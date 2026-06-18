# Safari Storage Bridge Design

Date: 2026-06-08

Status update (2026-06-18): this document describes the **legacy whole-state AppState bridge** used by the current bundled Safari extension + app MVP. The Extension/App decoupling route keeps this readable during migration, but the target bridge is op-based `recordBatch` ingest as defined in `EXTENSION_APP_DECOUPLING_DESIGN.md` and `INGEST_PROTOCOL.md`. Do not extend `loadState/saveState` as the long-term multi-source contract.

T076 compatibility status (2026-06-18): the Safari native handler now accepts `ingestRecordBatch` and `pullRecordBatch` beside legacy `loadState` / `saveState` / `clearState`. The JS `SafariNativeStorageAdapter` now prefers recordBatch pull on load and recordBatch ingest+pull on save, while falling back to legacy whole-state actions for older native handlers or cached extension scripts. Signed local install has passed; a real Safari page round trip is still pending after Safari reloads the latest extension scripts.

## Goal

Prepare the extension for Safari and iOS Safari packaging without changing the existing AppState schema.

The current Chrome path stores AppState in `chrome.storage.local`. Safari Web Extensions can support extension storage, but iOS packaging and future native app features may need a native bridge and App Group storage. This design keeps those paths separated behind the existing `StorageAdapter` boundary.

## Current Storage Boundary

The app already talks to storage through:

```text
StorageAdapter.loadState()
StorageAdapter.saveState(state)
StorageAdapter.clearState()
```

Existing adapters:

- `LocalStorageAdapter` for demo pages and non-extension contexts.
- `ChromeStorageAdapter` for Chrome/Chromium extension contexts.

Safari should add a third adapter, not change repositories or annotation code.

## Recommended Adapter Order

```text
SafariNativeStorageAdapter
ChromeStorageAdapter
LocalStorageAdapter
```

`createBestAvailableStorageAdapter()` can later choose Safari first when a Safari bridge is detected.

## Message Contract

Safari native bridge messages should be small and AppState-shaped:

```json
{
  "type": "FADING_FURIGANA_STORAGE",
  "action": "loadState" | "saveState" | "clearState" | "ingestRecordBatch" | "pullRecordBatch",
  "payload": {
    "state": {},
    "batch": {},
    "cursor": null,
    "targetKind": "safari-extension"
  },
  "requestId": "uuid-or-timestamp"
}
```

Response:

```json
{
  "type": "FADING_FURIGANA_STORAGE_RESPONSE",
  "requestId": "same-id",
  "ok": true,
  "payload": {
    "state": {}
  }
}
```

Error response:

```json
{
  "type": "FADING_FURIGANA_STORAGE_RESPONSE",
  "requestId": "same-id",
  "ok": false,
  "error": "message"
}
```

## Native Storage Shape

Store the same AppState v1 object, serialized as JSON:

```text
App Group container
  Library/Application Support/FadingFurigana/app-state-v1.json
```

Do not split words, exposures, and settings into separate native files until there is a measured reason. A single AppState file keeps migration simple.

## Privacy Defaults

Safari should preserve the same defaults:

- Annotation enabled.
- Exposure tracking enabled.
- URL privacy set to `domain_only`.

If the user selects `none`, native storage must not receive full URLs or page titles through `sourceOccurrences` or `dailyExposureSummaries`.

## Failure Behavior

If Safari native messaging fails:

1. Fall back to extension storage if available.
2. Fall back to in-page/local storage only for demo contexts.
3. Never block annotation forever because native storage is unavailable.

On load failure, return a default AppState and surface a debug status later in the popup.

## Future Native App Responsibilities

The native container can later provide:

- Local AppState recovery from automatic same-device backups.
- Paid cross-device sync.
- Cross-device cloud backup for subscribed accounts.
- Larger dictionary assets.
- Shared Safari extension configuration.

Those features should not be built into the content script.

## Implementation Plan for T023

1. Add Safari Web Extension target in Xcode.
2. Package existing `manifest.json`, JS, CSS, popup, and demo-safe assets.
3. Confirm `browser.storage.local` / `chrome.storage.local` availability in Safari first.
4. If native bridge is required, add `SafariNativeStorageAdapter`.
5. Smoke test on macOS Safari, then iOS Safari.

## Open Questions

- Whether Safari extension storage alone is enough for v0.1.
- Whether native App Group storage is needed before iOS distribution.
- Whether dictionary assets should live in the extension bundle or native app bundle.
