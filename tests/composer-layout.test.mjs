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
    assert.match(content, /const feedObserverRoot\s*=/);
    assert.match(content, /scanObserver\.observe\(feedObserverRoot/);
    assert.match(content, /const feedTargetSelector\s*=/);
    assert.doesNotMatch(content, /scanObserver\.observe\(document\.documentElement/);
  });
});

describe("Feed false-positive safeguards", () => {
  it("resets filter state when Facebook recycles a feed node", () => {
    assert.match(content, /function refreshReusedFeedUnit\(article\)/);
    assert.match(content, /filteredPosts\.delete\(article\)/);
    assert.match(content, /delete article\.dataset\.fbsSponsoredHidden/);
  });

  it("keeps sponsored posts recoverable and engagement filtering opt-in", () => {
    assert.match(content, /let adDisplayMode = "collapse"/);
    assert.match(content, /let filterEngagementGates = false/);
    assert.match(content, /if \(filterEngagementGates && \(evalResult\.isEngagementGate/);
    assert.match(contentDom, /isSponsored: confidence >= 90/);
    assert.match(contentDom, /confidence = Math\.max\(confidence, 80\)/);
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
    assert.match(css, /\.fbs-chip-host:hover \.fbs-allpost-btn[\s\S]*?opacity:\s*0\.82\s*!important/);
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
