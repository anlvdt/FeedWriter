import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const source = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
const snippet = source.slice(source.indexOf("const localStorageAccessReady ="), source.indexOf("async function repairCooldownsAfterStorageQuotaFix"));
const require = createRequire(import.meta.url);
const schema = require("../lib/message-schema.js");

test("content settings bridge accepts only content tabs and never accepts a key selector", () => {
  const tab = { id: "fixture-extension", tab: { id: 7, url: "https://www.facebook.com/" } };
  const popup = { id: "fixture-extension", url: "chrome-extension://fixture-extension/popup.html" };
  assert.equal(schema.validate({ action: "get-content-settings" }, tab).ok, true);
  assert.equal(schema.validate({ action: "get-content-settings" }, popup).ok, false);
  const allowed = source.slice(source.indexOf("const CONTENT_SETTING_KEYS ="), source.indexOf("chrome.storage.onChanged.addListener", source.indexOf("const CONTENT_SETTING_KEYS =")));
  assert.doesNotMatch(allowed, /apiKey|backupApiKeys/);
});

test("key migration fails closed when trusted-only storage access cannot be set", async () => {
  let migrated = false;
  const context = vm.createContext({
    chrome: { storage: {
      local: { setAccessLevel: async () => { throw new Error("denied"); } },
      sync: { setAccessLevel: async () => {} },
    } },
    FeedWriterApiKeyStore: { migrate: async () => { migrated = true; } },
    logger: { warn() {} },
    Promise,
  });
  vm.runInContext(snippet, context);
  await assert.rejects(vm.runInContext("migrateApiKeysOutOfSync()", context), /Không bảo vệ được kho API key/);
  assert.equal(migrated, false);
});

test("sync setting relay never forwards legacy API keys to content tabs", async () => {
  const relaySource = source.slice(source.indexOf("const CONTENT_SETTING_KEYS ="), source.indexOf("// API keys, history"));
  let listener;
  const sent = [];
  const context = vm.createContext({
    chrome: {
      storage: { onChanged: { addListener(fn) { listener = fn; } } },
      tabs: {
        async query() { return [{ id: 7 }]; },
        async sendMessage(_id, message) { sent.push(message); },
      },
    },
  });
  vm.runInContext(relaySource, context);
  listener({ apiKeys: { newValue: { groq: ["secret"] } }, autoSummarize: { newValue: true } }, "sync");
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(sent.length, 1);
  assert.deepEqual(Object.keys(sent[0].changes), ["autoSummarize"]);
  assert.doesNotMatch(JSON.stringify(sent), /secret/);
});
