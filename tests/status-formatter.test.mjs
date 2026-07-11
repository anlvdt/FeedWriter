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
});
