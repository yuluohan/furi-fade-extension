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
loadBrowserScript("src/core/appState.js");
loadBrowserScript("src/dictionary/localDictionaryProvider.js");

const { JapaneseAnalyzer, LocalDictionaryProvider, createScriptProfile } = window.FadingFuriganaDictionary;

function analyze(text, entries) {
  const provider = new LocalDictionaryProvider(entries);
  return new JapaneseAnalyzer(provider).analyze(text);
}

test("analyzes kanji compound with reading and offsets", () => {
  const tokens = analyze("メールの内容を確認してください。");
  const token = tokens.find((item) => item.surface === "確認");

  assert.equal(token.start, 7);
  assert.equal(token.end, 9);
  assert.equal(token.lemma, "確認");
  assert.equal(token.readingKana, "かくにん");
  assert.equal(token.source.provider, "local");
  assert.equal(token.scriptProfile.hasKanji, true);
});

test("analyzes mixed kanji and hiragana verbs", () => {
  const tokens = analyze("寿司を食べる。");
  const token = tokens.find((item) => item.surface === "食べる");

  assert.equal(token.lexicalItemId, "食べる:たべる");
  assert.equal(token.lemma, "食べる");
  assert.equal(token.readingKana, "たべる");
  assert.deepEqual(token.partOfSpeech, ["verb", "ichidan"]);
  assert.equal(token.scriptProfile.hasKanji, true);
  assert.equal(token.scriptProfile.hasHiragana, true);
});

test("keeps sample loanword original form while marking local provider source", () => {
  const tokens = analyze("サーバーの状態を確認してください。");
  const loanword = tokens.find((item) => item.surface === "サーバー");
  const state = tokens.find((item) => item.surface === "状態");

  assert.equal(loanword.lexicalType, "loanword");
  assert.equal(loanword.loanword.originalForm, "server");
  assert.equal(loanword.source.provider, "local");
  assert.equal(state.readingKana, "じょうたい");
});

test("prefers longest surface match", () => {
  const tokens = analyze("申請内容を確認する", [
    {
      surface: "申請",
      baseForm: "申請",
      reading: "しんせい",
      meanings: {},
      partOfSpeech: ["noun"]
    },
    {
      surface: "申請内容",
      baseForm: "申請内容",
      reading: "しんせいないよう",
      meanings: {},
      partOfSpeech: ["noun"]
    }
  ]);

  assert.equal(tokens[0].surface, "申請内容");
  assert.equal(tokens[0].start, 0);
  assert.equal(tokens[0].end, 4);
});

test("detects script profile for local dictionary entries", () => {
  assert.deepEqual(createScriptProfile("食べる"), {
    hasKanji: true,
    hasHiragana: true,
    hasKatakana: false,
    hasLatin: false
  });
  assert.deepEqual(createScriptProfile("サーバー"), {
    hasKanji: false,
    hasHiragana: false,
    hasKatakana: true,
    hasLatin: false
  });
});
