const path = require("node:path");
const { spawnSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");

run("npm", ["run", "check"]);
run("npm", ["test"]);
const safariBuildEnv = {};
if (!process.env.FURI_DEVELOPMENT_TEAM && !process.env.FURI_SAFARI_COMPILE_ONLY) {
  safariBuildEnv.FURI_SAFARI_COMPILE_ONLY = "1";
}
run("node", ["scripts/buildSafariMac.js"], safariBuildEnv);

function run(command, args, envOverrides = {}) {
  console.log(`\n$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: { ...process.env, ...envOverrides },
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}
