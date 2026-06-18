(() => {
  "use strict";

  const { LocalStorageAdapter, STORAGE_KEY } = window.FadingFuriganaStorage;

  class ChromeStorageAdapter {
    constructor(storageArea = window.chrome?.storage?.local, { loopbackClient = null, enableLoopback = true } = {}) {
      this.storageArea = storageArea;
      this.loopbackClient = loopbackClient || (enableLoopback ? createLoopbackClient(storageArea) : null);
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

      const nextState = window.FadingFuriganaState.prepareStateForSave(state);
      await callStorage(this.storageArea, "set", { [STORAGE_KEY]: nextState });
      this.queueLoopbackFlush(nextState);
      return window.FadingFuriganaState.migrateAppState(nextState);
    }

    async clearState() {
      if (!this.storageArea) return;
      await callStorage(this.storageArea, "remove", STORAGE_KEY);
    }

    getStorageStatus() {
      return {
        transport: "local",
        lastSuccessAt: null,
        lastError: null,
        loopback: this.loopbackClient?.getStatus?.() || null
      };
    }

    // Exposed so the popup can drive pairing (set code, verify, sync now) without reaching into
    // internals. Null when this build has no loopback transport (e.g. the Safari fallback path).
    getLoopbackClient() {
      return this.loopbackClient;
    }

    async flushToMacApp(state) {
      if (!this.loopbackClient) return { ok: false, applied: 0 };
      return this.loopbackClient.flushState(state);
    }

    queueLoopbackFlush(state) {
      if (!this.loopbackClient) return;
      Promise.resolve()
        .then(() => this.loopbackClient.flushState(state))
        .catch(() => {
          // Chrome remains fully local-first; loopback failures are visible via
          // getStorageStatus() but never block annotation or local persistence.
        });
    }
  }

  // Prefer the background service worker (so loopback fetches are first-party extension
  // requests); fall back to a direct in-context client when there is no worker to message
  // (e.g. tests, or a context without runtime.sendMessage).
  function createLoopbackClient(storageArea) {
    const loopback = window.FadingFuriganaLoopback;
    if (!loopback) return null;
    const runtime = window.chrome?.runtime || window.browser?.runtime;
    if (typeof runtime?.sendMessage === "function" && loopback.BackgroundLoopbackClient) {
      return new loopback.BackgroundLoopbackClient({ runtime });
    }
    return loopback.MacLoopbackClient ? new loopback.MacLoopbackClient({ storageArea }) : null;
  }

  function createBestAvailableStorageAdapter() {
    if (window.FadingFuriganaStorage.isSafariNativeStorageAvailable?.()) {
      return new window.FadingFuriganaStorage.SafariNativeStorageAdapter({
        // Safari reaches the Mac app over the App Group, not loopback, so the fallback adapter
        // must not also probe 127.0.0.1.
        fallbackAdapter: window.chrome?.storage?.local
          ? new ChromeStorageAdapter(window.chrome.storage.local, { enableLoopback: false })
          : null
      });
    }
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
