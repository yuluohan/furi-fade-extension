const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "..");

function loadBrowserScript(relativePath) {
  const filePath = path.join(rootDir, relativePath);
  vm.runInThisContext(fs.readFileSync(filePath, "utf8"), { filename: filePath });
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

function createMemoryStorageAdapter(initialState = null) {
  const adapter = {
    savedStates: [],
    state: initialState || window.FadingFuriganaState.createDefaultAppState("2026-06-08T00:00:00.000Z"),
    async loadState() {
      return window.FadingFuriganaState.migrateAppState(this.state);
    },
    async saveState(state) {
      this.state = JSON.parse(JSON.stringify(state));
      this.savedStates.push(this.state);
    }
  };
  return adapter;
}

function createToken(overrides = {}) {
  return {
    lexicalItemId: "確認:かくにん",
    surface: "確認",
    lemma: "確認",
    baseForm: "確認",
    reading: "かくにん",
    readingKana: "かくにん",
    meanings: {
      en: ["confirmation"],
      zhHans: ["确认"]
    },
    partOfSpeech: ["noun"],
    scriptProfile: {
      hasKanji: true,
      hasHiragana: false,
      hasKatakana: false,
      hasLatin: false
    },
    source: {
      provider: "test",
      confidence: 1
    },
    ...overrides
  };
}

global.window = global;
global.document = { title: "Test Page" };
loadBrowserScript("src/core/appState.js");
loadBrowserScript("src/storage/persistScheduler.js");
loadBrowserScript("src/repositories/repositories.js");
loadBrowserScript("src/services/wordRepositoryService.js");

const { WordRepositoryService, createPrivacyAwarePageContext } = window.FadingFuriganaWordRepository;
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test("creates privacy aware page context for each URL mode", () => {
  const pageContext = {
    url: "https://example.com/articles/1?draft=true",
    domain: "example.com",
    pageTitle: "Article"
  };

  assert.deepEqual(createPrivacyAwarePageContext("full", pageContext), {
    pageKey: "https://example.com/articles/1?draft=true",
    url: "https://example.com/articles/1?draft=true",
    domain: "example.com",
    pageTitle: "Article"
  });
  assert.deepEqual(createPrivacyAwarePageContext("domain_only", pageContext), {
    pageKey: "example.com",
    url: undefined,
    domain: "example.com",
    pageTitle: "Article"
  });
  assert.deepEqual(createPrivacyAwarePageContext("none", pageContext), {
    pageKey: "private-page",
    url: undefined,
    domain: undefined,
    pageTitle: undefined
  });
});

test("saves word with source occurrence and learning state", async () => {
  const storageAdapter = createMemoryStorageAdapter();
  const service = new WordRepositoryService(storageAdapter, {
    pageContextProvider: () => ({
      url: "https://example.com/news",
      domain: "example.com",
      pageTitle: "News"
    }),
    persistDelayMs: 1
  });
  await service.load();

  await service.saveWord(createToken(), "内容を確認してください。");

  const userState = service.getUserWordState("確認:かくにん");
  const occurrence = Object.values(service.state.sourceOccurrences)[0];
  assert.equal(userState.lifecycleStatus, "learning");
  assert.equal(userState.userIntent.saved, true);
  assert.equal(occurrence.surface, "確認");
  assert.equal(occurrence.domain, "example.com");
  assert.equal(occurrence.url, undefined);
  assert.equal(storageAdapter.savedStates.length >= 2, true);
});

test("records seen exposure without storing full URL when privacy is none", async () => {
  const initialState = window.FadingFuriganaState.createDefaultAppState("2026-06-08T00:00:00.000Z");
  initialState.settings.exposureTracking.saveUrls = "none";
  const storageAdapter = createMemoryStorageAdapter(initialState);
  const service = new WordRepositoryService(storageAdapter, {
    pageContextProvider: () => ({
      url: "https://example.com/private",
      domain: "example.com",
      pageTitle: "Private"
    }),
    persistDelayMs: 1
  });
  await service.load();

  await service.recordSeen(createToken());
  await service.persist();

  const [summary] = service.listDailyExposures();
  assert.equal(summary.pages["private-page"].domain, undefined);
  assert.equal(summary.pages["private-page"].pageTitle, undefined);
  assert.equal(summary.totalSeenCount, 1);
});

test("marks words known and ignored through service status actions", async () => {
  const storageAdapter = createMemoryStorageAdapter();
  const service = new WordRepositoryService(storageAdapter, { persistDelayMs: 1 });
  await service.load();

  await service.markKnown(createToken());
  assert.equal(service.getUserWordState("確認:かくにん").lifecycleStatus, "mastered");
  assert.equal(service.getUserWordState("確認:かくにん").annotationLevel, "hidden");

  await service.ignore(createToken());
  assert.equal(service.getUserWordState("確認:かくにん").lifecycleStatus, "ignored");
});

(async () => {
  for (const { name, fn } of tests) {
    await runTest(name, fn);
  }
})();
