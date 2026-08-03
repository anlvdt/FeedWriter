// FeedWriter — EN→VI translator
// Word · phrase · slang · collocation · shadowing
// https://github.com/anlvdt/fb-post-summarizer

(function () {
  "use strict";
  if (window.__feedwriter_translate_loaded) return;
  window.__feedwriter_translate_loaded = true;

  let translateTooltip = null;
  let lastClickTime = 0;
  let lastRect = null;
  let requestToken = 0;
  const DEBOUNCE_DELAY = 280;

  function isContextValid() {
    try {
      return !!chrome.runtime?.id;
    } catch (_) {
      return false;
    }
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function createTranslateTooltip() {
    if (translateTooltip) return;
    translateTooltip = document.createElement("div");
    translateTooltip.className = "fbs-translate-tooltip";
    translateTooltip.setAttribute("data-fbs-ui", "v3");
    document.body.appendChild(translateTooltip);
  }

  function hideTranslateTooltip() {
    if (translateTooltip) translateTooltip.classList.remove("fbs-visible");
    lastRect = null;
  }

  function positionTooltip(rect) {
    if (!translateTooltip || !rect) return;
    const tip = translateTooltip.getBoundingClientRect();
    const w = tip.width || 280;
    const h = tip.height || 80;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const M = 8;

    let left = rect.left + rect.width / 2 - w / 2;
    left = Math.max(M, Math.min(left, vw - w - M));

    let top = rect.bottom + 8;
    if (top + h > vh - M && rect.top - 8 - h > M) {
      top = rect.top - 8 - h;
    }
    top = Math.max(M, Math.min(top, vh - h - M));

    translateTooltip.style.top = top + window.scrollY + "px";
    translateTooltip.style.left = left + window.scrollX + "px";
  }

  /** Parse **Section:** blocks from model output into structured sections. */
  function parseSections(raw) {
    const text = String(raw || "").trim();
    if (!text) return [];
    const lines = text.split(/\n/);
    const sections = [];
    let current = { title: "", body: [] };

    const push = () => {
      const body = current.body.join("\n").trim();
      if (current.title || body) {
        sections.push({ title: current.title, body });
      }
    };

    for (const line of lines) {
      const m = line.match(/^\*\*(.+?)\*\*\s*:?\s*(.*)$/);
      if (m) {
        push();
        current = { title: m[1].trim(), body: m[2] ? [m[2]] : [] };
      } else {
        current.body.push(line);
      }
    }
    push();

    // Fallback: single blob without headers
    if (sections.length === 1 && !sections[0].title) {
      return [{ title: "Kết quả", body: sections[0].body }];
    }
    return sections;
  }

  function modeLabel(mode) {
    const map = {
      auto: "Dịch",
      word: "Từ / cụm",
      passage: "Đoạn văn",
      slang: "Slang",
      collocation: "Collocation",
      shadowing: "Shadowing",
    };
    return map[mode] || "Dịch";
  }

  function renderResult(source, rawTranslation, mode) {
    const sections = parseSections(rawTranslation);
    let bodyHtml = "";
    if (sections.length) {
      bodyHtml = sections
        .map((s) => {
          const title = s.title
            ? '<div class="fbs-translate-section-title">' + esc(s.title) + "</div>"
            : "";
          const body = '<div class="fbs-translate-section-body">' +
            esc(s.body).replace(/\n/g, "<br>") +
            "</div>";
          return '<div class="fbs-translate-section">' + title + body + "</div>";
        })
        .join("");
    } else {
      bodyHtml =
        '<div class="fbs-translate-section-body">' +
        esc(rawTranslation).replace(/\n/g, "<br>") +
        "</div>";
    }

    return (
      '<div class="fbs-translate-head">' +
        '<div class="fbs-translate-word">' + esc(source) + "</div>" +
        '<span class="fbs-translate-mode">' + esc(modeLabel(mode)) + "</span>" +
      "</div>" +
      '<div class="fbs-translate-result">' + bodyHtml + "</div>" +
      '<div class="fbs-translate-actions">' +
        '<button class="fbs-translate-copy" type="button">Copy</button>' +
        '<button class="fbs-translate-copy-source" type="button" title="Copy bản gốc để shadowing">Copy EN</button>' +
      "</div>"
    );
  }

  function wireCopyButtons(rawTranslation, sourceText) {
    const copyBtn = translateTooltip.querySelector(".fbs-translate-copy");
    if (copyBtn) {
      copyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(rawTranslation).then(() => {
          copyBtn.textContent = "Đã copy";
          setTimeout(() => { copyBtn.textContent = "Copy"; }, 1000);
        }).catch(() => {});
      });
    }
    const copySrc = translateTooltip.querySelector(".fbs-translate-copy-source");
    if (copySrc) {
      copySrc.addEventListener("click", (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(sourceText).then(() => {
          copySrc.textContent = "Đã copy";
          setTimeout(() => { copySrc.textContent = "Copy EN"; }, 1000);
        }).catch(() => {});
      });
    }
  }

  /**
   * @param {string} text
   * @param {DOMRect} rect
   * @param {string} mode auto|word|passage|slang|collocation|shadowing
   */
  function showTranslateTooltip(text, rect, mode = "auto", context = "") {
    createTranslateTooltip();
    lastRect = rect;
    const token = ++requestToken;
    const source = String(text || "").trim();
    if (!source) return;

    translateTooltip.setAttribute("role", "status");
    translateTooltip.setAttribute("aria-live", "polite");
    translateTooltip.innerHTML =
      '<div class="fbs-translate-loading"><div class="fbs-spinner"></div> Đang dịch…</div>';
    translateTooltip.classList.add("fbs-visible");
    positionTooltip(rect);

    try {
      chrome.runtime.sendMessage(
        {
          action: "translate-text",
          text: source,
          mode: mode || "auto",
          context: String(context || "").slice(0, 1200),
        },
        (resp) => {
          if (token !== requestToken) return;
          if (chrome.runtime.lastError) {
            if (translateTooltip?.classList.contains("fbs-visible")) {
              translateTooltip.innerHTML =
                '<div class="fbs-translate-error">Không kết nối được</div>';
            }
            return;
          }
          if (!translateTooltip?.classList.contains("fbs-visible")) return;

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

          const rawTranslation = (resp.translation || "").trim();
          if (!rawTranslation) {
            translateTooltip.innerHTML =
              '<div class="fbs-translate-word">' + esc(resp.word || source) + "</div>" +
              '<div class="fbs-translate-error">Không tìm thấy nghĩa</div>';
            if (lastRect) positionTooltip(lastRect);
            return;
          }

          const usedMode = resp.mode || mode || "auto";
          translateTooltip.innerHTML = renderResult(
            resp.word || source,
            rawTranslation,
            usedMode
          );
          if (lastRect) positionTooltip(lastRect);
          wireCopyButtons(rawTranslation, source);
        }
      );
    } catch (_) {
      if (translateTooltip?.classList.contains("fbs-visible")) {
        translateTooltip.innerHTML =
          '<div class="fbs-translate-error">Lỗi hệ thống</div>';
      }
    }
  }

  /** Accept English words, multi-word phrases, light punctuation. */
  function isTranslatable(text) {
    if (!text) return false;
    const t = text.trim();
    if (t.length < 2 || t.length > 2000) return false;
    // Must contain Latin letters
    if (!/[A-Za-z]/.test(t)) return false;
    // Reject pure URLs / emails
    if (/^https?:\/\//i.test(t) || /^[\w.+-]+@[\w.-]+$/.test(t)) return false;
    // Mostly Latin (allow digits, punctuation, spaces)
    const latin = (t.match(/[A-Za-z]/g) || []).length;
    return latin / Math.max(t.replace(/\s/g, "").length, 1) >= 0.45;
  }

  function guessMode(text) {
    const t = text.trim();
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length <= 3 && t.length <= 40) return "word";
    if (words.length <= 12 && t.length <= 100) return "word";
    return "passage";
  }

  function selectionRect() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return rect;
  }

  function selectionContext(text) {
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    const element = node?.nodeType === Node.ELEMENT_NODE
      ? node
      : node?.parentElement;
    if (!element) return "";
    const container = element.closest(
      '[data-testid="tweetText"], article[data-testid="tweet"], [data-ad-preview="message"], [data-ad-comet-preview="message"], [role="article"], p, li',
    );
    const surrounding = (container?.innerText || container?.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!surrounding || surrounding === String(text || "").trim()) return "";
    return surrounding.slice(0, 1200);
  }

  function runTranslate(text, mode, rect) {
    if (!isContextValid() || !isTranslatable(text)) return;
    const r = rect || selectionRect();
    if (!r) return;
    try {
      chrome.runtime.sendMessage({ action: "ping" }, () => {
        if (chrome.runtime.lastError) return;
        showTranslateTooltip(text, r, mode || "auto", selectionContext(text));
      });
    } catch (_) {}
  }

  // Double-click → word / short phrase lookup (auto)
  document.addEventListener("dblclick", (e) => {
    const now = Date.now();
    if (now - lastClickTime < DEBOUNCE_DELAY) return;
    lastClickTime = now;

    if (
      e.target.closest(
        ".fbs-panel, .fbs-floating-toolbar, .fbs-translate-tooltip, .fbs-chip-host"
      )
    )
      return;
    if (
      e.target.closest(
        'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]'
      )
    )
      return;

    const text = window.getSelection().toString().trim();
    if (!isTranslatable(text)) {
      hideTranslateTooltip();
      return;
    }
    runTranslate(text, guessMode(text), selectionRect());
  });

  // Messages from background / content toolbar
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.action) return false;

    if (msg.action === "translate-selection" || msg.action === "translate-text-ui") {
      const text = (msg.text || window.getSelection().toString() || "").trim();
      const mode = msg.mode || "auto";
      if (!text) {
        sendResponse?.({ ok: false, error: "empty" });
        return false;
      }
      let rect = selectionRect();
      if (!rect) {
        // Fallback: viewport center-ish
        rect = {
          left: window.innerWidth / 2 - 40,
          top: 80,
          width: 80,
          height: 20,
          right: window.innerWidth / 2 + 40,
          bottom: 100,
        };
      }
      runTranslate(text, mode === "auto" ? guessMode(text) : mode, rect);
      sendResponse?.({ ok: true });
      return true;
    }
    return false;
  });

  // Expose for content.js floating toolbar (same page, may be separate isolated world!)
  // Content scripts on same extension are separate worlds unless same file list.
  // So floating toolbar must send chrome.runtime message or use window custom event.
  window.addEventListener("message", (ev) => {
    if (ev.source !== window) return;
    const data = ev.data;
    if (!data || data.source !== "feedwriter" || data.type !== "translate") return;
    const text = (data.text || "").trim();
    const mode = data.mode || "auto";
    if (!text) return;
    runTranslate(text, mode, selectionRect());
  });

  document.addEventListener("mousedown", (e) => {
    if (translateTooltip && !translateTooltip.contains(e.target)) {
      hideTranslateTooltip();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && translateTooltip?.classList.contains("fbs-visible")) {
      hideTranslateTooltip();
    }
  });
  document.addEventListener("scroll", () => {
    if (!translateTooltip?.classList.contains("fbs-visible")) return;
    hideTranslateTooltip();
  }, {
    capture: true,
    passive: true,
  });

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
