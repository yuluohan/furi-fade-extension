(() => {
  "use strict";

  const MESSAGE_TYPE = "FADING_FURIGANA_STORAGE";
  const RESPONSE_TYPE = "FADING_FURIGANA_STORAGE_RESPONSE";
  const RELAY_MESSAGE_TYPE = "FADING_FURIGANA_NATIVE_STORAGE_RELAY";
  const {
    appStateFromRecordBatch,
    createRecordBatchFromAppState
  } = window.FadingFuriganaRecordBatch;

  class SafariNativeStorageAdapter {
    constructor({ runtime = getRuntime(), fallbackAdapter = null } = {}) {
      this.runtime = runtime;
      this.fallbackAdapter = fallbackAdapter;
      // Diagnostics surfaced in the popup: did the last read/write reach the
      // native store, or did it fall back to local storage?
      this.storageStatus = { transport: "unknown", lastSuccessAt: null, lastError: null };
    }

    // Snapshot of the most recent storage transport for the popup status panel.
    getStorageStatus() {
      return { ...this.storageStatus };
    }

    markNativeSuccess() {
      this.storageStatus.transport = "native";
      this.storageStatus.lastSuccessAt = window.FadingFuriganaState.createTimestamp();
      this.storageStatus.lastError = null;
    }

    markFallback(error) {
      this.storageStatus.transport = "fallback";
      this.storageStatus.lastError = error?.message || String(error);
    }

    async loadState() {
      try {
        const batch = await this.pullRecordBatch({ targetKind: "safari-extension", suppressWarning: true });
        return migrate(appStateFromRecordBatch(batch));
      } catch (error) {
        // Cached/older native handlers may not know recordBatch yet. Fall back
        // to the legacy whole-state action before surfacing an error.
      }

      try {
        const response = await this.send("loadState");
        const state = migrate(response?.payload?.state);
        if (isMeaningfulState(state) || !this.fallbackAdapter) return state;

        const fallbackState = await this.fallbackAdapter.loadState();
        if (isMeaningfulState(fallbackState)) {
          await this.saveState(fallbackState);
          return fallbackState;
        }
        return state;
      } catch (error) {
        warnNativeFailure("loadState", error);
        this.markFallback(error);
        return this.fallbackAdapter
          ? this.fallbackAdapter.loadState()
          : window.FadingFuriganaState.createDefaultAppState();
      }
    }

    async saveState(state) {
      try {
        const preparedState = window.FadingFuriganaState.prepareStateForSave(state);
        const batch = createRecordBatchFromAppState(preparedState, {
          sourceKind: "safari-extension",
          targetKind: "mac-app",
          direction: "push"
        });
        const ack = await this.ingestRecordBatch(batch, { suppressWarning: true });
        if (!ack?.ok) {
          throw new Error(ack?.error?.message || "Safari native record batch ingest failed.");
        }
        const pulled = await this.pullRecordBatch({ targetKind: "safari-extension", suppressWarning: true });
        return migrate(appStateFromRecordBatch(pulled));
      } catch (error) {
        // Keep legacy whole-state save as a migration guard for cached Safari
        // content scripts and older native handlers.
      }

      try {
        const response = await this.send("saveState", { state });
        return migrate(response?.payload?.state);
      } catch (error) {
        warnNativeFailure("saveState", error);
        this.markFallback(error);
        if (!this.fallbackAdapter) throw error;
        return this.fallbackAdapter.saveState(state);
      }
    }

    async ingestRecordBatch(batch, { suppressWarning = false } = {}) {
      try {
        const response = await this.send("ingestRecordBatch", { batch });
        return response?.payload?.ack;
      } catch (error) {
        if (!suppressWarning) warnNativeFailure("ingestRecordBatch", error);
        this.markFallback(error);
        if (typeof this.fallbackAdapter?.ingestRecordBatch === "function") {
          return this.fallbackAdapter.ingestRecordBatch(batch);
        }
        throw error;
      }
    }

    async pullRecordBatch({ cursor = null, targetKind = "safari-extension", suppressWarning = false } = {}) {
      try {
        const response = await this.send("pullRecordBatch", { cursor, targetKind });
        return response?.payload?.batch;
      } catch (error) {
        if (!suppressWarning) warnNativeFailure("pullRecordBatch", error);
        this.markFallback(error);
        if (typeof this.fallbackAdapter?.pullRecordBatch === "function") {
          return this.fallbackAdapter.pullRecordBatch({ cursor, targetKind });
        }
        throw error;
      }
    }

    async clearState() {
      try {
        await this.send("clearState");
      } catch (error) {
        warnNativeFailure("clearState", error);
        this.markFallback(error);
        if (!this.fallbackAdapter) throw error;
        await this.fallbackAdapter.clearState();
      }
    }

    async send(action, payload = {}) {
      if (!this.runtime?.sendNativeMessage && !this.runtime?.sendMessage) {
        throw new Error("Safari native messaging is unavailable.");
      }

      const request = {
        type: MESSAGE_TYPE,
        action,
        payload,
        requestId: `${Date.now()}-${Math.random().toString(36).slice(2)}`
      };
      const response = await sendNativeStorageRequest(this.runtime, request);
      if (response?.type !== RESPONSE_TYPE || response.requestId !== request.requestId) {
        throw new Error("Invalid Safari native storage response.");
      }
      if (!response.ok) {
        throw new Error(response.error || "Safari native storage request failed.");
      }
      this.markNativeSuccess();
      return response;
    }
  }

  function isSafariNativeStorageAvailable() {
    const runtime = getRuntime();
    const vendor = window.navigator?.vendor || "";
    return (
      /Apple/i.test(vendor) &&
      (typeof runtime?.sendNativeMessage === "function" || typeof runtime?.sendMessage === "function")
    );
  }

  function getRuntime() {
    return window.browser?.runtime || window.chrome?.runtime;
  }

  async function sendNativeStorageRequest(runtime, message) {
    if (typeof runtime?.sendNativeMessage === "function") {
      return callRuntimeMethod(runtime, "sendNativeMessage", message);
    }

    if (typeof runtime?.sendMessage === "function") {
      const relayResponse = await callRuntimeMethod(runtime, "sendMessage", {
        type: RELAY_MESSAGE_TYPE,
        payload: message
      });
      if (!relayResponse?.ok) {
        throw new Error(relayResponse?.error || "Safari native storage relay failed.");
      }
      return relayResponse.response;
    }

    throw new Error("Safari native messaging is unavailable.");
  }

  function callRuntimeMethod(runtime, methodName, message) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (handler, value) => {
        if (settled) return;
        settled = true;
        handler(value);
      };

      const callback = (response) => {
        const lastError = window.chrome?.runtime?.lastError || window.browser?.runtime?.lastError;
        if (lastError) {
          settle(reject, new Error(lastError.message));
          return;
        }
        settle(resolve, response);
      };

      try {
        const maybePromise = runtime[methodName](message, callback);
        if (maybePromise?.then) {
          maybePromise.then((response) => settle(resolve, response), (error) => settle(reject, error));
        }
      } catch (error) {
        settle(reject, error);
      }
    });
  }

  function migrate(state) {
    return window.FadingFuriganaState.migrateAppState(state);
  }

  function isMeaningfulState(state) {
    return (
      Object.keys(state.lexicalItems || {}).length > 0 ||
      Object.keys(state.userLexicalStates || {}).length > 0 ||
      Object.keys(state.dailyExposureSummaries || {}).length > 0
    );
  }

  function warnNativeFailure(action, error) {
    console.warn(`[Fading Furigana] Safari native storage ${action} failed:`, error?.message || error);
  }

  window.FadingFuriganaStorage = {
    ...window.FadingFuriganaStorage,
    SafariNativeStorageAdapter,
    isSafariNativeStorageAvailable
  };
})();
