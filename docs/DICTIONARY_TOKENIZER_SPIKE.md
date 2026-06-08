# Dictionary and Tokenizer Design Spike

Date: 2026-06-08

## Goal

Move from the current sample-only dictionary toward real Japanese word detection while keeping the extension usable in Chrome, demo pages, and eventually Safari.

The immediate goal is not perfect NLP. It is a practical first provider that can:

- Find Japanese lexical items in ordinary web text.
- Return surface form, lemma, reading, part of speech, token offsets, and confidence.
- Support mixed words such as `食べる`, kanji compounds such as `確認`, and katakana loanwords such as `サーバー`.
- Preserve privacy by default and avoid sending page text to a remote API.

## Current State

The current analyzer uses a small in-memory sample dictionary. It is useful for testing ruby annotation, tooltip behavior, storage, and exposure statistics, but it does not perform real morphological analysis.

The existing architecture already has the right provider boundary:

```text
DictionaryProvider -> JapaneseAnalyzer -> AnnotationEngine -> WordRepository/AppState
```

The next implementation should replace the sample `DictionaryProvider` / `JapaneseAnalyzer` internals without changing `AnnotationEngine`.

## Options Reviewed

### Kuromoji.js

Kuromoji.js is a pure JavaScript port of Kuromoji. Its browser usage model requires a built JS file plus gzipped dictionary files, and its tokens include surface form, part of speech, base form, reading, pronunciation, and word position.

Strengths:

- Runs locally in a browser extension.
- Provides readings and lemmas, which are exactly what furigana annotation needs.
- Compatible with the current no-server privacy posture.
- Easier first prototype than Python/Rust/Java engines.

Risks:

- Dictionary assets may be large for an extension and must be packaged carefully.
- Token offsets use word position conventions that need normalization into our zero-based `start` / `end`.
- Browser dictionary loading needs testing inside extension URLs and Cloudflare demo assets.

### Kuromoji Java / Lucene JapaneseAnalyzer

Kuromoji supports word segmentation, part-of-speech tagging, lemmatization, and readings. It also has segmentation modes useful for search-oriented compound splitting.

Strengths:

- Mature morphological analysis concepts and token attributes.
- Good reference for segmentation behavior.

Risks:

- Java runtime is not suitable for an in-browser extension.
- Useful as reference, not as the first implementation path.

### Sudachi

Sudachi was designed to improve Japanese tokenization for business text and dictionary maintenance, including multi-granular token information and normalization.

Strengths:

- Strong long-term direction for quality.
- Multi-granular tokenization is attractive for learner UI because compounds can be split at different levels.

Risks:

- Browser integration is less direct than Kuromoji.js.
- A WASM or API path would add complexity before the extension foundation is ready.

### Remote Dictionary/API

An API can return richer dictionary meanings, loanword origins, difficulty, and examples.

Strengths:

- Best path for multilingual meanings and richer learner intelligence.
- Can combine dictionary, frequency, and AI explanations.

Risks:

- Sending page text creates privacy and trust concerns.
- Needs authentication, quota, latency handling, and offline fallback.
- Too early for the first real tokenizer milestone.

## Decision

Use Kuromoji.js as the first real local tokenizer prototype.

Keep the current sample provider as a fallback and test fixture. Do not add a remote API yet.

Recommended provider order:

```text
SampleDictionaryProvider
KuromojiDictionaryProvider
RemoteDictionaryProvider (future)
```

## Proposed Token Mapping

Kuromoji token fields should map into our token shape like this:

| App Token Field | Kuromoji Field / Derivation |
| --- | --- |
| `surface` | `surface_form` |
| `lemma` / `baseForm` | `basic_form`, fallback to `surface_form` |
| `readingKana` | `reading`, fallback to surface for kana-only words |
| `partOfSpeech` | `pos`, `pos_detail_1`, `pos_detail_2`, `pos_detail_3` filtered for `*` |
| `start` | `word_position - 1` after confirming indexing behavior |
| `end` | `start + surface.length` |
| `lexicalItemId` | `createId(baseForm, readingKana)` |
| `lexicalType` | `loanword` if katakana-heavy noun, otherwise `word` |
| `scriptProfile` | Derived from surface |
| `source.provider` | `kuromoji` |
| `source.confidence` | `0.9` for known dictionary words, lower for unknown tokens |

## Annotation Filtering Rules

The first Kuromoji prototype should ignore:

- Particles, punctuation, symbols, auxiliary verbs, and very short kana-only function words.
- Tokens with no Japanese letters.
- Unknown one-character tokens unless they contain kanji and have a useful reading.

The prototype should include:

- Kanji words, including mixed kanji/kana words like `食べる`.
- Katakana nouns and longer katakana compounds.
- Known dictionary verbs/adjectives when a lemma and reading are available.

## Loanword Handling

Kuromoji does not solve loanword origin. For T021, store katakana tokens as `lexicalType: "loanword"` only when they are katakana-heavy, but leave:

```json
{
  "loanword": {
    "isLoanword": true,
    "originLanguage": undefined,
    "originalForm": undefined,
    "confidence": 0.3
  }
}
```

Real original-form lookup should remain a later dictionary/API problem. The current `サーバー -> server` sample can stay as a fixture proving the UI path.

## Implementation Plan for T021

1. Add `src/dictionary/kuromojiProvider.js`.
2. Package or reference Kuromoji browser build and dictionary assets in a controlled location.
3. Add an async tokenizer initialization path because Kuromoji builds tokenizer state before use.
4. Keep `SampleDictionaryProvider` as fallback if tokenizer loading fails.
5. Add analyzer tests for:
   - `確認してください`
   - `食べる`
   - `サーバーの状態`
   - punctuation and particles skipped by annotation rules
6. Verify extension and demo load paths separately.

## T021 Prototype Result

The first prototype adds `src/dictionary/localDictionaryProvider.js` instead of packaging Kuromoji assets immediately.

Reason:

- It removes dictionary/analyzer code from `contentScript.js` and creates the provider boundary needed by Kuromoji.
- It keeps the extension dependency-free while the package and dictionary asset strategy is still being validated.
- It adds a small local subset that covers kanji compounds, mixed kanji/kana words, and katakana loanword UI behavior.

Covered examples:

- `確認`
- `申請`
- `影響`
- `状態`
- `食べる`
- `サーバー`

The next true tokenizer step is still Kuromoji.js packaging and async initialization.

## Source Notes

- Kuromoji.js README: browser usage requires `build/kuromoji.js` and `dict/*.dat.gz`; tokens include surface form, part of speech, base form, reading, pronunciation, and word position.
- Kuromoji project page: Kuromoji supports word segmentation, part-of-speech tagging, lemmatization, and readings; it also documents segmentation modes for compounds.
- Sudachi paper: Sudachi emphasizes business-text tokenization, multi-granular token information, normalized form information, and continuously maintained dictionaries.

Source URLs:

- https://github.com/takuyaa/kuromoji.js
- https://atilika.org/
- https://aclanthology.org/L18-1355.pdf
