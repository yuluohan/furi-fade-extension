const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "..");

function loadBrowserScript(relativePath) {
  const filePath = path.join(rootDir, relativePath);
  vm.runInThisContext(fs.readFileSync(filePath, "utf8"), { filename: filePath });
}

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

async function runTests() {
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`[pass] ${name}`);
    } catch (error) {
      console.error(`[fail] ${name}`);
      throw error;
    }
  }
}

global.window = global;
loadBrowserScript("src/core/appState.js");
loadBrowserScript("src/dictionary/data/jmdictCommonData.js");
loadBrowserScript("src/dictionary/localDictionaryProvider.js");
loadBrowserScript("src/dictionary/backgroundTokenizerClient.js");

const { BackgroundTokenizerAnalyzer } = window.FadingFuriganaBackgroundTokenizer;

function createAnalyzer(results) {
  const localProvider = new window.FadingFuriganaDictionary.LocalDictionaryProvider();
  const fallbackAnalyzer = new window.FadingFuriganaDictionary.JapaneseAnalyzer(localProvider, { segmenter: null });
  return new BackgroundTokenizerAnalyzer({
    localProvider,
    fallbackAnalyzer,
    messenger: async () => ({ ok: true, results })
  });
}

function createToken(overrides = {}) {
  return {
    lexicalItemId: "日本:にっぽん",
    surface: "日本",
    baseForm: "日本",
    reading: "にっぽん",
    readingKana: "にっぽん",
    start: 0,
    end: 2,
    meanings: {},
    loanword: {},
    source: {
      provider: "kuromoji",
      confidence: 0.9
    },
    ...overrides
  };
}

test("overlays known dictionary spans when tokenizer only returns fragments or gaps", async () => {
  const analyzer = createAnalyzer([[]]);
  const [tokens] = await analyzer.analyzeBatch(["石質隕石"]);

  assert.deepEqual(tokens.map((token) => [token.surface, token.readingKana]), [["隕石", "いんせき"]]);
  assert.equal(tokens[0].source.provider, "jmdict");
});

test("does not replace exact tokenizer spans just to change readings", async () => {
  const analyzer = createAnalyzer([[createToken()]]);
  const [tokens] = await analyzer.analyzeBatch(["日本"]);

  assert.deepEqual(tokens.map((token) => [token.surface, token.readingKana]), [["日本", "にっぽん"]]);
  assert.equal(tokens[0].meanings.en.includes("Japan"), true);
});

test("enriches inflected verbs with their dictionary-form reading and id", async () => {
  const analyzer = createAnalyzer([
    [
      createToken({
        lexicalItemId: "誤る:あやまっ",
        surface: "誤っ",
        baseForm: "誤る",
        lemma: "誤る",
        reading: "あやまっ",
        readingKana: "あやまっ",
        baseReadingKana: "あやまっ",
        start: 0,
        end: 2
      })
    ]
  ]);
  const [tokens] = await analyzer.analyzeBatch(["誤った表示"]);

  assert.equal(tokens[0].surface, "誤っ");
  assert.equal(tokens[0].readingKana, "あやまっ");
  assert.equal(tokens[0].baseForm, "誤る");
  assert.equal(tokens[0].baseReadingKana, "あやまる");
  assert.equal(tokens[0].lexicalItemId, "誤る:あやまる");
  assert.equal(tokens[0].meanings.en.includes("to make a mistake (in)"), true);
});

runTests().catch(() => {
  process.exitCode = 1;
});
