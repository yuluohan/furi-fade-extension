(() => {
  "use strict";

  const SCHEMA_VERSION = 1;

  const DEFAULT_APP_SETTINGS = {
    display: {
      interfaceLanguage: "en"
    },
    annotation: {
      enabled: true,
      mode: "adaptive",
      hideKnownItems: true,
      showRuby: true,
      showLoanwordOrigins: true,
      showMeaningsInTooltip: true,
      userLevel: "none",
      constrainedLayoutMode: "tap_only",
      useSmartContextDisplay: true,
      statusColors: {
        new: "#D98C00",
        learning: "#2F7DFF",
        lapsed: "#D64545",
        saved: "#7A5AF8",
        known: "#2FA36B",
        ignored: "#8A8A8A"
      }
    },
    exposureTracking: {
      enabled: true,
      saveUrls: "domain_only",
      retentionDays: 90
    },
    siteOverrides: {},
    dictionary: {
      mode: "sample"
    }
  };

  const DEFAULT_USER_PROFILE = {
    targetLanguage: "ja",
    nativeLanguages: ["zhHans"],
    preferredMeaningLanguages: ["zhHans", "en", "ja"]
  };

  const DEFAULT_ENTITLEMENT_PLATFORM = "browser-extension";
  const BASIC_PRODUCT_IDS = {
    "apple-macos": "com.banyuguru.fadingfurigana.basic.macos",
    "apple-ios": "com.banyuguru.fadingfurigana.basic.ios",
    "browser-extension": "com.banyuguru.fadingfurigana.basic.browser"
  };

  function createTimestamp() {
    return new Date().toISOString();
  }

  function createDeviceId() {
    const randomUUID = window.crypto?.randomUUID?.bind(window.crypto);
    if (randomUUID) return `dev_${randomUUID()}`;
    return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
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

  function addDaysIso(isoText, days) {
    const date = new Date(isoText);
    const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
    safeDate.setUTCDate(safeDate.getUTCDate() + days);
    return safeDate.toISOString();
  }

  function createDefaultEntitlements(now = createTimestamp(), platform = DEFAULT_ENTITLEMENT_PLATFORM) {
    const productId = BASIC_PRODUCT_IDS[platform] || BASIC_PRODUCT_IDS[DEFAULT_ENTITLEMENT_PLATFORM];

    return {
      schemaVersion: 1,
      platform,
      trial: {
        startedAt: now,
        expiresAt: addDaysIso(now, 31),
        source: "first_app_launch"
      },
      basic: {
        status: "not_purchased",
        productId,
        purchasedAt: null,
        lastVerifiedAt: null,
        verificationStatus: "not_checked"
      },
      pro: {
        status: "not_subscribed",
        productId: null,
        currentPeriodEndsAt: null,
        lastVerifiedAt: null
      },
      access: {
        tier: "trial",
        basicUnlocked: true,
        proUnlocked: false,
        computedAt: now
      }
    };
  }

  function normalizeEntitlements(entitlements = {}, now = createTimestamp(), platform = DEFAULT_ENTITLEMENT_PLATFORM) {
    const source = entitlements && typeof entitlements === "object" ? entitlements : {};
    const targetPlatform = source.platform || platform;
    const defaults = createDefaultEntitlements(now, targetPlatform);
    const normalized = {
      ...defaults,
      ...source,
      schemaVersion: 1,
      platform: targetPlatform,
      trial: {
        ...defaults.trial,
        ...(source.trial || {})
      },
      basic: {
        ...defaults.basic,
        ...(source.basic || {}),
        status: normalizeBasicStatus(source.basic?.status),
        verificationStatus: normalizeVerificationStatus(source.basic?.verificationStatus)
      },
      pro: {
        ...defaults.pro,
        ...(source.pro || {}),
        status: normalizeProStatus(source.pro?.status)
      }
    };

    if (source.developmentOverride) {
      normalized.developmentOverride = normalizeDevelopmentOverride(source.developmentOverride);
    }
    normalized.access = computeEntitlementAccess(normalized, now);
    return normalized;
  }

  function computeEntitlementAccess(entitlements = {}, now = createTimestamp()) {
    const override = normalizeDevelopmentOverride(entitlements.developmentOverride);
    if (override !== "none") {
      return accessForTier(override, now);
    }

    const proStatus = normalizeProStatus(entitlements.pro?.status);
    if (proStatus === "active" || proStatus === "grace_period") {
      return accessForTier("pro", now);
    }

    const basicStatus = normalizeBasicStatus(entitlements.basic?.status);
    if (basicStatus === "purchased") {
      return accessForTier("basic", now);
    }

    const trialExpiresAt = entitlements.trial?.expiresAt;
    if (trialExpiresAt && new Date(trialExpiresAt).getTime() > new Date(now).getTime()) {
      return accessForTier("trial", now);
    }

    return accessForTier("expired", now);
  }

  function accessForTier(tier, now) {
    return {
      tier,
      basicUnlocked: tier === "trial" || tier === "basic" || tier === "pro",
      proUnlocked: tier === "pro",
      computedAt: now
    };
  }

  function normalizeBasicStatus(status) {
    return ["not_purchased", "purchased", "refunded", "unknown"].includes(status) ? status : "not_purchased";
  }

  function normalizeVerificationStatus(status) {
    return ["not_checked", "verified", "failed_offline", "failed_invalid", "pending_restore"].includes(status)
      ? status
      : "not_checked";
  }

  function normalizeProStatus(status) {
    return ["not_subscribed", "active", "grace_period", "expired", "unknown"].includes(status)
      ? status
      : "not_subscribed";
  }

  function normalizeDevelopmentOverride(value) {
    return ["trial", "expired", "basic", "pro"].includes(value) ? value : "none";
  }

  function createDefaultAppState(now = createTimestamp()) {
    return {
      schemaVersion: SCHEMA_VERSION,
      userProfile: clone(DEFAULT_USER_PROFILE),
      settings: clone(DEFAULT_APP_SETTINGS),
      entitlements: createDefaultEntitlements(now),
      lexicalItems: {},
      userLexicalStates: {},
      sourceOccurrences: {},
      dailyExposureSummaries: {},
      reviewLogs: {},
      metadata: {
        deviceId: createDeviceId(),
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
    const siteOverrides = settings.siteOverrides || {};
    const dictionary = settings.dictionary || {};
    const display = settings.display || {};

    return {
      ...settings,
      display: {
        ...clone(DEFAULT_APP_SETTINGS.display),
        ...display,
        interfaceLanguage: normalizeInterfaceLanguage(
          display.interfaceLanguage || settings.interfaceLanguage || DEFAULT_APP_SETTINGS.display.interfaceLanguage
        )
      },
      annotation: {
        ...clone(DEFAULT_APP_SETTINGS.annotation),
        ...annotation,
        enabled: annotation.enabled ?? settings.enabled ?? DEFAULT_APP_SETTINGS.annotation.enabled,
        mode: annotation.mode || mapLegacyAnnotationMode(legacyMode),
        userLevel: normalizeUserLevel(annotation.userLevel || settings.userLevel),
        constrainedLayoutMode: normalizeConstrainedLayoutMode(annotation.constrainedLayoutMode),
        useSmartContextDisplay:
          annotation.useSmartContextDisplay ?? DEFAULT_APP_SETTINGS.annotation.useSmartContextDisplay,
        hideKnownItems:
          annotation.hideKnownItems ?? settings.hideMasteredWords ?? DEFAULT_APP_SETTINGS.annotation.hideKnownItems,
        statusColors: normalizeStatusColors(annotation.statusColors)
      },
      exposureTracking: {
        ...clone(DEFAULT_APP_SETTINGS.exposureTracking),
        ...exposureTracking
      },
      siteOverrides: normalizeSiteOverrides(siteOverrides),
      dictionary: {
        ...clone(DEFAULT_APP_SETTINGS.dictionary),
        ...dictionary
      }
    };
  }

  function normalizeInterfaceLanguage(language) {
    if (language === "zh" || language === "zh-CN" || language === "zhHans") return "zhHans";
    if (language === "en" || language === "en-US") return "en";
    return DEFAULT_APP_SETTINGS.display.interfaceLanguage;
  }

  function normalizeUserLevel(level) {
    const normalized = String(level || DEFAULT_APP_SETTINGS.annotation.userLevel).toLowerCase();
    return ["none", "n5", "n4", "n3", "n2", "n1"].includes(normalized)
      ? normalized
      : DEFAULT_APP_SETTINGS.annotation.userLevel;
  }

  function normalizeConstrainedLayoutMode(mode) {
    if (mode === "ruby" || mode === "compact") return mode;
    return DEFAULT_APP_SETTINGS.annotation.constrainedLayoutMode;
  }

  function normalizeStatusColors(colors = {}) {
    const defaults = DEFAULT_APP_SETTINGS.annotation.statusColors;
    const normalized = { ...defaults };
    if (!colors || typeof colors !== "object" || Array.isArray(colors)) return normalized;

    for (const key of Object.keys(defaults)) {
      const color = normalizeHexColor(colors[key]);
      if (color) normalized[key] = color;
    }
    return normalized;
  }

  function normalizeHexColor(color) {
    if (typeof color !== "string") return null;
    const trimmed = color.trim();
    const shortMatch = /^#?([0-9a-f]{3})$/iu.exec(trimmed);
    if (shortMatch) {
      return `#${shortMatch[1].split("").map((character) => character + character).join("").toUpperCase()}`;
    }
    const longMatch = /^#?([0-9a-f]{6})$/iu.exec(trimmed);
    return longMatch ? `#${longMatch[1].toUpperCase()}` : null;
  }

  function normalizeSiteOverrides(overrides = {}) {
    const normalized = {};
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) return normalized;

    for (const [host, value] of Object.entries(overrides)) {
      const normalizedHost = normalizeHostname(host);
      if (!normalizedHost || !value || typeof value !== "object" || Array.isArray(value)) continue;
      normalized[normalizedHost] = {
        annotationEnabled: value.annotationEnabled !== false,
        updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined
      };
    }
    return normalized;
  }

  function normalizeHostname(hostname) {
    return String(hostname || "")
      .trim()
      .toLowerCase()
      .replace(/\.$/u, "");
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
      id: lexicalItemId,
      lexicalItemId,
      lifecycleStatus: "new",
      knowledgeConfidence: 0,
      annotationLevel: "full_ruby",
      userIntent: {
        saved: false,
        ignored: false,
        manuallyMarkedKnown: false,
        manuallyMarkedUnknown: false,
        pinnedAnnotation: false
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
      },
      updatedAt: now
    };
  }

  function migrateLegacyState(parsed, now = createTimestamp()) {
    const state = createDefaultAppState(now);
    state.settings = normalizeSettings(parsed.settings);
    state.entitlements = normalizeEntitlements(parsed.entitlements, now);

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
        createdAt: sentence.createdAt || now,
        updatedAt: sentence.updatedAt || sentence.createdAt || now,
        deviceId: sentence.deviceId || state.metadata.deviceId
      };
    }

    state.reviewLogs = parsed.reviewLogs || {};
    state.metadata.updatedAt = now;
    state.metadata.lastOpenedAt = now;
    return state;
  }

  function normalizeRecordDomains(state, now = createTimestamp()) {
    const deviceId = normalizeDeviceId(state.metadata?.deviceId) || createDeviceId();
    const metadata = {
      ...state.metadata,
      deviceId,
      createdAt: state.metadata?.createdAt || now,
      updatedAt: state.metadata?.updatedAt || now,
      lastOpenedAt: now
    };

    const lexicalItems = {};
    for (const [id, value] of Object.entries(state.lexicalItems || {})) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      lexicalItems[id] = {
        ...value,
        id: value.id || id,
        createdAt: value.createdAt || value.updatedAt || metadata.createdAt,
        updatedAt: value.updatedAt || value.createdAt || metadata.updatedAt,
        deviceId: value.deviceId || deviceId
      };
    }

    const userLexicalStates = {};
    for (const [id, value] of Object.entries(state.userLexicalStates || {})) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const defaults = createDefaultUserLexicalState(value.lexicalItemId || id, value.updatedAt || metadata.updatedAt);
      userLexicalStates[id] = {
        ...defaults,
        ...value,
        id: value.id || id,
        lexicalItemId: value.lexicalItemId || id,
        userIntent: { ...defaults.userIntent, ...(value.userIntent || {}) },
        exposure: { ...defaults.exposure, ...(value.exposure || {}) },
        interaction: { ...defaults.interaction, ...(value.interaction || {}) },
        learning: { ...defaults.learning, ...(value.learning || {}) },
        intelligence: { ...defaults.intelligence, ...(value.intelligence || {}) },
        updatedAt:
          value.updatedAt ||
          value.interaction?.lastActionAt ||
          value.learning?.lastReviewedAt ||
          value.exposure?.lastSeenAt ||
          metadata.updatedAt,
        deviceId: value.deviceId || deviceId
      };
    }

    const sourceOccurrences = {};
    for (const [id, value] of Object.entries(state.sourceOccurrences || {})) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      sourceOccurrences[id] = {
        ...value,
        id: value.id || id,
        createdAt: value.createdAt || value.updatedAt || metadata.updatedAt,
        updatedAt: value.updatedAt || value.createdAt || metadata.updatedAt,
        deviceId: value.deviceId || deviceId
      };
    }

    const dailyExposureSummaries = {};
    for (const [id, value] of Object.entries(state.dailyExposureSummaries || {})) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      dailyExposureSummaries[id] = {
        ...value,
        id: value.id || id,
        updatedAt: value.updatedAt || value.lastSeenAt || metadata.updatedAt,
        deviceId: value.deviceId || deviceId
      };
    }

    const reviewLogs = {};
    for (const [id, value] of Object.entries(state.reviewLogs || {})) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      reviewLogs[id] = {
        ...value,
        id: value.id || id,
        updatedAt: value.updatedAt || value.reviewedAt || metadata.updatedAt,
        deviceId: value.deviceId || deviceId
      };
    }

    return {
      ...state,
      metadata,
      lexicalItems,
      userLexicalStates,
      sourceOccurrences,
      dailyExposureSummaries,
      reviewLogs
    };
  }

  function normalizeDeviceId(deviceId) {
    return typeof deviceId === "string" && deviceId.trim() ? deviceId.trim() : null;
  }

  function mapLegacyStatus(status) {
    if (status === "new" || status === "discovered") return "new";
    if (status === "learning") return "learning";
    if (status === "reviewing") return "reviewing";
    if (status === "known") return "known";
    if (status === "mastered") return "mastered";
    if (status === "ignored") return "ignored";
    return "new";
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

    return normalizeRecordDomains({
      ...createDefaultAppState(now),
      ...parsed,
      userProfile: {
        ...clone(DEFAULT_USER_PROFILE),
        ...parsed.userProfile
      },
      settings: normalizeSettings(parsed.settings),
      entitlements: normalizeEntitlements(parsed.entitlements, now),
      metadata: {
        ...createDefaultAppState(now).metadata,
        ...parsed.metadata,
        updatedAt: parsed.metadata?.updatedAt || now,
        lastOpenedAt: now
      }
    }, now);
  }

  window.FadingFuriganaState = {
    SCHEMA_VERSION,
    DEFAULT_APP_SETTINGS,
    DEFAULT_ENTITLEMENT_PLATFORM,
    DEFAULT_USER_PROFILE,
    BASIC_PRODUCT_IDS,
    computeEntitlementAccess,
    createDefaultAppState,
    createDefaultEntitlements,
    createDefaultUserLexicalState,
    createDeviceId,
    createId,
    createLexicalItemFromToken,
    createTimestamp,
    getLocalDateKey,
    migrateAppState,
    normalizeEntitlements,
    normalizeHostname,
    normalizeSiteOverrides,
    normalizeSettings
  };
})();
