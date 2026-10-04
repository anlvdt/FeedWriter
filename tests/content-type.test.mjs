import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const policy = require(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "lib",
    "summary-policy.js",
  ),
);

const decide = policy.decideContentType;
const KINDS = new Set(["news", "tutorial", "review", "opinion"]);
const CONFIDENCE = new Set(["high", "low", "none"]);

function assertDecisionShape(result) {
  assert.ok(KINDS.has(result.kind), "unknown kind " + result.kind);
  assert.ok(
    CONFIDENCE.has(result.confidence),
    "unknown confidence " + result.confidence,
  );
  for (const k of KINDS) {
    assert.equal(
      typeof result.scores[k],
      "number",
      "missing score for " + k,
    );
  }
  assert.ok(Array.isArray(result.signals));
}

describe("decideContentType — contract", () => {
  it("never throws and always returns a well-formed decision", () => {
    for (const text of [null, undefined, "", "   ", 42, {}]) {
      const result = decide(text);
      assertDecisionShape(result);
    }
  });

  it("reports none for text under the info threshold", () => {
    const result = decide("quá ngắn");
    assert.equal(result.kind, "news");
    assert.equal(result.confidence, "none");
  });
});

describe("decideContentType — tutorial", () => {
  it("detects a Vietnamese install guide with steps and commands", () => {
    const text = [
      "Hướng dẫn cài Docker trên Ubuntu 22.04 cho người mới bắt đầu.",
      "1. Cập nhật danh sách gói trước khi cài bất cứ thứ gì.",
      "2. Chạy lệnh: sudo apt update && sudo apt install docker.io",
      "3. Mở terminal và kiểm tra phiên bản: docker --version",
      "4. Thêm user vào nhóm docker để chạy không cần sudo.",
      "Lệnh cuối cùng: sudo usermod -aG docker $USER",
      "Sau đó đăng xuất rồi đăng nhập lại để nhóm có hiệu lực.",
    ].join("\n");
    const result = decide(text);
    assertDecisionShape(result);
    assert.equal(result.kind, "tutorial");
  });

  it("detects an English how-to with numbered steps and commands", () => {
    const text = [
      "How to set up a local HTTPS dev server in five minutes.",
      "Step 1: install mkcert with brew install mkcert",
      "Step 2: run mkcert -install to trust the local CA",
      "Step 3: run mkcert localhost 127.0.0.1 to create a cert",
      "Step 4: open vite.config.js and set server.https to the cert paths",
      "Step 5: restart the dev server with npm run dev",
    ].join("\n");
    const result = decide(text);
    assertDecisionShape(result);
    assert.equal(result.kind, "tutorial");
  });
});

describe("decideContentType — review", () => {
  it("detects a Vietnamese review with pros/cons and verdict", () => {
    const text = [
      "Đánh giá MacBook Air M4 sau hai tuần sử dụng — mình đã dùng máy để code và edit video hằng ngày.",
      "Ưu điểm: pin trâu 14 tiếng, màn hình đẹp, tản nhiệt êm.",
      "Nhược điểm: chỉ có 2 cổng Thunderbolt, giá bản 24GB hơi chát.",
      "Mình chấm 8/10. Kết luận: đáng mua nếu bạn cần máy nhẹ cho công việc văn phòng và code.",
      "Trải nghiệm thực tế: sau khi dùng thử mình thấy trackpad vẫn là tốt nhất phân khúc.",
    ].join("\n");
    const result = decide(text);
    assertDecisionShape(result);
    assert.equal(result.kind, "review");
  });

  it("detects an English review with rating and first-person experience", () => {
    const text = [
      "Review: I've been using the Framework 13 for three months as my daily driver.",
      "Pros: modular ports, easy repairs, great keyboard.",
      "Cons: battery life is mediocre and the hinge flexes.",
      "I'd give it 7.5/10. In my opinion it is worth buying if you value repairability.",
      "Overall verdict: recommended with caveats.",
    ].join("\n");
    const result = decide(text);
    assertDecisionShape(result);
    assert.equal(result.kind, "review");
  });
});

describe("decideContentType — opinion", () => {
  it("detects an argumentative piece with stance verbs and normative claims", () => {
    const text = [
      "Tôi tin rằng AI sẽ không thay thế lập trình viên, nhưng sẽ thay đổi hoàn toàn cách chúng ta làm việc.",
      "Tôi nghĩ mọi công ty nên đầu tư vào kỹ năng prompt thay vì chỉ mua license.",
      "Chúng ta phải dừng việc coi LLM như oracle — nó là công cụ, và người dùng phải kiểm chứng.",
      "Theo tôi, ngành công nghiệp cần chuẩn đánh giá minh bạch hơn.",
      "Có thể sai, nhưng tôi cho rằng cách tiếp cận hiện tại đang đi sai hướng.",
    ].join("\n");
    const result = decide(text);
    assertDecisionShape(result);
    assert.equal(result.kind, "opinion");
  });
});

describe("decideContentType — news", () => {
  it("keeps a plain product launch as news with some confidence", () => {
    const text = [
      "OpenAI công bố GPT-6 vào sáng nay.",
      "Model mới hỗ trợ context 1 triệu token và giảm 40% độ trễ inference so với bản trước.",
      "Giá API giữ nguyên 5 USD mỗi triệu token đầu vào.",
      "Bản public API mở vào tháng 11 theo lộ trình công bố.",
    ].join("\n");
    const result = decide(text);
    assertDecisionShape(result);
    assert.equal(result.kind, "news");
  });
});

describe("decideContentType — ambiguity + override", () => {
  it("returns low or none confidence on genuinely mixed content", () => {
    // A short mixed snippet: one step-ish line, one opinion-ish line, one news-ish
    // line — nothing dominates strongly.
    const text = [
      "Cập nhật app vừa ra mắt tuần trước.",
      "Tôi nghĩ tính năng mới khá ổn.",
      "Vào Settings và bật toggle để thử.",
    ].join("\n");
    const result = decide(text);
    assertDecisionShape(result);
    assert.ok(
      result.confidence === "low" || result.confidence === "none",
      "expected low/none confidence, got " + result.confidence,
    );
  });

  it("forces the kind when formatOverride is a valid label", () => {
    for (const override of KINDS) {
      const result = decide("nội dung bất kỳ đủ dài để vượt ngưỡng tám mươi ký tự thông tin hợp lệ", {
        formatOverride: override,
      });
      assert.equal(result.kind, override);
      assert.equal(result.confidence, "high");
      assert.deepEqual(result.signals, ["user_override"]);
    }
  });

  it("ignores an invalid formatOverride", () => {
    const text = [
      "OpenAI công bố GPT-6 vào sáng nay với context 1 triệu token.",
      "Giá API giữ nguyên 5 USD mỗi triệu token.",
      "Bản public API mở vào tháng 11.",
    ].join("\n");
    const result = decide(text, { formatOverride: "essay" });
    assertDecisionShape(result);
    assert.notDeepEqual(result.signals, ["user_override"]);
    assert.equal(result.kind, "news");
  });
});
