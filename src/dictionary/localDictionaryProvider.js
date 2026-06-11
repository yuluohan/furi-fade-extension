(() => {
  "use strict";

  const SAMPLE_DICTIONARY_OVERRIDES = [
    {
      surface: "確認",
      baseForm: "確認",
      reading: "かくにん",
      meanings: {
        en: ["confirmation", "check"],
        zhHans: ["确认", "核对"],
        ja: ["確かめること"]
      },
      partOfSpeech: ["noun", "suru-verb"]
    },
    {
      surface: "申請",
      baseForm: "申請",
      reading: "しんせい",
      meanings: {
        en: ["application", "request"],
        zhHans: ["申请", "请求"],
        ja: ["申し込むこと"]
      },
      partOfSpeech: ["noun", "suru-verb"]
    },
    {
      surface: "影響",
      baseForm: "影響",
      reading: "えいきょう",
      meanings: {
        en: ["influence", "effect"],
        zhHans: ["影响"],
        ja: ["他に作用を及ぼすこと"]
      },
      partOfSpeech: ["noun"]
    },
    {
      surface: "状態",
      baseForm: "状態",
      reading: "じょうたい",
      meanings: {
        en: ["state", "condition"],
        zhHans: ["状态", "情况"],
        ja: ["ものごとのありさま"]
      },
      partOfSpeech: ["noun"]
    },
    {
      surface: "食べる",
      baseForm: "食べる",
      reading: "たべる",
      meanings: {
        en: ["to eat"],
        zhHans: ["吃"],
        ja: ["食物を口に入れて飲み込む"]
      },
      partOfSpeech: ["verb", "ichidan"]
    },
    {
      surface: "本",
      baseForm: "本",
      reading: "ほん",
      meanings: {
        en: ["book", "volume"],
        zhHans: ["书", "书籍"],
        ja: ["書物"]
      },
      partOfSpeech: ["noun"],
      source: {
        provider: "curated",
        confidence: 0.95
      }
    },
    {
      surface: "サーバー",
      baseForm: "サーバー",
      reading: "サーバー",
      meanings: {
        en: ["server"],
        zhHans: ["服务器"],
        ja: ["ネットワーク上でサービスを提供するコンピューター"]
      },
      partOfSpeech: ["loanword", "noun"],
      loanword: {
        isLoanword: true,
        originLanguage: "en",
        originalForm: "server",
        confidence: 0.9
      }
    }
  ];

  const DEFAULT_LOCAL_DICTIONARY = [
    ...((window.FadingFuriganaJmdictData && window.FadingFuriganaJmdictData.entries) || []),
    ...SAMPLE_DICTIONARY_OVERRIDES
  ];

  function createId(...parts) {
    return window.FadingFuriganaState.createId(...parts);
  }

  const DIGIT_RE = /[0-9０-９]/;

  // A digit followed by one of these kanji almost always reads as a counter,
  // so multi-character dictionary matches starting with one (e.g. 日本 inside
  // 10日本社) are rejected unless the surface is a known counter compound.
  const DATE_COUNTER_HEADS = new Set(["年", "月", "日", "時", "分", "秒", "週"]);
  const COUNTER_COMPOUND_SURFACES = new Set([
    "年度",
    "年代",
    "年間",
    "年生",
    "年目",
    "月間",
    "月目",
    "週間",
    "週目",
    "日間",
    "日目",
    "時間",
    "時半",
    "分間",
    "秒間"
  ]);

  // Counters whose reading after a digit is stable enough to annotate.
  // Irregular ones (日: ついたち/ふつか…, 分: ふん/ぷん, 本: ほん/ぼん/ぽん)
  // are deliberately absent: after a digit they are skipped instead of
  // annotated with a wrong standalone-noun reading.
  const COUNTER_READING_RULES = [
    { surface: "年", reading: "ねん", meanings: { en: ["year (counter)"], zhHans: ["…年"] } },
    { surface: "月", reading: "がつ", meanings: { en: ["month of the year"], zhHans: ["…月"] } },
    { surface: "時", reading: "じ", meanings: { en: ["o'clock"], zhHans: ["…点"] } },
    { surface: "円", reading: "えん", meanings: { en: ["yen"], zhHans: ["日元"] } },
    { surface: "回", reading: "かい", meanings: { en: ["counter for occurrences"], zhHans: ["…次"] } },
    { surface: "個", reading: "こ", meanings: { en: ["counter for items"], zhHans: ["…个"] } },
    { surface: "歳", reading: "さい", meanings: { en: ["years old"], zhHans: ["…岁"] } },
    { surface: "台", reading: "だい", meanings: { en: ["counter for machines and vehicles"], zhHans: ["…台"] } },
    { surface: "番", reading: "ばん", meanings: { en: ["number in a series"], zhHans: ["…号"] } },
    {
      surface: "人",
      reading: "にん",
      meanings: { en: ["counter for people"], zhHans: ["…人"] },
      // 1人/2人 read ひとり/ふたり; 11人/21人 etc. still read にん.
      singleDigitExceptions: ["1", "2", "１", "２"]
    }
  ];

  function hasKanji(text) {
    return /[\u3400-\u9fff]/.test(text);
  }

  function createScriptProfile(text) {
    return {
      hasKanji: hasKanji(text),
      hasHiragana: /[\u3040-\u309f]/.test(text),
      hasKatakana: /[\u30a0-\u30ff]/.test(text),
      hasLatin: /[a-z]/i.test(text)
    };
  }

  function isJapaneseCharacter(character) {
    return /[\u3040-\u30ff\u3400-\u9fff]/.test(character || "");
  }

  function isLikelyParticle(character) {
    return /[はがをにへとでのもやかねよぞ]/.test(character || "");
  }

  function isSingleKanjiInsideJapaneseText(entry, text, index) {
    if (!entry || entry.surface.length !== 1 || !entry.scriptProfile.hasKanji) return false;
    const previous = text[index - 1];
    const next = text[index + 1];
    return (
      (isJapaneseCharacter(previous) && !isLikelyParticle(previous)) ||
      (isJapaneseCharacter(next) && !isLikelyParticle(next))
    );
  }

  function normalizeDictionaryEntry(entry) {
    const baseForm = entry.baseForm || entry.lemma || entry.surface;
    const reading = entry.reading || entry.readingKana || entry.surface;
    const lexicalItemId = entry.lexicalItemId || entry.id || createId(baseForm, reading);
    const scriptProfile = entry.scriptProfile || createScriptProfile(entry.surface);
    const isKatakanaWord = scriptProfile.hasKatakana && !scriptProfile.hasKanji && !scriptProfile.hasHiragana;
    const loanword = entry.loanword || {
      isLoanword: isKatakanaWord,
      originLanguage: undefined,
      originalForm: undefined,
      confidence: isKatakanaWord ? 0.3 : undefined
    };

    return {
      ...entry,
      id: lexicalItemId,
      lexicalItemId,
      baseForm,
      lemma: baseForm,
      reading,
      readingKana: reading,
      baseReadingKana: entry.baseReadingKana || reading,
      lexicalType: entry.lexicalType || (loanword.isLoanword ? "loanword" : "word"),
      scriptProfile,
      loanword,
      source: entry.source || {
        provider: "local",
        confidence: 0.85
      }
    };
  }

  let counterEntriesAfterDigit = null;

  function getCounterEntriesAfterDigit() {
    if (!counterEntriesAfterDigit) {
      counterEntriesAfterDigit = new Map(
        COUNTER_READING_RULES.map((rule) => [
          rule.surface,
          {
            rule,
            entry: normalizeDictionaryEntry({
              surface: rule.surface,
              baseForm: rule.surface,
              reading: rule.reading,
              meanings: rule.meanings,
              partOfSpeech: ["counter"],
              source: { provider: "counter_rule", confidence: 0.9 }
            })
          }
        ])
      );
    }
    return counterEntriesAfterDigit;
  }

  function matchCounterAfterDigit(text, index) {
    const match = getCounterEntriesAfterDigit().get(text[index]);
    if (!match) return null;

    const digit = text[index - 1] || "";
    const beforeDigit = text[index - 2] || "";
    if (match.rule.singleDigitExceptions?.includes(digit) && !DIGIT_RE.test(beforeDigit)) return null;
    return match.entry;
  }

  function isDisallowedAfterDigit(surface) {
    // Single characters after a digit read as counters; the counter rules
    // decide whether they are safe to annotate.
    if (surface.length === 1) return hasKanji(surface);
    return DATE_COUNTER_HEADS.has(surface[0]) && !COUNTER_COMPOUND_SURFACES.has(surface);
  }

  function createDefaultSegmenter() {
    if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") return null;
    try {
      return new Intl.Segmenter("ja", { granularity: "word" });
    } catch {
      return null;
    }
  }

  function collectWordBoundaries(text, segmenter) {
    if (!segmenter) return null;

    const boundaries = new Set([0, text.length]);
    for (const segment of segmenter.segment(text)) {
      boundaries.add(segment.index);
    }
    return boundaries;
  }

  class LocalDictionaryProvider {
    constructor(entries = DEFAULT_LOCAL_DICTIONARY) {
      this.entries = entries.map((entry) => this.normalizeEntry(entry));
      this.bySurface = new Map();
      this.surfacesByFirstCharacter = new Map();

      for (const entry of this.entries) {
        this.bySurface.set(entry.surface, entry);
      }

      this.surfaces = [...this.bySurface.keys()].sort((a, b) => b.length - a.length);
      for (const surface of this.surfaces) {
        const firstCharacter = surface[0];
        const surfaces = this.surfacesByFirstCharacter.get(firstCharacter) || [];
        surfaces.push(surface);
        this.surfacesByFirstCharacter.set(firstCharacter, surfaces);
      }
    }

    normalizeEntry(entry) {
      return normalizeDictionaryEntry(entry);
    }

    findLongestAt(text, index, { boundaries = null, precededByDigit = false } = {}) {
      const candidates = this.surfacesByFirstCharacter.get(text[index]) || [];
      for (const surface of candidates) {
        if (boundaries && !boundaries.has(index + surface.length)) continue;
        if (precededByDigit && isDisallowedAfterDigit(surface)) continue;
        if (text.startsWith(surface, index)) {
          const entry = this.bySurface.get(surface);
          if (isSingleKanjiInsideJapaneseText(entry, text, index)) continue;
          return entry;
        }
      }
      return null;
    }
  }

  class JapaneseAnalyzer {
    constructor(dictionaryProvider, { segmenter = createDefaultSegmenter() } = {}) {
      this.dictionaryProvider = dictionaryProvider;
      this.segmenter = segmenter;
    }

    analyze(text) {
      const tokens = [];
      const boundaries = collectWordBoundaries(text, this.segmenter);
      let index = 0;

      while (index < text.length) {
        if (boundaries && !boundaries.has(index)) {
          index += 1;
          continue;
        }

        const precededByDigit = DIGIT_RE.test(text[index - 1] || "");
        const entry =
          this.dictionaryProvider.findLongestAt(text, index, { boundaries, precededByDigit }) ||
          (precededByDigit ? matchCounterAfterDigit(text, index) : null);
        if (!entry) {
          index += 1;
          continue;
        }

        tokens.push({
          ...entry,
          start: index,
          end: index + entry.surface.length,
          isKanjiWord: entry.scriptProfile.hasKanji,
          isKatakanaWord: entry.scriptProfile.hasKatakana
        });
        index += entry.surface.length;
      }

      return tokens;
    }
  }

  window.FadingFuriganaDictionary = {
    DEFAULT_LOCAL_DICTIONARY,
    JapaneseAnalyzer,
    LocalDictionaryProvider,
    SAMPLE_DICTIONARY_OVERRIDES,
    collectWordBoundaries,
    createDefaultSegmenter,
    createScriptProfile,
    isSingleKanjiInsideJapaneseText,
    matchCounterAfterDigit,
    normalizeDictionaryEntry
  };
})();
