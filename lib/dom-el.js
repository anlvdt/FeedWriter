/**
 * Pure DOM safety helpers for FeedWriter UI.
 * Browser callers use createElement + setText; tests cover escape/sanitize.
 * SYNC: escapeHtml mirrors popup.js esc() / content.js esc().
 */
"use strict";

function escapeHtml(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Allow only safe attribute names (no on* handlers). */
function isSafeAttrName(name) {
  if (typeof name !== "string" || !name) return false;
  if (/^on/i.test(name)) return false;
  return /^[a-zA-Z_:][\w:.-]*$/.test(name);
}

/**
 * Build a lightweight virtual node description (for tests / SSR-ish checks).
 * Runtime popup uses el() with real document.createElement.
 */
function vnode(tag, attrs = {}, children = []) {
  const safeAttrs = {};
  for (const [k, v] of Object.entries(attrs || {})) {
    if (!isSafeAttrName(k)) continue;
    if (v == null || v === false) continue;
    safeAttrs[k] = v === true ? "" : String(v);
  }
  const kids = Array.isArray(children) ? children : [children];
  return { tag, attrs: safeAttrs, children: kids };
}

/**
 * Create a real DOM element when `document` is available.
 * children: string → textContent; Node → append; array recursive.
 */
function el(tag, attrs = {}, children = []) {
  if (typeof document === "undefined") {
    return vnode(tag, attrs, children);
  }
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (!isSafeAttrName(k)) continue;
    if (v == null || v === false) continue;
    if (k === "className") node.className = String(v);
    else if (k === "textContent") node.textContent = String(v);
    else if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, String(v));
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const child of kids) {
    if (child == null || child === false) continue;
    if (typeof child === "string" || typeof child === "number") {
      node.appendChild(document.createTextNode(String(child)));
    } else if (child.nodeType) {
      node.appendChild(child);
    } else if (child.tag) {
      // vnode from tests — ignore in real DOM path
    }
  }
  return node;
}

function setText(node, text) {
  if (!node) return;
  node.textContent = text == null ? "" : String(text);
}

module.exports = {
  escapeHtml,
  isSafeAttrName,
  vnode,
  el,
  setText,
};

if (typeof globalThis !== "undefined") {
  globalThis.FeedWriterDomEl = module.exports;
}
