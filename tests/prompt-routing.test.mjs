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
  it("counts Vietnamese at ~3 chars per token and English at ~4", () => {
    assert.equal(run('estimateTokens("a".repeat(400))'), 100);
    const vi = "Bản cập nhật sửa lỗi pin và cải thiện hiệu năng. ".repeat(10);
    assert.equal(run("estimateTokens(vi)", { vi }), Math.ceil(vi.length / 3));
  });
});

describe("compact prompt", () => {
  const compact = run("COMPACT_NEWS_PROMPT");

  it("stays small and keeps the core rules", () => {
    assert.ok(compact.length < 3000, String(compact.length));
    assert.match(compact, /GIỮ người phát biểu/);
    assert.match(compact, /cộng đồng/);
    assert.match(compact, /Nguồn ít ý thì bài ngắn/);
    assert.doesNotMatch(compact, /không "cho biết"/);
  });

  it("a short post fits Groq with the compact prompt", () => {
    const post = "OpenAI vừa mở API giọng nói cho mọi nhà phát triển, giá 0,06 USD mỗi phút. ".repeat(8);
    assert.equal(run("requestFits(COMPACT_NEWS_PROMPT, post, 1280)", { post }), true);
  });
});

describe("handleStream routing", () => {
  it("sends the compact prompt only to Groq and costs Groq by it", () => {
    assert.match(background, /keyInfo\.provider === "groq" \? groqPrompt : activePrompt/);
    assert.match(background, /const groqPrompt = groqSizedPrompt\(activePrompt, shrinkBase, localMax\);\s*const estimatedCost =\s*estimateTokens\(groqPrompt\)/);
  });

  it("splits a source only when it is long, judged against the compact prompt", () => {
    assert.match(background, /if \(!requestFits\(compactSystemPrompt, completeSource, maxTokens\)\)/);
    assert.doesNotMatch(background, /if \(!requestFits\(systemPrompt, completeSource, maxTokens\)\)/);
  });

  it("keeps per-request rules and appended instructions when compacting", () => {
    assert.match(background, /const compactSystemPrompt = compactNewsPrompt\(systemPrompt\.slice\(0, systemPrompt\.length - promptExtras\.length\)\) \+ promptExtras;/);
    assert.match(background, /return compactSystemPrompt \+ prompt\.slice\(systemPrompt\.length\);/);
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
