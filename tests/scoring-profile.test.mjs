/**
 * Tests for profile-aware heuristic scoring (lib/scoring-profile.js).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const { scoreText, VALID_PROFILES } = require(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "lib",
    "scoring-profile.js",
  ),
);

describe("scoreText profiles", () => {
  it("exports tech and general profiles", () => {
    assert.deepEqual(VALID_PROFILES, ["tech", "general"]);
  });

  it("tech scores higher than general for Claude Pro / GPT-4 content", () => {
    // Long enough to pass short-text gate; AI brands only (avoid extra topic boosts maxing both to 9)
    const text =
      "Claude Pro and GPT-4 are available now. " +
      "OpenAI and Anthropic keep shipping new model updates this month for writers.";
    const tech = scoreText(text, "tech");
    const general = scoreText(text, "general");
    assert.ok(tech > general, `expected tech (${tech}) > general (${general})`);
    assert.ok(tech >= 5, `tech should pass filter threshold, got ${tech}`);
  });

  it("spam hard-sell scores low on all profiles", () => {
    const spam =
      "Mua ngay flash sale shopee voucher mã giảm giá sốc! " +
      "Shopee.vn free ship liên hệ ngay số lượng có hạn inbox để nhận deal.";
    for (const profile of VALID_PROFILES) {
      const s = scoreText(spam, profile);
      assert.ok(
        s <= 4,
        `spam should be low on ${profile}, got ${s}`,
      );
    }
  });

  it("empty and short text return low score", () => {
    assert.equal(scoreText("", "tech"), 1);
    assert.equal(scoreText(null, "general"), 1);
    assert.equal(scoreText("a".repeat(20), "tech"), 1);
  });

  it("general recognises product/review signals without a dedicated profile", () => {
    const review =
      "Review chi tiết sản phẩm tai nghe này sau 2 tuần trải nghiệm. " +
      "Đánh giá ưu nhược điểm, so sánh với đối thủ, có nên mua không? " +
      "Link mua và giá bán mình để ở comment.";
    const general = scoreText(review, "general");
    const tech = scoreText(review, "tech");
    assert.ok(
      general >= tech,
      `general (${general}) should be >= tech (${tech}) for product review`,
    );
    assert.ok(general >= 4, `general review should score reasonably, got ${general}`);
  });

  it("unknown profile falls back to tech behavior", () => {
    const text =
      "Claude Anthropic ChatGPT OpenAI GPT-4 Gemini DeepSeek Llama " +
      "just announced free tier trials for developers worldwide today.";
    const asDefault = scoreText(text);
    const asTech = scoreText(text, "tech");
    const asUnknown = scoreText(text, "nope");
    assert.equal(asDefault, asTech);
    assert.equal(asUnknown, asTech);
  });
});
