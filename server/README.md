# server

Cloudflare Worker. Today it only hosts the demo page (`/test-page` serves `packages/extension/demo/` with the extension sources as assets). Deployed from CI on pushes to `dev` (`.github/workflows/deploy-cloudflare.yml`, `workingDirectory: server`).

This directory is also the future home of the paid sync API (accounts, `sync/push|pull|snapshot`, billing webhooks, entitlements) per `docs/SYNC_AND_CLIENTS_DESIGN.md` §6 — Workers + D1.
