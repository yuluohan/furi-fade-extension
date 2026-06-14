# Third-Party Notices and Attributions

Fading Furigana bundles third-party data and code that require attribution.
These notices must be surfaced to users before public distribution — at minimum
in an in-app "Acknowledgements" view (Mac app About/Settings) and/or on the
public website, and the App Store listing should point to where they live.

Last reviewed: 2026-06-14

> Note: attribution wording below is drafted from the upstream license terms.
> Confirm the exact required text and the ShareAlike obligation (see JMdict)
> with the latest upstream license pages before publishing.

## JMdict / JMnedict dictionary data — EDRDG

- What we use: dictionary entries (surfaces, readings, meanings, difficulty
  signals) generated from JMdict into `packages/extension/src/dictionary/data/`.
- Source: JMdict/EDICT, the Japanese-Multilingual dictionary project.
- Copyright holder: Electronic Dictionary Research and Development Group
  (EDRDG), Monash University.
- License: Creative Commons Attribution-ShareAlike 4.0 International
  (CC BY-SA 4.0).
- License pages:
  - https://www.edrdg.org/edrdg/licence.html
  - https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project
- Required attribution (draft): "This product uses the JMdict/EDICT dictionary
  files. These files are the property of the Electronic Dictionary Research and
  Development Group, and are used in conformance with the Group's licence."

### ShareAlike obligation to confirm before launch

CC BY-SA 4.0 is a copyleft data license. The dictionary data we ship is a
processed/derived form of JMdict. Before public launch, confirm whether the
generated `jmdictCommonData.js` is treated as an adaptation of the database and,
if so, that we satisfy the ShareAlike terms (make the adapted data available
under a compatible license, with attribution). This is a legal-review item, not
just a string of attribution text.

## kuromoji.js morphological analyzer — Atilika / takuyaa

- What we use: vendored kuromoji build in `packages/extension/src/tokenizer/`.
- Origin: kuromoji (Java) by Atilika Inc., and the JavaScript port kuromoji.js.
- License: Apache License, Version 2.0.
- License page: https://www.apache.org/licenses/LICENSE-2.0
- Required: reproduce the Apache-2.0 license text and preserve the original
  copyright/NOTICE attribution (Copyright Atilika Inc. and kuromoji.js authors).

## IPADIC dictionary (bundled with kuromoji)

- What we use: the IPADIC morphological dictionary shipped with the kuromoji
  build under `packages/extension/src/tokenizer/dict/`.
- Origin: IPADIC, Nara Institute of Science and Technology (NAIST).
- License: IPADIC license (permissive, BSD-style; requires reproduction of the
  copyright notice and license terms).
- Required: reproduce the IPADIC copyright notice and license text.

## Action items before public launch

- [ ] Obtain and store the verbatim upstream license texts (EDRDG licence,
      Apache-2.0, IPADIC license) in the repo.
- [ ] Confirm the JMdict CC BY-SA 4.0 ShareAlike obligation with legal review.
- [ ] Add an in-app "Acknowledgements" view (Mac app) listing these notices.
- [ ] Reference acknowledgements from the App Store listing / website.
</content>
</invoke>
