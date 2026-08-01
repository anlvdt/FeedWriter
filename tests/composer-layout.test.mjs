import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(root, "ui.css"), "utf8");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");

describe("Facebook composer sidebar layout", () => {
  it("uses a right-rail width and compact two-row source controls", () => {
    assert.match(css, /\.fbs-panel-left\.is-composer/);
    assert.match(css, /width:\s*clamp\(264px,[^;]+336px\)\s*!important/);
    assert.match(css, /max-height:\s*calc\(100vh - 76px\)\s*!important/);
    assert.match(css, /grid-template-columns:\s*1fr 1fr 31px\s*!important/);
    assert.match(css, /grid-column:\s*1 \/ -1\s*!important/);
  });

  it("hides the selection toolbar while a native composer editor is open", () => {
    assert.match(css, /body:has\(:is\(/);
    assert.match(css, /\[role="dialog"\] \[contenteditable="true"\]/);
    assert.match(css, /\[role="dialog"\] \[data-lexical-editor="true"\]/);
    assert.match(css, /\.fbs-floating-toolbar\s*\{\s*display:\s*none\s*!important/);
  });
});

describe("Facebook personal-profile exclusion", () => {
  it("suppresses summary controls and selection actions on personal profiles", () => {
    assert.match(content, /function isFacebookPersonalProfileHome\(\)/);
    assert.match(content, /\^\(bạn bè\|friends\)\$/i);
    assert.match(content, /if \(isFacebookPersonalProfileHome\(\)\) \{\s*removePersonalProfileControls\(\);\s*return;/);
  });
});
