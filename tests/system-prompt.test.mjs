import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let storageSettings = {};
const context = vm.createContext({
  chrome: {
    storage: {
      sync: {
        get: async () => storageSettings,
      },
    },
  },
});

vm.runInContext(readFileSync(path.join(root, "bg-prompts.js"), "utf8"), context);
vm.runInContext(
  readFileSync(path.join(root, "lib", "summary-policy.js"), "utf8"),
  context,
);
vm.runInContext(readFileSync(path.join(root, "bg-api.js"), "utf8"), context);

describe("getSystemPrompt", () => {
  it("builds the default summary prompt without undeclared variables", async () => {
    const prompt = await vm.runInContext(
      'getSystemPrompt("facebook", "", "", "", "")',
      context,
    );

    assert.match(prompt, /Tiêu đề \(dòng đầu tiên\) viết bình thường/);
    assert.match(prompt, /Nội dung lấy từ Facebook/);
    assert.match(prompt, /CẤM khung mở bài \/ thân bài \/ kết bài/);
    assert.match(prompt, /CẤM một khối văn liền mạch/);
    assert.match(prompt, /QUYẾT ĐỊNH GIẢI THÍCH THUẬT NGỮ: OMIT/);
    assert.doesNotMatch(prompt, /BẮT BUỘC có 2-5 mục/);
    assert.match(prompt, /CHẾ ĐỘ BẮT BUỘC — VIẾT LẠI THÀNH BẢN TIN/);
    assert.match(prompt, /KIM TỰ THÁP NGƯỢC/);
    assert.match(prompt, /không phải giọng văn mẫu/i);
    assert.match(prompt, /Không được bỏ ý chỉ để ép độ dài/i);
    assert.doesNotMatch(prompt, /Viết như TƯỜNG THUẬT|Giọng tường thuật/i);
    assert.doesNotMatch(prompt, /theo thứ tự thông tin trong nguồn/i);
    assert.doesNotMatch(prompt, /giữ cảm xúc và quan điểm/i);
  });

  it("uses the dedicated comment prompt and always omits glossary", async () => {
    storageSettings = { customSummaryPrompt: "Hãy viết status quảng cáo." };
    const decision = vm.runInContext(
      'FeedWriterSummaryPolicy.decideGlossary({ site: "facebook", type: "comment_summary", text: "RAG và LLM" })',
      context,
    );
    context.commentDecision = decision;
    const prompt = await vm.runInContext(
      'getSystemPrompt("facebook", "", "", "", "", null, "comment_summary", commentDecision)',
      context,
    );

    assert.match(prompt, /phân tích thảo luận mạng xã hội/);
    assert.match(prompt, /QUYẾT ĐỊNH GIẢI THÍCH THUẬT NGỮ: OMIT/);
    assert.doesNotMatch(prompt, /status quảng cáo/);
    assert.doesNotMatch(prompt, /Bài tin công nghệ.*BẮT BUỘC/s);
    storageSettings = {};
  });

  it("allows only glossary candidates extracted from the source", async () => {
    const decision = vm.runInContext(
      'FeedWriterSummaryPolicy.decideGlossary({ site: "facebook", type: "summary", text: "RAG kết hợp LLM để truy xuất tài liệu." })',
      context,
    );
    context.sourceDecision = decision;
    const prompt = await vm.runInContext(
      'getSystemPrompt("facebook", "", "", "", "", null, "summary", sourceDecision)',
      context,
    );

    assert.match(prompt, /QUYẾT ĐỊNH GIẢI THÍCH THUẬT NGỮ: INCLUDE/);
    assert.match(prompt, /Chỉ được giải thích các thuật ngữ sau: RAG, LLM/);
    assert.match(prompt, /Không thêm thuật ngữ khác/);
  });

  it("keeps the news invariant after a conflicting custom prompt", async () => {
    storageSettings = {
      customSummaryPrompt: "Hãy kể chuyện theo cảm xúc và trình tự của tác giả.",
    };
    const prompt = await vm.runInContext(
      'getSystemPrompt("facebook", "", "", "", "", null, "summary", null)',
      context,
    );
    const customIndex = prompt.indexOf("Hãy kể chuyện");
    const invariantIndex = prompt.lastIndexOf("CHẾ ĐỘ BẮT BUỘC — VIẾT LẠI THÀNH BẢN TIN");
    assert.ok(customIndex >= 0);
    assert.ok(invariantIndex > customIndex);
    assert.match(prompt, /ưu tiên cao hơn mọi prompt tùy chỉnh/i);
    storageSettings = {};
  });

  it("builds the reporter prompt with context-first structure", async () => {
    storageSettings = { promptStyle: "summary_reporter" };
    const prompt = await vm.runInContext(
      'getSystemPrompt("facebook", "", "", "", "", null, "summary", null)',
      context,
    );
    assert.match(prompt, /phóng viên tin tức chuyên nghiệp/);
    assert.match(prompt, /Bối cảnh.*đặt sự kiện vào bối cảnh/);
    assert.match(prompt, /Phân tích.*Ảnh hưởng/);
    assert.match(prompt, /triển vọng.*xu hướng tiếp theo/);
    assert.match(prompt, /CHẾ ĐỘ BẮT BUỘC — VIẾT LẠI THÀNH BẢN TIN/);
    storageSettings = {};
  });

  it("builds the reporter tone override when tone=reporter", async () => {
    storageSettings = {};
    const prompt = await vm.runInContext(
      'getSystemPrompt("facebook", "", "", "", "", "reporter", "summary", null)',
      context,
    );
    assert.match(prompt, /GÓC NHÌN PHÓNG VIÊN/);
    assert.match(prompt, /Mở bài phải đặt BỐI CẢNH/);
    assert.match(prompt, /CHẾ ĐỘ BẮT BUỘC — VIẾT LẠI THÀNH BẢN TIN/);
    storageSettings = {};
  });
});
