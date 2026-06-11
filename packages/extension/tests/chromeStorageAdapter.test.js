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
loadBrowserScript("src/storage/chromeStorageAdapter.js");

const { ChromeStorageAdapter, STORAGE_KEY, createBestAvailableStorageAdapter } = window.FadingFuriganaStorage;
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test("loads and saves AppState through callback chrome.storage.local", async () => {
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
  global.chrome = { runtime: {}, storage: { local: createCallbackChromeStorage() } };
  const adapter = createBestAvailableStorageAdapter();

  assert.equal(adapter instanceof ChromeStorageAdapter, true);
});

test("factory falls back to LocalStorageAdapter outside extension context", () => {
  delete global.chrome;
  const adapter = createBestAvailableStorageAdapter();

  assert.equal(adapter instanceof window.FadingFuriganaStorage.LocalStorageAdapter, true);
});

(async () => {
  for (const { name, fn } of tests) {
    await runTest(name, fn);
  }
})();
