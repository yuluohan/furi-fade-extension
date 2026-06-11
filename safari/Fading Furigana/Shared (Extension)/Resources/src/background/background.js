// MV3 service worker: hosts the kuromoji tokenizer so content scripts can
// request real morphological analysis without loading the 17 MB dictionary
// per tab.

// The vendored modules attach to `window`; service workers only have `self`.
self.window = self;

// kuromoji's BrowserDictionaryLoader uses XMLHttpRequest, which does not
// exist in service workers; provide a minimal fetch-backed stand-in.
if (typeof self.XMLHttpRequest === "undefined") {
  self.XMLHttpRequest = class FetchBackedXhr {
    open(_method, url) {
      this._url = url;
    }

    send() {
      fetch(this._url)
        .then(async (response) => {
          this.status = response.status;
          this.statusText = response.statusText;
          this.response = await response.arrayBuffer();
          if (this.onload) this.onload.call(this);
        })
        .catch((error) => {
          if (this.onerror) this.onerror.call(this, error);
        });
    }
  };
}

importScripts(
  "/src/core/appState.js",
  "/src/dictionary/localDictionaryProvider.js",
  "/src/tokenizer/kuromoji.js",
  "/src/tokenizer/kuromojiTokenMapper.js"
);

const DICTIONARY_PATH = "/src/tokenizer/dict";

let tokenizerPromise = null;

function getTokenizer() {
  if (!tokenizerPromise) {
    tokenizerPromise = new Promise((resolve, reject) => {
      self.kuromoji.builder({ dicPath: DICTIONARY_PATH }).build((error, tokenizer) => {
        if (error) reject(error);
        else resolve(tokenizer);
      });
    });
    tokenizerPromise.catch(() => {
      tokenizerPromise = null;
    });
  }
  return tokenizerPromise;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "FADING_FURIGANA_TOKENIZE") return false;

  getTokenizer()
    .then((tokenizer) => {
      const results = (message.texts || []).map((text) =>
        self.FadingFuriganaKuromojiMapper.mapKuromojiTokens(text, tokenizer.tokenize(text))
      );
      sendResponse({ ok: true, results });
    })
    .catch((error) => {
      sendResponse({ ok: false, error: String(error?.message || error) });
    });
  return true;
});
