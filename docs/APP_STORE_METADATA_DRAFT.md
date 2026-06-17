# App Store Metadata Draft

## Product Page

App name: Fading Furigana

Subtitle: Learn Japanese as you browse

Promotional text:
Turn everyday Japanese pages into lightweight vocabulary practice. Save words, fade furigana as you learn, and review locally on your Mac.

Description:
Fading Furigana is a Safari extension and Mac companion app for Japanese learners who read real web pages.

The extension annotates Japanese text in Safari, lets you save useful words, and adapts the reading aid as your memory improves. The Mac app keeps your local library, daily review, word detail, learning activity, storage health, and settings in one place.

MVP scope:

- Safari Web Extension for macOS
- Local-first learning data stored in the app group container
- No account required for Basic
- One-month trial, then a one-time Basic purchase for local single-platform use
- Future Pro sync will be optional and account-based

Keywords:
Japanese, furigana, kanji, vocabulary, Safari extension, language learning, reading, JLPT, SRS

Acknowledgements / third-party data:
This app uses JMdict/EDICT dictionary data (© EDRDG, CC BY-SA 4.0), the
kuromoji morphological analyzer (Apache-2.0), and IPADIC (NAIST). See
`docs/THIRD_PARTY_NOTICES.md`. These attributions must be surfaced in-app
and/or on the website before public distribution.

Support URL:
TODO: public support URL.

Marketing URL:
TODO: public product URL.

Privacy Policy URL:
TODO: public privacy policy URL.

## App Review Notes

Fading Furigana includes a Safari Web Extension. The extension requests broad website access because its core feature is annotating Japanese text on arbitrary pages the user chooses to read.

For the MVP, Basic does not require an account. Purchase testing uses StoreKit/App Store purchase entitlement for the local Mac app. Learning data is stored locally in the app group container shared by the Mac app and Safari extension.

The app includes `PrivacyInfo.xcprivacy` manifests. The macOS app declares no tracking, no collected data types, and file timestamp access for local AppState storage diagnostics. The Safari extension declares no tracking, no collected data types, and no required-reason API access.

Page URL retention is configurable. Depending on user settings, the app may retain no page URL, domain-only source information, or full URL source information in local storage.

Public policy/support URLs are not final yet and must be added before external distribution.

## Beta Review Information

Demo account:
Not required for Basic MVP.

Purchases:
Use StoreKit sandbox to test the one-month trial, Basic unlock, and restore purchase flow for `com.japanstudylab.fadingfurigana.basic.macos`.

Test steps:

1. Install the macOS app and enable the Safari extension.
2. Open a Japanese web page in Safari.
3. Confirm Japanese text is annotated.
4. Save a word from the page.
5. Open the Mac app and confirm the word appears in the library.
6. Mark the word Known/Forgot and refresh Safari to confirm annotation behavior changes.
7. Open Settings to confirm purchase state, data/privacy settings, and storage health.
