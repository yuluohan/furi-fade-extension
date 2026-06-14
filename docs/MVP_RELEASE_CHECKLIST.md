# MVP Release Checklist

This checklist defines the bar for a small external MVP beta. The current product scope is:

- macOS app bundled with Safari Web Extension
- one-month trial for local Basic functionality, then a one-time Basic purchase per platform
- App Group AppState is the source of truth between Safari and the Mac app
- Pro cross-device sync, Chrome-to-Mac sync, iOS, Android, and Windows are out of scope for this MVP

## Release Decision

Status: not ready for public launch, ready to prepare a signed MVP beta.

The core user loop is present:

1. Browse Japanese pages in Safari.
2. Extension annotates words and tracks exposure.
3. User saves, marks known, forgets, ignores, or pins a word.
4. Safari writes shared AppState through the native bridge.
5. Mac app refreshes from App Group storage.
6. Mac app shows Today, Library, Discover, and review actions.

## Must Pass Before External Beta

- [ ] Create a signed Release build with a fixed Apple Development Team.
- [ ] Confirm the installed app shows a single Safari extension entry, not duplicates.
- [ ] Confirm version labels in the Mac app and extension popup match the build being tested.
- [ ] Fresh install smoke test: no existing AppState, onboarding appears, Safari settings opens.
- [ ] Upgrade smoke test: existing `app-state-v1.json` survives build/install/update.
- [ ] Safari save smoke test: save a word on a Japanese page, refresh Mac app, word appears.
- [ ] Mac app write-back smoke test: mark a word Known/Forgot in Mac app, refresh Safari page, annotation behavior changes.
- [ ] Review smoke test: saved word enters review queue, review result appends `reviewLogs`, next review date updates.
- [ ] Language smoke test: switch interface language between English and Chinese, app and popup reflect it.
- [ ] Storage diagnostics smoke test: popup and Mac app both report native/shared storage, not fallback.
- [ ] Real-page annotation smoke tests: Wikipedia, news article, Google results, long page, dynamic page.
- [ ] Privacy copy exists for local storage, page URL retention settings, and future paid sync boundary.
- [ ] Local recovery guidance exists for beta testers before reset/reinstall; do not offer portable export/import.

## Must Pass Before Paid Basic Launch

- [ ] Trial starts on first app use and lasts one month.
- [ ] Trial expiry locks only paid Basic features; local data remains present and safe.
- [ ] Basic one-time purchase unlocks the local single-platform learning loop.
- [ ] Restore purchase works.
- [ ] Purchase state appears in Settings.
- [ ] Paywall explains Basic vs Pro without implying export/import migration.
- [ ] Price points are confirmed in each storefront before release.
- [ ] App review notes explain Safari extension, local AppState, and no account requirement for Basic.
- [ ] Privacy policy and terms cover trial, one-time purchase, subscription, local data, and paid sync boundary.

## Should Pass Before Public Launch

- [ ] Notarized or App Store/TestFlight distribution path chosen.
- [ ] Crash/log collection policy chosen.
- [ ] Local data-loss recovery flow that does not create a cross-device import/export path.
- [ ] Clear recovery UI when App Group storage is unavailable.
- [ ] Extension permission copy reviewed.
- [ ] At least one week of personal daily-use dogfooding without data loss.
- [ ] Known limitations documented: tokenizer mistakes, dictionary coverage gaps, constrained-page fallback behavior.

## Ergonomics Backlog

These are not all required for the first external beta, but they define the product-quality bar for a learning app people will use every day:

- [x] Word detail sheet with learning state, example context, and direct actions.
- [x] Collapsible Mac app navigation for smaller windows.
- [x] Automatic Mac app refresh when Safari writes the shared AppState.
- [x] Undo or short-lived recovery after Save/Known/Forgot/Ignore.
- [x] Clear operation feedback after each word action.
- [ ] Daily review reminder through menu bar, notification, or badge.
- [ ] Keyboard shortcuts for review grading, opening details, and closing sheets.
- [ ] Local-only recovery UI for AppState corruption or accidental reset.
- [ ] Actionable recovery buttons when App Group storage, native bridge, or Safari extension state is unhealthy.
- [ ] Richer word detail history: recent pages/sentences, learning timeline, and why the word was suggested.
- [ ] Annotation appearance customization: choose colors by learning state first, then optionally by difficulty or part of speech.
- [x] Extension popup information architecture: make it a current-page/current-site control panel instead of a miniature full settings app.
- [x] App settings information architecture: make it the full learning, purchase, data, sync, and platform-management settings center.
- [x] Connected extension/platform status: clearly explain Safari shared local data, Chrome local-only data, and Pro sync unification.
- [ ] Accessibility pass: larger text mode, contrast check, VoiceOver labels, and reduced visual fatigue.

## Not Blocking This MVP

- Cross-device paid sync.
- Chrome extension sharing data with the Mac app.
- User-facing portable export/import that can bypass paid sync.
- iOS companion app.
- Android app.
- Windows app.
- Full JMdict lazy lookup or cloud dictionary API.
- App Store monetization.

## Recommended Next Task

Start `T053` by producing a signed beta candidate and running the "Must Pass Before External Beta" section top to bottom.
