# FeedWriter Deep Audit

Audit date: 2026-07-11 (supersedes 2026-06-12)  
Implementation wave: **v2.5.0** — P0/P1 items from deep audit landed via parallel subagents.

Scope: Chrome Extension Manifest V3 — UI, UX, algorithms, performance, usability, security.

Verification:

- `npm test` → 28 pass, 0 fail
- `npm run check` → syntax OK on core JS
- `manifest.json` valid JSON

---

## Executive Summary

FeedWriter is a feature-rich Vietnamese social content tool (summarize → edit → post + source).  
v2.5.0 closes the largest **safety / discoverability / performance** gaps from the 2026-06 audit while keeping zero runtime dependencies.

| Area | Score | Notes |
|------|------:|-------|
| UI | 8.0 | Toolbar multi-mode, footer CTAs, composer back |
| UX | 7.5 | Labs gate, Mac keys, unified min length |
| Algorithms | 8.0 | Unchanged core; stage logs for auto-post |
| Performance | 7.0 | IO-gated scan, 15s safety interval |
| Usability | 7.5 | Discoverability + onboarding improved |
| Security | 7.0 | Optional perms + Labs gate (was 4.0) |
| Maintainability | 6.0 | `lib/pure-logic.js` + `node:test` harness |

---

## Implemented (2026-07-11)

### P0 Security

1. **Labs automation gate** — `labsAutomationEnabled` + confirm phrase `TOI HIEU RUI RO`; schedule/manual blocked without Labs; one-click disable.
2. **Permission narrowing** — required perms reduced; `cookies`/`clipboardRead` optional; `https://*/*` → `optional_host_permissions`.
3. **Message hardening** — sensitive action set expanded; GitHub run-now only from extension pages.

### P0/P1 UX

1. **Mac shortcuts** — `metaKey || ctrlKey`; UI shows ⌘/Ctrl.
2. **Floating toolbar** — Summary | Status | Affiliate | Batch.
3. **Length thresholds** — `SUMMARIZE_MIN_CHARS=50` vs feed inject `MIN_LEN`.
4. **Composer ← Sửa lại** — restore footer/result without losing text.
5. **Panel a11y** — `role=dialog`, `aria-modal`, focus trap.
6. **Batch** — uses stored summary settings; Copy tất cả.
7. **Clipboard** — request optional `clipboardRead` on Paste click.

### P1 Performance

1. Scan safety interval **5s → 15s**.
2. Skip expensive work on off-screen already-processed posts when IntersectionObserver is active.
3. Debug: `localStorage.fbsDebugPerf = '1'`.

### P2 Engineering

1. **`npm test`** / `lib/pure-logic.js` / 28 tests (adapter, ngram, URL, Labs, StatusFormatter).
2. Keep-alive alarm less aggressive (5 min, activity-gated).

---

## Remaining backlog (not blocking)

| Priority | Item |
|----------|------|
| P1 | Full ACTION_SCHEMAS validation map |
| P1 | Auto-post stage logs in popup log UI (content already reports stages) |
| P2 | Delete legacy formatter paths in content-composer once StatusFormatter-only |
| P2 | `window.FeedWriter` namespace; split god files |
| P2 | Scoring profile selectable (tech vs general) |
| P3 | Chrome Web Store packaging + privacy policy |

See `UPGRADE_BACKLOG.md` for acceptance criteria detail.

---

## Architecture (current)

```
popup (settings / Labs / keys)
    ↓
background SW (API, guardrails, optional perms, GitHub alarm)
    ↓ ports / messages
content scripts (dom → composer → UI) + translate.js
```

Largest files: `content.js`, `background.js`, `content.css`, `content-dom.js`, `content-composer.js`.

---

## Manual smoke (required after load unpacked)

1. Reload extension → confirm fewer install permissions.
2. Labs off → Run now refused.
3. Type `TOI HIEU RUI RO` + enable Labs → schedule works; Tắt Labs clears.
4. Selection toolbar: four modes on FB.
5. Mac: ⌘E / ⌘C in panel.
6. Composer ← Sửa lại restores summary.
7. `npm test`.

Full checklist: `SMOKE_TEST.md`.
