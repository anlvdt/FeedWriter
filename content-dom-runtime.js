"use strict";

// --- DOM EXTRACTION & UTILS ---

const SITE = location.hostname.includes("facebook")
  ? "facebook"
  : location.hostname.includes("threads")
    ? "threads"
    : location.hostname.includes("x.com") ||
        location.hostname.includes("twitter")
      ? "x"
      : location.hostname.includes("linkedin")
        ? "linkedin"
        : location.hostname.includes("reddit")
          ? "reddit"
          : "other";

const IS_MOBILE_WEB = location.hostname === "m.facebook.com" ||
                      location.hostname === "mobile.facebook.com";

const SEE_MORE_KEYWORDS = {
  facebook: [
    "xem thêm",
    "see more",
    "voir plus",
    "mehr anzeigen",
    "もっと見る",
    "더 보기",
    "ver más",
    "ver mais",
  ],
  threads: ["more", "xem thêm"],
  x: ["show more"],
  linkedin: ["see more", "xem thêm", "...more"],
  reddit: [],
  other: ["see more", "xem thêm"],
};


// Prefer longer phrases. Short tokens ("tài trợ", "quảng cáo") are exact-only
// to avoid false positives on organic posts.
const SPONSORED_KEYWORDS = [
  // Vietnamese — full phrases
  "được tài trợ",
  "duoc tai tro",
  "đc tài trợ",
  "dc tai tro",
  "nội dung được tài trợ",
  "noi dung duoc tai tro",
  "bài viết được tài trợ",
  // Vietnamese — exact-only shorts (see _matchesSponsoredNorm)
  "quảng cáo",
  "quang cao",
  // English
  "sponsored",
  "paid partnership",
  "paid partnership with",
  "paid ad",
  "branded content",
  // Other languages
  "publicité",
  "sponsorisé",
  "gesponsert",
  "gesponsord",
  "patrocinado",
  "sponsorizzato",
  "rekommenderat",
  "commandité",
  "sponsorizat",
  "sponzorováno",
  "sponzorirano",
  "реклама",
  "広告",
  "スポンサー",
  "赞助内容",
  "贊助",
  "광고",
  "협찬",
];

/** Normalize FB label text: drop spaces/punctuation, lower-case. */
function _normLabelText(s) {
  return String(s || "")
    .replace(/\s+/g, "")
    .replace(/[·•|·]/g, "")
    .toLowerCase()
    .normalize("NFC");
}

const SPONSORED_KEYWORDS_NORM = SPONSORED_KEYWORDS.map(_normLabelText);

// Short norms: only exact/startsWith on short labels (not substring in long body text)
const SPONSORED_EXACT_ONLY_NORM = new Set(
  ["quảng cáo", "quang cao", "publicité", "реклама", "광고"].map(_normLabelText),
);

/**
 * True if normalized text is a Sponsored / Được tài trợ label.
 * Handles FB per-character spans ("Đượctàitrợ") and longer aria strings.
 * Avoids matching organic posts that merely mention ads.
 */
function _matchesSponsoredNorm(tcNorm) {
  if (!tcNorm || tcNorm.length < 5) return false;

  for (const kw of SPONSORED_KEYWORDS_NORM) {
    if (!kw || kw.length < 5) continue;
    // Exact label (portal / header chip)
    if (tcNorm === kw) return true;
    // Short header: "Sponsored·" / "Được tài trợ ·"
    if (tcNorm.length <= kw.length + 6 && tcNorm.startsWith(kw)) return true;
    // Long aria strings only for strong phrases (not short tokens)
    if (
      !SPONSORED_EXACT_ONLY_NORM.has(kw) &&
      kw.length >= 8 &&
      tcNorm.length <= 160 &&
      tcNorm.includes(kw)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Return the post unit matched by the current Facebook ad-rendering signature.
 *
 * Equivalent uBlock filter:
 * facebook.com##[data-ad-rendering-role="profile_name"]:upward([aria-posinset]:has([data-ad-rendering-role="story_message"]):has([data-ad-rendering-role^="cta-"]))
 *
 * `:upward()` is a uBlock-only pseudo-class, so walk the ancestors here. The
 * complete combination is deliberate: Facebook uses individual data-ad-* roles
 * in ordinary posts too, but this three-part signature identifies an ad unit.
 */
function _findFacebookAdRenderingUnit(container) {
  if (!container || SITE !== "facebook" || !container.querySelectorAll) return null;

  const profiles = [];
  if (container.matches?.('[data-ad-rendering-role="profile_name"]')) {
    profiles.push(container);
  }
  for (const profile of container.querySelectorAll(
    '[data-ad-rendering-role="profile_name"]',
  )) {
    profiles.push(profile);
    // A feed card has one profile name; cap work in case Facebook duplicates it.
    if (profiles.length >= 4) break;
  }

  for (const profile of profiles) {
    let unit = profile.parentElement;
    for (let depth = 0; depth < 16 && unit && unit !== document.body; depth++) {
      if (
        unit.hasAttribute("aria-posinset") &&
        unit.querySelector('[data-ad-rendering-role="story_message"]') &&
        unit.querySelector('[data-ad-rendering-role^="cta-"]')
      ) {
        return unit;
      }
      const role = unit.getAttribute("role") || "";
      if (role === "feed" || role === "main" || role === "complementary") break;
      unit = unit.parentElement;
    }
  }
  return null;
}

/**
 * Sponsored detection — prefer label/disclosure signals over structure.
 * FB puts data-ad-* on many organic posts → do NOT use those alone. The
 * composite ad-rendering signature above is the one structural exception.
 */
function detectSponsoredSignals(container) {
  if (!container || SITE !== "facebook") {
    return { isSponsored: false, reasons: [], confidence: 0, details: {} };
  }

  const reasons = [];
  let confidence = 0;
  const details = {};

  // 0. Current feed-ad signature: profile + story message + CTA in one feed unit.
  const adRenderingUnit = _findFacebookAdRenderingUnit(container);
  if (adRenderingUnit) {
    reasons.push("ad_rendering_signature");
    confidence = Math.max(confidence, 99);
    details.adRenderingSignature = true;
  }

  // 1. Ads about / AdChoices (strong)
  if (
    container.querySelector(
      'a[href*="/ads/about"], a[href*="about_ads"], a[href*="adchoices"], a[href*="/ads/preferences"]',
    )
  ) {
    reasons.push("ads_about_link");
    confidence = Math.max(confidence, 95);
  }

  // 2. Why am I seeing this ad? — full phrases only (never bare "Vì sao")
  if (
    container.querySelector(
      'a[aria-label*="Why am I seeing this"], a[aria-label*="Why am I seeing this ad"], a[aria-label*="Tại sao tôi nhìn thấy"], a[aria-label*="Tại sao bạn nhìn thấy quảng cáo"], a[aria-label*="why you\'re seeing this ad"], [aria-label*="tại sao bạn nhìn thấy quảng cáo"]',
    )
  ) {
    reasons.push("why_am_i_seeing");
    confidence = Math.max(confidence, 92);
  }

  // 3. Portal refs (primary FB pattern)
  const ariaRefs = container.querySelectorAll(
    "[aria-describedby],[aria-labelledby]",
  );
  for (const ref of ariaRefs) {
    const ids = (
      (ref.getAttribute("aria-describedby") || "") +
      " " +
      (ref.getAttribute("aria-labelledby") || "")
    )
      .trim()
      .split(/\s+/);
    for (const id of ids) {
      if (!id) continue;
      const portal = document.getElementById(id);
      if (!portal) continue;
      const raw = (portal.textContent || "").trim();
      // Portals for labels are short; skip long junk
      if (raw.length > 120) continue;
      const tcNorm = _normLabelText(raw);
      if (_matchesSponsoredNorm(tcNorm)) {
        reasons.push("portal_label");
        confidence = Math.max(confidence, 94);
        details.portalText = raw.slice(0, 80);
        break;
      }
    }
    if (reasons.includes("portal_label")) break;
  }

  // 4. aria-label — only strong sponsored phrases
  if (confidence < 90) {
    const ariaLabelEls = container.querySelectorAll("[aria-label]");
    for (const el of ariaLabelEls) {
      const raw = el.getAttribute("aria-label") || "";
      if (raw.length < 8 || raw.length > 180) continue;
      const lbl = _normLabelText(raw);
      // Must include a strong phrase (not bare "quảng cáo" in long UI chrome)
      const strong =
        lbl.includes("đượctàitrợ") ||
        lbl.includes("duoctaitro") ||
        lbl.includes("nộidungđượctàitrợ") ||
        lbl.includes("noidungduoctaitro") ||
        lbl.includes("sponsored") ||
        lbl.includes("paidpartnership") ||
        lbl.includes("brandedcontent");
      if (!strong) continue;
      reasons.push("aria_label");
      confidence = Math.max(confidence, 88);
      details.ariaLabel = raw.slice(0, 100);
      break;
    }
  }

  // 5. Short header text only (exact label chips — not post body)
  if (!reasons.includes("portal_label") && !reasons.includes("sponsored_keyword")) {
    const candidates = container.querySelectorAll(
      'a, span, div[dir="auto"], span[dir="auto"]',
    );
    let n = 0;
    for (const node of candidates) {
      if (++n > 60) break;
      const tc = (node.textContent || "").trim();
      // Header chips are tiny; ignore longer copy
      if (tc.length < 5 || tc.length > 36) continue;
      const tcNorm = _normLabelText(tc);
      if (tcNorm.length < 5 || tcNorm.length > 40) continue;
      if (_matchesSponsoredNorm(tcNorm)) {
        reasons.push("sponsored_keyword");
      // This fallback is informational only. A short word inside post content
      // is not enough to filter it without portal/disclosure evidence.
      confidence = Math.max(confidence, 80);
        details.labelText = tc.slice(0, 40);
        break;
      }
    }
  }

  // 6. Structure — ONLY explicit ad pagelets (FB uses data-ad-* on organic too)
  const pagelet =
    container.getAttribute?.("data-pagelet") ||
    container.closest?.("[data-pagelet]")?.getAttribute("data-pagelet") ||
    "";
  if (
    /FeedUnit_Ad|SponsoredFeed|AdsFeed|FeedAds/i.test(pagelet) ||
    container.querySelector?.(
      '[data-pagelet*="FeedUnit_Ad"], [data-pagelet*="SponsoredFeed"]',
    )
  ) {
    reasons.push("ad_structure");
    confidence = Math.max(confidence, 92);
  }

  // 7. Ads Library link (rare but strong) — require library path, not any /ads/
  if (
    container.querySelector?.(
      'a[href*="/ads/library"], a[href*="ads/library/?id="]',
    )
  ) {
    reasons.push("ads_library_link");
    confidence = Math.max(confidence, 90);
  }

  return {
    // An aria label alone is not sufficiently reliable; only disclosure,
    // portal, or explicit ad-structure evidence may filter a feed post.
    isSponsored: confidence >= 90,
    reasons,
    confidence,
    details,
  };
}

/**
 * Hot-path sponsored probe — ad-rendering signature, pagelet + ads links, and
 * a few portal ids only.
 * Skips the expensive aria-label / short-text walks used by the full detector.
 */
function detectSponsoredSignalsLight(container) {
  if (!container || SITE !== "facebook") {
    return { isSponsored: false, reasons: [], confidence: 0, details: {} };
  }
  const reasons = [];
  let confidence = 0;
  const details = {};

  const adRenderingUnit = _findFacebookAdRenderingUnit(container);
  if (adRenderingUnit) {
    reasons.push("ad_rendering_signature");
    confidence = 99;
    details.adRenderingSignature = true;
  }

  const pagelet =
    container.getAttribute?.("data-pagelet") ||
    container.closest?.("[data-pagelet]")?.getAttribute("data-pagelet") ||
    "";
  if (/FeedUnit_Ad|SponsoredFeed|AdsFeed|FeedAds/i.test(pagelet)) {
    reasons.push("ad_structure");
    confidence = 92;
  }

  if (
    container.querySelector?.(
      'a[href*="/ads/about"], a[href*="about_ads"], a[href*="adchoices"], a[href*="/ads/preferences"]',
    )
  ) {
    reasons.push("ads_about_link");
    confidence = Math.max(confidence, 95);
  }

  // Cap portal walk — Facebook posts can have dozens of aria-describedby nodes.
  const ariaRefs = container.querySelectorAll?.(
    "[aria-describedby],[aria-labelledby]",
  );
  const portalLimit = Math.min(ariaRefs?.length || 0, 18);
  for (let i = 0; i < portalLimit; i++) {
    const ref = ariaRefs[i];
    const ids = (
      (ref.getAttribute("aria-describedby") || "") +
      " " +
      (ref.getAttribute("aria-labelledby") || "")
    )
      .trim()
      .split(/\s+/);
    for (const id of ids) {
      if (!id || id.length > 40) continue;
      const portal = document.getElementById(id);
      if (!portal) continue;
      const raw = (portal.textContent || "").trim();
      if (raw.length < 5 || raw.length > 48) continue;
      if (_matchesSponsoredNorm(_normLabelText(raw))) {
        reasons.push("portal_label");
        confidence = Math.max(confidence, 94);
        details.portalText = raw.slice(0, 80);
        break;
      }
    }
    if (confidence >= 90) break;
  }

  return {
    isSponsored: confidence >= 90,
    reasons,
    confidence,
    details,
  };
}

const CLUTTER_LABELS = [
  // Vietnamese — gợi ý / đề xuất
  "gợi ý cho bạn", "video gợi ý", "reels gợi ý", "nhóm gợi ý",
  "trang gợi ý", "sự kiện gợi ý", "bài viết gợi ý", "có thể bạn quan tâm",
  "khám phá thêm", "người bạn có thể biết", "tin tức gợi ý",
  "dành cho bạn", "được đề xuất", "nội dung liên quan",
  "được xem nhiều", "xu hướng", "trending",
  // Vietnamese — reel / memory noise
  "kỷ niệm", "memories", "trong ngày này",
  // English — suggested / recommended
  "suggested for you", "suggested reels", "suggested groups",
  "suggested events", "pages you might like", "videos you might like",
  "people you may know", "you might also like", "suggested",
  "recommended", "recommended for you", "on this day",
  "reels and short videos", "friend suggestions",
  // French/German/Spanish
  "suggéré pour vous", "vorgeschlagen", "sugerido para ti",
  "recommandé pour vous", "empfohlen", "recomendado",
];

const CLUTTER_STOP_ROLES = new Set(["complementary", "banner", "navigation", "dialog"]);

// These are Facebook recommendation shelves, not feed posts. Their group-card
// artwork often contains copy such as "Tham gia nhóm để nhận…", which must
// never be evaluated as engagement bait.
const FB_GROUP_SUGGESTION_LABELS = new Set([
  "gợi ý nhóm",
  "nhóm gợi ý",
  "suggested groups",
  "groups you might like",
  "groups you should join",
]);

let _lastExtractedImages = [];

let hiddenClutterCount = 0;

const SEE_MORE = SEE_MORE_KEYWORDS[SITE] || SEE_MORE_KEYWORDS.other;

const fbAllPostInjected = new WeakSet();

// Cache for performance optimization
const _permalinkCache = new WeakMap(); // container → { url, quality, timestamp }
const _authorCache = new WeakMap(); // container → { name, timestamp }
const _metaCache = new WeakMap(); // container → { permalink, author, source, quality, timestamp }
const _containerCache = new WeakMap(); // element → container
const _sharedPostCache = new WeakMap(); // container → sharedArticle
const CACHE_TTL = 90000; // 90s — FB virtualizes posts; slightly longer cache cuts rescans

// Author-name noise (actions, UI chrome, not people/pages)
const AUTHOR_NOISE_RE = /^(sponsored|được tài trợ|quảng cáo|follow|theo dõi|following|đang theo dõi|like|thích|share|chia sẻ|comment|bình luận|reply|trả lời|see more|xem thêm|join|tham gia|message|nhắn tin|add friend|thêm bạn bè|suggested for you|gợi ý cho bạn)$/i;

function _findPostContainer(element) {
  if (!element) return null;
  if (_containerCache.has(element)) {
    return _containerCache.get(element);
  }

  let p = element;
  for (let i = 0; i < 30; i++) {
    if (!p || p === document.body) break;
    const role = p.getAttribute?.("role") || "";
    const pagelet = p.getAttribute?.("data-pagelet") || "";
    if (
      role === "article" ||
      p.hasAttribute?.("data-virtualized") ||
      (pagelet && pagelet.startsWith("FeedUnit"))
    ) {
      _containerCache.set(element, p);
      return p;
    }
    p = p.parentElement;
  }

  _containerCache.set(element, null);
  return null;
}

/**
 * Bare photo shells like https://www.facebook.com/photo/ (no fbid/set).
 * FB injects these on image posts; they are NOT post permalinks.
 */
function _isBareFbPhotoShell(href) {
  if (!href || typeof href !== "string") return false;
  try {
    const u = new URL(href, location.origin);
    if (!/facebook\.com/i.test(u.hostname)) return false;
    const path = u.pathname.replace(/\/+$/, "") || "/";
    // /photo or /photo/ without identity query
    if (/^\/photo$/i.test(path)) {
      const fbid = u.searchParams.get("fbid");
      const set = u.searchParams.get("set");
      if (!fbid && !set) return true;
      // fbid present but empty / non-numeric
      if (fbid != null && !/^\d{6,}$/.test(fbid)) return true;
    }
    // /photos/ without album/photo id segment
    if (/^\/photos$/i.test(path)) return true;
    if (/^\/photo\.php$/i.test(path) && !u.searchParams.get("fbid")) return true;
    return false;
  } catch (_) {
    return false;
  }
}

/** Photo/media URL that actually points at a specific asset (has fbid/set/id). */
function _isUsableFbPhotoPermalink(href) {
  if (!href || _isBareFbPhotoShell(href)) return false;
  try {
    const u = new URL(href, location.origin);
    if (!/facebook\.com/i.test(u.hostname)) return false;
    const p = u.pathname + u.search;
    if (u.searchParams.get("fbid") && /^\d{6,}$/.test(u.searchParams.get("fbid"))) return true;
    if (u.searchParams.get("set") && /[a-z0-9.]/i.test(u.searchParams.get("set"))) return true;
    // /user/photos/a.ALBUM/PHOTO_ID or /photos/pcb..../ID
    if (/\/photos\/[^/?#]+\/\d{6,}/i.test(p)) return true;
    if (/\/photo\.php\?/i.test(p) && u.searchParams.get("fbid")) return true;
    return false;
  } catch (_) {
    return false;
  }
}

/** True post permalink (not profile shell, not bare /photo/). */
function _isStrongFbPermalink(href) {
  if (!href || typeof href !== "string") return false;
  if (_isBareFbPhotoShell(href)) return false;
  try {
    const u = new URL(href, location.origin);
    if (!/facebook\.com|fb\.watch|fb\.com/i.test(u.hostname)) return false;
    const p = u.pathname + u.search;
    // Prefer true post identity patterns
    if (
      /\/posts\//i.test(p) ||
      /\/permalink\/?/i.test(p) ||
      /story_fbid=/i.test(p) ||
      /multi_permalinks=/i.test(p) ||
      /pfbid[0-9A-Za-z]/i.test(p) ||
      /\/reel\//i.test(p) ||
      /\/videos\/\d+/i.test(p) ||
      /\/watch\/?\?/i.test(p) ||
      /story\.php/i.test(p) ||
      /\/groups\/[^/]+\/posts\//i.test(p) ||
      /\/groups\/[^/]+\/permalink\//i.test(p)
    ) {
      return true;
    }
    // Media with real fbid is "usable" but weaker — still strong enough to open
    if (_isUsableFbPhotoPermalink(href)) return true;
    return false;
  } catch (_) {
    return false;
  }
}

/** True if URL is only a group/page/profile/photo shell (weak fallback). */
function _isWeakFbShellUrl(href) {
  if (!href) return true;
  if (_isBareFbPhotoShell(href)) return true;
  if (_isStrongFbPermalink(href)) return false;
  try {
    const u = new URL(href, location.origin);
    const path = u.pathname.replace(/\/$/, "");
    // group home, bare profile, page home, bare photo
    if (/^\/groups\/[^/]+$/i.test(path)) return true;
    if (/^\/profile\.php$/i.test(path) && !u.searchParams.get("story_fbid")) return true;
    if (/^\/photo$/i.test(path)) return true;
    if (/^\/[^/]+$/i.test(path) && !/posts|permalink|reel|videos|watch|photos?/i.test(path)) return true;
    return false;
  } catch (_) {
    return true;
  }
}

/** Rank family for sorting: higher = better post identity */
function _permalinkFamilyRank(href) {
  if (!href || _isBareFbPhotoShell(href)) return 0;
  if (/\/posts\/(pfbid|\d)/i.test(href) || /\/groups\/[^/]+\/posts\//i.test(href)) return 100;
  if (/pfbid[0-9A-Za-z]+/i.test(href)) return 95;
  if (/\/permalink|story_fbid=|multi_permalinks=|story\.php/i.test(href)) return 90;
  if (/\/reel\/|\/videos\/\d+|\/watch/i.test(href)) return 80;
  if (_isUsableFbPhotoPermalink(href)) return 40; // media only — last resort
  return 10;
}

function findFeedWrapper(el) {
  let cur = el;
  let found = null;
  for (let i = 0; i < 30; i++) {
    const parent = cur.parentElement;
    if (!parent || parent === document.body) break;
    const role = parent.getAttribute("role") || "";
    if (CLUTTER_STOP_ROLES.has(role)) break; // sidebar/nav — wrong area
    // Prefer the outermost virtualized/article unit so we never hide only the
    // status/media slice while author header + engagement bar stay visible.
    if (parent.hasAttribute("data-virtualized")) found = parent;
    if (role === "feed") {
      found = found || cur;
      break;
    }
    if (role === "article") {
      const pRole = (parent.parentElement?.getAttribute("role")) || "";
      if (pRole === "feed" || pRole === "article") found = parent;
    }
    cur = parent;
  }
  if (!found) return null;
  return _expandToFullPostCard(found) || found;
}

/** True when a node has status/media but not author chrome or engagement bar. */
function _isContentOnlyPostSlice(el) {
  if (!el || !el.querySelector) return false;
  const hasMessage = !!el.querySelector(
    '[data-ad-rendering-role="story_message"], [data-ad-preview="message"], [data-ad-comet-preview="message"], [data-testid="post_message"]',
  );
  if (!hasMessage) return false;
  const hasProfile = !!el.querySelector('[data-ad-rendering-role="profile_name"]');
  const hasEngage = !!el.querySelector(
    '[data-ad-rendering-role="like_button"], [data-ad-rendering-role="comment_button"], [aria-label="Thích"], [aria-label="Like"], [aria-label="Viết bình luận"], [aria-label="Write a comment"]',
  );
  return !hasProfile && !hasEngage;
}

/**
 * Climb to the full feed card (header + body + actions) when given a
 * content-only slice. Stops before feed/main/layout columns.
 */
function _expandToFullPostCard(el) {
  let cur = el;
  for (let i = 0; i < 8 && cur; i++) {
    if (!_isContentOnlyPostSlice(cur)) return cur;
    const par = cur.parentElement;
    if (!par || (typeof _isFbLayoutColumn === "function" && _isFbLayoutColumn(par))) {
      return cur;
    }
    const role = par.getAttribute("role") || "";
    if (role === "feed" || role === "main") return cur;
    // Parent must still look like the same post (owns author or actions).
    if (
      !par.querySelector?.(
        '[data-ad-rendering-role="profile_name"], [data-ad-rendering-role="like_button"], [aria-label="Thích"], [aria-label="Like"]',
      )
    ) {
      return cur;
    }
    cur = par;
  }
  return cur;
}

function _isFacebookGroupSuggestionContainer(element) {
  if (SITE !== "facebook" || !element) return false;
  const container = findFeedWrapper(element) || element;
  let node = container;
  for (let i = 0; i < 4 && node; i++, node = node.parentElement) {
    const pagelet = (node.getAttribute?.("data-pagelet") || "").toLowerCase();
    if (/groups.*(?:suggest|recommend|shouldjoin)|(?:suggest|recommend).*groups/.test(pagelet)) {
      return true;
    }
  }
  const labels = container.querySelectorAll?.(
    "h1, h2, h3, h4, [role='heading'], [aria-label], span[dir='auto'], div[dir='auto']",
  ) || [];
  for (let i = 0; i < Math.min(labels.length, 40); i++) {
    const label = (labels[i].innerText || labels[i].textContent || labels[i].getAttribute?.("aria-label") || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (FB_GROUP_SUGGESTION_LABELS.has(label)) return true;
  }
  return false;
}

function isSponsored(el) {
  if (SITE !== "facebook") return false;
  const container =
    findFeedWrapper(el) ||
    (el.getAttribute && el.getAttribute("role") === "article"
      ? el
      : _findPostContainer(el));
  if (!container) return false;
  return detectSponsoredSignals(container).isSponsored;
}

function isInNonPostArea(el) {
  let p = el;
  for (let i = 0; i < 20; i++) {
    p = p.parentElement;
    if (!p || p === document.body) return false;
    const role = p.getAttribute("role") || "";
    if (["navigation", "banner", "dialog", "complementary"].includes(role))
      return true;
    // Skip comment areas on Facebook.
    // Old FB structure: post=article, comment=article inside post (1 ancestor article = comment).
    // New FB structure: feed=article, post=article inside feed, comment=article inside post.
    // Now need 2+ ancestor articles to be a comment (post has 1 ancestor article = feed container).
    if (SITE === "facebook" && role === "article") {
      let articleAncestors = 0;
      let ancestor = p.parentElement;
      for (let j = 0; j < 15; j++) {
        if (!ancestor || ancestor === document.body) break;
        if (ancestor.getAttribute("role") === "article") articleAncestors++;
        ancestor = ancestor.parentElement;
      }
      if (articleAncestors >= 2) return true; // deeply nested = comment/reply
    }
    // Only check computed style for elements that might be fixed/sticky (cheaper than always calling getComputedStyle)
    if (p.style.position === "fixed" || p.style.position === "sticky")
      return true;
    if (p.classList.contains("fixed") || p.classList.contains("sticky"))
      return true;
  }
  return false;
}

function _findSharedPostArticle(postContainer) {
  if (!postContainer) return null;

  // Virtualized/FeedUnit wrappers often contain one top-level role=article.
  // Treat that node as the post root rather than mistaking it for a share.
  let articleRoot = postContainer;
  if (postContainer.getAttribute?.("role") !== "article") {
    const articles = Array.from(postContainer.querySelectorAll('[role="article"]'));
    const topArticle = articles.find((article) => {
      const parentArticle = article.parentElement?.closest?.('[role="article"]');
      return !parentArticle || !postContainer.contains(parentArticle);
    });
    if (topArticle) articleRoot = topArticle;
  }

  // Method 1: Look for nested article with own header
  const nestedArticles = articleRoot.querySelectorAll('[role="article"]');
  for (const nested of nestedArticles) {
    if (nested === articleRoot) continue;

    // Must be a direct nested article of this post. `nested.closest()` returns
    // the node itself, so start from its parent to avoid accepting comments or
    // a deeper article inside another embedded unit.
    const parentArticle = nested.parentElement?.closest?.('[role="article"]');
    if (parentArticle && parentArticle !== articleRoot) continue;

    // Skip comments
    if (_fbIsCommentArticle(nested, articleRoot)) continue;

    // Skip list items (reactions, comments list)
    let el = nested.parentElement;
    let isInList = false;
    for (let i = 0; i < 10 && el && el !== articleRoot; i++) {
      const role = (el.getAttribute("role") || "").toLowerCase();
      if (role === "list" || role === "listitem" || el.tagName === "UL") {
        isInList = true;
        break;
      }
      el = el.parentElement;
    }
    if (isInList) continue;

    // Must have own header with link
    const headers = nested.querySelectorAll("h2, h3, h4");
    for (const h of headers) {
      if (h.closest('[role="article"]') !== nested) continue;
      if (h.querySelector("a[href]")) return nested;
    }
  }

  // Method 2: Look for "shared a post" text
  const allText = articleRoot.innerText || articleRoot.textContent || "";
  const sharedPatterns = [
    "shared a post", "chia sẻ bài viết", "đã chia sẻ",
    "shared a memory", "chia sẻ kỷ niệm",
    "shared a video", "chia sẻ video",
    "shared a reel", "chia sẻ reel"
  ];
  const hasSharedText = sharedPatterns.some(p =>
    allText.toLowerCase().includes(p.toLowerCase())
  );

  if (hasSharedText) {
    // Find the nested article after "shared" text
    const nestedArticles = articleRoot.querySelectorAll('[role="article"]');
    if (nestedArticles.length > 1) {
      return nestedArticles[1]; // Second article is usually the shared content
    }
  }

  return null;
}

function _cleanFbUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    let href = _resolveFbRedirect(rawUrl);
    // Normalize mobile / web hosts to www for stable copy
    href = href
      .replace(/^https?:\/\/m\.facebook\.com/i, "https://www.facebook.com")
      .replace(/^https?:\/\/mobile\.facebook\.com/i, "https://www.facebook.com")
      .replace(/^https?:\/\/web\.facebook\.com/i, "https://www.facebook.com")
      .replace(/^https?:\/\/facebook\.com/i, "https://www.facebook.com");

    const u = new URL(href);
    // Canonicalize classic story.php → /id/posts/fbid when possible
    if (u.pathname.includes("story.php")) {
      const sfid = u.searchParams.get("story_fbid");
      const uid = u.searchParams.get("id");
      if (sfid && uid) {
        return "https://www.facebook.com/" + uid + "/posts/" + sfid;
      }
    }
    // multi_permalinks in group → /groups/X/posts/ID
    const mp = u.searchParams.get("multi_permalinks");
    if (mp && /\/groups\//i.test(u.pathname)) {
      return u.origin + u.pathname.replace(/\/$/, "") + "/posts/" + mp;
    }

    const TRACKING_PARAMS = [
      "fbclid", "ref", "comment_id", "reply_comment_id",
      "notif_id", "notif_t", "mibextid", "_rdr", "_rdc", "rdid", "share_scenario",
      "hoisted_section_header_type", "refid", "paipv", "eav", "extid",
      "fs", "ffn", "comment_tracking", "acontext", "hc_location",
    ];
    // Keep identity params needed for valid permalinks
    const KEEP = new Set([
      "story_fbid", "id", "multi_permalinks", "v", "set", "theater", "fbid",
    ]);
    for (const k of [...u.searchParams.keys()]) {
      if (KEEP.has(k)) continue;
      if (k.startsWith("__") || k.startsWith("utm_") || TRACKING_PARAMS.includes(k)) {
        u.searchParams.delete(k);
      }
    }
    // Drop empty query
    const qs = u.searchParams.toString();
    const clean = qs
      ? u.origin + u.pathname + "?" + qs
      : u.origin + u.pathname;
    return clean.replace(/\/$/, "");
  } catch (_) {
    return rawUrl;
  }
}

function _resolveFbRedirect(rawUrl) {
  if (!rawUrl) return "";
  try {
    if (
      rawUrl.includes("l.facebook.com/l.php") ||
      rawUrl.includes("lm.facebook.com/l.php") ||
      rawUrl.includes("l.facebook.com/l.php")
    ) {
      const u = new URL(rawUrl);
      const target = u.searchParams.get("u");
      if (target) return decodeURIComponent(target);
    }
  } catch (_) {}
  return rawUrl;
}

/** Extract Facebook post/story ID from a container using many signals. */
function _extractPostIdFromContainer(container) {
  if (!container) return null;
  const seen = new Set();
  const pushId = (id) => {
    if (!id) return null;
    const s = String(id);
    // FB post IDs are typically 10–20 digits; pfbid is alphanumeric
    if (/^\d{10,22}$/.test(s) || /^pfbid[0-9A-Za-z]{10,}$/.test(s)) {
      if (!seen.has(s)) {
        seen.add(s);
        return s;
      }
    }
    return null;
  };

  // Method 1: data-ft (legacy m-site / old desktop)
  const dataFtEl = container.querySelector("[data-ft]");
  if (dataFtEl) {
    try {
      const ft = JSON.parse(dataFtEl.getAttribute("data-ft"));
      const id =
        pushId(ft.top_level_post_id) ||
        pushId(ft.mf_story_key) ||
        pushId(ft.page_id && ft.top_level_post_id) ||
        pushId(ft.content_owner_id_new && ft.top_level_post_id);
      if (ft.top_level_post_id && pushId(ft.top_level_post_id)) return String(ft.top_level_post_id);
      if (ft.mf_story_key && pushId(ft.mf_story_key)) return String(ft.mf_story_key);
    } catch (_) {}
  }

  // Method 2: explicit data attributes on container and nearby
  const attrNames = [
    "data-story-id", "data-post-id", "data-ft", "data-testid",
    "data-store", "id", "ajaxify",
  ];
  for (const attr of attrNames) {
    const val = container.getAttribute?.(attr);
    if (!val) continue;
    const m =
      val.match(/pfbid[0-9A-Za-z]+/) ||
      val.match(/(?:story_fbid|post_id|top_level_post_id|mf_story_key)["':=\s]+(\d{10,22})/i) ||
      val.match(/(\d{15,22})/);
    if (m) {
      const id = pushId(m[1] || m[0]);
      if (id) return id;
    }
  }

  // Method 3: scan limited set of child data-* (cap to avoid O(n) blowup)
  const dataNodes = container.querySelectorAll(
    "[data-ft], [data-store], [data-testid*='post'], [data-testid*='story'], [id*='mall_post'], [id*='feed_subtitle']"
  );
  for (let i = 0; i < Math.min(dataNodes.length, 40); i++) {
    const el = dataNodes[i];
    for (const attr of el.attributes) {
      if (!attr.name.startsWith("data-") && attr.name !== "id") continue;
      const m =
        attr.value.match(/pfbid[0-9A-Za-z]+/) ||
        attr.value.match(/(\d{15,22})/);
      if (m) {
        const id = pushId(m[1] || m[0]);
        if (id) return id;
      }
    }
  }

  // Method 4: hidden inputs
  const hiddenInputs = container.querySelectorAll("input[type='hidden']");
  for (let i = 0; i < Math.min(hiddenInputs.length, 30); i++) {
    const val = hiddenInputs[i].value || "";
    const m = val.match(/pfbid[0-9A-Za-z]+/) || val.match(/(\d{15,22})/);
    if (m) {
      const id = pushId(m[1] || m[0]);
      if (id) return id;
    }
  }

  // Method 5: href fragments already on links (pfbid / numeric posts)
  const links = container.querySelectorAll("a[href]");
  for (let i = 0; i < Math.min(links.length, 80); i++) {
    const href = links[i].href || "";
    const m =
      href.match(/\/posts\/(pfbid[0-9A-Za-z]+|\d{10,22})/i) ||
      href.match(/story_fbid=(\d{10,22})/i) ||
      href.match(/multi_permalinks=(\d{10,22})/i) ||
      href.match(/\/permalink\/(\d{10,22})/i) ||
      href.match(/[?&]fbid=(\d{10,22})/i);
    if (m) {
      const id = pushId(m[1]);
      if (id) return id;
    }
  }

  // Method 6: aria-describedby / labelledby portals often encode story keys
  const idSources = [
    container.getAttribute("aria-describedby"),
    container.getAttribute("aria-labelledby"),
    container.id,
  ]
    .filter(Boolean)
    .join(" ");
  const idMatch = idSources.match(/(\d{10,22})/);
  if (idMatch && pushId(idMatch[1])) return idMatch[1];

  // Method 7: lightweight text scrape of serialized Relay blobs inside the unit
  // Cap length — only first 8KB of outerHTML to stay cheap
  try {
    const html = (container.outerHTML || "").slice(0, 8000);
    const blobMatch =
      html.match(/"post_id"\s*:\s*"?(\d{10,22})"?/) ||
      html.match(/"legacy_fbid"\s*:\s*"?(\d{10,22})"?/) ||
      html.match(/"story_fbid"\s*:\s*"?(\d{10,22})"?/) ||
      html.match(/"top_level_post_id"\s*:\s*"?(\d{10,22})"?/) ||
      html.match(/\/posts\/(pfbid[0-9A-Za-z]+)/);
    if (blobMatch) {
      const id = pushId(blobMatch[1]);
      if (id) return id;
    }
  } catch (_) {}

  return null;
}

/** Relative/absolute post-time labels used next to author name ("1 giờ", "2 h", …). */
const FB_TIME_TEXT_RE =
  /^(?:\d+\s*(?:giờ|phút|ngày|giây|tháng|năm|tuần|h|g|m|d|w|s|hr|hrs|min|mins|sec|secs|hour|hours|minute|minutes|day|days|week|weeks|month|months|year|years|mo|yr)s?|(?:hôm\s*qua|hôm\s*kia|vừa\s*xong|just\s*now|yesterday|now|a\s*few\s*seconds|vài\s*giây)|(?:\d{1,2}\s*(?:thg|tháng|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z.]*\s*\d{0,4}))$/i;

const FB_TIME_LOOSE_RE =
  /\b\d+\s*(?:giờ|phút|ngày|giây|tháng|năm|tuần|hour|minute|day|week|month|year|hr|min|sec)s?\b/i;

function _normalizeFbHref(raw) {
  if (!raw || typeof raw !== "string") return "";
  let href = raw.trim();
  if (!href || href === "#" || href.startsWith("javascript:") || href.startsWith("mailto:")) return "";
  // FB sometimes puts only the path: /user/posts/pfbid…
  try {
    href = _resolveFbRedirect(href);
    const abs = new URL(href, location.origin).href;
    if (!/facebook\.com|fb\.watch|fb\.com/i.test(new URL(abs).hostname)) return "";
    return abs;
  } catch (_) {
    return "";
  }
}

function _isTimestampText(raw) {
  if (!raw) return false;
  const t = String(raw).replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 56) return false;
  if (FB_TIME_TEXT_RE.test(t)) return true;
  // Aria-label often full: "Friday, July 24 at 3:15 PM"
  if (
    /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|thứ|tháng|at\s+\d{1,2}:\d{2}|lúc\s+\d)/i.test(t) &&
    t.length < 80
  ) {
    return true;
  }
  return false;
}

function _isTimestampLink(link) {
  if (!link) return false;
  const text = (link.innerText || link.textContent || "").trim();
  const aria = (link.getAttribute("aria-label") || "").trim();
  const title = (link.getAttribute("title") || "").trim();
  if (_isTimestampText(text) || _isTimestampText(aria) || _isTimestampText(title)) return true;
  // Nested visible time (FB wraps "1 giờ" in deep spans)
  if (text.length <= 40 && FB_TIME_LOOSE_RE.test(text) && text.split(/\s+/).length <= 6) return true;
  if (link.querySelector("abbr[data-utime], time[datetime], abbr[title]")) return true;
  return false;
}

function _scorePermalinkHref(href, link) {
  if (!href) return -1;
  href = _normalizeFbHref(href);
  if (!href) return -1;

  // Hard excludes — bare /photo/ is the #1 false positive on image posts
  if (_isBareFbPhotoShell(href)) return -1;
  if (
    /\/hashtag\//i.test(href) ||
    /\/events\//i.test(href) ||
    /\/marketplace\//i.test(href) ||
    /\/policies\//i.test(href) ||
    /\/help\//i.test(href) ||
    /\/watch\/live/i.test(href) ||
    /\/sharer/i.test(href) ||
    /\/dialog\//i.test(href) ||
    /\/friends\//i.test(href) ||
    /\/messages\//i.test(href) ||
    href === "https://www.facebook.com/" ||
    href === "https://www.facebook.com"
  ) {
    return -1;
  }

  let score = 0;
  let isPhotoMedia = false;
  if (/\/posts\/(pfbid|\d)/i.test(href)) score += 100;
  else if (/\/groups\/[^/]+\/posts\//i.test(href)) score += 100;
  else if (/\/groups\/[^/]+\/permalink\//i.test(href)) score += 98;
  else if (/\/permalink\/?/i.test(href)) score += 95;
  else if (/story_fbid=/i.test(href)) score += 95;
  else if (/multi_permalinks=/i.test(href)) score += 95;
  else if (/pfbid[0-9A-Za-z]+/i.test(href)) score += 92;
  else if (/\/reel\//i.test(href)) score += 90;
  else if (/\/videos\/\d+/i.test(href)) score += 88;
  else if (/story\.php/i.test(href)) score += 88;
  else if (/\/watch\/?\?/i.test(href) || /[?&]v=\d+/i.test(href)) score += 85;
  else if (_isUsableFbPhotoPermalink(href)) {
    // Media asset link — usable but NEVER above real /posts/ or pfbid
    score += 48;
    isPhotoMedia = true;
  } else if (/\/photos?\//i.test(href) || /\/photo\.php/i.test(href)) {
    // Any other photo-ish path without fbid → reject
    return -1;
  } else if (/\/stories\//i.test(href)) score += 60;

  // Timestamp chip next to author carries the real post id on modern FB.
  // Do NOT give photo-media the full timestamp bonus — image <a> often sits
  // near the time row and was winning over /posts/ + pfbid.
  if (link && _isTimestampLink(link)) {
    score += isPhotoMedia ? 8 : 55;
  }

  try {
    const u = new URL(href);
    if (u.pathname.split("/").filter(Boolean).length >= 2) score += 5;
    if (u.searchParams.has("comment_id")) score -= 20;
  } catch (_) {}

  // Family rank tie-break baked into score
  score += _permalinkFamilyRank(href) * 0.01;

  return score;
}

/**
 * Find the post-time control ("1 giờ") near the author header and extract its href.
 * This is the most reliable DOM signal on current Facebook feeds.
 */
function _findTimestampPermalink(container) {
  if (!container) return "";

  // Explicit strong POST urls (never photo shells)
  const strongSel =
    'a[href*="/posts/"], a[href*="pfbid"], a[href*="story_fbid"], a[href*="/permalink"], a[href*="multi_permalinks"], a[href*="story.php"]';
  const strongLinks = container.querySelectorAll(strongSel);
  const accept = (href) =>
    href &&
    !_isBareFbPhotoShell(href) &&
    _isStrongFbPermalink(href) &&
    _permalinkFamilyRank(href) >= 80 &&
    !/comment_id=/i.test(href);

  for (let i = 0; i < Math.min(strongLinks.length, 30); i++) {
    const a = strongLinks[i];
    const href = _normalizeFbHref(a.href || a.getAttribute("href") || "");
    if (!accept(href)) continue;
    if (_isTimestampLink(a) || _isInPostHeader(a, container)) {
      return _cleanFbUrl(href);
    }
  }
  for (let i = 0; i < Math.min(strongLinks.length, 30); i++) {
    const href = _normalizeFbHref(strongLinks[i].href || strongLinks[i].getAttribute("href") || "");
    if (accept(href)) return _cleanFbUrl(href);
  }

  // Walk anchors + role=link; match time text on self or descendants
  const anchors = container.querySelectorAll("a[href], a[role='link'], [role='link'][href], span[role='link']");
  for (let i = 0; i < Math.min(anchors.length, 120); i++) {
    const el = anchors[i];
    if (!_isTimestampLink(el) && !_looksLikeTimeChip(el)) continue;
    const href = _hrefFromTimeControl(el);
    // Time chip must resolve to post identity, not /photo/
    if (accept(href)) return _cleanFbUrl(href);
  }

  // Text-node / span walk: find "1 giờ" then climb to nearest link
  const spans = container.querySelectorAll("span, a, div[role='button']");
  for (let i = 0; i < Math.min(spans.length, 200); i++) {
    const el = spans[i];
    const raw = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    if (!raw || raw.length > 24) continue;
    if (!_isTimestampText(raw) && !FB_TIME_TEXT_RE.test(raw)) continue;
    const href = _hrefFromTimeControl(el);
    if (accept(href)) return _cleanFbUrl(href);
  }

  // <abbr data-utime> / <time>
  const timeNodes = container.querySelectorAll("abbr[data-utime], time[datetime], abbr[title]");
  for (let i = 0; i < Math.min(timeNodes.length, 16); i++) {
    const href = _hrefFromTimeControl(timeNodes[i]);
    if (accept(href)) return _cleanFbUrl(href);
  }

  return "";
}

function _looksLikeTimeChip(el) {
  if (!el) return false;
  const t = (el.innerText || "").replace(/\s+/g, " ").trim();
  if (t && t.length <= 20 && FB_TIME_TEXT_RE.test(t)) return true;
  // Globe + time row: parent often has both "1 giờ" and public icon
  const parent = el.parentElement;
  if (parent) {
    const pt = (parent.innerText || "").replace(/\s+/g, " ").trim();
    if (pt.length <= 40 && FB_TIME_LOOSE_RE.test(pt)) return true;
  }
  return false;
}

function _isInPostHeader(el, container) {
  if (!el || !container) return false;
  // Near first h2/h3 or within first ~20% of post height
  const header = container.querySelector("h2, h3, h4, strong");
  if (header) {
    const zone = header.closest("div") || header.parentElement;
    if (zone && zone.contains(el)) return true;
  }
  try {
    const cRect = container.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (cRect.height > 0 && r.top - cRect.top < Math.min(220, cRect.height * 0.35)) return true;
  } catch (_) {}
  return false;
}

/** Climb/descend from a time chip to a usable facebook href. */
function _hrefFromTimeControl(el) {
  if (!el) return "";
  const isGood = (h) =>
    h && !_isBareFbPhotoShell(h) && _permalinkFamilyRank(h) >= 80;

  // Self
  let href = _normalizeFbHref(el.href || el.getAttribute?.("href") || "");
  if (isGood(href)) return href;
  // Keep non-photo self href for later scoring only if not bare photo
  const selfHref = href && !_isBareFbPhotoShell(href) ? href : "";

  // Closest anchor up — prefer post family
  const up = el.closest?.("a[href], [role='link'][href]");
  if (up) {
    href = _normalizeFbHref(up.href || up.getAttribute("href") || "");
    if (isGood(href)) return href;
  }

  // Descendant: prefer /posts/ or pfbid first
  const downStrong = el.querySelector?.(
    'a[href*="/posts/"], a[href*="pfbid"], a[href*="story_fbid"], a[href*="/permalink"], a[href*="story.php"]',
  );
  if (downStrong) {
    href = _normalizeFbHref(downStrong.href || downStrong.getAttribute("href") || "");
    if (isGood(href)) return href;
  }
  const down = el.querySelector?.("a[href], [href*='facebook.com']");
  if (down) {
    href = _normalizeFbHref(down.href || down.getAttribute("href") || "");
    if (isGood(href)) return href;
  }

  // Sibling link (structure: [author][time as sibling link])
  const prev = el.previousElementSibling;
  const next = el.nextElementSibling;
  for (const sib of [prev, next]) {
    if (!sib) continue;
    const a = sib.tagName === "A" ? sib : sib.querySelector?.("a[href]");
    if (a) {
      href = _normalizeFbHref(a.href || a.getAttribute("href") || "");
      if (isGood(href)) return href;
    }
  }

  // Parent row of links — collect best by family rank
  let p = el.parentElement;
  let best = "";
  let bestRank = 0;
  for (let i = 0; i < 6 && p; i++) {
    const anchors = p.querySelectorAll("a[href]");
    for (const a of anchors) {
      href = _normalizeFbHref(a.href || a.getAttribute("href") || "");
      if (!href || _isBareFbPhotoShell(href)) continue;
      const rank = _permalinkFamilyRank(href);
      if (rank > bestRank) {
        bestRank = rank;
        best = href;
      }
    }
    if (bestRank >= 80) return best;
    p = p.parentElement;
  }
  if (bestRank >= 80) return best;
  // Do not return bare photo / weak self
  return selfHref && isGood(selfHref) ? selfHref : bestRank >= 40 ? best : "";
}

/**
 * Find best permalink inside a post container.
 * Returns { url, quality: "exact"|"constructed"|"shell"|"", reason }
 */
function _findPermalinkResultInContainer(container) {
  if (!container) return { url: "", quality: "", reason: "" };

  const cached = _permalinkCache.get(container);
  // Only reuse strong cache hits — never cache-lock empty/shell forever
  if (
    cached &&
    Date.now() - cached.timestamp < CACHE_TTL &&
    cached.quality === "exact" &&
    cached.url
  ) {
    return { url: cached.url, quality: cached.quality || "", reason: cached.reason || "cache" };
  }

  const store = (url, quality, reason) => {
    const cleaned = url ? _cleanFbUrl(url) : "";
    // Avoid caching weak results for long — allow Share path to re-try
    if (quality === "exact" || quality === "constructed") {
      _permalinkCache.set(container, {
        url: cleaned,
        quality,
        reason,
        timestamp: Date.now(),
      });
    }
    return { url: cleaned, quality, reason };
  };

  // === PRIORITY 0: Timestamp / header post link ("1 giờ") ===
  // Reject bare /photo/ shells even if they sit on the time chip.
  const fromTime = _findTimestampPermalink(container);
  if (
    fromTime &&
    _isStrongFbPermalink(fromTime) &&
    !_isBareFbPhotoShell(fromTime) &&
    _permalinkFamilyRank(fromTime) >= 80
  ) {
    return store(fromTime, "exact", "timestamp_header");
  }
  // Timestamp resolved only a photo — keep scanning for real /posts/

  const allLinks = container.querySelectorAll("a[href], [role='link'][href], a[role='link']");
  const candidates = [];

  for (let i = 0; i < allLinks.length; i++) {
    const link = allLinks[i];
    let href = _normalizeFbHref(link.href || link.getAttribute?.("href") || "");
    if (!href || _isBareFbPhotoShell(href)) continue;
    const score = _scorePermalinkHref(href, link);
    if (score < 50) continue;
    candidates.push({
      href,
      score,
      family: _permalinkFamilyRank(href),
      reason: _isTimestampLink(link) ? "timestamp" : score >= 90 ? "strong_pattern" : "candidate",
    });
  }

  // <abbr data-utime> / <time>
  const timeNodes = container.querySelectorAll("abbr[data-utime], time[datetime], abbr[title]");
  for (let i = 0; i < Math.min(timeNodes.length, 12); i++) {
    const href = _hrefFromTimeControl(timeNodes[i]);
    if (!href || _isBareFbPhotoShell(href)) continue;
    const score = Math.max(_scorePermalinkHref(href, timeNodes[i].closest("a") || timeNodes[i]), 80);
    if (score >= 50) {
      candidates.push({
        href,
        score,
        family: _permalinkFamilyRank(href),
        reason: "time_node",
      });
    }
  }

  if (candidates.length > 0) {
    // Prefer post-identity family, then raw score
    candidates.sort((a, b) => {
      if (b.family !== a.family) return b.family - a.family;
      return b.score - a.score;
    });
    // Prefer first non-photo if any strong post exists
    const bestPost = candidates.find((c) => c.family >= 80);
    const best = bestPost || candidates[0];
    if (best && !_isBareFbPhotoShell(best.href)) {
      if (best.family >= 80 && (best.score >= 70 || _isStrongFbPermalink(best.href))) {
        return store(best.href, "exact", best.reason);
      }
      // Photo-only post: accept usable fbid photo as constructed-quality media link
      if (best.family >= 40 && _isUsableFbPhotoPermalink(best.href) && best.score >= 48) {
        return store(best.href, "constructed", "photo_media");
      }
    }
  }

  // Construct from group/page + post id
  let groupId = "";
  let profilePath = "";
  let pageNumericId = "";
  for (let i = 0; i < allLinks.length; i++) {
    const href = allLinks[i].href || allLinks[i].getAttribute?.("href") || "";
    if (!groupId) {
      const gm = href.match(/facebook\.com\/groups\/([^\/?#]+)/i) || href.match(/^\/groups\/([^\/?#]+)/i);
      if (gm) groupId = gm[1];
    }
    if (!pageNumericId) {
      const pm = href.match(/facebook\.com\/pages\/[^\/]+\/(\d+)/i);
      if (pm) pageNumericId = pm[1];
    }
    if (!profilePath) {
      try {
        const u = new URL(href, location.origin);
        if (!u.hostname.includes("facebook.com")) continue;
        if (u.pathname.includes("profile.php") && u.searchParams.get("id")) {
          profilePath = u.searchParams.get("id");
        } else {
          const parts = u.pathname.split("/").filter(Boolean);
          if (
            parts.length === 1 &&
            !/^(groups|pages|watch|reel|events|marketplace|stories|photo|photos|videos|login|recover)$/i.test(parts[0])
          ) {
            profilePath = parts[0];
          } else if (parts[0] === "user" && parts[1]) {
            profilePath = parts[1];
          }
        }
      } catch (_) {}
    }
  }

  const postId = _extractPostIdFromContainer(container);
  if (postId) {
    if (groupId) {
      return store(
        "https://www.facebook.com/groups/" + groupId + "/posts/" + postId,
        "constructed",
        "group+postId"
      );
    }
    if (pageNumericId) {
      return store(
        "https://www.facebook.com/" + pageNumericId + "/posts/" + postId,
        "constructed",
        "page+postId"
      );
    }
    if (profilePath) {
      return store(
        "https://www.facebook.com/" + profilePath + "/posts/" + postId,
        "constructed",
        "profile+postId"
      );
    }
    if (/^\d{10,22}$/.test(postId)) {
      return store(
        "https://www.facebook.com/story.php?story_fbid=" + postId,
        "constructed",
        "story_fbid_only"
      );
    }
  }

  // Weak shell fallbacks
  if (groupId) {
    return store("https://www.facebook.com/groups/" + groupId, "shell", "group_home");
  }
  if (pageNumericId) {
    return store("https://www.facebook.com/" + pageNumericId, "shell", "page_home");
  }
  if (profilePath) {
    return store("https://www.facebook.com/" + profilePath, "shell", "profile_home");
  }

  return store("", "", "not_found");
}

function _findPermalinkInContainer(container) {
  return _findPermalinkResultInContainer(container).url;
}

function extractPostPermalink(element) {
  const url = location.href;
  if (SITE === "facebook") {
    // Single-post page → page URL is the source of truth
    if (_isStrongFbPermalink(url)) return _cleanFbUrl(url);
    if (!element) return "";

    const postContainer = _findPostContainer(element) || element;

    const usable = (r) =>
      r && r.url && !_isBareFbPhotoShell(r.url) && r.quality !== "shell";

    // Shared post → prefer original nested article
    const sharedInner = _findSharedPostArticle(postContainer);
    if (sharedInner) {
      const inner = _findPermalinkResultInContainer(sharedInner);
      if (usable(inner) && (inner.quality === "exact" || _permalinkFamilyRank(inner.url) >= 80)) {
        return inner.url;
      }
    }

    const direct = _findPermalinkResultInContainer(postContainer);
    if (usable(direct)) return direct.url;

    // Shared fallback (constructed ok, bare photo never)
    if (sharedInner) {
      const inner = _findPermalinkResultInContainer(sharedInner);
      if (usable(inner)) return inner.url;
    }
    return "";
  }

  // Non-Facebook platforms
  if (!element) return url;
  const postContainer = _findPostContainer(element);
  if (!postContainer) return url;
  const platformLinks = {
    threads: 'a[href*="/post/"]',
    x: 'a[href*="/status/"]',
    linkedin: 'a[href*="/feed/update/"]',
    reddit: 'a[href*="/comments/"]',
  };
  const selector = platformLinks[SITE];
  if (selector) {
    const link = postContainer.querySelector(selector);
    if (link && link.href) {
      try {
        return new URL(link.href).origin + new URL(link.href).pathname;
      } catch (_) {}
    }
  }
  return url;
}

/**
 * Rich metadata for composer UI: permalink quality + author + source.
 * quality: exact | constructed | shell | ""
 */
function extractPostMeta(element) {
  const empty = { permalink: "", author: "", source: "", quality: "", reason: "" };
  if (!element) return empty;

  const postContainer = _findPostContainer(element) || element;
  const cached = _metaCache.get(postContainer);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return {
      permalink: cached.permalink,
      author: cached.author,
      source: cached.source,
      quality: cached.quality,
      reason: cached.reason,
    };
  }

  let permalink = "";
  let quality = "";
  let reason = "";

  if (SITE === "facebook") {
    if (_isStrongFbPermalink(location.href)) {
      permalink = _cleanFbUrl(location.href);
      quality = "exact";
      reason = "page_url";
    } else {
      const sharedInner = _findSharedPostArticle(postContainer);
      if (sharedInner) {
        const inner = _findPermalinkResultInContainer(sharedInner);
        if (inner.url && inner.quality !== "shell") {
          permalink = inner.url;
          quality = inner.quality;
          reason = "shared:" + inner.reason;
        }
      }
      if (!permalink) {
        const direct = _findPermalinkResultInContainer(postContainer);
        permalink = direct.url;
        quality = direct.quality;
        reason = direct.reason;
      }
    }
  } else {
    permalink = extractPostPermalink(element);
    quality = permalink ? "exact" : "";
  }

  const author = extractPostAuthor(element);
  const source = extractPostSource(element);

  const result = { permalink, author, source, quality, reason };
  _metaCache.set(postContainer, { ...result, timestamp: Date.now() });
  return result;
}

function _isAvatar(img) {
    const w = img.naturalWidth || img.width || 0;
    const h = img.naturalHeight || img.height || 0;
    if (w > 0 && w === h && w <= 60) return true;
    try { if (getComputedStyle(img).borderRadius === "50%") return true; } catch (_) {}
    // Avatar thường trong link profile
    const parentLink = img.closest("a");
    if (parentLink) {
      const href = parentLink.href || "";
      // Profile pattern: /username hoặc /profile.php?id=
      if (href.includes("/profile.php") ||
          (href.includes("facebook.com") && /facebook\.com\/[^/?]+\/?$/.test(href) &&
           !href.includes("/posts/") && !href.includes("/photo") && !href.includes("/pages/"))) {
        return true;
      }
    }
    return false;
  }

function extractPostSource(element) {
  if (!element) return "";

  const postContainer = _findPostContainer(element);

  if (SITE === "facebook") {
    // 1. Nếu post là BÀI SHARE → source là nguồn bài gốc (group/page được share)
    const sharedInner = _findSharedPostArticle(postContainer);
    const containers = sharedInner ? [sharedInner, postContainer] : [postContainer];

    for (const container of containers) {
      // 2. Tìm pattern "Author › Group" hoặc "Author in Group"
      // trong header: nếu có ≥2 link trong h2/h3/h4 thì link thứ 2 thường là group/page
      const headers = container.querySelectorAll("h2, h3, h4");
      for (const h of headers) {
        // Header phải thuộc container này
        if (h.closest('[role="article"]') && h.closest('[role="article"]') !== container && container.getAttribute("role") === "article") continue;
        const links = h.querySelectorAll("a[href]");
        if (links.length >= 2) {
          for (let i = 1; i < links.length; i++) {
            const link = links[i];
            const href = link.href || "";
            const name = (link.innerText || link.textContent || "").trim();
            if (!_validateSourceName(name)) continue;
            // Chỉ lấy nếu link trỏ đến group hoặc page
            if (href.includes("/groups/") || href.match(/facebook\.com\/[^/?]+\/?$/)) {
              return name;
            }
          }
        }
      }

      // 3. Tìm direct group link trong container (trừ link avatar/author)
      const groupLinks = container.querySelectorAll('a[href*="/groups/"]');
      for (const link of groupLinks) {
        // Bỏ qua link rỗng / chỉ có ảnh
        const name = (link.innerText || link.textContent || "").trim();
        if (_validateSourceName(name)) {
          return name;
        }
      }
    }

    // 4. Fallback: nếu URL trang là group → lấy từ page title
    if (location.href.includes("/groups/")) {
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle && ogTitle.content) return ogTitle.content.trim();
    }
  }

  return "";
}

// Helper function: Validate source/group name
function _validateSourceName(name) {
  if (!name || name.length < 3 || name.length > 100) return false;

  // Reject hex strings (anti-scraping)
  if (/[a-f0-9]{10,}/i.test(name)) return false;

  // Reject long number sequences
  if (/\d{8,}/.test(name)) return false;

  // Reject pure numbers
  if (/^\d+$/.test(name)) return false;

  // Reject common noise patterns
  const noise = [
    "sponsored", "được tài trợ", "quảng cáo",
    "suggested for you", "gợi ý cho bạn",
    "recommended", "đề xuất"
  ];
  const lower = name.toLowerCase();
  if (noise.some(n => lower.includes(n))) return false;

  return true;
}

// Helper function: Validate author name
function _validateAuthorName(name) {
  if (!name || typeof name !== "string") return false;
  // Collapse FB zero-width / anti-scrape noise
  name = name
    .replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (name.length < 2 || name.length > 100) return false;

  // Reject hex strings (anti-scraping garbage) unless clearly Vietnamese text
  if (/[a-f0-9]{10,}/i.test(name) && !/[àáạảãâăèéẹẻẽêìíịỉĩòóọỏõôơùúụủũưỳýỵỷỹđ]/i.test(name)) {
    return false;
  }

  // Reject long number sequences
  if (/\d{8,}/.test(name)) return false;

  // Reject pure numbers / single punctuation
  if (/^[\d\W]+$/.test(name)) return false;

  // Reject too many words (sentence, not a name)
  if (name.split(/\s+/).length > 10) return false;

  if (AUTHOR_NOISE_RE.test(name)) return false;

  const lower = name.toLowerCase();
  const noiseSub = [
    "sponsored", "được tài trợ", "quảng cáo",
    "suggested for you", "gợi ý cho bạn",
    "recommended", "đề xuất", "see more", "xem thêm",
    "shared a", "đã chia sẻ", "is with", "cùng với",
  ];
  if (noiseSub.some((n) => lower === n || lower.startsWith(n + " "))) return false;

  return true;
}

function _fbCleanName(raw) {
  if (!raw) return "";
  return String(raw)
    .replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Facebook social-context cards (for example "Nope Pham đã bình luận gần
// đây." or the shorter "Trần Hồng Quân đã bình luận.") are neither a comment
// nor the post author. They use much of the same markup as headers/comments,
// so identify them from their complete text.
function _fbIsCommentActivityText(raw) {
  const text = _fbCleanName(raw);
  if (!text || text.length > 180) return false;
  return /^(?:.+?\s+)?(?:has\s+commented(?:\s+recently)?|have\s+commented(?:\s+recently)?|commented(?:\s+recently)?|(?:đã|vừa)\s+bình\s*luận(?:\s+gần\s*đây)?)[.!…]*$/i.test(text);
}

function _fbIsCommentActivityLink(link) {
  if (!link) return false;
  const header = link.closest?.("h2, h3, h4, [role='heading']");
  if (header && _fbIsCommentActivityText(header.innerText || header.textContent || "")) {
    return true;
  }
  let parent = link.parentElement;
  for (let i = 0; i < 3 && parent; i++, parent = parent.parentElement) {
    const text = parent.innerText || parent.textContent || "";
    if (text.length <= 180 && _fbIsCommentActivityText(text)) return true;
  }
  return false;
}

/** Profile-like Facebook href? */
function _fbIsProfileHref(href) {
  if (!href) return false;
  try {
    const u = new URL(href, location.origin);
    if (!/facebook\.com/i.test(u.hostname)) return false;
    const path = u.pathname.replace(/\/$/, "");
    if (/\/(posts|photos|photo|videos|reel|watch|permalink|groups|events|marketplace|stories|hashtag|pages)\b/i.test(path)) {
      if (/^\/user\/[^/]+$/i.test(path)) return true;
      return false;
    }
    if (path.includes("profile.php") && u.searchParams.get("id")) return true;
    if (/^\/[A-Za-z0-9.\-]+$/i.test(path)) return true;
    if (/^\/people\/[^/]+\/\d+$/i.test(path)) return true;
    return false;
  } catch (_) {
    return false;
  }
}

function _fbNameFromLink(link) {
  if (!link) return "";
  const aria = _fbCleanName(link.getAttribute("aria-label") || "");
  let fromAria = aria
    .replace(/\s*['']s profile$/i, "")
    .replace(/^Trang cá nhân của\s+/i, "")
    .replace(/^Profile of\s+/i, "")
    .trim();
  if (_validateAuthorName(fromAria) && fromAria.length < 80) return fromAria;

  const visible = _fbCleanName(link.innerText || "");
  if (_validateAuthorName(visible) && visible.length < 80) return visible;

  const dirSpan = link.querySelector('span[dir="auto"]');
  if (dirSpan) {
    const t = _fbCleanName(dirSpan.innerText || dirSpan.textContent || "");
    if (_validateAuthorName(t)) return t;
  }

  const fallback = _fbCleanName(link.textContent || "");
  if (_validateAuthorName(fallback) && fallback.length < 80) return fallback;
  return "";
}

// Extract a valid author name from the first profile-like <a> inside a header.
function _fbNameFromHeader(header) {
  if (!header) return "";
  if (_fbIsCommentActivityText(header.innerText || header.textContent || "")) return "";
  const links = header.querySelectorAll("a[href]");
  for (const link of links) {
    if (_fbIsCommentActivityLink(link)) continue;
    const href = link.href || "";
    if (href && !_fbIsProfileHref(href) && !href.includes("facebook.com")) continue;
    const name = _fbNameFromLink(link);
    if (name) return name;
  }
  if (links[0] && !_fbIsCommentActivityLink(links[0])) {
    const name = _fbNameFromLink(links[0]);
    if (name) return name;
  }
  return "";
}

function _fbIsCommentArticle(nested, postContainer) {
  let el = nested.parentElement;
  for (let i = 0; i < 10 && el && el !== postContainer; i++) {
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (role === "list" || role === "listitem" || el.tagName === "UL") return true;
    el = el.parentElement;
  }
  if (nested.closest("form")) return true;
  el = nested.parentElement;
  for (let i = 0; i < 5 && el && el !== postContainer; i++) {
    if (el.querySelector(":scope > form")) return true;
    el = el.parentElement;
  }
  return false;
}

function _fbFindOriginalAuthor(postContainer) {
  if (!postContainer) return "";
  const nestedArticles = postContainer.querySelectorAll('[role="article"]');
  for (const nested of nestedArticles) {
    if (nested === postContainer) continue;
    const parentArticle = nested.parentElement?.closest?.('[role="article"]');
    if (parentArticle && parentArticle !== postContainer) continue;
    if (_fbIsCommentArticle(nested, postContainer)) continue;

    const headers = nested.querySelectorAll("h2, h3, h4, strong");
    for (const h of headers) {
      const owner = h.closest('[role="article"]');
      if (owner && owner !== nested) continue;
      if (h.tagName === "STRONG") {
        const a = h.querySelector("a[href]");
        const name = _fbNameFromLink(a);
        if (name) return name;
        continue;
      }
      const name = _fbNameFromHeader(h);
      if (name) return name;
    }

    const strongs = nested.querySelectorAll("strong a[href], a[role='link']");
    for (const s of strongs) {
      if (s.closest('[role="article"]') !== nested) continue;
      if (_fbIsCommentActivityLink(s)) continue;
      if (s.href && !_fbIsProfileHref(s.href) && !/facebook\.com\/(profile\.php|people|user)/i.test(s.href)) {
        continue;
      }
      const name = _fbNameFromLink(s);
      if (name) return name;
    }
  }
  return "";
}

function _fbExtractAuthorFromContainer(container) {
  if (!container) return "";

  const headerText = _fbCleanName(
    container.querySelector("h2, h3, h4")?.innerText || "",
  );
  if (/\b(?:anonymous participant|anonymous member|thành viên ẩn danh|người tham gia ẩn danh)\b/i.test(headerText)) {
    return /anonymous/i.test(headerText) ? "Anonymous participant" : "Thành viên ẩn danh";
  }

  // 1) Semantic headers
  const headers = container.querySelectorAll("h2, h3, h4");
  for (const h of headers) {
    const owner = h.closest('[role="article"], [data-virtualized], [data-pagelet^="FeedUnit"]');
    if (owner && owner !== container && container.contains(owner)) continue;
    const name = _fbNameFromHeader(h);
    if (name) return name;
  }

  // 2) strong > a (classic FB actor name)
  const strongs = container.querySelectorAll("strong a[href]");
  for (let i = 0; i < Math.min(strongs.length, 12); i++) {
    const s = strongs[i];
    const art = s.closest('[role="article"]');
    if (art && art !== container && container.contains(art)) continue;
    if (s.href && !_fbIsProfileHref(s.href)) continue;
    const name = _fbNameFromLink(s);
    if (name) return name;
  }

  // 3) First profile link near top of post (avatar + name)
  const profileLinks = container.querySelectorAll("a[href*='facebook.com']");
  for (let i = 0; i < Math.min(profileLinks.length, 20); i++) {
    const a = profileLinks[i];
    if (_fbIsCommentActivityLink(a)) continue;
    if (!_fbIsProfileHref(a.href)) continue;
    const name = _fbNameFromLink(a);
    if (name) return name;
    const labeled = a.getAttribute("aria-label");
    const cleaned = _fbCleanName(
      (labeled || "")
        .replace(/\s*['']s profile$/i, "")
        .replace(/^Trang cá nhân của\s+/i, "")
    );
    if (_validateAuthorName(cleaned)) return cleaned;
  }

  // 4) Mobile: h3 a
  if (IS_MOBILE_WEB) {
    const authorH3 = container.querySelector("h3 a, header a");
    if (authorH3) {
      const name = _fbNameFromLink(authorH3);
      if (name) return name;
    }
  }

  return "";
}

function extractPostAuthor(element) {
  if (!element) return "";

  const postContainer = _findPostContainer(element) || (() => {
    let p = element;
    for (let i = 0; i < 25; i++) {
      if (!p?.parentElement || p.parentElement === document.body) break;
      p = p.parentElement;
      if (p.getAttribute?.("role") === "article") break;
    }
    return p;
  })();

  if (!postContainer) return "";

  const cached = _authorCache.get(postContainer);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.name;
  }

  let name = "";

  if (SITE === "facebook") {
    // Shared post → original author inside nested article (not the sharer)
    name = _fbFindOriginalAuthor(postContainer);
    if (!_validateAuthorName(name)) {
      name = _fbExtractAuthorFromContainer(postContainer);
    }
    if (!_validateAuthorName(name)) name = "";
  } else {
    const nameEl = postContainer.querySelector(
      '[data-testid="User-Name"], [data-testid="tweetAuthorName"]',
    );
    if (nameEl) name = (nameEl.textContent || "").split("@")[0].trim();

    if (!name) {
      const liAuthor = postContainer.querySelector(
        ".feed-shared-actor__name, .update-components-actor__name",
      );
      if (liAuthor) name = (liAuthor.textContent || "").trim();
    }

    if (!name) {
      const redditAuthor = postContainer.querySelector(
        '[data-testid="post_author_link"], a[href*="/user/"]',
      );
      if (redditAuthor) name = (redditAuthor.textContent || "").trim();
    }
  }

  name = _validateAuthorName(name) ? _fbCleanName(name) : "";
  _authorCache.set(postContainer, { name, timestamp: Date.now() });
  return name;
}

function extractPostImages(element) {
  if (!element) return [];
  const postContainer = _findPostContainer(element);

  // Helper: get best src from img element
  function _imgSrc(img) {
    const srcset = img.getAttribute("srcset") || img.getAttribute("data-srcset") || "";
    if (srcset) {
      const parts = srcset.split(",").map(s => s.trim().split(/\s+/)).filter(p => p[0]);
      if (parts.length > 0) {
        let best = parts[parts.length - 1];
        let bestW = 0;
        for (const p of parts) {
          const w = parseInt(p[1] || "0");
          if (w > bestW) { bestW = w; best = p; }
        }
        if (best[0]) return best[0];
      }
    }
    return img.getAttribute("data-src") || img.currentSrc || img.src || "";
  }

  function _isAvatar(img) {
    if (img.width > 0 && img.width < 80) return true;
    try { if (getComputedStyle(img).borderRadius === "50%") return true; } catch (_) {}
    return false;
  }

  function _isHeaderImg(img, container) {
    const headerEl = container.querySelector("h2, h3, h4, [data-testid='story-subtitle'], [data-testid='post-header']");
    if (headerEl && headerEl.contains(img)) return true;
    const parentLink = img.closest("a");
    if (parentLink) {
      const href = parentLink.href || "";
      if (href.includes("/user/") || href.includes("/profile.php") ||
          (href.includes("facebook.com") && /facebook\.com\/[^/?]+$/.test(href) &&
           !href.includes("/posts/") && !href.includes("/photo") && !href.includes("/reel"))) {
        return true;
      }
    }
    return false;
  }

  function _extractAllImagesFromContainer(container) {
    const collected = [];
    const seenSrcs = new Set();
    function _normalizeSrc(src) {
      try { const u = new URL(src); return u.origin + u.pathname; } catch (_) { return src; }
    }
    function _addIfUnique(src, area, priority) {
      if (!src || src.startsWith("data:")) return;
      if (src.includes("/rsrc.php/") || src.includes("emoji")) return;
      const key = _normalizeSrc(src);
      if (seenSrcs.has(key)) return;
      seenSrcs.add(key);
      collected.push({ src, area, priority });
    }

    // Strategy 1: Explicit photo links
    const photoLinks = container.querySelectorAll('a[href*="/photo"], a[href*="/photos/"], a[href*="fbid="], a[href*="/reel/"], a[href*="/videos/"]');
    for (const link of photoLinks) {
      const img = link.querySelector("img");
      if (!img) continue;
      const src = _imgSrc(img);
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      if (w > 0 && w < 80) continue;
      _addIfUnique(src, w * h, 1);
    }
    // Strategy 2: Background image
    const bgElements = container.querySelectorAll('[style*="background-image"]');
    for (const bgEl of bgElements) {
      const rect = bgEl.getBoundingClientRect();
      if (rect.width < 150 || rect.height < 150) continue;
      try { if (getComputedStyle(bgEl).borderRadius === "50%") continue; } catch (_) {}
      const style = bgEl.getAttribute("style") || "";
      const match = style.match(/background-image:\s*url\(["']?([^"']+)["']?\)/);
      if (match && match[1]) _addIfUnique(match[1], rect.width * rect.height, 2);
    }
    // Strategy 3: Large images
    const allImgs = container.querySelectorAll("img");
    for (const img of allImgs) {
      const src = _imgSrc(img);
      if (!src || src.startsWith("data:")) continue;
      if (_isAvatar(img)) continue;
      if (_isHeaderImg(img, container)) continue;
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      if (w > 0 && w < 200 && h < 200) continue;
      _addIfUnique(src, w * h, 3);
    }
    collected.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.area - a.area;
    });
    return collected.map(c => c.src);
  }

  function _collectImages() {
    if (SITE === "facebook") {
      const results = [];
      const seen = new Set();
      const push = (arr) => {
        for (const url of arr) {
          try {
            const key = new URL(url).origin + new URL(url).pathname;
            if (!seen.has(key)) { seen.add(key); results.push(url); }
          } catch (_) {
            if (!seen.has(url)) { seen.add(url); results.push(url); }
          }
        }
      };
      const sharedInner = _findSharedPostArticle(postContainer);
      if (sharedInner) push(_extractAllImagesFromContainer(sharedInner));
      push(_extractAllImagesFromContainer(postContainer));
      return results;
    } else {
      const results = [];
      const images = postContainer.querySelectorAll("img");
      for (const img of images) {
        const src = _imgSrc(img);
        if (!src || src.startsWith("data:")) continue;
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        if (w < 200 && h < 200) continue;
        if (src.includes("emoji") || src.includes("static")) continue;
        if (src.includes("profile") || src.includes("avatar")) continue;
        try { if (getComputedStyle(img).borderRadius === "50%") continue; } catch (_) {}
        // On X: skip link preview images (card thumbnails) — these are not user-uploaded
        if (SITE === "x") {
          const card = img.closest('[data-testid="card.wrapper"], [data-testid="card2"], [data-testid="socialContext"], a[href*="t.co"]');
          if (card) continue;
        }
        results.push(src);
      }
      return results;
    }
  }

  let allImages = _collectImages();
  if (allImages.length === 0) {
    const ogImage = document.querySelector('meta[property="og:image"]');
    if (ogImage && ogImage.content) allImages = [ogImage.content];
  }
  _lastExtractedImages = allImages;
  return allImages;
}

function extractPostImage(element) {
  const images = extractPostImages(element);
  return images.length > 0 ? images[0] : "";
}

async function fetchImageBlob(imgSrc, filename = "image.png") {
  if (!imgSrc) return null;

  // Attempt 1: Via Canvas (fastest but fails on cross-origin taint)
  // Tìm img element theo src OR currentSrc OR srcset (srcset có thể là URL chúng ta lấy)
  let imgEl = null;
  try {
    imgEl = document.querySelector(`img[src="${CSS.escape(imgSrc)}"]`);
    if (!imgEl) {
      // Fallback: scan tất cả img để tìm element có currentSrc match hoặc srcset chứa url
      const allImgs = document.querySelectorAll("img");
      for (const img of allImgs) {
        if (img.currentSrc === imgSrc || img.src === imgSrc) {
          imgEl = img; break;
        }
        const srcset = img.srcset || "";
        if (srcset && srcset.includes(imgSrc)) {
          imgEl = img; break;
        }
      }
    }
  } catch (_) {}

  if (imgEl && imgEl.naturalWidth > 0) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = imgEl.naturalWidth;
      canvas.height = imgEl.naturalHeight;
      canvas.getContext("2d").drawImage(imgEl, 0, 0);
      const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      if (blob) return new File([blob], filename, { type: "image/png" });
    } catch (_) {
      // Cross-origin taint — fall through to network fetch
    }
  }

  // Attempt 2: Via Background.js fetch (bypasses CORS)
  try {
    try {
      const origin = new URL(imgSrc).origin + "/*";
      if (chrome.permissions?.request) {
        await chrome.permissions.request({ origins: [origin, "https://*/*"] });
      } else {
        await chrome.runtime.sendMessage({
          action: "request-optional-permission",
          origins: [origin, "https://*/*"],
        });
      }
    } catch (_) {}
    const resp = await new Promise((resolve) =>
      chrome.runtime.sendMessage(
        { action: "fetch-image", url: imgSrc },
        resolve,
      ),
    );
    if (resp && resp.base64) {
      const fetchResp = await fetch(resp.base64);
      const blob = await fetchResp.blob();
      if (blob) {
        const ext = blob.type.includes("jpeg") ? "jpg" :
                   blob.type.includes("webp") ? "webp" :
                   blob.type.includes("png") ? "png" : "jpg";
        return new File([blob], filename.replace(/\.\w+$/, "." + ext), { type: blob.type || "image/jpeg" });
      }
    }
  } catch (_) {}

  return null;
}

async function fetchImageBlobs(imgSrcs, maxCount = 10) {
  if (!imgSrcs || imgSrcs.length === 0) return [];
  // Facebook limit 10 ảnh/post; giới hạn maxCount
  const targets = imgSrcs.slice(0, maxCount);
  const results = await Promise.all(
    targets.map((src, i) => fetchImageBlob(src, `image_${i + 1}.png`))
  );
  return results.filter(f => f !== null);
}

function _matchesClutterLabelNorm(normText) {
  return ALL_CLUTTER_LABELS_NORM.some(kw => normText === kw || normText.startsWith(kw));
}

function injectClutterCSS() {
  // v3: NEVER hide RightRail / complementary column — that shifts FB layout
  const STYLE_ID = "fbs-clutter-css-v3";
  ["fbs-clutter-css", "fbs-clutter-css-v2"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  // Chỉ ẩn widget trong feed — giữ nguyên cột layout (Left/Right rail)
  style.textContent = [
    // Stories row (trong feed)
    'div[role="main"] div[data-pagelet="Stories"]',
    'div[role="main"] div[data-pagelet*="Stories"]',
    'div[role="main"] div[aria-label="Stories"]',
    'div[role="main"] div[aria-label="Tin"]',
    // Reels shelf trong feed
    'div[role="main"] div[data-pagelet*="Reels"]',
    'div[role="main"] div[aria-label="Reels"]',
    'div[role="main"] div[aria-label="Thước phim ngắn"]',
    // Marketplace / groups widgets trong feed
    'div[role="main"] div[data-pagelet*="Marketplace"]',
    'div[role="main"] div[data-pagelet*="GroupsYouShouldJoin"]',
    'div[role="main"] div[data-pagelet*="PeopleYouMayKnow"]',
  ].join(",\n") + " { display: none !important; }";
  (document.head || document.documentElement).appendChild(style);
}

/** True if node is a layout column we must never display:none */
function _isFbLayoutColumn(el) {
  if (!el || el === document.body || el === document.documentElement) return true;
  const role = el.getAttribute("role") || "";
  if (
    role === "complementary" ||
    role === "main" ||
    role === "navigation" ||
    role === "banner" ||
    role === "feed"
  ) {
    return true;
  }
  const pl = (el.getAttribute("data-pagelet") || "").toLowerCase();
  if (
    pl.includes("rightrail") ||
    pl.includes("right_rail") ||
    pl.includes("rightside") ||
    pl.includes("leftrail") ||
    pl.includes("left_rail") ||
    pl === "root"
  ) {
    return true;
  }
  // Very wide shells (grid columns)
  try {
    if (el.offsetWidth >= 300 && el.querySelector?.('[role="feed"], [role="main"]'))
      return true;
  } catch (_) {}
  return false;
}

/** Hide an ad card without collapsing FB columns */
function _hideAdCardOnly(el) {
  if (!el || el.dataset.fbsHidden === "1") return false;
  if (_isFbLayoutColumn(el)) return false;
  const target = _expandToFullPostCard(el) || el;
  // Never blank status/media while leaving the author row + action bar.
  if (_isContentOnlyPostSlice(target)) return false;
  if (_isFbLayoutColumn(target)) return false;
  target.dataset.fbsHidden = "1";
  // Collapse content but keep flow if needed — display none on card only
  target.style.setProperty("display", "none", "important");
  return true;
}

function hideFeedClutter() {
  if (SITE !== "facebook") return;
  injectClutterCSS();

  let newlyHidden = 0;

  // ── Strategy 1: React portal detection (primary for Facebook) ────────────
  // Facebook renders "Được tài trợ" / clutter labels as React portals:
  //   <div class="__fb-light-mode">
  //     <span id="_r_a2_">Được tài trợ</span>
  //   </div>
  // These portals live directly under <body>, completely detached from the
  // feed DOM. The feed post references them via aria-describedby on a <span>
  // inside a DIV[data-virtualized] post wrapper:
  //   SPAN[aria-describedby="_r_a2_"] → A[role=link] → DIV[data-virtualized]
  // So we: (1) find portals with clutter text, (2) get their span IDs,
  // (3) find the feed element with aria-describedby pointing to that ID,
  // (4) walk up to find DIV[data-virtualized] via findFeedWrapper.
  // Sponsored signals: exact label OR substring inside longer aria text
  // e.g. "Mở menu cho nội dung được tài trợ của Kính Hải Triều Vietnam"
  function _portalIsSponsored(tcNorm) {
    if (_matchesClutterLabelNorm && _matchesClutterLabelNorm(tcNorm)) return true;
    return _matchesSponsoredNorm(tcNorm);
  }

  // Scan React label portals (light + dark). FB keeps "Được tài trợ" text here,
  // detached from the feed unit; posts link via aria-describedby / labelledby.
  const portals = document.querySelectorAll(
    ".__fb-light-mode, .__fb-dark-mode, body > div > span[id], body > div > div > span[id]",
  );
  for (const portal of portals) {
    if (portal.dataset.fbsPortalChecked) continue;
    // Prefer the element that actually holds the id (span) when portal is a wrapper
    const idHosts =
      portal.id
        ? [portal]
        : Array.from(portal.querySelectorAll("[id]")).slice(0, 12);
    const tcNorm = _normLabelText(portal.textContent || "");
    if (tcNorm.length < 2 || tcNorm.length > 220 || !_portalIsSponsored(tcNorm)) {
      // Only mark tiny non-matching nodes; wrappers may gain text later
      if (tcNorm.length > 0 && tcNorm.length < 80 && !_portalIsSponsored(tcNorm)) {
        portal.dataset.fbsPortalChecked = "1";
      }
      continue;
    }
    // Sponsored portal: try to find the feed post referencing it.
    // Do NOT mark as checked until we successfully hide — the post may not
    // be in the DOM yet (virtual scroll) and we need to retry on next scan.
    const idEls =
      idHosts && idHosts.length
        ? idHosts
        : portal.querySelectorAll("[id]");
    let didHide = false;
    for (const idEl of idEls) {
      if (!idEl.id) continue;
      const qid = JSON.stringify(idEl.id);
      const sel =
        "[aria-describedby~=" +
        qid +
        "],[aria-labelledby~=" +
        qid +
        "],[aria-describedby*=" +
        qid +
        "]";
      let ref;
      try {
        ref = document.querySelector(sel);
      } catch (e) {
        continue;
      }
      if (!ref) continue;
      const wrapper = findFeedWrapper(ref);
      if (!wrapper) continue; // post not in DOM yet — retry next scan
      if (wrapper.dataset.fbsHidden === "1") {
        didHide = true;
        break;
      }
      wrapper.dataset.fbsHidden = "1";
      wrapper.dataset.fbsHideReason = "sponsored";
      _hideWrapper(wrapper);
      hiddenClutterCount++;
      newlyHidden++;
      didHide = true;
      break;
    }
    if (didHide) portal.dataset.fbsPortalChecked = "1";
  }

  // ── Strategy 2: aria-label substring scan on elements in the feed ───────
  const roots =
    typeof visiblePosts !== "undefined" && visiblePosts.size > 0
      ? Array.from(visiblePosts)
      : [document.querySelector('div[role="main"]') || document.body];
  for (const root of roots) {
    if (!root || !root.querySelectorAll) continue;
    root.querySelectorAll("[aria-label]").forEach((el) => {
      if (el.dataset.fbsClutterChecked) return;
      const lbl = _normLabelText(el.getAttribute("aria-label") || "");
      if (lbl.length < 4 || lbl.length > 200) return;
      if (!_matchesSponsoredNorm(lbl)) return;
      el.dataset.fbsClutterChecked = "1";
      if (isInNonPostArea(el)) return;
      const wrapper = findFeedWrapper(el);
      if (!wrapper || wrapper.dataset.fbsHidden === "1") return;
      wrapper.dataset.fbsHidden = "1";
      _hideWrapper(wrapper);
      hiddenClutterCount++;
      newlyHidden++;
    });
  }

  // ── Strategy 3: ad link detection ───────────────────────────────────────
  for (const root of roots) {
    const adLinks = root.querySelectorAll(
      'a[href*="/ads/about"], a[href*="about_ads"], a[href*="adchoices"], a[href*="/ads/preferences"]'
    );
    for (const link of adLinks) {
      if (link.dataset.fbsAdLinkChecked) continue;
      link.dataset.fbsAdLinkChecked = "1";
      if (isInNonPostArea(link)) continue;
      const wrapper = findFeedWrapper(link);
      if (!wrapper || wrapper.dataset.fbsHidden === "1") continue;
      wrapper.dataset.fbsHidden = "1";
      _hideWrapper(wrapper);
      hiddenClutterCount++;
      newlyHidden++;
    }
  }

  // ── Strategy 4: CLUTTER_LABELS (Gợi ý, Reels, People you may know, ...) ─
  // Quét text label ngắn trong header của các item feed
  const CLUTTER_LABELS_NORM = CLUTTER_LABELS.map(kw => kw.replace(/\s+/g, "").toLowerCase());
  function _matchesClutter(tcNorm) {
    return CLUTTER_LABELS_NORM.some(kw => tcNorm === kw || tcNorm.startsWith(kw));
  }
  // Check spans/divs trong article headers (h2, h3, h4) hoặc dir="auto" labels
  // Giới hạn scope: chỉ quét trong feed container
  const feed = document.querySelector('[role="feed"]') || document.querySelector('[role="main"]');
  if (feed) {
    const headerCandidates = feed.querySelectorAll('h2 span[dir="auto"], h3 span[dir="auto"], h4 span[dir="auto"], h2 > span, h3 > span, h4 > span');
    for (const el of headerCandidates) {
      if (el.dataset.fbsLabelChecked) continue;
      const text = (el.textContent || "").trim();
      if (text.length < 3 || text.length > 60) continue;
      const tcNorm = text.replace(/\s+/g, "").toLowerCase();
      if (!_matchesClutter(tcNorm)) continue;
      el.dataset.fbsLabelChecked = "1";
      if (isInNonPostArea(el)) continue;
      const wrapper = findFeedWrapper(el);
      if (!wrapper || wrapper.dataset.fbsHidden === "1") continue;
      wrapper.dataset.fbsHidden = "1";
      _hideWrapper(wrapper);
      hiddenClutterCount++;
      newlyHidden++;
    }
  }

  // ── Strategy 5: Sidebar ads ONLY (never hide whole RightRail column) ──
  // Find "Được tài trợ" / Sponsored chips and hide the ad card subtree,
  // stopping before complementary / RightRail layout shells.
  const mainFeed =
    document.querySelector('[role="feed"]') ||
    document.querySelector('div[role="main"]');

  document.querySelectorAll("span, div[dir='auto'], h2, h3, h4").forEach((el) => {
    if (el.dataset.fbsSideAdChecked) return;
    const t = (el.textContent || "").trim();
    if (t !== "Được tài trợ" && t.toLowerCase() !== "sponsored") return;
    el.dataset.fbsSideAdChecked = "1";

    // In main feed → use normal feed wrapper hide
    if (mainFeed && mainFeed.contains(el)) {
      const w = findFeedWrapper(el);
      if (w && !_isFbLayoutColumn(w) && w.dataset.fbsHidden !== "1") {
        w.dataset.fbsHidden = "1";
        _hideWrapper(w);
        newlyHidden++;
        hiddenClutterCount++;
      }
      return;
    }

    // Side column: climb to smallest ad-card, not the column itself
    let p = el.parentElement;
    let adCard = null;
    for (let i = 0; i < 12 && p && p !== document.body; i++) {
      if (_isFbLayoutColumn(p)) break;
      const links = p.querySelectorAll(
        'a[href*="l.facebook.com"], a[href*="http"], a[target="_blank"]',
      );
      const w = p.offsetWidth || 0;
      // Prefer a compact card with outbound/ad links
      if (links.length >= 1 && w > 120 && w < 400) {
        adCard = p;
      }
      p = p.parentElement;
    }
    if (adCard && _hideAdCardOnly(adCard)) {
      newlyHidden++;
      hiddenClutterCount++;
    }
  });

  // No toast — silent hide
}


// === UNIFIED DETECTION ENGINE ===
// Consolidates all ad/affiliate detection signals into a single pipeline.
// Used by the feed filtering UI in content.js.


function _getPrimaryPostText(container) {
  if (!container) return "";
  try {
    const clone = container.cloneNode(true);
    // Strip nested comments + chrome that causes false engagement gates
    // (Like / Comment / Share buttons next to words like "link" in body)
    clone
      .querySelectorAll(
        'form, [role="article"] [role="article"], [role="toolbar"], [aria-label="Actions for this post"], [aria-label*="Thích"], [aria-label*="Like"], [aria-label*="Bình luận"], [aria-label*="Comment"], [aria-label*="Chia sẻ"], [aria-label*="Share"], [data-ad-comet-preview], ul[role="listbox"], [data-fbs-ui], .fbs-chip-host, .fbs-batch-checkbox',
      )
      .forEach((node) => node.remove());
    return clone.innerText || clone.textContent || "";
  } catch (_) {
    return container.innerText || container.textContent || "";
  }
}

/**
 * Text used by engagement-gate detection. Prefer Facebook's semantic post
 * body so social-context chrome ("X đã bình luận.") and comment threads
 * cannot turn a normal post into a false "comment để nhận" hit.
 */
function _getEngagementScanText(container) {
  if (!container) return "";
  const messageSelector =
    '[data-ad-preview="message"], [data-ad-comet-preview="message"], [data-testid="post_message"], [data-testid="post-message"]';
  const candidates = [];
  try {
    for (const node of container.querySelectorAll(messageSelector)) {
      if (node.closest("form")) continue;
      let articleDepth = 0;
      let parent = node.parentElement;
      while (parent && parent !== container) {
        if (parent.getAttribute?.("role") === "article") articleDepth++;
        parent = parent.parentElement;
      }
      const text = _normalizePostBodyText(node.innerText || node.textContent || "");
      if (text) candidates.push({ text, articleDepth });
    }
  } catch (_) {}

  let raw = "";
  if (candidates.length) {
    // Prefer the outermost message nodes inside this container. On modern
    // Facebook feeds the container is often data-virtualized wrapping one
    // article, so depth 1 is the real post body — do not skip it.
    candidates.sort(
      (a, b) => a.articleDepth - b.articleDepth || b.text.length - a.text.length,
    );
    const minDepth = candidates[0].articleDepth;
    raw = candidates
      .filter((candidate) => candidate.articleDepth === minDepth)
      .map((candidate) => candidate.text)
      .join("\n");
  } else {
    raw = _getPrimaryPostText(container);
  }
  raw = _normalizePostBodyText(raw);
  // Drop Facebook social-context lines and action-bar leftovers that survive cloning.
  const lines = String(raw || "")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => {
      if (!line) return false;
      if (_fbIsCommentActivityText(line)) return false;
      if (
        /^(?:thích|like|bình luận|comment|chia sẻ|share|xem thêm|see more|tóm tắt|all comments|tất cả bình luận|\d+\s*(?:comments?|bình luận))$/i.test(
          line,
        )
      ) {
        return false;
      }
      return true;
    });
  return lines.join("\n").trim();
}

function _normalizePostBodyText(raw) {
  const uiOnly = /^(?:like|thích|comment|bình luận|share|chia sẻ|send|gửi|follow|theo dõi|see more|xem thêm|show less|ẩn bớt|tóm tắt)$/i;
  const lines = String(raw || "")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line && !uiOnly.test(line));
  return lines.join("\n").trim();
}

/**
 * Extract the actual post body used by summary and Batch flows.
 * Prefer Facebook's semantic message node; fall back to a chrome/comment-free
 * clone. For shares, keep the sharer's note followed by the original body.
 */
function extractPostContent(element) {
  if (!element) return "";
  const postContainer = _findPostContainer(element) || element;
  const sharedInner = SITE === "facebook" ? _findSharedPostArticle(postContainer) : null;
  const messageSelector =
    '[data-ad-preview="message"], [data-ad-comet-preview="message"], [data-testid="post_message"], [data-testid="post-message"]';

  const extractOne = (container, excluded) => {
    if (!container) return "";
    const candidates = [];
    for (const node of container.querySelectorAll(messageSelector)) {
      if (excluded && excluded.contains(node)) continue;
      if (node.closest("form")) continue;
      const text = _normalizePostBodyText(node.innerText || node.textContent || "");
      if (!text) continue;
      let articleDepth = 0;
      let parent = node.parentElement;
      while (parent && parent !== container) {
        if (parent.getAttribute?.("role") === "article") articleDepth++;
        parent = parent.parentElement;
      }
      candidates.push({ text, articleDepth });
    }
    if (candidates.length) {
      candidates.sort((a, b) => a.articleDepth - b.articleDepth || b.text.length - a.text.length);
      return candidates[0].text;
    }
    return _normalizePostBodyText(_getPrimaryPostText(container));
  };

  const outerText = extractOne(postContainer, sharedInner);
  const innerText = sharedInner ? extractOne(sharedInner, null) : "";
  if (outerText && innerText && outerText !== innerText) return outerText + "\n\n" + innerText;
  return innerText || outerText;
}

/**
 * Detect "do X to get Y" engagement bait:
 * comment / like / react / share / follow / tag / join → link, file, gift, inbox…
 *
 * Returns null | {
 *   reason: string,           // primary reason key for UI/telemetry
 *   actions: string[],        // comment | like | share | follow | tag | join | react
 *   rewards: string[],        // link | file | doc | code | prompt | gift | access…
 *   confidence: number,       // 55–95
 *   pattern?: string,
 *   sample?: string,
 * }
 */
function _isInformationalCommentPointer(scan) {
  // Author puts the resource in comments — not "do X to get Y".
  const pointer =
    /(?:link|url|chi\s*ti[eế]t|mã\s*nguồn|ma\s*nguon|github|repo|file).{0,72}(?:để|de|ở|o|dưới|duoi|trong|ngay).{0,28}(?:phần\s*)?(?:bình\s*luận|binh\s*luan|comment|cmt)\b/i.test(
      scan,
    ) ||
    /(?:mình|toi|tôi|admin|ad)?\s*(?:để|de)\s*(?:ngay|ở|o|dưới|duoi|trong)?\s*(?:phần\s*)?(?:bình\s*luận|binh\s*luan|comment|cmt)\b/i.test(
      scan,
    );
  if (!pointer) return false;
  const engageToGet =
    /(?:like|thích|thả\s*tim|react|share|chia\s*sẻ\s*public|follow|theo\s*dõi|để\s*lại\s*(?:cmt|comment)|cmt\s*[\"'“”1]|comment\s*[\"'“”]).{0,52}(?:để\s*nhận|de\s*nhan|để\s*lấy|inbox|\bib\b|nhận\s*(?:file|link|tài|prompt))/i.test(
      scan,
    );
  return !engageToGet;
}

/**
 * Strip "không cần cmt/like…" so soft patterns cannot treat a negation as the
 * engagement action (e.g. "Không cần cmt, mình gửi file qua inbox").
 */
function _sanitizeEngagementScan(scan) {
  return String(scan || "")
    .replace(
      /(?:không|ko|khong|chả|cha)\s*(?:cần|can|phải|bat\s*buoc|cần\s*phải)?\s*(?:like|thích|thik|cmt|comment|bình\s*luận|binh\s*luan|share|chia\s*sẻ|chia\s*se|follow|theo\s*dõi|theo\s*doi|tag|join|tham\s*gia)/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Posts that talk ABOUT bait (warnings, scam quotes, "ai từng…") — not bait.
 */
function _isEngagementMetaDiscussion(scan) {
  if (!scan) return false;
  // Explicit warning / "đừng cmt để nhận"
  if (
    /(?:đừng|dung|không\s*nên|ko\s*nên|khong\s*nen)\s*(?:cmt|comment|bình\s*luận|like|share).{0,55}(?:để\s*nhận|de\s*nhan|để\s*lấy|nhận\s*(?:file|link|quà)|nhan\s*(?:file|link))/i.test(
      scan,
    )
  ) {
    return true;
  }
  // Scam / chiêu / giáo dục quanh cụm "cmt để nhận"
  if (
    /(?:scam|lừa|lua\s*đảo|lua\s*dao|cảnh\s*báo|canh\s*bao|cảnh\s*giác|chiêu|chieu|mánh|manh|toàn\s*scam|toan\s*scam|ví\s*dụ\s*scam|vi\s*du\s*scam)/i.test(
      scan,
    ) &&
    /(?:cmt|comment|bình\s*luận|binh\s*luan).{0,48}(?:để\s*nhận|de\s*nhan|để\s*lấy|de\s*lay|nhận\s*(?:file|link)|nhan\s*(?:file|link))/i.test(
      scan,
    )
  ) {
    return true;
  }
  // Educational framing: "nhận biết chiêu comment để lấy file"
  if (
    /(?:nhận\s*biết|nhan\s*biet|dạy\s*cách|day\s*cach|hướng\s*dẫn|huong\s*dan|hay\s*dùng|hay\s*dung).{0,55}(?:chiêu|chieu|mánh|manh)?\s*(?:cmt|comment|bình\s*luận).{0,40}(?:để\s*(?:nhận|lấy)|de\s*(?:nhan|lay))/i.test(
      scan,
    )
  ) {
    return true;
  }
  // Narrative past tense / rhetorical: "ai từng comment để nhận quà chưa?"
  if (
    /(?:ai\s*từng|từng\s*(?:bị|bi)|từng\s*(?:cmt|comment|like)).{0,50}(?:cmt|comment|bình\s*luận).{0,40}(?:để\s*nhận|de\s*nhan|để\s*lấy|nhận\s*(?:file|quà|qua|link))/i.test(
      scan,
    )
  ) {
    return true;
  }
  // Quoted bait as topic: … "cmt để nhận file" …
  if (
    /[\"'“”«].{0,8}(?:cmt|comment|bình\s*luận).{0,36}(?:để\s*nhận|de\s*nhan|để\s*lấy).{0,36}[\"'”»]/i.test(
      scan,
    ) &&
    /(?:scam|lừa|lua|chiêu|chieu|cảnh\s*báo|từng|đừng|dung|nhưng|nhung)/i.test(scan)
  ) {
    return true;
  }
  return false;
}

/** Soft hits need an imperative "do X → get Y" cue, not mere co-occurrence. */
function _hasEngagementImperative(sample, scan) {
  const s = `${sample || ""} ${scan || ""}`;
  return (
    /(?:để\s*nhận|de\s*nhan|để\s*lấy|de\s*lay|rồi\s*nhận|roi\s*nhan|to\s*get)/i.test(s) ||
    /(?:cmt|comment|để\s*lại|de\s*lai)\s*[\"'“”]?\s*(?:1|số\s*1|so\s*1|quan\s*tâm|quan\s*tam|xin\s*link|link|done|interested)/i.test(
      s,
    ) ||
    /(?:mình|toi|tôi|ad|admin|bot)\s*(?:sẽ\s*)?(?:gửi|gui|ib|inbox|dm)/i.test(s) ||
    /\b(?:i'?ll|will|we'?ll)\s*(?:send|dm|inbox)\b/i.test(s)
  );
}

function _detectEngagementGateText(container) {
  const raw = _getEngagementScanText(container).replace(/\s+/g, " ").trim();
  if (!raw || raw.length < 12) return null;
  const text = raw.toLowerCase();
  // Cap scan length — gates almost always sit in first ~1.2k chars of post body
  let scan = _sanitizeEngagementScan(text.slice(0, 1400));
  if (!scan || scan.length < 12) return null;

  // "Link mình để ngay/dưới bình luận" is an informational pointer, not
  // "comment/like to receive X". Bail before soft patterns can FP on GitHub URLs.
  if (_isInformationalCommentPointer(scan)) return null;
  if (_isEngagementMetaDiscussion(scan)) return null;

  // Short teencode forms need token edges so "scam"/"document" do not leak.
  const CMT_TOKEN =
    "(?:comment|bình\\s*luận|binh\\s*luan|(?:^|[^a-z0-9_])(?:cmt|cmb|cmnt)(?=[^a-z0-9_]|$)|để\\s*lại\\s*(?:cmt|comment|bình\\s*luận|ý\\s*kiến)|de\\s*lai\\s*(?:cmt|comment)|viết\\s*comment|viet\\s*cmt|gõ\\s*(?:cmt|comment)|go\\s*cmt|nhập\\s*(?:cmt|comment))";

  const ACTION = {
    comment: CMT_TOKEN,
    like:
      "(?:like|thích|thik|tha\\s*tim|thả\\s*tim|tha\\s*❤|❤|❤️|♥|🔥|react|reaction|cảm\\s*xúc|cam\\s*xuc|thả\\s*cảm\\s*xúc|bấm\\s*like|bam\\s*like|nhấn\\s*like|nhan\\s*like|click\\s*like|double\\s*tap|thả\\s*tim|tym)",
    share:
      "(?:share|chia\\s*sẻ|chia\\s*se|đăng\\s*lại|dang\\s*lai|repost|re-?share|share\\s*bài|share\\s*bai|share\\s*post|share\\s*story|chia\\s*sẻ\\s*(?:bài|story|public)|chia\\s*se\\s*(?:bai|story|public)|share\\s*public)",
    follow:
      "(?:follow|theo\\s*dõi|theo\\s*doi|fl\\b|fl\\s*page|follow\\s*page|follow\\s*nhóm|follow\\s*group|sub(?:scribe)?|đăng\\s*ký|dang\\s*ky|follow\\s*(?:mình|toi|tôi|us|me))",
    tag:
      "(?:tag|gắn\\s*thẻ|gan\\s*the|mention|nhắc\\s*(?:bạn|tên|ten)|tag\\s*(?:bạn|ban|bạn\\s*bè|ban\\s*be|\\d+\\s*bạn|friends?))",
    join:
      "(?:join|tham\\s*gia|vào\\s*nhóm|vao\\s*nhom|join\\s*group|tham\\s*gia\\s*(?:group|nhóm|nhom)|vào\\s*group)",
    save:
      "(?:save|lưu\\s*bài|luu\\s*bai|lưu\\s*post|luu\\s*post|bookmark)",
  };

  // Rewards: avoid bare "code"/"qua"/"link" alone in soft patterns — use REWARD_STRONG for share
  const REWARD =
    "(?:file|tài\\s*liệu|tai\\s*lieu|document|pdf|ebook|sách|sach|template|mẫu|mau|prompt|mã\\s*nguồn|ma\\s*nguon|source\\s*code|github|repo|download|tải\\s*(?:về|xuống|miễn\\s*phí|mien\\s*phi)|hướng\\s*dẫn|huong\\s*dan|tool|công\\s*cụ|cong\\s*cu|quà\\b|gift|bonus|voucher|coupon|mã\\s*giảm|ma\\s*giam|license|full\\s*bài|full\\s*bai|nội\\s*dung\\s*full|noi\\s*dung\\s*full|bản\\s*full|ban\\s*full|slide|pptx|excel|sheet|notion|ggdrive|google\\s*drive|dropbox|mega|pass(?:word)?|đáp\\s*án|dap\\s*an|checklist|workbook|course|khóa\\s*học|khoa\\s*hoc|membership|premium|vip|tài\\s*khoản|tai\\s*khoan|freebie|miễn\\s*phí|mien\\s*phi|bộ\\s*tài\\s*liệu|bo\\s*tai\\s*lieu|pack|bundle|link\\s*(?:drive|full|free|tài|tai|pdf|file)|url)";

  // Stronger rewards for share gates (bare "link" alone is too common in posts)
  const REWARD_SHARE =
    "(?:file|tài\\s*liệu|tai\\s*lieu|pdf|ebook|prompt|template|mẫu|mau|mã\\s*nguồn|github|drive|ggdrive|dropbox|mega|notion|quà\\b|gift|voucher|coupon|khóa\\s*học|khoa\\s*hoc|vip|premium|full\\s*(?:bài|bai|file|pack)|link\\s*(?:drive|full|free|pdf|file|tài|tai)|freebie|miễn\\s*phí|mien\\s*phi)";

  // Delivery / "get reward" verbs — keep distinct from ACTION verbs to avoid FP
  const DELIVER =
    "(?:nhận|nhan|lấy|lay|xin|gửi|gui|send|inbox|ib|dm|pm|mess(?:age)?|nhắn|nhan\\s*tin|gửi\\s*(?:qua|trong|ngay)|mình\\s*gửi|tôi\\s*gửi|toi\\s*gui|admin\\s*gửi|ad\\s*gửi|bot\\s*gửi|get|receive|give|ib\\s*ngay|gửi\\s*free|i'?ll\\s*send|will\\s*send)";

  // Connectors — NEVER bare "de"/"để" (matches "để học", "để dùng", "để ngay bình luận",
  // and ASCII "de" inside description/video/shared…). Soft gates must say get/receive.
  const CONNECTOR =
    "(?:để\\s*nhận|de\\s*nhan|để\\s*lấy|de\\s*lay|rồi\\s*nhận|roi\\s*nhan|→|->|=>|to\\s*get|and\\s*(?:i'?ll|we'?ll)?\\s*(?:send|dm|inbox)|for\\s*(?:the\\s*)?(?:free|file))";

  const actionsFound = [];
  const rewardsFound = [];
  let best = null;
  let bestScore = 0;

  const noteAction = (name) => {
    if (!actionsFound.includes(name)) actionsFound.push(name);
  };
  const noteReward = (name) => {
    if (!rewardsFound.includes(name)) rewardsFound.push(name);
  };

  // Infer reward labels from matched text slice
  const harvestRewards = (slice) => {
    if (/link|url|linh|drive|dropbox|mega|notion/i.test(slice)) noteReward("link");
    if (/file|pdf|pptx|excel|sheet|tài liệu|tai lieu|document|docs?/i.test(slice))
      noteReward("file");
    if (/prompt|template|mẫu|mau|checklist|workbook/i.test(slice)) noteReward("template");
    if (/mã nguồn|ma nguon|source|github|repo|code/i.test(slice)) noteReward("code");
    if (/quà|qua|gift|bonus|voucher|coupon|deal/i.test(slice)) noteReward("gift");
    if (/vip|premium|membership|khóa học|khoa hoc|course|acc(?:ount)?|tài khoản/i.test(slice))
      noteReward("access");
    if (/pass(?:word)?|mk|key|license|đáp án|dap an/i.test(slice)) noteReward("secret");
  };

  const tryHit = (reason, score, pattern, actionNames) => {
    const m = scan.match(pattern);
    if (!m) return;
    const sample = (m[0] || "").slice(0, 120);
    harvestRewards(sample);
    for (const a of actionNames) noteAction(a);
    if (score > bestScore) {
      bestScore = score;
      best = {
        reason,
        pattern: pattern.source || String(pattern),
        sample,
        confidence: score,
      };
    }
  };

  // ── 1) COMMENT gates (highest volume on VN Facebook) ───────────────
  // Prefer non-\b boundaries for Vietnamese tokens (JS \b is ASCII-only).
  const cmt = ACTION.comment;
  tryHit(
    "comment_gate",
    94,
    new RegExp(
      `(?:${cmt}).{0,60}(?:để\\s*nhận|de\\s*nhan|để\\s*lấy|→|->|=>).{0,70}(?:${REWARD})`,
      "i",
    ),
    ["comment"],
  );
  tryHit(
    "comment_gate",
    93,
    new RegExp(
      // Require deliver after reward — not "cmt" leftover near unrelated "file…gửi".
      `(?:${cmt}).{0,40}(?:${REWARD}).{0,50}(?:${DELIVER}|inbox|\\bib\\b|dm)`,
      "i",
    ),
    ["comment"],
  );
  tryHit(
    "comment_gate",
    92,
    new RegExp(
      // Want+reward must end in imperative cmt + deliver cue (not bare "comment đi").
      `(?:muốn|muon|cần|\\bcan\\b|lấy|lay|nhận|nhan|xin|muốn\\s*xin).{0,40}(?:${REWARD}).{0,45}(?:để\\s*lại|de\\s*lai|thì\\s*)?(?:${cmt}).{0,40}(?:${DELIVER}|mình|toi|tôi|ad|admin|bot)`,
      "i",
    ),
    ["comment"],
  );
  tryHit(
    "comment_gate",
    91,
    // Imperative "cmt/để lại …" cue only — plain "bình luận" near "xin link"
    // is common in activity headers and comment threads.
    /(?:để\s*lại|de\s*lai|comment|cmt)\b.{0,40}\b(?:một\s*dấu\s*chấm|dấu\s*chấm|số\s*1|so\s*1|từ\s*khóa|tu\s*khoa|keyword|quan\s*tâm|quan\s*tam|interested|xin\s*link|"link"|'link'|✅|✔️)\b/i,
    ["comment"],
  );
  tryHit(
    "comment_gate",
    90,
    new RegExp(
      `\\b(?:ai|bạn\\s*nào|ban\\s*nao|mọi\\s*người|moi\\s*nguoi|everyone|anyone|ae|anh\\s*em)\\b.{0,55}\\b${cmt}\\b.{0,70}\\b(?:mình|tôi|toi|bot|admin|ad)\\b.{0,40}\\b(?:${DELIVER})\\b`,
      "i",
    ),
    ["comment"],
  );
  tryHit(
    "comment_gate",
    90,
    new RegExp(
      // Avoid bare "bình luận" + "link" (action bar / thread chrome).
      `(?:để\\s*lại|de\\s*lai|comment|cmt)\\s*[.:+\\-–—]?\\s*(?:quan\\s*tâm|quan\\s*tam|xin\\s*link|\"link\"|'link'|inbox|ib|nhận\\s*(?:tài\\s*liệu|file|prompt|template)|nhan\\s*(?:tai\\s*lieu|file|prompt))`,
      "i",
    ),
    ["comment"],
  );
  tryHit(
    "comment_gate",
    90,
    new RegExp(
      `\\b(?:để\\s*lại|de\\s*lai|comment|cmt)\\b.{0,35}\\b(?:email|gmail|mail|sđt|sdt|zalo|telegram|tg)\\b.{0,70}\\b(?:${DELIVER}|${REWARD})\\b`,
      "i",
    ),
    ["comment"],
  );
  tryHit(
    "comment_gate",
    90,
    /\b(?:drop|leave)\b.{0,30}\b(?:a\s+)?(?:comment|email|keyword|\"interested\"|interested|link)\b.{0,70}\b(?:send|share|dm|inbox|get|receive|i'?ll\s+send)\b/i,
    ["comment"],
  );
  tryHit(
    "comment_gate",
    90,
    /\bcomment\s+[\"']?(done|interested|link|me|yes|yes\s*please)[\"']?.{0,50}\b(?:send|dm|inbox|link|file)\b/i,
    ["comment"],
  );
  // VN teencode: "cmt '1' / cmt số 1 / cmt quan tâm mình ib"
  tryHit(
    "comment_gate",
    92,
    /(?:cmt|comment|bình\s*luận|binh\s*luan)\s*[\"'“”]?\s*(?:1|số\s*1|so\s*1|quan\s*tâm|quan\s*tam|xin|link|done|yes|em|mình\s*cần|toi\s*can)\s*[\"'“”]?.{0,60}(?:ib|inbox|dm|gửi|gui|nhận|nhan|mình\s*(?:gửi|gui|ib)|ad\s*(?:gửi|gui|ib))/i,
    ["comment"],
  );
  tryHit(
    "comment_gate",
    91,
    /(?:ai|bạn\s*nào|ban\s*nao|ae|anh\s*em|mọi\s*người|moi\s*nguoi).{0,40}(?:cần|\bcan\b|muốn|muon|xin|lấy|lay).{0,40}(?:link|file|tài\s*liệu|tai\s*lieu|prompt|template).{0,40}(?:để\s*lại|de\s*lai|thì\s*)?(?:cmt|comment|bình\s*luận).{0,40}(?:gửi|gui|ib|inbox|dm|mình|ad|admin)/i,
    ["comment"],
  );
  tryHit(
    "comment_gate",
    90,
    /(?:để\s*lại|de\s*lai|comment|cmt).{0,30}(?:từ\s*khóa|tu\s*khoa|keyword|chữ|chu).{0,50}(?:nhận|nhan|lấy|lay|gửi|gui|ib|inbox)/i,
    ["comment"],
  );
  tryHit(
    "comment_gate",
    90,
    /(?:cmt|comment).{0,20}(?:bên\s*dưới|ben\s*duoi|phía\s*dưới|phia\s*duoi|below).{0,50}(?:mình|toi|tôi|ad|admin).{0,30}(?:gửi|gui|ib|inbox|dm)/i,
    ["comment"],
  );
  tryHit(
    "comment_gate",
    90,
    /\b(?:type|write|comment)\b.{0,25}\b(?:[\"']?(?:yes|done|interested|link|me)[\"']?)\b.{0,60}\b(?:i'?ll|will|we'?ll)?\s*(?:send|dm|inbox|share)\b/i,
    ["comment"],
  );
  tryHit(
    "comment_gate",
    90,
    /(?:inbox|ib|dm)\s*[\"'“”]?\s*(?:link|xin|quan\s*tâm|quan\s*tam|1|file|prompt)\s*[\"'“”]?.{0,50}(?:nhận|nhan|gửi|gui|lấy|lay)/i,
    ["comment"],
  );

  // ── 2) LIKE / REACT gates ──────────────────────────────────────────
  const like = ACTION.like;
  tryHit(
    "like_gate",
    90,
    new RegExp(
      // Require get/receive connector — bare "để" FPs on "Thích … để học … GitHub".
      `(?:${like}).{0,70}(?:${CONNECTOR}|để\\s*lấy|de\\s*lay).{0,90}(?:${REWARD})`,
      "i",
    ),
    ["like"],
  );
  tryHit(
    "like_gate",
    90,
    new RegExp(
      `(?:muốn|muon|cần|\\bcan\\b|lấy|lay|nhận|nhan|xin).{0,40}(?:${REWARD}).{0,45}(?:thì\\s*)?(?:${like}).{0,40}(?:${DELIVER}|${CONNECTOR}|mình|ad|admin)`,
      "i",
    ),
    ["like"],
  );
  tryHit(
    "like_gate",
    91,
    new RegExp(
      `(?:${like}).{0,40}\\+\\s*(?:${cmt}).{0,60}(?:${REWARD})`,
      "i",
    ),
    ["like", "comment"],
  );
  tryHit(
    "like_gate",
    90,
    /(?:thả\s*❤|tha\s*tim|thả\s*tim|❤️|❤|🔥|tym).{0,50}(?:nhận|nhan|lấy|lay|xin|để\s*nhận|de\s*nhan|inbox|ib).{0,50}(?:link|file|tài\s*liệu|tai\s*lieu|prompt|quà|qua)/i,
    ["like"],
  );
  tryHit(
    "like_gate",
    90,
    /(?:bấm|bam|nhấn|nhan|click)\s*(?:like|thích|thik|❤|❤️).{0,50}(?:để\s*nhận|de\s*nhan|để\s*lấy|de\s*lay|nhận|nhan|lấy|lay|xin).{0,50}(?:link|file|tài\s*liệu|prompt|quà)/i,
    ["like"],
  );
  tryHit(
    "like_gate",
    90,
    /\b(?:react|drop)\b.{0,20}(?:❤|❤️|🔥|❤️‍🔥|love|like).{0,50}\b(?:to\s+get|for\s+(?:the\s+)?(?:free|file)|and\s+(?:i'?ll\s+)?(?:send|dm))\b/i,
    ["like"],
  );

  // ── 3) SHARE gates (STRICT — bare "share" + "link" is normal FB UI) ──
  // Require: share/public/story/screenshot + clear get-reward intent
  const share = ACTION.share;
  tryHit(
    "share_gate",
    93,
    new RegExp(
      `(?:${share}).{0,40}(?:public|công\\s*khai|cong\\s*khai|lên\\s*story|len\\s*story|story).{0,50}(?:để\\s*nhận|de\\s*nhan|nhận|nhan|inbox|ib|lấy|lay).{0,40}(?:${REWARD_SHARE})`,
      "i",
    ),
    ["share"],
  );
  tryHit(
    "share_gate",
    92,
    new RegExp(
      `(?:${share}).{0,30}(?:để\\s*nhận|de\\s*nhan|để\\s*lấy).{0,50}(?:${REWARD_SHARE})`,
      "i",
    ),
    ["share"],
  );
  tryHit(
    "share_gate",
    91,
    new RegExp(
      `(?:muốn|muon|cần|\\bcan\\b|xin).{0,30}(?:${REWARD_SHARE}).{0,40}(?:thì\\s*)?(?:${share}).{0,20}(?:public|story|công\\s*khai).{0,40}(?:${DELIVER}|${CONNECTOR}|nhận|nhan)?`,
      "i",
    ),
    ["share"],
  );
  tryHit(
    "share_gate",
    90,
    /\bshare\s+(?:this\s+)?(?:post|reel|video).{0,40}\b(?:to\s+get|and\s+(?:i'?ll\s+)?send|dm\s+me|inbox)\b.{0,30}\b(?:file|ebook|pdf|link|template|prompt)\b/i,
    ["share"],
  );
  tryHit(
    "share_gate",
    90,
    new RegExp(
      `(?:chia\\s*sẻ|chia\\s*se|share).{0,30}(?:screenshot|chụp\\s*màn|chup\\s*man|bằng\\s*chứng|bang\\s*chung).{0,40}(?:nhận|nhan|gửi|gui|ib).{0,30}(?:${REWARD_SHARE})`,
      "i",
    ),
    ["share"],
  );

  // ── 4) FOLLOW / SUBSCRIBE gates ────────────────────────────────────
  const follow = ACTION.follow;
  tryHit(
    "follow_gate",
    91,
    new RegExp(
      `(?:${follow}).{0,60}(?:${CONNECTOR}|→|->|=>).{0,80}(?:${REWARD})`,
      "i",
    ),
    ["follow"],
  );
  tryHit(
    "follow_gate",
    90,
    new RegExp(
      `(?:muốn|muon|cần|\\bcan\\b|lấy|lay|nhận|nhan|xin).{0,40}(?:${REWARD}).{0,45}(?:thì\\s*)?(?:${follow}).{0,35}(?:${DELIVER}|${CONNECTOR}|mình|ad)?`,
      "i",
    ),
    ["follow"],
  );
  tryHit(
    "follow_gate",
    90,
    /\bfollow\s+(?:me|us|page|my\s+page).{0,50}\b(?:to\s+get|and\s+(?:i'?ll\s+)?(?:send|dm)|for\s+(?:the\s+)?(?:free|file|link))\b/i,
    ["follow"],
  );

  // ── 5) TAG / MENTION gates ─────────────────────────────────────────
  // Note: JS \b is ASCII-only — avoid relying on \b around Vietnamese tokens.
  const tag = ACTION.tag;
  tryHit(
    "tag_gate",
    91,
    new RegExp(
      `(?:${tag}).{0,50}(?:bạn|ban|bạn\\s*bè|ban\\s*be|friends?|người|\\d+\\s*bạn).{0,55}(?:${CONNECTOR}|${DELIVER}).{0,40}(?:${REWARD})`,
      "i",
    ),
    ["tag"],
  );
  tryHit(
    "tag_gate",
    90,
    /(?:tag|gắn\s*thẻ|gan\s*the|mention).{0,40}(?:\d+\s*)?(?:bạn|ban|friends?).{0,40}(?:để\s*nhận|de\s*nhan|để\s*lấy|de\s*lay|nhận|nhan|lấy|lay|xin).{0,40}(?:link|file|quà|qua|gift|tài\s*liệu|prompt)/i,
    ["tag"],
  );
  tryHit(
    "tag_gate",
    90,
    new RegExp(
      `(?:muốn|muon|cần|\\bcan\\b|lấy|lay|nhận|nhan).{0,40}(?:${REWARD}).{0,45}(?:thì\\s*)?(?:${tag}).{0,35}(?:${DELIVER}|${CONNECTOR}|mình|ad)?`,
      "i",
    ),
    ["tag"],
  );

  // ── 6) JOIN GROUP gates ────────────────────────────────────────────
  const join = ACTION.join;
  tryHit(
    "join_gate",
    91,
    new RegExp(
      // Community "join để nhận tài liệu hàng tuần" is often legit — require
      // downloadable bait or inbox delivery, not bare "tài liệu".
      `(?:${join}).{0,50}(?:${CONNECTOR}|→|->).{0,60}(?:file|pdf|ebook|prompt|template|mẫu|mau|drive|ggdrive|notion|vip|premium|full\\s*(?:bài|bai|file|pack)|miễn\\s*phí|mien\\s*phi|quà\\b|gift|voucher)`,
      "i",
    ),
    ["join"],
  );
  tryHit(
    "join_gate",
    90,
    new RegExp(
      `(?:muốn|muon|cần|\\bcan\\b|lấy|lay|nhận|nhan).{0,40}(?:${REWARD}).{0,45}(?:thì\\s*)?(?:${join}).{0,35}(?:${DELIVER}|${CONNECTOR}|mình|ad)?`,
      "i",
    ),
    ["join"],
  );

  // ── 7) Multi-action combos (like + cmt + share) ────────────────────
  tryHit(
    "engagement_combo",
    95,
    new RegExp(
      `(?:${like}).{0,25}(?:\\+|và|va|&|and|,).{0,15}(?:${cmt}).{0,25}(?:\\+|và|va|&|and|,).{0,15}(?:${share}).{0,80}(?:${REWARD})`,
      "i",
    ),
    ["like", "comment", "share"],
  );
  tryHit(
    "engagement_combo",
    93,
    new RegExp(
      `(?:${like}).{0,20}(?:\\+|và|va|&|,).{0,12}(?:${cmt}).{0,70}(?:${DELIVER}|${REWARD})`,
      "i",
    ),
    ["like", "comment"],
  );
  tryHit(
    "engagement_combo",
    92,
    new RegExp(
      `(?:${cmt}).{0,20}(?:\\+|và|va|&|,).{0,12}(?:${share}).{0,70}(?:${DELIVER}|${REWARD})`,
      "i",
    ),
    ["comment", "share"],
  );
  tryHit(
    "engagement_combo",
    91,
    /\b(?:like|thích|thik).{0,15}(?:comment|cmt|bình\s*luận|binh\s*luan).{0,15}(?:share|chia\s*sẻ|chia\s*se).{0,40}(?:nhận|nhan|lấy|lay|inbox|ib|link|file)/i,
    ["like", "comment", "share"],
  );
  // "Like + Share + Follow để nhận..."
  tryHit(
    "engagement_combo",
    94,
    new RegExp(
      `\\b${like}\\b.{0,20}(?:\\+|và|va|&|,).{0,12}\\b${share}\\b.{0,20}(?:\\+|và|va|&|,).{0,12}\\b${follow}\\b.{0,70}\\b(?:${DELIVER}|${REWARD})\\b`,
      "i",
    ),
    ["like", "share", "follow"],
  );
  // "FL + CMT + SHARE"
  tryHit(
    "engagement_combo",
    93,
    /\b(?:fl|follow|theo\s*dõi).{0,15}(?:\+|và|va|&).{0,12}(?:cmt|comment|bình\s*luận).{0,15}(?:\+|và|va|&).{0,12}(?:share|chia\s*sẻ).{0,50}(?:nhận|nhan|lấy|lay|link|file|ib)/i,
    ["follow", "comment", "share"],
  );
  // "Tag bạn + like + cmt"
  tryHit(
    "engagement_combo",
    90,
    new RegExp(
      `\\b${tag}\\b.{0,30}(?:\\+|và|va|&|,).{0,15}\\b(?:${like}|${cmt}|${share})\\b.{0,60}\\b(?:${DELIVER}|${REWARD})\\b`,
      "i",
    ),
    ["tag"],
  );

  // ── 7b) SAVE post gates ────────────────────────────────────────────
  const save = ACTION.save;
  tryHit(
    "engagement_gate",
    84,
    new RegExp(
      `\\b${save}\\b.{0,50}(?:${CONNECTOR}|→|->).{0,70}(?:${REWARD})`,
      "i",
    ),
    ["save"],
  );

  // ── 8) Inbox / DM after any engagement verb ────────────────────────
  tryHit(
    "inbox_gate",
    88,
    new RegExp(
      `\\b(?:${cmt}|${like}|${share}|${follow}|${tag})\\b.{0,60}\\b(?:inbox|ib|dm|pm|nhắn\\s*tin|nhan\\s*tin|mess(?:age)?)\\b.{0,50}\\b${REWARD}\\b`,
      "i",
    ),
    [], // actions filled by first alt match below
  );
  // re-run a simpler multi-action harvest for inbox pattern
  if (
    /\b(?:comment|cmt|bình\s*luận|like|thích|share|chia\s*sẻ|follow|theo\s*dõi|tag)\b.{0,60}\b(?:inbox|ib|dm)\b.{0,50}\b(?:link|file|tài\s*liệu|prompt|code|quà)/i.test(
      scan,
    )
  ) {
    if (/\b(?:comment|cmt|bình\s*luận)\b/i.test(scan)) noteAction("comment");
    if (/\b(?:like|thích|thả\s*tim|react)\b/i.test(scan)) noteAction("like");
    if (/\b(?:share|chia\s*sẻ)\b/i.test(scan)) noteAction("share");
    if (/\b(?:follow|theo\s*dõi)\b/i.test(scan)) noteAction("follow");
    if (/\btag\b/i.test(scan)) noteAction("tag");
    harvestRewards(scan);
    if (!best || bestScore < 88) {
      bestScore = 88;
      best = {
        reason: "inbox_gate",
        pattern: "action+inbox+reward",
        sample: scan.slice(0, 100),
        confidence: 88,
      };
    }
  }

  // ── 9) Soft heuristic — COMMENT/LIKE only (share is too FP-prone) ──
  if (!best || bestScore < 80) {
    const actionHit = scan.match(
      new RegExp(
        `(?:${ACTION.comment}|${ACTION.like}|${ACTION.tag})`,
        "i",
      ),
    );
    const rewardHit = scan.match(new RegExp(`(?:${REWARD_SHARE})`, "i"));
    const connectorHit = scan.match(
      /(?:để\s*nhận|de\s*nhan|để\s*lấy|inbox|ib\s+ngay|mình\s*gửi|toi\s*gui)/i,
    );
    if (actionHit && rewardHit && connectorHit) {
      const a = actionHit.index || 0;
      const r = rewardHit.index || 0;
      const c = connectorHit.index || 0;
      const span = Math.max(a, r, c) - Math.min(a, r, c);
      if (span <= 120) {
        const lo = Math.min(a, r, c);
        const hi = Math.max(a, r, c);
        const slice = scan.slice(lo, hi + 40);
        if (/\b(?:comment|cmt|bình\s*luận)\b/i.test(slice)) noteAction("comment");
        if (/\b(?:like|thích|thik|react|thả\s*tim)\b/i.test(slice)) noteAction("like");
        if (/\b(?:tag|gắn\s*thẻ)\b/i.test(slice)) noteAction("tag");
        // Never soft-match share alone
        if (actionsFound.length) {
          harvestRewards(slice);
          bestScore = 80;
          best = {
            reason: "engagement_gate",
            pattern: "proximity_strict",
            sample: slice.slice(0, 120),
            confidence: 80,
          };
        }
      }
    }
  }

  // ── 10) "Làm A để nhận B" — comment/like/tag only (not bare share) ─
  if (!best || bestScore < 90) {
    const doToGet = scan.match(
      /(?:hãy|hay|cứ|cu)?\s*(?:like|thích|thik|cmt|comment|bình\s*luận|binh\s*luan|tag)\b.{0,30}(?:để\s*nhận|de\s*nhan|để\s*lấy).{0,40}(?:file|tài\s*liệu|tai\s*lieu|prompt|template|pdf|drive|quà|gift|vip|full)/i,
    );
    if (doToGet) {
      const slice = doToGet[0];
      if (/\b(?:comment|cmt|bình\s*luận)\b/i.test(slice)) noteAction("comment");
      if (/\b(?:like|thích|thik)\b/i.test(slice)) noteAction("like");
      if (/\btag\b/i.test(slice)) noteAction("tag");
      harvestRewards(slice);
      if (actionsFound.length) {
        bestScore = 91;
        best = {
          reason: "engagement_gate",
          pattern: "lam_A_de_nhan_B",
          sample: slice.slice(0, 120),
          confidence: 91,
        };
      }
    }
  }

  // Minimum confidence: soft noise discarded. Soft hits also need an
  // imperative "do X → get Y" cue so narrative/quoted bait does not hide.
  const MIN_CONF = 90;
  if (best && best.confidence < MIN_CONF) {
    best = null;
    bestScore = 0;
  }
  if (
    best &&
    best.confidence < 94 &&
    !_hasEngagementImperative(best.sample, scan)
  ) {
    best = null;
    bestScore = 0;
  }
  // Re-check meta on the matched sample (quoted scam phrases score 94).
  if (best && _isEngagementMetaDiscussion(scan)) {
    best = null;
    bestScore = 0;
  }

  if (!best || actionsFound.length === 0) {
    // Require at least one recognized action for soft hits
    if (!best) return null;
    if (actionsFound.length === 0 && best.reason === "engagement_gate") return null;
    // If high-confidence reason already implies action, default it
    if (actionsFound.length === 0) {
      if (best.reason === "comment_gate") noteAction("comment");
      else if (best.reason === "like_gate") noteAction("like");
      else if (best.reason === "share_gate") noteAction("share");
      else if (best.reason === "follow_gate") noteAction("follow");
      else if (best.reason === "tag_gate") noteAction("tag");
      else if (best.reason === "join_gate") noteAction("join");
      else if (best.reason === "inbox_gate") noteAction("comment");
      else noteAction("comment");
    }
  }

  if (!best) return null;

  // Normalize reason from detected actions
  let reason = best.reason;
  if (actionsFound.length > 1) reason = "engagement_combo";
  else if (actionsFound.includes("comment") && actionsFound.length === 1) reason = "comment_gate";
  else if (actionsFound[0] === "like") reason = "like_gate";
  else if (actionsFound[0] === "share") reason = "share_gate";
  else if (actionsFound[0] === "follow") reason = "follow_gate";
  else if (actionsFound[0] === "tag") reason = "tag_gate";
  else if (actionsFound[0] === "join") reason = "join_gate";
  else if (actionsFound[0] === "save") reason = "engagement_gate";
  else if (best.reason === "inbox_gate") reason = "inbox_gate";

  return {
    reason,
    actions: actionsFound.length ? actionsFound : ["comment"],
    rewards: rewardsFound.length ? rewardsFound : ["link"],
    confidence: Math.min(96, best.confidence || bestScore),
    pattern: best.pattern,
    sample: best.sample,
  };
}

/** @deprecated name kept for callers — delegates to engagement gate */
function _detectCommentGateText(container) {
  const hit = _detectEngagementGateText(container);
  if (!hit) return null;
  return hit;
}

function evaluatePostSignals(postEl) {
  if (!postEl) {
    return {
      isSponsored: false,
      isCommentGate: false,
      isEngagementGate: false,
      reasons: [],
      confidence: 0,
      engagementActions: [],
      engagementRewards: [],
    };
  }

  const result = {
    isSponsored: false,
    isCommentGate: false,
    isEngagementGate: false,
    reasons: [],
    confidence: 0,
    details: {},
    engagementActions: [],
    engagementRewards: [],
  };

  // === SPONSORED DETECTION (always — independent of affiliate setting) ===
  const container =
    findFeedWrapper(postEl) ||
    (postEl.getAttribute && postEl.getAttribute("role") === "article"
      ? postEl
      : _findPostContainer(postEl));

  if (container && SITE === "facebook") {
    const sponsored = detectSponsoredSignals(container);
    if (sponsored.isSponsored) {
      result.isSponsored = true;
      for (const r of sponsored.reasons) {
        if (!result.reasons.includes(r)) result.reasons.push(r);
      }
      result.confidence = Math.max(result.confidence, sponsored.confidence || 90);
      result.details.sponsored = sponsored.details || {};
    }
  }

  // === ENGAGEMENT GATE (comment/like/share/follow/tag → get link/file) ===
  if (container && !_isFacebookGroupSuggestionContainer(container)) {
    const engagementGate = _detectEngagementGateText(container);
    if (engagementGate) {
      result.isEngagementGate = true;
      // Backward-compatible: any engagement gate still flags comment-gate UI path
      result.isCommentGate = true;
      result.reasons.push(engagementGate.reason);
      if (Array.isArray(engagementGate.actions)) {
        for (const a of engagementGate.actions) {
          if (!result.reasons.includes("action_" + a)) {
            result.reasons.push("action_" + a);
          }
        }
        result.engagementActions = engagementGate.actions.slice();
      }
      if (Array.isArray(engagementGate.rewards)) {
        result.engagementRewards = engagementGate.rewards.slice();
      }
      result.confidence = Math.max(
        result.confidence,
        engagementGate.confidence || 90,
      );
      result.details.engagementGate = engagementGate;
      result.details.commentGate = engagementGate; // legacy key
    }
  }


  // Dedupe reasons
  result.reasons = [...new Set(result.reasons)];

  return result;
}

// === RELATED SOURCE DISCOVERY ===
// Gather direct evidence from the post first, then enrich a few strong outbound
// candidates through the background worker. The composer remains editable.
function _cleanRelatedUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    let value = _resolveFbRedirect(rawUrl);
    const url = new URL(value, location.href);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    for (const key of [...url.searchParams.keys()]) {
      if (
        key.startsWith("utm_") ||
        key.startsWith("__") ||
        ["fbclid", "gclid", "ref", "ref_src", "source", "si"].includes(key)
      ) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString().replace(/\?$/, "");
  } catch (_) {
    return "";
  }
}

function _classifyRelatedUrl(rawUrl, label = "", evidence = "post-link") {
  const url = _cleanRelatedUrl(rawUrl);
  if (!url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const haystack = (url + " " + label).toLowerCase();
  const socialHosts = [
    "facebook.com", "web.facebook.com", "m.facebook.com", "threads.net",
    "x.com", "twitter.com", "linkedin.com", "reddit.com",
  ];
  if (socialHosts.some((domain) => host === domain || host.endsWith("." + domain))) return null;
  const shoppingHosts = [
    "shopee.vn", "shope.ee", "lazada.vn", "tiki.vn", "sendo.vn",
    "accesstrade.vn", "invol.co",
  ];
  if (shoppingHosts.some((domain) => host === domain || host.endsWith("." + domain))) return null;

  let type = "reference";
  let score = evidence === "post-link" ? 50 : 35;
  if (/nguồn|source|website|homepage|chi tiết|tham khảo|reference|xem thêm|read more/.test(haystack)) score += 12;
  if (
    /\.(zip|rar|7z|dmg|pkg|exe|msi|apk|deb|rpm|tar|gz|pdf)$/i.test(parsed.pathname) ||
    /download|tải xuống|release|releases|asset|installer|\/archive\//.test(haystack)
  ) {
    type = "download";
    score += 35;
  } else if (host === "github.com" || host.endsWith(".github.com") || host === "gitlab.com") {
    type = "github";
    score += 45;
  } else if (/docs?|documentation|guide|tutorial|paper|arxiv\.org|demo|website|homepage/.test(haystack)) {
    type = "reference";
    score += 18;
  }
  if (evidence === "canonical" || evidence === "og:url") score += 12;
  if (evidence === "json-ld") score += 8;
  return { url, type, label: (label || "").trim().substring(0, 120), evidence, score };
}

function _collectPostOutboundLinks(element, summaryText = "") {
  const postContainer = _findPostContainer(element);
  const sharedInner = SITE === "facebook" ? _findSharedPostArticle(postContainer) : null;
  const containers = sharedInner ? [sharedInner, postContainer] : [postContainer];
  const links = [];
  for (const container of containers) {
    if (!container) continue;
    for (const anchor of container.querySelectorAll("a[href]")) {
      const label = (anchor.innerText || anchor.textContent || anchor.getAttribute("aria-label") || "").trim();
      const classified = _classifyRelatedUrl(anchor.href, label, "post-link");
      if (classified) links.push(classified);
    }
  }
  const text = [summaryText, postContainer?.innerText || ""].join("\n");
  for (const match of text.matchAll(/https?:\/\/[^\s<>"')\]}]+/gi)) {
    const classified = _classifyRelatedUrl(match[0], "", "post-text");
    if (classified) links.push(classified);
  }
  return links;
}

function _dedupeRelatedLinks(links) {
  const byUrl = new Map();
  for (const link of links) {
    if (!link || !link.url) continue;
    const previous = byUrl.get(link.url);
    if (!previous || link.score > previous.score) byUrl.set(link.url, link);
  }
  return [...byUrl.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

async function discoverRelatedSourceLinks(element, summaryText = "") {
  const sourceUrl = extractPostPermalink(element) || "";
  const directLinks = _collectPostOutboundLinks(element, summaryText);
  const pageCandidates = directLinks
    .filter((link) => link.type === "reference")
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((link) => link.url);
  let enrichedLinks = [];
  if (pageCandidates.length > 0) {
    try {
      const response = await Promise.race([
        chrome.runtime.sendMessage({
          action: "enrich-related-source-links",
          urls: pageCandidates,
        }),
        new Promise((resolve) => setTimeout(() => resolve({ links: [] }), 9000)),
      ]);
      enrichedLinks = (response?.links || [])
        .map((link) => _classifyRelatedUrl(link.url, link.label, link.evidence))
        .filter(Boolean);
    } catch (_) {}
  }
  return { sourceUrl, relatedLinks: _dedupeRelatedLinks([...directLinks, ...enrichedLinks]) };
}

// Display modes for blocked content
const DISPLAY_MODES = {
  HIDE: "hide",       // Completely hidden
  COLLAPSE: "collapse", // Show indicator with reason
  MARK: "mark",       // Just highlight, don't hide
};

window.fbsExtractPermalink = extractPostPermalink;
window.fbsExtractAuthor = extractPostAuthor;
window.fbsExtractSource = extractPostSource;
window.fbsExtractMeta = extractPostMeta;
window.fbsIsStrongFbPermalink = _isStrongFbPermalink;
window.fbsIsWeakFbShellUrl = _isWeakFbShellUrl;
window.fbsIsBareFbPhotoShell = _isBareFbPhotoShell;
window.fbsPermalinkFamilyRank = _permalinkFamilyRank;
window.fbsCleanFbUrl = _cleanFbUrl;
window.fbsExtractImage = extractPostImage;
window.fbsExtractImages = extractPostImages;
window.fbsExtractPostContent = extractPostContent;
window.fbsEvaluatePostSignals = evaluatePostSignals;
window.fbsDetectSponsoredSignals = detectSponsoredSignals;
window.fbsDetectSponsoredSignalsLight = detectSponsoredSignalsLight;
window.fbsIsSponsored = isSponsored;
window.fbsDiscoverRelatedSourceLinks = discoverRelatedSourceLinks;
window.fbsCleanRelatedUrl = _cleanRelatedUrl;
window.fbsClassifyRelatedUrl = _classifyRelatedUrl;
window.fbsIsCommentActivityText = _fbIsCommentActivityText;
window.fbsIsGroupSuggestion = _isFacebookGroupSuggestionContainer;
window.fbsIsContentOnlyPostSlice = _isContentOnlyPostSlice;
window.fbsExpandToFullPostCard = _expandToFullPostCard;
window.fbsFindFeedWrapper = findFeedWrapper;
window.fbsDisplayModes = DISPLAY_MODES;
