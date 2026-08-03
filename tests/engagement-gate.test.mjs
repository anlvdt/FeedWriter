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
  const detectStart = src.indexOf("function _detectEngagementGateText");
  const detectEnd = src.indexOf("/** @deprecated name kept for callers");
  const normalizeEnd = src.indexOf("function extractPostContent");

  const code =
    src.slice(helpersStart, src.indexOf("function _fbIsCommentActivityLink")) +
    src.slice(helpersMid, normalizeEnd) +
    "\n" +
    src.slice(detectStart, detectEnd) +
    "\nmodule.exports = { _detectEngagementGateText, _getEngagementScanText, _fbIsCommentActivityText };";

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
});
