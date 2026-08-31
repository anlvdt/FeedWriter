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

  it("rotates providers instead of publishing polite refusals", () => {
    const background = readFileSync(path.join(root, "background.js"), "utf8");
    assert.ok(background.includes("/^i(?:'|’)?m\\s+sorry\\b/i"));
    assert.match(background, /failure: "provider_refusal"/);
    assert.match(
      background,
      /if \(postResult\.failure\) \{[\s\S]*?markKeyCooldown[\s\S]*?continue;/,
    );
    assert.match(background, /action: "retry"/);

    const content = readFileSync(path.join(root, "content.js"), "utf8");
    assert.match(content, /msg\.action === "retry"/);
    assert.match(content, /streamBuffer = "";[\s\S]*?first = true;/);

    const refusalBranch = background.indexOf("if (postResult.failure)");
    const telemetry = background.indexOf("await incrementTelemetry('summaries')", refusalBranch);
    const history = background.indexOf("await saveHistory(", refusalBranch);
    assert.ok(refusalBranch >= 0 && telemetry > refusalBranch && history > telemetry);
  });

  it("restores result actions when the UI watchdog has partial text", () => {
    const content = readFileSync(path.join(root, "content.js"), "utf8");
    assert.match(content, /const partial = streamBuffer\.trim\(\)/);
    assert.match(content, /Provider đã ngừng phản hồi/);
    assert.match(content, /\{ ok: true, summary: partial, partial: true \}/);
  });

  it("replaces X's generic OpenGraph image with an exact tweet screenshot", () => {
    const content = readFileSync(path.join(root, "content.js"), "utf8");
    const background = readFileSync(path.join(root, "background.js"), "utf8");

    assert.match(content, /const _xGenericImage = SITE === "x"/);
    assert.match(content, /meta\[property="og:image"\]/);
    assert.match(content, /const _xGenericCardImage = !!_xImageNode/);
    assert.match(content, /x\\\.com\|twitter\\\.com/);
    assert.match(content, /see\\s\+what/);
    assert.doesNotMatch(content, /SITE === "x" && !_xNativeMedia/);
    assert.match(content, /if \(_xGenericImage\) _imageUrl = ""/);
    assert.match(content, /x: Math\.round\(bounds\.x\)/);
    assert.match(content, /y: Math\.round\(bounds\.y\)/);
    assert.doesNotMatch(content, /bounds\.y \+ window\.scrollY/);
    assert.match(content, /viewport:[\s\S]*?width: window\.innerWidth/);

    assert.match(background, /const scaleX = img\.width \/ viewportWidth/);
    assert.match(background, /const scaleY = img\.height \/ viewportHeight/);
    assert.match(background, /ctx\.drawImage\([\s\S]*?sourceX,[\s\S]*?sourceY/);
    assert.match(content, /lastSummarizeParams\.capturedImageUrl = _imageUrl/);
    assert.match(content, /const imageUrl = capturedImageUrl \|\|/);
    assert.match(background, /\^data:image\\\/png;base64,/);
  });
});
