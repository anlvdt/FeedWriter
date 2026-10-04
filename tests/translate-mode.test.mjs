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

describe("translation headline casing", () => {
  const start = background.indexOf("function uppercaseTitleLine");
  const code = background.slice(start, background.indexOf("\n}\n", start) + 3);
  const c = vm.createContext({});
  vm.runInContext(code, c);
  it("uppercases only the first line", () => {
    assert.equal(
      c.uppercaseTitleLine("10 repo mã nguồn mở thay phần mềm đắt tiền\n\nBạn có thể đang trả phí."),
      "10 REPO MÃ NGUỒN MỞ THAY PHẦN MỀM ĐẮT TIỀN\n\nBạn có thể đang trả phí.",
    );
  });
  it("leaves list items and links alone", () => {
    assert.equal(c.uppercaseTitleLine("· AppFlowy thay Notion"), "· AppFlowy thay Notion");
    assert.equal(c.uppercaseTitleLine("http://github.com/a/b"), "http://github.com/a/b");
  });
});

describe("formatter keeps repo links out of uppercase headers", () => {
  const sandbox = { window: { enableUnicodeBold: true }, console, String, parseInt, Math };
  vm.createContext(sandbox);
  vm.runInContext(formatterCode + "\nthis.SF = StatusFormatter;", sandbox);
  const raw = [
    "10 repo thay thế phần mềm trả phí",
    "",
    "1. AppFlowy thay Notion",
    "http://github.com/AppFlowy-IO/AppFlowy",
    "2. NocoDB thay Airtable",
    "https://github.com/nocodb/nocodb",
    "3. Listmonk quản lý bản tin",
  ].join("\n");
  it("does not uppercase a short link line followed by a numbered item", () => {
    const out = sandbox.SF.format(raw, "facebook", {});
    assert.ok(out.includes("http://github.com/appflowy-io/appflowy"), out);
    assert.ok(out.includes("https://github.com/nocodb/nocodb"), out);
    assert.ok(!/HTTP:\/\/GITHUB/i.test(out.replace(/github\.com\/[^\s]*/gi, "")), out);
  });
  it("lowercases github links in translated output too", () => {
    const out = sandbox.SF.format("⁣Tiêu đề\n\nMô tả dài hơn bốn mươi ký tự để làm đoạn văn.\nhttp://github.com/Formbricks/Formbricks", "facebook", {});
    assert.ok(out.includes("http://github.com/formbricks/formbricks"), out);
  });
});

describe("untranslated headline detection", () => {
  const src = "10 GITHUB REPOS THAT CAN REPLACE EXPENSIVE SOFTWARE\n\nYou might be paying for tools that already have alternatives.\n\n1. AppFlowy\nNotion alternative.";
  const body = "Bạn có thể đang trả tiền cho công cụ đã có bản thay thế mã nguồn mở.\n\n1. AppFlowy\nThay thế Notion.";
  it("flags an English headline that starts with a digit", () => {
    const bad = ctx.checkTranslationCompleteness(src, "10 GITHUB REPOS THAT CAN REPLACE EXPENSIVE SOFTWARE\n\n" + body);
    assert.equal(bad.ok, false);
    assert.ok(bad.untranslated.length > 0);
  });
  it("accepts a Vietnamese headline", () => {
    const good = ctx.checkTranslationCompleteness(src, "10 REPO GITHUB CÓ THỂ THAY THẾ PHẦN MỀM ĐẮT TIỀN\n\n" + body);
    assert.equal(good.ok, true, JSON.stringify(good));
  });
});

describe("repo links are lowercase across the pipeline", () => {
  const utilsSrc = readFileSync(new URL("../utils.js", import.meta.url), "utf8");
  const u = vm.createContext({ module: { exports: {} } });
  vm.runInContext(utilsSrc.slice(utilsSrc.indexOf("function lowercaseRepoLinks"), utilsSrc.indexOf("function truncate")), u);
  it("lowercases github/gitlab links only", () => {
    assert.equal(
      u.lowercaseRepoLinks("Xem http://github.com/AppFlowy-IO/AppFlowy và https://GitLab.com/Foo/Bar, còn https://Example.com/Path"),
      "Xem http://github.com/appflowy-io/appflowy và https://gitlab.com/foo/bar, còn https://Example.com/Path",
    );
  });
  it("is wired into summary output, formatter, comment, composer and related URLs", () => {
    const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
    assert.match(read("background.js"), /processed = lowercaseRepoLinks\(processed\)/);
    assert.match(read("status-formatter.js"), /_lowercaseRepoLinks\(rawText\)/);
    assert.match(read("content.js"), /lowercaseRepoLinks\(out\)/);
    assert.match(read("content-composer.js"), /text = lowercaseRepoLinks\(text\)/);
    assert.match(read("content-composer.js"), /normalizeGithubField/);
    assert.match(read("content-dom.js"), /lowercaseRepoLinks\(clean\)/);
  });
});
