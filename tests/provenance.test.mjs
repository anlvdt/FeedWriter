// Community mods/plugins/repos made FOR a product must not be credited to the
// vendor ("Claude Code ra mắt mod…").
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const policy = require("../lib/summary-policy.js");

const modTweet = {
  text: 'My new Claude Code mod "typing-speed" is just dropped. See your prompt typing stats in your Claude Code interface https://github.com/riba2534/typing-speed',
  author: "riba",
  sourceUrl: "https://x.com/riba2534/status/2106448012343992414",
};

describe("detectProvenance", () => {
  it("recognizes a first-person community mod", () => {
    const p = policy.detectProvenance(modTweet);
    assert.equal(p.kind, "community");
    assert.deepEqual(p.brands.map((b) => b.name), ["Claude Code"]);
    assert.equal(p.creator, "@riba2534");
  });

  it("recognizes a Vietnamese post about a self-made plugin", () => {
    const p = policy.detectProvenance({
      text: "Mình vừa viết một plugin cho Claude Code để tự commit sau mỗi lần sửa code, ai cần thì lấy nhé.",
      author: "Nguyễn Văn A",
      sourceUrl: "https://www.facebook.com/groups/1/posts/2",
    });
    assert.equal(p.kind, "community");
    assert.equal(p.creator, "Nguyễn Văn A");
  });

  it("treats a third-party GitHub repo as community work", () => {
    const p = policy.detectProvenance({ text: "Claude Code statusline hiển thị chi phí theo phiên: github.com/someone/cc-cost", sourceUrl: "https://www.reddit.com/r/x/1" });
    assert.equal(p.kind, "community");
  });

  it("keeps official announcements official", () => {
    const official = policy.detectProvenance({
      text: "We've just released plugins for Claude Code. Install them with /plugin.",
      sourceUrl: "https://x.com/claudeai/status/1",
    });
    assert.equal(official.kind, "official");
    assert.equal(policy.buildProvenanceInstruction(official), "");
    assert.equal(policy.detectProvenance({ text: "Claude Code now supports hooks.", sourceUrl: "https://github.com/anthropics/claude-code" }).kind, "unknown");
    assert.equal(policy.detectProvenance({
      text: "Anthropic launched plugins for Claude Code yesterday, and the community has already published 500 of them at github.com/someone/awesome-claude-plugins",
      sourceUrl: "https://www.theverge.com/news/1",
    }).kind, "unknown");
    assert.equal(policy.detectProvenance({
      text: "Anthropic launched plugins for Claude Code yesterday, so I built my first plugin: auto-commit.",
      sourceUrl: "https://x.com/dev/status/1",
    }).kind, "community");
  });
});

describe("prompt and output checks", () => {
  const p = policy.detectProvenance(modTweet);

  it("tells the model who made it", () => {
    const rule = policy.buildProvenanceInstruction(p);
    assert.match(rule, /do @riba2534/);
    assert.match(rule, /KHÔNG phải sản phẩm hay tính năng chính hãng của Claude Code\/Anthropic/);
  });

  it("flags vendor-credited headlines and leads", () => {
    for (const output of [
      "CLAUDE CODE RA MẮT MOD TYPING-SPEED\n\nMod giúp xem tốc độ gõ prompt.",
      "Mod theo dõi tốc độ gõ\n\nAnthropic vừa bổ sung mod typing-speed cho Claude Code.",
      "Mod theo dõi tốc độ gõ\n\nTính năng mới của Claude Code cho xem tốc độ gõ prompt.",
      "Mod theo dõi tốc độ gõ\n\nMod được Anthropic phát hành hôm nay.",
    ]) {
      assert.match(policy.findMisattribution(output, p), /Gán nhầm cho hãng/, output);
    }
  });

  it("accepts correctly attributed output", () => {
    for (const output of [
      "MOD 'TYPING-SPEED' CHO CLAUDE CODE HIỂN THỊ TỐC ĐỘ GÕ PROMPT\n\nLập trình viên @riba2534 phát hành mod typing-speed cho Claude Code.",
      "Mod typing-speed cho Claude Code\n\nMod hiển thị thống kê tốc độ gõ ngay trong giao diện Claude Code.",
    ]) {
      assert.equal(policy.findMisattribution(output, p), "", output);
    }
    assert.equal(policy.findMisattribution("CLAUDE CODE RA MẮT HOOKS\n\nx", { kind: "official", brands: p.brands }), "");
  });
});

describe("background wiring", () => {
  const background = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  const context = vm.createContext({ FeedWriterSummaryPolicy: policy });
  vm.runInContext(readFileSync(new URL("../utils.js", import.meta.url), "utf8"), context);
  vm.runInContext(background.slice(background.indexOf("function computeNgramOverlap("), background.indexOf("async function handleStream(")), context);
  vm.runInContext(background.slice(background.indexOf("// === SELF-CORRECTION ==="), background.indexOf("// === HISTORY ===")), context);

  it("misattribution is a blocking issue that triggers the revision pass", () => {
    context.provenance = policy.detectProvenance(modTweet);
    const result = vm.runInContext('postProcessOutput("Claude Code ra mắt mod typing-speed\\n\\nMod giúp xem tốc độ gõ prompt.", "", "summary", provenance)', context);
    context.result = { summary: result.text, issues: result.issues };
    assert.equal(vm.runInContext("blockingQualityIssues(result).length", context), 1);
  });

  it("adds the provenance rule to the system prompt", () => {
    assert.match(background, /if \(provenanceRule\) systemPrompt \+= "\\n\\n" \+ provenanceRule;/);
  });
});
