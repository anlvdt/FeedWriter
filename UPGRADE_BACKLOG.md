# FeedWriter Upgrade Backlog

Created: 2026-06-12

This backlog turns `AUDIT_REPORT.md` into implementation-ready work. Items are ordered to reduce user-visible breakage and security risk before large refactors.

## Release 1: Stabilize And Make Truth Visible

### 1. Fix Batch Summarization Contract

Priority: P0

Status: Implemented. Static verification passed; manual batch verification still recommended.

Why:

- Batch mode currently expects `{ success, result }`, while the background `summarize` message returns `{ summary, quality, issues }` or `{ error }`.

Files:

- `content.js`
- `background.js`

Implementation:

1. Prefer fixing `content.js` to accept the existing background response shape:
   - success when `response.summary` is a non-empty string.
   - failure when `response.error` exists or summary is empty.
2. Pass through the requested `type` from batch requests instead of forcing `"summary"` in the background fallback.
3. Add a tiny test harness for the response adapter if the batch adapter is extracted into a pure helper.

Acceptance criteria:

- Batch summarize succeeds when the background response contains `{ summary: "..." }`.
- Batch summarize shows provider/user errors when the response contains `{ error: "..." }`.
- Batch affiliate still sends the requested type, not always summary.
- `node --check` passes for changed JS files.

Verification:

- Static check: `node --check content.js && node --check background.js`
- Manual check: select multiple posts, run batch summary, confirm successful cards contain output rather than `Unknown error`.

### 2. Sync Documentation With Runtime

Priority: P0

Status: Implemented. README now reflects version 2.4.0, current shortcuts, source workflow, Shopee manual affiliate flow, and current module layout.

Why:

- README says version `2.3.0`, but manifest is `2.4.0`.
- README lists `Ctrl+Shift+T` status shortcut, but manifest declares only summarize and affiliate commands.
- README still describes removed automatic Shopee affiliate suggestions.

Files:

- `README.md`
- Optional: `WAVE7_CHANGELOG.md` or a new `CHANGELOG.md`

Implementation:

1. Update badge and feature section to `2.4.0`.
2. Replace stale Shopee language with the current manual "Bóc Link" official affiliate generator flow.
3. Update project structure to list split content modules.
4. Add a clear "Risky automation" note for GitHub to Facebook auto-post.
5. Align shortcuts with `manifest.json`.

Acceptance criteria:

- README version matches `manifest.json`.
- README shortcut list matches `manifest.json.commands`.
- README no longer claims automatic Shopee affiliate generation if code does not provide it.
- New user can understand current architecture and risk flags without reading source.

Verification:

- Static check: compare `manifest.json` version/commands against README text.

### 3. Add Smoke Checklist

Priority: P1

Status: Implemented in `SMOKE_TEST.md`.

Why:

- There is no repeatable QA checklist for loading the unpacked extension and validating core flows.

Files:

- `SMOKE_TEST.md`

Implementation:

1. Document setup: load unpacked, add API key, open Facebook/feed.
2. Checklist core flows:
   - summarize selected text.
   - summarize feed post.
   - copy result.
   - edit result.
   - open post composer/manual source flow.
   - translate word.
   - Shopee "Bóc Link" flow.
   - popup API key test.
3. Add expected results and failure notes.

Acceptance criteria:

- A tester can run through the checklist without source knowledge.
- Checklist includes pass/fail boxes and notes.

Verification:

- Manual review of checklist against current UI labels.

## Release 2: Permission And Automation Risk Reduction

### 4. Permission Audit And Narrowing

Priority: P0

Status: Implemented (2026-07-11). `cookies` + `clipboardRead` → optional_permissions; `https://*/*` → optional_host_permissions. Background gates cookie clear + host fetch; popup/About notes optional perms. Remaining: content-side clipboard still uses navigator.clipboard (page permission).

Why:

- `manifest.json` grants `https://*/*`, `cookies`, and `clipboardRead`.

Files:

- `manifest.json`
- `background.js`
- `content-composer.js`
- `popup.html`
- `popup.js`

Implementation:

1. Inventory each permission and host permission with exact callsites.
2. Remove unused permissions.
3. Convert high-risk optional features to `optional_permissions` / `optional_host_permissions` where Chrome supports it.
4. Gate Shopee cookie cleanup behind explicit permission request or remove cookie cleanup.
5. Keep clipboard read attached only to user click surfaces and document it in popup/about.

Acceptance criteria:

- `https://*/*` is removed or explicitly justified in a documented allowlist.
- `cookies` is removed unless the user enables Shopee cleanup.
- Clipboard reads happen only inside direct user actions.
- Existing manual post/image/source flows still work.

Verification:

- Static check: inspect `manifest.json`.
- Manual check: reload extension and verify Chrome permission prompts are acceptable.
- Manual check: image fetch and related-source enrichment still work for common Facebook-hosted images and public HTTPS links.

### 5. Auto-Post Labs Gate

Priority: P0

Status: Implemented (2026-07-11). Settings `labsAutomationEnabled` + `labsAutomationAcknowledgedAt`; popup Labs gate + confirm phrase `TOI HIEU RUI RO` + "Tắt Labs ngay"; schedule/manual require Labs; migration forces safe off. Stage-level logs still backlog.

Why:

- The app can automatically publish and comment on Facebook, which is high risk for account health.

Files:

- `popup.html`
- `popup.js`
- `background.js`
- `content-composer.js`

Implementation:

1. Add a persistent "Labs automation enabled" setting.
2. Require explicit confirmation text before enabling scheduled GitHub auto-post.
3. Make the default action "prepare draft" if Labs is off.
4. Add richer run-stage logs: fetch repo, generate text, open tab, find composer, paste, click post, comment, close tab.
5. Add a one-click disable button in the GitHub auto-post section.

Acceptance criteria:

- Scheduled auto-post cannot be enabled accidentally.
- Manual "Run now" refuses to run until the risk gate is accepted.
- Logs identify the failed stage when posting fails or times out.
- Disabling Labs clears auto-post alarm.

Verification:

- Static check: `autoGithubEnabled` cannot be true unless Labs acknowledgement is stored.
- Manual check: run with Labs off, then on, and inspect popup log.

### 6. Message Router Hardening

Priority: P1

Status: Implemented (2026-07-11 v2.5.1). `lib/message-schema.js` + `FeedWriterMessageSchema.validate` gate in background onMessage; extension_page vs content_tab; tests in `tests/message-schema.test.mjs`.

Why:

- Sensitive background actions are partially protected, but message validation is scattered.

Files:

- `background.js`
- `content.js`

Implementation:

1. Create a central `ACTION_SCHEMAS` map for background messages.
2. Validate action, sender, tab URL, and payload shape before dispatch.
3. Add strict checks for:
   - `auto-github-post`
   - `fetch-image`
   - `enrich-related-source-links`
   - `unshorten-shopee-inline`
   - `summarize`
4. Prefer one `runtime.onMessage` listener per runtime side.

Acceptance criteria:

- Invalid payloads return `{ error }` and do not trigger network/automation.
- `auto-github-post` only runs on intended Facebook tabs opened by background orchestration.
- Existing popup and content-script actions still work.

Verification:

- Add mocked message-router tests once test harness exists.
- Manual check key popup actions and summarization still work.

## Release 3: Test Harness And Regression Protection

### 7. Add Zero-Dependency Node Test Harness

Priority: P1

Status: Implemented (v2.5.0–2.5.1). `package.json` scripts `test`/`check`; 84 tests across pure-logic, message-schema, provider-rotation, scoring-profile, StatusFormatter.

Why:

- Syntax checks pass, but logic regressions are currently unprotected.

Files:

- `package.json`
- `tests/*.test.js`
- Potential small exports in pure modules.

Implementation:

1. Add `package.json` with:
   - `"test": "node --test"`
   - `"check": "for f in *.js; do node --check \"$f\" || exit 1; done"`
2. Start tests with pure functions:
   - `StatusFormatter.format`
   - `StatusFormatter.toDisplayHTML`
   - URL normalization/cleaning helpers that can be extracted.
3. Add fixtures for malicious-looking text: `<script>`, quotes, markdown, Vietnamese accents.

Acceptance criteria:

- `npm test` or `node --test` passes locally.
- Formatter tests prove rendered HTML escapes user/API text.
- At least one test covers the batch response adapter.

Verification:

- `npm test`
- `npm run check`

### 8. Provider And Key Management Tests

Priority: P1

Status: Implemented (v2.5.1). `lib/provider-rotation.js` + `selectAvailableKey` in `bg-api.js` + `tests/provider-rotation.test.mjs`. Provider health panel in popup Keys tab.

Why:

- Provider fallback and API key rotation are critical and stateful.

Files:

- `bg-api.js`
- `tests/provider-rotation.test.js`

Implementation:

1. Extract provider selection to a pure-ish helper that accepts storage snapshots.
2. Test:
   - legacy single key migration.
   - preferred provider first.
   - rate-limited key skip.
   - no keys.
   - all keys limited wait time.

Acceptance criteria:

- Tests cover each provider in `PROVIDER_PRIORITY`.
- Tests do not call real network APIs.

Verification:

- `node --test tests/provider-rotation.test.js`

## Release 4: Performance And Maintainability

### 9. Feed Scanner Refactor

Priority: P1

Status: Implemented core (v2.5.1+). `postStateMap` WeakMap unifies seeMore/allPost/comment/affiliate/observed/evalFingerprint; IO-gate + 15s safety; MO prefers `role=main`/`feed` with light body remount watch. Full candidate-query reduction still optional.

Why:

- The app still performs repeated broad scans and observes `document.body`.

Files:

- `content.js`
- `content-dom.js`

Implementation:

1. Introduce `PostState` records in one WeakMap:
   - summarizedButtonInjected
   - allPostButtonInjected
   - commentButtonInjected
   - clutterEvaluated
   - affiliateEvaluated
   - observed
2. Locate feed containers and observe those instead of all `document.body` where possible.
3. Use IntersectionObserver to lazily process visible posts.
4. Keep a fallback scan, but reduce frequency and make it debug-configurable.

Acceptance criteria:

- Buttons still appear on Facebook posts after scroll, feed refresh, and tab return.
- CPU-heavy global scan is no longer the primary path.
- Debug counters show scan duration and candidate counts.

Verification:

- Manual Facebook scroll test for 5 minutes.
- Performance log: average scan duration stays below an agreed threshold on a typical feed.

### 10. Namespace Content Script Globals

Priority: P2

Status: Implemented compatibility phase (v2.5.1). `FeedWriter.dom|composer|format|runtime` with `window.fbs*` COMPAT aliases until v3.0. Full WeakMap PostState scanner still open (#9).

Why:

- Current scripts depend on top-level globals and manifest injection order.

Files:

- `content-dom.js`
- `content.js`
- `content-composer.js`
- `status-formatter.js`

Implementation:

1. Create `window.FeedWriter = window.FeedWriter || {}`.
2. Move exported functions under:
   - `FeedWriter.dom`
   - `FeedWriter.format`
   - `FeedWriter.composer`
   - `FeedWriter.runtime`
3. Keep compatibility aliases temporarily.
4. Remove aliases in a later release.

Acceptance criteria:

- No new top-level globals are introduced.
- Existing features keep working during compatibility phase.
- Code comments identify compatibility aliases and removal target.

Verification:

- Static search for `window.fbs*` exports.
- Manual summarize/post/translate checks.

### 11. UI Rendering Helper

Priority: P2

Why:

- Many UI blocks are large `innerHTML` strings. Escaping is mostly handled, but future changes are easy to get wrong.

Files:

- `content.js`
- `content-composer.js`
- `popup.js`
- `translate.js`

Implementation:

1. Add tiny DOM helper:
   - `el(tag, attrs, children)`
   - `setText`
   - `safeFragment` only for static trusted SVG/icon markup.
2. Migrate highest-risk dynamic content first:
   - history list.
   - template list.
   - error displays.
   - source preview.
3. Leave large static SVG button templates for later if safe.

Acceptance criteria:

- User/API text uses `textContent`, not interpolated HTML.
- Escaping tests cover representative renderers.

Verification:

- Static search for dynamic `innerHTML`.
- Unit tests with hostile fixture strings.

## Release 5: Product Upgrades

### 12. Manual-First Source Workflow

Priority: P1

Why:

- The app's automatic source extraction can be wrong; users need fast manual correction.

Files:

- `content-composer.js`
- `content.css`
- `README.md`

Implementation:

1. Keep source URL field auto-selected when composer panel opens.
2. Keep Paste button for manually copied source.
3. Add "clear detected source" or "trust manual link only" toggle if confusion remains.
4. Make comment preview click-to-select.
5. Document exact workflow in README/smoke test.

Acceptance criteria:

- User can copy a correct source manually, click Paste, and see comment preview update.
- App does not overwrite clipboard with wrong source during manual posting.
- The final post flow messaging does not imply source was auto-copied.

Verification:

- Manual source correction test on a Facebook post with bad detected source.

### 13. Provider Health Panel

Priority: P2

Status: Implemented (v2.5.1). Keys tab `#providerHealth` shows OK / rate-limited until / last used; refresh button. Clear rate-limit action still optional backlog.

Why:

- Users can add multiple keys, but provider health and last error are not very transparent.

Files:

- `popup.html`
- `popup.js`
- `bg-api.js`
- `background.js`

Implementation:

1. Track provider/key last success, last failure, last rate-limit until.
2. Show provider-level status in popup.
3. Add "retry provider" or "clear rate limit state" with confirmation.

Acceptance criteria:

- User can see why a provider is skipped.
- Key masking remains intact.
- Clearing provider state does not delete keys.

Verification:

- Mock local `keyStatus` and inspect popup rendering.

## Definition Of Done For The Upgrade Program

The audit-driven upgrade program should be considered complete when:

1. P0 items are fixed or intentionally removed from scope with documented rationale.
2. Tests cover formatter safety, batch contract, provider rotation, and message validation.
3. Manifest permissions are narrowed or justified in docs.
4. README and smoke checklist match the current manifest and UI.
5. Auto-post requires explicit Labs acknowledgement and logs stage-level failures.
6. Content scanning has measured performance counters and no longer depends primarily on broad periodic scans.
