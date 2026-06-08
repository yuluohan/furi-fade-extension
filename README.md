# Fading Furigana Extension Prototype

This is the first web annotation prototype for Fading Furigana.

## What works

- Scans page text with `TreeWalker`.
- Skips script/style/form/code/pre/ruby/contenteditable nodes.
- Uses a tiny local dictionary and longest-match lookup.
- Inserts safe `<ruby>` annotations for matching kanji words.
- Shows a tooltip on annotated words.
- Supports Save, Ignore, and Mark as Known.
- Persists prototype state in `localStorage`.
- Restores inserted ruby nodes with `window.FadingFurigana.restore()`.
- Watches dynamic DOM additions with `MutationObserver`.

## Demo

Open:

```text
demo/test-page.html
```

Expected behavior:

- `確認` shows `かくにん`.
- `申請` shows `しんせい`.
- Marking `確認` as known hides its furigana after refresh.
- `申請` remains annotated.

## Cloudflare Workers demo

Deploy the demo with Wrangler from the repository root:

```sh
npx wrangler deploy
```

The Worker serves:

- `/test-page` -> `demo/test-page.html`
- `/src/content/contentScript.js`
- `/src/styles/annotation.css`

If `/test-page` loads but annotations do not appear, check that the JS and CSS paths above return `200`.

## Local checks

Run syntax checks and state/repository tests:

```sh
npm run check
npm test
```

## Next step

Move storage behind a platform adapter:

- Safari iOS: content script -> background script -> native app extension -> App Group storage.
- Chrome desktop: content script -> background service worker -> `chrome.storage`.
