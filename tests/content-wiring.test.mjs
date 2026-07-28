import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "content.js"), "utf8");

function functionBody(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start + 1);
  assert.ok(start >= 0 && end > start, `unable to locate ${name}`);
  return source.slice(start, end);
}

describe("Facebook summary-button wiring", () => {
  it("keeps only the inline control beside See more", () => {
    const scanBody = functionBody("scanFBAllPosts", "scanCommentSections");

    assert.match(scanBody, /_removeLegacyPostChips\(root\)/);
    assert.doesNotMatch(source, /function _mountPostChip\(/);
    assert.doesNotMatch(scanBody, /_mountPostChip\(article\)/);
    assert.doesNotMatch(scanBody, /fbAllPostInjected/);
  });
});
