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
// Summary availability must not inherit the feed-filter length setting. The
// background validator accepts 30 characters, so any real status at that
// threshold should expose the action immediately.
const SUMMARY_MIN_LEN = 30;
// Bump when the feed action markup/layout changes. Extension reloads do not
// remove DOM inserted by the previous content-script instance, so an explicit
// component revision is required to replace stale controls in live feeds.
const SUMMARY_UI_VERSION = "text-v3";
let isBlocked = false;
// Raw (unformatted) text of the summary currently shown in the panel.
// Kept as the canonical source for Copy/Post so we never re-derive text from the
// rendered DOM — resultEl.textContent collapses the block-level <div> layout into
// a single line, which makes StatusFormatter treat the whole post as the title and
// UPPERCASE everything. Unlike panelBody.dataset.editedText (deleted after each
// render), this survives and is re-formatted per target platform at post time.
let lastPanelRawText = "";
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

const FB_NON_PROFILE_ROUTES = new Set([
  "", "home.php", "groups", "pages", "watch", "reel", "reels", "events",
  "marketplace", "stories", "photo", "photos", "videos", "gaming", "friends",
  "messages", "notifications", "settings", "help", "search", "login", "recover",
]);
let profileHomeCacheUrl = "";
let profileHomeCacheValue = false;
let profileHomeCacheAt = 0;
const PROFILE_HOME_CACHE_MS = 8000;

function getSummaryPolicyDecision(text, type = "summary") {
  if (typeof FeedWriterSummaryPolicy !== "undefined") {
    return FeedWriterSummaryPolicy.decideSummary({
      site: SITE,
      text,
      type,
      minimumChars: MIN_LEN,
    });
  }
  const length = String(text || "").trim().length;
  return {
    shouldSummarize: length >= MIN_LEN,
    reason: length >= MIN_LEN ? "length_fallback" : "too_short",
  };
}

/**
 * Keep FeedWriter out of Facebook's personal-profile home pages. A bare
 * /username URL may also be a Page, so require the profile-only Friends tab
 * before suppressing it. Numeric profile.php and /people URLs are personal
 * profile routes and can be identified directly.
 */
function isFacebookPersonalProfileHome() {
  if (SITE !== "facebook") return false;

  // This guard runs from several feed paths. Facebook's main container can be
  // very large, so do not repeatedly search its tabs while the route is stable.
  const currentUrl = location.href;
  const now = Date.now();
  if (
    currentUrl === profileHomeCacheUrl &&
    now - profileHomeCacheAt < PROFILE_HOME_CACHE_MS
  ) {
    return profileHomeCacheValue;
  }

  const remember = (value) => {
    profileHomeCacheUrl = currentUrl;
    profileHomeCacheValue = value;
    profileHomeCacheAt = now;
    return value;
  };

  let url;
  try {
    url = new URL(location.href);
  } catch (_) {
    return remember(false);
  }

  const path = url.pathname.replace(/\/+$/, "") || "/";
  const isNumericProfile =
    path === "/profile.php" &&
    !!url.searchParams.get("id") &&
    !url.searchParams.get("story_fbid");
  const isPeopleProfile = /^\/people\/[^/]+\/\d+$/i.test(path);
  const isUserProfile = /^\/user\/[^/]+$/i.test(path);
  if (isNumericProfile || isPeopleProfile || isUserProfile) return remember(true);

  const match = path.match(/^\/([^/]+)$/);
  if (!match || FB_NON_PROFILE_ROUTES.has(match[1].toLowerCase())) return remember(false);

  const main = document.querySelector('[role="main"]');
  if (!main) return remember(false);
  return remember(Array.from(
    main.querySelectorAll(
      '[role="tab"], a[href*="/friends"], a[href*="sk=friends"], ' +
        '[aria-label^="Chỉnh sửa trang cá nhân"], [aria-label^="Edit profile"]',
    ),
  ).some((tab) => {
    const label = (tab.textContent || "").replace(/\s+/g, " ").trim();
    const href = tab.getAttribute("href") || "";
    const aria = tab.getAttribute("aria-label") || "";
    return (
      /^(bạn bè|friends)$/i.test(label) ||
      /(?:\/friends(?:\/|$)|[?&]sk=friends\b)/i.test(href) ||
      /^(chỉnh sửa trang cá nhân|edit profile)\b/i.test(aria)
    );
  }));
}

function removePersonalProfileControls() {
  document
    .querySelectorAll(
      ".fbs-wrap, .fbs-chip-host, .fbs-btn-inline, .fbs-comment-summary-btn",
    )
    .forEach((element) => element.remove());
  if (floatingToolbar) floatingToolbar.classList.remove("fbs-visible");
}

function _isFacebookGroupSuggestion(element) {
  return SITE === "facebook" &&
    typeof window.fbsIsGroupSuggestion === "function" &&
    window.fbsIsGroupSuggestion(element);
}

function _removeGroupSuggestionControls(element) {
  element?.querySelectorAll(
    ".fbs-wrap, .fbs-chip-host, .fbs-btn-inline, .fbs-comment-summary-btn, .fbs-batch-checkbox",
  ).forEach((control) => control.remove());
}

const FB_POST_BODY_SELECTOR =
  '[data-ad-preview="message"], [data-ad-comet-preview="message"], [data-testid="post_message"], [data-testid="post-message"], [data-ad-rendering-role="story_message"]';

// A generic "Xem thêm" appears in many Facebook widgets. Prefer Facebook's
// semantic post-body node; fall back to the heuristic status text finder so
// organic posts without data-ad-preview still get Tóm tắt.
function _findFacebookPostBodyFrom(element) {
  if (SITE !== "facebook" || !element) return null;
  const direct = element.closest?.(FB_POST_BODY_SELECTOR);
  if (direct) return direct;
  const post = element.closest?.(
    'article[role="article"], [data-virtualized], div[data-pagelet^="FeedUnit"]',
  );
  if (!post || _isFacebookGroupSuggestion(post)) return null;
  const semantic = Array.from(post.querySelectorAll(FB_POST_BODY_SELECTOR))
    .find((body) => body.contains(element));
  if (semantic) return semantic;
  const fallback = _findFacebookStatusText(post);
  if (fallback && (fallback === element || fallback.contains(element))) return fallback;
  return null;
}

// Copy typography from Facebook's "Xem thêm" / status text so "Tóm tắt"
// shares the same line rhythm. CSS keeps a distinct accent color.
function _matchInlineBtnTypography(btn, refEl) {
  if (!btn || !refEl) return;
  // getComputedStyle/innerText can force layout. During kinetic scroll the CSS
  // defaults are already correct; defer visual matching to a later reinject.
  if (_isFbScrollBusy()) return;
  try {
    const label =
      [...refEl.querySelectorAll("span, div")].find((node) => {
        const text = (node.innerText || node.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        return SEE_MORE.some((kw) => text === kw || text.startsWith(kw));
      }) ||
      [...refEl.querySelectorAll("span[dir='auto'], div[dir='auto'], span, div")].find((node) => {
        const text = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
        return text.length >= 12 && !SEE_MORE.some((kw) => text.toLowerCase() === kw);
      }) ||
      refEl;
    const cs = window.getComputedStyle(label);
    const host = btn.closest(".fbs-wrap-inline") || btn;
    const fontSize = parseFloat(cs.fontSize);
    // Guard against inheriting Facebook chrome that renders at ~10–11px.
    host.style.fontSize = fontSize > 0 && fontSize < 13 ? "15px" : cs.fontSize;
    host.style.fontFamily = cs.fontFamily;
    host.style.lineHeight = cs.lineHeight;
    host.style.letterSpacing = cs.letterSpacing;
    host.style.fontWeight = "600";
  } catch (_) {}
}

function _statusBodyTextLength(textEl) {
  if (!textEl) return 0;
  // The caller rejects elements that already contain our UI. textContent is
  // sufficient for the length gate and avoids cloning a large Facebook post
  // plus forcing layout through innerText on every newly visible card.
  return (textEl.textContent || "").trim().length;
}

// Facebook's semantic story_message node is often only an outer wrapper. Its
// real text lives several levels deeper in a div/span[dir=auto]. Appending our
// inline action to the semantic wrapper puts it after a block child, which
// creates an artificial line even when there is ample horizontal room.
function _findFacebookInlineTextLeaf(textEl) {
  if (SITE !== "facebook" || !textEl?.querySelectorAll) return textEl;
  const candidates = textEl.querySelectorAll(
    'div[dir="auto"], span[dir="auto"]',
  );
  // The final eligible dir=auto node is normally the last paragraph/text leaf.
  // Walk backwards so multi-paragraph statuses get the action after the actual
  // final paragraph, not inside an outer semantic wrapper.
  for (let i = candidates.length - 1; i >= 0; i--) {
    const candidate = candidates[i];
    if (candidate.closest?.("[data-fbs-ui], form, [role='dialog']")) continue;
    if (candidate.closest?.("a, [role='button']")) continue;
    const value = (candidate.textContent || "").trim();
    if (!value) continue;
    return candidate;
  }
  return textEl;
}

function _findSeeMoreControl(textEl, maximum = 24) {
  if (!textEl) return null;
  const controls = textEl.querySelectorAll(
    '[role="button"], span[dir="auto"], div[dir="auto"]',
  );
  const limit = Math.min(controls.length, maximum);
  for (let i = 0; i < limit; i++) {
    const label = (controls[i].textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (SEE_MORE.some((keyword) => label === keyword || label.startsWith(keyword))) {
      return controls[i];
    }
  }
  return null;
}

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
  if (typeof discoverTimer !== "undefined" && discoverTimer) {
    clearInterval(discoverTimer);
    discoverTimer = null;
  }
  if (typeof pendingFeedRootDiscoveryRaf !== "undefined" && pendingFeedRootDiscoveryRaf) {
    cancelAnimationFrame(pendingFeedRootDiscoveryRaf);
    pendingFeedRootDiscoveryRaf = 0;
  }
  if (typeof _pendingSummaryRaf !== "undefined" && _pendingSummaryRaf) {
    cancelAnimationFrame(_pendingSummaryRaf);
    _pendingSummaryRaf = 0;
  }
  if (typeof _summaryRefreshTimers !== "undefined") {
    for (const timer of _summaryRefreshTimers) clearTimeout(timer);
    _summaryRefreshTimers.clear();
  }
  if (typeof sponsoredCatchupTimer !== "undefined" && sponsoredCatchupTimer) {
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

window.enableUnicodeBold = true;

chrome.storage.sync.get(["minLength", "blockedDomains", "sourceTemplate", "customSourceLink", "enableUnicodeBold"], (d) => {
  if (d.minLength) MIN_LEN = d.minLength;
  globalSourceTemplate = d.sourceTemplate || DEFAULT_SOURCE_TEMPLATE;
  globalCustomSourceLink = d.customSourceLink || "";
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
  if (changes.enableUnicodeBold) window.enableUnicodeBold = changes.enableUnicodeBold.newValue !== false;
  if (changes.adDisplayMode) adDisplayMode = changes.adDisplayMode.newValue === "mark" ? "mark" : "collapse";
  if (changes.filterEngagementGates) filterEngagementGates = changes.filterEngagementGates.newValue === true;
  if (changes.blockedDomains) updateBlockedState(changes.blockedDomains.newValue);
});

function updateBlockedState(rawPatterns = "") {
  const patterns = String(rawPatterns || "")
    .split("\n")
    .map((pattern) => pattern.trim())
    .filter(Boolean);
  isBlocked = patterns.some((pattern) => location.href.includes(pattern));
}

// Output language is always Vietnamese. No detection needed.
function detectAndSetLanguage() {
  chrome.storage.sync.get(["outputLanguage"], (data) => {
    if (data.outputLanguage !== "vi") {
      chrome.storage.sync.set({ outputLanguage: "vi" });
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
    .querySelectorAll(
      ".fbs-wrap, .fbs-panel, .fbs-backdrop, .fbs-chip-host, .fbs-floating-toolbar, .fbs-batch-bar, .fbs-translate-tooltip",
    )
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
  }, 2000);
}
setTimeout(applyTheme, 1000);
const themeObserver = new MutationObserver(throttledApplyTheme);
themeObserver.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["class"],
});
observers.push(themeObserver);

// Filtered feed units are tracked for the lifetime of their current DOM node.
const filteredPosts = new WeakSet();

// Telemetry counters
let telemetry = {
  postsScanned: 0,
  postsFlaggedAds: 0,
  postsFlaggedCommentGate: 0,
  topReasons: {},
  falsePositiveProxy: 0,
  lastResetDate: new Date().toDateString(),
};

// Content scripts cannot access local storage; load the narrow telemetry record
// through the service worker's validated bridge.
chrome.runtime.sendMessage({ action: "get-feed-telemetry" }, (response) => {
  if (chrome.runtime.lastError || !response?.ok || !response.telemetry) return;
  const today = new Date().toDateString();
  if (response.telemetry.lastResetDate !== today) {
    telemetry = { ...telemetry, lastResetDate: today };
  } else {
    telemetry = { ...telemetry, ...response.telemetry };
  }
});

let telemetryWriteTimer = null;
function saveTelemetry() {
  clearTimeout(telemetryWriteTimer);
  telemetryWriteTimer = setTimeout(() => {
    telemetryWriteTimer = null;
    if (!isContextValid()) return;
    try {
      const write = chrome.runtime.sendMessage({
        action: "save-feed-telemetry",
        telemetry,
      });
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
let adDisplayMode = "collapse";
let filterEngagementGates = false;

chrome.storage.sync.get(["adDisplayMode", "filterEngagementGates"], (d) => {
  if (d.adDisplayMode) adDisplayMode = d.adDisplayMode === "mark" ? "mark" : "collapse";
  filterEngagementGates = d.filterEngagementGates === true;
});

function _getReasonText(reason) {
  const reasonMap = {
    ads_about_link: "Link QC",
    why_am_i_seeing: "Ad disclosure",
    portal_label: "Nhãn Được tài trợ",
    aria_label: "aria Sponsored",
    sponsored_keyword: "Sponsored / Được tài trợ",
    ad_rendering_signature: "Cấu trúc quảng cáo mới của Facebook",
    ad_structure: "Cấu trúc ad",
    ads_library_link: "Ads Library",
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
  if (!postContainer) return;
  const expand =
    typeof window.fbsExpandToFullPostCard === "function"
      ? window.fbsExpandToFullPostCard
      : null;
  const isContentOnly =
    typeof window.fbsIsContentOnlyPostSlice === "function"
      ? window.fbsIsContentOnlyPostSlice
      : null;
  const findWrap =
    typeof findFeedWrapper === "function"
      ? findFeedWrapper
      : typeof window.fbsFindFeedWrapper === "function"
        ? window.fbsFindFeedWrapper
        : null;

  let target = (expand && expand(postContainer)) || postContainer;
  if (findWrap) {
    const wrap = findWrap(target) || findWrap(postContainer);
    if (wrap && !(isContentOnly && isContentOnly(wrap))) target = wrap;
  }
  // Refuse to hide a status/media slice that leaves author + action bar behind.
  if (isContentOnly && isContentOnly(target)) return;
  // Full card must include author chrome — otherwise we hollow the post.
  const hasAuthorChrome = !!target.querySelector?.(
    '[data-ad-rendering-role="profile_name"], [data-ad-rendering-role="actor_name"]',
  );
  const hasMessage = !!target.querySelector?.(
    '[data-ad-rendering-role="story_message"], [data-ad-preview="message"], [data-ad-comet-preview="message"], [data-testid="post_message"]',
  );
  if (hasMessage && !hasAuthorChrome) return;
  // Already collapsed / marked — never insert another chip (overlapping
  // article / data-virtualized / FeedUnit candidates used to loop forever).
  if (_isAlreadyFiltered(target) || _isAlreadyFiltered(postContainer)) return;

  const displayMode = type === "sponsored" ? adDisplayMode : "collapse";
  // Skip noisy action_* keys in visible reason chips — actions already in label
  const reasonText = evalResult.reasons
    .filter((r) => !String(r).startsWith("action_"))
    .map(_getReasonText)
    .join(", ");
  const confidence = evalResult.confidence;
  const isEngage =
    type === "comment_gate" || type === "engagement_gate";

  if (displayMode === "hide") {
    _markFilteredCluster(target);
    target.style.display = "none";
    return;
  }

  if (displayMode === "mark") {
    _markFilteredCluster(target);
    target.style.outline = "1px solid rgba(15, 118, 110, 0.45)";
    target.style.outlineOffset = "3px";
    const badge = document.createElement("div");
    badge.className = "fbs-mark-badge";
    const shortType = type === "sponsored"
      ? "QC"
      : isEngage
        ? _engagementGateShort(evalResult)
        : "Aff";
    badge.textContent = `${shortType} · ${confidence}%`;
    target.style.position = "relative";
    target.appendChild(badge);
    return;
  }

  // Collapse mode — soft chip (teal accent, not red alarm)
  const kind =
    type === "sponsored" ? "sponsored" : "engagement";
  const hiddenLabel =
    type === "sponsored"
      ? "Quảng cáo"
      : isEngage
        ? _engagementGateLabel(evalResult)
        : "Yêu cầu tương tác";

  // Replace any leftover chip for this cluster before inserting a new one.
  const parent = target.parentElement;
  if (parent) {
    for (const node of Array.from(parent.children)) {
      if (
        node !== target &&
        node.classList?.contains("fbs-filter-indicator") &&
        (node.nextElementSibling === target ||
          node.previousElementSibling === target)
      ) {
        try {
          node.remove();
        } catch (_) {}
      }
    }
  }

  const indicator = document.createElement("div");
  indicator.className = "fbs-filter-indicator fbs-hidden-chip";
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
    '<button type="button" class="fbs-filter-show fbs-hidden-chip-show">Hiện</button>';

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
    target.style.display = "";
    indicator.remove();
    _clearFilteredCluster(target);
    telemetry.falsePositiveProxy++;
    saveTelemetry();
  });

  _markFilteredCluster(target);
  target.style.display = "none";
  parent?.insertBefore(indicator, target);
}

/** Hash post text without FeedWriter chrome (chips would flip the fingerprint). */
function _cheapPostStamp(el) {
  if (!el) return "";
  try {
    const msg = el.querySelector?.(
      '[data-ad-rendering-role="story_message"], [data-ad-preview="message"], [data-ad-comet-preview="message"], [data-testid="post_message"], [data-testid="post-message"]',
    );
    const raw = ((msg && msg.textContent) || "").replace(/\s+/g, " ").trim();
    if (raw) {
      return (
        String(raw.length) +
        ":" +
        raw.slice(0, 64) +
        ":" +
        (raw.length > 64 ? raw.slice(-32) : "")
      );
    }
    // No semantic message yet — short sample only (never clone the FeedUnit).
    const fallback = (el.textContent || "").replace(/\s+/g, " ").trim();
    return String(fallback.length) + ":" + fallback.slice(0, 80);
  } catch (_) {
    return "";
  }
}

function _filterFingerprint(el) {
  return hashText(_cheapPostStamp(el));
}

function _isAlreadyFiltered(el) {
  if (!el) return true;
  if (filteredPosts.has(el)) return true;
  if (el.dataset?.fbsFiltered === "1") return true;
  if (el.style?.display === "none") return true;
  if (el.previousElementSibling?.classList?.contains("fbs-filter-indicator")) {
    return true;
  }
  let anc = el.parentElement;
  for (let i = 0; i < 12 && anc; i++) {
    if (filteredPosts.has(anc) || anc.dataset?.fbsFiltered === "1") return true;
    if (anc.style?.display === "none") return true;
    anc = anc.parentElement;
  }
  return false;
}

function _markFilteredCluster(target) {
  if (!target) return;
  filteredPosts.add(target);
  try {
    target.dataset.fbsFiltered = "1";
  } catch (_) {}
  // Overlapping feed selectors (article + data-virtualized + FeedUnit) must all
  // be marked or the next scan inserts another "đã ẩn" chip.
  for (const node of _feedCandidates(target)) {
    filteredPosts.add(node);
    try {
      node.dataset.fbsFiltered = "1";
    } catch (_) {}
  }
  filteredPosts.add(target);
}

function _clearFilteredCluster(target) {
  if (!target) return;
  const clearOne = (node) => {
    if (!node) return;
    filteredPosts.delete(node);
    try {
      delete node.dataset.fbsFiltered;
      delete node.dataset.fbsSponsoredHidden;
      delete node.dataset.fbsEvalFingerprint;
    } catch (_) {}
  };
  clearOne(target);
  for (const node of _feedCandidates(target)) clearOne(node);
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
  // Single combined query — three separate querySelectorAlls were thrashing style.
  return Array.from(
    root.querySelectorAll(
      'article[role="article"], [data-virtualized], div[data-pagelet^="FeedUnit"]',
    ),
  );
}

/** Pagelet-only group shelf check — never walks headings on the hot path. */
function _isGroupSuggestionCheap(el) {
  if (SITE !== "facebook" || !el) return false;
  let node = el;
  for (let i = 0; i < 3 && node; i++, node = node.parentElement) {
    const pagelet = (node.getAttribute?.("data-pagelet") || "").toLowerCase();
    if (
      /groups.*(?:suggest|recommend|shouldjoin)|(?:suggest|recommend).*groups/.test(
        pagelet,
      )
    ) {
      return true;
    }
  }
  return false;
}

/** Dedupe overlapping article / virtualized / FeedUnit nodes to one outermost card. */
function _uniqueFeedPosts(root) {
  const raw = _feedCandidates(root);
  const out = [];
  const seen = new Set();
  for (const node of raw) {
    if (!node || seen.has(node)) continue;
    if (_isNestedFeedUnit(node)) continue;
    // Skip if a parent is also a feed unit (prefer outer wrapper).
    let parent = node.parentElement;
    let nestedInCandidate = false;
    for (let i = 0; i < 14 && parent; i++) {
      if (
        parent.getAttribute?.("role") === "article" ||
        parent.hasAttribute?.("data-virtualized") ||
        String(parent.getAttribute?.("data-pagelet") || "").startsWith("FeedUnit")
      ) {
        nestedInCandidate = true;
        break;
      }
      parent = parent.parentElement;
    }
    if (nestedInCandidate) continue;
    seen.add(node);
    out.push(node);
  }
  return out;
}

/** Minimum confidence to auto-hide engagement bait (detector may still score softer). */
const ENGAGEMENT_HIDE_MIN_CONFIDENCE = 90;

function refreshReusedFeedUnit(article) {
  const stamp = _cheapPostStamp(article);
  const previous = article.dataset.fbsPostStamp;
  if (article.dataset.fbsFiltered === "1" || article.style.display === "none") {
    // Recycled DOM under a collapsed card — only un-hide when body text changes.
    if (previous && previous !== stamp) {
      article.style.display = "";
      article.style.outline = "";
      article.style.outlineOffset = "";
      article.querySelectorAll(".fbs-mark-badge").forEach((badge) => badge.remove());
      _clearFilteredCluster(article);
      delete article.dataset.fbsSponsoredHidden;
      delete article.dataset.fbsSponsoredChecked;
      delete article.dataset.fbsEvalFingerprint;
    }
    article.dataset.fbsPostStamp = stamp;
    return;
  }
  if (previous && previous !== stamp) {
    delete article.dataset.fbsSponsoredChecked;
    delete article.dataset.fbsEvalFingerprint;
    article.style.outline = "";
    article.style.outlineOffset = "";
    article.querySelectorAll(".fbs-mark-badge").forEach((badge) => badge.remove());
  }
  article.dataset.fbsPostStamp = stamp;
}

/**
 * Sponsored probe. Pass an iterable of posts for incremental work; omit to
 * scan only currently visible units (never the whole infinite feed on hot path).
 */
function scanSponsoredFast(postsOrRoot, opts) {
  if (SITE !== "facebook") return;
  if (isFacebookPersonalProfileHome()) return;
  if (_isFbScrollBusy()) return;

  const useFullDetect = !!(opts && opts.fullDetect);
  const detectLight =
    typeof window.fbsDetectSponsoredSignalsLight === "function"
      ? window.fbsDetectSponsoredSignalsLight
      : null;
  const detectFull =
    typeof window.fbsDetectSponsoredSignals === "function"
      ? window.fbsDetectSponsoredSignals
      : typeof detectSponsoredSignals === "function"
        ? detectSponsoredSignals
        : null;
  const detect = useFullDetect
    ? detectFull || detectLight
    : detectLight || detectFull;
  if (!detect) return;

  let articles;
  if (postsOrRoot && typeof postsOrRoot[Symbol.iterator] === "function" && !postsOrRoot.querySelectorAll) {
    articles = postsOrRoot;
  } else if (postsOrRoot && postsOrRoot.nodeType === 1) {
    articles = _uniqueFeedPosts(postsOrRoot);
  } else if (typeof visiblePosts !== "undefined" && visiblePosts.size > 0) {
    articles = Array.from(visiblePosts).slice(0, 14);
  } else {
    const root =
      document.querySelector('div[role="main"]') ||
      document.querySelector('div[id^="mount_0_0"]') ||
      document.body;
    articles = _uniqueFeedPosts(root).slice(0, 14);
  }

  let n = 0;
  for (const article of articles) {
    if (!article || !article.isConnected) continue;
    if (++n > 16) break;
    if (_isGroupSuggestionCheap(article)) continue;
    // Skip recycle stamp work when already probed and not filtered.
    if (
      article.dataset.fbsSponsoredChecked === "1" &&
      article.dataset.fbsSponsoredHidden !== "1" &&
      article.dataset.fbsFiltered !== "1"
    ) {
      continue;
    }
    refreshReusedFeedUnit(article);
    if (_isAlreadyFiltered(article)) continue;
    if (article.dataset.fbsSponsoredHidden === "1") continue;
    if (article.dataset.fbsSponsoredChecked === "1") continue;

    const hit = detect(article);
    if (!hit || !hit.isSponsored) {
      article.dataset.fbsSponsoredChecked = "1";
      continue;
    }

    article.dataset.fbsSponsoredHidden = "1";
    article.dataset.fbsSponsoredChecked = "1";
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

/** Inject Tóm tắt for a small set of posts — no whole-feed walks. */
function injectSummaryOnPosts(posts, { allowDuringScroll = false, limit = 10 } = {}) {
  if (!posts) return;
  if (_isFbScrollBusy() && !allowDuringScroll) return;
  let n = 0;
  for (const article of posts) {
    if (!article || !article.isConnected) continue;
    if (++n > limit) break;
    if (_isGroupSuggestionCheap(article)) continue;
    if (article.dataset.fbsSponsoredHidden === "1" || _isAlreadyFiltered(article)) {
      continue;
    }
    if (article.querySelector(".fbs-wrap-inline, .fbs-btn-inline[data-fbs-ui='v3']")) {
      continue;
    }
    if (postObserver && !article.dataset.fbsObserved) {
      article.dataset.fbsObserved = "1";
      postObserver.observe(article);
    }
    const textEl = _findFacebookStatusText(article);
    if (!textEl) continue;
    const seeMore = _findSeeMoreControl(textEl);
    if (seeMore) {
      inject(article, findClickable(seeMore), textEl, seeMore);
    } else {
      _mountInlineStatusChip(article, textEl, SUMMARY_MIN_LEN);
    }
  }
}

const _pendingFeedPosts = new Set();
const _pendingSummaryPosts = new Set();
let _pendingFlushRaf = 0;
let _pendingFlushIdle = 0;
let _pendingSummaryRaf = 0;

// While the user is scrolling, Facebook already saturates the main thread.
// Queue work only — never probe DOM / inject UI until scroll is idle.
let _fbScrollIdle = true;
let _fbScrollIdleTimer = 0;
// Leave enough room for kinetic-scroll work to settle before touching a post.
// 120ms only fires after scroll events fully stop, so it stays jank-free while
// getting the button on screen noticeably sooner after a scroll pause.
const FB_SCROLL_IDLE_MS = 120;
const FB_PENDING_POSTS_PER_FRAME = 2;
const FB_SUMMARY_POSTS_PER_FRAME = 1;

function _isFbScrollBusy() {
  return SITE === "facebook" && !_fbScrollIdle;
}

function _markFbScrollBusy() {
  if (SITE !== "facebook") return;
  _fbScrollIdle = false;
  if (_fbScrollIdleTimer) clearTimeout(_fbScrollIdleTimer);
  if (_pendingFlushRaf) {
    try {
      cancelAnimationFrame(_pendingFlushRaf);
    } catch (_) {}
    _pendingFlushRaf = 0;
  }
  if (_pendingFlushIdle && typeof cancelIdleCallback === "function") {
    try {
      cancelIdleCallback(_pendingFlushIdle);
    } catch (_) {}
    _pendingFlushIdle = 0;
  }
  _fbScrollIdleTimer = setTimeout(() => {
    _fbScrollIdle = true;
    _fbScrollIdleTimer = 0;
    _schedulePendingFeedRootDiscovery();
    _schedulePendingFlush();
  }, FB_SCROLL_IDLE_MS);
}

function _queueFeedPost(node) {
  if (!node || node.nodeType !== 1) return;
  if (_isNestedFeedUnit(node)) return;
  _pendingFeedPosts.add(node);
  _pendingSummaryPosts.add(node);
  _scheduleVisibleSummaryFlush();
}

// Mount only the user-facing control while scrolling. This path intentionally
// avoids sponsored detection, filter evaluation and whole-feed walks. One card
// per animation frame keeps the work below a frame budget while rootMargin
// lets it finish before the card reaches the viewport.
function _flushVisibleSummaryPosts() {
  _pendingSummaryRaf = 0;
  if (document.hidden || !_pendingSummaryPosts.size) return;
  const batch = [];
  for (const node of _pendingSummaryPosts) {
    _pendingSummaryPosts.delete(node);
    if (node?.isConnected) batch.push(node);
    if (batch.length >= FB_SUMMARY_POSTS_PER_FRAME) break;
  }
  if (batch.length) {
    try {
      injectSummaryOnPosts(batch, {
        allowDuringScroll: true,
        limit: FB_SUMMARY_POSTS_PER_FRAME,
      });
    } catch (_) {}
  }
  if (_pendingSummaryPosts.size) _scheduleVisibleSummaryFlush();
}

function _scheduleVisibleSummaryFlush() {
  if (document.hidden || _pendingSummaryRaf || !_pendingSummaryPosts.size) return;
  _pendingSummaryRaf = requestAnimationFrame(_flushVisibleSummaryPosts);
}

function _flushPendingFeedPosts() {
  _pendingFlushRaf = 0;
  _pendingFlushIdle = 0;
  if (_isFbScrollBusy() || document.hidden) return;
  if (!_pendingFeedPosts.size) return;

  const batch = [];
  for (const node of _pendingFeedPosts) {
    batch.push(node);
    _pendingFeedPosts.delete(node);
    // Each card can involve several deep Facebook selectors. Keep one flush
    // below a frame budget; the next rAF continues the queue.
    if (batch.length >= FB_PENDING_POSTS_PER_FRAME) break;
  }
  // Tóm tắt first (user-visible); sponsored probe second (heavier).
  try {
    injectSummaryOnPosts(batch);
  } catch (_) {}
  try {
    scanSponsoredFast(batch);
  } catch (_) {}

  if (_pendingFeedPosts.size) _schedulePendingFlush();
}

function _schedulePendingFlush() {
  if (document.hidden || _isFbScrollBusy()) return;
  if (_pendingFlushRaf || _pendingFlushIdle) return;
  if (!_pendingFeedPosts.size) return;
  // rAF — not requestIdleCallback (idle was delaying the button ~0.5–1.2s).
  _pendingFlushRaf = requestAnimationFrame(_flushPendingFeedPosts);
}

function scanEngagementPosts() {
  if (SITE !== "facebook") return;
  if (isFacebookPersonalProfileHome()) return;
  // Opt-in only — never run the heavy evaluate loop when the user left it off.
  if (!filterEngagementGates) return;
  if (typeof window.fbsEvaluatePostSignals !== "function") return;

  const root =
    document.querySelector('div[role="main"]') ||
    document.querySelector('div[id^="mount_0_0"]') ||
    document.body;

  // Prefer visible posts; never evaluate the entire virtualized history.
  const articles =
    visiblePosts && visiblePosts.size > 0
      ? Array.from(visiblePosts).slice(0, 12)
      : _uniqueFeedPosts(root).slice(0, 12);

  for (const article of articles) {
    if (_isGroupSuggestionCheap(article) || _isFacebookGroupSuggestion(article)) {
      _removeGroupSuggestionControls(article);
      continue;
    }
    refreshReusedFeedUnit(article);
    if (_isAlreadyFiltered(article)) continue;
    if (article.dataset.fbsSponsoredHidden === "1") continue;

    const evalFingerprint = _filterFingerprint(article);
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

    const engageConf = Number(evalResult.confidence) || 0;
    if (
      (evalResult.isEngagementGate || evalResult.isCommentGate) &&
      engageConf >= ENGAGEMENT_HIDE_MIN_CONFIDENCE
    ) {
      telemetry.postsFlaggedCommentGate++;
      for (const r of evalResult.reasons) {
        telemetry.topReasons[r] = (telemetry.topReasons[r] || 0) + 1;
      }
      hideFlaggedPost(article, evalResult, "engagement_gate");
    }
  }

  saveTelemetry();
}

// === SCAN LOGIC ===
function findNewSeeMoreElements() {
  const results = [];
  const roots = [];
  const rootEl =
    document.querySelector('div[role="main"]') ||
    document.querySelector('div[id^="mount_0_0"]') ||
    document.querySelector("main") ||
    document.body;

  // Prefer posts already in the viewport — full-main walks freeze Facebook.
  if (visiblePosts && visiblePosts.size > 0) {
    for (const post of visiblePosts) roots.push(post);
  }
  if (rootEl && SITE === "facebook") {
    let backlog = 0;
    for (const c of rootEl.querySelectorAll(
      'article[role="article"], [data-virtualized], div[data-pagelet^="FeedUnit"]',
    )) {
      if (c.dataset.fbsObserved) continue;
      if (_isNestedFeedUnit(c)) continue;
      roots.push(c);
      if (++backlog >= 10) break;
    }
  } else if (!roots.length && rootEl) {
    roots.push(rootEl);
  }

  const limitedRoots = roots.slice(0, 24);
  for (const root of limitedRoots) {
    if (!root) continue;
    // Stay inside the post body when possible — avoid scanning chrome/comments.
    const scope =
      (SITE === "facebook" &&
        root.querySelector?.(
          '[data-ad-preview="message"], [data-ad-comet-preview="message"], [data-testid="post_message"], [data-testid="post-message"], [data-ad-rendering-role="story_message"]',
        )) ||
      root;
    const els = scope.querySelectorAll(
      'div[role="button"], span[role="button"], span[dir="auto"], div[dir="auto"]',
    );
    const limit = Math.min(els.length, 48);
    for (let i = 0; i < limit; i++) {
      const el = els[i];
      if (_isFacebookGroupSuggestion(el)) {
        el.dataset.fbsScanned = "1";
        continue;
      }
      if (SITE === "facebook" && !_findFacebookPostBodyFrom(el)) {
        el.dataset.fbsScanned = "1";
        continue;
      }
      if (el.dataset.fbsScanned) {
        const textContainer = findTextContainer(el);
        const target = textContainer && findInjectTarget(textContainer);
        if (target && target.querySelector(".fbs-wrap, .fbs-btn, .fbs-btn-inline")) continue;
        delete el.dataset.fbsScanned;
      }
      if (el.children.length > 6) continue;
      // textContent avoids layout thrashing from innerText on every candidate.
      const t = (el.textContent || "").replace(/\u00a0/g, " ").trim().toLowerCase();
      if (t.length > 30 || t.length < 4) continue;
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
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAABmUlEQVR4nO1asW6DMBC1LZYsbqZkyJd168TYbnTN2mzt2Klbv6xDOxGWbLRyJJBF8XHGNndueRISwkDeu/M7OzqkAHBT3X8LBjifXqRrTHImjhEicyAOCVG5kR9y7QXkCpVb9Dt0nAvhgfrpWcTA6+UDfW91PIHjEhv9WOR9BFQT5NEeiEkeg3JzuB6Y32Vn4nJz8Lpf5UyelYByBnnvKsSJOIsMlIHkSQXEIE8mIBZ5Vib+twKKOQ9tHx+ikqgDVnpFTT70nd4CUuyL6oB3zppCS2/uIKweiIHt6oGMPaBE5iiWmrOpsqaWMlwK88/KgIlkigzou9tf15q3d/4m1iPEh2Nqv+P5l1Jb5Mei3Y23n19OEQUX8toxhaZEkJfRxiJpzrvDwFyf8gGJAJuwBjwwFGGywC4DLmAqEGsBWKwCUkFPeIO0P+Bj5MYaDyqjqfYyGiiVmColKXtkrVUWoZXYFX3TbiXdSqj9rhcBRRraC/UNY+pOZTu2SAHEu2Y3eX8AQxaCwnxQwQ1ni+vf+thDDMBFCDQ7fgBbv67l8a+1ewAAAABJRU5ErkJggg==";

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
        '<button type="button" class="fbs-tone-btn fbs-tone-default" data-tone="" title="Trở về tone mặc định">Mặc định</button>' +
        '<button type="button" class="fbs-tone-btn" data-tone="short">Ngắn hơn</button>' +
        '<button type="button" class="fbs-tone-btn" data-tone="reporter">Phóng viên</button>' +
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
  panel.querySelector(".fbs-close").addEventListener("click", closeOverlay);
  panel.querySelector(".fbs-min").addEventListener("click", toggleMinimize);
  panel.querySelector(".fbs-copy-btn").addEventListener("click", copyResult);
  panel
    .querySelector(".fbs-post-status-btn")
    .addEventListener("click", handlePostStatus);
  panel
    .querySelector(".fbs-stop-btn")
    .addEventListener("click", stopSummarize);
  panel.querySelector(".fbs-regen-btn").addEventListener("click", regenerate);
  panel.querySelector(".fbs-edit-btn").addEventListener("click", toggleEdit);
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
      const tone = btn.dataset.tone || null;
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
      SITE !== "other",
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
      if (!panel?.classList.contains("fbs-visible")) return;
      // Prefer body / primary action over Close so keyboard users land in content.
      const primary =
        panel.querySelector(".fbs-sp-open-fb") ||
        panel.querySelector(".fbs-copy-btn:not([style*='display: none'])") ||
        panel.querySelector(".fbs-panel-body") ||
        panel;
      try {
        if (primary === panel.querySelector(".fbs-panel-body")) {
          primary.setAttribute("tabindex", "-1");
        }
        primary.focus({ preventScroll: true });
      } catch (_) {}
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
  } else if (lastPanelRawText) {
    // Preferred: canonical raw summary text (keeps multi-line structure so the
    // formatter uppercases only the title, not the whole post).
    text = lastPanelRawText;
  } else if (panelBody?.dataset?.editedText) {
    text = panelBody.dataset.editedText;
  } else {
    // Last-resort DOM fallback. innerText (not textContent) preserves the
    // line breaks between block-level <div>s.
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
    let needsFormatting = true; // Track if text needs StatusFormatter processing
    
    if (textarea) {
      text = textarea.value;
      needsFormatting = true; // User-edited text needs formatting
    } else if (lastPanelRawText) {
      // Preferred: canonical raw summary text. Preserves the multi-line
      // structure (title / paragraphs / bullets) so StatusFormatter can detect
      // the title correctly and only uppercase THAT line — not the whole post.
      text = lastPanelRawText;
      needsFormatting = true;
    } else if (panelBody.dataset.editedText) {
      text = panelBody.dataset.editedText;
      needsFormatting = false; // Already formatted by StatusFormatter in fmt()
    } else if (resultEl) {
      // Last-resort DOM fallback. innerText (not textContent) so block-level
      // <div>s keep their line breaks; textContent would collapse the summary
      // into one line and make the title logic uppercase everything.
      text = resultEl.innerText || resultEl.textContent || "";
      needsFormatting = true; // Raw HTML text needs formatting
    }
    text = text.trim();
    if (!text) return;

    // Format for current platform using StatusFormatter (same as Copy button)
    // Only format if text hasn't been formatted yet
    if (needsFormatting && typeof StatusFormatter !== "undefined") {
      // ALWAYS format for Facebook when posting - don't use SITE variable
      // because we might be on X/Twitter but posting to Facebook
      const platform = "facebook";
      const hasRepo = !!(typeof globalCustomSourceLink !== 'undefined' && globalCustomSourceLink);
      text = StatusFormatter.format(text, platform, { hasRepo });
    } else if (needsFormatting) {
      // Fallback: apply unicode formatting + uppercase first line
      text = applyUnicodeFormatting(text);
      const lines = text.split("\n");
      if (lines.length > 0) {
        lines[0] = lines[0].toUpperCase();
      }
      text = lines.join("\n");
    }

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

  try {
    if (chrome.permissions?.request) {
      await chrome.permissions.request({ permissions: ["clipboardRead"] });
    } else {
      await chrome.runtime.sendMessage({
        action: "request-optional-permission",
        permissions: ["clipboardRead"],
      });
    }
  } catch (_) {}
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
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
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
        errorHtml += '<button type="button" class="fbs-error-btn" data-fbs-open-popup>' +
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

  // Remember the raw text of the summary currently rendered so Copy/Post can
  // re-format it cleanly per platform instead of scraping the collapsed DOM.
  lastPanelRawText = typeof t === "string" ? t : "";

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
  const itemsHtml = items
    .map((item) => {
      const cleanItem = item
        .replace(/✓\s*/, "")
        .replace(/^[·•\-*]\s*/, "")
        .replace(/<span class="fbs-bullet-dot">·<\/span>\s*/g, "");
      if (!cleanItem) return "";
      return (
        '<div class="fbs-glossary-item"><span class="fbs-glossary-bullet">·</span>' +
        cleanItem +
        "</div>"
      );
    })
    .filter(Boolean)
    .join("");
  return (
    '<div class="fbs-glossary">' +
    '<div class="fbs-glossary-heading">GIẢI THÍCH THUẬT NGỮ</div>' +
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

function summaryActionMarkup(labelClass = "fbs-inline-label") {
  return '<span class="' + labelClass + '" title="Tóm tắt nội dung">Tóm tắt</span>';
}

function createInlineBtn() {
  const d = document.createElement("span");
  d.className = "fbs-btn-inline fbs-summary-action";
  d.setAttribute("role", "button");
  d.setAttribute("tabindex", "0");
  d.setAttribute("data-fbs-ui", "v3");
  d.setAttribute("data-fbs-summary-ui", SUMMARY_UI_VERSION);
  d.setAttribute("data-fbs-action", "summarize");
  d.setAttribute("aria-label", "Tóm tắt bài viết");
  d.setAttribute("aria-haspopup", "dialog");
  d.innerHTML = summaryActionMarkup();
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
      <div class="fbs-batch-overlay-track">
        <div class="fbs-batch-overlay-fill" style="width: 0%"></div>
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
  const barFill = panel.querySelector('.fbs-batch-overlay-fill');
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
  if (isFacebookPersonalProfileHome()) {
    removePersonalProfileControls();
    return;
  }

  if (!text || text.length < SUMMARY_MIN_LEN) {
    openOverlay(
      '<div class="fbs-error">Text quá ngắn để tóm tắt (cần ít nhất 30 ký tự).</div>',
      false,
    );
    return;
  }

  // On X the button is an explicit user action. Keep the semantic policy for
  // deciding which Facebook posts should be offered automatically, but do not
  // reject a tweet after the user has deliberately asked FeedWriter to rewrite
  // it as a concise news item.
  if (type === "summary" && SITE !== "x") {
    const decision = getSummaryPolicyDecision(text, type);
    if (!decision.shouldSummarize) {
      const message = SITE === "x"
        ? "Tweet này đã đủ ngắn, chưa cần tóm tắt. FeedWriter chỉ tóm tắt bài X dài hoặc có nhiều ý."
        : "Nội dung này đã đủ ngắn hoặc chưa có đủ ý để tóm tắt.";
      openOverlay('<div class="fbs-error fbs-error-info">' + message + "</div>", false, type);
      return;
    }
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
  let settleSummarize = null;
  const summarizeDone = new Promise((resolve) => {
    settleSummarize = resolve;
  });
  const finishSummarize = (value) => {
    if (!settleSummarize) return;
    const done = settleSummarize;
    settleSummarize = null;
    done(value || { ok: false });
  };

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
    finishSummarize({ ok: false, error: e.message });
    return summarizeDone;
  }
  // Extract post metadata for enriched history (multi-strategy)
  const _el = lastSummarizeParams._element;
  const _meta = _el && typeof extractPostMeta === "function" ? extractPostMeta(_el) : null;
  const _sourceUrl = _meta?.permalink || extractPostPermalink(_el);
  let _imageUrl = extractPostImage(_el);
  const _author = _meta?.author || extractPostAuthor(_el);
  const _title = extractPostTitle(_el);
  const _source = _meta?.source || extractPostSource(_el);

  // X exposes a generic page-level OpenGraph image ("See what's happening")
  // when a tweet has no real media. Never attach that branding placeholder to
  // the summary; use the exact rendered tweet as the illustration instead.
  const _xNativeMedia = SITE === "x" && _el
    ? _el.querySelector(
        '[data-testid="tweetPhoto"] img, [data-testid="videoPlayer"], ' +
          '[data-testid="videoComponent"], video[poster]',
      )
    : null;
  const _xOgImage = SITE === "x"
    ? document.querySelector('meta[property="og:image"]')?.content || ""
    : "";
  const _normalizeImageUrl = (value) => {
    try {
      const url = new URL(value, location.href);
      return url.origin + url.pathname;
    } catch (_) {
      return String(value || "").split(/[?#]/)[0];
    }
  };
  const _xGenericImage = SITE === "x" && !_xNativeMedia && !!_imageUrl && (
    (_xOgImage && _normalizeImageUrl(_imageUrl) === _normalizeImageUrl(_xOgImage)) ||
    /(?:abs\.twimg\.com|static\.twitter\.com)\//i.test(_imageUrl)
  );
  if (_xGenericImage) _imageUrl = "";

  // On X: if there is no real tweet media (or the generic X placeholder was
  // rejected above), screenshot the post element as the illustration.
  if (SITE === "x" && !_imageUrl && _el) {
    try {
      const bounds = _el.getBoundingClientRect();
      if (bounds.width > 100 && bounds.height > 100) {
        const screenshotResp = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            {
              action: "capture-screenshot",
              bounds: {
                // captureVisibleTab uses viewport coordinates, not document
                // coordinates. Adding scroll offsets crops the wrong region.
                x: Math.round(bounds.x),
                y: Math.round(bounds.y),
                width: Math.round(bounds.width),
                height: Math.round(bounds.height),
              },
              viewport: {
                width: window.innerWidth,
                height: window.innerHeight,
              },
            },
            resolve,
          );
        });
        if (screenshotResp?.base64) {
          _imageUrl = screenshotResp.base64;
        }
      }
    } catch (_) {}
  }
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
  const summaryTimeoutMs = Math.min(
    300000,
    90000 + Math.ceil(text.length / 10000) * 30000,
  );
  const summaryTimeoutId = setTimeout(() => {
    if (!isSummarizing) return;
    isSummarizing = false;
    const partial = streamBuffer.trim();
    if (partial) {
      // Do not strand a usable response behind the streaming-only footer.
      // Finalizing the partial result restores Đăng / Sửa / Lại immediately.
      summaryCache.set(cacheKey, partial);
      openOverlay(
        '<div class="fbs-result">' + fmt(partial) + "</div>" +
          '<div class="fbs-quality-warn">Provider đã ngừng phản hồi. Đây là phần nội dung đã nhận được; bạn có thể sửa hoặc thử tạo lại.</div>',
        false,
        type,
      );
    } else {
      openOverlay(
        displayError({
          message: "Tóm tắt mất quá nhiều thời gian",
          detail:
            "Provider AI không hoàn tất phản hồi trong " +
            Math.round(summaryTimeoutMs / 1000) +
            " giây.",
          action: "Thử lại hoặc chọn provider khác.",
          severity: "warning",
          retryable: true,
        }),
        false,
        type,
      );
    }
    try {
      currentPort?.disconnect();
    } catch (_) {}
    currentPort = null;
    finishSummarize(
      partial
        ? { ok: true, summary: partial, partial: true }
        : { ok: false, error: "timeout" },
    );
  }, summaryTimeoutMs);

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
    } else if (msg.action === "retry") {
      streamBuffer = "";
      first = true;
      if (streamRafId) {
        cancelAnimationFrame(streamRafId);
        streamRafId = null;
      }
      openOverlay(
        '<div class="fbs-panel-body fbs-loading">' +
          '<div class="fbs-skeleton fbs-skeleton-text"></div>' +
          '<div class="fbs-skeleton fbs-skeleton-text"></div>' +
          '<div class="fbs-skeleton fbs-skeleton-text"></div>' +
          '<div style="margin-top:8px;font-size:11px;color:rgba(255,255,255,0.5);">' +
          esc(msg.message || "Đang thử provider khác...") +
          "</div></div>",
        true,
        type,
      );
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
      finishSummarize({ ok: true, summary: msg.full });
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
      finishSummarize({ ok: false, error: msg.error });
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
      finishSummarize({ ok: false, error: "disconnected" });
    }
  });
  return summarizeDone;
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
      chrome.runtime.sendMessage({
        action: "relay-translate",
        text,
        mode: "auto",
      }).catch(() => {});
    } else {
      openOverlay(
        '<div class="fbs-error">Bôi đen văn bản tiếng Anh trước khi dịch (Ctrl+Shift+T).</div>',
        false,
      );
    }
  }
  // translate-selection is handled by translate.js in its own isolated world.
});

// === INJECT BUTTON ===
function inject(target, seeMoreClickable, textContainer, seeMoreOriginal) {
  if (isFacebookPersonalProfileHome()) return;

  // A Chrome extension reload leaves previously injected DOM behind. Remove
  // old Summary revisions before checking the per-instance WeakSet so every
  // post converges on the same component without requiring a Facebook reload.
  target
    .querySelectorAll(
      `.fbs-summary-control:not([data-fbs-summary-ui="${SUMMARY_UI_VERSION}"]), ` +
        `.fbs-chip-host:not([data-fbs-summary-ui="${SUMMARY_UI_VERSION}"])`,
    )
    .forEach((el) => {
      try { el.remove(); } catch (_) {}
    });

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
    wrap.setAttribute("data-fbs-theme", currentTheme);
    wrap.setAttribute("data-fbs-summary-ui", SUMMARY_UI_VERSION);
    wrap.setAttribute("data-fbs-anchor", "see-more");
    wrap.className = "fbs-wrap fbs-wrap-inline fbs-summary-control";
    const btnNode = createInlineBtn();
    if (btnNode.setAttribute) btnNode.setAttribute("data-fbs-ui", "v3");
    if ((SITE === "x" || SITE === "facebook") && btnNode.firstChild?.nodeType === Node.TEXT_NODE) {
      // Keep the pill as one unit. The separator otherwise wraps onto the
      // previous line and makes the button look glued to the status text.
      btnNode.firstChild.textContent = "";
    }
    wrap.appendChild(btnNode);
    if (SITE === "facebook") {
      try {
        const afterEl =
          (seeMoreClickable && seeMoreClickable.parentElement && seeMoreClickable) ||
          seeMoreOriginal;
        _matchInlineBtnTypography(btnNode, afterEl);
        afterEl.parentElement.insertBefore(wrap, afterEl.nextSibling);
        inserted = true;
      } catch (e) {}
    }
    if (!inserted && SITE === "x" && seeMoreClickable) {
      try {
        // X renders Show more as a block-level role=button. Inserting after
        // that block forces a new line; appending to the control keeps both
        // labels in the same inline formatting context.
        seeMoreClickable.appendChild(wrap);
        inserted = true;
      } catch (e) {}
    }
    if (!inserted) {
      try {
        seeMoreOriginal.parentElement.insertBefore(wrap, seeMoreOriginal.nextSibling);
        inserted = true;
      } catch (e) {}
    }
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

  // Fallback: fixed corner chip on the post unit (never full-bleed absolute button)
  if (!inserted) {
    const postUnit =
      (target && _isFeedPostCandidate(target) && target) ||
      (textContainer && textContainer.closest?.('[data-pagelet^="FeedUnit"], [data-virtualized], article[role="article"]')) ||
      target;
    if (postUnit && typeof _mountPostChip === "function") {
      _mountPostChip(postUnit);
      inserted = true;
    }
  }

  // Legacy absolute wrap removed — it was stretched by FB image layouts.
  if (!inserted) return;

  // Chip path has its own click handler in _mountPostChip
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
    e.preventDefault();
    if (btnEl.getAttribute("aria-busy") === "true") return;

    const type = "summary";
    const label = btnEl.querySelector(".fbs-inline-label");
    btnEl.setAttribute("aria-busy", "true");
    if (label) label.textContent = "Đang tóm tắt…";

    try {
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
    } finally {
      btnEl.removeAttribute("aria-busy");
      if (label) label.textContent = "Tóm tắt";
    }
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
  if (_isFacebookGroupSuggestion(sm)) return;
  const postBody = _findFacebookPostBodyFrom(sm);
  if (SITE === "facebook" && !postBody) return;
  const textContainer = postBody || findTextContainer(sm);
  if (!textContainer) return;
  // Do not gate on visible length: truncated previews are often << MIN_LEN
  // even when the expanded post is summarizable. Presence of "Xem thêm" is
  // the signal. Keep a tiny floor only to ignore chrome false positives.
  if (_statusBodyTextLength(textContainer) < 40) return;
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
    '<div class="fbs-floating-more">' +
    '<button type="button" class="fbs-floating-btn fbs-floating-more-toggle" aria-expanded="false" aria-haspopup="true" title="Thêm công cụ">···</button>' +
    '<div class="fbs-floating-more-menu" hidden role="menu">' +
    '<button class="fbs-floating-btn" role="menuitem" data-action="translate" data-mode="slang" title="Slang / thành ngữ">Slang</button>' +
    '<button class="fbs-floating-btn" role="menuitem" data-action="translate" data-mode="collocation" title="Collocations">Cụm từ</button>' +
    '<button class="fbs-floating-btn" role="menuitem" data-action="translate" data-mode="shadowing" title="Shadowing luyện nói">Shadow</button>' +
    (SITE === "facebook"
      ? '<button class="fbs-floating-btn" role="menuitem" data-action="batch" title="Chọn nhiều bài (Alt+B)">Batch</button>'
      : "") +
    "</div></div>";
  document.body.appendChild(floatingToolbar);

  floatingToolbar.addEventListener("mousedown", (e) => e.preventDefault());
  floatingToolbar.addEventListener("click", (e) => {
    e.preventDefault();
    const moreToggle = e.target.closest(".fbs-floating-more-toggle");
    if (moreToggle) {
      const menu = floatingToolbar.querySelector(".fbs-floating-more-menu");
      const open = menu && menu.hasAttribute("hidden");
      if (menu) {
        if (open) menu.removeAttribute("hidden");
        else menu.setAttribute("hidden", "");
      }
      moreToggle.setAttribute("aria-expanded", open ? "true" : "false");
      return;
    }
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
      chrome.runtime.sendMessage({
        action: "relay-translate",
        text,
        mode,
      }).catch(() => {});
      return;
    }

    const anchor =
      sel.rangeCount > 0 ? sel.getRangeAt(0).startContainer.parentElement : null;
    summarizeText(text, action === "summary" ? "summary" : action, anchor);
  });

  const hideToolbar = () => {
    if (floatingToolbar && floatingToolbar.classList.contains("fbs-visible")) {
      floatingToolbar.classList.remove("fbs-visible");
      const menu = floatingToolbar.querySelector(".fbs-floating-more-menu");
      const toggle = floatingToolbar.querySelector(".fbs-floating-more-toggle");
      if (menu) menu.setAttribute("hidden", "");
      if (toggle) toggle.setAttribute("aria-expanded", "false");
    }
  };
  document.addEventListener("scroll", hideToolbar, { capture: true, passive: true });
  listeners.push({ element: document, event: "scroll", handler: hideToolbar, options: { capture: true, passive: true } });
  window.addEventListener("resize", hideToolbar, { passive: true });
  listeners.push({ element: window, event: "resize", handler: hideToolbar, options: { passive: true } });
}

// Facebook renders its post composer in a modal dialog. The native editor is
// already packed with controls, while our toolbar lives under `body` with a
// higher stacking level. Facebook can move the contenteditable attribute among
// nested nodes, so hide selection tools whenever its modal editor is open,
// rather than relying on the selected node alone.
function isNativeComposerOpen() {
  const editors = document.querySelectorAll(
    '[role="dialog"] [contenteditable="true"], ' +
      '[role="dialog"] [data-lexical-editor="true"], ' +
      '[aria-modal="true"] [contenteditable="true"], ' +
      '[aria-modal="true"] [data-lexical-editor="true"]',
  );

  return Array.from(editors).some((editor) => editor.getClientRects().length > 0);
}

function handleSelection() {
  createFloatingToolbar();
  setTimeout(() => {
    if (isFacebookPersonalProfileHome()) {
      floatingToolbar.classList.remove("fbs-visible");
      return;
    }

    if (isNativeComposerOpen()) {
      floatingToolbar.classList.remove("fbs-visible");
      return;
    }

    const selection = window.getSelection();
    const text = selection.toString().trim();
    if (selection.rangeCount === 0) {
      floatingToolbar.classList.remove("fbs-visible");
      return;
    }
    // Translate accepts short EN phrases; summary follows the shared semantic
    // policy and the user's configured minimum length.
    const canTranslate =
      text.length >= 2 && text.length <= 2000 && /[A-Za-z]/.test(text);
    const canSummary = getSummaryPolicyDecision(text, "summary").shouldSummarize;
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

let _selectionTimer = null;
const mouseupHandler = (e) => {
  if (floatingToolbar && floatingToolbar.contains(e.target)) return;
  // Debounce — Facebook click/scroll storms must not run selection logic every time.
  clearTimeout(_selectionTimer);
  _selectionTimer = setTimeout(() => {
    try {
      handleSelection();
    } catch (_) {}
  }, 120);
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
// Primary discovery path for Facebook — do NOT use a subtree MutationObserver
// on the feed (FB mutates constantly while scrolling and freezes the tab).
const viewportScanSig = new WeakMap();
function _viewportFingerprint(el) {
  if (!el) return "";
  const semantic = el.querySelector?.(FB_POST_BODY_SELECTOR);
  const raw = (semantic?.textContent || el.textContent || "").trim();
  // Avoid normalizing the entire post/comment tree on every IO callback.
  return raw.length + ":" + raw.slice(0, 120).replace(/\s+/g, " ");
}
function _isViewportScanCurrent(el) {
  if (!el || el.dataset.fbsViewportScanned !== "1") return false;
  return viewportScanSig.get(el) === _viewportFingerprint(el);
}
function _markViewportScanned(el) {
  if (!el) return;
  el.dataset.fbsViewportScanned = "1";
  viewportScanSig.set(el, _viewportFingerprint(el));
}

const visiblePosts = new Set();
let postObserver = null;
let feedRootObserver = null;
let observedFeedRoot = null;
let lastFallbackFeedDiscoveryAt = 0;
const FB_DISCOVERY_FALLBACK_MS = 8000;
const pendingFeedRootAdditions = new Set();
let pendingFeedRootDiscoveryRaf = 0;
if (typeof IntersectionObserver !== "undefined") {
  postObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const el = entry.target;
        if (entry.isIntersecting) {
          visiblePosts.add(el);
          // Queue only — never flush while scrolling (IO fires mid-scroll).
          if (!_isViewportScanCurrent(el)) {
            _markViewportScanned(el);
            _queueFeedPost(el);
          }
        } else {
          visiblePosts.delete(el);
        }
      }
      // Summary controls have their own one-card-per-frame fast path. Heavier
      // sponsored/filter work still waits until scrolling settles.
      _scheduleVisibleSummaryFlush();
      if (!_isFbScrollBusy()) _schedulePendingFlush();
    },
    { rootMargin: "360px 0px", threshold: 0 },
  );
}

if (SITE === "facebook") {
  window.addEventListener("scroll", _markFbScrollBusy, {
    capture: true,
    passive: true,
  });
  listeners.push({
    element: window,
    event: "scroll",
    handler: _markFbScrollBusy,
    options: { capture: true, passive: true },
  });
}

// Facebook replaces the status subtree after "See more". Because FeedWriter's
// inline control intentionally lives beside that label, the replacement can
// remove it. A capture listener schedules three bounded, summary-only retries;
// no persistent subtree MutationObserver is needed.
const _summaryRefreshTimers = new Set();

function _queueSummaryRefresh(post, delay) {
  const timer = setTimeout(() => {
    _summaryRefreshTimers.delete(timer);
    if (!post?.isConnected) return;
    post.dataset.fbsViewportScanned = "0";
    viewportScanSig.delete(post);
    _pendingSummaryPosts.add(post);
    _scheduleVisibleSummaryFlush();
  }, delay);
  _summaryRefreshTimers.add(timer);
}

function _handleFacebookSeeMoreClick(event) {
  if (SITE !== "facebook" || document.hidden) return;
  const target = event.target?.closest?.('[role="button"]');
  if (!target || target.closest("[data-fbs-ui]")) return;
  const label = (target.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/\.+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!label || label.length > 32) return;
  if (!SEE_MORE.some((keyword) => label === keyword || label.startsWith(keyword))) {
    return;
  }
  const body = _findFacebookPostBodyFrom(target);
  const post =
    (body && Array.from(visiblePosts).find((candidate) => candidate.contains(body))) ||
    body?.closest?.(
      'article[role="article"], [data-virtualized], div[data-pagelet^="FeedUnit"]',
    );
  if (!post) return;
  for (const delay of [0, 80, 240]) _queueSummaryRefresh(post, delay);
}

if (SITE === "facebook") {
  document.addEventListener("click", _handleFacebookSeeMoreClick, true);
  listeners.push({
    element: document,
    event: "click",
    handler: _handleFacebookSeeMoreClick,
    options: true,
  });
}

function _observeFeedUnit(node) {
  if (!node || node.nodeType !== 1 || !postObserver) return false;
  if (node.dataset.fbsObserved === "1" || _isNestedFeedUnit(node)) return false;
  node.dataset.fbsObserved = "1";
  try {
    postObserver.observe(node);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Register feed units from a newly-added top-level feed child. This is kept
 * deliberately shallow: Facebook mutates post internals continuously, so a
 * subtree observer would bring back scroll jank.
 */
function _observeFeedUnitsFromAddedNode(node) {
  if (!node || node.nodeType !== 1 || !postObserver) return;
  const selector =
    'div[data-pagelet^="FeedUnit"], [data-virtualized], article[role="article"]';
  const candidates = [];
  if (node.matches?.(selector)) candidates.push(node);
  // Newer Facebook builds render posts as anonymous direct children of the
  // role="feed" element with none of the markers above — observe those too.
  // The IntersectionObserver + status-text gate filter out non-post shells.
  if (
    !candidates.length &&
    node.tagName === "DIV" &&
    node.parentElement?.getAttribute("role") === "feed"
  ) {
    candidates.push(node);
  }
  // Direct feed children are already the unit we need. Descendant probing is
  // reserved for wrapper insertions so ordinary scroll append stays O(1).
  if (!candidates.length && node.querySelectorAll) {
    for (const candidate of node.querySelectorAll(selector)) {
      candidates.push(candidate);
      if (candidates.length >= 12) break;
    }
  }
  for (const candidate of candidates) {
    _observeFeedUnit(candidate);
  }
}

function _flushPendingFeedRootDiscovery() {
  pendingFeedRootDiscoveryRaf = 0;
  if (document.hidden) return;
  let inspected = 0;
  const limit = _isFbScrollBusy() ? 1 : 8;
  for (const node of pendingFeedRootAdditions) {
    pendingFeedRootAdditions.delete(node);
    _observeFeedUnitsFromAddedNode(node);
    if (++inspected >= limit) break;
  }
  if (pendingFeedRootAdditions.size) _schedulePendingFeedRootDiscovery();
}

function _schedulePendingFeedRootDiscovery() {
  if (document.hidden) return;
  if (pendingFeedRootDiscoveryRaf || !pendingFeedRootAdditions.size) return;
  pendingFeedRootDiscoveryRaf = requestAnimationFrame(
    _flushPendingFeedRootDiscovery,
  );
}

/** Observe only direct feed children; never Facebook's noisy post subtree. */
function _ensureFeedRootObserver(root) {
  if (!root || root === observedFeedRoot) return;
  if (!feedRootObserver) {
    feedRootObserver = new MutationObserver((mutations) => {
      if (document.hidden) return;
      let inspected = 0;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) pendingFeedRootAdditions.add(node);
          if (++inspected >= 8) break;
        }
        if (inspected >= 8) break;
      }
      // Queue only — Facebook may append cards while kinetic scrolling.
      _schedulePendingFeedRootDiscovery();
    });
    observers.push(feedRootObserver);
  } else {
    feedRootObserver.disconnect();
  }
  observedFeedRoot = root;
  // Facebook: no subtree MutationObserver on the feed — direct children only.
  feedRootObserver.observe(root, { childList: true });
}

/**
 * Fallback discovery for an initial/moved feed root. Normal additions use the
 * shallow observer above, so this full selector walk is intentionally rare.
 */
function _discoverFeedUnitsForObserver({ force = false } = {}) {
  if (SITE !== "facebook" || document.hidden || !postObserver) return;
  if (_isFbScrollBusy()) return;
  if (isFacebookPersonalProfileHome()) return;
  const root =
    document.querySelector('div[role="feed"]') ||
    document.querySelector('div[role="main"]');
  if (!root) return;
  _ensureFeedRootObserver(root);

  const now = Date.now();
  if (!force && now - lastFallbackFeedDiscoveryAt < FB_DISCOVERY_FALLBACK_MS) {
    return;
  }
  lastFallbackFeedDiscoveryAt = now;

  // FeedUnit pagelets only — bare [data-virtualized] matches too much chrome.
  const markerNodes = root.querySelectorAll('div[data-pagelet^="FeedUnit"]');
  if (markerNodes.length > 0) {
    let registered = 0;
    for (const node of markerNodes) {
      if (registered >= 16) break;
      if (_observeFeedUnit(node)) registered++;
    }
    return;
  }

  const virtualizedNodes = root.querySelectorAll(
    '[data-virtualized], article[role="article"]',
  );
  if (virtualizedNodes.length > 0) {
    let registered = 0;
    for (const node of virtualizedNodes) {
      if (registered >= 12) break;
      if (_observeFeedUnit(node)) registered++;
    }
    return;
  }

  // Marker-less builds: fall back to the feed's direct children (same source
  // _getTopLevelFeedPosts trusts). Bounded, and deduped via data-fbs-observed.
  let registered = 0;
  for (const node of root.querySelectorAll('div[role="feed"] > div')) {
    if (registered >= 12) break;
    if (_observeFeedUnit(node)) registered++;
  }
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
    // An eligible Facebook post must expose an actual post-body node. This
    // excludes carousels, suggested groups, and every other generic widget.
    if (SITE === "facebook" && !_findFacebookStatusText(el)) continue;
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
  if (_isFacebookGroupSuggestion(article)) {
    _removeGroupSuggestionControls(article);
    return;
  }
  if (SITE === "facebook") {
    const textEl = _findFacebookStatusText(article);
    if (textEl) _mountInlineStatusChip(article, textEl, SUMMARY_MIN_LEN);
    return;
  }
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
  host.setAttribute("data-fbs-theme", currentTheme);
  host.setAttribute("data-fbs-summary-ui", SUMMARY_UI_VERSION);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "fbs-allpost-btn fbs-summary-action";
  btn.setAttribute("data-fbs-action", "summarize");
  btn.setAttribute("data-fbs-ui", "v3");
  btn.setAttribute("data-fbs-summary-ui", SUMMARY_UI_VERSION);
  btn.title = "Tóm tắt bài này";
  btn.innerHTML = summaryActionMarkup("fbs-btn-label");

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    const platformText =
      SITE === "x"
        ? article.querySelector('[data-testid="tweetText"]')
        : null;
    const t = (
      (platformText && (platformText.innerText || platformText.textContent)) ||
      (typeof window.fbsExtractPostContent === "function" &&
        window.fbsExtractPostContent(article)) ||
      article.innerText ||
      ""
    ).trim();
    // Always route the click through summarizeText so short/failed extraction
    // shows a useful message instead of making the button appear unresponsive.
    summarizeText(t, "summary", article);
  });

  host.appendChild(btn);
  article.appendChild(host);
}

// Prefer Facebook's semantic status node. The fallback is bounded to text
// nodes inside the current post and never reads innerText on the scroll path.
function _findFacebookStatusText(article) {
  if (!article) return null;
  let best = null;
  let bestLength = 0;
  for (const node of article.querySelectorAll(FB_POST_BODY_SELECTOR)) {
    if (node.closest("form") || node.closest("[role=dialog]")) continue;
    const length = (node.textContent || "").trim().length;
    if (length > bestLength) {
      best = node;
      bestLength = length;
    }
  }
  // Tiny semantic nodes such as story/composer labels can live inside the same
  // virtualized shell. Do not let them suppress the real status fallback.
  if (best && bestLength >= SUMMARY_MIN_LEN) return best;

  // Fallback when Facebook drops semantic message attrs: prefer the longest
  // dir=auto text block that isn't comment/composer chrome.
  for (const node of article.querySelectorAll('div[dir="auto"], span[dir="auto"]')) {
    if (node.closest("form") || node.closest("[role=dialog]")) continue;
    if (node.closest('[aria-label*="bình luận" i], [aria-label*="comment" i], [aria-label*="Viết" i]')) {
      continue;
    }
    const length = (node.textContent || "").trim().length;
    if (length < SUMMARY_MIN_LEN || length <= bestLength) continue;
    let articleDepth = 0;
    let parent = node.parentElement;
    while (parent && parent !== article) {
      if (parent.getAttribute?.("role") === "article") articleDepth++;
      parent = parent.parentElement;
    }
    if (articleDepth >= 1) continue;
    best = node;
    bestLength = length;
  }
  return best;
}

function _mountInlineStatusChip(post, textEl, minimumLength = 50) {
  if (!post || !textEl) return;
  const currentControl = post.querySelector(
    `.fbs-summary-control[data-fbs-ui="v3"]` +
      `[data-fbs-summary-ui="${SUMMARY_UI_VERSION}"]`,
  );
  post
    .querySelectorAll(
      `.fbs-summary-control:not([data-fbs-summary-ui="${SUMMARY_UI_VERSION}"])`,
    )
    .forEach((el) => {
      try { el.remove(); } catch (_) {}
    });
  if (currentControl) return;
  // Gate on the real status body — feed-unit chrome (author/comments/UI) can
  // make the outer article look long even when the status is one sentence.
  const initialText = (textEl.textContent || "").replace(/\s+/g, " ").trim();
  if (
    initialText.length < minimumLength ||
    (SITE !== "x" &&
      !getSummaryPolicyDecision(initialText, "summary").shouldSummarize)
  ) return;

  // Remove a chip left by an older content-script instance in this live DOM.
  post.querySelectorAll(':scope > .fbs-chip-host').forEach((el) => {
    try { el.remove(); } catch (_) {}
  });

  const wrap = document.createElement("span");
  wrap.className =
    "fbs-wrap fbs-wrap-inline fbs-status-inline fbs-summary-control";
  wrap.setAttribute("data-fbs-ui", "v3");
  wrap.setAttribute("data-fbs-theme", currentTheme);
  wrap.setAttribute("data-fbs-summary-ui", SUMMARY_UI_VERSION);
  wrap.setAttribute("data-fbs-anchor", "status-end");
  const btn = createInlineBtn();
  if (btn.firstChild?.nodeType === Node.TEXT_NODE) btn.firstChild.textContent = "";
  wrap.appendChild(btn);

  // Keep the action inside the status text's own inline formatting context.
  // Adding a sibling row to Facebook's internal flex/grid wrapper can make
  // space-between/min-height rules push the action to the bottom of the card.
  const inlineHost = _findFacebookInlineTextLeaf(textEl);
  _matchInlineBtnTypography(btn, inlineHost);
  inlineHost.appendChild(wrap);

  const summarizePost = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (btn.getAttribute("aria-busy") === "true") return;
    btn.setAttribute("aria-busy", "true");
    const label = btn.querySelector(".fbs-inline-label");
    if (label) label.textContent = "Đang tóm tắt…";
    try {
      const currentTextEl =
        (SITE === "facebook" && _findFacebookStatusText(post)) ||
        post.querySelector('[data-testid="tweetText"]') ||
        textEl;
      const clone = currentTextEl.cloneNode(true);
      clone.querySelectorAll("[data-fbs-ui]").forEach((el) => el.remove());
      const text = (clone.textContent || "").replace(/\s+/g, " ").trim();
      if (
        text.length < minimumLength ||
        (SITE !== "x" &&
          !getSummaryPolicyDecision(text, "summary").shouldSummarize)
      ) {
        wrap.remove();
        return;
      }
      await summarizeText(text, "summary", post);
    } finally {
      btn.removeAttribute("aria-busy");
      if (label) label.textContent = "Tóm tắt";
    }
  };
  btn.addEventListener("click", summarizePost);
  btn.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") summarizePost(event);
  });
}

// X renders every tweet as article[data-testid="tweet"]. Unlike Facebook,
// most tweets have no "Show more" control, so the generic expander scan never
// sees them. Mount one summary chip per tweet and let the mutation observer
// pick up newly virtualized timeline items.
function scanXPosts() {
  if (SITE !== "x" || document.hidden) return;
  const posts = document.querySelectorAll('article[data-testid="tweet"]');
  for (const post of posts) {
    // Settled tweet — skip before the expensive controls walk below.
    if (post.querySelector('.fbs-wrap-inline[data-fbs-ui="v3"]')) continue;
    const textEl = post.querySelector('[data-testid="tweetText"]');
    const text = (textEl?.innerText || textEl?.textContent || "").trim();
    // X's summary control is user-initiated, so ordinary tweets remain
    // actionable. The semantic policy is intentionally not an eligibility
    // gate here; it is only used for automatic offering on longer feed posts.
    if (text.length < 50) continue;
    post.querySelectorAll(':scope > .fbs-chip-host').forEach((el) => {
      try { el.remove(); } catch (_) {}
    });

    // Prefer the same inline placement used on Facebook: immediately after
    // X's "Show more" control. Match the clickable node first so nested spans
    // do not produce duplicate buttons.
    const controls = post.querySelectorAll('[role="button"], button, a, span');
    let showMore = null;
    for (const control of controls) {
      const label = (control.innerText || control.textContent || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      if (label !== "show more" && label !== "xem thêm") continue;
      const clickable = findClickable(control);
      if (clickable && post.contains(clickable)) {
        showMore = control;
        break;
      }
    }

    if (showMore) {
      if (!post.querySelector('.fbs-wrap-inline[data-fbs-ui="v3"]')) {
        inject(post, findClickable(showMore), textEl, showMore);
      }
      continue;
    }

    _mountInlineStatusChip(post, textEl, 50);
  }
}

function scanFBAllPosts() {
  if (SITE !== "facebook") return;
  if (_isFbScrollBusy()) return;
  // Visible-only — never fall back to a full-feed walk (innerText thrash).
  if (!visiblePosts || visiblePosts.size === 0) return;
  const posts = Array.from(visiblePosts);

  let processed = 0;
  for (const article of posts) {
    if (++processed > 12) break;
    if (_isGroupSuggestionCheap(article)) {
      fbAllPostInjected.add(article);
      continue;
    }
    if (postObserver && !article.dataset.fbsObserved) {
      article.dataset.fbsObserved = "1";
      postObserver.observe(article);
    }

    article.querySelectorAll(":scope > .fbs-chip-host").forEach((el) => {
      try {
        el.remove();
      } catch (_) {}
    });

    if (article.dataset.fbsSponsoredHidden === "1" || _isAlreadyFiltered(article)) {
      fbAllPostInjected.add(article);
      continue;
    }
    // Never call full isSponsored() here — it walks the whole card.
    if (article.dataset.fbsSponsoredChecked !== "1") {
      scanSponsoredFast([article]);
      if (article.dataset.fbsSponsoredHidden === "1") {
        fbAllPostInjected.add(article);
        continue;
      }
    }

    if (article.querySelector(".fbs-wrap-inline, .fbs-btn-inline[data-fbs-ui='v3']")) {
      fbAllPostInjected.add(article);
      continue;
    }

    const textEl = _findFacebookStatusText(article);
    if (!textEl) {
      fbAllPostInjected.add(article);
      continue;
    }

    const seeMore = _findSeeMoreControl(textEl);
    if (seeMore) {
      inject(article, findClickable(seeMore), textEl, seeMore);
    } else {
      _mountInlineStatusChip(article, textEl, SUMMARY_MIN_LEN);
    }
    fbAllPostInjected.add(article);
  }
}

// === COMMENT THREAD SUMMARY (Feature 11) ===
const commentBtnInjected = new WeakSet();
function _isFacebookCommentActivityText(text) {
  // content-dom-runtime.js loads first and owns the canonical matcher.
  return typeof window.fbsIsCommentActivityText === "function"
    ? window.fbsIsCommentActivityText(text)
    : false;
}

function _visibleCommentEntries(article) {
  return Array.from(article.querySelectorAll('article[role="article"]'))
    .map((element) => ({ element, text: (element.textContent || "").replace(/\s+/g, " ").trim() }))
    .filter(({ text }) => text.length > 10 && !_isFacebookCommentActivityText(text));
}

function scanCommentSections() {
  if (SITE !== "facebook") return;
  const root = document.querySelector('div[role="main"]') || document.querySelector('div[id^="mount_0_0"]') || document.body;
  // Prefer visible posts; fall back to a small top-level sample.
  const articles = [];
  if (visiblePosts && visiblePosts.size > 0) {
    for (const post of visiblePosts) articles.push(post);
  } else {
    for (const node of _uniqueFeedPosts(root)) {
      articles.push(node);
      if (articles.length >= 12) break;
    }
  }
  let checked = 0;
  for (const article of articles) {
    if (++checked > 16) break;
    if (_isFacebookGroupSuggestion(article)) continue;
    if (_isNestedFeedUnit(article)) continue;
    if (commentBtnInjected.has(article)) {
      if (article.querySelector(".fbs-comment-summary-btn")) continue;
      commentBtnInjected.delete(article);
    }
    const commentArticles = article.querySelectorAll('article[role="article"]');
    if (commentArticles.length < 2) continue;
    const commentEntries = _visibleCommentEntries(article);
    if (commentEntries.length < 2) continue;
    commentBtnInjected.add(article);
    const btn = document.createElement("button");
    btn.className = "fbs-comment-summary-btn";
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg> Tóm tắt ' + commentEntries.length + ' bình luận';
    btn.title = "Tóm tắt toàn bộ thread bình luận";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const currentComments = _visibleCommentEntries(article).map(({ text }) => text);
      if (currentComments.length === 0) return;
      const combined = "THREAD BÌNH LUẬN (" + currentComments.length + " comments):\n\n" +
        currentComments.map((t, i) => (i + 1) + ". " + t).join("\n\n");
      summarizeText(combined, "comment_summary", article);
    });
    const firstComment = commentEntries[0].element;
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
        if (getSummaryPolicyDecision(text, "summary").shouldSummarize) {
          batchQueue.push({ text, el: article, cb });
        } else {
          cb.checked = false;
          cb.classList.remove("fbs-checked");
        }
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

  const progress = document.createElement("div");
  progress.className = "fbs-batch-progress fbs-batch-progress-live";
  progress.setAttribute("data-fbs-ui", "v3");
  progress.setAttribute("role", "status");
  progress.setAttribute("aria-live", "polite");
  progress.innerHTML =
    '<div class="fbs-batch-progress-label">Đang tóm tắt batch…</div>' +
    '<div class="fbs-batch-progress-track"><div class="fbs-batch-progress-fill"></div></div>' +
    '<div class="fbs-batch-progress-meta">0 / ' + items.length + "</div>";
  document.body.appendChild(progress);
  const fill = progress.querySelector(".fbs-batch-progress-fill");
  const meta = progress.querySelector(".fbs-batch-progress-meta");

  try {
    for (let i = 0; i < items.length; i++) {
      const { text, el } = items[i];
      if (fill) fill.style.width = Math.round(((i) / items.length) * 100) + "%";
      if (meta) meta.textContent = i + " / " + items.length;
      await summarizeText(text, "summary", el);
      await new Promise((r) => setTimeout(r, 800));
    }
    if (fill) fill.style.width = "100%";
    if (meta) meta.textContent = items.length + " / " + items.length;
  } finally {
    setTimeout(() => {
      try { progress.remove(); } catch (_) {}
    }, 600);
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
  if (!wrapper) return;
  const expand =
    typeof window.fbsExpandToFullPostCard === "function"
      ? window.fbsExpandToFullPostCard
      : null;
  const isContentOnly =
    typeof window.fbsIsContentOnlyPostSlice === "function"
      ? window.fbsIsContentOnlyPostSlice
      : null;
  let toHide = (expand && expand(wrapper)) || wrapper;
  // Never leave a hollow post (author + action bar, no status/media).
  if (isContentOnly && isContentOnly(toHide)) return;
  const par = toHide.parentElement;
  if (
    par &&
    par !== document.body &&
    par.getAttribute("role") !== "feed" &&
    par.getAttribute("role") !== "main" &&
    par.children.length === 1 &&
    (typeof _isFbLayoutColumn !== "function" || !_isFbLayoutColumn(par)) &&
    !(isContentOnly && isContentOnly(par))
  ) {
    toHide = par;
  }
  if (isContentOnly && isContentOnly(toHide)) return;
  toHide.style.setProperty("display", "none", "important");
  toHide.setAttribute("data-fbs-hidden", "1");
}

/**
 * Restore posts where only the status/media slice was display:none'd, leaving
 * the author row and Like/Comment/Share bar visible (hollow-card bug).
 */
function healHollowFeedPosts(root) {
  if (SITE !== "facebook") return;
  const scope = root || document;
  const messages = scope.querySelectorAll(
    '[data-ad-rendering-role="story_message"], [data-ad-preview="message"], [data-ad-comet-preview="message"]',
  );
  for (const msg of messages) {
    let node = msg.parentElement;
    for (let i = 0; i < 6 && node; i++) {
      const disp = node.style && node.style.getPropertyValue("display");
      if (disp === "none") {
        const parent = node.parentElement;
        const parentHasProfile = !!parent?.querySelector?.(
          '[data-ad-rendering-role="profile_name"]',
        );
        const nodeHasProfile = !!node.querySelector?.(
          '[data-ad-rendering-role="profile_name"]',
        );
        if (parentHasProfile && !nodeHasProfile) {
          node.style.removeProperty("display");
          node.removeAttribute("data-fbs-hidden");
          delete node.dataset.fbsHidden;
          delete node.dataset.fbsHideReason;
          filteredPosts.delete(node);
        }
        break;
      }
      node = node.parentElement;
    }
  }
}



// === REDDIT ===
function scanThreadsPosts() {
  if (SITE !== "threads" || document.hidden) return;
  const posts = document.querySelectorAll(
    '[data-pressable-container="true"], article, div[role="article"]',
  );
  for (const post of posts) {
    if (post.dataset.fbsScanned) continue;
    if (post.querySelector('.fbs-wrap, .fbs-btn, .fbs-chip-host')) {
      post.dataset.fbsScanned = "1";
      continue;
    }
    const text = (post.innerText || "").replace(/\s+/g, " ").trim();
    if (text.length < 50) continue;
    post.dataset.fbsScanned = "1";
    _mountInlineStatusChip(post, post, 50);
  }
}

function scanLinkedinPosts() {
  if (SITE !== "linkedin" || document.hidden) return;
  const posts = document.querySelectorAll(
    ".feed-shared-update-v2, .occludable-update, article.feed-shared-update-v2",
  );
  for (const post of posts) {
    if (post.dataset.fbsScanned) continue;
    if (post.querySelector('.fbs-wrap, .fbs-btn, .fbs-chip-host')) {
      post.dataset.fbsScanned = "1";
      continue;
    }
    const textEl = post.querySelector(
      ".feed-shared-update-v2__description, .update-components-text, .feed-shared-inline-show-more-text",
    );
    const text = ((textEl && textEl.innerText) || post.innerText || "").replace(/\s+/g, " ").trim();
    if (text.length < 50) continue;
    post.dataset.fbsScanned = "1";
    _mountInlineStatusChip(post, textEl || post, 50);
  }
}

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
function scan(opts) {
  if (!isContextValid() || isBlocked) return;
  if (document.hidden) return;
  if (_isFbScrollBusy()) return;
  if (isFacebookPersonalProfileHome()) {
    removePersonalProfileControls();
    return;
  }
  const full = !!(opts && opts.full);
  if (SITE === "reddit") scanRedditPosts();
  if (SITE === "x") scanXPosts();
  if (SITE === "threads") scanThreadsPosts();
  if (SITE === "linkedin") scanLinkedinPosts();
  _discoverFeedUnitsForObserver();
  scanSponsoredFast(undefined, { fullDetect: !!full });
  if (SITE === "facebook") {
    scanFBAllPosts();
    if (full && filterEngagementGates) scanEngagementPosts();
    scanCommentSections();
    healHollowFeedPosts();
  }
}

let scanDebounceTimer = null;
let scanScheduled = false;
// Non-Facebook feeds rescan only when the mutation observer sees a new post
// land, so the debounce just coalesces one insertion burst — keep it short or
// the button visibly lags the tweet.
const SCAN_DEBOUNCE_MS = SITE === "facebook" ? 4000 : 400;
const SCAN_SAFETY_INTERVAL_MS = 180_000;
let _scanSafetyCount = 0;
let discoverTimer = null;
let sponsoredCatchupTimer = null;

function scanSummaryControlsFast() {
  if (!isContextValid() || isBlocked || document.hidden) return;
  if (_isFbScrollBusy()) return;
  if (isFacebookPersonalProfileHome()) return;
  if (_pendingFeedPosts.size) {
    _flushPendingFeedPosts();
    return;
  }
  if (SITE === "facebook") scanFBAllPosts();
  if (SITE === "x") scanXPosts();
}

function scheduleScan() {
  if (document.hidden || _isFbScrollBusy()) return;
  clearTimeout(scanDebounceTimer);
  scanScheduled = true;
  scanDebounceTimer = setTimeout(() => {
    scanScheduled = false;
    if (_isFbScrollBusy()) return;
    const run = () => {
      try {
        scan({ full: filterEngagementGates });
      } catch (_) {}
    };
    if (typeof requestIdleCallback === "function") {
      // Short timeout: yield to pending frame work but never let "idle
      // starvation" during continuous feed updates delay the button.
      requestIdleCallback(run, { timeout: 800 });
    } else {
      run();
    }
  }, SCAN_DEBOUNCE_MS);
}

function scheduleSponsoredFast() {
  if (document.hidden || SITE !== "facebook") return;
  _schedulePendingFlush();
}

// Boot: discover quickly so the first viewport gets "Tóm tắt" without waiting.
if (SITE === "facebook") {
  const bootDiscover = () => {
    try {
      _discoverFeedUnitsForObserver();
      // Seed queue from anything already intersecting after observe().
      for (const el of visiblePosts) {
        if (_isViewportScanCurrent(el)) continue;
        _markViewportScanned(el);
        _queueFeedPost(el);
      }
      _schedulePendingFlush();
    } catch (_) {}
  };
  // Fast path — do not wait for requestIdleCallback (felt like ~1s delay).
  setTimeout(bootDiscover, 80);
  requestAnimationFrame(bootDiscover);
  // One retry covers Facebook's late initial mount. After that, direct feed
  // child observation handles new cards and this is only a sparse fallback.
  setTimeout(bootDiscover, 900);
  discoverTimer = setInterval(() => {
    if (document.hidden || _isFbScrollBusy()) return;
    _discoverFeedUnitsForObserver();
    _schedulePendingFlush();
  }, FB_DISCOVERY_FALLBACK_MS);
} else {
  // X/Reddit render their timeline well after document_end; a single early
  // scan lands before any post exists. Retry a few times — each pass is cheap
  // and no-ops once posts carry their button.
  for (const delay of [600, 1600, 3500]) {
    setTimeout(() => {
      try {
        scan({ full: false });
      } catch (_) {}
    }, delay);
  }
}

scanTimer = setInterval(() => {
  if (document.hidden || _isFbScrollBusy()) return;
  _scanSafetyCount++;
  _discoverFeedUnitsForObserver();
  if (filterEngagementGates && _scanSafetyCount % 2 === 0) {
    scheduleScan();
  } else {
    try {
      scanSponsoredFast();
    } catch (_) {}
  }
}, SCAN_SAFETY_INTERVAL_MS);

const resumeScan = () => {
  if (document.visibilityState === "visible" && !_isFbScrollBusy()) {
    _discoverFeedUnitsForObserver();
    _schedulePendingFlush();
  }
};
document.addEventListener("visibilitychange", resumeScan);
listeners.push({ element: document, event: "visibilitychange", handler: resumeScan });

// Facebook: no subtree MutationObserver on the feed — dominant scroll-jank source.
if (SITE !== "facebook") {
  const feedObserverRoot =
    document.querySelector('div[role="main"]') ||
    document.body ||
    document.documentElement;
  const feedTargetSelector =
    'article[role="article"], [data-virtualized], [data-pagelet^="FeedUnit"]';
  const scanObserver = new MutationObserver((mutations) => {
    if (document.hidden) return;
    let hit = false;
    const maxMutations = Math.min(mutations.length, 12);
    for (let mi = 0; mi < maxMutations; mi++) {
      const nodes = mutations[mi].addedNodes;
      const maxNodes = Math.min(nodes.length, 8);
      for (let ni = 0; ni < maxNodes; ni++) {
        const node = nodes[ni];
        // X (and Reddit) wrap each post in a plain container div, so the
        // added node itself never matches — probe one level into it too.
        if (
          node.nodeType === 1 &&
          (node.matches?.(feedTargetSelector) ||
            node.querySelector?.(feedTargetSelector))
        ) {
          hit = true;
          break;
        }
      }
      if (hit) break;
    }
    if (hit) scheduleScan();
  });
  scanObserver.observe(feedObserverRoot, { childList: true, subtree: true });
  observers.push(scanObserver);
}

window.buildCommentText = buildCommentText;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.action === "rescan-feed") {
    try {
      scan({ full: true });
      sendResponse({ ok: true });
    } catch (err) {
      console.warn("[FeedWriter] rescan-feed failed:", err?.message || err);
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
    return true;
  }
  return false;
});

function clearPendingPostToken(url) {
  url.searchParams.delete("feedwriter_compose");
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
}

async function requestPendingPost(action, kind, id) {
  const response = await chrome.runtime.sendMessage({ action, kind, id });
  if (!response?.ok) {
    const error = new Error(response?.error || "Không thể đọc bài chờ đăng.");
    error.code = response?.code || "pending_error";
    throw error;
  }
  return response.pending;
}

// A status summarized on X can be handed to a newly opened Facebook tab.
// The opaque query token references a trusted-context storage record. The
// record remains available for refresh/retry until the composer is ready.
async function consumePendingFacebookPost() {
  if (SITE !== "facebook") return;
  let url;
  try {
    url = new URL(location.href);
  } catch (_) {
    return;
  }
  const id = url.searchParams.get("feedwriter_compose");
  if (!id || !/^[0-9a-f-]{20,}$/i.test(id)) return;

  try {
    const pending = await requestPendingPost("get-pending-post", "facebook", id);
    for (let i = 0; i < 30 && !document.querySelector('div[role="main"]'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (typeof PosterFacebook === "undefined") {
      throw new Error("Không tải được bộ đăng Facebook");
    }
    const result = await PosterFacebook.post(pending.postData);
    if (!result?.ok) {
      throw new Error("Không mở được composer Facebook: " + (result?.reason || "unknown"));
    }
    try {
      await requestPendingPost("complete-pending-post", "facebook", id);
    } finally {
      clearPendingPostToken(url);
    }
  } catch (error) {
    const terminal = ["pending_invalid", "pending_missing", "pending_expired"].includes(error.code);
    if (terminal) clearPendingPostToken(url);
    console.error("[FeedWriter] Facebook handoff failed:", error);
    openOverlay(
      '<div class="fbs-error">' + esc(error?.message || String(error)) +
        (!terminal ? "<br>Tải lại trang để thử lại." : "") +
        "</div>",
      false,
    );
  }
}

consumePendingFacebookPost();

async function consumePendingRedditPost() {
  if (SITE !== "reddit" || !location.pathname.includes("/submit")) return;
  let url;
  try {
    url = new URL(location.href);
  } catch (_) {
    return;
  }
  const id = url.searchParams.get("feedwriter_compose");
  if (!id || !/^[0-9a-f-]{20,}$/i.test(id)) return;

  try {
    const pending = await requestPendingPost("get-pending-post", "reddit", id);
    if (typeof PosterReddit === "undefined") {
      throw new Error("Không tải được bộ đăng Reddit");
    }
    const result = await PosterReddit.post(pending.postData);
    if (!result?.ok) {
      throw new Error("Không điền được form Reddit: " + (result?.reason || "unknown"));
    }
    try {
      await requestPendingPost("complete-pending-post", "reddit", id);
    } finally {
      clearPendingPostToken(url);
    }
  } catch (error) {
    const terminal = ["pending_invalid", "pending_missing", "pending_expired"].includes(error.code);
    if (terminal) clearPendingPostToken(url);
    console.error("[FeedWriter] Reddit handoff failed:", error);
    openOverlay(
      '<div class="fbs-error">' + esc(error?.message || String(error)) +
        (!terminal ? "<br>Tải lại trang để thử lại." : "") +
        "</div>",
      false,
    );
  }
}

consumePendingRedditPost();

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-fbs-open-popup]");
  if (!btn) return;
  e.preventDefault();
  try {
    if (chrome.action?.openPopup) chrome.action.openPopup();
  } catch (_) {}
});
