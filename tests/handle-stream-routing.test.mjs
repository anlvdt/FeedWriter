// Runs the real service-worker bundle with fake chrome storage and provider
// endpoints, and checks which prompt each provider receives.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const sw = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8");
const store = { local: { apiKeys: { groq: ["gsk_test1234567890"], gemini: ["AIzaTest1234567890"] } }, sync: {} };
const listeners = () => ({ addListener() {}, removeListener() {}, hasListener() { return false; } });
const area = (name) => ({
  async get(keys, cb) { const ks = keys == null ? Object.keys(store[name]) : Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : Object.keys(keys);
    const out = Object.fromEntries(ks.filter(k => k in store[name]).map(k => [k, structuredClone(store[name][k])])); if (cb) cb(out); return out; },
  async set(v, cb) { Object.assign(store[name], structuredClone(v)); cb && cb(); },
  async remove(ks, cb) { for (const k of [].concat(ks)) delete store[name][k]; cb && cb(); },
  setAccessLevel: async () => {}, onChanged: listeners(),
});
const chrome = new Proxy({
  storage: { local: area("local"), sync: area("sync"), session: area("local"), onChanged: listeners() },
  runtime: { onMessage: listeners(), onConnect: listeners(), onInstalled: listeners(), onStartup: listeners(), getManifest: () => ({ version: "2.8.1" }), id: "x", lastError: null, getURL: (p) => p },
}, { get(t, k) { if (k in t) return t[k]; return new Proxy(function () {}, { get: (_, kk) => kk === "then" ? undefined : (["addListener","removeListener"].includes(kk) ? () => {} : chrome[kk] || (async () => ({}))), apply: async () => ({}) }); } });
const calls = [];
let headlineReply = "";
let article = "OPENAI MỞ API GIỌNG NÓI CHO MỌI NHÀ PHÁT TRIỂN\n\nOpenAI mở API giọng nói cho mọi nhà phát triển với giá 0.06 USD mỗi phút.\n\nAPI hỗ trợ 12 ngôn ngữ.";
async function fakeFetch(url, opts = {}) {
  const body = JSON.parse(opts.body || "{}");
  const provider = /groq/.test(url) ? "groq" : /googleapis/.test(url) ? "gemini" : url;
  const system = body.messages?.[0]?.content || body.system_instruction?.parts?.[0]?.text || "";
  calls.push({ provider, system, systemChars: system.length, compact: system.startsWith("Bạn là biên tập viên báo chí công nghệ tiếng Việt. Viết lại nguồn thành MỘT"), extract: /trích|TRÍCH/.test(system.slice(0, 300)) });
  // Non-stream calls (headline shortening) get JSON with headlineReply.
  if (!body.stream && !/streamGenerateContent/.test(url)) {
    const content = /^Bạn là biên tập viên báo chí công nghệ tiếng Việt\. Viết lại tiêu đề cho NGẮN/.test(system) ? headlineReply : article;
    const json = provider === "gemini"
      ? { candidates: [{ content: { parts: [{ text: content }] } }] }
      : { choices: [{ message: { content } }] };
    return new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });
  }
  const sse = provider === "gemini"
    ? `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: article }] } }] })}\n\n`
    : `data: ${JSON.stringify({ choices: [{ delta: { content: article } }] })}\n\ndata: [DONE]\n\n`;
  return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
}
const ctx = vm.createContext({ chrome, fetch: fakeFetch, console: { log() {}, warn() {}, error() {}, info() {}, debug() {} }, setTimeout, clearTimeout, setInterval, clearInterval,
  TextEncoder, TextDecoder, Response, Headers, AbortController, URL, URLSearchParams, crypto, structuredClone, navigator: { userAgent: "node" }, self: {}, performance, queueMicrotask, Blob, atob, btoa });
ctx.globalThis = ctx; ctx.self = ctx; ctx.addEventListener = () => {}; ctx.removeEventListener = () => {};
vm.runInContext(sw, ctx);
const handleStream = vm.runInContext("handleStream", ctx);

async function summarize(text, prefer) {
  calls.length = 0;
  const port = { postMessage() {} };
  const result = await handleStream(text, "x", port, new AbortController().signal, "https://x.com/someone/status/1", "", "someone", "", "X", null, null, null, prefer, "summary");
  return { result, calls: calls.map((c) => ({ ...c })) };
}

const shortPost = "OpenAI opens its voice API to all developers today. Pricing is $0.06 per minute and it supports 12 languages. ".repeat(4);

describe("handleStream prompt routing (service-worker bundle)", () => {
  // The 2026-09-28 build wrote a short post in one call with the full prompt
  // on every provider; that is the behaviour users rate highest.
  for (const provider of ["groq", "gemini"]) {
    it("writes a short post in one " + provider + " call with the full prompt", async () => {
      const { result, calls: made } = await summarize(shortPost, provider);
      assert.ok(result.summary, result.error);
      assert.equal(made.length, 1);
      assert.equal(made[0].provider, provider);
      assert.ok(made[0].systemChars > 15000, String(made[0].systemChars));
    });
  }
});

describe("list posts keep every source link", () => {
  const source = readFileSync(new URL("./fixtures/github-list-post.txt", import.meta.url), "utf8");
  const urls = [...source.matchAll(/https?:\/\/\S+/g)].map((m) => m[0]);

  it("lists the links in the prompt, revises, and appends what is still missing", async () => {
    const saved = article;
    // The fake model drops the last three projects every time.
    article = "10 DỰ ÁN GIÚP AI AGENT KIỂM CHỨNG CÂU TRẢ LỜI\n\nDanh sách dự án open-source giúp AI agent dẫn bằng chứng.\n\n" +
      urls.slice(0, 7).map((url, i) => "· Dự án " + (i + 1) + ": mô tả — " + url).join("\n");
    try {
      const { result, calls: made } = await summarize(source, "gemini");
      assert.ok(result.summary, result.error);
      const writing = made.filter((c) => /BẮT BUỘC GIỮ ĐỦ 10 LINK/.test(c.system));
      assert.ok(writing.length >= 1, "the article prompt lists every link");
      assert.ok(made.some((c) => /Thiếu link nguồn: 3\/10/.test(c.system)), "one revision names the missing links");
      for (const url of urls) assert.ok(result.summary.includes(url), url);
      assert.match(result.summary, /Liên kết:\n· Open Deep Research: https:\/\/github\.com\/langchain-ai\/open_deep_research/);
    } finally {
      article = saved;
    }
  });

  it("keeps the link list in the long-post (fact sheet + compact) prompt", async () => {
    const saved = article;
    article = "10 DỰ ÁN GIÚP AI AGENT KIỂM CHỨNG CÂU TRẢ LỜI\n\n" + urls.map((url) => "· Dự án: mô tả — " + url).join("\n");
    try {
      const { calls: made } = await summarize(source, "groq");
      // Earlier tests may have used Groq's simulated minute budget, so the
      // rotation can hand the article to another provider; either way the
      // prompt that writes it must carry the links.
      assert.ok(made.some((c) => /^Trích dữ kiện/.test(c.system)), "long list post is read in parts");
      assert.ok(made.some((c) => !/^Trích dữ kiện/.test(c.system) && /https:\/\/github\.com\/HKUDS\/LightRAG/.test(c.system)));
    } finally {
      article = saved;
    }
  });
});

describe("a community tool is not called a mod", () => {
  it("revises once, then replaces a leftover 'mod' with the source's kind", async () => {
    const saved = article;
    article = "MOD AGENT MONITOR CHO CLAUDE CODE GIÚP HIỂN THỊ TRỰC QUAN CÁC TRACE\n\nMod Agent Monitor của donvito cho phép xem trực quan trace của Claude Code, Codex hoặc Pi.";
    try {
      const source = "If you want to entertain yourself, download Agent Monitor\n\nIt's a visualizer of your Codex, Claude Code or Pi traces\n\nMore fun if you're using subagents\nhttps://github.com/donvito/agent-monitor";
      const { result, calls: made } = await summarize(source, "gemini");
      assert.ok(result.summary, result.error);
      assert.equal(made.length, 2, "first draft + one revision");
      assert.match(made[0].system, /là công cụ do @someone/);
      assert.match(made[1].system, /Gọi sai loại sản phẩm/);
      assert.match(result.summary, /^CÔNG CỤ AGENT MONITOR/);
      assert.doesNotMatch(result.summary, /\bmod\b/i);
    } finally {
      article = saved;
    }
  });
});

describe("long headlines", () => {
  const source = "Doubao, WorkBuddy, Claude Code and DeepSeek Harness can now call Codex's built-in image generation. Make Xiaohongshu and YouTube covers or turn posts into infographics right from those agents.";
  const lead = "Việc tích hợp này cho phép người dùng tạo ảnh bìa cho Xiaohongshu, YouTube hoặc chuyển nội dung thành infographic ngay trong các công cụ này.";
  const reported = "Các công cụ AI agent như Doubao, WorkBuddy, Claude Code và DeepSeek Harness hiện đã có thể gọi tính năng tạo ảnh tích hợp của Codex. " + lead;

  it("splits a lead glued to the headline and shortens the headline in one small call", async () => {
    const saved = [article, headlineReply];
    article = reported;
    headlineReply = "Doubao, Claude Code và DeepSeek Harness gọi được tính năng tạo ảnh của Codex";
    try {
      const { result, calls: made } = await summarize(source, "gemini");
      assert.ok(result.summary, result.error);
      const [headline, , body] = result.summary.split("\n");
      assert.equal(headline, "DOUBAO, CLAUDE CODE VÀ DEEPSEEK HARNESS GỌI ĐƯỢC TÍNH NĂNG TẠO ẢNH CỦA CODEX");
      assert.equal(body, lead);
      assert.ok(made.some((c) => /Viết lại tiêu đề cho NGẮN/.test(c.system)), "headline-only call");
      assert.ok(result.issues.some((i) => i.includes("Đã rút gọn tiêu đề")));
    } finally {
      [article, headlineReply] = saved;
    }
  });

  it("keeps the original headline when the shorter one is cut off or adds a number", async () => {
    for (const reply of [
      "Doubao, Claude Code và DeepSeek Harness gọi được tính năng tạo ảnh của",
      "Bốn công cụ AI agent gọi được 3 tính năng tạo ảnh của Codex",
      "",
    ]) {
      const saved = [article, headlineReply];
      article = reported;
      headlineReply = reply;
      try {
        const { result } = await summarize(source, "gemini");
        assert.match(result.summary.split("\n")[0], /^CÁC CÔNG CỤ AI AGENT NHƯ DOUBAO/, reply);
        assert.ok(result.issues.some((i) => i.includes("Tiêu đề quá dài")), reply);
      } finally {
        [article, headlineReply] = saved;
      }
    }
  });
});
