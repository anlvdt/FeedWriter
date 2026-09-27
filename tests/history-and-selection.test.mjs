import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { TextEncoder } from "node:util";
import crypto from "node:crypto";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("explicit image selection never restores a deselected primary image", () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, "post-data.js"), "utf8"), context);
  const images = selection => vm.runInContext(
    `PostData.fromFeedWriter("text", "", "first", "", "", ${JSON.stringify(selection)}).images.map(x => x.url)`,
    context,
  );
  assert.deepEqual([...images([])], []);
  assert.deepEqual([...images(["second"])], ["second"]);
  assert.deepEqual([...images(["second", "second", "third"])], ["second", "third"]);
  assert.equal(images(Array.from({ length: 12 }, (_, i) => `image-${i}`)).length, 10);
  assert.deepEqual([...images(undefined)], ["first"]);
});

test("clear then undo preserves summaries saved after clear and cannot undo twice", async () => {
  const source = fs.readFileSync(path.join(root, "background.js"), "utf8");
  const historySource = source.slice(source.indexOf("function compactHistoryForStorage"), source.indexOf("// reviewTodayHistory"));
  const state = { history: [{ text: "old", summary: "old" }, { text: "old", summary: "old" }] };
  const alarms = new Map();
  const chrome = { alarms: {
    onAlarm: { addListener() {} },
    async create(name, info) { alarms.set(name, info); },
    async clear(name) { return alarms.delete(name); },
  }, storage: { local: {
    async get(keys) {
      const names = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(names.map(key => [key, state[key]]));
    },
    async set(data) { Object.assign(state, data); },
    async remove(key) { delete state[key]; },
  } } };
  const context = vm.createContext({
    chrome, crypto, TextEncoder, Date, JSON,
    logger: { warn() {} },
    formatVietnamIsoString: () => "2026-09-23",
  });
  vm.runInContext("let historyWriteQueue = Promise.resolve(); const HISTORY_MAX_ITEMS = 200; const HISTORY_MAX_BYTES = 2 * 1024 * 1024;", context);
  vm.runInContext(historySource, context);
  const cleared = await vm.runInContext('updateHistory("history-clear")', context);
  assert.equal(cleared.ok, true);
  assert.equal(cleared.undoAvailable, true);
  assert.equal(alarms.has("history-backup-expire"), true);
  await vm.runInContext('saveHistory("new", "new", "test", "summary", "")', context);
  const restored = await vm.runInContext(`updateHistory("history-undo", ${JSON.stringify(cleared.id)})`, context);
  assert.equal(restored.ok, true);
  assert.deepEqual([...state.history.map(entry => entry.text)], ["new", "old", "old"]);
  assert.equal(alarms.has("history-backup-expire"), false);
  const again = await vm.runInContext(`updateHistory("history-undo", ${JSON.stringify(cleared.id)})`, context);
  assert.equal(again.ok, false);
  assert.deepEqual([...state.history.map(entry => entry.text)], ["new", "old", "old"]);
});

test("worker expiry removes the undo copy after the popup is gone", async () => {
  const source = fs.readFileSync(path.join(root, "background.js"), "utf8");
  const historySource = source.slice(source.indexOf("function compactHistoryForStorage"), source.indexOf("// reviewTodayHistory"));
  const state = { history: [{ text: "private", summary: "private" }] };
  const alarms = new Map();
  const chrome = { alarms: {
    onAlarm: { addListener() {} },
    async create(name, info) { alarms.set(name, info); },
    async clear(name) { return alarms.delete(name); },
  }, storage: { local: {
    async get(keys) {
      const names = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(names.map(key => [key, state[key]]));
    },
    async set(data) { Object.assign(state, data); },
    async remove(key) { delete state[key]; },
  } } };
  const context = vm.createContext({ chrome, crypto, TextEncoder, Date, JSON, logger: { warn() {} } });
  vm.runInContext("let historyWriteQueue = Promise.resolve(); const HISTORY_MAX_ITEMS = 200; const HISTORY_MAX_BYTES = 2 * 1024 * 1024;", context);
  vm.runInContext(historySource, context);
  const cleared = await vm.runInContext('updateHistory("history-clear")', context);
  assert.equal(cleared.undoAvailable, true);
  assert.equal(state.history.length, 0);
  assert.equal(state.historyBackup.items[0].text, "private");
  state.historyBackup.deletedAt = Date.now() - 31_000;
  await vm.runInContext("expireHistoryBackupIfDue()", context);
  assert.equal(state.historyBackup, undefined);
  assert.equal(alarms.size, 0);
});

test("history clear does not retain an undo copy if its alarm cannot be scheduled", async () => {
  const source = fs.readFileSync(path.join(root, "background.js"), "utf8");
  const historySource = source.slice(source.indexOf("function compactHistoryForStorage"), source.indexOf("// reviewTodayHistory"));
  const state = { history: [{ text: "private", summary: "private" }] };
  const chrome = { alarms: {
    onAlarm: { addListener() {} },
    async create() { throw new Error("alarm unavailable"); },
    async clear() {},
  }, storage: { local: {
    async get(keys) {
      const names = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(names.map(key => [key, state[key]]));
    },
    async set(data) { Object.assign(state, data); },
    async remove(key) { delete state[key]; },
  } } };
  const context = vm.createContext({ chrome, crypto, TextEncoder, Date, JSON, logger: { warn() {} } });
  vm.runInContext("let historyWriteQueue = Promise.resolve(); const HISTORY_MAX_ITEMS = 200; const HISTORY_MAX_BYTES = 2 * 1024 * 1024;", context);
  vm.runInContext(historySource, context);
  const result = await vm.runInContext('updateHistory("history-clear")', context);
  assert.equal(result.ok, true);
  assert.equal(result.undoAvailable, false);
  assert.equal(state.history.length, 0);
  assert.equal(state.historyBackup, undefined);
});
