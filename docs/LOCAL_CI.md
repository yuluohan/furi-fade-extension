# Local CI

Date: 2026-06-09

Run the full local CI flow from the repository root:

```sh
npm run ci:local
```

It performs:

1. JavaScript syntax checks.
2. Unit tests.
3. Safari Web Extension package generation.
4. Safari Xcode project generation/rebuild when needed.
5. macOS app/extension compile-only build by default.

`npm run ci:local` stays safe for normal development: when `FURI_DEVELOPMENT_TEAM` is not set, it automatically uses compile-only Safari build mode and does not install or register the extension.

For only the Safari side:

```sh
npm run build:safari:mac
```

The App Group bridge requires Apple Development signing. Set your Apple Team ID before running the installable Safari build:

```sh
FURI_DEVELOPMENT_TEAM=YOURTEAMID npm run build:safari:mac
```

For compile-only verification that does not install the app or register Safari:

```sh
FURI_SAFARI_COMPILE_ONLY=1 npm run build:safari:mac
```

The build writes DerivedData to:

```text
~/Library/Developer/FadingFuriganaBuild
```

Override it with:

```sh
FURI_XCODE_DERIVED_DATA=/some/path npm run build:safari:mac
```

Compile-only CI verifies buildability. The signed Safari build installs the app, but it still does not replace the manual Safari smoke test where the extension is enabled in Safari settings and tested on a real page.
