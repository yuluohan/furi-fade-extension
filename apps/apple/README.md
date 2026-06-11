# apps/apple

The Xcode project hosting the macOS app, the iOS app, and both Safari Web Extensions (as appex targets). Destined to grow into the full learning app (review/SRS, vocabulary, account, billing) per `docs/SYNC_AND_CLIENTS_DESIGN.md`.

Build rules:

- **Always build through `npm run build:safari:mac`** (packages the extension, syncs `Resources`, builds, re-signs with the local development certificate, installs to `~/Applications`, registers with Safari). A bare Xcode build ships whatever stale JS happens to be in `Resources`.
- `Shared (Extension)/Resources/` is a generated mirror of `packages/extension/dist` — never hand-edit it.
- The project was scaffolded by `safari-web-extension-packager` and is now hand-maintained. Regeneration (`FURI_REGENERATE_SAFARI_PROJECT=1`) destroys hand-written changes; only use it before real Swift UI work lands, never after.
- `scripts/patchSafariWrapper.js` patches the generated wrapper app after regeneration.
