import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
const branch = source.slice(
  source.indexOf('  if (request.action === "get-pending-post") {'),
  source.indexOf('  if (request.action === "prepare-pending-post") {'),
);

function makeFixture(oldTab) {
  const record = { createdAt: Date.now(), postData: { content: "draft" },
    claimedTabId: 7, prepared: true };
  let saved;
  const context = vm.createContext({
    schema: { isAllowedPendingSender: () => true },
    localStorageAccessReady: Promise.resolve(true),
    queuePendingPostUpdate: operation => operation(),
    loadPendingPost: async () => record,
    pendingPostKey: () => "pendingFacebookPost:fixture",
    chrome: {
      tabs: { get: async () => oldTab },
      storage: { local: { set: async data => { saved = data; } } },
    },
  });
  vm.runInContext(`function handle(request, sender, sendResponse) { ${branch} }`, context);
  const get = () => new Promise(resolve => {
    vm.runInContext("handle(request, sender, respond)", Object.assign(context, {
      request: { action: "get-pending-post", kind: "facebook", id: "fixture" },
      sender: { tab: { id: 8 } }, respond: resolve,
    }));
  });
  return { get, record, get saved() { return saved; } };
}

test("a prepared draft can be reclaimed after its original tab closes", async () => {
  const fixture = makeFixture(null);
  const result = await fixture.get();
  assert.equal(result.ok, true);
  assert.equal(fixture.record.claimedTabId, 8);
  assert.equal(fixture.record.prepared, false);
  assert.ok(fixture.saved);
});

test("a live original tab keeps its claim", async () => {
  const fixture = makeFixture({ id: 7 });
  const result = await fixture.get();
  assert.equal(result.ok, false);
  assert.equal(result.code, "pending_claimed");
  assert.equal(fixture.record.claimedTabId, 7);
});
