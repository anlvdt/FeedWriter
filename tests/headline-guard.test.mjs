import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const background = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const context = vm.createContext({});
const start = background.indexOf("function computeNgramOverlap(");
const end = background.indexOf("async function handleStream(", start);
assert.ok(start >= 0 && end > start);
vm.runInContext(background.slice(start, end), context);

function process(output) {
  context.output = output;
  return vm.runInContext('postProcessOutput(output, "", "summary")', context);
}

describe("summary headline deterministic guard", () => {
  for (const [input, expected] of [
    [
      "USER đề xuất cài plugin Product Designs cho Codex\n\nNội dung bài viết.",
      "PLUGIN PRODUCT DESIGNS ĐƯỢC ĐỀ XUẤT CHO CODEX",
    ],
    [
      "Người dùng: phát hiện tính năng mới trên Codex\n\nNội dung bài viết.",
      "PHÁT HIỆN TÍNH NĂNG MỚI TRÊN CODEX",
    ],
    [
      "Tác giả - giới thiệu công cụ mới\n\nNội dung bài viết.",
      "GIỚI THIỆU CÔNG CỤ MỚI",
    ],
    [
      "Người đăng cho biết bản cập nhật đã phát hành\n\nNội dung bài viết.",
      "CHO BIẾT BẢN CẬP NHẬT ĐÃ PHÁT HÀNH",
    ],
    [
      "Một người dùng chia sẻ plugin mới\n\nNội dung bài viết.",
      "CHIA SẺ PLUGIN MỚI",
    ],
  ]) {
    it(`removes forbidden headline lead: ${input.split("\\n")[0]}`, () => {
      const result = process(input);
      assert.equal(result.text.split("\n")[0], expected);
      assert.match(result.issues.join("\n"), /chủ thể (?:nguồn )?chung chung/);
    });
  }

  it("rewrites a generic recommendation actor even when it appears mid-headline", () => {
    const result = process(
      "GPT-6 tăng mức thẩm mỹ người dùng đề xuất cài plugin Product Designs cho Codex\n\nNội dung bài viết.",
    );
    assert.equal(
      result.text.split("\n")[0],
      "GPT-6 CẢI THIỆN KHẢ NĂNG THẨM MỸ VÀ PLUGIN PRODUCT DESIGNS ĐƯỢC ĐỀ XUẤT CHO CODEX",
    );
    assert.doesNotMatch(result.text.split("\n")[0], /NGƯỜI DÙNG|TÁC GIẢ|NGƯỜI ĐĂNG|\bUSER\b/);
    assert.doesNotMatch(result.text.split("\n")[0], /TĂNG MỨC THẨM MỸ/);
    assert.match(result.issues.join("\n"), /cấu trúc tin tức/);
  });

  it("keeps a valid headline and the existing all-caps design", () => {
    const result = process(
      "Codex bổ sung plugin Product Designs\n\nNội dung bài viết.",
    );
    assert.equal(
      result.text.split("\n")[0],
      "CODEX BỔ SUNG PLUGIN PRODUCT DESIGNS",
    );
    assert.doesNotMatch(result.issues.join("\n"), /chủ thể chung chung/);
  });

  it("never leaves a forbidden prefix when the generated headline is only that prefix", () => {
    const result = process("USER\n\nNội dung bài viết đủ dài để xử lý.");
    assert.equal(result.text.split("\n")[0], "CẬP NHẬT");
  });
});
