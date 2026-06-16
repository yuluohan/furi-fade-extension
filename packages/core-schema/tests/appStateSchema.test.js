const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "../../..");

function loadBrowserScript(relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  vm.runInThisContext(fs.readFileSync(filePath, "utf8"), { filename: filePath });
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

function getPath(value, dottedPath) {
  return dottedPath.split(".").reduce((cursor, part) => cursor?.[part], value);
}

function assertRecordDomain(state, domain) {
  for (const [id, record] of Object.entries(state[domain] || {})) {
    assert.equal(record.id, id);
    assert.equal(typeof record.updatedAt, "string", `${domain}.${id}.updatedAt`);
    assert.equal(record.deviceId.startsWith("dev_"), true, `${domain}.${id}.deviceId`);
  }
}

global.window = global;
loadBrowserScript("packages/extension/src/core/appState.js");

const schema = readJson("packages/core-schema/schema/app-state-v1.schema.json");
const vector = readJson("packages/core-schema/golden-vectors/app-state-v1-migration.json");
const migrated = window.FadingFuriganaState.migrateAppState(vector.input);

assert.equal(schema.properties.schemaVersion.const, 1);
assert.equal(migrated.schemaVersion, vector.expect.schemaVersion);
assert.equal(migrated.metadata.deviceId.startsWith(vector.expect.metadataDeviceIdPrefix), true);
assert.equal(migrated.metadata.storageRevision, 0);
assert.equal(typeof migrated.metadata.writeId, "string");

for (const dottedPath of vector.expect.preservedUnknownPaths) {
  assert.notEqual(getPath(migrated, dottedPath), undefined, dottedPath);
}

for (const [dottedRecordPath, expectedUpdatedAt] of Object.entries(vector.expect.recordUpdatedAt)) {
  const record = getPath(migrated, dottedRecordPath);
  assert.equal(record.updatedAt, expectedUpdatedAt, dottedRecordPath);
  assert.equal(record.deviceId, migrated.metadata.deviceId, dottedRecordPath);
}

for (const domain of [
  "lexicalItems",
  "userLexicalStates",
  "exposureIndex",
  "sourceOccurrences",
  "dailyExposureSummaries",
  "reviewLogs"
]) {
  assertRecordDomain(migrated, domain);
}

console.log("[pass] app-state v1 schema metadata and golden migration vector");
