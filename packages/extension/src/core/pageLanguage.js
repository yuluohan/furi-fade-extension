(() => {
  "use strict";

  const KANA_RE = /[\u3040-\u30ff]/g;
  const HAN_RE = /[\u3400-\u9fff]/g;
  const TEXT_SAMPLE_LIMIT = 8000;
  const MIN_HAN_FOR_HEURISTIC = 50;
  const MAX_KANA_RATIO_FOR_CHINESE = 0.02;

  function normalizeDeclaredLanguage(language) {
    return String(language || "").trim().toLowerCase();
  }

  function countMatches(text, re) {
    return (text.match(re) || []).length;
  }

  function detectPageLanguageProfile(doc) {
    const declaredLanguage = normalizeDeclaredLanguage(doc?.documentElement?.lang);
    const sampleText = String(doc?.body?.textContent || "").slice(0, TEXT_SAMPLE_LIMIT);

    return {
      declaredLanguage,
      kanaCount: countMatches(sampleText, KANA_RE),
      hanCount: countMatches(sampleText, HAN_RE)
    };
  }

  function isLikelyChinesePage(doc = window.document) {
    const profile = detectPageLanguageProfile(doc);

    if (profile.declaredLanguage.startsWith("ja")) return false;
    if (profile.declaredLanguage.startsWith("zh")) return true;

    // Japanese text always mixes kana into han; a han-heavy page with almost
    // no kana reads as Chinese even without a declared language.
    return (
      profile.hanCount >= MIN_HAN_FOR_HEURISTIC &&
      profile.kanaCount < profile.hanCount * MAX_KANA_RATIO_FOR_CHINESE
    );
  }

  function isPageEligibleForAnnotation(doc = window.document) {
    return !isLikelyChinesePage(doc);
  }

  window.FadingFuriganaPageLanguage = {
    detectPageLanguageProfile,
    isLikelyChinesePage,
    isPageEligibleForAnnotation
  };
})();
