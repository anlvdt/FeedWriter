/**
 * Tests for pure provider/API-key rotation (lib/provider-rotation.js).
 * Mirrors bg-api.js selectAvailableKey / parseRetryAfter — no chrome APIs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const {
  PROVIDER_PRIORITY,
  selectAvailableKey,
  parseRetryAfter,
} = require(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "lib",
    "provider-rotation.js",
  ),
);

const NOW = 1_700_000_000_000;

function emptyKeys() {
  return {
    groq: [],
    cerebras: [],
    nvidia: [],
    sambanova: [],
    gemini: [],
    openrouter: [],
  };
}

describe("PROVIDER_PRIORITY", () => {
  it("lists expected providers in order", () => {
    assert.deepEqual(PROVIDER_PRIORITY, [
      "groq",
      "cerebras",
      "nvidia",
      "sambanova",
      "gemini",
      "openrouter",
    ]);
  });
});

describe("selectAvailableKey — no keys", () => {
  it("returns noKeys when apiKeys empty and no legacy key", () => {
    const result = selectAvailableKey({
      apiKeys: emptyKeys(),
      legacyApiKey: null,
      keyStatus: {},
      rotationIndex: {},
      preferredProvider: null,
      now: NOW,
    });
    assert.equal(result.noKeys, true);
    assert.equal(result.key, null);
  });

  it("returns noKeys when apiKeys is null/undefined and no legacy", () => {
    const result = selectAvailableKey({
      apiKeys: null,
      legacyApiKey: null,
      now: NOW,
    });
    assert.equal(result.noKeys, true);
  });
});

describe("selectAvailableKey — legacy single key migration", () => {
  it("uses legacyApiKey under legacyProvider when multi-key empty", () => {
    const result = selectAvailableKey({
      apiKeys: emptyKeys(),
      legacyApiKey: "legacy-gsk-abc",
      legacyProvider: "gemini",
      keyStatus: {},
      rotationIndex: {},
      preferredProvider: null,
      now: NOW,
    });
    assert.equal(result.key, "legacy-gsk-abc");
    assert.equal(result.provider, "gemini");
    assert.equal(result.index, 0);
    assert.equal(result.newKeyStatus["legacy-gsk-abc"].lastUsed, NOW);
  });

  it("defaults legacy provider to groq", () => {
    const result = selectAvailableKey({
      apiKeys: null,
      legacyApiKey: "only-key",
      now: NOW,
    });
    assert.equal(result.key, "only-key");
    assert.equal(result.provider, "groq");
  });

  it("does not use legacy when multi-key already has entries", () => {
    const keys = emptyKeys();
    keys.groq = ["multi-key-1"];
    const result = selectAvailableKey({
      apiKeys: keys,
      legacyApiKey: "legacy-should-ignore",
      legacyProvider: "gemini",
      now: NOW,
    });
    assert.equal(result.key, "multi-key-1");
    assert.equal(result.provider, "groq");
  });
});

describe("selectAvailableKey — preferred provider first", () => {
  it("hoists preferredProvider ahead of default priority", () => {
    const keys = emptyKeys();
    keys.groq = ["groq-key"];
    keys.openrouter = ["or-key"];
    const result = selectAvailableKey({
      apiKeys: keys,
      preferredProvider: "openrouter",
      now: NOW,
    });
    assert.equal(result.provider, "openrouter");
    assert.equal(result.key, "or-key");
  });

  it("ignores preferredProvider not in PROVIDER_PRIORITY", () => {
    const keys = emptyKeys();
    keys.groq = ["groq-key"];
    keys.gemini = ["gem-key"];
    const result = selectAvailableKey({
      apiKeys: keys,
      preferredProvider: "unknown-provider",
      now: NOW,
    });
    assert.equal(result.provider, "groq");
  });
});

describe("selectAvailableKey — rate-limited key skip", () => {
  it("skips keys still rate-limited and picks next", () => {
    const keys = emptyKeys();
    keys.groq = ["k1", "k2"];
    const result = selectAvailableKey({
      apiKeys: keys,
      keyStatus: {
        k1: { rateLimitedUntil: NOW + 60_000 },
      },
      rotationIndex: { groq: 0 },
      now: NOW,
    });
    assert.equal(result.key, "k2");
    assert.equal(result.index, 1);
  });

  it("uses key once rateLimitedUntil has passed", () => {
    const keys = emptyKeys();
    keys.groq = ["k1"];
    const result = selectAvailableKey({
      apiKeys: keys,
      keyStatus: {
        k1: { rateLimitedUntil: NOW - 1 },
      },
      now: NOW,
    });
    assert.equal(result.key, "k1");
  });

  it("falls through to next provider when all keys of first are limited", () => {
    const keys = emptyKeys();
    keys.groq = ["g1"];
    keys.cerebras = ["c1"];
    const result = selectAvailableKey({
      apiKeys: keys,
      keyStatus: {
        g1: { rateLimitedUntil: NOW + 120_000 },
      },
      now: NOW,
    });
    assert.equal(result.provider, "cerebras");
    assert.equal(result.key, "c1");
  });
});

describe("selectAvailableKey — round-robin rotation", () => {
  it("starts at rotationIndex and advances newRotationIndex", () => {
    const keys = emptyKeys();
    keys.groq = ["a", "b", "c"];
    const result = selectAvailableKey({
      apiKeys: keys,
      rotationIndex: { groq: 1 },
      now: NOW,
    });
    assert.equal(result.key, "b");
    assert.equal(result.index, 1);
    assert.equal(result.newRotationIndex.groq, 2);
  });

  it("wraps rotation index modulo key length", () => {
    const keys = emptyKeys();
    keys.groq = ["a", "b"];
    const result = selectAvailableKey({
      apiKeys: keys,
      rotationIndex: { groq: 2 },
      now: NOW,
    });
    assert.equal(result.key, "a");
    assert.equal(result.newRotationIndex.groq, 1);
  });
});

describe("selectAvailableKey — all keys limited", () => {
  it("returns allLimited with waitMinutes from soonest unlock", () => {
    const keys = emptyKeys();
    keys.groq = ["g1"];
    keys.gemini = ["m1"];
    // g1 unlocks in 2.5 minutes, m1 in 10 minutes
    const result = selectAvailableKey({
      apiKeys: keys,
      keyStatus: {
        g1: { rateLimitedUntil: NOW + 2.5 * 60_000 },
        m1: { rateLimitedUntil: NOW + 10 * 60_000 },
      },
      now: NOW,
    });
    assert.equal(result.allLimited, true);
    assert.equal(result.total, 2);
    assert.equal(result.waitMinutes, 3); // ceil(2.5)
    assert.equal(result.key, null);
  });

  it("waitMinutes is at least 1", () => {
    const keys = emptyKeys();
    keys.groq = ["g1"];
    const result = selectAvailableKey({
      apiKeys: keys,
      keyStatus: {
        g1: { rateLimitedUntil: NOW + 100 }, // < 1 minute
      },
      now: NOW,
    });
    assert.equal(result.allLimited, true);
    assert.equal(result.waitMinutes, 1);
  });
});

describe("selectAvailableKey — each PROVIDER_PRIORITY provider", () => {
  for (const provider of PROVIDER_PRIORITY) {
    it(`selects ${provider} when only it has keys`, () => {
      const keys = emptyKeys();
      keys[provider] = [`${provider}-key-1`];
      const result = selectAvailableKey({
        apiKeys: keys,
        now: NOW,
      });
      assert.equal(result.provider, provider);
      assert.equal(result.key, `${provider}-key-1`);
      assert.equal(result.index, 0);
      assert.ok(result.newRotationIndex);
      assert.ok(result.newKeyStatus);
    });
  }

  it("follows default priority when multiple providers have keys", () => {
    const keys = emptyKeys();
    // lower priority first in object, but selection uses PROVIDER_PRIORITY
    keys.openrouter = ["or"];
    keys.gemini = ["gem"];
    keys.cerebras = ["cer"];
    const result = selectAvailableKey({
      apiKeys: keys,
      now: NOW,
    });
    assert.equal(result.provider, "cerebras");
    assert.equal(result.key, "cer");
  });
});

describe("selectAvailableKey — purity", () => {
  it("does not mutate caller apiKeys / keyStatus / rotationIndex", () => {
    const keys = emptyKeys();
    keys.groq = ["k1"];
    const keyStatus = {};
    const rotationIndex = { groq: 0 };
    selectAvailableKey({
      apiKeys: keys,
      keyStatus,
      rotationIndex,
      now: NOW,
    });
    assert.deepEqual(keys.groq, ["k1"]);
    assert.deepEqual(keyStatus, {});
    assert.deepEqual(rotationIndex, { groq: 0 });
  });
});

describe("parseRetryAfter", () => {
  it("parses 'try again in XmYs' format", () => {
    const ms = parseRetryAfter("Rate limit: try again in 2m30.5s please");
    assert.equal(ms, (2 * 60 + 30.5) * 1000);
  });

  it("parses retry-after seconds", () => {
    assert.equal(parseRetryAfter("retry after: 45"), 45_000);
    assert.equal(parseRetryAfter("Retry-After: 120"), 120_000);
  });

  it("defaults to 30 minutes when no match", () => {
    assert.equal(parseRetryAfter("unknown error"), 30 * 60 * 1000);
    assert.equal(parseRetryAfter(null), 30 * 60 * 1000);
    assert.equal(parseRetryAfter(undefined), 30 * 60 * 1000);
  });
});
