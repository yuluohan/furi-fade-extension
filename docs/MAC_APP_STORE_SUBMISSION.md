# Mac App Store Submission Runbook

Target: ship the macOS app + bundled Safari Web Extension to the **Mac App Store**
under Apple Developer team `W3JAJZ2RRU` (ZHUOQUN XU) (`com.japanstudylab.fadingfurigana`).

This is a higher bar than the external beta in `MVP_RELEASE_CHECKLIST.md`.
Order matters: account/agreements → signing → build/upload → listing → review.

Last updated: 2026-06-16 (distribution team set to `W3JAJZ2RRU`; the earlier local
dev/QA teams `Y3DTR7LH9K` (project) / `H4589RR2Z3` (local cert) were development-only
and are being retired in favor of the enrolled paid account `W3JAJZ2RRU`).

## Already satisfied (verified)

- [x] App Sandbox enabled on **both** targets (`com.apple.security.app-sandbox`) — mandatory for MAS.
- [x] App Group entitlement on both targets (`group.com.japanstudylab.fadingfurigana`).
- [x] Privacy manifests (`PrivacyInfo.xcprivacy`) on app + extension.
- [x] Complete app icon set incl. 1024×1024 marketing icon.
- [x] In-app purchase code (StoreKit 2) + trial/Basic entitlement model implemented.
- [~] Signed build pipeline verified locally under the previous dev team; project
      `DEVELOPMENT_TEAM` is now `W3JAJZ2RRU` — re-verify `npm run build:safari:mac` after
      adding the `W3JAJZ2RRU` Apple ID + development signing in Xcode (see section C).
- [x] Draft store copy: description, keywords, privacy policy, terms, privacy answers, review notes.

## A. Apple account & agreements (App Store Connect — you, browser)

- [x] Team `W3JAJZ2RRU` (ZHUOQUN XU) has an active **paid Apple Developer Program** membership (approved 2026-06-16).
- [ ] Accept the **Paid Apps Agreement**; complete **Tax & Banking** (required to sell the Basic IAP).
- [ ] Create the app record in App Store Connect for bundle id `com.japanstudylab.fadingfurigana`.
- [ ] Set primary language, category, and content rights.

## B. In-app purchase setup (App Store Connect)

- [ ] Create the **non-consumable** IAP product `com.japanstudylab.fadingfurigana.basic.macos`
      (the local `.storekit` file does NOT create a real product).
- [ ] Set price tier, localized name/description, and the IAP review screenshot.
- [ ] Plan to submit this IAP **together with the first app version** (first-time IAP must
      ship with an app submission).

## C. Distribution signing (machine gap — you/Xcode)

- [ ] Add the `W3JAJZ2RRU` Apple ID in Xcode → Settings → Accounts so Xcode can
      manage signing for it (the machine's only cert today is `H4589RR2Z3` dev).
- [ ] Create an **Apple Distribution** certificate for `W3JAJZ2RRU`
      (machine currently has only **Apple Development**).
- [ ] Create a **Mac Installer Distribution** certificate (signs the uploaded `.pkg`).
- [ ] Generate **Mac App Store** provisioning profiles for the app + extension
      (Xcode "Distribute App" can manage these automatically once the certs exist).

## D. Build & upload

- [~] Release archive compiled cleanly under the previous dev team (probed 2026-06-14:
      `ARCHIVE SUCCEEDED`, sandbox + app-group entitlements present, extension appex
      bundled). Must re-archive under `W3JAJZ2RRU` once its signing is set up; App Store
      export still needs the distribution certs in section C.
- [ ] Ensure the archive uses the full packaging pipeline so the extension Resources
      mirror is current (never a bare Xcode build that ships stale extension JS).
- [ ] Xcode Organizer → **Distribute App → App Store Connect → Upload**.

## E. Listing assets & metadata

- [ ] **macOS screenshots** (required; none in repo yet) — at supported sizes
      (e.g. 1280×800 / 1440×900 / 2560×1600 / 2880×1800).
- [ ] **Privacy Policy URL** (required field), Support URL, Marketing URL — finalize
      and insert into `docs/APP_STORE_METADATA_DRAFT.md`.
- [ ] Contact email for review/support.
- [ ] App description / keywords / promo text (drafted — finalize).
- [ ] **Privacy nutrition label** answers (drafted — `docs/APP_STORE_PRIVACY_ANSWERS_DRAFT.md`).
- [ ] **Age rating** questionnaire.
- [ ] **Export compliance** (uses only standard HTTPS → typically declare exempt).

## F. App Review risk areas (MAS-specific)

- [ ] **Trial model framing.** "One-month free trial → one-time non-consumable purchase"
      is a **locally-enforced** trial, not a StoreKit free trial (those are subscription-only).
      Review notes must say this and give reviewers a path to reach the paid state
      (sandbox tester / steps). Do not imply a StoreKit trial in copy.
- [ ] **Safari extension `<all_urls>`** justification (drafted in review notes).
- [ ] **Third-party data attribution**: JMdict/EDICT (EDRDG, CC BY-SA 4.0), kuromoji
      (Apache-2.0), IPADIC (NAIST) surfaced in an in-app Acknowledgements view; confirm
      the JMdict ShareAlike obligation. See `docs/THIRD_PARTY_NOTICES.md`.
- [ ] Reviewer-testable core loop: install → enable extension → annotate a Japanese page →
      save → Mac app shows it (steps drafted in `docs/APP_REVIEW_NOTES_DRAFT.md`).

## Notes

- The Xcode project already contains iOS targets/scheme. iOS submission is intentionally
  out of scope here; see the iOS sequencing discussion / `docs/SYNC_AND_CLIENTS_DESIGN.md`
  (iOS pairs best with Phase 2 paid sync).
- Cross-device sync is Pro/Phase 2 and not part of this macOS Basic submission.
</content>
