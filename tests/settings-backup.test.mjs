import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
const settingsSource = source.slice(source.indexOf("const DEFAULT_SETTINGS ="), source.indexOf("// API keys, history"));
const backupSource = source.slice(source.indexOf("async function backupSettings()"), source.indexOf("// Run migration only inside"));

test("backup and restore preserve disabled bold and active automation/model settings", async () => {
  const sync = {
    enableUnicodeBold: false,
    autoSummarize: true,
    autoShortenLinks: false,
    autoShortenConsent: false,
    modelOverrides: { groq: "fixture-model" },
  };
  const local = {};
  const context = vm.createContext({
    chrome: { storage: {
      onChanged: { addListener() {} },
      sync: {
        async get(keys) { return Object.fromEntries(keys.map(key => [key, sync[key]])); },
        async set(values) { Object.assign(sync, values); },
      },
      local: {
        async get(key) { return { [key]: local[key] }; },
        async set(values) { Object.assign(local, values); },
      },
    } },
    logger: { debug() {}, info() {}, error() {} },
    formatDate: () => "date",
  });
  vm.runInContext("const SETTINGS_VERSION = 2;", context);
  vm.runInContext(settingsSource + backupSource, context);
  await vm.runInContext("backupSettings()", context);
  Object.assign(sync, { enableUnicodeBold: true, autoSummarize: false, autoShortenLinks: true,
    autoShortenConsent: true, modelOverrides: {} });
  assert.equal(await vm.runInContext("restoreSettings()", context), true);
  assert.equal(sync.enableUnicodeBold, false);
  assert.equal(sync.autoSummarize, true);
  assert.equal(sync.autoShortenLinks, false);
  assert.equal(sync.autoShortenConsent, false);
  assert.equal(sync.modelOverrides.groq, "fixture-model");
});
