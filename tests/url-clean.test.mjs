/**
 * Tests for URL tracking-param stripping and cleanSourceUrl.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const pure = require(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "pure-logic.js"),
);

const { stripTrackingParams, cleanSourceUrl } = pure;

describe("stripTrackingParams", () => {
  it("strips utm_* and fbclid", () => {
    const dirty =
      "https://example.com/article?utm_source=fb&utm_medium=social&fbclid=IwAR123&id=42";
    const clean = stripTrackingParams(dirty);
    assert.ok(!clean.includes("utm_source"), clean);
    assert.ok(!clean.includes("utm_medium"), clean);
    assert.ok(!clean.includes("fbclid"), clean);
    assert.ok(clean.includes("id=42"), clean);
    assert.match(clean, /^https:\/\/example\.com\/article\?id=42$/);
  });

  it("strips gclid and __* params", () => {
    const dirty =
      "https://shop.example/p?gclid=abc&__tn__=R&keep=1";
    const clean = stripTrackingParams(dirty);
    assert.ok(!clean.includes("gclid"), clean);
    assert.ok(!clean.includes("__tn__"), clean);
    assert.ok(clean.includes("keep=1"), clean);
  });

  it("returns empty string for empty input", () => {
    assert.equal(stripTrackingParams(""), "");
    assert.equal(stripTrackingParams(null), "");
  });

  it("returns original string when URL is invalid", () => {
    assert.equal(stripTrackingParams("not a url"), "not a url");
  });
});

describe("cleanSourceUrl", () => {
  it("strips tracking on non-Facebook URLs", () => {
    const url =
      "https://news.example.com/story?utm_campaign=x&fbclid=y&slug=ok";
    const clean = cleanSourceUrl(url);
    assert.ok(!clean.includes("utm_"), clean);
    assert.ok(!clean.includes("fbclid"), clean);
    assert.ok(clean.includes("slug=ok"), clean);
  });

  it("normalizes Facebook story_fbid permalinks", () => {
    const raw =
      "https://www.facebook.com/story.php?story_fbid=111&id=222&fbclid=zzz";
    const clean = cleanSourceUrl(raw);
    assert.equal(clean, "https://www.facebook.com/222/posts/111/");
  });

  it("returns origin+pathname for plain Facebook paths", () => {
    const raw =
      "https://www.facebook.com/groups/123/posts/456/?ref=share&fbclid=abc";
    const clean = cleanSourceUrl(raw);
    assert.equal(clean, "https://www.facebook.com/groups/123/posts/456/");
  });

  it("preserves identity params for Facebook photo permalinks", () => {
    const raw =
      "https://www.facebook.com/photo.php?fbid=123456789012345&set=a.99&fbclid=tracking";
    const clean = cleanSourceUrl(raw);
    assert.match(clean, /fbid=123456789012345/);
    assert.match(clean, /set=a\.99/);
    assert.ok(!clean.includes("fbclid"), clean);
  });

  it("preserves the video id for Facebook Watch links", () => {
    const raw =
      "https://www.facebook.com/watch/?v=123456789012345&ref=sharing";
    const clean = cleanSourceUrl(raw);
    assert.match(clean, /[?&]v=123456789012345/);
    assert.ok(!clean.includes("ref="), clean);
  });
});
