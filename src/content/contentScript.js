(() => {
  "use strict";

  const SAMPLE_DICTIONARY = [
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

  function hasKanji(text) {
    return /[\u3400-\u9fff]/.test(text);
  }

  function createId(...parts) {
    return window.FadingFuriganaState.createId(...parts);
  }

  class DictionaryProvider {
    constructor(entries) {
      this.entries = entries.map((entry) => ({
        ...entry,
        id: createId(entry.baseForm, entry.reading),
        lexicalItemId: createId(entry.baseForm, entry.reading)
      }));
      this.bySurface = new Map();
      for (const entry of this.entries) {
        const existing = this.bySurface.get(entry.surface);
        if (!existing || entry.surface.length > existing.surface.length) {
          this.bySurface.set(entry.surface, entry);
        }
      }
      this.surfaces = [...this.bySurface.keys()].sort((a, b) => b.length - a.length);
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
          lexicalItemId: entry.lexicalItemId || entry.id,
          lemma: entry.baseForm,
          readingKana: entry.reading,
          baseReadingKana: entry.reading,
          lexicalType: entry.loanword?.isLoanword ? "loanword" : "word",
          scriptProfile: {
            hasKanji: hasKanji(entry.surface),
            hasHiragana: /[\u3040-\u309f]/.test(entry.surface),
            hasKatakana: /[\u30a0-\u30ff]/.test(entry.surface),
            hasLatin: /[a-z]/i.test(entry.surface)
          },
          source: {
            provider: "sample",
            confidence: 1
          },
          start: index,
          end: index + entry.surface.length,
          isKanjiWord: hasKanji(entry.surface),
          isKatakanaWord: /[\u30a0-\u30ff]/.test(entry.surface)
        });
        index += entry.surface.length;
      }

      return tokens;
    }
  }

  class LocalWordRepository {
    constructor(storageAdapter) {
      this.storageAdapter = storageAdapter;
      this.state = window.FadingFuriganaState.createDefaultAppState();
      this.lexicalItems = new window.FadingFuriganaRepositories.LexicalItemRepository(() => this.state);
      this.userLexicalStates = new window.FadingFuriganaRepositories.UserLexicalStateRepository(() => this.state);
      this.exposures = new window.FadingFuriganaRepositories.ExposureRepository(() => this.state);
    }

    async load() {
      this.state = await this.storageAdapter.loadState();
      await this.persist();
    }

    async persist() {
      await this.storageAdapter.saveState(this.state);
    }

    get settings() {
      return this.state.settings;
    }

    getUserWordState(wordId) {
      return this.userLexicalStates.getByLexicalItemId(wordId);
    }

    getLegacyUserWordState(wordId) {
      const state = this.getUserWordState(wordId);
      if (!state) return null;
      return {
        status: state.lifecycleStatus === "mastered" ? "mastered" : state.lifecycleStatus,
        annotationLevel: state.annotationLevel === "hidden" ? "hidden" : "ruby"
      };
    }

    upsertLexicalItem(token, now = new Date().toISOString()) {
      return this.lexicalItems.upsertFromToken(token, now);
    }

    ensureUserState(lexicalItemId, now = new Date().toISOString()) {
      return this.userLexicalStates.ensure(lexicalItemId, now);
    }

    async saveWord(token, sourceSentence) {
      const now = new Date().toISOString();
      const item = this.upsertLexicalItem(token, now);
      const occurrenceId = createId("occurrence", item.id, sourceSentence, now);
      const existingState = this.userLexicalStates.markSaved(item.id, now);

      this.state.sourceOccurrences[occurrenceId] = {
        id: occurrenceId,
        lexicalItemId: item.id,
        surface: token.surface,
        sentence: sourceSentence,
        url: window.location.href,
        domain: window.location.hostname,
        pageTitle: document.title,
        createdAt: now
      };

      await this.persist();
    }

    markKnown(token) {
      return this.setStatus(token, "mastered", "hidden");
    }

    ignore(token) {
      return this.setStatus(token, "ignored", "hidden");
    }

    async recordSeen(token) {
      const now = new Date().toISOString();
      const item = this.upsertLexicalItem(token, now);
      this.userLexicalStates.recordSeen(item.id, now);
      this.recordDailyExposure(item.id, token.surface, now);
      await this.persist();
    }

    recordDailyExposure(lexicalItemId, surface, seenAt) {
      const pageKey = this.state.settings.exposureTracking.saveUrls === "full"
        ? window.location.href
        : window.location.hostname || "unknown-page";
      return this.exposures.recordDailyExposure({
        lexicalItemId,
        surface,
        pageKey,
        url: window.location.href,
        domain: window.location.hostname,
        pageTitle: document.title,
        seenAt
      });
    }

    listDailyExposures(date = window.FadingFuriganaState.getLocalDateKey()) {
      return this.exposures.listDailyExposures(date);
    }

    listFrequentItems(range) {
      return this.exposures.listFrequentItems(range);
    }

    async setStatus(token, status, annotationLevel) {
      const now = new Date().toISOString();
      const item = this.upsertLexicalItem(token, now);
      this.userLexicalStates.setStatus(item.id, status, annotationLevel, now);
      await this.persist();
    }
  }

  async function boot() {
    if (!document.body || window.__fadingFuriganaLoaded) return;
    window.__fadingFuriganaLoaded = true;

    const storageAdapter = new window.FadingFuriganaStorage.LocalStorageAdapter();
    const repository = new LocalWordRepository(storageAdapter);
    await repository.load();
    const dictionaryProvider = new DictionaryProvider(SAMPLE_DICTIONARY);
    const analyzer = new JapaneseAnalyzer(dictionaryProvider);
    let engine;
    const tooltip = new window.FadingFuriganaTooltip.Tooltip(repository, () => engine.refresh());
    engine = new window.FadingFuriganaAnnotationEngine.AnnotationEngine({
      analyzer,
      repository,
      tooltip
    });
    engine.start();
  }

  boot();
})();
