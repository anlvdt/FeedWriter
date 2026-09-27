"""Run the unpacked extension in a disposable Chromium profile; no provider calls."""

import json
import shutil
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parent.parent
PROBE = """(async () => {
  let local, sync;
  try { local = await chrome.storage.local.get('apiKeys'); }
  catch (error) { local = 'DENIED:' + error.message; }
  try { sync = await chrome.storage.sync.get('apiKeys'); }
  catch (error) { sync = 'DENIED:' + error.message; }
  const settings = await chrome.runtime.sendMessage({ action: 'get-content-settings' });
  const shortener = await chrome.runtime.sendMessage({
    action: 'shorten-url', url: 'https://example.com/private?token=fixture',
  });
  document.documentElement.dataset.fwProbe = JSON.stringify({ local, sync, settings, shortener });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.apiKeys) document.documentElement.dataset.fwKeyEvent = 'leaked';
  });
})();
"""


def make_extension(destination):
    destination.mkdir()
    for path in ROOT.iterdir():
        if path.is_file() and path.suffix in (".js", ".css", ".html", ".json"):
            shutil.copy2(path, destination / path.name)
    for directory in ("lib", "fonts", "icons"):
        shutil.copytree(ROOT / directory, destination / directory)
    (destination / "fixture-probe.js").write_text(PROBE, encoding="utf-8")
    manifest = json.loads((destination / "manifest.json").read_text(encoding="utf-8"))
    manifest["content_scripts"][0]["js"].insert(0, "fixture-probe.js")
    (destination / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


def launch(playwright, extension, profile):
    context = playwright.chromium.launch_persistent_context(
        str(profile), channel="chromium", headless=True,
        args=[f"--disable-extensions-except={extension}", f"--load-extension={extension}"],
    )
    worker = context.service_workers[0] if context.service_workers else context.wait_for_event(
        "serviceworker", timeout=15000,
    )
    return context, worker


with TemporaryDirectory(prefix="feedwriter-extension-smoke-") as temp_dir, sync_playwright() as playwright:
    temp = Path(temp_dir)
    extension = temp / "extension"
    profile = temp / "profile"
    make_extension(extension)

    context, worker = launch(playwright, extension, profile)
    try:
        worker.evaluate("""async () => {
          await chrome.storage.local.set({ apiKeys: { groq: ['fixture-fake-key'] } });
          await chrome.storage.sync.set({ autoSummarize: false, autoShortenLinks: true });
        }""")
        page = context.new_page()
        page.route("https://www.facebook.com/**", lambda route: route.fulfill(
            status=200, content_type="text/html",
            body="<html><body><div role='article'><div data-ad-preview='message'>" +
                 "Long fictional post. " * 50 + "</div></div></body></html>",
        ))
        page.goto("https://www.facebook.com/fixture")
        page.wait_for_function("document.documentElement.dataset.fwProbe !== undefined")
        probe = json.loads(page.locator("html").get_attribute("data-fw-probe"))
        assert probe["local"].startswith("DENIED:"), probe
        assert probe["sync"].startswith("DENIED:"), probe
        assert probe["settings"]["ok"] is True, probe
        assert "apiKeys" not in probe["settings"]["settings"], probe
        assert probe["settings"]["settings"]["autoSummarize"] is False, probe
        assert probe["settings"]["settings"]["autoShortenConsent"] is False, probe
        assert "Chưa bật quyền" in probe["shortener"]["error"], probe

        worker.evaluate("""async () => {
          await chrome.storage.local.set({ apiKeys: { groq: ['fixture-fake-key-2'] } });
          await chrome.storage.sync.set({ apiKeys: { groq: ['fixture-legacy-key'] } });
        }""")
        page.wait_for_timeout(250)
        assert page.locator("html").get_attribute("data-fw-key-event") is None
        popup = context.new_page()
        popup.goto(f"chrome-extension://{worker.url.split('/')[2]}/popup.html")
        assert popup.title() == "FeedWriter"
        assert popup.locator("#autoShortenLinks").is_checked() is False
        worker.evaluate("async () => chrome.storage.local.set({ history: [{ text: 'fixture history', summary: 'fixture' }] })")
        cleared = worker.evaluate("async () => updateHistory('history-clear')")
        assert cleared["ok"] is True and cleared["undoAvailable"] is True, cleared
        assert worker.evaluate("async () => !!(await chrome.alarms.get('history-backup-expire'))") is True
        popup.close()

        worker.evaluate("""async () => {
          await chrome.storage.local.remove(['apiKeys', 'backupApiKeys']);
          await chrome.storage.sync.set({ apiKeys: { groq: ['fixture-legacy-key'] } });
          const { historyBackup } = await chrome.storage.local.get('historyBackup');
          historyBackup.deletedAt = Date.now() - 31000;
          await chrome.storage.local.set({ historyBackup });
        }""")
    finally:
        context.close()

    context, worker = launch(playwright, extension, profile)
    try:
        worker.evaluate("""async () => {
          for (let i = 0; i < 40; i++) {
            const local = await chrome.storage.local.get('apiKeys');
            const sync = await chrome.storage.sync.get('apiKeys');
            if (local.apiKeys?.groq?.includes('fixture-legacy-key') && !sync.apiKeys) return;
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          throw new Error('Legacy key was not migrated on restart');
        }""")
        worker.evaluate("""async () => {
          for (let i = 0; i < 40; i++) {
            if (!(await chrome.storage.local.get('historyBackup')).historyBackup) return;
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          throw new Error('Expired history undo copy survived restart');
        }""")
    finally:
        context.close()

print("Extension smoke: trusted storage, setting bridge, shortener consent, history expiry, migration passed")
