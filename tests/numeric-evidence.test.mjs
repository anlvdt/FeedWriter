import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Execute the production guardrails, including their real overlap/repetition
// helpers, without starting Chrome listeners or duplicating the algorithm.
const background = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const context = vm.createContext({});
const start = background.indexOf("function computeNgramOverlap(");
const end = background.indexOf("async function handleStream(", start);
assert.ok(start >= 0 && end > start);
vm.runInContext(background.slice(start, end), context);

function process(output, source) {
  context.output = output;
  context.source = source;
  return vm.runInContext('postProcessOutput(output, source, "summary")', context);
}

function numericWarnings(result) {
  return result.issues.filter((issue) => issue.includes("số liệu bịa"));
}

describe("production numeric evidence guardrail", () => {
  it("warns for one invented number instead of marking it good", () => {
    const result = process("Demo có 99999 người dùng\n\nCông cụ chuẩn bị yêu cầu trước khi lập trình.",
      "Demo supports specifying requirements before making changes to source code.");
    assert.equal(result.quality, "warn");
    assert.equal(numericWarnings(result).length, 1);
    assert.match(numericWarnings(result)[0], /99999/);
    assert.equal(result.failure, undefined); // Warn; do not discard the article.
  });

  it("also checks short sources and single-digit claims", () => {
    const result = process("Demo hỗ trợ tác vụ\n\nDemo đã thu hút 9 người dùng.", "Demo helps write code.");
    assert.equal(result.quality, "warn");
    assert.match(numericWarnings(result)[0], /\(9\)/);
  });

  for (const [source, value] of [
    ["The app has 56.9 thousand stars.", "56,9 nghìn"],
    ["The app has 56.9k stars.", "56.900"],
    ["The app has 1,234 users.", "1.234"],
    ["The price is 1,234.56 USD.", "1.234,56"],
  ]) {
    it(`recognizes equivalent notation: ${value}`, () => {
      assert.equal(numericWarnings(process(`Thông tin Demo\n\nGiá trị được công bố là ${value}.`, source)).length, 0);
    });
  }

  it("does not confuse a decimal with a larger integer", () => {
    const result = process("Thông tin Demo\n\nGiá trị được công bố là 569.", "The measured value was 56.9.");
    assert.match(numericWarnings(result)[0], /569/);
  });

  it("preserves exact VND values through compact formatting", () => {
    const result = process("Giá Demo\n\nMức giá là 44.990.000 đồng.", "Giá niêm yết 44.990.000 đồng.");
    assert.match(result.text, /44,99 triệu đồng/);
    assert.doesNotMatch(result.text, /45 triệu đồng/);
    assert.equal(numericWarnings(result).length, 0);
  });

  it("does not use digits in a source URL as factual evidence", () => {
    const result = process("Thông tin Demo\n\nDemo có 99999 người dùng.", "See the app at https://x.com/a/status/99999");
    assert.match(numericWarnings(result)[0], /99999/);
  });

  it("ignores generated list numbering but checks quantities inside items", () => {
    const result = process("Cách dùng Demo\n\n1. Mở ứng dụng.\n2. Chọn file.\nBước 3: Xuất kết quả.", "Open the app, choose a file and export the result.");
    assert.equal(numericWarnings(result).length, 0);
    const invented = process("Cách dùng Demo\n\n1. Mở ứng dụng cho 9 người dùng.", "Open the app.");
    assert.match(numericWarnings(invented)[0], /\(9\)/);
  });

  it("keeps version separators distinct from quantities", () => {
    assert.equal(numericWarnings(process("Demo mới\n\nBản 1.2.3 đã phát hành.", "Demo version 1.2.3 is released.")).length, 0);
    assert.match(numericWarnings(process("Demo mới\n\nDemo có 123 người dùng.", "Demo version 1.2.3 is released."))[0], /123/);
  });
});
