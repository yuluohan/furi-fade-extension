# Safari QA Run 2026-06-15

Candidate commit: `005c520`

Purpose: prepare and partially execute the Safari manual QA run described in `docs/SAFARI_MANUAL_QA.md`.

## Command-Level Result

Passed:

- `npm run check`
- Signed development build and install:

```sh
FURI_DEVELOPMENT_TEAM=Y3DTR7LH9K FURI_XCODE_DERIVED_DATA=/tmp/fading-furigana-signed-qa npm run build:safari:mac
```

- Installed app path:

```text
/Users/hanyuluo/Applications/Fading Furigana.app
```

- Installed app signature verified outside the sandbox:

```text
/Users/hanyuluo/Applications/Fading Furigana.app: valid on disk
/Users/hanyuluo/Applications/Fading Furigana.app: satisfies its Designated Requirement
```

- Registered Safari extension discovered outside the sandbox:

```text
com.banyuguru.fading-furigana.Extension(0.1.0)
```

- App version:

```text
0.1.0 (build 1)
```

- Extension manifest version:

```text
Fading Furigana 0.1.0
```

- Installed Safari extension resources matched the latest package according to `scripts/buildSafariMac.js`.

## QA Fixture

Local fixture added:

```text
packages/extension/demo/safari-qa-page.html
```

Served from repo root with:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Opened in Safari:

```text
http://127.0.0.1:8765/packages/extension/demo/safari-qa-page.html
```

Server confirmed page load:

```text
GET /packages/extension/demo/safari-qa-page.html HTTP/1.1" 200
```

## Notes

- The normal sandbox could not read the login keychain or system pluginkit service correctly, producing false negatives such as `CSSMERR_TP_NOT_TRUSTED` and `Connection invalid`.
- Re-running the same verification commands with elevated access confirmed two valid Apple Development identities, valid app signature, and one registered Safari extension entry.
- Safari was already running during install. The build script warned that existing tabs may keep old content scripts. Newly opened pages should load the latest extension; quit/reopen Safari if a manual result looks stale.

## Manual Sections Still Required

Run the visible/browser portions of `docs/SAFARI_MANUAL_QA.md`:

- [ ] Install and extension state in Safari Settings.
- [ ] Fresh-install loop.
- [ ] Annotation quality fixture visual pass.
- [ ] Real-page tests.
- [ ] App Group round trip.
- [ ] Settings round trip.
- [ ] Review flow.
- [ ] Purchase and trial.
- [ ] Upgrade and recovery.

Decision: hold external beta until manual sections pass.
