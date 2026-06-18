"use strict";

// Compiles the real LoopbackIngestServer (plus the shared IngestProtocol) against a tiny stub
// store, then runs the round-trip harness over a real 127.0.0.1 socket. Mirrors the
// runSwiftIngestGoldenVectors runner so it stays a plain, dependency-free Node script.

const { spawnSync } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");
const sharedApp = path.join(repoRoot, "apps/apple/Fading Furigana/Shared (App)");
const sources = [
  path.join(sharedApp, "IngestProtocol.swift"),
  path.join(sharedApp, "LoopbackIngestServer.swift"),
  path.join(repoRoot, "apps/apple/scripts/runLoopbackSmoke.swift")
];
const binaryPath = path.join(os.tmpdir(), `fading-furigana-loopback-smoke-${process.pid}`);
const moduleCachePath = path.join(os.tmpdir(), `fading-furigana-loopback-module-cache-${process.pid}`);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit" });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

run("xcrun", ["swiftc", "-module-cache-path", moduleCachePath, ...sources, "-o", binaryPath]);
run(binaryPath, []);
