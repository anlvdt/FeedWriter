"use strict";

// Platform adapter: Threads
// Ported from MultiPost-Extension sync/dynamic/threads.ts, adapted for FeedWriter.

const PosterThreads = {
  name: "threads",
  label: "Threads",
  icon: "@",
  color: "#000000",
  maxImages: 10,

  isAvailable() {
    return SITE === "threads";
  },

  async post(postData) {
    let text = PostData.getTextWithTags(postData);
    if (typeof StatusFormatter !== "undefined") {
      text = StatusFormatter.format(text, "threads");
    }

    try {
      // Step 1: Open compose dialog
      const composeIcon = this._findCreateIcon();
      if (composeIcon) {
        composeIcon.click();
        await new Promise(r => setTimeout(r, 2000));
      } else {
        const placeholder = await waitForElement(
          'div[contenteditable="true"][aria-placeholder]',
          5000
        ).catch(() => null);
        if (placeholder) {
          placeholder.click();
          await new Promise(r => setTimeout(r, 2000));
        } else {
          return { ok: false, reason: "no_compose_entry" };
        }
      }

      // Step 2: Find editor in dialog
      const dialog = document.querySelector("div[role='dialog']") || document.body;
      const editor = dialog.querySelector('div[contenteditable="true"][aria-placeholder]') ||
                     dialog.querySelector('div[contenteditable="true"]');
      if (!editor) {
        return { ok: false, reason: "no_editor" };
      }

      // Step 3: Paste text
      editor.click();
      editor.focus();
      pasteTextToEditor(editor, text);

      // Step 4: Upload images
      if (postData.images.length > 0) {
        try {
          const fileInput = await waitForElement(
            'input[type="file"][accept*="image/jpeg"]',
            5000
          );
          await uploadFilesToInput(fileInput, postData.images.slice(0, this.maxImages));
        } catch (err) {
          console.warn("[CrossPost:Threads] Image upload skipped:", err.message);
        }
      }

      await new Promise(r => setTimeout(r, 3000));
      return { ok: true, platform: "threads", needsManualPublish: true };
    } catch (err) {
      console.error("[CrossPost:Threads] Error:", err);
      return { ok: false, reason: err.message };
    }
  },

  _findCreateIcon() {
    const labels = ["Create", "Tạo", "创建", "建立", "New post", "新貼文"];
    for (const label of labels) {
      const svg = document.querySelector(`svg[aria-label="${label}"]`);
      if (svg) return svg.closest("a, div, button");
    }
    return null;
  },
};
