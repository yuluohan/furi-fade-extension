# Annotation Quality and Display Plan

Date: 2026-06-10

This document records solution proposals for the annotation-quality feedback collected on 2026-06-10. Items 1 and 2 below were implemented immediately; the rest are design proposals awaiting approval before implementation.

## 1. Skip Chinese pages (implemented)

The extension must not annotate Chinese websites. `src/core/pageLanguage.js` now gates `AnnotationEngine.annotateRoot`:

- `<html lang>` starting with `ja` → always eligible.
- `<html lang>` starting with `zh` → never eligible.
- No declared language → heuristic on the first 8,000 characters of body text: a page with 50+ han characters and a kana ratio below 2% reads as Chinese and is skipped. Japanese text always mixes kana into han, so real Japanese pages pass.

The gate runs inside `annotateRoot`, so late-loading SPA content is re-evaluated, not just the initial document.

## 2. Settings now propagate to all tabs (implemented)

Two compounding bugs made "turn annotations off" unreliable:

1. The popup only messaged the active tab; other tabs never re-read settings.
2. Worse, every content tab held the full `AppState` in memory and wrote it back wholesale when flushing exposure batches — reverting any settings the popup had just saved.

Fixes:

- `WordRepositoryService.persistImmediately` re-reads stored state and preserves its `settings` when writing; content tabs no longer own settings.
- The content script listens to `chrome.storage.onChanged` and refreshes when stored settings differ from in-memory settings, covering every tab in Chrome and Safari.
- The popup re-reads the latest state before saving so it does not clobber exposure data written while it was open.

Known remaining gap: two tabs flushing exposure data simultaneously can still lose one tab's exposure counts (last-write-wins on the data fields). This needs a merge-on-write or background-owned single writer; it also matters for the future companion-app sync, so it should be solved together with the storage bridge work.

## 3. Tokenization correctness (proposal)

Observed failures of the current longest-surface matching:

- Boundary errors: a string like `10日本日` matches `日本` across a word boundary; `日本` itself can fragment when overlapping entries win.
- Counter readings: `2024年` is annotated `とし` (the standalone-noun reading) instead of `ねん`; `月` is missing entirely, and the がつ/つき distinction cannot be resolved without context.
- Inflected forms (`食べた`, `行きます`) are not detected because only exact surfaces match.

These are all consequences of having no morphological analysis, and no amount of dictionary curation fixes them. Proposed two-phase plan:

### Phase A — `Intl.Segmenter` boundary guard (implemented 2026-06-10)

`Intl.Segmenter("ja", { granularity: "word" })` is built into Chrome 87+ and Safari 14.1+ and produces ICU word boundaries for Japanese. It now constrains the dictionary matcher in `localDictionaryProvider.js`:

- Dictionary matches must start and end on ICU word boundaries (spanning complete intermediate segments is allowed).
- Digit + counter handling, because ICU itself missegments strings like `10日本社` as `10|日本|社`:
  - Single-kanji matches directly after a digit are never taken from the dictionary; a curated counter table decides instead. Safe counters get counter readings (年=ねん, 月=がつ, 時=じ, 円=えん, 回=かい, 個=こ, 歳=さい, 台=だい, 番=ばん, 人=にん except 1人/2人). Irregular ones (日, 分, 本…) are skipped rather than annotated wrongly.
  - Multi-character matches directly after a digit whose first character is a date counter (年月日時分秒週) are rejected unless they are known counter compounds (時間, 年代, 年度, 年間, 週間, 日間…). This blocks `日本` inside `10日本社` while keeping `1980年代` → ねんだい.
  - Counter tokens get their own lexical ids (e.g. `年:ねん` vs the noun `年:とし`), so exposure stats stay separate.
- Falls back to the previous behavior when `Intl.Segmenter` is unavailable; counter rules still apply.
- Gold-sentence tests cover dates, counter compounds, irregular counters, and the ICU missegmentation traps.

Known accepted limitation: genuinely ambiguous strings like `2024年金問題` (年金 vs 年+金…) annotate the counter reading; only full morphological context (Phase B) can do better. Inflected-form coverage (`食べた`) also remains for Phase B.

### Phase B — kuromoji.js in the background worker (implemented 2026-06-10)

`docs/DICTIONARY_TOKENIZER_SPIKE.md` already chose kuromoji.js. Implementation:

- `scripts/vendorKuromoji.js` vendors the kuromoji browser build plus the gzipped IPADIC dictionary (~17 MB) into `src/tokenizer/`; `npm run vendor:kuromoji` refreshes it.
- `src/background/background.js` (MV3 service worker) lazily builds the tokenizer on first request (~0.6 s incl. dictionary load, then cached until the worker idles out). Service workers lack `XMLHttpRequest`, so a small fetch-backed shim feeds kuromoji's dictionary loader; the dictionary path is root-relative (`/src/tokenizer/dict`) because kuromoji's `path.join` would mangle a `chrome-extension://` URL.
- `src/tokenizer/kuromojiTokenMapper.js` maps IPADIC tokens to app tokens: particles/aux/symbols/numbers dropped, katakana readings converted to hiragana, lemmas kept for inflected verbs (`食べた` → base `食べる`), `word_position` converted to zero-based offsets. The phase-A counter safety net is reused on kuromoji output because IPADIC also misreads counters (`4月` → ツキ, `10日` → ニチ).
- `src/dictionary/backgroundTokenizerClient.js` batches text-node tokenization through `chrome.runtime.sendMessage`, enriches tokens with JMdict meanings/loanword data by base form, and falls back to the local analyzer permanently for the page if the background is unavailable (demo page, init failure, old browsers).
- `AnnotationEngine.annotateRoot` is now async batch: collect text nodes → tokenize in one round trip → re-verify each node is still attached and unchanged before annotating. Mutations arriving mid-flight trigger one rescan afterwards.

Result: `来月10日本社で会議` now annotates 本社=ほんしゃ correctly (phase A could only avoid annotating the missegmented 日本), and readings no longer depend on the packaged JMdict subset.

Known limits:

- Tooltip meanings still come from the packaged JMdict subset; tokens outside it annotate readings with an empty tooltip (dictionary expansion, see §4).
- Lexical ids for inflected forms use the surface-reading stem unless the base form exists in the local dictionary, so exposure stats for rare verbs may fragment per inflection until dictionary coverage grows.
- Safari needs 16.4+ for background service workers; iOS memory limits may require a lighter dictionary later. The local analyzer fallback covers both.

## 4. Dictionary coverage (proposal)

5,000 entries is far too few for general pages. Plan:

- After Phase B, readings no longer require JMdict, which removes the biggest coverage pressure.
- For meanings, tier the data: tier 1 = all JMdict priority-marked entries (~20k+) packaged and loaded eagerly; tier 2 = full JMdict (~190k entries) stored compressed, loaded lazily in the background (IndexedDB), queried only when a tooltip opens.
- Extend `scripts/buildJmdictCommonData.js` with a `--tier` flag instead of the fixed 5,000 cut.
- Chinese meanings: evaluate packaging a JMdict-zh-Hans source so tooltips stop depending on curated overrides.

## 5. Review and learning screens move to the companion app

T025 (review/frequency learning screens) is re-scoped to the planned companion app. The extension keeps only the lightweight stats panel and will expose data through the App Group / sync bridge (see `docs/SAFARI_STORAGE_BRIDGE_DESIGN.md`).

## 6. Level-based filtering with per-word actions (proposal)

Annotating every word makes Japanese pages unreadable. Plan:

- Add `settings.annotation.userLevel` (`none`, `n5` … `n1`). Word difficulty comes from JMdict priority/frequency markers mapped into level bands now, with curated JLPT vocabulary lists as a later refinement.
- `shouldAnnotate` skips words at or below the user's level.
- Two distinct per-word actions, both reachable through a right-click context menu (`contextMenus` permission + background worker) so nothing is added to the page layout:
  - **"I forgot this word" (reset to unlearned).** For recently learned words that have faded out. Pinning the annotation back on would be a display-level patch only — `knowledgeConfidence` would stay high, so fading, exposure stats, and the companion app's review queue would all still believe the word is known. Instead, reset the real learning state: `lifecycleStatus` back to `learning`, `knowledgeConfidence` to 0, `annotationLevel` to `full_ruby`, `userIntent.manuallyMarkedKnown` cleared, and `learning.reviewStage` marked lapsed so the future app reschedules it. Annotation reappears and the fading cycle restarts naturally; no new data fields needed.
  - **"Always annotate this word" (pin).** Only for words hidden by the level filter: the system thinks the word is too easy, but the user always wants the reading. This is a display preference, not a knowledge claim, so it must not touch learning data — store it as `userIntent.pinnedAnnotation` overriding the level filter.
- The popup gets a small "recently hidden" list with one-tap "forgot this word", until the companion app takes over richer management.

## 7. Height-constrained layout fallback (proposal)

`<ruby>` + `<rt>` grows the line box. In containers with `-webkit-line-clamp` or fixed heights (e.g. Google search result snippets) annotations are clipped or break the layout.

### Why not just let the ancestor grow?

Relaxing the ancestor's constraints (`-webkit-line-clamp: none`, `max-height: none`) is technically one line of CSS, but it is unsafe as a default:

- The constraints are part of the host page's layout contract — search result cards are clamped so cards stay equal height; grids and absolutely positioned siblings can overlap once a card grows.
- Virtualized lists (Twitter-style infinite feeds) measure item heights to position rows; mutating heights from a content script causes jumpy scrolling and misplaced rows. Breaking host sites is the top complaint category for content-script extensions.
- Much truncation is not CSS at all: server-side ellipsis, JS character-count truncation, JS-measured fixed heights. CSS overrides cannot recover those.

### Plan

- **Default: degrade, don't resize.** Before inserting a ruby, inspect a bounded number of ancestor computed styles for `-webkit-line-clamp`, `overflow: hidden` with a fixed `height`/`max-height`, or a line-height too small to fit an `rt`. In constrained contexts render the existing `tap_only` annotation level instead of ruby: a dotted-underline span with the reading in the existing tooltip on click. No line-box growth, layout untouched.
- **Opt-in "expand container" mode** (global or per-site, default off): for users who prefer full ruby everywhere, relax `line-clamp`/`max-height` only on simple text containers. Users enable it on sites they trust not to break.
- Cache the per-element decision; add a global "compact mode" display setting that forces `tap_only` everywhere for users who prefer minimal visual change.
