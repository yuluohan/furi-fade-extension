const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "..");

function loadBrowserScript(relativePath) {
  const filePath = path.join(rootDir, relativePath);
  vm.runInThisContext(fs.readFileSync(filePath, "utf8"), { filename: filePath });
}

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`[pass] ${name}`);
  } catch (error) {
    console.error(`[fail] ${name}`);
    throw error;
  }
}

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.className = "";
    this.hidden = false;
    this.textContent = "";
    this.style = {};
    this.disabled = false;
    this.listeners = {};
    this.childrenByClass = {};
    this.buttonsByAction = {};
  }

  set innerHTML(value) {
    this.html = value;
    this.childrenByClass = {
      "jr-tooltip__surface": new FakeElement(),
      "jr-tooltip__reading": new FakeElement(),
      "jr-tooltip__meaning": new FakeElement(),
      "jr-tooltip__sentence": new FakeElement(),
      "jr-tooltip__status": new FakeElement()
    };
    this.childrenByClass["jr-tooltip__status"].hidden = true;
    this.buttonsByAction = {
      save: new FakeElement("button"),
      forgot: new FakeElement("button"),
      pin: new FakeElement("button"),
      ignore: new FakeElement("button"),
      known: new FakeElement("button")
    };
  }

  get innerHTML() {
    return this.html || "";
  }

  appendChild(child) {
    child.parentElement = this;
    return child;
  }

  contains(target) {
    return target === this;
  }

  closest() {
    return null;
  }

  querySelector(selector) {
    if (selector.startsWith(".")) {
      return this.childrenByClass[selector.slice(1)] || null;
    }
    const match = selector.match(/\[data-action='([^']+)'\]/);
    if (match) return this.buttonsByAction[match[1]] || null;
    return null;
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  click() {
    return this.listeners.click?.({ target: this });
  }

  getBoundingClientRect() {
    return { left: 12, bottom: 24 };
  }

  get offsetHeight() {
    return 120;
  }

  get offsetWidth() {
    return 280;
  }
}

global.window = global;
global.innerHeight = 800;
global.innerWidth = 1200;
global.document = {
  documentElement: new FakeElement("html"),
  createElement: (tagName) => new FakeElement(tagName),
  addEventListener() {}
};
global.console = { ...console, warn() {} };
global.FadingFuriganaWordRepository = {
  isBasicAccessLockedError: (error) => error?.code === "basic_access_locked"
};

loadBrowserScript("src/content/tooltip.js");

const { Tooltip, getDisplayReading, getDisplaySurface } = window.FadingFuriganaTooltip;

runTest("displays the dictionary form for inflected verb cards", async () => {
  const token = {
    lexicalItemId: "誤る:あやまる",
    surface: "誤っ",
    lemma: "誤る",
    baseForm: "誤る",
    reading: "あやまっ",
    readingKana: "あやまっ",
    baseReadingKana: "あやまる",
    meanings: { en: ["to make a mistake"] }
  };
  const repository = {
    state: {
      settings: { display: { interfaceLanguage: "en" } },
      userProfile: { preferredMeaningLanguages: ["en"] }
    },
    saveWord() {}
  };
  const tooltip = new Tooltip(repository);

  tooltip.show(new FakeElement(), token, "ここでは誤った表示が出ます。");

  assert.equal(getDisplaySurface(token), "誤る");
  assert.equal(getDisplayReading(token), "あやまる");
  assert.equal(tooltip.element.querySelector(".jr-tooltip__surface").textContent, "誤る");
  assert.equal(tooltip.element.querySelector(".jr-tooltip__reading").textContent, "あやまる");
});

runTest("keeps contextual readings when the surface is already the headword", async () => {
  const token = {
    surface: "日本",
    lemma: "日本",
    baseForm: "日本",
    readingKana: "にっぽん",
    baseReadingKana: "にほん"
  };

  assert.equal(getDisplaySurface(token), "日本");
  assert.equal(getDisplayReading(token), "にっぽん");
});

runTest("hides immediately and notifies the page when optimistic Save starts", async () => {
  let resolveCommit;
  const repository = {
    state: {
      settings: { display: { interfaceLanguage: "en" } },
      userProfile: { preferredMeaningLanguages: ["en"] }
    },
    saveWordOptimistically() {
      return {
        commit: new Promise((resolve) => {
          resolveCommit = resolve;
        })
      };
    }
  };
  let changed = 0;
  const tooltip = new Tooltip(repository, () => {
    changed += 1;
  });

  tooltip.show(new FakeElement(), {
    lexicalItemId: "確認:かくにん",
    surface: "確認",
    reading: "かくにん",
    meanings: { en: ["confirmation"] }
  });
  tooltip.element.querySelector("[data-action='save']").click();

  assert.equal(tooltip.element.hidden, true);
  assert.equal(changed, 1);

  resolveCommit();
});

runTest("restores the tooltip and notifies the page again when optimistic Save fails", async () => {
  const error = new Error("locked");
  error.code = "basic_access_locked";
  const repository = {
    state: {
      settings: { display: { interfaceLanguage: "zhHans" } },
      userProfile: { preferredMeaningLanguages: ["zhHans", "en"] }
    },
    saveWordOptimistically() {
      return {
        commit: Promise.reject(error)
      };
    }
  };
  let changed = 0;
  const tooltip = new Tooltip(repository, () => {
    changed += 1;
  });

  tooltip.show(new FakeElement(), {
    lexicalItemId: "確認:かくにん",
    surface: "確認",
    reading: "かくにん",
    meanings: { zhHans: ["确认"] }
  });
  tooltip.element.querySelector("[data-action='save']").click();
  await Promise.resolve();

  const status = tooltip.element.querySelector(".jr-tooltip__status");
  assert.equal(tooltip.element.hidden, false);
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /试用已结束/);
  assert.equal(changed, 2);
});

runTest("shows localized Basic paywall prompt when Save is locked", async () => {
  const repository = {
    state: {
      settings: { display: { interfaceLanguage: "zhHans" } },
      userProfile: { preferredMeaningLanguages: ["zhHans", "en"] }
    },
    async saveWord() {
      const error = new Error("locked");
      error.code = "basic_access_locked";
      throw error;
    }
  };
  let changed = false;
  const tooltip = new Tooltip(repository, () => {
    changed = true;
  });

  tooltip.show(new FakeElement(), {
    surface: "確認",
    reading: "かくにん",
    meanings: { zhHans: ["确认"] }
  });
  await tooltip.element.querySelector("[data-action='save']").click();
  await Promise.resolve();
  await Promise.resolve();

  const status = tooltip.element.querySelector(".jr-tooltip__status");
  assert.equal(tooltip.element.hidden, false);
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /试用已结束/);
  assert.equal(changed, false);
});
