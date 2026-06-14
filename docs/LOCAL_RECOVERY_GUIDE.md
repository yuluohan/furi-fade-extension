# Local Recovery Guide

Last updated: 2026-06-14

This guide is for beta testers and support. It intentionally does not define a portable export/import flow, because cross-device migration belongs to the future paid sync product boundary.

## What Is Stored Locally

The Basic MVP stores learning data on the same Mac in the app group container:

```text
group.com.banyuguru.fading-furigana
```

The main state file is:

```text
Library/Application Support/FadingFurigana/app-state-v1.json
```

The Mac app and Safari extension both read and write this shared state through the app group.

## Before Reset Or Reinstall

Before resetting local data, reinstalling the app, or removing beta builds:

1. Open Settings.
2. Go to Data and Privacy.
3. Check Storage Health.
4. Confirm whether the app reports shared App Group storage.
5. If support has asked for a backup, copy the local state file from the app group container before resetting.

Do not use copied state files as a cross-device migration path.

## Built-In Recovery Behavior

When the app resets local state, it moves the existing state file aside to a timestamped backup before writing a fresh default state.

Backup file pattern:

```text
app-state-v1.backup-YYYYMMDD-HHMMSS.json
```

When the native bridge writes state from Safari, it may also create a `.bak` file next to the main state file before replacing it.

## If The App Shows Storage Problems

Use this order:

1. Confirm Safari extension is enabled.
2. Open the Mac app Settings window.
3. Check Data and Privacy > Storage Health.
4. Use Reload Local State if the file exists and is readable.
5. If the file is unreadable, preserve the current file for support before using Reset Local Data.
6. Re-test saving one word from Safari and refreshing the Mac app.

## Support Checklist

Ask the tester for:

- macOS version.
- App version and build number.
- Whether the Safari extension is enabled.
- Storage Health status.
- Whether `app-state-v1.json` exists.
- Whether a timestamped backup exists.
- The last action before the issue appeared.

Avoid asking beta testers to manually edit JSON unless debugging a development build.
