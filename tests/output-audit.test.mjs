// Defects found by replaying the 200-entry history export through the
// current post-processing (deep audit, 2026-10-04).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const policy = require("../lib/summary-policy.js");
const background = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const context = vm.createContext({ FeedWriterSummaryPolicy: policy });
vm.runInContext(readFileSync(new URL("../utils.js", import.meta.url), "utf8"), context);
vm.runInContext(background.slice(background.indexOf("function computeNgramOverlap("), background.indexOf("async function handleStream(")), context);
const post = (output, source = "") => {
  Object.assign(context, { output, source });
  return vm.runInContext('postProcessOutput(output, source, "summary")', context);
};
const fabricated = (output, source) => [...post(output, source).issues].filter((i) => i.includes("số liệu bịa") || i.includes("Tiêu đề cần viết lại: số liệu"));

describe("number evidence: no false 'fabricated' flags", () => {
  it("accepts dates rewritten from month names, compact scales, number words and time zones", () => {
    assert.deepEqual(fabricated("GPT-OSS 120B RỜI ANTIGRAVITY TỪ 2/11\n\nTừ ngày 2/11/2026, gói sinh viên chỉ còn Gemini.", "GPT-OSS 120B leaves Antigravity on November 2. Student plans keep Gemini."), []);
    assert.deepEqual(fabricated("Google đổi quyền truy cập từ 9/10\n\nGói Free chỉ còn Flash-Lite.", "Google is changing Gemini model access starting Oct 9: Free → Flash-Lite only"), []);
    assert.deepEqual(fabricated("Repo đạt 58 triệu lượt xem\n\nDự án có 1,2 tỷ token sau ba tuần, tức 3 tuần.", "58M views, 1.2B tokens after three weeks"), []);
    assert.deepEqual(fabricated("Sự kiện diễn ra lúc 0:00 (UTC+7)\n\nMicrosoft trả 5 000 USD cho hacker.", "Microsoft paid him $5,000."), []);
  });

  it("still flags a count the source does not support", () => {
    assert.ok(fabricated("Giới thiệu 11 dự án mã nguồn mở\n\nDanh sách gồm 11 dự án.", "10 GitHub repos that can replace expensive software").length > 0);
  });
});

describe("number formatting", () => {
  it("keeps Vietnamese thousands before a unit (5.000 USD is five thousand)", () => {
    const run = (t) => { context.t = t; return vm.runInContext("normalizeVietnameseNumericNotation(t)", context); };
    assert.equal(run("trả 5.000 USD cho hacker"), "trả 5.000 USD cho hacker");
    assert.equal(run("trả 5 000 USD cho hacker"), "trả 5.000 USD cho hacker");
    assert.equal(run("chip 2.5 GHz, giá $1,234.5"), "chip 2,5 GHz, giá 1.234,5 USD");
  });
});

describe("text cleanup", () => {
  it("does not capitalize a URL or domain at the start of a sentence", () => {
    const { text } = post("Danh sách công cụ mới nhất\n\nhttp://github.com/AppFlowy-IO/AppFlowy thay thế Notion.\n\nwww.example.com có bản demo. sau đó thử ngay.");
    assert.match(text, /\n\nhttp:\/\/github\.com\/AppFlowy-IO\/AppFlowy thay thế Notion\./);
    assert.match(text, /\n\nwww\.example\.com có bản demo\. Sau đó thử ngay\./);
  });

  it("drops 'Phần N' scaffolding from the long-post fact sheet", () => {
    const { text } = post("Mười công cụ thay thế phần mềm trả phí\n\nPhần 1:\n· AppFlowy thay thế Notion.\n\nPHẦN 2\n· NocoDB thay thế Airtable.");
    assert.doesNotMatch(text, /Phần\s+\d|PHẦN\s+\d/);
    assert.match(text, /· AppFlowy thay thế Notion\./);
  });
});
