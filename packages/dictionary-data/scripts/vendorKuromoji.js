const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const sourceDir = path.join(repoRoot, "node_modules", "kuromoji");
// Vendored tokenizer assets ship inside the extension package.
const targetDir = path.join(repoRoot, "packages", "extension", "src", "tokenizer");

if (!fs.existsSync(sourceDir)) {
  console.error("kuromoji is not installed; run `npm install` first.");
  process.exit(1);
}

fs.mkdirSync(path.join(targetDir, "dict"), { recursive: true });
fs.copyFileSync(path.join(sourceDir, "build", "kuromoji.js"), path.join(targetDir, "kuromoji.js"));

const dictFiles = fs.readdirSync(path.join(sourceDir, "dict")).filter((name) => name.endsWith(".dat.gz"));
for (const name of dictFiles) {
  fs.copyFileSync(path.join(sourceDir, "dict", name), path.join(targetDir, "dict", name));
}

console.log(`Vendored kuromoji build and ${dictFiles.length} dictionary files into src/tokenizer.`);
