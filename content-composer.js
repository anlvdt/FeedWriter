"use strict";

// --- COMPOSER & AUTO-POST ---

function openFacebookComposer(text, sourceUrl, imageUrl, author, source, allImages, discoveredLinks = []) {
  const preview = document.createElement("div");
  preview.className = "fbs-status-preview";

  // Normalize allImages: ensure it's an array with primary imageUrl first
  const imageList = Array.isArray(allImages) && allImages.length > 0
    ? allImages.slice(0, 10)
    : (imageUrl ? [imageUrl] : []);
  // Ensure primary imageUrl luôn ở đầu để backward compat với old code
  if (imageUrl && !imageList.includes(imageUrl)) imageList.unshift(imageUrl);

  // Validate author/source — bỏ nếu chứa ký tự rác (FB anti-scraping)
  const isValidName = (n) =>
    n &&
    n.length >= 2 &&
    n.length < 80 &&
    !/[a-f0-9]{10,}/i.test(n) &&
    !/\d{8,}/.test(n) &&
    n.split(/\s+/).length <= 10;
  const cleanAuthor = isValidName(author) ? author : "";
  const cleanSource = isValidName(source) ? source : "";
  const initialRelatedLinks = Array.isArray(discoveredLinks) ? discoveredLinks : [];
  const initialRelatedText = initialRelatedLinks.map((item) => item.url).filter(Boolean).join("\n");

  // Ảnh preview: nếu có nhiều ảnh → gallery lưới; nếu 1 ảnh → single preview
  let imgHtml = "";
  if (imageList.length > 1) {
    // Multi-image gallery — tất cả ảnh checked by default, user có thể uncheck
    const thumbsHtml = imageList.map((url, i) =>
      '<label class="fbs-sp-thumb"><input type="checkbox" class="fbs-sp-thumb-cb" data-url="' +
      esc(url) + '" checked><img src="' + esc(url) + '" loading="lazy" onerror="this.parentElement.style.display=\'none\'"></label>'
    ).join("");
    imgHtml =
      '<div class="fbs-sp-image fbs-sp-multi">' +
      '<div class="fbs-sp-multi-header">' + imageList.length + ' ảnh — bỏ tick ảnh không muốn đăng</div>' +
      '<div class="fbs-sp-thumbs">' + thumbsHtml + '</div>' +
      '</div>';
  } else if (imageList.length === 1) {
    imgHtml = '<div class="fbs-sp-image"><img src="' +
      esc(imageList[0]) +
      '" crossorigin="anonymous" onerror="this.parentElement.style.display=\'none\'"><button class="fbs-sp-copy-img"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> Copy ảnh</button></div>';
  }

  preview.innerHTML =
    '<div class="fbs-sp-step-header">' +
    '<div class="fbs-sp-step-title">Chuẩn bị đăng status</div>' +
    '<div class="fbs-sp-step-desc">Kiểm tra ảnh &amp; nguồn → Copy nguồn → dán vào comment đầu trên Facebook.</div>' +
    "</div>" +
    imgHtml +
    '<div class="fbs-sp-link-input">' +
    '<div class="fbs-sp-link-label"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Link bài gốc</div>' +
    '<div class="fbs-sp-link-row">' +
    '<input type="text" class="fbs-sp-link-field" placeholder="Dán link bài gốc — sẽ ghi nguồn ở comment đầu" value="' +
    esc(sourceUrl || "") +
    '">' +
    '<button type="button" class="fbs-sp-paste-link" title="Dán link nguồn từ clipboard" aria-label="Dán link nguồn từ clipboard">Paste</button>' +
    '<button type="button" class="fbs-sp-open-link" title="Mở link trong tab mới" aria-label="Mở link bài gốc"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>' +
    "</div>" +
    "</div>" +
    '<div class="fbs-sp-link-input" style="margin-top:6px">' +
    '<div class="fbs-sp-link-label"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg> Link Github / Download / Tham khảo</div>' +
    '<textarea class="fbs-sp-github-field" rows="2" placeholder="Mỗi dòng một link — tự nhận diện Repo / Download / Tham khảo">' +
    esc(initialRelatedText) +
    "</textarea>" +
    '<div class="fbs-sp-link-chips"></div>' +
    "</div>" +
    '<div class="fbs-sp-link-status">' +
    "</div>" +
    (cleanAuthor
      ? '<div class="fbs-sp-detected-source"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ' +
        esc(cleanAuthor) +
        (cleanSource && cleanSource !== cleanAuthor
          ? ' <span class="fbs-sp-source-group">(' +
            esc(cleanSource) +
            ")</span>"
          : "") +
        "</div>"
      : "") +
    '<div class="fbs-sp-comment" style="display:none">' +
    '<div class="fbs-sp-comment-label">Comment đầu tiên — ghi nguồn (xem trước):</div>' +
    '<div class="fbs-sp-comment-text" tabindex="0" title="Bấm vào để bôi đen nội dung nguồn khi cần copy thủ công"></div>' +
    '<button type="button" class="fbs-sp-copy-comment" title="Copy nội dung nguồn để dán vào comment đầu tiên"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy nguồn</button>' +
    "</div>" +
    '<div class="fbs-sp-actions">' +
    '<button type="button" class="fbs-sp-back" title="Quay lại chỉnh sửa tóm tắt">← Sửa lại</button>' +
    '<button class="fbs-sp-open-fb"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> Đăng status</button>' +
    "</div>";

  panelBody.appendChild(preview);

  panelBody.scrollTop = panelBody.scrollHeight;

  const footer = panel.querySelector(".fbs-panel-footer");
  if (footer) footer.style.display = "none";

  const linkField = preview.querySelector(".fbs-sp-link-field");
  const githubField = preview.querySelector(".fbs-sp-github-field");
  const chipsBox = preview.querySelector(".fbs-sp-link-chips");
  const linkStatus = preview.querySelector(".fbs-sp-link-status");
  const pasteLinkBtn = preview.querySelector(".fbs-sp-paste-link");
  const openLinkBtn = preview.querySelector(".fbs-sp-open-link");
  const backBtn = preview.querySelector(".fbs-sp-back");
  const commentSection = preview.querySelector(".fbs-sp-comment");
  const commentText = preview.querySelector(".fbs-sp-comment-text");
  const copyCommentBtn = preview.querySelector(".fbs-sp-copy-comment");

  // ← Sửa lại: đóng composer preview, quay về màn tóm tắt/edit (giữ nguyên .fbs-result + textarea)
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      if (preview && preview.parentNode) preview.remove();
      if (footer) footer.style.display = "";
      if (panel) panel.classList.remove("fbs-panel-left");
      if (typeof backdrop !== "undefined" && backdrop) {
        backdrop.classList.add("fbs-visible");
      }
      // Không đụng .fbs-result / .fbs-edit-textarea — nội dung tóm tắt được giữ nguyên
      if (panelBody) panelBody.scrollTop = 0;
    });
  }

  const LINK_TYPE_LABEL = { github: "Repo", download: "Tải về", reference: "Tham khảo" };

  // Reflect whether the source-link field has a usable value (green border + open btn)
  function refreshLinkFieldState() {
    const has = /^https?:\/\//i.test(linkField.value.trim());
    linkField.classList.toggle("has-value", has);
    if (openLinkBtn) openLinkBtn.disabled = !has;
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
            '<span class="fbs-sp-chip" data-type="' + esc(item.type) + '" data-url="' + esc(item.url) + '">' +
            '<span class="fbs-sp-chip-badge">' + esc(LINK_TYPE_LABEL[item.type] || "Tham khảo") + "</span>" +
            '<span class="fbs-sp-chip-url" title="' + esc(item.url) + '">' +
            esc(item.url.replace(/^https?:\/\//i, "")) +
            "</span>" +
            '<button type="button" class="fbs-sp-chip-open" title="Mở link" aria-label="Mở ' + esc(item.url) + '"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>' +
            '<button type="button" class="fbs-sp-chip-remove" title="Bỏ link này" aria-label="Bỏ ' + esc(item.url) + '">&times;</button>' +
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
        ? "✓ " + links.length + " link sẽ ghi vào comment nguồn — kiểm tra lại trước khi đăng."
        : "";
    }
  }

  function parseRelatedLinks(rawText) {
    const seen = new Set();
    return (rawText || "")
      .split(/\s+/)
      .map((url) => url.trim())
      .filter((url) => /^https?:\/\//i.test(url))
      .map((url) => {
        const classifyRelatedUrl =
          (window.FeedWriter && window.FeedWriter.dom && window.FeedWriter.dom.classifyRelatedUrl) ||
          window.fbsClassifyRelatedUrl;
        if (typeof classifyRelatedUrl === "function") {
          return classifyRelatedUrl(url, "", "manual");
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
    commentSection.style.display = "block";
    const relatedLinks = parseRelatedLinks(githubUrl);
    const oldRelatedLinks = typeof globalRelatedSourceLinks !== "undefined"
      ? globalRelatedSourceLinks
      : [];
    if (typeof globalRelatedSourceLinks !== "undefined") {
      globalRelatedSourceLinks = relatedLinks;
    }
    if (window.buildCommentText) {
      const commentContent = window.buildCommentText(url, cleanAuthor, cleanSource, { relatedLinks });
      commentText.style.whiteSpace = "pre-line";
      commentText.textContent = commentContent;
    } else {
      let fallbackContent = `📌 NGUỒN THAM KHẢO:\n· Link gốc: ${url || "(chưa có link bài gốc)"}`;
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
    try {
      const u = new URL(raw);
      if (u.hostname.includes("facebook.com")) {
        const mp = u.searchParams.get("multi_permalinks");
        if (mp && u.pathname.includes("/groups/")) {
          return (
            u.origin + u.pathname.replace(/\/$/, "") + "/posts/" + mp + "/"
          );
        }
        const sfid = u.searchParams.get("story_fbid");
        const uid = u.searchParams.get("id");
        if (sfid && uid) {
          return u.origin + "/" + uid + "/posts/" + sfid + "/";
        }
        return u.origin + u.pathname;
      }
      // Non-FB: strip tracking
      for (const k of [...u.searchParams.keys()]) {
        if (
          k.startsWith("utm_") ||
          k.startsWith("__") ||
          ["fbclid", "gclid", "ref"].includes(k)
        )
          u.searchParams.delete(k);
      }
      return u.toString().replace(/\?$/, "");
    } catch (_) {
      return raw;
    }
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
    const url = linkField.value.trim() || sourceUrl || "";
    const githubUrl = githubField.value.trim();
    updateComment(url, githubUrl);
    renderLinkUI();
  });

  githubField.addEventListener("paste", () => {
    setTimeout(() => {
      const url = linkField.value.trim() || sourceUrl || "";
      const githubUrl = githubField.value.trim();
      updateComment(url, githubUrl);
      renderLinkUI();
    }, 50);
  });

  // Paste link bài gốc — app hay đoán sai nguồn, nên ưu tiên link user vừa copy thủ công.
  // clipboardRead là optional_permission: request once on click, then readText.
  if (pasteLinkBtn) {
    pasteLinkBtn.addEventListener("click", async () => {
      selectSourceField();
      try {
        // Ask for optional clipboardRead while we still have the user gesture
        try {
          await new Promise((resolve) => {
            chrome.runtime.sendMessage(
              { action: "request-optional-permission", permissions: ["clipboardRead"] },
              () => resolve(),
            );
          });
        } catch (_) {}
        if (!navigator.clipboard || typeof navigator.clipboard.readText !== "function") {
          throw new Error("clipboard_unavailable");
        }
        const pasted = (await navigator.clipboard.readText()).trim();
        if (!pasted) {
          setPasteLinkButtonState("Clipboard trống", "is-error");
          setTimeout(() => setPasteLinkButtonState("Paste"), 1600);
          return;
        }
        const clean = normalizeFbUrl(pasted);
        linkField.value = clean;
        updateComment(clean, githubField.value.trim());
        refreshLinkFieldState();
        selectSourceField();
        setPasteLinkButtonState("Đã dán", "is-done");
        setTimeout(() => setPasteLinkButtonState("Paste"), 1600);
      } catch (_) {
        // Quyền clipboard bị chặn / không hỗ trợ — hướng dẫn dán tay (Mac: Cmd+V, Win/Linux: Ctrl+V)
        selectSourceField();
        setPasteLinkButtonState("Ctrl/Cmd+V", "is-error");
        if (linkStatus) {
          linkStatus.style.display = "";
          linkStatus.classList.remove("has-link");
          linkStatus.classList.add("no-link");
          linkStatus.textContent = "Hãy dùng Ctrl/Cmd+V dán vào ô link";
        }
        setTimeout(() => {
          setPasteLinkButtonState("Paste");
          selectSourceField();
          // Chỉ clear status nếu vẫn là thông báo lỗi clipboard (tránh xoá trạng thái link hợp lệ)
          if (
            linkStatus &&
            linkStatus.classList.contains("no-link") &&
            /Ctrl\/Cmd\+V/.test(linkStatus.textContent || "")
          ) {
            linkStatus.style.display = "none";
            linkStatus.textContent = "";
            linkStatus.classList.remove("no-link");
          }
        }, 2800);
      }
    });
  }
  if (openLinkBtn) {
    openLinkBtn.addEventListener("click", () => {
      const url = linkField.value.trim();
      if (/^https?:\/\//i.test(url)) window.open(url, "_blank", "noopener");
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
        updateComment(linkField.value.trim() || sourceUrl || "", githubField.value);
        renderLinkUI();
      }
    });
  }

  commentText.addEventListener("click", selectCommentText);
  commentText.addEventListener("focus", selectCommentText);
  if (copyCommentBtn) {
    const COPY_COMMENT_HTML = copyCommentBtn.innerHTML;
    copyCommentBtn.addEventListener("click", async () => {
      const content = (commentText.innerText || commentText.textContent || "").trim();
      if (!content) return;
      try {
        await navigator.clipboard.writeText(content);
        copyCommentBtn.innerHTML =
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Đã copy — dán vào comment';
        copyCommentBtn.classList.add("is-done");
      } catch (_) {
        selectCommentText();
        copyCommentBtn.innerHTML =
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Copy lỗi — đã bôi đen';
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
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> Copy ảnh';
        }, 2500);
      } catch (_) {
        window.open(imageUrl, "_blank");
        copyImgBtn.innerHTML =
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> Mở tab mới';
        setTimeout(() => {
          copyImgBtn.innerHTML =
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> Copy ảnh';
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
          const result = await adapter.post(postData);

          btn.disabled = false;
          if (result.ok) {
            btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Sẵn sàng trên ' + adapter.label + ' — bấm Đăng';
          } else {
            btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Lỗi: ' + (result.reason || "unknown");
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
        btn.innerHTML = '<div class="fbs-spinner" style="width:14px;height:14px;border-width:2px"></div> ' + msg;
      };
      const setDone = (msg) => {
        btn.disabled = false;
        btn.innerHTML =
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> ' + msg;
      };
      const setFail = (msg) => {
        btn.disabled = false;
        btn.innerHTML =
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> ' + msg;
      };

      try {
        // Prep comment text for preview only. Do not auto-copy source because the
        // detected source can be wrong; the user can paste a manually copied link.
        let sourceLine = "";
        const finalUrl = linkField.value.trim() || sourceUrl;
        const finalGithubUrl = githubField.value.trim();
        const finalRelatedLinks = parseRelatedLinks(finalGithubUrl);
        
        if (window.buildCommentText) {
          const oldRelatedLinks = typeof globalRelatedSourceLinks !== "undefined" ? globalRelatedSourceLinks : [];
          if (typeof globalRelatedSourceLinks !== "undefined") globalRelatedSourceLinks = finalRelatedLinks;
          sourceLine = window.buildCommentText(finalUrl, cleanAuthor, cleanSource, { relatedLinks: finalRelatedLinks });
          if (typeof globalRelatedSourceLinks !== "undefined") globalRelatedSourceLinks = oldRelatedLinks;
        } else {
          let fallbackContent = `📌 NGUỒN THAM KHẢO:\n· Link gốc: ${finalUrl || "(chưa có link bài gốc)"}`;
          for (const item of finalRelatedLinks) {
            const label = item.type === "github" ? "Repo/Mã nguồn" : item.type === "download" ? "Download" : "Tham khảo";
            fallbackContent += `\n· ${label}: ${item.url}`;
          }
          sourceLine = fallbackContent;
        }

        // Bước 1: Xác định ảnh user muốn đăng
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

        // Bước 2: Tìm và click nút "Bạn đang nghĩ gì?"
        const allButtons = document.querySelectorAll('div[role="main"] div[role="button"]');
        let composerBtn = null;
        for (const b of allButtons) {
          const t = (b.textContent || "").toLowerCase();
          if (t.includes("bạn đang nghĩ gì") ||
              t.includes("what's on your mind") ||
              t.includes("write something") ||
              t.includes("viết gì đó")) {
            composerBtn = b;
            break;
          }
        }
        if (!composerBtn) {
          window.scrollTo({ top: 0, behavior: "smooth" });
          setFail("Không thấy ô 'Bạn đang nghĩ gì?' — cuộn lên đầu feed rồi thử lại");
          return;
        }

        // Snapshot existing dialogs so we can find the NEW one after click
        const existingDialogs = new Set(document.querySelectorAll('div[role="dialog"]'));
        composerBtn.click();

        // Bước 3: Chờ CREATE POST dialog (dialog MỚI, không phải dialog cũ)
        setStatus("Chờ dialog mở...");
        let editor = null;
        for (let i = 0; i < 25 && !editor; i++) {
          const allDialogs = document.querySelectorAll('div[role="dialog"]');
          for (const dlg of allDialogs) {
            if (existingDialogs.has(dlg)) continue;
            const tb = dlg.querySelector('div[role="textbox"][contenteditable="true"]');
            if (tb) { editor = tb; break; }
          }
          // Fallback: check aria-label on textbox inside any dialog
          if (!editor) {
            const allBoxes = document.querySelectorAll('div[role="dialog"] div[role="textbox"][contenteditable="true"]');
            for (const box of allBoxes) {
              const label = (box.getAttribute("aria-label") || "").toLowerCase();
              if (label.includes("bạn đang nghĩ") || label.includes("what's on your mind") || label.includes("write something")) {
                editor = box;
                break;
              }
            }
          }
          if (!editor) await new Promise(r => setTimeout(r, 200));
        }
        if (!editor) {
          setFail("Không tìm thấy editor");
          return;
        }
        editor.click();
        editor.focus();
        await new Promise(r => setTimeout(r, 600));

        // Bước 4: Fetch ảnh parallel
        let imgFiles = [];
        if (selectedUrls.length > 0) {
          setStatus("Tải " + selectedUrls.length + " ảnh...");
          imgFiles = await fetchImageBlobs(selectedUrls, 10);
          console.log("[Manual Post] Fetched", imgFiles.length, "/", selectedUrls.length, "images");
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
          // Minimal fallback when StatusFormatter unavailable — strip markdown markers only
          textWithFooter = String(text || "").replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1");
        }
        pasteToLexical(editor, textWithFooter, imgFiles.length > 0 ? imgFiles : null);

        // Chờ upload hoàn tất (để user thấy ảnh đã render trước khi bấm Đăng)
        const uploadWait = imgFiles.length > 1 ? 1500 + imgFiles.length * 1000 :
                          imgFiles.length === 1 ? 2000 : 800;
        await new Promise(r => setTimeout(r, uploadWait));

        if (sourceLine) setDone("Sẵn sàng — bấm Đăng, không tự copy nguồn");
        else setDone("Sẵn sàng — bấm Đăng");
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
  if (hasRepo) {
    return "\n━━━━━━━━━━\n👉 Link gốc & mã nguồn dưới bình luận đầu tiên";
  } else {
    return "\n━━━━━━━━━━\n👉 Chi tiết & nguồn dưới bình luận đầu tiên";
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
 * @deprecated Prefer StatusFormatter.format(text, platform, opts). Kept as last-resort fallback until v3.0.
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
 * @deprecated Prefer StatusFormatter.format(text, "facebook", opts). Kept as last-resort fallback until v3.0.
 */
function buildUnifiedStatusText(rawText, options = {}) {
  // Normalize *** to **
  let cleaned = rawText.trim().replace(/^\*{3}\s*/gm, "**");
  
  // Strip any existing footers & separators to prevent duplicates
  const footerRegex = /\s*(?:[—-]\s*\n\s*)?Nguồn\s+dưới\s+(?:cmt|bình\s+luận|binh\s+luan)\s+đầu(?:\s+tiên)?\s*$/i;
  cleaned = cleaned.replace(footerRegex, "");
  cleaned = cleaned.replace(/━━━━━━━━━━\s*/g, "");
  cleaned = cleaned.replace(/👉 (?:Link gốc & mã nguồn|Chi tiết & nguồn) dưới bình luận đầu tiên\s*$/i, "");
  // Strip any broken/truncated footer remnants (e.g. from AI token limit cuts like "_________________\n👉 Chi tiết &")
  cleaned = cleaned.replace(/(?:_{5,}|━━━━━━━━━━)\s*(?:👉|•)?\s*(?:Chi\s+tiết|Link\s+gốc|Nguồn)?.*$/gi, "");
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
      formatted.push('✓ ' + bulletText);
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
 * @deprecated Prefer StatusFormatter.format(text, "facebook", opts). Kept as last-resort fallback until v3.0.
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
      formatted.push(titleEmoji + ' ' + cleanLine.toUpperCase());
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
      formatted.push('✓ ' + bulletText);
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
  if (lower.match(/github|gitlab|git|repo|code|coding|lập trình|react|typescript|javascript|python|c\+\+|rust|go|java|sql|postgres|database|mã nguồn/)) return '💻';

  // UI/UX / Design / Aesthetics
  if (lower.match(/ui|ux|design|giao diện|css|tailwind|color|typography|font|figma|thẩm mỹ|phối màu/)) return '🎨';

  // Performance / Speed / Optimize
  if (lower.match(/performance|speed|optimization|fast|lcp|cwv|memory|leak|tốc độ|tối ưu/)) return '⚡';

  // Security / Privacy / Secure
  if (lower.match(/security|privacy|auth|encryption|secure|hack|leak|bảo mật|quyền riêng tư/)) return '🔒';

  // Mobile / iOS / Android
  if (lower.match(/ios|android|mobile|swift|kotlin|flutter|react native|di động/)) return '📱';

  // Web / Chrome / Browser / Extension
  if (lower.match(/web|chrome|extension|browser|firefox|edge|manifest|trình duyệt|tiện ích/)) return '🌐';

  // DevOps / Build / Deploy
  if (lower.match(/docker|ci|cd|devops|deploy|build|setup|npm|yarn|pip|triển khai/)) return '🔧';

  // Analytics / SEO / Growth
  if (lower.match(/analytics|chart|graph|growth|seo|traffic|thống kê|biểu đồ/)) return '📈';

  // Deep Learning / Research / Cognitive / Science
  if (lower.match(/paper|research|science|brain|cognitive|deep learning|neural|nghiên cứu|khoa học|trí não/)) return '🧠';

  // Technology/AI (generic)
  if (lower.match(/ai|công nghệ|tech|phần mềm|app|tool|software|digital|chatgpt|claude|gemini/)) return '🤖';

  // Business/Money
  if (lower.match(/kinh doanh|tiền|thu nhập|doanh thu|marketing|bán hàng|business|money|revenue/)) return '💰';

  // Education/Learning
  if (lower.match(/học|giáo dục|khóa học|kiến thức|kỹ năng|education|learning|course|skill/)) return '📚';

  // News/Update
  if (lower.match(/tin tức|cập nhật|thông báo|mới|news|update|announcement/)) return '📰';

  // Tips/Guide
  if (lower.match(/tips|hướng dẫn|cách|bí quyết|mẹo|guide|how to|tutorial/)) return '💡';

  // Warning/Important
  if (lower.match(/cảnh báo|quan trọng|chú ý|lưu ý|warning|important|alert/)) return '⚠️';

  // Success/Achievement
  if (lower.match(/thành công|đạt được|chiến thắng|kỷ lục|success|achievement|win/)) return '🎉';

  // Default
  return '📌';
}

function pasteToLexical(element, text, file = null) {
  element.focus();
  // Paste text trước (không kèm file — Facebook sẽ bỏ text nếu có file)
  if (text) {
    const dtText = new DataTransfer();
    dtText.setData("text/plain", text);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: dtText,
        bubbles: true,
        cancelable: true,
      }),
    );
  }
  // Paste file riêng sau (nếu có). Hỗ trợ cả single file và array of files.
  if (file) {
    const files = Array.isArray(file) ? file : [file];
    if (files.length === 0) return;
    setTimeout(() => {
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
    }, 500);
  }
}

async function fbsAgentPost(summaryText, imageUrl, rawSourceUrl, postElement) {
  if (SITE !== "facebook") return { ok: false, reason: "not_facebook" };

  let postText = summaryText || "";
  const cleanUrl = cleanSourceUrl(rawSourceUrl);
  // Lấy author + source (group/page name) từ DOM
  const extractAuthor =
    (window.FeedWriter && window.FeedWriter.dom && window.FeedWriter.dom.extractAuthor) ||
    window.fbsExtractAuthor;
  const postAuthor =
    postElement && typeof extractAuthor === "function"
      ? extractAuthor(postElement)
      : "";
  const postSource =
    postElement && typeof extractPostSource === "function"
      ? extractPostSource(postElement)
      : "";

  // LUÔN tạo commentText — bắt buộc comment nguồn
  let commentText = "";
  // URL hữu ích: phải có permalink pattern (không chỉ là homepage FB hoặc URL ngắn)
  // Giảm threshold từ 30 → 25 để bắt được group URL có slug ngắn
  const hasPostPattern = cleanUrl && (
    cleanUrl.includes("/posts/") ||
    cleanUrl.includes("/permalink") ||
    cleanUrl.includes("story_fbid") ||
    cleanUrl.includes("pfbid") ||
    cleanUrl.includes("multi_permalinks") ||
    cleanUrl.includes("/videos/") ||
    cleanUrl.includes("/photos/")
  );
  const isUsefulUrl = cleanUrl &&
    cleanUrl !== "https://www.facebook.com" &&
    cleanUrl !== "https://www.facebook.com/" &&
    (hasPostPattern || cleanUrl.length > 30);

  if (isUsefulUrl) {
    // Có link chính xác → dùng link + tên tác giả
    commentText = buildCommentText(cleanUrl, postAuthor, postSource);
  } else {
    // Không có link chính xác → build comment từ thông tin có sẵn
    // Sử dụng buildCommentText để format nhất quán
    let fallbackUrl = "";
    if (cleanUrl && cleanUrl.length > 20) {
      fallbackUrl = cleanUrl;
    } else {
      // Dùng URL trang hiện tại nếu có ý nghĩa (group/page/profile)
      const pageUrl = location.href;
      if (pageUrl.includes("/groups/") || pageUrl.includes("/pages/") || pageUrl.match(/facebook\.com\/[^\/?]+\/?$/)) {
        fallbackUrl = pageUrl.split("?")[0];
      }
    }

    if (fallbackUrl) {
      commentText = buildCommentText(fallbackUrl, postAuthor, postSource);
    } else {
      // Không có URL nào → vẫn build comment với author/source (không link)
      if (window.buildCommentText) {
        commentText = window.buildCommentText("", postAuthor, postSource);
      } else {
        commentText = "📌 NGUỒN THAM KHẢO:\n· Link gốc: (chưa có link bài gốc)";
      }
    }
  }
  console.log("[Agent] Comment text prepared:", commentText);
  console.log("[Agent] Author:", postAuthor || "(unknown)", "| Source:", postSource || "(unknown)", "| URL:", cleanUrl || "(none)");

  // Build final post text — StatusFormatter primary; minimal strip fallback only
  {
    const hasRepo = !!(typeof globalCustomSourceLink !== 'undefined' && globalCustomSourceLink);
    if (typeof StatusFormatter !== "undefined") {
      postText = StatusFormatter.format(postText, "facebook", { hasRepo });
    } else {
      // Minimal fallback — strip markdown markers, no legacy formatForFacebook path
      postText = String(postText || "")
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/\*(.*?)\*/g, "$1")
        .trim();
    }
  }

  console.log("[Agent] fbsAgentPost called:", {
    textLength: postText.length,
    textPreview: postText.substring(0, 80),
    hasImage: !!imageUrl,
    sourceUrl: cleanUrl || "(none)",
    hasComment: !!commentText,
  });

  // Step 1: Mở FB Composer (click "Bạn đang nghĩ gì?")
  const mainArea = document.querySelector('div[role="main"]');
  if (!mainArea) return { ok: false, reason: "no_main_area" };

  const allButtons = mainArea.querySelectorAll('div[role="button"]');
  let composerBtn = null;
  for (const b of allButtons) {
    const t = (b.textContent || "").toLowerCase();
    if (
      t.includes("bạn đang nghĩ gì") ||
      t.includes("what's on your mind") ||
      t.includes("write something") ||
      t.includes("viết gì đó") ||
      t.includes("chia sẻ điều gì") ||
      t.includes("say something")
    ) {
      composerBtn = b;
      break;
    }
  }
  if (!composerBtn) return { ok: false, reason: "no_composer_btn" };

  const existingDialogs = new Set(document.querySelectorAll('div[role="dialog"]'));
  composerBtn.click();

  // Step 2: Chờ CREATE POST dialog MỚI (không phải dialog xem post cũ)
  let editor = null;
  for (let i = 0; i < 25; i++) {
    const allDialogs = document.querySelectorAll('div[role="dialog"]');
    for (const dlg of allDialogs) {
      if (existingDialogs.has(dlg)) continue;
      const tb = dlg.querySelector('div[role="textbox"][contenteditable="true"]');
      if (tb) { editor = tb; break; }
    }
    if (!editor) {
      const allBoxes = document.querySelectorAll('div[role="dialog"] div[role="textbox"][contenteditable="true"]');
      for (const box of allBoxes) {
        const label = (box.getAttribute("aria-label") || "").toLowerCase();
        if (label.includes("bạn đang nghĩ") || label.includes("what's on your mind") || label.includes("write something")) {
          editor = box;
          break;
        }
      }
    }
    if (editor) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!editor) {
    console.error("[Agent] Không tìm thấy Editor TextBox.");
    return { ok: false, reason: "no_editor" };
  }

  // Kích hoạt Lexical bằng cách click & focus trước khi paste
  editor.click();
  editor.focus();
  await new Promise((r) => setTimeout(r, 1000));

  // Step 3: Fetch image blobs — agent cố lấy TẤT CẢ ảnh từ bài gốc
  // để post giống bài gốc nhất có thể. Fetch song song để tiết kiệm thời gian.
  let imgFiles = [];
  try {
    // Lấy danh sách tất cả ảnh từ postElement (bao gồm bài share gốc)
    let allImages = [];
    const extractImages =
      (window.FeedWriter && window.FeedWriter.dom && window.FeedWriter.dom.extractImages) ||
      window.fbsExtractImages;
    if (postElement && typeof extractImages === "function") {
      allImages = extractImages(postElement);
    } else if (imageUrl) {
      allImages = [imageUrl];
    }
    // Ensure imageUrl (primary) là ảnh đầu tiên nếu có
    if (imageUrl && !allImages.includes(imageUrl)) {
      allImages.unshift(imageUrl);
    }
    if (allImages.length > 0) {
      console.log("[Agent] Fetching", allImages.length, "image(s) in parallel...");
      imgFiles = await fetchImageBlobs(allImages, 10);
      console.log("[Agent] Fetched", imgFiles.length, "image file(s) successfully");
    }
  } catch (imgErr) {
    console.warn("[Agent] Multi-image fetch failed, fallback to single:", imgErr.message);
    const singleFile = await fetchImageBlob(imageUrl);
    if (singleFile) imgFiles = [singleFile];
  }

  // Step 4: Paste text (+ images) — giả lập gõ chậm
  console.log("[Agent] Pasting text...", { length: postText.length, images: imgFiles.length });
  pasteToLexical(editor, postText, imgFiles.length > 0 ? imgFiles : null);
  // Chờ text render + image upload (multi-image cần nhiều thời gian hơn)
  const uploadWaitMs = imgFiles.length > 1 ? 3000 + imgFiles.length * 1500 :
                      imgFiles.length === 1 ? 5000 : 3000;
  await new Promise((r) => setTimeout(r, uploadWaitMs));

  // Step 5: Chờ nút Tiếp hoặc Đăng native không bị disabled (đợi upload ảnh)
  let fbPostBtn = null;
  let isNextBtn = false;
  for (let i = 0; i < 20; i++) {
    fbPostBtn = document.querySelector(
      'div[aria-label="Tiếp"][role="button"], div[aria-label="Next"][role="button"], div[aria-label="Đăng"][role="button"], div[aria-label="Post"][role="button"]',
    );
    if (fbPostBtn && fbPostBtn.getAttribute("aria-disabled") !== "true") {
      const label = fbPostBtn.getAttribute("aria-label");
      isNextBtn = label === "Tiếp" || label === "Next";
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!fbPostBtn) {
    console.error("[Agent] Không tìm thấy nút Đăng/Tiếp.");
    return { ok: false, reason: "no_post_btn" };
  }
  // Giả lập review trước khi đăng (2-4s)
  await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));
  console.log("[Agent] Clicking post button...");
  fbPostBtn.click();

  // Nếu phải qua bước "Tiếp" (Next), chờ màn hình tiếp theo và bấm "Đăng"
  if (isNextBtn) {
    await new Promise((r) => setTimeout(r, 1000 + Math.random() * 500));
    let finalPostBtn = null;
    for (let i = 0; i < 15; i++) {
      finalPostBtn = document.querySelector(
        'div[aria-label="Đăng"][role="button"], div[aria-label="Post"][role="button"]',
      );
      if (
        finalPostBtn &&
        finalPostBtn.getAttribute("aria-disabled") !== "true"
      )
        break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (finalPostBtn) {
      finalPostBtn.click();
    } else {
      console.error(
        "[Agent] Mắc kẹt sau khi bấm Tiếp, không tìm thấy nút Đăng.",
      );
      return { ok: false, reason: "no_final_post_btn" };
    }
  }

  // Step 6: Chờ post xuất hiện trên Feed
  console.log("[Agent] === STEP 6: Bài đã đăng, chờ feed refresh ===");
  console.log("[Agent] commentText:", commentText.substring(0, 80));
  await new Promise((r) => setTimeout(r, 10000));

  // Step 7: Comment nguồn — bài vừa đăng nằm ngay đầu feed
  {
    try {
      console.log("[Agent] === STEP 7: Comment nguồn ===");

      // Tìm nút "Viết bình luận" trực tiếp bằng aria-label (chính xác nhất)
      let commentBtn = null;
      let commentBox = null;

      // Tăng thời gian poll lên 20s (40 * 500ms) — bài vừa đăng có thể cần
      // thời gian để render xong trong feed, đặc biệt khi có ảnh
      for (let poll = 0; poll < 40 && !commentBtn && !commentBox; poll++) {
        // Ưu tiên: tìm aria-label="Viết bình luận" hoặc "Write a comment"
        commentBtn = document.querySelector('[aria-label="Viết bình luận"][role="button"]') ||
                     document.querySelector('[aria-label="Write a comment"][role="button"]') ||
                     document.querySelector('[aria-label="Comment"][role="button"]') ||
                     // Variant: "Bình luận" only (không có "Viết")
                     document.querySelector('[aria-label="Bình luận"][role="button"]:not([aria-label*="Xem"])');
        // Hoặc comment box đã mở sẵn
        if (!commentBtn) {
          commentBox = document.querySelector('div[role="textbox"][contenteditable="true"][aria-label*="bình luận"]') ||
                       document.querySelector('div[role="textbox"][contenteditable="true"][aria-label*="comment"]') ||
                       document.querySelector('div[role="textbox"][contenteditable="true"][aria-label*="Bình luận"]');
        }
        if (!commentBtn && !commentBox) await new Promise((r) => setTimeout(r, 500));
      }

      if (commentBox) {
        console.log("[Agent] Comment box already open!");
      } else if (commentBtn) {
        console.log("[Agent] Found 'Viết bình luận' button, clicking...");
        commentBtn.scrollIntoView({ behavior: "smooth", block: "center" });
        await new Promise((r) => setTimeout(r, 1000));
        commentBtn.click();
        await new Promise((r) => setTimeout(r, 3000));

        // Poll tìm comment textbox sau khi click (có thể trong dialog) — 15s
        for (let poll = 0; poll < 30 && !commentBox; poll++) {
          // Chính xác nhất: data-lexical-editor textbox
          commentBox = document.querySelector('[data-lexical-editor="true"][role="textbox"][contenteditable="true"]');
          // Fallback: aria-label chứa "Bình luận dưới tên"
          if (!commentBox) {
            commentBox = document.querySelector('[aria-label*="Bình luận dưới tên"][contenteditable="true"]') ||
                         document.querySelector('[aria-label*="Comment as"][contenteditable="true"]');
          }
          // Fallback: bất kỳ textbox contenteditable trong dialog
          if (!commentBox) {
            commentBox = document.querySelector('div[role="dialog"] div[contenteditable="true"][role="textbox"]');
          }
          // Fallback cuối: textbox cuối cùng trong document (thường là comment box mới mở)
          if (!commentBox) {
            const allBoxes = document.querySelectorAll('div[contenteditable="true"][role="textbox"]');
            if (allBoxes.length > 0) commentBox = allBoxes[allBoxes.length - 1];
          }
          if (!commentBox) await new Promise((r) => setTimeout(r, 500));
        }
      } else {
        console.warn("[Agent] ✗ Không tìm thấy nút 'Viết bình luận' sau 20s");
        console.warn("[Agent] ✗ Comment NGUỒN KHÔNG ĐƯỢC ĐĂNG — copy thủ công:", commentText);
        // Copy comment text vào clipboard để user có thể paste thủ công
        try {
          await navigator.clipboard.writeText(commentText);
          console.log("[Agent] Đã copy commentText vào clipboard để user paste thủ công");
        } catch (_) {}
      }

      if (commentBox) {
        console.log("[Agent] ✓ Comment box found! Pasting...");
        commentBox.click();
        commentBox.focus();
        await new Promise((r) => setTimeout(r, 1000));
        pasteToLexical(commentBox, commentText);
        await new Promise((r) => setTimeout(r, 2500));

        // Verify paste thành công — nếu commentBox rỗng thì retry 1 lần
        const pastedText = (commentBox.innerText || commentBox.textContent || "").trim();
        if (pastedText.length < 5) {
          console.warn("[Agent] Paste lần 1 thất bại, retry...");
          commentBox.click();
          commentBox.focus();
          await new Promise((r) => setTimeout(r, 500));
          pasteToLexical(commentBox, commentText);
          await new Promise((r) => setTimeout(r, 2000));
        }

        // Verify lần cuối — chỉ gửi Enter nếu có text
        const finalText = (commentBox.innerText || commentBox.textContent || "").trim();
        if (finalText.length >= 5) {
          // Gửi bằng Enter
          commentBox.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }),
          );
          await new Promise((r) => setTimeout(r, 2000));
          console.log("[Agent] ✓ Comment nguồn đã gửi!");
        } else {
          console.error("[Agent] ✗ Paste commentText failed sau 2 lần retry");
          console.error("[Agent] ✗ Comment NGUỒN KHÔNG ĐƯỢC ĐĂNG — copy thủ công:", commentText);
          try { await navigator.clipboard.writeText(commentText); } catch (_) {}
        }
      } else {
        console.warn("[Agent] ✗ Không tìm thấy ô comment");
      }
    } catch (commentErr) {
      console.error("[Agent] Lỗi khi comment:", commentErr.message);
    }
  }

  // Step 8: Đóng modal "Bài viết" mà Facebook mở sau khi đăng/comment
  // Facebook tự mở post dialog sau khi đăng — agent cần đóng để tiếp tục scroll feed.
  {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      // Ưu tiên: nút Đóng trong dialog (aria-label tiếng Việt và tiếng Anh)
      const closeBtn =
        document.querySelector('div[role="dialog"] [aria-label="Đóng"][role="button"]') ||
        document.querySelector('div[role="dialog"] [aria-label="Close"][role="button"]') ||
        document.querySelector('[aria-label="Đóng"][role="button"]') ||
        document.querySelector('[aria-label="Close"][role="button"]');
      if (closeBtn) {
        console.log("[Agent] Step 8: Đóng modal FB post");
        closeBtn.click();
        await new Promise((r) => setTimeout(r, 800));
      } else {
        // Fallback: Escape key
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }),
        );
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch (_) {}
  }

  // Notify background → browser notification
  try {
    chrome.runtime.sendMessage({
      action: "agent-posted",
      preview: summaryText.substring(0, 100),
    });
  } catch (_) {}

  return { ok: true };
}

// === AUTO GITHUB → FACEBOOK (scheduled) ===
// Lean, self-contained auto-post used by the background scheduler. Opens the FB
// composer, pastes a ready-made status (text-only), publishes it, then drops the
// repo link in the first comment. Reports the outcome back to background.js.
// Manual composer "Đăng status" is separate and still requires an explicit user
// click — this path only runs from the scheduled agent.
async function fbsGithubAutoPost(statusText, repoUrl, imageUrl) {
  const report = (ok, message, stage) => {
    const full =
      stage && !ok
        ? "[" + stage + "] " + message
        : message;
    try {
      chrome.runtime.sendMessage({
        action: "github-autopost-done",
        ok,
        message: full,
        stage: stage || (ok ? "done" : "error"),
      });
    } catch (_) {}
    return { ok, message: full, stage: stage || (ok ? "done" : "error") };
  };

  if (SITE !== "facebook") {
    return report(false, "Không phải tab Facebook.", "site");
  }

  const bodyText = (statusText || "").trim();
  if (!bodyText) return report(false, "Nội dung status rỗng.", "input");
  // Use the SAME unified formatting engine as manual posts. The facebook
  // profile uppercases the WHOLE title line (titleUppercase:true) and, with
  // hasRepo:true, appends the standard "👉 Link gốc & mã nguồn dưới bình luận
  // đầu tiên" footer. No more ad-hoc capitalization / footer hint here.
  // StatusFormatter primary; minimal markdown-strip fallback (no legacy formatters)
  const postText =
    typeof StatusFormatter !== "undefined"
      ? StatusFormatter.format(bodyText, "facebook", { hasRepo: true })
      : bodyText.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1");

  const commentText =
    "📦 Mã nguồn GitHub:\n" + (repoUrl || "") + "\n\n#opensource #github";

  try {
    // Step 1: Open composer ("Bạn đang nghĩ gì?").
    const mainArea = document.querySelector('div[role="main"]');
    if (!mainArea) {
      return report(
        false,
        "Composer not found — không tìm thấy vùng feed (no_main_area).",
        "composer_not_found",
      );
    }

    let composerBtn = null;
    for (const b of mainArea.querySelectorAll('div[role="button"]')) {
      const t = (b.textContent || "").toLowerCase();
      if (
        t.includes("bạn đang nghĩ gì") ||
        t.includes("what's on your mind") ||
        t.includes("write something") ||
        t.includes("viết gì đó") ||
        t.includes("chia sẻ điều gì") ||
        t.includes("say something")
      ) {
        composerBtn = b;
        break;
      }
    }
    if (!composerBtn) {
      return report(
        false,
        "Composer not found — không tìm thấy ô 'Bạn đang nghĩ gì?'.",
        "composer_not_found",
      );
    }

    const existingDialogs = new Set(document.querySelectorAll('div[role="dialog"]'));
    composerBtn.click();

    // Step 2: Wait for the NEW create-post dialog editor.
    let editor = null;
    for (let i = 0; i < 25; i++) {
      for (const dlg of document.querySelectorAll('div[role="dialog"]')) {
        if (existingDialogs.has(dlg)) continue;
        const tb = dlg.querySelector('div[role="textbox"][contenteditable="true"]');
        if (tb) { editor = tb; break; }
      }
      if (editor) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!editor) {
      return report(
        false,
        "Composer not found — dialog soạn thảo không mở được.",
        "composer_not_found",
      );
    }

    editor.click();
    editor.focus();
    await new Promise((r) => setTimeout(r, 800));

    // Step 3: Fetch the GitHub social-preview card (repo "screenshot") and
    // paste it together with the text. Falls back to text-only if the image
    // can't be fetched, so a failed image never blocks the post.
    let imgFiles = [];
    if (imageUrl && typeof fetchImageBlobs === "function") {
      try {
        imgFiles = (await fetchImageBlobs([imageUrl], 1)) || [];
      } catch (_) {
        imgFiles = [];
      }
    }
    try {
      pasteToLexical(editor, postText, imgFiles.length > 0 ? imgFiles : null);
    } catch (pasteErr) {
      return report(
        false,
        "Paste failed — lỗi khi dán nội dung: " +
          (pasteErr && pasteErr.message ? pasteErr.message : String(pasteErr)),
        "paste_failed",
      );
    }
    // Image upload needs more time than text-only.
    await new Promise((r) => setTimeout(r, imgFiles.length > 0 ? 5000 : 2500));

    // Verify paste landed in the editor (Lexical may swallow events)
    {
      const editorText = (editor.innerText || editor.textContent || "").trim();
      if (editorText.length < 8) {
        return report(
          false,
          "Paste failed — editor vẫn trống sau khi dán status.",
          "paste_failed",
        );
      }
    }

    // Step 4: Click Đăng (or Tiếp → Đăng).
    // Auto-agent path only — manual "Đăng status" never auto-clicks Post.
    let postBtn = null;
    let isNextBtn = false;
    for (let i = 0; i < 20; i++) {
      postBtn = document.querySelector(
        'div[aria-label="Tiếp"][role="button"], div[aria-label="Next"][role="button"], div[aria-label="Đăng"][role="button"], div[aria-label="Post"][role="button"]',
      );
      if (postBtn && postBtn.getAttribute("aria-disabled") !== "true") {
        const label = postBtn.getAttribute("aria-label");
        isNextBtn = label === "Tiếp" || label === "Next";
        break;
      }
      await new Promise((r) => setTimeout(r, 800));
    }
    if (!postBtn) {
      return report(
        false,
        "Post button not found — không tìm thấy nút Đăng/Post/Tiếp.",
        "post_button_not_found",
      );
    }

    await new Promise((r) => setTimeout(r, 1500));
    postBtn.click();

    if (isNextBtn) {
      await new Promise((r) => setTimeout(r, 1200));
      let finalBtn = null;
      for (let i = 0; i < 15; i++) {
        finalBtn = document.querySelector(
          'div[aria-label="Đăng"][role="button"], div[aria-label="Post"][role="button"]',
        );
        if (finalBtn && finalBtn.getAttribute("aria-disabled") !== "true") break;
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!finalBtn) {
        return report(
          false,
          "Post button not found — mắc kẹt sau bước Tiếp, không thấy nút Đăng.",
          "post_button_not_found",
        );
      }
      finalBtn.click();
    }

    // Step 5: Wait for the post to land in the feed.
    await new Promise((r) => setTimeout(r, 9000));

    // Step 6: Comment the repo link (best-effort — failure here is non-fatal).
    if (repoUrl) {
      try {
        let commentBtn = null;
        let commentBox = null;
        for (let poll = 0; poll < 40 && !commentBtn && !commentBox; poll++) {
          commentBtn =
            document.querySelector('[aria-label="Viết bình luận"][role="button"]') ||
            document.querySelector('[aria-label="Write a comment"][role="button"]') ||
            document.querySelector('[aria-label="Comment"][role="button"]');
          if (!commentBtn) {
            commentBox =
              document.querySelector('[data-lexical-editor="true"][role="textbox"][contenteditable="true"]');
          }
          if (!commentBtn && !commentBox) await new Promise((r) => setTimeout(r, 500));
        }
        if (commentBtn && !commentBox) {
          commentBtn.scrollIntoView({ behavior: "smooth", block: "center" });
          await new Promise((r) => setTimeout(r, 800));
          commentBtn.click();
          await new Promise((r) => setTimeout(r, 2500));
          for (let poll = 0; poll < 30 && !commentBox; poll++) {
            commentBox =
              document.querySelector('[data-lexical-editor="true"][role="textbox"][contenteditable="true"]') ||
              document.querySelector('div[role="dialog"] div[contenteditable="true"][role="textbox"]');
            if (!commentBox) {
              const boxes = document.querySelectorAll('div[contenteditable="true"][role="textbox"]');
              if (boxes.length) commentBox = boxes[boxes.length - 1];
            }
            if (!commentBox) await new Promise((r) => setTimeout(r, 500));
          }
        }
        if (commentBox) {
          commentBox.click();
          commentBox.focus();
          await new Promise((r) => setTimeout(r, 800));
          pasteToLexical(commentBox, commentText);
          await new Promise((r) => setTimeout(r, 2000));
          const pasted = (commentBox.innerText || commentBox.textContent || "").trim();
          if (pasted.length >= 5) {
            commentBox.dispatchEvent(
              new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }),
            );
            await new Promise((r) => setTimeout(r, 1500));
          }
        }
      } catch (_) {}
    }

    // Step 7: Close any post dialog FB auto-opens.
    try {
      const closeBtn =
        document.querySelector('div[role="dialog"] [aria-label="Đóng"][role="button"]') ||
        document.querySelector('div[role="dialog"] [aria-label="Close"][role="button"]');
      if (closeBtn) closeBtn.click();
    } catch (_) {}

    return report(true, "Đã đăng repo lên Facebook.", "done");
  } catch (e) {
    return report(
      false,
      "Lỗi khi đăng: " + (e && e.message ? e.message : String(e)),
      "error",
    );
  }
}

// ── FeedWriter.composer namespace ─────────────────────────────────────
window.FeedWriter = window.FeedWriter || {};
window.FeedWriter.composer = {
  open: openFacebookComposer,
  agentPost: fbsAgentPost,
  githubAutoPost: fbsGithubAutoPost,
};

// COMPAT aliases — remove after v3.0
window.fbsAgentPost = FeedWriter.composer.agentPost;
window.fbsGithubAutoPost = FeedWriter.composer.githubAutoPost;
