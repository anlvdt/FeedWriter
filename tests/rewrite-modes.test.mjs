import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const policy = createRequire(import.meta.url)("../lib/summary-policy.js");

describe("manual rewrite modes (translate / list)", () => {
  it("allows forcing translation for any language up to the translate cap", () => {
    assert.equal(policy.canForceTranslation("Xin chào, đây là một đoạn tiếng Việt."), true);
    assert.equal(policy.canForceTranslation("x".repeat(6001)), false);
    assert.equal(policy.canForceTranslation("   "), false);
  });

  it("offers Dịch and List + link chips in the panel tone row", () => {
    const src = read("content.js");
    assert.match(src, /data-tone="translate"/);
    assert.match(src, /data-tone="list"/);
  });

  it("defines a list tone that keeps every repo link", () => {
    const src = read("bg-api.js");
    const i = src.indexOf("list: ");
    assert.ok(i >= 0, "list tone missing");
    const block = src.slice(i, i + 1400);
    assert.match(block, /URL/);
    assert.match(block, /đủ tất cả các mục/);
  });

  it("routes tone=translate to translation mode and bypasses the auto policy", () => {
    const bg = read("background.js");
    assert.match(bg, /tone === "translate"/);
    assert.match(bg, /explicitRewrite/);
    const ct = read("content.js");
    assert.match(ct, /type === "summary" && SITE !== "x" && !tone/);
  });

  it("shows the tone row after an info skip so the user can request a rewrite", () => {
    assert.match(read("content.js"), /html\.includes\("fbs-error-info"\)/);
  });
});
