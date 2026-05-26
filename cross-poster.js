"use strict";

// Cross-post orchestrator — manages platform selection UI and dispatches to adapters.
// Wires into content-composer.js's existing "Đăng status" flow.

const CrossPoster = {
  adapters: [],
  _initialized: false,

  init() {
    if (this._initialized) return;
    this._initialized = true;

    this.adapters = [
      typeof PosterFacebook !== "undefined" ? PosterFacebook : null,
      typeof PosterThreads !== "undefined" ? PosterThreads : null,
      typeof PosterX !== "undefined" ? PosterX : null,
      typeof PosterLinkedin !== "undefined" ? PosterLinkedin : null,
      typeof PosterReddit !== "undefined" ? PosterReddit : null,
    ].filter(Boolean);

    this._loadSavedPlatforms();
  },

  getAvailableAdapters() {
    return this.adapters;
  },

  getCurrentAdapter() {
    return this.adapters.find(a => a.isAvailable()) || null;
  },

  _savedPlatforms: new Set(),

  _loadSavedPlatforms() {
    try {
      chrome.storage.sync.get(["crossPostPlatforms"], (data) => {
        if (data.crossPostPlatforms) {
          this._savedPlatforms = new Set(data.crossPostPlatforms);
        }
      });
    } catch (_) {}
  },

  _savePlatforms(platforms) {
    this._savedPlatforms = new Set(platforms);
    try {
      chrome.storage.sync.set({ crossPostPlatforms: platforms });
    } catch (_) {}
  },

  createPlatformSelector() {
    const container = document.createElement("div");
    container.className = "fbs-crosspost-selector";
    container.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin:8px 0;";

    const currentSite = this.getCurrentAdapter();

    for (const adapter of this.adapters) {
      const isCurrent = adapter === currentSite;
      const isChecked = isCurrent || this._savedPlatforms.has(adapter.name);

      const label = document.createElement("label");
      label.style.cssText = `
        display:inline-flex;align-items:center;gap:4px;
        padding:4px 10px;border-radius:16px;font-size:12px;font-weight:500;
        cursor:${isCurrent ? "default" : "pointer"};user-select:none;
        border:1.5px solid ${isChecked ? adapter.color : "rgba(255,255,255,0.15)"};
        background:${isChecked ? adapter.color + "20" : "transparent"};
        color:${isChecked ? adapter.color : "rgba(255,255,255,0.4)"};
        transition:all 0.15s ease;
        ${isCurrent ? "opacity:1;" : ""}
      `;

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = isChecked;
      checkbox.disabled = isCurrent;
      checkbox.dataset.platform = adapter.name;
      checkbox.style.cssText = "display:none;";

      const icon = document.createElement("span");
      icon.textContent = adapter.icon;
      icon.style.cssText = "font-weight:700;font-size:11px;";

      const nameSpan = document.createElement("span");
      nameSpan.textContent = adapter.label;

      if (isCurrent) {
        const badge = document.createElement("span");
        badge.textContent = "✓";
        badge.style.cssText = "font-size:10px;opacity:0.7;";
        label.appendChild(badge);
      }

      label.appendChild(checkbox);
      label.appendChild(icon);
      label.appendChild(nameSpan);

      if (!isCurrent) {
        label.addEventListener("click", (e) => {
          e.preventDefault();
          checkbox.checked = !checkbox.checked;
          label.style.borderColor = checkbox.checked ? adapter.color : "rgba(255,255,255,0.15)";
          label.style.background = checkbox.checked ? adapter.color + "20" : "transparent";
          label.style.color = checkbox.checked ? adapter.color : "rgba(255,255,255,0.4)";

          const selected = this._getSelectedPlatforms(container);
          this._savePlatforms(selected);
        });
      }

      container.appendChild(label);
    }

    return container;
  },

  _getSelectedPlatforms(container) {
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    const selected = [];
    checkboxes.forEach(cb => {
      if (cb.checked) selected.push(cb.dataset.platform);
    });
    return selected;
  },

  async postToSelected(postData, selectorContainer) {
    const selectedNames = selectorContainer
      ? this._getSelectedPlatforms(selectorContainer)
      : [this.getCurrentAdapter()?.name].filter(Boolean);

    const results = [];
    const currentSite = this.getCurrentAdapter();

    // Post to current site first (direct DOM injection)
    if (currentSite && selectedNames.includes(currentSite.name)) {
      const result = await currentSite.post(postData);
      results.push(result);
    }

    // Queue other platforms via background script message
    const otherPlatforms = selectedNames.filter(n => n !== currentSite?.name);
    if (otherPlatforms.length > 0) {
      try {
        chrome.runtime.sendMessage({
          action: "crosspost-queue",
          platforms: otherPlatforms,
          postData: {
            title: postData.title,
            content: postData.content,
            images: postData.images,
            tags: postData.tags,
            sourceUrl: postData.sourceUrl,
          },
        });
        for (const p of otherPlatforms) {
          results.push({ ok: true, platform: p, queued: true });
        }
      } catch (err) {
        console.warn("[CrossPost] Failed to queue:", err.message);
        for (const p of otherPlatforms) {
          results.push({ ok: false, platform: p, reason: "queue_failed" });
        }
      }
    }

    return results;
  },

  buildStatusLine(results) {
    return results.map(r => {
      const adapter = this.adapters.find(a => a.name === r.platform);
      const label = adapter ? adapter.label : r.platform;
      if (r.queued) return `${label}: đã xếp hàng`;
      if (r.ok) return `${label}: ✓`;
      return `${label}: ✗ ${r.reason || ""}`;
    }).join(" · ");
  },
};

// Auto-init when loaded
if (typeof SITE !== "undefined") {
  CrossPoster.init();
}
