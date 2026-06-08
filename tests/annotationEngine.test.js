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
};
loadBrowserScript("src/core/annotationDecision.js");
loadBrowserScript("src/content/annotationEngine.js");

const { AnnotationEngine, extractSentence, shouldSkipTextNode } = window.FadingFuriganaAnnotationEngine;

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
    this.hidden = false;
    this.isContentEditable = false;
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

function createEngine({ root, tokens }) {
  global.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  global.NodeFilter = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };
  global.MutationObserver = class {
    observe() {}
  };
  global.document = createFakeDocument(root);

  const seenTokens = [];
  const repository = {
    settings: {
      annotation: {
        enabled: true,
        mode: "adaptive",
        hideKnownItems: true
      }
    },
    getUserWordState() {
      return null;
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
    engine: new AnnotationEngine({ analyzer, repository, tooltip: { show() {} } }),
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

test("annotates text nodes with ruby output and records exposure", () => {
  const root = new FakeElement("div");
  root.appendChild(new FakeTextNode("メールの内容を確認してください。"));
  const token = createToken();
  const { engine, seenTokens } = createEngine({ root, tokens: [token] });

  engine.annotateRoot(root);

  const ruby = collectByClass(root, "jr-ruby")[0];
  assert.equal(ruby.dataset.surface, "確認");
  assert.equal(ruby.dataset.readingKana, "かくにん");
  assert.equal(ruby.dataset.sourceSentence, "メールの内容を確認してください。");
  assert.equal(ruby.children[1].tagName, "RT");
  assert.equal(ruby.children[1].textContent, "かくにん");
  assert.deepEqual(seenTokens, ["確認"]);
  assert.equal(
    serializeNode(root),
    '<div class="">メールの内容を<ruby class="jr-ruby">確認<rt class="">かくにん</rt></ruby>してください。</div>'
  );
});

test("uses loanword original form as ruby text", () => {
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

  engine.annotateRoot(root);

  const ruby = collectByClass(root, "jr-ruby")[0];
  assert.equal(ruby.dataset.surface, "サーバー");
  assert.equal(ruby.children[1].textContent, "server");
});

test("does not re-annotate descendants of existing ruby annotations", () => {
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

  engine.annotateRoot(root);

  assert.equal(collectByClass(root, "jr-ruby").length, 2);
  assert.deepEqual(seenTokens, ["確認"]);
});

test("restores generated ruby annotations to their original text", () => {
  const root = new FakeElement("div");
  root.appendChild(new FakeTextNode("メールの内容を確認してください。"));
  const { engine } = createEngine({ root, tokens: [createToken()] });

  engine.annotateRoot(root);
  assert.equal(collectByClass(root, "jr-ruby").length, 1);

  engine.restore();

  assert.equal(collectByClass(root, "jr-ruby").length, 0);
  assert.equal(root.textContent, "メールの内容を確認してください。");
  assert.equal(serializeNode(root), '<div class="">メールの内容を確認してください。</div>');
});
