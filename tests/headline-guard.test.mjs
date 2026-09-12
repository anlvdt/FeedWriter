import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const background = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const context = vm.createContext({});
const start = background.indexOf("function computeNgramOverlap(");
const end = background.indexOf("async function handleStream(", start);
assert.ok(start >= 0 && end > start);
vm.runInContext(background.slice(start, end), context);

function process(output) {
  context.output = output;
  return vm.runInContext('postProcessOutput(output, "", "summary")', context);
}

describe("summary headline deterministic guard", () => {
  for (const [input, expected] of [
    [
      "USER đề xuất cài plugin Product Designs cho Codex\n\nNội dung bài viết.",
      "PLUGIN PRODUCT DESIGNS ĐƯỢC ĐỀ XUẤT CHO CODEX",
    ],
    [
      "Người dùng: phát hiện tính năng mới trên Codex\n\nNội dung bài viết.",
      "PHÁT HIỆN TÍNH NĂNG MỚI TRÊN CODEX",
    ],
    [
      "Tác giả - giới thiệu công cụ mới\n\nNội dung bài viết.",
      "GIỚI THIỆU CÔNG CỤ MỚI",
    ],
    [
      "Người đăng cho biết bản cập nhật đã phát hành\n\nNội dung bài viết.",
      "CHO BIẾT BẢN CẬP NHẬT ĐÃ PHÁT HÀNH",
    ],
    [
      "Một người dùng chia sẻ plugin mới\n\nNội dung bài viết.",
      "CHIA SẺ PLUGIN MỚI",
    ],
  ]) {
    it(`removes forbidden headline lead: ${input.split("\\n")[0]}`, () => {
      const result = process(input);
      assert.equal(result.text.split("\n")[0], expected);
      assert.match(result.issues.join("\n"), /chủ thể (?:nguồn )?chung chung/);
    });
  }

  it("rewrites a generic recommendation actor even when it appears mid-headline", () => {
    const result = process(
      "GPT-6 tăng mức thẩm mỹ người dùng đề xuất cài plugin Product Designs cho Codex\n\nNội dung bài viết.",
    );
    assert.equal(
      result.text.split("\n")[0],
      "GPT-6 CẢI THIỆN KHẢ NĂNG THẨM MỸ VÀ PLUGIN PRODUCT DESIGNS ĐƯỢC ĐỀ XUẤT CHO CODEX",
    );
    assert.doesNotMatch(result.text.split("\n")[0], /NGƯỜI DÙNG|TÁC GIẢ|NGƯỜI ĐĂNG|\bUSER\b/);
    assert.doesNotMatch(result.text.split("\n")[0], /TĂNG MỨC THẨM MỸ/);
    assert.match(result.issues.join("\n"), /cấu trúc tin tức/);
  });

  it("keeps a valid headline and the existing all-caps design", () => {
    const result = process(
      "Codex bổ sung plugin Product Designs\n\nNội dung bài viết.",
    );
    assert.equal(
      result.text.split("\n")[0],
      "CODEX BỔ SUNG PLUGIN PRODUCT DESIGNS",
    );
    assert.doesNotMatch(result.issues.join("\n"), /chủ thể chung chung/);
  });

  it("never leaves a forbidden prefix when the generated headline is only that prefix", () => {
    const result = process("USER\n\nNội dung bài viết đủ dài để xử lý.");
    assert.equal(result.text.split("\n")[0], "CẬP NHẬT");
  });
  it("removes forbidden headline leads with expanded source actors (leaker, trang tin, chuyên gia)", () => {
    for (const [input, expected] of [
      ["Leaker: iPhone 17 sẽ mỏng hơn\n\nNội dung bài viết.", "IPHONE 17 SẼ MỎNG HƠN"],
      ["Trang tin cho biết Nvidia tăng sản lượng chip\n\nNội dung bài viết.", "CHO BIẾT NVIDIA TĂNG SẢN LƯỢNG CHIP"],
      ["Một bài đăng chia sẻ thủ thuật mới\n\nNội dung bài viết.", "CHIA SẺ THỦ THUẬT MỚI"],
      ["Chuyên gia nhận định thị trường AI bùng nổ\n\nNội dung bài viết.", "NHẬN ĐỊNH THỊ TRƯỜNG AI BÙNG NỔ"],
    ]) {
      const result = process(input);
      assert.equal(result.text.split("\n")[0], expected);
      assert.match(result.issues.join("\n"), /chủ thể (?:nguồn )?chung chung/);
    }
  });

  it("removes named publisher attribution from the headline across case and prefix variations", () => {
    const cases = [
      "Vox cho biết GPT-6 Pro có thể tạo bản mô tả công việc cho kỹ sư\n\nNội dung bài viết.",
      "vox cho biết GPT-6 Pro có thể tạo bản mô tả công việc cho kỹ sư\n\nNội dung bài viết.",
      "VOX CHO BIẾT GPT-6 Pro có thể tạo bản mô tả công việc cho kỹ sư\n\nNội dung bài viết.",
      "Theo Vox cho biết GPT-6 Pro có thể tạo bản mô tả công việc cho kỹ sư\n\nNội dung bài viết.",
      "Theo Vox: GPT-6 Pro có thể tạo bản mô tả công việc cho kỹ sư\n\nNội dung bài viết.",
      "Theo Vox, GPT-6 Pro có thể tạo bản mô tả công việc cho kỹ sư\n\nNội dung bài viết.",
      "The Verge đưa tin GPT-6 Pro có thể tạo bản mô tả công việc cho kỹ sư\n\nNội dung bài viết.",
    ];
    for (const input of cases) {
      const result = process(input);
      assert.equal(
        result.text.split("\n")[0],
        "GPT-6 PRO CÓ THỂ TẠO BẢN MÔ TẢ CÔNG VIỆC CHO KỸ SƯ",
      );
      assert.match(result.issues.join(" "), /tên nguồn/);
    }
  });

  it("capitalizes expanded modern tech brand names in body", () => {
    const input = "TIÊU ĐỀ BẢN TIN\n\nTrong thử nghiệm, nvidia, qualcomm, deepseek, anthropic và tsmc đạt hiệu năng cao.";
    const result = process(input);
    assert.match(result.text, /Nvidia/);
    assert.match(result.text, /Qualcomm/);
    assert.match(result.text, /DeepSeek/);
    assert.match(result.text, /Anthropic/);
    assert.match(result.text, /TSMC/);
  });

  it("cleans awkward translationese and mechanical phrasing in body", () => {
    const input = "TIÊU ĐỀ BẢN TIN\n\nHệ thống cung cấp khả năng cho phép người dùng có thể kích hoạt tính năng mới được thiết kế nhằm mục đích tăng tốc độ.";
    const result = process(input);
    assert.doesNotMatch(result.text, /cung cấp khả năng cho phép/);
    assert.doesNotMatch(result.text, /cho phép người dùng có thể/);
    assert.doesNotMatch(result.text, /được thiết kế nhằm mục đích/);
    assert.match(result.text, /cho phép người dùng/);
    assert.match(result.text, /nhằm/);
  });

  it("strips empty journalistic filler prefix at start of body", () => {
    const input = "TIÊU ĐỀ BẢN TIN\n\nĐược biết, Apple vừa phát hành bản cập nhật mới.";
    const result = process(input);
    const body = result.text.split("\n\n")[1];
    assert.ok(!body.startsWith("Được biết,"));
    assert.match(body, /Apple vừa phát hành bản cập nhật mới/);
  });

  it("normalizes awkward IT terminology in headlines into standard terms", () => {
    const cases = [
      [
        "CÔNG CỤ AI KHÔNG MÃ KÉO‑THẢ TẠO ẢNH, VIDEO VÀ MÔ HÌNH 3D TRÊN MÁY TÍNH CÁ NHÂN\n\nNội dung bài viết.",
        "CÔNG CỤ AI NO-CODE KÉO THẢ TẠO ẢNH, VIDEO VÀ MÔ HÌNH 3D TRÊN PC",
      ],
      [
        "Nền tảng không mã mới cho lập trình viên\n\nNội dung bài viết.",
        "NỀN TẢNG NO-CODE MỚI CHO LẬP TRÌNH VIÊN",
      ],
      [
        "Đại lý AI tự động hóa tác vụ trên máy tính cá nhân\n\nNội dung bài viết.",
        "AI AGENT TỰ ĐỘNG HÓA TÁC VỤ TRÊN PC",
      ],
    ];
    for (const [input, expected] of cases) {
      const result = process(input);
      assert.equal(result.text.split("\n")[0], expected);
    }
  });

  it("strips robotic self-referential introductory leads while preserving the main fact", () => {
    const input =
      "TIÊU ĐỀ BẢN TIN\n\nTôi đưa tin về công cụ mới cho phép người dùng xây dựng ảnh, video và mô hình 3D AI bằng cách kết nối các khối trực quan, không cần viết mã và chạy trực tiếp trên máy tính cá nhân của mình.";
    const result = process(input);
    const body = result.text.split("\n\n")[1];
    assert.doesNotMatch(body, /^Tôi đưa tin về/i);
    assert.match(body, /^Công cụ mới cho phép người dùng/);
    assert.match(body, /không cần viết code/);
    assert.doesNotMatch(body, /không cần viết mã/);
    assert.match(body, /chạy trực tiếp trên máy/);
    assert.doesNotMatch(body, /máy tính cá nhân của mình/);
  });

  it("cleans awkward IT translationese in body paragraphs", () => {
    const input =
      "TIÊU ĐỀ BẢN TIN\n\nNền tảng AI không mã hỗ trợ kéo-thả để xây dựng đại lý AI mà không cần viết mã.";
    const result = process(input);
    assert.match(result.text, /Nền tảng AI no-code/);
    assert.match(result.text, /kéo thả/);
    assert.match(result.text, /AI agent/);
    assert.match(result.text, /không cần viết code/);
    assert.doesNotMatch(result.text, /không mã/);
    assert.doesNotMatch(result.text, /đại lý AI/);
  });

  it("strips 'Mới đây' lead and 'chính thức' filler from headline", () => {
    const result = process(
      "Mới đây, Apple chính thức ra mắt iPhone 17\n\nNội dung bài viết.",
    );
    assert.match(result.text, /^APPLE RA MẮT IPHONE 17/);
  });

  it("flags clickbait words in headline as a quality issue", () => {
    const result = process(
      "Tính năng mới gây sốc trên iPhone\n\nNội dung bài viết đủ dài.",
    );
    assert.ok(
      result.issues.some((i) => i.includes("giật gân")),
      "expected clickbait flag, got: " + JSON.stringify(result.issues),
    );
  });
});
