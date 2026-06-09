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
Current phase: foundation and architecture
Next recommended task: install Xcode Safari converter and generate Safari project
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
| T023 | blocked | Add Safari Web Extension packaging | Xcode app container and Safari extension target | `npm run package:safari`, `npm run check`, `npm test`; blocked because `safari-web-extension-converter` is unavailable in current Xcode tools |

## Update Rules

- When starting a task, change status to `in_progress`.
- When finishing a task, change status to `done` and add verification notes if needed.
- If a task cannot continue without external input, change status to `blocked` and describe the blocker.
- Keep tasks small enough to complete in one focused development session.

## Last Updated

```text
2026-06-08
```
