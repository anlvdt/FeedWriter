import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const background = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const formatterCode = readFileSync(new URL("../status-formatter.js", import.meta.url), "utf8");
const ctx = vm.createContext({});
const start = background.indexOf("const TRANSLATION_MARK");
const end = background.indexOf("// Main post-processing function", start);
assert.ok(start >= 0 && end > start);
vm.runInContext(background.slice(start, end), ctx);

const tweet = [
  "ollama @ollama · 2h",
  "Ollama now supports Jev-like decision models all locally.",
  "",
  "ollama pull nimble",
  "",
  "Here's Nimble playing Ollama racer through the new local /v1/systemone API in real-time.",
].join("\n");

describe("translation mode helpers", () => {
  it("strips scraped author/time header lines only", () => {
    const out = ctx.stripSocialMetadataLines(tweet);
    assert.ok(out.startsWith("Ollama now supports"));
    assert.equal(ctx.stripSocialMetadataLines("Plain body line that is long enough to keep as is."),
      "Plain body line that is long enough to keep as is.");
  });

  it("rejects a translation that loses the endpoint or a paragraph", () => {
    const src = ctx.stripSocialMetadataLines(tweet);
    const cut = "Ollama hỗ trợ Jev-like.\n\nollama pull nimble\n\nNimble đang chơi Ollama race...";
    const bad = ctx.checkTranslationCompleteness(src, cut);
    assert.equal(bad.ok, false);
    assert.ok(bad.missing.includes("/v1/systemone"));
    const good = "Ollama hỗ trợ Jev-like.\n\nollama pull nimble\n\nĐây là Nimble chơi Ollama racer qua API cục bộ /v1/systemone theo thời gian thực.";
    assert.equal(ctx.checkTranslationCompleteness(src, good).ok, true);
  });

  it("formatter keeps translated text as-is without uppercasing line 1", () => {
    const sandbox = { window: { enableUnicodeBold: true }, console, String, parseInt, Math };
    vm.createContext(sandbox);
    vm.runInContext(formatterCode + "\nthis.SF = StatusFormatter;", sandbox);
    const text = "\u2063Ollama hỗ trợ mô hình Jev-like chạy local.\n\nollama pull nimble";
    const out = sandbox.SF.format(text, "facebook", {});
    assert.match(out, /^Ollama hỗ trợ mô hình Jev-like chạy local\./);
    assert.ok(!out.includes("\u2063"));
  });

  it("rejects a translation that leaves the last sentence in English", () => {
    const src = "Cursor can now chart in chat.\n\nUse /visualize to analyze data inline. Available now in the Agents Window.";
    const bad = "Cursor giờ có thể tạo biểu đồ trong trò chuyện.\n\nDùng /visualize để phân tích dữ liệu ngay trong dòng. Available now in the Agents Window.";
    const r = ctx.checkTranslationCompleteness(src, bad);
    assert.equal(r.ok, false);
    assert.equal(r.untranslated.length, 1);
    const good = bad.replace("Available now in the Agents Window.", "Hiện đã có trong Agents Window.");
    assert.equal(ctx.checkTranslationCompleteness(src, good).ok, true);
  });
});

describe("translation output shape", () => {
  const prompts = readFileSync(new URL("../bg-prompts.js", import.meta.url), "utf8");
  const promptStart = prompts.indexOf("const TRANSLATE_SOURCE_PROMPT");
  const promptText = prompts.slice(promptStart, prompts.indexOf("`;", promptStart));

  it("asks for a title and a short summary above the translation", () => {
    assert.match(promptText, /tiêu đề/i);
    assert.match(promptText, /tóm tắt ngắn/i);
  });

  it("forbids 'Phần N' labels and keeps full URLs", () => {
    assert.match(promptText, /Phần \d/);
    assert.match(promptText, /URL đầy đủ/);
  });

  it("strips stray 'Phần N:' label lines in post-processing", () => {
    const start = background.indexOf("function stripPartLabels");
    assert.ok(start >= 0, "stripPartLabels missing");
    const code = background.slice(start, background.indexOf("\n}\n", start) + 3);
    const c = vm.createContext({});
    vm.runInContext(code, c);
    assert.equal(c.stripPartLabels("Phần 1:\n· AppFlowy\nPhần 2:\n· NocoDB"), "· AppFlowy\n· NocoDB");
    assert.equal(c.stripPartLabels("Phần 1: Giới thiệu về React"), "Phần 1: Giới thiệu về React");
  });
});

describe("source link preservation in summaries", () => {
  const prompts = readFileSync(new URL("../bg-prompts.js", import.meta.url), "utf8");
  it("defines a rule that keeps each item's URL", () => {
    const i = prompts.indexOf("const SOURCE_LINKS_INSTRUCTION");
    assert.ok(i >= 0);
    assert.match(prompts.slice(i, prompts.indexOf("`;", i)), /URL đầy đủ/);
  });

  it("counts distinct URLs in the source", () => {
    const start = background.indexOf("function countDistinctUrls");
    assert.ok(start >= 0);
    const c = vm.createContext({});
    vm.runInContext(background.slice(start, background.indexOf("\n}\n", start) + 3), c);
    const src = "A\nhttps://github.com/a/b\nB\nhttps://github.com/a/b\nC\nhttps://github.com/c/d.";
    assert.equal(c.countDistinctUrls(src), 2);
    assert.equal(c.countDistinctUrls("no links"), 0);
  });
});
