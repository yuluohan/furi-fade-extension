# App Store Privacy Answers Draft

Last updated: 2026-06-14

Use this as a working checklist for App Store Connect privacy answers. Confirm against the final submitted binary and public privacy policy before upload.

## Tracking

Does this app track users?

Draft answer: No.

Rationale: The Basic MVP does not use advertising identifiers, does not sell personal data, and does not combine learning data with third-party data for advertising or tracking.

## Data Collection

Does this app collect data from this app?

Draft answer: No, for the Basic MVP.

Rationale: Saved words, review history, settings, and page context are stored locally on the user's Mac through App Group storage. The Basic MVP does not upload learning data to a Fading Furigana server.

Apple may process App Store purchase, TestFlight, crash, or diagnostic information under Apple's systems and policies.

## Browsing Data

Does the app access web content?

Draft answer: Yes, locally, through the Safari Web Extension.

Rationale: The extension reads webpage text selected by the user's browsing context so it can identify Japanese words and render furigana annotations. For the Basic MVP, this page text is processed locally.

## Page URLs

Are page URLs retained?

Draft answer: User-configurable local retention.

Options in the app:

- Off: no page URL retained.
- Domain only: local source context may keep the site domain.
- Full URL: local source context may keep the full page URL.

These values are local Basic data and are not uploaded to a Fading Furigana server in the MVP.

## Purchases

Does the app use purchases?

Draft answer: Yes.

Rationale: Basic uses StoreKit/App Store purchase and restore flows. Purchase processing is handled by Apple.

## Account

Does Basic require an account?

Draft answer: No.

Rationale: Basic is a local single-platform learning loop. A future Pro sync feature may require an account and updated privacy disclosures before release.
