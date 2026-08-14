/**
 * Tests for ACTION_SCHEMAS message router validation (lib/message-schema.js).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const schema = require(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "message-schema.js"),
);

const {
  SENDER,
  ACTION_SCHEMAS,
  classifySender,
  isAllowedPendingSender,
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

const redditContentSender = {
  id: EXT_ID,
  tab: { id: 43, url: "https://www.reddit.com/submit" },
  url: "https://www.reddit.com/submit",
};

const untrustedContentSender = {
  id: EXT_ID,
  tab: { id: 44, url: "https://example.com/" },
  url: "https://example.com/",
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

describe("isAllowedPendingSender", () => {
  it("binds pending Facebook and Reddit handoffs to their destination sites", () => {
    assert.equal(isAllowedPendingSender("facebook", contentTabSender), true);
    assert.equal(isAllowedPendingSender("reddit", redditContentSender), true);
    assert.equal(isAllowedPendingSender("facebook", redditContentSender), false);
    assert.equal(isAllowedPendingSender("reddit", contentTabSender), false);
    assert.equal(isAllowedPendingSender("facebook", untrustedContentSender), false);
    assert.equal(isAllowedPendingSender("facebook", extensionPageSender), false);
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

  it("accepts ping / test-connection / get-key-status with no payload", () => {
    for (const action of ["ping", "test-connection", "get-key-status", "backupSettings"]) {
      const r = validate({ action }, extensionPageSender);
      assert.equal(r.ok, true, `expected ${action} ok`);
    }
  });

  it("rejects key/settings actions from a content tab", () => {
    for (const action of ["test-connection", "get-key-status", "backupSettings", "restoreSettings"]) {
      const r = validate({ action }, contentTabSender);
      assert.equal(r.ok, false, `expected ${action} blocked from content tab`);
    }
  });

  it("rejects removed Shopee unshorten action", () => {
    const request = { action: "unshorten-shopee-inline", url: "https://shope.ee/abc" };
    assert.equal(validate(request, contentTabSender).ok, false);
    assert.equal(ACTION_SCHEMAS["unshorten-shopee-inline"], undefined);
  });

  it("accepts relay-translate only from the requesting content tab", () => {
    const request = { action: "relay-translate", text: "archive", mode: "word" };
    assert.equal(validate(request, contentTabSender).ok, true);
    assert.equal(validate(request, extensionPageSender).ok, false);
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

  it("accepts shorten-url and explicit translate-text requests", () => {
    assert.equal(
      validate({ action: "shorten-url", url: "https://example.com/long" }, contentTabSender).ok,
      true,
    );
    assert.equal(
      validate({ action: "translate-text", text: "archive", mode: "word" }, contentTabSender).ok,
      true,
    );
    assert.equal(
      validate({ action: "translate-text", text: "  " }, contentTabSender).ok,
      false,
    );
    assert.equal(
      validate({ action: "translate-word", word: "hello" }, contentTabSender).ok,
      false,
    );
  });

  it("accepts pending-post bridges only from their intended sender class", () => {
    const pending = { action: "get-pending-post", kind: "facebook", id: "abc123" };
    assert.equal(validate(pending, contentTabSender).ok, true);
    assert.equal(validate(pending, extensionPageSender).ok, false);
    assert.equal(
      validate({ action: "complete-pending-post", kind: "reddit", id: "abc123" }, redditContentSender).ok,
      true,
    );
    assert.equal(
      validate({ action: "store-pending-post", kind: "reddit", postData: {} }, redditContentSender).ok,
      true,
    );
    assert.equal(
      validate({ action: "store-pending-post", kind: "reddit", postData: {} }, extensionPageSender).ok,
      false,
    );
  });

  it("validateMessage rejects when schemas map is empty for action", () => {
    const r = validateMessage("ping", { action: "ping" }, extensionPageSender, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, "Unknown action");
  });

  it("is bundled into the service worker source list", () => {
    const swBuild = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "build-sw.py"),
      "utf8",
    );
    assert.match(swBuild, /lib\/message-schema\.js/);
  });

  it("exports SENDER constants used by schemas", () => {
    assert.equal(SENDER.ANY_EXTENSION, "extension");
    assert.equal(SENDER.EXTENSION_PAGE, "extension_page");
    assert.equal(SENDER.CONTENT_TAB, "content_tab");
    assert.ok(ACTION_SCHEMAS.summarize);
    assert.equal(ACTION_SCHEMAS["run-github-autopost-now"], undefined);
    assert.equal(ACTION_SCHEMAS["github-autopost-done"], undefined);
  });
});
