import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const store = require(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "api-key-store.js"));

function fixture(localState, syncState, options = {}) {
  const local = structuredClone(localState);
  const sync = structuredClone(syncState);
  let syncRemoved = false;
  const api = {
    local: {
      async get() { return structuredClone(local); },
      async set(update) {
        if (options.failWrite) throw new Error("write failed");
        Object.assign(local, structuredClone(update));
      },
    },
    sync: {
      async get() { return structuredClone(sync); },
      async remove(keys) {
        if (options.failRemove) throw new Error("remove failed");
        syncRemoved = true;
        for (const key of keys) delete sync[key];
      },
    },
  };
  return { api, local, sync, get syncRemoved() { return syncRemoved; } };
}

test("mixed local and sync keys survive migration and repeat migration", async () => {
  const state = fixture(
    { apiKeys: { groq: ["local-A"] } },
    { apiKeys: { groq: ["sync-B"], gemini: ["sync-C"] } },
  );
  const first = await store.migrate(state.api);
  assert.deepEqual(first.apiKeys.groq, ["local-A", "sync-B"]);
  assert.deepEqual(first.apiKeys.gemini, ["sync-C"]);
  assert.deepEqual(state.local.backupApiKeys, state.local.apiKeys);
  assert.equal(state.syncRemoved, true);
  assert.deepEqual((await store.migrate(state.api)).apiKeys, first.apiKeys);
});

test("an empty sync map cannot destroy the only recovery backup", async () => {
  const state = fixture(
    { backupApiKeys: { cerebras: ["backup-A"] } },
    { apiKeys: {} },
  );
  const result = await store.migrate(state.api);
  assert.equal(result.restoredFromBackup, true);
  assert.deepEqual(state.local.apiKeys.cerebras, ["backup-A"]);
  assert.deepEqual(state.local.backupApiKeys.cerebras, ["backup-A"]);
});

test("a nonempty primary does not resurrect deliberately removed backup keys", async () => {
  const state = fixture(
    { apiKeys: { groq: ["current"] }, backupApiKeys: { groq: ["old"] } },
    {},
  );
  const result = await store.migrate(state.api);
  assert.deepEqual(result.apiKeys.groq, ["current"]);
  assert.equal(state.syncRemoved, false);
});

test("legacy key is kept and sync is only removed after a verified local write", async () => {
  const state = fixture({}, { apiKey: "legacy-A", provider: "gemini" });
  await store.migrate(state.api);
  assert.deepEqual(state.local.apiKeys.gemini, ["legacy-A"]);
  assert.equal(state.syncRemoved, true);

  const failed = fixture({}, { apiKey: "legacy-B" }, { failWrite: true });
  await assert.rejects(store.migrate(failed.api), /write failed/);
  assert.equal(failed.syncRemoved, false);
  assert.equal(failed.sync.apiKey, "legacy-B");
});
