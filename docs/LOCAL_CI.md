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
4. Safari Xcode project generation/rebuild.
5. `xcodebuild -list`.
6. macOS app/extension build with signing disabled.

For only the Safari side:

```sh
npm run build:safari:mac
```

The macOS build uses:

```text
CODE_SIGNING_ALLOWED=NO
```

and writes DerivedData to:

```text
/private/tmp/furi-xcode-derived
```

Override it with:

```sh
FURI_XCODE_DERIVED_DATA=/some/path npm run build:safari:mac
```

This local CI verifies buildability. It does not replace the manual Safari smoke test where the extension is enabled in Safari settings and tested on a real page.
