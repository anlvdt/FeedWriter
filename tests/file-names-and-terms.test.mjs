// "DESIGN. MD", "DESIGN .md", "DESIGN.MD" and "generic" → "chung".
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const background = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const context = vm.createContext({ FeedWriterSummaryPolicy: require("../lib/summary-policy.js") });
vm.runInContext(readFileSync(new URL("../utils.js", import.meta.url), "utf8"), context);
vm.runInContext(background.slice(background.indexOf("function computeNgramOverlap("), background.indexOf("async function handleStream(")), context);
const post = (output, source) => {
  context.output = output;
  context.source = source;
  return vm.runInContext('postProcessOutput(output, source, "summary")', context);
};

const source = "Google's open DESIGN.md spec stops Claude Code and Codex from shipping generic AI UI. Add \"Read DESIGN.md before any UI work.\" to AGENTS.md so every screen shares colors, spacing and layout.";
const draft =
  "DESIGN.MD ngăn Claude Code và Codex tạo UI AI chung\n\n" +
  "Thiết kế mở DESIGN. MD của Google cho phép Claude Code và Codex đọc file UI khi thêm dòng \"Read DESIGN .md before any UI work.\" vào AGENTS.md, giúp đồng nhất màu sắc, khoảng cách và bố cục trên mọi màn hình.";

describe("file names", () => {
  const { text } = post(draft, source);

  it("joins split names and keeps the source spelling, headline included", () => {
    assert.match(text, /^DESIGN\.md NGĂN CLAUDE CODE VÀ CODEX TẠO UI AI CHUNG CHUNG\n/);
    assert.match(text, /Thiết kế mở DESIGN\.md của Google/);
    assert.match(text, /"Read DESIGN\.md before any UI work\."/);
    assert.match(text, /vào AGENTS\.md,/);
    assert.doesNotMatch(text, /DESIGN\.\s+MD|DESIGN\s+\.md|DESIGN\.MD/);
  });

  it("repairs split names in the source before the model sees them", () => {
    const clean = vm.runInContext('joinSplitFileNames("Thêm dòng vào AGENTS .md và DESIGN. MD; README . md")', context);
    assert.equal(clean, "Thêm dòng vào AGENTS.md và DESIGN.md; README.md");
  });

  it("does not join an ordinary sentence break", () => {
    const text2 = vm.runInContext('joinSplitFileNames("Dữ liệu ở dạng bảng. Md là viết tắt.")', context);
    assert.equal(text2, "Dữ liệu ở dạng bảng. Md là viết tắt.");
  });

  it("keeps file names, URLs and code in their case when the headline is uppercased", () => {
    assert.equal(
      vm.runInContext('uppercaseKeepingUnits("thêm package.json và `npx init` tại https://x.dev/a, pin 5000 mAh")', context),
      "THÊM package.json VÀ `npx init` TẠI https://x.dev/a, PIN 5000 mAh",
    );
  });
});

describe("generic is 'chung chung', not 'chung'", () => {
  it("fixes the wrong phrasing in headline and body", () => {
    const { text, issues } = post("Codex tránh tạo giao diện chung nhờ DESIGN.md\n\nNếu thiếu file, câu trả lời AI chung sẽ lặp lại.", source);
    assert.match(text, /GIAO DIỆN CHUNG CHUNG/);
    assert.match(text, /câu trả lời AI chung chung sẽ/);
    assert.ok(!issues.some((i) => i.includes("Dịch sai nghĩa")));
  });

  it("flags a draft with no right rendering so the revision pass runs", () => {
    const { issues } = post("DESIGN.md giúp đồng nhất giao diện\n\nCác màn hình dùng chung một bảng màu.", source);
    assert.ok(issues.some((i) => i.includes("[!] Dịch sai nghĩa")));
  });

  it("leaves 'chung' alone when the source never says generic", () => {
    const { text, issues } = post("Ứng dụng có giao diện chung cho mọi màn hình\n\nGiao diện chung giúp đồng bộ.", "One shared UI for every screen.");
    assert.match(text, /Giao diện chung giúp/);
    assert.ok(!issues.some((i) => i.includes("Dịch sai nghĩa")));
  });
});
