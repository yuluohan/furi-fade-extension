# Fading Furigana Extension Requirements and Design

## 1. Scope

This document defines the browser extension side of Fading Furigana.

The extension helps English-speaking learners read Japanese web pages in Safari without leaving the original page. It annotates Japanese kanji words with ruby/furigana only when the user has not mastered the word yet. Users can click annotated words, inspect the reading and English meaning, then save, ignore, or mark the word as known.

The first extension milestone focuses on the web annotation loop:

```text
Japanese web page
-> detect dictionary-backed kanji words
-> annotate unknown words with ruby
-> click word card
-> Save / Ignore / Mark as Known
-> mastered or ignored words stop showing furigana
```

The extension must not become a full reader app, translation app, course app, or AI explanation tool.

## 2. MVP Goals

The MVP extension must:

- Run on normal Japanese article pages.
- Detect Japanese text nodes in the original page.
- Identify dictionary-backed Japanese kanji words.
- Insert ruby/furigana for words that should be annotated.
- Avoid destructive DOM rewrites.
- Show a word tooltip when the user clicks an annotated word.
- Support Save, Ignore, and Mark as Known actions.
- Persist word status locally.
- Hide furigana for mastered or ignored words.
- Handle dynamic content added after page load.
- Offer a restore path that removes inserted ruby nodes where possible.

The current prototype implements these goals with:

- A small in-memory sample dictionary.
- Longest-match analysis.
- `TreeWalker` text-node scanning.
- `MutationObserver`.
- `localStorage` prototype persistence.

## 3. Non-Goals

The extension MVP must not implement:

- Full Japanese morphological analysis.
- Full-page translation.
- AI explanations or AI chat.
- OCR.
- YouTube subtitle annotation.
- Video subtitle synchronization.
- Android support.
- Chrome mobile support.
- Cloud sync.
- Account login.
- A dedicated reader/import flow.
- Social features.

These can be considered later only after the page annotation and review loop works.

## 4. Target Platforms

### MVP Platform

```text
iOS Safari Web Extension
```

### Prototype Platform

```text
Plain browser content-script demo
```

The current folder starts as a browser-compatible prototype so the annotation engine can be tested quickly before adding Xcode and Safari native-extension packaging.

### Future Platforms

```text
macOS Safari Web Extension
Chrome / Edge desktop extension
Firefox desktop extension
```

The core annotation logic should be kept browser-neutral. Safari and Chrome differences should live in platform adapters.

## 5. User Stories

### 5.1 Annotate a Page

As a learner, I want unknown Japanese kanji words to show furigana directly on the Safari page, so I can keep reading without importing the article into another app.

Acceptance:

- Given the text `メールの内容を確認してください。申請には時間がかかります。`
- And the user has not mastered any words
- The extension renders:

```html
メールの内容を<ruby>確認<rt>かくにん</rt></ruby>してください。
<ruby>申請<rt>しんせい</rt></ruby>には時間がかかります。
```

### 5.2 Inspect a Word

As a learner, I want to tap an annotated word and see the reading, English meaning, and original sentence.

Acceptance:

- Clicking `申請` opens a tooltip.
- The tooltip shows:

```text
申請
しんせい
application; request
申請には時間がかかります。
Save / Ignore / Mark as Known
```

### 5.3 Save a Word

As a learner, I want to save a word into my vocabulary list for later review.

Acceptance:

- Clicking Save persists the word entry and source sentence.
- The word status becomes `learning`.
- The word remains annotated until it is mastered or ignored.

### 5.4 Mark a Word as Known

As a learner, I want to mark a word as known so furigana disappears.

Acceptance:

- Clicking Mark as Known sets status to `mastered`.
- Existing annotations refresh.
- Future page loads do not annotate the word while hide-mastered behavior is enabled.

### 5.5 Ignore a Word

As a learner, I want to ignore a word so it no longer appears as a learning target.

Acceptance:

- Clicking Ignore sets status to `ignored`.
- The word is not annotated on future scans.

### 5.6 Restore Page

As a user, I want annotation to be reversible as much as possible.

Acceptance:

- Extension-inserted ruby nodes can be replaced with their original surface text.
- The extension does not promise to restore unrelated page framework changes.

## 6. Functional Requirements

### 6.1 Text Detection

The extension must scan text nodes under `document.body`.

It must skip:

```text
script
style
noscript
textarea
input
select
button
code
pre
ruby
rt
rp
contenteditable
```

It must skip empty text nodes and text nodes that do not contain Japanese characters.

### 6.2 Japanese Analyzer

The extension must expose an analyzer abstraction:

```ts
interface JapaneseAnalyzer {
  analyze(text: string): Promise<JapaneseToken[]> | JapaneseToken[];
}
```

MVP analyzer behavior:

- Uses a local dictionary.
- Uses longest-match lookup.
- Returns dictionary-backed tokens only.
- Does not attempt full Japanese morphological parsing.

Future analyzer behavior:

- Can be replaced with a tokenizer or dictionary provider without changing DOM annotation code.

### 6.3 Token Model

```ts
type JapaneseToken = {
  id: string;
  surface: string;
  baseForm: string;
  reading: string;
  meaningEn?: string;
  partOfSpeech?: string;
  start: number;
  end: number;
  isKanjiWord: boolean;
  isKatakanaWord: boolean;
};
```

### 6.4 Annotation Decision

The extension must decide whether to annotate a token based on:

- Token properties.
- User word state.
- Extension settings.

Reference behavior:

```ts
function shouldAnnotate(word, userState, settings) {
  if (!settings.enabled || settings.annotationMode === "off") return false;
  if (userState?.status === "ignored") return false;
  if (settings.hideMasteredWords && userState?.status === "mastered") return false;
  if (settings.annotationMode === "all_kanji_words") return word.isKanjiWord;
  if (settings.annotationMode === "unknown_words_only") return !userState || userState.status !== "mastered";
  if (settings.annotationMode === "saved_words_only") return !!userState && userState.status !== "mastered";
  return false;
}
```

### 6.5 Ruby Insertion

The extension must insert:

```html
<ruby class="jr-ruby" data-word-id="...">
  確認
  <rt>かくにん</rt>
</ruby>
```

Implementation constraints:

- Do not replace `document.body.innerHTML`.
- Do not rewrite entire page sections when replacing one text node is enough.
- Use a `DocumentFragment` to replace individual text nodes.
- Store enough metadata on inserted ruby nodes for tooltip display and restoration.

Recommended data attributes:

```text
data-word-id
data-surface
data-base-form
data-reading
data-meaning-en
data-part-of-speech
data-source-sentence
data-original-text
data-jr-annotated
```

### 6.6 Tooltip

Clicking `.jr-ruby` must show a floating tooltip.

Tooltip fields:

```text
surface
reading
English meaning
source sentence
Save
Ignore
Mark as Known
```

Tooltip requirements:

- Use text assignment for user-visible content instead of HTML interpolation where possible.
- Stay within viewport bounds.
- Close when clicking outside the tooltip.
- Avoid interfering with the page more than necessary.

### 6.7 Dynamic Content

The extension must observe dynamic DOM additions.

Requirements:

- Use `MutationObserver`.
- Debounce annotation work.
- Ignore mutations caused by the extension's own annotation pass.
- Avoid duplicate ruby insertion.
- Avoid infinite loops.

### 6.8 Restore

The extension should provide:

```ts
window.FadingFurigana.restore()
```

Restore behavior:

- Find `.jr-ruby` nodes inserted by this extension.
- Replace each ruby node with `data-original-text` or the surface text.
- Do not try to undo unrelated page changes.

### 6.9 Settings

The extension should support:

```ts
type AnnotationMode =
  | "all_kanji_words"
  | "unknown_words_only"
  | "saved_words_only"
  | "off";

type ExtensionSettings = {
  enabled: boolean;
  annotationMode: AnnotationMode;
  hideMasteredWords: boolean;
};
```

MVP default:

```ts
{
  enabled: true,
  annotationMode: "unknown_words_only",
  hideMasteredWords: true
}
```

## 7. Data Model

### 7.1 WordEntry

```ts
type WordEntry = {
  id: string;
  surface: string;
  baseForm: string;
  reading: string;
  meaningEn: string;
  partOfSpeech?: string;
  jlptLevel?: string;
  isKanjiWord: boolean;
  isKatakanaWord: boolean;
  createdAt: string;
  updatedAt: string;
};
```

### 7.2 UserWordState

```ts
type UserWordState = {
  id: string;
  wordId: string;
  status: "new" | "learning" | "reviewing" | "mastered" | "ignored";
  annotationLevel: "full" | "ruby" | "tap_only" | "hidden";
  seenCount: number;
  savedCount: number;
  reviewCount: number;
  correctCount: number;
  wrongCount: number;
  correctStreak: number;
  firstSeenAt?: string;
  lastSeenAt?: string;
  lastReviewedAt?: string;
  nextReviewAt?: string;
  sourceSentenceIds: string[];
};
```

### 7.3 SourceSentence

```ts
type SourceSentence = {
  id: string;
  wordId: string;
  sentence: string;
  url: string;
  pageTitle: string;
  createdAt: string;
};
```

### 7.4 Repository Interface

The extension must use a repository abstraction instead of coupling annotation code to a specific storage backend.

```ts
interface WordRepository {
  getWordById(id: string): Promise<WordEntry | null> | WordEntry | null;
  saveWord(word: WordEntry, sourceSentence?: SourceSentence): Promise<void> | void;
  updateUserWordState(state: UserWordState): Promise<void> | void;
  getUserWordState(wordId: string): Promise<UserWordState | null> | UserWordState | null;
  listVocabulary(): Promise<WordEntry[]> | WordEntry[];
}
```

Prototype storage:

```text
localStorage
```

Safari iOS MVP storage target:

```text
content script
-> extension background script
-> native app extension
-> App Group shared storage
-> iOS app
```

Chrome desktop future storage target:

```text
content script
-> background service worker
-> chrome.storage
```

## 8. Architecture

Recommended components:

```text
DictionaryProvider
  Owns dictionary entries and lookup strategy.

JapaneseAnalyzer
  Converts page text into JapaneseToken[].

AnnotationEngine
  Scans DOM, filters tokens, inserts ruby, restores ruby.

Tooltip
  Owns word-card UI and actions.

WordRepository
  Owns words, user states, source sentences, and persistence.

SettingsRepository
  Owns extension settings and user preferences.
```

Component boundary rule:

```text
Tokenizer/dictionary logic must not know about DOM nodes.
DOM annotation logic must not know about platform storage details.
Storage adapters must not contain annotation rules.
```

## 9. File Structure

Current prototype:

```text
fading-furigana-extension/
  manifest.json
  README.md
  EXTENSION_REQUIREMENTS_AND_DESIGN.md
  demo/
    test-page.html
  src/
    content/
      contentScript.js
    styles/
      annotation.css
```

Future TypeScript structure:

```text
src/
  content/
    contentScript.ts
    annotationEngine.ts
    domWalker.ts
    tooltip.ts
  shared/
    dictionaryProvider.ts
    japaneseAnalyzer.ts
    wordRepository.ts
    settings.ts
    types.ts
  platform/
    safariRepository.ts
    chromeRepository.ts
    localStorageRepository.ts
  styles/
    annotation.css
tests/
  japaneseAnalyzer.test.ts
  annotationEngine.test.ts
  shouldAnnotate.test.ts
```

## 10. Safari Web Extension Design

Safari iOS requires the extension to be distributed inside an iOS app.

The eventual data flow should be:

```text
content script
  handles DOM annotation and word clicks

background script
  receives content-script messages
  forwards relevant events to native extension

native app extension
  reads/writes shared app data

App Group storage
  shared data location for iOS app and native extension

iOS app
  vocabulary UI and review state updates
```

Important Safari constraint:

```text
Do not assume the content script can directly access the iOS app's local data.
```

The repository adapter should hide this communication path from `AnnotationEngine`.

## 11. Chrome Extension Design

Chrome desktop can reuse most web extension files:

```text
manifest.json
content script
background service worker
annotation CSS
shared analyzer/repository interfaces
```

Chrome-specific differences should live in:

```text
chromeRepository
chromeBackgroundBridge
manifest permissions
```

Chrome mobile is not a reliable target for this product. Do not plan MVP mobile support around Chrome extensions.

## 12. Security and Privacy Requirements

The extension should:

- Avoid sending page text to remote services in MVP.
- Store vocabulary locally.
- Request the minimum practical host permissions.
- Avoid annotating password fields, input fields, forms, code blocks, and editable content.
- Avoid injecting third-party scripts.
- Avoid logging full page text in production.
- Clearly disclose that page text is processed locally for annotation.

## 13. Performance Requirements

The extension should:

- Avoid scanning pages that do not contain Japanese text.
- Avoid rescanning the entire page too often.
- Debounce mutation handling.
- Avoid duplicate annotations.
- Keep dictionary lookup efficient enough for article pages.
- Prefer replacing individual text nodes instead of large DOM subtrees.

Future improvements:

- Limit annotation to visible/article-like regions.
- Batch large pages.
- Add maximum text-node length safeguards.
- Cache analyzer results for repeated text nodes.

## 14. Testing Requirements

### 14.1 Analyzer Tests

Given:

```text
メールの内容を確認してください。申請には時間がかかります。
```

Expected tokens:

```text
確認 / かくにん
申請 / しんせい
```

### 14.2 Annotation Tests

Verify:

- Ruby is inserted for dictionary-backed words.
- `pre`, `code`, form controls, and existing `ruby` are skipped.
- Annotation does not duplicate after repeated scans.
- Restore removes inserted ruby nodes.

### 14.3 State Tests

Verify:

- Unknown words are annotated.
- `mastered` words are hidden when `hideMasteredWords` is true.
- `ignored` words are never annotated.
- `saved_words_only` only annotates existing saved states.

### 14.4 Interaction Tests

Verify:

- Clicking a ruby opens tooltip.
- Save persists the word and source sentence.
- Ignore removes annotation after refresh.
- Mark as Known removes annotation after refresh.

## 15. Manual Acceptance Checklist

Use `demo/test-page.html`.

Starting state:

- Clear local data.
- Load the demo page.

Expected:

```text
確認 -> かくにん
申請 -> しんせい
影響 -> えいきょう
```

Skipped content:

```text
The 確認 inside <pre> is not annotated.
```

Tooltip:

```text
Click 申請.
Tooltip shows surface, reading, English meaning, source sentence, and actions.
```

Mark known:

```text
Click 確認.
Click Mark as Known.
確認 no longer has furigana.
申請 still has furigana.
Refresh page.
確認 remains unannotated.
```

Restore:

```text
Call window.FadingFurigana.restore().
Inserted ruby nodes are replaced with original surface text.
```

## 16. Milestones

### Milestone 1: Prototype Annotation

Status: implemented in this folder.

Deliverables:

- Local dictionary.
- Longest-match analyzer.
- DOM TreeWalker.
- Ruby insertion.
- Tooltip.
- Save / Ignore / Mark as Known.
- Local persistence.
- MutationObserver.
- Restore.

### Milestone 2: TypeScript and Tests

Deliverables:

- Split `contentScript.js` into typed modules.
- Add analyzer tests.
- Add annotation-decision tests.
- Add DOM annotation tests using a browser-like environment.

### Milestone 3: Safari Extension Packaging

Deliverables:

- Xcode iOS app container.
- Safari Web Extension target.
- Content script and CSS packaged into extension target.
- Background script message bridge.
- Native app extension bridge.
- App Group entitlement.
- Shared storage adapter.

### Milestone 4: Extension UI and Settings

Deliverables:

- Extension popup or app-controlled settings.
- Annotation mode.
- Hide mastered words toggle.
- Enable/disable annotation.
- Restore annotations command.

### Milestone 5: Chrome Desktop Port

Deliverables:

- Chrome MV3 manifest.
- Chrome background service worker.
- Chrome storage adapter.
- Cross-browser compatibility tests.

## 17. Open Questions

- Should first-seen words be persisted automatically, or only after Save/Ignore/Mark as Known?
- Should `saved_words_only` annotate only `learning/reviewing`, or also `new` words seen previously?
- How many dictionary entries should ship in the first public MVP?
- Should page annotation be automatic on all sites, or only after user activation per page/domain?
- Should source sentence extraction use simple punctuation rules or a stronger sentence splitter?
- Should `tap_only` mode render underlines instead of ruby?

## 18. Current Prototype Limitations

- The dictionary has only three entries.
- The analyzer does not handle conjugation or full Japanese tokenization.
- State persistence uses `localStorage`, not Safari App Group storage.
- The tooltip is intentionally simple.
- The restore function only restores extension-inserted ruby nodes.
- The current prototype is not yet an Xcode-packaged Safari Web Extension app.

## 19. Product Principle

The extension should help users gradually stop needing furigana.

The goal is not:

```text
Show as much help as possible forever.
```

The goal is:

```text
Show enough help now, then make the help disappear as the user learns.
```

