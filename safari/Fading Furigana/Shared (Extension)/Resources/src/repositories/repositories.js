(() => {
  "use strict";

  function getStateValue(stateOrProvider) {
    return typeof stateOrProvider === "function" ? stateOrProvider() : stateOrProvider;
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
      state.exposure.seenCount += 1;
      state.exposure.firstSeenAt ||= now;
      state.exposure.lastSeenAt = now;
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

      if (status === "ignored") {
        state.userIntent.ignored = true;
        state.interaction.ignoredCount += 1;
      }

      return state;
    }
  }

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
          lastSeenAt: seenAt
        };
      }

      const summary = this.state.dailyExposureSummaries[id];
      summary.totalSeenCount += 1;
      summary.surfaceForms[input.surface] = (summary.surfaceForms[input.surface] || 0) + 1;
      summary.firstSeenAt ||= seenAt;
      summary.lastSeenAt = seenAt;

      if (!summary.pages[pageKey]) {
        summary.pages[pageKey] = {
          pageTitle: input.pageTitle,
          domain: input.domain,
          seenCount: 0,
          firstSeenAt: seenAt,
          lastSeenAt: seenAt
        };
        summary.uniquePageCount += 1;
      }

      summary.pages[pageKey].seenCount += 1;
      summary.pages[pageKey].lastSeenAt = seenAt;
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
