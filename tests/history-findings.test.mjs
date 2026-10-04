// Regressions found by reviewing exported history (feedwriter-history.json,
// 2026-10-04): mangled URLs/slugs, decimal-comma model versions, U+2011
// hyphens, placeholder outputs saved as summaries, duplicate history entries.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { TextEncoder } from "node:util";
import crypto from "node:crypto";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { cleanSourceUrl } = require("../lib/url-clean.js");
const background = readFileSync(new URL("../background.js", import.meta.url), "utf8");

const ppContext = vm.createContext({});
vm.runInContext(
  background.slice(background.indexOf("function computeNgramOverlap("), background.indexOf("async function handleStream(")),
  ppContext,
);
const postProcess = (output, source = "") => {
  ppContext.output = output;
  ppContext.source = source;
  return vm.runInContext('postProcessOutput(output, source, "summary")', ppContext);
};

describe("post-processing keeps identifiers intact", () => {
  it("does not brand-capitalize URLs, domains, handles, code or slugs", () => {
    const { text } = postProcess(
      "Repo demo mới cho github\n\n" +
      "Người dùng github có thể tải claude-opus-5-5-demo tại https://github.com/riba2534/claude-opus-5-5-demo " +
      "hoặc github.com/x/y, hỏi @claude, chạy `cursor --help` và thử claude.",
    );
    assert.match(text, /Người dùng GitHub/);
    assert.match(text, /thử Claude\./);
    assert.match(text, / claude-opus-5-5-demo /);
    assert.match(text, /https:\/\/github\.com\/riba2534\/claude-opus-5-5-demo/);
    assert.match(text, / github\.com\/x\/y/);
    assert.match(text, /@claude/);
    assert.match(text, /`cursor --help`/);
  });

  it("lowercases URL hostnames written with brand casing", () => {
    const { text } = postProcess("Kỹ năng viết mới cho agent\n\nDự án tại https://GitHub.com/0xpili/Simplified-English giúp agent viết rõ hơn.");
    assert.match(text, /https:\/\/github\.com\/0xpili\/Simplified-English/);
  });

  it("restores model version dots and normalizes number separators", () => {
    const { text } = postProcess(
      "Opus 5.5 tạo 84 000 tin nhắn trong ba tuần\n\n" +
      "Claude Opus 5,5 là model mới. SWE‑2 chạy hơn 1 000 lần, mỗi lần 5.000 mẫu, repo đạt 1.5 k sao và đọc 2.5 GB.",
    );
    assert.match(text, /Claude Opus 5\.5 là/);
    assert.match(text, /SWE-2/);
    assert.doesNotMatch(text, /‑/);
    assert.match(text, /hơn 1\.000 lần/);
    assert.match(text, /5\.000 mẫu/);
    assert.match(text, /1,5 k sao/);
    assert.match(text, /2,5 GB/);
  });

  it("rejects placeholder answers instead of saving them as summaries", () => {
    for (const output of [
      "[KHÔNG CÓ DỮ LIỆU TIN TỨC ĐÁNG TIN CẬY ĐỂ BIÊN TẬP THÀNH BẢN TIN.]",
      "⁣Phần 1:\n· Không có sự kiện, số liệu, tên, điều kiện hay kết quả cụ thể trong đoạn văn.",
      "**NO_SUMMARY**",
    ]) {
      assert.equal(postProcess(output).failure, "invalid_output", output);
    }
    assert.equal(postProcess("Không có phí thuê bao cho openGym\n\nỨng dụng miễn phí, không thu thập dữ liệu.").failure, undefined);
  });
});

describe("X source URLs", () => {
  it("canonicalizes photo/video/history permalinks to the status URL", () => {
    assert.equal(cleanSourceUrl("https://x.com/Da7_Tech/status/2106515649551868126/photo/1"), "https://x.com/Da7_Tech/status/2106515649551868126");
    assert.equal(cleanSourceUrl("https://twitter.com/mxstbr/status/2105428405571428785/history?s=20"), "https://x.com/mxstbr/status/2105428405571428785");
    assert.equal(cleanSourceUrl("https://x.com/karpathy"), "https://x.com/karpathy");
  });
});

describe("history entries", () => {
  it("replaces the previous entry for the same post and drops shell titles", async () => {
    const historySource = background.slice(background.indexOf("function compactHistoryForStorage"), background.indexOf("// reviewTodayHistory"));
    const state = { history: [{ id: "other", text: "o", summary: "o", sourceUrl: "https://x.com/a/status/1", type: "summary" }] };
    const chrome = {
      alarms: { onAlarm: { addListener() {} } },
      storage: { local: {
        async get(keys) {
          const names = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(names.map(key => [key, state[key]]));
        },
        async set(data) { Object.assign(state, data); },
      } },
    };
    const context = vm.createContext({
      chrome, crypto, TextEncoder, Date, JSON, cleanSourceUrl,
      logger: { warn() {} },
      formatVietnamIsoString: () => "2026-10-04",
    });
    vm.runInContext("let historyWriteQueue = Promise.resolve(); const HISTORY_MAX_ITEMS = 200; const HISTORY_MAX_BYTES = 2 * 1024 * 1024;", context);
    vm.runInContext(historySource, context);
    const url = "https://x.com/GeminiUpda0kkb/status/2106448012343992414/photo/1";
    for (const summary of ["v1", "v2", "v3"]) {
      await vm.runInContext(`saveHistory("t", ${JSON.stringify(summary)}, "x", "summary", ${JSON.stringify(url)}, "", "", "Home / X")`, context);
    }
    assert.deepEqual([...state.history.map(e => e.summary)], ["v3", "o"]);
    assert.equal(state.history[0].sourceUrl, "https://x.com/GeminiUpda0kkb/status/2106448012343992414");
    assert.equal(state.history[0].postTitle, "");
  });
});

describe("news sentences that mention a post", () => {
  it("keeps 'Bài viết của Apple xác nhận…' and drops only social-post narration", () => {
    const keep = postProcess("Tiêu đề thử nghiệm cho bài\n\nBài viết của Apple xác nhận iOS 27 ra mắt ngày 10/9. Bản cập nhật hỗ trợ iPhone 12 trở lên.").text;
    assert.match(keep, /Bài viết của Apple xác nhận iOS 27 ra mắt ngày 10\/9\./);
    const blog = postProcess("Tiêu đề thử nghiệm cho bài\n\nBài đăng trên blog của Google công bố Gemini 4 có cửa sổ ngữ cảnh 2 triệu token.").text;
    assert.match(blog, /Gemini 4 có cửa sổ ngữ cảnh/);
    const social = postProcess("Tiêu đề thử nghiệm cho bài\n\nBài đăng trên X của người dùng A lúc 17:10 đã chia sẻ thông tin về bản cập nhật. Bản cập nhật sửa lỗi pin.").text;
    assert.doesNotMatch(social, /Bài đăng trên X/);
    assert.match(social, /Bản cập nhật sửa lỗi pin\./);
  });
});
