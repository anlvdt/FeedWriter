// Cases from the history export of 2026-10-04 (newest entries).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import { TextEncoder } from "node:util";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const policy = require("../lib/summary-policy.js");
const { cleanSourceUrl } = require("../lib/url-clean.js");
const background = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const context = vm.createContext({ FeedWriterSummaryPolicy: policy });
vm.runInContext(readFileSync(new URL("../utils.js", import.meta.url), "utf8"), context);
vm.runInContext(background.slice(background.indexOf("function computeNgramOverlap("), background.indexOf("async function handleStream(")), context);
vm.runInContext(background.slice(background.indexOf("// === SELF-CORRECTION ==="), background.indexOf("// === HISTORY ===")), context);
const post = (output, source, provenance = null) => {
  Object.assign(context, { output, source, provenance });
  return vm.runInContext('postProcessOutput(output, source, "summary", provenance)', context);
};
const blocking = (result) => {
  context.result = { summary: result.text, issues: result.issues };
  return vm.runInContext("blockingQualityIssues(result)", context);
};

describe("#7 /cache: a community mod credited to Claude Code", () => {
  const source = "Run /cache and you’ll get a full panel showing how the cache is behaving throughout your session.\n\nThis is one of those Mods that should be installed in every Claude Code setup";
  const provenance = policy.detectProvenance({ text: source, author: "Daniel San", sourceUrl: "https://x.com/dani_avila7/status/2106455608090099799" });
  const reported = "CHẠY /CACHE TRONG CLAUDE CODE HIỂN THỊ BẢNG ĐIỀU KHIỂN BỘ NHỚ ĐỆM\n\nClaude Code, môi trường phát triển AI, đã bổ sung một Mod mới cho phép người dùng nhập lệnh /cache.";

  it("'Mods' next to Claude Code marks community work", () => {
    assert.equal(provenance.kind, "community");
    assert.equal(provenance.noun, "mod");
    assert.match(policy.buildProvenanceInstruction(provenance), /mod do @dani_avila7/);
  });

  it("flags the vendor credit even through an appositive, and drops the invented descriptor", () => {
    const result = post(reported, source, provenance);
    assert.ok(blocking(result).some((issue) => issue.includes("Gán nhầm cho hãng")));
    assert.match(result.text, /\n\nClaude Code đã bổ sung một Mod mới/);
    assert.doesNotMatch(result.text, /môi trường phát triển AI/);
  });

  it("a vendor release that mentions mods stays unknown", () => {
    assert.equal(policy.detectProvenance({ text: "Anthropic launched plugins for Claude Code; the community calls them mods.", sourceUrl: "https://www.theverge.com/x" }).kind, "unknown");
  });
});

describe("#2 Antigravity: the author's suggestion stated as fact", () => {
  const source = "Antigravity added Claude Opus 5.5 and Sonnet 5.5.\n\nGPT-OSS 120B leaves Antigravity on November 2.\n\nAdd Gemini 4 Argon to the paid plans, and they get hard to beat.";

  it("is a blocking issue", () => {
    const result = post("ANTIGRAVITY BỔ SUNG CLAUDE OPUS 5.5\n\nĐồng thời, Antigravity cũng bổ sung Gemini 4 Argon vào các gói trả phí.", source);
    assert.ok(blocking(result).some((issue) => issue.includes("Biến giả định thành sự thật")));
  });

  it("a hedged sentence passes", () => {
    const result = post("ANTIGRAVITY BỔ SUNG CLAUDE OPUS 5.5\n\nTác giả cho rằng nếu thêm Gemini 4 Argon, các gói trả phí sẽ khó bị cạnh tranh.", source);
    assert.ok(!result.issues.some((issue) => issue.includes("Biến giả định")));
  });
});

describe("glossary", () => {
  it("does not explain product names or common terms (#6 T3, #8 open-source, #19 LLM, #30 CLI)", () => {
    for (const text of [
      "Made more improvements to the usage view in T3 Code.",
      "It's called openGym, free and open-source.",
      "Ask your LLM to explain something in ASD-STE100.",
      "MonoCode bundles Claude Code, Codex, Cursor CLI and OpenCode.",
      "Kimi K3 tops the benchmark",
    ]) {
      const decision = policy.decideGlossary({ site: "x", text });
      assert.ok(!decision.candidates.some((c) => /^(T3|open-source|LLM|CLI|K3)$/i.test(c.term)), text);
    }
  });

  it("gives MCP its real meaning (#25 said 'giao diện quản lý phiên')", () => {
    const decision = policy.decideGlossary({ site: "x", text: "AgentHydra exposes an MCP server for session control." });
    assert.equal(decision.candidates[0].term, "MCP");
    assert.match(policy.buildGlossaryInstruction(decision), /MCP = Model Context Protocol/);
  });

  it("keeps versioned standards whose letters are known (DDR5)", () => {
    assert.ok(policy.extractGlossaryCandidates("RAM DDR5 và H100").some((c) => c.term === "DDR5"));
    assert.ok(!policy.extractGlossaryCandidates("RAM DDR5 và H100").some((c) => c.term === "H100"));
  });
});

describe("history records version and provider", () => {
  it("stores both so exported history can be traced to a build", async () => {
    const state = { history: [] };
    const chrome = {
      runtime: { getManifest: () => ({ version: "9.9.9" }) },
      storage: { local: {
        async get(keys) { return Object.fromEntries([].concat(keys).map((k) => [k, state[k]])); },
        async set(data) { Object.assign(state, data); },
      } },
    };
    const ctx = vm.createContext({ chrome, crypto, TextEncoder, JSON, Date, cleanSourceUrl, logger: { warn() {} }, formatVietnamIsoString: () => "2026-10-04" });
    vm.runInContext("let historyWriteQueue = Promise.resolve(); const HISTORY_MAX_ITEMS = 200; const HISTORY_MAX_BYTES = 2 * 1024 * 1024;", ctx);
    vm.runInContext(background.slice(background.indexOf("function compactHistoryForStorage"), background.indexOf("// reviewTodayHistory")), ctx);
    await vm.runInContext('saveHistory("src", "out", "x", "summary", "https://x.com/a/status/1", "", "", "", null, "groq")', ctx);
    assert.equal(state.history[0].version, "9.9.9");
    assert.equal(state.history[0].provider, "groq");
  });
});
