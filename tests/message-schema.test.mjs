/**
 * Tests for ACTION_SCHEMAS message router validation (lib/message-schema.js).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const schema = require(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "message-schema.js"),
);

const {
  SENDER,
  ACTION_SCHEMAS,
  classifySender,
  validateMessage,
  validate,
} = schema;

const EXT_ID = "feedwriter-test-ext-id";

const extensionPageSender = {
  id: EXT_ID,
  url: `chrome-extension://${EXT_ID}/popup.html`,
};

const contentTabSender = {
  id: EXT_ID,
  tab: { id: 42 },
  url: "https://www.facebook.com/",
};

const unknownSender = {};

describe("classifySender", () => {
  it("classifies extension page (no tab)", () => {
    assert.equal(classifySender(extensionPageSender), "extension_page");
  });

  it("classifies content tab", () => {
    assert.equal(classifySender(contentTabSender), "content_tab");
  });

  it("classifies missing id as unknown", () => {
    assert.equal(classifySender(unknownSender), "unknown");
    assert.equal(classifySender(null), "unknown");
  });

  it("classifies non-extension url without tab as external", () => {
    assert.equal(
      classifySender({ id: EXT_ID, url: "https://evil.example/" }),
      "external",
    );
  });
});

describe("validate / ACTION_SCHEMAS", () => {
  it("rejects invalid summarize without text", () => {
    const r = validate({ action: "summarize" }, extensionPageSender);
    assert.equal(r.ok, false);
    assert.match(r.error, /text|required|Missing/i);
  });

  it("rejects summarize with empty/whitespace text", () => {
    const r = validate(
      { action: "summarize", text: "   " },
      contentTabSender,
    );
    assert.equal(r.ok, false);
    assert.match(r.error, /non-empty|text/i);
  });

  it("accepts valid summarize", () => {
    const r = validate(
      { action: "summarize", text: "Hello world article body", type: "summary" },
      contentTabSender,
    );
    assert.equal(r.ok, true);
    assert.equal(r.request.action, "summarize");
  });

  it("rejects run-github-autopost-now from content_tab", () => {
    const r = validate(
      { action: "run-github-autopost-now" },
      contentTabSender,
    );
    assert.equal(r.ok, false);
    assert.match(r.error, /not allowed|content_tab/i);
  });

  it("accepts run-github-autopost-now from extension_page", () => {
    const r = validate(
      { action: "run-github-autopost-now" },
      extensionPageSender,
    );
    assert.equal(r.ok, true);
  });

  it("rejects fetch-image missing url", () => {
    const r = validate({ action: "fetch-image" }, contentTabSender);
    assert.equal(r.ok, false);
    assert.match(r.error, /url|required|Missing/i);
  });

  it("accepts fetch-image with url", () => {
    const r = validate(
      { action: "fetch-image", url: "https://example.com/a.jpg" },
      contentTabSender,
    );
    assert.equal(r.ok, true);
  });

  it("rejects unknown action", () => {
    const r = validate({ action: "totally-unknown-xyz" }, extensionPageSender);
    assert.equal(r.ok, false);
    assert.equal(r.error, "Unknown action");
  });

  it("rejects github-autopost-done from extension_page", () => {
    const r = validate(
      { action: "github-autopost-done", ok: true },
      extensionPageSender,
    );
    assert.equal(r.ok, false);
  });

  it("accepts github-autopost-done from content_tab", () => {
    const r = validate(
      { action: "github-autopost-done", ok: true, message: "ok" },
      contentTabSender,
    );
    assert.equal(r.ok, true);
  });

  it("rejects request-optional-permission without permissions or origins", () => {
    const r = validate(
      { action: "request-optional-permission" },
      contentTabSender,
    );
    assert.equal(r.ok, false);
  });

  it("accepts request-optional-permission with permissions array", () => {
    const r = validate(
      {
        action: "request-optional-permission",
        permissions: ["clipboardRead"],
      },
      contentTabSender,
    );
    assert.equal(r.ok, true);
  });

  it("accepts enrich-related-source-links with urls array", () => {
    const r = validate(
      { action: "enrich-related-source-links", urls: ["https://a.com"] },
      contentTabSender,
    );
    assert.equal(r.ok, true);
  });

  it("accepts Facebook composer handoff only from a content tab", () => {
    const request = {
      action: "open-facebook-composer",
      postData: { content: "A summarized X post" },
    };
    assert.equal(validate(request, contentTabSender).ok, true);
    assert.equal(validate(request, extensionPageSender).ok, false);
  });

  it("rejects enrich-related-source-links without urls", () => {
    const r = validate(
      { action: "enrich-related-source-links" },
      contentTabSender,
    );
    assert.equal(r.ok, false);
  });

  it("rejects unshorten-shopee-inline from extension_page", () => {
    const r = validate(
      { action: "unshorten-shopee-inline", url: "https://s.shopee.vn/x" },
      extensionPageSender,
    );
    assert.equal(r.ok, false);
  });

  it("accepts unshorten-shopee-inline from content_tab", () => {
    const r = validate(
      { action: "unshorten-shopee-inline", url: "https://s.shopee.vn/x" },
      contentTabSender,
    );
    assert.equal(r.ok, true);
  });

  it("accepts ping / test-connection / get-key-status with no payload", () => {
    for (const action of ["ping", "test-connection", "get-key-status", "backupSettings", "reschedule-github"]) {
      const r = validate({ action }, extensionPageSender);
      assert.equal(r.ok, true, `expected ${action} ok`);
    }
  });

  it("accepts restoreSettings with optional backupIndex number", () => {
    assert.equal(
      validate({ action: "restoreSettings" }, extensionPageSender).ok,
      true,
    );
    assert.equal(
      validate({ action: "restoreSettings", backupIndex: 1 }, extensionPageSender).ok,
      true,
    );
    assert.equal(
      validate({ action: "restoreSettings", backupIndex: "0" }, extensionPageSender).ok,
      false,
    );
  });

  it("accepts shorten-url and translate-word with required strings", () => {
    assert.equal(
      validate({ action: "shorten-url", url: "https://example.com/long" }, contentTabSender).ok,
      true,
    );
    assert.equal(
      validate({ action: "translate-word", word: "hello" }, contentTabSender).ok,
      true,
    );
    assert.equal(
      validate({ action: "translate-word", word: "  " }, contentTabSender).ok,
      false,
    );
  });

  it("accepts contextual technical translation requests", () => {
    const r = validate(
      {
        action: "translate-text",
        text: "archive",
        mode: "word",
        context: "Extract the downloaded archive file before running the code.",
      },
      contentTabSender,
    );
    assert.equal(r.ok, true);
  });

  it("validateMessage rejects when schemas map is empty for action", () => {
    const r = validateMessage("ping", { action: "ping" }, extensionPageSender, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, "Unknown action");
  });

  it("exports SENDER constants used by schemas", () => {
    assert.equal(SENDER.ANY_EXTENSION, "extension");
    assert.equal(SENDER.EXTENSION_PAGE, "extension_page");
    assert.equal(SENDER.CONTENT_TAB, "content_tab");
    assert.ok(ACTION_SCHEMAS.summarize);
    assert.ok(ACTION_SCHEMAS["run-github-autopost-now"]);
  });
});
