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
loadBrowserScript("src/dictionary/data/jmdictCommonData.js");
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

test("loads packaged JMdict priority tier entries by default", () => {
  const tokens = analyze("学校で言葉を勉強する。");
  const school = tokens.find((item) => item.surface === "学校");
  const language = tokens.find((item) => item.surface === "言葉");

  assert.equal(window.FadingFuriganaJmdictData.metadata.tier, "priority");
  assert.equal(window.FadingFuriganaJmdictData.metadata.entryCount > 20000, true);
  assert.equal(window.FadingFuriganaJmdictData.metadata.tiers.priority.eager, true);
  assert.equal(school.source.provider, "jmdict");
  assert.equal(school.readingKana, "がっこう");
  assert.equal(school.meanings.en.includes("school"), true);
  assert.equal(language.source.provider, "jmdict");
});

test("keeps common compounds and verbs from splitting into single kanji", () => {
  const japanese = analyze("日本へ行く。");
  const japaneseLanguage = analyze("日本語を勉強する。");
  const book = analyze("本を読む。");

  assert.deepEqual(japanese.map((item) => item.surface), ["日本", "行く"]);
  assert.equal(japanese[0].readingKana, "にほん");
  assert.equal(japanese[1].readingKana, "いく");
  assert.deepEqual(japaneseLanguage.map((item) => item.surface), ["日本語", "勉強"]);
  assert.equal(book.find((item) => item.surface === "本").readingKana, "ほん");
  assert.equal(book.find((item) => item.surface === "読む").readingKana, "よむ");
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

test("constrains dictionary matches to word boundaries", () => {
  // ICU segments 来月10日本社 as 来月|10|日本|社; the date-counter guard must
  // still reject 日本 directly after the digits.
  const tokens = analyze("来月10日本社で会議");

  assert.equal(tokens.some((item) => item.surface === "日本"), false);
  assert.deepEqual(tokens.map((item) => item.surface), ["来月", "会議"]);
});

test("keeps real words that follow a complete date expression", () => {
  const tokens = analyze("15日日本政府は発表した");
  const japaneseGovernment = tokens.find((item) => item.surface === "日本政府");

  assert.equal(japaneseGovernment.readingKana, "にほんせいふ");
  assert.equal(tokens.some((item) => item.surface === "日"), false);
});

test("reads date counters with counter readings after digits", () => {
  const tokens = analyze("日本の経済は2024年4月に回復した。");
  const year = tokens.find((item) => item.surface === "年");
  const month = tokens.find((item) => item.surface === "月");

  assert.equal(tokens.find((item) => item.surface === "日本").readingKana, "にほん");
  assert.equal(year.readingKana, "ねん");
  assert.equal(year.lexicalItemId, "年:ねん");
  assert.equal(year.source.provider, "counter_rule");
  assert.equal(month.readingKana, "がつ");
});

test("keeps counter compounds after digits", () => {
  const hours = analyze("3時間かかった");
  const era = analyze("1980年代の音楽");

  assert.equal(hours.find((item) => item.surface === "時間").readingKana, "じかん");
  assert.equal(era.find((item) => item.surface === "年代").readingKana, "ねんだい");
});

test("skips counters with irregular readings after digits", () => {
  assert.equal(analyze("3日かかる").length, 0);
  assert.equal(analyze("9時30分に開始").some((item) => item.surface === "分"), false);
  assert.equal(analyze("1人で行く").some((item) => item.surface === "人"), false);
  assert.equal(analyze("2人で行く").some((item) => item.surface === "人"), false);
});

test("annotates regular people counts after digits", () => {
  assert.equal(analyze("3人で行く").find((item) => item.surface === "人").readingKana, "にん");
  assert.equal(analyze("21人が参加").find((item) => item.surface === "人").readingKana, "にん");
});

test("analyzes without Intl.Segmenter support", () => {
  const provider = new LocalDictionaryProvider();
  const analyzer = new JapaneseAnalyzer(provider, { segmenter: null });
  const tokens = analyzer.analyze("内容を確認する2024年");

  assert.equal(tokens.find((item) => item.surface === "確認").readingKana, "かくにん");
  assert.equal(tokens.find((item) => item.surface === "年").readingKana, "ねん");
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
