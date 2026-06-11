# Dictionary Data

## Current Source

The extension now packages a local JMdict priority tier at:

```text
src/dictionary/data/jmdictCommonData.js
```

The generated file contains all priority-marked Japanese lexical surfaces extracted from `JMdict_e.gz`. The current packaged tier has roughly 40k+ surfaces because one JMdict entry can expand into multiple written forms.

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

Default generation builds the eager priority tier:

```bash
node scripts/buildJmdictCommonData.js --tier=priority /path/to/JMdict_e.gz
```

Supported tiers:

```text
common
  Legacy capped subset. Use with --limit=5000 when a small debug file is needed.

priority
  Default eager tier. Includes every JMdict entry with priority markers and is packaged with the extension.

full
  Full JMdict export path reserved for the future lazy/background lookup tier.
```

The script:

- reads JMdict XML,
- keeps entries with JMdict priority markers for the `priority` tier,
- filters out punctuation and number-starting entries,
- stores English glosses in `meanings.en`,
- stores source metadata as `source.provider = "jmdict"`,
- writes an extension-ready browser script.

## Current Limits

- The packaged priority tier is English-only because it is generated from `JMdict_e.gz`.
- Chinese meanings still come from existing curated override entries, not from JMdict.
- Full JMdict lazy lookup is not implemented yet; tooltip meanings outside the priority tier may still be empty.
- Loanword origin is not solved by JMdict; curated loanword origin data remains separate.
