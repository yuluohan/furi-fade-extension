# Safari Manual QA Runbook

Date: 2026-06-15

Purpose: run the real macOS Safari extension and container app through the flows that are most likely to break an MVP beta: annotation injection, word actions, App Group storage, settings, purchase gating, and real-page behavior.

This runbook complements `docs/MVP_RELEASE_CHECKLIST.md`. Use it for every signed beta candidate.

## Scope

Must cover:

- macOS app bundled with the Safari Web Extension.
- Same-device App Group storage through `group.com.banyuguru.fading-furigana`.
- Trial and Basic local purchase behavior.
- No account system and no cross-device sync.

Out of scope:

- Chrome-to-Mac sync.
- iOS Safari.
- Android, Windows, or cloud sync.
- Public App Store metadata review, except where it affects in-app behavior.

## Preflight

1. Start from a clean working tree:

```sh
git status --short --branch
```

2. Run automated checks:

```sh
npm test
npm run check
FURI_SAFARI_COMPILE_ONLY=1 FURI_XCODE_DERIVED_DATA=/tmp/fading-furigana-safari-qa npm run build:safari:mac
```

3. For real Safari/App Group testing, install a signed development build:

```sh
FURI_DEVELOPMENT_TEAM=Y3DTR7LH9K FURI_XCODE_DERIVED_DATA=/tmp/fading-furigana-signed-qa npm run build:safari:mac
```

If signing fails, stop. Compile-only builds do not prove the native App Group bridge works.

4. Serve the local QA fixture from the repo root:

```sh
python3 -m http.server 8765
```

Open:

```text
http://localhost:8765/packages/extension/demo/safari-qa-page.html
```

The fixture intentionally does not load extension source files. The installed Safari extension must inject into it like a normal website.

## Test Matrix

Record each result as Pass, Fail, or Blocked. Capture the exact page URL and a short note for every failure.

### 1. Install And Extension State

- [ ] Installed app launches.
- [ ] Safari Settings shows exactly one Fading Furigana extension entry.
- [ ] Extension can be enabled.
- [ ] Mac app footer reports shared container storage, not local fallback.
- [ ] Extension popup reports native/shared storage, not local fallback.
- [ ] App version and extension popup version match the candidate.

### 2. Fresh-Install Loop

- [ ] With no existing `app-state-v1.json`, app shows onboarding.
- [ ] "Open Safari Extension Settings" opens Safari settings.
- [ ] After enabling extension, onboarding reflects enabled status.
- [ ] Opening the QA fixture shows annotations without requiring app restart.
- [ ] Saving one word creates local state and app auto-refreshes within about 2 seconds.

Use `docs/LOCAL_RECOVERY_GUIDE.md` before removing or backing up local state.

### 3. Annotation Quality Fixture

Open the QA fixture and verify:

- [ ] Baseline words such as `確認`, `申請`, `影響`, `状態`, `寿司`, `食べる`, and `勉強` annotate.
- [ ] Save responsiveness: click `確認`, press Save, and confirm the tooltip disappears and the word turns saved color immediately.
- [ ] Page-provided reading evidence: `石質隕石（せきしついんせき）` does not show a wrong `いししつ` reading.
- [ ] Unrelated kana parentheses: `石質隕石（これはめずらしい）` is not treated as a reading.
- [ ] Code blocks and `data-fading-furigana-ignore` areas are not annotated.
- [ ] Normal link click still navigates; Option-click on a link opens the word tooltip.
- [ ] Page chrome / compact card sections do not break layout and use tap-only display where needed.
- [ ] Dynamic text added by the fixture is annotated after the page settles.
- [ ] Lower-page content annotates as it scrolls near the viewport.

Failure bar: any visible wrong reading, page-wide flicker, multi-second Save delay, broken link behavior, or layout-clipping regression blocks beta.

### 4. Real Pages

Run the same action set on:

- [ ] Japanese Wikipedia article.
- [ ] Japanese news article.
- [ ] Google search results or another constrained-layout results page.
- [ ] Long scrolling article.
- [ ] Dynamic page with late-loaded content.

For each page:

- [ ] Initial annotations appear only after the page is stable.
- [ ] Scrolling does not cause memory-like runaway annotation or visible flicker.
- [ ] Save is immediate.
- [ ] Known/Forgot/Ignore/Always Show affect only the selected word, not the whole page.
- [ ] Safari console has no repeated storage or annotation errors.

### 5. App Group Round Trip

- [ ] Save a word in Safari and confirm it appears in the Mac app without manual refresh.
- [ ] Mark that word Known in the Mac app; refresh Safari page and confirm it hides or changes according to settings.
- [ ] Mark the word Forgot; refresh Safari page and confirm it is visible again.
- [ ] Pin/Always Show keeps the annotation visible even if the word would normally be hidden.
- [ ] Ignore hides the selected word on the current page without re-tokenizing the page.

### 6. Settings Round Trip

- [ ] Toggle annotations off in the popup; current site stops annotating.
- [ ] Toggle annotations back on; current site annotates again.
- [ ] Pause the current site; reload confirms the pause persists.
- [ ] Change interface language in Mac settings; app and popup reflect Chinese/English after refresh.
- [ ] Change user level filter; words at or below the chosen level hide.
- [ ] Change status colors; saved/known/learning colors update on page after refresh.
- [ ] URL privacy modes behave as documented: `domain_only` does not store full URLs, `none` stores neither URL nor domain.

### 7. Review Flow

- [ ] Saved word enters learning/review state.
- [ ] Daily review shows the word when due.
- [ ] Correct/incorrect grading appends `reviewLogs`.
- [ ] Next review date updates.
- [ ] Dashboard daily activity grid changes after saved/reviewed activity.

### 8. Purchase And Trial

Use StoreKit sandbox/configured development testing.

- [ ] Fresh install starts trial.
- [ ] Trial expired state leaves existing local data visible.
- [ ] Expired trial blocks new Safari saves with a localized Basic unlock message.
- [ ] Expired trial blocks new Mac app saves through the paywall.
- [ ] Basic purchase changes Settings state to purchased/basic.
- [ ] After purchase, Safari Save succeeds without reloading the page.
- [ ] Restore Purchase works.
- [ ] Purchase failure/cancel does not corrupt local learning data.

### 9. Upgrade And Recovery

- [ ] Existing `app-state-v1.json` survives installing the new candidate.
- [ ] App opens and migrates older local state.
- [ ] Storage diagnostics show the correct path and updated timestamp.
- [ ] If native bridge is blocked, the popup/app clearly report fallback or failure.
- [ ] Recovery guide steps are sufficient to locate and back up local state.

## Result Template

```text
Candidate:
Date:
Tester:
macOS:
Safari:
Build command:

Automated checks:
- npm test:
- npm run check:
- compile-only Safari build:
- signed Safari build:

Manual sections:
- Install and extension state:
- Fresh-install loop:
- Annotation quality fixture:
- Real pages:
- App Group round trip:
- Settings round trip:
- Review flow:
- Purchase and trial:
- Upgrade and recovery:

Blocking failures:
- 

Non-blocking follow-ups:
- 

Decision:
- Ship to external beta / hold
```

## Exit Criteria

External beta can proceed only when:

- No blocking failures remain.
- Save feedback is immediate on the QA fixture and at least two real pages.
- App Group round trip works both Safari -> Mac app and Mac app -> Safari.
- Expired trial and purchased Basic states are both tested.
- Known limitations are documented in `docs/MVP_RELEASE_CHECKLIST.md` or release notes.
