const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const projectDir = path.join(rootDir, "apps", "apple");
const extensionDir = path.join(rootDir, "packages", "extension", "dist", "safari-web-extension");
const safariProjectDir = path.join(projectDir, "Fading Furigana");
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
const safariExtensionBundleIdentifier = "com.japanstudylab.fadingfurigana.Extension";
const lsregister =
  "/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister";
const developmentTeam = process.env.FURI_DEVELOPMENT_TEAM || readProjectDevelopmentTeam();
const developmentTeamSource = process.env.FURI_DEVELOPMENT_TEAM ? "FURI_DEVELOPMENT_TEAM" : "Xcode project";
const compileOnly = process.env.FURI_SAFARI_COMPILE_ONLY === "1";
const restartSafari = process.env.FURI_RESTART_SAFARI === "1";
const openSafariUrl = process.env.FURI_OPEN_SAFARI_URL || "";

run("npm", ["run", "package:safari"]);
cleanupGeneratedDuplicateProjectDirs();
if (!fs.existsSync(xcodeProject) || process.env.FURI_REGENERATE_SAFARI_PROJECT === "1") {
  run("xcrun", [
    "safari-web-extension-packager",
    "--project-location",
    projectDir,
    "--app-name",
    "Fading Furigana",
    "--bundle-identifier",
    "com.japanstudylab.fadingfurigana",
    "--swift",
    "--copy-resources",
    "--no-open",
    "--no-prompt",
    "--force",
    extensionDir
  ]);
  cleanupGeneratedDuplicateProjectDirs();
} else {
  console.log("\nUsing existing Safari Xcode project. Set FURI_REGENERATE_SAFARI_PROJECT=1 to regenerate it.");
}
run("node", ["apps/apple/scripts/patchSafariWrapper.js"]);
// The packager's resource copy has been observed to drop files from the
// Xcode Resources mirror; force-merge dist over it so direct Xcode builds
// always ship the current extension code.
run("ditto", [extensionDir, path.join(projectDir, "Fading Furigana", "Shared (Extension)", "Resources")]);

const buildArgs = [
  "-project",
  xcodeProject,
  "-scheme",
  "Fading Furigana (macOS)",
  "-configuration",
  "Debug",
  "-derivedDataPath",
  derivedDataPath
];

if (compileOnly) {
  buildArgs.push("CODE_SIGNING_ALLOWED=NO");
} else if (developmentTeam) {
  console.log(`\nUsing Apple Development Team ${developmentTeam} from ${developmentTeamSource}.`);
  buildArgs.push(
    "-allowProvisioningUpdates",
    "DEVELOPMENT_TEAM=" + developmentTeam,
    "CODE_SIGN_STYLE=Automatic",
    "CODE_SIGN_IDENTITY=Apple Development"
  );
} else {
  console.error(
    "\nApp Group storage requires a signed Apple Development build. " +
      "Set FURI_DEVELOPMENT_TEAM to your Apple Team ID and run again:\n\n" +
      "  FURI_DEVELOPMENT_TEAM=YOURTEAMID npm run build:safari:mac\n\n" +
      "If Xcode already builds successfully, open Signing & Capabilities once so " +
      "the project saves DEVELOPMENT_TEAM, then run npm run build:safari:mac without the env var.\n\n" +
      "For compile-only CI checks that do not install or run Safari, use:\n\n" +
      "  FURI_SAFARI_COMPILE_ONLY=1 npm run build:safari:mac\n"
  );
  process.exit(1);
}

buildArgs.push("build");
run("xcodebuild", buildArgs);

if (compileOnly) {
  console.log("\nCompile-only build succeeded. Skipping install and Safari registration.");
  process.exit(0);
}

if (!verifyBuiltAppSignature()) {
  console.error("\nSigned build did not pass codesign verification. Open Xcode Signing & Capabilities and check the team/profile.");
  process.exit(1);
}

quitSafariIfRequested();
installApp();
verifyInstalledExtensionResources();
registerSafariExtension();
reopenSafariIfRequested();

if (restartSafari) {
  console.log("\nDone. Safari was restarted so newly opened pages should load the latest extension code.");
} else if (isSafariRunning()) {
  console.warn(
    "\nInstalled extension resources are up to date, but Safari is still running. " +
      "Existing tabs may keep old content scripts. Quit and reopen Safari, or run with:\n\n" +
      "  FURI_RESTART_SAFARI=1 FURI_DEVELOPMENT_TEAM=" +
      (developmentTeam || "YOURTEAMID") +
      " npm run build:safari:mac\n"
  );
} else {
  console.log("\nDone. Open Safari, then enable the extension in Settings > Extensions if needed.");
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

function readProjectDevelopmentTeam() {
  try {
    const projectFile = fs.readFileSync(path.join(xcodeProject, "project.pbxproj"), "utf8");
    return projectFile.match(/\bDEVELOPMENT_TEAM = ([A-Z0-9]+);/)?.[1] || "";
  } catch {
    return "";
  }
}

function cleanupGeneratedDuplicateProjectDirs() {
  if (!fs.existsSync(safariProjectDir)) return;

  const duplicateDirPattern =
    /^(Shared \(App\)|Shared \(Extension\)|iOS \(App\)|iOS \(Extension\)|macOS \(App\)|macOS \(Extension\)) \d+$/;
  for (const entry of fs.readdirSync(safariProjectDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !duplicateDirPattern.test(entry.name)) continue;

    const entryPath = path.join(safariProjectDir, entry.name);
    if (directoryHasFiles(entryPath)) {
      console.warn(`\nKeeping generated duplicate directory because it contains files: ${entryPath}`);
      continue;
    }

    fs.rmSync(entryPath, { recursive: true, force: true });
    console.log(`Removed empty generated duplicate directory: ${entryPath}`);
  }
}

function directoryHasFiles(dirPath) {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isFile() || entry.isSymbolicLink()) return true;
    if (entry.isDirectory() && directoryHasFiles(entryPath)) return true;
  }
  return false;
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

function verifyInstalledExtensionResources() {
  const resourceChecks = [
    "manifest.json",
    "src/content/annotationEngine.js",
    "src/content/tooltip.js",
    "src/services/wordRepositoryService.js",
    "src/styles/annotation.css"
  ];

  for (const relativePath of resourceChecks) {
    const packagedPath = path.join(extensionDir, relativePath);
    const installedPath = path.join(installedExtensionPath, "Contents", "Resources", relativePath);
    if (!fs.existsSync(packagedPath) || !fs.existsSync(installedPath)) {
      console.error(`\nInstalled extension resource is missing: ${relativePath}`);
      process.exit(1);
    }

    const packagedHash = sha256(packagedPath);
    const installedHash = sha256(installedPath);
    if (packagedHash !== installedHash) {
      console.error(
        `\nInstalled extension resource is stale: ${relativePath}\n` +
          `  packaged:  ${packagedHash}\n` +
          `  installed: ${installedHash}`
      );
      process.exit(1);
    }
  }

  console.log("\nVerified installed Safari extension resources match the latest package.");
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function quitSafariIfRequested() {
  if (!restartSafari || !isSafariRunning()) return;
  run("osascript", ["-e", 'tell application "Safari" to quit'], { allowFailure: true });
  run("sleep", ["2"], { allowFailure: true });
}

function reopenSafariIfRequested() {
  if (!restartSafari) return;
  if (openSafariUrl) {
    run("open", ["-a", "Safari", openSafariUrl], { allowFailure: true });
  } else {
    run("open", ["-a", "Safari"], { allowFailure: true });
  }
}

function isSafariRunning() {
  const result = spawnSync("osascript", ["-e", 'application "Safari" is running'], {
    cwd: rootDir,
    env: process.env,
    encoding: "utf8"
  });
  return result.status === 0 && result.stdout.trim() === "true";
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
  if (!record.includes("identifier:                 com.japanstudylab.fadingfurigana")) return;
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
