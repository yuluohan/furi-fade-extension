const path = require("node:path");
const { spawnSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const projectDir = path.join(rootDir, "safari");
const extensionDir = path.join(rootDir, "dist", "safari-web-extension");
const xcodeProject = path.join(projectDir, "Fading Furigana", "Fading Furigana.xcodeproj");
const derivedDataPath = process.env.FURI_XCODE_DERIVED_DATA || "/private/tmp/furi-xcode-derived";

run("npm", ["run", "package:safari"]);
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
run("xcodebuild", ["-list", "-project", xcodeProject]);
run("xcodebuild", [
  "-project",
  xcodeProject,
  "-scheme",
  "Fading Furigana (macOS)",
  "-configuration",
  "Debug",
  "-derivedDataPath",
  derivedDataPath,
  "CODE_SIGNING_ALLOWED=NO",
  "build"
]);

function run(command, args) {
  console.log(`\n$ ${command} ${args.map(formatArg).join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function formatArg(arg) {
  return /\s/.test(arg) ? JSON.stringify(arg) : arg;
}
