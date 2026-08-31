/**
 * FeedWriter summary/glossary policy.
 *
 * Shared by content scripts (offer/gate decisions) and the service worker
 * (prompt constraints + output validation). Keep this file dependency-free.
 */
"use strict";

(function initSummaryPolicy(root) {
  const COMMON_TERMS = new Set([
    "ai", "amd", "api", "app", "addon", "android", "apple", "aws", "camera",
    "ceo", "chatgpt", "chrome", "comment", "cpu", "css", "facebook", "fb",
    "feed", "firefox", "gb", "google", "gpu", "hcm", "html", "http", "https",
    "ibm", "iphone", "internet", "link", "nasa", "openai", "plugin", "post",
    "prompt", "ram", "share", "smartphone", "ssd", "tb", "tiktok", "token",
    "tp", "update", "url", "usb", "usd", "vnd", "vn", "website", "wifi",
    "windows", "youtube",
  ]);

  const KNOWN_TECH_TERMS = [
    "agentic ai", "context window", "fine-tuning", "fine tuning", "function calling",
    "generative ai", "large language model", "machine learning", "multimodal",
    "oauth", "quantization", "retrieval-augmented generation", "rag", "lora",
    "webassembly", "webrtc", "zero-day", "zero day",
  ];

  // Acronyms worth explaining even when the source does not spell them out.
  // Do not treat arbitrary ALL-CAPS words as terminology: social posts often
  // capitalize ordinary English words such as LOT, NEW, BIG, or FREE.
  const KNOWN_TECH_ACRONYMS = new Set([
    "agi", "asi", "cdn", "cli", "crm", "cuda", "dlss", "erp", "gan",
    "gpt", "hdr", "llm", "mcp", "nlp", "npu", "ocr", "oled", "rag",
    "saas", "sdk", "sso", "tpu", "ui", "ux", "vpn", "wasm",
  ]);

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[‐‑‒–—]/g, "-")
      .replace(/[^\p{L}\p{N}+#.\-\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function countSentences(text) {
    const clean = String(text || "").replace(/https?:\/\/\S+/g, " ").trim();
    if (!clean) return 0;
    const punctuated = clean.match(/[.!?…](?:\s|$)/g)?.length || 0;
    if (punctuated > 0) return punctuated;
    return clean.split(/\n+/).filter((line) => line.trim().length >= 35).length;
  }

  function countListItems(text) {
    return String(text || "")
      .split(/\n+/)
      .filter((line) => /^\s*(?:[·•\-*]|\d+[.)])\s+/.test(line)).length;
  }

  function informationalCharacters(text) {
    return String(text || "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/(?:^|\s)[#@][\p{L}\p{N}_]+/gu, "")
      .replace(/\s+/g, " ")
      .trim().length;
  }

  function decideSummary(options = {}) {
    const text = String(options.text || "").trim();
    const site = options.site || "other";
    const type = options.type || "summary";
    const sentenceCount = countSentences(text);
    const listItemCount = countListItems(text);
    const infoChars = informationalCharacters(text);
    const requestedMinimum = Number(options.minimumChars || 0);
    const minimumMet = !Number.isFinite(requestedMinimum) || requestedMinimum <= 0
      ? true
      : infoChars >= requestedMinimum;

    if (type === "comment_summary") {
      return {
        shouldSummarize: infoChars >= 80,
        reason: infoChars >= 80 ? "comment_thread" : "too_short",
        infoChars,
        sentenceCount,
        listItemCount,
      };
    }

    if (site === "x") {
      const threadCount = Number(options.threadCount || 1);
      const shouldSummarize = minimumMet && (
        threadCount >= 3 ||
        infoChars >= 320 ||
        sentenceCount >= 4 ||
        listItemCount >= 4
      );
      return {
        shouldSummarize,
        reason: shouldSummarize
          ? threadCount >= 3 ? "thread" : "dense_x_post"
          : "short_x_post",
        infoChars,
        sentenceCount,
        listItemCount,
      };
    }

    const shouldSummarize = minimumMet && (
      infoChars >= 350 || sentenceCount >= 4 || listItemCount >= 4
    );
    return {
      shouldSummarize,
      reason: shouldSummarize ? "informational_post" : "not_enough_information",
      infoChars,
      sentenceCount,
      listItemCount,
    };
  }

  function addCandidate(result, seen, term, category) {
    const clean = String(term || "").trim().replace(/[.,;:!?]+$/, "");
    const normalized = normalizeText(clean);
    if (!normalized || COMMON_TERMS.has(normalized) || seen.has(normalized)) return;
    if (normalized.length < 2 || normalized.length > 60) return;
    seen.add(normalized);
    result.push({ term: clean, normalized, category });
  }

  function sourceDefinesAcronym(source, acronym) {
    const escaped = String(acronym || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!escaped) return false;
    const longForm = "[A-Z][A-Za-z0-9+.-]+(?:\\s+[A-Z][A-Za-z0-9+.-]+){1,7}";
    return new RegExp(
      "(?:" + longForm + "\\s*\\(\\s*" + escaped + "\\s*\\)|" +
        escaped + "\\s*\\(\\s*" + longForm + "\\s*\\))",
      "i",
    ).test(String(source || ""));
  }

  function isGlossaryAcronym(source, term) {
    const normalized = normalizeText(term);
    return KNOWN_TECH_ACRONYMS.has(normalized) ||
      /\d/.test(String(term || "")) ||
      sourceDefinesAcronym(source, term);
  }

  function extractGlossaryCandidates(text) {
    const source = String(text || "");
    const normalizedSource = normalizeText(source);
    const result = [];
    const seen = new Set();

    const acronymPattern = /(?:^|[^\p{L}\p{N}])([A-Z][A-Z0-9]{1,7})(?=$|[^\p{L}\p{N}])/gu;
    let match;
    while ((match = acronymPattern.exec(source))) {
      if (!isGlossaryAcronym(source, match[1])) continue;
      addCandidate(result, seen, match[1], "acronym");
    }

    for (const term of KNOWN_TECH_TERMS) {
      if (normalizedSource.includes(normalizeText(term))) {
        addCandidate(result, seen, term, "known_technical_term");
      }
    }

    const versionedSecurityTerms = source.match(/\bCVE-\d{4}-\d{4,7}\b/gi) || [];
    for (const term of versionedSecurityTerms) {
      addCandidate(result, seen, term, "security_identifier");
    }

    return result;
  }

  function decideGlossary(options = {}) {
    const site = options.site || "other";
    const type = options.type || "summary";
    if (type === "comment_summary") {
      return { mode: "omit", reason: "comment_summary", candidates: [], limit: 0 };
    }

    const candidates = extractGlossaryCandidates(options.text);
    const limit = site === "x" ? 1 : 3;
    const selected = candidates.slice(0, limit);
    return {
      mode: selected.length > 0 ? "include" : "omit",
      reason: selected.length > 0 ? "unfamiliar_terms_found" : "no_unfamiliar_terms",
      candidates: selected,
      limit: selected.length > 0 ? limit : 0,
    };
  }

  function decideSummaryAndGlossary(options = {}) {
    return {
      summary: decideSummary(options),
      glossary: decideGlossary(options),
    };
  }

  function buildGlossaryInstruction(decision) {
    const glossary = decision || { mode: "omit", candidates: [], limit: 0 };
    if (glossary.mode !== "include" || !glossary.candidates?.length) {
      return [
        "QUYẾT ĐỊNH GIẢI THÍCH THUẬT NGỮ: OMIT.",
        "- KHÔNG in tiêu đề 'Giải thích thuật ngữ' và KHÔNG thêm bất kỳ mục thuật ngữ nào.",
      ].join("\n");
    }
    const terms = glossary.candidates.map((item) => item.term).join(", ");
    return [
      "QUYẾT ĐỊNH GIẢI THÍCH THUẬT NGỮ: INCLUDE.",
      "- Chỉ được giải thích các thuật ngữ sau: " + terms + ".",
      "- Tối đa " + glossary.limit + " mục; mỗi mục đúng một dòng theo dạng · Thuật ngữ: Một câu dễ hiểu.",
      "- Đặt mục này ở cuối bài. Không thêm thuật ngữ khác dù có vẻ liên quan.",
    ].join("\n");
  }

  function sanitizeGlossaryOutput(output, decision) {
    const text = String(output || "").trim();
    if (!text) return text;
    const lines = text.split("\n");
    const headingIndex = lines.findIndex((line) => {
      const clean = line.replace(/\*+/g, "").replace(/[:：]/g, "").trim();
      return clean.length <= 48 &&
        /^(?:giải\s*thích\s*thuật\s*ngữ|glossary|terms? explained)$/iu.test(clean);
    });
    if (headingIndex < 0) return text;

    const body = lines.slice(0, headingIndex).join("\n").trimEnd();
    if (decision?.mode !== "include" || !decision.candidates?.length) return body;

    const allowed = new Map(
      decision.candidates.map((item) => [normalizeText(item.term), item.term]),
    );
    const validItems = [];
    for (const line of lines.slice(headingIndex + 1)) {
      const clean = line.trim().replace(/^[·•\-*]\s*/, "");
      const match = clean.match(/^(.{1,60}?)\s*[:：]\s*(.+)$/);
      if (!match) continue;
      const normalizedTerm = normalizeText(match[1].replace(/\*+/g, ""));
      const canonical = allowed.get(normalizedTerm);
      if (!canonical || !match[2].trim()) continue;
      validItems.push("· " + canonical + ": " + match[2].trim().replace(/\*+/g, ""));
      if (validItems.length >= decision.limit) break;
    }

    if (!validItems.length) return body;
    return body + "\n\nGiải thích thuật ngữ:\n" + validItems.join("\n");
  }

  const api = {
    decideSummary,
    extractGlossaryCandidates,
    decideGlossary,
    decideSummaryAndGlossary,
    buildGlossaryInstruction,
    sanitizeGlossaryOutput,
    normalizeText,
    isGlossaryAcronym,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FeedWriterSummaryPolicy = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
