(() => {
  "use strict";

  function getStateValue(stateOrProvider) {
    return typeof stateOrProvider === "function" ? stateOrProvider() : stateOrProvider;
  }

  function stateDeviceId(state) {
    return state.metadata?.deviceId || "dev_unknown";
  }

  class LexicalItemRepository {
    constructor(stateOrProvider) {
      this.stateOrProvider = stateOrProvider;
    }

    get state() {
      return getStateValue(this.stateOrProvider);
    }

    getById(id) {
      return this.state.lexicalItems[id] || null;
    }

    upsertFromToken(token, now = window.FadingFuriganaState.createTimestamp()) {
      const lexicalItemId = token.lexicalItemId || token.id;
      const item = window.FadingFuriganaState.createLexicalItemFromToken(
        token,
        this.state.lexicalItems[lexicalItemId],
        now
      );
      this.state.lexicalItems[lexicalItemId] = item;
      return item;
    }

    listVocabulary() {
      return Object.values(this.state.lexicalItems);
    }
  }

  class UserLexicalStateRepository {
    constructor(stateOrProvider) {
      this.stateOrProvider = stateOrProvider;
    }

    get state() {
      return getStateValue(this.stateOrProvider);
    }

    getByLexicalItemId(lexicalItemId) {
      return this.state.userLexicalStates[lexicalItemId] || null;
    }

    ensure(lexicalItemId, now = window.FadingFuriganaState.createTimestamp()) {
      if (!this.state.userLexicalStates[lexicalItemId]) {
        this.state.userLexicalStates[lexicalItemId] =
          window.FadingFuriganaState.createDefaultUserLexicalState(lexicalItemId, now);
      }
      return this.state.userLexicalStates[lexicalItemId];
    }

    recordSeen(lexicalItemId, now = window.FadingFuriganaState.createTimestamp()) {
      const state = this.ensure(lexicalItemId, now);
      if (state.lifecycleStatus === "discovered") state.lifecycleStatus = "new";
      state.exposure.seenCount += 1;
      state.exposure.firstSeenAt ||= now;
      state.exposure.lastSeenAt = now;
      state.updatedAt = now;
      state.deviceId ||= stateDeviceId(this.state);
      return state;
    }

    markSaved(lexicalItemId, now = window.FadingFuriganaState.createTimestamp()) {
      const state = this.ensure(lexicalItemId, now);
      state.lifecycleStatus = "learning";
      state.annotationLevel = "full_ruby";
      state.knowledgeConfidence = Math.min(state.knowledgeConfidence, 0.4);
      state.userIntent.saved = true;
      state.interaction.savedCount += 1;
      state.interaction.lastActionAt = now;
      state.learning.reviewStage = "learning";
      state.updatedAt = now;
      state.deviceId ||= stateDeviceId(this.state);
      return state;
    }

    setStatus(lexicalItemId, status, annotationLevel, now = window.FadingFuriganaState.createTimestamp()) {
      const state = this.ensure(lexicalItemId, now);
      state.lifecycleStatus = status;
      state.annotationLevel = annotationLevel === "hidden" ? "hidden" : "full_ruby";
      state.interaction.lastActionAt = now;

      if (status === "mastered") {
        state.knowledgeConfidence = 1;
        state.userIntent.manuallyMarkedKnown = true;
        state.interaction.markedKnownCount += 1;
      }

      if (status === "known") {
        state.knowledgeConfidence = Math.max(state.knowledgeConfidence, 0.9);
        state.userIntent.manuallyMarkedKnown = true;
        state.interaction.markedKnownCount += 1;
      }

      if (status === "ignored") {
        state.userIntent.ignored = true;
        state.interaction.ignoredCount += 1;
      }

      state.updatedAt = now;
      state.deviceId ||= stateDeviceId(this.state);
      return state;
    }

    resetLearning(lexicalItemId, now = window.FadingFuriganaState.createTimestamp()) {
      const state = this.ensure(lexicalItemId, now);
      state.lifecycleStatus = "learning";
      state.annotationLevel = "full_ruby";
      state.knowledgeConfidence = 0;
      state.userIntent.saved = true;
      state.userIntent.ignored = false;
      state.userIntent.manuallyMarkedKnown = false;
      state.userIntent.manuallyMarkedUnknown = true;
      state.interaction.lastActionAt = now;
      state.learning.reviewStage = "lapsed";
      state.learning.wrongCount += 1;
      state.learning.correctStreak = 0;
      state.intelligence.confidenceKnown = 0;
      state.intelligence.confidenceNeedsHelp = 1;
      state.intelligence.reasonCodes = [...new Set([...(state.intelligence.reasonCodes || []), "user_forgot"])];
      state.updatedAt = now;
      state.deviceId ||= stateDeviceId(this.state);
      return state;
    }

    setPinnedAnnotation(lexicalItemId, pinned, now = window.FadingFuriganaState.createTimestamp()) {
      const state = this.ensure(lexicalItemId, now);
      state.userIntent.pinnedAnnotation = !!pinned;
      if (pinned && state.annotationLevel === "hidden") state.annotationLevel = "full_ruby";
      state.interaction.lastActionAt = now;
      state.intelligence.reasonCodes = [
        ...new Set([...(state.intelligence.reasonCodes || []), pinned ? "user_pinned_annotation" : "user_unpinned_annotation"])
      ];
      state.updatedAt = now;
      state.deviceId ||= stateDeviceId(this.state);
      return state;
    }
  }

  // Storage quota is tight (about 10 MB in Safari); exposure summaries must
  // stay small no matter how much the user reads.
  const MAX_SURFACE_FORMS_PER_SUMMARY = 5;
  const MAX_PAGES_PER_SUMMARY = 8;

  class ExposureRepository {
    constructor(stateOrProvider) {
      this.stateOrProvider = stateOrProvider;
    }

    get state() {
      return getStateValue(this.stateOrProvider);
    }

    recordDailyExposure(input) {
      if (!this.state.settings.exposureTracking.enabled) return null;

      const seenAt = input.seenAt || window.FadingFuriganaState.createTimestamp();
      const date = input.date || window.FadingFuriganaState.getLocalDateKey(new Date(seenAt));
      const id = window.FadingFuriganaState.createId("daily-exposure", date, input.lexicalItemId);
      const pageKey = input.pageKey || input.url || input.domain || "unknown-page";

      if (!this.state.dailyExposureSummaries[id]) {
        this.state.dailyExposureSummaries[id] = {
          id,
          date,
          lexicalItemId: input.lexicalItemId,
          totalSeenCount: 0,
          uniquePageCount: 0,
          surfaceForms: {},
          pages: {},
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
          updatedAt: seenAt,
          deviceId: stateDeviceId(this.state)
        };
      }

      const summary = this.state.dailyExposureSummaries[id];
      summary.totalSeenCount += 1;
      summary.firstSeenAt ||= seenAt;
      summary.lastSeenAt = seenAt;
      summary.updatedAt = seenAt;
      summary.deviceId ||= stateDeviceId(this.state);

      if (
        summary.surfaceForms[input.surface] !== undefined ||
        Object.keys(summary.surfaceForms).length < MAX_SURFACE_FORMS_PER_SUMMARY
      ) {
        summary.surfaceForms[input.surface] = (summary.surfaceForms[input.surface] || 0) + 1;
      }

      let page = summary.pages[pageKey];
      if (!page && Object.keys(summary.pages).length < MAX_PAGES_PER_SUMMARY) {
        page = {
          domain: input.domain,
          seenCount: 0,
          firstSeenAt: seenAt,
          lastSeenAt: seenAt
        };
        summary.pages[pageKey] = page;
        summary.uniquePageCount += 1;
      }

      if (page) {
        page.seenCount += 1;
        page.lastSeenAt = seenAt;
      }
      return summary;
    }

    listDailyExposures(date) {
      return Object.values(this.state.dailyExposureSummaries)
        .filter((summary) => summary.date === date)
        .sort((a, b) => b.totalSeenCount - a.totalSeenCount);
    }

    listFrequentItems({ startDate, endDate }) {
      const totals = new Map();

      for (const summary of Object.values(this.state.dailyExposureSummaries)) {
        if (summary.date < startDate || summary.date > endDate) continue;
        const existing = totals.get(summary.lexicalItemId) || {
          lexicalItemId: summary.lexicalItemId,
          totalSeenCount: 0,
          uniquePageCount: 0,
          surfaceForms: {}
        };

        existing.totalSeenCount += summary.totalSeenCount;
        existing.uniquePageCount += summary.uniquePageCount;
        for (const [surface, count] of Object.entries(summary.surfaceForms)) {
          existing.surfaceForms[surface] = (existing.surfaceForms[surface] || 0) + count;
        }
        totals.set(summary.lexicalItemId, existing);
      }

      return [...totals.values()].sort((a, b) => b.totalSeenCount - a.totalSeenCount);
    }
  }

  window.FadingFuriganaRepositories = {
    ExposureRepository,
    LexicalItemRepository,
    UserLexicalStateRepository
  };
})();
