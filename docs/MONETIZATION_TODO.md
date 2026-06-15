# Monetization Todo

This document turns the current pricing goal into implementable tasks.

Business target:

- Trial: one month of Basic functionality.
- Basic: one-time purchase for one platform's local learning loop.
- Pro: subscription for cross-platform sync, cloud backup, and advanced intelligence.
- No user-facing portable export/import. Cross-device migration is part of paid sync.

Price targets are product intent, not final App Store configuration:

- China mainland target: approximately CNY 6 for Basic.
- US target: approximately USD 0.99 or USD 1 for Basic.
- Final storefront prices must be chosen in App Store Connect / Chrome Web Store / Stripe from each platform's available price points.

## Current Capability Map

### Already Basic-Capable

- [x] Safari extension annotation.
- [x] Local AppState vocabulary store.
- [x] Save / Known / Forgot / Ignore / Restore / Always Show actions.
- [x] Word detail sheet.
- [x] Local review queue and SRS basics.
- [x] Local exposure statistics.
- [x] Today / Library / Discover views.
- [x] Basic frequent-word suggestions.
- [x] Manual level filtering foundation.
- [x] Mac App automatic AppState refresh.
- [x] Undo and operation feedback.
- [x] Chinese / English interface.
- [x] Local-only same-device App Group bridge between Safari extension and Mac app.

### Already Pro-Adjacent

- [x] AppState schema has domains needed for future sync.
- [x] Sync architecture design exists.
- [x] Review logs are append-only with client-generated IDs.
- [x] Daily exposure summaries exist.

## Basic Launch Todo

Basic is the first sellable tier. It must feel useful after trial without needing any account.

- [x] Define exact Basic lock rules after the one-month trial.
- [x] Add local entitlement schema: trial start date, trial expiry, Basic purchase state, platform id, last receipt check.
- [x] Add StoreKit purchase flow for macOS Basic one-time purchase.
- [ ] Add StoreKit purchase flow for iOS Basic one-time purchase.
- [x] Add purchase restore flow for macOS Basic.
- [x] Add offline behavior: cached entitlement remains usable; failed receipt checks do not destroy local access.
- [x] Add Mac app paywall sheet shown after trial expiry.
- [x] Add Safari extension paywall gate for expired-trial Save.
- [x] Add settings section showing trial/purchase status.
- [x] Add app copy explaining that local data remains safe when trial expires.
- [x] Add app copy explaining Basic is single-platform/local, not cross-device sync.
- [ ] Add signed release build flow for a Basic beta candidate.
- [x] Add App Store review notes for Safari extension + local AppState behavior.
- [x] Add privacy policy page covering local storage, page URL settings, and no account requirement for Basic.
- [x] Add Terms / purchase copy for one-time Basic unlock.
- [ ] Manually test: fresh install -> trial starts.
- [ ] Manually test: trial expired -> Basic paywall appears.
- [ ] Manually test: purchase unlocks Basic.
- [ ] Manually test: restore purchase unlocks Basic.
- [ ] Manually test: existing local vocabulary survives trial expiry and purchase.

## Basic Feature Boundary

Basic includes:

- [x] Local annotation and vocabulary.
- [x] Local review.
- [x] Local word detail.
- [x] Local today / 7-day exposure stats.
- [x] Manual level filtering.
- [x] Same-device Safari extension + Mac app data bridge.

Basic should not include:

- [ ] Cross-device sync.
- [ ] Cloud backup/restore.
- [ ] Cross-platform migration.
- [ ] User-facing portable export/import.
- [ ] Account-based device list.
- [ ] Server-side long-term analytics.
- [ ] Behavior-driven automatic level model.
- [ ] Advanced intelligent recommendation engine.

## Basic Entitlement Design

The entitlement record should live in local AppState metadata or a small sibling entitlement file in the same trusted local store. It should be readable by the Mac app and extension, but written by the app once StoreKit is added.

Recommended shape:

```json
{
  "entitlements": {
    "schemaVersion": 1,
    "platform": "apple-macos",
    "trial": {
      "startedAt": "2026-06-13T00:00:00.000Z",
      "expiresAt": "2026-07-13T00:00:00.000Z",
      "source": "first_app_launch"
    },
    "basic": {
      "status": "not_purchased",
      "productId": "com.banyuguru.fadingfurigana.basic.macos",
      "purchasedAt": null,
      "lastVerifiedAt": null,
      "verificationStatus": "not_checked"
    },
    "pro": {
      "status": "not_subscribed",
      "productId": null,
      "currentPeriodEndsAt": null,
      "lastVerifiedAt": null
    },
    "access": {
      "tier": "trial",
      "basicUnlocked": true,
      "proUnlocked": false,
      "computedAt": "2026-06-13T00:00:00.000Z"
    }
  }
}
```

Status values:

- `trial.access.tier`: `trial`, `basic`, `pro`, or `expired`.
- `basic.status`: `not_purchased`, `purchased`, `refunded`, or `unknown`.
- `basic.verificationStatus`: `not_checked`, `verified`, `failed_offline`, `failed_invalid`, or `pending_restore`.
- `pro.status`: `not_subscribed`, `active`, `grace_period`, `expired`, or `unknown`.

Product IDs should be platform-specific at first:

- Apple macOS Basic: `com.banyuguru.fadingfurigana.basic.macos`
- Apple iOS Basic: decide later whether it is separate or a universal Apple unlock.
- Chrome Basic: decide after Chrome Web Store monetization route is chosen.

## Trial Rules

- Trial starts on the first successful Mac app launch that can write the local store.
- Trial length is 31 days for implementation simplicity and user perception as "one month".
- Trial start must be persisted immediately and never silently reset.
- If the local store is missing because of a fresh reinstall, treat it as a new local install during MVP; server-side anti-abuse can wait until accounts exist.
- If the system clock moves backward, do not delete data or panic. Keep the previous computed expiry result when possible and show a neutral "purchase status needs refresh" state.
- Extension annotation should read the computed access state; it should not independently decide trial dates.

## Post-Trial Lock Rules

When trial is active or Basic is purchased:

- Safari annotation is enabled according to user settings.
- Save / Known / Forgot / Ignore / Always Show actions are enabled.
- Mac app Today / Library / Discover are enabled.
- Local review and local exposure stats are enabled.

When trial is expired and Basic is not purchased:

- Local vocabulary and history remain visible.
- Local data is never deleted, hidden, or corrupted.
- Review of already saved words remains available as a goodwill feature.
- New word saving from Safari is locked behind the Basic paywall.
- Continuous annotation can show a limited preview state, but should not keep building a full free replacement for Basic.
- Settings remain accessible.
- Restore Purchase remains accessible.
- Pro upsell should not replace the Basic paywall; Basic is the lowest-friction path.

The lock should feel like "continue your local learning loop with Basic", not like data hostage-taking.

Implementation status:

- 2026-06-13 Phase A done: Mac app opens the Basic paywall after trial expiry, and all Mac app Save entry points are blocked behind Basic while existing data and review stay available.
- 2026-06-13 Phase B done: Safari extension Save reloads the latest entitlement before writing, blocks expired-trial saves in `WordRepositoryService`, and keeps the tooltip open with a localized Basic unlock prompt.

## Paywall Design

Trigger points:

- Trial expired and user tries to save a new word.
- Trial expired and user opens the app.
- User taps a locked Basic feature in Settings or dashboard.
- User taps a Pro-only feature before subscribing.

Basic paywall content:

- Title: "Continue learning locally"
- Main copy: "Your words stay on this Mac. Basic unlocks the local Safari extension and Mac learning app after the trial."
- Safety copy: "Your saved words are not deleted when the trial ends."
- Boundary copy: "Basic is for this platform. Cross-device sync and advanced intelligence are part of Pro."
- Primary action: "Unlock Basic"
- Secondary action: "Restore Purchase"
- Tertiary action: "Not now"

Pro paywall content:

- Title: "Sync and learn across devices"
- Main copy: "Pro adds cross-device sync, cloud backup, long-term word frequency, and smarter recommendations."
- Boundary copy: "Basic local learning keeps working without Pro."
- Primary action: "Start Pro"
- Secondary action: "Restore Subscription"

## Settings Entitlement UI

Settings should show:

- Current tier: Trial, Basic, Pro, or Trial Expired.
- Trial days remaining when trial is active.
- Basic purchase status and Restore Purchase button.
- Pro subscription status once Pro exists.
- Short data-safety sentence: "Local vocabulary stays on this device even if purchase status changes."
- Short boundary sentence: "Sync and cloud backup require Pro."

## Offline And Restore Behavior

- A previously verified Basic purchase remains usable offline.
- A failed network or StoreKit verification must not downgrade access immediately.
- Invalid/refunded purchases can downgrade Basic only after a successful verification says so.
  - [ ] **Not implemented (confirmed 2026-06-15).** `ViewController.applyCurrentEntitlements` /
        `Transaction.updates` only handle `.verified` to *unlock*; there is no
        `revocationDate`/refund handling, and once `basic.status = purchased` is written to
        local AppState there is no downgrade path. Effect: a refunded user keeps Basic.
        Add revocation handling before charging real money.
- Restore Purchase should set `verificationStatus` to `pending_restore` while running.
- If restore fails offline, keep current access and show a retryable error.
- Purchase/restore code should write entitlement state atomically so the extension never sees a half-written entitlement.

## Pro Subscription Todo

Pro should not be required for the Basic MVP launch. Build after Basic purchase and release flow are stable.

- [ ] Define Pro SKU names and billing periods.
- [ ] Add account system.
- [ ] Add subscription entitlement model.
- [ ] Add server-side entitlement verification.
- [ ] Add Cloudflare sync API.
- [x] Add sync schema golden vectors.
- [x] Add per-record `updatedAt`, `deviceId`, and mutation metadata points.
- [ ] Add persisted outbound op log and sync push/pull mutation wrappers.
- [ ] Add device list.
- [ ] Add sync conflict handling and merge tests.
- [ ] Add cloud backup/restore for subscribed accounts.
- [ ] Add Chrome sync adapter.
- [ ] Add Swift sync adapter for Apple apps.
- [ ] Add subscription paywall.
- [ ] Add subscription restore/status UI.
- [ ] Add lapsed subscription behavior: local data remains usable, sync pauses (decision below).

### Tier Relationship & Lapse Decision (2026-06-15)

- **Pro is an add-on purchased on top of Basic.** Owning Basic is a prerequisite for subscribing to Pro; a Pro subscriber always holds the one-time Basic entitlement.
- **When Pro lapses, access falls back to Basic, not to trial-expired.** Because the user always owns Basic, the full local learning loop stays available after a subscription ends — including saving new words locally, status actions, review, and stats. Only cross-device sync, cloud backup/restore, and advanced intelligence pause.
- This is consistent with "Do Not Build → do not lock or delete local data when trial/subscription expires." The difference vs. trial-expired is intentional: trial-expired users never paid, so new-word Save is gated; Pro-lapsed users paid for Basic, so local Save stays open.

## Pro Feature Boundary

Pro includes:

- [ ] Cross-platform sync.
- [ ] Cloud backup and restore.
- [ ] Multi-device merge.
- [ ] Long-term cross-device word frequency.
- [ ] Intelligent recommendation ranking.
- [ ] Automatic user-level estimation.
- [ ] Adaptive hiding based on behavior.
- [ ] Weekly/monthly learning reports.
- [ ] Rich word history across pages/devices.
- [ ] Future cloud dictionary/API enhancements.

## Storefront / Pricing Todo

- [ ] Confirm Apple App Store price point closest to CNY 6.
- [ ] Confirm Apple App Store price point closest to USD 0.99 / USD 1.
- [ ] Confirm whether macOS distribution is Mac App Store first, notarized direct download later, or both.
- [ ] Confirm Chrome Web Store monetization route for Chrome Basic.
- [ ] Confirm Stripe route for Windows/Android/direct builds if needed.
- [ ] Decide whether Basic unlocks "Safari macOS bundle" or "Apple platform bundle" across macOS/iOS.
- [ ] Decide whether first month trial is implemented locally for Basic or through platform introductory offers where available.

## Do Not Build

- [ ] Do not add user-facing AppState export.
- [ ] Do not add user-facing AppState import.
- [ ] Do not let local backup files become a documented migration path.
- [ ] Do not require account login for Basic local use.
- [ ] Do not lock or delete local data when trial/subscription expires.
