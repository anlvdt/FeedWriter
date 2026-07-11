import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  escapeHtml,
  isSafeAttrName,
  vnode,
} = require("../lib/dom-el.js");

describe("escapeHtml", () => {
  it("escapes script and quotes", () => {
    const raw = `<script>alert("x")</script> & 'y'`;
    const out = escapeHtml(raw);
    assert.equal(out.includes("<"), false);
    assert.equal(out.includes(">"), false);
    assert.match(out, /&lt;script&gt;/);
    assert.match(out, /&amp;/);
    assert.match(out, /&quot;/);
    assert.match(out, /&#39;/);
  });

  it("handles null/undefined", () => {
    assert.equal(escapeHtml(null), "");
    assert.equal(escapeHtml(undefined), "");
  });
});

describe("isSafeAttrName", () => {
  it("allows normal attrs and blocks event handlers", () => {
    assert.equal(isSafeAttrName("class"), true);
    assert.equal(isSafeAttrName("data-id"), true);
    assert.equal(isSafeAttrName("onclick"), false);
    assert.equal(isSafeAttrName("onerror"), false);
    assert.equal(isSafeAttrName(""), false);
  });
});

describe("vnode", () => {
  it("strips unsafe attrs and keeps text children", () => {
    const n = vnode(
      "div",
      { className: "ok", onclick: "evil()", "data-x": "1" },
      ["hello <b>"],
    );
    assert.equal(n.tag, "div");
    assert.equal(n.attrs.onclick, undefined);
    assert.equal(n.attrs["data-x"], "1");
    assert.deepEqual(n.children, ["hello <b>"]);
  });
});
