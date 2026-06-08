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
      meaningEn: "confirmation; check",
      partOfSpeech: "noun; suru-verb"
    },
    {
      surface: "申請",
      baseForm: "申請",
      reading: "しんせい",
      meaningEn: "application; request",
      partOfSpeech: "noun; suru-verb"
    },
    {
      surface: "影響",
      baseForm: "影響",
      reading: "えいきょう",
      meaningEn: "influence; effect",
      partOfSpeech: "noun"
    },
    {
      surface: "サーバー",
      baseForm: "サーバー",
      reading: "server",
      meaningEn: "server",
      partOfSpeech: "loanword noun"
    }
  ];

  const DEFAULT_SETTINGS = {
    annotationMode: "unknown_words_only",
    hideMasteredWords: true,
    enabled: true
  };

  const JAPANESE_RE = /[\u3040-\u30ff\u3400-\u9fff]/;
  const SENTENCE_END_RE = /[。！？!?]/;
  const STORAGE_KEY = "jrFadingFuriganaState";
  const ANNOTATED_ATTR = "data-jr-annotated";

  function hasKanji(text) {
    return /[\u3400-\u9fff]/.test(text);
  }

  function createId(...parts) {
    return parts
      .join(":")
      .normalize("NFKC")
      .replace(/\s+/g, "-")
      .toLowerCase();
  }

  class DictionaryProvider {
    constructor(entries) {
      this.entries = entries.map((entry) => ({
        ...entry,
        id: createId(entry.baseForm, entry.reading)
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
    constructor() {
      this.state = {
        words: {},
        userWordStates: {},
        sourceSentences: {},
        reviewLogs: {},
        settings: DEFAULT_SETTINGS
      };
    }

    async load() {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      try {
        const parsed = JSON.parse(raw);
        this.state = {
          ...this.state,
          ...parsed,
          settings: { ...DEFAULT_SETTINGS, ...parsed.settings }
        };
      } catch {
        this.state.settings = DEFAULT_SETTINGS;
      }
    }

    persist() {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    }

    get settings() {
      return this.state.settings;
    }

    getUserWordState(wordId) {
      return this.state.userWordStates[wordId] || null;
    }

    saveWord(token, sourceSentence) {
      const now = new Date().toISOString();
      const word = {
        id: token.id,
        surface: token.surface,
        baseForm: token.baseForm,
        reading: token.reading,
        meaningEn: token.meaningEn,
        partOfSpeech: token.partOfSpeech,
        isKanjiWord: token.isKanjiWord,
        isKatakanaWord: token.isKatakanaWord,
        createdAt: this.state.words[token.id]?.createdAt || now,
        updatedAt: now
      };

      const sentenceId = createId(token.id, sourceSentence, now);
      const existingState = this.getUserWordState(token.id);

      this.state.words[token.id] = word;
      this.state.sourceSentences[sentenceId] = {
        id: sentenceId,
        wordId: token.id,
        sentence: sourceSentence,
        url: window.location.href,
        pageTitle: document.title,
        createdAt: now
      };
      this.state.userWordStates[token.id] = {
        id: existingState?.id || createId("state", token.id),
        wordId: token.id,
        status: "learning",
        annotationLevel: "ruby",
        seenCount: existingState?.seenCount || 1,
        savedCount: (existingState?.savedCount || 0) + 1,
        reviewCount: existingState?.reviewCount || 0,
        correctCount: existingState?.correctCount || 0,
        wrongCount: existingState?.wrongCount || 0,
        correctStreak: existingState?.correctStreak || 0,
        firstSeenAt: existingState?.firstSeenAt || now,
        lastSeenAt: now,
        lastReviewedAt: existingState?.lastReviewedAt,
        nextReviewAt: existingState?.nextReviewAt,
        sourceSentenceIds: [...(existingState?.sourceSentenceIds || []), sentenceId]
      };

      this.persist();
    }

    markKnown(token) {
      this.setStatus(token, "mastered", "hidden");
    }

    ignore(token) {
      this.setStatus(token, "ignored", "hidden");
    }

    recordSeen(token) {
      const now = new Date().toISOString();
      const existingState = this.getUserWordState(token.id);
      if (!existingState) {
        this.state.userWordStates[token.id] = {
          id: createId("state", token.id),
          wordId: token.id,
          status: "new",
          annotationLevel: "ruby",
          seenCount: 1,
          savedCount: 0,
          reviewCount: 0,
          correctCount: 0,
          wrongCount: 0,
          correctStreak: 0,
          firstSeenAt: now,
          lastSeenAt: now,
          sourceSentenceIds: []
        };
      } else {
        existingState.seenCount += 1;
        existingState.lastSeenAt = now;
      }
      this.persist();
    }

    setStatus(token, status, annotationLevel) {
      const now = new Date().toISOString();
      const existingState = this.getUserWordState(token.id);
      this.state.words[token.id] = {
        id: token.id,
        surface: token.surface,
        baseForm: token.baseForm,
        reading: token.reading,
        meaningEn: token.meaningEn,
        partOfSpeech: token.partOfSpeech,
        isKanjiWord: token.isKanjiWord,
        isKatakanaWord: token.isKatakanaWord,
        createdAt: this.state.words[token.id]?.createdAt || now,
        updatedAt: now
      };
      this.state.userWordStates[token.id] = {
        id: existingState?.id || createId("state", token.id),
        wordId: token.id,
        status,
        annotationLevel,
        seenCount: existingState?.seenCount || 1,
        savedCount: existingState?.savedCount || 0,
        reviewCount: existingState?.reviewCount || 0,
        correctCount: existingState?.correctCount || 0,
        wrongCount: existingState?.wrongCount || 0,
        correctStreak: existingState?.correctStreak || 0,
        firstSeenAt: existingState?.firstSeenAt || now,
        lastSeenAt: now,
        lastReviewedAt: existingState?.lastReviewedAt,
        nextReviewAt: existingState?.nextReviewAt,
        sourceSentenceIds: existingState?.sourceSentenceIds || []
      };
      this.persist();
    }
  }

  function shouldAnnotate(word, userState, settings) {
    if (!settings.enabled || settings.annotationMode === "off") return false;
    if (userState?.status === "ignored") return false;
    if (settings.hideMasteredWords && userState?.status === "mastered") return false;
    if (settings.annotationMode === "all_kanji_words") return word.isKanjiWord;
    if (settings.annotationMode === "unknown_words_only") return !userState || userState.status !== "mastered";
    if (settings.annotationMode === "saved_words_only") return !!userState && userState.status !== "mastered";
    return false;
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
      this.element.querySelector(".jr-tooltip__reading").textContent = token.reading;
      this.element.querySelector(".jr-tooltip__meaning").textContent = token.meaningEn || "";
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
        state: this.repository.state
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
        .filter((token) => shouldAnnotate(token, this.repository.getUserWordState(token.id), this.repository.settings));

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
      ruby.dataset.wordId = token.id;
      ruby.dataset.surface = token.surface;
      ruby.dataset.baseForm = token.baseForm;
      ruby.dataset.reading = token.reading;
      ruby.dataset.meaningEn = token.meaningEn || "";
      ruby.dataset.partOfSpeech = token.partOfSpeech || "";
      ruby.dataset.sourceSentence = sourceSentence;
      ruby.dataset.originalText = token.surface;

      const rt = document.createElement("rt");
      rt.textContent = token.reading;
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
          id: ruby.dataset.wordId,
          surface: ruby.dataset.surface,
          baseForm: ruby.dataset.baseForm,
          reading: ruby.dataset.reading,
          meaningEn: ruby.dataset.meaningEn,
          partOfSpeech: ruby.dataset.partOfSpeech,
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

    const repository = new LocalWordRepository();
    await repository.load();
    const dictionaryProvider = new DictionaryProvider(SAMPLE_DICTIONARY);
    const analyzer = new JapaneseAnalyzer(dictionaryProvider);
    const engine = new AnnotationEngine(analyzer, repository);
    engine.start();
  }

  boot();
})();
