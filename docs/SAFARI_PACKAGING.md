# Safari Web Extension Packaging

Date: 2026-06-08

## Current Status

The repository now has a Safari packaging step:

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

The script also validates that every manifest-referenced asset exists in the package, including extension icons.

## Xcode Conversion

Generate or rebuild the Xcode project with:

```sh
xcrun safari-web-extension-packager \
  --project-location safari \
  --app-name "Fading Furigana" \
  --bundle-identifier "com.banyuguru.fading-furigana" \
  --swift \
  --copy-resources \
  --no-open \
  --no-prompt \
  --force \
  dist/safari-web-extension
```

Generated project:

```text
safari/Fading Furigana/Fading Furigana.xcodeproj
```

The project currently contains macOS and iOS app/extension targets.

## Local Xcode Verification

Run the full local Safari build flow:

```sh
npm run build:safari:mac
```

Run the full local CI flow:

```sh
npm run ci:local
```

List schemes and targets:

```sh
xcodebuild -list -project "safari/Fading Furigana/Fading Furigana.xcodeproj"
```

Build macOS without signing:

```sh
xcodebuild \
  -project "safari/Fading Furigana/Fading Furigana.xcodeproj" \
  -scheme "Fading Furigana (macOS)" \
  -configuration Debug \
  -derivedDataPath /private/tmp/furi-xcode-derived \
  CODE_SIGNING_ALLOWED=NO \
  build
```

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
