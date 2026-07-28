// FeedWriter — Background service worker
// https://github.com/anlvdt/fb-post-summarizer
// Author: Le An (anlvdt)

// NOTE: Chrome MV3 service worker entry is service-worker.js (bundled).
// This file is a SOURCE MODULE — do not load it directly as service_worker.
// Rebuild: python3 scripts/build-sw.py
//
// importScripts is intentionally NOT used here: Chrome often throws
// NetworkError "utils.js failed to load" for multi-file SW on external volumes.
// The bundle inlines utils.js + bg-prompts.js + bg-api.js instead.
//
// If you ever need standalone SW for debugging only:
// importScripts("utils.js", "bg-prompts.js", "bg-api.js");

// Boot marker — if chrome://extensions shows "fetching the script", SW never got here
try {
  console.info("[FeedWriter] service worker booted", {
    at: new Date().toISOString(),
  });
} catch (_) {}

// MV3 lifecycle — claim clients immediately so messages aren't dropped
self.addEventListener("install", (event) => {
  try {
    console.info("[FeedWriter] SW install");
  } catch (_) {}
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    self.clients.claim().then(() => {
      try {
        console.info("[FeedWriter] SW activated");
      } catch (_) {}
    }),
  );
});

// Catch stray promise rejections so Chrome doesn't surface "No SW" errors
self.addEventListener("unhandledrejection", (event) => {
  console.warn("[FeedWriter] Unhandled rejection:", event.reason);
  event.preventDefault();
});

// Hard errors during SW evaluation are what produce "fetching the script"
self.addEventListener("error", (event) => {
  console.error("[FeedWriter] SW error:", event?.message || event);
});

// Fallback logger and feature flags if utils.js failed to load
if (typeof logger === 'undefined') {
  logger = {
    debug: (...args) => console.debug('[DEBUG]', ...args),
    info: (...args) => console.info('[INFO]', ...args),
    warn: (...args) => console.warn('[WARN]', ...args),
    error: (...args) => console.error('[ERROR]', ...args),
  };
}

if (typeof featureFlags === 'undefined') {
  featureFlags = {
    enableLogging: false,
    enableCache: false,
    enableBatchStorage: false,
    enableEventDelegation: false,
    enableMutationObserver: false,
    enableIntersectionObserver: false,
    testMode: false,
  };
}

// Initialize StorageBatcher for history (must be after importScripts)
const historyBatcher = typeof StorageBatcher !== 'undefined'
  ? new StorageBatcher(500)
  : { set: (key, value) => chrome.storage.local.set({ [key]: value }) };

// Storage schema version
const STORAGE_VERSION = 2;
const SETTINGS_VERSION = 2;

// === SETTINGS SCHEMA ===
const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  minLength: 400,
  outputLanguage: 'vi',
  languageAutoDetected: true,
  summaryLength: 'medium',
  promptStyle: 'default',
  customInstructions: '',
  customSummaryPrompt: '',
  sourceTemplate: '• Nguồn bài viết: {platform} {author} {source}\n  {link}',
  customSourceLink: '',
  enableUnicodeBold: true,
  advancedModeEnabled: false,
  hideAffiliatePosts: false,
  adDisplayMode: 'hide', // Sponsored / Được tài trợ — hide by default
  affiliateDisplayMode: 'collapse',
  blockedDomains: '',
  theme: 'auto',
  // === Auto GitHub → Facebook ===
};

// === STORAGE MIGRATION ===
async function migrateStorageIfNeeded() {
  if (!chrome?.storage?.local) return; // SW not ready
  const data = await chrome.storage.local.get(['storageVersion', 'history', 'apiKeys']);
  const currentVersion = data.storageVersion || 0;

  if (currentVersion < STORAGE_VERSION) {
    logger.info(`Migrating storage from v${currentVersion} to v${STORAGE_VERSION}`);

    // Migration v0 -> v1: Initial version
    if (currentVersion < 1) {
      // No migration needed, just set version
    }

    // Migration v1 -> v2: Add templates support
    if (currentVersion < 2) {
      const templates = data.templates || [];
      await chrome.storage.local.set({ templates });
      logger.info('Migration v1->v2: Added templates support');
    }

    await chrome.storage.local.set({ storageVersion: STORAGE_VERSION });
    logger.info('Storage migration completed');
  }
}

// === SETTINGS MIGRATION ===
async function migrateSettingsIfNeeded() {
  if (!chrome?.storage?.sync) return; // SW not ready

  const data = await chrome.storage.sync.get([...Object.keys(DEFAULT_SETTINGS), 'outputLang']);
  const currentVersion = data.version || 0;

  if (currentVersion < SETTINGS_VERSION) {
    logger.info(`Migrating settings from v${currentVersion} to v${SETTINGS_VERSION}`);

    const migratedSettings = { ...DEFAULT_SETTINGS };

    // Migration v0 -> v1: Rename outputLang to outputLanguage
    if (currentVersion < 1) {
      if (data.outputLang) {
        migratedSettings.outputLanguage = data.outputLang;
        logger.info('Migration v0->v1: Renamed outputLang to outputLanguage');
      }
    }

    // Migration v1 -> v2: Add languageAutoDetected flag
    if (currentVersion < 2) {
      migratedSettings.languageAutoDetected = data.languageAutoDetected !== undefined
        ? data.languageAutoDetected
        : true;
      logger.info('Migration v1->v2: Added languageAutoDetected flag');
    }

    // Merge existing settings with defaults (preserve user values)
    for (const key in DEFAULT_SETTINGS) {
      if (data[key] !== undefined && key !== 'version') {
        migratedSettings[key] = data[key];
      }
    }

    migratedSettings.version = SETTINGS_VERSION;
    await chrome.storage.sync.set(migratedSettings);
    logger.info('Settings migration completed');
  }
}

// === SETTINGS VALIDATION ===
async function validateSettings() {
  if (!chrome?.storage?.sync) return;

  const data = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  const validatedSettings = {};
  let hasInvalidSettings = false;

  for (const key in DEFAULT_SETTINGS) {
    const value = data[key];
    const defaultValue = DEFAULT_SETTINGS[key];

    // Validate each setting
    if (value === undefined || value === null) {
      validatedSettings[key] = defaultValue;
      hasInvalidSettings = true;
    } else if (typeof value !== typeof defaultValue) {
      validatedSettings[key] = defaultValue;
      hasInvalidSettings = true;
      logger.warn(`Invalid type for setting ${key}: expected ${typeof defaultValue}, got ${typeof value}`);
    } else {
      validatedSettings[key] = value;
    }
  }

  if (hasInvalidSettings) {
    await chrome.storage.sync.set(validatedSettings);
    logger.info('Settings validation completed, invalid settings reset to defaults');
  }
}

// === SETTINGS BACKUP & RESTORE ===
async function backupSettings() {
  if (!chrome?.storage?.sync) return null;

  const data = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  const backup = {
    version: SETTINGS_VERSION,
    timestamp: Date.now(),
    settings: data
  };

  // Store backup in local storage
  const backups = await chrome.storage.local.get('settingsBackups');
  const backupList = backups.settingsBackups || [];
  backupList.push(backup);

  // Keep only last 5 backups
  if (backupList.length > 5) {
    backupList.shift();
  }

  await chrome.storage.local.set({ settingsBackups: backupList });
  logger.debug('Settings backup created');

  return backup;
}

async function restoreSettings(backupIndex = 0) {
  if (!chrome?.storage?.local || !chrome?.storage?.sync) return false;

  const backups = await chrome.storage.local.get('settingsBackups');
  const backupList = backups.settingsBackups || [];

  if (backupIndex >= backupList.length) {
    logger.error('Backup index out of range');
    return false;
  }

  const backup = backupList[backupList.length - 1 - backupIndex]; // Most recent first
  await chrome.storage.sync.set(backup.settings);
  logger.info(`Settings restored from backup (${new Date(backup.timestamp).toLocaleString()})`);

  return true;
}

// Run migration only inside onInstalled / onStartup
// (Removed top-level execution to prevent "Error: No SW" on some browsers)

// === TELEMETRY ===
let telemetryData = { sessions: 0, summaries: 0, errors: 0 };
let telemetryLoaded = false;

async function saveTelemetry() {
  if (!featureFlags.enableLogging) return;
  if (!chrome?.storage?.local) return; // SW not ready
  await chrome.storage.local.set({ telemetry: telemetryData });
}

async function loadTelemetry() {
  if (!chrome?.storage?.local) return; // SW not ready
  try {
    const data = await chrome.storage.local.get('telemetry');
    telemetryData = {
      sessions: data.telemetry?.sessions || 0,
      summaries: data.telemetry?.summaries || 0,
      errors: data.telemetry?.errors || 0
    };
    telemetryLoaded = true;
  } catch (e) {
    logger.error('Failed to load telemetry:', e);
  }
}

async function incrementTelemetry(field) {
  if (!featureFlags.enableLogging) return;
  if (!chrome?.storage?.local) return; // SW not ready
  try {
    if (!telemetryLoaded) {
      await loadTelemetry();
    }
    if (telemetryData[field] !== undefined) {
      telemetryData[field]++;
    }
    await saveTelemetry();
  } catch (e) {
    logger.error(`Failed to increment telemetry field ${field}:`, e);
  }
}

async function initializeTelemetry() {
  await incrementTelemetry('sessions');
}

function trackEvent(event, data = {}) {
  if (!featureFlags.enableLogging) return;
  logger.info(`Event: ${event}`, data);
  // Could send to analytics service here
}

// === KEEP SERVICE WORKER ALIVE ===
// Optimized keep-alive strategy with adaptive intervals
let keepAliveState = {
  lastActivity: Date.now(),
  isActive: false,
  activityCount: 0
};

function ensureKeepAliveAlarm() {
  if (!chrome?.alarms) {
    logger.warn('Alarms API unavailable, cannot set keep-alive');
    return;
  }

  // Adaptive interval: 1 min when active, 5 min when idle
  const getDesiredPeriod = () => {
    const timeSinceActivity = Date.now() - keepAliveState.lastActivity;
    const isRecentlyActive = timeSinceActivity < 5 * 60 * 1000; // 5 minutes
    return isRecentlyActive ? 1 : 5;
  };

  const desiredPeriod = getDesiredPeriod();
  const createAlarm = () => {
    chrome.alarms.create('keep-alive', {
      delayInMinutes: desiredPeriod,
      periodInMinutes: desiredPeriod,
    });
    logger.debug('Keep-alive alarm created with periodInMinutes=' + desiredPeriod);
  };

  chrome.alarms.get('keep-alive', (existing) => {
    if (chrome.runtime.lastError) {
      logger.warn('Keep-alive alarm get failed:', chrome.runtime.lastError.message);
      createAlarm();
      return;
    }

    if (!existing) {
      createAlarm();
    } else if (existing.periodInMinutes !== desiredPeriod) {
      logger.info('Adjusting keep-alive interval to ' + desiredPeriod + ' min');
      chrome.alarms.clear('keep-alive', (wasCleared) => {
        if (!wasCleared) {
          logger.warn('Failed to clear stale keep-alive alarm');
        }
        createAlarm();
      });
    } else {
      logger.debug('Keep-alive alarm already exists with correct interval');
    }
  });
}

// Track activity for adaptive keep-alive
function trackActivity() {
  keepAliveState.lastActivity = Date.now();
  keepAliveState.activityCount++;
  keepAliveState.isActive = true;

  // Adjust keep-alive interval based on activity
  if (keepAliveState.activityCount % 10 === 0) {
    ensureKeepAliveAlarm();
  }
}

// Setup keep-alive on startup
ensureKeepAliveAlarm();

// === MEMORY MANAGEMENT ===
const memoryCache = {
  data: new Map(),
  maxSize: 50,
  maxAge: 5 * 60 * 1000, // 5 minutes

  set(key, value) {
    // Evict oldest entries if cache is full
    if (this.data.size >= this.maxSize) {
      const firstKey = this.data.keys().next().value;
      this.data.delete(firstKey);
    }

    this.data.set(key, {
      value,
      timestamp: Date.now()
    });
  },

  get(key) {
    const entry = this.data.get(key);
    if (!entry) return null;

    // Check if entry is expired
    if (Date.now() - entry.timestamp > this.maxAge) {
      this.data.delete(key);
      return null;
    }

    return entry.value;
  },

  clear() {
    this.data.clear();
  },

  // Periodic cleanup of expired entries
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.data.entries()) {
      if (now - entry.timestamp > this.maxAge) {
        this.data.delete(key);
      }
    }
  }
};

// Memory cleanup runs via keep-alive alarm, not setInterval (setInterval dies with SW)

// === ALARM LISTENER ===
if (chrome?.alarms?.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'keep-alive') {
      logger.debug('Keep-alive alarm fired');
      memoryCache.cleanup();
      ensureKeepAliveAlarm();

      const timeSinceActivity = Date.now() - keepAliveState.lastActivity;
      if (timeSinceActivity > 10 * 60 * 1000) {
        keepAliveState.isActive = false;
      }
    }
  });
}

// === UTILITIES ===
// Fallback fetchWithTimeout if utils.js not loaded
if (typeof fetchWithTimeout === "undefined") {
  var fetchWithTimeout = function (url, options = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, {
      ...options,
      signal: options.signal || controller.signal,
    }).finally(() => clearTimeout(timeoutId));
  };
}

async function injectAndSend(tabId, message) {
  try {
    // CSS first (ui.css last so v3 tokens win), then JS in dependency order
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content.css", "ui.css"],
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        "errors.js",
        "utils.js",
        "dom-helpers.js",
        "post-data.js",
        "status-formatter.js",
        "content-dom.js",
        "poster-facebook.js",
        "poster-threads.js",
        "poster-x.js",
        "poster-linkedin.js",
        "poster-reddit.js",
        "cross-poster.js",
        "content-composer.js",
        "content.js",
      ],
    });
    chrome.tabs.sendMessage(tabId, message).catch((err) => {
      console.warn("sendMessage after inject failed", err);
    });
  } catch (e) {
    console.error("Injection failed", e);
  }
}

// === RELATED SOURCE DISCOVERY ===
// Enrich a small set of outbound URLs with metadata from their landing pages.
// Requests are intentionally bounded and reject local/private hosts.
function isSafePublicHttpsUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      host === "localhost" ||
      host.endsWith(".local") ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host === "::" ||
      /^::ffff:(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/i.test(host) ||
      /^f[cd][0-9a-f:]*$/i.test(host) ||
      /^fe[89ab][0-9a-f:]*$/i.test(host) ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) return false;
    return true;
  } catch (_) {
    return false;
  }
}

function decodeHtmlEntities(text) {
  return (text || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function absoluteUrl(rawUrl, baseUrl) {
  try {
    const url = new URL(decodeHtmlEntities(rawUrl), baseUrl);
    return isSafePublicHttpsUrl(url.href) ? url.href : "";
  } catch (_) {
    return "";
  }
}

function extractRelatedMetadata(html, finalUrl) {
  const links = [];
  const add = (url, evidence, label = "") => {
    const absolute = absoluteUrl(url, finalUrl);
    if (absolute) links.push({ url: absolute, evidence, label });
  };

  const metaPatterns = [
    [/<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)["']/gi, "canonical"],
    [/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*canonical[^"']*["']/gi, "canonical"],
    [/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/gi, "og:url"],
    [/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:url["']/gi, "og:url"],
  ];
  for (const [pattern, evidence] of metaPatterns) {
    for (const match of html.matchAll(pattern)) add(match[1], evidence);
  }

  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const label = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const haystack = (match[1] + " " + label).toLowerCase();
    if (/github\.com|gitlab\.com|download|tải xuống|source code|mã nguồn|release|docs?|documentation|demo|paper|arxiv\.org/.test(haystack)) {
      add(match[1], "page-link", label.substring(0, 120));
    }
    if (links.length >= 24) break;
  }

  const jsonLdUrlPattern = /"(?:url|sameAs|citation|isBasedOn|contentUrl|downloadUrl)"\s*:\s*"([^"]+)"/gi;
  for (const match of html.matchAll(jsonLdUrlPattern)) add(match[1], "json-ld");
  return links;
}

async function enrichRelatedSourceUrl(rawUrl) {
  if (!isSafePublicHttpsUrl(rawUrl)) return [];
  try {
    let currentUrl = rawUrl;
    let response = null;
    for (let redirectCount = 0; redirectCount <= 3; redirectCount++) {
      if (!isSafePublicHttpsUrl(currentUrl)) return [];
      response = await fetchWithTimeout(currentUrl, {
        method: "GET",
        credentials: "omit",
        redirect: "manual",
        referrerPolicy: "no-referrer",
        headers: { Accept: "text/html,application/xhtml+xml" },
      }, 8000);
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const nextUrl = absoluteUrl(response.headers.get("location") || "", currentUrl);
      if (!nextUrl) return [];
      currentUrl = nextUrl;
    }
    if (!response) return [];
    if (!response.ok || !isSafePublicHttpsUrl(response.url)) return [];
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) return [];
    const contentLength = parseInt(response.headers.get("content-length") || "0", 10);
    if (contentLength > 1024 * 1024) return [];
    const html = (await response.text()).slice(0, 1024 * 1024);
    return [
      { url: response.url, evidence: "redirect-target" },
      ...extractRelatedMetadata(html, response.url),
    ];
  } catch (_) {
    return [];
  }
}

// === CONTEXT MENU ===
if (chrome?.runtime?.onInstalled) {
chrome.runtime.onInstalled.addListener(async () => {
  // Run all migrations and telemetry init
  await migrateStorageIfNeeded().catch(e => logger.error('Storage migration failed (onInstalled):', e));
  await migrateSettingsIfNeeded().catch(e => logger.error('Settings migration failed (onInstalled):', e));
  await validateSettings().catch(e => logger.error('Settings validation failed (onInstalled):', e));
  await backupSettings().catch(e => logger.error('Settings backup failed (onInstalled):', e));
  await initializeTelemetry().catch(e => logger.error('Telemetry init failed (onInstalled):', e));

  // Context Menu — recreate clean (drops legacy affiliate items)
  const buildMenus = () => {
    chrome.contextMenus.create({
      id: "content-tools",
      title: "FeedWriter",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: "summarize-selection",
      parentId: "content-tools",
      title: "Tóm tắt nội dung",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: "translate-selection",
      parentId: "content-tools",
      title: "Dịch (EN → VI)",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: "translate-slang",
      parentId: "content-tools",
      title: "Slang / thành ngữ",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: "translate-collocation",
      parentId: "content-tools",
      title: "Collocations (cụm hay đi kèm)",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: "translate-shadowing",
      parentId: "content-tools",
      title: "Shadowing (luyện nói)",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: "separator-1",
      parentId: "content-tools",
      type: "separator",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: "unshorten-shopee",
      parentId: "content-tools",
      title: "Bóc Link Shopee",
      contexts: ["selection"],
    });
  };
  try {
    chrome.contextMenus.removeAll(() => buildMenus());
  } catch (_) {
    buildMenus();
  }

  // Migrate old single apiKey + restore from local backup if sync empty
  // (do NOT write empty apiKeys — that can wipe recovery chance on race)
  (async () => {
    try {
      const data = await chrome.storage.sync.get(["apiKey", "apiKeys", "provider"]);
      const localData = await chrome.storage.local.get(["backupApiKeys"]);
      let apiKeys = data.apiKeys || null;
      const providers = [
        "groq",
        "gemini",
        "cerebras",
        "nvidia",
        "sambanova",
        "openrouter",
      ];
      const count = (m) =>
        m && typeof m === "object"
          ? providers.reduce((n, p) => n + (Array.isArray(m[p]) ? m[p].length : 0), 0)
          : 0;

      if (!apiKeys || count(apiKeys) === 0) {
        if (localData.backupApiKeys && count(localData.backupApiKeys) > 0) {
          apiKeys = localData.backupApiKeys;
          logger.info("Restored apiKeys from local backup on install/update");
        } else {
          apiKeys = {
            groq: [],
            gemini: [],
            cerebras: [],
            sambanova: [],
            openrouter: [],
          };
        }
      }
      for (const p of providers) {
        if (!Array.isArray(apiKeys[p])) apiKeys[p] = [];
      }
      if (data.apiKey && count(apiKeys) === 0) {
        const provider = data.provider || "groq";
        if (!apiKeys[provider].includes(data.apiKey)) {
          apiKeys[provider].push(data.apiKey);
        }
      }
      // Only write when we have something useful or structure needs normalize
      if (count(apiKeys) > 0 || data.apiKeys) {
        await chrome.storage.sync.set({ apiKeys });
        if (count(apiKeys) > 0) {
          await chrome.storage.local.set({ backupApiKeys: apiKeys });
        }
      }
    } catch (e) {
      logger.error("apiKeys migrate/restore failed:", e);
    }
  })();

  ensureKeepAliveAlarm();
});
} // end if (chrome?.runtime?.onInstalled)

async function clearShopeeCookies() {
  const domains = [".shopee.vn", "shopee.vn", ".shope.ee", "shope.ee"];
  for (const d of domains) {
    const cookies = await chrome.cookies.getAll({ domain: d });
    for (const c of cookies) {
      await chrome.cookies.remove({
        url: "https://" + c.domain.replace(/^\./, "") + c.path,
        name: c.name,
      });
    }
  }
}

async function processUnshorten(url, tabId) {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "https:" || !["shope.ee", "www.shope.ee"].includes(parsedUrl.hostname)) {
      throw new Error("Chỉ hỗ trợ link https://shope.ee");
    }
    const resp = await fetchWithTimeout(
      url,
      { method: "GET", redirect: "follow" },
      30000,
    );
    const finalUrl = resp.url;
    const cleanMatch = finalUrl.match(/-i\.(\d+)\.(\d+)/);
    const output = cleanMatch
      ? "https://shopee.vn/product/" + cleanMatch[1] + "/" + cleanMatch[2]
      : finalUrl;
    await clearShopeeCookies();
    chrome.tabs
      .sendMessage(tabId, { action: "unshorten-result", text: output })
      .catch(() => {});
    chrome.tabs.create({
      url: "https://affiliate.shopee.vn/offer/custom_link",
    });
  } catch (e) {
    chrome.tabs
      .sendMessage(tabId, {
        action: "unshorten-result",
        error: "Lỗi extract: " + e.message,
      })
      .catch(() => {});
  }
}

if (chrome?.commands?.onCommand && chrome?.tabs?.query) {
  chrome.commands.onCommand.addListener((command) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        const msg = { action: "shortcut-" + command };
        chrome.tabs
          .sendMessage(tabs[0].id, msg)
          .catch(() => injectAndSend(tabs[0].id, msg));
      }
    });
  });
}

if (chrome?.contextMenus?.onClicked) {
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "summarize-selection" && info.selectionText) {
    const msg = {
      action: "summarize-selection",
      text: info.selectionText,
      type: "summary",
    };
    chrome.tabs
      .sendMessage(tab.id, msg)
      .catch(() => injectAndSend(tab.id, msg));
  } else if (
    (info.menuItemId === "translate-selection" ||
      info.menuItemId === "translate-slang" ||
      info.menuItemId === "translate-collocation" ||
      info.menuItemId === "translate-shadowing") &&
    info.selectionText
  ) {
    const modeMap = {
      "translate-selection": "auto",
      "translate-slang": "slang",
      "translate-collocation": "collocation",
      "translate-shadowing": "shadowing",
    };
    const msg = {
      action: "translate-selection",
      text: info.selectionText,
      mode: modeMap[info.menuItemId] || "auto",
    };
    chrome.tabs
      .sendMessage(tab.id, msg)
      .catch(() => injectAndSend(tab.id, msg));
  } else if (info.menuItemId === "unshorten-shopee" && info.selectionText) {
    const urlMatches = info.selectionText.match(/https?:\/\/shope\.ee\/[^\s]*/);
    if (!urlMatches) {
      chrome.tabs
        .sendMessage(tab.id, {
          action: "unshorten-result",
          error: "Không tìm thấy link shope.ee trong phần bôi đen",
        })
        .catch(() => {});
      return;
    }
    processUnshorten(urlMatches[0], tab.id);
  }
});
} // end if (chrome?.contextMenus?.onClicked)

// === BADGE COUNTER ===
async function incrementBadge() {
  const today = new Date().toDateString();
  const data = await chrome.storage.local.get(["dailyCount", "lastDate"]);
  let count = data.lastDate === today ? data.dailyCount || 0 : 0;
  count++;
  await chrome.storage.local.set({ dailyCount: count, lastDate: today });
  chrome.action.setBadgeText({ text: count.toString() });
  chrome.action.setBadgeBackgroundColor({ color: "#8B93F7" });
}

// === PORT-BASED STREAMING ===
if (chrome?.runtime?.onConnect) {
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "summarize-stream") return;
  const controller = new AbortController();

  port.onMessage.addListener(async (msg) => {
    if (msg.action !== "summarize") return;
    try {
      const result = await handleStream(
        msg.text,
        msg.site,
        port,
        controller.signal,
        msg.type,
        msg.sourceUrl,
        msg.imageUrl,
        msg.author,
        msg.postTitle,
        msg.postSource,
        msg.tone || null,
        msg.preferredProvider || null,
      );
      if (result && result.error)
        port.postMessage({ action: "error", error: result.error });
      else if (result && result.summary)
        port.postMessage({
          action: "done",
          full: result.summary,
          quality: result.quality,
          issues: result.issues,
          imageUrl: msg.imageUrl || "",
        });
    } catch (e) {
      if (e.name !== "AbortError") {
        try {
          port.postMessage({ action: "error", error: e.message });
        } catch (_) {}
      }
    }
  });

  port.onDisconnect.addListener(() => controller.abort());
});
} // end if (chrome?.runtime?.onConnect)

// === FALLBACK: non-streaming for test/context menu ===
if (chrome?.runtime?.onMessage) {
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (sender.id && sender.id !== chrome.runtime.id) {
    console.warn("[FeedWriter] Rejected message from untrusted sender:", sender.id);
    return false;
  }

  const sensitiveActions = new Set(["summarize", "fetch-image"]);
  if (sensitiveActions.has(request.action) && !sender.id) {
    console.warn("[FeedWriter] Rejected sensitive message without extension sender id");
    sendResponse({ error: "Untrusted sender" });
    return true;
  }

  if (request.action === "ping") {
    sendResponse({ ok: true });
    return true;
  }

  if (request.action === "disable-github-autopost") {
    // Legacy cleanup: clear old alarm + force flag off
    (async () => {
      try {
        if (chrome?.alarms) await chrome.alarms.clear("auto-github-post");
        await chrome.storage.sync.set({ autoGithubEnabled: false });
      } catch (_) {}
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (request.action === "enrich-related-source-links") {
    (async () => {
      const urls = Array.isArray(request.urls) ? request.urls : [];
      const unique = [...new Set(urls.filter(isSafePublicHttpsUrl))].slice(0, 4);
      const enriched = await Promise.all(unique.map(enrichRelatedSourceUrl));
      sendResponse({ links: enriched.flat().slice(0, 60) });
    })().catch((error) => sendResponse({ links: [], error: error.message }));
    return true;
  }

  // === SETTINGS BACKUP/RESTORE ===
  if (request.action === "backupSettings") {
    backupSettings()
      .then(backup => {
        sendResponse({ success: true, backup });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === "restoreSettings") {
    const backupIndex = request.backupIndex || 0;
    restoreSettings(backupIndex)
      .then(success => {
        sendResponse({ success });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  // === SHORTEN URL (bypass CORS) ===
  if (request.action === "shorten-url") {
    (async () => {
      try {
        const longUrl = request.url;
        let parsedLongUrl;
        try {
          parsedLongUrl = new URL(longUrl);
        } catch (_) {
          throw new Error("Invalid URL");
        }
        if (!isSafePublicHttpsUrl(parsedLongUrl.href)) {
          throw new Error("Only public HTTPS URLs are allowed");
        }

        const fetchShortUrl = async (url) => {
          const response = await fetchWithTimeout(url, { method: "GET" }, 5000);
          if (!response.ok) return "";
          const shortUrl = (await response.text()).trim();
          try {
            const parsedShortUrl = new URL(shortUrl);
            return ["http:", "https:"].includes(parsedShortUrl.protocol) ? shortUrl : "";
          } catch (_) {
            return "";
          }
        };

        // 1. Try is.gd (Preferred)
        try {
          const params = new URLSearchParams({
            format: 'simple',
            url: longUrl,
          });
          const shortUrl = await fetchShortUrl(`https://is.gd/create.php?${params}`);
          if (shortUrl) {
            console.log('[FeedWriter] is.gd success:', shortUrl);
            sendResponse({ success: true, shortUrl });
            return;
          }
        } catch (error) {
          console.warn('[FeedWriter] is.gd failed:', error);
        }

        // 2. Try v.gd (Similar service to is.gd)
        try {
          const params = new URLSearchParams({
            format: 'simple',
            url: longUrl,
          });
          const shortUrl = await fetchShortUrl(`https://v.gd/create.php?${params}`);
          if (shortUrl) {
            console.log('[FeedWriter] v.gd success:', shortUrl);
            sendResponse({ success: true, shortUrl });
            return;
          }
        } catch (error) {
          console.warn('[FeedWriter] v.gd failed:', error);
        }

        // 3. Try da.gd
        try {
          const shortUrl = await fetchShortUrl(`https://da.gd/s?url=${encodeURIComponent(longUrl)}`);
          if (shortUrl) {
            console.log('[FeedWriter] da.gd success:', shortUrl);
            sendResponse({ success: true, shortUrl });
            return;
          }
        } catch (error) {
          console.warn('[FeedWriter] da.gd failed:', error);
        }

        // 4. Fallback to TinyURL
        try {
          const shortUrl = await fetchShortUrl(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(longUrl)}`);
          if (shortUrl) {
            console.log('[FeedWriter] TinyURL success:', shortUrl);
            sendResponse({ success: true, shortUrl });
            return;
          }
        } catch (error) {
          console.warn('[FeedWriter] TinyURL failed:', error);
        }

        // If all fail, return original URL
        console.warn('[FeedWriter] All URL shortening services failed, using original URL');
        sendResponse({ success: true, shortUrl: longUrl });
      } catch (error) {
        console.error('[FeedWriter] Error shortening URL:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // === GET KEY STATUS for popup ===
  if (request.action === "get-key-status") {
    chrome.storage.local.get(["keyStatus"], (data) => {
      sendResponse(data.keyStatus || {});
    });
    return true;
  }
  if (
    request.action === "unshorten-shopee-inline" &&
    request.url &&
    sender.tab
  ) {
    processUnshorten(request.url, sender.tab.id);
    return true;
  }
  if (request.action === "summarize") {
    const fakePort = { postMessage: () => {} };
    const controller = new AbortController();
    handleStream(
      request.text,
      request.site || "unknown",
      fakePort,
      controller.signal,
      request.type || "summary",
    )
      .then((r) => sendResponse(r || { error: "Unknown error" }))
      .catch((e) => sendResponse({ error: e.message }));
    return true;
  }
  // === TEST CONNECTION (lightweight, no guardrails) ===
  if (request.action === "test-connection") {
    (async () => {
      try {
        // Unstick keys blocked by soft cooldowns from prior timeouts/errors
        await clearAllKeyCooldowns();

        const nonStreamFns = {
          groq: callGroqNonStream,
          gemini: callGeminiNonStream,
          cerebras: callCerebrasNonStream,
          nvidia: callNvidiaNonStream,
          sambanova: callSambanovaNonStream,
          openrouter: callOpenrouterNonStream,
        };

        const errors = [];
        // Try up to 6 different keys/providers
        for (let i = 0; i < 6; i++) {
          const keyInfo = await getAvailableKey();
          if (!keyInfo.key) {
            if (keyInfo.noKeys)
              return sendResponse({ error: "Chưa có API Key." });
            if (i === 0 && keyInfo.allLimited)
              return sendResponse({
                error:
                  "Tất cả " +
                  keyInfo.total +
                  " key bị rate limit. Thử lại sau ~" +
                  keyInfo.waitMinutes +
                  " phút.",
              });
            break;
          }
          const callFn = nonStreamFns[keyInfo.provider];
          if (!callFn) {
            errors.push(keyInfo.provider + ": provider không hỗ trợ");
            await markKeyCooldown(keyInfo.key, 60_000, "no-fn");
            continue;
          }
          try {
            const result = await callFn(
              keyInfo.key,
              "Reply with exactly: OK",
              "You are a test bot. Reply OK.",
            );
            return sendResponse({
              ok: true,
              provider: keyInfo.provider,
              response: (result || "").substring(0, 50),
            });
          } catch (e) {
            const msg = e?.message || String(e);
            const cls = classifyProviderError(msg);
            errors.push(`${keyInfo.provider}: ${msg.substring(0, 80)}`);
            await markKeyCooldown(keyInfo.key, cls.cooldownMs, msg.substring(0, 120));
          }
        }
        sendResponse({
          error:
            errors.length > 0
              ? "Test thất bại — " + errors.slice(0, 3).join(" · ")
              : "Không tìm được key khả dụng.",
        });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }
  // === TRANSLATE (word / passage / slang / collocation / shadowing) ===
  if (
    (request.action === "translate-text" && request.text) ||
    (request.action === "translate-word" && (request.word || request.text))
  ) {
    const payload = request.text || request.word;
    const mode =
      request.mode || (request.action === "translate-word" ? "word" : "auto");
    translateText(payload, mode)
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ error: e.message }));
    return true;
  }
  // Floating toolbar on social pages → ensure active tab translate UI runs
  if (request.action === "relay-translate" && request.text) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab?.id) {
        sendResponse({ ok: false });
        return;
      }
      const msg = {
        action: "translate-selection",
        text: request.text,
        mode: request.mode || "auto",
      };
      chrome.tabs
        .sendMessage(tab.id, msg)
        .then(() => sendResponse({ ok: true }))
        .catch(() => {
          // Inject translate script if missing (rare)
          chrome.scripting
            .executeScript({ target: { tabId: tab.id }, files: ["translate.js"] })
            .then(() => chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["translate.css"] }))
            .then(() => chrome.tabs.sendMessage(tab.id, msg))
            .then(() => sendResponse({ ok: true }))
            .catch((e) => sendResponse({ ok: false, error: e?.message }));
        });
    });
    return true;
  }
  // === FETCH IMAGE AS BASE64 (CORS Bypass) ===
  // Used by fetchImageBlob() in content.js to bypass cross-origin canvas taint.
  // Timeout 20s (ảnh Facebook thường < 2MB, 20s đủ; 30s quá dài cho parallel fetch)
  if (request.action === "fetch-image") {
    const url = request.url;
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (_) {
      sendResponse({ error: "Invalid URL format" });
      return true;
    }
    if (!isSafePublicHttpsUrl(parsedUrl.href)) {
      sendResponse({ error: "Only public HTTPS URLs allowed" });
      return true;
    }
    fetchWithTimeout(url, {
      credentials: "omit",
      referrer: "",
      referrerPolicy: "no-referrer",
    }, 20000)
      .then((res) => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.blob();
      })
      .then((blob) => {
        // Reject empty/invalid blobs
        if (!blob || blob.size < 100) {
          sendResponse({ error: "Empty or invalid image" });
          return;
        }
        // Reject quá lớn (Facebook upload limit ~10MB)
        if (blob.size > 12 * 1024 * 1024) {
          sendResponse({ error: "Image too large (>12MB)" });
          return;
        }
        const reader = new FileReader();
        reader.onloadend = () => sendResponse({ base64: reader.result, size: blob.size, type: blob.type });
        reader.onerror = () => sendResponse({ error: "FileReader failed" });
        reader.readAsDataURL(blob);
      })
      .catch((e) => sendResponse({ error: e.message || "fetch failed" }));
    return true;
  }
});
} // end if (chrome?.runtime?.onMessage)

// === HEURISTIC SCORING (thay thế AI eval để tiết kiệm API call) ===
// Đánh giá nhanh dựa trên keywords, patterns, độ dài — không cần gọi AI
// Baseline thấp (default-reject): bài phải có tín hiệu dương rõ ràng mới qua ngưỡng >= 5
function heuristicScore(text) {
  if (!text || text.length < 30) return 1;

  const lower = text.toLowerCase();
  let score = 3; // Baseline thấp — default reject, cần tín hiệu dương để qua 5

  // === TIER 1A: AI/LLM brands — ưu tiên cao nhất (+3/hit, tối đa +6) ===
  const aiBrands = [
    'claude', 'anthropic', 'chatgpt', 'openai', 'gpt-4', 'gpt-3', 'gpt4',
    'gemini', 'google deepmind', 'llama', 'mistral', 'deepseek', 'qwen',
    'grok', 'copilot', 'perplexity', 'midjourney', 'sora', 'dall-e',
    'stable diffusion', 'runway ml', 'large language model', 'trí tuệ nhân tạo',
    'google ai studio', 'notebooklm', 'meta ai', 'microsoft ai', 'amazon bedrock',
  ];
  let aiBoost = 0;
  for (const kw of aiBrands) {
    if (lower.includes(kw)) aiBoost = Math.min(aiBoost + 3, 6);
  }
  score += aiBoost;

  // === TIER 1B: AI subscription / free-tier deals (+2 bonus trên AI boost) ===
  // "Claude Pro miễn phí", "ChatGPT Plus trial", "Gemini Advanced gói free"
  const freeSignals = ['miễn phí', 'free tier', 'free plan', 'dùng thử', 'trial ', 'gói miễn', 'đăng ký miễn', 'tháng miễn phí', 'promo code'];
  if (aiBoost > 0 && freeSignals.some((kw) => lower.includes(kw))) score += 2;

  // === TIER 1C: Security incidents — quan tâm cao (+2.5 nếu có 2+ tín hiệu, +1.5 nếu 1) ===
  const securityKeywords = [
    'data breach', 'rò rỉ dữ liệu', 'lộ dữ liệu', 'rò rỉ thông tin',
    'tấn công mạng', 'tin tặc', 'hacker tấn',
    'ransomware', 'malware', 'mã độc', 'phishing',
    'lỗ hổng bảo mật', 'bảo mật nghiêm trọng', 'zero-day',
    'vulnerability', 'exploit', 'an ninh mạng',
  ];
  const secHits = securityKeywords.filter((kw) => lower.includes(kw)).length;
  if (secHits >= 2) score += 2.5;
  else if (secHits === 1) score += 1.5;

  // === TIER 2: Tech companies / flagship hardware (+2/hit, tối đa +3) ===
  const techBrands = [
    'iphone', 'ipad', 'macbook', 'apple silicon', 'vision pro',
    'samsung galaxy', 'pixel phone', 'oneplus',
    'nvidia', 'rtx ', 'geforce', 'h100', 'a100',
    'microsoft', 'windows 11', 'azure', 'google cloud',
    'qualcomm', 'snapdragon', ' tsmc', 'intel core',
  ];
  let brandBoost = 0;
  for (const kw of techBrands) {
    if (lower.includes(kw)) brandBoost = Math.min(brandBoost + 2, 3);
  }
  score += brandBoost;

  // === TIER 3: Tech topics (+1/hit, tối đa +2) ===
  const techTopics = [
    'machine learning', 'deep learning', 'neural network', 'llm',
    'github', 'open source', 'mã nguồn mở',
    'lập trình', 'developer', 'kỹ sư phần mềm',
    'bảo mật', 'cybersecurity',
    'startup', 'unicorn', 'gọi vốn', 'funding', 'series a', 'series b',
    'chip ', 'vi xử lý', 'bán dẫn', 'semiconductor',
    'python', 'javascript', 'typescript', 'react', 'docker', 'kubernetes',
    'aws ', 'devops', 'cicd', 'api ', 'framework',
  ];
  const topicHits = techTopics.filter((kw) => lower.includes(kw)).length;
  score += Math.min(topicHits, 2);

  // === TIER 4: Tips/hướng dẫn (chỉ tính khi có tech anchor) ===
  const tipKeywords = ['hướng dẫn', 'tutorial', 'tips', 'thủ thuật', 'mẹo hay', 'tối ưu', 'productivity'];
  const techAnchors = ['điện thoại', 'máy tính', 'laptop', 'app ', 'phần mềm', 'chrome', 'android', 'ios '];
  const hasTip = tipKeywords.some((kw) => lower.includes(kw));
  const hasTechAnchor = techAnchors.some((kw) => lower.includes(kw));
  if (hasTip && hasTechAnchor) score += 1.5;
  else if (hasTip) score += 0.3;

  // === News signals (+1 nếu bài có tín hiệu tin tức) ===
  const newsKeywords = [
    'ra mắt', 'vừa ra mắt', 'chính thức ra', 'công bố', 'announce',
    'phiên bản mới', 'cập nhật mới', 'billion', 'triệu usd', 'funding',
    'nghiên cứu mới', 'research paper',
  ];
  if (newsKeywords.some((kw) => lower.includes(kw))) score += 1;

  // === URL presence (+0.5): bài có link thường là chia sẻ tin ===
  if (/https?:\/\//.test(text)) score += 0.5;

  // === NEGATIVE: spam bán hàng (-3 mỗi hit, cap -5) ===
  const spamKeywords = [
    'mua ngay', 'giá sốc', 'flash sale', 'voucher', 'mã giảm',
    'shopee.vn', 'lazada.vn', 'tiki.vn',
    'dm để', 'inbox để', 'liên hệ ngay', 'số lượng có hạn',
    'free ship', 'miễn phí vận chuyển',
  ];
  let spamHits = 0;
  for (const kw of spamKeywords) {
    if (lower.includes(kw)) spamHits++;
  }
  score -= Math.min(spamHits * 3, 5);

  // === NEGATIVE: nội dung cá nhân/drama/off-topic (-2 mỗi hit, cap -4) ===
  const offTopicKeywords = [
    'chúc mừng sinh nhật', 'happy birthday', 'bóc phốt', 'drama',
    'sao hàn', 'kpop', 'phim bộ', 'bóng đá', 'ngoại hạng anh',
    'công thức nấu', 'cách nấu', 'tuyển dụng', 'cần tuyển',
    'chiêm tinh', 'tarot', 'tử vi',
  ];
  let offTopicHits = 0;
  for (const kw of offTopicKeywords) {
    if (lower.includes(kw)) offTopicHits++;
  }
  score -= Math.min(offTopicHits * 2, 4);

  // === LENGTH heuristic ===
  if (text.length < 100) score -= 1;
  if (text.length >= 200 && text.length <= 3000) score += 0.5;

  return Math.max(1, Math.min(9, Math.round(score)));
}

// === AUTO-PILOT EVALUATE SUMMARY LOGIC ===
async function evaluateSummaryForAgent(payload, tabId) {
  const prompt = `Bạn là biên tập viên tech. Đánh giá bài tóm tắt sau có xứng đáng chia sẻ lên trang công nghệ không.

ĐĂNG (score 7-9) — ưu tiên cao nhất cho:
- AI/LLM mới: Claude, ChatGPT, Gemini, Anthropic, OpenAI, DeepSeek, Llama, Grok, Mistral...
- Đăng ký AI miễn phí / giá rẻ: gói free tier, trial, promo của các AI tool lớn
- Bảo mật: data breach, lỗ hổng nghiêm trọng, ransomware, tấn công quy mô lớn
- Sản phẩm tech nổi bật: iPhone, MacBook, chip AI, GPU thế hệ mới
- Startup tech gọi vốn lớn, IPO, M&A đáng chú ý
- Lập trình, công cụ dev, GitHub repo nổi bật, framework mới

BỎ QUA (score 1-3) — bài thuộc loại:
- Status cá nhân, cảm xúc, tâm sự, drama
- Quảng cáo, bán hàng thông thường (shopee, lazada, affiliate hàng tiêu dùng)
- Ẩm thực, du lịch, thời trang, thể thao, giải trí không liên quan tech
- Tin tức chính trị, xã hội không liên quan tech
- Tuyển dụng, chúc mừng, sự kiện cá nhân

Trả về JSON: {"score": 7}`;

  const nonStreamFns = {
    groq: callGroqNonStream,
    gemini: callGeminiNonStream,
    cerebras: callCerebrasNonStream,
    nvidia: callNvidiaNonStream,
    sambanova: callSambanovaNonStream,
    openrouter: callOpenrouterNonStream,
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const keyInfo = await getAvailableKey();
    console.log(
      "[Agent Eval] Attempt",
      attempt,
      "key:",
      keyInfo.key ? keyInfo.provider + ":***" : "NONE",
      "noKeys:",
      keyInfo.noKeys,
      "allLimited:",
      keyInfo.allLimited,
    );
    if (!keyInfo.key) {
      // Không có key — giải phóng agent ngay, không thể eval
      chrome.tabs
        .sendMessage(tabId, { action: "agent_decision", score: 0 })
        .catch(() => {});
      return;
    }

    const callFn = nonStreamFns[keyInfo.provider] || callGroqNonStream;
    try {
      const result = await callFn(
        keyInfo.key,
        prompt + "\n\nTóm tắt:\n" + payload.text,
        "You are a JSON-only API. Only output valid JSON.",
      );
      // Robust JSON extraction
      let data = { score: 0 };
      const match = result.match(/\{[\s\S]*"score"\s*:\s*\d+[\s\S]*\}/i);
      if (match) {
        try {
          data = JSON.parse(match[0]);
        } catch (e) {}
      } else {
        let cleanResult = (result || "").trim();
        if (cleanResult.startsWith("```json")) {
          cleanResult = cleanResult
            .replace(/^```json\n?/, "")
            .replace(/\n?```$/, "");
        }
        try {
          data = JSON.parse(cleanResult);
        } catch (e) {}
      }

      console.log("[Agent] Summary Score:", data.score);
      chrome.tabs
        .sendMessage(tabId, { action: "agent_decision", score: data.score })
        .catch(() => {});
      return;
    } catch (e) {
      if (
        e.message &&
        (e.message.includes("429") ||
          e.message.toLowerCase().includes("rate") ||
          e.message.toLowerCase().includes("limit"))
      ) {
        await markKeyRateLimited(keyInfo.key, parseRetryAfter(e.message));
      } else {
        // Lỗi thông thường (API down, sai key...) → mark key bị lỗi, thử provider tiếp theo
        const localData = await chrome.storage.local.get(["keyStatus"]);
        const keyStatus = localData.keyStatus || {};
        keyStatus[keyInfo.key] = {
          ...(keyStatus[keyInfo.key] || {}),
          rateLimitedUntil: Date.now() + 5 * 60 * 1000,
        }; // Tạm skip 5 phút
        await chrome.storage.local.set({ keyStatus });
        console.warn(
          "[Agent Eval] Provider",
          keyInfo.provider,
          "failed, trying next. Error:",
          e.message,
        );
      }
      continue; // Luôn thử provider tiếp theo
    }
  }

  // Trả về 0 nếu fail cả 3 lần để giải phóng Agent khỏi trạng thái WAITING_EVAL
  console.log("[Agent] Eval failed 3 times, sending score 0");
  chrome.tabs
    .sendMessage(tabId, { action: "agent_decision", score: 0 })
    .catch(() => {});
}

// === AUTO-PILOT EVALUATION LOGIC ===
async function evaluatePostForAgent(payload, tabId) {
  const prompt = `Bạn là một AI phân tích nội dung mạng xã hội.
Hãy đọc bài viết sau và chấm điểm độ thu hút từ 1-10 (ưu tiên bài có thông tin hữu ích, tin tức công nghệ, bài học).
Nếu điểm >= 8, hãy tóm tắt và viết lại thành 1 status Facebook mang phong cách cá nhân của bạn, ngắn gọn, hấp dẫn.
Nếu bài có gắn link, yêu cầu người đọc xem link ở dưới comment.
Luôn trả về ĐÚNG ĐỊNH DẠNG JSON (không có markdown code block):
{"score": 9, "status": "nội dung status..."}`;

  const nonStreamFns = {
    groq: callGroqNonStream,
    gemini: callGeminiNonStream,
    cerebras: callCerebrasNonStream,
    nvidia: callNvidiaNonStream,
    sambanova: callSambanovaNonStream,
    openrouter: callOpenrouterNonStream,
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const keyInfo = await getAvailableKey();
    if (!keyInfo.key) return;

    const callFn = nonStreamFns[keyInfo.provider] || callGroqNonStream;
    try {
      const result = await callFn(
        keyInfo.key,
        prompt,
        "You are a JSON-only API. Only output valid JSON.",
      );
      let cleanResult = (result || "").trim();
      if (cleanResult.startsWith("\`\`\`json")) {
        cleanResult = cleanResult
          .replace(/^\`\`\`json\n/, "")
          .replace(/\n\`\`\`$/, "");
      }
      try {
        const data = JSON.parse(cleanResult);
        console.log("[Agent] AI Score:", data.score);
        if (data.score >= 5 && data.status) {
          chrome.tabs
            .sendMessage(tabId, {
              action: "agent_execute",
              status: data.status,
              source: payload.source,
              image: payload.image,
            })
            .catch(() => {});
        } else {
          // Score too low or no status — release agent
          chrome.tabs
            .sendMessage(tabId, { action: "agent_decision", score: data.score || 0 })
            .catch(() => {});
        }
        return;
      } catch (pe) {
        console.error("[Agent] JSON parse error:", pe);
      }
    } catch (e) {
      if (
        e.message &&
        (e.message.includes("429") ||
          e.message.toLowerCase().includes("rate") ||
          e.message.toLowerCase().includes("limit"))
      ) {
        await markKeyRateLimited(keyInfo.key, parseRetryAfter(e.message));
        continue;
      }
      return;
    }
  }
}

// === TRANSLATE: word · passage · slang · collocation · shadowing ===
const translateCache = new LRUCache(200);

function buildTranslatePrompt(text, mode) {
  const src = String(text || "").trim().slice(0, 2500);
  const systemBase =
    "You are an expert English→Vietnamese language coach for learners. " +
    "Focus on natural usage: slang, idioms, collocations, register. " +
    "Be concise. Use Vietnamese for explanations. No emoji.";

  if (mode === "passage") {
    return {
      system: systemBase,
      prompt:
        `Dịch đoạn tiếng Anh sang tiếng Việt tự nhiên, chuẩn giao tiếp.\n\n` +
        `Trả lời đúng format (giữ tiêu đề **...**):\n` +
        `**Dịch:**\n(bản dịch trôi chảy)\n\n` +
        `**Slang / Informal:**\n(các từ lóng, thành ngữ, cách nói không trang trọng — nếu có; không thì viết "Không có")\n\n` +
        `**Collocations:**\n(cụm từ hay đi kèm trong đoạn, dạng: word + collocation — nghĩa)\n\n` +
        `**Ghi chú:**\n(1–2 lưu ý ngữ cảnh/register nếu hữu ích)\n\n` +
        `Đoạn:\n"""${src}"""`,
    };
  }

  if (mode === "slang") {
    return {
      system: systemBase,
      prompt:
        `Phân tích slang / thành ngữ / cách nói informal của đoạn/cụm tiếng Anh.\n\n` +
        `Format:\n` +
        `**Nghĩa đen:**\n...\n\n` +
        `**Nghĩa slang / ẩn dụ:**\n...\n\n` +
        `**Register:**\n(casual / rude / internet slang / business informal…)\n\n` +
        `**Tương đương tiếng Việt:**\n(cách nói tự nhiên tương đương)\n\n` +
        `**Ví dụ:**\n(1 câu EN + 1 câu VI)\n\n` +
        `**Lưu ý:**\n(khi nào nên/không nên dùng)\n\n` +
        `Input:\n"""${src}"""`,
    };
  }

  if (mode === "collocation") {
    return {
      system: systemBase,
      prompt:
        `Liệt kê collocations (cụm từ hay đi kèm) liên quan đến input tiếng Anh.\n\n` +
        `Format:\n` +
        `**Nghĩa cốt lõi:**\n...\n\n` +
        `**Collocations phổ biến:**\n` +
        `· verb + noun: ...\n` +
        `· adj + noun: ...\n` +
        `· prep patterns: ...\n` +
        `(liệt kê 5–10 cụm, mỗi dòng: collocation — nghĩa VI ngắn)\n\n` +
        `**Cụm hay nhầm:**\n(nếu có)\n\n` +
        `**Ví dụ ngắn:**\n(2 câu EN)\n\n` +
        `Input:\n"""${src}"""`,
    };
  }

  if (mode === "shadowing") {
    return {
      system: systemBase + " Optimize for speaking practice (shadowing).",
      prompt:
        `Chuẩn bị luyện shadowing (nghe-nói bắt chước) cho input tiếng Anh.\n\n` +
        `Format:\n` +
        `**Dịch nghĩa:**\n(bản VI rõ, tự nhiên)\n\n` +
        `**IPA / Phát âm gợi ý:**\n(phiên âm gần đúng, có thể tách từ khó)\n\n` +
        `**Chia đoạn shadowing:**\n` +
        `1. (chunk ngắn 3–8 từ)\n` +
        `2. ...\n` +
        `(3–8 chunks, giữ nguyên wording gốc)\n\n` +
        `**Nhịp & nhấn:**\n(từ nào nhấn, chỗ ngắt hơi)\n\n` +
        `**Mẹo luyện:**\n(1–2 câu)\n\n` +
        `Input:\n"""${src}"""`,
    };
  }

  // word / auto short phrase — dictionary + collocation + light slang
  return {
    system: systemBase,
    prompt:
      `Dịch từ/cụm tiếng Anh sang tiếng Việt cho người học.\n` +
      `Ưu tiên: nghĩa thực tế, slang nếu có, collocations hay đi kèm.\n\n` +
      `Format:\n` +
      `**Phiên âm:** /.../\n\n` +
      `**Nghĩa:** ...\n\n` +
      `**Loại từ / Register:** (n./v./adj · formal/casual/slang)\n\n` +
      `**Slang / Informal:** (nếu có; không thì "—")\n\n` +
      `**Collocations:** (3–6 cụm: collocation — nghĩa)\n\n` +
      `**Ví dụ:** (1 câu EN + 1 câu VI)\n\n` +
      `**Shadowing tip:** (chia 1–2 chunk ngắn để đọc to)\n\n` +
      `Input: "${src}"`,
  };
}

function resolveTranslateMode(text, mode) {
  const m = (mode || "auto").toLowerCase();
  if (["word", "passage", "slang", "collocation", "shadowing"].includes(m)) {
    return m;
  }
  // auto
  const t = String(text || "").trim();
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 4 && t.length <= 48) return "word";
  if (words.length <= 14 && t.length <= 120) return "word";
  return "passage";
}

async function translateText(text, mode = "auto") {
  const source = String(text || "").replace(/\s+/g, " ").trim();
  if (!source) return { error: "Không có văn bản để dịch." };
  if (source.length > 2500) return { error: "Đoạn quá dài (tối đa ~2500 ký tự)." };

  const resolved = resolveTranslateMode(source, mode);
  const cacheKey = resolved + "::" + source.toLowerCase();
  if (translateCache.has(cacheKey)) return translateCache.get(cacheKey);

  const { system, prompt } = buildTranslatePrompt(source, resolved);
  const nonStreamFns = {
    groq: callGroqNonStream,
    gemini: callGeminiNonStream,
    cerebras: callCerebrasNonStream,
    nvidia: callNvidiaNonStream,
    sambanova: callSambanovaNonStream,
    openrouter: callOpenrouterNonStream,
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const keyInfo = await getAvailableKey();
    if (!keyInfo.key) return { error: "Chưa có API Key khả dụng." };

    const callFn = nonStreamFns[keyInfo.provider] || callGroqNonStream;
    try {
      const result = await callFn(keyInfo.key, prompt, system);
      const output = {
        word: source,
        translation: (result || "").trim(),
        mode: resolved,
      };
      translateCache.set(cacheKey, output);
      return output;
    } catch (e) {
      if (
        e.message &&
        (e.message.includes("429") ||
          e.message.toLowerCase().includes("rate") ||
          e.message.toLowerCase().includes("limit"))
      ) {
        await markKeyRateLimited(keyInfo.key, parseRetryAfter(e.message));
        continue;
      }
      return { error: e.message };
    }
  }
  return { error: "Tất cả key đều bị rate limit." };
}

/** @deprecated use translateText — kept for older callers */
async function translateWord(word) {
  return translateText(word, "word");
}

// === HELPER: Intelligent text cleaning ===
function cleanInputText(text) {
  // Normalize whitespace only — don't remove content words
  return text.replace(/\s+/g, " ").trim();
}

// ============================================================
// === POST-PROCESSING GUARDRAILS (Validator Sandwich Pattern)
// ============================================================
// Research: freeCodeCamp "How to Build Reliable AI Systems",
// LangChain evaluation concepts, LLM guardrails best practices.
//
// Architecture:
//   INPUT GUARDRAILS → LLM (probabilistic) → OUTPUT GUARDRAILS
//
// Output guardrails run AFTER streaming completes, checking:
// 1. Length validation (too short / too long)
// 2. Copy detection (n-gram overlap with source)
// 3. Quality heuristics (empty, repetitive, off-topic)
// 4. Auto-fix for common issues (trim, clean formatting)
// ============================================================

// --- Input Guardrails ---
function validateInput(text) {
  if (!text || typeof text !== "string")
    return { valid: false, error: "Không có nội dung." };
  const trimmed = text.trim();
  if (trimmed.length < 30)
    return { valid: false, error: "Nội dung quá ngắn (cần ít nhất 30 ký tự)." };
  if (trimmed.length > 100000)
    return { valid: false, error: "Nội dung quá dài (tối đa 100.000 ký tự)." };
  return { valid: true, text: trimmed };
}

// --- Output Guardrails ---

// N-gram overlap: detect if output copies too much from source
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

// Repetition detection: check if output repeats itself
function detectRepetition(text) {
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

// Main post-processing function
function postProcessOutput(output, sourceText, type) {
  const issues = [];
  let processed = output.trim();

  // 1. Empty or near-empty check
  if (!processed || processed.length < 10) {
    return {
      text: processed,
      quality: "fail",
      issues: ["Output trống hoặc quá ngắn."],
    };
  }

  // 2. Length validation
  const minLen = 20;
  const maxLen = 2000;

  if (processed.length < minLen) {
    issues.push("Output ngắn bất thường.");
  }
  if (processed.length > maxLen) {
    // Auto-fix: truncate at last complete sentence
    const lastSentence = processed.substring(0, maxLen).lastIndexOf(".");
    if (lastSentence > maxLen * 0.5) {
      processed = processed.substring(0, lastSentence + 1);
      issues.push("Output đã được cắt ngắn.");
    }
  }

  // 3. Copy detection (n-gram overlap) — only for Vietnamese content
  if (sourceText && sourceText.length > 50) {
    const isVietnamese =
      /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(
        sourceText,
      );
    if (isVietnamese) {
      const overlap = computeNgramOverlap(sourceText, processed, 4);
      if (overlap > 0.6) {
        issues.push(
          "[!] Output copy nhiều từ bài gốc (" +
            Math.round(overlap * 100) +
            "%).",
        );
      }
    }
  }

  // 4. Repetition detection + auto-dedup
  const repRate = detectRepetition(processed);
  if (repRate > 0.3) {
    // Auto-fix: remove duplicate sentences
    const sentParts = processed.split(/([.!?。]\s*)/);
    const seen = new Set();
    const deduped = [];
    for (let i = 0; i < sentParts.length; i += 2) {
      const s = sentParts[i];
      const punct = sentParts[i + 1] || "";
      const key = s.toLowerCase().replace(/\s+/g, " ").trim();
      if (key.length < 10 || !seen.has(key)) {
        seen.add(key);
        deduped.push(s + punct);
      }
    }
    const dedupedText = deduped.join("").trim();
    if (dedupedText !== processed) {
      processed = dedupedText;
      issues.push("Đã xóa câu lặp lại.");
    } else {
      issues.push("Output có nhiều câu lặp lại.");
    }
  }

  // 5. Clean formatting artifacts
  // Remove leading/trailing quotes that LLMs sometimes add
  processed = processed.replace(/^["'""'']+|["'""'']+$/g, "").trim();
  // Remove "Tóm tắt:" or "Summary:" prefix that LLMs sometimes prepend
  processed = processed
    .replace(/^(tóm tắt|summary|status|review|affiliate)\s*[:：]\s*/i, "")
    .trim();
  // Strip "Đoạn 1:", "Đoạn 2:" labels that AI copies from format example
  processed = processed.replace(/^Đoạn\s*\d+\s*[:：]\s*/gim, "");
  // Normalize "*** Giải thích" → "**Giải thích" (old prompt format)
  processed = processed.replace(/^\*{3}\s*/gm, "**");

  // Xử lý tiêu đề dòng đầu tiên
  if (type && type.startsWith("summary")) {
    const lines = processed.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().length > 0) {
        // Strip ** bold markdown nếu AI vẫn trả về (prompt mới yêu cầu không dùng **)
        lines[i] = lines[i].replace(/^\*\*(.+?)\*\*$/, "$1");
        lines[i] = lines[i].replace(/^\*\*(.+)$/, "$1");
        lines[i] = lines[i].replace(/^(.+)\*\*$/, "$1");
        // Viết hoa toàn bộ tiêu đề
        lines[i] = lines[i].toUpperCase();
        break;
      }
    }
    processed = lines.join("\n");
    // Đảm bảo chỉ có ĐÚNG 1 dòng trống (\n\n) sau tiêu đề và giữa các đoạn
    processed = processed.replace(/\n{3,}/g, "\n\n");
  }

  // 6. VnReview spelling rules auto-fix
  // Fix common currency formatting
  processed = processed.replace(/\bđô[ -]?la\b/gi, "USD");
  processed = processed.replace(/\bđô\b(?!\s*C)/gi, "USD");
  // Fix abbreviated place names
  processed = processed.replace(/\bVN\b(?!\w)/g, "Việt Nam");
  processed = processed.replace(/\bHN\b(?!\w)/g, "Hà Nội");
  processed = processed.replace(/\bSG\b(?!\w)/g, "TP. HCM");
  // Fix day names capitalization (thứ hai → thứ Hai)
  processed = processed.replace(
    /\bthứ (hai|ba|tư|năm|sáu|bảy)\b/gi,
    (m, d) => "thứ " + d.charAt(0).toUpperCase() + d.slice(1),
  );
  processed = processed.replace(/\bchủ nhật\b/gi, "Chủ nhật");
  // Fix month names (tháng một → tháng Một, but tháng 10 stays)
  processed = processed.replace(
    /\btháng (một|hai|ba|tư|năm|sáu|bảy|tám|chín)\b/gi,
    (m, mo) => "tháng " + mo.charAt(0).toUpperCase() + mo.slice(1),
  );

  // 7. Brand name capitalization — fix lowercase brand names in body text.
  // Applied before title-uppercase step so the title still gets all-caps.
  // Only fix in body (after first line) to avoid fighting with toUpperCase().
  const titleEnd = processed.indexOf("\n");
  if (titleEnd > 0) {
    const title = processed.slice(0, titleEnd);
    let body = processed.slice(titleEnd);
    const brandFixes = [
      [/\bchrome\b/gi, "Chrome"],
      [/\bfirebase\b/gi, "Firebase"],
      [/\bgoogle\b/gi, "Google"],
      [/\bfacebook\b/gi, "Facebook"],
      [/\binstagram\b/gi, "Instagram"],
      [/\byoutube\b/gi, "YouTube"],
      [/\btiktok\b/gi, "TikTok"],
      [/\bwhatsapp\b/gi, "WhatsApp"],
      [/\btwitter\b/gi, "Twitter"],
      [/\bwindows\b/gi, "Windows"],
      [/\bmacos\b/gi, "macOS"],
      [/\b(?<![a-z])ios\b/gi, "iOS"],
      [/\bandroid\b/gi, "Android"],
      [/\biphone\b/gi, "iPhone"],
      [/\bipad\b/gi, "iPad"],
      [/\bapple\b/gi, "Apple"],
      [/\bmicrosoft\b/gi, "Microsoft"],
      [/\bopenai\b/gi, "OpenAI"],
      [/\bchatgpt\b/gi, "ChatGPT"],
      [/\bclaude\b/gi, "Claude"],
      [/\bgemini\b/gi, "Gemini"],
      [/\bgpt-(\d)/gi, "GPT-$1"],
      [/\blinkedin\b/gi, "LinkedIn"],
      [/\bpaypal\b/gi, "PayPal"],
      [/\bspotify\b/gi, "Spotify"],
      [/\bnetflix\b/gi, "Netflix"],
      [/\bamazon\b/gi, "Amazon"],
    ];
    for (const [re, fix] of brandFixes) body = body.replace(re, fix);
    processed = title + body;
  }

  // 8. Fix VND long format → short format (44.990.000 đồng → gần 45 triệu đồng)
  processed = processed.replace(
    /(\d{1,3})\.(\d{3})\.(\d{3})\s*(?:đồng|VND|vnđ|VNĐ)/gi,
    (match, a, b, c) => {
      const num = parseInt(a + b + c, 10);
      if (num >= 1000000000) {
        const ty = num / 1000000000;
        return (
          (ty % 1 === 0 ? ty.toString() : ty.toFixed(1).replace(".", ",")) +
          " tỷ đồng"
        );
      }
      const trieu = num / 1000000;
      if (trieu % 1 === 0) return trieu + " triệu đồng";
      return trieu.toFixed(1).replace(".", ",") + " triệu đồng";
    },
  );

  // 9. Remove empty lead-in sentences at the beginning
  const leadInPatterns = [
    /^[^\n.!?]*(?:mình|tôi|mình)\s+(?:vừa|mới|đã)\s+(?:đọc|xem|thấy|nghe|biết)\s+(?:được|thấy|về)?\s*[^\n.!?]*[.!?]\s*/i,
    /^(?:gần đây|mới đây|dạo gần đây|thời gian gần đây)[,.]?\s*[^\n.!?]*[.!?]\s*/i,
    /^(?:như (?:chúng ta|mọi người|các bạn) (?:đã |đều )?biết)[,.]?\s*[^\n.!?]*[.!?]\s*/i,
    /^(?:hôm nay|hôm qua|sáng nay|tối qua)\s+(?:mình|tôi)\s+(?:đọc|xem|thấy|nghe)[^\n.!?]*[.!?]\s*/i,
  ];
  for (const pat of leadInPatterns) {
    if (pat.test(processed)) {
      processed = processed.replace(pat, "").trim();
      issues.push("Đã xóa câu dẫn dắt rỗng ở đầu bài.");
      break;
    }
  }

  // 10. Hallucination detection: check if output contains numbers not in source
  if (sourceText && sourceText.length > 50) {
    const sourceNums = new Set(
      (sourceText.match(/\d[\d.,]*\d|\d+/g) || []).map((n) =>
        n.replace(/[.,]/g, ""),
      ),
    );
    const outputNums = (processed.match(/\d[\d.,]*\d|\d+/g) || []).map((n) =>
      n.replace(/[.,]/g, ""),
    );
    const fabricated = outputNums.filter(
      (n) => n.length >= 2 && !sourceNums.has(n),
    );
    if (fabricated.length >= 2) {
      issues.push(
        "[!] Output có thể chứa số liệu bịa (" +
          fabricated.slice(0, 3).join(", ") +
          ") — không tìm thấy trong bài gốc.",
      );
    }
  }

  // 11. Detect "nói xạo" - writing as if personally experienced when sharing others' content
  const fakeExperiencePatterns = [
    /\b(?:mình|tôi)\s+(?:vừa|đã|mới)\s+(?:thử|test|dùng|tạo|làm|mua|cài|nâng cấp|update)\b/i,
    /\b(?:mình|tôi)\s+(?:thử|test|dùng)\s+(?:rồi|xong|thấy)\b/i,
    /\b(?:mình|tôi)\s+(?:đã\s+)?(?:tạo|làm)\s+(?:được|ra|xong)\b/i,
    /\bthật\s+sự\s+(?:choáng|sốc|bất ngờ|ngạc nhiên)\b/i,
    /\b(?:mình|tôi)\s+(?:rất|cực kỳ|vô cùng)\s+(?:thích|hài lòng|ấn tượng|ngạc nhiên)\b/i,
    /\bsau khi (?:mình|tôi)\s+(?:dùng|thử|test|cài)\b/i,
    /\b(?:mình|tôi)\s+(?:khuyên|recommend|đề xuất)\b/i,
  ];
  for (const pat of fakeExperiencePatterns) {
    if (pat.test(processed)) {
      issues.push(
        "[!] Output viết như người trải nghiệm trực tiếp — có thể không chính xác nếu đây là nội dung chia sẻ lại.",
      );
      break;
    }
  }

  // 12. Detect excessive possessive "của bạn/mình/chúng ta"
  const possessiveMatches =
    processed.match(/của\s+(?:bạn|mình|chúng ta)/gi) || [];
  if (possessiveMatches.length >= 3) {
    issues.push(
      'Output dùng "của bạn/mình" ' +
        possessiveMatches.length +
        " lần — nên viết trực tiếp hơn.",
    );
  }

  // 13. Quality score
  let quality = "good";
  if (issues.some((i) => i.includes("fail") || i.includes("trống")))
    quality = "fail";
  else if (issues.some((i) => i.includes("[!]") || i.includes("copy")))
    quality = "warn";
  else if (issues.length > 0) quality = "info";

  return { text: processed, quality, issues };
}

async function handleStream(
  text,
  site,
  port,
  signal,
  type = "summary",
  sourceUrl = "",
  imageUrl = "",
  author = "",
  postTitle = "",
  postSource = "",
  tone = null,
  preferredProvider = null,
) {
  // === INPUT GUARDRAILS ===
  const inputCheck = validateInput(text);
  if (!inputCheck.valid) return { error: inputCheck.error };

  const data = await chrome.storage.sync.get(["summaryLength"]);
  const summaryLength = data.summaryLength || "medium";

  // Clean and truncate text
  const cleanedText = cleanInputText(inputCheck.text);
  const truncated =
    cleanedText.length > MAX_INPUT_CHARS
      ? cleanedText.substring(0, MAX_INPUT_CHARS) +
        "\n[...bài viết đã được cắt ngắn]"
      : cleanedText;

  let systemPrompt = await getSystemPrompt(
    type,
    site,
    author,
    sourceUrl,
    postTitle,
    postSource,
    tone,
  );

  const streamFns = {
    groq: callGroqStream,
    gemini: callGeminiStream,
    cerebras: callCerebrasStream,
    nvidia: callNvidiaStream,
    sambanova: callSambanovaStream,
    openrouter: callOpenrouterStream,
  };

  const maxTokensMap = { short: 256, medium: 512, long: 1024 };
  const maxTokens = maxTokensMap[summaryLength] || 512;

  // Try enough times to rotate through keys (was hard-capped at 4 → stuck early)
  const maxAttempts = 8;
  const attemptErrors = [];
  const triedKeys = new Set();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal.aborted) return { error: "Đã hủy." };

    // Get best available key across all providers
    const keyInfo = await getAvailableKey(attempt === 0 ? preferredProvider : null);
    if (!keyInfo.key) {
      if (keyInfo.noKeys)
        return { error: "Chưa có API Key. Thêm ở tab API Keys." };
      if (keyInfo.allLimited) {
        // One more chance: clear soft cooldowns and retry once
        if (attempt === 0) {
          await clearAllKeyCooldowns();
          continue;
        }
        return {
          error:
            "Tất cả " +
            keyInfo.total +
            " key đang cooldown/rate-limit. Thử lại sau ~" +
            keyInfo.waitMinutes +
            " phút, hoặc tab Keys → Test kết nối (xóa cooldown).",
        };
      }
      break;
    }

    // Avoid infinite loop on same key within this request
    const keyId = keyInfo.provider + ":" + (keyInfo.index ?? keyInfo.key.slice(0, 8));
    if (triedKeys.has(keyInfo.key)) {
      // Force short skip already-tried key
      await markKeyCooldown(keyInfo.key, 20_000, "already-tried");
      continue;
    }
    triedKeys.add(keyInfo.key);

    const callFn = streamFns[keyInfo.provider];
    if (!callFn) return { error: "Provider không hợp lệ: " + keyInfo.provider };

    try {
      port.postMessage({
        action: "status",
        message: `Đang kết nối ${keyInfo.provider} (${attempt + 1}/${maxAttempts})...`,
      });
    } catch (_) {}

    const result = await callFn(
      keyInfo.key,
      truncated,
      systemPrompt,
      port,
      signal,
      maxTokens,
    );

    if (result.rateLimited) {
      const retryMs = parseRetryAfter(result.rateLimitError || "");
      await markKeyRateLimited(keyInfo.key, retryMs);
      attemptErrors.push(`${keyInfo.provider}: rate limit`);
      try {
        port.postMessage({
          action: "status",
          message: `${keyInfo.provider} rate limit — thử key/provider khác...`,
        });
      } catch (_) {}
      continue;
    }

    if (result.error) {
      const cls = classifyProviderError(result.error, result.status || 0);
      console.warn(
        "[Stream] Provider",
        keyInfo.provider,
        "error:",
        result.error,
        "kind:",
        cls.kind,
        "→ trying next",
      );
      await markKeyCooldown(keyInfo.key, cls.cooldownMs, result.error);
      attemptErrors.push(`${keyInfo.provider}: ${String(result.error).substring(0, 100)}`);
      const statusMsg =
        cls.kind === "invalid"
          ? `${keyInfo.provider}: key không hợp lệ — thử key khác...`
          : cls.kind === "timeout"
            ? `${keyInfo.provider} chậm — thử provider khác...`
            : `${keyInfo.provider} lỗi — thử tiếp...`;
      try {
        port.postMessage({ action: "status", message: statusMsg });
      } catch (_) {}
      continue;
    }

    if (result.summary) {
      // Track successful summary
      await incrementTelemetry('summaries');
      trackEvent('summary_completed', { provider: keyInfo.provider, type });
      const postResult = postProcessOutput(result.summary, text, type);
      result.summary = postResult.text;
      result.quality = postResult.quality;
      result.issues = postResult.issues;
      incrementBadge();
      saveHistory(
        text,
        result.summary,
        site,
        type,
        sourceUrl,
        imageUrl,
        author,
        postTitle,
      );
    }
    return result;
  }

  const detail =
    attemptErrors.length > 0
      ? " Chi tiết: " + attemptErrors.slice(-3).join(" · ")
      : "";
  return {
    error:
      "Tất cả API đều lỗi hoặc quá tải. Kiểm tra API Key (tab Keys → Test kết nối)." +
      detail,
  };
}
// === HISTORY ===
async function saveHistory(
  text,
  summary,
  site,
  type,
  sourceUrl,
  imageUrl,
  author,
  postTitle,
) {
  const data = await chrome.storage.local.get("history");
  const history = data.history || [];
  history.unshift({
    text: text.substring(0, 2000),
    summary,
    date: new Date().toISOString(),
    site: site || "unknown",
    type: type || "summary",
    sourceUrl: sourceUrl || "",
    imageUrl: imageUrl || "",
    author: author || "",
    postTitle: postTitle || "",
  });
  if (history.length > 200) history.length = 200;
  historyBatcher.set('history', history);
}

// reviewTodayHistory uses getAvailableKey with retry on rate limit
// Generic streaming API call function
async function callStreamAPI(config) {
  const {
    url,
    headers = {},
    body,
    extractFn,
    port,
    signal,
    maxTokens = 512,
    provider = "unknown",
  } = config;

  const timeoutController = new AbortController();
  // Free-tier providers can be slow; 12s was too aggressive → false failures
  const firstTokenTimeoutMs = 22000;
  const totalTimeoutMs = 60000;
  let receivedToken = false;
  const abortRequest = () => timeoutController.abort();
  const timeoutId = setTimeout(abortRequest, totalTimeoutMs);
  const firstTokenTimeoutId = setTimeout(() => {
    if (!receivedToken) abortRequest();
  }, firstTokenTimeoutMs);
  signal.addEventListener("abort", abortRequest, { once: true });

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      signal: timeoutController.signal,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const raw = await resp.text().catch(() => "");
      let err = {};
      try {
        err = raw ? JSON.parse(raw) : {};
      } catch (_) {
        err = { message: raw.slice(0, 200) };
      }
      const msg =
        err.error?.message ||
        err.message ||
        (typeof err.error === "string" ? err.error : "") ||
        resp.statusText ||
        ("HTTP " + resp.status);
      if (resp.status === 429) {
        return {
          rateLimited: true,
          rateLimitError: msg,
          status: 429,
        };
      }
      // 401/403 = bad key; plain 403 with empty/CF body still treat as auth/network issue
      const invalidKey =
        resp.status === 401 ||
        /invalid|incorrect api key|api key|unauthorized|authentication/i.test(
          String(msg),
        );
      return {
        error: `${provider} API lỗi (${resp.status}): ` + msg,
        status: resp.status,
        invalidKey,
      };
    }
    return processStream(resp, port, timeoutController.signal, extractFn, () => {
      receivedToken = true;
      clearTimeout(firstTokenTimeoutId);
    });
  } catch (error) {
    if (error.name === "AbortError" && !signal.aborted) {
      const timeoutSeconds = receivedToken
        ? totalTimeoutMs / 1000
        : firstTokenTimeoutMs / 1000;
      return {
        error: `${provider} phản hồi quá chậm. Đã dừng sau ${timeoutSeconds} giây.`,
      };
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    clearTimeout(firstTokenTimeoutId);
    signal.removeEventListener("abort", abortRequest);
  }
}

// Non-streaming API calls for AI review
async function callNonStream(url, extraHeaders, body, extractFn) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    const msg = data?.error?.message || "HTTP " + response.status;
    throw new Error(msg);
  }
  return extractFn(data) || "";
}

async function callGroqNonStream(apiKey, userMessage, systemPrompt) {
  return callNonStream(
    "https://api.groq.com/openai/v1/chat/completions",
    { Authorization: "Bearer " + apiKey },
    {
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: 1024,
      temperature: 0.3,
    },
    (d) => d?.choices?.[0]?.message?.content,
  );
}

async function callGeminiNonStream(apiKey, userMessage, systemPrompt) {
  return callNonStream(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" +
      apiKey,
    {},
    {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userMessage }] }],
      generationConfig: { maxOutputTokens: 1024, temperature: 0.3 },
    },
    (d) => d?.candidates?.[0]?.content?.parts?.[0]?.text,
  );
}

// === EXPORT: Generate dtcn-v2 compatible JSON ===
function exportDtcnJson(items) {
  return items.map((item) => ({
    source: formatSourceName(item.site, item.author),
    title: item.postTitle || item.summary.split(/[.\n]/)[0].substring(0, 100),
    link: item.sourceUrl || "",
    image: item.imageUrl || "",
    summary: item.summary || "",
    full_body: item.text || "",
    score: item.aiScore || 50,
    pub_date: item.date || new Date().toISOString(),
  }));
}

function formatSourceName(site, author) {
  const siteNames = {
    facebook: "Facebook",
    threads: "Threads",
    x: "X (Twitter)",
    linkedin: "LinkedIn",
    reddit: "Reddit",
  };
  const siteName = siteNames[site] || site || "Web";
  return author ? `${author} (${siteName})` : siteName;
}

// === ALARM: Auto review ===
// Re-register alarm on SW startup if previously enabled
if (chrome?.runtime?.onStartup) {
chrome.runtime.onStartup.addListener(async () => {
  await migrateStorageIfNeeded().catch(e => logger.error('Storage migration failed (onStartup):', e));
  await migrateSettingsIfNeeded().catch(e => logger.error('Settings migration failed (onStartup):', e));
  await validateSettings().catch(e => logger.error('Settings validation failed (onStartup):', e));
  await initializeTelemetry().catch(e => logger.error('Telemetry init failed (onStartup):', e));
  const today = new Date().toDateString();
  const data = await chrome.storage.local.get([
    "dailyCount",
    "lastDate",
    "reviewAlarm",
  ]);
  if (data.lastDate === today) {
    chrome.action.setBadgeText({ text: (data.dailyCount || 0).toString() });
    chrome.action.setBadgeBackgroundColor({ color: "#8B93F7" });
  }

  ensureKeepAliveAlarm();
});
} // end if (chrome?.runtime?.onStartup)

// keep-alive alarm handled by the listener near line 386

// Legacy auto-GitHub removed.
if (chrome?.alarms) chrome.alarms.clear("auto-github-post").catch(() => {});
