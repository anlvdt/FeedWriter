"use strict";

// Platform adapter: Facebook
// Uses FeedWriter's existing mature FB posting logic, wrapped in the unified adapter interface.

// Facebook localizes the composer publish control ("Post"/"Đăng"/"Đăng bài").
const FB_PUBLISH_LABEL_RE =
  /^(post|đăng|đăng bài|chia sẻ|share|publish|update|đăng lên|post it)$/i;

function findFacebookPublishButton() {
  const dialogs = document.querySelectorAll('div[role="dialog"]');
  for (const dialog of dialogs) {
    const candidates = dialog.querySelectorAll(
      'div[role="button"], button, span[role="button"]',
    );
    for (const el of candidates) {
      if (el.getAttribute("aria-disabled") === "true") continue;
      const label = (
        el.getAttribute("aria-label") ||
        el.textContent ||
        ""
      ).trim();
      if (FB_PUBLISH_LABEL_RE.test(label)) return el;
    }
  }
  return null;
}

// Floating cancel window — the user gets a few seconds to abort the auto-post.
function confirmAutoPublishCountdown(seconds = 5) {
  return new Promise((resolve) => {
    const bar = document.createElement("div");
    bar.setAttribute("data-fbs-ui", "v3");
    bar.setAttribute("role", "alert");
    bar.setAttribute("aria-live", "assertive");
    bar.style.cssText =
      "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);" +
      "z-index:2147483647;background:#1a2229;color:#eef2f5;padding:10px 16px;" +
      "border-radius:10px;display:flex;gap:12px;align-items:center;" +
      "box-shadow:0 12px 32px rgba(0,0,0,.45);font:500 13px/1.4 sans-serif";
    const label = document.createElement("span");
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Huỷ đăng (Esc)";
    cancel.style.cssText =
      "background:#eb5757;color:#fff;border:none;border-radius:6px;" +
      "padding:5px 12px;font:inherit;cursor:pointer";
    let left = seconds;
    let settled = false;
    const onKey = (e) => {
      if (e.key === "Escape") finish(false);
    };
    const finish = (go) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      document.removeEventListener("keydown", onKey, true);
      try { bar.remove(); } catch (_) {}
      resolve(go);
    };
    const tick = () => {
      label.textContent = `FeedWriter tự đăng sau ${left}s`;
      if (left-- <= 0) finish(true);
    };
    cancel.addEventListener("click", () => finish(false));
    document.addEventListener("keydown", onKey, true);
    bar.appendChild(label);
    bar.appendChild(cancel);
    document.documentElement.appendChild(bar);
    const timer = setInterval(tick, 1000);
    tick();
  });
}

async function autoPublishFacebookPost() {
  const go = await confirmAutoPublishCountdown(5);
  if (!go) return { published: false, cancelled: true };
  const btn = await waitForCondition(findFacebookPublishButton, 5000).catch(
    () => null,
  );
  if (!btn) return { published: false, reason: "no_publish_button" };
  btn.click();
  return { published: true };
}

const PosterFacebook = {
  name: "facebook",
  label: "Facebook",
  icon: "f",
  color: "#1877F2",
  maxImages: 10,

  isAvailable() {
    return SITE === "facebook";
  },

  async post(postData) {
    const text = PostData.getTextWithTags(postData);

    const mainArea = document.querySelector('div[role="main"]');
    if (!mainArea) return { ok: false, reason: "no_main_area" };

    // Step 1: Click "Bạn đang nghĩ gì?"
    const composerBtn = await waitForCondition(() => {
      const buttons = mainArea.querySelectorAll('div[role="button"]');
      for (const b of buttons) {
        const t = (b.textContent || "").toLowerCase();
        if (t.includes("bạn đang nghĩ gì") ||
            t.includes("what's on your mind") ||
            t.includes("write something") ||
            t.includes("viết gì đó") ||
            t.includes("chia sẻ điều gì") ||
            t.includes("say something")) {
          return b;
        }
      }
      return null;
    }, 5000).catch(() => null);

    if (!composerBtn) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return { ok: false, reason: "no_composer_btn" };
    }
    composerBtn.click();

    // Step 2: Wait for editor
    let editor;
    try {
      editor = await waitForElement(
        'div[role="dialog"] div[role="textbox"][contenteditable="true"]',
        5000
      );
    } catch (_) {
      return { ok: false, reason: "no_editor" };
    }
    editor.click();
    editor.focus();
    await new Promise(r => setTimeout(r, 600));

    // Step 3: Fetch images
    let imgFiles = [];
    if (postData.images.length > 0) {
      const urls = postData.images.map(img => img.url);
      if (typeof fetchImageBlobs === "function") {
        imgFiles = await fetchImageBlobs(urls, this.maxImages);
        // Permission revoked → all fetches silently failed. Offer a re-grant
        // (banner click is a user gesture) and retry once.
        if (
          imgFiles.length === 0 &&
          typeof didLastImageFetchLackPermission === "function" &&
          didLastImageFetchLackPermission() &&
          typeof showImagePermissionBanner === "function"
        ) {
          const granted = await showImagePermissionBanner();
          if (granted) {
            imgFiles = await fetchImageBlobs(urls, this.maxImages);
          }
        }
      }
    }

    // Step 4: Paste text
    const formatted = typeof StatusFormatter !== "undefined"
      ? StatusFormatter.format(text, "facebook", { hasRepo: false })
      : (typeof applyUnicodeFormatting === "function"
          ? applyUnicodeFormatting(text)
          : text);
    if (typeof pasteToLexical === "function") {
      pasteToLexical(editor, formatted, imgFiles.length > 0 ? imgFiles : null);
    } else {
      pasteTextToEditor(editor, formatted);
    }

    const uploadWait = imgFiles.length > 1 ? 1500 + imgFiles.length * 1000 :
                       imgFiles.length === 1 ? 2000 : 800;
    await new Promise(r => setTimeout(r, uploadWait));

    if (postData.autoPublish) {
      const pub = await autoPublishFacebookPost();
      return {
        ok: true,
        platform: "facebook",
        needsManualPublish: !pub.published,
        published: !!pub.published,
        cancelled: !!pub.cancelled,
        publishReason: pub.reason || null,
      };
    }
    return { ok: true, platform: "facebook", needsManualPublish: true };
  },
};
