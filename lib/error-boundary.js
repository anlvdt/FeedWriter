/**
 * FeedWriter error boundary + circuit breaker.
 *
 * Dependency-free and side-effect-free on load: nothing here registers global
 * listeners or touches storage by itself. Callers construct what they need.
 *
 * Note on storage: background.js restricts chrome.storage.local to
 * TRUSTED_CONTEXTS, so a content script must NOT write there. Content scripts
 * report errors through the service worker message bridge instead.
 */
"use strict";

(function initErrorBoundary(root) {
  const SEVERITY = {
    CRITICAL: "critical",
    HIGH: "high",
    MEDIUM: "medium",
    LOW: "low",
  };

  const CATEGORY = {
    NETWORK: "network",
    API: "api",
    DOM: "dom",
    STORAGE: "storage",
    VALIDATION: "validation",
    UNKNOWN: "unknown",
  };

  /** Error carrying classification + user-facing recovery hints. */
  class FeedWriterError extends Error {
    constructor(message, options = {}) {
      super(message);
      this.name = "FeedWriterError";
      this.code = options.code || "UNKNOWN_ERROR";
      this.severity = options.severity || SEVERITY.MEDIUM;
      this.category = options.category || CATEGORY.UNKNOWN;
      this.context = options.context || {};
      this.timestamp = Date.now();
      this.userMessage = options.userMessage || message;
      this.retryable = options.retryable === true;
    }

    toJSON() {
      return {
        message: this.message,
        code: this.code,
        severity: this.severity,
        category: this.category,
        timestamp: this.timestamp,
        userMessage: this.userMessage,
        retryable: this.retryable,
      };
    }
  }

  const NETWORK_PATTERN = /network|fetch|econn|enotfound|failed to fetch/i;
  const TIMEOUT_PATTERN = /timeout|aborted|quá chậm/i;
  const RATE_PATTERN = /rate limit|quota|too many requests|resource.?exhausted/i;
  const STORAGE_PATTERN = /storage|quota_bytes|chrome\.storage/i;
  const DOM_PATTERN = /element|selector|node|dom/i;

  function classify(message) {
    if (RATE_PATTERN.test(message)) return { category: CATEGORY.API, retryable: true };
    if (TIMEOUT_PATTERN.test(message)) return { category: CATEGORY.NETWORK, retryable: true };
    if (NETWORK_PATTERN.test(message)) return { category: CATEGORY.NETWORK, retryable: true };
    if (STORAGE_PATTERN.test(message)) return { category: CATEGORY.STORAGE, retryable: false };
    if (DOM_PATTERN.test(message)) return { category: CATEGORY.DOM, retryable: false };
    return { category: CATEGORY.UNKNOWN, retryable: false };
  }

  /**
   * Collects and classifies errors for one execution context.
   * Keeps a bounded in-memory ring; persistence is the caller's choice.
   */
  class ErrorBoundary {
    constructor(options = {}) {
      this.name = options.name || "ErrorBoundary";
      this.onError = typeof options.onError === "function" ? options.onError : null;
      this.maxLogSize = options.maxLogSize || 50;
      this.errorLog = [];
    }

    handleError(error, context = {}) {
      const enriched = this.enrich(error, context);
      this.errorLog.push(enriched);
      if (this.errorLog.length > this.maxLogSize) {
        this.errorLog = this.errorLog.slice(-this.maxLogSize);
      }
      console.error(`[FeedWriter ${this.name}]`, enriched.code, enriched.message);
      if (this.onError) {
        try {
          this.onError(enriched);
        } catch (handlerError) {
          console.warn(`[FeedWriter ${this.name}] onError threw:`, handlerError);
        }
      }
      return enriched;
    }

    enrich(error, context) {
      if (error instanceof FeedWriterError) {
        error.context = { ...error.context, ...context };
        return error;
      }
      const message = error?.message || String(error);
      const { category, retryable } = classify(message);
      return new FeedWriterError(message, {
        code: error?.code || "UNCAUGHT",
        category,
        retryable,
        context: { ...context, stack: error?.stack },
      });
    }

    getStats() {
      const byCategory = {};
      for (const error of this.errorLog) {
        byCategory[error.category] = (byCategory[error.category] || 0) + 1;
      }
      return { total: this.errorLog.length, byCategory, recent: this.errorLog.slice(-10) };
    }

    clear() {
      this.errorLog = [];
    }
  }

  /**
   * Circuit breaker: stops hammering a provider that keeps failing.
   * closed → (threshold failures) → open → (after timeout) → half-open → closed
   */
  class CircuitBreaker {
    constructor(options = {}) {
      this.name = options.name || "CircuitBreaker";
      this.threshold = options.threshold || 5;
      this.timeout = options.timeout || 60_000;
      this.state = "closed";
      this.failureCount = 0;
      this.lastFailureTime = 0;
    }

    async execute(fn) {
      if (this.state === "open") {
        if (Date.now() - this.lastFailureTime <= this.timeout) {
          throw new FeedWriterError(`${this.name} is unavailable`, {
            code: "CIRCUIT_OPEN",
            severity: SEVERITY.HIGH,
            category: CATEGORY.NETWORK,
            retryable: true,
          });
        }
        this.state = "half-open";
      }

      try {
        const result = await fn();
        this.failureCount = 0;
        this.state = "closed";
        return result;
      } catch (error) {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        if (this.failureCount >= this.threshold) this.state = "open";
        throw error;
      }
    }

    getState() {
      return {
        state: this.state,
        failureCount: this.failureCount,
        lastFailureTime: this.lastFailureTime,
      };
    }

    reset() {
      this.state = "closed";
      this.failureCount = 0;
      this.lastFailureTime = 0;
    }
  }

  const api = {
    FeedWriterError,
    ErrorBoundary,
    CircuitBreaker,
    SEVERITY,
    CATEGORY,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FeedWriterErrorBoundary = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
