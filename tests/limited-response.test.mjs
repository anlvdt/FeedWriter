import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
const code = source.slice(source.indexOf("async function readTextLimited("), source.indexOf("async function enrichRelatedSourceUrl("));
const context = vm.createContext({ TextDecoder, Promise, Error, Blob, setTimeout, clearTimeout });
vm.runInContext(code, context);

test("reads a bounded UTF-8 response in chunks", async () => {
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("Đoạn "));
      controller.enqueue(new TextEncoder().encode("hai"));
      controller.close();
    },
  }));
  context.response = response;
  context.signal = new AbortController().signal;
  assert.equal(await vm.runInContext("readTextLimited(response, 100, signal)", context), "Đoạn hai");
});

test("rejects a stream without Content-Length after the byte cap", async () => {
  let pulled = 0;
  const response = new Response(new ReadableStream({
    pull(controller) {
      pulled++;
      controller.enqueue(new Uint8Array(1024));
    },
  }));
  context.response = response;
  context.signal = new AbortController().signal;
  await assert.rejects(vm.runInContext("readTextLimited(response, 2048, signal)", context), /response_too_large/);
  assert.ok(pulled < 10);
});

test("body deadline stops a stalled response", async () => {
  const response = new Response(new ReadableStream({ start() {} }));
  const controller = new AbortController();
  context.response = response;
  context.signal = controller.signal;
  const result = vm.runInContext("readTextLimited(response, 2048, signal)", context);
  controller.abort();
  await assert.rejects(result, /response_timeout/);
});

test("image body rejects excess bytes without buffering the full response", async () => {
  let pulled = 0;
  const response = new Response(new ReadableStream({
    pull(controller) {
      pulled++;
      controller.enqueue(new Uint8Array(1024));
    },
  }));
  context.response = response;
  await assert.rejects(
    vm.runInContext('readBlobLimited(response, 2048, 1000, "image/png")', context),
    /Ảnh quá lớn/,
  );
  assert.ok(pulled < 10);
});

test("image body deadline ends a stalled download", async () => {
  const response = new Response(new ReadableStream({ start() {} }));
  context.response = response;
  await assert.rejects(
    vm.runInContext('readBlobLimited(response, 2048, 20, "image/png")', context),
    /image_response_timeout/,
  );
});
