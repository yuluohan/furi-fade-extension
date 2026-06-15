(() => {
  "use strict";

  class BackgroundTokenizerAnalyzer {
    constructor({ localProvider, fallbackAnalyzer, messenger = defaultMessenger }) {
      this.localProvider = localProvider;
      this.fallbackAnalyzer = fallbackAnalyzer;
      this.messenger = messenger;
      this.backgroundFailed = false;
    }

    async analyzeBatch(texts) {
      if (!this.backgroundFailed) {
        try {
          const response = await this.messenger({ type: "FADING_FURIGANA_TOKENIZE", texts });
          if (response?.ok && Array.isArray(response.results)) {
            return response.results.map((tokens, index) => this.reconcileTokens(texts[index], tokens));
          }
          throw new Error(response?.error || "tokenizer unavailable");
        } catch {
          // Background tokenizer is unavailable (init failure, old browser);
          // stay on the local analyzer for the rest of this page.
          this.backgroundFailed = true;
        }
      }
      return texts.map((text) => this.fallbackAnalyzer.analyze(text));
    }

    enrichTokens(tokens) {
      const enriched = [];
      for (const token of tokens || []) {
        const result = this.enrichToken(token);
        if (result) enriched.push(result);
      }
      return enriched;
    }

    reconcileTokens(text, tokens) {
      return this.overlayDictionarySpans(text, this.enrichTokens(tokens));
    }

    overlayDictionarySpans(text, tokens) {
      if (typeof this.fallbackAnalyzer?.analyze !== "function") return tokens;

      const dictionaryTokens = this.fallbackAnalyzer
        .analyze(text)
        .filter((token) => shouldOverlayDictionaryToken(token, tokens));
      if (dictionaryTokens.length === 0) return tokens;

      const preserved = tokens.filter((token) => !dictionaryTokens.some((overlay) => rangesOverlap(token, overlay)));
      return [...preserved, ...dictionaryTokens].sort((a, b) => a.start - b.start || b.end - a.end);
    }

    enrichToken(token) {
      const entry =
        this.localProvider.bySurface.get(token.baseForm) || this.localProvider.bySurface.get(token.surface);

      if (entry) {
        return {
          ...token,
          id: entry.id,
          lexicalItemId: entry.lexicalItemId,
          meanings: hasMeanings(token.meanings) ? token.meanings : entry.meanings,
          difficulty: token.difficulty || entry.difficulty,
          loanword: token.isKatakanaWord ? entry.loanword : token.loanword,
          baseReadingKana: entry.baseReadingKana || token.baseReadingKana
        };
      }

      // A katakana ruby that just repeats the surface adds nothing; only keep
      // katakana words once a source form or meaning is known.
      if (token.isKatakanaWord && !token.loanword?.originalForm && !hasMeanings(token.meanings)) {
        return null;
      }
      return token;
    }
  }

  function hasMeanings(meanings) {
    return !!meanings && Object.values(meanings).some((list) => Array.isArray(list) && list.length > 0);
  }

  function shouldOverlayDictionaryToken(dictionaryToken, tokenizerTokens) {
    if (!dictionaryToken || dictionaryToken.surface.length < 2) return false;
    const overlapping = (tokenizerTokens || []).filter((token) => rangesOverlap(token, dictionaryToken));
    if (overlapping.some((token) => token.start === dictionaryToken.start && token.end === dictionaryToken.end)) {
      return false;
    }

    const dictionaryLength = dictionaryToken.end - dictionaryToken.start;
    return (
      overlapping.length === 0 ||
      overlapping.every(
        (token) =>
          token.start >= dictionaryToken.start &&
          token.end <= dictionaryToken.end &&
          token.end - token.start < dictionaryLength
      )
    );
  }

  function rangesOverlap(left, right) {
    return Number.isFinite(left?.start) && Number.isFinite(left?.end) && left.start < right.end && right.start < left.end;
  }

  function defaultMessenger(message) {
    return new Promise((resolve, reject) => {
      try {
        window.chrome.runtime.sendMessage(message, (response) => {
          const lastError = window.chrome?.runtime?.lastError;
          if (lastError) reject(new Error(lastError.message));
          else resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function createBestAvailableAnalyzer({ localProvider, fallbackAnalyzer }) {
    if (window.chrome?.runtime?.sendMessage && window.chrome?.runtime?.id) {
      return new BackgroundTokenizerAnalyzer({ localProvider, fallbackAnalyzer });
    }
    return fallbackAnalyzer;
  }

  window.FadingFuriganaBackgroundTokenizer = {
    BackgroundTokenizerAnalyzer,
    createBestAvailableAnalyzer
  };
})();
