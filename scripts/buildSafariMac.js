const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const projectDir = path.join(rootDir, "safari");
const extensionDir = path.join(rootDir, "dist", "safari-web-extension");
const xcodeProject = path.join(projectDir, "Fading Furigana", "Fading Furigana.xcodeproj");
// Keep build products out of /tmp: macOS clears /tmp on reboot, which made the
// registered extension silently disappear from Safari.
const derivedDataPath =
  process.env.FURI_XCODE_DERIVED_DATA || path.join(os.homedir(), "Library", "Developer", "FadingFuriganaBuild");
const builtAppPath = path.join(derivedDataPath, "Build", "Products", "Debug", "Fading Furigana.app");
// Install into ~/Applications so LaunchServices keeps a stable, reboot-proof
// registration that Safari can always resolve.
const installedAppPath = path.join(os.homedir(), "Applications", "Fading Furigana.app");
const installedExtensionPath = path.join(
  installedAppPath,
  "Contents",
  "PlugIns",
  "Fading Furigana Extension.appex"
);
const safariExtensionBundleIdentifier = "com.banyuguru.fading-furigana.Extension";
const lsregister =
  "/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister";

run("npm", ["run", "package:safari"]);
if (!fs.existsSync(xcodeProject) || process.env.FURI_REGENERATE_SAFARI_PROJECT === "1") {
  run("xcrun", [
    "safari-web-extension-packager",
    "--project-location",
    projectDir,
    "--app-name",
    "Fading Furigana",
    "--bundle-identifier",
    "com.banyuguru.fading-furigana",
    "--swift",
    "--copy-resources",
    "--no-open",
    "--no-prompt",
    "--force",
    extensionDir
  ]);
} else {
  console.log("\nUsing existing Safari Xcode project. Set FURI_REGENERATE_SAFARI_PROJECT=1 to regenerate it.");
}
run("node", ["scripts/patchSafariWrapper.js"]);
// The packager's resource copy has been observed to drop files from the
// Xcode Resources mirror; force-merge dist over it so direct Xcode builds
// always ship the current extension code.
run("ditto", [extensionDir, path.join(projectDir, "Fading Furigana", "Shared (Extension)", "Resources")]);

run("xcodebuild", [
  "-project",
  xcodeProject,
  "-scheme",
  "Fading Furigana (macOS)",
  "-configuration",
  "Debug",
  "-derivedDataPath",
  derivedDataPath,
  "CODE_SIGN_IDENTITY=-",
  "build"
]);

// Re-sign with a real Apple Development certificate only when explicitly
// requested:
// Safari lists properly signed extensions without the "Allow unsigned
// extensions" developer toggle, which resets on every Safari quit and made
// ad-hoc builds look like they had vanished. Auto-detecting a certificate is
// fragile on local machines because CI/sandbox contexts can see identities
// that the logged-in user does not trust, producing an app Safari refuses.
let signingIdentity = detectSigningIdentity();
if (signingIdentity) {
  console.log(`\nRe-signing with development certificate ${signingIdentity.name}.`);
  resignApp(signingIdentity.hash);
  if (!verifyBuiltAppSignature()) {
    console.warn(
      "\nDevelopment certificate signature is not trusted by this macOS user. " +
        "Falling back to ad-hoc signing; enable Safari's unsigned extension " +
        "developer setting before testing."
    );
    resignApp("-");
    signingIdentity = null;
  }
} else {
  console.warn(
    "\nNo Apple Development identity found; keeping ad-hoc signature. " +
      "Safari will only show the extension while Develop > Developer Settings > " +
      "'Allow unsigned extensions' is enabled (it resets when Safari quits)."
  );
}

installApp();
registerSafariExtension();

console.log("\nDone. In Safari: quit and reopen, then enable the extension in Settings > Extensions.");
if (!signingIdentity) {
  console.log("Ad-hoc build: also enable Develop > Developer Settings > 'Allow unsigned extensions' first.");
}

function run(command, args, options = {}) {
  console.log(`\n$ ${command} ${args.map(formatArg).join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit"
  });

  if (result.status !== 0) {
    if (options.allowFailure) return result;
    process.exit(result.status || 1);
  }

  return result;
}

function formatArg(arg) {
  return /\s/.test(arg) ? JSON.stringify(arg) : arg;
}

function detectSigningIdentity() {
  if (process.env.FURI_SIGNING_IDENTITY) {
    return { hash: process.env.FURI_SIGNING_IDENTITY, name: process.env.FURI_SIGNING_IDENTITY };
  }

  return null;
}

function resignApp(identityHash) {
  // Inner bundle first, then the app, preserving existing entitlements
  // (e.g. get-task-allow from the debug build).
  const extensionInBuild = path.join(builtAppPath, "Contents", "PlugIns", "Fading Furigana Extension.appex");
  for (const target of [extensionInBuild, builtAppPath]) {
    run("codesign", ["--force", "--preserve-metadata=entitlements", "--sign", identityHash, target]);
  }
  run("codesign", ["--verify", "--deep", builtAppPath]);
}

function verifyBuiltAppSignature() {
  const result = spawnSync("codesign", ["--verify", "--deep", "--strict", builtAppPath], {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit"
  });
  return result.status === 0;
}

function installApp() {
  cleanupRegisteredAppCopies();
  fs.mkdirSync(path.dirname(installedAppPath), { recursive: true });
  fs.rmSync(installedAppPath, { recursive: true, force: true });
  run("ditto", [builtAppPath, installedAppPath]);
  registerInstalledApp();
  // xcodebuild registers its build product with LaunchServices; unregister it
  // so Safari lists exactly one copy of the extension (the installed one).
  run(lsregister, ["-u", builtAppPath], { allowFailure: true });
  cleanupRegisteredAppCopies();
  registerInstalledApp();
}

function registerInstalledApp() {
  run(lsregister, ["-f", "-R", "-trusted", installedAppPath]);
}

function registerSafariExtension() {
  const existing = findRegisteredSafariExtensionPaths();
  for (const extensionPath of existing) {
    if (extensionPath !== installedExtensionPath) {
      run("pluginkit", ["-r", extensionPath], { allowFailure: true });
    }
  }

  run("pluginkit", ["-a", installedExtensionPath]);
  run("open", [installedAppPath]);
}

function cleanupRegisteredAppCopies() {
  const registeredAppPaths = findLaunchServicesAppPaths();

  for (const appPath of registeredAppPaths) {
    if (appPath !== installedAppPath) {
      run(lsregister, ["-u", appPath], { allowFailure: true });
    }
  }
}

function findLaunchServicesAppPaths() {
  const result = spawnSync(lsregister, ["-dump"], {
    cwd: rootDir,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024
  });

  if (result.status !== 0) return [];

  const paths = new Set();
  let record = [];
  for (const line of result.stdout.split("\n")) {
    if (/^-{20,}$/.test(line.trim())) {
      addLaunchServicesPathFromRecord(record, paths);
      record = [];
    } else {
      record.push(line);
    }
  }
  addLaunchServicesPathFromRecord(record, paths);

  return [...paths];
}

function addLaunchServicesPathFromRecord(recordLines, paths) {
  const record = recordLines.join("\n");
  if (!record.includes("identifier:                 com.banyuguru.fading-furigana")) return;
  if (!record.includes("bundle id:                  Fading Furigana")) return;

  const appPath = record.match(/\npath:\s+(.+?\.app)(?:\s+\(0x[0-9a-f]+\))?$/m)?.[1]?.trim();
  if (appPath && path.basename(appPath) === "Fading Furigana.app") {
    paths.add(appPath);
  }
}

function findRegisteredSafariExtensionPaths() {
  const result = spawnSync("pluginkit", ["-m", "-v", "-p", "com.apple.Safari.web-extension"], {
    cwd: rootDir,
    env: process.env,
    encoding: "utf8"
  });

  if (result.status !== 0) return [];

  return result.stdout
    .split("\n")
    .filter((line) => line.includes(safariExtensionBundleIdentifier))
    .map((line) => line.match(/\/.*\.appex/)?.[0])
    .filter(Boolean);
}
