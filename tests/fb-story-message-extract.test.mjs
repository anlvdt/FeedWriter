import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../content-dom.js", import.meta.url), "utf8");
const grab = (name) => {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const next = src.indexOf("\nfunction ", start + 10);
  return src.slice(start, next);
};

// Facebook's current feed markup tags the post body with
// data-ad-rendering-role="story_message" and has no data-ad-preview node.
// extractPostContent must use it instead of dumping the whole card text.
function load(container) {
  const ctx = vm.createContext({
    SITE: "facebook",
    _findPostContainer: () => container,
    _findSharedPostArticle: () => null,
  });
  vm.runInContext(
    src.slice(
      src.indexOf("const FB_MESSAGE_SELECTOR"),
      src.indexOf(";\n", src.indexOf("const FB_MESSAGE_SELECTOR")) + 2,
    ) +
      "\n" +
      grab("_normalizePostBodyText") +
      grab("_getPrimaryPostText") +
      grab("extractPostContent"),
    ctx,
  );
  return ctx;
}

describe("Facebook story_message extraction", () => {
  it("returns only the story_message body, not author/comments/suggestions", () => {
    const body = {
      innerText: "Nội dung bài viết thật.",
      parentElement: null,
      closest: () => null,
      getAttribute: () => null,
    };
    const container = {
      innerText: "Tên Tác Giả\nNội dung bài viết thật.\nThích\nBình luận\nBài viết gợi ý không liên quan",
      querySelectorAll(sel) {
        return String(sel).includes("story_message") ? [body] : [];
      },
    };
    const ctx = load(container);
    assert.equal(vm.runInContext("extractPostContent(el)", Object.assign(ctx, { el: {} })), "Nội dung bài viết thật.");
  });
});
