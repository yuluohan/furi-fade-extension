(() => {
  "use strict";

  const SCHEMA_VERSION = 1;

  const DEFAULT_APP_SETTINGS = {
    annotation: {
      enabled: true,
      mode: "adaptive",
      hideKnownItems: true,
      showRuby: true,
      showLoanwordOrigins: true,
      showMeaningsInTooltip: true
    },
    exposureTracking: {
      enabled: true,
      saveUrls: "domain_only",
      retentionDays: 90
    },
    dictionary: {
      mode: "sample"
    }
  };

  const DEFAULT_USER_PROFILE = {
    targetLanguage: "ja",
    nativeLanguages: ["zhHans"],
    preferredMeaningLanguages: ["zhHans", "en", "ja"]
  };

  function createTimestamp() {
    return new Date().toISOString();
  }

  function createId(...parts) {
    return parts
      .join(":")
      .normalize("NFKC")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase();
  }

  function getLocalDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createDefaultAppState(now = createTimestamp()) {
    return {
      schemaVersion: SCHEMA_VERSION,
      userProfile: clone(DEFAULT_USER_PROFILE),
      settings: clone(DEFAULT_APP_SETTINGS),
      lexicalItems: {},
      userLexicalStates: {},
      sourceOccurrences: {},
      dailyExposureSummaries: {},
      reviewLogs: {},
      metadata: {
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: now
      }
    };
  }

  function normalizeSettings(settings = {}) {
    const legacyMode = settings.annotationMode;
    const annotation = settings.annotation || {};
    const exposureTracking = settings.exposureTracking || {};
    const dictionary = settings.dictionary || {};

    return {
      annotation: {
        ...clone(DEFAULT_APP_SETTINGS.annotation),
        ...annotation,
        enabled: annotation.enabled ?? settings.enabled ?? DEFAULT_APP_SETTINGS.annotation.enabled,
        mode: annotation.mode || mapLegacyAnnotationMode(legacyMode),
        hideKnownItems:
          annotation.hideKnownItems ?? settings.hideMasteredWords ?? DEFAULT_APP_SETTINGS.annotation.hideKnownItems
      },
      exposureTracking: {
        ...clone(DEFAULT_APP_SETTINGS.exposureTracking),
        ...exposureTracking
      },
      dictionary: {
        ...clone(DEFAULT_APP_SETTINGS.dictionary),
        ...dictionary
      }
    };
  }

  function mapLegacyAnnotationMode(mode) {
    if (mode === "all_kanji_words") return "all_items";
    if (mode === "unknown_words_only") return "unknown_items_only";
    if (mode === "saved_words_only") return "saved_items_only";
    if (mode === "off") return "off";
    return DEFAULT_APP_SETTINGS.annotation.mode;
  }

  function normalizeScriptProfile(value = {}) {
    return {
      hasKanji: !!value.hasKanji,
      hasHiragana: !!value.hasHiragana,
      hasKatakana: !!value.hasKatakana,
      hasLatin: !!value.hasLatin
    };
  }

  function createLexicalItemFromToken(token, existingItem = null, now = createTimestamp()) {
    const meanings = token.meanings || {};
    if (token.meaningEn && !meanings.en) meanings.en = [token.meaningEn];

    return {
      id: token.lexicalItemId || token.id,
      surface: token.surface,
      lemma: token.lemma || token.baseForm || token.surface,
      readingKana: token.readingKana || token.reading,
      baseReadingKana: token.baseReadingKana || token.readingKana || token.reading,
      lexicalType: token.lexicalType || (token.isKatakanaWord ? "loanword" : "word"),
      scriptProfile: normalizeScriptProfile(token.scriptProfile || {
        hasKanji: !!token.isKanjiWord,
        hasHiragana: /[\u3040-\u309f]/.test(token.surface),
        hasKatakana: !!token.isKatakanaWord,
        hasLatin: /[a-z]/i.test(token.surface)
      }),
      partOfSpeech: Array.isArray(token.partOfSpeech) ? token.partOfSpeech : [token.partOfSpeech || "unknown"],
      meanings,
      conjugation: token.conjugation,
      loanword: token.loanword || {
        isLoanword: !!token.isKatakanaWord,
        originLanguage: token.loanwordOriginLanguage,
        originalForm: token.loanwordOriginalForm,
        confidence: token.loanwordConfidence
      },
      difficulty: token.difficulty,
      source: token.source || {
        provider: "sample",
        confidence: 1
      },
      createdAt: existingItem?.createdAt || now,
      updatedAt: now
    };
  }

  function createDefaultUserLexicalState(lexicalItemId, now = createTimestamp()) {
    return {
      lexicalItemId,
      lifecycleStatus: "discovered",
      knowledgeConfidence: 0,
      annotationLevel: "full_ruby",
      userIntent: {
        saved: false,
        ignored: false,
        manuallyMarkedKnown: false,
        manuallyMarkedUnknown: false
      },
      exposure: {
        seenCount: 0,
        uniquePageCount: 0,
        uniqueSentenceCount: 0,
        firstSeenAt: now,
        lastSeenAt: now
      },
      interaction: {
        tooltipOpenCount: 0,
        savedCount: 0,
        markedKnownCount: 0,
        ignoredCount: 0,
        lastActionAt: undefined
      },
      learning: {
        reviewStage: "new",
        reviewCount: 0,
        correctCount: 0,
        wrongCount: 0,
        correctStreak: 0,
        lastReviewedAt: undefined,
        nextReviewAt: undefined,
        ease: undefined
      },
      intelligence: {
        inferredDifficulty: undefined,
        confidenceKnown: 0,
        confidenceNeedsHelp: 1,
        reasonCodes: []
      }
    };
  }

  function migrateLegacyState(parsed, now = createTimestamp()) {
    const state = createDefaultAppState(now);
    state.settings = normalizeSettings(parsed.settings);

    for (const [wordId, word] of Object.entries(parsed.words || {})) {
      state.lexicalItems[wordId] = createLexicalItemFromToken({
        id: word.id || wordId,
        lexicalItemId: word.id || wordId,
        surface: word.surface,
        baseForm: word.baseForm,
        reading: word.reading,
        meaningEn: word.meaningEn,
        partOfSpeech: word.partOfSpeech,
        isKanjiWord: word.isKanjiWord,
        isKatakanaWord: word.isKatakanaWord
      }, null, word.updatedAt || now);
    }

    for (const [wordId, userState] of Object.entries(parsed.userWordStates || {})) {
      const migrated = createDefaultUserLexicalState(wordId, userState.lastSeenAt || now);
      migrated.lifecycleStatus = mapLegacyStatus(userState.status);
      migrated.knowledgeConfidence = userState.status === "mastered" ? 1 : 0;
      migrated.annotationLevel = mapLegacyAnnotationLevel(userState.annotationLevel);
      migrated.userIntent.saved = (userState.savedCount || 0) > 0 || userState.status === "learning";
      migrated.userIntent.ignored = userState.status === "ignored";
      migrated.userIntent.manuallyMarkedKnown = userState.status === "mastered";
      migrated.exposure.seenCount = userState.seenCount || 0;
      migrated.exposure.firstSeenAt = userState.firstSeenAt;
      migrated.exposure.lastSeenAt = userState.lastSeenAt;
      migrated.interaction.savedCount = userState.savedCount || 0;
      migrated.interaction.markedKnownCount = userState.status === "mastered" ? 1 : 0;
      migrated.interaction.ignoredCount = userState.status === "ignored" ? 1 : 0;
      migrated.learning.reviewCount = userState.reviewCount || 0;
      migrated.learning.correctCount = userState.correctCount || 0;
      migrated.learning.wrongCount = userState.wrongCount || 0;
      migrated.learning.correctStreak = userState.correctStreak || 0;
      migrated.learning.lastReviewedAt = userState.lastReviewedAt;
      migrated.learning.nextReviewAt = userState.nextReviewAt;
      state.userLexicalStates[wordId] = migrated;
    }

    for (const [sentenceId, sentence] of Object.entries(parsed.sourceSentences || {})) {
      state.sourceOccurrences[sentenceId] = {
        id: sentence.id || sentenceId,
        lexicalItemId: sentence.wordId,
        surface: state.lexicalItems[sentence.wordId]?.surface || "",
        sentence: sentence.sentence,
        url: sentence.url,
        domain: getDomain(sentence.url),
        pageTitle: sentence.pageTitle,
        createdAt: sentence.createdAt || now
      };
    }

    state.reviewLogs = parsed.reviewLogs || {};
    state.metadata.updatedAt = now;
    state.metadata.lastOpenedAt = now;
    return state;
  }

  function mapLegacyStatus(status) {
    if (status === "new") return "discovered";
    if (status === "learning") return "learning";
    if (status === "reviewing") return "reviewing";
    if (status === "mastered") return "mastered";
    if (status === "ignored") return "ignored";
    return "discovered";
  }

  function mapLegacyAnnotationLevel(level) {
    if (level === "hidden") return "hidden";
    if (level === "tap_only") return "tap_only";
    return "full_ruby";
  }

  function getDomain(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return undefined;
    }
  }

  function migrateAppState(parsed) {
    const now = createTimestamp();
    if (!parsed || typeof parsed !== "object") return createDefaultAppState(now);
    if (parsed.schemaVersion !== SCHEMA_VERSION) return migrateLegacyState(parsed, now);

    return {
      ...createDefaultAppState(now),
      ...parsed,
      userProfile: {
        ...clone(DEFAULT_USER_PROFILE),
        ...parsed.userProfile
      },
      settings: normalizeSettings(parsed.settings),
      metadata: {
        ...createDefaultAppState(now).metadata,
        ...parsed.metadata,
        updatedAt: parsed.metadata?.updatedAt || now,
        lastOpenedAt: now
      }
    };
  }

  window.FadingFuriganaState = {
    SCHEMA_VERSION,
    DEFAULT_APP_SETTINGS,
    DEFAULT_USER_PROFILE,
    createDefaultAppState,
    createDefaultUserLexicalState,
    createId,
    createLexicalItemFromToken,
    createTimestamp,
    getLocalDateKey,
    migrateAppState,
    normalizeSettings
  };
})();
