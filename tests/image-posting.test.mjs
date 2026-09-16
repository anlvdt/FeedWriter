import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "content-dom.js"), "utf8");
const imageHelpers = source.slice(
  source.indexOf("let lastImageFetchPermissionDenied"),
  source.indexOf("function _matchesClutterLabelNorm"),
);

function makeContext(onMessage) {
  const context = vm.createContext({
    URL,
    Blob,
    File,
    Uint8Array,
    atob,
    console,
    document: {
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    chrome: {
      runtime: { sendMessage: onMessage },
    },
  });
  vm.runInContext(imageHelpers, context);
  return context;
}

describe("Facebook post image handoff", () => {
  it("turns a captured PNG data URL into a PNG File without a network fetch", async () => {
    const context = makeContext(() => { throw new Error("unexpected message"); });
    const dataUrl = "data:image/png;base64," + Buffer.alloc(120, 7).toString("base64");
    context.imageUrl = dataUrl;
    const file = await vm.runInContext("fetchImageBlob(imageUrl, 'capture.png')", context);
    assert.equal(file.type, "image/png");
    assert.equal(file.name, "capture.png");
    assert.equal(file.size, 120);
  });

  it("converts a service-worker image response into a File", async () => {
    const dataUrl = "data:image/jpeg;base64," + Buffer.alloc(120, 8).toString("base64");
    const context = makeContext((message, callback) => {
      if (message.action === "request-optional-permission") return Promise.resolve({ granted: true });
      assert.equal(message.action, "fetch-image");
      callback({ base64: dataUrl });
    });
    context.imageUrl = "https://pbs.twimg.com/media/example.jpg";
    const file = await vm.runInContext("fetchImageBlob(imageUrl, 'image.png')", context);
    assert.equal(file.type, "image/jpeg");
    assert.equal(file.name, "image.jpg");
    assert.equal(file.size, 120);
  });

  it("allows HTTPS image connections in the extension CSP", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
    assert.match(manifest.content_security_policy.extension_pages, /connect-src[^;]*https:/);
  });
});
