"""Offline DOM regression fixtures. Run: python3 tests/browser-fixture.py"""
from pathlib import Path
import os
import shutil
import json
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DOM_JS = ROOT / "content-dom.js"
CONTENT_JS = (ROOT / "content.js").read_text(encoding="utf-8")
REDDIT_SCAN = CONTENT_JS[CONTENT_JS.index("function scanRedditPosts() {"):CONTENT_JS.index("// === MAIN SCAN ===")]


def page_for(browser, hostname, body):
    page = browser.new_page()
    url = f"https://{hostname}/fixture"
    page.route("**/*", lambda route: route.fulfill(
        status=200, content_type="text/html; charset=utf-8", body=f"<html><body>{body}</body></html>"))
    page.goto(url)
    page.add_script_tag(path=str(DOM_JS))
    return page


with sync_playwright() as playwright:
    chrome_path = (os.environ.get("FEEDWRITER_TEST_CHROME") or
                   shutil.which("google-chrome") or shutil.which("chromium") or
                   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    browser = playwright.chromium.launch(headless=True, executable_path=chrome_path if Path(chrome_path).exists() else None)
    try:
        facebook = page_for(browser, "www.facebook.com", """
          <div role="article" id="post">
            <h2><a href="/arcadia">Arcadia</a></h2>
            <a href="https://www.facebook.com/arcadia/posts/123">Time</a>
            <div data-ad-preview="message">Đoạn một.</div>
            <div data-ad-preview="message">Đoạn hai.</div>
          </div>""")
        post = facebook.locator("#post")
        assert facebook.evaluate("fbsExtractPostContent(document.querySelector('#post'))") == "Đoạn một.\n\nĐoạn hai."
        first = facebook.evaluate("fbsExtractMeta(document.querySelector('#post'))")
        post.locator('a[href*="/posts/"]').evaluate("el => el.href = 'https://www.facebook.com/arcadia/posts/456'")
        post.locator('[data-ad-preview="message"]').first.evaluate("el => el.textContent = 'Bài mới.'")
        second = facebook.evaluate("fbsExtractMeta(document.querySelector('#post'))")
        assert "123" in first["permalink"] and "456" in second["permalink"], (first, second)
        facebook.close()

        fixtures = [
            ("x.com", '<article role="article"><a href="/sample/status/123">Link</a><div data-testid="tweetText">A long tweet body</div></article>', "/status/123"),
            ("www.threads.net", '<div data-pressable-container="true"><a href="/@sample/post/abc">Link</a><div>Thread body</div></div>', "/post/abc"),
            ("www.linkedin.com", '<div class="feed-shared-update-v2"><a href="/feed/update/urn:li:activity:123">Link</a><div>Post body</div></div>', "/feed/update/"),
            ("www.reddit.com", '<shreddit-post><a href="/r/test/comments/abc/title">Link</a><div slot="text-body">Reddit body</div></shreddit-post>', "/comments/abc"),
        ]
        for host, body, permalink_part in fixtures:
            page = page_for(browser, host, body)
            url = page.evaluate("fbsExtractPermalink(document.body.firstElementChild)")
            assert permalink_part in url, (host, url)
            page.close()

        reddit = page_for(browser, "www.reddit.com", '<shreddit-post id="post"></shreddit-post>')
        reddit.evaluate("window.MIN_LEN = 30; window.inject = function(post) { const chip = document.createElement('span'); chip.className = 'fbs-wrap'; post.appendChild(chip); }; " + REDDIT_SCAN + "window.scanRedditPosts = scanRedditPosts;")
        reddit.evaluate("scanRedditPosts()")
        assert reddit.locator("#post").get_attribute("data-fbs-scanned") is None
        reddit.locator("#post").evaluate("el => el.innerHTML = '<div slot=\"text-body\">' + 'Reddit body with enough detail to summarize. '.repeat(3) + '</div>'")
        reddit.evaluate("scanRedditPosts()")
        assert reddit.locator("#post").get_attribute("data-fbs-scanned") == "1"
        assert reddit.locator("#post .fbs-wrap").count() == 1
        reddit.close()

        composer = page_for(browser, "www.facebook.com", '<div id="editor" contenteditable="true"></div>')
        composer.evaluate("window.chrome = { runtime: { id: 'fixture', onMessage: { addListener() {} }, sendMessage() {} } };")
        composer.add_script_tag(path=str(ROOT / "content-composer.js"))
        result = composer.evaluate("""async () => {
          const editor = document.querySelector('#editor');
          const events = [];
          editor.addEventListener('paste', event => {
            const files = event.clipboardData.files;
            if (files.length) events.push('image');
            else {
              const chunk = event.clipboardData.getData('text/plain');
              events.push(chunk.length);
              editor.textContent += chunk;
            }
          });
          await pasteToLexical(editor, 'x'.repeat(28000), [new File(['image'], 'test.png', { type: 'image/png' })]);
          return { events, length: editor.textContent.length };
        }""")
        assert result["length"] == 28000
        assert result["events"] == [4000] * 7 + ["image"], result
        composer.close()

        translate = page_for(browser, "www.facebook.com", '<span id="word">hello</span>')
        translate.evaluate("""window.__messages = [];
          window.chrome = { runtime: { id: 'fixture', onMessage: { addListener(listener) { window.__translateListener = listener; } },
            sendMessage(message, callback) { window.__messages.push(message.action); callback?.({ translation: 'Xin chào' }); } } };""")
        translate.add_script_tag(path=str(ROOT / "lib/translate-eligibility.js"))
        translate.add_script_tag(path=str(ROOT / "translate.js"))
        result = translate.evaluate("""() => {
          const range = document.createRange();
          range.selectNodeContents(document.querySelector('#word'));
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          const before = window.__messages.length;
          document.querySelector('#word').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
          return { before, after: window.__messages.length, tooltip: !!document.querySelector('.fbs-translate-tooltip') };
        }""")
        assert result["before"] == result["after"] and not result["tooltip"], result
        translate.evaluate("window.__translateListener({ action: 'translate-selection', text: 'hello', mode: 'word' }, null, () => {})")
        assert translate.locator(".fbs-translate-tooltip.fbs-visible").count() == 1
        translate.locator(".fbs-translate-tooltip").evaluate("el => el.dispatchEvent(new Event('scroll'))")
        assert translate.locator(".fbs-translate-tooltip.fbs-visible").count() == 1
        translate.evaluate("document.dispatchEvent(new Event('scroll'))")
        assert translate.locator(".fbs-translate-tooltip.fbs-visible").count() == 0
        translate.close()

        reddit_editor = browser.new_page()
        reddit_editor.route("https://www.reddit.com/*", lambda route: route.fulfill(
            status=200, content_type="text/html; charset=utf-8",
            body="<html><body><main><faceplate-textarea-input id='title'></faceplate-textarea-input><div id='editors'></div></main></body></html>"))
        reddit_editor.goto("https://www.reddit.com/submit")
        reddit_editor.evaluate("""window.SITE = 'reddit';
          window.PostData = { getTextWithTags(data) { return data.content; } };
          window.waitForCondition = async check => check();
          window.pasteTextToEditor = (editor, text) => { editor.textContent = text; };
          const shadow = document.querySelector('#title').attachShadow({mode:'open'});
          shadow.innerHTML = '<textarea id="innerTextArea"></textarea>';""")
        reddit_editor.add_script_tag(path=str(ROOT / "poster-reddit.js"))
        draft = {"title": "Fixture title", "content": "A Reddit body with enough text.", "images": [], "tags": []}
        reddit_editor.evaluate("window.__draft = " + json.dumps(draft))
        result = reddit_editor.evaluate("PosterReddit.post(window.__draft)")
        assert not result["ok"] and result["reason"] == "Không xác định được ô nội dung Reddit.", result
        reddit_editor.locator("#editors").evaluate("el => el.innerHTML = '<div contenteditable=\"true\" aria-label=\"Body\"></div>'")
        result = reddit_editor.evaluate("PosterReddit.post(window.__draft)")
        assert result["ok"] and reddit_editor.locator('[contenteditable="true"]').inner_text() == draft["content"], result
        reddit_editor.locator("#editors").evaluate("el => el.innerHTML = '<div contenteditable=\"true\"></div><div contenteditable=\"true\"></div>'")
        result = reddit_editor.evaluate("PosterReddit.post(window.__draft)")
        assert not result["ok"] and result["reason"] == "Không xác định được ô nội dung Reddit.", result
        reddit_editor.close()
        print("OK offline browser fixtures: extraction, hydration, long paste, Reddit editor, translate")
    finally:
        browser.close()
