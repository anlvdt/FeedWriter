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
    let text = PostData.getTextWithTags(postData);
    if (typeof StatusFormatter !== "undefined") {
      text = StatusFormatter.format(text, "reddit");
    }

    try {
      // Step 1: Navigate to submit page if not already there
      if (!location.pathname.includes("/submit")) {
        const subreddit = this._detectSubreddit();
        if (subreddit) {
          location.href = `https://www.reddit.com/r/${subreddit}/submit?type=TEXT`;
        } else {
          location.href = "https://www.reddit.com/submit?type=TEXT";
        }
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
        if (tablist && tablist.length > 1) {
          const imageTab = tablist[1].querySelector("button");
          if (imageTab) {
            imageTab.click();
            await new Promise(r => setTimeout(r, 1000));
          }
        }

        try {
          const fileInput = await waitForCondition(() => {
            return document.querySelector("r-post-media-input")
              ?.shadowRoot?.querySelector("input");
          }, 5000);
          if (fileInput) {
            await uploadFilesToInput(fileInput, postData.images.slice(0, this.maxImages));
          }
        } catch (err) {
          console.warn("[CrossPost:Reddit] Image upload skipped:", err.message);
        }
      }

      // Step 5: Fill body text
      await new Promise(r => setTimeout(r, 1000));
      const editors = document.querySelectorAll('div[contenteditable="true"]');
      if (editors.length > 2) {
        const bodyEditor = editors[2];
        bodyEditor.focus();
        await new Promise(r => setTimeout(r, 500));
        pasteTextToEditor(bodyEditor, postData.content);
      }

      await new Promise(r => setTimeout(r, 2000));
      return { ok: true, platform: "reddit", needsManualPublish: true };
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
