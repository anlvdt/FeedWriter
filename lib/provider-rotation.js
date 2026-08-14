/**
 * Pure provider/API-key selection logic for unit testing.
 *
 * Keep in sync with bg-api.js (selectAvailableKey / parseRetryAfter).
 * CommonJS so Node tests can require() without a bundler.
 * Extension SW cannot import this module; bg-api.js hosts the same algorithm.
 */
"use strict";

const PROVIDER_PRIORITY = [
  "groq",
  "cerebras",
  "sambanova",
  "gemini",
  "openrouter",
];

const EMPTY_API_KEYS = {
  groq: [],
  gemini: [],
  cerebras: [],
  sambanova: [],
  openrouter: [],
};

/**
 * Select the next available API key across providers (pure).
 *
 * @param {object} opts
 * @param {object|null|undefined} opts.apiKeys - { groq: string[], ... }
 * @param {string|null|undefined} opts.legacyApiKey - old single-key storage
 * @param {string|null|undefined} opts.legacyProvider - provider for legacy key
 * @param {object} [opts.keyStatus] - { [key]: { rateLimitedUntil, lastUsed } }
 * @param {object} [opts.rotationIndex] - { [provider]: number }
 * @param {string|null} [opts.preferredProvider]
 * @param {number} opts.now - epoch ms
 * @returns {{ key: string, provider: string, index: number, newRotationIndex: object, newKeyStatus: object }
 *   | { noKeys: true, key?: null, provider?: null }
 *   | { allLimited: true, waitMinutes: number, total: number, key?: null, provider?: null }}
 */
function selectAvailableKey(opts) {
  const {
    legacyApiKey = null,
    legacyProvider = "groq",
    preferredProvider = null,
    now,
  } = opts;

  let apiKeys = opts.apiKeys;
  let hasAnyKey = false;
  if (apiKeys) {
    for (const p in apiKeys) {
      if (apiKeys[p] && apiKeys[p].length > 0) hasAnyKey = true;
    }
  }

  if (!apiKeys) {
    apiKeys = { ...EMPTY_API_KEYS };
  } else {
    // Shallow-clone so we can push legacy keys without mutating caller state
    apiKeys = { ...apiKeys };
    for (const p of Object.keys(apiKeys)) {
      if (Array.isArray(apiKeys[p])) apiKeys[p] = apiKeys[p].slice();
    }
  }

  // Fallback to legacy single key when no multi-key entries
  if (!hasAnyKey && legacyApiKey) {
    const provider = legacyProvider || "groq";
    if (!apiKeys[provider]) apiKeys[provider] = [];
    if (!apiKeys[provider].includes(legacyApiKey)) {
      apiKeys[provider].push(legacyApiKey);
    }
  }

  const keyStatus = { ...(opts.keyStatus || {}) };
  const rotationIndex = { ...(opts.rotationIndex || {}) };

  const orderedProviders =
    preferredProvider && PROVIDER_PRIORITY.includes(preferredProvider)
      ? [
          preferredProvider,
          ...PROVIDER_PRIORITY.filter((p) => p !== preferredProvider),
        ]
      : PROVIDER_PRIORITY;

  for (const provider of orderedProviders) {
    const keys = apiKeys[provider] || [];
    if (keys.length === 0) continue;

    const startIdx = (rotationIndex[provider] || 0) % keys.length;
    for (let i = 0; i < keys.length; i++) {
      const idx = (startIdx + i) % keys.length;
      const key = keys[idx];
      const status = keyStatus[key] || {};

      if (!status.rateLimitedUntil || now >= status.rateLimitedUntil) {
        const newRotationIndex = {
          ...rotationIndex,
          [provider]: (idx + 1) % keys.length,
        };
        const newKeyStatus = {
          ...keyStatus,
          [key]: { ...(keyStatus[key] || {}), lastUsed: now },
        };
        return {
          key,
          provider,
          index: idx,
          newRotationIndex,
          newKeyStatus,
        };
      }
    }
  }

  // All keys across all providers are rate-limited (or empty)
  let soonestTime = Infinity;
  let totalKeys = 0;
  for (const provider of PROVIDER_PRIORITY) {
    const keys = apiKeys[provider] || [];
    totalKeys += keys.length;
    for (const key of keys) {
      const until = (keyStatus[key] || {}).rateLimitedUntil || 0;
      if (until < soonestTime) soonestTime = until;
    }
  }

  if (totalKeys === 0) {
    return { key: null, provider: null, noKeys: true };
  }
  const waitMinutes = Math.max(1, Math.ceil((soonestTime - now) / 60000));
  return {
    key: null,
    provider: null,
    allLimited: true,
    waitMinutes,
    total: totalKeys,
  };
}

/**
 * Parse retry-after duration from provider error messages (ms).
 * Keep in sync with bg-api.js parseRetryAfter.
 */
function parseRetryAfter(errorMessage) {
  const match = errorMessage?.match(/try again in (\d+)m([\d.]+)s/i);
  if (match) return (parseInt(match[1], 10) * 60 + parseFloat(match[2])) * 1000;
  const secMatch = errorMessage?.match(/retry.?after:?\s*(\d+)/i);
  if (secMatch) return parseInt(secMatch[1], 10) * 1000;
  const m2 = errorMessage?.match(/in\s+(\d+)\s*m(?:in(?:ute)?s?)?/i);
  if (m2) return parseInt(m2[1], 10) * 60 * 1000;
  return 15 * 60 * 1000;
}

async function hashKeyId(key) {
  if (!key) return "";
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) return "legacy:" + String(key).slice(0, 12);
  const buf = await subtle.digest("SHA-256", new TextEncoder().encode(String(key)));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 20);
}

module.exports = {
  PROVIDER_PRIORITY,
  selectAvailableKey,
  parseRetryAfter,
  hashKeyId,
};
