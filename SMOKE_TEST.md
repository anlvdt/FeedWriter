# FeedWriter Smoke Test

Use this checklist after changing content scripts, background messaging, popup settings, permissions, or posting flows.

Date:
Tester:
Browser:
Extension version:

## Setup

- [ ] Open `chrome://extensions/`
- [ ] Enable Developer mode
- [ ] Load unpacked extension from this repository
- [ ] Open the FeedWriter popup
- [ ] Add at least one API key in the Keys tab
- [ ] Click test connection and confirm it returns OK
- [ ] Open Facebook, X/Twitter, LinkedIn, Reddit, or Threads depending on the flow being tested

## Core Summarize

- [ ] Select a paragraph of text on a supported site
- [ ] Trigger summarize from the floating toolbar or context menu
- [ ] Overlay opens with loading state
- [ ] Streaming result appears
- [ ] Copy button copies formatted output
- [ ] Edit button allows editing and saving the edited text
- [ ] Regenerate button requests a new result

Expected:

- No `Extension context invalidated` error.
- No raw HTML from source content appears in the result.
- Footer/buttons do not overlap the result.

## Feed Post Button

- [ ] On Facebook feed, scroll until long posts appear
- [ ] Confirm FeedWriter injects a summarize button near eligible posts
- [ ] Click summarize on a feed post
- [ ] Result includes useful text and no unrelated comment/sidebar content
- [ ] Close overlay and scroll further
- [ ] Buttons continue appearing on newly loaded posts

Expected:

- Page remains responsive while scrolling.
- Buttons are not duplicated on the same post.

## Batch Summarize

- [ ] Select multiple posts with batch checkboxes if available
- [ ] Start batch summarize
- [ ] Confirm progress count advances
- [ ] Confirm successful items show generated output, not `Unknown error`
- [ ] Copy all successful results

Expected:

- Success response from background `{ summary: "..." }` is accepted.
- Provider/API errors are shown as failures with the real error text.

## Manual Source Posting Flow

- [ ] Summarize a Facebook post
- [ ] Click `Đăng Status`
- [ ] Confirm source URL field is focused/selected when the preview panel opens
- [ ] Copy the correct source URL manually from the original post/browser
- [ ] Click `Paste` beside `Link bài gốc`
- [ ] Confirm the source field updates and the comment preview changes
- [ ] Click `Copy nguồn`
- [ ] Confirm the clipboard contains the comment source text for the first comment
- [ ] Click the comment preview and confirm its text is selected as a fallback if copy fails
- [ ] Click the post button to open Facebook composer

Expected:

- The app copies source only when `Copy nguồn` is clicked.
- Final status says the post is ready without claiming source was auto-copied.
- User can manually post/comment the verified source.

## Translation Tooltip

- [ ] Double-click an English word
- [ ] Tooltip appears near the selected word
- [ ] Result is translated into Vietnamese
- [ ] Copy translation button copies the meaning
- [ ] Click outside to close

Expected:

- Tooltip stays within viewport.
- Later responses do not overwrite a newer lookup.

## Shopee Link Flow

- [ ] Find or open a page with a `https://shope.ee/...` link
- [ ] Confirm `Bóc Link` pill appears next to the link
- [ ] Click the pill
- [ ] Confirm the pill shows loading, then success or a readable error
- [ ] Confirm Shopee Affiliate custom link page opens

Expected:

- Duplicate clicks do not open duplicate affiliate tabs.
- The extension does not claim to generate a commission link by itself.

## Popup Settings

- [ ] Change summary length and save
- [ ] Toggle advanced mode
- [ ] Add and delete a template
- [ ] Export history if history exists
- [ ] Clear history and use undo within 30 seconds
- [ ] Open About and confirm version matches `manifest.json`

Expected:

- Settings persist after closing/reopening popup.
- API keys remain masked.

## GitHub Auto-Post

Warning: this flow can publish to Facebook. Run only with a test account or when intentionally validating automation.

- [ ] Read the warning in popup settings
- [ ] Keep scheduled auto-post disabled by default
- [ ] If testing manually, confirm you understand Facebook automation risk
- [ ] Click `Chạy ngay`
- [ ] Watch the log for fetch/generate/post result

Expected:

- Failures include enough stage information to recover.
- Scheduled alarm is not enabled unless the setting is explicitly on.

## Labs Gate (Risky Automation)

- [ ] Confirm Labs / automation gate is **off** by default
- [ ] Attempt to enable scheduled GitHub auto-post without Labs acknowledgement — must be refused
- [ ] Enable Labs only after typing confirm phrase `TOI HIEU RUI RO` (exact)
- [ ] With Labs on, "Run now" / schedule can proceed per settings
- [ ] Disable Labs and confirm auto-post alarm is cleared / cannot schedule

Expected:

- `autoGithubEnabled` cannot stick true without Labs acknowledgement.
- Wrong or empty confirm phrase does not unlock automation.

## Mac Shortcuts

- [ ] On macOS Chrome, open About / shortcut hints in popup
- [ ] Confirm summarize / affiliate shortcuts are usable (Chrome command defaults; labels may show Ctrl or ⌘ depending on build)
- [ ] On Windows/Linux, shortcuts still work with Ctrl+Shift+S / Ctrl+Shift+A
- [ ] Overlay Edit (Ctrl/Cmd+E) and Copy still work when panel is focused

Expected:

- No broken key handlers on Mac (metaKey accepted where ctrlKey is used for in-panel actions).

## Floating Toolbar Multi-Mode

- [ ] Select long text on Facebook
- [ ] Toolbar shows Tóm tắt | Status | Affiliate | Batch
- [ ] Each mode produces the correct overlay title / prompt type
- [ ] On non-Facebook sites, Batch is hidden

## Composer Back Navigation

- [ ] Summarize → Đăng Status → confirm composer preview opens
- [ ] Click **← Sửa lại**
- [ ] Summary result still present; panel footer restored; can edit/copy again

## Automated Tests (optional)

```bash
npm test
npm run check
```

- [ ] 28+ tests pass
- [ ] Syntax check OK
- User can trigger summarize and affiliate from documented shortcuts.

## Unit tests (Node, optional)

- [ ] With Node 18+ available: run `npm test` from repo root
- [ ] Confirm all pure-logic tests pass (batch adapter, guardrails, URL clean, StatusFormatter)
- [ ] Optionally run `npm run check` for `node --check` on main scripts

## Final Checks

- [ ] Run `node --check` for changed JS files (or `npm run check`)
- [ ] Reload extension after code changes
- [ ] Refresh tested websites after reloading extension
- [ ] Confirm no duplicate overlays/buttons after reload
- [ ] Record any failures with URL, browser, extension version, and console error
