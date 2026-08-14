import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "background.js"), "utf8");
const start = source.indexOf("async function migrateStorageIfNeeded()");
const end = source.indexOf("// === SETTINGS MIGRATION ===", start);
assert.ok(start >= 0 && end > start, "storage migration source must be discoverable");
const migrationSource = source.slice(start, end);

function createMigration(state) {
  const chrome = {
    storage: {
      local: {
        async get(keys) {
          return Object.fromEntries(keys.filter((key) => key in state).map((key) => [key, state[key]]));
        },
        async set(update) {
          Object.assign(state, update);
        },
      },
    },
  };
  const logger = { info() {} };
  return new Function(
    "chrome",
    "logger",
    `const STORAGE_VERSION = 2; ${migrationSource}; return migrateStorageIfNeeded;`,
  )(chrome, logger);
}

test("v1 to v2 migration preserves existing templates", async () => {
  const templates = [{ id: "kept", name: "Must survive" }];
  const state = { storageVersion: 1, templates };
  await createMigration(state)();
  assert.deepEqual(state.templates, templates);
  assert.equal(state.storageVersion, 2);
});

test("v1 to v2 migration initializes a missing template list", async () => {
  const state = { storageVersion: 1 };
  await createMigration(state)();
  assert.deepEqual(state.templates, []);
  assert.equal(state.storageVersion, 2);
});
