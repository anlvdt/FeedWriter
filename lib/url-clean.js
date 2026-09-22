/**
 * Source-URL cleanup shared by content scripts and Node tests.
 * Content scripts load this file from the manifest; tests require() it.
 */
"use strict";

const TRACKING_PARAM_EXACT = [
  "fbclid",
  "gclid",
  "ref",
  "comment_id",
  "reply_comment_id",
];

const ALLOWED_IMAGE_HOST_SUFFIXES = [
  "fbcdn.net",
  "cdninstagram.com",
  "twimg.com",
  "redd.it",
  "redditmedia.com",
  "redditstatic.com",
  "licdn.com",
  "linkedin.com",
  "googleusercontent.com",
];

function imageOptionalOrigins() {
  return ALLOWED_IMAGE_HOST_SUFFIXES.flatMap((suffix) => [
    "https://*." + suffix + "/*",
    "https://" + suffix + "/*",
  ]);
}

function isAllowedImageHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return ALLOWED_IMAGE_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith("." + suffix),
  );
}

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

function cleanSourceUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    const u = new URL(rawUrl);
    if (u.hostname.includes("facebook.com")) {
      const cleanFb =
        (typeof globalThis !== "undefined" &&
          typeof globalThis.fbsCleanFbUrl === "function" &&
          globalThis.fbsCleanFbUrl) ||
        (typeof window !== "undefined" &&
          typeof window.fbsCleanFbUrl === "function" &&
          window.fbsCleanFbUrl);
      if (cleanFb) return cleanFb(rawUrl);
      const mp = u.searchParams.get("multi_permalinks");
      if (mp && u.pathname.includes("/groups/")) {
        return u.origin + u.pathname.replace(/\/$/, "") + "/posts/" + mp + "/";
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

const FeedWriterUrlClean = {
  TRACKING_PARAM_EXACT,
  ALLOWED_IMAGE_HOST_SUFFIXES,
  imageOptionalOrigins,
  isAllowedImageHost,
  stripTrackingParams,
  cleanSourceUrl,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = FeedWriterUrlClean;
}
if (typeof globalThis !== "undefined") {
  globalThis.FeedWriterUrlClean = FeedWriterUrlClean;
  globalThis.stripTrackingParams = stripTrackingParams;
  globalThis.cleanSourceUrl = cleanSourceUrl;
}
