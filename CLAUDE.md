# Fading Furigana — AI Development Guide

Japanese reading-annotation product: browser extensions annotate kanji/loanwords on web pages with adaptive "fading" based on exposure; companion apps add review/SRS. Product rule: **free single-device local use, paid multi-device cloud sync** (see `docs/SYNC_AND_CLIENTS_DESIGN.md`).

## Repository map

```text
packages/extension/        One WebExtension codebase (Chrome / Safari macOS / Safari iOS).
  manifest.json, src/, tests/, demo/, scripts/ (icons, Safari dist packaging)
  src/dictionary/data/     Generated JMdict data (43k entries; built by dictionary-data tooling)
  src/tokenizer/           Vendored kuromoji build + IPADIC dicts (17 MB; vendored, do not edit)
packages/dictionary-data/  Tooling only; its outputs land in packages/extension/src/
packages/core-schema/      Sync data contract: JSON Schema + merge rules + golden vectors (T043, pending)
apps/apple/                Xcode project: macOS/iOS apps + Safari extensions (appex)
  Fading Furigana/Shared (Extension)/Resources/   GENERATED mirror of extension dist — never hand-edit
server/                    Cloudflare Worker (today: demo host; future: sync API)
scripts/                   Cross-package orchestration (buildSafariMac, runLocalCi)
docs/                      Design docs + DEVELOPMENT_PLAN.md task table
```

## Commands

```bash
npm run check            # node --check every script/module (no build system)
npm test                 # plain Node test scripts, no framework
npm run package:safari   # icons + packages/extension/dist/safari-web-extension
npm run build:safari:mac # full pipeline: package → Xcode build → re-sign → install → register
npm run vendor:kuromoji  # refresh vendored kuromoji from node_modules
npm run build:jmdict     # regenerate dictionary data (needs /private/tmp/JMdict_e.gz)
```

## Hard rules (violating these has burned whole sessions)

1. **Never build via bare Xcode.** The Xcode `Resources` mirror is generated from `packages/extension` via dist; a bare Xcode build ships stale JS. Always `npm run build:safari:mac` (it ditto-merges dist into Resources). To verify what Safari actually runs: `pluginkit -m -v -p com.apple.Safari.web-extension | grep -i furigana`, then grep the listed `.appex` for a recent code marker.
2. **The installed app lives at `~/Applications/Fading Furigana.app`**, signed with the local Apple Development cert (build script re-signs via `codesign`; xcodebuild automatic signing fails — Apple ID not logged into Xcode). Exactly one copy must stay registered; the build script unregisters others.
3. **Lexical IDs are content-derived** (`createId(baseForm, reading)` → `確認:かくにん`), never dictionary-build-derived. Devices on different dictionary versions must agree on IDs.
4. **Local-first.** No feature may require an account or network for local annotation/review. Paid capability = cloud sync, enforced server-side only.
5. **Sync schema evolves additively.** New fields optional with defaults; merge logic must round-trip unknown fields. Breaking changes need a schemaVersion bump + server gate (`docs/SYNC_AND_CLIENTS_DESIGN.md` §9).
6. **Storage is quota-sensitive** (Safari ~10 MB before `unlimitedStorage`). Exposure-only words store no meanings; summaries store no page titles; `compactState` prunes on persist. Do not reintroduce per-occurrence bloat.
7. **The annotation engine must not fight pages**: incremental scanning (WeakSet of processed nodes), viewport-lazy via IntersectionObserver, per-page node budget with self-suspend, per-element churn backoff. Any new DOM-writing path must respect these guards.

## Conventions

- Plain JS, IIFE modules attaching to `window.FadingFurigana*`; no bundler, no frameworks. Service worker shims `self.window = self`.
- Regex literals use `\uXXXX` escapes, not literal kana/kanji ranges.
- Tests are dependency-free Node scripts under `packages/extension/tests/`; register new files in the root `package.json` `test` chain (and new modules in `check`).
- Every completed task gets a row in `docs/DEVELOPMENT_PLAN.md` (T-numbered, with verification notes).
- Commit messages in Chinese, conventional prefix (`feat:`/`fix:`/`docs:`), body lists key changes.
- Safari (macOS) is the primary manual test target; Chrome is secondary.

## Tokenization pipeline (for context)

Content script → background service worker (kuromoji + IPADIC, lazy ~0.6 s first build) → token mapper (POS filter, katakana→hiragana, counter-reading safety net: IPADIC misreads `4月`→ツキ etc.) → content-side enrichment from packaged JMdict (meanings) → annotation decision (`shouldAnnotate`) → ruby/tap-only rendering. Fallback when no background (demo page, iOS): `Intl.Segmenter` boundary guard + dictionary longest-match with the same counter rules.
