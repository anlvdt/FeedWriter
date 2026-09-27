"use strict";

// Platform adapter: X (Twitter)
// Ported from MultiPost-Extension sync/dynamic/x.ts, adapted for FeedWriter.

const PosterX = {
  name: "x",
  label: "X",
  icon: "𝕏",
  color: "#000000",
  maxImages: 4,

  isAvailable() {
    return SITE === "x";
  },

  async post(postData) {
    if (postData.images.length > this.maxImages) {
      return { ok: false, reason: `X hỗ trợ tối đa ${this.maxImages} ảnh.` };
    }
    let text = PostData.getTextWithTags(postData);
    if (typeof StatusFormatter !== "undefined") {
      text = StatusFormatter.format(text, "x");
    }

    try {
      // Step 1: Wait for editor
      let editor;
      try {
        editor = await waitForElement('div[data-contents="true"]', 5000);
      } catch (_) {
        // Fallback: try contenteditable
        editor = await waitForElement(
          'div[contenteditable="true"][role="textbox"]',
          5000
        ).catch(() => null);
      }
      if (!editor) {
        return { ok: false, reason: "no_editor" };
      }
      editor.focus();
      await new Promise(r => setTimeout(r, 500));

      // Step 2: Paste text
      pasteTextToEditor(editor, text);

      // Step 3: Upload images (max 4 on X)
      if (postData.images.length > 0) {
        await new Promise(r => setTimeout(r, 500));
        const fileInput = document.querySelector('input[type="file"]');
        if (fileInput) {
          const requested = postData.images.slice(0, this.maxImages);
          const attached = await uploadFilesToInput(fileInput, requested);
          if (attached < requested.length) return { ok: false, reason: `Chỉ tải được ${attached}/${requested.length} ảnh X.` };
        } else {
          return { ok: false, reason: "Không tìm thấy ô tải ảnh X." };
        }
      }

      await new Promise(r => setTimeout(r, 2000));
      return { ok: true, platform: "x", needsManualPublish: true,
        mediaConfirmationRequired: postData.images.length > 0 };
    } catch (err) {
      console.error("[CrossPost:X] Error:", err);
      return { ok: false, reason: err.message };
    }
  },
};
