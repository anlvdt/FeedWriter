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
- [ ] Confirm FeedWriter places **Tóm tắt** beside “Xem thêm”, or in a compact right-aligned row directly below a fully visible post body
- [ ] Click summarize on a feed post
- [ ] Result includes useful text and no unrelated comment/sidebar content
- [ ] Close overlay and scroll further
- [ ] Buttons continue appearing on newly loaded posts

Expected:

- Page remains responsive while scrolling.
- Buttons are not duplicated on the same post.
- Summary controls never cover media, author controls, or Facebook’s reaction bar.

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

- [ ] Select English text
- [ ] Click `Dịch` in the selection toolbar, use `Ctrl/Cmd+Shift+T`, or choose the translate context-menu item
- [ ] Tooltip appears near the selected text
- [ ] Result is translated into Vietnamese
- [ ] Copy translation button copies the meaning
- [ ] Click outside or press Escape to close

Expected:

- Selection alone and double-click alone do not send text to the AI.
- Tooltip stays within viewport.
- Later responses do not overwrite a newer lookup.

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

## Retired Surfaces

- [ ] Confirm the popup has no Labs or GitHub auto-post controls
- [ ] Confirm context menus contain only summarize and translate actions
- [ ] Confirm the selection toolbar has no affiliate-writing action

Expected:

- FeedWriter prepares content but never publishes a post or source comment automatically.
- No hidden confirmation phrase or scheduled auto-post path remains.

## Mac Shortcuts

- [ ] On macOS Chrome, open About / shortcut hints in popup
- [ ] Confirm summarize and translate shortcuts use `Cmd+Shift+S` and `Cmd+Shift+T`
- [ ] On Windows/Linux, confirm shortcuts use `Ctrl+Shift+S` and `Ctrl+Shift+T`
- [ ] Overlay Edit (`Ctrl/Cmd+E`) and Copy still work when the panel is focused

Expected:

- No broken key handlers on Mac (`metaKey` is accepted where `ctrlKey` is used for in-panel actions).

## Floating Toolbar

- [ ] Select text on a supported site
- [ ] Toolbar shows `Tóm tắt`, `Dịch`, and a `···` menu
- [ ] The menu offers `Slang`, `Cụm từ`, and `Shadow`
- [ ] On Facebook, the menu also offers `Batch`
- [ ] On non-Facebook sites, `Batch` is absent
- [ ] Each translation mode produces the matching tooltip mode

## Composer Back Navigation

- [ ] Summarize → Đăng Status → confirm composer preview opens
- [ ] Click **← Sửa lại**
- [ ] Summary result still present; panel footer restored; can edit/copy again

## Automated Validation

```bash
npm run test:all
```

- [ ] Generated DOM, composer, and service-worker runtimes are current
- [ ] Every shipped JavaScript file passes `node --check`
- [ ] All unit and contract tests pass
- [ ] CI runs the same command on pushes and pull requests

## Final Checks

- [ ] Run `node --check` for changed JS files (or `npm run check`)
- [ ] Reload extension after code changes
- [ ] Refresh tested websites after reloading extension
- [ ] Confirm no duplicate overlays/buttons after reload
- [ ] Record any failures with URL, browser, extension version, and console error
