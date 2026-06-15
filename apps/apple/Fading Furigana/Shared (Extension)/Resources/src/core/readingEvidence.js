(() => {
  "use strict";

  const KANJI_RE = /[\u3400-\u9fff]/;
  const INLINE_READING_SURFACE_CHAR_RE = /[\u3040-\u30ff\u3400-\u9fff々〆ヵヶー・]/u;
  const INLINE_READING_KANA_RE = /^[\u3040-\u30ffーゝゞヽヾ・･\s]+$/u;
  const INLINE_READING_MAX_SURFACE_LENGTH = 40;
  const INLINE_READING_MAX_READING_LENGTH = 80;

  function findInlineReadingRanges(text) {
    const ranges = [];
    const value = String(text || "");

    for (let index = 0; index < value.length; index += 1) {
      const open = value[index];
      const close = open === "（" ? "）" : open === "(" ? ")" : null;
      if (!close) continue;

      const closeIndex = value.indexOf(close, index + 1);
      if (closeIndex < 0) continue;

      const reading = value.slice(index + 1, closeIndex).trim();
      if (!isInlineKanaReading(reading)) continue;

      let surfaceEnd = index;
      while (surfaceEnd > 0 && /\s/u.test(value[surfaceEnd - 1])) surfaceEnd -= 1;

      let surfaceStart = surfaceEnd;
      while (
        surfaceStart > 0 &&
        surfaceEnd - surfaceStart < INLINE_READING_MAX_SURFACE_LENGTH &&
        INLINE_READING_SURFACE_CHAR_RE.test(value[surfaceStart - 1])
      ) {
        surfaceStart -= 1;
      }

      const bestSurfaceStart = findBestInlineReadingSurfaceStart(value, surfaceStart, surfaceEnd, reading);
      if (bestSurfaceStart === null) continue;

      surfaceStart = bestSurfaceStart;
      const surface = value.slice(surfaceStart, surfaceEnd);
      if (!surface || !KANJI_RE.test(surface)) continue;

      ranges.push({
        start: surfaceStart,
        end: surfaceEnd,
        reading,
        source: "inline_parenthetical"
      });
      index = closeIndex;
    }

    return mergeRanges(ranges);
  }

  function suppressTokensCoveredByInlineReadings(text, tokens) {
    const ranges = findSupportedInlineReadingRanges(text, tokens);
    if (ranges.length === 0) return tokens || [];
    return (tokens || []).filter((token) => !isTokenCoveredByInlineReading(token, ranges));
  }

  function findSupportedInlineReadingRanges(text, tokens) {
    return findInlineReadingRanges(text).filter((range) => isInlineReadingSupportedByTokens(range, tokens));
  }

  function createEvidenceAwareAnalyzer(analyzer) {
    if (!analyzer) return analyzer;
    return new EvidenceAwareAnalyzer(analyzer);
  }

  class EvidenceAwareAnalyzer {
    constructor(analyzer) {
      this.analyzer = analyzer;
    }

    analyze(text) {
      return suppressTokensCoveredByInlineReadings(text, this.analyzer.analyze(text));
    }

    async analyzeBatch(texts) {
      const tokenLists =
        typeof this.analyzer.analyzeBatch === "function"
          ? await this.analyzer.analyzeBatch(texts)
          : texts.map((text) => this.analyzer.analyze(text));
      return (tokenLists || []).map((tokens, index) => suppressTokensCoveredByInlineReadings(texts[index], tokens));
    }
  }

  function isInlineKanaReading(reading) {
    if (!reading || reading.length > INLINE_READING_MAX_READING_LENGTH) return false;
    return INLINE_READING_KANA_RE.test(reading);
  }

  function isInlineReadingSupportedByTokens(range, tokens) {
    const coveredTokens = (tokens || []).filter((token) => isTokenCoveredByInlineReading(token, [range]));
    if (coveredTokens.length === 0) return false;

    const rangeLength = range.end - range.start;
    const coveredLength = coveredTokens.reduce((sum, token) => sum + Math.max(0, token.end - token.start), 0);
    if (coveredLength / rangeLength < 0.5) return false;

    const evidenceReading = normalizeKanaForComparison(range.reading);
    const tokenReading = normalizeKanaForComparison(
      coveredTokens.map((token) => token.readingKana || token.reading || "").join("")
    );
    if (!evidenceReading || !tokenReading) return false;
    if (evidenceReading === tokenReading) return true;
    if (evidenceReading.includes(tokenReading) || tokenReading.includes(evidenceReading)) return true;

    const overlap = longestCommonSubsequenceLength(evidenceReading, tokenReading);
    return overlap >= 2 && overlap / Math.min(evidenceReading.length, tokenReading.length) >= 0.5;
  }

  function findBestInlineReadingSurfaceStart(value, runStart, surfaceEnd, reading) {
    const normalizedReading = normalizeKanaForComparison(reading);
    for (let candidateStart = runStart; candidateStart < surfaceEnd; candidateStart += 1) {
      const surface = value.slice(candidateStart, surfaceEnd);
      if (!KANJI_RE.test(surface)) continue;

      const kanaProjection = normalizeKanaForComparison(surface.replace(/[^\u3040-\u30ffーゝゞヽヾ・･\s]/gu, ""));
      if (kanaProjection && !isSubsequence(kanaProjection, normalizedReading)) continue;
      return candidateStart;
    }
    return null;
  }

  function normalizeKanaForComparison(value) {
    return String(value || "")
      .replace(/[\u30a1-\u30f6]/gu, (character) => String.fromCharCode(character.charCodeAt(0) - 0x60))
      .replace(/[・･\s]/gu, "");
  }

  function isSubsequence(needle, haystack) {
    let haystackIndex = 0;
    for (const character of needle) {
      haystackIndex = haystack.indexOf(character, haystackIndex);
      if (haystackIndex < 0) return false;
      haystackIndex += character.length;
    }
    return true;
  }

  function longestCommonSubsequenceLength(left, right) {
    if (!left || !right) return 0;
    const previous = new Array(right.length + 1).fill(0);
    const current = new Array(right.length + 1).fill(0);

    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
      for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
        current[rightIndex] =
          left[leftIndex - 1] === right[rightIndex - 1]
            ? previous[rightIndex - 1] + 1
            : Math.max(previous[rightIndex], current[rightIndex - 1]);
      }
      for (let index = 0; index < current.length; index += 1) {
        previous[index] = current[index];
        current[index] = 0;
      }
    }

    return previous[right.length];
  }

  function isTokenCoveredByInlineReading(token, ranges) {
    if (!Array.isArray(ranges) || ranges.length === 0) return false;
    if (!Number.isFinite(token?.start) || !Number.isFinite(token?.end) || token.end <= token.start) return false;
    return ranges.some((range) => token.start >= range.start && token.end <= range.end);
  }

  function mergeRanges(ranges) {
    if (ranges.length <= 1) return ranges;
    const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [sorted[0]];

    for (const range of sorted.slice(1)) {
      const previous = merged[merged.length - 1];
      if (range.start <= previous.end) {
        previous.end = Math.max(previous.end, range.end);
        continue;
      }
      merged.push(range);
    }

    return merged;
  }

  window.FadingFuriganaReadingEvidence = {
    EvidenceAwareAnalyzer,
    createEvidenceAwareAnalyzer,
    findInlineReadingRanges,
    findSupportedInlineReadingRanges,
    isInlineReadingSupportedByTokens,
    isTokenCoveredByInlineReading,
    suppressTokensCoveredByInlineReadings
  };
})();
