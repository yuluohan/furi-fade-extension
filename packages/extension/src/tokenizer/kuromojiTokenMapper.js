(() => {
  "use strict";

  const SKIP_POS = new Set(["助詞", "助動詞", "記号", "フィラー", "その他", "接続詞", "連体詞"]);
  const DIGIT_RE = /[0-9０-９]/;
  const KANJI_RE = /[\u3400-\u9fff]/;
  const KATAKANA_ONLY_RE = /^[\u30a1-\u30fa\u30fc]+$/;

  function katakanaToHiragana(text) {
    return String(text || "").replace(/[\u30a1-\u30f6]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0x60)
    );
  }

  function createId(...parts) {
    return window.FadingFuriganaState.createId(...parts);
  }

  function isJapaneseCharacter(character) {
    return /[\u3040-\u30ff\u3400-\u9fff]/.test(character || "");
  }

  function isLikelyParticle(character) {
    return /[はがをにへとでのもやかねよぞ]/.test(character || "");
  }

  function isSingleKanjiInsideJapaneseText(surface, text, start) {
    if (surface.length !== 1 || !KANJI_RE.test(surface)) return false;
    const previous = text[start - 1];
    const next = text[start + 1];
    return (
      (isJapaneseCharacter(previous) && !isLikelyParticle(previous)) ||
      (isJapaneseCharacter(next) && !isLikelyParticle(next))
    );
  }

  function mapKuromojiTokens(text, rawTokens) {
    const tokens = [];
    for (const raw of rawTokens || []) {
      const token = mapKuromojiToken(text, raw);
      if (token) tokens.push(token);
    }
    return tokens;
  }

  function mapKuromojiToken(text, raw) {
    const surface = raw?.surface_form || "";
    if (!surface.trim()) return null;
    if (SKIP_POS.has(raw.pos)) return null;
    if (raw.pos === "名詞" && raw.pos_detail_1 === "数") return null;

    const start = (raw.word_position || 1) - 1;
    const end = start + surface.length;

    // IPADIC misreads counters after digits (4月 → ツキ, 10日 → ニチ for とおか),
    // so the shared counter rules decide: safe table reading or no annotation.
    if (surface.length === 1 && DIGIT_RE.test(text[start - 1] || "")) {
      const counter = window.FadingFuriganaDictionary.matchCounterAfterDigit(text, start);
      if (!counter) return null;
      return { ...counter, start, end, isKanjiWord: true, isKatakanaWord: false };
    }

    if (isSingleKanjiInsideJapaneseText(surface, text, start)) return null;

    const baseForm = raw.basic_form && raw.basic_form !== "*" ? raw.basic_form : surface;
    const isKatakanaWord = KATAKANA_ONLY_RE.test(surface);

    if (isKatakanaWord) {
      if (surface.length < 2) return null;
      return buildToken({ raw, surface, baseForm, start, end, readingKana: surface, isKatakanaWord: true });
    }

    if (!KANJI_RE.test(surface)) return null;
    if (!raw.reading || raw.reading === "*") return null;

    return buildToken({
      raw,
      surface,
      baseForm,
      start,
      end,
      readingKana: katakanaToHiragana(raw.reading),
      isKatakanaWord: false
    });
  }

  function buildToken({ raw, surface, baseForm, start, end, readingKana, isKatakanaWord }) {
    const lexicalItemId = createId(baseForm, readingKana);
    const partOfSpeech = [raw.pos, raw.pos_detail_1, raw.pos_detail_2, raw.pos_detail_3].filter(
      (part) => part && part !== "*"
    );
    const scriptProfile = window.FadingFuriganaDictionary.createScriptProfile(surface);
    const hasConjugation = raw.conjugated_type && raw.conjugated_type !== "*";

    return {
      id: lexicalItemId,
      lexicalItemId,
      surface,
      lemma: baseForm,
      baseForm,
      reading: readingKana,
      readingKana,
      baseReadingKana: readingKana,
      meanings: {},
      partOfSpeech,
      lexicalType: isKatakanaWord ? "loanword" : "word",
      scriptProfile,
      loanword: {
        isLoanword: isKatakanaWord,
        originLanguage: undefined,
        originalForm: undefined,
        confidence: isKatakanaWord ? 0.3 : undefined
      },
      conjugation: hasConjugation ? { type: raw.conjugated_type, form: raw.conjugated_form } : undefined,
      source: {
        provider: "kuromoji",
        confidence: raw.word_type === "KNOWN" ? 0.9 : 0.4
      },
      start,
      end,
      isKanjiWord: scriptProfile.hasKanji,
      isKatakanaWord
    };
  }

  window.FadingFuriganaKuromojiMapper = {
    katakanaToHiragana,
    isSingleKanjiInsideJapaneseText,
    mapKuromojiToken,
    mapKuromojiTokens
  };
})();
