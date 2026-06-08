const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "..");

function loadBrowserScript(relativePath) {
  const filePath = path.join(rootDir, relativePath);
  vm.runInThisContext(fs.readFileSync(filePath, "utf8"), { filename: filePath });
}

function test(name, fn) {
  try {
    fn();
    console.log(`[pass] ${name}`);
  } catch (error) {
    console.error(`[fail] ${name}`);
    throw error;
  }
}

function createElement({ tagName = "P", parentElement = null, attributes = {}, hidden = false, isContentEditable = false } = {}) {
  return {
    tagName,
    parentElement,
    hidden,
    isContentEditable,
    getAttribute(name) {
      return attributes[name] ?? null;
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name);
    }
  };
}

global.window = global;
loadBrowserScript("src/content/annotationEngine.js");

const { extractSentence, shouldSkipTextNode } = window.FadingFuriganaAnnotationEngine;

test("extracts sentence around token start", () => {
  const text = "前の文です。メールの内容を確認してください。次の文です。";
  const start = text.indexOf("確認");

  assert.equal(extractSentence(text, start), "メールの内容を確認してください。");
});

test("does not skip Japanese text in normal paragraph", () => {
  const parentElement = createElement({ tagName: "P" });
  const node = {
    nodeValue: "申請には時間がかかります。",
    parentElement
  };

  assert.equal(shouldSkipTextNode(node), false);
});

test("skips text without Japanese characters", () => {
  const parentElement = createElement({ tagName: "P" });
  const node = {
    nodeValue: "plain English",
    parentElement
  };

  assert.equal(shouldSkipTextNode(node), true);
});

test("skips code and preformatted text", () => {
  const parentElement = createElement({ tagName: "CODE" });
  const node = {
    nodeValue: "確認",
    parentElement
  };

  assert.equal(shouldSkipTextNode(node), true);
});

test("skips hidden or explicitly ignored content", () => {
  const hiddenParent = createElement({ tagName: "P", hidden: true });
  const ignoredParent = createElement({
    tagName: "P",
    attributes: {
      "data-fading-furigana-ignore": ""
    }
  });

  assert.equal(shouldSkipTextNode({ nodeValue: "確認", parentElement: hiddenParent }), true);
  assert.equal(shouldSkipTextNode({ nodeValue: "確認", parentElement: ignoredParent }), true);
});

test("skips descendants of existing annotations", () => {
  const annotationParent = createElement({
    tagName: "SPAN",
    attributes: {
      "data-jr-annotated": "true"
    }
  });
  const child = createElement({ tagName: "SPAN", parentElement: annotationParent });

  assert.equal(shouldSkipTextNode({ nodeValue: "確認", parentElement: child }), true);
});
