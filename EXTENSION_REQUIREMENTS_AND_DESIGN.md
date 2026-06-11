# Fading Furigana Extension Requirements and Design

## 1. Scope

This document defines the browser extension side of Fading Furigana.

Fading Furigana is an adaptive Japanese reading assistant for multilingual learners. It helps users read Japanese web pages in place by detecting dictionary-backed Japanese lexical items, showing the right amount of help, and gradually reducing that help as the user becomes familiar with each item.

The product is not limited to pure kanji words. It must eventually support:

```text
確認
食べる
食べました
申し込む
気をつける
サーバー
メール
```

The first extension milestone focuses on the page annotation and learning-state loop:

```text
Japanese web page
-> detect dictionary-backed lexical items
-> decide whether and how much help to show
-> annotate unknown or useful items inline
-> click word card
-> Save / Ignore / Mark as Known
-> update user state and daily exposure statistics
-> reduce annotation as the user learns
```

The extension must not become a full reader app, full-page translation app, course app, or AI chat product. Its primary job is to augment the original web page without pulling the user out of their reading flow.

## 2. MVP Goals

The MVP extension must:

- Run on normal Japanese article pages.
- Detect Japanese text nodes in the original page.
- Identify dictionary-backed Japanese lexical items.
- Support mixed-script lexical items such as `食べる`, not only pure kanji words.
- Support katakana loanwords without assuming the origin language is English.
- Insert ruby/furigana or another inline hint for items that should be annotated.
- Avoid destructive DOM rewrites.
- Show a tooltip when the user clicks an annotated item.
- Support Save, Ignore, and Mark as Known actions.
- Persist user state locally.
- Hide or reduce help for known, mastered, or ignored items.
- Track daily exposure frequency locally.
- Handle dynamic content added after page load.
- Offer a restore path that removes inserted annotation nodes where possible.

The current prototype implements a smaller version of these goals with:

- A small in-memory sample dictionary.
- Longest-match analysis.
- `TreeWalker` text-node scanning.
- `MutationObserver`.
- `localStorage` prototype persistence.
- A web demo route for Cloudflare Workers.

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

Important clarification:

```text
The MVP does not need to implement full morphology, but the data model must support lemma, surface form, reading, and conjugation metadata so a stronger analyzer can be added later.
```

## 4. Product Model

Fading Furigana should use a local-first product model:

```text
One device: free
Cross-device sync: paid
```

The free product must remain useful without login:

- Annotate Japanese pages.
- Save, ignore, and mark words as known.
- Store learning state locally.
- Track local daily exposure statistics.
- Export or import local data for backup.

The paid product should unlock account-based sync:

- Cloud backup and restore.
- Sync vocabulary, learning state, settings, and exposure summaries across devices.
- Merge changes from browser extensions, desktop apps, and mobile apps.
- Maintain a device list and sync health status.
- Enable richer cross-device statistics and review queues.

The account and cloud sync layer is the source of cross-device continuity, not any single app. This matters because users may use combinations such as:

```text
Chrome extension + macOS learning app
Safari extension + iOS app
Chrome extension + Android app
Windows app + Chrome extension
```

Local data must continue to work when the user is offline or not logged in. Cloud sync should be additive: it should replicate and merge local learning data after login, not replace the local-first experience.

## 5. Target Platforms

### MVP Platform

```text
iOS Safari Web Extension
```

### Prototype Platform

```text
Plain browser content-script demo
Cloudflare Workers demo site
```

The current folder starts as a browser-compatible prototype so the annotation engine can be tested quickly before adding Xcode and Safari native-extension packaging.

### Future Platforms

```text
macOS Safari Web Extension
Chrome / Edge desktop extension
Firefox desktop extension
iOS app
Android app
Windows app
macOS learning app
```

The core annotation logic should be browser-neutral. Safari and Chrome differences should live in platform and storage adapters.

Safari has one special product constraint: Safari Web Extensions must be packaged inside a native app. The macOS Safari host app should therefore become a real learning app over time, not remain only a launcher. However, it must still be treated as one client in a broader multi-client system. It must not become the exclusive data center for the product.

Long-term platform roles:

- Browser extensions collect reading context and support lightweight in-page actions.
- Desktop and mobile apps provide vocabulary management, review, statistics, account, subscription, import/export, and sync status.
- Cloud sync keeps user data consistent across all clients.

## 6. User Stories

### 5.1 Annotate a Page

As a learner, I want unfamiliar Japanese lexical items to show reading help directly on the page, so I can keep reading without importing the article into another app.

Acceptance:

- Given the text `メールの内容を確認してください。昨日ラーメンを食べました。`
- And the user has not mastered any matching lexical items
- The extension can render:

```html
メールの内容を<ruby>確認<rt>かくにん</rt></ruby>してください。
昨日ラーメンを<ruby>食べました<rt>たべました</rt></ruby>。
```

### 5.2 Inspect a Lexical Item

As a multilingual learner, I want to tap an annotated item and see its reading, localized meaning, and original sentence.

Acceptance:

- Clicking `申請` opens a tooltip.
- The tooltip shows the best localized meaning based on user preferences.
- If the user prefers Simplified Chinese with English fallback, the tooltip may show:

```text
申請
しんせい
申请; 请求
申請には時間がかかります。
Save / Ignore / Mark as Known
```

### 5.3 Save an Item

As a learner, I want to save a lexical item into my vocabulary list for later review.

Acceptance:

- Clicking Save persists the lexical item and source occurrence.
- The user state becomes `saved` or `learning`.
- The item remains annotated until the app decides to reduce help or the user marks it known.

### 5.4 Mark an Item as Known

As a learner, I want to mark an item as known so repeated help disappears.

Acceptance:

- Clicking Mark as Known increases `knowledgeConfidence`.
- The lifecycle state becomes `known` or `mastered`.
- Existing annotations refresh.
- Future page loads do not show full ruby while hide-known behavior is enabled.

### 5.5 Ignore an Item

As a learner, I want to ignore an item so it no longer appears as a learning target.

Acceptance:

- Clicking Ignore sets lifecycle state to `ignored`.
- The item is not annotated on future scans unless the user changes settings.
- Exposure counts may still be retained if exposure tracking is enabled.

### 5.6 Restore Page

As a user, I want annotation to be reversible as much as possible.

Acceptance:

- Extension-inserted annotation nodes can be replaced with their original surface text.
- The extension does not promise to restore unrelated page framework changes.

### 5.7 Daily Exposure Statistics

As a learner, I want the extension to automatically count which lexical items I encounter each day, so I can identify high-frequency words in my real reading and prioritize what to remember.

Acceptance:

- When a dictionary-backed lexical item is detected on a page, the extension records a daily exposure summary.
- Repeated encounters of the same lexical item on the same day increase that day's count.
- The extension tracks total exposures and unique page exposures where possible.
- Different surface forms can roll up to the same lemma, such as `食べる` and `食べました`.
- The user can later view the most frequently encountered items for today, this week, or a selected date range.
- The feature does not send browsing history or exposure data to a remote server in the MVP.

### 5.8 Adaptive Help

As a learner, I want the app to become less intrusive as it learns what I know.

Acceptance:

- Newly discovered items can show full ruby.
- Frequently seen items with no user interaction may become subtle hints.
- Saved items can remain more visible while they are being learned.
- Known or mastered items can be hidden.
- High-frequency items with low confidence can be recommended for review.

## 7. Functional Requirements

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

It should also skip:

```text
[hidden]
aria-hidden="true"
data-fading-furigana-ignore
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

- Uses a local sample dictionary.
- Uses longest-match lookup.
- Returns dictionary-backed tokens only.
- Does not attempt full Japanese morphological parsing.

Future analyzer behavior:

- Can use a local dictionary, tokenizer, API, or hybrid provider.
- Can return lemma and conjugation metadata.
- Must not require DOM annotation code to know the dictionary source.

### 6.3 Token Model

`JapaneseToken` is a page-level match. It represents one occurrence inside one text node, not the user's durable vocabulary record.

```ts
type JapaneseToken = {
  id: string;
  lexicalItemId: string;
  surface: string;
  lemma: string;
  readingKana: string;
  baseReadingKana?: string;
  start: number;
  end: number;
  lexicalType: "word" | "phrase" | "compound" | "loanword" | "name" | "grammar";
  scriptProfile: ScriptProfile;
  conjugation?: ConjugationInfo;
  source: {
    provider: "sample" | "local" | "api" | "hybrid";
    confidence: number;
  };
};
```

Supporting types:

```ts
type ScriptProfile = {
  hasKanji: boolean;
  hasHiragana: boolean;
  hasKatakana: boolean;
  hasLatin: boolean;
};

type ConjugationInfo = {
  dictionaryForm?: string;
  form?: string;
  polite?: boolean;
  tense?: "past" | "nonpast" | "unknown";
};
```

### 6.4 Annotation Decision

The extension must decide whether to annotate a token based on:

- Token properties.
- User lexical state.
- Extension settings.
- Exposure and review signals.

Reference behavior:

```ts
function shouldAnnotate(token, userState, settings) {
  if (!settings.annotation.enabled) return false;
  if (settings.annotation.mode === "off") return false;
  if (userState?.lifecycleStatus === "ignored") return false;
  if (settings.annotation.hideKnownItems && userState?.knowledgeConfidence >= 0.85) return false;
  if (settings.annotation.mode === "saved_items_only") return userState?.userIntent.saved === true;
  if (settings.annotation.mode === "adaptive") return token.source.confidence > 0.5;
  return true;
}
```

Annotation mode values:

```text
adaptive
all_items
unknown_items_only
saved_items_only
off
```

### 6.5 Annotation Rendering

The extension may insert ruby:

```html
<ruby class="jr-ruby" data-lexical-item-id="...">
  確認
  <rt>かくにん</rt>
</ruby>
```

It may also support lighter annotation levels later:

```text
full_ruby
compact_ruby
underline
tap_only
hidden
```

Implementation constraints:

- Do not replace `document.body.innerHTML`.
- Do not rewrite entire page sections when replacing one text node is enough.
- Use a `DocumentFragment` to replace individual text nodes.
- Store enough metadata on inserted nodes for tooltip display and restoration.
- Do not count extension-inserted annotation nodes as new reading exposure.

Recommended data attributes:

```text
data-lexical-item-id
data-surface
data-lemma
data-reading-kana
data-source-sentence
data-original-text
data-fading-furigana-annotated
```

### 6.6 Tooltip

Clicking an annotation must show a floating tooltip.

Tooltip fields:

```text
surface
lemma
readingKana
localized meaning
part of speech
loanword origin, if available
source sentence
seen today / total seen, if useful
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
- Avoid duplicate annotation.
- Avoid infinite loops.

### 6.8 Restore

The extension should provide:

```ts
window.FadingFurigana.restore()
```

Restore behavior:

- Find nodes inserted by this extension.
- Replace each annotation node with `data-original-text` or the surface text.
- Do not try to undo unrelated page changes.

### 6.9 Settings

Settings should separate annotation display from exposure tracking.

```ts
type AppSettings = {
  annotation: {
    enabled: boolean;
    mode: "adaptive" | "all_items" | "unknown_items_only" | "saved_items_only" | "off";
    hideKnownItems: boolean;
    showRuby: boolean;
    showLoanwordOrigins: boolean;
    showMeaningsInTooltip: boolean;
  };
  exposureTracking: {
    enabled: boolean;
    saveUrls: "full" | "domain_only" | "hashed" | "none";
    retentionDays: number;
  };
  dictionary: {
    mode: "sample" | "local" | "api" | "hybrid";
  };
};
```

MVP default:

```ts
{
  annotation: {
    enabled: true,
    mode: "adaptive",
    hideKnownItems: true,
    showRuby: true,
    showLoanwordOrigins: true,
    showMeaningsInTooltip: true
  },
  exposureTracking: {
    enabled: true,
    saveUrls: "domain_only",
    retentionDays: 90
  },
  dictionary: {
    mode: "sample"
  }
}
```

### 6.10 Daily Exposure Tracking

The extension should update daily exposure statistics when it identifies a dictionary-backed token.

Requirements:

- Count exposures by local calendar day.
- Use the user's local timezone for daily grouping.
- Count by normalized lexical item id, not only by surface form.
- Track surface forms seen that day.
- Track total seen count and unique page count.
- Batch or debounce storage writes on pages with many matches.
- Avoid counting extension restore/reinsert cycles as new reading exposure.
- Do not track exposure when `settings.exposureTracking.enabled` is false.
- If annotation is disabled but exposure tracking is enabled, the extension may scan without rendering, but the UI must make that behavior clear.

Suggested future behavior:

- Show "Today's frequent items".
- Show "This week's recurring items".
- Suggest review targets based on high frequency + low knowledge confidence.
- Let users filter out known, mastered, or ignored items.

## 8. Data Model

### 7.1 AppState

All persisted local data should be represented as a versioned state object.

```ts
type AppState = {
  schemaVersion: 1;
  userProfile: UserProfile;
  settings: AppSettings;
  lexicalItems: Record<LexicalItemId, LexicalItem>;
  userLexicalStates: Record<LexicalItemId, UserLexicalState>;
  sourceOccurrences: Record<OccurrenceId, SourceOccurrence>;
  dailyExposureSummaries: Record<DailyExposureId, DailyExposureSummary>;
  reviewLogs: Record<ReviewLogId, ReviewLog>;
  metadata: AppMetadata;
};
```

The `schemaVersion` field is required. Future versions must define migrations from older persisted states.

### 7.2 UserProfile

```ts
type UserProfile = {
  targetLanguage: "ja";
  nativeLanguages: LocaleCode[];
  preferredMeaningLanguages: LocaleCode[];
};
```

Example:

```ts
{
  targetLanguage: "ja",
  nativeLanguages: ["zhHans"],
  preferredMeaningLanguages: ["zhHans", "en", "ja"]
}
```

### 7.3 LexicalItem

`LexicalItem` describes the dictionary-level item. It does not describe whether the user knows it.

```ts
type LexicalItem = {
  id: LexicalItemId;
  surface: string;
  lemma: string;
  readingKana: string;
  baseReadingKana?: string;
  lexicalType: "word" | "phrase" | "compound" | "loanword" | "name" | "grammar";
  scriptProfile: ScriptProfile;
  partOfSpeech: string[];
  meanings: Record<LocaleCode, string[]>;
  conjugation?: ConjugationInfo;
  loanword?: LoanwordInfo;
  difficulty?: {
    jlpt?: "N5" | "N4" | "N3" | "N2" | "N1";
    frequencyRank?: number;
    gradeLevel?: string;
  };
  source: {
    provider: "sample" | "local" | "api" | "hybrid";
    confidence: number;
  };
  createdAt: string;
  updatedAt: string;
};
```

Loanword metadata must not assume English origin:

```ts
type LoanwordInfo = {
  isLoanword: boolean;
  originLanguage?: LocaleCode;
  originalForm?: string;
  confidence?: number;
};
```

Examples:

```ts
{
  id: "食べる:たべる",
  surface: "食べる",
  lemma: "食べる",
  readingKana: "たべる",
  baseReadingKana: "たべる",
  lexicalType: "word",
  scriptProfile: {
    hasKanji: true,
    hasHiragana: true,
    hasKatakana: false,
    hasLatin: false
  },
  partOfSpeech: ["verb"],
  meanings: {
    en: ["to eat"],
    zhHans: ["吃"],
    ja: ["食物を口に入れる"]
  },
  source: {
    provider: "sample",
    confidence: 1
  },
  createdAt: "2026-06-08T08:00:00.000Z",
  updatedAt: "2026-06-08T08:00:00.000Z"
}
```

```ts
{
  id: "パン:パン",
  surface: "パン",
  lemma: "パン",
  readingKana: "パン",
  lexicalType: "loanword",
  scriptProfile: {
    hasKanji: false,
    hasHiragana: false,
    hasKatakana: true,
    hasLatin: false
  },
  partOfSpeech: ["noun"],
  meanings: {
    en: ["bread"],
    zhHans: ["面包"]
  },
  loanword: {
    isLoanword: true,
    originLanguage: "pt",
    originalForm: "pao",
    confidence: 0.8
  },
  source: {
    provider: "sample",
    confidence: 1
  },
  createdAt: "2026-06-08T08:00:00.000Z",
  updatedAt: "2026-06-08T08:00:00.000Z"
}
```

### 7.4 UserLexicalState

`UserLexicalState` describes the relationship between the user and a lexical item.

```ts
type UserLexicalState = {
  lexicalItemId: LexicalItemId;
  lifecycleStatus:
    | "discovered"
    | "noticed"
    | "saved"
    | "learning"
    | "reviewing"
    | "familiar"
    | "known"
    | "mastered"
    | "ignored";
  knowledgeConfidence: number;
  annotationLevel: "full_ruby" | "compact_ruby" | "underline" | "tap_only" | "hidden";
  userIntent: {
    saved: boolean;
    ignored: boolean;
    manuallyMarkedKnown: boolean;
    manuallyMarkedUnknown: boolean;
  };
  exposure: {
    seenCount: number;
    uniquePageCount: number;
    uniqueSentenceCount: number;
    firstSeenAt?: string;
    lastSeenAt?: string;
  };
  interaction: {
    tooltipOpenCount: number;
    savedCount: number;
    markedKnownCount: number;
    ignoredCount: number;
    lastActionAt?: string;
  };
  learning: {
    reviewStage: "new" | "learning" | "reviewing" | "graduated";
    reviewCount: number;
    correctCount: number;
    wrongCount: number;
    correctStreak: number;
    lastReviewedAt?: string;
    nextReviewAt?: string;
    ease?: number;
  };
  intelligence: {
    inferredDifficulty?: "beginner" | "elementary" | "intermediate" | "advanced";
    confidenceKnown: number;
    confidenceNeedsHelp: number;
    reasonCodes: string[];
  };
};
```

This richer state lets the app distinguish:

```text
seen but ignored by user attention
clicked because it looked unfamiliar
saved intentionally
frequently encountered but not learned
known by explicit user action
mastered through repeated review
```

### 7.5 SourceOccurrence

`SourceOccurrence` records where an item appeared. Detailed occurrence data should be bounded by retention settings.

```ts
type SourceOccurrence = {
  id: OccurrenceId;
  lexicalItemId: LexicalItemId;
  surface: string;
  sentence: string;
  url?: string;
  domain?: string;
  pageTitle?: string;
  contextBefore?: string;
  contextAfter?: string;
  createdAt: string;
};
```

The MVP should prefer saving source occurrences when the user saves or interacts with an item. It should avoid saving every occurrence forever.

### 7.6 DailyExposureSummary

Daily exposure summaries support frequency-based review and adaptive recommendations.

```ts
type DailyExposureSummary = {
  id: DailyExposureId;
  date: string;
  lexicalItemId: LexicalItemId;
  totalSeenCount: number;
  uniquePageCount: number;
  surfaceForms: Record<string, number>;
  pages: Record<string, {
    pageTitle?: string;
    domain?: string;
    seenCount: number;
    firstSeenAt: string;
    lastSeenAt: string;
  }>;
  firstSeenAt: string;
  lastSeenAt: string;
};
```

ID format:

```text
daily-exposure:{yyyy-mm-dd}:{lexicalItemId}
```

Example:

```ts
{
  id: "daily-exposure:2026-06-08:食べる:たべる",
  date: "2026-06-08",
  lexicalItemId: "食べる:たべる",
  totalSeenCount: 6,
  uniquePageCount: 2,
  surfaceForms: {
    "食べる": 2,
    "食べました": 4
  },
  pages: {
    "example.com": {
      pageTitle: "Example Article",
      domain: "example.com",
      seenCount: 4,
      firstSeenAt: "2026-06-08T08:00:00.000Z",
      lastSeenAt: "2026-06-08T08:15:00.000Z"
    }
  },
  firstSeenAt: "2026-06-08T08:00:00.000Z",
  lastSeenAt: "2026-06-08T09:20:00.000Z"
}
```

### 7.7 ReviewLog

```ts
type ReviewLog = {
  id: ReviewLogId;
  lexicalItemId: LexicalItemId;
  result: "correct" | "wrong" | "skipped";
  reviewedAt: string;
  previousLifecycleStatus: string;
  nextLifecycleStatus: string;
};
```

### 7.8 Metadata and IDs

Base aliases:

```ts
type LocaleCode = string;
type LexicalItemId = string;
type OccurrenceId = string;
type DailyExposureId = string;
type ReviewLogId = string;
```

```ts
type AppMetadata = {
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
};
```

ID rules:

```text
LexicalItemId = normalize(lemma + ":" + baseReadingKana)
OccurrenceId = "occurrence:" + lexicalItemId + ":" + timestamp
DailyExposureId = "daily-exposure:" + yyyy-mm-dd + ":" + lexicalItemId
ReviewLogId = "review:" + lexicalItemId + ":" + timestamp
```

Normalization should use NFKC, trim whitespace, lowercase Latin characters, and collapse internal whitespace.

### 7.9 Repository Interfaces

The extension must use repository abstractions instead of coupling annotation code to a specific storage backend.

```ts
interface LexicalItemRepository {
  getLexicalItemById(id: LexicalItemId): Promise<LexicalItem | null> | LexicalItem | null;
  upsertLexicalItem(item: LexicalItem): Promise<void> | void;
  listVocabulary(): Promise<LexicalItem[]> | LexicalItem[];
}

interface UserLexicalStateRepository {
  getUserState(id: LexicalItemId): Promise<UserLexicalState | null> | UserLexicalState | null;
  updateUserState(state: UserLexicalState): Promise<void> | void;
}

interface ExposureRepository {
  recordDailyExposure(input: {
    lexicalItemId: LexicalItemId;
    surface: string;
    url?: string;
    domain?: string;
    pageTitle?: string;
    seenAt: string;
  }): Promise<void> | void;
  listDailyExposures(date: string): Promise<DailyExposureSummary[]> | DailyExposureSummary[];
  listFrequentItems(range: {
    startDate: string;
    endDate: string;
  }): Promise<DailyExposureSummary[]> | DailyExposureSummary[];
}

interface StorageAdapter {
  loadState(): Promise<AppState> | AppState;
  saveState(state: AppState): Promise<void> | void;
  clearState(): Promise<void> | void;
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
-> chrome.storage.local
```

## 9. Architecture

Recommended components:

```text
DictionaryProvider
  Owns dictionary entries, lookup strategy, and provider-specific confidence.

JapaneseAnalyzer
  Converts page text into JapaneseToken[].

AnnotationEngine
  Scans DOM, filters tokens, inserts annotations, restores annotations.

Tooltip
  Owns word-card UI and actions.

LexicalItemRepository
  Owns dictionary-level lexical items.

UserLexicalStateRepository
  Owns user learning state for each lexical item.

ExposureRepository
  Owns daily exposure summaries and frequency queries.

SettingsRepository
  Owns extension settings and user preferences.

StorageAdapter
  Owns persistence details for localStorage, chrome.storage, or Safari bridge storage.
```

Component boundary rule:

```text
Tokenizer/dictionary logic must not know about DOM nodes.
DOM annotation logic must not know about platform storage details.
Storage adapters must not contain annotation rules.
Exposure tracking must not require annotation rendering to be enabled.
```

## 10. File Structure

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
  core/
    dictionaryProvider.ts
    japaneseAnalyzer.ts
    annotationDecision.ts
    ids.ts
    types.ts
  repositories/
    lexicalItemRepository.ts
    userLexicalStateRepository.ts
    exposureRepository.ts
    settingsRepository.ts
  storage/
    localStorageAdapter.ts
    chromeStorageAdapter.ts
    safariStorageAdapter.ts
    migrations.ts
  platform/
    safariBridge.ts
    chromeBridge.ts
    webDemoPlatform.ts
  styles/
    annotation.css
tests/
  japaneseAnalyzer.test.ts
  annotationEngine.test.ts
  annotationDecision.test.ts
  exposureRepository.test.ts
  storageMigration.test.ts
```

## 11. Safari Web Extension Design

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
  vocabulary UI, exposure stats, review state, and privacy settings
```

Important Safari constraint:

```text
Do not assume the content script can directly access the iOS app's local data.
```

The storage adapter should hide this communication path from `AnnotationEngine`.

## 12. Chrome Extension Design

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
chromeStorageAdapter
chromeBackgroundBridge
manifest permissions
```

Chrome mobile is not a reliable target for this product. Do not plan MVP mobile support around Chrome extensions.

## 13. Security and Privacy Requirements

The extension should:

- Avoid sending page text to remote services in MVP.
- Store vocabulary locally.
- Store exposure statistics locally in MVP.
- Request the minimum practical host permissions.
- Avoid annotating password fields, input fields, forms, code blocks, and editable content.
- Avoid injecting third-party scripts.
- Avoid logging full page text in production.
- Clearly disclose that page text is processed locally for annotation.
- Clearly disclose whether exposure tracking is enabled.
- Let users disable exposure tracking separately from annotation display.
- Let users clear vocabulary and exposure data.
- Support URL privacy options for exposure tracking:

```text
full URL
domain only
hashed page key
no URL/page storage
```

Default MVP URL storage should be:

```text
domain only
```

Retention requirements:

- Daily summary data can be retained longer.
- Raw source occurrences should be bounded by retention settings.
- Default detailed occurrence retention should be no more than 90 days.
- Incognito/private browsing should not be tracked unless explicitly allowed by the platform and user.

## 14. Performance Requirements

The extension should:

- Avoid scanning pages that do not contain Japanese text.
- Avoid rescanning the entire page too often.
- Debounce mutation handling.
- Batch exposure writes.
- Avoid duplicate annotations.
- Keep dictionary lookup efficient enough for article pages.
- Prefer replacing individual text nodes instead of large DOM subtrees.

Future improvements:

- Limit annotation to visible/article-like regions.
- Batch large pages.
- Add maximum text-node length safeguards.
- Cache analyzer results for repeated text nodes.
- Cache daily exposure increments per page before flushing to storage.

## 15. Testing Requirements

### 14.1 Analyzer Tests

Given:

```text
メールの内容を確認してください。昨日ラーメンを食べました。
```

Expected tokens:

```text
確認 / かくにん
食べました / たべました -> lemma 食べる
```

### 14.2 Annotation Tests

Verify:

- Ruby is inserted for dictionary-backed lexical items.
- `pre`, `code`, form controls, and existing `ruby` are skipped.
- Annotation does not duplicate after repeated scans.
- Restore removes inserted annotation nodes.

### 14.3 State Tests

Verify:

- Discovered items are annotated according to settings.
- High-confidence known items are hidden when `hideKnownItems` is true.
- Ignored items are never annotated.
- `saved_items_only` only annotates saved or learning items.

### 14.4 Interaction Tests

Verify:

- Clicking an annotation opens tooltip.
- Save persists lexical item, user state, and source occurrence.
- Ignore removes annotation after refresh.
- Mark as Known removes or reduces annotation after refresh.

### 14.5 Exposure Tests

Verify:

- Daily exposure counts group by local date.
- Multiple surface forms roll up to the same lexical item.
- Unique page counts are stable for repeated encounters on one page.
- Exposure tracking can be disabled.
- Annotation disabled does not imply exposure tracking disabled unless settings say so.

## 16. Manual Acceptance Checklist

Use `demo/test-page.html`.

Starting state:

- Clear local data.
- Load the demo page.

Expected:

```text
確認 -> かくにん
申請 -> しんせい
影響 -> えいきょう
サーバー -> server or source-form hint in the prototype
```

Skipped content:

```text
The 確認 inside <pre> is not annotated.
```

Tooltip:

```text
Click 申請.
Tooltip shows surface, reading, localized meaning, source sentence, and actions.
```

Mark known:

```text
Click 確認.
Click Mark as Known.
確認 no longer has full ruby.
申請 still has ruby.
Refresh page.
確認 remains reduced or unannotated.
```

Restore:

```text
Call window.FadingFurigana.restore().
Inserted annotation nodes are replaced with original surface text.
```

Exposure:

```text
Load a page with repeated 食べる / 食べました.
Daily exposure summary rolls both forms up to 食べる.
Frequent items can be listed for the current date.
```

## 17. Milestones

### Milestone 1: Prototype Annotation

Status: implemented in this folder.

Deliverables:

- Sample dictionary.
- Longest-match analyzer.
- DOM TreeWalker.
- Ruby insertion.
- Tooltip.
- Save / Ignore / Mark as Known.
- Local persistence.
- MutationObserver.
- Restore.
- Cloudflare demo deployment.

### Milestone 2: Data Model and Storage Foundation

Deliverables:

- Define `AppState` v1.
- Add default state factory.
- Add migration strategy.
- Add `StorageAdapter`.
- Preserve current demo behavior.

### Milestone 3: Repository and Exposure Layer

Deliverables:

- Add lexical item repository.
- Add user lexical state repository.
- Add exposure repository.
- Add daily frequency queries.
- Add tests for state updates and daily grouping.

### Milestone 4: TypeScript and Annotation Tests

Deliverables:

- Split `contentScript.js` into typed modules.
- Add analyzer tests.
- Add annotation-decision tests.
- Add DOM annotation tests using a browser-like environment.
- Add exposure tracking tests.

### Milestone 5: Safari Extension Packaging

Deliverables:

- Xcode iOS app container.
- Safari Web Extension target.
- Content script and CSS packaged into extension target.
- Background script message bridge.
- Native app extension bridge.
- App Group entitlement.
- Shared storage adapter.

### Milestone 6: Extension UI and Settings

Deliverables:

- Extension popup or app-controlled settings.
- Annotation mode.
- Hide known items toggle.
- Enable/disable annotation.
- Enable/disable exposure tracking.
- URL privacy mode.
- Restore annotations command.
- Today's frequent items view.

### Milestone 7: Chrome Desktop Port

Deliverables:

- Chrome MV3 manifest.
- Chrome background service worker.
- Chrome storage adapter.
- Cross-browser compatibility tests.

## 18. Open Questions

- Should first-seen items be persisted automatically, or should daily summaries update without creating full user state?
- What exact threshold turns `discovered` into `familiar`?
- Should high-frequency ignored items remain visible in analytics?
- Should annotation be automatic on all sites, or only after user activation per page/domain?
- Should source sentence extraction use simple punctuation rules or a stronger sentence splitter?
- Should `tap_only` mode render underlines, subtle background, or no visible mark?
- Should URL storage default to `domain_only` or `hashed` for privacy?
- How many dictionary entries should ship in the first public MVP?
- Which tokenizer or dictionary should power the first real analyzer?

## 19. Current Prototype Limitations

- The dictionary has only a few sample entries.
- The analyzer does not handle conjugation or full Japanese tokenization.
- State persistence uses `localStorage`, not Safari App Group storage or `chrome.storage.local`.
- The tooltip is intentionally simple.
- Daily exposure statistics are specified but not implemented.
- The restore function only restores extension-inserted annotation nodes.
- The current prototype is not yet an Xcode-packaged Safari Web Extension app.

## 20. Product Principle

The extension should help users gradually stop needing visible help.

The goal is not:

```text
Show as much help as possible forever.
```

The goal is:

```text
Show enough help now, learn from real reading behavior, then make the help disappear as the user learns.
```
