import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const { isFacebookCommentActivityText } = require(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "pure-logic.js"),
);

describe("Facebook comment activity chrome", () => {
  it("recognizes the Vietnamese recently-commented feed label", () => {
    assert.equal(isFacebookCommentActivityText("Nope Pham đã bình luận gần đây."), true);
    assert.equal(isFacebookCommentActivityText("Trần Hồng Quân đã bình luận."), true);
  });

  it("recognizes English variants without rejecting a real comment", () => {
    assert.equal(isFacebookCommentActivityText("Nope Pham commented recently."), true);
    assert.equal(isFacebookCommentActivityText("Alex commented."), true);
    assert.equal(isFacebookCommentActivityText("Bình luận này phân tích rất rõ nguyên nhân của vấn đề."), false);
  });

  it("does not treat long post text that mentions comments as feed chrome", () => {
    assert.equal(
      isFacebookCommentActivityText(
        "Nope Pham đã bình luận gần đây. Đây là nội dung bài viết dài với nhiều thông tin cần tóm tắt cho người đọc.",
      ),
      false,
    );
  });
});
