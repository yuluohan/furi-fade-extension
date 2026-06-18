"use strict";

const { spawnSync } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");
const ingestSource = path.join(repoRoot, "apps/apple/Fading Furigana/Shared (App)/IngestProtocol.swift");
const runnerSource = path.join(repoRoot, "apps/apple/scripts/runSwiftIngestGoldenVectors.swift");
const vectorPath = path.join(repoRoot, "packages/core-schema/golden-vectors/ingest-protocol-v1.json");
const binaryPath = path.join(os.tmpdir(), `fading-furigana-swift-ingest-vectors-${process.pid}`);
const moduleCachePath = path.join(os.tmpdir(), `fading-furigana-swift-module-cache-${process.pid}`);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit"
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

run("xcrun", ["swiftc", "-module-cache-path", moduleCachePath, ingestSource, runnerSource, "-o", binaryPath]);
run(binaryPath, [vectorPath]);
