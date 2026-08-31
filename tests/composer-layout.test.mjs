import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(root, "ui.css"), "utf8");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const composer = fs.readFileSync(path.join(root, "content-composer.js"), "utf8");
const composerRuntime = fs.readFileSync(path.join(root, "content-composer-runtime.js"), "utf8");
const contentDom = fs.readFileSync(path.join(root, "content-dom.js"), "utf8");
const contentDomRuntime = fs.readFileSync(path.join(root, "content-dom-runtime.js"), "utf8");
const popup = fs.readFileSync(path.join(root, "popup.html"), "utf8");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");

describe("Facebook composer panel layout", () => {
  it("uses a readable width and constrained height on desktop", () => {
    assert.match(css, /\.fbs-panel-left\.is-composer/);
    assert.match(css, /width:\s*min\(400px, calc\(100vw - 32px\)\)\s*!important/);
    assert.match(css, /max-height:\s*min\(68vh, 640px\)\s*!important/);
    assert.match(css, /transform:\s*translateY\(-50%\)\s*!important/);
    assert.match(css, /grid-template-columns:\s*1fr 1fr 31px\s*!important/);
    assert.match(css, /grid-column:\s*1 \/ -1\s*!important/);
  });

  it("hides the selection toolbar while a native composer editor is open", () => {
    assert.match(css, /body:has\(:is\(/);
    assert.match(css, /\[role="dialog"\] \[contenteditable="true"\]/);
    assert.match(css, /\[role="dialog"\] \[data-lexical-editor="true"\]/);
    assert.match(css, /\.fbs-floating-toolbar\s*\{\s*display:\s*none\s*!important/);
  });
});

describe("Facebook personal-profile exclusion", () => {
  it("suppresses summary controls and selection actions on personal profiles", () => {
    assert.match(content, /function isFacebookPersonalProfileHome\(\)/);
    assert.match(content, /\^\(bạn bè\|friends\)\$/i);
    assert.match(content, /if \(isFacebookPersonalProfileHome\(\)\) \{\s*removePersonalProfileControls\(\);\s*return;/);
  });
});

describe("Feed scanning cost controls", () => {
  it("observes only the feed root and reacts only to added feed units", () => {
    assert.match(content, /function _discoverFeedUnitsForObserver/);
    assert.match(content, /IntersectionObserver/);
    assert.match(content, /fbsViewportScanned/);
    assert.match(content, /SCAN_DEBOUNCE_MS = SITE === "facebook" \? 4000 : 400/);
    assert.match(content, /function _cheapPostStamp/);
    assert.match(content, /fbsSponsoredChecked/);
    assert.match(content, /if \(!filterEngagementGates\) return/);
    assert.match(content, /_pendingFeedPosts/);
    assert.match(content, /function injectSummaryOnPosts/);
    assert.match(content, /detectSponsoredSignalsLight|fbsDetectSponsoredSignalsLight/);
    assert.match(contentDom, /function detectSponsoredSignalsLight/);
    assert.match(contentDom, /fbsDetectSponsoredSignalsLight/);
    assert.match(contentDom, /function _findFacebookAdRenderingUnit/);
    assert.match(contentDom, /\[data-ad-rendering-role="profile_name"\]/);
    assert.match(contentDom, /\[data-ad-rendering-role="story_message"\]/);
    assert.match(contentDom, /\[data-ad-rendering-role\^="cta-"\]/);
    assert.match(contentDom, /ad_rendering_signature/);
    assert.match(content, /_isFbScrollBusy/);
    assert.match(content, /_markFbScrollBusy/);
    assert.match(content, /FB_SCROLL_IDLE_MS/);
    assert.match(content, /FB_PENDING_POSTS_PER_FRAME = 2/);
    assert.match(content, /FB_SUMMARY_POSTS_PER_FRAME = 1/);
    assert.match(content, /function _flushVisibleSummaryPosts/);
    assert.match(content, /allowDuringScroll: true/);
    assert.match(content, /rootMargin: "360px 0px"/);
    assert.match(content, /FB_DISCOVERY_FALLBACK_MS = 8000/);
    assert.match(content, /feedRootObserver\.observe\(root, \{ childList: true \}\)/);
    assert.match(content, /pendingFeedRootAdditions/);
    assert.match(content, /Queue only — Facebook may append cards while kinetic scrolling/);
    assert.match(content, /Summary controls have their own one-card-per-frame fast path/);
    assert.match(content, /const limit = _isFbScrollBusy\(\) \? 1 : 8/);
    assert.match(
      content,
      /getComputedStyle\/innerText can force layout[\s\S]{0,180}if \(_isFbScrollBusy\(\)\) return;/,
    );
    assert.match(
      content,
      /Facebook: no subtree MutationObserver on the feed/,
    );
    assert.match(content, /if \(SITE !== "facebook"\) \{/);
  });

  it("discovers wrapped X tweets and marker-less Facebook feed children", () => {
    // X wraps each tweet in a plain div — the observer must probe descendants.
    assert.match(content, /node\.querySelector\?\.\(feedTargetSelector\)/);
    // Facebook builds without FeedUnit/virtualized markers: direct feed kids.
    assert.match(content, /parentElement\?\.getAttribute\("role"\) === "feed"/);
    assert.match(content, /querySelectorAll\('div\[role="feed"\] > div'\)/);
    // Repeat X scans skip settled tweets before the controls walk.
    assert.match(content, /\.fbs-wrap-inline\[data-fbs-ui="v3"\]'\)\) continue;/);
  });

  it("keeps expensive feed discovery sparse and avoids cloning post bodies for the length gate", () => {
    const facebookBoot = content.slice(
      content.indexOf('// Boot: discover quickly'),
      content.indexOf('scanTimer = setInterval'),
    );
    assert.match(facebookBoot, /\}, FB_DISCOVERY_FALLBACK_MS\);/);
    assert.doesNotMatch(facebookBoot, /\}, 1500\);/);
    assert.match(content, /textContent is\s*\n\s*\/\/ sufficient for the length gate/);
    assert.doesNotMatch(
      content,
      /function _statusBodyTextLength\(textEl\)[\s\S]{0,600}cloneNode\(true\)/,
    );
    const viewportFingerprint = content.slice(
      content.indexOf("function _viewportFingerprint"),
      content.indexOf("function _isViewportScanCurrent"),
    );
    assert.match(viewportFingerprint, /textContent/);
    assert.doesNotMatch(viewportFingerprint, /innerText/);

    const facebookStatusFinder = content.slice(
      content.indexOf("function _findFacebookStatusText"),
      content.indexOf("function _mountInlineStatusChip"),
    );
    assert.match(facebookStatusFinder, /querySelectorAll\(FB_POST_BODY_SELECTOR\)/);
    assert.doesNotMatch(facebookStatusFinder, /innerText/);
  });
});

describe("Feed false-positive safeguards", () => {
  it("resets filter state when Facebook recycles a feed node", () => {
    assert.match(content, /function refreshReusedFeedUnit\(article\)/);
    assert.match(content, /function _markFilteredCluster\(/);
    assert.match(content, /function _isAlreadyFiltered\(/);
    assert.match(content, /dataset\.fbsFiltered/);
    assert.match(content, /_clearFilteredCluster\(article\)/);
    assert.match(content, /_filterFingerprint\(article\)/);
  });

  it("keeps sponsored posts recoverable and engagement filtering opt-in", () => {
    assert.match(content, /let adDisplayMode = "collapse"/);
    assert.match(content, /let filterEngagementGates = false/);
    assert.match(content, /if \(!filterEngagementGates\) return/);
    assert.match(content, /ENGAGEMENT_HIDE_MIN_CONFIDENCE/);
    assert.match(content, /function _uniqueFeedPosts/);
    assert.match(contentDom, /isSponsored: confidence >= 90/);
    assert.match(contentDom, /confidence = Math\.max\(confidence, 80\)/);
    assert.match(contentDom, /function _isEngagementMetaDiscussion/);
    assert.match(contentDom, /const MIN_CONF = 90/);
    assert.ok(!popup.includes('<option value="hide" selected>Ẩn hoàn toàn</option>'));
  });

  it("excludes group-suggestion shelves from filtering and summary controls", () => {
    assert.match(contentDom, /const FB_GROUP_SUGGESTION_LABELS/);
    assert.match(contentDom, /function _isFacebookGroupSuggestionContainer\(element\)/);
    assert.match(contentDom, /container && !_isFacebookGroupSuggestionContainer\(container\)/);
    assert.match(content, /function _removeGroupSuggestionControls\(element\)/);
    assert.match(content, /if \(_isFacebookGroupSuggestion\(article\)\)/);
    assert.match(content, /if \(_isFacebookGroupSuggestion\(sm\)\) return;/);
  });

  it("only adds Facebook summary controls inside semantic post bodies", () => {
    assert.match(content, /const FB_POST_BODY_SELECTOR/);
    assert.match(content, /function _findFacebookPostBodyFrom\(element\)/);
    assert.match(content, /SITE === "facebook" && !_findFacebookPostBodyFrom\(el\)/);
    assert.match(content, /SITE === "facebook" && !postBody\) return;/);
    assert.match(content, /SITE === "facebook" && !_findFacebookStatusText\(el\)\) continue;/);
  });

  it("does not ship retired affiliate detection helpers", () => {
    assert.doesNotMatch(contentDomRuntime, /AFFILIATE_DOMAINS/);
    assert.doesNotMatch(contentDomRuntime, /_detectAffiliateUrl/);
  });
});

describe("Feed summary control density", () => {
  it("keeps summary controls visually secondary to Facebook content", () => {
    assert.match(css, /\.fbs-btn-inline\.fbs-summary-action\[data-fbs-ui="v3"\]\[data-fbs-summary-ui="text-v3"\][\s\S]*?display:\s*inline\s*!important/);
    assert.match(css, /\.fbs-btn-inline\.fbs-summary-action\[data-fbs-ui="v3"\]\[data-fbs-summary-ui="text-v3"\][\s\S]*?height:\s*auto\s*!important/);
    assert.match(css, /\.fbs-btn-inline\.fbs-summary-action\[data-fbs-ui="v3"\]\[data-fbs-summary-ui="text-v3"\][\s\S]*?background:\s*transparent\s*!important/);
    assert.match(css, /\.fbs-wrap\[data-fbs-theme="light"\] \.fbs-btn-inline\.fbs-summary-action[\s\S]*?color:\s*#39726d\s*!important/);
    assert.match(css, /\.fbs-wrap-inline\[data-fbs-ui="v3"\][\s\S]*?margin:\s*0\s*!important/);
    assert.match(css, /button\.fbs-allpost-btn[\s\S]*?height:\s*auto\s*!important/);
    assert.doesNotMatch(css, /\.fbs-summary-row \.fbs-btn-inline > span[\s\S]*?var\(--fw-accent\)/);
  });

  it("uses one compact text-action summary control with dialog semantics", () => {
    const inlineFactory = content.slice(
      content.indexOf("function summaryActionMarkup"),
      content.indexOf("// === POST METADATA EXTRACTION ==="),
    );
    assert.match(inlineFactory, /labelClass = "fbs-inline-label"/);
    assert.match(inlineFactory, /fbs-summary-action/);
    assert.match(inlineFactory, /data-fbs-summary-ui/);
    assert.doesNotMatch(inlineFactory, /fbs-summary-action-icon/);
    assert.match(inlineFactory, /aria-label", "Tóm tắt bài viết"/);
    assert.match(inlineFactory, /aria-haspopup", "dialog"/);
    assert.doesNotMatch(inlineFactory, /ICON_BASE64/);
  });

  it("replaces stale feed controls after an extension reload", () => {
    assert.match(content, /const SUMMARY_UI_VERSION = "text-v3"/);
    assert.match(
      content,
      /\.fbs-summary-control:not\(\[data-fbs-summary-ui=/,
    );
    assert.match(content, /currentControl\) return/);
    assert.match(
      css,
      /\[data-fbs-summary-ui="text-v3"\][\s\S]*?height:\s*auto\s*!important/,
    );
  });

  it("places Facebook inline summaries immediately after See more", () => {
    assert.match(content, /function _matchInlineBtnTypography\(btn, refEl\)/);
    assert.match(content, /_matchInlineBtnTypography\(btnNode, afterEl\)/);
    assert.match(content, /afterEl\.parentElement\.insertBefore\(wrap, afterEl\.nextSibling\)/);
    assert.doesNotMatch(content, /sep\.className = "fbs-inline-sep"/);
    assert.match(content, /data-fbs-anchor", "see-more"/);
    assert.match(css, /\[data-fbs-summary-ui="text-v3"\]\[data-fbs-anchor="see-more"\]::before[\s\S]*?content:\s*" · "\s*!important/);
  });

  it("restores the summary control after Facebook replaces See more", () => {
    assert.match(content, /function _handleFacebookSeeMoreClick\(event\)/);
    assert.match(content, /document\.addEventListener\("click", _handleFacebookSeeMoreClick, true\)/);
    assert.match(content, /for \(const delay of \[0, 80, 240\]\)/);
    assert.match(content, /_pendingSummaryPosts\.add\(post\)/);
    assert.match(
      content,
      /\(SITE === "facebook" && _findFacebookStatusText\(post\)\)/,
    );
  });

  it("keeps full Facebook summaries inline without adding a blank row", () => {
    assert.doesNotMatch(content, /const isFacebookRow = SITE === "facebook"/);
    assert.doesNotMatch(content, /fbs-summary-row/);
    assert.match(content, /function _findFacebookInlineTextLeaf\(textEl\)/);
    assert.match(content, /const inlineHost = _findFacebookInlineTextLeaf\(textEl\)/);
    assert.match(content, /inlineHost\.appendChild\(wrap\)/);
    assert.match(content, /data-fbs-anchor", "status-end"/);
    assert.match(
      css,
      /\[data-fbs-anchor="status-end"\]::before[\s\S]*?content:\s*"\\00a0"\s*!important/,
    );
    assert.doesNotMatch(css, /\.fbs-summary-row\[data-fbs-ui="v3"\]/);
    assert.match(css, /\.fbs-wrap:not\(\.fbs-wrap-inline\)/);
  });

  it("anchors full-post actions to the final real Facebook text leaf", () => {
    const helperSource = content.slice(
      content.indexOf("function _findFacebookInlineTextLeaf"),
      content.indexOf("function _findSeeMoreControl"),
    );
    const context = vm.createContext({ SITE: "facebook" });
    vm.runInContext(helperSource, context);

    const candidate = (text, blocked = false) => ({
      textContent: text,
      closest(selector) {
        return blocked && selector.includes("a,") ? {} : null;
      },
    });
    const outer = candidate("Toàn bộ status");
    const finalLeaf = candidate("Đoạn cuối status");
    const linkedChrome = candidate("Liên kết chrome", true);
    const semanticHost = {
      querySelectorAll() {
        return [outer, finalLeaf, linkedChrome];
      },
    };

    assert.equal(
      context._findFacebookInlineTextLeaf(semanticHost),
      finalLeaf,
    );
  });

  it("exposes focus and busy states on summary controls", () => {
    assert.match(content, /btn\.setAttribute\("aria-busy", "true"\)/);
    assert.match(content, /label\.textContent = "Đang tóm tắt…"/);
    assert.match(
      css,
      /\.fbs-btn-inline\[data-fbs-ui="v3"\]:focus-visible[\s\S]*?outline:\s*2px solid #0866ff/,
    );
    assert.match(
      css,
      /\.fbs-btn-inline\[data-fbs-ui="v3"\]\[aria-busy="true"\][\s\S]*?cursor:\s*progress/,
    );
  });

  it("does not mount inline summaries on short Facebook status bodies", () => {
    assert.match(content, /const SUMMARY_MIN_LEN = 30/);
    assert.match(content, /text\.length < SUMMARY_MIN_LEN/);
    assert.match(content, /best && bestLength >= SUMMARY_MIN_LEN/);
    assert.match(content, /function _statusBodyTextLength\(textEl\)/);
    assert.match(
      content,
      /!getSummaryPolicyDecision\(initialText, "summary"\)\.shouldSummarize/,
    );
    assert.match(content, /_matchInlineBtnTypography\(btn, inlineHost\)/);
    // Truncated posts with "Xem thêm" must still get Tóm tắt even when short.
    assert.match(
      content,
      /inject\(article, findClickable\(seeMore\), textEl, seeMore\)/,
    );
    assert.match(
      content,
      /_mountInlineStatusChip\(article, textEl, SUMMARY_MIN_LEN\)/,
    );
    assert.doesNotMatch(
      content,
      /if \(_statusBodyTextLength\(textEl\) >= MIN_LEN \/ 2\) \{\s*inject\(article/,
    );
  });

  it("keeps the explicit summary action available on ordinary X posts", () => {
    const scanXSource = content.slice(
      content.indexOf("function scanXPosts()"),
      content.indexOf("function scanFBAllPosts()"),
    );
    assert.match(scanXSource, /if \(text\.length < 50\) continue/);
    assert.doesNotMatch(
      scanXSource,
      /getSummaryPolicyDecision\(text, "summary"\)\.shouldSummarize/,
    );
    assert.match(content, /if \(type === "summary" && SITE !== "x"\)/);
    assert.match(
      content,
      /SITE !== "x" &&\s*!getSummaryPolicyDecision\(initialText, "summary"\)\.shouldSummarize/,
    );
    assert.match(
      background,
      /type === "summary" &&\s*site !== "x" &&\s*!summaryPolicy\.summary\.shouldSummarize/,
    );
  });

  it("refuses to hide content-only slices that leave hollow Facebook cards", () => {
    assert.match(contentDom, /function _isContentOnlyPostSlice\(el\)/);
    assert.match(contentDom, /function _expandToFullPostCard\(el\)/);
    assert.match(content, /function healHollowFeedPosts\(/);
    assert.match(content, /healHollowFeedPosts\(/);
    assert.match(content, /fbsIsContentOnlyPostSlice/);
  });
});

describe("UI system v3 contracts", () => {
  const popupCss = fs.readFileSync(path.join(root, "popup.css"), "utf8");
  const contentCss = fs.readFileSync(path.join(root, "content.css"), "utf8");

  it("keeps Facebook chip host clear of top-right native controls", () => {
    assert.match(css, /\.fbs-chip-host[^\n]*\{[\s\S]*?right:\s*104px\s*!important/);
    assert.match(css, /button\.fbs-allpost-btn[\s\S]*?opacity:\s*1\s*!important/);
  });

  it("keeps the light-theme summarize chip legible on white feed cards", () => {
    const block = css.match(/\.fbs-chip-host\[data-fbs-theme="light"\] \.fbs-allpost-btn[^{]*\{([^}]*)\}/);
    assert.ok(block, "expected light-theme chip override");
    assert.match(block[1], /background:\s*transparent\s*!important/);
    assert.match(block[1], /color:\s*#39726d\s*!important/);
    assert.match(block[1], /box-shadow:\s*none\s*!important/);
  });

  it("separates summary title, lead, body and close in the overlay", () => {
    assert.match(css, /\.fbs-result \.fbs-title-line/);
    assert.match(css, /\.fbs-result \.fbs-para/);
  });

  it("uses Be Vietnam Pro for UI and titles", () => {
    assert.match(css, /--fw-font:\s*"Be Vietnam Pro"/);
    assert.match(css, /--fw-font-display:\s*"Be Vietnam Pro"/);
    assert.match(popupCss, /--fw-font:\s*"Be Vietnam Pro"/);
    assert.match(popup, /fonts\/be-vietnam-pro\.css/);
    assert.ok(fs.existsSync(path.join(root, "fonts/BeVietnamPro-400-vietnamese.woff2")));
    assert.ok(fs.existsSync(path.join(root, "fonts/BeVietnamPro-700-vietnamese.woff2")));
  });

  it("aliases popup and content tokens to canonical --fw-*", () => {
    assert.match(popupCss, /--fw-accent:\s*#0f766e/i);
    assert.match(popupCss, /--bg:\s*var\(--fw-bg\)/);
    assert.match(popupCss, /--accent:\s*var\(--fw-accent\)/);
    assert.match(contentCss, /--fbs-accent:\s*var\(--fw-accent/);
  });

  it("rebinds popup light-theme aliases so inputs are not white-on-white", () => {
    const lightBlock = popupCss.match(/body\.light,\s*html\.light\s*\{([\s\S]*?)\n\}/);
    assert.ok(lightBlock, "expected body.light, html.light token block");
    assert.match(lightBlock[1], /--bg:\s*var\(--fw-bg\)/);
    assert.match(lightBlock[1], /--text:\s*var\(--fw-text\)/);
    assert.match(lightBlock[1], /--bg-input:\s*#ffffff/);
    assert.match(popupCss, /background-color:\s*var\(--bg-input\)/);
  });

  it("rounds the popup shell while bounding it to the viewport", () => {
    const bodyBlock = popupCss.match(/body\s*\{([\s\S]*?)\n\}/);
    assert.ok(bodyBlock, "expected popup body rule");
    assert.match(bodyBlock[1], /overflow:\s*hidden/);
    assert.match(bodyBlock[1], /height:\s*min\(600px,\s*100vh\)/);
    assert.match(bodyBlock[1], /background:\s*var\(--bg\)\s*!important/);
    assert.match(bodyBlock[1], /border-radius:\s*var\(--radius-popup/);
    assert.match(bodyBlock[1], /clip-path:\s*inset\(0 round var\(--radius-popup/);
    const htmlBlock = popupCss.match(/html\s*\{([\s\S]*?)\n\}/);
    assert.ok(htmlBlock, "expected popup html rule");
    assert.match(htmlBlock[1], /height:\s*600px/);
    assert.match(htmlBlock[1], /background:\s*transparent\s*!important/);
    assert.match(htmlBlock[1], /border-radius:\s*0/);
    assert.match(htmlBlock[1], /clip-path:\s*none/);
    assert.doesNotMatch(popupCss, /#popup-window\s*\{/);
    assert.doesNotMatch(popup, /id="popup-window"/);
    const shellBlock = popupCss.match(/#main-view,\s*[\s\S]*?\.wizard-container\s*\{([\s\S]*?)\n\}/);
    assert.ok(shellBlock, "expected popup shell rule");
    assert.match(shellBlock[1], /overflow-y:\s*hidden/);
    assert.match(shellBlock[1], /contain:\s*paint/);
    assert.match(shellBlock[1], /border-radius:\s*14px\s*!important/);
    assert.match(popupCss, /\.popup-scroll\s*\{[\s\S]*?height:\s*0/);
    assert.match(popupCss, /\.popup-scroll\s*\{[\s\S]*?flex:\s*1 1 0/);
    assert.match(popupCss, /\.popup-scroll\s*\{[\s\S]*?overflow-y:\s*auto/);
    assert.match(popupCss, /\.popup-scroll::-webkit-scrollbar\s*\{\s*width:\s*4px/);
    assert.match(popupCss, /\.settings-footer\.sticky-save\s*\{[\s\S]*?position:\s*static/);
    for (const m of popupCss.matchAll(/\.settings-footer\.sticky-save \.btn-primary[^{]*\{([^}]*)\}/g)) {
      assert.doesNotMatch(m[1], /border-radius:\s*0/, "save button must stay rounded");
    }
    // An inline display:block on #main-view collapses the flex-sized
    // .popup-scroll region to its padding; JS must defer to the CSS layout.
    const popupJs = fs.readFileSync(path.join(root, "popup.js"), "utf8");
    assert.doesNotMatch(popupJs, /mainView\.style\.display\s*=\s*"block"/);
    assert.match(popupJs, /mainView\.style\.removeProperty\("display"\)/);
    assert.match(popupCss, /#main-view\[hidden\][\s\S]*?display:\s*none\s*!important/);
  });

  it("restyles comment-summary without sage leftover and uses toolbar overflow", () => {
    assert.doesNotMatch(contentCss, /fbs-comment-summary-btn[\s\S]{0,220}#A8C0B4/);
    assert.match(content, /fbs-floating-more-menu/);
    assert.match(content, /fbs-batch-progress-live/);
    assert.match(css, /fwSheetIn/);
  });

  it("uses Vietnamese tab labels and keys-first empty state", () => {
    assert.match(popup, />Khóa API</);
    assert.match(popup, />Giới thiệu</);
    assert.match(popup, /id="wizardStep1Skip"/);
    assert.match(popup, /<button type="button" class="wizard-skip-link" id="wizardStep1Skip">/);
    const popupJs = fs.readFileSync(path.join(root, "popup.js"), "utf8");
    assert.match(popupJs, /activateTab\("apikeys"\)/);
    assert.match(popupJs, /popupScroll\.scrollTop = 0/);
  });

  it("uses distinct labels for expanded settings and feed filtering", () => {
    assert.match(popup, />Hiện thêm</);
    assert.match(popup, />Lọc feed &amp; hướng dẫn</);
    assert.match(popup, />Nguồn, template &amp; backup</);
    assert.equal((popup.match(/class="accordion advanced-accordion/g) || []).length, 2);
  });

  it("keeps floating batch bar styles owned by ui.css", () => {
    assert.doesNotMatch(contentCss, /rgba\(20,\s*10,\s*40/);
    assert.match(content, /fbs-batch-overlay-track/);
    assert.match(content, /fbs-batch-overlay-fill/);
  });

  it("focuses panel body or primary action instead of Close on open", () => {
    assert.match(content, /\.fbs-sp-open-fb/);
    assert.match(content, /primary\.focus\(\{ preventScroll: true \}\)/);
    assert.doesNotMatch(
      content.slice(content.indexOf("function openOverlay"), content.indexOf("function toggleMinimize")),
      /closeButton\.focus\(\)/,
    );
  });
});

describe("Composer source-card density", () => {
  it("keeps reference links always open and source preview open by default", () => {
    assert.match(composer, /<div class="fbs-sp-link-input fbs-sp-related-block">/);
    assert.doesNotMatch(composer, /<details class="fbs-sp-link-input fbs-sp-related-block"/);
    assert.match(composer, /<details class="fbs-sp-comment" open>/);
    assert.match(css, /\.is-composer \.fbs-status-preview[\s\S]*?border:\s*none\s*!important/);
    assert.match(css, /max-height:\s*104px\s*!important/);
  });

  it("keeps the source-copy action available when the preview is collapsed", () => {
    assert.match(
      composer,
      /"<\/details>" \+\s*'<button type="button" class="fbs-sp-copy-comment"/,
    );
  });

  it("copies the source before opening Facebook from X", () => {
    assert.match(composer, /async function copySourceComment\(\)/);
    const xBranch = composer.slice(
      composer.indexOf('if \(SITE === "x"\)'.replace(/\\/g, "")),
      composer.indexOf("// Cross-platform:", composer.indexOf('if (SITE === "x")')),
    );
    assert.ok(xBranch.indexOf("await copySourceComment()") >= 0);
    assert.ok(
      xBranch.indexOf("await copySourceComment()") <
        xBranch.indexOf('action: "open-facebook-composer"'),
    );
    assert.match(xBranch, /Đã mở Facebook — nguồn đã copy/);
    assert.match(composer, /Sẵn sàng — nguồn đã copy, bấm Đăng/);
    assert.doesNotMatch(composer, /không tự copy nguồn/);
  });

  it("materializes captured X screenshot data URLs for Facebook", () => {
    const domSource = fs.readFileSync(path.join(root, "content-dom.js"), "utf8");
    assert.match(domSource, /\^data:image\\\/\(\?:png\|jpeg\|webp\);base64,/);
    assert.match(domSource, /const response = await fetch\(imgSrc\)/);
    assert.match(domSource, /return new File\(\[blob\]/);
  });

  it("recovers GitHub destinations hidden behind X t.co anchors", () => {
    assert.match(contentDom, /function _expandedXAnchorUrls\(anchor, label = ""\)/);
    assert.match(contentDom, /data-expanded-url/);
    assert.match(contentDom, /github\\\.com\|gitlab\\\.com/);
    assert.match(contentDom, /"https:\/\/" \+ displayed/);
    const collector = contentDom.slice(
      contentDom.indexOf("function _collectPostOutboundLinks"),
      contentDom.indexOf("function _dedupeRelatedLinks"),
    );
    assert.match(collector, /_expandedXAnchorUrls\(anchor, label\)/);
    assert.match(collector, /"x-expanded-link"/);
  });
});

describe("No autonomous Facebook publishing", () => {
  it("keeps publishing behind an explicit user action", () => {
    assert.match(composer, /class="fbs-sp-open-fb"/);
    assert.doesNotMatch(composer, /window\.fbsAgentPost\s*=/);
    assert.doesNotMatch(composer, /agent-posted|legacyAutopostRemoved/);
  });

  it("does not ship archived automation code to social pages", () => {
    assert.doesNotMatch(composerRuntime, /legacyAutopostRemoved|agent-posted/);
    assert.doesNotMatch(composerRuntime, /Removed legacy autonomous posting implementation/);
  });
});
