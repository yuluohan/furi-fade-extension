# Settings Panel UX and Platform Relationship Plan

Date: 2026-06-13

## Product Positioning

The relationship should be defined in one sentence:

**The extension panel controls how annotation behaves right now in the current browser; the app settings manage the user's learning system, purchase state, data, sync, and cross-platform setup.**

The current issue is not that the product has too few settings. The issue is that the extension popup and the app settings both look like places to configure the same thing. A user can reasonably ask:

> Should I change this in the extension, or in the app?

The product should answer that through structure, not help text.

## Current Problems

The extension popup currently includes:

- Interface language.
- Annotation on/off.
- Annotation mode.
- User level.
- Display style.
- Smart compact areas.
- Hide known words.
- Daily exposure tracking.
- URL privacy.
- Word frequency lists.
- Storage diagnostics.
- Reset and Save.

This makes the popup feel like a miniature settings app. But when users open a browser extension popup, they usually want to control the current page or the current site quickly.

The Mac app settings currently include:

- Annotation settings.
- User level.
- Display style.
- Exposure tracking.
- URL privacy.
- Interface language.
- Safari extension settings entry.
- Purchase and restore purchase.

This is closer to a real system settings surface, but it does not yet clearly explain:

- Which settings affect the Safari extension.
- Which settings belong only to the app.
- What will happen later with Chrome, iOS Safari, Android, and Windows.
- Why Safari extension data and Chrome extension data may not be the same before Pro sync.

## Recommended Product Split

### Extension Panel

The extension panel should keep high-frequency, immediate, browser-context controls:

- Current site annotation on/off.
- Current page or current site pause/resume.
- Current page display style: Auto, Ruby, Tap hints.
- Quick user level switch: All, N5, N4, N3, N2, N1.
- Light word actions from tooltip/card: Save, Known, Forgot, Ignore, Always Show.
- Today's small summary: words seen today, words saved today.
- Current page status: annotating, paused, unsupported page, storage fallback, trial expired.
- One clear entry to full settings.

It should not try to be the full settings app.

### App Settings

The app settings should own low-frequency, global, account, purchase, data, and platform management:

- Global annotation behavior.
- Learning language and interface language.
- Exposure statistics retention period.
- URL privacy policy.
- Trial, Basic, Pro, purchase, and restore purchase.
- Connected extensions and platform status.
- Sync, account, and device management.
- Advanced appearance customization, such as colors by word state.
- Recovery flows for local storage or native bridge problems.

The app is the learning system center. The extension is the browser control surface.

## Future Platform Principles

Do not make users understand terms like "StorageAdapter", "App Group", "native bridge", or "local AppState".

Use user-facing language like:

- This Mac's Safari data.
- This Chrome browser's data.
- This iPhone's Safari data.
- Turn on Pro to sync across devices.

The platform model should follow these principles:

- Every client should be useful by itself.
- The app is the learning center for its own platform.
- Pro is the only feature that unifies data across platforms.
- Trial and Basic stay local and should not require an account.
- The product should not imply that Chrome and Safari share data unless Pro sync is enabled.

## Important Platform Scenarios

### User Only Installs Chrome Extension

The Chrome extension must be independently useful. It cannot require the Mac app.

It should support:

- Annotation.
- Save/Known/Forgot/Ignore/Always Show.
- Basic local settings.
- Basic local purchase or unlock path appropriate to the Chrome distribution route.
- A review or learning entry point, even if lighter than the native app.
- Pro sign-in and sync when available.

### User Only Installs iOS Safari Extension

The iOS Safari extension should stay minimal.

The complete settings experience should live in the iOS app. The extension panel should focus on:

- Enable/disable for current site.
- Current page/site status.
- Open the app.
- Clear locked or unsupported state messaging.

### User Installs Safari Extension and Mac App

This is the current MVP bundle.

The user-facing model should be:

**Safari extension and Mac app share this Mac's local data.**

The settings should show:

- Safari extension connected/enabled.
- Shared local data status.
- Current app and extension build versions.
- Recovery actions if the extension is disabled or the native bridge falls back.

### User Installs Safari Extension, Chrome Extension, and Mac App

The default user-facing message should be:

**Safari extension and Mac app share this Mac's data. Chrome has its own local browser data. Turn on Pro sync to unify them.**

Before Pro sync, Chrome-to-Mac data sharing should not be implied.

After Pro sync, the app should show that both clients are connected to the same account and syncing through the cloud.

## Proposed New Extension Popup Structure

### Top Status

- Annotating this page.
- Paused on this site.
- Unsupported page.
- Trial: X days left.
- Basic unlocked.
- Save locked after trial expiry.

### Quick Controls

- Annotation on/off.
- Pause/enable current site.
- Display style: Auto, Ruby, Tap hints.
- User level: All, N5, N4, N3, N2, N1.

### Today's Small Summary

- Seen today: X words.
- Saved today: X words.

The popup should show only a compact summary, not full analytics.

### Footer

- Full Settings.
- Open Learning App on Safari/macOS and Safari/iOS.
- Open web or sync settings on Chrome when no companion app exists.

## Proposed New App Settings Structure

### Learning Experience

- Annotation mode.
- Known up to level.
- Hide known words.
- Smart compact areas.

### Appearance

- Default display style: Auto, Ruby, Tap hints.
- Color customization by word state:
  - New.
  - Learning.
  - Known.
  - Ignored.
  - Always Show / pinned.
- Later optional overlays:
  - Difficulty level.
  - Part of speech.
- Reset to defaults.
- Contrast safety check.

### Data and Privacy

- Daily word statistics.
- URL saving policy.
- Retention period.
- Local storage health and recovery.

### Extensions

- Safari: connected, disabled, fallback, or not installed.
- Chrome: not connected, local-only, or synced through Pro.
- iOS Safari: future support.
- Per-extension build/version status.
- Platform-specific setup actions.

### Purchase and Sync

- Trial status.
- Basic local unlock.
- Pro cross-platform sync.
- Restore purchase.
- Account and connected devices when Pro exists.

## Key UX Improvements

- The extension popup should not require a complex Reset/Save flow. Changes should apply immediately where possible.
- Dangerous reset or recovery actions should live in the app settings, not in the popup.
- The popup should not contain deep analytics. It should show only compact current-day summaries.
- Full word frequency, learning progress, review, and history belong in the app.
- The app settings need a clear "Extensions" section that explains what is connected, where data is stored, and why Safari and Chrome may differ before Pro sync.
- The app should avoid technical storage language in primary UI. Technical details can remain in diagnostics or tooltips.

## Recommended Implementation Order

1. Refactor the information architecture before adding more settings.
2. Slim the extension popup into a current-page/browser control panel.
3. Upgrade app settings into the complete settings center.
4. Add connected extension/platform status.
5. Add annotation color customization and other advanced appearance controls.

## Implementation Notes

- Keep one shared settings schema where possible, but present it differently by surface.
- The same setting can appear in both places only if the user's intent is different:
  - Popup: quick current browsing adjustment.
  - App: persistent global preference.
- Site-specific settings may need a new domain in `AppState`, separate from global settings.
- Chrome must remain standalone until Pro sync exists.
- Safari macOS and iOS should use the app as the complete settings home because the extension is bundled with a container app.

## Non-Goals

- Do not add portable export/import to solve cross-platform movement. Cross-platform unification belongs to Pro sync.
- Do not require an account for Trial or Basic local use.
- Do not make Chrome depend on the Mac app.
- Do not expose implementation terms as primary user-facing concepts.
