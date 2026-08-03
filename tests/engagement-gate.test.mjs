import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { isFacebookCommentActivityText } = require(
  path.join(root, "lib", "pure-logic.js"),
);

function loadEngagementDetector() {
  const src = fs.readFileSync(path.join(root, "content-dom.js"), "utf8");
  const helpersStart = src.indexOf("function _fbCleanName");
  const helpersMid = src.indexOf("function _getPrimaryPostText");
  const detectStart = src.indexOf("function _isInformationalCommentPointer");
  const detectEnd = src.indexOf("/** @deprecated name kept for callers");
  const normalizeEnd = src.indexOf("function extractPostContent");

  const code =
    src.slice(helpersStart, src.indexOf("function _fbIsCommentActivityLink")) +
    src.slice(helpersMid, normalizeEnd) +
    "\n" +
    src.slice(detectStart, detectEnd) +
    "\nmodule.exports = { _detectEngagementGateText, _getEngagementScanText, _fbIsCommentActivityText, _isInformationalCommentPointer, _isEngagementMetaDiscussion, _sanitizeEngagementScan };";

  const mod = {};
  const sandboxConsole = { log() {}, warn() {}, error() {} };
  new Function("module", "SITE", "console", "location", code)(
    mod,
    "facebook",
    sandboxConsole,
    { origin: "https://www.facebook.com", hostname: "www.facebook.com" },
  );
  return mod.exports;
}

function makeContainer(text, messageText, { wrapMessageInArticle = false } = {}) {
  const messageNodes = [];
  if (messageText) {
    const msg = {
      closest(sel) {
        return sel === "form" ? null : null;
      },
      parentElement: null,
      innerText: messageText,
      textContent: messageText,
      getAttribute() {
        return null;
      },
    };
    if (wrapMessageInArticle) {
      const article = {
        getAttribute(k) {
          return k === "role" ? "article" : null;
        },
        parentElement: null,
      };
      msg.parentElement = article;
      messageNodes.push(msg);
      const container = {
        innerText: text,
        textContent: text,
        querySelectorAll(sel) {
          if (
            String(sel).includes("data-ad-preview") ||
            String(sel).includes("post_message")
          ) {
            return messageNodes;
          }
          return [];
        },
        cloneNode() {
          return {
            querySelectorAll() {
              return [];
            },
            innerText: text,
            textContent: text,
          };
        },
      };
      article.parentElement = container;
      return container;
    }
    messageNodes.push(msg);
  }

  return {
    innerText: text,
    textContent: text,
    querySelectorAll(sel) {
      if (
        String(sel).includes("data-ad-preview") ||
        String(sel).includes("post_message")
      ) {
        return messageNodes;
      }
      return [];
    },
    cloneNode() {
      return {
        querySelectorAll() {
          return [];
        },
        innerText: text,
        textContent: text,
      };
    },
  };
}

describe("Facebook comment activity chrome", () => {
  it("recognizes short 'đã bình luận' headers without 'gần đây'", () => {
    assert.equal(isFacebookCommentActivityText("Trần Hồng Quân đã bình luận."), true);
    assert.equal(isFacebookCommentActivityText("Nope Pham đã bình luận gần đây."), true);
    assert.equal(isFacebookCommentActivityText("Alex commented."), true);
    assert.equal(
      isFacebookCommentActivityText("Bình luận này phân tích rất rõ nguyên nhân của vấn đề."),
      false,
    );
  });
});

describe("Engagement gate false positives", () => {
  const { _detectEngagementGateText, _getEngagementScanText } = loadEngagementDetector();

  it("does not hide a normal share post that only has an activity header", () => {
    const body =
      "Mình vừa dành nhiều tuần rảnh để build một MVP nhỏ là Trợ lý AI 360, nên muốn chia sẻ với mọi người và xin thêm góp ý để hoàn thiện.";
    const full = `Trần Hồng Quân đã bình luận.\nBuild in Public VN\nTrần Hồng Quân · 15 giờ\n${body}\nXem thêm\nThích\nBình luận\nChia sẻ\nTất cả bình luận\nNguyễn A: hay quá anh\nBình B: cho mình xin link demo với\n`;
    assert.equal(_detectEngagementGateText(makeContainer(full, body)), null);
  });

  it("ignores comment-thread chrome when no semantic message node exists", () => {
    const contaminated = `Trần Hồng Quân đã bình luận.
Mình chia sẻ MVP xin góp ý hoàn thiện sản phẩm.
Thích
Bình luận
Chia sẻ
Tất cả bình luận
Nguyễn A: hay quá
Bình B: cho mình xin link demo với`;
    assert.equal(_detectEngagementGateText(makeContainer(contaminated)), null);
  });

  it("uses the post body under a virtualized article wrapper", () => {
    const body = 'Comment "link" để nhận file prompt miễn phí';
    const full = `Trần Hồng Quân đã bình luận.\n${body}\nBình luận\nA: xin link`;
    const container = makeContainer(full, body, { wrapMessageInArticle: true });
    const scanned = _getEngagementScanText(container);
    assert.match(scanned, /Comment "link" để nhận file/);
    assert.doesNotMatch(scanned, /xin link$/i);
    const hit = _detectEngagementGateText(container);
    assert.ok(hit);
    assert.equal(hit.reason, "comment_gate");
  });

  it("still catches real comment-to-get bait in the post body", () => {
    const body = 'Comment "link" để nhận file prompt miễn phí';
    const hit = _detectEngagementGateText(makeContainer(body, body));
    assert.ok(hit);
    assert.equal(hit.reason, "comment_gate");
    assert.ok(hit.actions.includes("comment"));
  });

  it("does not treat 'phản hồi / góp ý' feedback requests as comment gates", () => {
    const body = "Mọi người phản hồi giúp mình với, mình gửi thêm hướng dẫn sau";
    assert.equal(_detectEngagementGateText(makeContainer(body, body)), null);
  });

  it("does not hide posts that only point to a link in comments", () => {
    const body =
      "Kho học Generative AI của Microsoft 21 bài, hơn 114 nghìn sao GitHub, có sẵn bản tiếng Việt.\n" +
      "Khóa này dạy Python, TypeScript, RAG.\n" +
      "Link mình để ngay bình luận nhé 👇";
    assert.equal(_detectEngagementGateText(makeContainer(body, body)), null);
    assert.equal(
      _detectEngagementGateText(
        makeContainer("Chi tiết mình để dưới bình luận đầu tiên nhé", "Chi tiết mình để dưới bình luận đầu tiên nhé"),
      ),
      null,
    );
  });

  it("still catches like-to-get bait that mentions GitHub", () => {
    const body = "Thả tim hoặc thích để nhận github repo khóa học này";
    const hit = _detectEngagementGateText(makeContainer(body, body));
    assert.ok(hit);
    assert.equal(hit.reason, "like_gate");
  });

  it("does not hide voluntary inbox offers without a comment/like gate", () => {
    assert.equal(
      _detectEngagementGateText(
        makeContainer(
          "Nếu cần file mẫu Notion, inbox mình gửi luôn nhé",
          "Nếu cần file mẫu Notion, inbox mình gửi luôn nhé",
        ),
      ),
      null,
    );
    assert.equal(
      _detectEngagementGateText(
        makeContainer(
          "Không cần cmt, mình gửi file Notion qua inbox",
          "Không cần cmt, mình gửi file Notion qua inbox",
        ),
      ),
      null,
    );
  });

  it("does not hide posts that discuss or warn about engagement bait", () => {
    const corpus = [
      'Ai từng bị scam "cmt để nhận file" chưa?',
      "Mấy page hay dùng chiêu cmt để nhận file nhưng toàn scam",
      'Đừng cmt "1" để nhận file, toàn scam',
      "Bài này dạy cách nhận biết chiêu comment để lấy file",
      "Ai từng comment để nhận quà chưa?",
    ];
    for (const body of corpus) {
      assert.equal(
        _detectEngagementGateText(makeContainer(body, body)),
        null,
        body,
      );
    }
  });

  it("does not hide soft join-for-weekly-docs community posts", () => {
    const body = "Join group để nhận tài liệu hàng tuần";
    assert.equal(_detectEngagementGateText(makeContainer(body, body)), null);
  });

  it("does not treat bare want-file-then-comment as a gate without deliver cue", () => {
    assert.equal(
      _detectEngagementGateText(
        makeContainer("Muốn file thì comment đi", "Muốn file thì comment đi"),
      ),
      null,
    );
  });

  it("still catches strong comment/like gates after tightening", () => {
    const cases = [
      ['Comment "link" để nhận file prompt miễn phí', "comment_gate"],
      ["Cmt số 1 mình ib file luôn", "comment_gate"],
      ["Cần tài liệu thì để lại cmt mình gửi", "comment_gate"],
      ["Thả tim hoặc thích để nhận github repo khóa học này", "like_gate"],
      ["Share public để nhận file PDF miễn phí", "share_gate"],
    ];
    for (const [body, reason] of cases) {
      const hit = _detectEngagementGateText(makeContainer(body, body));
      assert.ok(hit, body);
      assert.equal(hit.reason, reason, body);
      assert.ok(hit.confidence >= 90, body);
    }
  });
});
