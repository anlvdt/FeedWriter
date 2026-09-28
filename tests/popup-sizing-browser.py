"""Guard Chrome action-popup intrinsic size, including its narrow initial viewport."""
from pathlib import Path
import shutil
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
with sync_playwright() as p:
    chrome = shutil.which('google-chrome') or '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    browser = p.chromium.launch(headless=True, executable_path=chrome if Path(chrome).exists() else None)
    page = browser.new_page()
    page.goto((ROOT / 'popup.html').as_uri())
    # No extension APIs in this fixture: test the real markup and CSS only.
    for width in (25, 50, 320, 380, 1280):
        page.set_viewport_size({'width': width, 'height': 600})
        for view in ('main-view', 'wizard-view'):
            page.evaluate('''view => {
                for (const id of ['main-view', 'wizard-view']) {
                    const el = document.getElementById(id);
                    el.hidden = id !== view;
                    el.style.display = id === view ? (id === 'main-view' ? 'flex' : 'block') : 'none';
                }
            }''', view)
            sizes = page.evaluate('''() => ({
                root: document.documentElement.getBoundingClientRect().width,
                body: document.body.getBoundingClientRect().width,
                scroll: document.documentElement.scrollWidth
            })''')
            assert sizes['root'] == 380 and sizes['body'] == 380, (width, view, sizes)
            assert sizes['scroll'] >= 380, (width, view, sizes)
    browser.close()
print('OK popup intrinsic sizing: main and onboarding at initial widths 25/50/320/380/1280px')
