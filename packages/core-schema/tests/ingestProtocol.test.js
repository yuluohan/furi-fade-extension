const assert = require("node:assert");
const {
  INGEST_PROTOCOL_VERSION,
  createRecordBatch,
  createRecordId,
  ingestBatch,
  mergeRecord,
  migrateAppStateToRecordStore,
  recordStoreToAppState,
  validateRecordBatch
} = require("../src/recordStore");

const vectors = require("../golden-vectors/ingest-protocol-v1.json");

const DEVICE_A = "dev_ingest_a";
const DEVICE_B = "dev_ingest_b";
const WORD_ID = "確認:かくにん";
const NOW = "2026-06-18T10:00:00.000Z";

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

function createSnapshot() {
  return {
    formatVersion: 1,
    storageKind: "record-store-snapshot",
    migratedAt: NOW,
    source: {
      schemaVersion: 1,
      storageRevision: 0,
      writeId: null,
      deviceId: DEVICE_A,
      updatedAt: NOW
    },
    records: {}
  };
}

function lexicalRecord(overrides = {}) {
  const logicalId = overrides.logicalId || WORD_ID;
  const updatedAt = overrides.updatedAt || NOW;
  const deviceId = overrides.deviceId || DEVICE_A;
  return {
    formatVersion: 1,
    recordId: createRecordId("lexicalItem", logicalId),
    type: "lexicalItem",
    domain: "lexicalItems",
    logicalId,
    syncScope: "syncable",
    mergeStrategy: "lww",
    updatedAt,
    deviceId,
    value: {
      id: logicalId,
      surface: "確認",
      readingKana: "かくにん",
      meanings: { en: ["confirmation"] },
      updatedAt,
      deviceId,
      ...(overrides.value || {})
    },
    ...withoutValueOverrides(overrides)
  };
}

function userStateRecord(overrides = {}) {
  const logicalId = overrides.logicalId || WORD_ID;
  const updatedAt = overrides.updatedAt || NOW;
  const deviceId = overrides.deviceId || DEVICE_A;
  return {
    formatVersion: 1,
    recordId: createRecordId("userLexicalState", logicalId),
    type: "userLexicalState",
    domain: "userLexicalStates",
    logicalId,
    syncScope: "syncable",
    mergeStrategy: "lww",
    updatedAt,
    deviceId,
    value: {
      id: logicalId,
      lexicalItemId: logicalId,
      lifecycleStatus: "learning",
      annotationLevel: "full_ruby",
      updatedAt,
      deviceId,
      ...(overrides.value || {})
    },
    ...withoutValueOverrides(overrides)
  };
}

function exposureRecord(overrides = {}) {
  const logicalId = overrides.logicalId || WORD_ID;
  const updatedAt = overrides.updatedAt || NOW;
  const deviceId = overrides.deviceId || DEVICE_A;
  return {
    formatVersion: 1,
    recordId: createRecordId("exposureIndex", logicalId),
    type: "exposureIndex",
    domain: "exposureIndex",
    logicalId,
    syncScope: "syncable",
    mergeStrategy: "lww_pending_additive_exposure",
    updatedAt,
    deviceId,
    value: {
      id: logicalId,
      lexicalItemId: logicalId,
      surface: "確認",
      readingKana: "かくにん",
      baseReadingKana: "かくにん",
      seenCount: 1,
      firstSeenAt: updatedAt,
      lastSeenAt: updatedAt,
      updatedAt,
      deviceId,
      ...(overrides.value || {})
    },
    ...withoutValueOverrides(overrides)
  };
}

function reviewRecord(id, overrides = {}) {
  const updatedAt = overrides.updatedAt || NOW;
  const deviceId = overrides.deviceId || DEVICE_A;
  return {
    formatVersion: 1,
    recordId: createRecordId("reviewLog", id),
    type: "reviewLog",
    domain: "reviewLogs",
    logicalId: id,
    syncScope: "syncable",
    mergeStrategy: "append_lww_same_id",
    updatedAt,
    deviceId,
    value: {
      id,
      lexicalItemId: WORD_ID,
      reviewedAt: updatedAt,
      result: "good",
      updatedAt,
      deviceId,
      ...(overrides.value || {})
    },
    ...withoutValueOverrides(overrides)
  };
}

function appMetadataRecord(overrides = {}) {
  const updatedAt = overrides.updatedAt || NOW;
  const deviceId = overrides.deviceId || DEVICE_A;
  return {
    formatVersion: 1,
    recordId: createRecordId("appMetadata", "local"),
    type: "appMetadata",
    domain: "metadata",
    logicalId: "local",
    syncScope: "local_only",
    mergeStrategy: "local_only",
    updatedAt,
    deviceId,
    value: {
      deviceId,
      updatedAt,
      storageRevision: 1,
      ...(overrides.value || {})
    },
    ...withoutValueOverrides(overrides)
  };
}

function withoutValueOverrides(overrides) {
  const copy = { ...overrides };
  delete copy.value;
  return copy;
}

function batch(records, options = {}) {
  return createRecordBatch(records, {
    batchId: "bat_test_001",
    sourceClientId: DEVICE_A,
    sourceKind: "chrome-extension",
    targetKind: "mac-app",
    createdAt: NOW,
    ...options
  });
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("creates and validates a record batch", () => {
  const created = batch([lexicalRecord(), exposureRecord()]);
  const validation = validateRecordBatch(created);

  assert.equal(created.protocolVersion, INGEST_PROTOCOL_VERSION);
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.errors, []);
  assert.ok(validation.warnings.some((warning) => warning.includes("lww_pending_additive_exposure")));
  assert.equal(validation.counts.lexicalItem, 1);
  assert.equal(validation.counts.exposureIndex, 1);
});

test("ingests by recordId and keeps different types with the same logicalId", () => {
  const snapshot = createSnapshot();
  const ack = ingestBatch(snapshot, batch([lexicalRecord(), userStateRecord()]), {
    appliedAt: "2026-06-18T10:00:01.000Z"
  });

  assert.equal(ack.ok, true);
  assert.equal(snapshot.source.storageRevision, 1);
  assert.ok(snapshot.records[createRecordId("lexicalItem", WORD_ID)]);
  assert.ok(snapshot.records[createRecordId("userLexicalState", WORD_ID)]);
  assert.equal(Object.keys(snapshot.records).length, 2);
});

test("replaying the same batch is idempotent", () => {
  const snapshot = createSnapshot();
  const incoming = batch([reviewRecord("rl_001")]);

  const firstAck = ingestBatch(snapshot, incoming, { appliedAt: "2026-06-18T10:00:01.000Z" });
  const afterFirst = clone(snapshot);
  const secondAck = ingestBatch(snapshot, incoming, { appliedAt: "2026-06-18T10:00:02.000Z" });

  assert.equal(firstAck.ok, true);
  assert.equal(secondAck.ok, true);
  assert.deepEqual(snapshot, afterFirst);
  assert.equal(Object.keys(snapshot.records).length, 1);
  assert.equal(snapshot.source.storageRevision, 1);
});

test("last-write-wins uses deviceId as deterministic tie-breaker", () => {
  const existing = lexicalRecord({
    deviceId: DEVICE_A,
    updatedAt: NOW,
    value: { meanings: { en: ["old"] } }
  });
  const incoming = lexicalRecord({
    deviceId: DEVICE_B,
    updatedAt: NOW,
    value: { meanings: { en: ["new"] } }
  });

  const merged = mergeRecord(existing, incoming);
  assert.equal(merged.deviceId, DEVICE_B);
  assert.equal(merged.value.meanings.en[0], "new");
});

test("append-only records coexist and identical ids use LWW", () => {
  const snapshot = createSnapshot();
  const first = reviewRecord("rl_001", { updatedAt: "2026-06-18T10:00:00.000Z" });
  const second = reviewRecord("rl_002", { updatedAt: "2026-06-18T10:01:00.000Z" });
  ingestBatch(snapshot, batch([first, second]), { appliedAt: "2026-06-18T10:01:01.000Z" });

  const newerSameId = reviewRecord("rl_001", {
    updatedAt: "2026-06-18T10:02:00.000Z",
    value: { result: "easy" }
  });
  ingestBatch(snapshot, batch([newerSameId], { batchId: "bat_test_002" }), {
    appliedAt: "2026-06-18T10:02:01.000Z"
  });

  assert.equal(Object.keys(snapshot.records).length, 2);
  assert.equal(snapshot.records[createRecordId("reviewLog", "rl_001")].value.result, "easy");
  assert.equal(snapshot.records[createRecordId("reviewLog", "rl_002")].value.result, "good");
});

test("invalid deterministic record ids reject the whole batch without mutation", () => {
  const snapshot = createSnapshot();
  const invalid = lexicalRecord({ recordId: "lexicalItem:not-canonical" });
  const ack = ingestBatch(snapshot, batch([invalid]));

  assert.equal(ack.ok, false);
  assert.equal(ack.error.code, "invalid_batch");
  assert.equal(Object.keys(snapshot.records).length, 0);
  assert.equal(snapshot.source.storageRevision, 0);
});

test("local-only incoming records keep the existing local record by default", () => {
  const existing = appMetadataRecord({
    deviceId: DEVICE_A,
    value: { writeId: "wr_local" }
  });
  const incoming = appMetadataRecord({
    deviceId: DEVICE_B,
    updatedAt: "2026-06-18T11:00:00.000Z",
    value: { writeId: "wr_incoming" }
  });

  const merged = mergeRecord(existing, incoming);
  assert.equal(merged.value.writeId, "wr_local");
});

test("shared golden vectors match AppState projection", () => {
  assert.equal(vectors.formatVersion, 1);
  for (const vector of vectors.cases) {
    const snapshot = migrateAppStateToRecordStore(clone(vector.initialState), {
      migratedAt: "2026-06-18T12:00:00.000Z"
    });
    const ack = ingestBatch(snapshot, clone(vector.batch), {
      appliedAt: "2026-06-18T12:00:01.000Z"
    });
    const appState = recordStoreToAppState(snapshot);

    assertSubset(ack, vector.expectedAck, `${vector.name}.ack`);
    assertSubset(appState, vector.expectedState, `${vector.name}.state`);
  }
});

function assertSubset(actual, expected, pathLabel) {
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    assert.ok(actual && typeof actual === "object" && !Array.isArray(actual), `${pathLabel} should be an object`);
    for (const [key, value] of Object.entries(expected)) {
      assertSubset(actual[key], value, `${pathLabel}.${key}`);
    }
    return;
  }
  assert.deepEqual(actual, expected, pathLabel);
}

(async () => {
  for (const { name, fn } of tests) {
    await runTest(name, fn);
  }
})();
