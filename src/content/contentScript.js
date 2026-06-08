(() => {
  "use strict";

  const SKIP_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEXTAREA",
    "INPUT",
    "SELECT",
    "BUTTON",
    "CODE",
    "PRE",
    "RUBY",
    "RT",
    "RP"
  ]);

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

  const JAPANESE_RE = /[\u3040-\u30ff\u3400-\u9fff]/;
  const SENTENCE_END_RE = /[。！？!?]/;
  const ANNOTATED_ATTR = "data-jr-annotated";

  function hasKanji(text) {
    return /[\u3400-\u9fff]/.test(text);
  }

  function createId(...parts) {
    return window.FadingFuriganaState.createId(...parts);
  }

  function getMeaningText(item, preferredLanguages) {
    const meanings = item.meanings || {};
    for (const locale of preferredLanguages || []) {
      if (meanings[locale]?.length) return meanings[locale].join("; ");
    }
    return Object.values(meanings).find((values) => values?.length)?.join("; ") || "";
  }

  function parseJsonDataset(value, fallback) {
    if (!value) return fallback;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
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

  function shouldSkipTextNode(node) {
    if (!node.nodeValue || !node.nodeValue.trim() || !JAPANESE_RE.test(node.nodeValue)) return true;

    let element = node.parentElement;
    while (element) {
      if (SKIP_TAGS.has(element.tagName)) return true;
      if (element.isContentEditable) return true;
      if (element.hasAttribute(ANNOTATED_ATTR)) return true;
      element = element.parentElement;
    }

    return false;
  }

  function extractSentence(text, start) {
    let sentenceStart = start;
    while (sentenceStart > 0 && !SENTENCE_END_RE.test(text[sentenceStart - 1])) {
      sentenceStart -= 1;
    }

    let sentenceEnd = start;
    while (sentenceEnd < text.length && !SENTENCE_END_RE.test(text[sentenceEnd])) {
      sentenceEnd += 1;
    }

    if (sentenceEnd < text.length) sentenceEnd += 1;
    return text.slice(sentenceStart, sentenceEnd).trim();
  }

  class Tooltip {
    constructor(repository, onStateChange) {
      this.repository = repository;
      this.onStateChange = onStateChange;
      this.element = document.createElement("div");
      this.element.className = "jr-tooltip";
      this.element.hidden = true;
      document.documentElement.appendChild(this.element);

      document.addEventListener("click", (event) => {
        if (!this.element.contains(event.target) && !event.target.closest(".jr-ruby")) {
          this.hide();
        }
      });
    }

    show(target, token, sourceSentence) {
      const meaningText = getMeaningText(token, this.repository.state.userProfile.preferredMeaningLanguages);
      const readingText = token.loanword?.originalForm || token.readingKana || token.reading;
      this.element.hidden = false;
      this.element.innerHTML = `
        <div class="jr-tooltip__surface"></div>
        <div class="jr-tooltip__reading"></div>
        <div class="jr-tooltip__meaning"></div>
        <div class="jr-tooltip__sentence"></div>
        <div class="jr-tooltip__actions">
          <button type="button" data-action="save">Save</button>
          <button type="button" data-action="ignore">Ignore</button>
          <button type="button" data-action="known">Mark as Known</button>
        </div>
      `;

      this.element.querySelector(".jr-tooltip__surface").textContent = token.surface;
      this.element.querySelector(".jr-tooltip__reading").textContent = readingText;
      this.element.querySelector(".jr-tooltip__meaning").textContent = meaningText;
      this.element.querySelector(".jr-tooltip__sentence").textContent = sourceSentence || "";

      this.element.querySelector("[data-action='save']").addEventListener("click", () => {
        this.repository.saveWord(token, sourceSentence);
        this.hide();
      });
      this.element.querySelector("[data-action='ignore']").addEventListener("click", () => {
        this.repository.ignore(token);
        this.hide();
        this.onStateChange();
      });
      this.element.querySelector("[data-action='known']").addEventListener("click", () => {
        this.repository.markKnown(token);
        this.hide();
        this.onStateChange();
      });

      const rect = target.getBoundingClientRect();
      const top = Math.min(window.innerHeight - this.element.offsetHeight - 12, rect.bottom + 8);
      const left = Math.min(window.innerWidth - this.element.offsetWidth - 12, Math.max(12, rect.left));
      this.element.style.top = `${Math.max(12, top)}px`;
      this.element.style.left = `${left}px`;
    }

    hide() {
      this.element.hidden = true;
    }
  }

  class AnnotationEngine {
    constructor(analyzer, repository) {
      this.analyzer = analyzer;
      this.repository = repository;
      this.isAnnotating = false;
      this.tooltip = new Tooltip(repository, () => this.refresh());
      this.observer = new MutationObserver((mutations) => this.onMutations(mutations));
      this.scheduleTimer = null;
    }

    start() {
      this.annotateRoot(document.body);
      this.observer.observe(document.body, { childList: true, subtree: true });
      document.addEventListener("click", (event) => this.onClick(event));
      window.FadingFurigana = {
        restore: () => this.restore(),
        refresh: () => this.refresh(),
        state: this.repository.state,
        exposures: {
          today: () => this.repository.listDailyExposures(),
          frequent: (range) => this.repository.listFrequentItems(range),
          frequentThisWeek: () => {
            const end = new Date();
            const start = new Date();
            start.setDate(end.getDate() - 6);
            return this.repository.listFrequentItems({
              startDate: window.FadingFuriganaState.getLocalDateKey(start),
              endDate: window.FadingFuriganaState.getLocalDateKey(end)
            });
          }
        }
      };
    }

    refresh() {
      this.restore();
      this.annotateRoot(document.body);
    }

    restore() {
      const rubies = [...document.querySelectorAll(".jr-ruby")];
      for (const ruby of rubies) {
        ruby.replaceWith(document.createTextNode(ruby.dataset.originalText || ruby.textContent || ""));
      }
    }

    onMutations(mutations) {
      if (this.isAnnotating) return;
      const hasNewText = mutations.some((mutation) =>
        [...mutation.addedNodes].some((node) => node.nodeType === Node.TEXT_NODE || node.nodeType === Node.ELEMENT_NODE)
      );
      if (!hasNewText) return;

      window.clearTimeout(this.scheduleTimer);
      this.scheduleTimer = window.setTimeout(() => this.annotateRoot(document.body), 120);
    }

    annotateRoot(root) {
      if (!root || this.isAnnotating) return;
      this.isAnnotating = true;

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          return shouldSkipTextNode(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        }
      });

      const nodes = [];
      while (walker.nextNode()) {
        nodes.push(walker.currentNode);
      }

      for (const node of nodes) {
        this.annotateTextNode(node);
      }

      this.isAnnotating = false;
    }

    annotateTextNode(node) {
      const text = node.nodeValue;
      const tokens = this.analyzer
        .analyze(text)
        .filter((token) =>
          window.FadingFuriganaAnnotationDecision.shouldAnnotate(
            token,
            this.repository.getUserWordState(token.lexicalItemId),
            this.repository.settings
          )
        );

      if (tokens.length === 0) return;

      const fragment = document.createDocumentFragment();
      let cursor = 0;

      for (const token of tokens) {
        if (token.start < cursor) continue;
        fragment.appendChild(document.createTextNode(text.slice(cursor, token.start)));
        fragment.appendChild(this.createRuby(token, extractSentence(text, token.start)));
        cursor = token.end;
        this.repository.recordSeen(token);
      }

      fragment.appendChild(document.createTextNode(text.slice(cursor)));
      node.replaceWith(fragment);
    }

    createRuby(token, sourceSentence) {
      const ruby = document.createElement("ruby");
      ruby.className = "jr-ruby";
      ruby.setAttribute(ANNOTATED_ATTR, "true");
      ruby.dataset.wordId = token.lexicalItemId;
      ruby.dataset.lexicalItemId = token.lexicalItemId;
      ruby.dataset.surface = token.surface;
      ruby.dataset.lemma = token.lemma || token.baseForm || token.surface;
      ruby.dataset.baseForm = token.baseForm || token.lemma || token.surface;
      ruby.dataset.reading = token.readingKana || token.reading;
      ruby.dataset.readingKana = token.readingKana || token.reading;
      ruby.dataset.meanings = JSON.stringify(token.meanings || {});
      ruby.dataset.partOfSpeech = Array.isArray(token.partOfSpeech)
        ? token.partOfSpeech.join(", ")
        : token.partOfSpeech || "";
      ruby.dataset.loanword = JSON.stringify(token.loanword || {});
      ruby.dataset.sourceSentence = sourceSentence;
      ruby.dataset.originalText = token.surface;

      const rt = document.createElement("rt");
      rt.textContent = token.loanword?.originalForm || token.readingKana || token.reading;
      ruby.appendChild(document.createTextNode(token.surface));
      ruby.appendChild(rt);
      return ruby;
    }

    onClick(event) {
      const ruby = event.target.closest?.(".jr-ruby");
      if (!ruby) return;

      event.preventDefault();
      event.stopPropagation();
      this.tooltip.show(
        ruby,
        {
          id: ruby.dataset.lexicalItemId || ruby.dataset.wordId,
          lexicalItemId: ruby.dataset.lexicalItemId || ruby.dataset.wordId,
          surface: ruby.dataset.surface,
          lemma: ruby.dataset.lemma || ruby.dataset.baseForm,
          baseForm: ruby.dataset.baseForm || ruby.dataset.lemma,
          reading: ruby.dataset.reading,
          readingKana: ruby.dataset.readingKana || ruby.dataset.reading,
          meanings: parseJsonDataset(ruby.dataset.meanings, {}),
          partOfSpeech: ruby.dataset.partOfSpeech,
          loanword: parseJsonDataset(ruby.dataset.loanword, {}),
          isKanjiWord: true,
          isKatakanaWord: false
        },
        ruby.dataset.sourceSentence
      );
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
    const engine = new AnnotationEngine(analyzer, repository);
    engine.start();
  }

  boot();
})();
