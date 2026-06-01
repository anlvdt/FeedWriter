"use strict";

// Platform adapter registry for the site currently open in the tab.

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

  },

  getAvailableAdapters() {
    return this.adapters;
  },

  getCurrentAdapter() {
    return this.adapters.find(a => a.isAvailable()) || null;
  },

};

// Auto-init when loaded
if (typeof SITE !== "undefined") {
  CrossPoster.init();
}
