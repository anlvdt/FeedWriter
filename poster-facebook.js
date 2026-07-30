"use strict";

// Platform adapter: Facebook
// Uses FeedWriter's existing mature FB posting logic, wrapped in the unified adapter interface.

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

    return { ok: true, platform: "facebook", needsManualPublish: !postData.autoPublish };
  },
};
