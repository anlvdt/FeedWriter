/**
 * Pure, dependency-free logic extracted for unit testing.
 *
 * These functions MIRROR algorithms used in content/background scripts
 * (which cannot be imported as modules). Keep in sync when production
 * algorithms change:
 *
 *   computeNgramOverlap  → background.js (output guardrails)
 *   detectRepetition     → background.js (output guardrails)
 *   cleanSourceUrl       → content.js (URL cleanup)
 *   stripTrackingParams  → content-dom.js / content.js
 *   adaptSummarizeResponse → content.js processSingleText (batch)
 *   isMacPlatform        → shortcut label UX (Cmd vs Ctrl)
 *   labsGateAllows       → Labs automation risk gate (UPGRADE_BACKLOG)
 *
 * CommonJS so Node tests can `createRequire` / `require` without a bundler.
 * Safe for optional future use from extension scripts via importScripts or copy.
 */
"use strict";

// --- Output Guardrails (background.js) ------------------------------------

/**
 * N-gram overlap: fraction of output n-grams also present in source.
 * High value (~>0.6) suggests copy-paste rather than rewrite.
 */
function computeNgramOverlap(source, output, n = 4) {
  if (!source || !output) return 0;
  const normalize = (s) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  const getNgrams = (text, size) => {
    const words = text.split(" ");
    const ngrams = new Set();
    for (let i = 0; i <= words.length - size; i++) {
      ngrams.add(words.slice(i, i + size).join(" "));
    }
    return ngrams;
  };

  const srcNgrams = getNgrams(normalize(source), n);
  const outNgrams = getNgrams(normalize(output), n);
  if (outNgrams.size === 0) return 0;

  let overlap = 0;
  for (const ng of outNgrams) {
    if (srcNgrams.has(ng)) overlap++;
  }
  return overlap / outNgrams.size;
}

/**
 * Repetition rate: fraction of sentences (len > 10) that are duplicates.
 */
function detectRepetition(text) {
  if (!text) return 0;
  const sentences = text
    .split(/[.!?。]\s*/)
    .filter((s) => s.trim().length > 10);
  if (sentences.length < 2) return 0;

  let dupes = 0;
  const seen = new Set();
  for (const s of sentences) {
    const key = s.toLowerCase().trim();
    if (seen.has(key)) dupes++;
    seen.add(key);
  }
  return dupes / sentences.length;
}

// --- URL cleanup (content.js cleanSourceUrl) ------------------------------

const TRACKING_PARAM_EXACT = [
  "fbclid",
  "gclid",
  "ref",
  "comment_id",
  "reply_comment_id",
];

/**
 * Remove common tracking query params from a URL (utm_*, fbclid, gclid, …).
 * Returns a URL string with trailing bare `?` stripped.
 */
function stripTrackingParams(rawUrl) {
  if (!rawUrl) return "";
  try {
    const u = new URL(rawUrl);
    for (const k of [...u.searchParams.keys()]) {
      if (
        k.startsWith("utm_") ||
        k.startsWith("__") ||
        TRACKING_PARAM_EXACT.includes(k)
      ) {
        u.searchParams.delete(k);
      }
    }
    return u.toString().replace(/\?$/, "");
  } catch (_) {
    return rawUrl;
  }
}

/**
 * Clean a source URL: Facebook permalink normalization + tracking strip.
 * Mirrors content.js cleanSourceUrl.
 */
function cleanSourceUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    const u = new URL(rawUrl);
    if (u.hostname.includes("facebook.com")) {
      const mp = u.searchParams.get("multi_permalinks");
      if (mp && u.pathname.includes("/groups/")) {
        return (
          u.origin + u.pathname.replace(/\/$/, "") + "/posts/" + mp + "/"
        );
      }
      const sfid = u.searchParams.get("story_fbid");
      const uid = u.searchParams.get("id");
      if (sfid && uid) return u.origin + "/" + uid + "/posts/" + sfid + "/";
      const keep = new Set([
        "story_fbid",
        "id",
        "multi_permalinks",
        "v",
        "set",
        "theater",
        "fbid",
      ]);
      for (const key of [...u.searchParams.keys()]) {
        if (keep.has(key)) continue;
        if (
          key.startsWith("utm_") ||
          key.startsWith("__") ||
          TRACKING_PARAM_EXACT.includes(key) ||
          key === "mibextid"
        ) {
          u.searchParams.delete(key);
        }
      }
      return u.toString().replace(/\?$/, "");
    }
    return stripTrackingParams(rawUrl);
  } catch (_) {
    return rawUrl;
  }
}

// --- Batch response adapter (content.js processSingleText) ----------------

/**
 * Normalize background summarize responses into a single shape.
 * Accepts legacy `{ summary }` and newer `{ success, result }` payloads.
 *
 * @returns {{ ok: boolean, result?: string, error?: string }}
 */
function adaptSummarizeResponse(response) {
  if (!response || typeof response !== "object") {
    return { ok: false, error: "Unknown error" };
  }
  if (response.success && response.result) {
    return { ok: true, result: String(response.result) };
  }
  if (typeof response.summary === "string" && response.summary.trim()) {
    return { ok: true, result: response.summary };
  }
  return {
    ok: false,
    error:
      typeof response.error === "string" && response.error
        ? response.error
        : "Unknown error",
  };
}

// --- Platform / Labs gates ------------------------------------------------

const LABS_CONFIRM_PHRASE = "TOI HIEU RUI RO";

/**
 * Detect macOS-like user agents for Cmd vs Ctrl shortcut labels.
 */
function isMacPlatform(ua) {
  if (!ua || typeof ua !== "string") return false;
  return /Mac|iPhone|iPad|iPod/i.test(ua);
}

/**
 * Labs automation risk gate.
 * Requires both labsAutomationEnabled and exact confirm phrase "TOI HIEU RUI RO".
 *
 * @param {object} settings
 * @param {string} [confirmText]
 */
function labsGateAllows(settings, confirmText) {
  if (!settings || typeof settings !== "object") return false;
  if (!settings.labsAutomationEnabled) return false;
  const phrase =
    typeof confirmText === "string"
      ? confirmText
      : settings.labsConfirmText || "";
  return phrase.trim() === LABS_CONFIRM_PHRASE;
}

// --- Exports --------------------------------------------------------------

const pureLogic = {
  computeNgramOverlap,
  detectRepetition,
  cleanSourceUrl,
  stripTrackingParams,
  adaptSummarizeResponse,
  isMacPlatform,
  labsGateAllows,
  LABS_CONFIRM_PHRASE,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = pureLogic;
}

// Also attach for ESM interop via createRequire consumers
if (typeof globalThis !== "undefined") {
  globalThis.FeedWriterPureLogic = pureLogic;
}
