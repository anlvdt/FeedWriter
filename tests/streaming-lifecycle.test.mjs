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
    assert.equal(
      context.port.messages.map((message) => message.text || "").join(""),
      "Nội dung đã nhận",
    );
    assert.ok(context.port.messages.every((message) => !("full" in message)));
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

  it("streams incremental chunks instead of repeatedly sending the full response", () => {
    const api = readFileSync(path.join(root, "bg-api.js"), "utf8");
    const content = readFileSync(path.join(root, "content.js"), "utf8");

    assert.match(api, /port\.postMessage\(\{ action: "chunk", text \}\)/);
    assert.doesNotMatch(api, /action: "chunk", text: token, full: fullText/);
    assert.match(content, /streamBuffer \+= msg\.text/);
  });

  it("keeps screenshots out of history storage and migrates API keys before settings", () => {
    const background = readFileSync(path.join(root, "background.js"), "utf8");
    const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));

    assert.ok(manifest.permissions.includes("unlimitedStorage"));
    assert.match(background, /function compactHistoryForStorage/);
    assert.match(background, /function repairCooldownsAfterStorageQuotaFix/);
    assert.match(background, /storageQuotaRepairVersion: REPAIR_VERSION/);
    assert.match(background, /\^data:\/i\.test\(String\(imageUrl/);
    assert.match(background, /chrome\.storage\.sync\.remove\(\["apiKeys", "apiKey"\]\)/);
    assert.ok(
      background.indexOf("await migrateApiKeysOutOfSync()") <
        background.indexOf("await migrateSettingsIfNeeded()"),
    );
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

  it("uses the neutral news prompt as the default summary tone", () => {
    const background = readFileSync(path.join(root, "background.js"), "utf8");
    const content = readFileSync(path.join(root, "content.js"), "utf8");
    assert.doesNotMatch(background, /if \(type === "summary" && !tone\) tone = "viral"/);
    assert.doesNotMatch(content, /if \(type === "summary" && !tone\) tone = "viral"/);
    assert.match(content, /data-tone="default"[^>]*>Bản tin · mặc định<\/button>/);
    assert.match(content, /data-tone="viral"[^>]*>Viral<\/button>/);
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

  it("defers a media-less X screenshot until the explicit publish action", () => {
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
    const summarizeFlow = content.slice(
      content.indexOf("async function summarizeText"),
      content.indexOf("currentPort.postMessage", content.indexOf("async function summarizeText")),
    );
    assert.doesNotMatch(summarizeFlow, /captureVisiblePost\(_el\)/);
    assert.match(content, /const imageUrl = realPostImages\[0\] \|\| capturedImageUrl \|\|/);
    assert.match(content, /SITE === "x" && realPostImages\.length === 0/);
    assert.match(content, /Always recapture at publish/);
    assert.match(background, /\^data:image\\\/png;base64,/);
  });
});
