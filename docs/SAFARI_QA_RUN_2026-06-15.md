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

## Full Manual Run — 2026-06-15 (signed rebuild incl. T065 fix)

Executed against a fresh, signed, single-registered install. Entitlement reset to a
true trial first (deleted the StoreKit Testing transaction + cleared `app-state-v1.json`,
per §8 note). Browser-side actions performed by the tester; data side verified against the
App Group `app-state-v1.json`.

Manual sections:

- [x] Install and extension state — single extension registered, footer/popup report `Shared container` (not fallback), versions match `0.1.0 (1)`.
- [x] Fresh-install loop — onboarding on empty state; enabling extension annotates the fixture without app restart; first save auto-refreshes the Mac app.
- [x] Annotation quality fixture — baseline words annotate; no wrong `いししつ` reading; unrelated kana parens ignored; code/`data-fading-furigana-ignore` not annotated; dynamic + viewport-lazy annotate; links navigate / Option-click opens tooltip. `石質隕石` left unannotated (rare compound; no wrong reading → passes the bar).
- [x] Real pages — ja.wikipedia.org, www.yahoo.co.jp, www.aozora.gr.jp, localhost fixture all annotate and write exposure back (~2492 words accumulated).
- [x] App Group round trip — Safari Save/Known/Forgot/Ignore/Pin all write; Mac app Known/Forgot write back; refresh reflects state both directions.
- [x] Settings round trip — interface language zh⇄en, `userLevel` n5, status colors, site pause (`siteOverrides`), and URL privacy verified: `domain_only` stores domain only; `none` stores `pageKey:"private-page"` with no url/domain/title.
- [x] Review flow — grading appends `reviewLogs`; per-word `reviewCount`/`reviewStage`/`nextReviewAt` update (multi-grade easy/good/forgot).
- [x] Purchase and trial — fresh install → trial (31 days); expired override blocks new Safari Save; Basic purchase (StoreKit testing, $0.99, Touch ID) → `basic.status=purchased`, `tier=basic`, override auto-cleared; Restore Purchase re-verifies. (Not separately retested: Safari Save after purchase — Basic is unlocked.)
- [x] Upgrade and recovery — data survived repeated signed rebuilds/reinstalls; storage diagnostics show `Normal — shared with Safari`, word count, and update timestamp, with Show-in-Finder / Reload / Reset controls. Native-bridge fallback path not destructively tested.

### Blocking bug found and fixed

- **T065** — `WordRepositoryService.persistImmediately` overwrote shared state with the
  content tab's stale snapshot (re-merging only `settings`/`entitlements`), so a Safari
  word action after a Mac app review wiped `reviewLogs` and per-word `learning` schedule.
  Fixed with per-record LWW merge of all record-keyed domains; regression test added;
  rebuilt and re-verified live (review → Safari action, reviewLogs and all schedules
  preserved). Committed `4358f86`.

### Backlog filed (non-blocking)

- **T066** — exposure-only word records grow unbounded (~2492 words = 6.94 MB; no eviction).
- **T067** — decide expired-trial boundary for Known/Forgot/Ignore (only Save is gated today).
- **T068** — localize the "已标记为忘记" toast (renders Chinese under English UI).

### Observations (non-blocking)

- Xcode-run instance briefly reports `Unable to read Safari extension status (SFErrorDomain error 1)`; the `open`-installed app reads it fine. Xcode-run quirk, not a defect.
- StoreKit Testing transaction must be deleted after purchase testing or fresh installs resolve to `basic` (see §8 note in `SAFARI_MANUAL_QA.md`); transaction was deleted after this run.

Decision: core local loop (annotate → save → two-way sync → review → purchase) verified on a
signed build with the T065 fix. No blocking failures remain. Ready to proceed toward an
external beta candidate; T066–T068 tracked for follow-up.
