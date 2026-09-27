import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");
const snippet = source.slice(source.indexOf("function stopSummarize()"), source.indexOf("function extractGithubRepoUrl("));

test("stopping a summary settles once, disconnects, and clears the busy state", () => {
  let settled = 0;
  let disconnected = 0;
  const overlays = [];
  const context = vm.createContext({
    isSummarizing: true,
    activeSummaryRequest: { finish() { settled++; } },
    currentPort: { disconnect() { disconnected++; } },
    panelBody: { innerHTML: "<div>partial</div>" },
    openOverlay(html, streaming) { overlays.push({ html, streaming }); },
  });
  vm.runInContext(snippet, context);
  vm.runInContext("stopSummarize(); stopSummarize();", context);
  assert.equal(settled, 1);
  assert.equal(disconnected, 1);
  assert.equal(context.isSummarizing, false);
  assert.equal(context.currentPort, null);
  assert.equal(overlays.length, 1);
  assert.match(overlays[0].html, /Đã dừng/);
  assert.equal(overlays[0].streaming, false);
});
