# Privacy Policy Draft

Last updated: 2026-06-14

This is draft product copy for the Fading Furigana MVP. Review before publishing and replace the contact/support placeholders.

## Overview

Fading Furigana helps you read Japanese by adding furigana annotations to words on webpages and saving words you choose to learn.

For the Basic MVP, Fading Furigana is local-first. It does not require an account, and your learning data is stored on your Mac.

## Data Stored On Your Device

Fading Furigana may store the following data locally:

- Words you save or mark as known, forgotten, ignored, or pinned.
- Readings, dictionary meanings, and estimated difficulty information.
- Review history, review schedule, and daily learning activity.
- Example sentence context for saved words.
- App settings such as annotation behavior, status colors, language, and privacy choices.
- Trial and Basic purchase entitlement status.

## Page Information

The Safari extension reads webpage text so it can find Japanese words and add furigana annotations.

When you save or review a word, Fading Furigana may store page context such as the page title, sentence, and URL. URL saving is controlled by the app's privacy settings. If URL saving is disabled, saved word context should not retain the page URL.

URL retention options:

- Off: do not retain page URLs for saved context.
- Domain only: retain the site domain without the full page URL.
- Full URL: retain the full page URL for saved context.

## Local Storage And Same-Device Sharing

On macOS, the Safari extension and Mac app share local learning data through Apple's App Group storage for:

```text
group.com.japanstudylab.fadingfurigana
```

This same-device sharing lets words saved in Safari appear in the Mac app without creating an account.

## Purchases

Fading Furigana Basic is planned as a one-time purchase for the local single-platform learning loop. Purchase and restore operations use Apple's StoreKit APIs.

Your saved words are not deleted when a trial ends, when purchase status changes, or when purchase verification is temporarily unavailable.

## Sync

Cross-device sync and cloud backup are not part of the Basic MVP. If a future Pro sync feature is added, this policy should be updated before release to explain account data, cloud storage, retention, and deletion.

## Data Sharing

For the Basic MVP, Fading Furigana does not sell personal data and does not use learning data for advertising.

For the Basic MVP, Fading Furigana does not upload your learning history, saved words, page context, or review history to a Fading Furigana server.

Apple may process purchase and diagnostic information according to Apple's own terms and privacy policies when you use App Store purchases, TestFlight, or system-level diagnostics.

## Privacy Manifest Summary

The macOS app and Safari extension include Apple privacy manifests.

- Tracking: no.
- Collected data types declared by this app: none.
- Required-reason API access: the macOS app declares file timestamp access for local AppState storage diagnostics. The Safari extension declares no required-reason API access.

## User Controls

The app includes settings for:

- Annotation behavior.
- Page URL retention.
- Local storage health.
- Reloading local state.
- Resetting local data.

## Contact

Add support contact information before publishing.
