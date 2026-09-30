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
