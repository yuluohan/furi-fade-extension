(() => {
  "use strict";

  const RECORD_DEFINITIONS = Object.freeze({
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

  const SINGLETON_RECORDS = Object.freeze([
    ["appMetadata", "metadata"],
    ["userProfile", "userProfile"],
    ["settings", "settings"],
    ["entitlements", "entitlements"]
  ]);

  const MAP_RECORDS = Object.freeze([
    "lexicalItem",
    "userLexicalState",
    "exposureIndex",
    "sourceOccurrence",
    "dailyExposureSummary",
    "reviewLog"
  ]);

  function createRecordBatchFromAppState(state, options = {}) {
    const migrated = migrate(state);
    const metadata = migrated.metadata || {};
    const createdAt = options.createdAt || window.FadingFuriganaState.createTimestamp();
    const sourceClientId = normalizeDeviceId(metadata.deviceId);
    const records = [];

    for (const [type, appStateKey] of SINGLETON_RECORDS) {
      const definition = RECORD_DEFINITIONS[type];
      records.push(createRecord(definition, definition.singletonId, migrated[appStateKey] || {}, metadata));
    }

    for (const type of MAP_RECORDS) {
      const definition = RECORD_DEFINITIONS[type];
      const domain = migrated[definition.appStateKey] || {};
      for (const logicalId of Object.keys(domain).sort()) {
        const value = domain[logicalId];
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        records.push(createRecord(definition, logicalId, value, metadata));
      }
    }

    return {
      protocolVersion: 1,
      batchId: options.batchId || createBatchId(sourceClientId, createdAt),
      sourceClientId,
      sourceKind: options.sourceKind || "chrome-extension",
      targetKind: options.targetKind || "mac-app",
      direction: options.direction || "push",
      createdAt,
      baseCursor: options.baseCursor ?? null,
      records
    };
  }

  function createRecord(definition, logicalId, value, metadata) {
    const updatedAt = firstString(
      value.deletedAt,
      value.updatedAt,
      value.lastSeenAt,
      value.reviewedAt,
      value.createdAt,
      metadata.updatedAt,
      metadata.createdAt,
      window.FadingFuriganaState.createTimestamp()
    );
    const record = {
      formatVersion: 1,
      recordId: createRecordId(definition.type, logicalId),
      type: definition.type,
      domain: definition.domain,
      logicalId,
      syncScope: definition.syncScope,
      mergeStrategy: definition.mergeStrategy,
      updatedAt,
      deviceId: normalizeDeviceId(value.deviceId || metadata.deviceId),
      value: clone(value)
    };
    if (typeof value.deletedAt === "string" && value.deletedAt.trim()) {
      record.deletedAt = value.deletedAt.trim();
    }
    return record;
  }

  function appStateFromRecordBatch(batch) {
    if (!batch || typeof batch !== "object" || !Array.isArray(batch.records)) {
      throw new Error("Invalid record batch response.");
    }
    const state = window.FadingFuriganaState.createDefaultAppState(batch.createdAt);
    state.lexicalItems = {};
    state.userLexicalStates = {};
    state.exposureIndex = {};
    state.sourceOccurrences = {};
    state.dailyExposureSummaries = {};
    state.reviewLogs = {};

    for (const record of batch.records) {
      if (!record || typeof record !== "object" || record.deletedAt) continue;
      const definition = RECORD_DEFINITIONS[record.type];
      if (!definition) continue;
      const value = clone(record.value || {});
      switch (record.type) {
        case "appMetadata":
          state.metadata = value;
          break;
        case "userProfile":
          state.userProfile = value;
          break;
        case "settings":
          state.settings = value;
          break;
        case "entitlements":
          state.entitlements = value;
          break;
        default:
          if (definition.appStateKey) state[definition.appStateKey][record.logicalId] = value;
      }
    }

    return state;
  }

  function createRecordId(type, logicalId) {
    return `${type}:${encodeURIComponent(String(logicalId || ""))}`;
  }

  function createBatchId(sourceClientId, createdAt) {
    const safeSource = String(sourceClientId || "dev_unknown").replace(/[^a-zA-Z0-9_:-]/g, "_");
    const safeTime = String(createdAt || "").replace(/[^0-9A-Za-z]/g, "");
    return `bat_${safeSource}_${safeTime}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function normalizeDeviceId(value) {
    return typeof value === "string" && value.startsWith("dev_") ? value : "dev_unknown";
  }

  function firstString(...values) {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value || {}));
  }

  function migrate(state) {
    return window.FadingFuriganaState.migrateAppState(state);
  }

  window.FadingFuriganaRecordBatch = {
    RECORD_DEFINITIONS,
    createRecordBatchFromAppState,
    appStateFromRecordBatch,
    createRecordId
  };
})();
