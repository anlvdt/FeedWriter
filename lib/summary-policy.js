/**
 * FeedWriter summary/glossary policy.
 *
 * Shared by content scripts (offer/gate decisions) and the service worker
 * (prompt constraints + output validation). Keep this file dependency-free.
 */
"use strict";

(function initSummaryPolicy(root) {
  const COMMON_TERMS = new Set([
    "agent", "ai", "amd", "api", "app", "addon", "android", "apple", "aws", "camera",
    "ceo", "chatgpt", "chrome", "comment", "cpu", "css", "facebook", "fb",
    "feed", "firefox", "gb", "google", "gpu", "hcm", "html", "http", "https",
    "ibm", "iphone", "internet", "link", "local", "low-code", "nasa", "no-code", "node",
    "openai", "pc", "pipeline", "plugin", "post", "prompt", "ram", "sdk", "share",
    "smartphone", "ssd", "tb", "tiktok", "token", "tp", "ui", "update", "url",
    "usb", "usd", "ux", "vnd", "vn", "website", "wifi", "windows", "workflow",
    "youtube",
  ]);

  const KNOWN_TECH_TERMS = [
    "agentic ai", "airdrop", "benchmark", "blockchain", "checkpoint", "ci/cd",
    "closed-source", "closed source", "cold start", "context window", "cross-platform",
    "end-to-end encryption", "exploit", "fine-tuning", "fine tuning", "firmware",
    "foundry", "function calling", "generative ai", "hallucination", "inference",
    "jailbreak", "large language model", "latency", "lora", "machine learning",
    "microkernel", "multimodal", "oauth", "open-source", "open source", "ota update",
    "parameter", "payload", "prompt injection", "quantization", "refresh rate",
    "retrieval-augmented generation", "rag", "sandbox", "side-loading", "sideloading",
    "smart contract", "soc", "system on chip", "telemetry", "thermal throttling",
    "throughput", "tokenizer", "wafer", "webassembly", "webrtc", "weights",
    "zero-day", "zero day", "zero-shot", "zero shot",
  ];

  // Acronyms worth explaining even when the source does not spell them out.
  // Do not treat arbitrary ALL-CAPS words as terminology: social posts often
  // capitalize ordinary English words such as LOT, NEW, BIG, or FREE.
  const KNOWN_TECH_ACRONYMS = new Set([
    "agi", "asi", "cdn", "cli", "crm", "cuda", "cve", "ddr", "dlss",
    "ecc", "erp", "fov", "fps", "gan", "gpt", "hdr", "ide", "iot",
    "isp", "json", "k8s", "llm", "mcp", "moe", "nlp", "npu", "nvme",
    "ocr", "oled", "ota", "pcie", "pwa", "pwm", "rag", "rest", "rpc",
    "rtx", "saas", "sdk", "sla", "soc", "sql", "ssh", "ssl", "sso",
    "tdp", "tls", "tps", "tpu", "ui", "ux", "vpn", "vram", "wan", "wasm",
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

  const VI_CHARS = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi;
  const MAX_TRANSLATE_CHARS = 6000;

  function looksVietnamese(text) {
    const letters = String(text || "").match(/\p{L}/gu)?.length || 0;
    if (!letters) return false;
    return (String(text).match(VI_CHARS)?.length || 0) / letters > 0.04;
  }

  function isListOnly(text) {
    const lines = String(text || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 3) return false;
    const items = lines.filter((l) => /^(?:[·•\-*▪◦→✅✔️]|\d+[.)])\s*/u.test(l)).length;
    return items >= 3 && items / lines.length >= 0.7;
  }

  // A post that already opens with its own headline and an intro paragraph
  // before a numbered/bulleted list ("10 repos…" + intro + items). Rewriting
  // it as a news item loses items and links, so it is translated in place.
  function isTitledListPost(text) {
    const lines = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 5) return false;
    const isItem = (l) => /^(?:[·•\-*▪◦→]|\d+[.)])\s*\S/u.test(l);
    const [title, intro] = lines;
    if (isItem(title) || title.length > 140 || /[.!?:]$/.test(title)) return false;
    if (isItem(intro) || intro.length < 25) return false;
    return lines.filter(isItem).length >= 3;
  }

  // Too-short or list-only foreign-language sources are translated verbatim
  // instead of summarized/rewritten; Vietnamese sources keep the old policy.
  function decideTranslation(options = {}) {
    const text = String(options.text || "").trim();
    if ((options.type || "summary") !== "summary" || !text) {
      return { translate: false, reason: "not_summary" };
    }
    if (text.length > MAX_TRANSLATE_CHARS) return { translate: false, reason: "too_long" };
    if (looksVietnamese(text)) return { translate: false, reason: "already_vietnamese" };
    if (isListOnly(text)) return { translate: true, reason: "list_only" };
    if (!decideSummary(options).shouldSummarize) return { translate: true, reason: "too_short" };
    return { translate: false, reason: "summarizable" };
  }

  // Explicit "rewrite as translation" request: any language, but one request.
  function canForceTranslation(text) {
    const t = String(text || "").trim();
    return !!t && t.length <= MAX_TRANSLATE_CHARS;
  }

  // Foreign-language sources short enough to translate in one request may fall
  // back from summarizing to translating when there is nothing to summarize.
  function canFallbackToTranslation(text) {
    const t = String(text || "").trim();
    return !!t && t.length <= MAX_TRANSLATE_CHARS && !looksVietnamese(t);
  }

  // === CONTENT-TYPE CLASSIFIER (news | tutorial | review | opinion) ===
  // Deterministic signal scoring. High-confidence results route to a
  // kind-specific prompt template; low-confidence results fall back to an LLM
  // label in the service worker; "none" keeps the default news rewrite.

  const CONTENT_KINDS = ["news", "tutorial", "review", "opinion"];
  const CONTENT_KIND_SET = new Set(CONTENT_KINDS);

  function countMatches(text, re) {
    return (String(text || "").match(re) || []).length;
  }

  function countMatchingLines(text, re) {
    return String(text || "")
      .split(/\n+/)
      .filter((line) => re.test(line)).length;
  }

  // Distinct capitalized multi-word entities not at sentence start
  // (proper-noun density signal for news).
  function countProperNouns(text) {
    const re = /(?:^|[.!?\n]\s*)([A-ZÀ-Ỹ][\p{L}\p{N}&.'’-]*(?:\s+[A-ZÀ-Ỹ][\p{L}\p{N}&.'’-]*){1,3})/gmu;
    const seen = new Set();
    let m;
    while ((m = re.exec(String(text || "")))) seen.add(m[1].toLowerCase());
    return seen.size;
  }

  /**
   * Classify a summary source into a content kind.
   * @param {string} text cleaned source text
   * @param {{site?: string, formatOverride?: string}} [options]
   * @returns {{kind:"news"|"tutorial"|"review"|"opinion",
   *            confidence:"high"|"low"|"none",
   *            scores:{news:number,tutorial:number,review:number,opinion:number},
   *            signals:string[]}}
   */
  function decideContentType(text, options = {}) {
    const scores = { news: 0, tutorial: 0, review: 0, opinion: 0 };
    const signals = [];
    const raw = String(text || "");

    const override = String(options.formatOverride || "").toLowerCase();
    if (CONTENT_KIND_SET.has(override)) {
      return {
        kind: override,
        confidence: "high",
        scores,
        signals: ["user_override"],
      };
    }

    if (informationalCharacters(raw) < 80) {
      return { kind: "news", confidence: "none", scores, signals };
    }
    const normalized = " " + normalizeText(raw) + " ";

    // --- tutorial ---
    const stepLines = countMatchingLines(raw, /^\s*\d{1,2}[.)]\s+\S/);
    if (stepLines) {
      scores.tutorial += 2 * Math.min(3, stepLines);
      signals.push("steps:" + stepLines);
    }
    const codeLines = countMatchingLines(
      raw,
      /`{1,3}[^`\n]+`{1,3}|^\s*(?:\$\s*|npm\s|pip\s|yarn\s|pnpm\s|git\s|docker\s|curl\s|ollama\s|brew\s|apt\s|sudo\s|cd\s|python\s*)/i,
    ) + countMatchingLines(raw, /=>|::|\{[^}]*\}/);
    if (codeLines) {
      scores.tutorial += 2 * Math.min(2, codeLines);
      signals.push("code:" + codeLines);
    }
    if (/(?:hướng\s+dẫn|how\s*[-–]?\s*to|step[-\s]?by[-\s]?step|từng\s+bước|cách\s+(?:cài|dùng|làm|chạy|build|deploy)|tutorial)/i.test(normalized)) {
      scores.tutorial += 3;
      signals.push("howto_marker");
    }
    const imperativeLines = countMatchingLines(
      raw,
      /^\s*(?:mở|vào|chạy|cài|copy|dán|gõ|tải|nhấn|chọn|bật|tắt|thêm)\b/i,
    ) + countMatchingLines(
      raw,
      /^\s*(?:open|run|install|copy|paste|type|download|click|select|add|enable|create)\b/i,
    );
    if (imperativeLines) {
      scores.tutorial += 1 * Math.min(2, imperativeLines);
      signals.push("imperative:" + imperativeLines);
    }
    if (countListItems(raw) >= 3 && imperativeLines >= 2) {
      scores.tutorial += 1;
      signals.push("imperative_list");
    }

    // --- review ---
    if (/(?:ưu\s*điểm|nhược\s*điểm|pros?\s*(?:and|\/|vs)\s*cons?|điểm\s*cộng|điểm\s*trừ)/i.test(normalized)) {
      scores.review += 4;
      signals.push("pros_cons");
    }
    if (/(?:đánh\s*giá|review|trên\s*tay|hands?-?on|trải\s*nghiệm\s*(?:thực\s*tế|sản\s*phẩm|dịch\s*vụ)|so\s*sánh\s*(?:với|giữa))/i.test(normalized)) {
      scores.review += 3;
      signals.push("review_marker");
    }
    if (/\d{1,2}(?:[.,]\d)?\s*\/\s*(?:5|10)\b|(?:chấm|score|rating)\s*\d|★|☆/i.test(raw)) {
      scores.review += 2;
      signals.push("rating");
    }
    const firstPerson = countMatches(
      raw,
      /(?:^|[.!?\n]\s*)(?:mình|tôi|em)\s+(?:đã|vừa|mới|thường)\s+(?:dùng|thử|test|xài|mua|trải\s*nghiệm|cài)/gi,
    ) + countMatches(
      raw,
      /(?:^|[.!?\n]\s*)(?:i(?:'ve| have)?|my)\s+(?:used|tested|tried|been\s+using|bought)/gi,
    );
    if (firstPerson) {
      scores.review += 2 * Math.min(2, firstPerson);
      signals.push("first_person:" + firstPerson);
    }
    if (/(?:kết\s*luận|verdict|đáng\s*(?:mua|dùng|tiền)|khuyên\s*(?:mua|dùng)|recommend)/i.test(normalized)) {
      scores.review += 1;
      signals.push("verdict");
    }

    // --- opinion ---
    const opinionVerbs = countMatches(
      raw,
      /(?:tôi|mình)\s+(?:nghĩ|tin|cho\s+rằng|thấy|cho\s+là)|theo\s+(?:tôi|mình|quan\s+điểm)|in\s+my\s+(?:opinion|view)|i\s+(?:think|believe|argue|feel)/gi,
    );
    if (opinionVerbs) {
      scores.opinion += 2 * Math.min(2, opinionVerbs);
      signals.push("opinion_verbs:" + opinionVerbs);
    }
    const normative = countMatches(
      raw,
      /\b(?:nên|cần\s+phải|đáng\s+lẽ|should|must|ought\s+to)\b/gi,
    );
    const words = raw.split(/\s+/).filter(Boolean).length || 1;
    const normBuckets = Math.floor(normative / Math.max(3, Math.ceil(words / 300) * 3));
    if (normBuckets) {
      scores.opinion += 2 * Math.min(2, normBuckets);
      signals.push("normative:" + normative);
    }
    const attributed = countMatches(
      raw,
      /[A-ZÀ-Ỹ][\p{L}\p{N}&.'’-]+\s+(?:cho\s+rằng|nhận\s+định|khẳng\s+định|cho\s+hay|nói\s+rằng|argues|claims|says)\b/giu,
    );
    if (attributed >= 2) {
      scores.opinion += 1;
      signals.push("attributed:" + attributed);
    }
    if (/(?:unpopular\s+opinion|thực\s+ra|sự\s+thật\s+là|điều\s+mà\s+ít\s+ai\s+nói|hot\s*take)/i.test(normalized)) {
      scores.opinion += 1;
      signals.push("hot_take");
    }

    // --- news (light baseline: only wins when other kinds are quiet) ---
    if (/(?:ra\s+mắt|phát\s+hành|công\s+bố|launch|release|announce|unveil|roll\s*out)/i.test(normalized)) {
      scores.news += 1;
      signals.push("launch");
    }
    if (/ngày\s+\d{1,2}[/.-]\d{1,2}|(?:vào|trong)\s+(?:tháng|quý|năm)\s+\d|thứ\s+(?:hai|ba|tư|năm|sáu|bảy)|chủ\s+nhật/i.test(normalized) ||
        new Set(raw.match(/\b\d{2,4}\b/g) || []).size >= 2) {
      scores.news += 1;
      signals.push("dated");
    }
    if (countProperNouns(raw) >= 3) {
      scores.news += 1;
      signals.push("entities");
    }

    let best = "news";
    let second = 0;
    for (const kind of CONTENT_KINDS) {
      if (scores[kind] > scores[best]) best = kind;
    }
    for (const kind of CONTENT_KINDS) {
      if (kind !== best) second = Math.max(second, scores[kind]);
    }
    const margin = scores[best] - second;
    const confidence =
      scores[best] >= 6 && margin >= 3
        ? "high"
        : scores[best] >= 4 && margin >= 1
          ? "low"
          : "none";
    return {
      kind: scores[best] > 0 ? best : "news",
      confidence,
      scores,
      signals,
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
      "- Tối đa " + glossary.limit + " mục; mỗi mục đúng một dòng theo dạng · Thuật ngữ: Một câu dễ hiểu (nêu chức năng thực tế hoặc tác dụng, tránh định nghĩa sách vở phức tạp).",
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
    decideContentType,
    extractGlossaryCandidates,
    decideGlossary,
    decideSummaryAndGlossary,
    decideTranslation,
    canFallbackToTranslation,
    canForceTranslation,
    looksVietnamese,
    isListOnly,
    isTitledListPost,
    buildGlossaryInstruction,
    sanitizeGlossaryOutput,
    normalizeText,
    isGlossaryAcronym,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FeedWriterSummaryPolicy = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
