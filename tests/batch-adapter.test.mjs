/**
 * Tests for adaptSummarizeResponse — batch summarize response shapes.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const pure = require(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "pure-logic.js"),
);

const { adaptSummarizeResponse } = pure;

describe("adaptSummarizeResponse", () => {
  it("accepts { summary } legacy shape", () => {
    const r = adaptSummarizeResponse({ summary: "Tóm tắt ngắn gọn." });
    assert.equal(r.ok, true);
    assert.equal(r.result, "Tóm tắt ngắn gọn.");
  });

  it("accepts { success, result } shape", () => {
    const r = adaptSummarizeResponse({
      success: true,
      result: "Kết quả batch",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result, "Kết quả batch");
  });

  it("returns error from { error }", () => {
    const r = adaptSummarizeResponse({ error: "Rate limit exceeded" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "Rate limit exceeded");
  });

  it("returns Unknown error for empty / null / whitespace summary", () => {
    assert.equal(adaptSummarizeResponse(null).ok, false);
    assert.equal(adaptSummarizeResponse(undefined).ok, false);
    assert.equal(adaptSummarizeResponse({}).ok, false);
    assert.equal(adaptSummarizeResponse({ summary: "" }).ok, false);
    assert.equal(adaptSummarizeResponse({ summary: "   " }).ok, false);
    assert.equal(adaptSummarizeResponse({ success: true }).ok, false);
    assert.equal(adaptSummarizeResponse({ success: true, result: "" }).ok, false);
    assert.match(
      adaptSummarizeResponse({}).error,
      /Unknown error/i,
    );
  });

  it("prefers success+result over empty summary when both present", () => {
    const r = adaptSummarizeResponse({
      success: true,
      result: "from result",
      summary: "from summary",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result, "from result");
  });
});
