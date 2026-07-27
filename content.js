"use strict";
// FeedWriter — Content script
// https://github.com/anlvdt/fb-post-summarizer
// Author: Le An (anlvdt)

// Boot marker — check facebook.com DevTools Console after reload.
// If you do NOT see this line, the page is still running an old inject (hard-refresh needed).
try {
  console.info("[FeedWriter] content UI v3 loaded", {
    host: location.hostname,
    path: location.pathname.slice(0, 40),
  });
} catch (_) {}

let MIN_LEN = 400;
let isBlocked = false;
const DEFAULT_SOURCE_TEMPLATE = "• Nguồn bài viết: {platform} {author} {source}\n  {link}";
let globalSourceTemplate = DEFAULT_SOURCE_TEMPLATE;
let globalCustomSourceLink = "";
let globalRelatedSourceLinks = [];
let pendingSourceDiscovery = null;
let scanTimer = null;
const injected = new WeakSet();
const summaryCache = new LRUCache(50);
const observers = []; // Store observers for cleanup
const listeners = []; // Store event listeners for cleanup

// Batch operations state
const batchOperations = {
  active: false,
  selectedTexts: [],
  currentIndex: 0,
  results: [],
  type: 'summary'
};

// Cleanup function
function cleanup() {
  observers.forEach(obs => obs.disconnect());
  observers.length = 0;
  listeners.forEach(({ element, event, handler, options }) => {
    element.removeEventListener(event, handler, options);
  });
  listeners.length = 0;
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
  if (sponsoredCatchupTimer) {
    clearInterval(sponsoredCatchupTimer);
    sponsoredCatchupTimer = null;
  }
  if (telemetryWriteTimer) {
    clearTimeout(telemetryWriteTimer);
    telemetryWriteTimer = null;
  }
}

// Cleanup only when the page is actually leaving. A new extension port is not
// a lifecycle signal: Facebook and our own helpers may open ports while the
// existing DOM scanners still need to keep running.
window.addEventListener("beforeunload", cleanup, { once: true });

let hideAffiliatePosts = false;
window.enableUnicodeBold = true;

chrome.storage.sync.get(["minLength", "blockedDomains", "sourceTemplate", "customSourceLink", "hideAffiliatePosts", "enableUnicodeBold"], (d) => {
  if (d.minLength) MIN_LEN = d.minLength;
  globalSourceTemplate = d.sourceTemplate || DEFAULT_SOURCE_TEMPLATE;
  globalCustomSourceLink = d.customSourceLink || "";
  hideAffiliatePosts = !!d.hideAffiliatePosts;
  if (d.enableUnicodeBold !== undefined) window.enableUnicodeBold = d.enableUnicodeBold;
  updateBlockedState(d.blockedDomains);

  // Auto-detect language from Facebook and set as default if not already set
  detectAndSetLanguage();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (changes.minLength) MIN_LEN = changes.minLength.newValue || 400;
  if (changes.sourceTemplate) globalSourceTemplate = changes.sourceTemplate.newValue || DEFAULT_SOURCE_TEMPLATE;
  if (changes.customSourceLink) globalCustomSourceLink = changes.customSourceLink.newValue || "";
  if (changes.hideAffiliatePosts) hideAffiliatePosts = !!changes.hideAffiliatePosts.newValue;
  if (changes.enableUnicodeBold) window.enableUnicodeBold = changes.enableUnicodeBold.newValue !== false;
  if (changes.adDisplayMode) adDisplayMode = changes.adDisplayMode.newValue || "hide";
  if (changes.affiliateDisplayMode) affiliateDisplayMode = changes.affiliateDisplayMode.newValue || "collapse";
  if (changes.blockedDomains) updateBlockedState(changes.blockedDomains.newValue);
});

function updateBlockedState(rawPatterns = "") {
  const patterns = String(rawPatterns || "")
    .split("\n")
    .map((pattern) => pattern.trim())
    .filter(Boolean);
  isBlocked = patterns.some((pattern) => location.href.includes(pattern));
}

// Detect language from Facebook page and set as default
function detectAndSetLanguage() {
  const htmlLang = document.documentElement.lang || "";
  let detectedLang = "vi"; // Default to Vietnamese

  // Map Facebook language codes to our output language
  if (htmlLang.startsWith("en")) {
    detectedLang = "en";
  } else if (htmlLang.startsWith("vi")) {
    detectedLang = "vi";
  } else if (htmlLang.startsWith("zh")) {
    detectedLang = "zh";
  } else if (htmlLang.startsWith("ja")) {
    detectedLang = "ja";
  } else if (htmlLang.startsWith("ko")) {
    detectedLang = "ko";
  } else if (htmlLang.startsWith("th")) {
    detectedLang = "th";
  } else if (htmlLang.startsWith("id")) {
    detectedLang = "id";
  }

  // Only set if user hasn't explicitly chosen a language
  chrome.storage.sync.get(["outputLanguage", "languageAutoDetected"], (data) => {
    if (!data.outputLanguage || data.languageAutoDetected !== false) {
      chrome.storage.sync.set({
        outputLanguage: detectedLang,
        languageAutoDetected: true
      });
    }
  });
}

function hashText(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++)
    h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  return h.toString(36);
}



// === THEME ===
let currentTheme = "light";
function detectTheme() {
  const bg = getComputedStyle(document.body).backgroundColor;
  if (!bg || bg === "rgba(0, 0, 0, 0)") return "dark";
  const m = bg.match(/\d+/g);
  if (!m) return "dark";
  return (+m[0] + +m[1] + +m[2]) / 3 > 128 ? "light" : "dark";
}
function applyTheme() {
  currentTheme = detectTheme();
  document
    .querySelectorAll(".fbs-wrap, .fbs-panel, .fbs-backdrop")
    .forEach((el) => {
      el.setAttribute("data-fbs-theme", currentTheme);
    });
}
let themeTimer = null;
function throttledApplyTheme() {
  if (themeTimer) return;
  themeTimer = setTimeout(() => {
    themeTimer = null;
    applyTheme();
  }, 500);
}
setTimeout(applyTheme, 1000);
const themeObserver = new MutationObserver(throttledApplyTheme);
themeObserver.observe(document.body, {
  attributes: true,
  attributeFilter: ["class", "style"],
});
observers.push(themeObserver);

// === AFFILIATE LINK DETECTION (uses unified engine from content-dom.js) ===
const affiliatePostsHidden = new WeakSet();

// Telemetry counters
let telemetry = {
  postsScanned: 0,
  postsFlaggedAds: 0,
  postsFlaggedAffiliate: 0,
  postsFlaggedCommentGate: 0,
  topReasons: {},
  falsePositiveProxy: 0,
  lastResetDate: new Date().toDateString(),
};

// Load telemetry from storage
chrome.storage.local.get(["fbsTelemetry"], (d) => {
  if (d.fbsTelemetry) {
    const today = new Date().toDateString();
    if (d.fbsTelemetry.lastResetDate !== today) {
      telemetry = { ...telemetry, lastResetDate: today };
    } else {
      telemetry = { ...telemetry, ...d.fbsTelemetry };
    }
  }
});

let telemetryWriteTimer = null;
function saveTelemetry() {
  clearTimeout(telemetryWriteTimer);
  telemetryWriteTimer = setTimeout(() => {
    telemetryWriteTimer = null;
    if (!isContextValid()) return;
    try {
      const write = chrome.storage.local.set({ fbsTelemetry: telemetry });
      if (write?.catch) {
        write.catch((err) => {
          if (isContextValid()) {
            console.warn("[FeedWriter] saveTelemetry failed:", err?.message || err);
          }
        });
      }
    } catch (err) {
      console.warn("[FeedWriter] saveTelemetry failed:", err?.message || err);
    }
  }, 1200);
}

// Display modes: hide, collapse, mark
// Sponsored / Được tài trợ defaults to full hide
let adDisplayMode = "hide";
let affiliateDisplayMode = "collapse";

chrome.storage.sync.get(["adDisplayMode", "affiliateDisplayMode"], (d) => {
  if (d.adDisplayMode) adDisplayMode = d.adDisplayMode;
  if (d.affiliateDisplayMode) affiliateDisplayMode = d.affiliateDisplayMode;
});

function _getReasonText(reason) {
  const reasonMap = {
    ads_about_link: "Link QC",
    why_am_i_seeing: "Ad disclosure",
    portal_label: "Nhãn Được tài trợ",
    aria_label: "aria Sponsored",
    sponsored_keyword: "Sponsored / Được tài trợ",
    ad_structure: "Cấu trúc ad",
    ads_library_link: "Ads Library",
    affiliate_domain: "Link Affiliate",
    shortener_link: "Short-link",
    affiliate_param: "Aff param",
    redirect_wrapper: "FB redirect",
    affiliate_text: "Nội dung Aff",
    affiliate_cta: "CTA Affiliate",
    // Engagement bait: do X to get Y
    comment_gate: "Comment để nhận",
    like_gate: "Like/react để nhận",
    share_gate: "Share để nhận",
    follow_gate: "Follow để nhận",
    tag_gate: "Tag bạn để nhận",
    join_gate: "Join group để nhận",
    inbox_gate: "Inbox/DM để nhận",
    engagement_combo: "Like+Cmt+Share để nhận",
    engagement_gate: "Làm X để nhận Y",
    action_comment: "cmt",
    action_like: "like",
    action_share: "share",
    action_follow: "follow",
    action_tag: "tag",
    action_join: "join",
    action_save: "save",
  };
  return reasonMap[reason] || reason;
}

/** Build human-readable label for engagement-gate posts from actions. */
function _engagementGateLabel(evalResult) {
  const actions = Array.isArray(evalResult?.engagementActions)
    ? evalResult.engagementActions
    : [];
  const actionVi = {
    comment: "comment",
    like: "like",
    share: "share",
    follow: "follow",
    tag: "tag",
    join: "join",
    save: "save",
  };
  if (actions.length >= 2) {
    return "Bài yêu cầu " + actions.map((a) => actionVi[a] || a).join("+");
  }
  if (actions.length === 1) {
    const a = actions[0];
    if (a === "comment") return "Bài yêu cầu comment";
    if (a === "like") return "Bài yêu cầu like/react";
    if (a === "share") return "Bài yêu cầu share";
    if (a === "follow") return "Bài yêu cầu follow";
    if (a === "tag") return "Bài yêu cầu tag bạn";
    if (a === "join") return "Bài yêu cầu join group";
    if (a === "save") return "Bài yêu cầu lưu bài";
  }
  // Fallback from primary reason key
  const r = (evalResult?.reasons || [])[0] || "";
  if (r === "like_gate") return "Bài yêu cầu like/react";
  if (r === "share_gate") return "Bài yêu cầu share";
  if (r === "follow_gate") return "Bài yêu cầu follow";
  if (r === "tag_gate") return "Bài yêu cầu tag bạn";
  if (r === "join_gate") return "Bài yêu cầu join group";
  if (r === "inbox_gate") return "Bài yêu cầu inbox/DM";
  if (r === "engagement_combo") return "Bài yêu cầu tương tác (combo)";
  return "Bài yêu cầu tương tác";
}

function _engagementGateShort(evalResult) {
  const actions = Array.isArray(evalResult?.engagementActions)
    ? evalResult.engagementActions
    : [];
  if (actions.length >= 2) return "Engage bait";
  if (actions[0] === "like") return "Like gate";
  if (actions[0] === "share") return "Share gate";
  if (actions[0] === "follow") return "Follow gate";
  if (actions[0] === "tag") return "Tag gate";
  if (actions[0] === "join") return "Join gate";
  if (actions[0] === "comment") return "Comment gate";
  return "Engage bait";
}

function hideFlaggedPost(postContainer, evalResult, type) {
  if (affiliatePostsHidden.has(postContainer)) return;
  affiliatePostsHidden.add(postContainer);

  const displayMode = type === "sponsored" ? adDisplayMode : affiliateDisplayMode;
  // Skip noisy action_* keys in visible reason chips — actions already in label
  const reasonText = evalResult.reasons
    .filter((r) => !String(r).startsWith("action_"))
    .map(_getReasonText)
    .join(", ");
  const confidence = evalResult.confidence;
  const isEngage =
    type === "comment_gate" || type === "engagement_gate";

  if (displayMode === "hide") {
    postContainer.style.display = "none";
    return;
  }

  if (displayMode === "mark") {
    postContainer.style.outline = "1px solid rgba(139, 147, 247, 0.45)";
    postContainer.style.outlineOffset = "3px";
    const badge = document.createElement("div");
    badge.className = "fbs-mark-badge";
    const shortType = type === "sponsored"
      ? "QC"
      : isEngage
        ? _engagementGateShort(evalResult)
        : "Aff";
    badge.textContent = `${shortType} · ${confidence}%`;
    postContainer.style.position = "relative";
    postContainer.appendChild(badge);
    return;
  }

  // Collapse mode — soft chip (violet accent, not red alarm)
  const kind =
    type === "sponsored" ? "sponsored" : isEngage ? "engagement" : "affiliate";
  const hiddenLabel =
    type === "sponsored"
      ? "Quảng cáo"
      : isEngage
        ? _engagementGateLabel(evalResult)
        : "Affiliate";

  const indicator = document.createElement("div");
  indicator.className = "fbs-affiliate-indicator fbs-hidden-chip";
  indicator.setAttribute("data-fbs-ui", "v3");
  indicator.setAttribute("data-kind", kind);
  indicator.innerHTML =
    '<svg class="fbs-hidden-chip-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">' +
    (kind === "sponsored"
      ? '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>'
      : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>') +
    "</svg>" +
    '<div class="fbs-hidden-chip-body">' +
    '<span class="fbs-hidden-chip-title"></span>' +
    (reasonText
      ? '<span class="fbs-hidden-chip-meta"></span>'
      : "") +
    "</div>" +
    '<button type="button" class="fbs-affiliate-show fbs-hidden-chip-show">Hiện</button>';

  indicator.querySelector(".fbs-hidden-chip-title").textContent =
    hiddenLabel + " đã ẩn";
  const metaEl = indicator.querySelector(".fbs-hidden-chip-meta");
  if (metaEl) {
    metaEl.textContent =
      reasonText + (confidence ? " · " + confidence + "%" : "");
    metaEl.title = metaEl.textContent;
  }

  const showBtn = indicator.querySelector(".fbs-hidden-chip-show");
  showBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    postContainer.style.display = "";
    indicator.remove();
    affiliatePostsHidden.delete(postContainer);
    telemetry.falsePositiveProxy++;
    saveTelemetry();
  });

  postContainer.style.display = "none";
  postContainer.parentElement?.insertBefore(indicator, postContainer);
}

/** Nested feed unit? (comment thread, etc.) */
function _isNestedFeedUnit(article) {
  let depth = 0;
  let anc = article.parentElement;
  for (let j = 0; j < 20; j++) {
    if (!anc || anc === document.body) break;
    if (
      anc.getAttribute("role") === "article" ||
      anc.hasAttribute("data-virtualized") ||
      (anc.getAttribute("data-pagelet") &&
        anc.getAttribute("data-pagelet").startsWith("FeedUnit"))
    )
      depth++;
    anc = anc.parentElement;
  }
  return depth >= 1;
}

function _feedCandidates(root) {
  const candidates = [];
  if (
    root?.nodeType === 1 &&
    (root.matches?.('article[role="article"]') ||
      root.matches?.("[data-virtualized]") ||
      root.matches?.('div[data-pagelet^="FeedUnit"]'))
  ) {
    candidates.push(root);
  }
  if (root?.querySelectorAll) {
    candidates.push(
      ...root.querySelectorAll(
        'article[role="article"], [data-virtualized], div[data-pagelet^="FeedUnit"]',
      ),
    );
  }
  return [...new Set(candidates)];
}

/**
 * Fast path: sponsored only — no fingerprint lock, re-checks until hidden.
 * Called on every new DOM node so ads die before user scrolls past.
 */
function scanSponsoredFast(rootEl, skipClutterScan = false) {
  if (SITE !== "facebook") return;
  const root =
    rootEl ||
    document.querySelector('div[role="main"]') ||
    document.querySelector('div[id^="mount_0_0"]') ||
    document.body;

  // Portal-based hide (detached "Được tài trợ" labels). Skip this expensive
  // document-wide pass when scanning a single newly-added post subtree.
  if (!skipClutterScan && typeof hideFeedClutter === "function") {
    try {
      hideFeedClutter();
    } catch (_) {}
  }

  const detect =
    typeof window.fbsDetectSponsoredSignals === "function"
      ? window.fbsDetectSponsoredSignals
      : typeof detectSponsoredSignals === "function"
        ? detectSponsoredSignals
        : null;
  const isSp =
    typeof isSponsored === "function"
      ? isSponsored
      : typeof window.fbsIsSponsored === "function"
        ? window.fbsIsSponsored
        : null;

  for (const article of _feedCandidates(root)) {
    if (affiliatePostsHidden.has(article)) continue;
    if (article.dataset.fbsSponsoredHidden === "1") continue;
    if (_isNestedFeedUnit(article)) continue;

    let hit = null;
    if (detect) {
      hit = detect(article);
    } else if (isSp && isSp(article)) {
      hit = { isSponsored: true, reasons: ["sponsored_keyword"], confidence: 85 };
    }
    if (!hit || !hit.isSponsored) continue;

    article.dataset.fbsSponsoredHidden = "1";
    telemetry.postsFlaggedAds++;
    for (const r of hit.reasons || []) {
      telemetry.topReasons[r] = (telemetry.topReasons[r] || 0) + 1;
    }
    hideFlaggedPost(
      article,
      {
        isSponsored: true,
        reasons: hit.reasons || ["portal_label"],
        confidence: hit.confidence || 90,
      },
      "sponsored",
    );
  }
}

function scanAffiliatePosts() {
  if (SITE !== "facebook") return;
  if (typeof window.fbsEvaluatePostSignals !== "function") return;

  // Always run sponsored fast path first
  scanSponsoredFast();

  const root =
    document.querySelector('div[role="main"]') ||
    document.querySelector('div[id^="mount_0_0"]') ||
    document.body;

  for (const article of _feedCandidates(root)) {
    if (affiliatePostsHidden.has(article)) continue;
    if (_isNestedFeedUnit(article)) continue;

    // Sponsored may appear after first paint (portal) — recheck if not yet hidden
    if (article.dataset.fbsSponsoredHidden !== "1") {
      const det =
        typeof window.fbsDetectSponsoredSignals === "function"
          ? window.fbsDetectSponsoredSignals(article)
          : null;
      if (det && det.isSponsored) {
        article.dataset.fbsSponsoredHidden = "1";
        telemetry.postsFlaggedAds++;
        for (const r of det.reasons || []) {
          telemetry.topReasons[r] = (telemetry.topReasons[r] || 0) + 1;
        }
        hideFlaggedPost(
          article,
          {
            isSponsored: true,
            reasons: det.reasons || [],
            confidence: det.confidence || 90,
          },
          "sponsored",
        );
        continue;
      }
    }

    const evalFingerprint = hashText(
      (article.innerText || article.textContent || "").trim(),
    );
    if (article.dataset.fbsEvalFingerprint === evalFingerprint) continue;

    article.dataset.fbsEvalFingerprint = evalFingerprint;
    telemetry.postsScanned++;

    const evalResult = window.fbsEvaluatePostSignals(article);

    if (evalResult.isSponsored) {
      article.dataset.fbsSponsoredHidden = "1";
      telemetry.postsFlaggedAds++;
      for (const r of evalResult.reasons) {
        telemetry.topReasons[r] = (telemetry.topReasons[r] || 0) + 1;
      }
      hideFlaggedPost(article, evalResult, "sponsored");
      continue;
    }

    // Engagement bait
    if (evalResult.isEngagementGate || evalResult.isCommentGate) {
      telemetry.postsFlaggedCommentGate++;
      for (const r of evalResult.reasons) {
        telemetry.topReasons[r] = (telemetry.topReasons[r] || 0) + 1;
      }
      hideFlaggedPost(article, evalResult, "engagement_gate");
    } else if (
      hideAffiliatePosts &&
      evalResult.isAffiliate &&
      evalResult.confidence >= 70
    ) {
      telemetry.postsFlaggedAffiliate++;
      for (const r of evalResult.reasons) {
        telemetry.topReasons[r] = (telemetry.topReasons[r] || 0) + 1;
      }
      hideFlaggedPost(article, evalResult, "affiliate");
    }
  }

  saveTelemetry();
}

// === SCAN LOGIC ===
function findNewSeeMoreElements() {
  const results = [];
  let roots = [];
  
  if (typeof visiblePosts !== "undefined" && visiblePosts.size > 0) {
    roots = Array.from(visiblePosts);
    // Eagerly scan newly rendered posts before async IntersectionObserver triggers
    const rootEl = document.querySelector('div[role="main"]') || document.querySelector('div[id^="mount_0_0"]') || document.body;
    if (rootEl && SITE === "facebook") {
      const candidates = rootEl.querySelectorAll('article[role="article"], [data-virtualized], div[data-pagelet^="FeedUnit"]');
      for (const c of candidates) {
        if (!c.dataset.fbsObserved) {
          roots.push(c);
        }
      }
    }
  } else {
    roots = [
      document.querySelector('div[role="main"]') ||
      document.querySelector('div[id^="mount_0_0"]') ||
      document.querySelector("main") ||
      document.body
    ];
  }

  for (const root of roots) {
    if (!root) continue;
    const els = root.querySelectorAll(
      'div[role="button"], span[role="button"], span[dir="auto"], div[dir="auto"]',
    );
    for (const el of els) {
      if (el.dataset.fbsScanned) {
        const textContainer = findTextContainer(el);
        const target = textContainer && findInjectTarget(textContainer);
        if (target && target.querySelector(".fbs-wrap, .fbs-btn, .fbs-btn-inline")) continue;
        delete el.dataset.fbsScanned;
      }
      if (el.children.length > 6) continue;
      // Normalize non-breaking spaces (\u00a0) to avoid match misses
      const t = (el.innerText || el.textContent || "").replace(/\u00a0/g, " ").trim().toLowerCase();
      if (t.length > 30 || t.length < 4) continue;
      // Clean ellipses, dots, and collapse double spaces to cover patterns like "... Xem thêm" or "xem thêm"
      const cleanT = t.replace(/\.+/g, "").replace(/\s+/g, " ").trim();
      if (SEE_MORE.some((kw) => cleanT === kw || cleanT.startsWith(kw) || t === kw || t === "..." + kw || t.startsWith(kw))) {
        el.dataset.fbsScanned = "1";
        if (isInNonPostArea(el)) continue;
        if (isSponsored(el)) continue;
        results.push(el);
      }
    }
  }
  return results;
}


// Non-organic feed labels (short text in post header, similar to "Sponsored")

// Find the closest ancestor article[role="article"] of an element (legacy helper)


// ── Feed wrapper finder ──────────────────────────────────────────────────
// Walk UP from any element inside a post to find the individual post wrapper.
// Stops at div[role="feed"] child or data-virtualized — does NOT stop at
// div[role="main"] which would match the entire newsfeed column.



// isSponsored: used by findNewSeeMoreElements to skip injecting button on ad posts.
// Finds the feed wrapper for el, then scans it for any sponsored signal.
// isSponsored: used by findNewSeeMoreElements to skip injecting button on ad posts.
// Finds the feed wrapper for el, then scans it for any sponsored signal.




function findClickable(el) {
  let p = el;
  for (let i = 0; i < 5; i++) {
    if (!p) return el;
    if (
      p.getAttribute("role") === "button" ||
      p.tagName === "A" ||
      p.tagName === "BUTTON"
    )
      return p;
    p = p.parentElement;
  }
  return el;
}

function findTextContainer(seeMoreEl) {
  let el = seeMoreEl,
    best = null;
  for (let i = 0; i < 12; i++) {
    el = el.parentElement;
    if (!el || el === document.body) break;
    const len = (el.innerText || "").length;
    if (len >= 100 && len < 10000) best = el;
    if (len >= 10000) break;
  }
  return best;
}

function findInjectTarget(textContainer) {
  let el = textContainer;
  for (let i = 0; i < 3; i++) {
    if (!el.parentElement || el.parentElement === document.body) break;
    el = el.parentElement;
  }
  return el;
}

// === IMPROVED TEXT EXTRACTION ===
// Based on readability heuristics and Vietnamese content patterns

function extractMainContent(element) {
  if (!element) return "";

  // Clone to avoid modifying DOM
  const clone = element.cloneNode(true);

  // Remove unwanted elements (structural noise + potentially dangerous embeds)
  const unwanted = clone.querySelectorAll(
    "script, style, nav, footer, aside, iframe, object, embed, " +
      "noscript, template, svg[aria-hidden], " +
      '[role="navigation"], [role="banner"], [role="complementary"], ' +
      ".related-posts, .recommended, .recommendation",
  );
  unwanted.forEach((el) => el.remove());

  // Get text content
  let text = clone.innerText || clone.textContent || "";

  // Clean up whitespace
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

function cleanText(text) {
  // Only remove SEE_MORE patterns at the end of text
  const patterns = [...SEE_MORE];
  let cleaned = text;
  for (const p of patterns) {
    const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cleaned = cleaned.replace(
      new RegExp("\\s*" + escaped + "\\s*$", "gi"),
      "",
    );
  }
  return cleaned.replace(/\s+/g, " ").trim();
}

const ICON_BASE64 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAJPklEQVR42s2aa4xdVRXHf2vv87h37ms605m+ZlqmBdpSmpaWYsNTRT7II0agorbGF0SRGD9ACLXEQNLSRh6iRg0JBQQrQo2KicaECOElIFamRGkFpS0taWk703ncO3MfZ+/th3PndqbTofOq407OnEzmnD3/tc5a//Xfa2+hOr5bWK/vSW02AKu33Xl2sTO/wVl3Gc7NwzE1QwCRfaLkhURDetNraze+cyJWAdjk7tIb5C6zctsmdGjay0d6lolzuMjgjGUqh2iFeBonQtCU3WlKevmOtRtqmIVr12h+s92sfnpjW7G79z3le5jOHhxiBBQSGzmFw+Gw4LRuyGIrEYlcZv5rn7tzD9eu0YJzXPTwbeQrximrMOVKJCJezQMiKBGcm3gc2eocSmTUUSmAcw4X3yMd+J5VlrSv5ZUb78NDhPJDt+/SdT5RZ2EIeCVCvlxif9dhnABmnB9DQegFtE1roK8ScSTfg3OjD83GVJZMmEREPFOuRF5DyiuX7C5EFsuqx+84o1KI9rhiaSAlauAP9nbhrOXOK27gijPPQytVfWL0hljrCH1Nvlxk9YO3snrBEjZfs44jvd2nnMY6R2uukXuf+x3PvbuT5nSu+hUdkgjxU16bV+oobNZ1AdaJEUEPgD/a10UumWT3rT+btGDu7e9mWjLFyuYFvJ/pIKkDHHZEOyrOMDtsoD6VoS8qV9PR4ZwYpZwudRQ2e4K62JUMAup41sCh3i723PFgPJGJ0EqNO+49pSkbE89s4+j/sLcTpXxCUSPmg3WWbJimWCnFnj2eFyrGrC72wLU44xhgGyVCR76X1XMXMydbD87ha29CJALgiQBCZCMAVjUtoL1rP5GFYMSkFjxkOBEKUqX3FnWyl/pNmbn1jbEXTkdxAhDF8uxcUI6yc+Pm6hHjomyi00ruxlnQwvJs64SMUEyZSqiGjVYTMmLKDKgVqQkaMaUGTIYRU27AcCOOJ/ZoCqYaLzHG+sTF91NcMZtVAcnx+jD4ctU7WliWacXYCn22NKDkRhzeeAqTEgERRqMqdPU5T2nAESi/+vvIvhNPsbJpAf/pOUSSgNAPJs8AJRNQ10ECU/VnMYpQcjKDY72llGJOooFjlTylUj+e1hMzYMDzr7//L655bCMJX6OUN6p400rw8VjU3Er7gfdounstkXEnVN94/mP5brCVgdUMeB5z6huZmW6Ia8d4DHADYQNc+cjdCEIu2YAZwxrBh1hPeR6pMHHSutBZ6OaStiWEnsZYh8WRCkP2HjvM4d4eUkE4bF0yui9Q1SoCpIMEh3q7qC/2ExnDSeNgBCeMpNpECZ3FPFFkeOYrG4b9ffPz29n05+0sbJ4zzGneaGnOOoeI8NLNW7j28S2gDJ7ycdaNTQOdxDk4SyZMsHXNt2OZYS0igrEWX2uOFftGpEtvrMk7d1ozf/vOA6dxAUxNujuRoXViMljIOItzDg/BTBJoDUQ4BBnzumPMBmhRtXDQk+h573S/56oeAvhl+wt09RcIRBFNuOslOGfx/JCbzr+8lvAyynozegNcnG/rnryPbS/9nrppM4lcNClNI1EexZ4jPPr6n/jLLfdO/hcYXAe2tb/IuQtXkPMSk9Irqi3gZ7Ty6u4d9PT3kk1mqETxgupUOTE6GhWpVeLbLv0s9/1hK2GuaRLCp0oxEZjeo3z58uvJJjNx4fO8IQ6UyaLRe6/6KtcvvYhjfT0EXjAJ3TpLJpXm7NnzmIbPnkMf0L73XTzRLG49gzNnt9LSPAvjy0m5dFzJ/7G5Z086/9/92E/Y8tsnKHYcjlsvLhb78886hxkt82hpaMAlQyj0HVfC45PTFoUMmWQ0DFCxBiXH49lYQ+D5vPrOP7nw61dD2ZBrncf0+QtrDORwHO3p5uDf/0p9Nod3/kKCbAZX6K/9fzV2Oa3GBr4qF3ztoZWqtScDz6f937u58IaPk2mew/zFS0nXpbDOYqzBOou1llRdHdObm8E5jr7yDyrdfUgiqIXTaZfTDugq5Nl63S1cv+wSjDVoFZfA8268hsz8RdSn0xQHtXFEhHKlQmdvF7lUlsPdncxqaALRdO7YxcxLl+FUPLkaj5y21pJL5qgL6k55pcM6sskUa57YXNU5MfibfrwRTIWmTBZj7RDwAEfefpNn7voRHU89jzGGo93d6NAjKpbJ7zuE1IXg3GmW09YhSugp9eMHiSFU+MizzzBt9lxK1gwD/8Fbb/DEg9u46vyLYgf+8U3kypVYa/GTCQqHOsm0zcaITEBOi8HTp5DTKpYJ6UFSGWDX/r3YjqOkFizCVldZQ8D/4Bes+8Sna8/f/NPNoGIqtx6YviLlviJe6P1v5XRkDZ7SvLN/L0hV77iPBv/FLet5cvtWWpasqO3wOGuxxQokwpFzIBghQe2gVslYNL4dVE21VrWu8UeB//z31/Pkrx+lbemqGvhRFDJHQvl8WMhPWldCqkCNi99d2nYW6HjfzVrLwZ2v8/gPtw0D/9TTjzL33JWUTmg0i9YEyQAqER7IAdHS4iLrEMQ6R2M6w4t736ZkDKHW1Q2Oiat/qS6t5jXPIpw+g2N9vRR6unj258/yqRUX1J77wiDw0QngXcWh6xJOp1MSFfoOKId9WUKNG7QVICI0JpJ88qH1sbDSHqq6Wzmx6/hiaMu6b1F4q531a785BPyX7v8evxoBPCJExX5SsxqtTgc4Y1/+iE0+xb7Ow8zMTeOBq7/GZWeciyipFuHxrwKcc4Re3J1rvO5SektFKoVuVDpDfTJD57EjtMxuxVo7nMr7yniJgKYLz8H6Ab4nbQKw6qHbd5lQLRq+zaroLPRyMN9B0k8gTiYsoFX1RzaTI2c9DrzcTqIuSdmDqFImHSZPDr5QwvlC4wVLotSMRs8V8rvf+Mb9iz2cI3j4tsX5vrLTge8N3ui2ztKQStOYzgyplpPSfbAWySWYdcl5dOx4G5UvU5dIDAPvKhWiYgU/k6RhxVlRmMt5pZ5u0r5ejHNM7VED55AwRMSR33uQwsFOTH8RVzVCtEInky41u9FmWpq0V5+jnC+QmJab/9oNA0cNmOLDHs6BUvh1AdY4yn3FuEgBKhkQplPoOp9yXz9BfXanCfXyHZ8ZfNiD/5PjNtWugfgqbuoCuAhn2CfIC4npg47b5Nfre9Ix1v8CufyJNIfJsR8AAAAASUVORK5CYII=";

// === OVERLAY (panel, backdrop, streaming) ===
let backdrop = null,
  panel = null,
  panelBody = null;
let overlayPreviousFocus = null;

// Module-level: store the most recently extracted image list for callers
// that need multi-image support. Populated by extractPostImage() and read
// by extractPostImages() helper exposed on window.
let isSummarizing = false,
  currentPort = null;

function ensureOverlay() {
  // Force rebuild when an old panel shell is still on the page
  if (panel && panel.isConnected && panel.getAttribute("data-fbs-ui") === "v3") return;
  if (panel && panel.isConnected) {
    try { panel.remove(); } catch (_) {}
    panel = null;
    panelBody = null;
  }
  if (backdrop && backdrop.isConnected) {
    try { backdrop.remove(); } catch (_) {}
    backdrop = null;
  }
  // Drop any orphaned legacy panels from previous content-script injects
  document.querySelectorAll(".fbs-panel, .fbs-backdrop").forEach((el) => {
    if (el.getAttribute?.("data-fbs-ui") !== "v3") {
      try { el.remove(); } catch (_) {}
    }
  });

  backdrop = document.createElement("div");
  backdrop.className = "fbs-backdrop";
  document.body.appendChild(backdrop);
  backdrop.addEventListener("click", closeOverlay);

  panel = document.createElement("div");
  panel.className = "fbs-panel fbs-ui-v3";
  panel.setAttribute("data-fbs-ui", "v3");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "fbs-panel-title");
  panel.setAttribute("aria-hidden", "true");
  panel.setAttribute("tabindex", "-1");
  const shortcutMod = /Mac|iPhone|iPad|iPod/i.test(
    navigator.platform || navigator.userAgent || "",
  )
    ? "⌘"
    : "Ctrl";
  panel.innerHTML =
    '<div class="fbs-panel-head">' +
      '<div class="fbs-brand">' +
        '<img class="fbs-brand-icon" src="' + ICON_BASE64 + '" width="18" height="18" alt="">' +
        '<div class="fbs-brand-text">' +
          '<span class="fbs-title-text" id="fbs-panel-title">FeedWriter</span>' +
          '<span class="fbs-subtitle" data-role="panel-subtitle">Tóm tắt</span>' +
        '</div>' +
      '</div>' +
      '<div class="fbs-panel-actions">' +
        '<button type="button" class="fbs-icon-btn fbs-min" title="Thu gọn" aria-label="Thu gọn">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12h14"/></svg>' +
        '</button>' +
        '<button type="button" class="fbs-icon-btn fbs-close" title="Đóng" aria-label="Đóng">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>' +
    '<div class="fbs-panel-body" role="region" aria-live="polite"></div>' +
    '<div class="fbs-tone-row" hidden>' +
      '<span class="fbs-tone-label">Viết lại với tone</span>' +
      '<div class="fbs-tone-chips" role="group" aria-label="Tone">' +
        '<button type="button" class="fbs-tone-btn" data-tone="short">Ngắn hơn</button>' +
        '<button type="button" class="fbs-tone-btn" data-tone="academic">Học thuật</button>' +
        '<button type="button" class="fbs-tone-btn" data-tone="viral">Viral</button>' +
        '<button type="button" class="fbs-tone-btn" data-tone="bullet">Bullet</button>' +
      '</div>' +
    '</div>' +
    '<div class="fbs-panel-footer">' +
      '<div class="fbs-footer-tools">' +
        '<button type="button" class="fbs-tool-btn fbs-edit-btn" title="Chỉnh sửa (' + shortcutMod + '+E)">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>' +
          '<span>Sửa</span>' +
        '</button>' +
        '<button type="button" class="fbs-tool-btn fbs-regen-btn" title="Viết lại">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6"/><path d="M21 13a9 9 0 1 1-3-7.7L21 8"/></svg>' +
          '<span>Lại</span>' +
        '</button>' +
        '<button type="button" class="fbs-tool-btn fbs-stop-btn" title="Dừng">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>' +
          '<span>Dừng</span>' +
        '</button>' +
        '<select class="fbs-model-select" title="Provider AI" aria-label="Provider AI">' +
          '<option value="">Auto</option>' +
          '<option value="groq">Groq</option>' +
          '<option value="gemini">Gemini</option>' +
          '<option value="cerebras">Cerebras</option>' +
          '<option value="sambanova">Samba</option>' +
          '<option value="openrouter">OpenRouter</option>' +
        '</select>' +
      '</div>' +
      '<div class="fbs-footer-primary">' +
        '<button type="button" class="fbs-btn-secondary fbs-copy-btn" title="Copy (' + shortcutMod + '+C)">' +
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
          'Copy' +
        '</button>' +
        '<button type="button" class="fbs-btn-primary fbs-post-status-btn" title="Kiểm tra nguồn & đăng status">' +
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>' +
          'Đăng status' +
        '</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(panel);
  panelBody = panel.querySelector(".fbs-panel-body");
  panel.querySelector(".fbs-close")?.addEventListener("click", closeOverlay);
  panel.querySelector(".fbs-min")?.addEventListener("click", toggleMinimize);
  panel.querySelector(".fbs-copy-btn")?.addEventListener("click", copyResult);
  panel
    .querySelector(".fbs-post-status-btn")
    ?.addEventListener("click", handlePostStatus);
  panel
    .querySelector(".fbs-stop-btn")
    ?.addEventListener("click", stopSummarize);
  panel.querySelector(".fbs-regen-btn")?.addEventListener("click", regenerate);
  panel.querySelector(".fbs-edit-btn")?.addEventListener("click", toggleEdit);
  panel.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || !panel.classList.contains("fbs-visible")) return;
    const focusable = Array.from(
      panel.querySelectorAll(
        'button:not([disabled]):not([hidden]), select:not([disabled]):not([hidden]), textarea:not([disabled]):not([hidden]), input:not([disabled]):not([hidden]), a[href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null);
    if (!focusable.length) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
  panel.querySelectorAll(".fbs-tone-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!lastSummarizeParams) return;
      const tone = btn.dataset.tone;
      panel.querySelectorAll(".fbs-tone-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const { text, type, _element } = lastSummarizeParams;
      summarizeText(text, type, _element, tone);
    });
  });
}

let lastSummarizeParams = null;

// Undo/Redo system for textarea
const undoRedoHistory = {
  stack: [],
  currentIndex: -1,
  maxSize: 50,

  push(value) {
    // Remove any redo history after current position
    this.stack = this.stack.slice(0, this.currentIndex + 1);

    // Add new state
    this.stack.push(value);

    // Limit stack size
    if (this.stack.length > this.maxSize) {
      this.stack.shift();
    } else {
      this.currentIndex++;
    }
  },

  undo() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      return this.stack[this.currentIndex];
    }
    return null;
  },

  redo() {
    if (this.currentIndex < this.stack.length - 1) {
      this.currentIndex++;
      return this.stack[this.currentIndex];
    }
    return null;
  },

  canUndo() {
    return this.currentIndex > 0;
  },

  canRedo() {
    return this.currentIndex < this.stack.length - 1;
  },

  clear() {
    this.stack = [];
    this.currentIndex = -1;
  }
};

function toggleEdit() {
  if (!panelBody) return;
  const editBtn = panel.querySelector(".fbs-edit-btn");
  const existingTextarea = panelBody.querySelector(".fbs-edit-textarea");

  if (existingTextarea) {
    // Save edits and switch back to display mode
    const editedText = existingTextarea.value;
    // Store edited text for copy
    panelBody.dataset.editedText = editedText;
    panelBody.innerHTML =
      '<div class="fbs-result">' + fmt(editedText) + "</div>";
    editBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg><span>Sửa</span>';
    editBtn.classList.remove("is-done");

    // Clear undo/redo history when exiting edit mode
    undoRedoHistory.clear();
  } else {
    // Switch to edit mode
    const currentText =
      panelBody.dataset.editedText || panelBody.innerText || "";
    panelBody.innerHTML =
      '<textarea class="fbs-edit-textarea" aria-label="Chỉnh sửa nội dung">' +
      esc(currentText) +
      "</textarea>";
    const textarea = panelBody.querySelector(".fbs-edit-textarea");

    // Initialize undo/redo history
    undoRedoHistory.clear();
    undoRedoHistory.push(currentText);

    // Track changes for undo/redo
    let typingTimer;
    textarea.addEventListener('input', () => {
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        undoRedoHistory.push(textarea.value);
      }, 500); // Save state after 500ms of no typing
    });

    // Handle Ctrl+Z (undo) and Ctrl+Y (redo)
    textarea.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          const prevValue = undoRedoHistory.undo();
          if (prevValue !== null) {
            textarea.value = prevValue;
          }
        } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
          e.preventDefault();
          const nextValue = undoRedoHistory.redo();
          if (nextValue !== null) {
            textarea.value = nextValue;
          }
        }
      }
    });

    textarea.focus();
    textarea.setSelectionRange(0, 0);
    editBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg><span>Xong</span>';
    editBtn.classList.add("is-done");
  }
}

function regenerate() {
  if (!lastSummarizeParams) return;
  const { text, type, _element, tone } = lastSummarizeParams;
  const prefix = hashText(text) + "_" + type;
  for (const k of summaryCache.keys()) {
    if (k.startsWith(prefix)) summaryCache.delete(k);
  }
  summarizeText(text, type, _element, tone);
}

function openOverlay(html, streaming, type = "summary") {
  ensureOverlay();
  const wasVisible = panel.classList.contains("fbs-visible");
  if (!wasVisible) overlayPreviousFocus = document.activeElement;
  // Brand stays "FeedWriter"; mode goes in subtitle
  const subtitle = panel.querySelector('[data-role="panel-subtitle"]');
  if (subtitle) {
    if (type === "status_share") subtitle.textContent = "Status";
    else if (type === "comment_summary") subtitle.textContent = "Bình luận";
    else if (streaming || isSummarizing) subtitle.textContent = "Đang viết…";
    else subtitle.textContent = "Tóm tắt";
  }

  // Streaming: chỉ update nội dung result, không rebuild toàn bộ DOM
  if (streaming) {
    const existingResult = panelBody.querySelector(".fbs-result");
    if (existingResult) {
      const temp = document.createElement("div");
      temp.innerHTML = html;
      const newResult = temp.querySelector(".fbs-result");
      if (newResult) {
        existingResult.innerHTML = newResult.innerHTML;
      }
    } else {
      panelBody.innerHTML = html;
    }

    const resultEl = panelBody.querySelector(".fbs-result");
    if (resultEl) {
      const chars = (resultEl.textContent || "").length;
      let progressEl = panel.querySelector(".fbs-stream-progress");
      if (!progressEl) {
        progressEl = document.createElement("span");
        progressEl.className = "fbs-stream-progress";
        const brandText = panel.querySelector(".fbs-brand-text");
        if (brandText) brandText.appendChild(progressEl);
      }
      progressEl.textContent = chars > 0 ? chars + " ký tự" : "";
    }
  } else {
    panelBody.innerHTML = html;
    const progressEl = panel.querySelector(".fbs-stream-progress");
    if (progressEl) progressEl.remove();
  }

  delete panelBody.dataset.editedText;
  backdrop.classList.add("fbs-visible");
  panel.classList.add("fbs-visible");
  panel.setAttribute("aria-hidden", "false");
  panel.classList.remove("is-composer", "fbs-panel-left", "fbs-minimized");
  panel.dataset.mode = type || "summary";
  panel.classList.toggle("is-streaming", !!(streaming || isSummarizing));
  panel.classList.toggle(
    "is-ready",
    !isSummarizing && !streaming && html.includes("fbs-result"),
  );

  const footer = panel.querySelector(".fbs-panel-footer");
  const hasContent =
    html.includes("fbs-result") ||
    html.includes("fbs-loading") ||
    html.includes("fbs-progress") ||
    streaming;
  if (footer) {
    footer.style.display = hasContent ? "flex" : "none";
    footer.classList.toggle("is-visible", !!hasContent);
    // Tools-only footer while streaming (primary actions hidden via setVis)
    footer.classList.toggle("is-streaming-footer", !!(isSummarizing || streaming));
  }

  const setVis = (sel, on) => {
    const el = panel.querySelector(sel);
    if (!el) return;
    el.style.display = on
      ? el.tagName === "SELECT"
        ? "inline-block"
        : "inline-flex"
      : "none";
    el.hidden = !on;
  };
  setVis(".fbs-stop-btn", isSummarizing || streaming);
  setVis(".fbs-copy-btn", !isSummarizing && !streaming);
  setVis(
    ".fbs-post-status-btn",
    !isSummarizing &&
      !streaming &&
      html.includes("fbs-result") &&
      SITE === "facebook",
  );
  setVis(
    ".fbs-regen-btn",
    !isSummarizing && !streaming && html.includes("fbs-result"),
  );
  setVis(
    ".fbs-edit-btn",
    !isSummarizing && !streaming && html.includes("fbs-result"),
  );
  setVis(".fbs-model-select", !isSummarizing && !streaming);

  const toneRow = panel.querySelector(".fbs-tone-row");
  const showTone =
    !isSummarizing &&
    !streaming &&
    html.includes("fbs-result") &&
    type === "summary";
  if (toneRow) {
    toneRow.hidden = !showTone;
    toneRow.classList.toggle("fbs-tone-visible", showTone);
  }
  if (showTone && lastSummarizeParams && lastSummarizeParams.tone) {
    panel.querySelectorAll(".fbs-tone-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.tone === lastSummarizeParams.tone);
    });
  } else if (!showTone) {
    panel
      .querySelectorAll(".fbs-tone-btn")
      .forEach((b) => b.classList.remove("active"));
  }
  if (streaming && panelBody.scrollHeight - panelBody.scrollTop < 500)
    panelBody.scrollTop = panelBody.scrollHeight;
  if (!wasVisible) {
    requestAnimationFrame(() => {
      const closeButton = panel?.querySelector(".fbs-close");
      if (closeButton && panel.classList.contains("fbs-visible")) closeButton.focus();
    });
  }
}


  function toggleMinimize(e) {
    if (e) e.stopPropagation();
    const panel = document.querySelector(".fbs-panel");
    if (!panel) return;
    panel.classList.toggle("fbs-minimized");
  }

  function closeOverlay() {
  stopSummarize();
  if (speechSynthesis.speaking) speechSynthesis.cancel();
  if (panel) {
    panel.classList.remove("fbs-visible");
    panel.classList.remove("fbs-panel-left");
    panel.classList.remove("is-composer");
    panel.classList.remove("is-streaming");
    panel.classList.remove("is-ready");
    panel.setAttribute("aria-hidden", "true");
  }
  if (backdrop) backdrop.classList.remove("fbs-visible");
  if (overlayPreviousFocus && typeof overlayPreviousFocus.focus === "function") {
    try { overlayPreviousFocus.focus(); } catch (_) {}
  }
  overlayPreviousFocus = null;
}

function stopSummarize() {
  if (!isSummarizing) return;
  isSummarizing = false;
  if (currentPort) {
    try {
      currentPort.disconnect();
    } catch (_) {}
    currentPort = null;
  }
  if (panelBody) {
    openOverlay(
      panelBody.innerHTML + '<div class="fbs-error">Đã dừng.</div>',
      false,
    );
  }
}

function copyResult() {
  // If in edit mode, get text from textarea; otherwise use edited cache or display text
  const textarea = panelBody?.querySelector(".fbs-edit-textarea");
  let text = "";

  if (textarea) {
    text = textarea.value;
  } else if (panelBody?.dataset?.editedText) {
    text = panelBody.dataset.editedText;
  } else {
    // Get text from fbs-result only (exclude product list HTML)
    const resultEl = panelBody?.querySelector(".fbs-result");
    if (resultEl) {
      text = resultEl.innerText || resultEl.textContent || "";
    } else {
      text = panelBody?.innerText || "";
    }
  }

  // Format for current platform using StatusFormatter (or legacy fallback)
  if (typeof StatusFormatter !== "undefined") {
    const platform = (typeof SITE !== "undefined") ? SITE : "facebook";
    const hasRepo = !!(typeof globalCustomSourceLink !== 'undefined' && globalCustomSourceLink);
    text = StatusFormatter.format(text, platform, { hasRepo });
  } else {
    text = applyUnicodeFormatting(text);
    const lines = text.split("\n");
    if (lines.length > 0) {
      lines[0] = lines[0].toUpperCase();
    }
    text = lines.join("\n");
  }

  navigator.clipboard.writeText(text).then(() => {
    const btn = panel.querySelector(".fbs-copy-btn");
    const orig = btn.innerHTML;
    btn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied';
    setTimeout(() => {
      btn.innerHTML = orig;
    }, 1500);
  });
}

// === ĐĂNG STATUS ===

async function handlePostStatus() {
  // Không cần check lastSummarizeParams — lấy text trực tiếp từ panel
  if (isSummarizing || !panelBody) return;

  try {
    // Lấy text từ panel — ưu tiên edited text, rồi fbs-result element (tránh lấy text nút bấm)
    const textarea = panelBody.querySelector(".fbs-edit-textarea");
    const resultEl = panelBody.querySelector(".fbs-result");
    let text = "";
    if (textarea) {
      text = textarea.value;
    } else if (panelBody.dataset.editedText) {
      text = panelBody.dataset.editedText;
    } else if (resultEl) {
      text = resultEl.innerText || resultEl.textContent || "";
    }
    text = text.trim();
    if (!text) return;

    // Auto-uppercase the first line (title)
    const lines = text.split("\n");
    if (lines.length > 0) {
      lines[0] = lines[0].toUpperCase();
    }
    text = lines.join("\n");

    // Lấy metadata từ DOM element (nếu có) — multi-strategy link + author
    const _element = lastSummarizeParams?._element || null;
    let meta = _element && typeof window.fbsExtractMeta === "function"
      ? window.fbsExtractMeta(_element)
      : null;
    let rawUrl = meta?.permalink || (_element ? extractPostPermalink(_element) : location.href);
    let author = meta?.author || (_element ? extractPostAuthor(_element) : "");
    let source = meta?.source || (_element ? extractPostSource(_element) : "");
    let linkQuality = meta?.quality || "";
    const imageUrl = _element ? extractPostImage(_element) : "";
    // Lấy TẤT CẢ ảnh để user có thể chọn paste multi-image
    const allImages = _element && typeof window.fbsExtractImages === "function"
      ? window.fbsExtractImages(_element)
      : (imageUrl ? [imageUrl] : []);
    let relatedLinks = [];
    if (_element && typeof window.fbsDiscoverRelatedSourceLinks === "function") {
      try {
        const discovered =
          pendingSourceDiscovery?.element === _element
            ? await pendingSourceDiscovery.promise
            : await window.fbsDiscoverRelatedSourceLinks(_element, text);
        // Only adopt discovered sourceUrl when stronger than a shell URL
        if (discovered?.sourceUrl) {
          const weak = typeof window.fbsIsWeakFbShellUrl === "function"
            ? window.fbsIsWeakFbShellUrl(rawUrl)
            : !rawUrl;
          const discoveredStrong = typeof window.fbsIsStrongFbPermalink === "function"
            ? window.fbsIsStrongFbPermalink(discovered.sourceUrl)
            : !!discovered.sourceUrl;
          if (!rawUrl || weak || discoveredStrong) {
            rawUrl = discovered.sourceUrl;
            if (discoveredStrong) linkQuality = "exact";
          }
        }
        relatedLinks = discovered?.relatedLinks || [];
      } catch (_) {}
    }
    // Prefer timestamp/"1 giờ" + Share→Copy whenever link is not a strong post permalink
    const isStrong =
      rawUrl &&
      typeof window.fbsIsStrongFbPermalink === "function" &&
      window.fbsIsStrongFbPermalink(rawUrl);
    const needsAsyncLink =
      !rawUrl ||
      !isStrong ||
      linkQuality === "shell" ||
      linkQuality === "" ||
      linkQuality === "constructed" ||
      (typeof window.fbsIsWeakFbShellUrl === "function" && window.fbsIsWeakFbShellUrl(rawUrl));
    if (_element && needsAsyncLink && typeof window.fbsExtractPermalinkAsync === "function") {
      try {
        const asyncUrl = await window.fbsExtractPermalinkAsync(_element, {
          forceShare: !isStrong,
        });
        if (
          asyncUrl &&
          (typeof window.fbsIsStrongFbPermalink !== "function" ||
            window.fbsIsStrongFbPermalink(asyncUrl) ||
            !rawUrl ||
            !isStrong)
        ) {
          rawUrl = asyncUrl;
          linkQuality =
            typeof window.fbsIsStrongFbPermalink === "function" &&
            window.fbsIsStrongFbPermalink(asyncUrl)
              ? "exact"
              : linkQuality || "constructed";
        }
      } catch (_) {}
    }
    // Re-read author after async in case DOM shifted (cheap, cached)
    if (_element && !author) {
      author = extractPostAuthor(_element) || "";
    }

    // Không append nguồn vào text — nguồn sẽ ghi ở comment đầu tiên

    // Normalize through the canonical helper so identity parameters such as
    // photo.php?fbid= and watch?v= are never discarded.
    const cleanUrl = cleanSourceUrl(rawUrl);

    // Dịch panel sang phải, ẩn backdrop
    panel.classList.add("fbs-panel-left");
    if (backdrop) backdrop.classList.remove("fbs-visible");
    openFacebookComposer(text, cleanUrl, imageUrl, author, source, allImages, relatedLinks, {
      linkQuality,
      postElement: _element,
    });
  } catch (_) {
    // Fallback
    const resultEl = panelBody?.querySelector(".fbs-result");
    const text = resultEl ? resultEl.innerText : panelBody?.innerText || "";
    panel.classList.add("fbs-panel-left");
    if (backdrop) backdrop.classList.remove("fbs-visible");
    openFacebookComposer(text.trim(), "", "", "", "", []);
  }
}



document.addEventListener("keydown", (e) => {
  // Close panel with Escape
  if (e.key === "Escape") {
    if (floatingToolbar) floatingToolbar.classList.remove("fbs-visible");
    closeOverlay();
    return;
  }

  // Panel shortcuts (only when panel is visible)
  const panel = document.querySelector(".fbs-panel.fbs-visible");
  if (!panel) return;

  // Copy with Ctrl+C (when not in input/textarea)
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && !["INPUT", "TEXTAREA"].includes(e.target.tagName)) {
    e.preventDefault();
    const copyBtn = panel.querySelector(".fbs-copy-btn");
    if (copyBtn) copyBtn.click();
    return;
  }

  // Edit with Ctrl+E
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "e") {
    e.preventDefault();
    const editBtn = panel.querySelector(".fbs-edit-btn");
    if (editBtn && editBtn.style.display !== "none") editBtn.click();
    return;
  }
});

// ============================================================
// POST API — shared by the manual composer flow
// ============================================================
function cleanSourceUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    const u = new URL(rawUrl);
    if (u.hostname.includes("facebook.com")) {
      if (typeof window.fbsCleanFbUrl === "function") {
        return window.fbsCleanFbUrl(rawUrl);
      }
      const mp = u.searchParams.get("multi_permalinks");
      if (mp && u.pathname.includes("/groups/"))
        return (
          u.origin + u.pathname.replace(/\/$/, "") + "/posts/" + mp + "/"
        );
      const sfid = u.searchParams.get("story_fbid");
      const uid = u.searchParams.get("id");
      if (sfid && uid) return u.origin + "/" + uid + "/posts/" + sfid + "/";
      const keep = new Set(["story_fbid", "id", "multi_permalinks", "v", "set", "theater", "fbid"]);
      for (const key of [...u.searchParams.keys()]) {
        if (keep.has(key)) continue;
        if (key.startsWith("utm_") || key.startsWith("__") || ["fbclid", "ref", "comment_id", "reply_comment_id", "mibextid"].includes(key)) {
          u.searchParams.delete(key);
        }
      }
      return u.toString().replace(/\?$/, "");
    }
    for (const k of [...u.searchParams.keys()]) {
      if (
        k.startsWith("utm_") ||
        k.startsWith("__") ||
        ["fbclid", "gclid", "ref", "comment_id", "reply_comment_id"].includes(
          k,
        )
      )
        u.searchParams.delete(k);
    }
    return u.toString().replace(/\?$/, "");
  } catch (_) {
    return rawUrl;
  }
}



// Parallel fetch nhiều ảnh cùng lúc, returns array of File (null entries filtered out)
// Max parallel: 5, timeout per image handled by background.js (30s)




function buildCommentText(cleanUrl, author, source, options = {}) {
  const isValidName = (n) =>
    n && n.length >= 2 && n.length < 80 && !/[a-f0-9]{10,}/i.test(n) && !/\d{8,}/.test(n);

  const a = isValidName(author) ? author.trim() : "";
  const s = isValidName(source) ? source.trim() : "";

  const plat = SITE === "facebook" ? "Facebook" :
               SITE === "threads" ? "Threads" :
               SITE === "reddit" ? "Reddit" :
               SITE === "x" ? "X" :
               SITE === "linkedin" ? "LinkedIn" : "Web";

  let isCustom = !!globalSourceTemplate && 
                 globalSourceTemplate !== "• Nguồn bài viết: {platform} {author} {source}\n  {link}" &&
                 globalSourceTemplate !== "• Nguồn bài viết: {platform} {author} {source}\\n  {link}";

  let out;
  if (isCustom) {
    out = globalSourceTemplate;
    out = out.replaceAll("{platform}", plat);
    out = out.replaceAll("{author}", a);
    out = out.replaceAll("{source}", s && s !== a ? `(${s})` : "");
  } else {
    if (a) {
      out = `NGUỒN THAM KHẢO:\n· Tác giả: ${a}${s && s !== a ? ` (${s})` : ""} · ${plat}\n· Link gốc: {link}`;
    } else {
      out = `NGUỒN THAM KHẢO:\n· Link gốc: {link}`;
    }
  }

  let linkStr = cleanUrl || "(chưa có link bài gốc)";
  if (globalCustomSourceLink) {
    if (out.includes("{repo}")) {
      out = out.replaceAll("{repo}", globalCustomSourceLink);
    } else {
      out += "\n· Repo/Mã nguồn: " + globalCustomSourceLink;
    }
  } else {
    out = out.replaceAll("{repo}", "");
  }

  out = out.replaceAll("{link}", linkStr);

  const relatedLinks = Array.isArray(options.relatedLinks)
    ? options.relatedLinks
    : Array.isArray(globalRelatedSourceLinks)
    ? globalRelatedSourceLinks
    : [];
  const normalizedSourceUrl = typeof window.fbsCleanRelatedUrl === "function"
    ? window.fbsCleanRelatedUrl(cleanUrl)
    : cleanUrl;
  const normalizedCustomUrl = typeof window.fbsCleanRelatedUrl === "function"
    ? window.fbsCleanRelatedUrl(globalCustomSourceLink)
    : globalCustomSourceLink;
  const seenRelated = new Set();
  for (const item of relatedLinks) {
    const rawUrl = typeof item === "string" ? item : item?.url;
    const url = typeof window.fbsCleanRelatedUrl === "function"
      ? window.fbsCleanRelatedUrl(rawUrl)
      : rawUrl;
    if (!url || seenRelated.has(url) || url === normalizedSourceUrl || url === normalizedCustomUrl) continue;
    seenRelated.add(url);
    const type = typeof item === "string" ? "reference" : item.type;
    const label = type === "github"
      ? "Repo/Mã nguồn"
      : type === "download"
        ? "Download"
        : "Tham khảo";
    out += "\n· " + label + ": " + url;
  }

  // Cleanup extra spaces but preserve intentional line breaks
  out = out.split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(line => line).join('\n');
  if (!out) out = "NGUỒN THAM KHẢO:\n· Link gốc: " + linkStr;

  // Strip any markdown bold/italic asterisks to ensure clean copy in comments
  out = out.replace(/\*\*/g, "").replace(/\*/g, "");

  return out;
}



// Expose DOM extractors for composer helpers
// Plural: returns ALL images from the post (main + shared inner, deduped & sorted)
// Must be called AFTER extractPostImage() for the same element since extractPostImage
// populates the internal _lastExtractedImages cache.
window.fbsExtractImages = function (element) {
  // Always re-run extraction to get fresh data for this element
  extractPostImage(element);
  return _lastExtractedImages.slice();
};

/**
 * Multi-strategy permalink:
 *  1) Timestamp / header link ("1 giờ") in the post unit
 *  2) Strong DOM patterns (pfbid, /posts/, story_fbid)
 *  3) Share → "Sao chép liên kết" / "Copy link" (most reliable when DOM is obfuscated)
 *
 * options.forceShare = true → always try Share after DOM (for "Tìm lại")
 */
window.fbsExtractPermalinkAsync = async function (element, options = {}) {
  const forceShare = !!(options && options.forceShare);
  try {
    if (SITE === "facebook" && element) {
      const postContainer = _findPostContainer(element);
      if (!postContainer) return extractPostPermalink(element) || "";

      const isBarePhoto = (u) =>
        typeof _isBareFbPhotoShell === "function" && _isBareFbPhotoShell(u);
      const isPostFamily = (u) => {
        if (!u || isBarePhoto(u)) return false;
        if (typeof _permalinkFamilyRank === "function") return _permalinkFamilyRank(u) >= 80;
        return (
          typeof _isStrongFbPermalink === "function" &&
          _isStrongFbPermalink(u) &&
          !/\/photo\/?(\?|$)/i.test(u)
        );
      };

      // 1) Timestamp chip first ("1 giờ" next to author) — post family only
      if (typeof _findTimestampPermalink === "function") {
        const ts = _findTimestampPermalink(postContainer);
        if (ts && isPostFamily(ts) && !forceShare) return _cleanFbUrl(ts);
      }

      // 2) Shared original + full DOM scan
      const meta = typeof extractPostMeta === "function" ? extractPostMeta(element) : null;
      if (meta?.permalink && meta.quality === "exact" && isPostFamily(meta.permalink) && !forceShare) {
        return meta.permalink;
      }

      const sharedInner = _findSharedPostArticle(postContainer);
      if (sharedInner) {
        const innerPermalink = _findPermalinkInContainer(sharedInner);
        if (innerPermalink && isPostFamily(innerPermalink) && !forceShare) {
          return _cleanFbUrl(innerPermalink);
        }
      }

      const domPermalink = _findPermalinkInContainer(postContainer);
      if (domPermalink && isPostFamily(domPermalink) && !forceShare) {
        return _cleanFbUrl(domPermalink);
      }

      // 3) Share → Copy link when DOM only has /photo/ shells or weak results
      const needShare =
        forceShare ||
        !domPermalink ||
        isBarePhoto(domPermalink) ||
        !isPostFamily(domPermalink) ||
        (meta && (meta.quality === "shell" || meta.quality === "constructed"));
      if (needShare) {
        const shareUrl = await _fbCopyLinkViaShareMenu(postContainer);
        if (shareUrl && !isBarePhoto(shareUrl)) return shareUrl;
      }

      // 4) Fallbacks — never return bare https://www.facebook.com/photo/
      if (meta?.permalink && meta.quality !== "shell" && !isBarePhoto(meta.permalink)) {
        return meta.permalink;
      }
      if (domPermalink && !isBarePhoto(domPermalink)) return _cleanFbUrl(domPermalink);
      if (meta?.permalink && !isBarePhoto(meta.permalink)) return meta.permalink;
    }
  } catch (_) {}

  return extractPostPermalink(element) || "";
};

/** Open post Share menu and click "Copy link" / "Sao chép liên kết". */
async function _fbCopyLinkViaShareMenu(postContainer) {
  if (!postContainer) return "";

  const isShareControl = (el) => {
    const label = (
      (el.getAttribute("aria-label") || "") +
      " " +
      (el.getAttribute("title") || "") +
      " " +
      ((el.textContent || "").slice(0, 80))
    )
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    if (!label) return false;
    // Exact-ish share actions — avoid "Share your thoughts" comment boxes
    if (
      label === "chia sẻ" ||
      label === "share" ||
      label.includes("gửi nội dung này cho bạn bè") ||
      label.includes("send this to friends") ||
      label.includes("gửi cho bạn bè") ||
      label.includes("share this") ||
      /^chia sẻ\b/.test(label) ||
      /^share\b/.test(label)
    ) {
      // Exclude comment composer / reactions
      if (label.includes("bình luận") || label.includes("comment") || label.includes("cảm xúc")) return false;
      return true;
    }
    return false;
  };

  // Prefer footer action bar buttons inside this post
  const scopeButtons = Array.from(
    postContainer.querySelectorAll('[role="button"], [aria-label], div[tabindex="0"]')
  );
  let shareBtn = scopeButtons.find(isShareControl) || null;

  // Sometimes share lives one level outside virtualized inner node
  if (!shareBtn && postContainer.parentElement) {
    shareBtn = Array.from(
      postContainer.parentElement.querySelectorAll('[role="button"][aria-label], [aria-label]')
    ).find(isShareControl) || null;
  }
  if (!shareBtn) return "";

  const oldClip = await navigator.clipboard.readText().catch(() => "");
  const existingSurfaces = new Set(
    document.querySelectorAll('div[role="dialog"], [role="menu"], [role="listbox"]'),
  );
  try {
    shareBtn.click();
  } catch (_) {
    return "";
  }

  // Wait for dialog OR menu popover
  let surface = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 150));
    surface = Array.from(
      document.querySelectorAll('div[role="dialog"], [role="menu"], [role="listbox"]'),
    ).find((candidate) => !existingSurfaces.has(candidate)) || null;
    if (surface) break;
  }
  if (!surface) {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return "";
  }

  const isCopyLabel = (t) => {
    t = (t || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!t || t.length > 48) return false;
    return (
      t === "sao chép liên kết" ||
      t === "copy link" ||
      t === "copy link to post" ||
      t === "copy" ||
      t.includes("sao chép liên kết") ||
      t.includes("copy link") ||
      t.includes("copy the link")
    );
  };

  let copyBtn = null;
  const nodes = surface.querySelectorAll(
    'span[dir="auto"], div[dir="auto"], [role="menuitem"], [role="button"], [role="listitem"], span'
  );
  for (const el of nodes) {
    const t = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!isCopyLabel(t)) continue;
    copyBtn =
      el.closest('[role="button"], [role="menuitem"], [role="listitem"], div[tabindex="0"], a') || el;
    // Prefer the row that is clickable
    if (copyBtn) break;
  }

  if (!copyBtn) {
    // Close and abort
    try {
      const closeBtn = surface.querySelector(
        '[aria-label="Đóng"][role="button"], [aria-label="Close"][role="button"]'
      );
      if (closeBtn) closeBtn.click();
      else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    } catch (_) {}
    return "";
  }

  try {
    copyBtn.click();
  } catch (_) {}

  // Poll clipboard for FB url (clipboard write can lag)
  let newClip = "";
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 150));
    newClip = await navigator.clipboard.readText().catch(() => "");
    if (
      newClip &&
      newClip !== oldClip &&
      /facebook\.com|fb\.watch|fb\.com/i.test(newClip)
    ) {
      break;
    }
  }

  // Dismiss UI
  try {
    const closeBtn = document.querySelector(
      'div[role="dialog"] [aria-label="Đóng"][role="button"], div[role="dialog"] [aria-label="Close"][role="button"]'
    );
    if (closeBtn) closeBtn.click();
    else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    // second escape for nested menus
    setTimeout(() => {
      try {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      } catch (_) {}
    }, 80);
  } catch (_) {}

  if (newClip && /facebook\.com|fb\.watch|fb\.com/i.test(newClip) && newClip !== oldClip) {
    return _cleanFbUrl(newClip);
  }
  return "";
}

// === HELPERS ===
function esc(s) {
  // textContent→innerHTML escapes & < > but NOT quotes; esc() is used in
  // attribute positions (value="", title="", data-url="") with data scraped
  // from Facebook posts, so quotes must be escaped to stop attribute breakout.
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Display structured error with actions
function displayError(errorData) {
  let errorHtml = '';

  // If errorData is a string (legacy), convert to structured format
  if (typeof errorData === 'string') {
    errorHtml = '<div class="fbs-error">' + esc(errorData) + '</div>';
  } else if (errorData && typeof errorData === 'object') {
    // Structured error from errors.js
    const severityClass = errorData.severity === 'warning' ? 'fbs-error-warning' :
                          errorData.severity === 'info' ? 'fbs-error-info' : '';

    errorHtml = '<div class="fbs-error ' + severityClass + '">' +
      '<div class="fbs-error-header">' +
        '<div class="fbs-error-icon">!</div>' +
        '<div class="fbs-error-title">' + esc(errorData.message) + '</div>' +
      '</div>' +
      '<div class="fbs-error-detail">' + esc(errorData.detail) + '</div>' +
      '<div class="fbs-error-action">' + esc(errorData.action) + '</div>';

    // Add action buttons if available
    if (errorData.actionButton) {
      errorHtml += '<div class="fbs-error-buttons">';

      if (errorData.retryable) {
        errorHtml += '<button class="fbs-error-btn fbs-error-btn-primary" onclick="window.location.reload()">Thử lại</button>';
      }

      if (errorData.actionUrl) {
        errorHtml += '<button class="fbs-error-btn" onclick="chrome.runtime.openOptionsPage()">' +
                     esc(errorData.actionButton) + '</button>';
      }

      errorHtml += '</div>';
    }

    errorHtml += '</div>';
  } else {
    errorHtml = '<div class="fbs-error">Lỗi không xác định</div>';
  }

  return errorHtml;
}

function fmt(t) {
  let text = t;

  // Use StatusFormatter if available (new unified engine)
  if (typeof StatusFormatter !== "undefined") {
    const hasRepo = !!(typeof globalCustomSourceLink !== 'undefined' && globalCustomSourceLink);
    // Store plain-text formatted version for copy/paste/post
    const plainText = StatusFormatter.format(text, "facebook", { hasRepo });
    if (panelBody) {
      panelBody.dataset.editedText = plainText;
    }
    // Return rich HTML for panel display
    return StatusFormatter.toDisplayHTML(text, { hasRepo });
  }

  // Legacy fallback: original formatting logic
  const isAlreadyFormatted = text.includes("━━━━━━━━━━");
  if (!isAlreadyFormatted) {
    const hasRepo = !!(typeof globalCustomSourceLink !== 'undefined' && globalCustomSourceLink);
    text = buildUnifiedStatusText(text, { hasRepo });
    if (panelBody) {
      panelBody.dataset.editedText = text;
    }
  }

  let html = esc(text);
  html = html
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>");
  html = html.replace(/✓\s+/g, '<span class="fbs-bullet-dot">·</span> ');
  html = html.replace(
    /━━━━━━━━━━/g,
    '<div class="fbs-source-footer" aria-hidden="true"></div>',
  );

  const lines = html.split("\n");
  let formattedLines = [];
  let inGlossary = false;
  let glossaryItems = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.includes("Giải thích thuật ngữ") || trimmed.includes("Giải thích:")) {
      inGlossary = true;
      glossaryItems = [];
      continue;
    }

    if (inGlossary) {
      if (!trimmed || trimmed.includes("━━━━━━━━━━") || trimmed.includes("fbs-source-footer")) {
        inGlossary = false;
        formattedLines.push(renderGlossaryCard(glossaryItems));
        if (trimmed && !trimmed.includes("fbs-source-footer")) formattedLines.push(line);
      } else {
        glossaryItems.push(line);
      }
      continue;
    }

    if (trimmed.includes("✓") || /class="fbs-bullet-dot"/.test(line)) {
      const cleanBullet = line
        .replace(/✓\s*/, "")
        .replace(/<span class="fbs-bullet-dot">·<\/span>\s*/g, "")
        .trim();
      formattedLines.push(
        '<div class="fbs-bullet"><span class="fbs-bullet-marker">▸</span><span class="fbs-bullet-text">' +
          cleanBullet +
          "</span></div>",
      );
    } else if (i === 0 && trimmed.length > 0) {
      formattedLines.push('<div class="fbs-title-line">' + line + "</div>");
    } else {
      formattedLines.push(
        line
          ? '<div class="fbs-para">' + line + "</div>"
          : '<div class="fbs-para-break" aria-hidden="true"></div>',
      );
    }
  }

  if (inGlossary && glossaryItems.length > 0) {
    formattedLines.push(renderGlossaryCard(glossaryItems));
  }

  return formattedLines.join("");
}

function renderGlossaryCard(items) {
  const normalizedItems = [];
  for (const rawItem of items) {
    const item = rawItem
      .replace(/<span class="fbs-bullet-dot">·<\/span>\s*/g, "")
      .replace(/^[·•\-*]\s*/, "")
      .trim();
    if (!item) continue;
    const continuation = item.match(/^:\s*(.+)$/);
    const previous = normalizedItems[normalizedItems.length - 1];
    if (continuation && previous && !previous.def) {
      previous.def = continuation[1].trim();
      continue;
    }
    const m = item.match(/^(.+?):\s*(.+)$/);
    normalizedItems.push(m
      ? { term: m[1].trim(), def: m[2].trim() }
      : { term: item, def: "" });
  }

  const itemsHtml = normalizedItems
    .map((item) => {
      return (
        '<div class="fbs-glossary-item"><span class="fbs-glossary-bullet">·</span>' +
        "<strong>" + item.term + "</strong>" +
        (item.def ? '<span class="fbs-glossary-def">: ' + item.def + "</span>" : "") +
        "</div>"
      );
    })
    .filter(Boolean)
    .join("");
  return (
    '<div class="fbs-glossary">' +
    '<div class="fbs-glossary-heading">Giải thích thuật ngữ</div>' +
    itemsHtml +
    "</div>"
  );
}

// === BUTTONS ===
function createBtn() {
  // Use <button> (not div[role=button]) so Facebook's [role=button] layout
  // rules cannot stretch it into a full-height strip.
  const d = document.createElement("button");
  d.type = "button";
  d.className = "fbs-btn";
  d.setAttribute("data-fbs-action", "summarize");
  d.innerHTML =
    '<img class="fbs-btn-icon" src="' +
    ICON_BASE64 +
    '" width="14" height="14" alt="" aria-hidden="true">' +
    '<span class="fbs-btn-label" title="Tóm tắt nội dung">Tóm tắt</span>';
  return d;
}

function createInlineBtn() {
  const d = document.createElement("span");
  d.className = "fbs-btn-inline";
  d.setAttribute("role", "button");
  d.setAttribute("tabindex", "0");
  d.setAttribute("data-fbs-ui", "v3");
  d.style.cssText =
    "cursor:pointer;font-size:inherit;font-family:inherit;background:none;border:none;padding:0;margin:0;display:inline;line-height:inherit;vertical-align:baseline;height:auto;width:auto;max-height:none;writing-mode:horizontal-tb;";
  d.innerHTML =
    ' · <span title="Tóm tắt nội dung" style="cursor:pointer;display:inline-flex;align-items:center;gap:3px;vertical-align:baseline;color:#A1A1AA;font-weight:600;font-size:0.92em;background:rgba(161,161,170,0.13);padding:0px 6px 1px;border-radius:8px;transition:background 0.15s"><img src="' +
    ICON_BASE64 +
    '" style="width:11px;height:11px;vertical-align:-1px;flex-shrink:0">Tóm tắt</span>';
  const pill = d.querySelector("span");
  d.addEventListener("mouseenter", () => {
    pill.style.background = "rgba(161,161,170,0.28)";
  });
  d.addEventListener("mouseleave", () => {
    pill.style.background = "rgba(161,161,170,0.13)";
  });
  return d;
}

// === POST METADATA EXTRACTION ===

// Helper: tìm nested/shared post article bên trong post container.
// Khi ai đó share bài của người khác, Facebook render nested article.
// Returns the inner (original) post article, or null if this is not a share.


// Helper: parse URL và clean tracking params — shared utility


// Helper: resolve l.facebook.com/l.php redirect URL to actual target.
// Facebook wraps external links như l.facebook.com/l.php?u=<ENCODED_URL>




// Helper tìm permalink trong 1 container (post hoặc nested shared post).
// Được tách ra để tái sử dụng cho cả bài thường và bài share.




// Facebook author helpers live in content-dom.js
// (_fbNameFromHeader, _fbFindOriginalAuthor, _fbExtractAuthorFromContainer, ...)


function extractPostTitle(element) {
  if (!element) return "";

  // Walk up to post container
  let postContainer = element;
  for (let i = 0; i < 20; i++) {
    if (
      !postContainer.parentElement ||
      postContainer.parentElement === document.body
    )
      break;
    postContainer = postContainer.parentElement;
    if (postContainer.getAttribute("role") === "article") break;
  }

  // Reddit has explicit title
  const redditTitle = postContainer.querySelector(
    '[data-testid="post-title"], h1, h3[slot="title"]',
  );
  if (redditTitle) return (redditTitle.textContent || "").trim();

  // LinkedIn shared articles
  const liTitle = postContainer.querySelector(
    ".feed-shared-article__title, .update-components-article__title",
  );
  if (liTitle) return (liTitle.textContent || "").trim();

  // og:title for single post pages
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle && ogTitle.content) return ogTitle.content;

  // Fallback: empty — AI will generate title from summary
  return "";
}

// === STREAMING SUMMARIZE ===
async function wakeServiceWorker() {
  for (let i = 0; i < 3; i++) {
    try {
      const resp = await chrome.runtime.sendMessage({ action: "ping" });
      if (resp?.ok) return true;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 300 * (i + 1)));
  }
  // Last resort: connect() can wake a SW that sendMessage can't
  try {
    const probe = chrome.runtime.connect({ name: "ping" });
    probe.disconnect();
    await new Promise(r => setTimeout(r, 200));
    const resp = await chrome.runtime.sendMessage({ action: "ping" });
    if (resp?.ok) return true;
  } catch (_) {}
  return false;
}

// === BATCH OPERATIONS ===
async function startBatchOperation(texts, type = 'summary') {
  if (!texts || texts.length === 0) {
    alert('Không có text nào được chọn');
    return;
  }

  batchOperations.active = true;
  batchOperations.selectedTexts = texts;
  batchOperations.currentIndex = 0;
  batchOperations.results = [];
  batchOperations.type = type;

  showBatchProgress();
  await processBatchNext();
}

async function processBatchNext() {
  if (!batchOperations.active) return;

  const { selectedTexts, currentIndex, type } = batchOperations;

  if (currentIndex >= selectedTexts.length) {
    // Batch complete
    showBatchResults();
    return;
  }

  const text = selectedTexts[currentIndex];
  updateBatchProgress(currentIndex + 1, selectedTexts.length);

  try {
    // Process current text
    const result = await processSingleText(text, type);
    batchOperations.results.push({ text, result, success: true });
  } catch (error) {
    batchOperations.results.push({ text, result: error.message, success: false });
  }

  batchOperations.currentIndex++;

  // Process next after short delay
  setTimeout(() => processBatchNext(), 500);
}

async function processSingleText(text, type) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: "summarize",
        text: text,
        type: type,
        summaryLength: "medium",
        promptStyle: "default"
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.success && response.result) {
          resolve(response.result);
        } else if (response && typeof response.summary === "string" && response.summary.trim()) {
          resolve(response.summary);
        } else {
          reject(new Error(response?.error || "Unknown error"));
        }
      }
    );
  });
}

function showBatchProgress() {
  const html = `
    <div class="fbs-batch-progress">
      <div class="fbs-batch-header">
        <div class="fbs-batch-title">Đang xử lý hàng loạt...</div>
        <button class="fbs-batch-cancel">Hủy</button>
      </div>
      <div class="fbs-batch-bar">
        <div class="fbs-batch-bar-fill" style="width: 0%"></div>
      </div>
      <div class="fbs-batch-status">0 / ${batchOperations.selectedTexts.length}</div>
    </div>
  `;

  openOverlay(html, false, batchOperations.type);

  const cancelBtn = panel.querySelector('.fbs-batch-cancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      batchOperations.active = false;
      closeOverlay();
    });
  }
}

function updateBatchProgress(current, total) {
  const barFill = panel.querySelector('.fbs-batch-bar-fill');
  const status = panel.querySelector('.fbs-batch-status');

  if (barFill) {
    const percent = (current / total) * 100;
    barFill.style.width = percent + '%';
  }

  if (status) {
    status.textContent = `${current} / ${total}`;
  }
}

function showBatchResults() {
  const { results } = batchOperations;
  const successCount = results.filter(r => r.success).length;
  const failCount = results.length - successCount;

  let html = `
    <div class="fbs-batch-results">
      <div class="fbs-batch-summary">
        <div class="fbs-batch-summary-item success">
          <span class="fbs-batch-summary-count">${successCount}</span>
          <span class="fbs-batch-summary-label">Thành công</span>
        </div>
        <div class="fbs-batch-summary-item error">
          <span class="fbs-batch-summary-count">${failCount}</span>
          <span class="fbs-batch-summary-label">Thất bại</span>
        </div>
      </div>
      <div class="fbs-batch-results-list">
  `;

  results.forEach((item, index) => {
    const statusClass = item.success ? 'success' : 'error';
    const statusIcon = item.success ? 'OK' : 'ERR';
    const preview = item.text.substring(0, 50) + (item.text.length > 50 ? '...' : '');

    html += `
      <div class="fbs-batch-result-item ${statusClass}">
        <div class="fbs-batch-result-header">
          <span class="fbs-batch-result-icon">${statusIcon}</span>
          <span class="fbs-batch-result-preview">${esc(preview)}</span>
        </div>
        ${item.success ? `<div class="fbs-batch-result-content">${esc(item.result)}</div>` : `<div class="fbs-batch-result-error">${esc(item.result)}</div>`}
      </div>
    `;
  });

  html += `
      </div>
      <div class="fbs-batch-actions">
        <button class="fbs-batch-copy-all btn btn-primary">Copy tất cả</button>
        <button class="fbs-batch-close btn btn-secondary">Đóng</button>
      </div>
    </div>
  `;

  openOverlay(html, false, batchOperations.type);

  // Add event listeners
  const copyAllBtn = panel.querySelector('.fbs-batch-copy-all');
  if (copyAllBtn) {
    copyAllBtn.addEventListener('click', () => {
      const allResults = results
        .filter(r => r.success)
        .map(r => r.result)
        .join('\n\n---\n\n');

      navigator.clipboard.writeText(allResults).then(() => {
        copyAllBtn.textContent = 'Đã copy!';
        setTimeout(() => {
          copyAllBtn.textContent = 'Copy tất cả';
        }, 2000);
      });
    });
  }

  const closeBtn = panel.querySelector('.fbs-batch-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      closeOverlay();
      batchOperations.active = false;
    });
  }
}

async function summarizeText(text, type = "summary", contextElement = null, tone = null) {
  if (!text || text.length < 50) {
    openOverlay(
      '<div class="fbs-error">Text quá ngắn để tóm tắt.</div>',
      false,
    );
    return;
  }

  if (!isContextValid()) {
    openOverlay(
      '<div class="fbs-error">Extension đã cập nhật. Vui lòng F5.</div>',
      false,
      type,
    );
    return;
  }

  // Smart cache key includes settings that affect output
  let settings;
  try {
    settings = await new Promise((r) =>
      chrome.storage.sync.get([
        "summaryLength",
        "promptStyle",
        "outputLanguage",
        "customInstructions",
        "customSummaryPrompt",
      ], r),
    );
  } catch (_) {
    openOverlay(
      '<div class="fbs-error">Extension đã cập nhật. Vui lòng F5.</div>',
      false,
      type,
    );
    return;
  }
  // Legacy affiliate writing removed — fall back to summary
  if (type && String(type).startsWith("affiliate")) type = "summary";
  const cacheKey =
    hashText(text) +
    "_" +
    type +
    "_" +
    (settings.summaryLength || "medium") +
    "_" +
    (settings.promptStyle || "default") +
    "_" +
    (settings.outputLanguage || "auto") +
    "_" +
    hashText(settings.customInstructions || "") +
    "_" +
    hashText(settings.customSummaryPrompt || "") +
    (tone ? "_" + tone : "");

  if (summaryCache.has(cacheKey)) {
    openOverlay(
      '<div class="fbs-result">' + fmt(summaryCache.get(cacheKey)) + "</div>",
      false,
      type,
    );
    return;
  }

  lastSummarizeParams = { text, type, _element: contextElement, tone };
  isSummarizing = true;
  const title =
    type === "status_share"
      ? "Đang viết Status..."
      : type === "comment_summary"
        ? "Đang tóm tắt bình luận..."
        : "Đang tóm tắt...";

  // Show skeleton loading instead of spinner
  const skeletonHtml = '<div class="fbs-panel-body fbs-loading">' +
    '<div class="fbs-skeleton fbs-skeleton-text"></div>' +
    '<div class="fbs-skeleton fbs-skeleton-text"></div>' +
    '<div class="fbs-skeleton fbs-skeleton-text"></div>' +
    '<div class="fbs-skeleton fbs-skeleton-text"></div>' +
    '<div class="fbs-skeleton fbs-skeleton-text"></div>' +
    '<div style="margin-top:8px;font-size:11px;color:rgba(255,255,255,0.5);">' + title + '</div>' +
    '</div>';

  openOverlay(skeletonHtml, false, type);

  // Wake SW before connecting port (MV3 SW dies after ~30s idle)
  const swAlive = await wakeServiceWorker();
  if (!swAlive || !isContextValid()) {
    openOverlay(
      displayError({
        message: "Service Worker không phản hồi",
        detail: "Background script chưa sẵn sàng. Có thể do Chrome tạm dừng extension.",
        action: "Nhấn F5 để tải lại trang, hoặc tắt/bật extension trong chrome://extensions",
        severity: "warning",
        retryable: true,
      }),
      false,
      type,
    );
    isSummarizing = false;
    return;
  }
  try {
    currentPort = chrome.runtime.connect({ name: "summarize-stream" });
  } catch (e) {
    openOverlay(
      displayError({
        message: "Không kết nối được Service Worker",
        detail: e.message || "No SW",
        action: "Nhấn F5 để tải lại trang",
        severity: "warning",
        retryable: true,
      }),
      false,
      type,
    );
    isSummarizing = false;
    return;
  }
  // Extract post metadata for enriched history (multi-strategy)
  const _el = lastSummarizeParams._element;
  const _meta = _el && typeof extractPostMeta === "function" ? extractPostMeta(_el) : null;
  const _sourceUrl = _meta?.permalink || extractPostPermalink(_el);
  const _imageUrl = extractPostImage(_el);
  const _author = _meta?.author || extractPostAuthor(_el);
  const _title = extractPostTitle(_el);
  const _source = _meta?.source || extractPostSource(_el);
  const _modelSelect = panel && panel.querySelector(".fbs-model-select");
  const _preferredProvider = _modelSelect ? _modelSelect.value : "";
  currentPort.postMessage({
    action: "summarize",
    text,
    site: SITE,
    type,
    tone: tone || null,
    preferredProvider: _preferredProvider || null,
    sourceUrl: _sourceUrl,
    imageUrl: _imageUrl,
    author: _author,
    postTitle: _title,
    postSource: _source,
  });

  let first = true;
  let streamBuffer = "";
  let streamRafId = null;
  const summaryTimeoutId = setTimeout(() => {
    if (!isSummarizing) return;
    isSummarizing = false;
    openOverlay(
      displayError({
        message: "Tóm tắt mất quá nhiều thời gian",
        detail: "Provider AI không hoàn tất phản hồi trong 90 giây.",
        action: "Thử lại hoặc chọn provider khác.",
        severity: "warning",
        retryable: true,
      }),
      false,
      type,
    );
    try {
      currentPort?.disconnect();
    } catch (_) {}
    currentPort = null;
  }, 90000);

  function renderStream() {
    streamRafId = null;

    // Estimate expected length based on generation type and tone
    let expectedLength = 450;
    if (type === "status_share") expectedLength = 500;
    else if (type === "comment_summary") expectedLength = 300;
    else if (tone === "short") expectedLength = 200;
    else if (tone === "bullet") expectedLength = 350;

    const pct = Math.min(Math.floor((streamBuffer.length / expectedLength) * 100), 99);

    const existingResult = panelBody.querySelector(".fbs-result");
    const progressBar = panelBody.querySelector(".fbs-progress-bar");
    const progressLabel = panelBody.querySelector(".fbs-progress-label-text");

    if (progressBar) progressBar.style.width = pct + "%";
    if (progressLabel) progressLabel.textContent = `Đang tạo... ${pct}%`;

    const htmlToInsert = fmt(streamBuffer);
    if (existingResult) {
      existingResult.innerHTML = htmlToInsert;
    } else {
      openOverlay(
        '<div class="fbs-progress-container">' +
          '<div class="fbs-progress-text"><span class="fbs-progress-label-text">Đang tạo... ' + pct + '%</span></div>' +
          '<div class="fbs-progress-bar-bg"><div class="fbs-progress-bar" style="width:' + pct + '%"></div></div>' +
        '</div>' +
        '<div class="fbs-result">' + htmlToInsert + "</div>",
        true,
      );
    }
    if (panelBody.scrollHeight - panelBody.scrollTop < 500)
      panelBody.scrollTop = panelBody.scrollHeight;
  }

  currentPort.onMessage.addListener((msg) => {
    if (msg.action === "chunk") {
      if (first) {
        first = false;
        openOverlay(
          '<div class="fbs-progress-container">' +
            '<div class="fbs-progress-text"><span class="fbs-progress-label-text">Đang tạo... 0%</span></div>' +
            '<div class="fbs-progress-bar-bg"><div class="fbs-progress-bar" style="width:0%"></div></div>' +
          '</div>' +
          '<div class="fbs-result"></div>',
          true,
        );
      }
      streamBuffer = msg.full;
      // Throttle DOM updates to 1 per animation frame
      if (!streamRafId) {
        streamRafId = requestAnimationFrame(renderStream);
      }
    } else if (msg.action === "status") {
      const statusEl = panelBody.querySelector(".fbs-loading div:last-child");
      if (statusEl) statusEl.textContent = msg.message;
    } else if (msg.action === "done") {
      clearTimeout(summaryTimeoutId);
      if (streamRafId) {
        cancelAnimationFrame(streamRafId);
        streamRafId = null;
      }
      isSummarizing = false;
      summaryCache.set(cacheKey, msg.full);
      const discoveryElement = lastSummarizeParams?._element;
      if (discoveryElement && typeof window.fbsDiscoverRelatedSourceLinks === "function") {
        pendingSourceDiscovery = {
          element: discoveryElement,
          promise: window.fbsDiscoverRelatedSourceLinks(discoveryElement, msg.full).catch(() => ({
            sourceUrl: "",
            relatedLinks: [],
          })),
        };
      }
      // Show quality warnings from post-processing guardrails
      let qualityHtml = "";
      if (msg.issues && msg.issues.length > 0) {
        const issueClass =
          msg.quality === "warn" ? "fbs-quality-warn" : "fbs-quality-info";
        qualityHtml =
          '<div class="' +
          issueClass +
          '">' +
          msg.issues.map((i) => esc(i)).join("<br>") +
          "</div>";
      }

      // Render final results but keep progress bar showing 100% temporarily
      openOverlay(
        '<div class="fbs-progress-container">' +
          '<div class="fbs-progress-text"><span class="fbs-progress-label-text">Hoàn thành! 100%</span></div>' +
          '<div class="fbs-progress-bar-bg"><div class="fbs-progress-bar" style="width:100%; background:var(--success, #00b894)"></div></div>' +
        '</div>' +
        '<div class="fbs-result">' + fmt(msg.full) + "</div>" + qualityHtml,
        false,
        type,
      );

      // Smoothly fade out and remove the progress container
      setTimeout(() => {
        const progressContainer = panelBody ? panelBody.querySelector(".fbs-progress-container") : null;
        if (progressContainer) {
          progressContainer.style.transition = "opacity 0.4s ease";
          progressContainer.style.opacity = "0";
          setTimeout(() => progressContainer.remove(), 400);
        }
      }, 650);

      try {
        currentPort.disconnect();
      } catch (_) {}
      currentPort = null;
    } else if (msg.action === "error") {
      clearTimeout(summaryTimeoutId);
      isSummarizing = false;

      // Use structured error display
      const errorHtml = displayError(msg.errorData || msg.error || 'Lỗi không xác định');
      openOverlay(errorHtml, false);

      try {
        currentPort.disconnect();
      } catch (_) {}
      currentPort = null;
    }
  });

  currentPort.onDisconnect.addListener(() => {
    clearTimeout(summaryTimeoutId);
    if (isSummarizing) {
      isSummarizing = false;
      if (panelBody && !panelBody.innerHTML.includes("fbs-result")) {
        const errorHtml = displayError('Kết nối bị ngắt.');
        openOverlay(errorHtml, false, type);
      } else if (panelBody) {
        openOverlay(panelBody.innerHTML, false, type);
      }
    }
  });
}

// === MESSAGES (CONTEXT MENU, SHORTCUTS & UNSHORTEN) ===
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "clear-cache") {
    summaryCache.clear();
    logger.info("Cache cleared via test mode");
    return;
  }
  if (msg.action === "summarize-selection" && msg.text) {
    summarizeText(msg.text, msg.type);
  }
  if (msg.action === "shortcut-summarize-shortcut") {
    const text = window.getSelection().toString();
    if (text) summarizeText(text, "summary");
    else
      openOverlay(
        '<div class="fbs-error">Vui lòng bôi đen đoạn văn bản trước khi bấm Hotkey!</div>',
        false,
      );
  }
  if (msg.action === "shortcut-translate-shortcut") {
    const text = window.getSelection().toString().trim();
    if (text) {
      window.postMessage(
        { source: "feedwriter", type: "translate", text, mode: "auto" },
        "*"
      );
    } else {
      openOverlay(
        '<div class="fbs-error">Bôi đen văn bản tiếng Anh trước khi dịch (Ctrl+Shift+T).</div>',
        false,
      );
    }
  }
  if (msg.action === "translate-selection" && msg.text) {
    window.postMessage(
      {
        source: "feedwriter",
        type: "translate",
        text: msg.text,
        mode: msg.mode || "auto",
      },
      "*"
    );
  }
  if (msg.action === "unshorten-result") {
    if (msg.error) {
      finishUnshorten("Bóc link lỗi", true);
      openOverlay(
        '<div class="fbs-error">' + esc(msg.error) + "</div>",
        false,
      );
    } else if (msg.text) {
      navigator.clipboard
        .writeText(msg.text)
        .then(() => finishUnshorten("Đã copy link", false))
        .catch(() => {
          finishUnshorten("Lỗi clipboard", true);
          openOverlay(
            '<div class="fbs-error">Lỗi ghi clipboard. Link gốc là:<br><code>' +
              esc(msg.text) +
              "</code></div>",
            false,
          );
        });
    }
  }
});

// === INJECT BUTTON ===
function inject(target, seeMoreClickable, textContainer, seeMoreOriginal) {
  if (injected.has(target)) {
    // Keep if a healthy (non-stretched) button already exists
    const existing = target.querySelector(".fbs-wrap[data-fbs-ui='v3'] .fbs-btn, .fbs-btn-inline[data-fbs-ui='v3']");
    if (existing) return;
    // Drop broken/legacy buttons so we can re-inject
    target.querySelectorAll(".fbs-wrap, .fbs-btn:not(.fbs-copy-btn):not(.fbs-post-status-btn), .fbs-btn-inline").forEach((el) => {
      try { el.remove(); } catch (_) {}
    });
    injected.delete(target);
  }
  injected.add(target);

  // Prefer INLINE chip after "Xem thêm" — never stretch absolute on media blocks.
  const canInline = !!(seeMoreOriginal && seeMoreOriginal.parentElement);

  let inserted = false;

  if (canInline) {
    const wrap = document.createElement("span");
    wrap.setAttribute("data-fbs-ui", "v3");
    wrap.className = "fbs-wrap fbs-wrap-inline";
    const btnNode = createInlineBtn();
    if (btnNode.setAttribute) btnNode.setAttribute("data-fbs-ui", "v3");
    wrap.appendChild(btnNode);
    try {
      seeMoreOriginal.parentElement.insertBefore(wrap, seeMoreOriginal.nextSibling);
      inserted = true;
    } catch (e) {}
    if (!inserted && seeMoreClickable && seeMoreClickable.parentElement) {
      try {
        seeMoreClickable.parentElement.insertBefore(wrap, seeMoreClickable.nextSibling);
        inserted = true;
      } catch (e) {}
    }
    if (!inserted && textContainer) {
      try {
        textContainer.appendChild(wrap);
        inserted = true;
      } catch (e) {}
    }
    if (inserted) {
      const btnEl = wrap.querySelector(".fbs-btn-inline") || wrap;
      btnEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          btnEl.click();
        }
      });
      // Wire click on wrap path below via shared handler
      wrap._fbsIsInlineInject = true;
    }
  }

  // No fallback chip: posts without Facebook's "Xem thêm" anchor do not get
  // a second corner button. The inline chip above is the only feed action.
  if (!inserted) return;

  // Inline chip click handler
  const inlineWrap =
    (seeMoreOriginal &&
      seeMoreOriginal.parentElement &&
      seeMoreOriginal.parentElement.querySelector(".fbs-wrap-inline[data-fbs-ui='v3']")) ||
    (textContainer && textContainer.querySelector(".fbs-wrap-inline[data-fbs-ui='v3']")) ||
    (target && target.querySelector && target.querySelector(".fbs-wrap-inline[data-fbs-ui='v3']"));
  const btnEl =
    (inlineWrap && (inlineWrap.querySelector(".fbs-btn-inline") || inlineWrap)) || null;
  if (!btnEl) return;

  btnEl.addEventListener("click", async (e) => {
    e.stopPropagation();
    const type = "summary";
    openOverlay(
      '<div class="fbs-loading"><div class="fbs-spinner"></div><span>Đang tóm tắt...</span></div>',
      false,
      type,
    );

    // Expand to get full text
    if (seeMoreClickable) {
      try {
        seeMoreClickable.click();
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 1200));
    }

    const sourceElement = textContainer || target;
    const text = cleanText(
      (typeof window.fbsExtractPostContent === "function" &&
        window.fbsExtractPostContent(sourceElement)) ||
        extractMainContent(sourceElement) ||
        sourceElement.innerText ||
        "",
    );

    // Collapse back
    const collapseBtn = findCollapseBtn(textContainer || target);
    if (collapseBtn) {
      try {
        collapseBtn.click();
      } catch (_) {}
    } else if (seeMoreClickable) {
      try {
        seeMoreClickable.click();
      } catch (_) {}
    }

    await summarizeText(text, type, textContainer || target);
  });
}

const COLLAPSE_KEYWORDS = ["ẩn bớt", "hide", "show less", "voir moins", "weniger anzeigen", "접기"];

function findCollapseBtn(container) {
  if (!container) return null;
  const els = container.querySelectorAll(
    'div[role="button"], span[role="button"], span[dir="auto"], div[dir="auto"]',
  );
  for (const el of els) {
    const t = (el.innerText || el.textContent || "").trim().toLowerCase();
    if (t.length > 20 || t.length < 3) continue;
    if (COLLAPSE_KEYWORDS.some((kw) => t === kw || t.startsWith(kw))) return el;
  }
  return null;
}

function processSeeMore(sm) {
  const textContainer = findTextContainer(sm);
  if (!textContainer) return;
  if ((textContainer.innerText || "").trim().length < MIN_LEN / 2) return;
  const target = findInjectTarget(textContainer);
  if (
    injected.has(target) &&
    !target.querySelector(".fbs-wrap, .fbs-btn, .fbs-btn-inline")
  ) {
    injected.delete(target);
  }
  if (
    injected.has(target) ||
    target.querySelector(".fbs-wrap") ||
    target.querySelector(".fbs-btn-inline")
  )
    return;
  inject(target, findClickable(sm), textContainer, sm);
}

// === FLOATING TOOLBAR ===
let floatingToolbar = null;
function createFloatingToolbar() {
  if (floatingToolbar) return;
  floatingToolbar = document.createElement("div");
  floatingToolbar.className = "fbs-floating-toolbar";
  floatingToolbar.setAttribute("role", "toolbar");
  floatingToolbar.setAttribute("aria-label", "FeedWriter — công cụ cho vùng chọn");
  floatingToolbar.innerHTML =
    '<button class="fbs-floating-btn fbs-btn-highlight" data-action="summary" title="Tóm tắt"><img src="' +
    ICON_BASE64 +
    '" width="13" height="13" alt=""> Tóm tắt</button>' +
    '<button class="fbs-floating-btn" data-action="translate" data-mode="auto" title="Dịch EN→VI">Dịch</button>' +
    '<button class="fbs-floating-btn" data-action="translate" data-mode="slang" title="Slang / thành ngữ">Slang</button>' +
    '<button class="fbs-floating-btn" data-action="translate" data-mode="collocation" title="Collocations">Cụm từ</button>' +
    '<button class="fbs-floating-btn" data-action="translate" data-mode="shadowing" title="Shadowing luyện nói">Shadow</button>' +
    (SITE === "facebook"
      ? '<button class="fbs-floating-btn" data-action="batch" title="Chọn nhiều bài (Alt+B)">Batch</button>'
      : "");
  document.body.appendChild(floatingToolbar);

  floatingToolbar.addEventListener("mousedown", (e) => e.preventDefault());
  floatingToolbar.addEventListener("click", (e) => {
    e.preventDefault();
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-action");
    if (action === "batch") {
      floatingToolbar.classList.remove("fbs-visible");
      if (batchMode) exitBatchMode();
      else enterBatchMode();
      return;
    }
    const sel = window.getSelection();
    const text = sel.toString().trim();
    if (!text) return;
    floatingToolbar.classList.remove("fbs-visible");

    if (action === "translate") {
      const mode = btn.getAttribute("data-mode") || "auto";
      // Bridge to translate.js (separate content-script world) via window message
      window.postMessage(
        { source: "feedwriter", type: "translate", text, mode },
        "*"
      );
      // Also try runtime message for pages where translate listens
      try {
        chrome.runtime.sendMessage({
          action: "relay-translate",
          text,
          mode,
        });
      } catch (_) {}
      return;
    }

    const anchor =
      sel.rangeCount > 0 ? sel.getRangeAt(0).startContainer.parentElement : null;
    summarizeText(text, action === "summary" ? "summary" : action, anchor);
  });

  const hideToolbar = () => {
    if (floatingToolbar && floatingToolbar.classList.contains("fbs-visible"))
      floatingToolbar.classList.remove("fbs-visible");
  };
  document.addEventListener("scroll", hideToolbar, { capture: true, passive: true });
  listeners.push({ element: document, event: "scroll", handler: hideToolbar, options: { capture: true, passive: true } });
  // A resize invalidates the stored coordinates → dismiss rather than mispoint.
  window.addEventListener("resize", hideToolbar, { passive: true });
  listeners.push({ element: window, event: "resize", handler: hideToolbar, options: { passive: true } });
}

function handleSelection() {
  createFloatingToolbar();
  setTimeout(() => {
    const selection = window.getSelection();
    const text = selection.toString().trim();
    if (selection.rangeCount === 0) {
      floatingToolbar.classList.remove("fbs-visible");
      return;
    }
    // Translate: short EN phrases OK. Summary still needs MIN_LEN.
    const canTranslate =
      text.length >= 2 && text.length <= 2000 && /[A-Za-z]/.test(text);
    const canSummary = text.length >= MIN_LEN;
    if (!canTranslate && !canSummary) {
      floatingToolbar.classList.remove("fbs-visible");
      return;
    }
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      floatingToolbar.classList.remove("fbs-visible");
      return;
    }

    floatingToolbar.querySelectorAll("[data-action]").forEach((btn) => {
      const action = btn.getAttribute("data-action");
      if (action === "summary" || action === "batch") {
        btn.disabled = !canSummary;
        btn.style.opacity = canSummary ? "1" : "0.35";
        btn.style.pointerEvents = canSummary ? "" : "none";
      } else if (action === "translate") {
        btn.disabled = !canTranslate;
        btn.style.opacity = canTranslate ? "1" : "0.35";
        btn.style.pointerEvents = canTranslate ? "" : "none";
      }
    });

    floatingToolbar.classList.add("fbs-visible");
    const tbW = floatingToolbar.offsetWidth || 300;
    const tbH = floatingToolbar.offsetHeight || 40;
    const M = 8;
    let left = rect.left + rect.width / 2 - tbW / 2;
    left = Math.max(M, Math.min(left, window.innerWidth - tbW - M));
    let below = false;
    let top = rect.top - tbH - 8;
    if (top < M) {
      top = rect.bottom + 8;
      below = true;
    }
    floatingToolbar.classList.toggle("fbs-below", below);
    floatingToolbar.style.top = top + window.scrollY + "px";
    floatingToolbar.style.left = left + window.scrollX + "px";
  }, 0);
}

const mouseupHandler = (e) => {
  if (floatingToolbar && floatingToolbar.contains(e.target)) return;
  handleSelection();
};
document.addEventListener("mouseup", mouseupHandler);
listeners.push({ element: document, event: "mouseup", handler: mouseupHandler });

const mousedownHandler = (e) => {
  if (floatingToolbar && !floatingToolbar.contains(e.target)) {
    floatingToolbar.classList.remove("fbs-visible");
  }
};
document.addEventListener("mousedown", mousedownHandler);
listeners.push({ element: document, event: "mousedown", handler: mousedownHandler });

// === VISIBLE POSTS TRACKER (IntersectionObserver) ===
const visiblePosts = new Set();
let postObserver = null;
if (typeof IntersectionObserver !== "undefined") {
  postObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        visiblePosts.add(entry.target);
      } else {
        visiblePosts.delete(entry.target);
      }
    }
  }, { rootMargin: "800px 0px" });
}

// === FB ALL POSTS (Feature 6) — one fixed chip per top-level feed post ===

/** True if node looks like a feed post unit (not a nested comment / media shell). */
function _isFeedPostCandidate(el) {
  if (!el || el.nodeType !== 1) return false;
  const pagelet = el.getAttribute("data-pagelet") || "";
  if (pagelet.startsWith("FeedUnit")) return true;
  if (el.getAttribute("role") === "article") return true;
  if (el.hasAttribute("data-virtualized")) return true;
  return false;
}

/**
 * Collect unique TOP-LEVEL posts only.
 * Avoids injecting into every nested article / photo / comment shell
 * (which caused giant stretched buttons on images).
 */
function _getTopLevelFeedPosts(root) {
  const raw = [
    ...root.querySelectorAll('div[data-pagelet^="FeedUnit"]'),
    ...root.querySelectorAll('div[role="feed"] > div'),
    ...root.querySelectorAll('div[role="main"] [data-virtualized]'),
    ...root.querySelectorAll('div[role="main"] article[role="article"]'),
  ];
  const seen = new Set();
  const tops = [];
  for (const el of raw) {
    if (!el || seen.has(el)) continue;
    // Skip if contained in another candidate (keep outermost)
    let nested = false;
    for (const other of raw) {
      if (other !== el && other.contains(el)) {
        nested = true;
        break;
      }
    }
    if (nested) continue;
    // Skip tiny / non-post shells (image-only tiles often < 120px tall without text)
    const text = (el.innerText || "").replace(/\s+/g, " ").trim();
    if (text.length < MIN_LEN) continue;
    // Skip comment-only blocks: many short lines of names without body
    if (el.querySelector('form[role="presentation"], div[aria-label*="Viết bình luận"], div[aria-label*="Write a comment"]')
        && text.length < MIN_LEN * 1.5
        && !el.querySelector('div[dir="auto"]')) {
      continue;
    }
    seen.add(el);
    tops.push(el);
  }
  return tops;
}

/** Remove any FeedWriter chips that Facebook layout has stretched. */
function _purgeBrokenChips(scope) {
  const root = scope || document;
  root.querySelectorAll(".fbs-allpost-btn, .fbs-chip-host, .fbs-wrap:not(.fbs-wrap-inline)").forEach((el) => {
    try {
      const h = el.offsetHeight || 0;
      const w = el.offsetWidth || 0;
      // Normal chip ~28–40px tall, ~70–140px wide. Anything huge = layout hijack.
      if (h > 48 || w > 220 || h > w * 1.8) {
        el.remove();
      }
    } catch (_) {}
  });
}

/**
 * Mount a FIXED-SIZE chip host in the top-right of a post.
 * Host is isolated so FB flex/grid cannot stretch the button with the image.
 */
function _mountPostChip(article) {
  // Already has a healthy host?
  const existingHost = article.querySelector(":scope > .fbs-chip-host[data-fbs-ui='v3']");
  if (existingHost) {
    const btn = existingHost.querySelector(".fbs-allpost-btn");
    if (btn && (btn.offsetHeight || 0) <= 48 && (existingHost.offsetHeight || 0) <= 48) return;
    try { existingHost.remove(); } catch (_) {}
  }
  // Drop any loose buttons from older builds
  article.querySelectorAll(".fbs-allpost-btn, .fbs-chip-host, .fbs-wrap:not(.fbs-wrap-inline)").forEach((el) => {
    try { el.remove(); } catch (_) {}
  });

  const pos = getComputedStyle(article).position;
  if (pos === "static" || pos === "") {
    // Isolate without fighting FB layout too hard
    article.style.position = "relative";
  }

  const host = document.createElement("div");
  host.className = "fbs-chip-host";
  host.setAttribute("data-fbs-ui", "v3");

  // Header height varies per post type (Group posts, "Suggested for you"
  // rows add extra lines), so a fixed offset can cover the X / ⋯ controls.
  // Measure the header action cluster and sit right below it. Substring
  // aria-label matching only — FB labels are "Ẩn bài viết"/"Hide post",
  // never bare "Ẩn"/"Hide". Re-measured on hover because FB re-renders
  // headers (banners, translate rows) after mount, and the X often only
  // appears on hover; the button itself is invisible until hover anyway.
  const positionChip = () => {
    let chipTop = 56;
    try {
      const artRect = article.getBoundingClientRect();
      const ctrls = article.querySelectorAll(
        'div[aria-haspopup="menu"][role="button"], ' +
        '[aria-label*="Actions for this post"], [aria-label*="Hành động"], ' +
        '[aria-label*="Hide post"], [aria-label*="Ẩn bài viết"], ' +
        '[aria-label*="Remove"], [aria-label*="Xóa"], [aria-label*="Tùy chọn"]'
      );
      let maxBottom = 0;
      for (const c of ctrls) {
        const r = c.getBoundingClientRect();
        const relTop = r.top - artRect.top;
        // Only header-zone controls count (comment/share menus sit far lower)
        if (r.height > 0 && relTop >= 0 && relTop < 140) {
          maxBottom = Math.max(maxBottom, r.bottom - artRect.top);
        }
      }
      if (maxBottom > 0) chipTop = Math.round(maxBottom + 6);
    } catch (_) {}
    // Reserve the Facebook header action lane (⋯ / X) on the far right.
    // Keeping a fixed horizontal gutter is safer than trying to infer the
    // controls' width: Facebook often renders them only on hover and may
    // omit aria-labels in localized/virtualized variants.
    const safeRight = 104;
    host.style.setProperty("top", chipTop + "px", "important");
    host.style.setProperty("right", safeRight + "px", "important");
    host.style.setProperty("inset", chipTop + "px " + safeRight + "px auto auto", "important");
  };
  positionChip();
  article.addEventListener("mouseenter", positionChip);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "fbs-allpost-btn";
  btn.setAttribute("data-fbs-action", "summarize");
  btn.setAttribute("data-fbs-ui", "v3");
  btn.title = "Tóm tắt bài này";
  btn.innerHTML =
    '<img class="fbs-btn-icon" src="' + ICON_BASE64 + '" width="12" height="12" alt="" aria-hidden="true">' +
    '<span class="fbs-btn-label">Tóm tắt</span>';

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    const t = (
      (typeof window.fbsExtractPostContent === "function" &&
        window.fbsExtractPostContent(article)) ||
      article.innerText ||
      ""
    ).trim();
    if (t.length >= MIN_LEN) summarizeText(t, "summary", article);
  });

  host.appendChild(btn);
  article.appendChild(host);
}

function scanFBAllPosts() {
  if (SITE !== "facebook") return;
  const root =
    document.querySelector('div[role="main"]') ||
    document.querySelector('div[id^="mount_0_0"]') ||
    document.body;

  _purgeBrokenChips(root);

  const posts = _getTopLevelFeedPosts(root);
  for (const article of posts) {
    if (postObserver && !article.dataset.fbsObserved) {
      article.dataset.fbsObserved = "1";
      postObserver.observe(article);
    }

    // Remove any fallback chip left by an older content-script instance
    // before deciding whether this post has an inline "Xem thêm" chip.
    article.querySelectorAll(":scope > .fbs-chip-host[data-fbs-ui='v3'], :scope > .fbs-allpost-btn").forEach((el) => {
      try { el.remove(); } catch (_) {}
    });

    if (isSponsored(article)) {
      fbAllPostInjected.add(article);
      continue;
    }

    // Skip if inline "Xem thêm" chip already present
    if (article.querySelector(".fbs-wrap-inline, .fbs-btn-inline[data-fbs-ui='v3']")) {
      fbAllPostInjected.add(article);
      continue;
    }

    // Remove legacy/fallback corner chips. Only the inline button after
    // Facebook's "Xem thêm" is supported now.
    fbAllPostInjected.add(article);
  }
}

// === COMMENT THREAD SUMMARY (Feature 11) ===
const commentBtnInjected = new WeakSet();
function scanCommentSections() {
  if (SITE !== "facebook") return;
  const root = document.querySelector('div[role="main"]') || document.querySelector('div[id^="mount_0_0"]') || document.body;
  // Include both old (role="article") and new (data-virtualized) top-level post containers
  const articles = [
    ...root.querySelectorAll('article[role="article"]'),
    ...root.querySelectorAll('[data-virtualized]'),
  ];
  for (const article of articles) {
    // Only top-level post containers — not nested in another post
    let depth = 0;
    let ancestor = article.parentElement;
    for (let j = 0; j < 20; j++) {
      if (!ancestor || ancestor === document.body) break;
      if (ancestor.getAttribute("role") === "article" || ancestor.hasAttribute("data-virtualized")) depth++;
      ancestor = ancestor.parentElement;
    }
    if (depth >= 1) continue; // nested = not a top-level post
    if (commentBtnInjected.has(article)) {
      if (article.querySelector(".fbs-comment-summary-btn")) continue;
      commentBtnInjected.delete(article);
    }
    // Check for comment articles inside this post
    const commentArticles = article.querySelectorAll('article[role="article"]');
    if (commentArticles.length < 2) continue; // need at least 2 visible comments
    // Collect comment text
    const commentTexts = [];
    for (const ca of commentArticles) {
      const t = (ca.innerText || "").trim();
      if (t.length > 10) commentTexts.push(t);
    }
    if (commentTexts.length < 2) continue;
    commentBtnInjected.add(article);
    const btn = document.createElement("button");
    btn.className = "fbs-comment-summary-btn";
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg> Tóm tắt ' + commentTexts.length + ' bình luận';
    btn.title = "Tóm tắt toàn bộ thread bình luận";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const currentComments = Array.from(article.querySelectorAll('article[role="article"]'))
        .map(ca => (ca.innerText || "").trim()).filter(t => t.length > 10);
      if (currentComments.length === 0) return;
      const combined = "THREAD BÌNH LUẬN (" + currentComments.length + " comments):\n\n" +
        currentComments.map((t, i) => (i + 1) + ". " + t).join("\n\n");
      summarizeText(combined, "comment_summary", article);
    });
    // Insert before the first comment article
    const firstComment = commentArticles[0];
    firstComment.parentElement?.insertBefore(btn, firstComment);
  }
}

// === BATCH QUEUE (Feature 12) ===
let batchMode = false;
let batchQueue = []; // [{text, el}]
let batchBar = null;
const batchCheckboxes = new WeakMap(); // article → checkbox el

function createBatchBar() {
  if (batchBar) return;
  batchBar = document.createElement("div");
  batchBar.className = "fbs-batch-bar";
  batchBar.innerHTML =
    '<span class="fbs-batch-count">0 bài đã chọn</span>' +
    '<button class="fbs-batch-run-btn">Tóm tắt tất cả</button>' +
    '<button class="fbs-batch-cancel-btn" title="Thoát Batch Mode" aria-label="Thoát Batch Mode">×</button>';
  document.body.appendChild(batchBar);
  batchBar.querySelector(".fbs-batch-run-btn").addEventListener("click", runBatch);
  batchBar.querySelector(".fbs-batch-cancel-btn").addEventListener("click", exitBatchMode);
}

function updateBatchBar() {
  if (!batchBar) return;
  batchBar.querySelector(".fbs-batch-count").textContent = batchQueue.length + " bài đã chọn";
}

function enterBatchMode() {
  batchMode = true;
  batchQueue = [];
  createBatchBar();
  batchBar.classList.add("fbs-batch-visible");
  document.body.classList.add("fbs-batch-mode");
  // Add checkboxes to all visible post articles
  const root = document.querySelector('div[role="main"]') || document.body;
  _getTopLevelFeedPosts(root).forEach(article => {
    if (batchCheckboxes.has(article)) return;
    const pos = getComputedStyle(article).position;
    if (pos === "static" || pos === "") article.style.position = "relative";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "fbs-batch-checkbox";
    cb.addEventListener("change", () => {
      if (cb.checked) {
        cb.classList.add("fbs-checked");
        const text = (
          (typeof window.fbsExtractPostContent === "function" &&
            window.fbsExtractPostContent(article)) ||
          article.innerText ||
          ""
        ).trim();
        if (text.length >= MIN_LEN) batchQueue.push({ text, el: article, cb });
      } else {
        cb.classList.remove("fbs-checked");
        batchQueue = batchQueue.filter(item => item.cb !== cb);
      }
      updateBatchBar();
    });
    article.appendChild(cb);
    batchCheckboxes.set(article, cb);
  });
  updateBatchBar();
}

function exitBatchMode() {
  batchMode = false;
  batchQueue = [];
  document.body.classList.remove("fbs-batch-mode");
  if (batchBar) {
    batchBar.classList.remove("fbs-batch-visible");
  }
  // Remove all checkboxes
  document.querySelectorAll(".fbs-batch-checkbox").forEach(cb => cb.remove());
}

async function runBatch() {
  if (batchQueue.length === 0) return;
  const items = [...batchQueue];
  exitBatchMode();
  for (let i = 0; i < items.length; i++) {
    const { text, el } = items[i];
    await summarizeText(text, "summary", el);
    // Small delay between items so UI is responsive
    await new Promise(r => setTimeout(r, 800));
  }
}

// Alt+B toggles batch mode
document.addEventListener("keydown", (e) => {
  if (e.altKey && e.key === "b") {
    e.preventDefault();
    if (batchMode) exitBatchMode(); else enterBatchMode();
  }
});

// === HIDE SPONSORED POSTS ===
// Inject one-time CSS for structural clutter (Stories, Reels, Right Rail, etc.)


// ── All bad labels ───────────────────────────────────────────────────────
const ALL_CLUTTER_LABELS = [
  ...SPONSORED_KEYWORDS,
  ...CLUTTER_LABELS,
];

function _matchesClutterLabel(t) {
  return ALL_CLUTTER_LABELS.some(kw =>
    t === kw ||
    t.startsWith(kw + " ") ||
    t.startsWith(kw + "·") ||
    t.startsWith(kw + " ·")
  );
}

// Pre-computed whitespace-stripped versions for obfuscated text matching
// Facebook splits "Được tài trợ" into per-character spans — stripping spaces
// from both sides lets textContent "Đượctàitrợ" match keyword "được tài trợ"
const ALL_CLUTTER_LABELS_NORM = ALL_CLUTTER_LABELS.map(kw =>
  kw.replace(/\s+/g, "").toLowerCase()
);



// ── Toast ────────────────────────────────────────────────────────────────
let clutterToast = null;
let clutterToastTimer = null;

function showClutterToast(_count) {
  // Silent — no toast (user preference)
}

function _hideWrapper(wrapper) {
  // Instant hide — ads must disappear before user scrolls past (no 240ms anim)
  let toHide = wrapper;
  const par = wrapper.parentElement;
  if (
    par &&
    par !== document.body &&
    par.getAttribute("role") !== "feed" &&
    par.getAttribute("role") !== "main" &&
    par.children.length === 1 &&
    (typeof _isFbLayoutColumn !== "function" || !_isFbLayoutColumn(par))
  ) {
    toHide = par;
  }
  toHide.style.setProperty("display", "none", "important");
  toHide.setAttribute("data-fbs-hidden", "1");
}



// === REDDIT ===
function scanRedditPosts() {
  const posts = document.querySelectorAll(
    'shreddit-post, div[data-testid="post-container"]',
  );
  for (const post of posts) {
    if (post.dataset.fbsScanned) continue;
    post.dataset.fbsScanned = "1";
    const textEl = post.querySelector(
      '[data-testid="post-content"], .md, [slot="text-body"]',
    );
    if (!textEl) continue;
    if ((textEl.innerText || "").trim().length < MIN_LEN) continue;
    inject(post, null, textEl);
  }
}

// === MAIN SCAN ===
// "Bóc Link" runs a network fetch in the background (up to 30s) and the result
// comes back asynchronously via the "unshorten-result" message. We track a
// single in-flight request + its triggering pill so we can show a loading
// state, surface success/failure on the button itself, and stop repeat clicks
// from spawning duplicate fetches (and duplicate affiliate tabs).
let unshortenInFlight = false;
let activeUnshortenPill = null;
let activeUnshortenOriginalHTML = "";
let unshortenTimeout = null;

const UNSHORTEN_PILL_STYLE =
  "cursor:pointer;display:inline-flex;align-items:center;gap:4px;padding:0px 6px 1px;border-radius:6px;background:rgba(255,107,107,0.15);color:#ff6b6b;font-size:0.85em;font-weight:bold;margin-left:4px;";

// Restore the active pill to its idle state after a brief result message.
function finishUnshorten(message, isError) {
  clearTimeout(unshortenTimeout);
  unshortenInFlight = false;
  const pill = activeUnshortenPill;
  activeUnshortenPill = null;
  if (!pill) return;
  pill.style.pointerEvents = "";
  pill.style.color = isError ? "#ff6b6b" : "#2ed573";
  pill.textContent = message;
  const original = activeUnshortenOriginalHTML;
  setTimeout(() => {
    pill.innerHTML = original;
    pill.style.opacity = "";
    pill.style.color = "";
  }, 2500);
}

function scanShopeeLinks() {
  const links = document.querySelectorAll('a[href*="shope.ee/"]');
  for (const a of links) {
    if (a.dataset.fbsUnshorten) continue;
    a.dataset.fbsUnshorten = "1";
    const btn = document.createElement("span");
    btn.innerHTML =
      ' <span class="fbs-unshorten-pill" title="Bóc Link Không Cookie" style="' +
      UNSHORTEN_PILL_STYLE +
      '"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>Bóc Link</span>';
    const pill = btn.querySelector("span");
    const originalHTML = pill.innerHTML;
    pill.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Single in-flight: ignore clicks (this or other pills) while one runs.
      if (unshortenInFlight) return;
      unshortenInFlight = true;
      activeUnshortenPill = pill;
      activeUnshortenOriginalHTML = originalHTML;
      pill.style.opacity = "0.65";
      pill.style.pointerEvents = "none";
      pill.style.color = "";
      pill.textContent = "Đang bóc link…";
      clearTimeout(unshortenTimeout);
      unshortenTimeout = setTimeout(() => {
        finishUnshorten("Quá hạn — thử lại", true);
      }, 35000);
      chrome.runtime
        .sendMessage({ action: "unshorten-shopee-inline", url: a.href })
        .catch(() => finishUnshorten("Lỗi gửi yêu cầu", true));
    });
    a.insertAdjacentElement("afterend", btn);
  }
}

function scan() {
  if (!isContextValid() || isBlocked) return;
  if (document.hidden) return;
  if (SITE === "reddit") scanRedditPosts();
  // Sponsored first (fast) then rest
  scanSponsoredFast();
  try {
    _purgeBrokenChips(document);
  } catch (_) {}
  findNewSeeMoreElements().forEach(processSeeMore);
  scanFBAllPosts();
  if (!scan._skipComments) scanCommentSections();
  scanShopeeLinks();
  scanAffiliatePosts();
}

let scanDebounceTimer = null;
let scanScheduled = false;
let sponsoredDebounceTimer = null;
let sponsoredScheduled = false;
const SCAN_DEBOUNCE_MS = 400;
const SPONSORED_DEBOUNCE_MS = 32; // ~1 frame — hide ads ASAP
let _scanSafetyCount = 0;

function scheduleScan() {
  if (scanScheduled || document.hidden) return;
  scanScheduled = true;
  clearTimeout(scanDebounceTimer);
  scanDebounceTimer = setTimeout(() => {
    scanScheduled = false;
    scan();
  }, SCAN_DEBOUNCE_MS);
}

function scheduleSponsoredFast() {
  if (document.hidden || SITE !== "facebook") return;
  if (sponsoredScheduled) return;
  sponsoredScheduled = true;
  clearTimeout(sponsoredDebounceTimer);
  sponsoredDebounceTimer = setTimeout(() => {
    sponsoredScheduled = false;
    try {
      scanSponsoredFast();
    } catch (_) {}
  }, SPONSORED_DEBOUNCE_MS);
}

// Immediate first pass
scanSponsoredFast();
scan();
scheduleScan();

// Catch ads that load portals slightly after the post (~0.3–1s)
let sponsoredCatchup = 0;
let sponsoredCatchupTimer = SITE === "facebook" ? setInterval(() => {
  if (document.hidden) return;
  scanSponsoredFast();
  if (++sponsoredCatchup > 40) {
    clearInterval(sponsoredCatchupTimer);
    sponsoredCatchupTimer = null;
  }
}, 500) : null;

// Safety full scan
scanTimer = setInterval(() => {
  if (document.hidden) return;
  _scanSafetyCount++;
  scan._skipComments = _scanSafetyCount % 2 === 0;
  scanSponsoredFast();
  scan();
}, 15000);

const resumeScan = () => {
  if (document.visibilityState === "visible") {
    scanSponsoredFast();
    scan();
  }
};
document.addEventListener("visibilitychange", resumeScan);
window.addEventListener("focus", resumeScan);
window.addEventListener("pageshow", resumeScan);
listeners.push({ element: document, event: "visibilitychange", handler: resumeScan });
listeners.push({ element: window, event: "focus", handler: resumeScan });
listeners.push({ element: window, event: "pageshow", handler: resumeScan });

let fastScanPending = false;
const scanObserver = new MutationObserver((mutations) => {
  let hasNewPost = false;
  let hasPortal = false;
  const newPostRoots = [];
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (node.nodeType !== 1) continue;
      const pagelet = node.getAttribute?.("data-pagelet") || "";
      const isPost =
        node.getAttribute?.("role") === "article" ||
        node.hasAttribute?.("data-virtualized") ||
        pagelet.startsWith("FeedUnit");
      const isPortal =
        node.classList?.contains("__fb-light-mode") ||
        node.classList?.contains("__fb-dark-mode") ||
        (node.id && node.tagName === "SPAN" && (node.textContent || "").length < 80);
      if (isPost) {
        hasNewPost = true;
        if (newPostRoots.length < 12) newPostRoots.push(node);
      }
      if (isPortal) hasPortal = true;
      if (
        !hasNewPost &&
        node.querySelector?.(
          'article[role="article"], [data-virtualized], [data-pagelet^="FeedUnit"], .__fb-light-mode, .__fb-dark-mode',
        )
      ) {
        hasNewPost = true;
      }
      if (hasNewPost && hasPortal) break;
    }
    if (hasNewPost && hasPortal) break;
  }

  // Always prioritize sponsored path on DOM churn
  if (hasNewPost || hasPortal) {
    // MutationObserver runs immediately after Facebook commits the new DOM.
    // Scan each new post subtree now; do not wait for the general 32ms debounce.
    for (const postRoot of newPostRoots) {
      try {
        scanSponsoredFast(postRoot, true);
      } catch (_) {}
    }
    // Detached "Được tài trợ" portal labels need the document-level mapping.
    if (hasPortal) {
      try {
        scanSponsoredFast();
      } catch (_) {}
    }
    if (!fastScanPending) {
      fastScanPending = true;
      requestAnimationFrame(() => {
        fastScanPending = false;
        scanSponsoredFast();
      });
    }
  }
  scheduleScan();
});
scanObserver.observe(document.documentElement || document.body, {
  childList: true,
  subtree: true,
});
observers.push(scanObserver);
window.buildCommentText = buildCommentText;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.action === "rescan-feed") {
    try {
      scan();
      sendResponse({ ok: true });
    } catch (err) {
      console.warn("[FeedWriter] rescan-feed failed:", err?.message || err);
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
    return true;
  }
  return false;
});

// Note: the auto-generated Shopee affiliate suggestion (search URL + aff_sid)
// was removed — that link format does not earn commission. Affiliate links are
// now created manually via the "Bóc Link" pill (scanShopeeLinks) which opens
// the official Shopee custom-link generator.
