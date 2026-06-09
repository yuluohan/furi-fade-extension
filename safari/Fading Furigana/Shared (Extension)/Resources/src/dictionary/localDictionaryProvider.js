(() => {
  "use strict";

  const DEFAULT_LOCAL_DICTIONARY = [
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

  function createId(...parts) {
    return window.FadingFuriganaState.createId(...parts);
  }

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

  class LocalDictionaryProvider {
    constructor(entries = DEFAULT_LOCAL_DICTIONARY) {
      this.entries = entries.map((entry) => this.normalizeEntry(entry));
      this.bySurface = new Map();

      for (const entry of this.entries) {
        const existing = this.bySurface.get(entry.surface);
        if (!existing || entry.surface.length > existing.surface.length) {
          this.bySurface.set(entry.surface, entry);
        }
      }

      this.surfaces = [...this.bySurface.keys()].sort((a, b) => b.length - a.length);
    }

    normalizeEntry(entry) {
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

    findLongestAt(text, index) {
      for (const surface of this.surfaces) {
        if (text.startsWith(surface, index)) {
          return this.bySurface.get(surface);
        }
      }
      return null;
    }
  }

  class JapaneseAnalyzer {
    constructor(dictionaryProvider) {
      this.dictionaryProvider = dictionaryProvider;
    }

    analyze(text) {
      const tokens = [];
      let index = 0;

      while (index < text.length) {
        const entry = this.dictionaryProvider.findLongestAt(text, index);
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
    createScriptProfile
  };
})();
