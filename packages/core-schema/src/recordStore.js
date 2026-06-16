"use strict";

const RECORD_STORE_FORMAT_VERSION = 1;
const APP_STATE_SCHEMA_VERSION = 1;

const RECORD_TYPES = Object.freeze({
  appMetadata: Object.freeze({
    type: "appMetadata",
    domain: "metadata",
    singletonId: "local",
    syncScope: "local_only",
    mergeStrategy: "local_only"
  }),
  userProfile: Object.freeze({
    type: "userProfile",
    domain: "userProfile",
    singletonId: "global",
    syncScope: "syncable",
    mergeStrategy: "lww"
  }),
  settings: Object.freeze({
    type: "settings",
    domain: "settings",
    singletonId: "global",
    syncScope: "syncable",
    mergeStrategy: "lww"
  }),
  entitlements: Object.freeze({
    type: "entitlements",
    domain: "entitlements",
    singletonId: "local",
    syncScope: "local_or_server_authoritative",
    mergeStrategy: "server_authoritative"
  }),
  lexicalItem: Object.freeze({
    type: "lexicalItem",
    domain: "lexicalItems",
    appStateKey: "lexicalItems",
    syncScope: "syncable",
    mergeStrategy: "lww"
  }),
  userLexicalState: Object.freeze({
    type: "userLexicalState",
    domain: "userLexicalStates",
    appStateKey: "userLexicalStates",
    syncScope: "syncable",
    mergeStrategy: "lww"
  }),
  exposureIndex: Object.freeze({
    type: "exposureIndex",
    domain: "exposureIndex",
    appStateKey: "exposureIndex",
    syncScope: "syncable",
    mergeStrategy: "lww_pending_additive_exposure"
  }),
  sourceOccurrence: Object.freeze({
    type: "sourceOccurrence",
    domain: "sourceOccurrences",
    appStateKey: "sourceOccurrences",
    syncScope: "syncable",
    mergeStrategy: "append_lww_same_id"
  }),
  dailyExposureSummary: Object.freeze({
    type: "dailyExposureSummary",
    domain: "dailyExposureSummaries",
    appStateKey: "dailyExposureSummaries",
    syncScope: "per_device_delta",
    mergeStrategy: "additive_delta_pending"
  }),
  reviewLog: Object.freeze({
    type: "reviewLog",
    domain: "reviewLogs",
    appStateKey: "reviewLogs",
    syncScope: "syncable",
    mergeStrategy: "append_lww_same_id"
  })
});

const SINGLETON_DEFINITIONS = Object.freeze([
  RECORD_TYPES.appMetadata,
  RECORD_TYPES.userProfile,
  RECORD_TYPES.settings,
  RECORD_TYPES.entitlements
]);

const MAP_DEFINITIONS = Object.freeze([
  RECORD_TYPES.lexicalItem,
  RECORD_TYPES.userLexicalState,
  RECORD_TYPES.exposureIndex,
  RECORD_TYPES.sourceOccurrence,
  RECORD_TYPES.dailyExposureSummary,
  RECORD_TYPES.reviewLog
]);

const TYPE_BY_NAME = Object.freeze(
  Object.fromEntries(Object.values(RECORD_TYPES).map((definition) => [definition.type, definition]))
);

function createRecordId(type, logicalId) {
  return `${type}:${encodeRecordKey(logicalId)}`;
}

function encodeRecordKey(value) {
  return encodeURIComponent(String(value || ""));
}

function migrateAppStateToRecordStore(appState, options = {}) {
  if (!appState || typeof appState !== "object" || Array.isArray(appState)) {
    throw new TypeError("Expected an AppState object.");
  }

  const migratedAt = options.migratedAt || createTimestamp();
  const metadata = objectOrEmpty(appState.metadata);
  const sourceDeviceId = normalizeDeviceId(metadata.deviceId);
  const sourceUpdatedAt = firstString(metadata.updatedAt, metadata.createdAt, migratedAt);
  const source = {
    schemaVersion: normalizeInteger(appState.schemaVersion, APP_STATE_SCHEMA_VERSION),
    storageRevision: normalizeInteger(metadata.storageRevision, 0),
    writeId: firstString(metadata.writeId, null),
    deviceId: sourceDeviceId,
    updatedAt: sourceUpdatedAt
  };

  const records = {};
  addRecord(records, RECORD_TYPES.appMetadata, RECORD_TYPES.appMetadata.singletonId, metadata, {
    updatedAt: sourceUpdatedAt,
    deviceId: sourceDeviceId
  });
  addRecord(records, RECORD_TYPES.userProfile, RECORD_TYPES.userProfile.singletonId, objectOrEmpty(appState.userProfile), {
    updatedAt: sourceUpdatedAt,
    deviceId: sourceDeviceId
  });
  addRecord(records, RECORD_TYPES.settings, RECORD_TYPES.settings.singletonId, objectOrEmpty(appState.settings), {
    updatedAt: sourceUpdatedAt,
    deviceId: sourceDeviceId
  });
  addRecord(records, RECORD_TYPES.entitlements, RECORD_TYPES.entitlements.singletonId, objectOrEmpty(appState.entitlements), {
    updatedAt: sourceUpdatedAt,
    deviceId: sourceDeviceId
  });

  for (const definition of MAP_DEFINITIONS) {
    const domain = objectOrEmpty(appState[definition.appStateKey]);
    for (const [logicalId, value] of Object.entries(domain)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      addRecord(records, definition, logicalId, value, {
        updatedAt: inferRecordUpdatedAt(value, sourceUpdatedAt, migratedAt),
        deviceId: normalizeDeviceId(value.deviceId || sourceDeviceId)
      });
    }
  }

  return {
    formatVersion: RECORD_STORE_FORMAT_VERSION,
    storageKind: "record-store-snapshot",
    migratedAt,
    source,
    records
  };
}

function addRecord(records, definition, logicalId, value, options) {
  const recordId = createRecordId(definition.type, logicalId);
  const recordValue = clone(value);
  const record = {
    formatVersion: RECORD_STORE_FORMAT_VERSION,
    recordId,
    type: definition.type,
    domain: definition.domain,
    logicalId,
    syncScope: definition.syncScope,
    mergeStrategy: definition.mergeStrategy,
    updatedAt: options.updatedAt,
    deviceId: normalizeDeviceId(options.deviceId),
    value: recordValue
  };

  if (typeof recordValue.deletedAt === "string" && recordValue.deletedAt.trim()) {
    record.deletedAt = recordValue.deletedAt.trim();
  }

  records[recordId] = record;
  return record;
}

function recordStoreToAppState(snapshot, options = {}) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new TypeError("Expected a record-store snapshot object.");
  }

  if (!options.allowInvalid) {
    const validation = validateRecordStoreSnapshot(snapshot);
    if (!validation.valid) {
      throw new Error(`Invalid record-store snapshot: ${validation.errors.join("; ")}`);
    }
  }

  const source = objectOrEmpty(snapshot.source);
  const records = objectOrEmpty(snapshot.records);
  const state = {
    schemaVersion: normalizeInteger(source.schemaVersion, APP_STATE_SCHEMA_VERSION),
    userProfile: clone(getSingletonValue(records, RECORD_TYPES.userProfile) || {}),
    settings: clone(getSingletonValue(records, RECORD_TYPES.settings) || {}),
    entitlements: clone(getSingletonValue(records, RECORD_TYPES.entitlements) || {}),
    lexicalItems: {},
    userLexicalStates: {},
    exposureIndex: {},
    sourceOccurrences: {},
    dailyExposureSummaries: {},
    reviewLogs: {},
    metadata: clone(getSingletonValue(records, RECORD_TYPES.appMetadata) || {
      deviceId: source.deviceId || "dev_unknown",
      updatedAt: source.updatedAt || snapshot.migratedAt,
      createdAt: source.updatedAt || snapshot.migratedAt,
      lastOpenedAt: source.updatedAt || snapshot.migratedAt,
      storageRevision: source.storageRevision || 0,
      writeId: source.writeId || null
    })
  };

  for (const record of Object.values(records)) {
    const definition = TYPE_BY_NAME[record?.type];
    if (!definition?.appStateKey || record.deletedAt) continue;
    state[definition.appStateKey][record.logicalId] = clone(record.value);
  }

  return state;
}

function validateRecordStoreSnapshot(snapshot) {
  const errors = [];
  const warnings = [];
  const counts = {};

  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return {
      valid: false,
      errors: ["snapshot must be an object"],
      warnings,
      counts
    };
  }

  if (snapshot.formatVersion !== RECORD_STORE_FORMAT_VERSION) {
    errors.push(`formatVersion must be ${RECORD_STORE_FORMAT_VERSION}`);
  }

  if (snapshot.storageKind !== "record-store-snapshot") {
    errors.push("storageKind must be record-store-snapshot");
  }

  if (!isIsoTimestamp(snapshot.migratedAt)) {
    errors.push("migratedAt must be an ISO timestamp string");
  }

  const records = objectOrEmpty(snapshot.records);
  if (records !== snapshot.records) {
    errors.push("records must be an object");
  }

  const logicalSets = {
    lexicalItem: new Set(),
    userLexicalState: new Set(),
    exposureIndex: new Set()
  };

  for (const [recordId, record] of Object.entries(records)) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      errors.push(`${recordId} must be an object`);
      continue;
    }

    const prefix = recordId;
    counts[record.type] = (counts[record.type] || 0) + 1;

    if (record.recordId !== recordId) errors.push(`${prefix}.recordId must match its key`);
    if (record.formatVersion !== RECORD_STORE_FORMAT_VERSION) {
      errors.push(`${prefix}.formatVersion must be ${RECORD_STORE_FORMAT_VERSION}`);
    }

    const definition = TYPE_BY_NAME[record.type];
    if (!definition) {
      errors.push(`${prefix}.type is unknown: ${record.type}`);
      continue;
    }

    if (record.domain !== definition.domain) errors.push(`${prefix}.domain must be ${definition.domain}`);
    if (record.syncScope !== definition.syncScope) errors.push(`${prefix}.syncScope must be ${definition.syncScope}`);
    if (record.mergeStrategy !== definition.mergeStrategy) {
      errors.push(`${prefix}.mergeStrategy must be ${definition.mergeStrategy}`);
    }
    if (typeof record.logicalId !== "string" || record.logicalId.length === 0) {
      errors.push(`${prefix}.logicalId must be a non-empty string`);
    } else if (record.recordId !== createRecordId(record.type, record.logicalId)) {
      errors.push(`${prefix}.recordId is not deterministic for type/logicalId`);
    }

    if (!isIsoTimestamp(record.updatedAt)) errors.push(`${prefix}.updatedAt must be an ISO timestamp string`);
    if (!isDeviceId(record.deviceId)) errors.push(`${prefix}.deviceId must start with dev_`);
    if (record.deletedAt !== undefined && !isIsoTimestamp(record.deletedAt)) {
      errors.push(`${prefix}.deletedAt must be an ISO timestamp string when present`);
    }
    if (!record.value || typeof record.value !== "object" || Array.isArray(record.value)) {
      errors.push(`${prefix}.value must be an object`);
    }

    if (definition.appStateKey && record.value?.id !== undefined && record.value.id !== record.logicalId) {
      errors.push(`${prefix}.value.id must match logicalId when present`);
    }

    if (logicalSets[record.type]) logicalSets[record.type].add(record.logicalId);
  }

  for (const definition of SINGLETON_DEFINITIONS) {
    const recordId = createRecordId(definition.type, definition.singletonId);
    if (!records[recordId]) {
      errors.push(`missing singleton record ${recordId}`);
    }
  }

  for (const [recordId, record] of Object.entries(records)) {
    if (!record || typeof record !== "object" || Array.isArray(record)) continue;
    if (!record.value || typeof record.value !== "object" || Array.isArray(record.value)) continue;

    const lexicalItemId = record.value.lexicalItemId;
    if (
      ["sourceOccurrence", "dailyExposureSummary", "reviewLog"].includes(record.type) &&
      (typeof lexicalItemId !== "string" || lexicalItemId.length === 0)
    ) {
      errors.push(`${recordId}.value.lexicalItemId must be a non-empty string`);
    }

    if (record.type === "userLexicalState") {
      const id = record.value.lexicalItemId || record.logicalId;
      if (!logicalSets.lexicalItem.has(id) && !logicalSets.exposureIndex.has(id)) {
        warnings.push(`${recordId} references ${id}, which has no lexicalItem or exposureIndex record`);
      }
    }

    if (["sourceOccurrence", "dailyExposureSummary", "reviewLog"].includes(record.type)) {
      const id = record.value.lexicalItemId;
      if (
        typeof id === "string" &&
        !logicalSets.lexicalItem.has(id) &&
        !logicalSets.userLexicalState.has(id) &&
        !logicalSets.exposureIndex.has(id)
      ) {
        warnings.push(`${recordId} references ${id}, which is not present in vocabulary records`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    counts
  };
}

function mergeRecordStoreSnapshots(left, right, options = {}) {
  const merged = clone(left);
  merged.migratedAt = options.mergedAt || createTimestamp();
  merged.records = objectOrEmpty(merged.records);

  for (const [recordId, incomingRecord] of Object.entries(objectOrEmpty(right?.records))) {
    const existingRecord = merged.records[recordId];
    merged.records[recordId] = existingRecord
      ? chooseWinningRecord(existingRecord, incomingRecord)
      : clone(incomingRecord);
  }

  merged.source = {
    ...objectOrEmpty(left?.source),
    ...objectOrEmpty(right?.source),
    updatedAt: laterIso(left?.source?.updatedAt, right?.source?.updatedAt) || right?.source?.updatedAt || left?.source?.updatedAt,
    storageRevision: Math.max(
      normalizeInteger(left?.source?.storageRevision, 0),
      normalizeInteger(right?.source?.storageRevision, 0)
    )
  };

  return merged;
}

function chooseWinningRecord(left, right) {
  const leftVersionAt = recordVersionAt(left);
  const rightVersionAt = recordVersionAt(right);
  const timeComparison = compareIso(leftVersionAt, rightVersionAt);
  if (timeComparison < 0) return clone(right);
  if (timeComparison > 0) return clone(left);

  const leftDeleted = !!left.deletedAt;
  const rightDeleted = !!right.deletedAt;
  if (leftDeleted !== rightDeleted) return clone(rightDeleted ? right : left);

  const deviceComparison = String(left.deviceId || "").localeCompare(String(right.deviceId || ""));
  if (deviceComparison < 0) return clone(right);
  if (deviceComparison > 0) return clone(left);

  return String(left.recordId || "").localeCompare(String(right.recordId || "")) <= 0
    ? clone(right)
    : clone(left);
}

function recordVersionAt(record) {
  return laterIso(record?.deletedAt, record?.updatedAt) || record?.updatedAt || record?.deletedAt || "";
}

function getSingletonValue(records, definition) {
  const record = records[createRecordId(definition.type, definition.singletonId)];
  return record && !record.deletedAt ? record.value : null;
}

function inferRecordUpdatedAt(value, sourceUpdatedAt, migratedAt) {
  return firstString(
    value.updatedAt,
    value.deletedAt,
    value.lastSeenAt,
    value.reviewedAt,
    value.createdAt,
    sourceUpdatedAt,
    migratedAt
  );
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function normalizeDeviceId(value) {
  return typeof value === "string" && value.startsWith("dev_") ? value : "dev_unknown";
}

function isDeviceId(value) {
  return typeof value === "string" && value.startsWith("dev_");
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return values.at(-1) ?? "";
}

function isIsoTimestamp(value) {
  return typeof value === "string" && value.trim() && Number.isFinite(Date.parse(value));
}

function laterIso(left, right) {
  if (!left) return right;
  if (!right) return left;
  return compareIso(left, right) >= 0 ? left : right;
}

function compareIso(left, right) {
  const leftTime = Date.parse(left || "");
  const rightTime = Date.parse(right || "");
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    return leftTime === rightTime ? 0 : leftTime > rightTime ? 1 : -1;
  }
  return String(left || "").localeCompare(String(right || ""));
}

function createTimestamp() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  APP_STATE_SCHEMA_VERSION,
  MAP_DEFINITIONS,
  RECORD_STORE_FORMAT_VERSION,
  RECORD_TYPES,
  SINGLETON_DEFINITIONS,
  chooseWinningRecord,
  createRecordId,
  migrateAppStateToRecordStore,
  mergeRecordStoreSnapshots,
  recordStoreToAppState,
  validateRecordStoreSnapshot
};
