# Prelaunch Audit 2026-06-14

This audit captures the automated checks run before preparing the first signed macOS Safari Web Extension beta.

## Result

Status: code is ready for a signed beta candidate, but this machine cannot produce a signed build yet.

Blocking item:

- Install or regenerate the Apple signing certificate/private key for development team `Y3DTR7LH9K`, then run a signed Release build.

## Automated Checks Passed

- `npm run check`
- `npm test`
- `npm run package:safari`
- `FURI_SAFARI_COMPILE_ONLY=1 FURI_XCODE_DERIVED_DATA=/tmp/fading-furigana-release-compile npm run build:safari:mac`
- Unsigned Release compile:
  `xcodebuild -project apps/apple/Fading\ Furigana/Fading\ Furigana.xcodeproj -scheme Fading\ Furigana\ \(macOS\) -configuration Release -derivedDataPath /tmp/fading-furigana-release-nosign CODE_SIGNING_ALLOWED=NO build`
- macOS app/extension plist and entitlement syntax checks:
  `plutil -lint`
- StoreKit configuration JSON check:
  `python3 -m json.tool apps/apple/Fading\ Furigana/Fading\ Furigana.storekit`
- Extension source sync spot checks:
  `annotationEngine.js`, `appState.js`, and `annotation.css` match between `packages/extension/src` and the bundled Safari extension resources.

## Signed Build Failure

Signed Release currently fails with:

```text
No signing certificate "Mac Development" found: No "Mac Development" signing certificate matching team ID "Y3DTR7LH9K" with a private key was found.
```

This affects both:

- `Fading Furigana (macOS)`
- `Fading Furigana Extension (macOS)`

## Build Metadata

- App bundle id: `com.banyuguru.fading-furigana`
- Extension bundle id: `com.banyuguru.fading-furigana.Extension`
- App Group: `group.com.banyuguru.fading-furigana`
- Marketing version: `0.1.0`
- Build number: `1`
- macOS Basic IAP product id: `com.banyuguru.fadingfurigana.basic.macos`
- Safari extension manifest version: `0.1.0`
- Safari extension display name: `Fading Furigana`

## Review-Sensitive Areas

- The Safari extension uses `<all_urls>` because it annotates Japanese text on arbitrary pages selected by the user. The App Review notes should explicitly explain this.
- Page URL saving is user-configurable. The privacy policy and review notes should explain when URLs are retained and that local learning data stays on the Mac for Basic.
- The macOS app and Safari extension now include `PrivacyInfo.xcprivacy` resources. Both declare no tracking and no collected data types. The macOS app declares file timestamp access for local AppState storage diagnostics; the extension declares no required-reason API access.
- No final public privacy policy or terms page exists in the repo yet; draft copy now exists in `docs/PRIVACY_POLICY_DRAFT.md`.

## Manual Beta Smoke Tests Still Required

- Create a signed Release build.
- Install the signed app and confirm Safari shows a single extension entry.
- Confirm the Mac app and popup both show `0.1.0`.
- Fresh install: no existing AppState, onboarding appears, Safari settings opens.
- Upgrade install: existing `app-state-v1.json` survives.
- Safari save: save a word on a Japanese page, refresh the Mac app, confirm the word appears.
- Mac app write-back: mark a word Known/Forgot in the Mac app, refresh Safari, confirm annotation behavior changes.
- Review flow: saved word enters review queue, grading appends `reviewLogs`, next review date updates.
- Language switch: English and Chinese update the app and popup.
- Storage diagnostics: popup and Mac app both report native/shared storage.
- Real pages: Wikipedia, news article, Google results, long page, dynamic page.
- IAP sandbox: trial start, trial expiry paywall, Basic purchase, restore purchase, data survives purchase state changes.

## Distribution Notes

Apple's TestFlight documentation says external testers require beta app description and beta app review information, and the first external build must pass beta App Review before it can be shared. If distributing outside the Mac App Store, Apple documents notarization as the normal macOS software distribution path.
