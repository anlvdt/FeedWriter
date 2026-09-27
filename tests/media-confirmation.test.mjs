import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const linkedin = fs.readFileSync(new URL("../poster-linkedin.js", import.meta.url), "utf8");

function makeContext(fetchImageBlob) {
  const events = [];
  const editor = {
    innerText: "",
    focus() {},
    dispatchEvent(event) { events.push(event.type); },
  };
  const trigger = { click() {} };
  const document = { querySelector(selector) {
    if (selector.includes("draft-text-replaceable")) return trigger;
    if (selector.includes("ql-editor")) return editor;
    return null;
  } };
  class DataTransfer {
    constructor() {
      this.files = [];
      this.items = { add: file => this.files.push(file) };
    }
  }
  class ClipboardEvent { constructor(type) { this.type = type; } }
  const context = vm.createContext({
    SITE: "linkedin", document, Event, DataTransfer, ClipboardEvent,
    PostData: { getTextWithTags: () => "draft" },
    waitForCondition: async resolve => resolve(),
    fetchImageBlob,
    setTimeout: callback => callback(),
    console: { warn() {}, error() {} },
  });
  vm.runInContext(linkedin, context);
  return { context, events };
}

test("LinkedIn refuses a partial image handoff", async () => {
  const fixture = makeContext(async () => { throw new Error("image unavailable"); });
  const result = await vm.runInContext(
    'PosterLinkedin.post({ content: "draft", images: [{ url: "https://example.com/a.png", name: "a.png" }] })',
    fixture.context,
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /0\/1 ảnh/);
  assert.equal(fixture.events.includes("paste"), false);
});

test("LinkedIn flags a transferred image for visual confirmation", async () => {
  const fixture = makeContext(async () => ({ name: "a.png" }));
  const result = await vm.runInContext(
    'PosterLinkedin.post({ content: "draft", images: [{ url: "https://example.com/a.png", name: "a.png" }] })',
    fixture.context,
  );
  assert.equal(result.ok, true);
  assert.equal(result.mediaConfirmationRequired, true);
  assert.equal(fixture.events.includes("paste"), true);
});
