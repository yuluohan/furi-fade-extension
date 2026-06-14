# Merge Rules

These rules are the sync contract for future Pro sync. The current MVP remains local-first and does not require a server.

## Global Rules

- Schema evolution is additive by default.
- Unknown fields must be preserved and round-tripped.
- Breaking changes require a major `schemaVersion` bump and server-side client gating.
- Every syncable record carries `updatedAt` and `deviceId`.
- Deletions use tombstones (`deletedAt`) instead of immediate removal.

## Domains

| Domain | Merge rule |
| --- | --- |
| `lexicalItems` | Last-write-wins by `updatedAt`, with `deviceId` as deterministic tie-breaker. |
| `userLexicalStates` | Last-write-wins by `updatedAt`, with `deviceId` as deterministic tie-breaker. |
| `sourceOccurrences` | Append by client-generated `id`; identical IDs use last-write-wins. |
| `dailyExposureSummaries` | Future sync should send additive deltas. Local v1 summaries remain per-device records keyed by date and lexical item. |
| `reviewLogs` | Append-only by client-generated `id`; identical IDs use last-write-wins. |
| `settings` | Last-write-wins per settings object until finer-grained settings ops exist. |
| `entitlements` | Server-authoritative for Pro; local-authoritative for Basic MVP. |

## Invariants

- Lexical item IDs are content-derived (`baseForm:reading`) and must not depend on dictionary build IDs.
- Local data remains usable when sync is paused, unavailable, or requires an app update.
- Trial and Basic data stay local unless the user explicitly enables Pro sync.
