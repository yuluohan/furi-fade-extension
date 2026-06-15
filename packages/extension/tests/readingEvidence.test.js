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
loadBrowserScript("src/core/readingEvidence.js");

const {
  createEvidenceAwareAnalyzer,
  findInlineReadingRanges,
  findSupportedInlineReadingRanges,
  isInlineReadingSupportedByTokens,
  isTokenCoveredByInlineReading,
  suppressTokensCoveredByInlineReadings
} = window.FadingFuriganaReadingEvidence;

function createToken(overrides = {}) {
  return {
    lexicalItemId: "確認:かくにん",
    surface: "確認",
    readingKana: "かくにん",
    start: 0,
    end: 2,
    ...overrides
  };
}

test("detects page-provided parenthetical kana readings", () => {
  const text = "石質隕石（せきしついんせき）を確認します。";
  const ranges = findInlineReadingRanges(text);

  assert.equal(ranges.length, 1);
  assert.deepEqual(ranges[0], {
    start: 0,
    end: 4,
    reading: "せきしついんせき",
    source: "inline_parenthetical"
  });
  assert.equal(isTokenCoveredByInlineReading({ start: 0, end: 2 }, ranges), true);
  assert.equal(isTokenCoveredByInlineReading({ start: text.indexOf("確認"), end: text.indexOf("確認") + 2 }, ranges), false);
});

test("ignores non-kana parenthetical translations", () => {
  assert.equal(findInlineReadingRanges("日本（Japan）を確認します。").length, 0);
});

test("trims unrelated kana before page-provided readings", () => {
  const text = "詳しくは石質隕石（せきしついんせき）を確認します。";
  const ranges = findInlineReadingRanges(text);

  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].start, text.indexOf("石質隕石"));
  assert.equal(ranges[0].end, text.indexOf("石質隕石") + "石質隕石".length);
  assert.equal(isTokenCoveredByInlineReading({ start: 0, end: "詳しく".length }, ranges), false);
});

test("suppresses tokenizer tokens covered by page-provided readings", () => {
  const text = "石質隕石（せきしついんせき）を確認します。";
  const confirmStart = text.indexOf("確認");
  const tokens = [
    createToken({
      lexicalItemId: "石質:いししつ",
      surface: "石質",
      readingKana: "いししつ",
      start: 0,
      end: 2
    }),
    createToken({
      lexicalItemId: "隕石:いんせき",
      surface: "隕石",
      readingKana: "いんせき",
      start: 2,
      end: 4
    }),
    createToken({
      start: confirmStart,
      end: confirmStart + 2
    })
  ];

  assert.deepEqual(
    suppressTokensCoveredByInlineReadings(text, tokens).map((token) => token.surface),
    ["確認"]
  );
  assert.equal(findSupportedInlineReadingRanges(text, tokens).length, 1);
  assert.equal(isInlineReadingSupportedByTokens(findInlineReadingRanges(text)[0], tokens), true);
});

test("does not suppress kana-only parenthetical notes without token-reading support", () => {
  const text = "石質隕石（これはめずらしい）を確認します。";
  const tokens = [
    createToken({
      lexicalItemId: "石質:いししつ",
      surface: "石質",
      readingKana: "いししつ",
      start: 0,
      end: 2
    }),
    createToken({
      lexicalItemId: "隕石:いんせき",
      surface: "隕石",
      readingKana: "いんせき",
      start: 2,
      end: 4
    })
  ];

  assert.equal(findInlineReadingRanges(text).length, 1);
  assert.equal(findSupportedInlineReadingRanges(text, tokens).length, 0);
  assert.deepEqual(suppressTokensCoveredByInlineReadings(text, tokens), tokens);
});

test("supports half-width parenthetical kana readings", () => {
  const text = "石質隕石(せきしついんせき)を確認します。";
  const tokens = [
    createToken({
      lexicalItemId: "石質:いししつ",
      surface: "石質",
      readingKana: "いししつ",
      start: 0,
      end: 2
    })
  ];

  assert.equal(suppressTokensCoveredByInlineReadings(text, tokens).length, 0);
});

test("wraps sync analyzers before tokens reach annotation", () => {
  const analyzer = createEvidenceAwareAnalyzer({
    analyze() {
      return [
        createToken({
          lexicalItemId: "石質:いししつ",
          surface: "石質",
          readingKana: "いししつ",
          start: 0,
          end: 2
        })
      ];
    }
  });

  assert.equal(analyzer.analyze("石質隕石（せきしついんせき）").length, 0);
});

test("wraps batch analyzers before tokens reach annotation", async () => {
  const analyzer = createEvidenceAwareAnalyzer({
    async analyzeBatch() {
      return [
        [
          createToken({
            lexicalItemId: "石質:いししつ",
            surface: "石質",
            readingKana: "いししつ",
            start: 0,
            end: 2
          })
        ],
        [createToken()]
      ];
    }
  });

  const results = await analyzer.analyzeBatch(["石質隕石（せきしついんせき）", "確認します。"]);
  assert.deepEqual(results.map((tokens) => tokens.map((token) => token.surface)), [[], ["確認"]]);
});

runTests().catch(() => {
  process.exitCode = 1;
});
