# core-schema

The platform-neutral sync data contract. This package is the single source of truth that keeps the JS (extensions), Swift (Apple apps), and later Kotlin (Android) sync implementations honest.

Contains:

- `schema/` — versioned JSON Schema for the sync payload: `AppState` domains plus sync metadata (`deviceId`, per-record `updatedAt`, `opSeq`, tombstones).
- `src/recordStore.js` — the Phase 3 prep contract: deterministic per-record IDs, AppState v1 → record-store snapshot migration, snapshot → AppState reconstruction, record validation, and a small per-record merge prototype for conflict fixtures. It is intentionally not wired into the runtime storage path yet.
- `merge-rules.md` — normative merge semantics per domain (additive exposure deltas, append-only review logs, LWW per record elsewhere). See `docs/SYNC_AND_CLIENTS_DESIGN.md` §3.
- `golden-vectors/` — input states → expected merged output. Every implementation in every language must pass the same vectors; a failing vector is a failing unit test, not a doc bug. Must include a cross-dictionary-version case (lexical IDs are content-derived and must match across versions).

Invariants (from `docs/SYNC_AND_CLIENTS_DESIGN.md` §9):

- Additive-only evolution by default; unknown fields are preserved and round-tripped, never stripped.
- Breaking changes bump the major `schemaVersion`; the server gates too-old clients into a paused-sync state.
