/**
 * Shared EN→VI eligibility for the social toolbar and the translate tooltip.
 */
"use strict";

function isTranslatable(text) {
  if (!text) return false;
  const t = String(text).trim();
  if (t.length < 2 || t.length > 24000) return false;
  if (!/[A-Za-z]/.test(t)) return false;
  if (/^https?:\/\//i.test(t) || /^[\w.+-]+@[\w.-]+$/.test(t)) return false;
  const latin = (t.match(/[A-Za-z]/g) || []).length;
  return latin / Math.max(t.replace(/\s+/g, "").length, 1) >= 0.45;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { isTranslatable };
}
if (typeof globalThis !== "undefined") {
  globalThis.isTranslatable = isTranslatable;
}
