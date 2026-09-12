/**
 * FeedWriter model registry.
 *
 * Single source of truth for which models each provider can run. The service
 * worker bundle includes this file (see scripts/build-sw.py) and the popup
 * loads it via <script>; tests require() it. Keep dependency-free.
 *
 * Custom model IDs are allowed — the registry lists known-good options but
 * resolveModel() accepts any sane non-empty string so users can adopt new
 * provider models without waiting for an extension update.
 */
"use strict";

(function initModelRegistry(root) {
  const DEFAULT_MODELS = {
    groq: "openai/gpt-oss-120b",
    cerebras: "gpt-oss-120b",
    sambanova: "Meta-Llama-3.3-70B-Instruct",
    gemini: "gemini-3.1-flash-lite",
    openrouter: "openai/gpt-oss-120b",
  };

  // Known-good models per provider, offered as datalist suggestions in the
  // popup. Order: default first, then sensible alternatives. Verified against
  // provider model catalogs 2026-09 — e.g. gemini-2.0-flash shut down
  // 2026-06-01, Cerebras/SambaNova dropped the small Llama 8B/3.1 models.
  const MODEL_REGISTRY = {
    groq: [
      { id: "openai/gpt-oss-120b", label: "GPT OSS 120B (mặc định)" },
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile" },
      { id: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout 17B" },
      { id: "qwen/qwen3-32b", label: "Qwen3 32B" },
      { id: "openai/gpt-oss-20b", label: "GPT OSS 20B (nhẹ, nhanh)" },
    ],
    cerebras: [
      { id: "gpt-oss-120b", label: "GPT OSS 120B (mặc định)" },
      { id: "zai-glm-4.7", label: "GLM 4.7" },
    ],
    sambanova: [
      { id: "Meta-Llama-3.3-70B-Instruct", label: "Llama 3.3 70B (mặc định)" },
      { id: "gpt-oss-120b", label: "GPT OSS 120B" },
      { id: "DeepSeek-V3.1", label: "DeepSeek V3.1" },
      { id: "MiniMax-M2.7", label: "MiniMax M2.7" },
    ],
    gemini: [
      { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite (mặc định, free tier)" },
      { id: "gemini-3-flash-preview", label: "Gemini 3 Flash (preview, free tier)" },
      { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
      { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (trả phí)" },
      { id: "gemini-flash-latest", label: "Flash mới nhất (auto hot-swap)" },
    ],
    openrouter: [
      { id: "openai/gpt-oss-120b", label: "GPT OSS 120B (mặc định)" },
      { id: "openai/gpt-oss-20b", label: "GPT OSS 20B (nhẹ)" },
      { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B Instruct" },
      { id: "qwen/qwen3-32b", label: "Qwen3 32B" },
      { id: "google/gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite (qua OR)" },
    ],
  };

  const PROVIDER_LABELS = {
    groq: "Groq",
    cerebras: "Cerebras",
    sambanova: "SambaNova",
    gemini: "Gemini",
    openrouter: "OpenRouter",
  };

  // Lighter/cheaper models for low-stakes tasks (translate, test-connection).
  // Summaries keep the default model for quality; these calls just need speed.
  const FAST_MODELS = {
    groq: "openai/gpt-oss-20b",
    // Cerebras has no smaller public model — gpt-oss-120b is already ~3k tok/s.
    cerebras: "gpt-oss-120b",
    // SambaNova removed Meta-Llama-3.1-8B-Instruct 2026-04-14.
    sambanova: "gpt-oss-120b",
    gemini: "gemini-3.1-flash-lite",
    openrouter: "openai/gpt-oss-20b",
  };

  // Tasks that may use the fast tier. Anything not listed uses the default.
  const FAST_TASKS = new Set(["translate", "test"]);

  // Model IDs are provider-defined slugs: letters, digits, dots, dashes,
  // slashes, colons (OpenRouter :free suffix), underscores.
  const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/:]{0,119}$/;

  function isValidModelId(id) {
    return typeof id === "string" && MODEL_ID_RE.test(id);
  }

  function listModels(provider) {
    return MODEL_REGISTRY[provider] || [];
  }

  function defaultModel(provider) {
    return DEFAULT_MODELS[provider] || "";
  }

  function fastModel(provider) {
    return FAST_MODELS[provider] || defaultModel(provider);
  }

  /**
   * Resolve which model a provider should run.
   * @param {string} provider
   * @param {object} [overrides] - { [provider]: modelId } from storage
   * @param {string} [task] - "translate" | "test" route to the fast tier
   * @returns {string} model id — override if valid, else tier-appropriate default
   */
  function resolveModel(provider, overrides, task) {
    const custom = overrides && overrides[provider];
    if (isValidModelId(custom)) return custom.trim();
    if (task && FAST_TASKS.has(task)) return fastModel(provider);
    return defaultModel(provider);
  }

  /**
   * Sanitize a raw overrides map from storage: drop unknown providers and
   * malformed ids so a corrupt/crafted storage value can't inject a bad URL
   * segment (Gemini embeds the model in the request path).
   */
  function sanitizeOverrides(raw) {
    const clean = {};
    if (!raw || typeof raw !== "object") return clean;
    for (const provider of Object.keys(DEFAULT_MODELS)) {
      const v = raw[provider];
      if (isValidModelId(v)) clean[provider] = v.trim();
    }
    return clean;
  }

  const api = {
    MODEL_REGISTRY,
    DEFAULT_MODELS,
    FAST_MODELS,
    FAST_TASKS,
    PROVIDER_LABELS,
    isValidModelId,
    listModels,
    defaultModel,
    fastModel,
    resolveModel,
    sanitizeOverrides,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FeedWriterModelRegistry = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
