(() => {
  "use strict";

  function shouldAnnotate(token, userState, settings) {
    const annotation = settings?.annotation || {};
    const mode = annotation.mode || "adaptive";

    if (!annotation.enabled || mode === "off") return false;
    if (userState?.lifecycleStatus === "ignored") return false;
    if (userState?.userIntent?.pinnedAnnotation) return true;
    if (annotation.hideKnownItems && getKnowledgeConfidence(userState) >= 0.85) return false;
    if (isHiddenByUserLevel(token, annotation, userState)) return false;
    if (mode === "all_items") return true;
    if (mode === "unknown_items_only") return !userState || getKnowledgeConfidence(userState) < 0.85;
    if (mode === "saved_items_only") return userState?.userIntent?.saved === true;
    if (mode === "adaptive") return getSourceConfidence(token) > 0.5;
    return false;
  }

  function getAnnotationLevel(userState, settings) {
    const annotation = settings?.annotation || {};
    if (!annotation.enabled || annotation.mode === "off") return "hidden";
    if (userState?.lifecycleStatus === "ignored") return "hidden";
    if (userState?.userIntent?.pinnedAnnotation) return userState?.annotationLevel || "full_ruby";
    if (annotation.hideKnownItems && getKnowledgeConfidence(userState) >= 0.85) return "hidden";
    if (isHiddenByUserLevel(null, annotation, userState)) return "hidden";
    return userState?.annotationLevel || "full_ruby";
  }

  function getKnowledgeConfidence(userState) {
    return typeof userState?.knowledgeConfidence === "number" ? userState.knowledgeConfidence : 0;
  }

  function getSourceConfidence(token) {
    return typeof token?.source?.confidence === "number" ? token.source.confidence : 0;
  }

  const LEVEL_RANK = {
    none: 0,
    n5: 1,
    n4: 2,
    n3: 3,
    n2: 4,
    n1: 5
  };

  function isHiddenByUserLevel(token, annotation, userState) {
    const userLevel = normalizeLevel(annotation.userLevel);
    if (userLevel === "none") return false;
    if (userState?.userIntent?.saved) return false;
    if (userState?.lifecycleStatus === "learning") return false;
    if (userState?.userIntent?.manuallyMarkedUnknown) return false;

    const wordLevel = normalizeLevel(
      token?.difficulty?.jlptLevel || userState?.intelligence?.inferredDifficulty?.jlptLevel
    );
    if (wordLevel === "none") return false;
    return LEVEL_RANK[wordLevel] <= LEVEL_RANK[userLevel];
  }

  function normalizeLevel(level) {
    const normalized = String(level || "none").toLowerCase();
    return Object.prototype.hasOwnProperty.call(LEVEL_RANK, normalized) ? normalized : "none";
  }

  window.FadingFuriganaAnnotationDecision = {
    getAnnotationLevel,
    isHiddenByUserLevel,
    shouldAnnotate
  };
})();
