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

  it("does not mistake capitalized ordinary words for terminology", () => {
    const result = policy.decideGlossary({
      site: "x",
      text: "A LOT OF PEOPLE WANT THIS NEW FEATURE FOR FREE.",
    });
    assert.equal(result.mode, "omit");
    assert.deepEqual(result.candidates, []);
  });

  it("keeps known, versioned, and explicitly defined acronyms", () => {
    const candidates = policy.extractGlossaryCandidates(
      "MCP kết nối model; chuẩn XYZ (Extended Yield Zone) và DDR5 cũng xuất hiện.",
    );
    assert.deepEqual(
      candidates.map((item) => item.term),
      ["MCP", "XYZ", "DDR5"],
    );
  });
  it("detects expanded modern technical terms and acronyms", () => {
    const candidates = policy.extractGlossaryCandidates(
      "Bài viết nhắc tới benchmark, jailbreak và prompt injection, hỗ trợ NVME cùng RTX 4090.",
    );
    const terms = candidates.map((item) => item.term);
    assert.ok(terms.includes("benchmark"));
    assert.ok(terms.includes("jailbreak"));
    assert.ok(terms.includes("prompt injection"));
    assert.ok(terms.includes("NVME"));
    assert.ok(terms.includes("RTX"));
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

describe("translation fallback policy", () => {
  it("translates a short foreign-language post", () => {
    const r = policy.decideTranslation({ site: "x", text: "OpenAI released a new model today." });
    assert.deepEqual([r.translate, r.reason], [true, "too_short"]);
  });

  it("translates a list-only post even when it has many items", () => {
    const text = "- Faster inference\n- Lower latency\n- Cheaper tokens\n- Better tools\n- Longer context";
    const r = policy.decideTranslation({ site: "facebook", text });
    assert.deepEqual([r.translate, r.reason], [true, "list_only"]);
  });

  it("keeps summarizing long English prose", () => {
    const text = Array.from({ length: 6 }, (_, i) => `Sentence number ${i + 1} explains a detailed product change for developers.`).join(" ");
    assert.equal(policy.decideTranslation({ site: "facebook", text }).translate, false);
  });

  it("does not translate Vietnamese sources", () => {
    const r = policy.decideTranslation({ site: "x", text: "Apple vừa phát hành bản cập nhật sửa lỗi pin." });
    assert.deepEqual([r.translate, r.reason], [false, "already_vietnamese"]);
  });
});

describe("translation fallback eligibility", () => {
  it("allows the NO_SUMMARY fallback only for short foreign-language sources", () => {
    assert.equal(policy.canFallbackToTranslation("Cursor can now chart in chat. Available now."), true);
    assert.equal(policy.canFallbackToTranslation("Apple vừa phát hành bản cập nhật sửa lỗi pin."), false);
    assert.equal(policy.canFallbackToTranslation("word ".repeat(2000)), false);
  });
});

import { createRequire as _cr } from "node:module";
describe("titled list posts are translated in place", () => {
  const policy = _cr(import.meta.url)("../lib/summary-policy.js");
  const post = [
    "10 GITHUB REPOS THAT CAN REPLACE EXPENSIVE SOFTWARE",
    "You might be paying for tools that already have open-source alternatives.",
    "Here are 10 worth checking out:",
    "1. AppFlowy", "Notion alternative.", "http://github.com/AppFlowy-IO/AppFlowy",
    "2. NocoDB", "Spreadsheet-style workspace.", "http://github.com/nocodb/nocodb",
    "3. Listmonk", "Self-hosted newsletters.", "http://github.com/knadh/listmonk",
  ].join("\n");
  it("detects headline + intro + list", () => {
    assert.equal(policy.isTitledListPost(post), true);
  });
  it("ignores plain paragraphs and bare lists", () => {
    assert.equal(policy.isTitledListPost("Just one short sentence here.\nAnother line of text that is long enough."), false);
    assert.equal(policy.isTitledListPost("1. a\n2. b\n3. c\n4. d\n5. e"), false);
  });
});
