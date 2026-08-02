import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const popup = fs.readFileSync(path.join(root, "popup.html"), "utf8");

describe("manifest scope", () => {
  it("does not request arbitrary-site host access", () => {
    assert.ok(!manifest.host_permissions.includes("https://*/*"));
    assert.ok(!manifest.host_permissions.includes("http://*/*"));
  });

  it("runs translation only on supported social platforms", () => {
    const translation = manifest.content_scripts.at(-1);
    const coreMatches = manifest.content_scripts
      .slice(0, -1)
      .flatMap((entry) => entry.matches)
      .sort();
    assert.deepEqual(translation.matches.slice().sort(), coreMatches);
  });

  it("loads only one platform-specific posting adapter per social site", () => {
    const facebook = manifest.content_scripts[0];
    const nonFacebook = manifest.content_scripts.slice(1, -1);
    assert.ok(facebook.js.includes("content-composer-runtime.js"));
    assert.ok(nonFacebook.every((entry) => entry.js.includes("content-composer-runtime.js")));
    assert.ok(nonFacebook.every((entry) => entry.js.filter((file) => file.startsWith("poster-")).length === 1));
  });
});

describe("popup controls", () => {
  it("uses native buttons for accordion headers", () => {
    assert.equal((popup.match(/<button class="accordion-header"/g) || []).length, 4);
    assert.ok(!popup.includes('<div class="accordion-header"'));
  });

  it("keeps layout styling in the stylesheet instead of inline markup", () => {
    assert.ok((popup.match(/\sstyle=/g) || []).length <= 10);
  });
});
