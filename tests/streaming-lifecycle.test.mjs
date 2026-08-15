import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadStreamingContext() {
  const context = vm.createContext({
    AbortController,
    DOMException,
    TextDecoder,
    TextEncoder,
    URL,
    Uint8Array,
    setTimeout,
    clearTimeout,
    crypto: globalThis.crypto,
    chrome: {
      storage: {
        sync: { get: async () => ({}) },
        local: { get: async () => ({}), set: async () => {} },
      },
    },
  });
  vm.runInContext(readFileSync(path.join(root, "bg-api.js"), "utf8"), context);
  return context;
}

function stalledResponse(text) {
  const bytes = new TextEncoder().encode(`data: ${JSON.stringify({ token: text })}\n\n`);
  let reads = 0;
  return {
    body: {
      getReader() {
        return {
          async read() {
            reads += 1;
            if (reads === 1) return { done: false, value: bytes };
            throw new DOMException("stream aborted", "AbortError");
          },
          async cancel() {},
        };
      },
    },
  };
}

describe("streaming lifecycle", () => {
  it("keeps received text when a provider stream times out", async () => {
    const context = loadStreamingContext();
    context.response = stalledResponse("Nội dung đã nhận");
    context.port = { messages: [], postMessage(message) { this.messages.push(message); } };
    context.signal = new AbortController().signal;
    context.parseLine = (data) => data.token || "";

    const result = await vm.runInContext(
      "processStream(response, port, signal, parseLine, null, () => false)",
      context,
    );

    assert.equal(result.summary, "Nội dung đã nhận");
    assert.equal(result.recoveredFromTimeout, true);
    assert.equal(context.port.messages.at(-1).full, "Nội dung đã nhận");
  });

  it("does not publish a partial result after an explicit user stop", async () => {
    const context = loadStreamingContext();
    context.response = stalledResponse("Nội dung dở dang");
    context.port = { postMessage() {} };
    context.signal = new AbortController().signal;
    context.parseLine = (data) => data.token || "";

    const result = await vm.runInContext(
      "processStream(response, port, signal, parseLine, null, () => true)",
      context,
    );

    assert.equal(result.error, "Đã hủy.");
    assert.equal(result.summary, undefined);
  });

  it("propagates a provider timeout when no text was received", async () => {
    const context = loadStreamingContext();
    context.response = stalledResponse("");
    context.port = { postMessage() {} };
    context.signal = new AbortController().signal;
    context.parseLine = () => "";

    await assert.rejects(
      vm.runInContext(
        "processStream(response, port, signal, parseLine, null, () => false)",
        context,
      ),
      (error) => error?.name === "AbortError",
    );
  });

  it("keeps the stream promise inside the timeout try/finally", () => {
    const background = readFileSync(path.join(root, "background.js"), "utf8");
    assert.match(background, /return await processStream\(/);
    assert.match(background, /idleTimeoutId = setTimeout\(abortRequest, streamIdleTimeoutMs\)/);
    assert.match(background, /if \(result\.recoveredFromTimeout\)/);
  });

  it("keeps the summary type in scope throughout the background stream", () => {
    const background = readFileSync(path.join(root, "background.js"), "utf8");
    assert.match(
      background,
      /async function handleStream\([\s\S]*?preferredProvider = null,\s*type = "summary",\s*\)/,
    );
    assert.match(
      background,
      /msg\.preferredProvider \|\| null,\s*msg\.type \|\| "summary",\s*\)/,
    );
    assert.match(background, /postProcessOutput\(result\.summary, text, type\)/);
    assert.match(background, /saveHistory\([\s\S]*?site,\s*type,/);
  });

  it("restores result actions when the UI watchdog has partial text", () => {
    const content = readFileSync(path.join(root, "content.js"), "utf8");
    assert.match(content, /const partial = streamBuffer\.trim\(\)/);
    assert.match(content, /Provider đã ngừng phản hồi/);
    assert.match(content, /\{ ok: true, summary: partial, partial: true \}/);
  });
});
