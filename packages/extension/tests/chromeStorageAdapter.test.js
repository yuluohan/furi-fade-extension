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
loadBrowserScript("src/storage/safariNativeStorageAdapter.js");
loadBrowserScript("src/storage/chromeStorageAdapter.js");

const {
  ChromeStorageAdapter,
  SafariNativeStorageAdapter,
  STORAGE_KEY,
  createBestAvailableStorageAdapter
} = window.FadingFuriganaStorage;
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
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
  const adapter = new ChromeStorageAdapter(global.chrome.storage.local);
  const state = window.FadingFuriganaState.createDefaultAppState("2026-06-08T00:00:00.000Z");

  state.lexicalItems.example = { id: "example" };
  await adapter.saveState(state);

  assert.equal(global.chrome.storage.local.values[STORAGE_KEY].lexicalItems.example.id, "example");

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
  const adapter = new ChromeStorageAdapter(global.chrome.storage.local);
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
        callback({
          type: "FADING_FURIGANA_STORAGE_RESPONSE",
          requestId: message.requestId,
          ok: true,
          payload: message.action === "loadState" ? { state: nativeState } : {}
        });
      }
    }
  };

  const adapter = createBestAvailableStorageAdapter();
  assert.equal(adapter instanceof SafariNativeStorageAdapter, true);

  const loaded = await adapter.loadState();
  assert.equal(loaded.lexicalItems["日本:にほん"].reading, "にほん");

  await adapter.saveState(loaded);
  assert.equal(messages[0].type, "FADING_FURIGANA_STORAGE");
  assert.equal(messages[0].action, "loadState");
  assert.equal(messages[1].action, "saveState");
  assert.equal(messages[1].payload.state.lexicalItems["日本:にほん"].surface, "日本");
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
            payload: { state: window.FadingFuriganaState.createDefaultAppState("2026-06-08T00:00:00.000Z") }
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
  assert.equal(messages[0].payload.action, "loadState");
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
