const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "..");

function loadBrowserScript(relativePath) {
  const filePath = path.join(rootDir, relativePath);
  vm.runInThisContext(fs.readFileSync(filePath, "utf8"), { filename: filePath });
}

function createMemoryStorage() {
  const values = {};
  return {
    values,
    getItem(key) {
      return values[key] || null;
    },
    setItem(key, value) {
      values[key] = value;
    },
    removeItem(key) {
      delete values[key];
    }
  };
}

function createCallbackChromeStorage() {
  const values = {};
  return {
    values,
    get(key, callback) {
      callback({ [key]: values[key] });
    },
    set(nextValues, callback) {
      Object.assign(values, nextValues);
      callback();
    },
    remove(key, callback) {
      delete values[key];
      callback();
    }
  };
}

function createPromiseChromeStorage() {
  const values = {};
  return {
    values,
    get(key) {
      return Promise.resolve({ [key]: values[key] });
    },
    set(nextValues) {
      Object.assign(values, nextValues);
      return Promise.resolve();
    },
    remove(key) {
      delete values[key];
      return Promise.resolve();
    }
  };
}

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`[pass] ${name}`);
  } catch (error) {
    console.error(`[fail] ${name}`);
    throw error;
  }
}

global.window = global;
global.localStorage = createMemoryStorage();
loadBrowserScript("src/core/appState.js");
loadBrowserScript("src/storage/localStorageAdapter.js");
loadBrowserScript("src/storage/recordBatchCodec.js");
loadBrowserScript("src/storage/safariNativeStorageAdapter.js");
loadBrowserScript("src/storage/chromeLoopbackClient.js");
loadBrowserScript("src/storage/chromeStorageAdapter.js");

const {
  ChromeStorageAdapter,
  SafariNativeStorageAdapter,
  STORAGE_KEY,
  createBestAvailableStorageAdapter
} = window.FadingFuriganaStorage;
const {
  MacLoopbackClient,
  BackgroundLoopbackClient,
  handleLoopbackAction,
  LOOPBACK_STATE_KEY,
  LOOPBACK_MESSAGE_TYPE
} = window.FadingFuriganaLoopback;

// Stands in for the background service worker: dispatches loopback messages to a worker-owned
// MacLoopbackClient, exactly as background.js does.
function createWorkerRuntime(workerClient) {
  const sent = [];
  const runtime = {
    sendMessage(message, callback) {
      sent.push(message);
      handleLoopbackAction(workerClient, message.action, message.payload)
        .then((result) => callback({ ok: true, result, status: workerClient.getStatus() }))
        .catch((error) => callback({ ok: false, error: error.message, status: workerClient.getStatus() }));
    }
  };
  return { runtime, sent };
}
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function recordId(type, logicalId) {
  return `${type}:${encodeURIComponent(logicalId)}`;
}

// Simulates the Mac loopback server on one port: /health for discovery, and bearer-gated
// pull/ingest endpoints. A missing or wrong token yields HTTP 401, matching the Swift server.
function createServerFetch({ token = null, port = 57312 } = {}) {
  const calls = [];
  const base = `http://127.0.0.1:${port}`;
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (!url.startsWith(`${base}/`)) {
      throw new Error("ECONNREFUSED"); // other ports refuse instantly
    }
    if (url === `${base}/health`) {
      return { ok: true, status: 200, json: async () => ({ ok: true, protocolVersion: 1 }) };
    }
    const presented = (options.headers?.Authorization || "").replace(/^Bearer /, "");
    if (token && presented !== token) {
      return { ok: false, status: 401, json: async () => ({ ok: false, error: "Loopback token is invalid." }) };
    }
    if (url === `${base}/pull-record-batch`) {
      return { ok: true, status: 200, json: async () => ({ ok: true, batch: { records: [] } }) };
    }
    if (url === `${base}/ingest-record-batch`) {
      const body = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ack: { ok: true, batchId: body.batch.batchId, appliedRecordIds: [], rejectedRecords: [] } })
      };
    }
    return { ok: false, status: 404, json: async () => ({ error: "not found" }) };
  };
  return { fetchImpl, calls };
}

function createNativeRecordBatchFromState(state, overrides = {}) {
  const metadata = state.metadata || {};
  const createdAt = overrides.createdAt || metadata.updatedAt || "2026-06-08T00:00:00.000Z";
  const deviceId = metadata.deviceId || "dev_test_native";
  const records = [
    {
      formatVersion: 1,
      recordId: "appMetadata:local",
      type: "appMetadata",
      domain: "metadata",
      logicalId: "local",
      syncScope: "local_only",
      mergeStrategy: "local_only",
      updatedAt: metadata.updatedAt || createdAt,
      deviceId,
      value: metadata
    }
  ];
  for (const [logicalId, value] of Object.entries(state.lexicalItems || {})) {
    records.push({
      formatVersion: 1,
      recordId: recordId("lexicalItem", logicalId),
      type: "lexicalItem",
      domain: "lexicalItems",
      logicalId,
      syncScope: "syncable",
      mergeStrategy: "lww",
      updatedAt: value.updatedAt || metadata.updatedAt || createdAt,
      deviceId: value.deviceId || deviceId,
      value
    });
  }
  return {
    protocolVersion: 1,
    batchId: overrides.batchId || "bat_native_test",
    sourceClientId: deviceId,
    sourceKind: overrides.sourceKind || "mac-app",
    targetKind: overrides.targetKind || "safari-extension",
    direction: "pull_response",
    createdAt,
    baseCursor: null,
    records
  };
}

function setNavigatorVendor(vendor) {
  Object.defineProperty(global, "navigator", {
    configurable: true,
    value: { vendor }
  });
}

test("loads and saves AppState through callback chrome.storage.local", async () => {
  setNavigatorVendor("Google Inc.");
  delete global.browser;
  global.chrome = { runtime: {}, storage: { local: createCallbackChromeStorage() } };
  const adapter = new ChromeStorageAdapter(global.chrome.storage.local, { enableLoopback: false });
  const state = window.FadingFuriganaState.createDefaultAppState("2026-06-08T00:00:00.000Z");

  state.lexicalItems.example = { id: "example" };
  const saved = await adapter.saveState(state);

  assert.equal(global.chrome.storage.local.values[STORAGE_KEY].lexicalItems.example.id, "example");
  assert.equal(saved.metadata.storageRevision, 1);
  assert.ok(saved.metadata.writeId);

  const loaded = await adapter.loadState();
  assert.equal(loaded.schemaVersion, 1);
  assert.equal(loaded.lexicalItems.example.id, "example");

  await adapter.clearState();
  assert.equal(global.chrome.storage.local.values[STORAGE_KEY], undefined);
});

test("loads legacy JSON strings from promise chrome.storage.local", async () => {
  setNavigatorVendor("Google Inc.");
  delete global.browser;
  global.chrome = { runtime: {}, storage: { local: createPromiseChromeStorage() } };
  const adapter = new ChromeStorageAdapter(global.chrome.storage.local, { enableLoopback: false });
  const legacyState = {
    settings: { enabled: true },
    words: {
      "確認:かくにん": {
        id: "確認:かくにん",
        surface: "確認",
        baseForm: "確認",
        reading: "かくにん",
        meaningEn: "confirmation"
      }
    },
    userWordStates: {}
  };

  global.chrome.storage.local.values[STORAGE_KEY] = JSON.stringify(legacyState);
  const loaded = await adapter.loadState();

  assert.equal(loaded.schemaVersion, 1);
  assert.equal(loaded.lexicalItems["確認:かくにん"].surface, "確認");
});

test("factory chooses chrome.storage.local when available", () => {
  setNavigatorVendor("Google Inc.");
  delete global.browser;
  global.chrome = { runtime: {}, storage: { local: createCallbackChromeStorage() } };
  const adapter = createBestAvailableStorageAdapter();

  assert.equal(adapter instanceof ChromeStorageAdapter, true);
});

test("Chrome loopback client discovers Mac app and flushes a record batch", async () => {
  setNavigatorVendor("Google Inc.");
  delete global.browser;
  const storageArea = createPromiseChromeStorage();
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === "http://127.0.0.1:57312/health") {
      return {
        ok: true,
        json: async () => ({ ok: true, protocolVersion: 1 })
      };
    }
    if (url === "http://127.0.0.1:57312/ingest-record-batch") {
      const body = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          ack: {
            protocolVersion: 1,
            batchId: body.batch.batchId,
            ok: true,
            appliedRecordIds: body.batch.records.map((record) => record.recordId),
            rejectedRecords: []
          }
        })
      };
    }
    return { ok: false, json: async () => ({ error: "not here" }) };
  };
  const client = new MacLoopbackClient({ storageArea, fetchImpl, ports: [57311, 57312], timeoutMs: 5 });
  const state = window.FadingFuriganaState.createDefaultAppState("2026-06-18T00:00:00.000Z");
  state.lexicalItems["確認:かくにん"] = { id: "確認:かくにん", surface: "確認", reading: "かくにん" };

  const result = await client.flushState(state);

  assert.equal(result.ok, true);
  assert.equal(result.applied, 1);
  const ingestRequest = requests.find((request) => request.url.endsWith("/ingest-record-batch"));
  const batch = JSON.parse(ingestRequest.options.body).batch;
  assert.equal(batch.sourceKind, "chrome-extension");
  assert.equal(batch.targetKind, "mac-app");
  assert.ok(batch.records.some((record) => record.recordId === recordId("lexicalItem", "確認:かくにん")));
  assert.equal(storageArea.values[LOOPBACK_STATE_KEY].pendingBatches.length, 0);
  assert.equal(storageArea.values[LOOPBACK_STATE_KEY].port, 57312);
});

test("ChromeStorageAdapter keeps local save when loopback is unavailable", async () => {
  setNavigatorVendor("Google Inc.");
  delete global.browser;
  global.chrome = { runtime: {}, storage: { local: createPromiseChromeStorage() } };
  const attempts = [];
  const loopbackClient = {
    getStatus: () => ({ connected: false, lastSuccessAt: null, lastError: "connection refused", port: null }),
    async flushState(state) {
      attempts.push(state);
      throw new Error("connection refused");
    }
  };
  const adapter = new ChromeStorageAdapter(global.chrome.storage.local, { loopbackClient });
  const state = window.FadingFuriganaState.createDefaultAppState("2026-06-18T00:00:00.000Z");
  state.lexicalItems.local = { id: "local", surface: "局所" };

  const saved = await adapter.saveState(state);
  await Promise.resolve();

  assert.equal(saved.lexicalItems.local.surface, "局所");
  assert.equal(global.chrome.storage.local.values[STORAGE_KEY].lexicalItems.local.surface, "局所");
  assert.equal(attempts.length, 1);
  assert.equal(adapter.getStorageStatus().transport, "local");
  assert.equal(adapter.getStorageStatus().loopback.lastError, "connection refused");
});

test("factory chooses Safari native storage on Safari", async () => {
  setNavigatorVendor("Apple Computer, Inc.");
  delete global.chrome;
  const messages = [];
  const nativeState = window.FadingFuriganaState.createDefaultAppState("2026-06-08T00:00:00.000Z");
  nativeState.lexicalItems["日本:にほん"] = {
    id: "日本:にほん",
    surface: "日本",
    baseForm: "日本",
    reading: "にほん"
  };
  global.browser = {
    runtime: {
      sendNativeMessage(message, callback) {
        messages.push(message);
        if (message.action === "pullRecordBatch") {
          callback({
            type: "FADING_FURIGANA_STORAGE_RESPONSE",
            requestId: message.requestId,
            ok: true,
            payload: { batch: createNativeRecordBatchFromState(nativeState) }
          });
          return;
        }
        if (message.action === "ingestRecordBatch") {
          callback({
            type: "FADING_FURIGANA_STORAGE_RESPONSE",
            requestId: message.requestId,
            ok: true,
            payload: {
              ack: {
                protocolVersion: 1,
                batchId: message.payload.batch.batchId,
                ok: true,
                appliedRecordIds: message.payload.batch.records.map((record) => record.recordId),
                rejectedRecords: [],
                storageRevision: 2
              }
            }
          });
          return;
        }
        callback({
          type: "FADING_FURIGANA_STORAGE_RESPONSE",
          requestId: message.requestId,
          ok: true,
          payload: message.action === "loadState"
            ? { state: nativeState }
            : { state: window.FadingFuriganaState.prepareStateForSave(message.payload.state) }
        });
      }
    }
  };

  const adapter = createBestAvailableStorageAdapter();
  assert.equal(adapter instanceof SafariNativeStorageAdapter, true);

  const loaded = await adapter.loadState();
  assert.equal(loaded.lexicalItems["日本:にほん"].reading, "にほん");

  const saved = await adapter.saveState(loaded);
  assert.equal(messages[0].type, "FADING_FURIGANA_STORAGE");
  assert.equal(messages[0].action, "pullRecordBatch");
  assert.equal(messages[1].action, "ingestRecordBatch");
  assert.equal(messages[1].payload.batch.sourceKind, "safari-extension");
  assert.equal(messages[1].payload.batch.targetKind, "mac-app");
  assert.ok(messages[1].payload.batch.records.some((record) => record.recordId === recordId("lexicalItem", "日本:にほん")));
  assert.equal(messages[2].action, "pullRecordBatch");
  assert.equal(saved.lexicalItems["日本:にほん"].surface, "日本");
});

test("Safari native storage uses background relay when direct native messaging is unavailable", async () => {
  setNavigatorVendor("Apple Computer, Inc.");
  delete global.chrome;
  const messages = [];
  global.browser = {
    runtime: {
      sendMessage(message, callback) {
        messages.push(message);
        callback({
          ok: true,
          response: {
            type: "FADING_FURIGANA_STORAGE_RESPONSE",
            requestId: message.payload.requestId,
            ok: true,
            payload: {
              batch: createNativeRecordBatchFromState(
                window.FadingFuriganaState.createDefaultAppState("2026-06-08T00:00:00.000Z")
              )
            }
          }
        });
      }
    }
  };

  const adapter = createBestAvailableStorageAdapter();
  assert.equal(adapter instanceof SafariNativeStorageAdapter, true);

  const loaded = await adapter.loadState();
  assert.equal(loaded.schemaVersion, 1);
  assert.equal(messages[0].type, "FADING_FURIGANA_NATIVE_STORAGE_RELAY");
  assert.equal(messages[0].payload.type, "FADING_FURIGANA_STORAGE");
  assert.equal(messages[0].payload.action, "pullRecordBatch");
});

test("Safari native adapter falls back to legacy whole-state actions for older native handlers", async () => {
  setNavigatorVendor("Apple Computer, Inc.");
  delete global.chrome;
  const messages = [];
  const nativeState = window.FadingFuriganaState.createDefaultAppState("2026-06-08T00:00:00.000Z");
  nativeState.lexicalItems["旧:ふるい"] = {
    id: "旧:ふるい",
    surface: "旧",
    reading: "ふるい"
  };
  global.browser = {
    runtime: {
      sendNativeMessage(message, callback) {
        messages.push(message);
        if (message.action === "pullRecordBatch" || message.action === "ingestRecordBatch") {
          callback({
            type: "FADING_FURIGANA_STORAGE_RESPONSE",
            requestId: message.requestId,
            ok: false,
            error: "Unsupported storage action."
          });
          return;
        }
        callback({
          type: "FADING_FURIGANA_STORAGE_RESPONSE",
          requestId: message.requestId,
          ok: true,
          payload: message.action === "loadState"
            ? { state: nativeState }
            : { state: window.FadingFuriganaState.prepareStateForSave(message.payload.state) }
        });
      }
    }
  };

  const adapter = new SafariNativeStorageAdapter({ fallbackAdapter: null });
  const loaded = await adapter.loadState();
  const saved = await adapter.saveState(loaded);

  assert.equal(loaded.lexicalItems["旧:ふるい"].surface, "旧");
  assert.equal(messages[0].action, "pullRecordBatch");
  assert.equal(messages[1].action, "loadState");
  assert.equal(messages[2].action, "ingestRecordBatch");
  assert.equal(messages[3].action, "saveState");
  assert.equal(saved.lexicalItems["旧:ふるい"].reading, "ふるい");
});

test("Safari native adapter reports native transport after a successful request", async () => {
  setNavigatorVendor("Apple Computer, Inc.");
  delete global.chrome;
  global.browser = {
    runtime: {
      sendNativeMessage(message, callback) {
        callback({
          type: "FADING_FURIGANA_STORAGE_RESPONSE",
          requestId: message.requestId,
          ok: true,
          payload: {
            batch: createNativeRecordBatchFromState(
              window.FadingFuriganaState.createDefaultAppState("2026-06-08T00:00:00.000Z")
            )
          }
        });
      }
    }
  };

  const adapter = new SafariNativeStorageAdapter({ fallbackAdapter: null });
  assert.equal(adapter.getStorageStatus().transport, "unknown");

  await adapter.loadState();
  const status = adapter.getStorageStatus();
  assert.equal(status.transport, "native");
  assert.ok(status.lastSuccessAt);
  assert.equal(status.lastError, null);
});

test("Safari native adapter can push record batches to the native store", async () => {
  setNavigatorVendor("Apple Computer, Inc.");
  delete global.chrome;
  const sentMessages = [];
  const ack = {
    protocolVersion: 1,
    batchId: "bat_adapter_test",
    ok: true,
    appliedRecordIds: ["reviewLog:rl_001"],
    rejectedRecords: [],
    storageRevision: 2
  };
  global.browser = {
    runtime: {
      sendNativeMessage(message, callback) {
        sentMessages.push(message);
        callback({
          type: "FADING_FURIGANA_STORAGE_RESPONSE",
          requestId: message.requestId,
          ok: true,
          payload: { ack }
        });
      }
    }
  };

  const adapter = new SafariNativeStorageAdapter({ fallbackAdapter: null });
  const batch = {
    protocolVersion: 1,
    batchId: "bat_adapter_test",
    sourceClientId: "dev_extension",
    sourceKind: "safari-extension",
    targetKind: "mac-app",
    direction: "push",
    createdAt: "2026-06-18T10:00:00.000Z",
    records: []
  };

  const result = await adapter.ingestRecordBatch(batch);

  assert.deepEqual(result, ack);
  assert.equal(sentMessages[0].action, "ingestRecordBatch");
  assert.equal(sentMessages[0].payload.batch.batchId, "bat_adapter_test");
});

test("Safari native adapter can pull record batches from the native store", async () => {
  setNavigatorVendor("Apple Computer, Inc.");
  delete global.chrome;
  const sentMessages = [];
  const batch = {
    protocolVersion: 1,
    batchId: "bat_pull_test",
    sourceClientId: "dev_mac",
    sourceKind: "mac-app",
    targetKind: "safari-extension",
    direction: "pull_response",
    createdAt: "2026-06-18T10:00:00.000Z",
    baseCursor: "cur_001",
    records: []
  };
  global.browser = {
    runtime: {
      sendNativeMessage(message, callback) {
        sentMessages.push(message);
        callback({
          type: "FADING_FURIGANA_STORAGE_RESPONSE",
          requestId: message.requestId,
          ok: true,
          payload: { batch }
        });
      }
    }
  };

  const adapter = new SafariNativeStorageAdapter({ fallbackAdapter: null });
  const result = await adapter.pullRecordBatch({ cursor: "cur_001", targetKind: "safari-extension" });

  assert.deepEqual(result, batch);
  assert.equal(sentMessages[0].action, "pullRecordBatch");
  assert.equal(sentMessages[0].payload.cursor, "cur_001");
  assert.equal(sentMessages[0].payload.targetKind, "safari-extension");
});

test("Safari native adapter reports fallback transport when native fails", async () => {
  setNavigatorVendor("Apple Computer, Inc.");
  delete global.chrome;
  global.browser = {
    runtime: {
      sendNativeMessage(message, callback) {
        callback({
          type: "FADING_FURIGANA_STORAGE_RESPONSE",
          requestId: message.requestId,
          ok: false,
          error: "native store unavailable"
        });
      }
    }
  };

  const fallback = new window.FadingFuriganaStorage.LocalStorageAdapter(createMemoryStorage());
  const adapter = new SafariNativeStorageAdapter({ fallbackAdapter: fallback });

  await adapter.loadState();
  const status = adapter.getStorageStatus();
  assert.equal(status.transport, "fallback");
  assert.ok(status.lastError);
});

test("normalizeToken uppercases and keeps only A-Z0-9", () => {
  const { normalizeToken } = window.FadingFuriganaLoopback;
  assert.equal(normalizeToken(" ab2-9 xk "), "AB29XK");
  assert.equal(normalizeToken("ff-9k2m"), "FF9K2M");
  assert.equal(normalizeToken(null), "");
});

test("loopback client stores, reads, and clears a normalized pairing code", async () => {
  const storageArea = createPromiseChromeStorage();
  const { fetchImpl } = createServerFetch({ token: "AB29XK7" });
  const client = new MacLoopbackClient({ storageArea, fetchImpl, ports: [57312], timeoutMs: 5 });

  const normalized = await client.setToken("ab2-9xk7");
  assert.equal(normalized, "AB29XK7");
  assert.equal(await client.getToken(), "AB29XK7");
  assert.equal(storageArea.values[LOOPBACK_STATE_KEY].token, "AB29XK7");

  await client.clearToken();
  assert.equal(await client.getToken(), null);
});

test("verifyPairing succeeds and authorizes with the stored code", async () => {
  const storageArea = createPromiseChromeStorage();
  const { fetchImpl, calls } = createServerFetch({ token: "GOODCODE", port: 57312 });
  const client = new MacLoopbackClient({ storageArea, fetchImpl, ports: [57312], timeoutMs: 5 });
  await client.setToken("GOODCODE");

  const result = await client.verifyPairing();

  assert.equal(result.ok, true);
  assert.equal(result.port, 57312);
  const pull = calls.find((call) => call.url.endsWith("/pull-record-batch"));
  assert.equal(pull.options.headers.Authorization, "Bearer GOODCODE");
  assert.equal(client.getStatus().connected, true);
  assert.equal(storageArea.values[LOOPBACK_STATE_KEY].port, 57312);
});

test("verifyPairing reports unauthorized for a wrong code", async () => {
  const storageArea = createPromiseChromeStorage();
  const { fetchImpl } = createServerFetch({ token: "GOODCODE", port: 57312 });
  const client = new MacLoopbackClient({ storageArea, fetchImpl, ports: [57312], timeoutMs: 5 });
  await client.setToken("WRONGCODE");

  const result = await client.verifyPairing();

  assert.equal(result.ok, false);
  assert.equal(result.reason, "unauthorized");
  assert.equal(client.getStatus().connected, false);
});

test("verifyPairing reports no_server when the Mac app is unreachable", async () => {
  const storageArea = createPromiseChromeStorage();
  const fetchImpl = async () => {
    throw new Error("ECONNREFUSED");
  };
  const client = new MacLoopbackClient({ storageArea, fetchImpl, ports: [57311, 57312], timeoutMs: 5 });
  await client.setToken("ANYCODE");

  const result = await client.verifyPairing();

  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_server");
});

test("ChromeStorageAdapter exposes its loopback client; Safari fallback disables loopback", () => {
  setNavigatorVendor("Google Inc.");
  delete global.browser;
  global.chrome = { runtime: {}, storage: { local: createCallbackChromeStorage() } };
  const chromeAdapter = new ChromeStorageAdapter(global.chrome.storage.local);
  assert.ok(chromeAdapter.getLoopbackClient());

  setNavigatorVendor("Apple Computer, Inc.");
  global.chrome = { runtime: {}, storage: { local: createCallbackChromeStorage() } };
  global.browser = { runtime: { sendNativeMessage() {} } };
  const safariAdapter = createBestAvailableStorageAdapter();
  assert.equal(safariAdapter instanceof SafariNativeStorageAdapter, true);
  assert.equal(safariAdapter.fallbackAdapter.getLoopbackClient(), null);
});

test("background loopback proxy routes a flush to the worker-owned client", async () => {
  const workerStorage = createPromiseChromeStorage();
  const { fetchImpl, calls } = createServerFetch({ token: "GOODCODE", port: 57312 });
  const workerClient = new MacLoopbackClient({ storageArea: workerStorage, fetchImpl, ports: [57312], timeoutMs: 5 });
  await workerClient.setToken("GOODCODE");

  const { runtime } = createWorkerRuntime(workerClient);
  const proxy = new BackgroundLoopbackClient({ runtime });
  const state = window.FadingFuriganaState.createDefaultAppState("2026-06-18T00:00:00.000Z");
  state.lexicalItems["駅:えき"] = { id: "駅:えき", surface: "駅", reading: "えき" };

  const result = await proxy.flushState(state);

  assert.equal(result.ok, true);
  assert.equal(result.applied, 1);
  assert.ok(calls.find((call) => call.url.endsWith("/ingest-record-batch")));
  assert.equal(proxy.getStatus().connected, true); // cached from the worker's response
});

test("background loopback proxy surfaces verifyPairing results from the worker", async () => {
  const workerStorage = createPromiseChromeStorage();
  const { fetchImpl } = createServerFetch({ token: "GOODCODE", port: 57312 });
  const workerClient = new MacLoopbackClient({ storageArea: workerStorage, fetchImpl, ports: [57312], timeoutMs: 5 });
  await workerClient.setToken("WRONGCODE");

  const { runtime } = createWorkerRuntime(workerClient);
  const proxy = new BackgroundLoopbackClient({ runtime });

  const result = await proxy.verifyPairing();
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unauthorized");
});

test("ChromeStorageAdapter routes loopback through the background worker when messaging exists", async () => {
  setNavigatorVendor("Google Inc.");
  delete global.browser;
  const sent = [];
  global.chrome = {
    runtime: {
      sendMessage(message, callback) {
        sent.push(message);
        callback({ ok: true, result: { ok: true, applied: 1 }, status: { connected: true, port: 57312 } });
      }
    },
    storage: { local: createPromiseChromeStorage() }
  };
  const adapter = new ChromeStorageAdapter(global.chrome.storage.local);
  assert.equal(adapter.getLoopbackClient() instanceof BackgroundLoopbackClient, true);

  const state = window.FadingFuriganaState.createDefaultAppState("2026-06-18T00:00:00.000Z");
  state.lexicalItems.routed = { id: "routed" };
  await adapter.saveState(state);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const flush = sent.find((message) => message.type === LOOPBACK_MESSAGE_TYPE && message.action === "flushState");
  assert.ok(flush, "expected a flushState message to the worker");
  assert.ok(flush.payload.state.lexicalItems.routed);
  assert.equal(adapter.getStorageStatus().loopback.connected, true);
});

test("factory falls back to LocalStorageAdapter outside extension context", () => {
  setNavigatorVendor("Google Inc.");
  delete global.browser;
  delete global.chrome;
  const adapter = createBestAvailableStorageAdapter();

  assert.equal(adapter instanceof window.FadingFuriganaStorage.LocalStorageAdapter, true);
});

(async () => {
  for (const { name, fn } of tests) {
    await runTest(name, fn);
  }
})();
