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

  function defaultIsPageEligible() {
    if (!window.FadingFuriganaPageLanguage) return true;
    return window.FadingFuriganaPageLanguage.isPageEligibleForAnnotation(document);
  }

  const ANALYZE_CHUNK_SIZE = 50;
  // Hard per-page budget of analyzed text nodes. Pages that fight the
  // annotations (frameworks restoring text in a loop) would otherwise grow
  // memory without bound; beyond the budget the engine shuts itself off.
  const PAGE_NODE_BUDGET = 50000;
  // Annotate slightly ahead of the viewport so scrolling feels seamless.
  const VIEWPORT_LOOKAHEAD = "600px 0px 600px 0px";
  // While a freshly loaded page is still mutating (hydration, lazy widgets),
  // hold annotations back until the DOM has been quiet for a moment, so the
  // site's re-renders do not make annotations flicker in and out.
  const STABILITY_QUIET_MS = 600;
  const STABILITY_MAX_WAIT_MS = 6000;
  // An element whose children keep getting re-annotated is fighting us
  // (a framework restores its text on every render): cool down, then give up.
  const ELEMENT_CHURN_SOFT_LIMIT = 4;
  const ELEMENT_CHURN_HARD_LIMIT = 12;
  const ELEMENT_CHURN_COOLDOWN_MS = 5000;

  function createViewportObserver(onVisibleElements) {
    if (typeof IntersectionObserver !== "function") return null;
    return new IntersectionObserver(
      (entries, observer) => {
        const visible = [];
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          visible.push(entry.target);
        }
        if (visible.length > 0) onVisibleElements(visible);
      },
      { rootMargin: VIEWPORT_LOOKAHEAD }
    );
  }

  class AnnotationEngine {
    constructor({ analyzer, repository, tooltip, isPageEligible }) {
      this.analyzer = analyzer;
      this.repository = repository;
      this.tooltip = tooltip;
      this.isPageEligible = isPageEligible || defaultIsPageEligible;
      this.isAnnotating = false;
      this.rescanRequested = false;
      this.suspended = false;
      this.remainingNodeBudget = PAGE_NODE_BUDGET;
      // Each word counts at most one exposure per page visit, so re-renders
      // and refreshes cannot inflate the stats or the stored state.
      this.recordedSeenIds = new Set();
      // Text nodes that have already been analyzed; never re-tokenize them.
      this.processedNodes = new WeakSet();
      // Subtrees added by page mutations, waiting for an incremental pass.
      this.pendingRoots = new Set();
      // Text nodes waiting for their parent element to scroll into view.
      this.queuedNodesByElement = new WeakMap();
      // Re-annotation counters per parent element, to detect render fights.
      this.churnByElement = new WeakMap();
      this.bootAt = Date.now();
      this.lastForeignMutationAt = 0;
      this.viewportObserver = createViewportObserver((elements) => this.onElementsVisible(elements));
      this.observer = new MutationObserver((mutations) => this.onMutations(mutations));
      this.scheduleTimer = null;
    }

    start() {
      this.annotateRoot(document.body).catch(() => {});
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
      this.processedNodes = new WeakSet();
      this.pendingRoots.clear();
      this.queuedNodesByElement = new WeakMap();
      this.churnByElement = new WeakMap();
      this.viewportObserver?.disconnect();
      this.restore();
      return this.annotateRoot(document.body);
    }

    restore() {
      const rubies = [...document.querySelectorAll(".jr-ruby")];
      for (const ruby of rubies) {
        ruby.replaceWith(document.createTextNode(ruby.dataset.originalText || ruby.textContent || ""));
      }
    }

    onMutations(mutations) {
      const sizeBefore = this.pendingRoots.size;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.TEXT_NODE && node.nodeType !== Node.ELEMENT_NODE) continue;
          // Ignore our own ruby insertions.
          if (node.nodeType === Node.ELEMENT_NODE && node.hasAttribute?.(ANNOTATED_ATTR)) continue;
          if (node.nodeType === Node.TEXT_NODE && this.processedNodes.has(node)) continue;
          this.pendingRoots.add(node);
        }
      }
      if (this.pendingRoots.size === 0) return;
      if (this.pendingRoots.size > sizeBefore) {
        this.lastForeignMutationAt = Date.now();
      }

      if (this.isAnnotating) {
        this.rescanRequested = true;
        return;
      }
      this.scheduleRescan();
    }

    scheduleRescan(delayMs = 120) {
      window.clearTimeout(this.scheduleTimer);
      this.scheduleTimer = window.setTimeout(() => this.annotatePending().catch(() => {}), delayMs);
    }

    // Returns how long annotation should still wait for the page to settle.
    getStabilityDelay() {
      const now = Date.now();
      if (now - this.bootAt >= STABILITY_MAX_WAIT_MS) return 0;
      if (!this.lastForeignMutationAt) return 0;
      const sinceMutation = now - this.lastForeignMutationAt;
      return sinceMutation >= STABILITY_QUIET_MS ? 0 : STABILITY_QUIET_MS - sinceMutation;
    }

    annotatePending() {
      const roots = [...this.pendingRoots];
      this.pendingRoots.clear();

      const nodes = new Set();
      for (const root of roots) {
        if (root.isConnected === false) continue;
        for (const node of this.collectTextNodes(root)) {
          nodes.add(node);
        }
      }
      return this.scheduleNodes([...nodes]);
    }

    annotateRoot(root) {
      if (!root) return Promise.resolve();
      return this.scheduleNodes(this.collectTextNodes(root));
    }

    // Defer tokenization until the nodes' parent elements are near the
    // viewport, so long pages only pay for what the user actually sees.
    scheduleNodes(nodes) {
      if (this.suspended || nodes.length === 0 || !this.isPageEligible()) return Promise.resolve();

      const now = Date.now();
      let retryDelay = 0;
      const ready = [];
      for (const node of nodes) {
        const churn = node.parentElement ? this.churnByElement.get(node.parentElement) : null;
        if (churn?.unstable) continue;
        if (churn && churn.blockedUntil > now) {
          this.pendingRoots.add(node);
          retryDelay = Math.max(retryDelay, churn.blockedUntil - now);
          continue;
        }
        ready.push(node);
      }
      if (retryDelay > 0) this.scheduleRescan(retryDelay);
      if (ready.length === 0) return Promise.resolve();

      if (!this.viewportObserver) return this.annotateNodes(ready);

      const newlyObserved = [];
      for (const node of ready) {
        const element = node.parentElement;
        if (!element) continue;
        let queued = this.queuedNodesByElement.get(element);
        if (!queued) {
          queued = new Set();
          this.queuedNodesByElement.set(element, queued);
          newlyObserved.push(element);
        }
        queued.add(node);
      }
      for (const element of newlyObserved) {
        this.viewportObserver.observe(element);
      }
      return Promise.resolve();
    }

    onElementsVisible(elements) {
      const nodes = [];
      for (const element of elements) {
        const queued = this.queuedNodesByElement.get(element);
        if (!queued) continue;
        this.queuedNodesByElement.delete(element);
        nodes.push(...queued);
      }
      this.annotateNodes(nodes).catch(() => {});
    }

    collectTextNodes(root) {
      const isUnprocessed = (node) => !this.processedNodes.has(node) && !shouldSkipTextNode(node);

      if (root.nodeType === Node.TEXT_NODE) {
        return isUnprocessed(root) ? [root] : [];
      }

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          return isUnprocessed(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      });

      const nodes = [];
      while (walker.nextNode()) {
        nodes.push(walker.currentNode);
      }
      return nodes;
    }

    async annotateNodes(nodes) {
      if (this.suspended || nodes.length === 0 || !this.isPageEligible()) return;
      // Skip tokenization entirely while annotation is off; a settings change
      // triggers refresh(), which re-collects everything.
      const annotation = this.repository.settings?.annotation;
      if (!annotation?.enabled || annotation.mode === "off") return;

      // Let a still-loading page settle first, otherwise the site's own
      // re-renders strip and re-trigger annotations in a visible flicker.
      const stabilityDelay = this.getStabilityDelay();
      if (stabilityDelay > 0) {
        for (const node of nodes) this.pendingRoots.add(node);
        this.scheduleRescan(stabilityDelay);
        return;
      }

      if (this.isAnnotating) {
        for (const node of nodes) this.pendingRoots.add(node);
        this.rescanRequested = true;
        return;
      }
      this.isAnnotating = true;

      try {
        // Chunked round trips keep messages small and let the page stay
        // responsive while long pages are tokenized.
        for (let offset = 0; offset < nodes.length; offset += ANALYZE_CHUNK_SIZE) {
          const chunk = nodes.slice(offset, offset + ANALYZE_CHUNK_SIZE);
          const texts = chunk.map((node) => node.nodeValue);
          const tokenLists = await this.analyzeTexts(texts);
          const annotatedParents = new Set();

          for (let index = 0; index < chunk.length; index += 1) {
            if (this.remainingNodeBudget <= 0) {
              this.suspend();
              return;
            }
            this.remainingNodeBudget -= 1;

            const node = chunk[index];
            this.processedNodes.add(node);
            // The page may have changed while waiting for the tokenizer.
            if (node.isConnected === false || !node.parentElement) continue;
            if (node.nodeValue !== texts[index]) continue;

            const parentElement = node.parentElement;
            if (this.annotateTextNode(node, tokenLists[index] || []) && parentElement) {
              annotatedParents.add(parentElement);
            }
          }

          for (const parentElement of annotatedParents) {
            this.trackElementChurn(parentElement);
          }
        }
      } finally {
        this.isAnnotating = false;
      }

      if (this.rescanRequested || this.pendingRoots.size > 0) {
        this.rescanRequested = false;
        this.scheduleRescan();
      }
    }

    trackElementChurn(element) {
      const entry = this.churnByElement.get(element) || { count: 0, blockedUntil: 0, unstable: false };
      entry.count += 1;
      if (entry.count >= ELEMENT_CHURN_HARD_LIMIT) {
        entry.unstable = true;
      } else if (entry.count > ELEMENT_CHURN_SOFT_LIMIT) {
        entry.blockedUntil = Date.now() + ELEMENT_CHURN_COOLDOWN_MS;
      }
      this.churnByElement.set(element, entry);
    }

    suspend() {
      this.suspended = true;
      this.observer.disconnect();
      this.viewportObserver?.disconnect();
      this.queuedNodesByElement = new WeakMap();
      window.clearTimeout(this.scheduleTimer);
      this.pendingRoots.clear();
      this.rescanRequested = false;
      console.warn(
        "[Fading Furigana] Annotation suspended on this page after hitting the per-page processing budget."
      );
    }

    analyzeTexts(texts) {
      if (typeof this.analyzer.analyzeBatch === "function") {
        return this.analyzer.analyzeBatch(texts);
      }
      return Promise.resolve(texts.map((text) => this.analyzer.analyze(text)));
    }

    annotateTextNode(node, analyzedTokens) {
      const text = node.nodeValue;
      const tokens = analyzedTokens.filter((token) =>
        window.FadingFuriganaAnnotationDecision.shouldAnnotate(
          token,
          this.repository.getUserWordState(token.lexicalItemId),
          this.repository.settings
        )
      );

      if (tokens.length === 0) return false;

      const fragment = document.createDocumentFragment();
      let cursor = 0;

      const appendProcessedText = (value) => {
        const textNode = document.createTextNode(value);
        this.processedNodes.add(textNode);
        fragment.appendChild(textNode);
      };

      for (const token of tokens) {
        if (token.start < cursor) continue;
        appendProcessedText(text.slice(cursor, token.start));
        fragment.appendChild(this.createRuby(token, extractSentence(text, token.start)));
        cursor = token.end;
        if (!this.recordedSeenIds.has(token.lexicalItemId)) {
          this.recordedSeenIds.add(token.lexicalItemId);
          this.repository.recordSeen(token);
        }
      }

      appendProcessedText(text.slice(cursor));
      node.replaceWith(fragment);
      return true;
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
