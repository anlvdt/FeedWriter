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
    if (postData.images.length > this.maxImages) {
      return { ok: false, reason: `Facebook hỗ trợ tối đa ${this.maxImages} ảnh trong luồng này.` };
    }
    const text = PostData.getTextWithTags(postData);

    let editor;
    try {
      editor = await findFacebookPostEditor();
    } catch (error) {
      return { ok: false, reason: error.message };
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
      if (imgFiles.length === 0) {
        return { ok: false, reason: "Không tải được ảnh bài viết. Hãy kiểm tra quyền truy cập ảnh rồi tải lại trang để thử lại." };
      }
      if (imgFiles.length < urls.length) {
        return { ok: false, reason: `Chỉ tải được ${imgFiles.length}/${urls.length} ảnh. Hãy thử lại hoặc bỏ chọn ảnh lỗi.` };
      }
    }

    // Step 4: Paste text
    const formatted = typeof StatusFormatter !== "undefined"
      ? StatusFormatter.format(text, "facebook", { hasRepo: false })
      : (typeof applyUnicodeFormatting === "function"
          ? applyUnicodeFormatting(text)
          : text);
    if (typeof pasteToLexical === "function") {
      await pasteToLexical(editor, formatted, imgFiles.length > 0 ? imgFiles : null);
    } else {
      pasteTextToEditor(editor, formatted);
    }

    const uploadWait = imgFiles.length > 1 ? 1500 + imgFiles.length * 1000 :
                       imgFiles.length === 1 ? 2000 : 800;
    await new Promise(r => setTimeout(r, uploadWait));

    if (formatted.trim() && !(editor.innerText || editor.textContent || "").trim()) {
      return { ok: false, reason: "Facebook chưa nhận nội dung bài đăng." };
    }

    return { ok: true, platform: "facebook", textInserted: true, requestedImages: postData.images.length,
      attachedImages: imgFiles.length, failedImages: [], needsManualPublish: true,
      mediaConfirmationRequired: postData.images.length > 0 };
  },
};

// Shared by the in-page preview and cross-tab handoff. Never pick a comment
// editor merely because it happens to be the first textbox in a dialog.
function facebookElementVisible(element) {
  return !!element && !element.closest('[hidden], [aria-hidden="true"], .fbs-panel') &&
    element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
}

function facebookComposerLabel(element) {
  return [element.getAttribute("aria-label"), element.getAttribute("data-placeholder"),
    element.textContent].filter(Boolean).join(" ").replace(/[’‘]/g, "'").toLowerCase();
}

function isFacebookComposerLabel(label) {
  return /bạn đang nghĩ|what's on your mind|write something|viết gì đó|chia sẻ điều gì|say something|tạo bài viết|create post/.test(label);
}

function findVisibleFacebookPostEditor() {
  for (const dialog of document.querySelectorAll('[role="dialog"]')) {
    if (!facebookElementVisible(dialog)) continue;
    const title = dialog.querySelector('h1, h2, [role="heading"]');
    const composerDialog = isFacebookComposerLabel([
      dialog.getAttribute("aria-label"), title?.textContent,
    ].filter(Boolean).join(" ").toLowerCase());
    const editors = Array.from(dialog.querySelectorAll('[contenteditable="true"]'))
      .filter(facebookElementVisible)
      .filter(editor => !/comment|bình luận|reply|trả lời/i.test(editor.getAttribute("aria-label") || ""));
    const labelled = editors.find(editor => isFacebookComposerLabel(facebookComposerLabel(editor)));
    if (labelled) return labelled;
    if (composerDialog && editors.length === 1) return editors[0];
  }
  return null;
}

async function findFacebookPostEditor() {
  let editor = findVisibleFacebookPostEditor();
  if (editor) return editor;
  const trigger = await waitForCondition(() => {
    return Array.from(document.querySelectorAll('[role="main"] [role="button"], main button, main [role="button"], [role="main"] button'))
      .filter(facebookElementVisible)
      .find(button => !button.closest('[role="article"], [role="dialog"]') &&
        button.getAttribute("aria-disabled") !== "true" && !button.disabled &&
        isFacebookComposerLabel(facebookComposerLabel(button)));
  }, 8000).catch(() => null);
  if (!trigger) throw new Error("Không thấy ô tạo bài viết. Hãy mở ô ‘Bạn đang nghĩ gì?’ trên trang cá nhân, nhóm hoặc Bảng feed rồi thử lại.");
  trigger.click();
  editor = await waitForCondition(findVisibleFacebookPostEditor, 8000).catch(() => null);
  if (!editor) throw new Error("Chưa tìm thấy ô nội dung Facebook. Hãy mở hộp Tạo bài viết rồi thử lại.");
  return editor;
}
