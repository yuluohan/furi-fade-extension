const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "..");

function loadBrowserScript(relativePath) {
  const filePath = path.join(rootDir, relativePath);
  vm.runInThisContext(fs.readFileSync(filePath, "utf8"), { filename: filePath });
}

function createMemoryStorage(initialValue = null) {
  const values = new Map();
  if (initialValue !== null) values.set("jrFadingFuriganaState", initialValue);

  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
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
loadBrowserScript("src/core/appState.js");
loadBrowserScript("src/storage/localStorageAdapter.js");
loadBrowserScript("src/repositories/repositories.js");

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test("creates AppState v1 defaults", () => {
  const state = window.FadingFuriganaState.createDefaultAppState("2026-06-08T00:00:00.000Z");

  assert.equal(state.schemaVersion, 1);
  assert.equal(state.userProfile.targetLanguage, "ja");
  assert.equal(state.settings.display.interfaceLanguage, "en");
  assert.equal(state.settings.annotation.mode, "adaptive");
  assert.equal(state.settings.annotation.userLevel, "none");
  assert.equal(state.settings.annotation.constrainedLayoutMode, "tap_only");
  assert.equal(state.settings.annotation.useSmartContextDisplay, true);
  assert.equal(state.settings.annotation.statusColors.saved, "#7A5AF8");
  assert.equal(state.settings.exposureTracking.saveUrls, "domain_only");
  assert.deepEqual(state.settings.siteOverrides, {});
  assert.equal(state.entitlements.platform, "browser-extension");
  assert.equal(state.entitlements.access.tier, "trial");
  assert.equal(state.entitlements.access.basicUnlocked, true);
  assert.equal(state.entitlements.basic.status, "not_purchased");
  assert.deepEqual(Object.keys(state.lexicalItems), []);
  assert.deepEqual(Object.keys(state.dailyExposureSummaries), []);
});

test("normalizes entitlement access states", () => {
  const trial = window.FadingFuriganaState.normalizeEntitlements(
    {
      platform: "apple-macos",
      trial: {
        startedAt: "2026-06-01T00:00:00.000Z",
        expiresAt: "2026-07-02T00:00:00.000Z"
      }
    },
    "2026-06-13T00:00:00.000Z"
  );
  const expired = window.FadingFuriganaState.normalizeEntitlements(
    {
      trial: {
        startedAt: "2026-05-01T00:00:00.000Z",
        expiresAt: "2026-06-01T00:00:00.000Z"
      }
    },
    "2026-06-13T00:00:00.000Z"
  );
  const basic = window.FadingFuriganaState.normalizeEntitlements(
    {
      basic: {
        status: "purchased",
        verificationStatus: "verified"
      }
    },
    "2026-06-13T00:00:00.000Z"
  );
  const pro = window.FadingFuriganaState.normalizeEntitlements(
    {
      pro: {
        status: "active"
      }
    },
    "2026-06-13T00:00:00.000Z"
  );
  const override = window.FadingFuriganaState.normalizeEntitlements(
    {
      basic: {
        status: "purchased"
      },
      developmentOverride: "expired"
    },
    "2026-06-13T00:00:00.000Z"
  );
  const recovered = window.FadingFuriganaState.normalizeEntitlements(null, "2026-06-13T00:00:00.000Z");

  assert.equal(trial.platform, "apple-macos");
  assert.equal(trial.basic.productId, "com.banyuguru.fadingfurigana.basic.macos");
  assert.equal(trial.access.tier, "trial");
  assert.equal(expired.access.tier, "expired");
  assert.equal(expired.access.basicUnlocked, false);
  assert.equal(basic.access.tier, "basic");
  assert.equal(basic.access.basicUnlocked, true);
  assert.equal(pro.access.tier, "pro");
  assert.equal(pro.access.proUnlocked, true);
  assert.equal(override.access.tier, "expired");
  assert.equal(recovered.access.tier, "trial");
});

test("normalizes interface language settings", () => {
  const zhSettings = window.FadingFuriganaState.normalizeSettings({
    display: {
      interfaceLanguage: "zh-CN"
    }
  });
  const legacySettings = window.FadingFuriganaState.normalizeSettings({
    interfaceLanguage: "en-US"
  });
  const fallbackSettings = window.FadingFuriganaState.normalizeSettings({
    display: {
      interfaceLanguage: "fr"
    }
  });

  assert.equal(zhSettings.display.interfaceLanguage, "zhHans");
  assert.equal(legacySettings.display.interfaceLanguage, "en");
  assert.equal(fallbackSettings.display.interfaceLanguage, "en");
});

test("normalizes annotation level settings", () => {
  const settings = window.FadingFuriganaState.normalizeSettings({
    annotation: {
      userLevel: "N3",
      constrainedLayoutMode: "ruby"
    }
  });
  const compact = window.FadingFuriganaState.normalizeSettings({
    annotation: {
      constrainedLayoutMode: "compact"
    }
  });
  const fallback = window.FadingFuriganaState.normalizeSettings({
    annotation: {
      userLevel: "expert",
      constrainedLayoutMode: "expand"
    }
  });

  assert.equal(settings.annotation.userLevel, "n3");
  assert.equal(settings.annotation.constrainedLayoutMode, "ruby");
  assert.equal(compact.annotation.constrainedLayoutMode, "compact");
  assert.equal(fallback.annotation.userLevel, "none");
  assert.equal(fallback.annotation.constrainedLayoutMode, "tap_only");
});

test("normalizes annotation status colors", () => {
  const settings = window.FadingFuriganaState.normalizeSettings({
    annotation: {
      statusColors: {
        new: "abc",
        saved: "#123abc",
        known: "not-a-color"
      }
    }
  });

  assert.equal(settings.annotation.statusColors.new, "#AABBCC");
  assert.equal(settings.annotation.statusColors.saved, "#123ABC");
  assert.equal(settings.annotation.statusColors.known, "#2FA36B");
  assert.equal(settings.annotation.statusColors.ignored, "#8A8A8A");
});

test("normalizes site override settings", () => {
  const settings = window.FadingFuriganaState.normalizeSettings({
    siteOverrides: {
      "Example.COM.": {
        annotationEnabled: false,
        updatedAt: "2026-06-13T00:00:00.000Z"
      },
      "bad.example": "paused"
    }
  });

  assert.deepEqual(settings.siteOverrides, {
    "example.com": {
      annotationEnabled: false,
      updatedAt: "2026-06-13T00:00:00.000Z"
    }
  });
});


test("migrates legacy localStorage state", () => {
  const legacyState = {
    words: {
      "確認:かくにん": {
        id: "確認:かくにん",
        surface: "確認",
        baseForm: "確認",
        reading: "かくにん",
        meaningEn: "confirmation; check",
        partOfSpeech: "noun",
        isKanjiWord: true,
        isKatakanaWord: false
      }
    },
    userWordStates: {
      "確認:かくにん": {
        status: "mastered",
        annotationLevel: "hidden",
        seenCount: 3,
        savedCount: 1
      }
    },
    sourceSentences: {},
    reviewLogs: {},
    settings: {
      enabled: true,
      annotationMode: "unknown_words_only",
      hideMasteredWords: true
    }
  };

  const migrated = window.FadingFuriganaState.migrateAppState(legacyState);
  const lexicalItem = migrated.lexicalItems["確認:かくにん"];
  const userState = migrated.userLexicalStates["確認:かくにん"];

  assert.equal(migrated.schemaVersion, 1);
  assert.equal(lexicalItem.lemma, "確認");
  assert.deepEqual(lexicalItem.meanings.en, ["confirmation; check"]);
  assert.equal(userState.lifecycleStatus, "mastered");
  assert.equal(userState.knowledgeConfidence, 1);
  assert.equal(userState.annotationLevel, "hidden");
  assert.equal(migrated.settings.annotation.mode, "unknown_items_only");
});

test("loads, saves, and clears state through LocalStorageAdapter", async () => {
  const storage = createMemoryStorage();
  const adapter = new window.FadingFuriganaStorage.LocalStorageAdapter(storage);
  const state = await adapter.loadState();

  state.lexicalItems.example = { id: "example" };
  await adapter.saveState(state);

  const saved = JSON.parse(storage.getItem("jrFadingFuriganaState"));
  assert.equal(saved.lexicalItems.example.id, "example");

  await adapter.clearState();
  assert.equal(storage.getItem("jrFadingFuriganaState"), null);
});

test("updates lexical items and user state through repositories", () => {
  const state = window.FadingFuriganaState.createDefaultAppState("2026-06-08T00:00:00.000Z");
  const lexicalItems = new window.FadingFuriganaRepositories.LexicalItemRepository(state);
  const userStates = new window.FadingFuriganaRepositories.UserLexicalStateRepository(state);

  const item = lexicalItems.upsertFromToken({
    id: "食べる:たべる",
    lexicalItemId: "食べる:たべる",
    surface: "食べる",
    lemma: "食べる",
    readingKana: "たべる",
    meanings: {
      en: ["to eat"],
      zhHans: ["吃"]
    },
    scriptProfile: {
      hasKanji: true,
      hasHiragana: true,
      hasKatakana: false,
      hasLatin: false
    },
    partOfSpeech: ["verb"]
  }, "2026-06-08T01:00:00.000Z");

  assert.equal(item.lemma, "食べる");
  assert.equal(lexicalItems.listVocabulary().length, 1);

  userStates.recordSeen(item.id, "2026-06-08T01:01:00.000Z");
  userStates.markSaved(item.id, "2026-06-08T01:02:00.000Z");
  userStates.setStatus(item.id, "known", "hidden", "2026-06-08T01:03:00.000Z");
  userStates.resetLearning(item.id, "2026-06-08T01:04:00.000Z");
  userStates.setPinnedAnnotation(item.id, true, "2026-06-08T01:05:00.000Z");

  const userState = userStates.getByLexicalItemId(item.id);
  assert.equal(userState.exposure.seenCount, 1);
  assert.equal(userState.userIntent.saved, true);
  assert.equal(userState.lifecycleStatus, "learning");
  assert.equal(userState.knowledgeConfidence, 0);
  assert.equal(userState.userIntent.manuallyMarkedUnknown, true);
  assert.equal(userState.userIntent.pinnedAnnotation, true);
});

test("records daily exposure and lists frequent items", () => {
  const state = window.FadingFuriganaState.createDefaultAppState("2026-06-08T00:00:00.000Z");
  const exposures = new window.FadingFuriganaRepositories.ExposureRepository(state);

  exposures.recordDailyExposure({
    lexicalItemId: "食べる:たべる",
    surface: "食べる",
    domain: "example.com",
    pageKey: "example.com/article",
    pageTitle: "Article",
    seenAt: "2026-06-08T01:00:00.000Z"
  });
  exposures.recordDailyExposure({
    lexicalItemId: "食べる:たべる",
    surface: "食べました",
    domain: "example.com",
    pageKey: "example.com/article",
    pageTitle: "Article",
    seenAt: "2026-06-08T01:01:00.000Z"
  });
  exposures.recordDailyExposure({
    lexicalItemId: "確認:かくにん",
    surface: "確認",
    domain: "example.org",
    pageKey: "example.org/news",
    pageTitle: "News",
    seenAt: "2026-06-08T02:00:00.000Z"
  });

  const daily = exposures.listDailyExposures("2026-06-08");
  assert.equal(daily.length, 2);
  assert.equal(daily[0].lexicalItemId, "食べる:たべる");
  assert.equal(daily[0].totalSeenCount, 2);
  assert.equal(daily[0].surfaceForms["食べました"], 1);
  assert.equal(daily[0].uniquePageCount, 1);

  const frequent = exposures.listFrequentItems({
    startDate: "2026-06-01",
    endDate: "2026-06-08"
  });
  assert.equal(frequent[0].lexicalItemId, "食べる:たべる");
  assert.equal(frequent[0].totalSeenCount, 2);
});

(async () => {
  for (const { name, fn } of tests) {
    await runTest(name, fn);
  }
})();
