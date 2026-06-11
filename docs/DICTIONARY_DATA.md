# Dictionary Data

## Current Source

The extension now packages a local JMdict common subset at:

```text
src/dictionary/data/jmdictCommonData.js
```

The generated file contains 5,000 common Japanese lexical entries extracted from `JMdict_e.gz`.

Source project:

```text
JMdict / EDICT Dictionary Project
https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project
```

License:

```text
Creative Commons Attribution-ShareAlike
```

## Why Local Data

The browser extension should work on normal pages without calling a remote API for every token. A packaged local subset keeps annotation fast, private, and available in Chrome and Safari.

## Generation

Download the official JMdict English gzip file, then run:

```bash
node scripts/buildJmdictCommonData.js /path/to/JMdict_e.gz
```

The script:

- reads JMdict XML,
- keeps entries with JMdict priority markers,
- filters out punctuation and number-starting entries,
- stores English glosses in `meanings.en`,
- stores source metadata as `source.provider = "jmdict"`,
- writes an extension-ready browser script.

## Current Limits

- The packaged subset is English-only because it is generated from `JMdict_e.gz`.
- Chinese meanings still come from existing curated override entries, not from JMdict.
- Morphological analysis is still longest-surface matching, not full tokenization.
- Inflected forms that are not exact surfaces may not be detected until a tokenizer is integrated.
- Loanword origin is not solved by JMdict; curated loanword origin data remains separate.
