(() => {
  "use strict";

  const LOOPBACK_STATE_KEY = "jrFadingFuriganaLoopback";
  const DEFAULT_PORTS = Array.from({ length: 21 }, (_, index) => 57310 + index);
  const DEFAULT_TIMEOUT_MS = 400;
  const MAX_PENDING_BATCHES = 8;

  class MacLoopbackClient {
    constructor({
      storageArea = window.chrome?.storage?.local,
      fetchImpl = globalThis.fetch?.bind(globalThis),
      ports = DEFAULT_PORTS,
      timeoutMs = DEFAULT_TIMEOUT_MS
    } = {}) {
      this.storageArea = storageArea;
      this.fetchImpl = fetchImpl;
      this.ports = ports;
      this.timeoutMs = timeoutMs;
      this.status = {
        connected: false,
        lastSuccessAt: null,
        lastError: null,
        port: null
      };
    }

    getStatus() {
      return { ...this.status };
    }

    async enqueueState(state) {
      const batch = window.FadingFuriganaRecordBatch.createRecordBatchFromAppState(state, {
        sourceKind: "chrome-extension",
        targetKind: "mac-app",
        direction: "push"
      });
      const stored = await this.loadStoredState();
      const pending = [...(stored.pendingBatches || []), batch].slice(-MAX_PENDING_BATCHES);
      await this.saveStoredState({ ...stored, pendingBatches: pending });
      return batch;
    }

    async flushState(state) {
      await this.enqueueState(state);
      return this.flushPending();
    }

    async flushPending() {
      if (!this.fetchImpl || !this.storageArea) {
        this.markFailure(new Error("Chrome loopback transport is unavailable."));
        return { ok: false, applied: 0 };
      }

      const stored = await this.loadStoredState();
      const pending = [...(stored.pendingBatches || [])];
      if (pending.length === 0) return { ok: true, applied: 0 };

      const endpoint = await this.discoverEndpoint(stored.port);
      if (!endpoint) return { ok: false, applied: 0 };

      const remaining = [];
      let applied = 0;
      for (const batch of pending) {
        try {
          const response = await this.postJson(`${endpoint.baseUrl}/ingest-record-batch`, { batch }, stored.token);
          const ack = response?.ack;
          if (!ack?.ok) {
            throw new Error(ack?.error?.message || "Mac app rejected record batch.");
          }
          applied += 1;
        } catch (error) {
          remaining.push(batch);
          this.markFailure(error);
        }
      }

      await this.saveStoredState({
        ...stored,
        port: endpoint.port,
        pendingBatches: remaining
      });

      if (remaining.length === 0) this.markSuccess(endpoint.port);
      return { ok: remaining.length === 0, applied };
    }

    async pullRecordBatch({ cursor = null, targetKind = "chrome-extension" } = {}) {
      const stored = await this.loadStoredState();
      const endpoint = await this.discoverEndpoint(stored.port);
      if (!endpoint) throw new Error("Mac app loopback server is unavailable.");

      const response = await this.postJson(`${endpoint.baseUrl}/pull-record-batch`, { cursor, targetKind }, stored.token);
      this.markSuccess(endpoint.port);
      return response?.batch;
    }

    async pullState(options = {}) {
      const batch = await this.pullRecordBatch(options);
      return window.FadingFuriganaState.migrateAppState(
        window.FadingFuriganaRecordBatch.appStateFromRecordBatch(batch)
      );
    }

    async getToken() {
      const stored = await this.loadStoredState();
      return stored.token;
    }

    async setToken(token) {
      const normalized = normalizeToken(token);
      const stored = await this.loadStoredState();
      await this.saveStoredState({ ...stored, token: normalized || null });
      return normalized;
    }

    async clearToken() {
      const stored = await this.loadStoredState();
      await this.saveStoredState({ ...stored, token: null });
    }

    // Probes for the Mac app and confirms the stored pairing code is accepted. Distinguishes
    // "no app running" from "code rejected" so the popup can give the user the right next step.
    async verifyPairing() {
      if (!this.fetchImpl) return { ok: false, reason: "unavailable" };

      const stored = await this.loadStoredState();
      const endpoint = await this.discoverEndpoint(stored.port);
      if (!endpoint) return { ok: false, reason: "no_server" };

      try {
        const headers = { Accept: "application/json", "Content-Type": "application/json" };
        if (stored.token) headers.Authorization = `Bearer ${stored.token}`;
        const response = await this.fetchWithTimeout(`${endpoint.baseUrl}/pull-record-batch`, {
          method: "POST",
          headers,
          body: JSON.stringify({ cursor: null, targetKind: "chrome-extension" })
        });

        if (response.status === 401) {
          this.markFailure(new Error("Pairing code rejected."));
          return { ok: false, reason: "unauthorized", port: endpoint.port };
        }
        if (!response.ok) {
          this.markFailure(new Error(`Loopback request failed with HTTP ${response.status}.`));
          return { ok: false, reason: "error", port: endpoint.port };
        }

        await this.saveStoredState({ ...stored, port: endpoint.port });
        this.markSuccess(endpoint.port);
        return { ok: true, port: endpoint.port };
      } catch (error) {
        this.markFailure(error);
        return { ok: false, reason: "error", error: error?.message };
      }
    }

    async discoverEndpoint(preferredPort = null) {
      const ports = preferredPort
        ? [preferredPort, ...this.ports.filter((port) => port !== preferredPort)]
        : this.ports;

      for (const port of ports) {
        const baseUrl = `http://127.0.0.1:${port}`;
        try {
          const response = await this.fetchWithTimeout(`${baseUrl}/health`, {
            method: "GET",
            headers: { Accept: "application/json" }
          });
          if (!response?.ok) continue;
          const body = await response.json();
          if (body?.ok && body?.protocolVersion === 1) {
            this.markSuccess(port);
            return { port, baseUrl };
          }
        } catch (error) {
          this.markFailure(error);
        }
      }
      return null;
    }

    async postJson(url, body, token) {
      const headers = {
        Accept: "application/json",
        "Content-Type": "application/json"
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      const response = await this.fetchWithTimeout(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `Loopback request failed with HTTP ${response.status}.`);
      }
      return payload;
    }

    fetchWithTimeout(url, options = {}) {
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timeout = controller
        ? setTimeout(() => controller.abort(), this.timeoutMs)
        : null;
      const request = this.fetchImpl(url, {
        ...options,
        cache: "no-store",
        signal: controller?.signal
      });
      return Promise.resolve(request).finally(() => {
        if (timeout) clearTimeout(timeout);
      });
    }

    async loadStoredState() {
      const values = await callStorage(this.storageArea, "get", LOOPBACK_STATE_KEY);
      const raw = values?.[LOOPBACK_STATE_KEY];
      if (!raw || typeof raw !== "object") {
        return { port: null, token: null, pendingBatches: [] };
      }
      return {
        port: Number.isInteger(raw.port) ? raw.port : null,
        token: typeof raw.token === "string" ? raw.token : null,
        pendingBatches: Array.isArray(raw.pendingBatches) ? raw.pendingBatches : []
      };
    }

    async saveStoredState(state) {
      await callStorage(this.storageArea, "set", {
        [LOOPBACK_STATE_KEY]: {
          port: Number.isInteger(state.port) ? state.port : null,
          token: typeof state.token === "string" ? state.token : null,
          pendingBatches: Array.isArray(state.pendingBatches) ? state.pendingBatches : []
        }
      });
    }

    markSuccess(port) {
      this.status.connected = true;
      this.status.port = port;
      this.status.lastSuccessAt = window.FadingFuriganaState.createTimestamp();
      this.status.lastError = null;
    }

    markFailure(error) {
      this.status.connected = false;
      this.status.lastError = error?.message || String(error);
    }
  }

  // Mirrors LoopbackPairing.normalize in the Mac app: uppercase, keep only A-Z0-9, so a code
  // pasted with spaces/dashes/lowercase still matches what the app stored.
  function normalizeToken(input) {
    return String(input || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
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

  window.FadingFuriganaLoopback = {
    MacLoopbackClient,
    LOOPBACK_STATE_KEY,
    DEFAULT_PORTS,
    normalizeToken
  };
})();
