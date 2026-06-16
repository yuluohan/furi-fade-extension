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
      this.state = window.FadingFuriganaState.prepareStateForSave(state);
      this.savedStates.push(this.state);
      return window.FadingFuriganaState.migrateAppState(this.state);
    }
  };
  return adapter;
}

function simulateExternalSave(storageAdapter, mutate) {
  const nextState = JSON.parse(JSON.stringify(storageAdapter.state));
  mutate(nextState);
  storageAdapter.state = window.FadingFuriganaState.prepareStateForSave(nextState);
  return storageAdapter.state;
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

test("optimistic save updates in-memory word state before storage finishes", async () => {
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

  let resolveLoadState;
  let shouldDelayLoad = true;
  storageAdapter.loadState = async () => {
    if (!shouldDelayLoad) return window.FadingFuriganaState.migrateAppState(storageAdapter.state);
    shouldDelayLoad = false;
    return new Promise((resolve) => {
      resolveLoadState = () => resolve(window.FadingFuriganaState.migrateAppState(storageAdapter.state));
    });
  };

  const saveAttempt = service.saveWordOptimistically(createToken(), "内容を確認してください。");

  const userState = service.getUserWordState("確認:かくにん");
  assert.equal(userState.lifecycleStatus, "learning");
  assert.equal(userState.userIntent.saved, true);
  assert.equal(Object.values(service.state.sourceOccurrences).length, 1);
  assert.equal(storageAdapter.savedStates.length, 0);

  resolveLoadState();
  await saveAttempt.commit;

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

test("optimistic save rolls back when Basic access is locked", async () => {
  const initialState = window.FadingFuriganaState.createDefaultAppState("2026-06-08T00:00:00.000Z");
  initialState.entitlements.developmentOverride = "expired";
  const storageAdapter = createMemoryStorageAdapter(initialState);
  const service = new WordRepositoryService(storageAdapter, { persistDelayMs: 1 });
  await service.load();

  const saveAttempt = service.saveWordOptimistically(createToken(), "内容を確認してください。");
  assert.equal(service.getUserWordState("確認:かくにん").userIntent.saved, true);

  await assert.rejects(saveAttempt.commit, (error) => error?.code === "basic_access_locked");

  assert.equal(service.getUserWordState("確認:かくにん"), null);
  assert.equal(Object.values(service.state.sourceOccurrences).length, 0);
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

test("recordSeen stores exposure-only words in the light index and keeps saved-word meanings intact", async () => {
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

  await service.recordSeen(createToken({
    lexicalItemId: "経済:けいざい",
    surface: "経済",
    lemma: "経済",
    baseForm: "経済",
    reading: "けいざい",
    readingKana: "けいざい"
  }));
  assert.equal(service.state.lexicalItems["経済:けいざい"], undefined);
  assert.equal(service.getUserWordState("経済:けいざい"), null);
  assert.equal(service.state.exposureIndex["経済:けいざい"].seenCount, 1);
  assert.equal(service.state.exposureIndex["経済:けいざい"].surface, "経済");

  await service.saveWord(createToken(), "内容を確認してください。");
  await service.recordSeen(createToken());
  await service.persist();

  assert.deepEqual(service.state.lexicalItems["確認:かくにん"].meanings.zhHans, ["确认"]);
  assert.equal(service.state.exposureIndex["確認:かくにん"].seenCount, 1);
  const summary = Object.values(service.state.dailyExposureSummaries)
    .find((entry) => entry.lexicalItemId === "確認:かくにん");
  assert.equal(Object.values(summary.pages)[0].pageTitle, undefined);
});

test("first interaction promotes exposure index into a full user state", async () => {
  const storageAdapter = createMemoryStorageAdapter();
  const service = new WordRepositoryService(storageAdapter, { persistDelayMs: 1 });
  await service.load();

  service.exposureIndex.recordSeen(createToken(), "2026-06-08T01:00:00.000Z");
  service.exposureIndex.recordSeen(createToken(), "2026-06-09T01:00:00.000Z");

  await service.saveWord(createToken(), "内容を確認してください。");

  const userState = service.getUserWordState("確認:かくにん");
  assert.equal(userState.userIntent.saved, true);
  assert.equal(userState.exposure.seenCount, 2);
  assert.equal(userState.exposure.firstSeenAt, "2026-06-08T01:00:00.000Z");
  assert.equal(userState.exposure.lastSeenAt, "2026-06-09T01:00:00.000Z");
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
  storageAdapter.state = window.FadingFuriganaState.prepareStateForSave(purchasedState);

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

test("persist skips record-domain merge when storage signature is unchanged", async () => {
  const storageAdapter = createMemoryStorageAdapter();
  const service = new WordRepositoryService(storageAdapter, { persistDelayMs: 1 });
  await service.load();

  let mergeCount = 0;
  const originalMerge = service.createMergedPersistState.bind(service);
  service.createMergedPersistState = (stored) => {
    mergeCount += 1;
    return originalMerge(stored);
  };

  await service.recordSeen(createToken());
  await service.persist();

  assert.equal(mergeCount, 0);
  assert.equal(storageAdapter.savedStates.at(-1).metadata.storageRevision, 1);
  assert.ok(storageAdapter.savedStates.at(-1).metadata.writeId);
});

test("persist falls back to record-domain merge when storage signature changed", async () => {
  const storageAdapter = createMemoryStorageAdapter();
  const service = new WordRepositoryService(storageAdapter, { persistDelayMs: 1 });
  await service.load();

  simulateExternalSave(storageAdapter, (state) => {
    state.reviewLogs["review-1"] = {
      id: "review-1",
      lexicalItemId: "利用:りよう",
      result: "good",
      reviewedAt: "2026-06-15T10:52:01.000Z",
      updatedAt: "2026-06-15T10:52:01.000Z"
    };
  });

  let mergeCount = 0;
  const originalMerge = service.createMergedPersistState.bind(service);
  service.createMergedPersistState = (stored) => {
    mergeCount += 1;
    return originalMerge(stored);
  };

  await service.recordSeen(createToken());
  await service.persist();

  const persisted = storageAdapter.savedStates.at(-1);
  assert.equal(mergeCount, 1);
  assert.ok(persisted.reviewLogs["review-1"]);
  assert.ok(persisted.exposureIndex["確認:かくにん"]);
  assert.equal(persisted.metadata.storageRevision, 2);
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
  simulateExternalSave(storageAdapter, (state) => {
    state.settings.annotation.enabled = false;
  });

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

test("persist preserves review logs and schedule written elsewhere since load", async () => {
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

  // Simulate the Mac app grading a review after this tab loaded: it appends a
  // reviewLog and writes the word's learning schedule into shared storage.
  simulateExternalSave(storageAdapter, (state) => {
    state.reviewLogs = {
      "review-1": {
        id: "review-1",
        lexicalItemId: "利用:りよう",
        result: "good",
        reviewedAt: "2026-06-15T10:52:01.000Z",
        updatedAt: "2026-06-15T10:52:01.000Z"
      }
    };
    state.userLexicalStates["利用:りよう"] = {
      id: "利用:りよう",
      lexicalItemId: "利用:りよう",
      lifecycleStatus: "learning",
      learning: {
        reviewCount: 1,
        correctCount: 1,
        correctStreak: 2,
        reviewStage: "learning",
        nextReviewAt: "2026-06-18T10:52:01.000Z"
      },
      updatedAt: "2026-06-15T10:52:01.000Z"
    };
  });

  // This tab interacts with a different word and persists its own change.
  await service.recordSeen(createToken());
  await service.persist();

  const persisted = storageAdapter.savedStates.at(-1);
  // The Mac app's review log and schedule must survive the tab's persist.
  assert.ok(persisted.reviewLogs["review-1"], "review log was wiped");
  assert.equal(persisted.reviewLogs["review-1"].result, "good");
  assert.equal(persisted.userLexicalStates["利用:りよう"].learning.reviewCount, 1);
  assert.equal(
    persisted.userLexicalStates["利用:りよう"].learning.nextReviewAt,
    "2026-06-18T10:52:01.000Z"
  );
  // And the tab's own exposure write still landed.
  assert.ok(persisted.exposureIndex["確認:かくにん"], "tab exposure index write was lost");
  assert.ok(
    Object.values(persisted.dailyExposureSummaries).some((entry) => entry.lexicalItemId === "確認:かくにん"),
    "tab daily exposure write was lost"
  );
});

test("blocks forgetting an unsaved word after trial expiry but allows re-forgetting a saved word", async () => {
  const initialState = window.FadingFuriganaState.createDefaultAppState("2026-06-08T00:00:00.000Z");
  initialState.entitlements.developmentOverride = "expired";
  const storageAdapter = createMemoryStorageAdapter(initialState);
  const service = new WordRepositoryService(storageAdapter, { persistDelayMs: 1 });
  await service.load();

  // Forgot on a brand-new (unsaved) word builds a saved learning entry → blocked.
  await assert.rejects(
    () => service.markForgotten(createToken()),
    (error) => error?.code === "basic_access_locked"
  );
  assert.equal(service.getUserWordState("確認:かくにん"), null);

  // A word already saved before expiry can still be re-forgotten (review re-grade).
  service.userLexicalStates.markSaved("確認:かくにん");
  await service.markForgotten(createToken());
  const state = service.getUserWordState("確認:かくにん");
  assert.equal(state.userIntent.manuallyMarkedUnknown, true);
  assert.equal(state.learning.reviewStage, "lapsed");
});

test("compactState evicts stale exposure-only words and keeps interacted or recent ones", async () => {
  const storageAdapter = createMemoryStorageAdapter();
  const service = new WordRepositoryService(storageAdapter, { persistDelayMs: 1 });
  await service.load();

  const now = new Date();
  const recent = now.toISOString();
  const old = new Date(now.getTime() - 200 * 24 * 60 * 60 * 1000).toISOString();

  // Stale, exposure-only → evicted.
  service.userLexicalStates.recordSeen("古い:ふるい", old);
  service.state.lexicalItems["古い:ふるい"] = { id: "古い:ふるい", meanings: {} };
  // Stale but saved → kept.
  service.userLexicalStates.recordSeen("保存:ほぞん", old);
  service.userLexicalStates.markSaved("保存:ほぞん", old);
  // Recent, exposure-only → kept.
  service.userLexicalStates.recordSeen("新規:しんき", recent);

  service.compactState();

  assert.equal(service.getUserWordState("古い:ふるい"), null, "stale exposure word should be evicted");
  assert.equal(service.state.lexicalItems["古い:ふるい"], undefined);
  assert.ok(service.getUserWordState("保存:ほぞん"), "saved word must be kept even when stale");
  assert.ok(service.getUserWordState("新規:しんき"), "recent exposure word must be kept");
});

test("persist compaction removes stale exposure records after merging stored state", async () => {
  const initialState = window.FadingFuriganaState.createDefaultAppState("2026-06-08T00:00:00.000Z");
  const old = "2020-01-01T00:00:00.000Z";
  initialState.userLexicalStates["古い:ふるい"] =
    window.FadingFuriganaState.createDefaultUserLexicalState("古い:ふるい", old);
  initialState.userLexicalStates["古い:ふるい"].exposure.seenCount = 1;
  initialState.userLexicalStates["古い:ふるい"].exposure.lastSeenAt = old;
  initialState.userLexicalStates["古い:ふるい"].updatedAt = old;
  initialState.lexicalItems["古い:ふるい"] = {
    id: "古い:ふるい",
    meanings: {},
    updatedAt: old,
    deviceId: initialState.metadata.deviceId
  };

  const storageAdapter = createMemoryStorageAdapter(initialState);
  const service = new WordRepositoryService(storageAdapter, { persistDelayMs: 1 });
  await service.load();

  await service.persistImmediately();

  const persisted = storageAdapter.savedStates.at(-1);
  assert.equal(persisted.userLexicalStates["古い:ふるい"], undefined);
  assert.equal(persisted.lexicalItems["古い:ふるい"], undefined);
});

(async () => {
  for (const { name, fn } of tests) {
    await runTest(name, fn);
  }
})();
