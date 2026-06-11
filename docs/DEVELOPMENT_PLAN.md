# Fading Furigana Development Plan

This document breaks development into small, completable tasks. Update the status whenever a task is finished.

Status values:

```text
done
in_progress
pending
blocked
```

## Current Status Summary

```text
Current branch: dev
Current phase: annotation quality and display
Next recommended task: manual extension test of T031, then T032 (tiered dictionary) or T033 (level filtering)
```

## Tasks

| ID | Status | Task | Deliverable | Verification |
| --- | --- | --- | --- | --- |
| T001 | done | Build initial annotation prototype | Demo annotates sample Japanese text with ruby and tooltip actions | Manual demo test |
| T002 | done | Add demo toggle | Demo can hide and show annotations | Manual demo test |
| T003 | done | Add katakana loanword sample | `サーバー` displays `server` as source-form hint | Manual demo test |
| T004 | done | Deploy demo through Cloudflare Workers | `/test-page` serves demo and JS/CSS assets | `wrangler deploy` / online smoke test |
| T005 | done | Add GitHub Actions Cloudflare deployment | Push to `dev` deploys with Wrangler action | GitHub Actions run |
| T006 | done | Fix Cloudflare assets upload | Exclude generated dependencies from Worker assets | `npx wrangler@latest deploy --dry-run` |
| T007 | done | Upgrade requirements document | Requirements reflect adaptive lexical annotation, multilingual meanings, exposure statistics, privacy | Document review |
| T008 | done | Add AppState v1 and storage adapter | `AppState`, migration helpers, `LocalStorageAdapter` | Manual demo test, `node --check` |
| T009 | done | Extract repository layer | Lexical item, user lexical state, and exposure repositories | `node --check`, dry-run |
| T010 | done | Add automated state/repository tests | Lightweight Node tests for state, migration, storage, repositories | `npm run check`, `npm test` |
| T011 | done | Add development design and task plan docs | `docs/DEVELOPMENT_DESIGN.md` and this plan | Document review |
| T012 | done | Extract annotation decision module | Move `shouldAnnotate` and related settings logic out of content script | `npm run check`, `npm test`, HTTP script load check, Wrangler dry-run; browser automation unavailable this run |
| T013 | done | Extract DOM annotation engine module | Move DOM scanning, ruby insertion, restore, mutation handling out of content script | `npm run check`, `npm test`, HTTP script load check, Wrangler dry-run |
| T014 | done | Extract tooltip module | Move tooltip rendering and actions out of content script | `npm run check`, `npm test`, HTTP script load check, Wrangler dry-run |
| T015 | done | Add DOM annotation tests | Test skip tags, duplicate prevention, restore, and annotation output | `npm run check`, `npm test` |
| T016 | done | Add exposure write batching | Avoid saving state once per token on large pages | `npm run check`, `npm test`, HTTP script load check, Wrangler dry-run |
| T017 | done | Add ChromeStorageAdapter | Store AppState in `chrome.storage.local` | `npm run check`, `npm test`, HTTP script load check, Wrangler dry-run |
| T018 | done | Add extension settings UI | Toggle annotation, exposure tracking, URL privacy mode | `npm run check`, `npm test`, HTTP popup load check, Wrangler dry-run |
| T019 | done | Add vocabulary/frequency debug UI | Show today's frequent items and this week's recurring items | `npm run check`, `npm test`, HTTP popup load check, Wrangler dry-run |
| T020 | done | Add real dictionary/tokenizer provider design spike | Choose local dictionary/tokenizer/API strategy | `docs/DICTIONARY_TOKENIZER_SPIKE.md`, source review |
| T021 | done | Add local dictionary provider prototype | Replace sample-only dictionary for a small real subset | `npm run check`, `npm test`, HTTP script load check, Wrangler dry-run |
| T022 | done | Add Safari storage bridge design | Define background/native/App Group message path | `docs/SAFARI_STORAGE_BRIDGE_DESIGN.md` |
| T023 | done | Add Safari Web Extension packaging | Xcode app container and Safari extension target | `npm run package:safari`, `xcrun safari-web-extension-packager`, `xcodebuild -list`, macOS no-sign build |
| T024 | done | Extract word repository service | Move annotation data coordination out of content script | `npm run check`, `npm test`, HTTP script load check, `npm run package:safari` |
| T025 | blocked | Add review and frequency-based learning screens | Re-scoped to the companion app (see `ANNOTATION_QUALITY_PLAN.md` §5); extension keeps the lightweight stats panel only | Blocked until companion app work starts |
| T026 | done | Add extension interface language setting | Store UI language in AppState and switch popup text between Chinese and English | `npm run check`, `npm test`, `npm run package:safari` |
| T027 | done | Integrate packaged JMdict common data | Load 5,000 real JMdict entries locally through DictionaryProvider | `npm run check`, `npm test`, `npm run package:safari` |
| T028 | done | Skip annotation on Chinese pages | `src/core/pageLanguage.js` gates the annotation engine via declared `lang` plus kana/han heuristic | `npm run check`, `npm test`, `npm run package:safari` |
| T029 | done | Fix settings propagation across tabs | Content tabs preserve stored settings on persist, listen to `storage.onChanged`; popup re-reads state before saving | `npm run check`, `npm test` (lost-update regression test) |
| T030 | done | Tokenizer phase A: Intl.Segmenter boundary guard | Dictionary matches constrained to ICU word boundaries; digit+counter readings (年/月/時/円/回/個/歳/台/番/人), irregular counters skipped, date-counter compound guard | `npm run check`, `npm test` (gold-sentence tests), `npm run package:safari` |
| T031 | done | Tokenizer phase B: kuromoji.js in background worker | MV3 service worker hosts kuromoji (vendored build + IPADIC dict); content scripts batch-tokenize via messaging with local-analyzer fallback; counter safety net applied to IPADIC output | `npm run check`, `npm test` (mapper unit + real-kuromoji integration tests), worker simulation, `npm run package:safari`; manual extension test pending |
| T032 | pending | Tiered dictionary coverage expansion | Tier 1 priority entries eager (~20k), tier 2 full JMdict lazy | `ANNOTATION_QUALITY_PLAN.md` §4 |
| T033 | pending | Level-based filtering and per-word actions | `annotation.userLevel` setting; right-click "forgot this word" (resets learning state) and "always annotate" (pin for level-filtered words) | `ANNOTATION_QUALITY_PLAN.md` §6 |
| T034 | pending | Height-constrained layout fallback | Default `tap_only` rendering inside line-clamped/fixed-height containers; opt-in per-site "expand container" mode | `ANNOTATION_QUALITY_PLAN.md` §7, Google results manual test |
| T035 | done | Fix annotation performance on large/dynamic pages | Incremental annotation: processed-node tracking (WeakSet), mutation-scoped scanning instead of full-page rescans, chunked tokenizer batches, single settings-refresh path (storage.onChanged only), exposure persist batched at 2s; runaway-loop fuses: 50k-node per-page budget with self-suspend, one exposure per word per page | `npm run check`, `npm test` (incremental + budget/dedup regression tests), Safari manual test after memory blowup report |
| T036 | done | Viewport-lazy annotation | Text nodes wait in an IntersectionObserver queue (600px lookahead) and are only tokenized when their parent element scrolls near the viewport; exposure stats now mean "actually displayed on screen"; tokenization skipped entirely while annotation is off | `npm run check`, `npm test` (viewport deferral test), Safari manual test |
| T037 | done | Stop annotation flicker on loading pages | Stability gate: defer annotation until the DOM has been quiet 600ms (max 6s after boot); per-element churn backoff: elements re-annotated >4 times cool down 5s, >12 times are abandoned | `npm run check`, `npm test` (settle + churn backoff tests), Safari manual test on long loading pages |
| T038 | done | Fix storage-driven refresh loop (flicker on static pages) | `WordRepositoryService.load()` no longer writes storage back (broke the persist→onChanged→load→persist cycle); onChanged settings comparison normalizes both sides; reloads are serialized with an in-flight guard | `npm run check`, `npm test` (read-only load test), Safari manual test on Wikipedia search page |
| T039 | done | Fix storage quota exhaustion | `unlimitedStorage` permission; exposure-only words store no meanings; exposure summaries store no page titles, capped pages/surface forms; `compactState` prunes expired summaries and slims legacy bloat on every persist; quota failures warn once instead of spamming | `npm run check`, `npm test` (compaction/diet tests), Safari console clean after browsing |
| T040 | done | Targeted word refresh on tooltip actions | Save/known/ignore re-evaluate only that word's rubies in place (`engine.refreshWord`); no full restore, no re-tokenization, no page-wide flash; ruby dataset carries source confidence for faithful re-evaluation | `npm run check`, `npm test` (targeted refresh tests), Safari manual test |

## Update Rules

- When starting a task, change status to `in_progress`.
- When finishing a task, change status to `done` and add verification notes if needed.
- If a task cannot continue without external input, change status to `blocked` and describe the blocker.
- Keep tasks small enough to complete in one focused development session.

## Last Updated

```text
2026-06-10
```
