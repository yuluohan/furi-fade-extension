(() => {
  "use strict";

  const { LocalStorageAdapter, STORAGE_KEY } = window.FadingFuriganaStorage;

  class ChromeStorageAdapter {
    constructor(storageArea = window.chrome?.storage?.local) {
      this.storageArea = storageArea;
    }

    async loadState() {
      if (!this.storageArea) return window.FadingFuriganaState.createDefaultAppState();

      const values = await callStorage(this.storageArea, "get", STORAGE_KEY);
      const raw = values?.[STORAGE_KEY];
      if (!raw) return window.FadingFuriganaState.createDefaultAppState();

      try {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        return window.FadingFuriganaState.migrateAppState(parsed);
      } catch {
        return window.FadingFuriganaState.createDefaultAppState();
      }
    }

    async saveState(state) {
      if (!this.storageArea) return;

      const nextState = {
        ...state,
        metadata: {
          ...state.metadata,
          updatedAt: window.FadingFuriganaState.createTimestamp()
        }
      };
      await callStorage(this.storageArea, "set", { [STORAGE_KEY]: nextState });
    }

    async clearState() {
      if (!this.storageArea) return;
      await callStorage(this.storageArea, "remove", STORAGE_KEY);
    }
  }

  function createBestAvailableStorageAdapter() {
    if (window.chrome?.storage?.local) {
      return new ChromeStorageAdapter(window.chrome.storage.local);
    }
    return new LocalStorageAdapter();
  }

  function callStorage(storageArea, methodName, payload) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (handler, value) => {
        if (settled) return;
        settled = true;
        handler(value);
      };

      const callback = (result) => {
        const lastError = window.chrome?.runtime?.lastError;
        if (lastError) {
          settle(reject, new Error(lastError.message));
          return;
        }
        settle(resolve, result);
      };

      try {
        const maybePromise = storageArea[methodName](payload, callback);
        if (maybePromise?.then) {
          maybePromise.then((result) => settle(resolve, result), (error) => settle(reject, error));
        }
      } catch (error) {
        settle(reject, error);
      }
    });
  }

  window.FadingFuriganaStorage = {
    ...window.FadingFuriganaStorage,
    ChromeStorageAdapter,
    createBestAvailableStorageAdapter
  };
})();
