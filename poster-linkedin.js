"use strict";

// Platform adapter: LinkedIn
// Ported from MultiPost-Extension sync/dynamic/linkedin.ts, adapted for FeedWriter.
// Handles LinkedIn's Shadow DOM (div#interop-outlet) for the new layout.

const PosterLinkedin = {
  name: "linkedin",
  label: "LinkedIn",
  icon: "in",
  color: "#0A66C2",
  maxImages: 8,

  isAvailable() {
    return SITE === "linkedin";
  },

  async post(postData) {
    let text = PostData.getTextWithTags(postData);
    if (typeof StatusFormatter !== "undefined") {
      text = StatusFormatter.format(text, "linkedin");
    }

    try {
      // Step 1: Click "Start a post" trigger
      let triggerButton;
      try {
        triggerButton = await waitForCondition(() => {
          return document.querySelector("div[componentkey='draft-text-replaceable-component']") ||
                 document.querySelector("div.share-box-feed-entry__top-bar > button");
        }, 5000);
      } catch (_) {
        return { ok: false, reason: "no_trigger_button" };
      }
      triggerButton.click();
      await new Promise(r => setTimeout(r, 1000));

      // Step 2: Resolve root — may be in Shadow DOM
      const outlet = document.querySelector("div#interop-outlet");
      const root = (outlet && outlet.shadowRoot) ? outlet.shadowRoot : document;

      // Step 3: Wait for editor
      let editor;
      try {
        editor = await waitForCondition(() => {
          return root.querySelector('div.ql-editor[contenteditable="true"]');
        }, 8000);
      } catch (_) {
        return { ok: false, reason: "no_editor" };
      }

      // Step 4: Paste text
      editor.focus();
      editor.innerText = text;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      editor.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise(r => setTimeout(r, 500));

      // Step 5: Upload images via clipboard paste
      if (postData.images.length > 0) {
        const dataTransfer = new DataTransfer();
        for (let i = 0; i < Math.min(postData.images.length, this.maxImages); i++) {
          try {
            const image = postData.images[i];
            const file = typeof fetchImageBlob === "function"
              ? await fetchImageBlob(image.url, image.name)
              : null;
            if (!file) throw new Error("Image download returned no file");
            dataTransfer.items.add(file);
          } catch (err) {
            console.warn("[CrossPost:LinkedIn] Image fetch failed:", err.message);
          }
        }
        if (dataTransfer.files.length > 0) {
          editor.dispatchEvent(new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: dataTransfer,
          }));
        }
      }

      await new Promise(r => setTimeout(r, 3000));
      return { ok: true, platform: "linkedin", needsManualPublish: true };
    } catch (err) {
      console.error("[CrossPost:LinkedIn] Error:", err);
      return { ok: false, reason: err.message };
    }
  },
};
