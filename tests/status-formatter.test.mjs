/**
 * Load production status-formatter.js in a VM sandbox and assert format behavior.
 * Footer strip + title uppercase are critical for Facebook output quality.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const formatterPath = path.join(root, "status-formatter.js");

let StatusFormatter;

before(() => {
  const code = fs.readFileSync(formatterPath, "utf8");
  const sandbox = {
    window: { enableUnicodeBold: true },
    console,
    String,
    parseInt,
    Math,
  };
  vm.createContext(sandbox);
  // const StatusFormatter is lexical; export onto globalThis for tests
  vm.runInContext(
    code + "\n;globalThis.StatusFormatter = StatusFormatter;\n",
    sandbox,
    { filename: "status-formatter.js" },
  );
  StatusFormatter = sandbox.StatusFormatter || sandbox.globalThis?.StatusFormatter;
  // Node vm: globalThis may be the context itself
  if (!StatusFormatter && sandbox.globalThis) {
    StatusFormatter = sandbox.globalThis.StatusFormatter;
  }
  // Fallback: property set via assignment in context
  if (!StatusFormatter) {
    StatusFormatter = vm.runInContext("StatusFormatter", sandbox);
  }
  assert.ok(StatusFormatter && typeof StatusFormatter.format === "function");
});

describe("StatusFormatter.format", () => {
  it("uppercases the title on Facebook profile", () => {
    const raw = "Cách tối ưu Chrome trên macOS\n\nGiữ tab gọn và tắt extension thừa.";
    const out = StatusFormatter.format(raw, "facebook", { hasRepo: false });
    // First content line after optional emoji should include uppercase title words
    assert.match(out, /CÁCH TỐI ƯU CHROME TRÊN MACOS/i);
    // Production uppercases: Vietnamese keeps case via toUpperCase
    const lines = out.split("\n").filter((l) => l.trim());
    const titleLine = lines[0];
    assert.ok(
      titleLine.includes("CÁCH") || titleLine.includes("Cách".toUpperCase()),
      `title should be uppercased, got: ${titleLine}`,
    );
    assert.equal(titleLine, titleLine.toUpperCase() || titleLine);
    // Stronger: the original title words appear in upper form
    assert.ok(
      /CÁCH TỐI ƯU/i.test(titleLine) && titleLine === titleLine.toLocaleUpperCase("vi"),
      `expected VI uppercase title, got: ${JSON.stringify(titleLine)}`,
    );
  });

  it("strips existing footer so it is not duplicated", () => {
    const raw =
      "Bí quyết làm việc hiệu quả với AI\n\n" +
      "Dùng prompt rõ ràng và kiểm tra lại kết quả.\n\n" +
      "━━━━━━━━━━\n" +
      "👉 Chi tiết & nguồn dưới bình luận đầu tiên";
    const out = StatusFormatter.format(raw, "facebook", { hasRepo: false });
    // Exactly one footer separator from the renderer
    const sepCount = (out.match(/━━━━━━━━━━/g) || []).length;
    assert.equal(sepCount, 1, `expected single footer separator, got ${sepCount}:\n${out}`);
    // Body should not retain the stripped AI footer as content-only dupe of CTA without sep
    const withoutOfficialFooter = out.replace(
      /\n\n━━━━━━━━━━\n👉 Chi tiết & nguồn dưới bình luận đầu tiên\s*$/,
      "",
    );
    assert.ok(
      !/Chi tiết & nguồn dưới bình luận đầu tiên/.test(withoutOfficialFooter),
      "stripped footer must not remain in body",
    );
  });

  it("strips Nguồn dưới cmt footer variants", () => {
    const raw =
      "Tiêu đề demo cho formatter\n\nNội dung chính của bài viết demo.\n\n—\nNguồn dưới cmt đầu tiên";
    const out = StatusFormatter.format(raw, "facebook", { hasRepo: false });
    const body = out.replace(
      /\n\n━━━━━━━━━━\n👉 .+$/s,
      "",
    );
    assert.ok(!/Nguồn dưới cmt/i.test(body), body);
  });

  it("adds repo footer when hasRepo is true", () => {
    const raw = "Open source tool hay cho dev\n\nMột dòng mô tả ngắn.";
    const out = StatusFormatter.format(raw, "facebook", { hasRepo: true });
    assert.match(out, /Link gốc & mã nguồn dưới bình luận đầu tiên/);
  });

  it("does not append Facebook footer on threads profile", () => {
    const raw = "Short threads title here\n\nBody line.";
    const out = StatusFormatter.format(raw, "threads", {});
    assert.ok(!out.includes("━━━━━━━━━━"), out);
    assert.ok(!/bình luận đầu tiên/i.test(out), out);
  });

  it("keeps glossary items instead of treating every line as a footer", () => {
    const raw =
      "Thuật ngữ AI cần biết\n\nNội dung chính.\n\n" +
      "Giải thích thuật ngữ:\n· RAG: Truy xuất dữ liệu trước khi sinh câu trả lời";
    const out = StatusFormatter.format(raw, "facebook", { hasRepo: false });
    assert.match(out, /GIẢI THÍCH THUẬT NGỮ/i);
    assert.match(out, /Truy xuất dữ liệu trước khi sinh câu trả lời/);
  });

  it("merges glossary definitions wrapped onto a colon-only line", () => {
    const raw =
      "Refactor là gì?\n\nNội dung chính.\n\n" +
      "Giải thích thuật ngữ:\n· Refactor\n: Quá trình tái cấu trúc code để cải thiện chất lượng và hiệu suất.";
    const out = StatusFormatter.format(raw, "facebook", { hasRepo: false });
    assert.match(out, /Quá trình tái cấu trúc code/);
    assert.doesNotMatch(out, /· : Quá trình/);
  });

  it("removes empty bullets and merges a bulleted definition into its term", () => {
    const raw =
      "AI hoạt động ra sao?\n\nNội dung chính.\n\n" +
      "Giải thích thuật ngữ:\n·\n· Mô hình AI\n· Là một chương trình máy tính được thiết kế để thực hiện các nhiệm vụ thông minh như con người.";
    const out = StatusFormatter.format(raw, "facebook", { hasRepo: false });
    const glossaryLines = out.split("\n").filter((line) => line.startsWith("·"));

    assert.equal(glossaryLines.length, 1, out);
    assert.match(glossaryLines[0], /^· Mô hình /);
    assert.match(glossaryLines[0], /: Là một chương trình/);

    const html = StatusFormatter.toDisplayHTML(raw);
    assert.match(html, /<strong>Mô hình AI<\/strong>/);
    assert.match(html, /class="fbs-glossary-def">Là một chương trình/);
    assert.equal((html.match(/class="fbs-glossary-item"/g) || []).length, 1);
  });

  it("uses the same normalized glossary structure on every platform", () => {
    const raw =
      "AI hoạt động ra sao?\n\nNội dung chính.\n\n" +
      "Giải thích thuật ngữ:\n·\n· Mô hình AI\n· Là một chương trình máy tính.";

    for (const platform of ["facebook", "threads", "x", "linkedin", "reddit"]) {
      const out = StatusFormatter.format(raw, platform, { hasRepo: false });
      const definitionLine = out.split("\n").find((line) => line.includes("Là một chương trình"));

      assert.ok(definitionLine, `${platform}: missing glossary definition\n${out}`);
      assert.match(definitionLine, /Mô hình/);
      assert.ok(
        !out.split("\n").some((line) => /^[·-]\s*$/.test(line)),
        `${platform}: retained an empty glossary bullet\n${out}`,
      );
    }
  });

  it("renders long glossary terms above definitions without a leading colon", () => {
    const html = StatusFormatter.toDisplayHTML(
      "Giải thích thuật ngữ:\n· Mô hình trí tuệ nhân tạo mã nguồn mở: Là loại mô hình cho phép người dùng xem và chỉnh sửa mã nguồn.",
    );
    assert.match(
      html,
      /<strong>Mô hình trí tuệ nhân tạo mã nguồn mở<\/strong>/,
    );
    assert.match(html, /class="fbs-glossary-def">Là loại mô hình/);
    assert.doesNotMatch(html, /class="fbs-glossary-def">:\s/);
    assert.match(html, /class="fbs-glossary-bullet"/);
  });
});
