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
const ctx = vm.createContext({});
vm.runInContext(grab("_normalizePostBodyText") + grab("_extractXTweetText"), ctx);

const node = (text, children = []) => ({
  innerText: text,
  contains: (other) => other === node || children.includes(other),
});

describe("X tweet text extraction", () => {
  it("returns only tweetText nodes, not handle/time/views chrome", () => {
    const body = node("Cursor 3 is here.\nBuild faster.");
    const quoted = node("Quoted tweet body");
    ctx.article = {
      innerText: "Cursor@cursor_ai, 0:32 2:09 AM · Sep 30, 2026 · 184.6K Views Relevant View quotes",
      querySelectorAll: () => [body, quoted],
    };
    const out = vm.runInContext("_extractXTweetText(article)", ctx);
    assert.equal(out, "Cursor 3 is here.\nBuild faster.\n\nQuoted tweet body");
    assert.ok(!/Views|Relevant|@cursor_ai/.test(out));
  });

  it("returns empty text for a tweet without text instead of article chrome", () => {
    ctx.article = { querySelectorAll: () => [] };
    assert.equal(vm.runInContext("_extractXTweetText(article)", ctx), "");
  });

  it("drops FeedWriter's own inline button mounted inside the tweet text", () => {
    const ui = { removed: false, remove() { this.removed = true; } };
    const body = {
      get innerText() { return ui.removed ? "Available now in the Agents Window." : "Available now in the Agents Window.Đang tóm tắt…"; },
      contains: () => false,
      cloneNode() { return this; },
      querySelectorAll: () => [ui],
    };
    ctx.article = { querySelectorAll: () => [body] };
    assert.equal(vm.runInContext("_extractXTweetText(article)", ctx), "Available now in the Agents Window.");
  });
});

describe("X tweet text links", () => {
  it("replaces truncated link text with the full expanded URL", () => {
    const anchor = {
      textContent: "github.com/AppFlowy-IO/Ap…",
      getAttribute: (k) => (k === "title" ? "https://github.com/AppFlowy-IO/AppFlowy" : null),
      replaceWith(text) { this.replacedWith = text; },
    };
    const body = {
      get innerText() {
        return anchor.replacedWith
          ? "AppFlowy\n" + anchor.replacedWith
          : "AppFlowy\ngithub.com/AppFlowy-IO/Ap…";
      },
      contains: () => false,
      cloneNode() { return this; },
      querySelectorAll: (sel) => (/^a\b/.test(sel) ? [anchor] : []),
    };
    ctx.SITE = "x";
    ctx._expandedXAnchorUrls = (a) => [a.getAttribute("title")];
    ctx.article = { querySelectorAll: () => [body] };
    const out = vm.runInContext("_extractXTweetText(article)", ctx);
    assert.match(out, /https:\/\/github\.com\/AppFlowy-IO\/AppFlowy$/);
    assert.ok(!out.includes("…"));
  });
});
