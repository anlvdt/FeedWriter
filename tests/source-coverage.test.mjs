import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const background = readFileSync(path.join(root, "background.js"), "utf8");
const prompts = readFileSync(path.join(root, "bg-prompts.js"), "utf8");
const api = readFileSync(path.join(root, "bg-api.js"), "utf8");
const content = readFileSync(path.join(root, "content.js"), "utf8");
const popup = readFileSync(path.join(root, "popup.html"), "utf8");

describe("complete-source news rewrite", () => {
  it("does not silently truncate long source input or output", () => {
    assert.doesNotMatch(background, /cleanedText\.substring\(0,\s*MAX_INPUT_CHARS\)/);
    assert.doesNotMatch(background, /bài viết đã được cắt ngắn/);
    assert.doesNotMatch(background, /const maxLen = 2000/);
    assert.match(background, /const completeSource = cleanedText/);
    assert.match(background, /const coverageTokens = Math\.ceil\(completeSource\.length \/ 10\)/);
    assert.match(api, /const MAX_OUTPUT_TOKENS = 8192/);
  });

  it("extends token and timeout budgets for long posts", () => {
    assert.match(background, /Math\.max\(baseMaxTokens, coverageTokens\)/);
    assert.match(background, /Math\.max\(60000, maxTokens \* 40\)/);
    assert.match(content, /90000 \+ Math\.ceil\(text\.length \/ 10000\) \* 30000/);
  });

  it("keeps every valuable idea while enforcing news style", () => {
    assert.match(prompts, /Không được bỏ ý chỉ để ép độ dài/);
    assert.match(prompts, /không đặt tỷ lệ rút gọn cố định/);
    assert.doesNotMatch(prompts, /Viết như tường thuật\/đưa tin/i);
    assert.doesNotMatch(prompts, /5-7 bullet max/i);
    assert.doesNotMatch(prompts, /Giảm 50-70% nội dung/i);
    assert.match(background, /Output có xu hướng kể lại theo trình tự/);
    assert.match(background, /Output quá ngắn so với nguồn dài/);
  });

  it("describes length presets as coverage-preserving", () => {
    assert.match(popup, /Cô đọng · vẫn đủ ý/);
    assert.match(popup, /Đầy đủ · cân bằng/);
    assert.match(popup, /Bản tin có cấu trúc/);
    assert.doesNotMatch(popup, /Ngắn · 1–2 câu|Vừa · 3–5 câu|Giữ cấu trúc gốc/);
  });
});
