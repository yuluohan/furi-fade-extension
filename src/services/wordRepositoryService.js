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
      this.state = await this.storageAdapter.loadState();
      await this.persist();
    }

    async persist() {
      await this.persistScheduler.flush();
    }

    async persistImmediately() {
      await this.storageAdapter.saveState(this.state);
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
      return this.setStatus(token, "mastered", "hidden");
    }

    ignore(token) {
      return this.setStatus(token, "ignored", "hidden");
    }

    async recordSeen(token) {
      const now = new Date().toISOString();
      const item = this.upsertLexicalItem(token, now);
      this.userLexicalStates.recordSeen(item.id, now);
      this.recordDailyExposure(item.id, token.surface, now);
      this.persistScheduler.schedule();
    }

    recordDailyExposure(lexicalItemId, surface, seenAt) {
      const pageContext = this.getPageContext();
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
