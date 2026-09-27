import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
const urlRules = source.slice(
  source.indexOf("function isSafePublicHttpsUrl("),
  source.indexOf("const ALLOWED_OPTIONAL_PERMISSIONS"),
);
const enrichment = source.slice(
  source.indexOf("async function enrichRelatedSourceUrl("),
  source.indexOf("// === CONTEXT MENU ==="),
);

function fixture(fetch) {
  const context = vm.createContext({
    URL, AbortController, setTimeout, clearTimeout, fetch,
    absoluteUrl: (url, base) => new URL(url, base).href,
    readTextLimited: async () => "<html></html>",
    extractRelatedMetadata: () => [],
  });
  vm.runInContext(urlRules + enrichment, context);
  return context;
}

test("an attacker-owned public hostname is not fetched for metadata", async () => {
  const calls = [];
  const context = fixture(async (url) => { calls.push(url); throw new Error("unexpected fetch"); });
  assert.equal(vm.runInContext("isSafePublicHttpsUrl('https://public.example/post')", context), true);
  assert.equal(vm.runInContext("isAllowedEnrichmentFetchUrl('https://public.example/post')", context), false);
  await vm.runInContext("enrichRelatedSourceUrl('https://public.example/post')", context);
  assert.deepEqual(calls, []);
});

test("an allowed host cannot redirect metadata fetch to another hostname", async () => {
  const calls = [];
  const context = fixture(async (url) => {
    calls.push(url);
    return { status: 302, headers: new Map([["location", "https://public.example/private"]]) };
  });
  const result = await vm.runInContext("enrichRelatedSourceUrl('https://github.com/example/repo')", context);
  assert.equal(result.length, 0);
  assert.deepEqual(calls, ["https://github.com/example/repo"]);
});

test("standard HTTPS code-hosting and paper URLs remain eligible", () => {
  const context = fixture(async () => { throw new Error("unused"); });
  for (const url of ["https://github.com/org/repo", "https://gitlab.com/org/repo", "https://arxiv.org/abs/1234.5678"]) {
    assert.equal(vm.runInContext(`isAllowedEnrichmentFetchUrl(${JSON.stringify(url)})`, context), true);
  }
  for (const url of ["https://github.com:444/private", "https://sub.github.com/private", "https://github.com.evil.test/"]) {
    assert.equal(vm.runInContext(`isAllowedEnrichmentFetchUrl(${JSON.stringify(url)})`, context), false);
  }
});
