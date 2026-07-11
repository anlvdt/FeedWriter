/**
 * Tests for output guardrails, Labs risk gate, and platform helpers.
 * Pure logic from lib/pure-logic.js (mirrors background.js / planned Labs gate).
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

const {
  computeNgramOverlap,
  detectRepetition,
  labsGateAllows,
  isMacPlatform,
  LABS_CONFIRM_PHRASE,
} = pure;

describe("computeNgramOverlap", () => {
  it("returns high overlap when output is largely copy-paste from source", () => {
    const source =
      "Apple vừa ra mắt iPhone mới với chip A18 và camera 48MP. " +
      "Thiết kế titan nhẹ hơn thế hệ trước và pin dùng cả ngày dài. " +
      "Giá khởi điểm từ 999 đô la Mỹ tại thị trường Mỹ.";
    const output =
      "Apple vừa ra mắt iPhone mới với chip A18 và camera 48MP. " +
      "Thiết kế titan nhẹ hơn thế hệ trước và pin dùng cả ngày dài. " +
      "Giá khởi điểm từ 999 đô la Mỹ tại thị trường Mỹ.";
    const overlap = computeNgramOverlap(source, output, 4);
    assert.ok(overlap > 0.6, `expected high overlap, got ${overlap}`);
  });

  it("returns low overlap when output is original rewrite", () => {
    const source =
      "Apple vừa ra mắt iPhone mới với chip A18 và camera 48MP. " +
      "Thiết kế titan nhẹ hơn thế hệ trước và pin dùng cả ngày dài. " +
      "Giá khởi điểm từ 999 đô la Mỹ tại thị trường Mỹ.";
    const output =
      "Dòng máy flagship mới của Apple mang sức mạnh xử lý vượt trội, " +
      "cảm biến ảnh rõ nét hơn và khung vỏ kim loại cứng cáp. " +
      "Người dùng có thể dùng thoải mái cả ngày mà không lo hết pin.";
    const overlap = computeNgramOverlap(source, output, 4);
    assert.ok(overlap < 0.3, `expected low overlap, got ${overlap}`);
  });

  it("returns 0 for empty inputs", () => {
    assert.equal(computeNgramOverlap("", "hello world again more"), 0);
    assert.equal(computeNgramOverlap("hello world again more", ""), 0);
    assert.equal(computeNgramOverlap(null, "x"), 0);
  });
});

describe("detectRepetition", () => {
  it("finds duplicate sentences", () => {
    const text =
      "Công nghệ AI đang thay đổi cách chúng ta làm việc mỗi ngày. " +
      "Nhiều doanh nghiệp đã áp dụng chatbot để hỗ trợ khách hàng. " +
      "Công nghệ AI đang thay đổi cách chúng ta làm việc mỗi ngày. " +
      "Các mô hình ngôn ngữ lớn giúp soạn thảo nội dung nhanh hơn.";
    const rate = detectRepetition(text);
    assert.ok(rate > 0, `expected positive repetition rate, got ${rate}`);
    assert.ok(rate >= 0.2, `expected at least ~0.25, got ${rate}`);
  });

  it("returns 0 when all sentences are unique", () => {
    const text =
      "Câu thứ nhất nói về sản phẩm mới ra mắt. " +
      "Câu thứ hai giải thích lợi ích chính cho người dùng. " +
      "Câu thứ ba kết thúc bằng lời khuyên mua sắm hợp lý.";
    assert.equal(detectRepetition(text), 0);
  });

  it("returns 0 for short or single-sentence text", () => {
    assert.equal(detectRepetition("Ngắn quá."), 0);
    assert.equal(detectRepetition(""), 0);
    assert.equal(
      detectRepetition("Chỉ có một câu dài hơn mười ký tự trong đoạn này."),
      0,
    );
  });
});

describe("labsGateAllows", () => {
  it("requires labsAutomationEnabled and confirm phrase TOI HIEU RUI RO", () => {
    assert.equal(labsGateAllows({ labsAutomationEnabled: true }, LABS_CONFIRM_PHRASE), true);
    assert.equal(
      labsGateAllows(
        { labsAutomationEnabled: true, labsConfirmText: LABS_CONFIRM_PHRASE },
      ),
      true,
    );
  });

  it("denies when Labs is off even with correct phrase", () => {
    assert.equal(
      labsGateAllows({ labsAutomationEnabled: false }, LABS_CONFIRM_PHRASE),
      false,
    );
    assert.equal(labsGateAllows({}, LABS_CONFIRM_PHRASE), false);
    assert.equal(labsGateAllows(null, LABS_CONFIRM_PHRASE), false);
  });

  it("denies wrong or missing confirm phrase", () => {
    assert.equal(
      labsGateAllows({ labsAutomationEnabled: true }, "toi hieu rui ro"),
      false,
    );
    assert.equal(
      labsGateAllows({ labsAutomationEnabled: true }, "I understand"),
      false,
    );
    assert.equal(labsGateAllows({ labsAutomationEnabled: true }, ""), false);
    assert.equal(labsGateAllows({ labsAutomationEnabled: true }), false);
  });
});

describe("isMacPlatform", () => {
  it("detects Mac / iOS user agents", () => {
    assert.equal(
      isMacPlatform(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      ),
      true,
    );
    assert.equal(
      isMacPlatform(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      ),
      true,
    );
  });

  it("returns false for Windows / Linux / empty", () => {
    assert.equal(
      isMacPlatform(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      ),
      false,
    );
    assert.equal(
      isMacPlatform("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"),
      false,
    );
    assert.equal(isMacPlatform(""), false);
    assert.equal(isMacPlatform(null), false);
  });
});
