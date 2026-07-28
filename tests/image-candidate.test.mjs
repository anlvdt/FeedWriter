import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let isLikelyAvatar;

before(() => {
  const code = fs.readFileSync(path.join(root, "content-dom.js"), "utf8");
  const sandbox = {
    window: {},
    location: { hostname: "www.facebook.com", href: "https://www.facebook.com/" },
    document: {},
    URL,
    String,
    Number,
    Math,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "content-dom.js" });
  isLikelyAvatar = sandbox.window.fbsIsLikelyAvatarCandidate;
  assert.equal(typeof isLikelyAvatar, "function");
});

describe("Facebook image candidate filtering", () => {
  it("rejects small profile-photo links and keeps large post photos", () => {
    assert.equal(isLikelyAvatar({
      renderedWidth: 40,
      renderedHeight: 40,
      href: "https://www.facebook.com/photo/?fbid=123",
    }), true);

    assert.equal(isLikelyAvatar({
      renderedWidth: 640,
      renderedHeight: 420,
      href: "https://www.facebook.com/photo/?fbid=456",
    }), false);
  });

  it("rejects unloaded header avatars and semantic avatar labels", () => {
    assert.equal(isLikelyAvatar({
      renderedWidth: 0,
      renderedHeight: 0,
      href: "https://www.facebook.com/photo/?fbid=123",
      isInHeader: true,
    }), true);

    assert.equal(isLikelyAvatar({
      renderedWidth: 320,
      renderedHeight: 320,
      alt: "Ảnh đại diện của tác giả",
    }), true);
  });
});
