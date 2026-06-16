const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const {
  RECORD_STORE_FORMAT_VERSION,
  RECORD_TYPES,
  createRecordId,
  mergeRecordStoreSnapshots,
  migrateAppStateToRecordStore,
  recordStoreToAppState,
  validateRecordStoreSnapshot
} = require("../src/recordStore");

const repoRoot = path.resolve(__dirname, "../../..");
const MIGRATED_AT = "2026-06-16T01:00:00.000Z";
const DEVICE_ID = "dev_record_store_test";

function loadBrowserScript(relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  vm.runInThisContext(fs.readFileSync(filePath, "utf8"), { filename: filePath });
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

function createRepresentativeState() {
  const state = window.FadingFuriganaState.createDefaultAppState("2026-06-16T00:00:00.000Z");
  state.metadata = {
    ...state.metadata,
    deviceId: DEVICE_ID,
    createdAt: "2026-06-16T00:00:00.000Z",
    updatedAt: "2026-06-16T00:30:00.000Z",
    lastOpenedAt: "2026-06-16T00:30:00.000Z",
    storageRevision: 7,
    writeId: "wr_record_store_test"
  };
  state.userProfile.extraProfileField = { preserved: true };
  state.settings.experimentalLocalFlag = { kept: true };
  state.entitlements.basic.status = "purchased";
  state.entitlements.basic.purchasedAt = "2026-06-16T00:05:00.000Z";

  const token = createToken();
  state.lexicalItems[token.lexicalItemId] = {
    ...window.FadingFuriganaState.createLexicalItemFromToken(token, null, "2026-06-16T00:10:00.000Z"),
    deviceId: DEVICE_ID,
    unknownLexicalField: "round-trip"
  };

  state.userLexicalStates[token.lexicalItemId] = {
    ...window.FadingFuriganaState.createDefaultUserLexicalState(token.lexicalItemId, "2026-06-16T00:10:00.000Z"),
    lifecycleStatus: "learning",
    userIntent: {
      saved: true,
      ignored: false,
      manuallyMarkedKnown: false,
      manuallyMarkedUnknown: false,
      pinnedAnnotation: false
    },
    exposure: {
      seenCount: 3,
      uniquePageCount: 2,
      uniqueSentenceCount: 2,
      firstSeenAt: "2026-06-16T00:10:00.000Z",
      lastSeenAt: "2026-06-16T00:20:00.000Z"
    },
    updatedAt: "2026-06-16T00:20:00.000Z",
    deviceId: DEVICE_ID
  };

  state.exposureIndex[token.lexicalItemId] = {
    id: token.lexicalItemId,
    lexicalItemId: token.lexicalItemId,
    surface: token.surface,
    readingKana: token.readingKana,
    baseReadingKana: token.readingKana,
    seenCount: 3,
    firstSeenAt: "2026-06-16T00:10:00.000Z",
    lastSeenAt: "2026-06-16T00:20:00.000Z",
    updatedAt: "2026-06-16T00:20:00.000Z",
    deviceId: DEVICE_ID
  };

  const occurrenceId = "occurrence:確認:2026-06-16T00:11:00.000Z";
  state.sourceOccurrences[occurrenceId] = {
    id: occurrenceId,
    lexicalItemId: token.lexicalItemId,
    surface: token.surface,
    sentence: "内容を確認してください。",
    domain: "example.com",
    pageTitle: "Example",
    createdAt: "2026-06-16T00:11:00.000Z",
    updatedAt: "2026-06-16T00:11:00.000Z",
    deviceId: DEVICE_ID
  };

  const summaryId = "daily-exposure:2026-06-16:確認:かくにん";
  state.dailyExposureSummaries[summaryId] = {
    id: summaryId,
    date: "2026-06-16",
    lexicalItemId: token.lexicalItemId,
    totalSeenCount: 3,
    uniquePageCount: 1,
    surfaceForms: {
      "確認": 3
    },
    pages: {
      "example.com": {
        domain: "example.com",
        seenCount: 3,
        firstSeenAt: "2026-06-16T00:10:00.000Z",
        lastSeenAt: "2026-06-16T00:20:00.000Z"
      }
    },
    firstSeenAt: "2026-06-16T00:10:00.000Z",
    lastSeenAt: "2026-06-16T00:20:00.000Z",
    updatedAt: "2026-06-16T00:20:00.000Z",
    deviceId: DEVICE_ID
  };

  state.reviewLogs.rl_fixed = {
    id: "rl_fixed",
    lexicalItemId: token.lexicalItemId,
    reviewedAt: "2026-06-16T00:25:00.000Z",
    result: "good",
    stageBefore: "learning",
    stageAfter: "reviewing",
    nextReviewAt: "2026-06-19T00:25:00.000Z",
    source: "test",
    updatedAt: "2026-06-16T00:25:00.000Z",
    deviceId: DEVICE_ID
  };

  return state;
}

function assertCleanSnapshot(snapshot) {
  const validation = validateRecordStoreSnapshot(snapshot);
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.valid, true);
  return validation;
}

global.window = global;
loadBrowserScript("packages/extension/src/core/appState.js");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("record-store v1 schema lists the implemented record types", () => {
  const schema = readJson("packages/core-schema/schema/record-store-v1.schema.json");
  const schemaTypes = schema.$defs.record.properties.type.enum;
  assert.equal(schema.properties.formatVersion.const, RECORD_STORE_FORMAT_VERSION);
  for (const definition of Object.values(RECORD_TYPES)) {
    assert.ok(schemaTypes.includes(definition.type), definition.type);
  }
});

test("migrates AppState into deterministic records and round-trips active data", () => {
  const state = createRepresentativeState();
  const snapshot = migrateAppStateToRecordStore(state, { migratedAt: MIGRATED_AT });
  const validation = assertCleanSnapshot(snapshot);

  assert.equal(snapshot.source.schemaVersion, 1);
  assert.equal(snapshot.source.storageRevision, 7);
  assert.equal(snapshot.source.writeId, "wr_record_store_test");
  assert.equal(Object.keys(snapshot.records).length, 10);
  assert.equal(validation.counts.appMetadata, 1);
  assert.equal(validation.counts.settings, 1);
  assert.equal(validation.counts.entitlements, 1);
  assert.equal(validation.counts.lexicalItem, 1);
  assert.equal(validation.counts.userLexicalState, 1);
  assert.equal(validation.counts.exposureIndex, 1);
  assert.equal(validation.counts.sourceOccurrence, 1);
  assert.equal(validation.counts.dailyExposureSummary, 1);
  assert.equal(validation.counts.reviewLog, 1);

  const settingsRecord = snapshot.records[createRecordId("settings", "global")];
  assert.equal(settingsRecord.syncScope, "syncable");
  const entitlementRecord = snapshot.records[createRecordId("entitlements", "local")];
  assert.equal(entitlementRecord.syncScope, "local_or_server_authoritative");
  assert.equal(entitlementRecord.mergeStrategy, "server_authoritative");

  const lexicalRecord = snapshot.records[createRecordId("lexicalItem", "確認:かくにん")];
  assert.equal(lexicalRecord.value.unknownLexicalField, "round-trip");
  assert.equal(lexicalRecord.recordId, "lexicalItem:%E7%A2%BA%E8%AA%8D%3A%E3%81%8B%E3%81%8F%E3%81%AB%E3%82%93");

  const persistedShape = clone(state);
  const roundTrip = recordStoreToAppState(snapshot);
  assert.deepEqual(roundTrip.userProfile, persistedShape.userProfile);
  assert.deepEqual(roundTrip.settings, persistedShape.settings);
  assert.deepEqual(roundTrip.entitlements, persistedShape.entitlements);
  assert.deepEqual(roundTrip.metadata, persistedShape.metadata);
  assert.deepEqual(roundTrip.lexicalItems, persistedShape.lexicalItems);
  assert.deepEqual(roundTrip.userLexicalStates, persistedShape.userLexicalStates);
  assert.deepEqual(roundTrip.exposureIndex, persistedShape.exposureIndex);
  assert.deepEqual(roundTrip.sourceOccurrences, persistedShape.sourceOccurrences);
  assert.deepEqual(roundTrip.dailyExposureSummaries, persistedShape.dailyExposureSummaries);
  assert.deepEqual(roundTrip.reviewLogs, persistedShape.reviewLogs);
});

test("migration is idempotent for fixed input and preserves tombstones as records", () => {
  const state = createRepresentativeState();
  const deletedId = "古い:ふるい";
  state.lexicalItems[deletedId] = {
    id: deletedId,
    surface: "古い",
    readingKana: "ふるい",
    updatedAt: "2026-06-15T00:00:00.000Z",
    deletedAt: "2026-06-16T00:40:00.000Z",
    deviceId: DEVICE_ID
  };

  const first = migrateAppStateToRecordStore(state, { migratedAt: MIGRATED_AT });
  const second = migrateAppStateToRecordStore(state, { migratedAt: MIGRATED_AT });
  assert.deepEqual(second, first);
  assertCleanSnapshot(first);

  const tombstone = first.records[createRecordId("lexicalItem", deletedId)];
  assert.equal(tombstone.deletedAt, "2026-06-16T00:40:00.000Z");
  assert.equal(tombstone.value.deletedAt, "2026-06-16T00:40:00.000Z");

  const roundTrip = recordStoreToAppState(first);
  assert.equal(roundTrip.lexicalItems[deletedId], undefined);
});

test("validates a large exposure-heavy state without requiring runtime storage changes", () => {
  const state = window.FadingFuriganaState.createDefaultAppState("2026-06-16T00:00:00.000Z");
  state.metadata.deviceId = DEVICE_ID;
  state.metadata.updatedAt = "2026-06-16T00:30:00.000Z";
  state.metadata.storageRevision = 22;
  state.metadata.writeId = "wr_large_fixture";

  for (let index = 0; index < 1500; index += 1) {
    const lexicalItemId = `単語${index}:たんご${index}`;
    const seenAt = `2026-06-16T00:${String(index % 60).padStart(2, "0")}:00.000Z`;
    state.exposureIndex[lexicalItemId] = {
      id: lexicalItemId,
      lexicalItemId,
      surface: `単語${index}`,
      readingKana: `たんご${index}`,
      baseReadingKana: `たんご${index}`,
      seenCount: (index % 5) + 1,
      firstSeenAt: seenAt,
      lastSeenAt: seenAt,
      updatedAt: seenAt,
      deviceId: DEVICE_ID
    };

    const summaryId = `daily-exposure:2026-06-16:${lexicalItemId}`;
    state.dailyExposureSummaries[summaryId] = {
      id: summaryId,
      date: "2026-06-16",
      lexicalItemId,
      totalSeenCount: (index % 5) + 1,
      uniquePageCount: 1,
      surfaceForms: {
        [`単語${index}`]: (index % 5) + 1
      },
      pages: {
        "example.com": {
          domain: "example.com",
          seenCount: (index % 5) + 1,
          firstSeenAt: seenAt,
          lastSeenAt: seenAt
        }
      },
      firstSeenAt: seenAt,
      lastSeenAt: seenAt,
      updatedAt: seenAt,
      deviceId: DEVICE_ID
    };
  }

  const snapshot = migrateAppStateToRecordStore(state, { migratedAt: MIGRATED_AT });
  const validation = assertCleanSnapshot(snapshot);
  assert.equal(validation.counts.exposureIndex, 1500);
  assert.equal(validation.counts.dailyExposureSummary, 1500);
  assert.equal(Object.keys(snapshot.records).length, 3004);

  const roundTrip = recordStoreToAppState(snapshot);
  assert.equal(Object.keys(roundTrip.exposureIndex).length, 1500);
  assert.equal(Object.keys(roundTrip.dailyExposureSummaries).length, 1500);
});

test("per-record merge keeps append-only records and resolves identical IDs by version", () => {
  const left = migrateAppStateToRecordStore(createRepresentativeState(), { migratedAt: MIGRATED_AT });
  const right = clone(left);
  right.source.storageRevision = 8;
  right.source.updatedAt = "2026-06-16T00:45:00.000Z";

  const lexicalRecordId = createRecordId("lexicalItem", "確認:かくにん");
  left.records[lexicalRecordId].updatedAt = "2026-06-16T00:20:00.000Z";
  left.records[lexicalRecordId].deviceId = "dev_a";
  left.records[lexicalRecordId].value.meanings.en = ["old confirmation"];
  right.records[lexicalRecordId].updatedAt = "2026-06-16T00:45:00.000Z";
  right.records[lexicalRecordId].deviceId = "dev_b";
  right.records[lexicalRecordId].value.meanings.en = ["new confirmation"];

  const rightReviewId = createRecordId("reviewLog", "rl_right_only");
  right.records[rightReviewId] = {
    ...clone(right.records[createRecordId("reviewLog", "rl_fixed")]),
    recordId: rightReviewId,
    logicalId: "rl_right_only",
    updatedAt: "2026-06-16T00:46:00.000Z",
    value: {
      ...clone(right.records[createRecordId("reviewLog", "rl_fixed")].value),
      id: "rl_right_only",
      result: "easy",
      updatedAt: "2026-06-16T00:46:00.000Z"
    }
  };

  const occurrenceId = "occurrence:確認:2026-06-16T00:11:00.000Z";
  const occurrenceRecordId = createRecordId("sourceOccurrence", occurrenceId);
  right.records[occurrenceRecordId].updatedAt = "2026-06-16T00:50:00.000Z";
  right.records[occurrenceRecordId].deletedAt = "2026-06-16T00:50:00.000Z";
  right.records[occurrenceRecordId].value.deletedAt = "2026-06-16T00:50:00.000Z";

  const merged = mergeRecordStoreSnapshots(left, right, { mergedAt: "2026-06-16T02:00:00.000Z" });
  assertCleanSnapshot(merged);

  assert.equal(merged.records[lexicalRecordId].value.meanings.en[0], "new confirmation");
  assert.ok(merged.records[createRecordId("reviewLog", "rl_fixed")]);
  assert.ok(merged.records[rightReviewId]);
  assert.equal(merged.records[occurrenceRecordId].deletedAt, "2026-06-16T00:50:00.000Z");

  const roundTrip = recordStoreToAppState(merged);
  assert.equal(roundTrip.sourceOccurrences[occurrenceId], undefined);
  assert.equal(Object.keys(roundTrip.reviewLogs).length, 2);
});

test("validation reports deterministic-id errors and dangling references", () => {
  const snapshot = migrateAppStateToRecordStore(createRepresentativeState(), { migratedAt: MIGRATED_AT });
  const broken = clone(snapshot);
  const lexicalRecordId = createRecordId("lexicalItem", "確認:かくにん");
  broken.records[lexicalRecordId].recordId = "lexicalItem:not-deterministic";

  const sourceStateRecord = snapshot.records[createRecordId("userLexicalState", "確認:かくにん")];
  const danglingLogicalId = "幽霊:ゆうれい";
  const danglingStateId = createRecordId("userLexicalState", danglingLogicalId);
  broken.records[danglingStateId] = {
    ...clone(sourceStateRecord),
    recordId: danglingStateId,
    logicalId: danglingLogicalId,
    value: {
      ...clone(sourceStateRecord.value),
      id: danglingLogicalId,
      lexicalItemId: danglingLogicalId
    }
  };

  const validation = validateRecordStoreSnapshot(broken);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("recordId must match its key")));
  assert.ok(validation.warnings.some((warning) => warning.includes(danglingStateId)));
});

(async () => {
  for (const { name, fn } of tests) {
    await runTest(name, fn);
  }
})();
