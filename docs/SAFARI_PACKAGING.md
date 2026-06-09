# Safari Web Extension Packaging

Date: 2026-06-08

## Current Status

The repository now has a Safari packaging preparation step:

```sh
npm run package:safari
```

This creates:

```text
dist/safari-web-extension
```

The package contains:

- `manifest.json`
- all `src/**` runtime files
- popup HTML/CSS/JS
- content script JS and CSS

The script also validates that every manifest-referenced asset exists in the package.

## Xcode Conversion

When Xcode's Safari converter is available, run:

```sh
xcrun safari-web-extension-converter dist/safari-web-extension
```

In this environment, `xcrun --find safari-web-extension-converter` currently fails, so the Xcode project cannot be generated here yet.

## Expected Manual Smoke Test

After converter generation:

1. Open the generated Xcode project.
2. Run the macOS container app.
3. Enable the extension in Safari settings.
4. Open a Japanese page or the local demo page.
5. Confirm:
   - annotations render,
   - popup opens,
   - settings save,
   - daily frequency counts appear,
   - `domain_only` and `none` URL privacy modes do not store full URLs.

## iOS Safari Notes

For iOS Safari, keep AppState storage behind `StorageAdapter`. Start with Safari extension storage if available. Only add the native/App Group bridge when iOS testing proves it is necessary.
