import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const policy = require(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "lib",
    "summary-policy.js",
  ),
);

describe("summary eligibility policy", () => {
  it("does not summarize a short single tweet", () => {
    const result = policy.decideSummary({
      site: "x",
      text: "Apple vừa phát hành bản cập nhật sửa lỗi pin cho iPhone.",
    });
    assert.equal(result.shouldSummarize, false);
    assert.equal(result.reason, "short_x_post");
  });

  it("summarizes a dense Facebook post", () => {
    const text = Array.from(
      { length: 5 },
      (_, i) => `Đây là ý thông tin thứ ${i + 1} với dữ liệu đủ rõ ràng để người đọc theo dõi.`,
    ).join(" ");
    const result = policy.decideSummary({ site: "facebook", text });
    assert.equal(result.shouldSummarize, true);
  });

  it("honors the configured minimum across entry points", () => {
    const text = "Ý một đủ rõ. Ý hai đủ rõ. Ý ba đủ rõ. Ý bốn đủ rõ.";
    const result = policy.decideSummary({
      site: "facebook",
      text,
      minimumChars: 400,
    });
    assert.equal(result.shouldSummarize, false);
  });

  it("summarizes a collected X thread", () => {
    const result = policy.decideSummary({
      site: "x",
      text: "Một thread ngắn.",
      threadCount: 4,
    });
    assert.equal(result.shouldSummarize, true);
    assert.equal(result.reason, "thread");
  });
});

describe("glossary policy", () => {
  it("omits glossary for ordinary product news", () => {
    const result = policy.decideGlossary({
      site: "facebook",
      text: "iPhone có thêm màu mới, camera sáng hơn và pin dùng lâu hơn.",
    });
    assert.equal(result.mode, "omit");
    assert.deepEqual(result.candidates, []);
  });

  it("allows only unfamiliar source terms and limits X to one", () => {
    const result = policy.decideGlossary({
      site: "x",
      text: "RAG kết hợp LLM với context window dài và fine-tuning theo dữ liệu riêng.",
    });
    assert.equal(result.mode, "include");
    assert.equal(result.limit, 1);
    assert.equal(result.candidates.length, 1);
  });

  it("removes an unsolicited glossary when policy says omit", () => {
    const output =
      "APPLE CẬP NHẬT IPHONE\n\nBản mới cải thiện pin.\n\n" +
      "Giải thích thuật ngữ:\n· iPhone: Điện thoại của Apple.";
    const clean = policy.sanitizeGlossaryOutput(output, {
      mode: "omit",
      candidates: [],
      limit: 0,
    });
    assert.equal(clean, "APPLE CẬP NHẬT IPHONE\n\nBản mới cải thiện pin.");
  });

  it("drops hallucinated terms and keeps allowed source terms", () => {
    const decision = policy.decideGlossary({
      site: "facebook",
      text: "RAG giúp hệ thống truy xuất tài liệu trước khi trả lời.",
    });
    const output =
      "RAG GIÚP TRUY XUẤT TÀI LIỆU\n\nNội dung chính.\n\n" +
      "Giải thích thuật ngữ:\n" +
      "· RAG: Kỹ thuật bổ sung dữ liệu liên quan trước khi tạo câu trả lời.\n" +
      "· Blockchain: Cơ sở dữ liệu phân tán.";
    const clean = policy.sanitizeGlossaryOutput(output, decision);
    assert.match(clean, /· RAG:/);
    assert.doesNotMatch(clean, /Blockchain/);
  });

  it("never adds glossary to comment summaries", () => {
    const result = policy.decideGlossary({
      site: "facebook",
      type: "comment_summary",
      text: "Nhiều bình luận tranh luận về RAG và LLM.",
    });
    assert.equal(result.mode, "omit");
  });
});
