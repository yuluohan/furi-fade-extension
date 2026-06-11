# dictionary-data

Tooling for the dictionary assets that ship inside `packages/extension/src/` (extension manifests need the files physically in the extension package, so generated/vendored artifacts live there; this package holds only the generators).

- `scripts/buildJmdictCommonData.js` — generates `packages/extension/src/dictionary/data/jmdictCommonData.js` from `JMdict_e.gz` (download from the EDRDG project; default source path `/private/tmp/JMdict_e.gz`). Tier via `--tier` / `JMDICT_TIER` (`priority` keeps all priority-marked entries, ~43k). Run: `npm run build:jmdict`.
- `scripts/vendorKuromoji.js` — copies the kuromoji browser build + IPADIC dictionaries from `node_modules` into `packages/extension/src/tokenizer/`. Run: `npm run vendor:kuromoji`.

Licensing: JMdict is CC BY-SA (EDRDG); IPADIC carries its own license inside the kuromoji package. See `docs/DICTIONARY_DATA.md`.
