# Sync and Multi-Client Architecture Design

Date: 2026-06-11

Concrete design for the product rule defined in `DEVELOPMENT_DESIGN.md` §6: free single-device local use, paid multi-device cloud sync. Covers Safari (macOS), Safari (iOS), Chrome, and the macOS / Windows / iOS / Android apps.

## 1. The product rule, stated precisely

```text
Free  = full local functionality on each device, no account, no sync.
Paid  = an account plus cloud sync that connects devices together.
```

Two consequences that simplify everything:

- **"One device free" needs no enforcement.** A free user may install on three devices; they simply get three independent local datasets. The thing being sold is the *connection*, not the features. No device fingerprinting, no local license checks, nothing to crack — the paid capability physically lives on the server.
- **The free path must never touch the account system.** No login wall, no nag on first run. The account UI appears only when the user asks for sync.

One deliberate exception: a Safari extension and its container app on the *same* device share data for free through App Group storage (`SAFARI_STORAGE_BRIDGE_DESIGN.md`). That is one device, not sync.

## 2. Client matrix and code sharing

| Client | UI tech | Core logic | Role |
| --- | --- | --- | --- |
| Chrome extension | WebExtension (existing) | JS core (existing) | Annotate, capture, light actions |
| Safari macOS extension | Same WebExtension code | JS core | Same |
| Safari iOS extension | Same WebExtension code | JS core, local analyzer only | Same, memory-constrained |
| macOS app | SwiftUI (existing Xcode container) | Swift domain + App Group state | Review/SRS, vocab, stats, account, billing |
| iOS app | Same SwiftUI multiplatform project | Same | Same; also hosts the iOS Safari extension |
| Android app | Later: Kotlin/Compose (or Flutter) | Port of domain spec | Review on the go |
| Windows app | Later: Tauri wrapping the JS core | JS core reused | Review; Chrome covers annotation |

Decisions:

- **One WebExtension codebase for all three extensions.** Already true. The iOS Safari extension cannot host kuromoji (extension memory limits); it runs the existing local-analyzer fallback (Intl.Segmenter + packaged dictionary), which the architecture already supports. A native tokenizer bridge through the containing app is a later optimization, not a blocker.
- **macOS and iOS apps are one SwiftUI multiplatform target** — the Xcode project that exists today as the Safari container. The apps must exist anyway to distribute the Safari extensions, so the learning app rides along for free. This pairs each Safari extension with a same-device app sharing data via App Group.
- **Do not build seven clients at once.** Android and Windows are phase 3; Chrome on Windows already covers annotation there, and export/import covers migration until then.

### The single source of truth is the data contract, not a code library

Domain logic will exist in at least two languages (JS for extensions, Swift for apps; later Kotlin). Sharing a binary core across all of them costs more than it saves. Instead:

- A versioned, platform-neutral **sync schema** (the `AppState` domains plus sync metadata) is specified once, in this repo, as JSON Schema plus a merge-rules document.
- A set of **golden test vectors** (input states → merged output) lives beside the schema. Every implementation (JS, Swift, Kotlin) must pass the same vectors. This is what keeps three implementations honest, cheaply.

## 3. Sync protocol

Local-first replication, not state upload. Whole-state sync (today's `AppState` blob) cannot merge two devices and grows unbounded; the unit of sync is the **change**, not the state.

```text
Device keeps:  local AppState  +  outbound op log  +  server cursor
Sync push:     ops since last acked op
Sync pull:     ops since cursor, applied through merge rules
New device:    download snapshot, then tail the op log
```

Merge rules are chosen so conflicts are structurally impossible or trivially resolvable — no interactive conflict UI, ever:

| Domain | Rule |
| --- | --- |
| `dailyExposureSummaries` | **Additive deltas.** Devices ship per-word-per-day count increments; the server sums. Never conflicts. |
| `reviewLogs` | Append-only with client-generated IDs. Never conflicts. |
| `userLexicalStates` | Last-write-wins per record (`updatedAt`, `deviceId` as tiebreak). A save on the phone and an ignore on the laptop seconds apart: latest intent wins — correct for user-intent data. |
| `lexicalItems` | LWW per record; mostly dictionary-derived and identical across devices anyway. |
| `settings`, `userProfile` | LWW per object. |
| Deletions | Tombstones (`deletedAt`), garbage-collected server-side after all devices ack. |

Required schema additions (cheap now, expensive to retrofit — see §7): per-record `updatedAt` (mostly present), stable `deviceId`, monotonic per-device `opSeq`, and `schemaVersion` already exists.

## 4. Accounts, payments, entitlements

```text
            App Store IAP      Play Billing      Stripe (web)
                  \                 |                /
                   server-side receipt validation
                              |
                    entitlements table (account → plan, expiry)
                              |
                    sync API: refuses push/pull without active plan
```

- **One account, one subscription, every platform.** Subscribing on iOS unlocks sync in Chrome. Receipts/webhooks (App Store Server API, Play Developer API, Stripe) all normalize into one server-side entitlement record. Never trust client-side receipt checks.
- Store rules dictate the payment rail per platform: IAP on iOS/macOS App Store, Play Billing on Android, Stripe checkout for Chrome/Windows users (link from extension popup to the web).
- Sign-in: Sign in with Apple (mandatory on iOS once any third-party login exists) + email magic link. Avoid passwords.
- Grace behavior: when a subscription lapses, sync stops but **local data stays fully usable on every device** — devices degrade to independent free islands. Never hold data hostage; it also keeps refund/billing disputes low-stakes.

## 5. Per-client topology

```text
[Chrome ext] ──────────────── cloud sync (JS sync adapter)
[Safari macOS ext] ── App Group ── [macOS app] ── cloud sync (Swift)
[Safari iOS ext]   ── App Group ── [iOS app]   ── cloud sync (Swift)
[Android app] ─────────────── cloud sync (Kotlin)
[Windows app] ─────────────── cloud sync (JS core via Tauri)
```

- On Apple platforms the **app owns cloud sync**; the extension reads/writes the shared App Group store and stays simple. (MV3 extension service workers are a poor place for long-lived sync anyway.)
- The Chrome extension has no companion, so it embeds the JS sync adapter directly in its background worker (sync on startup, on storage change debounce, on alarm).
- `CloudSyncAdapter` wraps the existing `StorageAdapter` boundary exactly as `DEVELOPMENT_DESIGN.md` §6 prescribes; annotation code never knows sync exists.

## 6. Server

Cloudflare Workers + D1 (SQLite), reusing the deployment rail this repo already has (wrangler + GitHub Actions):

- Endpoints: `auth` (Apple/magic-link), `sync/push`, `sync/pull`, `sync/snapshot`, `billing/webhooks`, `account/devices`, `account/export`, `account/delete`.
- Tables: `accounts`, `devices`, `entitlements`, `ops` (account, device, seq, domain, payload, ts), `snapshots`.
- Scale shape is friendly: ops are tiny, exposure deltas batch naturally, snapshots compact the log.
- Privacy: exposure data derives from browsing. Domain-only URL policy already exists client-side; the server stores whatever the client chose to record, plus mandatory account export and delete endpoints from day one.

## 7. Phasing

```text
Phase 0 (now, cheap):       Schema prep — deviceId, per-record updatedAt audit,
                            op-log-friendly mutation points, golden vector harness.
Phase 1 (free, no server):  macOS/iOS apps with App Group shared storage and the
                            T025 review UI. Ship value before charging.
Phase 2 (the paid product): CF Workers sync + accounts + Stripe/IAP entitlements;
                            JS sync adapter (Chrome) and Swift sync (apps).
Phase 3 (reach):            Android app; Windows app if demand shows.
```

Phase 0 matters most: every mutation that today writes `AppState` in place must also be expressible as an op (entity, id, fields, updatedAt, deviceId). Doing this while the codebase is small is days; after three more clients exist it is weeks.

## 8. Repository strategy

All clients, the server, and the data contract live in **this one repository**, organized by directory:

```text
packages/core-schema/      sync contract: JSON Schema + merge rules + golden vectors
packages/extension/        today's src/ — one WebExtension codebase, three packaging targets
packages/dictionary-data/  JMdict build + kuromoji assets
apps/apple/                one Xcode project: macOS app, iOS app, both Safari extensions
apps/android/  apps/windows/   phase 3
server/                    CF Workers sync API
docs/
```

Rationale: the cross-language data contract is the asset most at risk of drift, and a monorepo lets one commit atomically change the contract plus every implementation, with the golden vectors enforcing agreement in CI. A solo developer gets none of multi-repo's benefits and all of its version-juggling costs. The "different extension versions" are not separate projects — Chrome / Safari macOS / Safari iOS are three packaging targets of one codebase, and the Safari extensions live as appex targets inside the Apple app project anyway.

Migration is incremental, keyed to one event: **when Phase 1 adds hand-written SwiftUI to the container app, the Xcode project stops being regenerated** by `safari-web-extension-packager --force` (which would destroy hand-written code) and becomes hand-maintained; the build script keeps only the dist → Resources JS sync step. That is the moment `safari/` moves to `apps/apple/`. Until then, no directory churn.

Split a directory into its own repository only if a concrete need appears (outsourced Android development, open-sourcing the extension while keeping the server private). Extracting from a monorepo is easy; merging repositories back is painful.

## 9. Version skew and schema evolution

Clients update on independent schedules (Chrome Web Store auto-updates, App Store, Play). Where skew can and cannot happen:

- **A Safari extension can never skew against its own container app**: the appex ships inside the app bundle and updates atomically with it.
- Cross-device combinations (old Mac app vs new Chrome extension) meet **only through cloud sync**, so version skew reduces to one problem: sync protocol compatibility.

Layered policy:

1. **Local-first is the floor.** No version combination can break local annotation, review, or stats; the worst possible outcome of skew is a paused sync.
2. **Additive-only evolution by default.** New fields are optional with defaults. Old clients must preserve and round-trip unknown fields (merge rules treat unknown fields as opaque baggage of the record, never stripped on write). Most releases therefore require no coordination at all.
3. **`schemaVersion` on every sync payload; the server gates.** Breaking changes (avoid them) bump the major version; the server answers too-old clients with "upgrade required". That device pauses sync and shows an update prompt while staying fully usable locally. Ops from newer devices accumulate safely server-side; after the upgrade the old device resumes from its cursor with nothing lost.
4. **Lexical IDs are content-derived (`baseForm:reading`), never dictionary-build-derived.** Devices on different dictionary versions must keep talking about the same words. This is a hard invariant; the golden vectors should include a cross-dictionary-version case.
5. Local `AppState` migrations stay forward-only (`migrateAppState` + `schemaVersion`, already in place); on Apple platforms the App Group store is only ever touched by one bundle version at a time, so no cross-version local-store handling is needed.

## 10. Risks

- **Two merge implementations drifting** — mitigated by the golden vectors; treat a vector failure like a failing unit test, not a doc bug.
- **iOS extension memory** — kuromoji stays macOS/Chrome-only until proven; local analyzer quality on iOS is the fallback cost.
- **Apple billing review** — the extension popup must not link to Stripe on iOS builds; gate the upsell per platform.
- **Clock skew breaking LWW** — use server receipt time as authoritative `updatedAt` ceiling; client timestamps only order ops from the same device.
