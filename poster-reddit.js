"use strict";

// Platform adapter: Reddit
// Ported from MultiPost-Extension sync/dynamic/reddit.ts, adapted for FeedWriter.
// Handles Reddit's web components with Shadow DOM.

const PosterReddit = {
  name: "reddit",
  label: "Reddit",
  icon: "r/",
  color: "#FF4500",
  maxImages: 20,

  isAvailable() {
    return SITE === "reddit";
  },

  async post(postData) {
    if (postData.images.length > this.maxImages) {
      return { ok: false, reason: `Reddit hỗ trợ tối đa ${this.maxImages} ảnh.` };
    }
    let text = PostData.getTextWithTags(postData);
    if (typeof StatusFormatter !== "undefined") {
      text = StatusFormatter.format(text, "reddit");
    }

    try {
      // Step 1: Navigate to submit page if not already there
      if (!location.pathname.includes("/submit")) {
        const response = await chrome.runtime.sendMessage({
          action: "store-pending-post",
          kind: "reddit",
          postData,
        });
        if (!response?.ok || !response.id) {
          throw new Error(response?.error || "Không thể lưu bài chờ đăng Reddit");
        }
        const id = response.id;
        const subreddit = this._detectSubreddit();
        const dest = subreddit
          ? `https://www.reddit.com/r/${subreddit}/submit?type=TEXT&feedwriter_compose=${encodeURIComponent(id)}`
          : `https://www.reddit.com/submit?type=TEXT&feedwriter_compose=${encodeURIComponent(id)}`;
        location.href = dest;
        return { ok: true, platform: "reddit", reason: "navigating_to_submit" };
      }

      // Step 2: Wait for title textarea (inside Shadow DOM)
      let titleTextarea;
      try {
        titleTextarea = await waitForCondition(() => {
          const host = document.querySelector("faceplate-textarea-input");
          if (host && host.shadowRoot) {
            return host.shadowRoot.querySelector('textarea[id="innerTextArea"]');
          }
          return null;
        }, 8000);
      } catch (_) {
        return { ok: false, reason: "no_title_input" };
      }

      // Step 3: Fill title (Reddit requires title, max 300 chars)
      const title = postData.title || postData.content.substring(0, 100);
      titleTextarea.value = title.slice(0, 300);
      titleTextarea.dispatchEvent(new Event("input", { bubbles: true }));
      titleTextarea.dispatchEvent(new Event("change", { bubbles: true }));

      // Step 4: If images, switch to Image tab and upload
      if (postData.images.length > 0) {
        const tablist = document.querySelector("r-post-type-select")
          ?.shadowRoot?.querySelector("div[role='tablist']")
          ?.querySelectorAll("faceplate-tracker");
        const imageTab = tablist?.[1]?.querySelector("button");
        if (!imageTab) return { ok: false, reason: "Không tìm thấy chế độ đăng ảnh Reddit." };
        imageTab.click();
        await new Promise(r => setTimeout(r, 1000));

        try {
          const fileInput = await waitForCondition(() => {
            return document.querySelector("r-post-media-input")
              ?.shadowRoot?.querySelector("input");
          }, 5000);
          if (fileInput) {
            const requested = postData.images.slice(0, this.maxImages);
            const attached = await uploadFilesToInput(fileInput, requested);
            if (attached < requested.length) {
              return { ok: false, reason: `Chỉ tải được ${attached}/${requested.length} ảnh Reddit.` };
            }
          } else {
            return { ok: false, reason: "Không tìm thấy ô tải ảnh Reddit." };
          }
        } catch (err) {
          return { ok: false, reason: "Không tải được ảnh Reddit: " + err.message };
        }
      }

      // Step 5: Fill body text
      await new Promise(r => setTimeout(r, 1000));
      const composer = document.querySelector("shreddit-post-submit") || document.querySelector('main, [role="main"]');
      const editors = [...(composer?.querySelectorAll('[contenteditable="true"]') || [])]
        .filter(editor => editor.getClientRects().length > 0);
      const named = editors.filter(editor => /body|text|nội dung/i.test(editor.getAttribute("aria-label") || ""));
      const bodyEditor = named.length === 1 ? named[0] : editors.length === 1 ? editors[0] : null;
      if (postData.content.trim() && !bodyEditor) {
        return { ok: false, reason: "Không xác định được ô nội dung Reddit." };
      }
      if (bodyEditor) {
        bodyEditor.focus();
        pasteTextToEditor(bodyEditor, postData.content);
        try {
          await waitForCondition(() => (bodyEditor.innerText || bodyEditor.textContent || "").trim(), 2000);
        } catch (_) {
          return { ok: false, reason: "Reddit chưa nhận nội dung bài đăng." };
        }
      }

      await new Promise(r => setTimeout(r, 2000));
      return { ok: true, platform: "reddit", needsManualPublish: true,
        mediaConfirmationRequired: postData.images.length > 0 };
    } catch (err) {
      console.error("[CrossPost:Reddit] Error:", err);
      return { ok: false, reason: err.message };
    }
  },

  _detectSubreddit() {
    const match = location.pathname.match(/\/r\/([^\/]+)/);
    return match ? match[1] : null;
  },
};
