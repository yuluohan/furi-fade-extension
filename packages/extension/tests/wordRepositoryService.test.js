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
  assert.equal(storageAdapter.savedStates.length >= 1, true);
});

test("blocks saving new words after trial expiry without Basic", async () => {
  const initialState = window.FadingFuriganaState.createDefaultAppState("2026-06-08T00:00:00.000Z");
  initialState.entitlements.developmentOverride = "expired";
  const storageAdapter = createMemoryStorageAdapter(initialState);
  const service = new WordRepositoryService(storageAdapter, { persistDelayMs: 1 });
  await service.load();

  await assert.rejects(
    () => service.saveWord(createToken(), "内容を確認してください。"),
    (error) => error?.code === "basic_access_locked"
  );

  assert.equal(service.getUserWordState("確認:かくにん"), null);
  assert.equal(storageAdapter.savedStates.length, 0);
});

test("allows saving during trial and after Basic unlock", async () => {
  const trialStorage = createMemoryStorageAdapter();
  const pageContextProvider = () => ({
    url: "https://example.com/news",
    domain: "example.com",
    pageTitle: "News"
  });
  const trialService = new WordRepositoryService(trialStorage, { pageContextProvider, persistDelayMs: 1 });
  await trialService.load();
  await trialService.saveWord(createToken(), "内容を確認してください。");
  assert.equal(trialService.getUserWordState("確認:かくにん").lifecycleStatus, "learning");

  const basicState = window.FadingFuriganaState.createDefaultAppState("2026-06-08T00:00:00.000Z");
  basicState.entitlements.basic.status = "purchased";
  basicState.entitlements.basic.purchasedAt = "2026-06-08T01:00:00.000Z";
  basicState.entitlements = window.FadingFuriganaState.normalizeEntitlements(
    basicState.entitlements,
    "2026-06-08T01:00:00.000Z"
  );
  const basicStorage = createMemoryStorageAdapter(basicState);
  const basicService = new WordRepositoryService(basicStorage, { pageContextProvider, persistDelayMs: 1 });
  await basicService.load();
  await basicService.saveWord(createToken({ lexicalItemId: "勉強:べんきょう", surface: "勉強" }), "日本語を勉強する。");
  assert.equal(basicService.getUserWordState("勉強:べんきょう").lifecycleStatus, "learning");
});

test("recordSeen stores no meanings and keeps saved-word meanings intact", async () => {
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

  await service.recordSeen(createToken({ lexicalItemId: "経済:けいざい", surface: "経済" }));
  assert.deepEqual(service.state.lexicalItems["経済:けいざい"].meanings, {});

  await service.saveWord(createToken(), "内容を確認してください。");
  await service.recordSeen(createToken());
  await service.persist();

  assert.deepEqual(service.state.lexicalItems["確認:かくにん"].meanings.zhHans, ["确认"]);
  const summary = Object.values(service.state.dailyExposureSummaries)[0];
  assert.equal(Object.values(summary.pages)[0].pageTitle, undefined);
});

test("persist preserves newer entitlement state from storage", async () => {
  const initialState = window.FadingFuriganaState.createDefaultAppState("2026-06-08T00:00:00.000Z");
  const storageAdapter = createMemoryStorageAdapter(initialState);
  const service = new WordRepositoryService(storageAdapter, {
    pageContextProvider: () => ({
      url: "https://example.com/news",
      domain: "example.com",
      pageTitle: "News"
    }),
    persistDelayMs: 1
  });
  await service.load();

  const purchasedState = window.FadingFuriganaState.createDefaultAppState("2026-06-08T00:00:00.000Z");
  purchasedState.entitlements.basic.status = "purchased";
  purchasedState.entitlements.basic.purchasedAt = "2026-06-08T01:00:00.000Z";
  purchasedState.entitlements = window.FadingFuriganaState.normalizeEntitlements(
    purchasedState.entitlements,
    "2026-06-08T01:00:00.000Z"
  );
  storageAdapter.state = purchasedState;

  await service.recordSeen(createToken());
  await service.persist();

  const persisted = storageAdapter.savedStates.at(-1);
  assert.equal(persisted.entitlements.basic.status, "purchased");
  assert.equal(persisted.entitlements.access.tier, "basic");
});

test("compactState drops expired exposure summaries", async () => {
  const storageAdapter = createMemoryStorageAdapter();
  const service = new WordRepositoryService(storageAdapter, { persistDelayMs: 1 });
  await service.load();

  service.state.dailyExposureSummaries["daily-exposure:2020-01-01:確認:かくにん"] = {
    id: "daily-exposure:2020-01-01:確認:かくにん",
    date: "2020-01-01",
    lexicalItemId: "確認:かくにん",
    totalSeenCount: 3,
    uniquePageCount: 1,
    surfaceForms: {},
    pages: { "example.com": { pageTitle: "Old", seenCount: 3 } }
  };

  await service.persistImmediately();

  assert.equal(service.state.dailyExposureSummaries["daily-exposure:2020-01-01:確認:かくにん"], undefined);
});

test("load does not write storage back", async () => {
  const storageAdapter = createMemoryStorageAdapter();
  const service = new WordRepositoryService(storageAdapter, { persistDelayMs: 1 });

  await service.load();

  assert.equal(storageAdapter.savedStates.length, 0);
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

test("persisting exposure data does not overwrite settings saved elsewhere", async () => {
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

  // The popup turns annotation off in storage while this tab still holds the
  // old settings in memory.
  storageAdapter.state.settings.annotation.enabled = false;

  await service.recordSeen(createToken());
  await service.persist();

  const persisted = storageAdapter.savedStates.at(-1);
  assert.equal(persisted.settings.annotation.enabled, false);
  assert.equal(Object.keys(persisted.dailyExposureSummaries).length, 1);
});

test("marks words known and ignored through service status actions", async () => {
  const storageAdapter = createMemoryStorageAdapter();
  const service = new WordRepositoryService(storageAdapter, { persistDelayMs: 1 });
  await service.load();

  await service.markKnown(createToken());
  assert.equal(service.getUserWordState("確認:かくにん").lifecycleStatus, "known");
  assert.equal(service.getUserWordState("確認:かくにん").annotationLevel, "hidden");

  await service.ignore(createToken());
  assert.equal(service.getUserWordState("確認:かくにん").lifecycleStatus, "ignored");
});

test("forgot and pin actions make hidden words visible again", async () => {
  const storageAdapter = createMemoryStorageAdapter();
  const service = new WordRepositoryService(storageAdapter, { persistDelayMs: 1 });
  await service.load();

  await service.markKnown(createToken());
  await service.markForgotten(createToken());

  let userState = service.getUserWordState("確認:かくにん");
  assert.equal(userState.lifecycleStatus, "learning");
  assert.equal(userState.knowledgeConfidence, 0);
  assert.equal(userState.annotationLevel, "full_ruby");
  assert.equal(userState.userIntent.manuallyMarkedUnknown, true);
  assert.equal(userState.learning.reviewStage, "lapsed");

  await service.pinAnnotation(createToken());
  userState = service.getUserWordState("確認:かくにん");
  assert.equal(userState.userIntent.pinnedAnnotation, true);
});

(async () => {
  for (const { name, fn } of tests) {
    await runTest(name, fn);
  }
})();
