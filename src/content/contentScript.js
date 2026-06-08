(() => {
  "use strict";

  function createId(...parts) {
    return window.FadingFuriganaState.createId(...parts);
  }

  class LocalWordRepository {
    constructor(storageAdapter) {
      this.storageAdapter = storageAdapter;
      this.state = window.FadingFuriganaState.createDefaultAppState();
      this.lexicalItems = new window.FadingFuriganaRepositories.LexicalItemRepository(() => this.state);
      this.userLexicalStates = new window.FadingFuriganaRepositories.UserLexicalStateRepository(() => this.state);
      this.exposures = new window.FadingFuriganaRepositories.ExposureRepository(() => this.state);
      this.persistScheduler = new window.FadingFuriganaPersistScheduler.PersistScheduler(
        () => this.persistImmediately(),
        { delayMs: 250 }
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
      const existingState = this.userLexicalStates.markSaved(item.id, now);

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
      const saveUrls = this.state.settings.exposureTracking.saveUrls;

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
          pageKey: window.location.href,
          url: window.location.href,
          domain: window.location.hostname,
          pageTitle: document.title
        };
      }

      return {
        pageKey: window.location.hostname || "unknown-page",
        url: undefined,
        domain: window.location.hostname,
        pageTitle: document.title
      };
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

  async function boot() {
    if (!document.body || window.__fadingFuriganaLoaded) return;
    window.__fadingFuriganaLoaded = true;

    const storageAdapter = window.FadingFuriganaStorage.createBestAvailableStorageAdapter();
    const repository = new LocalWordRepository(storageAdapter);
    await repository.load();
    const dictionaryProvider = new window.FadingFuriganaDictionary.LocalDictionaryProvider();
    const analyzer = new window.FadingFuriganaDictionary.JapaneseAnalyzer(dictionaryProvider);
    let engine;
    const tooltip = new window.FadingFuriganaTooltip.Tooltip(repository, () => engine.refresh());
    engine = new window.FadingFuriganaAnnotationEngine.AnnotationEngine({
      analyzer,
      repository,
      tooltip
    });
    engine.start();

    if (window.chrome?.runtime?.onMessage) {
      window.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type !== "FADING_FURIGANA_SETTINGS_UPDATED") return false;

        repository
          .load()
          .then(() => {
            engine.refresh();
            sendResponse({ ok: true });
          })
          .catch((error) => {
            sendResponse({ ok: false, error: error.message });
          });
        return true;
      });
    }
  }

  boot();
})();
