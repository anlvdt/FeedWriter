import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const context = vm.createContext({
  chrome: {
    storage: {
      sync: {
        get: async () => ({}),
      },
    },
  },
});

vm.runInContext(readFileSync(path.join(root, "bg-prompts.js"), "utf8"), context);
vm.runInContext(readFileSync(path.join(root, "bg-api.js"), "utf8"), context);

describe("getSystemPrompt", () => {
  it("builds the default summary prompt without undeclared variables", async () => {
    const prompt = await vm.runInContext(
      'getSystemPrompt("facebook", "", "", "", "")',
      context,
    );

    assert.match(prompt, /Tiêu đề \(dòng đầu tiên\) viết bình thường/);
    assert.match(prompt, /Bài viết từ Facebook/);
    assert.match(prompt, /CẤM khung mở bài \/ thân bài \/ kết bài/);
    assert.match(prompt, /CẤM một khối văn liền mạch/);
    assert.match(prompt, /Giải thích thuật ngữ/);
    assert.match(prompt, /BẮT BUỘC có 2-5 mục/);
  });
});
