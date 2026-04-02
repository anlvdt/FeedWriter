(function () {
  "use strict";

  let MIN_LEN = 400;
  let scanTimer = null;
  const injected = new WeakSet();
  const summaryCache = new Map(); // cache by text hash

  chrome.storage.sync.get("minLength", (d) => {
    if (d.minLength) MIN_LEN = d.minLength;
  });

  // Check if extension context is still valid
  function isContextValid() {
    try { return !!chrome.runtime?.id; } catch (e) { return false; }
  }

  // Simple hash for cache key
  function hashText(text) {
    let h = 0;
    for (let i = 0; i < text.length; i++) {
      h = ((h << 5) - h + text.charCodeAt(i)) | 0;
    }
    return h.toString(36);
  }

  const SEE_MORE = [
    "xem thêm", "see more", "voir plus", "mehr anzeigen",
    "もっと見る", "더 보기", "ver más", "ver mais",
  ];

  // Narrowed scan: only check elements inside main content area
  function findNewSeeMoreElements() {
    const results = [];
    // Narrow scope: only scan inside main or mount_0_0
    const root = document.querySelector('div[role="main"]')
      || document.querySelector('div[id^="mount_0_0"]')
      || document.body;
    const els = root.querySelectorAll("div, span");
    for (const el of els) {
      if (el.dataset.fbsScanned) continue;
      if (el.children.length > 3) continue;
      const t = (el.textContent || "").trim().toLowerCase();
      if (t.length > 30 || t.length < 4) continue;
      if (SEE_MORE.includes(t)) {
        el.dataset.fbsScanned = "1";
        if (isInNonPostArea(el)) continue;
        results.push(el);
      }
    }
    return results;
  }

  function isInNonPostArea(el) {
    let p = el;
    for (let i = 0; i < 20; i++) {
      p = p.parentElement;
      if (!p || p === document.body) return false;
      const role = p.getAttribute("role") || "";
      if (["navigation", "banner", "dialog", "complementary"].includes(role)) return true;
      const pos = getComputedStyle(p).position;
      if (pos === "fixed" || pos === "sticky") return true;
    }
    return false;
  }

  function findClickable(el) {
    let p = el;
    for (let i = 0; i < 5; i++) {
      if (!p) return el;
      if (p.getAttribute("role") === "button" || p.tagName === "A") return p;
      p = p.parentElement;
    }
    return el;
  }

  function findTextContainer(seeMoreEl) {
    let el = seeMoreEl, best = null;
    for (let i = 0; i < 12; i++) {
      el = el.parentElement;
      if (!el || el === document.body) break;
      const len = (el.innerText || "").length;
      if (len >= 100 && len < 4000) best = el;
      if (len >= 4000) break;
    }
    return best;
  }

  function findInjectTarget(textContainer) {
    let el = textContainer;
    for (let i = 0; i < 3; i++) {
      if (!el.parentElement || el.parentElement === document.body) break;
      el = el.parentElement;
    }
    return el;
  }

  function cleanText(text) {
    return text.replace(
      /\s*(Xem thêm|See more|Voir plus|Mehr anzeigen|もっと見る|더 보기|Ver más|Ver mais)\s*$/i, ""
    ).trim();
  }

  // === SINGLE REUSABLE OVERLAY ===
  let backdrop = null, panel = null, panelBody = null, activeCloseHandler = null;

  function ensureOverlay() {
    if (panel && panel.isConnected) return;
    // Backdrop
    backdrop = document.createElement("div");
    backdrop.className = "fbs-backdrop";
    document.body.appendChild(backdrop);
    backdrop.addEventListener("click", closeOverlay);
    // Panel
    panel = document.createElement("div");
    panel.className = "fbs-panel";
    panel.innerHTML =
      '<div class="fbs-panel-head"><span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> Tóm tắt AI</span>' +
      '<div class="fbs-close" role="button" tabindex="0">✕</div></div>' +
      '<div class="fbs-panel-body"></div>' +
      '<div class="fbs-panel-footer"><button class="fbs-copy-btn" title="Copy tóm tắt"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy</button></div>';
    document.body.appendChild(panel);
    panelBody = panel.querySelector(".fbs-panel-body");
    panel.querySelector(".fbs-close").addEventListener("click", closeOverlay);
    panel.querySelector(".fbs-copy-btn").addEventListener("click", () => {
      const text = panelBody.innerText || "";
      navigator.clipboard.writeText(text).then(() => {
        const btn = panel.querySelector(".fbs-copy-btn");
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied';
        setTimeout(() => {
          btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy';
        }, 1500);
      });
    });
  }

  function openOverlay(html) {
    ensureOverlay();
    panelBody.innerHTML = html;
    backdrop.classList.add("fbs-visible");
    panel.classList.add("fbs-visible");
    panel.querySelector(".fbs-panel-footer").style.display =
      html.includes("fbs-result") ? "flex" : "none";
  }

  function closeOverlay() {
    if (panel) panel.classList.remove("fbs-visible");
    if (backdrop) backdrop.classList.remove("fbs-visible");
  }

  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeOverlay(); });

  function fmt(t) {
    return t.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/^[-•]\s*/gm, "• ").replace(/\n/g, "<br>");
  }

  function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

  function createBtn() {
    const d = document.createElement("div");
    d.className = "fbs-btn";
    d.setAttribute("role", "button");
    d.setAttribute("tabindex", "0");
    d.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
      '<polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/>' +
      '<line x1="16" y1="17" x2="8" y2="17"/></svg><span>Tóm tắt</span>';
    return d;
  }

  // Send message with context invalidation handling
  async function safeSendMessage(msg) {
    if (!isContextValid()) {
      return { error: "Extension đã được cập nhật. Vui lòng reload trang (F5)." };
    }
    try {
      return await chrome.runtime.sendMessage(msg);
    } catch (e) {
      if (e.message?.includes("Extension context invalidated") || e.message?.includes("Receiving end does not exist")) {
        return { error: "Extension đã được cập nhật. Vui lòng reload trang (F5)." };
      }
      return { error: "Lỗi: " + e.message };
    }
  }

  function inject(target, seeMoreClickable, textContainer) {
    if (injected.has(target)) return;
    if (target.querySelector(".fbs-wrap")) return;
    injected.add(target);

    const wrap = document.createElement("div");
    wrap.className = "fbs-wrap";
    wrap.appendChild(createBtn());

    const pos = getComputedStyle(target).position;
    if (pos === "static" || pos === "") target.style.position = "relative";
    target.appendChild(wrap);

    wrap.querySelector(".fbs-btn").addEventListener("click", async () => {
      openOverlay('<div class="fbs-loading"><div class="fbs-spinner"></div><span>Đang tóm tắt...</span></div>');

      // Expand to get full text, save HTML to restore
      let savedHTML = null;
      if (seeMoreClickable && textContainer) {
        savedHTML = textContainer.innerHTML;
        try { seeMoreClickable.click(); } catch (e) {}
        await new Promise(r => setTimeout(r, 800));
      }

      const text = cleanText((textContainer || target).innerText || "");

      // Restore post to collapsed state
      if (savedHTML && textContainer) {
        textContainer.innerHTML = savedHTML;
      }

      if (!text || text.length < MIN_LEN) {
        openOverlay('<div class="fbs-error">Bài viết quá ngắn để tóm tắt.</div>');
        return;
      }

      // Check cache
      const key = hashText(text);
      if (summaryCache.has(key)) {
        openOverlay('<div class="fbs-result">' + fmt(summaryCache.get(key)) + '</div>');
        return;
      }

      const r = await safeSendMessage({ action: "summarize", text });
      if (r && r.error) {
        openOverlay('<div class="fbs-error">' + esc(r.error) + '</div>');
      } else if (r && r.summary) {
        summaryCache.set(key, r.summary); // cache
        openOverlay('<div class="fbs-result">' + fmt(r.summary) + '</div>');
      } else {
        openOverlay('<div class="fbs-error">Không nhận được phản hồi.</div>');
      }
    });
  }

  function processSeeMore(sm) {
    const textContainer = findTextContainer(sm);
    if (!textContainer) return;
    if ((textContainer.innerText || "").trim().length < MIN_LEN / 2) return;

    const target = findInjectTarget(textContainer);
    if (injected.has(target) || target.querySelector(".fbs-wrap")) return;

    const clickable = findClickable(sm);
    inject(target, clickable, textContainer);
  }

  function scan() {
    if (!isContextValid()) return; // stop scanning if context invalid
    const seeMoreEls = findNewSeeMoreElements();
    seeMoreEls.forEach(processSeeMore);
  }

  function debouncedScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 1500);
  }

  setTimeout(scan, 2000);
  setTimeout(scan, 5000);
  new MutationObserver(() => debouncedScan()).observe(document.body, { childList: true, subtree: true });
  setInterval(scan, 8000);
  console.log("[FBS] Loaded");
})();
