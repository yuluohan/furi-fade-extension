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
  "/src/storage/recordBatchCodec.js",
  "/src/storage/chromeLoopbackClient.js",
  "/src/dictionary/localDictionaryProvider.js",
  "/src/tokenizer/kuromoji.js",
  "/src/tokenizer/kuromojiTokenMapper.js"
);

const DICTIONARY_PATH = "/src/tokenizer/dict";
const NATIVE_STORAGE_RELAY_MESSAGE_TYPE = "FADING_FURIGANA_NATIVE_STORAGE_RELAY";
const LOOPBACK_MESSAGE_TYPE = self.FadingFuriganaLoopback?.LOOPBACK_MESSAGE_TYPE || "FADING_FURIGANA_LOOPBACK";
const extensionRuntime = globalThis.chrome?.runtime || globalThis.browser?.runtime;

let tokenizerPromise = null;

// The worker owns the one real loopback client, so its fetches to 127.0.0.1 are first-party
// extension requests (content-script fetches would carry the page Origin and fail CORS reads).
let loopbackClient = null;
function getLoopbackClient() {
  if (loopbackClient) return loopbackClient;
  const loopback = self.FadingFuriganaLoopback;
  const storageArea = globalThis.chrome?.storage?.local || globalThis.browser?.storage?.local;
  if (!loopback?.MacLoopbackClient || !storageArea) return null;
  loopbackClient = new loopback.MacLoopbackClient({ storageArea });
  return loopbackClient;
}

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

extensionRuntime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === NATIVE_STORAGE_RELAY_MESSAGE_TYPE) {
    sendNativeStorageMessage(message.payload)
      .then((response) => sendResponse({ ok: true, response }))
      .catch((error) => {
        sendResponse({ ok: false, error: String(error?.message || error) });
      });
    return true;
  }

  if (message?.type === LOOPBACK_MESSAGE_TYPE) {
    const client = getLoopbackClient();
    if (!client) {
      sendResponse({ ok: false, error: "Loopback client is unavailable in the background worker." });
      return true;
    }
    self.FadingFuriganaLoopback
      .handleLoopbackAction(client, message.action, message.payload)
      .then((result) => sendResponse({ ok: true, result, status: client.getStatus() }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error), status: client.getStatus() }));
    return true;
  }

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

function sendNativeStorageMessage(payload) {
  return new Promise((resolve, reject) => {
    if (typeof extensionRuntime?.sendNativeMessage !== "function") {
      reject(new Error("Native messaging is unavailable in the background worker."));
      return;
    }

    let settled = false;
    const settle = (handler, value) => {
      if (settled) return;
      settled = true;
      handler(value);
    };

    const callback = (response) => {
      const lastError = globalThis.chrome?.runtime?.lastError || globalThis.browser?.runtime?.lastError;
      if (lastError) {
        settle(reject, new Error(lastError.message));
        return;
      }
      settle(resolve, response);
    };

    try {
      const maybePromise = extensionRuntime.sendNativeMessage(payload, callback);
      if (maybePromise?.then) {
        maybePromise.then((response) => settle(resolve, response), (error) => settle(reject, error));
      }
    } catch (error) {
      settle(reject, error);
    }
  });
}
