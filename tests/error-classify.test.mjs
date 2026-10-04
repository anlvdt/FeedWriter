/**
 * Regression test for the "fake quota lockout" bug: provider errors about
 * models/params (400 "invalid model", "max_tokens too large", context length)
 * used to match the bare /invalid/ regex → 1h cooldown per key → all keys
 * poisoned → user sees "hết quota" for an hour.
 *
 * Extracts isModelError / isContextError / classifyProviderError from
 * bg-api.js via vm (same technique as headline-guard.test.mjs).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../bg-api.js", import.meta.url), "utf8");
const context = vm.createContext({});
// Slice from isModelError through the end of classifyProviderError
const start = src.indexOf("function isModelError(");
const end = src.indexOf("const MAX_OUTPUT_TOKENS", start);
assert.ok(start >= 0 && end > start, "could not locate classifier block");
// classifyProviderError calls parseRetryAfter — stub it
vm.runInContext(
  "function parseRetryAfter(m){ const s = String(m||'').match(/retry.?after:?\\s*(\\d+)/i); return s ? +s[1]*1000 : 900000; }" +
    src.slice(start, end),
  context,
);

const classify = (msg, status) => {
  context.__msg = msg;
  context.__status = status;
  return vm.runInContext(
    "classifyProviderError(__msg, __status)",
    context,
  );
};

describe("classifyProviderError — no fake quota lockout", () => {
  it("does NOT classify 'invalid model' as a bad API key", () => {
    const r = classify("Groq API lỗi (400): The model `bad-model` does not exist or is invalid", 400);
    assert.equal(r.kind, "model");
    assert.ok(r.cooldownMs < 60_000, "model errors get short cooldown");
  });

  it("does NOT classify 'max_tokens too large' as invalid key", () => {
    const r = classify("Invalid value for max_tokens: 8192 exceeds maximum", 400);
    assert.equal(r.kind, "context");
    assert.ok(r.cooldownMs < 60_000);
  });

  it("does NOT classify context-length errors as invalid key", () => {
    const r = classify("context_length_exceeded: reduce the length of the messages", 400);
    assert.equal(r.kind, "context");
  });

  it("classifies Groq TPM 413 as tpm, not context or a bad key", () => {
    const r = classify(
      "Request too large for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Requested 14368",
      413,
    );
    assert.equal(r.kind, "tpm");
    assert.ok(r.cooldownMs <= 30_000);
  });

  it("still classifies real bad keys as invalid (1h)", () => {
    const r = classify("Incorrect API key provided: gsk_xxx", 401);
    assert.equal(r.kind, "invalid");
    assert.equal(r.cooldownMs, 60 * 60 * 1000);
  });

  it("still classifies 401/403 status as invalid", () => {
    assert.equal(classify("whatever", 401).kind, "invalid");
    assert.equal(classify("forbidden", 403).kind, "invalid");
  });

  it("classifies 429 / rate-limit messages as rate", () => {
    assert.equal(classify("Rate limit reached", 429).kind, "rate");
    assert.equal(classify("quota exceeded", 0).kind, "rate");
  });

  it("classifies timeouts as timeout (45s)", () => {
    const r = classify("Request timeout after 30s");
    assert.equal(r.kind, "timeout");
    assert.equal(r.cooldownMs, 45_000);
  });

  it("classifies 5xx as server (90s)", () => {
    const r = classify("Internal server error", 503);
    assert.equal(r.kind, "server");
    assert.equal(r.cooldownMs, 90_000);
  });

  it("classifies 402 / payment-required as billing (6h, not generic 2min)", () => {
    const r = classify("Payment required to access this resource. Visit your billing tab.", 402);
    assert.equal(r.kind, "billing");
    assert.equal(r.cooldownMs, 6 * 60 * 60 * 1000);
    // Message-only variant (some providers omit the status)
    assert.equal(
      classify("insufficient balance for this request", 400).kind,
      "billing",
    );
  });

  it("billing errors are not classified as invalid or rate", () => {
    const r = classify("402 Payment Required", 402);
    assert.notEqual(r.kind, "invalid");
    assert.notEqual(r.kind, "rate");
  });
});

// Regression: Groq answers a per-minute TOKEN quota with HTTP 413 "Request too
// large … on tokens per minute (TPM)". That is a rate limit, not a context
// overflow — classifying it as "context" made the app tell users their (often
// short) post was "too long" and to select a shorter passage, which never
// helped because the budget is dominated by the system prompt + reserved
// output tokens, not the user's text.
describe("classifyProviderError — token-per-interval limits are rate/tpm, not context", () => {
  it("classifies Groq 413 TPM 'Request too large' as tpm", () => {
    const r = classify(
      "Request too large for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Requested 8500, please reduce your message size and try again in 8.35s.",
      413,
    );
    assert.equal(r.kind, "tpm");
  });

  it("classifies Groq tokens-per-day (TPD) limit as rate", () => {
    const r = classify(
      "Rate limit reached on tokens per day (TPD): Limit 500000. Please try again in 2m30s.",
      429,
    );
    assert.equal(r.kind, "rate");
  });

  it("classifies Gemini RESOURCE_EXHAUSTED as rate", () => {
    assert.equal(classify("Resource has been exhausted (e.g. check quota).", 429).kind, "rate");
  });

  it("STILL classifies a genuine context-window overflow as context", () => {
    const r = classify(
      "This model's maximum context length is 8192 tokens, however you requested 20000 (context_length_exceeded).",
      400,
    );
    assert.equal(r.kind, "context");
  });

  it("STILL treats a bare 413 with no rate wording as context", () => {
    assert.equal(classify("Payload too large", 413).kind, "context");
  });
});
