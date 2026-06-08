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

  const JAPANESE_RE = /[\u3040-\u30ff\u3400-\u9fff]/;
  const SENTENCE_END_RE = /[。！？!?]/;
  const ANNOTATED_ATTR = "data-jr-annotated";

  function shouldSkipTextNode(node) {
    if (!node.nodeValue || !node.nodeValue.trim() || !JAPANESE_RE.test(node.nodeValue)) return true;

    let element = node.parentElement;
    while (element) {
      if (SKIP_TAGS.has(element.tagName)) return true;
      if (element.isContentEditable) return true;
      if (element.hidden) return true;
      if (element.getAttribute("aria-hidden") === "true") return true;
      if (element.hasAttribute("data-fading-furigana-ignore")) return true;
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

  class AnnotationEngine {
    constructor({ analyzer, repository, tooltip }) {
      this.analyzer = analyzer;
      this.repository = repository;
      this.tooltip = tooltip;
      this.isAnnotating = false;
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
      this.tooltip.show(ruby, datasetToToken(ruby), ruby.dataset.sourceSentence);
    }
  }

  function datasetToToken(ruby) {
    return {
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
    };
  }

  function parseJsonDataset(value, fallback) {
    if (!value) return fallback;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  window.FadingFuriganaAnnotationEngine = {
    AnnotationEngine,
    extractSentence,
    shouldSkipTextNode
  };
})();
