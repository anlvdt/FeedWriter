// FeedWriter — Double-click English → Vietnamese translator
// Runs on ALL web pages
// https://github.com/anlvdt/fb-post-summarizer
// Author: Le An (anlvdt)

(function () {
  "use strict";
  if (window.__feedwriter_translate_loaded) return;
  window.__feedwriter_translate_loaded = true;

  let translateTooltip = null;
  let lastClickTime = 0;
  let lastRect = null; // viewport-relative rect of the looked-up word
  let requestToken = 0; // guards against out-of-order async responses
  const DEBOUNCE_DELAY = 300; // ms

  function isContextValid() {
    try {
      return !!chrome.runtime?.id;
    } catch (e) {
      return false;
    }
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function createTranslateTooltip() {
    if (translateTooltip) return;
    translateTooltip = document.createElement("div");
    translateTooltip.className = "fbs-translate-tooltip";
    document.body.appendChild(translateTooltip);
  }

  function hideTranslateTooltip() {
    if (translateTooltip) translateTooltip.classList.remove("fbs-visible");
    lastRect = null;
  }

  // Position the tooltip relative to `rect` (viewport-relative), measuring the
  // tooltip's real size so it never renders off-screen. Re-run after content
  // changes (loading → result) because the height differs a lot.
  function positionTooltip(rect) {
    if (!translateTooltip) return;
    const tip = translateTooltip.getBoundingClientRect();
    const w = tip.width || 240;
    const h = tip.height || 60;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const M = 8; // viewport margin

    // Horizontal: centre on the word, then clamp inside the viewport.
    let left = rect.left + rect.width / 2 - w / 2;
    left = Math.max(M, Math.min(left, vw - w - M));

    // Vertical: prefer below; flip above when it would overflow the bottom and
    // there's more room on top; finally clamp so the top never goes off-screen.
    let top = rect.bottom + 6;
    if (top + h > vh - M && rect.top - 6 - h > M) {
      top = rect.top - 6 - h;
    }
    top = Math.max(M, Math.min(top, vh - h - M));

    translateTooltip.style.top = top + window.scrollY + "px";
    translateTooltip.style.left = left + window.scrollX + "px";
  }

  function showTranslateTooltip(text, rect) {
    createTranslateTooltip();
    lastRect = rect;
    const token = ++requestToken;
    translateTooltip.setAttribute("role", "status");
    translateTooltip.setAttribute("aria-live", "polite");
    translateTooltip.innerHTML =
      '<div class="fbs-translate-loading"><div class="fbs-spinner"></div> Đang dịch...</div>';
    translateTooltip.classList.add("fbs-visible");
    positionTooltip(rect);

    // Error handling for chrome.runtime.sendMessage
    try {
      chrome.runtime.sendMessage(
        { action: "translate-word", word: text },
        (resp) => {
          // Ignore responses superseded by a newer lookup.
          if (token !== requestToken) return;
          // Check if context is still valid
          if (chrome.runtime.lastError) {
            console.warn(
              "[Translate] Runtime error:",
              chrome.runtime.lastError.message,
            );
            if (
              translateTooltip &&
              translateTooltip.classList.contains("fbs-visible")
            ) {
              translateTooltip.innerHTML =
                '<div class="fbs-translate-error">Không kết nối được</div>';
            }
            return;
          }

          if (
            !translateTooltip ||
            !translateTooltip.classList.contains("fbs-visible")
          )
            return;

          if (!resp) {
            translateTooltip.innerHTML =
              '<div class="fbs-translate-error">Không nhận được phản hồi</div>';
            return;
          }

          if (resp.error) {
            translateTooltip.innerHTML =
              '<div class="fbs-translate-error">' + esc(resp.error) + "</div>";
            return;
          }

          const word = esc(resp.word || text);
          const rawTranslation = (resp.translation || "").trim();
          if (!rawTranslation) {
            translateTooltip.innerHTML =
              '<div class="fbs-translate-word">' +
              word +
              "</div>" +
              '<div class="fbs-translate-error">Không tìm thấy nghĩa</div>';
            if (lastRect) positionTooltip(lastRect);
            return;
          }
          const translation = esc(rawTranslation).replace(/\n/g, "<br>");
          translateTooltip.innerHTML =
            '<div class="fbs-translate-word">' +
            word +
            "</div>" +
            '<div class="fbs-translate-result">' +
            translation +
            "</div>" +
            '<button class="fbs-translate-copy" type="button" title="Sao chép nghĩa" aria-label="Sao chép nghĩa">Sao chép</button>';
          // Re-measure: the result box is taller than the loading row.
          if (lastRect) positionTooltip(lastRect);

          const copyBtn = translateTooltip.querySelector(".fbs-translate-copy");
          if (copyBtn) {
            copyBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              navigator.clipboard
                .writeText(rawTranslation)
                .then(() => {
                  e.target.textContent = "✓ Đã copy";
                  setTimeout(() => {
                    e.target.textContent = "Sao chép";
                  }, 1000);
                })
                .catch((err) => {
                  console.warn("[Translate] Copy failed:", err);
                });
            });
          }
        },
      );
    } catch (err) {
      console.error("[Translate] Failed to send message:", err);
      if (
        translateTooltip &&
        translateTooltip.classList.contains("fbs-visible")
      ) {
        translateTooltip.innerHTML =
          '<div class="fbs-translate-error">Lỗi hệ thống</div>';
      }
    }
  }

  function isEnglishWord(text) {
    return (
      /^[a-zA-Z][-a-zA-Z']{1,30}$/.test(text) ||
      /^[a-zA-Z][-a-zA-Z' ]{1,50}$/.test(text)
    );
  }

  document.addEventListener("dblclick", (e) => {
    // Debounce double-click events
    const now = Date.now();
    if (now - lastClickTime < DEBOUNCE_DELAY) {
      return;
    }
    lastClickTime = now;

    if (
      e.target.closest(
        ".fbs-panel, .fbs-floating-toolbar, .fbs-translate-tooltip",
      )
    )
      return;

    // Don't hijack double-click inside editable fields (composers, search
    // boxes, comment inputs) — the user is selecting their own text there.
    if (
      e.target.closest(
        'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]',
      )
    )
      return;

    const selection = window.getSelection();
    const text = selection.toString().trim();

    if (!text || !isEnglishWord(text)) {
      hideTranslateTooltip();
      return;
    }

    if (!isContextValid()) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    // Wake service worker before sending message (MV3 SW may be asleep)
    try {
      chrome.runtime.sendMessage({ action: "ping" }, () => {
        if (chrome.runtime.lastError) {
          console.warn(
            "[Translate] Service worker unavailable:",
            chrome.runtime.lastError.message,
          );
          return;
        }
        showTranslateTooltip(text, rect);
      });
    } catch (err) {
      console.error("[Translate] Failed to ping service worker:", err);
    }
  });

  document.addEventListener("mousedown", (e) => {
    if (translateTooltip && !translateTooltip.contains(e.target)) {
      hideTranslateTooltip();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (
      e.key === "Escape" &&
      translateTooltip &&
      translateTooltip.classList.contains("fbs-visible")
    ) {
      hideTranslateTooltip();
    }
  });
  document.addEventListener("scroll", hideTranslateTooltip, {
    capture: true,
    passive: true,
  });

  // Cleanup tooltip DOM when extension is reloaded/invalidated
  try {
    const port = chrome.runtime.connect({ name: "translate-keepalive" });
    port.onDisconnect.addListener(() => {
      if (translateTooltip) {
        translateTooltip.remove();
        translateTooltip = null;
      }
    });
  } catch (_) {}
})();
