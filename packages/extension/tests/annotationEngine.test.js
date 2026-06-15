const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "..");

function loadBrowserScript(relativePath) {
  const filePath = path.join(rootDir, relativePath);
  vm.runInThisContext(fs.readFileSync(filePath, "utf8"), { filename: filePath });
}

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

async function runTests() {
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`[pass] ${name}`);
    } catch (error) {
      console.error(`[fail] ${name}`);
      throw error;
    }
  }
}

function createElement({ tagName = "P", parentElement = null, attributes = {}, hidden = false, isContentEditable = false } = {}) {
  return {
    tagName,
    parentElement,
    hidden,
    isContentEditable,
    getAttribute(name) {
      return attributes[name] ?? null;
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name);
    }
  };
}

global.window = global;
global.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
global.NodeFilter = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };
global.MutationObserver = class {
  observe() {}
  disconnect() {}
};
loadBrowserScript("src/core/annotationDecision.js");
loadBrowserScript("src/content/annotationEngine.js");

const {
  AnnotationEngine,
  extractSentence,
  getAnnotationStatus,
  isSiteAnnotationPaused,
  shouldSkipTextNode,
  shouldUseTapOnlyInLayout,
  shouldUseTapOnlyInSmartContext
} = window.FadingFuriganaAnnotationEngine;

class FakeTextNode {
  constructor(nodeValue) {
    this.nodeType = Node.TEXT_NODE;
    this.nodeValue = nodeValue;
    this.parentElement = null;
  }

  get textContent() {
    return this.nodeValue;
  }

  replaceWith(replacement) {
    replaceChild(this, replacement);
  }
}

class FakeElement {
  constructor(tagName) {
    this.nodeType = Node.ELEMENT_NODE;
    this.tagName = tagName.toUpperCase();
    this.parentElement = null;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.className = "";
    this.classList = {
      add: (...classNames) => {
        const existing = new Set(this.className.split(/\s+/u).filter(Boolean));
        for (const className of classNames) existing.add(className);
        this.className = [...existing].join(" ");
      }
    };
    this.style = {
      values: {},
      setProperty: (name, value) => {
        this.style.values[name] = value;
      },
      getPropertyValue: (name) => this.style.values[name] || ""
    };
    this.hidden = false;
    this.isContentEditable = false;
    this.computedStyle = null;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }

  get textContent() {
    return this.children.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    this.children = [new FakeTextNode(String(value))];
    this.children[0].parentElement = this;
  }

  replaceWith(replacement) {
    replaceChild(this, replacement);
  }

  closest(selector) {
    if (selector === "a[href]") {
      let element = this;
      while (element) {
        if (element.tagName === "A" && element.attributes.href) return element;
        element = element.parentElement;
      }
      return null;
    }
    if (selector !== ".jr-ruby") return null;
    let element = this;
    while (element) {
      if (element.className?.split(" ").includes("jr-ruby")) return element;
      element = element.parentElement;
    }
    return null;
  }
}

class FakeDocumentFragment {
  constructor() {
    this.children = [];
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }
}

function replaceChild(oldNode, replacement) {
  const parent = oldNode.parentElement;
  if (!parent) return;

  const index = parent.children.indexOf(oldNode);
  if (index < 0) return;

  const replacements = replacement instanceof FakeDocumentFragment ? replacement.children : [replacement];
  for (const child of replacements) {
    child.parentElement = parent;
  }
  parent.children.splice(index, 1, ...replacements);
}

function collectTextNodes(root, acceptNode, nodes = []) {
  if (root.nodeType === Node.TEXT_NODE) {
    if (acceptNode(root) === NodeFilter.FILTER_ACCEPT) nodes.push(root);
    return nodes;
  }

  for (const child of root.children || []) {
    collectTextNodes(child, acceptNode, nodes);
  }
  return nodes;
}

function collectByClass(root, className, nodes = []) {
  if (root.className?.split(" ").includes(className)) nodes.push(root);
  for (const child of root.children || []) {
    collectByClass(child, className, nodes);
  }
  return nodes;
}

function createFakeDocument(root) {
  return {
    body: root,
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    createTextNode(text) {
      return new FakeTextNode(text);
    },
    createDocumentFragment() {
      return new FakeDocumentFragment();
    },
    createTreeWalker(rootNode, _whatToShow, filter) {
      const nodes = collectTextNodes(rootNode, filter.acceptNode);
      let index = -1;
      return {
        currentNode: null,
        nextNode() {
          index += 1;
          this.currentNode = nodes[index] || null;
          return Boolean(this.currentNode);
        }
      };
    },
    querySelectorAll(selector) {
      if (selector !== ".jr-ruby") return [];
      return collectByClass(root, "jr-ruby");
    }
  };
}

function serializeNode(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
  return `<${node.tagName.toLowerCase()} class="${node.className}">${node.children.map(serializeNode).join("")}</${node.tagName.toLowerCase()}>`;
}

function createEngine({ root, tokens, settings = {}, tooltip = { show() {} }, userState = null } = {}) {
  global.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  global.NodeFilter = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };
  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  global.document = createFakeDocument(root);
  global.getComputedStyle = (element) => element.computedStyle || {};

  const seenTokens = [];
  const repository = {
    settings: {
      annotation: {
        enabled: true,
        mode: "adaptive",
        hideKnownItems: true,
        ...settings.annotation
      },
      siteOverrides: settings.siteOverrides || {}
    },
    getUserWordState() {
      return userState;
    },
    recordSeen(token) {
      seenTokens.push(token.surface);
    }
  };

  const analyzer = {
    analyze() {
      return tokens;
    }
  };

  return {
    engine: new AnnotationEngine({ analyzer, repository, tooltip }),
    seenTokens
  };
}

function createToken(overrides = {}) {
  return {
    lexicalItemId: "word:確認:かくにん",
    surface: "確認",
    lemma: "確認",
    baseForm: "確認",
    reading: "かくにん",
    readingKana: "かくにん",
    meanings: {
      en: ["confirmation"],
      zhHans: ["确认"]
    },
    partOfSpeech: ["noun"],
    loanword: {},
    source: {
      confidence: 1
    },
    start: 7,
    end: 9,
    ...overrides
  };
}

test("extracts sentence around token start", () => {
  const text = "前の文です。メールの内容を確認してください。次の文です。";
  const start = text.indexOf("確認");

  assert.equal(extractSentence(text, start), "メールの内容を確認してください。");
});

test("does not skip Japanese text in normal paragraph", () => {
  const parentElement = createElement({ tagName: "P" });
  const node = {
    nodeValue: "申請には時間がかかります。",
    parentElement
  };

  assert.equal(shouldSkipTextNode(node), false);
});

test("skips text without Japanese characters", () => {
  const parentElement = createElement({ tagName: "P" });
  const node = {
    nodeValue: "plain English",
    parentElement
  };

  assert.equal(shouldSkipTextNode(node), true);
});

test("skips code and preformatted text", () => {
  const parentElement = createElement({ tagName: "CODE" });
  const node = {
    nodeValue: "確認",
    parentElement
  };

  assert.equal(shouldSkipTextNode(node), true);
});

test("skips hidden or explicitly ignored content", () => {
  const hiddenParent = createElement({ tagName: "P", hidden: true });
  const ignoredParent = createElement({
    tagName: "P",
    attributes: {
      "data-fading-furigana-ignore": ""
    }
  });

  assert.equal(shouldSkipTextNode({ nodeValue: "確認", parentElement: hiddenParent }), true);
  assert.equal(shouldSkipTextNode({ nodeValue: "確認", parentElement: ignoredParent }), true);
});

test("skips descendants of existing annotations", () => {
  const annotationParent = createElement({
    tagName: "SPAN",
    attributes: {
      "data-jr-annotated": "true"
    }
  });
  const child = createElement({ tagName: "SPAN", parentElement: annotationParent });

  assert.equal(shouldSkipTextNode({ nodeValue: "確認", parentElement: child }), true);
});

test("annotates text nodes with ruby output and records exposure", async () => {
  const root = new FakeElement("div");
  root.appendChild(new FakeTextNode("メールの内容を確認してください。"));
  const token = createToken();
  const { engine, seenTokens } = createEngine({ root, tokens: [token] });

  await engine.annotateRoot(root);

  const ruby = collectByClass(root, "jr-ruby")[0];
  assert.equal(ruby.dataset.surface, "確認");
  assert.equal(ruby.dataset.readingKana, "かくにん");
  assert.equal(ruby.dataset.sourceSentence, "メールの内容を確認してください。");
  assert.equal(ruby.children[1].tagName, "RT");
  assert.equal(ruby.children[1].textContent, "かくにん");
  assert.deepEqual(seenTokens, ["確認"]);
  assert.equal(
    serializeNode(root),
    '<div class="">メールの内容を<ruby class="jr-ruby jr-ruby--status-new">確認<rt class="">かくにん</rt></ruby>してください。</div>'
  );
});

test("skips annotation when the page is not eligible", async () => {
  const root = new FakeElement("div");
  root.appendChild(new FakeTextNode("メールの内容を確認してください。"));
  const { engine, seenTokens } = createEngine({ root, tokens: [createToken()] });
  engine.isPageEligible = () => false;

  await engine.annotateRoot(root);

  assert.equal(collectByClass(root, "jr-ruby").length, 0);
  assert.deepEqual(seenTokens, []);
});

test("skips annotation when the current site is paused", async () => {
  global.location = { hostname: "example.com" };
  const root = new FakeElement("div");
  root.appendChild(new FakeTextNode("メールの内容を確認してください。"));
  const { engine, seenTokens } = createEngine({
    root,
    tokens: [createToken()],
    settings: {
      siteOverrides: {
        "example.com": {
          annotationEnabled: false
        }
      }
    }
  });

  await engine.annotateRoot(root);

  assert.equal(isSiteAnnotationPaused(engine.repository.settings, "example.com"), true);
  assert.equal(collectByClass(root, "jr-ruby").length, 0);
  assert.deepEqual(seenTokens, []);
});


test("uses loanword original form as ruby text", async () => {
  const root = new FakeElement("div");
  root.appendChild(new FakeTextNode("サーバーの状態を確認してください。"));
  const token = createToken({
    lexicalItemId: "word:サーバー:server",
    surface: "サーバー",
    lemma: "サーバー",
    baseForm: "サーバー",
    reading: "サーバー",
    readingKana: "サーバー",
    meanings: {
      en: ["server"],
      zhHans: ["服务器"]
    },
    loanword: {
      isLoanword: true,
      originLanguage: "en",
      originalForm: "server",
      confidence: 0.9
    },
    start: 0,
    end: 4
  });
  const { engine } = createEngine({ root, tokens: [token] });

  await engine.annotateRoot(root);

  const ruby = collectByClass(root, "jr-ruby")[0];
  assert.equal(ruby.dataset.surface, "サーバー");
  assert.equal(ruby.children[1].textContent, "server");
});

test("applies custom annotation color for saved word status", async () => {
  const root = new FakeElement("div");
  root.appendChild(new FakeTextNode("メールの内容を確認してください。"));
  const { engine } = createEngine({
    root,
    tokens: [createToken()],
    settings: {
      annotation: {
        statusColors: {
          saved: "#123ABC"
        }
      }
    },
    userState: {
      lifecycleStatus: "learning",
      userIntent: {
        saved: true
      },
      learning: {
        reviewStage: "learning"
      }
    }
  });

  await engine.annotateRoot(root);

  const ruby = collectByClass(root, "jr-ruby")[0];
  assert.equal(getAnnotationStatus(engine.repository.getUserWordState()), "saved");
  assert.equal(ruby.dataset.wordStatus, "saved");
  assert.equal(ruby.className, "jr-ruby jr-ruby--status-saved");
  assert.equal(ruby.style.getPropertyValue("--jr-accent-color"), "#123ABC");
  assert.equal(ruby.style.getPropertyValue("--jr-accent-rgb"), "18, 58, 188");
});

test("prioritizes lapsed status over saved status", () => {
  assert.equal(
    getAnnotationStatus({
      lifecycleStatus: "learning",
      userIntent: {
        saved: true
      },
      learning: {
        reviewStage: "lapsed"
      }
    }),
    "lapsed"
  );
});

test("uses tap-only annotation inside constrained layout", async () => {
  const root = new FakeElement("div");
  const paragraph = new FakeElement("p");
  paragraph.computedStyle = {
    overflow: "hidden",
    overflowY: "hidden",
    height: "36px",
    maxHeight: "36px",
    lineHeight: "16px",
    webkitLineClamp: "2"
  };
  paragraph.appendChild(new FakeTextNode("メールの内容を確認してください。"));
  root.appendChild(paragraph);

  const { engine, seenTokens } = createEngine({ root, tokens: [createToken()] });

  await engine.annotateRoot(root);

  const annotation = collectByClass(root, "jr-ruby")[0];
  assert.equal(shouldUseTapOnlyInLayout(paragraph, { constrainedLayoutMode: "tap_only" }), true);
  assert.equal(annotation.tagName, "SPAN");
  assert.equal(annotation.className, "jr-ruby jr-ruby--tap-only jr-ruby--status-new");
  assert.equal(annotation.textContent, "確認");
  assert.equal(annotation.children.some((child) => child.tagName === "RT"), false);
  assert.deepEqual(seenTokens, ["確認"]);
});

test("uses tap-only annotation in smart page chrome contexts", async () => {
  const root = new FakeElement("div");
  const heading = new FakeElement("h2");
  heading.appendChild(new FakeTextNode("重要な確認"));
  root.appendChild(heading);

  const { engine } = createEngine({
    root,
    tokens: [createToken({ start: 3, end: 5 })]
  });

  await engine.annotateRoot(root);

  const annotation = collectByClass(root, "jr-ruby")[0];
  assert.equal(shouldUseTapOnlyInSmartContext(heading, "重要な確認", { useSmartContextDisplay: true }), true);
  assert.equal(annotation.tagName, "SPAN");
  assert.equal(annotation.className, "jr-ruby jr-ruby--tap-only jr-ruby--status-new");
});

test("keeps link clicks working while allowing Option-click tooltips", async () => {
  const root = new FakeElement("div");
  const link = new FakeElement("a");
  link.setAttribute("href", "https://example.com/article");
  link.appendChild(new FakeTextNode("確認ページ"));
  root.appendChild(link);

  let tooltipShown = false;
  const { engine } = createEngine({
    root,
    tokens: [createToken({ start: 0, end: 2 })],
    tooltip: {
      show() {
        tooltipShown = true;
      }
    }
  });

  await engine.annotateRoot(root);
  const annotation = collectByClass(root, "jr-ruby")[0];
  const normalClick = {
    target: annotation,
    altKey: false,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    }
  };

  engine.onClick(normalClick);

  assert.equal(tooltipShown, false);
  assert.equal(normalClick.defaultPrevented, false);
  assert.equal(normalClick.propagationStopped, false);

  const optionClick = {
    target: annotation,
    altKey: true,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    }
  };

  engine.onClick(optionClick);

  assert.equal(tooltipShown, true);
  assert.equal(optionClick.defaultPrevented, true);
  assert.equal(optionClick.propagationStopped, true);
});

test("passes dictionary-form readings through ruby dataset to the tooltip", async () => {
  const root = new FakeElement("div");
  root.appendChild(new FakeTextNode("ここでは誤った表示が出ます。"));

  let tooltipToken = null;
  const { engine } = createEngine({
    root,
    tokens: [
      createToken({
        lexicalItemId: "誤る:あやまる",
        surface: "誤っ",
        lemma: "誤る",
        baseForm: "誤る",
        reading: "あやまっ",
        readingKana: "あやまっ",
        baseReadingKana: "あやまる",
        start: 4,
        end: 6
      })
    ],
    tooltip: {
      show(_target, token) {
        tooltipToken = token;
      }
    }
  });

  await engine.annotateRoot(root);
  engine.onClick({
    target: collectByClass(root, "jr-ruby")[0],
    altKey: false,
    preventDefault() {},
    stopPropagation() {}
  });

  assert.equal(tooltipToken.surface, "誤っ");
  assert.equal(tooltipToken.baseForm, "誤る");
  assert.equal(tooltipToken.readingKana, "あやまっ");
  assert.equal(tooltipToken.baseReadingKana, "あやまる");
});

test("keeps normal paragraph ruby while smart context display is enabled", async () => {
  const root = new FakeElement("div");
  const paragraph = new FakeElement("p");
  paragraph.computedStyle = {
    overflow: "visible",
    lineHeight: "24px"
  };
  paragraph.appendChild(new FakeTextNode("メールの内容を確認してください。"));
  root.appendChild(paragraph);

  const { engine } = createEngine({ root, tokens: [createToken()] });

  await engine.annotateRoot(root);

  const annotation = collectByClass(root, "jr-ruby")[0];
  assert.equal(shouldUseTapOnlyInSmartContext(paragraph, "メールの内容を確認してください。", { useSmartContextDisplay: true }), false);
  assert.equal(annotation.tagName, "RUBY");
});

test("smart page chrome display can be disabled", async () => {
  const root = new FakeElement("div");
  const heading = new FakeElement("h2");
  heading.appendChild(new FakeTextNode("重要な確認"));
  root.appendChild(heading);

  const { engine } = createEngine({
    root,
    tokens: [createToken({ start: 3, end: 5 })],
    settings: {
      annotation: {
        useSmartContextDisplay: false
      }
    }
  });

  await engine.annotateRoot(root);

  const annotation = collectByClass(root, "jr-ruby")[0];
  assert.equal(shouldUseTapOnlyInSmartContext(heading, "重要な確認", { useSmartContextDisplay: false }), false);
  assert.equal(annotation.tagName, "RUBY");
});

test("uses tap-only annotation globally in compact display mode", async () => {
  const root = new FakeElement("div");
  const paragraph = new FakeElement("p");
  paragraph.computedStyle = {
    overflow: "visible",
    lineHeight: "24px"
  };
  paragraph.appendChild(new FakeTextNode("メールの内容を確認してください。"));
  root.appendChild(paragraph);

  const { engine } = createEngine({
    root,
    tokens: [createToken()],
    settings: {
      annotation: {
        constrainedLayoutMode: "compact"
      }
    }
  });

  await engine.annotateRoot(root);

  const annotation = collectByClass(root, "jr-ruby")[0];
  assert.equal(shouldUseTapOnlyInLayout(paragraph, { constrainedLayoutMode: "compact" }), true);
  assert.equal(annotation.tagName, "SPAN");
  assert.equal(annotation.className, "jr-ruby jr-ruby--tap-only jr-ruby--status-new");
  assert.equal(annotation.children.some((child) => child.tagName === "RT"), false);
});

test("does not re-annotate descendants of existing ruby annotations", async () => {
  const root = new FakeElement("div");
  root.appendChild(new FakeTextNode("確認"));

  const existingRuby = new FakeElement("ruby");
  existingRuby.className = "jr-ruby";
  existingRuby.setAttribute("data-jr-annotated", "true");
  existingRuby.appendChild(new FakeTextNode("確認"));
  root.appendChild(existingRuby);

  const { engine, seenTokens } = createEngine({
    root,
    tokens: [createToken({ start: 0, end: 2 })]
  });

  await engine.annotateRoot(root);

  assert.equal(collectByClass(root, "jr-ruby").length, 2);
  assert.deepEqual(seenTokens, ["確認"]);
});

test("restores generated ruby annotations to their original text", async () => {
  const root = new FakeElement("div");
  root.appendChild(new FakeTextNode("メールの内容を確認してください。"));
  const { engine } = createEngine({ root, tokens: [createToken()] });

  await engine.annotateRoot(root);
  assert.equal(collectByClass(root, "jr-ruby").length, 1);

  engine.restore();

  assert.equal(collectByClass(root, "jr-ruby").length, 0);
  assert.equal(root.textContent, "メールの内容を確認してください。");
  assert.equal(serializeNode(root), '<div class="">メールの内容を確認してください。</div>');
});

test("does not re-analyze already processed nodes", async () => {
  const root = new FakeElement("div");
  root.appendChild(new FakeTextNode("メールの内容を確認してください。"));
  const { engine } = createEngine({ root, tokens: [] });
  let analyzeCalls = 0;
  engine.analyzer = {
    analyze() {
      analyzeCalls += 1;
      return [createToken()];
    }
  };

  await engine.annotateRoot(root);
  await engine.annotateRoot(root);

  assert.equal(analyzeCalls, 1);
  assert.equal(collectByClass(root, "jr-ruby").length, 1);
});

test("refresh clears processed tracking and re-annotates", async () => {
  const root = new FakeElement("div");
  root.appendChild(new FakeTextNode("メールの内容を確認してください。"));
  const { engine } = createEngine({ root, tokens: [] });
  engine.analyzer = {
    analyze(text) {
      const start = text.indexOf("確認");
      return start < 0 ? [] : [createToken({ start, end: start + 2 })];
    }
  };

  await engine.annotateRoot(root);
  assert.equal(collectByClass(root, "jr-ruby").length, 1);

  await engine.refresh();

  const rubies = collectByClass(root, "jr-ruby");
  assert.equal(rubies.length, 1);
  assert.equal(rubies[0].dataset.surface, "確認");
});

test("records one exposure per word per page", async () => {
  const root = new FakeElement("div");
  root.appendChild(new FakeTextNode("確認します。"));
  root.appendChild(new FakeTextNode("もう一度確認します。"));
  const { engine, seenTokens } = createEngine({ root, tokens: [] });
  engine.analyzer = {
    analyze(text) {
      const start = text.indexOf("確認");
      return start < 0 ? [] : [createToken({ start, end: start + 2 })];
    }
  };

  await engine.annotateRoot(root);

  assert.equal(collectByClass(root, "jr-ruby").length, 2);
  assert.deepEqual(seenTokens, ["確認"]);
});

test("suspends annotation after exhausting the page budget", async () => {
  const root = new FakeElement("div");
  root.appendChild(new FakeTextNode("確認します。"));
  root.appendChild(new FakeTextNode("申請します。"));
  const { engine } = createEngine({ root, tokens: [createToken({ start: 0, end: 2 })] });
  engine.remainingNodeBudget = 1;

  await engine.annotateRoot(root);

  assert.equal(engine.suspended, true);
  assert.equal(collectByClass(root, "jr-ruby").length, 1);

  await engine.annotateRoot(root);
  assert.equal(collectByClass(root, "jr-ruby").length, 1);
});

test("waits for the page to settle before annotating", async () => {
  const root = new FakeElement("div");
  root.appendChild(new FakeTextNode("メールの内容を確認してください。"));
  const { engine } = createEngine({ root, tokens: [createToken()] });

  // A foreign mutation just happened: annotation must hold back.
  engine.lastForeignMutationAt = Date.now();
  await engine.annotateRoot(root);

  assert.equal(collectByClass(root, "jr-ruby").length, 0);
  assert.equal(engine.pendingRoots.size > 0, true);
  window.clearTimeout(engine.scheduleTimer);

  // Once the page has been quiet long enough, the deferred pass annotates.
  engine.lastForeignMutationAt = Date.now() - 1000;
  await engine.annotatePending();

  assert.equal(collectByClass(root, "jr-ruby").length, 1);
});

test("backs off from elements that keep getting re-annotated", async () => {
  const paragraph = new FakeElement("p");
  paragraph.appendChild(new FakeTextNode("確認します。"));
  const { engine } = createEngine({ root: paragraph, tokens: [] });
  engine.analyzer = {
    analyze(text) {
      const start = text.indexOf("確認");
      return start < 0 ? [] : [createToken({ start, end: start + 2 })];
    }
  };

  // Simulate a framework restoring plain text after each annotation pass.
  for (let round = 0; round < 5; round += 1) {
    await engine.annotateRoot(paragraph);
    assert.equal(collectByClass(paragraph, "jr-ruby").length, 1, `round ${round}`);
    paragraph.textContent = "確認します。";
  }

  // The element is now in cooldown: the next pass is deferred, not applied.
  await engine.annotateRoot(paragraph);
  assert.equal(collectByClass(paragraph, "jr-ruby").length, 0);
  assert.equal(engine.pendingRoots.size > 0, true);
  window.clearTimeout(engine.scheduleTimer);
});

test("defers annotation until elements scroll near the viewport", async () => {
  let observerInstance = null;
  global.IntersectionObserver = class {
    constructor(callback) {
      this.callback = callback;
      this.targets = new Set();
      observerInstance = this;
    }
    observe(element) {
      this.targets.add(element);
    }
    unobserve(element) {
      this.targets.delete(element);
    }
    disconnect() {
      this.targets.clear();
    }
  };

  try {
    const root = new FakeElement("div");
    const paragraph = new FakeElement("p");
    paragraph.appendChild(new FakeTextNode("メールの内容を確認してください。"));
    root.appendChild(paragraph);
    const { engine, seenTokens } = createEngine({ root, tokens: [createToken()] });

    await engine.annotateRoot(root);

    // Nothing is annotated until the paragraph becomes visible.
    assert.equal(collectByClass(root, "jr-ruby").length, 0);
    assert.equal(observerInstance.targets.has(paragraph), true);

    observerInstance.callback([{ target: paragraph, isIntersecting: true }], observerInstance);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(collectByClass(root, "jr-ruby").length, 1);
    assert.deepEqual(seenTokens, ["確認"]);
  } finally {
    delete global.IntersectionObserver;
  }
});

test("refreshWord removes only that word's annotations without re-analyzing", async () => {
  const root = new FakeElement("div");
  root.appendChild(new FakeTextNode("確認します。"));
  root.appendChild(new FakeTextNode("申請します。"));
  const { engine } = createEngine({ root, tokens: [] });
  let analyzeCalls = 0;
  engine.analyzer = {
    analyze(text) {
      analyzeCalls += 1;
      if (text.includes("確認")) return [createToken({ start: 0, end: 2 })];
      if (text.includes("申請")) {
        return [createToken({ lexicalItemId: "word:申請:しんせい", surface: "申請", start: 0, end: 2 })];
      }
      return [];
    }
  };

  await engine.annotateRoot(root);
  assert.equal(collectByClass(root, "jr-ruby").length, 2);

  const analyzeCallsBefore = analyzeCalls;
  engine.repository.getUserWordState = (id) =>
    id === "word:確認:かくにん" ? { lifecycleStatus: "mastered", knowledgeConfidence: 1 } : null;
  engine.refreshWord("word:確認:かくにん");

  const rubies = collectByClass(root, "jr-ruby");
  assert.equal(rubies.length, 1);
  assert.equal(rubies[0].dataset.surface, "申請");
  assert.equal(root.textContent.includes("確認します。"), true);
  assert.equal(analyzeCalls, analyzeCallsBefore);
});

test("refreshWord keeps annotations that should stay visible", async () => {
  const root = new FakeElement("div");
  root.appendChild(new FakeTextNode("確認します。"));
  const { engine } = createEngine({
    root,
    tokens: [createToken({ start: 0, end: 2 })],
    settings: {
      annotation: {
        statusColors: {
          saved: "#445566"
        }
      }
    }
  });

  await engine.annotateRoot(root);
  const annotation = collectByClass(root, "jr-ruby")[0];
  assert.equal(annotation.dataset.wordStatus, "new");

  engine.repository.getUserWordState = () => ({
    lifecycleStatus: "learning",
    knowledgeConfidence: 0.4,
    userIntent: { saved: true },
    learning: {
      reviewStage: "learning"
    }
  });
  engine.refreshWord("word:確認:かくにん");

  assert.equal(collectByClass(root, "jr-ruby").length, 1);
  assert.equal(annotation.dataset.wordStatus, "saved");
  assert.equal(annotation.className, "jr-ruby jr-ruby--status-saved");
  assert.equal(annotation.style.getPropertyValue("--jr-accent-color"), "#445566");
});

test("uses async batch analyzers when available", async () => {
  const root = new FakeElement("div");
  root.appendChild(new FakeTextNode("メールの内容を確認してください。"));
  const { engine } = createEngine({ root, tokens: [] });
  engine.analyzer = {
    async analyzeBatch(texts) {
      return texts.map(() => [createToken()]);
    }
  };

  await engine.annotateRoot(root);

  assert.equal(collectByClass(root, "jr-ruby").length, 1);
});

runTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
