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
    assert.match(out, /GIẢI THÍCH THUẬT NGỮ/);
    assert.equal((out.match(/Giải thích thuật ngữ/g) || []).length, 0, out);
    assert.match(out, /Truy xuất dữ liệu trước khi sinh câu trả lời/);
    const html = StatusFormatter.toDisplayHTML(raw, { hasRepo: false });
    assert.match(html, /GIẢI THÍCH THUẬT NGỮ/);
  });

  it("keeps glossary items after a blank line under the heading", () => {
    const raw =
      "Context window của model mới\n\n" +
      "Model nới giới hạn ngữ cảnh lên 1 triệu token.\n\n" +
      "Giải thích thuật ngữ:\n\n" +
      "· RAG: Truy xuất dữ liệu trước khi sinh câu trả lời\n" +
      "· Fine-tuning: Huấn luyện thêm model trên dữ liệu riêng";
    const out = StatusFormatter.format(raw, "facebook", { hasRepo: false });
    assert.match(out, /GIẢI THÍCH THUẬT NGỮ/);
    assert.match(out, /· RAG: Truy xuất dữ liệu trước khi sinh câu trả lời/);
    assert.match(out, /· Fine-tuning: Huấn luyện thêm model trên dữ liệu riêng/);
    const beforeGlossary = out.split(/GIẢI THÍCH THUẬT NGỮ/)[0];
    assert.ok(!/· RAG/.test(beforeGlossary), beforeGlossary);
  });

  it("does not turn a heading-only leftover term into body bullets", () => {
    const raw =
      "Công cụ review code tự động\n\n" +
      "Dùng Codex để rà pull request.\n\n" +
      "GIẢI THÍCH THUẬT NGỮ:\n\n" +
      "· **codex‑auto‑review**";
    const out = StatusFormatter.format(raw, "facebook", { hasRepo: false });
    assert.ok(!/GIẢI THÍCH THUẬT NGỮ/.test(out), out);
    assert.ok(!/codex‑auto‑review/.test(out), out);
  });

  it("drops a second all-caps article the model appended after the close", () => {
    const raw =
      "Codex cắt token rác trong hội thoại\n\n" +
      "Codex 5.6 khuyên xóa log hết hạn khỏi context.\n\n" +
      "Cách này giảm token vô ích trước mỗi lần gọi model.\n\n" +
      "OPENAI NGỪNG FRONTIER RL, KHÔNG CÒN CUNG CẤP RESET VÀ KHUYẾN NGHỊ DÙNG LUNA\n\n" +
      "OpenAI đã dừng dịch vụ Frontier RL và ngừng cung cấp tính năng reset cho người dùng.\n\n" +
      "Công ty cũng đề nghị người dùng chuyển sang sử dụng Luna thay vì Frontier RL.";
    const out = StatusFormatter.format(raw, "facebook", { hasRepo: false });
    assert.match(out, /Codex 5\.6/);
    assert.ok(!/FRONTIER RL/i.test(out), out);
    assert.ok(!/\bLuna\b/i.test(out), out);
  });

  it("drops a filler close paragraph and keeps the glossary", () => {
    const raw =
      "OpenAI ra ChatGPT cho teen\n\n" +
      "OpenAI mở gói ChatGPT dành cho người dùng vị thành niên, kèm chế độ giám sát của phụ huynh.\n\n" +
      "Việc ra mắt này cung cấp cho người dùng teen công cụ học tập chuyên biệt và các biện pháp bảo vệ mạnh mẽ, đồng thời cho phép phụ huynh giám sát, đánh dấu bước tiến quan trọng trong chiến lược AI có trách nhiệm của OpenAI đối với trẻ vị thành niên.\n\n" +
      "Giải thích thuật ngữ:\n" +
      "· Parental control: Công cụ để phụ huynh xem và giới hạn hoạt động của con.";
    const out = StatusFormatter.format(raw, "facebook", { hasRepo: false });
    assert.ok(!/bước tiến/i.test(out), out);
    assert.ok(!/chiến lược AI có trách nhiệm/i.test(out), out);
    assert.match(out, /GIẢI THÍCH THUẬT NGỮ/);
    assert.match(out, /Parental control/);
    const html = StatusFormatter.toDisplayHTML(raw, { hasRepo: false });
    assert.match(html, /GIẢI THÍCH THUẬT NGỮ/);
    assert.ok(!/bước tiến/i.test(html), html);
  });

  it("does not treat a body feature list as a glossary", () => {
    const raw =
      "Ba điểm nổi bật của bản cập nhật\n\n" +
      "Bản vá tập trung vào hiệu năng.\n\n" +
      "· Tốc độ: nhanh hơn 20%\n" +
      "· Pin: dùng được 12 giờ";
    const out = StatusFormatter.format(raw, "facebook", { hasRepo: false });
    assert.ok(!/GIẢI THÍCH THUẬT NGỮ/.test(out), out);
    assert.match(out, /· Tốc độ: nhanh hơn 20%/);
    assert.match(out, /· Pin: dùng được 12 giờ/);
  });

  it("splits a wall of text into title plus separate paragraphs", () => {
    const raw =
      "Huawei hạ giá Mate 70 Pro Max ngang Xiaomi Ultra\n\n" +
      "Huawei đổi chiến lược giá: bản Pro Max lần đầu về sát phân khúc Ultra của Xiaomi. " +
      "Mức giá mới cắt khoảng 15% so với lần ra mắt, kèm gói bảo hành 2 năm. " +
      "Hệ sinh thái HarmonyOS vẫn là rào cản với người dùng Android. " +
      "Động thái này cho thấy Huawei chấp nhận giảm biên lợi nhuận để lấy lại thị phần nội địa.";
    const out = StatusFormatter.format(raw, "facebook", { hasRepo: false });
    const body = out.replace(/\n\n━━━━━━━━━━\n👉 .+$/s, "");
    const parts = body.split(/\n\n+/);
    assert.ok(parts.length >= 3, `expected title + paragraphs, got ${parts.length}:\n${body}`);
    assert.equal(parts[0], parts[0].toLocaleUpperCase("vi"));
    assert.match(parts[1], /Huawei đổi chiến lược giá/);
    assert.match(body, /thị phần nội địa/);
    assert.ok(!/Mở bài|Thân bài|Kết bài/i.test(body), body);
  });

  it("strips printed structure labels from output", () => {
    const raw =
      "iPhone báo đầy bộ nhớ sau bản cập nhật\n\n" +
      "Mở bài: iOS dọn cache kém khiến máy báo đầy dù ảnh không tăng.\n\n" +
      "Thân bài: Người dùng phải xóa dữ liệu hệ thống thủ công để lấy lại vài GB.\n\n" +
      "Kết bài: Cần sao lưu trước khi cập nhật bản tiếp theo.";
    const out = StatusFormatter.format(raw, "facebook", { hasRepo: false });
    assert.ok(!/Mở bài|Thân bài|Kết bài/i.test(out), out);
    assert.match(out, /iOS dọn cache kém/);
    assert.match(out, /sao lưu trước khi cập nhật/);
  });

  it("does not break version numbers when splitting sentences", () => {
    const raw =
      "iOS 18.2 sửa lỗi hao pin\n\n" +
      "Bản iOS 18.2 giảm hao pin trên iPhone 15. Apple ghi nhận lỗi từ 18.1. Người dùng nên cập nhật ngay.";
    const out = StatusFormatter.format(raw, "facebook", { hasRepo: false });
    assert.match(out, /iOS 18\.2/);
    assert.ok(!/iOS 18\n/.test(out), out);
  });

  it("keeps short tutorial steps instead of merging them into an essay", () => {
    const raw =
      "Ba bước dọn cache Chrome\n\n" +
      "Làm lần lượt các bước sau.\n\n" +
      "1. Mở chrome://settings/clearBrowserData\n" +
      "2. Chọn Cached images and files\n" +
      "3. Bấm Clear data";
    const out = StatusFormatter.format(raw, "facebook", { hasRepo: false });
    assert.match(out, /1\. Mở chrome/);
    assert.match(out, /2\. Chọn Cached/);
    assert.match(out, /3\. Bấm Clear data/);
  });

  it("strips markdown asterisks and stacked bullets on Facebook", () => {
    const raw =
      "Công cụ review code tự động\n\n" +
      "Dùng **Codex** để rà PR.\n\n" +
      "· · **codex‑auto‑review**\n" +
      "· **RAG**: truy xuất dữ liệu trước khi sinh câu trả lời";
    const out = StatusFormatter.format(raw, "facebook", { hasRepo: false });
    assert.ok(!out.includes("*"), `Facebook text must not contain *: \n${out}`);
    assert.ok(!/·\s*·/.test(out), `stacked bullets must collapse:\n${out}`);
    assert.match(out, /CODEX/i);
    assert.match(out, /codex‑auto‑review/);
    assert.match(out, /RAG/);
    const bulletLines = out.split("\n").filter((l) => l.startsWith("· "));
    assert.ok(
      bulletLines.some((l) => /^· codex‑auto‑review$/.test(l.trim())),
      `expected a single-marker bullet, got:\n${bulletLines.join("\n")}`,
    );
  });

  it("renders markdown bullets as HTML without leftover asterisks", () => {
    const html = StatusFormatter.toDisplayHTML(
      "Công cụ review\n\n· · **codex-auto-review**",
      { hasRepo: false },
    );
    assert.ok(!html.includes("*"), html);
    assert.match(html, /<strong>codex-auto-review<\/strong>/);
  });

  it("renders lead and close classes in the summary popup HTML", () => {
    const raw =
      "Codex cắt 85% token rác trong hội thoại\n\n" +
      "Codex 5.6 khuyên xóa kế hoạch hủy và log hết hạn khỏi context. " +
      "Prompt dọn ngữ cảnh giữ lại setup và code thành công. " +
      "Cách này giảm token vô ích trước mỗi lần gọi model.";
    const html = StatusFormatter.toDisplayHTML(raw, { hasRepo: false });
    assert.match(html, /class="fbs-title-line"/);
    assert.match(html, /class="fbs-para"/);
    assert.equal((html.match(/fbs-para-lead|fbs-para-close/g) || []).length, 0);
    assert.ok(!/Mở bài|Thân bài|Kết bài/i.test(html), html);
  });
});
