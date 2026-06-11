const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "..");

function loadBrowserScript(relativePath) {
  const filePath = path.join(rootDir, relativePath);
  vm.runInThisContext(fs.readFileSync(filePath, "utf8"), { filename: filePath });
}

function test(name, fn) {
  try {
    fn();
    console.log(`[pass] ${name}`);
  } catch (error) {
    console.error(`[fail] ${name}`);
    throw error;
  }
}

global.window = global;
loadBrowserScript("src/core/annotationDecision.js");

const token = {
  lexicalItemId: "確認:かくにん",
  source: {
    provider: "sample",
    confidence: 1
  }
};

const baseSettings = {
  annotation: {
    enabled: true,
    mode: "adaptive",
    hideKnownItems: true
  }
};

test("adaptive mode annotates confident dictionary-backed token", () => {
  assert.equal(window.FadingFuriganaAnnotationDecision.shouldAnnotate(token, null, baseSettings), true);
});

test("disabled annotation never annotates", () => {
  const settings = {
    annotation: {
      ...baseSettings.annotation,
      enabled: false
    }
  };
  assert.equal(window.FadingFuriganaAnnotationDecision.shouldAnnotate(token, null, settings), false);
});

test("ignored state never annotates", () => {
  const userState = {
    lifecycleStatus: "ignored",
    knowledgeConfidence: 0,
    userIntent: {
      saved: false
    }
  };
  assert.equal(window.FadingFuriganaAnnotationDecision.shouldAnnotate(token, userState, baseSettings), false);
});

test("known item is hidden when hideKnownItems is enabled", () => {
  const userState = {
    lifecycleStatus: "known",
    knowledgeConfidence: 0.9,
    userIntent: {
      saved: true
    }
  };
  assert.equal(window.FadingFuriganaAnnotationDecision.shouldAnnotate(token, userState, baseSettings), false);
  assert.equal(window.FadingFuriganaAnnotationDecision.getAnnotationLevel(userState, baseSettings), "hidden");
});

test("saved_items_only annotates saved items only", () => {
  const settings = {
    annotation: {
      ...baseSettings.annotation,
      mode: "saved_items_only"
    }
  };
  assert.equal(window.FadingFuriganaAnnotationDecision.shouldAnnotate(token, null, settings), false);
  assert.equal(
    window.FadingFuriganaAnnotationDecision.shouldAnnotate(token, {
      lifecycleStatus: "learning",
      knowledgeConfidence: 0.2,
      userIntent: {
        saved: true
      }
    }, settings),
    true
  );
});

test("unknown_items_only does not annotate high-confidence item", () => {
  const settings = {
    annotation: {
      ...baseSettings.annotation,
      mode: "unknown_items_only"
    }
  };
  assert.equal(
    window.FadingFuriganaAnnotationDecision.shouldAnnotate(token, {
      lifecycleStatus: "known",
      knowledgeConfidence: 0.95,
      userIntent: {
        saved: true
      }
    }, settings),
    false
  );
});

test("user level hides words at or below the selected level", () => {
  const settings = {
    annotation: {
      ...baseSettings.annotation,
      userLevel: "n3"
    }
  };
  const n4Token = {
    ...token,
    difficulty: {
      jlptLevel: "n4"
    }
  };
  const n2Token = {
    ...token,
    difficulty: {
      jlptLevel: "n2"
    }
  };

  assert.equal(window.FadingFuriganaAnnotationDecision.shouldAnnotate(n4Token, null, settings), false);
  assert.equal(window.FadingFuriganaAnnotationDecision.shouldAnnotate(n2Token, null, settings), true);
});

test("saved and pinned words override level filtering", () => {
  const settings = {
    annotation: {
      ...baseSettings.annotation,
      userLevel: "n2"
    }
  };
  const easyToken = {
    ...token,
    difficulty: {
      jlptLevel: "n5"
    }
  };

  assert.equal(
    window.FadingFuriganaAnnotationDecision.shouldAnnotate(easyToken, {
      lifecycleStatus: "learning",
      knowledgeConfidence: 0.2,
      userIntent: { saved: true }
    }, settings),
    true
  );
  assert.equal(
    window.FadingFuriganaAnnotationDecision.shouldAnnotate(easyToken, {
      lifecycleStatus: "known",
      knowledgeConfidence: 0.9,
      userIntent: { pinnedAnnotation: true }
    }, settings),
    true
  );
});
