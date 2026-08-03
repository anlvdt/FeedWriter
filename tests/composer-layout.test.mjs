import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(root, "ui.css"), "utf8");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const composer = fs.readFileSync(path.join(root, "content-composer.js"), "utf8");
const composerRuntime = fs.readFileSync(path.join(root, "content-composer-runtime.js"), "utf8");
const contentDom = fs.readFileSync(path.join(root, "content-dom.js"), "utf8");
const contentDomRuntime = fs.readFileSync(path.join(root, "content-dom-runtime.js"), "utf8");
const popup = fs.readFileSync(path.join(root, "popup.html"), "utf8");

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
    assert.match(content, /SCAN_DEBOUNCE_MS = 4000/);
    assert.match(content, /function _cheapPostStamp/);
    assert.match(content, /fbsSponsoredChecked/);
    assert.match(content, /if \(!filterEngagementGates\) return/);
    assert.match(content, /_pendingFeedPosts/);
    assert.match(content, /function injectSummaryOnPosts/);
    assert.match(content, /detectSponsoredSignalsLight|fbsDetectSponsoredSignalsLight/);
    assert.match(contentDom, /function detectSponsoredSignalsLight/);
    assert.match(contentDom, /fbsDetectSponsoredSignalsLight/);
    assert.match(content, /_isFbScrollBusy/);
    assert.match(content, /_markFbScrollBusy/);
    assert.match(content, /FB_SCROLL_IDLE_MS/);
    assert.match(content, /FB_PENDING_POSTS_PER_FRAME = 2/);
    assert.match(content, /FB_DISCOVERY_FALLBACK_MS = 8000/);
    assert.match(content, /feedRootObserver\.observe\(root, \{ childList: true \}\)/);
    assert.match(content, /pendingFeedRootAdditions/);
    assert.match(content, /Queue only — Facebook may append cards while kinetic scrolling/);
    assert.match(content, /Queue only — never flush while scrolling/);
    assert.match(
      content,
      /Facebook: no subtree MutationObserver on the feed/,
    );
    assert.match(content, /if \(SITE !== "facebook"\) \{/);
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
    assert.match(css, /\.fbs-wrap-inline \.fbs-btn-inline > span[\s\S]*?background:\s*transparent\s*!important/);
    assert.match(css, /\.fbs-wrap-inline \.fbs-btn-inline > span[\s\S]*?color:\s*var\(--fw-accent\)\s*!important/);
    assert.match(css, /\.fbs-wrap-inline \.fbs-inline-sep[\s\S]*?color:\s*var\(--fw-text-3\)\s*!important/);
    assert.match(css, /\.fbs-wrap-inline\[data-fbs-ui="v3"\][\s\S]*?margin:\s*0\s*!important/);
    assert.match(css, /button\.fbs-allpost-btn[\s\S]*?height:\s*28px\s*!important/);
    assert.match(css, /\.fbs-chip-host:hover \.fbs-allpost-btn[\s\S]*?opacity:\s*1\s*!important/);
  });

  it("uses text-only inline summary controls", () => {
    const inlineFactory = content.slice(
      content.indexOf("function createInlineBtn()"),
      content.indexOf("// === POST METADATA EXTRACTION ==="),
    );
    assert.match(inlineFactory, /d\.innerHTML\s*=\s*'<span title="Tóm tắt nội dung">Tóm tắt<\/span>'/);
    assert.doesNotMatch(inlineFactory, /ICON_BASE64/);
  });

  it("places Facebook inline summaries immediately after See more", () => {
    assert.match(content, /function _matchInlineBtnTypography\(btn, refEl\)/);
    assert.match(content, /_matchInlineBtnTypography\(btnNode, afterEl\)/);
    assert.match(content, /afterEl\.parentElement\.insertBefore\(wrap, afterEl\.nextSibling\)/);
    assert.match(content, /sep\.className = "fbs-inline-sep"/);
    assert.match(content, /sep\.textContent = " · "/);
  });

  it("does not mount inline summaries on short Facebook status bodies", () => {
    assert.match(content, /function _statusBodyTextLength\(textEl\)/);
    assert.match(
      content,
      /if \(_statusBodyTextLength\(textEl\) < minimumLength\) return;/,
    );
    assert.match(content, /_matchInlineBtnTypography\(btn, textEl\)/);
    // Truncated posts with "Xem thêm" must still get Tóm tắt even when short.
    assert.match(
      content,
      /inject\(article, findClickable\(seeMore\), textEl, seeMore\)/,
    );
    assert.doesNotMatch(
      content,
      /if \(_statusBodyTextLength\(textEl\) >= MIN_LEN \/ 2\) \{\s*inject\(article/,
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
    assert.match(css, /button\.fbs-allpost-btn[\s\S]*?opacity:\s*0\.72\s*!important/);
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

  it("clips the Chrome popup once at the rounded body while the app shell scrolls", () => {
    const bodyBlock = popupCss.match(/body\s*\{([\s\S]*?)\n\}/);
    assert.ok(bodyBlock, "expected popup body rule");
    assert.match(bodyBlock[1], /overflow:\s*hidden/);
    assert.match(bodyBlock[1], /clip-path:\s*inset\(0 round var\(--radius-popup, 20px\)\)/);
    const shellBlock = popupCss.match(/#main-view,\s*[\s\S]*?\.wizard-container\s*\{([\s\S]*?)\n\}/);
    assert.ok(shellBlock, "expected popup shell rule");
    assert.match(shellBlock[1], /overflow-y:\s*auto/);
    assert.match(shellBlock[1], /contain:\s*paint/);
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
  });

  it("compresses Settings into fewer advanced accordions", () => {
    assert.match(popup, />Tuỳ chọn nâng cao</);
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
  it("keeps optional links and source preview collapsed until needed", () => {
    assert.match(composer, /<details class="fbs-sp-link-input fbs-sp-related-block">/);
    assert.match(composer, /<details class="fbs-sp-comment" style="display:none">/);
    assert.match(css, /\.is-composer \.fbs-status-preview[\s\S]*?border:\s*none\s*!important/);
    assert.match(css, /max-height:\s*104px\s*!important/);
  });

  it("keeps the source-copy action available when the preview is collapsed", () => {
    assert.match(
      composer,
      /"<\/details>" \+\s*'<button type="button" class="fbs-sp-copy-comment"/,
    );
  });
});

describe("No autonomous Facebook publishing", () => {
  it("does not expose the legacy autonomous publisher", () => {
    assert.doesNotMatch(composer, /window\.fbsAgentPost\s*=/);
    assert.match(composer, /publishing and source[\s\S]*always performed by the user/);
  });

  it("does not ship archived automation code to social pages", () => {
    assert.doesNotMatch(composerRuntime, /legacyAutopostRemoved/);
    assert.doesNotMatch(composerRuntime, /Removed legacy autonomous posting implementation/);
  });
});
