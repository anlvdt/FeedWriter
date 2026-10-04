// A draft with a factual problem is sent back once with the detected issues.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const background = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const context = vm.createContext({});
vm.runInContext(
  background.slice(background.indexOf("// === SELF-CORRECTION ==="), background.indexOf("// === HISTORY ===")) +
    ";this.api = { blockingQualityIssues, buildRevisionInstruction, pickRevisedResult };",
  context,
);
const { blockingQualityIssues, buildRevisionInstruction, pickRevisedResult } = context.api;

const bad = (summary) => ({
  summary,
  issues: ["[!] Output có thể chứa số liệu bịa (42) — không tìm thấy trong bài gốc.", "Đã loại bỏ tên nguồn ở đầu tiêu đề."],
});
const good = (summary) => ({ summary, issues: ["Đã rút tiêu đề cho trọn ý, phần chi tiết nằm ở đoạn sau."] });

describe("self-correction pass", () => {
  it("only factual warnings are blocking", () => {
    assert.equal(blockingQualityIssues(bad("x")).length, 1);
    assert.equal(blockingQualityIssues(good("x")).length, 0);
    assert.equal(blockingQualityIssues({ summary: "x", issues: ["[!] Output quá ngắn so với nguồn dài — có thể đã bỏ sót luận điểm hoặc dữ kiện."] }).length, 0);
    assert.equal(blockingQualityIssues({ error: "fail" }).length, 0);
  });

  it("hands the issues and the draft back to the model", () => {
    const instruction = buildRevisionInstruction("Bản nháp có số 42", blockingQualityIssues(bad("x")));
    assert.match(instruction, /SỬA BẢN NHÁP/);
    assert.match(instruction, /- Output có thể chứa số liệu bịa \(42\)/);
    assert.match(instruction, /Bản nháp có số 42/);
  });

  it("keeps the better version and never loses the first draft", () => {
    assert.equal(pickRevisedResult(bad("v1"), good("v2")).summary, "v2");
    assert.equal(pickRevisedResult(bad("v1"), bad("v2")).summary, "v2");
    assert.equal(pickRevisedResult(bad("v1"), { error: "quota" }).summary, "v1");
    const worse = { summary: "v2", issues: [...bad("").issues, "[!] Tiêu đề cần viết lại: thiếu chủ thể hoặc sự kiện cụ thể."] };
    assert.equal(pickRevisedResult(bad("v1"), worse).summary, "v1");
  });

  it("records history once, after the revision pass", () => {
    const tail = background.slice(background.indexOf("deferRecording = true;"));
    assert.ok(tail.indexOf("pickRevisedResult(") < tail.indexOf("await recordSummary(finalResult)"));
    assert.match(background, /if \(recordResult && !deferRecording\) await recordSummary\(result\);/);
  });
});
