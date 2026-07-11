/**
 * Pure message-schema validation for FeedWriter runtime messages.
 *
 * No chrome.* dependency — safe for Node tests and the service worker.
 * Service worker loads via importScripts("lib/message-schema.js") which
 * attaches globalThis.FeedWriterMessageSchema. Tests require() this module.
 *
 * Keep ACTION_SCHEMAS in sync with background.js onMessage handlers.
 */
"use strict";

/** @typedef {'extension'|'extension_page'|'content_tab'} SenderClass */

const SENDER = {
  /** Same extension id; popup, options, or content script */
  ANY_EXTENSION: "extension",
  /** Popup / options — no tab on sender */
  EXTENSION_PAGE: "extension_page",
  /** Content script — sender has tab */
  CONTENT_TAB: "content_tab",
};

/**
 * Classify a chrome.runtime.onMessage sender-like object.
 * @param {{ id?: string, tab?: object, url?: string }|null|undefined} senderLike
 * @returns {'extension_page'|'content_tab'|'external'|'unknown'}
 */
function classifySender(senderLike) {
  if (!senderLike || typeof senderLike !== "object") return "unknown";
  if (!senderLike.id) return "unknown";
  if (senderLike.tab) return "content_tab";
  const url = senderLike.url || "";
  if (
    url &&
    !url.startsWith("chrome-extension://") &&
    !url.startsWith("moz-extension://")
  ) {
    return "external";
  }
  return "extension_page";
}

/**
 * @param {string|string[]} allowed
 * @param {string} cls
 */
function senderMatches(allowed, cls) {
  if (Array.isArray(allowed)) {
    return allowed.some((a) => senderMatches(a, cls));
  }
  if (allowed === SENDER.ANY_EXTENSION) {
    return cls === "extension_page" || cls === "content_tab";
  }
  if (allowed === SENDER.EXTENSION_PAGE) return cls === "extension_page";
  if (allowed === SENDER.CONTENT_TAB) return cls === "content_tab";
  return false;
}

/**
 * @param {unknown} value
 * @param {string} type
 */
function checkType(value, type) {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "nonEmptyString":
      return typeof value === "string" && value.trim().length > 0;
    case "array":
      return Array.isArray(value);
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && !Number.isNaN(value);
    default:
      return true;
  }
}

/**
 * Validate action name, sender class, and payload shape against schemas.
 *
 * @param {string} action
 * @param {object} request
 * @param {{ id?: string, tab?: object, url?: string }|null|undefined} senderLike
 * @param {Record<string, object>} schemas
 * @returns {{ ok: true, request: object } | { ok: false, error: string }}
 */
function validateMessage(action, request, senderLike, schemas) {
  if (!schemas || typeof schemas !== "object") {
    return { ok: false, error: "No schemas" };
  }
  if (typeof action !== "string" || !action) {
    return { ok: false, error: "Missing action" };
  }
  if (!request || typeof request !== "object") {
    return { ok: false, error: "Invalid request" };
  }

  const schema = schemas[action];
  if (!schema) {
    return { ok: false, error: "Unknown action" };
  }

  const cls = classifySender(senderLike);
  const allowed = schema.sender != null ? schema.sender : SENDER.ANY_EXTENSION;
  if (!senderMatches(allowed, cls)) {
    return {
      ok: false,
      error: `Action "${action}" not allowed from ${cls}`,
    };
  }

  const fields = schema.fields || {};
  const required = schema.required || [];

  for (const key of required) {
    if (!(key in request) || request[key] === undefined || request[key] === null) {
      return { ok: false, error: `Missing required field: ${key}` };
    }
    const type = fields[key];
    if (type && !checkType(request[key], type)) {
      if (type === "nonEmptyString") {
        return {
          ok: false,
          error: `Field "${key}" must be a non-empty string`,
        };
      }
      return { ok: false, error: `Field "${key}" must be ${type}` };
    }
  }

  for (const [key, type] of Object.entries(fields)) {
    if (required.includes(key)) continue;
    if (!(key in request) || request[key] === undefined || request[key] === null) {
      continue;
    }
    if (!checkType(request[key], type)) {
      if (type === "nonEmptyString") {
        return {
          ok: false,
          error: `Field "${key}" must be a non-empty string`,
        };
      }
      return { ok: false, error: `Field "${key}" must be ${type}` };
    }
  }

  if (Array.isArray(schema.requireAny) && schema.requireAny.length) {
    const hasAny = schema.requireAny.some((key) => {
      const v = request[key];
      if (v === undefined || v === null) return false;
      const type = fields[key];
      if (type === "array") return Array.isArray(v) && v.length > 0;
      if (type === "string" || type === "nonEmptyString") {
        return typeof v === "string" && v.trim().length > 0;
      }
      return true;
    });
    if (!hasAny) {
      return {
        ok: false,
        error: `At least one of [${schema.requireAny.join(", ")}] is required`,
      };
    }
  }

  return { ok: true, request };
}

/**
 * Convenience entry: validate a full runtime message envelope.
 * @param {object} request
 * @param {{ id?: string, tab?: object, url?: string }|null|undefined} senderLike
 * @param {Record<string, object>} [schemas]
 */
function validate(request, senderLike, schemas) {
  const map = schemas || ACTION_SCHEMAS;
  if (!request || typeof request !== "object") {
    return { ok: false, error: "Invalid request" };
  }
  return validateMessage(request.action, request, senderLike, map);
}

/**
 * Central map of known runtime actions → sender + payload schema.
 * All background onMessage actions should appear here.
 */
const ACTION_SCHEMAS = {
  ping: {
    sender: SENDER.ANY_EXTENSION,
    fields: {},
    required: [],
  },
  summarize: {
    sender: SENDER.ANY_EXTENSION,
    fields: {
      text: "nonEmptyString",
      type: "string",
      site: "string",
      summaryLength: "string",
      promptStyle: "string",
      outputLanguage: "string",
    },
    required: ["text"],
  },
  "fetch-image": {
    sender: SENDER.ANY_EXTENSION,
    fields: { url: "nonEmptyString" },
    required: ["url"],
  },
  "enrich-related-source-links": {
    sender: SENDER.ANY_EXTENSION,
    fields: { urls: "array" },
    required: ["urls"],
  },
  "unshorten-shopee-inline": {
    sender: SENDER.CONTENT_TAB,
    fields: { url: "nonEmptyString" },
    required: ["url"],
  },
  "run-github-autopost-now": {
    sender: SENDER.EXTENSION_PAGE,
    fields: {},
    required: [],
  },
  "reschedule-github": {
    sender: SENDER.ANY_EXTENSION,
    fields: {},
    required: [],
  },
  "request-optional-permission": {
    sender: SENDER.ANY_EXTENSION,
    fields: {
      permissions: "array",
      origins: "array",
    },
    required: [],
    requireAny: ["permissions", "origins"],
  },
  "github-autopost-done": {
    sender: SENDER.CONTENT_TAB,
    fields: {
      ok: "boolean",
      message: "string",
      stage: "string",
    },
    required: [],
  },
  "translate-word": {
    sender: SENDER.ANY_EXTENSION,
    fields: { word: "nonEmptyString" },
    required: ["word"],
  },
  "test-connection": {
    sender: SENDER.ANY_EXTENSION,
    fields: {},
    required: [],
  },
  backupSettings: {
    sender: SENDER.ANY_EXTENSION,
    fields: {},
    required: [],
  },
  restoreSettings: {
    sender: SENDER.ANY_EXTENSION,
    fields: { backupIndex: "number" },
    required: [],
  },
  "get-key-status": {
    sender: SENDER.ANY_EXTENSION,
    fields: {},
    required: [],
  },
  "shorten-url": {
    sender: SENDER.ANY_EXTENSION,
    fields: { url: "nonEmptyString" },
    required: ["url"],
  },
};

const FeedWriterMessageSchema = {
  SENDER,
  ACTION_SCHEMAS,
  classifySender,
  validateMessage,
  validate,
  senderMatches,
  checkType,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = FeedWriterMessageSchema;
}

if (typeof globalThis !== "undefined") {
  globalThis.FeedWriterMessageSchema = FeedWriterMessageSchema;
}
