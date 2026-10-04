// The full prompt is close to Groq's free-tier minute budget. Only Groq
// requests get the compact prompt; short posts are never split into parts.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const background = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const context = vm.createContext({});
vm.runInContext(
  "const TPM_SAFE_TOKENS = 7000;\n" +
    background.slice(background.indexOf("const COMPACT_NEWS_PROMPT"), background.indexOf("function splitSourceIntoChunks(")),
  context,
);
const run = (code, vars = {}) => { Object.assign(context, vars); return vm.runInContext(code, context); };

describe("token estimate", () => {
  it("counts ~4 characters per token, as the 2026-09-28 build did", () => {
    assert.equal(run('estimateTokens("a".repeat(400))'), 100);
    const vi = "Bản cập nhật sửa lỗi pin và cải thiện hiệu năng. ".repeat(10);
    assert.equal(run("estimateTokens(vi)", { vi }), Math.ceil(vi.length / 4));
  });
});

describe("compact prompt", () => {
  const compact = run("COMPACT_NEWS_PROMPT");

  it("is the short 2026-09-28 prompt, used only when the full one does not fit", () => {
    assert.ok(compact.length < 2000, String(compact.length));
    assert.match(compact, /fact-first theo kim tự tháp ngược/);
  });
});

describe("handleStream routing (2026-09-28 behaviour)", () => {
  it("sends the same prompt to every provider", () => {
    assert.doesNotMatch(background, /groqSizedPrompt|compactSystemPrompt/);
    assert.match(background, /const result = await callFn\(\s*keyInfo\.key,\s*sourceMessage,\s*activePrompt,/);
  });

  it("splits a source only when the full prompt plus the source does not fit", () => {
    assert.match(background, /if \(!requestFits\(systemPrompt, completeSource, maxTokens\)\)/);
    assert.match(background, /synthesisBase = compactNewsPrompt\(systemPrompt\);/);
  });

  it("has no length budget", () => {
    assert.doesNotMatch(background, /buildLengthBudgetInstruction\(/);
  });
});

describe("Gemini response parsing", () => {
  const api = readFileSync(new URL("../bg-api.js", import.meta.url), "utf8");
  const ctx = vm.createContext({});
  vm.runInContext(api.slice(api.indexOf("function geminiText("), api.indexOf("/** gpt-oss and Qwen3")), ctx);

  it("joins every text part and skips thoughts", () => {
    ctx.d = { candidates: [{ content: { parts: [{ text: "suy nghĩ", thought: true }, { text: "Tiêu đề\n\n" }, { text: "Thân bài." }] } }] };
    assert.equal(vm.runInContext("geminiText(d)", ctx), "Tiêu đề\n\nThân bài.");
    assert.equal(vm.runInContext("geminiText({})", ctx), "");
  });
});
