# Fading Furigana Development Design

This document describes the implementation design for turning the current web demo into a browser extension architecture. The product requirements live in `EXTENSION_REQUIREMENTS_AND_DESIGN.md`; this document focuses on how the code should be organized and evolved.

## 1. Current Architecture

The current implementation is still plain browser JavaScript with no build step.

```text
demo/test-page.html
  loads appState.js
  loads localStorageAdapter.js
  loads repositories.js
  loads contentScript.js

manifest.json
  loads the same scripts as content scripts in extension mode
```

Current modules:

```text
src/core/appState.js
  Defines AppState v1, default settings, ID helpers, migration helpers, lexical item creation, and user state creation.

src/storage/localStorageAdapter.js
  Implements loadState, saveState, and clearState against localStorage.

src/repositories/repositories.js
  Implements LexicalItemRepository, UserLexicalStateRepository, and ExposureRepository.

src/services/wordRepositoryService.js
  Coordinates repositories, persistence scheduling, page privacy context, save/ignore/known actions, and exposure recording.

src/content/contentScript.js
  Boots storage, repository service, dictionary provider, analyzer, tooltip, and annotation engine.
```

## 2. Design Principles

- Keep the content script focused on DOM scanning, annotation, tooltip interaction, and page lifecycle.
- Keep persistent data shape centralized in `AppState`.
- Keep storage backend details behind `StorageAdapter`.
- Keep vocabulary and exposure data operations in repositories.
- Preserve the no-build demo until there is a clear reason to introduce TypeScript or bundling.
- Keep every refactor behavior-preserving unless a product requirement explicitly changes behavior.

## 3. Data Ownership

```text
AppState
  Owns the persisted JSON schema.

StorageAdapter
  Owns where AppState is stored.

LexicalItemRepository
  Owns lexicalItems.

UserLexicalStateRepository
  Owns userLexicalStates.

ExposureRepository
  Owns dailyExposureSummaries and frequency queries.

AnnotationEngine
  Owns DOM mutation and annotation rendering.
```

`contentScript.js` should stay a small composition root. Business state coordination lives in `WordRepositoryService`.

## 4. AppState v1

The persisted state is:

```text
schemaVersion
userProfile
settings
lexicalItems
userLexicalStates
sourceOccurrences
dailyExposureSummaries
reviewLogs
metadata
```

The schema is designed to support:

- multilingual meanings
- mixed-script Japanese words such as `食べる`
- katakana loanwords with non-English origin languages
- adaptive user learning state
- daily exposure frequency summaries
- future review scheduling

All future schema changes must include migration logic in `src/core/appState.js`.

## 5. Storage Strategy

Current:

```text
LocalStorageAdapter
ChromeStorageAdapter
```

Next extension targets:

```text
SafariStorageAdapter
  Uses background/native bridge and App Group storage.
```

Storage adapters must not contain annotation decisions or vocabulary learning rules. They should only load, save, and clear `AppState`.

## 6. Multi-Client and Sync Strategy

The product should remain local-first on every client:

```text
Single device usage: local storage, free, no account required.
Cross-device sync: account-based cloud sync, paid.
```

No client should become the only data center. The macOS Safari host app is allowed to become a full learning app because Safari requires a native app container, but it must still be treated as one client beside:

```text
Chrome extension
Safari extension
macOS learning app
iOS app
Android app
Windows app
future web app
```

Long-term ownership:

```text
Browser extensions
  In-page annotation, lightweight save/ignore/known actions, exposure capture.

Desktop/mobile apps
  Vocabulary management, review, statistics, account, subscription, import/export, sync status.

Cloud Sync API
  Cross-device AppState replication, merge, backup, restore, subscription gating, device list.
```

The sync layer should be added as an adapter/coordinator around `AppState`, not by making annotation code call cloud APIs directly.

Recommended shape:

```text
Local StorageAdapter
  Always available; source of offline truth on this device.

CloudSyncAdapter
  Optional; enabled only for logged-in paid sync users.
  Pushes local changes and pulls remote changes.
  Uses timestamps, device IDs, per-record updatedAt, and additive exposure counters for merge.

Subscription/Account service
  Determines whether cloud sync is enabled.
  Must not block local annotation or local learning state.
```

The common sync payload should be platform-neutral and based on `AppState` domains:

- `userProfile`
- `settings`
- `lexicalItems`
- `userLexicalStates`
- `dailyExposureSummaries`
- `reviewLogs`
- sync metadata such as `deviceId`, `updatedAt`, `deletedAt`, and `revision`

This allows a user to run `Chrome extension + macOS app`: Chrome can collect page exposures and word actions, cloud sync can store them, and the macOS app can display and review the same data after login.

## 7. Repository Strategy

Repositories are deliberately state-backed and storage-agnostic. They mutate the in-memory `AppState`; the coordinator decides when to call `saveState`.

```text
LexicalItemRepository
  upsertFromToken
  getById
  listVocabulary

UserLexicalStateRepository
  ensure
  recordSeen
  markSaved
  setStatus
  getByLexicalItemId

ExposureRepository
  recordDailyExposure
  listDailyExposures
  listFrequentItems
```

Exposure writes are batched through `PersistScheduler` so large pages do not persist state once per token.

## 8. Annotation Strategy

The annotation engine should:

- walk text nodes with `TreeWalker`
- skip unsafe or inappropriate tags
- call the analyzer for token matches
- call repositories/services for user state
- insert minimal `<ruby>` nodes
- restore inserted annotations on demand
- avoid duplicate annotation after dynamic DOM mutations

The engine should not know whether data comes from localStorage, Chrome storage, Safari storage, local dictionary, or remote API.

## 9. Analyzer Strategy

Current:

```text
LocalDictionaryProvider + longest-match lookup
```

Future:

```text
Local dictionary provider
Tokenizer provider
API provider
Hybrid provider
```

All providers should return `JapaneseToken[]` with stable `lexicalItemId`, `surface`, `lemma`, `readingKana`, `start`, and `end`.

## 10. Testing Strategy

Current tests use Node built-ins only:

```text
npm run check
npm test
```

Covered now:

- AppState defaults
- legacy state migration
- LocalStorageAdapter
- LexicalItemRepository
- UserLexicalStateRepository
- ExposureRepository

Next tests should cover:

- annotation decision logic
- DOM skip rules
- ruby insertion/restoration
- tooltip actions
- exposure write batching
- word repository service privacy behavior

## 11. Deployment Strategy

Cloudflare Workers demo uses:

```text
worker.js
wrangler.jsonc
.assetsignore
```

CI deploys from the `dev` branch with GitHub Actions and `cloudflare/wrangler-action`.

Before pushing deploy-impacting changes, run:

```sh
npm run check
npm test
npx wrangler@latest deploy --dry-run
```

## 12. Migration Path

Recommended implementation order:

1. Stabilize tests and repository layer.
2. Extract annotation decision and DOM annotation modules.
3. Add Chrome storage adapter.
4. Add extension popup/settings UI.
5. Add real dictionary/tokenizer provider.
6. Add Safari bridge/storage.
7. Add review and frequency-based learning screens.
