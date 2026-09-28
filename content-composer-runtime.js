"use strict";

// Auto-shorten the source link through the background shorten-url bridge.
// Cached per URL; falls back to the original on any failure.
const _shortUrlCache = new Map();
let _autoShortenLinks = false;
try {
  chrome.runtime.sendMessage({ action: "get-content-settings" }, (response) => {
    if (!chrome.runtime?.lastError && response?.ok) {
      _autoShortenLinks = response.settings?.autoShortenConsent === true;
    }
  });
} catch (_) {}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.action !== "content-settings-changed" || sender?.id !== chrome.runtime.id) return false;
  if (message.changes?.autoShortenConsent) {
    _autoShortenLinks = message.changes.autoShortenConsent.newValue === true;
  }
  return false;
});

function resolveDisplayUrl(url) {
  const u = String(url || "").trim();
  if (!_autoShortenLinks || !/^https?:\/\//i.test(u)) return Promise.resolve(u);
  if (_shortUrlCache.has(u)) return Promise.resolve(_shortUrlCache.get(u));
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ action: "shorten-url", url: u }, (resp) => {
        const short =
          !chrome.runtime?.lastError && resp?.success && resp.shortUrl
            ? resp.shortUrl
            : u;
        _shortUrlCache.set(u, short);
        resolve(short);
      });
    } catch (_) {
      resolve(u);
    }
  });
}

// --- FACEBOOK COMPOSER ---

function openFacebookComposer(text, sourceUrl, imageUrl, author, source, allImages, discoveredLinks = [], options = {}) {
  panelBody.querySelector(".fbs-status-preview")?.remove();
  const preview = document.createElement("div");
  preview.className = "fbs-status-preview";

  // An explicit empty selection means the user wants a text-only draft.
  const selectedImages = allImages === undefined
    ? (imageUrl ? [imageUrl] : [])
    : (Array.isArray(allImages) ? allImages : []);
  const imageList = [...new Set(selectedImages.filter(url => typeof url === "string" && url.trim()))].slice(0, 10);

  // Validate author/source — bỏ nếu chứa ký tự rác (FB anti-scraping)
  const isValidName = (n) =>
    n &&
    n.length >= 2 &&
    n.length < 80 &&
    !/[a-f0-9]{10,}/i.test(n) &&
    !/\d{8,}/.test(n) &&
    n.split(/\s+/).length <= 10;
  let cleanAuthor = isValidName(author) ? author : "";
  let cleanSource = isValidName(source) ? source : "";
  let linkQuality = options.linkQuality || "";
  const postElement = options.postElement || null;
  const initialRelatedLinks = (Array.isArray(discoveredLinks) ? discoveredLinks : [])
    .filter((item) => {
      if (!item || !item.url) return false;
      try {
        const host = new URL(item.url).hostname.toLowerCase();
        return !["t.co", "x.com", "twitter.com"].some((d) => host === d || host.endsWith("." + d));
      } catch (_) {
        return false;
      }
    });
  const initialRelatedText = initialRelatedLinks.map((item) => item.url).filter(Boolean).join("\n");

  const escAttrValue = (value) =>
    esc(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  function qualityLabel(q, url) {
    const barePhoto =
      typeof window.fbsIsBareFbPhotoShell === "function" &&
      window.fbsIsBareFbPhotoShell(url);
    if (barePhoto) {
      return { cls: "is-weak", text: "Sai dạng /photo/ — bấm Tìm lại hoặc Dán" };
    }
    const family =
      typeof window.fbsPermalinkFamilyRank === "function"
        ? window.fbsPermalinkFamilyRank(url)
        : 0;
    const strong = typeof window.fbsIsStrongFbPermalink === "function"
      ? window.fbsIsStrongFbPermalink(url)
      : false;
    if ((strong && family >= 80) || q === "exact") {
      return { cls: "is-exact", text: "Link chính xác" };
    }
    if (q === "constructed" || (strong && family >= 40)) {
      return { cls: "is-ok", text: "Link dựng / media — nên kiểm tra" };
    }
    if (url && (q === "shell" || (typeof window.fbsIsWeakFbShellUrl === "function" && window.fbsIsWeakFbShellUrl(url)))) {
      return { cls: "is-weak", text: "Chỉ trang group/page — dán link bài" };
    }
    if (!url) return { cls: "is-missing", text: "Chưa có link — Dán hoặc Tìm lại" };
    return { cls: "is-ok", text: "Đã có link — nên kiểm tra" };
  }

  // Ảnh preview: nếu có nhiều ảnh → gallery lưới; nếu 1 ảnh → single preview
  let imgHtml = "";
  if (imageList.length > 1) {
    // Multi-image gallery — tất cả ảnh checked by default, user có thể uncheck
    const thumbsHtml = imageList.map((url, i) =>
      '<label class="fbs-sp-thumb"><input type="checkbox" class="fbs-sp-thumb-cb" data-url="' +
      escAttrValue(url) + '" aria-label="Chọn ảnh ' + (i + 1) + '" checked><img src="' +
      escAttrValue(url) + '" alt="Ảnh ' + (i + 1) + '" loading="lazy"></label>'
    ).join("");
    imgHtml =
      '<div class="fbs-sp-image fbs-sp-multi">' +
      '<div class="fbs-sp-multi-header">' + imageList.length + ' ảnh — bỏ tick ảnh không muốn đăng</div>' +
      '<div class="fbs-sp-thumbs">' + thumbsHtml + '</div>' +
      '</div>';
  } else if (imageList.length === 1) {
    imgHtml = '<div class="fbs-sp-image"><label class="fbs-sp-single-select"><input type="checkbox" class="fbs-sp-thumb-cb" data-url="' +
      escAttrValue(imageList[0]) + '" aria-label="Chọn ảnh 1" checked> Đăng ảnh này</label><img src="' +
      escAttrValue(imageList[0]) +
      '" alt="Ảnh xem trước" ><button type="button" class="fbs-sp-copy-img"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> Sao chép ảnh</button></div>';
  }

  const q0 = qualityLabel(linkQuality, sourceUrl || "");
  preview.innerHTML =
    imgHtml +
    '<div class="fbs-sp-source-card">' +
    '<div class="fbs-sp-source-card-head">' +
    '<span class="fbs-sp-source-card-title">Nguồn</span>' +
    '<span class="fbs-sp-link-quality ' + q0.cls + '" data-role="link-quality">' + esc(q0.text) + "</span>" +
    "</div>" +
    '<div class="fbs-sp-author-row">' +
    '<label class="fbs-sp-mini-label" for="fbs-sp-author-field">Tác giả</label>' +
    '<input type="text" id="fbs-sp-author-field" class="fbs-sp-author-field" placeholder="Tên tác giả / page" value="' +
    escAttrValue(cleanAuthor || "") +
    '" autocomplete="off" spellcheck="false">' +
    (cleanSource && cleanSource !== cleanAuthor
      ? '<span class="fbs-sp-source-group" title="Group / page">' + esc(cleanSource) + "</span>"
      : "") +
    "</div>" +
    '<div class="fbs-sp-link-input">' +
    '<div class="fbs-sp-link-label"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Link bài gốc</div>' +
    '<div class="fbs-sp-link-row">' +
    '<input type="text" class="fbs-sp-link-field" aria-label="Link bài gốc" placeholder="Dán link bài gốc (permalink)" value="' +
    escAttrValue(sourceUrl || "") +
    '" autocomplete="off" spellcheck="false">' +
    '<button type="button" class="fbs-sp-paste-link" title="Dán link từ clipboard" aria-label="Dán link nguồn">Dán</button>' +
    '<button type="button" class="fbs-sp-redetect-link" title="Tìm lại link từ bài Facebook" aria-label="Tìm lại link">Tìm lại</button>' +
    '<button type="button" class="fbs-sp-open-link" title="Mở link trong tab mới" aria-label="Mở link bài gốc"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>' +
    "</div>" +
    "</div>" +
    "</div>" +
    '<div class="fbs-sp-link-input fbs-sp-related-block">' +
    '<div class="fbs-sp-link-label"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg> Link tham khảo <span>Tuỳ chọn</span></div>' +
    '<textarea class="fbs-sp-github-field" aria-label="Link tham khảo, mỗi dòng một link" rows="2" placeholder="Mỗi dòng một link (tuỳ chọn)">' +
    esc(initialRelatedText) +
    "</textarea>" +
    '<div class="fbs-sp-link-chips"></div>' +
    "</div>" +
    '<div class="fbs-sp-link-status" role="status" aria-live="polite"></div>' +
    '<details class="fbs-sp-comment" open>' +
    '<summary class="fbs-sp-comment-label">Bình luận nguồn <span>Xem trước</span></summary>' +
    '<div class="fbs-sp-comment-text" tabindex="0" title="Bấm để bôi đen khi cần copy thủ công"></div>' +
    "</details>" +
    '<button type="button" class="fbs-sp-copy-comment" title="Sao chép nội dung nguồn"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Sao chép nguồn</button>' +
    '<div class="fbs-sp-post-status" role="status" aria-live="polite" aria-atomic="true"></div>' +
    '<div class="fbs-sp-actions">' +
    '<button type="button" class="fbs-sp-copy-text">Sao chép nội dung</button>' +
    '<button type="button" class="fbs-sp-open-fb"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> ' + (SITE === "x" || SITE === "facebook" ? "Điền bản nháp Facebook" : "Điền bản nháp") + '</button>' +
    "</div>";

  panelBody.appendChild(preview);
  preview.querySelectorAll("img").forEach((image) => {
    image.addEventListener("error", () => {
      const imageShell = image.closest(".fbs-sp-thumb, .fbs-sp-image");
      if (imageShell && !imageShell.querySelector(".fbs-sp-image-error")) {
        image.hidden = true;
        const warning = document.createElement("span");
        warning.className = "fbs-sp-image-error";
        warning.textContent = "Ảnh lỗi";
        imageShell.title = "Không xem trước được ảnh. Bỏ chọn nếu không muốn tải ảnh này.";
        imageShell.appendChild(warning);
      }
    });
  });

  panelBody.scrollTop = panelBody.scrollHeight;

  const footer = panel.querySelector(".fbs-panel-footer");
  if (footer) footer.style.display = "none";
  const toneRow = panel.querySelector(".fbs-tone-row");
  if (toneRow) {
    toneRow.hidden = true;
    toneRow.classList.remove("fbs-tone-visible");
  }
  panel.classList.add("is-composer");
  panel.setAttribute("aria-modal", "false");
  const subtitle = panel.querySelector('[data-role="panel-subtitle"]');
  if (subtitle) subtitle.textContent = SITE === "x" || SITE === "facebook" ? "Bản nháp Facebook" : "Bản nháp";

  const linkField = preview.querySelector(".fbs-sp-link-field");
  const authorField = preview.querySelector(".fbs-sp-author-field");
  const qualityEl = preview.querySelector('[data-role="link-quality"]');
  const githubField = preview.querySelector(".fbs-sp-github-field");
  const chipsBox = preview.querySelector(".fbs-sp-link-chips");
  const linkStatus = preview.querySelector(".fbs-sp-link-status");
  const pasteLinkBtn = preview.querySelector(".fbs-sp-paste-link");
  const redetectBtn = preview.querySelector(".fbs-sp-redetect-link");
  const openLinkBtn = preview.querySelector(".fbs-sp-open-link");
  const commentSection = preview.querySelector(".fbs-sp-comment");
  const commentText = preview.querySelector(".fbs-sp-comment-text");
  const copyCommentBtn = preview.querySelector(".fbs-sp-copy-comment");

  const postStatus = preview.querySelector(".fbs-sp-post-status");
  preview.querySelector(".fbs-sp-copy-text").addEventListener("click", async () => {
    try {
      const formatted = typeof StatusFormatter !== "undefined"
        ? StatusFormatter.format(text, SITE === "x" ? "facebook" : SITE, {
            hasRepo: parseRelatedLinks(githubField.value).some(item => item.type === "github"),
          }) : text;
      await navigator.clipboard.writeText(formatted);
      postStatus.textContent = "Đã sao chép nội dung. Dán vào ô tạo bài viết rồi kiểm tra trước khi đăng.";
    } catch (_) {
      postStatus.textContent = "Trình duyệt không cho sao chép. Hãy chọn nội dung bản tóm tắt và dùng Ctrl/Cmd+C.";
    }
  });

  const LINK_TYPE_LABEL = { github: "Repo", download: "Tải về", reference: "Tham khảo" };

  function refreshQualityBadge(url, q) {
    if (!qualityEl) return;
    const info = qualityLabel(q || linkQuality, url || "");
    qualityEl.className = "fbs-sp-link-quality " + info.cls;
    qualityEl.textContent = info.text;
  }

  // Reflect whether the source-link field has a usable value (green border + open btn)
  function refreshLinkFieldState() {
    const url = linkField.value.trim();
    const has = /^https?:\/\//i.test(url);
    const strong = typeof window.fbsIsStrongFbPermalink === "function" && window.fbsIsStrongFbPermalink(url);
    linkField.classList.toggle("has-value", has);
    linkField.classList.toggle("is-strong", !!strong);
    linkField.classList.toggle("is-weak", has && !strong && (typeof window.fbsIsWeakFbShellUrl === "function" ? window.fbsIsWeakFbShellUrl(url) : false));
    if (openLinkBtn) openLinkBtn.disabled = !has;
    if (has && strong) linkQuality = "exact";
    refreshQualityBadge(url, linkQuality);
  }

  if (authorField) {
    authorField.addEventListener("input", () => {
      cleanAuthor = isValidName(authorField.value.trim()) ? authorField.value.trim() : authorField.value.trim();
      updateComment(linkField.value.trim(), githubField.value.trim());
    });
  }

  function selectSourceField() {
    linkField.focus({ preventScroll: true });
    linkField.select();
  }

  function selectCommentText() {
    if (!commentText || !commentText.textContent.trim()) return;
    const range = document.createRange();
    range.selectNodeContents(commentText);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function getSourceCommentContent() {
    return (commentText?.innerText || commentText?.textContent || "").trim();
  }

  async function copySourceComment() {
    const content = getSourceCommentContent();
    if (!content) throw new Error("Nội dung nguồn đang trống");
    if (!navigator.clipboard?.writeText) {
      throw new Error("Trình duyệt không cho phép ghi clipboard");
    }
    await navigator.clipboard.writeText(content);
    return content;
  }

  function setPasteLinkButtonState(label, className = "") {
    if (!pasteLinkBtn) return;
    pasteLinkBtn.textContent = label;
    pasteLinkBtn.classList.toggle("is-done", className === "is-done");
    pasteLinkBtn.classList.toggle("is-error", className === "is-error");
  }

  // Render the auto-detected/manual links as inspectable chips (type badge + open + remove)
  // and keep the status line in sync. This is the user's verification surface before posting.
  function renderLinkUI() {
    const links = parseRelatedLinks(githubField.value);
    if (chipsBox) {
      chipsBox.innerHTML = links
        .map(
          (item) =>
            '<span class="fbs-sp-chip" data-type="' + escAttrValue(item.type) + '" data-url="' + escAttrValue(item.url) + '">' +
            '<span class="fbs-sp-chip-badge">' + esc(LINK_TYPE_LABEL[item.type] || "Tham khảo") + "</span>" +
            '<span class="fbs-sp-chip-url" title="' + escAttrValue(item.url) + '">' +
            esc(item.url.replace(/^https?:\/\//i, "")) +
            "</span>" +
            '<button type="button" class="fbs-sp-chip-open" title="Mở link" aria-label="Mở ' + escAttrValue(item.url) + '"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>' +
            '<button type="button" class="fbs-sp-chip-remove" title="Bỏ link này" aria-label="Bỏ ' + escAttrValue(item.url) + '">&times;</button>' +
            "</span>"
        )
        .join("");
    }
    if (linkStatus) {
      const hasLinks = links.length > 0;
      linkStatus.classList.toggle("has-link", hasLinks);
      linkStatus.classList.remove("no-link");
      // No links → collapse the line entirely. The empty-state hint is
      // redundant with the textarea placeholder, so we drop the noise.
      linkStatus.style.display = hasLinks ? "" : "none";
      linkStatus.textContent = hasLinks
        ? "" + links.length + " link sẽ ghi vào comment nguồn — kiểm tra lại trước khi đăng."
        : "";
    }
  }

  function parseRelatedLinks(rawText) {
    const seen = new Set();
    return (rawText || "")
      .split(/\s+/)
      .map((url) => url.trim())
      .filter((url) => /^https?:\/\//i.test(url))
      .filter((url) => {
        try {
          const host = new URL(url).hostname.toLowerCase();
          return !["t.co", "x.com", "twitter.com"].some((d) => host === d || host.endsWith("." + d));
        } catch (_) {
          return false;
        }
      })
      .map((url) => {
        if (typeof window.fbsClassifyRelatedUrl === "function") {
          return window.fbsClassifyRelatedUrl(url, "", "manual");
        }
        return { url, type: "reference" };
      })
      .filter(Boolean)
      .filter((url) => {
        if (seen.has(url.url)) return false;
        seen.add(url.url);
        return true;
      });
  }

  // Generate comment content từ link — ghi nguồn kèm tên tác giả nếu có
  // LUÔN hiển thị section comment (kể cả khi chưa có URL) để user biết
  // cần paste link. Nếu thiếu link mà có author/source → vẫn show "Nguồn: X"
  function updateComment(url, githubUrl) {

    const relatedLinks = parseRelatedLinks(githubUrl);
    const oldRelatedLinks = typeof globalRelatedSourceLinks !== "undefined"
      ? globalRelatedSourceLinks
      : [];
    if (typeof globalRelatedSourceLinks !== "undefined") {
      globalRelatedSourceLinks = relatedLinks;
    }
    // Prefer live author field so edits flow into comment preview
    const authorNow = authorField
      ? authorField.value.trim()
      : cleanAuthor;
    if (window.buildCommentText) {
      const commentContent = window.buildCommentText(url, authorNow, cleanSource, { relatedLinks });
      commentText.style.whiteSpace = "pre-line";
      commentText.textContent = commentContent;
    } else {
      let fallbackContent = `NGUỒN THAM KHẢO:\n· Link gốc: ${url || "(chưa có link bài gốc)"}`;
      if (authorNow) fallbackContent += `\n· Tác giả: ${authorNow}`;
      for (const item of relatedLinks) {
        const label = item.type === "github" ? "Repo/Mã nguồn" : item.type === "download" ? "Download" : "Tham khảo";
        fallbackContent += `\n· ${label}: ${item.url}`;
      }
      commentText.style.whiteSpace = "pre-line";
      commentText.textContent = fallbackContent;
    }
    if (typeof globalRelatedSourceLinks !== "undefined") {
      globalRelatedSourceLinks = oldRelatedLinks;
    }
  }

  // LUÔN render section comment ngay khi mở composer — kể cả khi chưa có link
  updateComment(sourceUrl || "", initialRelatedText);
  renderLinkUI();
  refreshLinkFieldState();
  setTimeout(() => selectSourceField(), 120);

  // Normalize Facebook URL
  function normalizeFbUrl(raw) {
    return typeof cleanSourceUrl === "function" ? cleanSourceUrl(raw) : raw;
  }

  // Auto-normalize khi paste link
  linkField.addEventListener("paste", () => {
    setTimeout(() => {
      const url = linkField.value.trim();
      const githubUrl = githubField.value.trim();
      if (!url) return;
      const clean = normalizeFbUrl(url);
      linkField.value = clean;
      updateComment(clean, githubUrl);
      refreshLinkFieldState();
    }, 50);
  });

  // Cũng update khi user gõ tay
  linkField.addEventListener("input", () => {
    const url = linkField.value.trim();
    const githubUrl = githubField.value.trim();
    updateComment(url, githubUrl);
    refreshLinkFieldState();
  });

  // Update comment khi gõ github link
  githubField.addEventListener("input", () => {
    const url = linkField.value.trim();
    const githubUrl = githubField.value.trim();
    updateComment(url, githubUrl);
    renderLinkUI();
  });

  githubField.addEventListener("paste", () => {
    setTimeout(() => {
      const url = linkField.value.trim();
      const githubUrl = githubField.value.trim();
      updateComment(url, githubUrl);
      renderLinkUI();
    }, 50);
  });

  // Paste link bài gốc — app hay đoán sai nguồn, nên ưu tiên link user vừa copy thủ công.
  if (pasteLinkBtn) {
    pasteLinkBtn.addEventListener("click", async () => {
      selectSourceField();
      try {
        try {
          if (chrome.permissions?.request) {
            await chrome.permissions.request({ permissions: ["clipboardRead"] });
          } else {
            await chrome.runtime.sendMessage({
              action: "request-optional-permission",
              permissions: ["clipboardRead"],
            });
          }
        } catch (_) {}
        const pasted = (await navigator.clipboard.readText()).trim();
        if (!pasted) {
          setPasteLinkButtonState("Clipboard trống", "is-error");
          setTimeout(() => setPasteLinkButtonState("Dán"), 1600);
          return;
        }
        const clean = normalizeFbUrl(pasted);
        linkField.value = clean;
        updateComment(clean, githubField.value.trim());
        refreshLinkFieldState();
        selectSourceField();
        setPasteLinkButtonState("Đã dán", "is-done");
        setTimeout(() => setPasteLinkButtonState("Dán"), 1600);
      } catch (_) {
        setPasteLinkButtonState("Ctrl+V", "is-error");
        setTimeout(() => {
          setPasteLinkButtonState("Dán");
          selectSourceField();
        }, 1600);
      }
    });
  }
  if (openLinkBtn) {
    openLinkBtn.addEventListener("click", () => {
      const url = linkField.value.trim();
      if (/^https?:\/\//i.test(url)) window.open(url, "_blank", "noopener");
    });
  }

  // Re-detect permalink (+ author) from the original Facebook post DOM / Share menu
  if (redetectBtn) {
    redetectBtn.addEventListener("click", async () => {
      if (!postElement) {
        redetectBtn.textContent = "Không có bài";
        setTimeout(() => { redetectBtn.textContent = "Tìm lại"; }, 1600);
        return;
      }
      const prev = redetectBtn.textContent;
      redetectBtn.disabled = true;
      redetectBtn.textContent = "…";
      try {
        let found = "";
        if (typeof window.fbsExtractPermalinkAsync === "function") {
          // forceShare: always try Share → Copy link if timestamp DOM is weak
          found = (await window.fbsExtractPermalinkAsync(postElement, { forceShare: true })) || "";
        } else if (typeof window.fbsExtractPermalink === "function") {
          found = window.fbsExtractPermalink(postElement) || "";
        }
        if (found) {
          const clean = normalizeFbUrl(found);
          linkField.value = clean;
          linkQuality = typeof window.fbsIsStrongFbPermalink === "function" && window.fbsIsStrongFbPermalink(clean)
            ? "exact"
            : "constructed";
          updateComment(clean, githubField.value.trim());
          refreshLinkFieldState();
        }
        // Refresh author if empty or still default
        if (authorField && typeof window.fbsExtractAuthor === "function") {
          const a = window.fbsExtractAuthor(postElement) || "";
          if (a && (!authorField.value.trim() || authorField.value.trim() === cleanAuthor)) {
            authorField.value = a;
            cleanAuthor = a;
            updateComment(linkField.value.trim(), githubField.value.trim());
          }
        }
        redetectBtn.textContent = found ? "Đã tìm" : "Không thấy";
      } catch (_) {
        redetectBtn.textContent = "Lỗi";
      }
      redetectBtn.disabled = false;
      setTimeout(() => { redetectBtn.textContent = prev || "Tìm lại"; }, 1600);
    });
  }

  // Chip actions: mở link trong tab mới / bỏ link khỏi danh sách
  if (chipsBox) {
    chipsBox.addEventListener("click", (e) => {
      const chip = e.target.closest(".fbs-sp-chip");
      if (!chip) return;
      const url = chip.dataset.url;
      if (e.target.closest(".fbs-sp-chip-open")) {
        if (/^https?:\/\//i.test(url)) window.open(url, "_blank", "noopener");
        return;
      }
      if (e.target.closest(".fbs-sp-chip-remove")) {
        const remaining = parseRelatedLinks(githubField.value)
          .map((item) => item.url)
          .filter((u) => u !== url);
        githubField.value = remaining.join("\n");
        updateComment(linkField.value.trim(), githubField.value);
        renderLinkUI();
      }
    });
  }

  commentText.addEventListener("click", selectCommentText);
  commentText.addEventListener("focus", selectCommentText);
  if (copyCommentBtn) {
    const COPY_COMMENT_HTML = copyCommentBtn.innerHTML;
    copyCommentBtn.addEventListener("click", async () => {
      try {
        await copySourceComment();
        copyCommentBtn.innerHTML =
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Đã copy — dán vào comment';
        copyCommentBtn.classList.add("is-done");
      } catch (_) {
        selectCommentText();
        copyCommentBtn.innerHTML =
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Không sao chép được — đã bôi đen';
        copyCommentBtn.classList.add("is-error");
      }
      setTimeout(() => {
        copyCommentBtn.innerHTML = COPY_COMMENT_HTML;
        copyCommentBtn.classList.remove("is-done", "is-error");
      }, 2200);
    });
  }

  // Copy ảnh
  const copyImgBtn = preview.querySelector(".fbs-sp-copy-img");
  if (copyImgBtn) {
    copyImgBtn.addEventListener("click", async () => {
      try {
        copyImgBtn.innerHTML =
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> ...';
        const imgEl = preview.querySelector(".fbs-sp-image img");
        const canvas = document.createElement("canvas");
        canvas.width = imgEl.naturalWidth;
        canvas.height = imgEl.naturalHeight;
        canvas.getContext("2d").drawImage(imgEl, 0, 0);
        const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        copyImgBtn.innerHTML =
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Đã copy!';
        setTimeout(() => {
          copyImgBtn.innerHTML =
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> Sao chép ảnh';
        }, 2500);
      } catch (_) {
        window.open(imageUrl, "_blank");
        copyImgBtn.innerHTML =
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> Mở tab mới';
        setTimeout(() => {
          copyImgBtn.innerHTML =
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> Sao chép ảnh';
        }, 2000);
      }
    });
  }

  // Đăng status — mở composer + paste text + paste ảnh.
  // Hỗ trợ cross-platform: Facebook, Threads, X, LinkedIn, Reddit.
  preview
    .querySelector(".fbs-sp-open-fb")
    .addEventListener("click", async () => {
      const btn = preview.querySelector(".fbs-sp-open-fb");

      // X is the source platform, while Facebook is the requested publishing
      // destination. Hand the prepared status to the background worker so it
      // can open a Facebook tab and let that tab fill the native composer.
      if (SITE === "x") {
        btn.disabled = true;
        btn.innerHTML = '<div class="fbs-spinner" style="width:14px;height:14px;border-width:2px"></div> Đang copy nguồn...';

        let sourceCopied = false;
        try {
          // Keep this as the first awaited action in the click handler so the
          // browser's transient user activation still authorizes clipboard.
          await copySourceComment();
          sourceCopied = true;
        } catch (error) {
          postStatus.textContent = "Chưa sao chép được nguồn. Bạn vẫn có thể điền bản nháp và sao chép nguồn sau.";
        }

        btn.innerHTML = '<div class="fbs-spinner" style="width:14px;height:14px;border-width:2px"></div> Đang mở Facebook...';

        let selectedUrls = [];
        const thumbCheckboxes = preview.querySelectorAll(".fbs-sp-thumb-cb");
        if (thumbCheckboxes.length > 0) {
          selectedUrls = Array.from(thumbCheckboxes)
            .filter((cb) => cb.checked)
            .map((cb) => cb.dataset.url)
            .filter(Boolean);
        } else if (imageList.length > 0) {
          selectedUrls = imageList;
        }

        if (selectedUrls.some(url => /^https?:/i.test(url))) {
          try {
            await chrome.runtime.sendMessage({
              action: "request-optional-permission",
              origins:
                (typeof FeedWriterUrlClean !== "undefined" &&
                  FeedWriterUrlClean.imageOptionalOrigins &&
                  FeedWriterUrlClean.imageOptionalOrigins()) ||
                ["https://*.fbcdn.net/*", "https://fbcdn.net/*"],
            });
          } catch (_) {}
        }

        try {
          const response = await chrome.runtime.sendMessage({
            action: "open-facebook-composer",
            postData: PostData.fromFeedWriter(
              text,
              linkField.value.trim(),
              imageUrl,
              authorField.value.trim() || cleanAuthor,
              cleanSource,
              selectedUrls,
            ),
          });
          if (!response?.ok) throw new Error(response?.error || "Không mở được Facebook");
          btn.disabled = false;
          btn.textContent = sourceCopied ? 'Đã mở Facebook — nguồn đã copy' : 'Đã mở Facebook — chưa sao chép nguồn';
        } catch (err) {
          btn.disabled = false;
          btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Lỗi: ' + esc(err?.message || String(err));
        }
        return;
      }

      // Cross-platform: nếu đang ở platform khác và có adapter → dùng adapter
      if (SITE !== "facebook" && typeof CrossPoster !== "undefined") {
        const adapter = CrossPoster.getCurrentAdapter();
        if (adapter) {
          btn.disabled = true;
          btn.innerHTML = '<div class="fbs-spinner" style="width:14px;height:14px;border-width:2px"></div> Đang đăng lên ' + adapter.label + '...';

          // Build PostData từ context hiện tại
          let selectedUrls = [];
          const thumbCheckboxes = preview.querySelectorAll(".fbs-sp-thumb-cb");
          if (thumbCheckboxes.length > 0) {
            selectedUrls = Array.from(thumbCheckboxes)
              .filter(cb => cb.checked)
              .map(cb => cb.dataset.url)
              .filter(Boolean);
          } else if (imageList.length > 0) {
            selectedUrls = imageList;
          }

          const postData = PostData.fromFeedWriter(text, sourceUrl, imageUrl, cleanAuthor, cleanSource, selectedUrls);
          try {
            const result = await adapter.post(postData);
            if (result.ok) {
            const message = result.reason === 'navigating_to_submit'
              ? 'Đã mở trang soạn Reddit — chờ bản nháp được điền rồi kiểm tra trước khi bấm Đăng'
              : result.mediaConfirmationRequired
              ? 'Đã điền bản nháp trên ' + adapter.label + ' — kiểm tra ảnh hiển thị trước khi bấm Đăng'
              : 'Sẵn sàng trên ' + adapter.label + ' — bấm Đăng';
            btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> ' + message;
            } else {
              btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Lỗi: ' + esc(result.reason || "Không chuẩn bị được bài đăng");
            }
          } catch (err) {
            btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Lỗi: ' + esc(err?.message || "Không chuẩn bị được bài đăng");
          } finally {
            btn.disabled = false;
          }
          return;
        }
        // No adapter for this site — fallback to copy
        await navigator.clipboard.writeText(text);
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Đã copy (chưa hỗ trợ ' + SITE + ')';
        return;
      } else if (SITE !== "facebook") {
        await navigator.clipboard.writeText(text);
        btn.innerHTML =
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Đã copy text';
        return;
      }

      btn.disabled = true;
      btn.innerHTML =
        '<div class="fbs-spinner" style="width:14px;height:14px;border-width:2px"></div> Mở Composer...';

      const setStatus = (msg) => {
        postStatus.textContent = msg;
        btn.setAttribute("aria-busy", "true");
        btn.innerHTML = '<div class="fbs-spinner" style="width:14px;height:14px;border-width:2px"></div> ' + msg;
      };
      const setDone = (msg) => {
        postStatus.textContent = msg;
        btn.removeAttribute("aria-busy");
        if (!panel.classList.contains("fbs-minimized") && typeof toggleMinimize === "function") toggleMinimize();
        btn.disabled = false;
        btn.innerHTML =
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> ' + msg;
      };
      const setFail = (msg) => {
        postStatus.textContent = msg;
        btn.removeAttribute("aria-busy");
        btn.disabled = false;
        btn.innerHTML =
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Thử lại';
      };

      try {
        // Use the source fields reviewed by the user, including an intentionally empty link.
        let sourceLine = "";
        const finalUrl = await resolveDisplayUrl(
          linkField.value.trim(),
        );
        const finalGithubUrl = githubField.value.trim();
        const finalRelatedLinks = parseRelatedLinks(finalGithubUrl);

        if (window.buildCommentText) {
          const oldRelatedLinks = typeof globalRelatedSourceLinks !== "undefined" ? globalRelatedSourceLinks : [];
          if (typeof globalRelatedSourceLinks !== "undefined") globalRelatedSourceLinks = finalRelatedLinks;
          sourceLine = window.buildCommentText(finalUrl, cleanAuthor, cleanSource, { relatedLinks: finalRelatedLinks });
          if (typeof globalRelatedSourceLinks !== "undefined") globalRelatedSourceLinks = oldRelatedLinks;
        } else {
          let fallbackContent = `NGUỒN THAM KHẢO:\n· Link gốc: ${finalUrl || "(chưa có link bài gốc)"}`;
          for (const item of finalRelatedLinks) {
            const label = item.type === "github" ? "Repo/Mã nguồn" : item.type === "download" ? "Download" : "Tham khảo";
            fallbackContent += `\n· ${label}: ${item.url}`;
          }
          sourceLine = fallbackContent;
        }

        // Auto-copy source comment before touching the native composer.
        let sourceCopied = false;
        if (sourceLine) {
          try {
            await navigator.clipboard.writeText(sourceLine);
            sourceCopied = true;
          } catch (_) {
            postStatus.textContent = "Chưa sao chép được nguồn — có thể sao chép sau khi điền bản nháp.";
          }
        }

        let selectedUrls = [];
        const thumbCheckboxes = preview.querySelectorAll(".fbs-sp-thumb-cb");
        if (thumbCheckboxes.length > 0) {
          selectedUrls = Array.from(thumbCheckboxes)
            .filter(cb => cb.checked)
            .map(cb => cb.dataset.url)
            .filter(Boolean);
        } else if (imageList.length > 0) {
          selectedUrls = imageList;
        }

        if (selectedUrls.some(url => /^https?:/i.test(url))) {
          try {
            await chrome.runtime.sendMessage({
              action: "request-optional-permission",
              origins:
                (typeof FeedWriterUrlClean !== "undefined" &&
                  FeedWriterUrlClean.imageOptionalOrigins &&
                  FeedWriterUrlClean.imageOptionalOrigins()) ||
                ["https://*.fbcdn.net/*", "https://fbcdn.net/*"],
            });
          } catch (_) {}
        }

        // Both entry points use the same visible, post-only editor lookup.
        setStatus("Mở ô soạn bài Facebook...");
        const editor = await findFacebookPostEditor();
        editor.click();
        editor.focus();
        await new Promise(r => setTimeout(r, 600));

        // Bước 4: Fetch ảnh parallel
        let imgFiles = [];
        if (selectedUrls.length > 0) {
          setStatus("Tải " + selectedUrls.length + " ảnh...");
          imgFiles = await fetchImageBlobs(selectedUrls, 10);
          if (
            imgFiles.length === 0 &&
            typeof didLastImageFetchLackPermission === "function" &&
            didLastImageFetchLackPermission() &&
            typeof showImagePermissionBanner === "function"
          ) {
            setStatus("Cần quyền tải ảnh...");
            const granted = await showImagePermissionBanner();
            if (granted) {
              imgFiles = await fetchImageBlobs(selectedUrls, 10);
            }
          }
          console.log("[Manual Post] Fetched", imgFiles.length, "/", selectedUrls.length, "images");
          if (imgFiles.length === 0) {
            setFail("Không tải được ảnh bài viết — kiểm tra quyền truy cập ảnh rồi thử lại");
            return;
          }
          if (imgFiles.length < selectedUrls.length) {
            setFail(`Chỉ tải được ${imgFiles.length}/${selectedUrls.length} ảnh. Hãy thử lại hoặc bỏ chọn ảnh lỗi.`);
            return;
          }
        }

        // Bước 5: Paste text + ảnh
        setStatus("Dán nội dung...");
        let textWithFooter;
        if (typeof StatusFormatter !== "undefined") {
          const hasRepo =
            !!(typeof globalCustomSourceLink !== 'undefined' && globalCustomSourceLink) ||
            parseRelatedLinks(finalGithubUrl).some((item) => item.type === "github");
          textWithFooter = StatusFormatter.format(text, "facebook", { hasRepo });
        } else {
          textWithFooter = applyUnicodeFormatting(text);
        }
        await pasteToLexical(editor, textWithFooter, imgFiles.length > 0 ? imgFiles : null);

        // Chờ upload hoàn tất (để user thấy ảnh đã render trước khi bấm Đăng)
        const uploadWait = imgFiles.length > 1 ? 1500 + imgFiles.length * 1000 :
                          imgFiles.length === 1 ? 2000 : 800;
        await new Promise(r => setTimeout(r, uploadWait));

        if (textWithFooter.trim() && !(editor.innerText || editor.textContent || "").trim()) {
          setFail("Facebook chưa nhận nội dung bài đăng — hãy thử lại");
          return;
        }

        if (selectedUrls.length > 0) {
          setDone("Đã điền bản nháp — kiểm tra ảnh hiển thị trên Facebook trước khi bấm Đăng");
        } else if (sourceCopied) setDone("Sẵn sàng — nguồn đã copy, bấm Đăng");
        else setDone("Bản nháp đã điền — chưa sao chép nguồn. Kiểm tra rồi bấm Đăng trên Facebook.");
        editor.focus();
      } catch (err) {
        console.error("[Manual Post] Error:", err);
        setFail("Lỗi: " + (err.message || err));
      }
    });
}

/**
 * Generate standard premium Facebook footer with dynamic Call to Action
 */
function getFacebookFooter(hasRepo) {
  const disclaimer =
    "ℹ️ Lưu ý: Bài viết tổng hợp từ nguồn công khai, chưa dựa trên trải nghiệm trực tiếp. " +
    "Vui lòng kiểm tra mức độ phù hợp trước khi sử dụng.";
  if (hasRepo) {
    return disclaimer + "\n\n━━━━━━━━━━\nLink gốc & mã nguồn dưới bình luận đầu tiên";
  } else {
    return disclaimer + "\n\n━━━━━━━━━━\nChi tiết & nguồn dưới bình luận đầu tiên";
  }
}

/**
 * Unicode sans-serif bold for standard English letters and digits.
 * Splits by whitespace and only bolds tokens that are entirely ASCII.
 * Vietnamese words (with diacritics) are skipped entirely — no partial bolding.
 */
function toUnicodeBold(str) {
  return str.split(/(\s+)/).map(token => {
    if (/^\s+$/.test(token)) return token;
    if (/[^\x00-\x7F]/.test(token)) return token;
    let result = "";
    for (let i = 0; i < token.length; i++) {
      const c = token.charCodeAt(i);
      if (c >= 65 && c <= 90)       result += String.fromCodePoint(c + 120211); // U+1D5D4 (𝗔)
      else if (c >= 97 && c <= 122) result += String.fromCodePoint(c + 120205); // U+1D5EE (𝗮)
      else if (c >= 48 && c <= 57)  result += String.fromCodePoint(c + 120764); // U+1D7EC (𝟬)
      else result += token[i];
    }
    return result;
  }).join("");
}

/**
 * Unicode sans-serif italic for standard English letters.
 * Same split-by-whitespace approach — skip tokens with non-ASCII characters.
 */
function toUnicodeItalic(str) {
  return str.split(/(\s+)/).map(token => {
    if (/^\s+$/.test(token)) return token;
    if (/[^\x00-\x7F]/.test(token)) return token;
    let result = "";
    for (let i = 0; i < token.length; i++) {
      const c = token.charCodeAt(i);
      if (c >= 65 && c <= 90)       result += String.fromCodePoint(c + 120263); // U+1D608 (𝘈)
      else if (c >= 97 && c <= 122) result += String.fromCodePoint(c + 120257); // U+1D622 (𝘢)
      else result += token[i];
    }
    return result;
  }).join("");
}

/**
 * Apply Unicode Bold and Italic formatting depending on configuration
 */
function applyUnicodeFormatting(text) {
  const isUnicodeBoldEnabled = (window.enableUnicodeBold !== false);
  if (!isUnicodeBoldEnabled) {
    return text.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1");
  }
  let result = text;
  result = result.replace(/\*\*(.*?)\*\*/g, (match, p1) => toUnicodeBold(p1));
  result = result.replace(/\*(.*?)\*/g, (match, p1) => toUnicodeItalic(p1));
  return result;
}

/**
 * Convert raw AI response text into unified plain text status format
 */
function buildUnifiedStatusText(rawText, options = {}) {
  // Normalize *** to **
  let cleaned = rawText.trim().replace(/^\*{3}\s*/gm, "**");

  // Strip any existing footers & separators to prevent duplicates
  const footerRegex = /\s*(?:[—-]\s*\n\s*)?Nguồn\s+dưới\s+(?:cmt|bình\s+luận|binh\s+luan)\s+đầu(?:\s+tiên)?\s*$/i;
  cleaned = cleaned.replace(footerRegex, "");
  cleaned = cleaned.replace(/━━━━━━━━━━\s*/g, "");
  cleaned = cleaned.replace(/ (?:Link gốc & mã nguồn|Chi tiết & nguồn) dưới bình luận đầu tiên\s*$/i, "");
  // Strip any broken/truncated footer remnants (e.g. from AI token limit cuts like "_________________\nChi tiết &")
  cleaned = cleaned.replace(/(?:_{5,}|━━━━━━━━━━)\s*(?:|•)?\s*(?:Chi\s+tiết|Link\s+gốc|Nguồn)?.*$/gi, "");
  cleaned = cleaned.trim();

  let lines = cleaned.split('\n');
  let formatted = [];
  let inBulletSection = false;
  let firstNonEmptyFound = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line) {
      if (formatted.length > 0 && formatted[formatted.length - 1] !== '') {
        formatted.push('');
      }
      continue;
    }

    // First line is title
    if (!firstNonEmptyFound) {
      firstNonEmptyFound = true;
      const emoji = detectTitleEmoji(line);
      const cleanLine = line.replace(/^[\p{Emoji}\s]+/u, '');
      formatted.push(emoji + ' ' + cleanLine.toUpperCase());
      formatted.push('');
      continue;
    }

    // Bullets
    if (line.startsWith('·') || line.startsWith('•') || line.startsWith('-') || line.startsWith('*') || line.startsWith('✓')) {
      if (!inBulletSection) {
        if (formatted.length > 0 && formatted[formatted.length - 1] !== '') {
          formatted.push('');
        }
        inBulletSection = true;
      }
      const bulletText = line.replace(/^[·•\-*✓]\s*/, '');
      formatted.push('· ' + bulletText);
      continue;
    }

    if (inBulletSection) {
      formatted.push('');
      inBulletSection = false;
    }
    formatted.push(line);
  }

  let result = formatted.join('\n');
  const hasRepo = !!options.hasRepo;
  result += "\n" + getFacebookFooter(hasRepo);

  return result;
}

/**
 * Format AI-generated text for Facebook status posting
 * Transforms plain text into visually appealing Facebook format
 *
 * @param {string} text - AI-generated text with \n line breaks
 * @returns {string} - Facebook-optimized text
 */
function formatForFacebook(text) {
  const processedText = applyUnicodeFormatting(text);
  let lines = processedText.split('\n');
  let formatted = [];
  let inBulletSection = false;
  let firstNonEmptyFound = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line) {
      if (formatted.length > 0 && formatted[formatted.length - 1] !== '') {
        formatted.push('');
      }
      continue;
    }

    // Detect title (first non-empty line)
    if (!firstNonEmptyFound) {
      firstNonEmptyFound = true;
      const titleEmoji = detectTitleEmoji(line);
      // Remove any existing emojis at the start to avoid doubling
      const cleanLine = line.replace(/^[\p{Emoji}\s]+/u, '');
      formatted.push((titleEmoji ? titleEmoji + ' ' : '') + cleanLine.toUpperCase());
      formatted.push('');
      continue;
    }

    // Detect bullet points
    if (line.startsWith('·') || line.startsWith('•') || line.startsWith('-') || line.startsWith('*') || line.startsWith('✓')) {
      if (!inBulletSection) {
        if (formatted.length > 0 && formatted[formatted.length - 1] !== '') {
          formatted.push('');
        }
        inBulletSection = true;
      }
      const bulletText = line.replace(/^[·•\-*✓]\s*/, '');
      formatted.push('· ' + bulletText);
      continue;
    }

    if (inBulletSection) {
      formatted.push('');
      inBulletSection = false;
    }
    formatted.push(line);
  }

  return formatted.join('\n');
}

/**
 * Detect appropriate emoji for title based on content
 */
function detectTitleEmoji(title) {
  const lower = title.toLowerCase();

  // Code / Frameworks / Git / Dev
  // Title prefix icons removed for a cleaner professional look
  return '';
}

async function pasteToLexical(element, text, file = null) {
  const readText = () => (element.innerText || element.textContent || "").replace(/\r\n/g, "\n").trim();
  if (readText()) {
    throw new Error("Ô Facebook đang có nội dung. Hãy giữ hoặc xóa bản nháp đó trước khi điền lại để tránh trùng bài.");
  }
  element.focus();
  if (text) {
    const CHUNK_SIZE = 4000;
    for (let offset = 0; offset < text.length;) {
      let end = Math.min(offset + CHUNK_SIZE, text.length);
      // Do not split a surrogate pair (Unicode bold and emoji use these).
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      const chunk = text.slice(offset, end);
      const before = readText();
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const dtText = new DataTransfer();
      dtText.setData("text/plain", chunk);
      element.dispatchEvent(new ClipboardEvent("paste", {
        clipboardData: dtText, bubbles: true, cancelable: true,
      }));
      await new Promise(r => setTimeout(r, 150));
      // Some editors ignore untrusted paste. Use the browser editing command
      // only when nothing changed; never append a second copy after success.
      if (readText() === before && chunk.trim()) {
        element.focus();
        document.execCommand("insertText", false, chunk);
        await new Promise(r => setTimeout(r, 150));
      }
      const expected = text.slice(0, end).replace(/\r\n/g, "\n").trim();
      if (readText() !== expected) {
        throw new Error("Facebook chưa nhận đủ nội dung. Hãy dùng Sao chép nội dung, kiểm tra bản nháp rồi dán thủ công.");
      }
      offset = end;
    }
  }
  // Paste file riêng sau (nếu có). Hỗ trợ cả single file và array of files.
  if (file) {
    const files = Array.isArray(file) ? file : [file];
    if (files.length === 0) return;
    await new Promise(r => setTimeout(r, 800));
      element.focus();
      const dtFile = new DataTransfer();
      for (const f of files) {
        if (f) dtFile.items.add(f);
      }
      if (dtFile.files.length === 0) return;
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: dtFile,
          bubbles: true,
          cancelable: true,
        }),
      );
  }
}
