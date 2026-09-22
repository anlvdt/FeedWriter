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

// --- URL cleanup (lib/url-clean.js is the production source) --------------
const urlClean =
  (typeof FeedWriterUrlClean !== "undefined" && FeedWriterUrlClean) ||
  (typeof require === "function" ? require("./url-clean.js") : null);

function stripTrackingParams(rawUrl) {
  return urlClean.stripTrackingParams(rawUrl);
}

function cleanSourceUrl(rawUrl) {
  return urlClean.cleanSourceUrl(rawUrl);
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

// --- Platform helpers -----------------------------------------------------

/**
 * Detect macOS-like user agents for Cmd vs Ctrl shortcut labels.
 */
function isMacPlatform(ua) {
  if (!ua || typeof ua !== "string") return false;
  return /Mac|iPhone|iPad|iPod/i.test(ua);
}


// --- Facebook feed chrome -------------------------------------------------

/**
 * Facebook sometimes inserts a social-context card such as
 * "Nope Pham đã bình luận gần đây." or "Trần Hồng Quân đã bình luận."
 * into the feed. It is UI chrome, not a comment or the author of the post
 * shown below it.
 */
function isFacebookCommentActivityText(value) {
  const text = String(value || "")
    .replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text.length > 180) return false;
  return /^(?:.+?\s+)?(?:has\s+commented(?:\s+recently)?|have\s+commented(?:\s+recently)?|commented(?:\s+recently)?|(?:đã|vừa)\s+bình\s*luận(?:\s+gần\s*đây)?)[.!…]*$/i.test(text);
}

// --- Exports --------------------------------------------------------------

const pureLogic = {
  computeNgramOverlap,
  detectRepetition,
  cleanSourceUrl,
  stripTrackingParams,
  adaptSummarizeResponse,
  isMacPlatform,
  isFacebookCommentActivityText,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = pureLogic;
}

// Also attach for ESM interop via createRequire consumers
if (typeof globalThis !== "undefined") {
  globalThis.FeedWriterPureLogic = pureLogic;
}
