"""Offline Facebook draft and UI regressions; never sends a real post."""
from pathlib import Path
import os
import shutil
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PANEL = '''<div class="fbs-panel fbs-ui-v3 fbs-visible fbs-panel-left" data-fbs-ui="v3" role="dialog">
<div class="fbs-panel-head"><span class="fbs-title-text">FeedWriter</span><span class="fbs-subtitle" data-role="panel-subtitle"></span></div>
<div class="fbs-panel-body"></div><div class="fbs-panel-footer"></div></div>'''
DIALOG = '''<div role="dialog" aria-label="Tạo bài viết" id="native"><h2>Tạo bài viết</h2>
<div id="editor" role="textbox" contenteditable="true" data-lexical-editor="true"></div>
<button id="publish">Đăng</button></div>'''

with sync_playwright() as p:
    chrome = os.environ.get("FEEDWRITER_TEST_CHROME") or shutil.which("google-chrome") or "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    browser = p.chromium.launch(headless=True, executable_path=chrome if Path(chrome).exists() else None)
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.route("**/*", lambda route: route.fulfill(status=200, content_type="text/html", body="<html><body></body></html>"))
    page.goto("https://www.facebook.com/fixture")
    page.evaluate('''() => {
      window.SITE = 'facebook';
      window.chrome = { runtime: { id: 'fixture', onMessage: { addListener() {} },
        sendMessage(_message, callback) { callback?.({ok:true, settings:{}}); return Promise.resolve({granted:true}); } } };
      window.esc = text => String(text ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      window.StatusFormatter = { format: text => text };
      window.fetchImageBlobs = async () => { throw new Error('Unexpected image fetch'); };
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async writeText() { throw new Error('Clipboard denied'); } } });
    }''')
    for file in ["dom-helpers.js", "post-data.js", "poster-facebook.js", "content-composer-runtime.js"]:
        page.add_script_tag(path=str(ROOT / file))
    for file in ["content.css", "ui.css"]:
        page.add_style_tag(path=str(ROOT / file))

    # Facebook may name the dialog through a plain span, not a heading.
    page.evaluate("html => document.body.innerHTML = html", '<div role="dialog" aria-labelledby="post-title"><span id="post-title">Create a post</span><div role="textbox" contenteditable="true" id="labelled-editor"></div></div>')
    assert page.evaluate("findVisibleFacebookPostEditor().id") == "labelled-editor"
    # aria-placeholder is sufficient without a dialog heading.
    page.evaluate("html => document.body.innerHTML = html", '<div role="dialog"><div contenteditable="true" aria-placeholder="Bạn đang nghĩ gì?" id="placeholder-editor"></div></div>')
    assert page.evaluate("findVisibleFacebookPostEditor().id") == "placeholder-editor"
    # Unlabelled editors are accepted only after our explicit composer click.
    page.evaluate("html => document.body.innerHTML = html", '<div role="dialog"><div contenteditable="true" role="textbox" id="old-editor"></div></div><main><button id="open-post">Create post</button></main>')
    assert page.evaluate("findVisibleFacebookPostEditor()") is None
    page.evaluate("() => { document.querySelector('#open-post').onclick = () => document.body.insertAdjacentHTML('beforeend', '<div role=dialog><div contenteditable=true data-lexical-editor=true id=new-editor></div></div>'); }")
    assert page.evaluate("async () => (await findFacebookPostEditor()).id") == "new-editor"
    # Comment labels referenced by ID must also be excluded.
    page.evaluate("html => document.body.innerHTML = html", '<div role="dialog"><span id="comment-label">Write a comment</span><div contenteditable="true" role="textbox" aria-labelledby="comment-label"></div></div>')
    assert page.evaluate("findVisibleFacebookPostEditor(new Set())") is None
    # Ambiguous newly opened editors must not receive content.
    page.evaluate("html => document.body.innerHTML = html", '<div role="dialog"><div contenteditable="true" role="textbox">one</div></div><div role="dialog"><div contenteditable="true" role="textbox">two</div></div>')
    assert page.evaluate("findVisibleFacebookPostEditor(new Set())") is None

    # Semantic <main>/<button>, smart apostrophe, and hidden stale dialogs.
    page.evaluate("html => document.body.innerHTML = html", '<div hidden>'+DIALOG+'</div><main><button id="trigger">What’s on your mind?</button></main>')
    page.evaluate('''html => document.querySelector('#trigger').onclick = () => {
      document.body.insertAdjacentHTML('beforeend', html);
      document.querySelector('#trigger').dataset.clicked = 'yes';
    }''', DIALOG.replace('id="editor"', 'id="active-editor"'))
    assert page.evaluate("async () => (await findFacebookPostEditor()).id") == "active-editor"
    assert page.locator("#trigger").get_attribute("data-clicked") == "yes"
    # Existing composer should be reused; unrelated comment editors ignored.
    page.evaluate("() => { document.querySelector('#trigger').onclick = () => { throw new Error('Should reuse dialog'); }; }")
    assert page.evaluate("async () => (await findFacebookPostEditor()).id") == "active-editor"
    page.evaluate("document.body.insertAdjacentHTML('afterbegin', '<div role=dialog><h2>Comments</h2><div role=textbox contenteditable=true aria-label=\"Write a comment\" id=comment></div></div>')")
    assert page.evaluate("findVisibleFacebookPostEditor().id") == "active-editor"

    # Browser fallback for ignored synthetic paste; preserve Unicode and lines.
    result = page.evaluate('''async () => {
      const editor = document.querySelector('#active-editor');
      const text = 'a'.repeat(3999) + '😀' + '\\nDòng tiếng Việt\\n' + 'b'.repeat(4100);
      await pasteToLexical(editor, text);
      return editor.innerText === text;
    }''')
    assert result
    before = page.locator("#active-editor").inner_text()
    error = page.evaluate("async () => { try { await pasteToLexical(document.querySelector('#active-editor'), 'new'); } catch(e) { return e.message; } }")
    assert "đang có nội dung" in error
    assert page.locator("#active-editor").inner_text() == before
    # A partial paste must not be mistaken for a complete draft.
    page.evaluate('''() => {
      const editor = document.querySelector('#active-editor'); editor.textContent = '';
      editor.addEventListener('paste', e => { e.preventDefault(); editor.textContent += e.clipboardData.getData('text/plain').slice(0,2); }, {once:true});
    }''')
    error = page.evaluate("async () => { try { await pasteToLexical(document.querySelector('#active-editor'), 'full draft'); } catch(e) { return e.message; } }")
    assert "chưa nhận đủ" in error
    assert page.locator("#active-editor").inner_text() == "fu"

    # Cross-tab adapter shares the same editor selection and verifies insertion.
    page.locator("#active-editor").evaluate("el => el.textContent = ''")
    result = page.evaluate("PosterFacebook.post(PostData.create({content:'Adapter draft'}))")
    assert result["ok"] and result["needsManualPublish"]
    assert page.locator("#active-editor").inner_text() == "Adapter draft"
    assert page.locator("#comment").inner_text() == ""

    # Integrated preview: blocked clipboard must not prevent filling Facebook.
    page.evaluate("html => document.body.innerHTML = html", PANEL + DIALOG)
    page.evaluate('''() => {
      window.panel = document.querySelector('.fbs-panel'); window.panelBody = panel.querySelector('.fbs-panel-body');
      window.toggleMinimize = () => panel.classList.toggle('fbs-minimized');
      window.__published = 0;
      document.querySelector('#publish').onclick = () => window.__published++;
      openFacebookComposer('Bản nháp kiểm thử', 'https://example.com/source', '', 'Tác giả', '', []);
    }''')
    page.locator(".fbs-sp-link-field").fill("")
    page.locator(".fbs-sp-open-fb").click()
    page.wait_for_function("document.querySelector('.fbs-sp-post-status').textContent.includes('chưa sao chép nguồn. Kiểm tra')")
    assert page.locator("#editor").inner_text() == "Bản nháp kiểm thử"
    assert "example.com/source" not in page.locator(".fbs-sp-comment-text").text_content()
    assert page.locator(".fbs-panel").get_attribute("aria-modal") == "false"
    assert page.evaluate("window.__published") == 0
    # Refreshing the preview does not duplicate IDs or controls; failed images
    # remain selectable and keyboard-accessible, and explicit deselection works.
    page.evaluate('''() => {
      panel.classList.remove('fbs-minimized');
      openFacebookComposer('Bản nháp mới', '', '', '', '', ['https://example.com/a.jpg','https://example.com/b.jpg']);
      document.querySelectorAll('.fbs-sp-thumb img').forEach(image => image.dispatchEvent(new Event('error')));
    }''')
    assert page.locator(".fbs-status-preview").count() == 1
    assert page.locator(".fbs-sp-image-error").count() == 2
    first = page.locator(".fbs-sp-thumb-cb").first
    first.focus()
    page.keyboard.press("Space")
    assert not first.is_checked()
    assert page.locator(".fbs-sp-thumb").first.is_visible()
    assert page.get_by_role("textbox", name="Link bài gốc", exact=True).count() == 1
    assert page.get_by_role("textbox", name="Link tham khảo, mỗi dòng một link", exact=True).count() == 1

    # Check actual overflow at desktop and compact widths, both themes.
    for width in [1280, 390, 320]:
        page.set_viewport_size({"width": width, "height": 800})
        for theme in ["light", "dark"]:
            page.locator(".fbs-panel").evaluate("(el, theme) => el.dataset.fbsTheme = theme", theme)
            page.wait_for_timeout(400)
            assert page.locator(".fbs-panel").evaluate("el => el.scrollWidth <= el.clientWidth + 1"), (width,theme)
            assert page.locator(".fbs-panel-body").evaluate("el => el.scrollWidth <= el.clientWidth + 1"), (width,theme,page.locator(".fbs-panel-body").evaluate("el => [...el.querySelectorAll('*')].filter(x=>x.getBoundingClientRect().right > el.getBoundingClientRect().right).map(x=>[x.className,x.getBoundingClientRect().width])"))
            assert page.locator(".fbs-panel").evaluate("el => {const r=el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth+1;}"), (width, theme, page.locator(".fbs-panel").bounding_box())
            if width in [1280,390]:
                page.screenshot(path=f"/tmp/feedwriter-composer-{width}-{theme}.png")
                page.locator(".fbs-sp-open-fb").scroll_into_view_if_needed()
                assert page.locator(".fbs-sp-open-fb").is_visible()
                page.screenshot(path=f"/tmp/feedwriter-composer-actions-{width}-{theme}.png")
    assert not errors, errors
    browser.close()
    print("OK Facebook composer: semantic triggers, existing/hidden dialogs, comment exclusion, ignored/partial paste, Unicode, clipboard denial, draft preservation, image keyboard selection, responsive light/dark UI; no publish")
