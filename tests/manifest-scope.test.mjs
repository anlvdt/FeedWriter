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

  it("runs translation on all https pages", () => {
    const translation = manifest.content_scripts.at(-1);
    assert.deepEqual(translation.matches, ["https://*/*"]);
    assert.ok(translation.js.includes("translate.js"));
  });

  it("keeps clipboardRead optional and drops Shopee hosts and cookies", () => {
    assert.ok((manifest.optional_permissions || []).includes("clipboardRead"));
    assert.ok(!(manifest.permissions || []).includes("clipboardRead"));
    assert.ok(!(manifest.permissions || []).includes("cookies"));
    assert.ok(!manifest.host_permissions.some((h) => /shopee|shope\.ee/i.test(h)));
    assert.ok((manifest.optional_host_permissions || []).includes("https://*/*"));
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
    assert.equal((popup.match(/<button class="accordion-header"/g) || []).length, 2);
    assert.ok(!popup.includes('<div class="accordion-header"'));
    for (const id of ["feed-filter-settings", "source-template-settings"]) {
      assert.match(popup, new RegExp(`aria-controls="${id}"`));
      assert.match(popup, new RegExp(`id="${id}"`));
    }
  });

  it("keeps layout styling in the stylesheet instead of inline markup", () => {
    assert.ok((popup.match(/\sstyle=/g) || []).length <= 10);
  });
});
