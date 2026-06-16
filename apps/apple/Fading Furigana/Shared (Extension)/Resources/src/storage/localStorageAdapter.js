(() => {
  "use strict";

  const STORAGE_KEY = "jrFadingFuriganaState";

  class LocalStorageAdapter {
    constructor(storage = window.localStorage) {
      this.storage = storage;
    }

    async loadState() {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return window.FadingFuriganaState.createDefaultAppState();

      try {
        return window.FadingFuriganaState.migrateAppState(JSON.parse(raw));
      } catch {
        return window.FadingFuriganaState.createDefaultAppState();
      }
    }

    async saveState(state) {
      const nextState = window.FadingFuriganaState.prepareStateForSave(state);
      this.storage.setItem(STORAGE_KEY, JSON.stringify(nextState));
      return window.FadingFuriganaState.migrateAppState(nextState);
    }

    async clearState() {
      this.storage.removeItem(STORAGE_KEY);
    }

    getStorageStatus() {
      return { transport: "local", lastSuccessAt: null, lastError: null };
    }
  }

  window.FadingFuriganaStorage = {
    LocalStorageAdapter,
    STORAGE_KEY
  };
})();
