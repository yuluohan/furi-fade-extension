(() => {
  "use strict";

  function shouldAnnotate(token, userState, settings) {
    const annotation = settings?.annotation || {};
    const mode = annotation.mode || "adaptive";

    if (!annotation.enabled || mode === "off") return false;
    if (userState?.lifecycleStatus === "ignored") return false;
    if (annotation.hideKnownItems && getKnowledgeConfidence(userState) >= 0.85) return false;
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
    if (annotation.hideKnownItems && getKnowledgeConfidence(userState) >= 0.85) return "hidden";
    return userState?.annotationLevel || "full_ruby";
  }

  function getKnowledgeConfidence(userState) {
    return typeof userState?.knowledgeConfidence === "number" ? userState.knowledgeConfidence : 0;
  }

  function getSourceConfidence(token) {
    return typeof token?.source?.confidence === "number" ? token.source.confidence : 0;
  }

  window.FadingFuriganaAnnotationDecision = {
    getAnnotationLevel,
    shouldAnnotate
  };
})();
