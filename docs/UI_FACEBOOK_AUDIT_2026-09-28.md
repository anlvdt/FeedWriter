# UI/UX and Facebook draft audit — 2026-09-28

Scope: current FeedWriter sources, posting preview, Facebook adapter and cross-tab handoff, keyboard interaction, compact layouts, existing popup and extension smoke tests. GitNexus's FeedWriter index was four commits behind; findings were verified against current source instead.

## Fixed findings

- Facebook discovery assumed `div[role=main]` and `div[role=button]`, and the two entry points used different discovery logic. Both now share visible composer discovery supporting semantic main/buttons, curly apostrophes, and existing post dialogs. Hidden dialogs, FeedWriter panels and labelled comment/reply editors are excluded.
- Failure to copy a source comment blocked draft preparation. Copy failures now leave draft preparation available and report that the source still needs copying.
- Synthetic paste could be ignored or partially accepted while any nonempty editor was reported as success. Text is now verified after each chunk; unchanged text uses a browser editing-command fallback. Partial insertion reports recovery instructions. Existing drafts are preserved instead of appended to, and Unicode surrogate pairs are not split.
- Broken image previews were hidden while still selected. They now remain visible as selectable error tiles; unnecessary preview CORS mode was removed. Keyboard users can focus and toggle multi-image checkboxes.
- Source fields lacked accessible names; posting errors overloaded the action button. Fields now have names, posting has a live status area and retry action, and a separate copy-content recovery action is available.
- Source review retained modal semantics and trapped Tab after the backdrop was dismissed. Composer mode is nonmodal; successful native preparation minimizes the panel and focuses the Facebook editor.
- Clearing the detected source could silently restore it during later changes or posting. The current source field is now authoritative, including an empty value.
- Reopening preview could duplicate controls. Prior preview is replaced.
- The source-quality badge overflowed at 320px. It now wraps; action controls retain usable heights. Legacy `transition:all` on panel geometry was disabled to prevent transient overflow during resize.
- Text-only drafts no longer request remote-image permissions.

## Verification

- `npm run test:all`: 367 tests passed; JavaScript syntax and generated runtime checks passed.
- `python3 tests/browser-fixture.py`: existing offline browser fixtures passed, including 28,000-character paste and image event ordering.
- `python3 tests/extension-smoke.py`: unpacked-extension smoke passed (storage isolation, settings bridge, consent, history expiry and migration).
- `npm run test:facebook-composer`: new real-browser offline regression passed for discovery, existing/hidden dialogs, comment exclusion, ignored/partial paste, Unicode, existing-draft preservation, Facebook adapter, denied clipboard, source clearing, keyboard image choices and layouts at 1280/390/320px in light/dark themes. Screenshots reviewed for desktop and compact composer/action states.
- Additional disposable-profile popup audit: onboarding skip and all four tabs (settings, API keys, history, about) passed visibility and horizontal-overflow checks. Settings and API-key screenshots reviewed.
- `git diff --check`: passed.

## Remaining verification boundary

No authenticated Facebook session was inspected and no live post was published. Offline fixtures verify the tested DOM shapes and browser behavior, not Facebook's current React/Lexical implementation or account-specific restrictions. Image transfer still requires the user to inspect actual thumbnails in Facebook before publishing. The extension prepares a draft; the final Facebook “Đăng” action remains manual.

Reload the unpacked extension and refresh existing Facebook/X tabs to use the new content scripts. If Chrome loads a separate copied runtime directory, update that copy first; source edits alone do not update an independently copied installation.
