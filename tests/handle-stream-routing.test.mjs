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
let article = "OPENAI MỞ API GIỌNG NÓI CHO MỌI NHÀ PHÁT TRIỂN\n\nOpenAI mở API giọng nói cho mọi nhà phát triển với giá 0.06 USD mỗi phút.\n\nAPI hỗ trợ 12 ngôn ngữ.";
async function fakeFetch(url, opts = {}) {
  const body = JSON.parse(opts.body || "{}");
  const provider = /groq/.test(url) ? "groq" : /googleapis/.test(url) ? "gemini" : url;
  const system = body.messages?.[0]?.content || body.system_instruction?.parts?.[0]?.text || "";
  calls.push({ provider, system, systemChars: system.length, compact: system.startsWith("Bạn là biên tập viên báo chí công nghệ tiếng Việt. Viết lại nguồn thành MỘT"), extract: /trích|TRÍCH/.test(system.slice(0, 300)) });
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
  it("writes a short post in one Groq call with the compact prompt", async () => {
    const { result, calls: made } = await summarize(shortPost, "groq");
    assert.ok(result.summary, result.error);
    assert.equal(made.length, 1);
    assert.equal(made[0].provider, "groq");
    assert.equal(made[0].compact, true);
  });

  it("gives other providers the full prompt, without splitting a short post", async () => {
    const { result, calls: made } = await summarize(shortPost, "gemini");
    assert.ok(result.summary, result.error);
    assert.equal(made.length, 1);
    assert.equal(made[0].provider, "gemini");
    assert.ok(made[0].systemChars > 15000, String(made[0].systemChars));
  });
});

describe("list posts keep every source link", () => {
  const source = readFileSync(new URL("./fixtures/github-list-post.txt", import.meta.url), "utf8");
  const urls = [...source.matchAll(/https?:\/\/\S+/g)].map((m) => m[0]);

  it("lists the links in the prompt, revises once, and appends what is still missing", async () => {
    const saved = article;
    // The fake model drops the last three projects every time.
    article = "10 DỰ ÁN GIÚP AI AGENT KIỂM CHỨNG CÂU TRẢ LỜI\n\nDanh sách dự án open-source giúp AI agent dẫn bằng chứng.\n\n" +
      urls.slice(0, 7).map((url, i) => "· Dự án " + (i + 1) + ": mô tả — " + url).join("\n");
    try {
      const { result, calls: made } = await summarize(source, "gemini");
      assert.ok(result.summary, result.error);
      assert.equal(made.length, 2, "first draft + one revision");
      assert.match(made[0].system, /BẮT BUỘC GIỮ ĐỦ 10 LINK/);
      assert.match(made[1].system, /Thiếu link nguồn: 3\/10/);
      for (const url of urls) assert.ok(result.summary.includes(url), url);
      assert.match(result.summary, /Liên kết:\n· Open Deep Research: https:\/\/github\.com\/langchain-ai\/open_deep_research/);
      assert.ok(result.issues.some((issue) => issue.includes("Đã bổ sung 3 link")));
    } finally {
      article = saved;
    }
  });

  it("gives Groq the link list in the compact prompt too", async () => {
    const saved = article;
    article = "10 DỰ ÁN GIÚP AI AGENT KIỂM CHỨNG CÂU TRẢ LỜI\n\n" + urls.map((url) => "· Dự án: mô tả — " + url).join("\n");
    try {
      const { calls: made } = await summarize(source, "groq");
      assert.equal(made[0].provider, "groq");
      assert.equal(made[0].compact, true);
      assert.match(made[0].system, /https:\/\/github\.com\/HKUDS\/LightRAG/);
      assert.equal(made.length, 1);
    } finally {
      article = saved;
    }
  });
});
