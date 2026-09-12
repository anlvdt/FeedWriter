/**
 * Tests for lib/model-registry.js — per-provider model resolution and
 * override sanitization. Pure module, no chrome APIs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const reg = require(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "lib",
    "model-registry.js",
  ),
);

const PROVIDERS = ["groq", "cerebras", "sambanova", "gemini", "openrouter"];

describe("model registry defaults", () => {
  it("has a default model for every provider", () => {
    for (const p of PROVIDERS) {
      assert.ok(reg.defaultModel(p), `missing default for ${p}`);
    }
  });

  it("each provider's default is first in its model list", () => {
    for (const p of PROVIDERS) {
      const models = reg.listModels(p);
      assert.ok(models.length > 0, `no models listed for ${p}`);
      assert.equal(models[0].id, reg.defaultModel(p));
    }
  });

  it("keeps the provider defaults", () => {
    assert.equal(reg.defaultModel("groq"), "openai/gpt-oss-120b");
    assert.equal(reg.defaultModel("cerebras"), "gpt-oss-120b");
    assert.equal(reg.defaultModel("sambanova"), "Meta-Llama-3.3-70B-Instruct");
    assert.equal(reg.defaultModel("gemini"), "gemini-3.1-flash-lite");
    assert.equal(reg.defaultModel("openrouter"), "openai/gpt-oss-120b");
  });
});

describe("resolveModel", () => {
  it("returns the provider default when no override", () => {
    assert.equal(reg.resolveModel("groq", {}), "openai/gpt-oss-120b");
    assert.equal(reg.resolveModel("groq"), "openai/gpt-oss-120b");
    assert.equal(reg.resolveModel("groq", null), "openai/gpt-oss-120b");
  });

  it("returns a valid user override", () => {
    const overrides = { groq: "llama-3.3-70b-versatile" };
    assert.equal(reg.resolveModel("groq", overrides), "llama-3.3-70b-versatile");
  });

  it("falls back to default on invalid override", () => {
    for (const bad of ["", "  ", "<script>", "a".repeat(200), {}, 42, null]) {
      assert.equal(
        reg.resolveModel("groq", { groq: bad }),
        "openai/gpt-oss-120b",
        `bad value should not resolve: ${JSON.stringify(bad)}`,
      );
    }
  });

  it("accepts OpenRouter :free suffix style ids", () => {
    assert.equal(reg.isValidModelId("meta-llama/llama-3.3-70b-instruct:free"), true);
  });

  it("rejects ids that could break the Gemini URL path", () => {
    assert.equal(reg.isValidModelId("../escape"), false);
    assert.equal(reg.isValidModelId("model?query=1"), false);
    assert.equal(reg.isValidModelId("model&x=1"), false);
    assert.equal(reg.isValidModelId("model name"), false);
  });
});

describe("sanitizeOverrides", () => {
  it("drops unknown providers and invalid ids", () => {
    const clean = reg.sanitizeOverrides({
      groq: "llama-3.3-70b-versatile",
      evil: "gpt-4",
      gemini: "<img onerror=x>",
      cerebras: 42,
    });
    assert.deepEqual(clean, { groq: "llama-3.3-70b-versatile" });
  });

  it("handles non-object input", () => {
    assert.deepEqual(reg.sanitizeOverrides(null), {});
    assert.deepEqual(reg.sanitizeOverrides("x"), {});
    assert.deepEqual(reg.sanitizeOverrides([1, 2]), {});
  });
});

describe("fast tier (task-based routing)", () => {
  it("has a fast model for every provider", () => {
    for (const p of PROVIDERS) {
      assert.ok(reg.fastModel(p), `missing fast model for ${p}`);
    }
  });

  it("routes translate/test tasks to the fast tier", () => {
    assert.equal(reg.resolveModel("groq", {}, "translate"), reg.fastModel("groq"));
    assert.equal(reg.resolveModel("gemini", {}, "test"), reg.fastModel("gemini"));
  });

  it("summary tasks keep the default model", () => {
    assert.equal(reg.resolveModel("groq", {}, "summary"), "openai/gpt-oss-120b");
    assert.equal(reg.resolveModel("groq", {}), "openai/gpt-oss-120b");
  });

  it("user override wins over fast tier", () => {
    const overrides = { groq: "llama-3.3-70b-versatile" };
    assert.equal(
      reg.resolveModel("groq", overrides, "translate"),
      "llama-3.3-70b-versatile",
    );
  });
});
