/** Shared migration for the popup and service worker. Never logs key material. */
"use strict";

const FeedWriterApiKeyStore = (() => {
  const providers = ["groq", "gemini", "cerebras", "nvidia", "sambanova", "openrouter"];

  function normalize(map) {
    const result = {};
    for (const provider of providers) {
      const keys = Array.isArray(map?.[provider]) ? map[provider] : [];
      result[provider] = [...new Set(keys.filter((key) =>
        typeof key === "string" && key.trim().length > 0,
      ))];
    }
    return result;
  }

  function count(map) {
    return providers.reduce((total, provider) => total + (map[provider]?.length || 0), 0);
  }

  function merge(local, backup, sync) {
    const primary = normalize(local.apiKeys);
    const recovered = count(primary) === 0 && count(normalize(backup)) > 0;
    const base = recovered ? normalize(backup) : primary;
    const legacyProvider = providers.includes(sync.provider) ? sync.provider : "groq";
    const merged = normalize(base);
    const synced = normalize(sync.apiKeys);
    for (const provider of providers) {
      merged[provider] = [...new Set([...merged[provider], ...synced[provider]])];
    }
    if (typeof sync.apiKey === "string" && sync.apiKey.trim() &&
        !merged[legacyProvider].includes(sync.apiKey)) {
      merged[legacyProvider].push(sync.apiKey);
    }
    return { apiKeys: merged, restoredFromBackup: recovered };
  }

  function sameKeys(a, b) {
    return providers.every((provider) => {
      const left = a[provider] || [];
      const right = b[provider] || [];
      return left.length === right.length && left.every((key, index) => key === right[index]);
    });
  }

  async function migrate(storage) {
    const [local, sync] = await Promise.all([
      storage.local.get(["apiKeys", "backupApiKeys"]),
      storage.sync.get(["apiKeys", "apiKey", "provider"]),
    ]);
    const result = merge(local, local.backupApiKeys, sync);
    const hasSync = sync.apiKeys !== undefined || !!sync.apiKey;
    const mustWrite = hasSync || result.restoredFromBackup ||
      (count(result.apiKeys) > 0 && !sameKeys(normalize(local.apiKeys), result.apiKeys));
    if (mustWrite) {
      await storage.local.set({
        apiKeys: result.apiKeys,
        backupApiKeys: result.apiKeys,
      });
      const persisted = await storage.local.get("apiKeys");
      if (!sameKeys(normalize(persisted.apiKeys), result.apiKeys)) {
        throw new Error("API key migration could not verify local storage");
      }
    }
    if (hasSync) await storage.sync.remove(["apiKeys", "apiKey"]);
    return result;
  }

  return { providers, normalize, count, merge, migrate };
})();

if (typeof module !== "undefined") module.exports = FeedWriterApiKeyStore;
globalThis.FeedWriterApiKeyStore = FeedWriterApiKeyStore;
