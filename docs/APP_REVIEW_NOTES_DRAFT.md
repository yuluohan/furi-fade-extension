# App Review Notes Draft

These notes are draft copy for App Store Connect / TestFlight beta review.

## Summary

Fading Furigana is a macOS app bundled with a Safari Web Extension for Japanese reading practice. The extension adds furigana to Japanese words on webpages, lets users save words, and shares same-device learning data with the Mac app through an App Group container.

## Safari Extension Behavior

The extension runs on webpages so it can detect Japanese text and annotate words in place. It uses broad host access because the feature is intended to work on user-selected Japanese reading pages, including articles, search results, documentation, and other arbitrary websites.

The extension does not create a user account for Basic. For the MVP, learning data is stored locally on the user's Mac and shared only between the Safari extension and the container app through:

```text
group.com.banyuguru.fading-furigana
```

## Data Stored Locally

The local AppState may include:

- Saved vocabulary and learning status.
- Review history and next review dates.
- Daily exposure/review summaries.
- Example sentence context for saved words.
- Page context such as page title and URL only when the user's privacy setting allows URL saving.
- Local entitlement state for trial and Basic purchase status.

The app includes settings for page URL retention and local storage diagnostics/reset.

## In-App Purchase

The macOS Basic product id is:

```text
com.banyuguru.fadingfurigana.basic.macos
```

Basic unlocks the local single-platform Safari extension + Mac app learning loop after the trial. Existing local learning data remains present if the trial expires or purchase verification is temporarily unavailable.

Pro sync, cross-device backup, Chrome-to-Mac sync, iOS, Android, and Windows clients are not part of this MVP.

## Suggested Reviewer Flow

1. Open the Mac app and confirm the dashboard appears.
2. Enable the Safari extension from Safari Settings.
3. Visit a Japanese webpage.
4. Click an annotated word and save it.
5. Return to the Mac app and confirm the saved word appears in the library.
6. Mark the word Known or Forgot in the Mac app.
7. Refresh the Safari page and confirm annotation behavior reflects the updated status.
8. Open Settings to review trial/Basic state, privacy controls, storage diagnostics, and extension status.

## Current Beta Caveat

This is a local-first MVP beta. Cross-device sync and cloud backup are intentionally not enabled.
