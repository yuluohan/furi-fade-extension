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

global.window = global;
loadBrowserScript("src/core/pageLanguage.js");

const { detectPageLanguageProfile, isLikelyChinesePage, isPageEligibleForAnnotation } =
  window.FadingFuriganaPageLanguage;

function createFakeDocument({ lang = "", text = "" } = {}) {
  return {
    documentElement: { lang },
    body: { textContent: text }
  };
}

const CHINESE_TEXT =
  "今天的新闻报道介绍了经济发展情况，专家认为市场环境正在持续改善，企业投资意愿增强，" +
  "消费需求逐步回升，就业形势总体稳定，相关部门将继续推出支持政策，促进高质量发展。";

const JAPANESE_TEXT =
  "本日のニュースでは経済の回復について報道されました。専門家は市場環境が改善していると述べ、" +
  "企業の投資意欲も高まっているとしています。今後も政策支援が続く見通しです。";

test("declared ja language is never treated as Chinese", () => {
  const doc = createFakeDocument({ lang: "ja", text: CHINESE_TEXT });
  assert.equal(isLikelyChinesePage(doc), false);
  assert.equal(isPageEligibleForAnnotation(doc), true);
});

test("declared zh language is treated as Chinese regardless of text", () => {
  for (const lang of ["zh", "zh-CN", "zh-Hant", "ZH-TW"]) {
    const doc = createFakeDocument({ lang, text: JAPANESE_TEXT });
    assert.equal(isLikelyChinesePage(doc), true, `lang=${lang}`);
    assert.equal(isPageEligibleForAnnotation(doc), false, `lang=${lang}`);
  }
});

test("han-heavy text without kana is detected as Chinese", () => {
  const doc = createFakeDocument({ text: CHINESE_TEXT });
  assert.equal(isLikelyChinesePage(doc), true);
  assert.equal(isPageEligibleForAnnotation(doc), false);
});

test("Japanese text without declared language stays eligible", () => {
  const doc = createFakeDocument({ text: JAPANESE_TEXT });
  assert.equal(isLikelyChinesePage(doc), false);
  assert.equal(isPageEligibleForAnnotation(doc), true);
});

test("short or non-CJK pages stay eligible", () => {
  assert.equal(isPageEligibleForAnnotation(createFakeDocument({ text: "" })), true);
  assert.equal(isPageEligibleForAnnotation(createFakeDocument({ text: "Hello world, plain English page." })), true);
  assert.equal(isPageEligibleForAnnotation(createFakeDocument({ text: "日本" })), true);
});

test("profile reports declared language and character counts", () => {
  const profile = detectPageLanguageProfile(createFakeDocument({ lang: " JA-jp ", text: "確認します" }));
  assert.equal(profile.declaredLanguage, "ja-jp");
  assert.equal(profile.hanCount, 2);
  assert.equal(profile.kanaCount, 3);
});

test("missing document parts do not throw", () => {
  assert.equal(isPageEligibleForAnnotation({}), true);
  assert.equal(isPageEligibleForAnnotation({ documentElement: {}, body: {} }), true);
});

console.log("pageLanguage tests passed");
