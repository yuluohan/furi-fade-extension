const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const outputDir = path.join(rootDir, "dist", "safari-web-extension");
const manifestPath = path.join(rootDir, "manifest.json");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const requiredFiles = collectManifestFiles(manifest);

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

copyFile("manifest.json");
copyDirectory("src");

for (const relativePath of requiredFiles) {
  const absolutePath = path.join(outputDir, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Missing packaged manifest asset: ${relativePath}`);
  }
}

console.log(`Safari Web Extension package prepared: ${path.relative(rootDir, outputDir)}`);
console.log(`Packaged ${requiredFiles.length} manifest asset references.`);

function collectManifestFiles(manifest) {
  const files = new Set();

  for (const contentScript of manifest.content_scripts || []) {
    for (const filePath of contentScript.js || []) files.add(filePath);
    for (const filePath of contentScript.css || []) files.add(filePath);
  }

  if (manifest.action?.default_popup) {
    files.add(manifest.action.default_popup);
    collectHtmlAssets(manifest.action.default_popup, files);
  }

  return [...files].sort();
}

function collectHtmlAssets(relativeHtmlPath, files) {
  const html = fs.readFileSync(path.join(rootDir, relativeHtmlPath), "utf8");
  const htmlDir = path.dirname(relativeHtmlPath);

  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const assetPath = match[1];
    if (/^(https?:|data:|#)/.test(assetPath)) continue;
    files.add(path.normalize(path.join(htmlDir, assetPath)));
  }
}

function copyDirectory(relativePath) {
  const source = path.join(rootDir, relativePath);
  const destination = path.join(outputDir, relativePath);
  fs.cpSync(source, destination, { recursive: true });
}

function copyFile(relativePath) {
  const source = path.join(rootDir, relativePath);
  const destination = path.join(outputDir, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}
