import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const translate = fs.readFileSync(path.join(root, "translate.js"), "utf8");
const popup = fs.readFileSync(path.join(root, "popup.html"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const { isTranslatable } = require(path.join(root, "lib/translate-eligibility.js"));

describe("audit hardening", () => {
  it("keeps README, popup badge, and manifest on the same version", () => {
    assert.equal(manifest.version, "2.8.5");
    assert.match(popup, /v2\.8\.5/);
    assert.match(readme, /version-2\.8\.5/);
  });

  it("binds screenshots to the sender X tab", () => {
    assert.match(background, /const tab = sender\.tab/);
    assert.match(background, /isXScreenshotHost\(senderHostname\(sender\)\)/);
    assert.match(background, /active\.id !== tab\.id/);
    assert.doesNotMatch(
      background,
      /chrome\.tabs\.query\(\{\s*active:\s*true,\s*currentWindow:\s*true\s*\}\)/,
    );
  });

  it("allowlists optional permission requests", () => {
    assert.match(background, /ALLOWED_OPTIONAL_PERMISSIONS/);
    assert.match(background, /isAllowedOptionalOrigin/);
    assert.match(background, /clipboardRead/);
  });

  it("shares Groq TPM across summarize jobs and falls back when exhausted", () => {
    assert.match(background, /const groqTpmLedger/);
    assert.match(background, /async function waitForGroqTpm/);
    assert.match(background, /function groqTpmExcludeProviders/);
    assert.match(background, /Groq hết token\/phút — chuyển provider khác/);
    assert.match(background, /excludeProviders/);
  });

  it("does not spend auto-summary quota on skipped posts", () => {
    assert.match(content, /post\.dataset\.fbsAutoSummary = "skip"/);
    assert.match(content, /autoSummaryCount\+\+/);
    const queue = content.slice(
      content.indexOf("function queueAutoSummary"),
      content.indexOf("async function runAutoSummary"),
    );
    assert.doesNotMatch(queue, /autoSummaryCount\+\+/);
  });

  it("copies selected panel text instead of hijacking Cmd/Ctrl+C", () => {
    assert.match(content, /panel\.contains\(sel\.anchorNode\)/);
  });

  it("opens translate on double-click of an English word", () => {
    assert.match(translate, /addEventListener\("dblclick"/);
    assert.match(translate, /applyTranslateTheme/);
  });

  it("uses one isTranslatable helper for toolbar and tooltip", () => {
    assert.equal(isTranslatable("hello"), true);
    assert.equal(isTranslatable("https://example.com"), false);
    assert.equal(isTranslatable("こんにちは"), false);
    for (const entry of manifest.content_scripts) {
      if (entry.js.includes("content.js") || entry.js.includes("translate.js")) {
        assert.ok(entry.js.includes("lib/translate-eligibility.js"));
      }
    }
  });
});
