import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");
const snippet = source.slice(source.indexOf("function clearPendingPostToken(url)"), source.indexOf("async function consumePendingRedditPost()"));

test("failed completion ACK keeps token and retry does not paste twice", async () => {
  const id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  let prepared = false;
  let postCalls = 0;
  let completeCalls = 0;
  let displayedError = "";
  let url = `https://www.facebook.com/?feedwriter_compose=${id}`;
  const context = vm.createContext({
    SITE: "facebook",
    URL,
    location: { get href() { return url; } },
    document: { querySelector: () => ({ innerText: "draft" }) },
    history: { state: null, replaceState(_state, _title, path) { url = `https://www.facebook.com${path}`; } },
    chrome: { runtime: { async sendMessage(message) {
      if (message.action === "get-pending-post") return { ok: true, pending: { prepared, postData: { content: "draft" } } };
      if (message.action === "prepare-pending-post") { prepared = true; return { ok: true }; }
      if (message.action === "complete-pending-post") {
        completeCalls++;
        return completeCalls === 1 ? { ok: false, error: "ack failed" } : { ok: true };
      }
      throw new Error("unexpected action");
    } } },
    PosterFacebook: { async post() { postCalls++; return { ok: true }; } },
    openOverlay(html) { displayedError = html; },
    esc: value => value,
    console: { error() {} },
    setTimeout,
  });
  vm.runInContext(snippet, context);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(postCalls, 1);
  assert.match(url, /feedwriter_compose=/);
  assert.match(displayedError, /ack failed/);
  await vm.runInContext("consumePendingFacebookPost()", context);
  assert.equal(postCalls, 1);
  assert.equal(completeCalls, 2);
  assert.doesNotMatch(url, /feedwriter_compose=/);
});

test("reload after prepare refills a blank composer before acknowledging", async () => {
  const id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  let postCalls = 0;
  let prepareCalls = 0;
  let completeCalls = 0;
  const context = vm.createContext({
    SITE: "facebook",
    URL,
    location: { href: `https://www.facebook.com/?feedwriter_compose=${id}` },
    document: { querySelector: () => null },
    history: { state: null, replaceState() {} },
    chrome: { runtime: { async sendMessage(message) {
      if (message.action === "get-pending-post") return { ok: true, pending: { prepared: true, postData: { content: "draft" } } };
      if (message.action === "prepare-pending-post") { prepareCalls++; return { ok: true }; }
      if (message.action === "complete-pending-post") { completeCalls++; return { ok: true }; }
      throw new Error("unexpected action");
    } } },
    PosterFacebook: { async post() { postCalls++; return { ok: true }; } },
    openOverlay() {}, esc: value => value, console: { error() {} }, setTimeout: fn => fn(),
  });
  vm.runInContext(snippet, context);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(postCalls, 1);
  assert.equal(prepareCalls, 1);
  assert.equal(completeCalls, 1);
});
