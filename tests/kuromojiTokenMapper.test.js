const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "..");

function loadBrowserScript(relativePath) {
  const filePath = path.join(rootDir, relativePath);
  vm.runInThisContext(fs.readFileSync(filePath, "utf8"), { filename: filePath });
}

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`[pass] ${name}`);
  } catch (error) {
    console.error(`[fail] ${name}`);
    throw error;
  }
}

global.window = global;
loadBrowserScript("src/core/appState.js");
loadBrowserScript("src/dictionary/localDictionaryProvider.js");
loadBrowserScript("src/tokenizer/kuromojiTokenMapper.js");

const { katakanaToHiragana, mapKuromojiTokens } = window.FadingFuriganaKuromojiMapper;

function rawToken(overrides = {}) {
  return {
    word_type: "KNOWN",
    word_position: 1,
    surface_form: "確認",
    pos: "名詞",
    pos_detail_1: "サ変接続",
    pos_detail_2: "*",
    pos_detail_3: "*",
    conjugated_type: "*",
    conjugated_form: "*",
    basic_form: "確認",
    reading: "カクニン",
    pronunciation: "カクニン",
    ...overrides
  };
}

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test("converts katakana readings to hiragana", () => {
  assert.equal(katakanaToHiragana("カクニン"), "かくにん");
  assert.equal(katakanaToHiragana("タベタ"), "たべた");
  assert.equal(katakanaToHiragana("サーバー"), "さーばー");
});

test("maps kanji tokens with readings and offsets", () => {
  const text = "内容を確認した";
  const tokens = mapKuromojiTokens(text, [
    rawToken({ surface_form: "内容", basic_form: "内容", reading: "ナイヨウ", word_position: 1 }),
    rawToken({ surface_form: "を", pos: "助詞", basic_form: "を", reading: "ヲ", word_position: 3 }),
    rawToken({ surface_form: "確認", word_position: 4 }),
    rawToken({
      surface_form: "し",
      pos: "動詞",
      pos_detail_1: "自立",
      basic_form: "する",
      reading: "シ",
      word_position: 6
    }),
    rawToken({ surface_form: "た", pos: "助動詞", basic_form: "た", reading: "タ", word_position: 7 })
  ]);

  assert.deepEqual(tokens.map((token) => token.surface), ["内容", "確認"]);
  assert.equal(tokens[0].readingKana, "ないよう");
  assert.equal(tokens[0].start, 0);
  assert.equal(tokens[0].end, 2);
  assert.equal(tokens[1].start, 3);
  assert.equal(tokens[1].lexicalItemId, "確認:かくにん");
  assert.equal(tokens[1].source.provider, "kuromoji");
});

test("maps inflected verbs to their base form", () => {
  const text = "寿司を食べた";
  const tokens = mapKuromojiTokens(text, [
    rawToken({ surface_form: "寿司", basic_form: "寿司", reading: "スシ", word_position: 1 }),
    rawToken({ surface_form: "を", pos: "助詞", basic_form: "を", reading: "ヲ", word_position: 3 }),
    rawToken({
      surface_form: "食べ",
      pos: "動詞",
      pos_detail_1: "自立",
      conjugated_type: "一段",
      conjugated_form: "連用形",
      basic_form: "食べる",
      reading: "タベ",
      word_position: 4
    })
  ]);
  const verb = tokens.find((token) => token.surface === "食べ");

  assert.equal(verb.baseForm, "食べる");
  assert.equal(verb.readingKana, "たべ");
  assert.equal(verb.conjugation.type, "一段");
});

test("overrides counter readings after digits using shared rules", () => {
  // IPADIC reads 4月 as ツキ; the mapper must apply がつ instead.
  const text = "2024年4月";
  const tokens = mapKuromojiTokens(text, [
    rawToken({ surface_form: "2024", pos: "名詞", pos_detail_1: "数", basic_form: "*", reading: undefined, word_position: 1 }),
    rawToken({ surface_form: "年", pos: "名詞", pos_detail_1: "接尾", basic_form: "年", reading: "ネン", word_position: 5 }),
    rawToken({ surface_form: "4", pos: "名詞", pos_detail_1: "数", basic_form: "*", reading: undefined, word_position: 6 }),
    rawToken({ surface_form: "月", pos: "名詞", pos_detail_1: "一般", basic_form: "月", reading: "ツキ", word_position: 7 })
  ]);

  assert.deepEqual(
    tokens.map((token) => [token.surface, token.readingKana]),
    [["年", "ねん"], ["月", "がつ"]]
  );
  assert.equal(tokens[0].source.provider, "counter_rule");
});

test("drops irregular counters after digits", () => {
  const text = "10日かかる";
  const tokens = mapKuromojiTokens(text, [
    rawToken({ surface_form: "10", pos: "名詞", pos_detail_1: "数", basic_form: "*", reading: undefined, word_position: 1 }),
    rawToken({ surface_form: "日", pos: "名詞", pos_detail_1: "接尾", basic_form: "日", reading: "ニチ", word_position: 3 })
  ]);

  assert.equal(tokens.length, 0);
});

test("keeps katakana words and skips kana-only and unknown-reading tokens", () => {
  const text = "ニュースを読むくらい";
  const tokens = mapKuromojiTokens(text, [
    rawToken({ surface_form: "ニュース", basic_form: "ニュース", reading: "ニュース", word_position: 1 }),
    rawToken({ surface_form: "を", pos: "助詞", basic_form: "を", reading: "ヲ", word_position: 5 }),
    rawToken({
      surface_form: "読む",
      pos: "動詞",
      pos_detail_1: "自立",
      basic_form: "読む",
      reading: "ヨム",
      word_position: 6
    }),
    rawToken({ surface_form: "くらい", basic_form: "くらい", reading: "クライ", word_position: 8 })
  ]);

  assert.deepEqual(tokens.map((token) => token.surface), ["ニュース", "読む"]);
  assert.equal(tokens[0].isKatakanaWord, true);
  assert.equal(tokens[0].lexicalType, "loanword");
  assert.equal(tokens[0].readingKana, "ニュース");
});

test("integration: maps real kuromoji output for problem sentences", async () => {
  let kuromoji;
  try {
    kuromoji = require("kuromoji");
  } catch {
    console.log("  (kuromoji not installed; skipping integration test)");
    return;
  }

  const tokenizer = await new Promise((resolve, reject) => {
    kuromoji
      .builder({ dicPath: path.join(rootDir, "src", "tokenizer", "dict") })
      .build((error, built) => (error ? reject(error) : resolve(built)));
  });

  const analyze = (text) => mapKuromojiTokens(text, tokenizer.tokenize(text));

  const business = analyze("来月10日本社で会議");
  assert.deepEqual(
    business.map((token) => [token.surface, token.readingKana]),
    [["来月", "らいげつ"], ["本社", "ほんしゃ"], ["会議", "かいぎ"]]
  );

  const dates = analyze("日本の経済は2024年4月に回復した。");
  assert.equal(dates.find((token) => token.surface === "日本").readingKana, "にっぽん");
  assert.equal(dates.find((token) => token.surface === "年").readingKana, "ねん");
  assert.equal(dates.find((token) => token.surface === "月").readingKana, "がつ");

  const inflected = analyze("寿司を食べた");
  const verb = inflected.find((token) => token.surface === "食べ");
  assert.equal(verb.baseForm, "食べる");
  assert.equal(verb.readingKana, "たべ");
});

(async () => {
  for (const { name, fn } of tests) {
    await runTest(name, fn);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
