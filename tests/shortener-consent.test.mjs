import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const composer = fs.readFileSync(new URL("../content-composer.js", import.meta.url), "utf8");
const shortener = composer.slice(0, composer.indexOf("// --- FACEBOOK COMPOSER ---"));

test("legacy auto-shorten setting does not consent to third-party URL disclosure", async () => {
  const actions = [];
  let onMessage;
  const context = vm.createContext({
    chrome: { runtime: {
      id: "fixture-extension",
      onMessage: { addListener(listener) { onMessage = listener; } },
      sendMessage(message, callback) {
        actions.push(message.action);
        if (message.action === "get-content-settings") {
          callback({ ok: true, settings: { autoShortenLinks: true } });
        } else {
          callback({ success: true, shortUrl: "https://is.gd/fixture" });
        }
      },
    } },
  });
  vm.runInContext(shortener, context);
  context.url = "https://example.com/private?token=fixture";
  assert.equal(await vm.runInContext("resolveDisplayUrl(url)", context), context.url);
  assert.deepEqual(actions, ["get-content-settings"]);

  onMessage({ action: "content-settings-changed", changes: {
    autoShortenConsent: { newValue: true },
  } }, { id: "fixture-extension" });
  assert.equal(await vm.runInContext("resolveDisplayUrl(url)", context), "https://is.gd/fixture");
  assert.deepEqual(actions, ["get-content-settings", "shorten-url"]);
});
