(() => {
  "use strict";

  function createId(...parts) {
    return window.FadingFuriganaState.createId(...parts);
  }

  class WordRepositoryService {
    constructor(storageAdapter, { pageContextProvider = createBrowserPageContext, persistDelayMs = 250 } = {}) {
      this.storageAdapter = storageAdapter;
      this.pageContextProvider = pageContextProvider;
      this.state = window.FadingFuriganaState.createDefaultAppState();
      this.lexicalItems = new window.FadingFuriganaRepositories.LexicalItemRepository(() => this.state);
      this.userLexicalStates = new window.FadingFuriganaRepositories.UserLexicalStateRepository(() => this.state);
      this.exposures = new window.FadingFuriganaRepositories.ExposureRepository(() => this.state);
      this.persistScheduler = new window.FadingFuriganaPersistScheduler.PersistScheduler(
        () => this.persistImmediately(),
        { delayMs: persistDelayMs }
      );
    }

    async load() {
      // Read-only: persisting here would make every storage.onChanged-driven
      // reload write storage again and feed an endless change/reload loop.
      this.state = await this.storageAdapter.loadState();
    }

    async persist() {
      await this.persistScheduler.flush();
    }

    async persistImmediately() {
      this.compactState();
      // The popup owns settings; a content tab persisting exposure data must
      // not write its possibly stale in-memory settings back over them.
      const stored = await this.storageAdapter.loadState();
      const nextState = stored?.settings ? { ...this.state, settings: stored.settings } : this.state;

      try {
        await this.storageAdapter.saveState(nextState);
        this.persistFailureLogged = false;
      } catch (error) {
        if (!this.persistFailureLogged) {
          this.persistFailureLogged = true;
          console.warn("[Fading Furigana] Failed to save state:", error?.message || error);
        }
        throw error;
      }
    }

    // Keeps stored state within storage quota: drops expired exposure
    // summaries, legacy per-page titles, and meanings of words the user never
    // interacted with (the dictionary re-supplies them at annotation time).
    compactState() {
      const retentionDays = this.state.settings.exposureTracking.retentionDays || 90;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
      const cutoff = window.FadingFuriganaState.getLocalDateKey(cutoffDate);

      for (const [id, summary] of Object.entries(this.state.dailyExposureSummaries)) {
        if (summary.date < cutoff) {
          delete this.state.dailyExposureSummaries[id];
          continue;
        }
        for (const page of Object.values(summary.pages || {})) {
          delete page.pageTitle;
        }
      }

      for (const [id, item] of Object.entries(this.state.lexicalItems)) {
        if (!item.meanings || Object.keys(item.meanings).length === 0) continue;
        const userState = this.state.userLexicalStates[id];
        const interacted =
          userState &&
          (userState.userIntent?.saved ||
            userState.userIntent?.ignored ||
            userState.userIntent?.manuallyMarkedKnown ||
            (userState.interaction?.tooltipOpenCount || 0) > 0);
        if (!interacted) item.meanings = {};
      }
    }

    get settings() {
      return this.state.settings;
    }

    getUserWordState(wordId) {
      return this.userLexicalStates.getByLexicalItemId(wordId);
    }

    getLegacyUserWordState(wordId) {
      const state = this.getUserWordState(wordId);
      if (!state) return null;
      return {
        status: state.lifecycleStatus === "mastered" ? "mastered" : state.lifecycleStatus,
        annotationLevel: state.annotationLevel === "hidden" ? "hidden" : "ruby"
      };
    }

    upsertLexicalItem(token, now = new Date().toISOString()) {
      return this.lexicalItems.upsertFromToken(token, now);
    }

    ensureUserState(lexicalItemId, now = new Date().toISOString()) {
      return this.userLexicalStates.ensure(lexicalItemId, now);
    }

    async saveWord(token, sourceSentence) {
      const now = new Date().toISOString();
      const item = this.upsertLexicalItem(token, now);
      const occurrenceId = createId("occurrence", item.id, sourceSentence, now);
      this.userLexicalStates.markSaved(item.id, now);

      this.state.sourceOccurrences[occurrenceId] = {
        id: occurrenceId,
        lexicalItemId: item.id,
        surface: token.surface,
        sentence: sourceSentence,
        ...this.getPageContext(),
        createdAt: now
      };

      await this.persist();
    }

    markKnown(token) {
      return this.setStatus(token, "known", "hidden");
    }

    ignore(token) {
      return this.setStatus(token, "ignored", "hidden");
    }

    async markForgotten(token) {
      const now = new Date().toISOString();
      const item = this.upsertLexicalItem(token, now);
      this.userLexicalStates.resetLearning(item.id, now);
      await this.persist();
    }

    async pinAnnotation(token) {
      const now = new Date().toISOString();
      const item = this.upsertLexicalItem(token, now);
      this.userLexicalStates.setPinnedAnnotation(item.id, true, now);
      await this.persist();
    }

    async recordSeen(token) {
      const now = new Date().toISOString();
      // Exposure-only words store no meanings (the dictionary provides them
      // at annotation time); full entries are written when the user saves or
      // marks a word. Existing items are left untouched to avoid churn.
      const lexicalItemId = token.lexicalItemId || token.id;
      const item =
        this.lexicalItems.getById(lexicalItemId) || this.upsertLexicalItem({ ...token, meanings: {} }, now);
      this.userLexicalStates.recordSeen(item.id, now);
      this.recordDailyExposure(item.id, token.surface, now);
      this.persistScheduler.schedule();
    }

    recordDailyExposure(lexicalItemId, surface, seenAt) {
      // Exposure summaries never store page titles; titles only belong to
      // explicitly saved occurrences.
      const { pageTitle, ...pageContext } = this.getPageContext();
      return this.exposures.recordDailyExposure({
        lexicalItemId,
        surface,
        ...pageContext,
        seenAt
      });
    }

    getPageContext() {
      return createPrivacyAwarePageContext(
        this.state.settings.exposureTracking.saveUrls,
        this.pageContextProvider()
      );
    }

    listDailyExposures(date = window.FadingFuriganaState.getLocalDateKey()) {
      return this.exposures.listDailyExposures(date);
    }

    listFrequentItems(range) {
      return this.exposures.listFrequentItems(range);
    }

    async setStatus(token, status, annotationLevel) {
      const now = new Date().toISOString();
      const item = this.upsertLexicalItem(token, now);
      this.userLexicalStates.setStatus(item.id, status, annotationLevel, now);
      await this.persist();
    }
  }

  function createBrowserPageContext() {
    return {
      url: window.location.href,
      domain: window.location.hostname,
      pageTitle: document.title
    };
  }

  function createPrivacyAwarePageContext(saveUrls, pageContext) {
    if (saveUrls === "none") {
      return {
        pageKey: "private-page",
        url: undefined,
        domain: undefined,
        pageTitle: undefined
      };
    }

    if (saveUrls === "full") {
      return {
        pageKey: pageContext.url,
        url: pageContext.url,
        domain: pageContext.domain,
        pageTitle: pageContext.pageTitle
      };
    }

    return {
      pageKey: pageContext.domain || "unknown-page",
      url: undefined,
      domain: pageContext.domain,
      pageTitle: pageContext.pageTitle
    };
  }

  window.FadingFuriganaWordRepository = {
    WordRepositoryService,
    createPrivacyAwarePageContext
  };
})();
