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

  // Short sources were padded to ~2.4x their length after 2026-09-30. Give the
  // model an explicit ceiling scaled to the source so a 60-word post cannot
  // come back as a 150-word article. Long sources keep the coverage rules.
  const LENGTH_BUDGET_MAX_SOURCE_WORDS = 400;

  function countWords(text) {
    return String(text || "")
      .replace(/https?:\/\/\S+/g, " ")
      .split(/\s+/)
      .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
  }

  function buildLengthBudgetInstruction(text, type = "summary") {
    if (type === "comment_summary") return "";
    const words = countWords(text);
    if (!words || words > LENGTH_BUDGET_MAX_SOURCE_WORDS) return "";
    const ceiling = Math.max(40, Math.round(words * 1.1));
    return "NGÂN SÁCH ĐỘ DÀI: Nguồn chỉ khoảng " + words + " từ. " +
      "Toàn bộ bài viết (kể cả tiêu đề) KHÔNG vượt quá khoảng " + ceiling + " từ. " +
      "Không thêm bối cảnh, phân tích, ý nghĩa hay giải thích mà nguồn không có để kéo dài bài; " +
      "nguồn ít ý thì bài ngắn.";
  }

  // === PROVENANCE: official vendor release vs. community-made work ===
  // Users build mods, plugins, skills and repos FOR a product (Claude Code
  // mods, Cursor rules, ChatGPT GPTs...). Summaries kept turning "my new
  // Claude Code mod" into "Claude Code ra mắt mod mới". Decide who made the
  // thing from the source, tell the model, and verify the output.
  const PROVENANCE_BRANDS = [
    { name: "Claude Code", vendor: "Anthropic", re: /claude\s*code/i },
    { name: "Claude", vendor: "Anthropic", re: /\bclaude\b/i },
    { name: "Codex", vendor: "OpenAI", re: /\bcodex\b/i },
    { name: "ChatGPT", vendor: "OpenAI", re: /\bchatgpt\b/i },
    { name: "Gemini", vendor: "Google", re: /\bgemini\b/i },
    { name: "GitHub Copilot", vendor: "GitHub", re: /\bcopilot\b/i },
    { name: "Cursor", vendor: "Cursor", re: /\bcursor\b/i },
    { name: "VS Code", vendor: "Microsoft", re: /\bvs\s*code\b|visual studio code/i },
    { name: "Obsidian", vendor: "Obsidian", re: /\bobsidian\b/i },
  ];

  // Accounts and GitHub orgs that speak for the vendor itself.
  const OFFICIAL_HANDLES = new Set([
    "anthropicai", "claudeai", "anthropic", "openai", "openaidevs", "chatgptapp",
    "googledeepmind", "geminiapp", "google", "googleai", "github", "cursor_ai",
    "code", "vscode", "obsdmd", "microsoft",
  ]);
  const OFFICIAL_GITHUB_ORGS = new Set([
    "anthropics", "openai", "google", "google-gemini", "google-deepmind",
    "github", "microsoft", "getcursor", "cursor", "obsidianmd",
  ]);
  const OFFICIAL_DOMAINS = /(?:^|\.)(?:anthropic\.com|claude\.com|claude\.ai|openai\.com|blog\.google|deepmind\.google|github\.blog|cursor\.com|code\.visualstudio\.com|obsidian\.md)$/i;

  const COMMUNITY_ARTIFACT =
    "(?:mod|mods|plugin|plug-in|skill|extension|tool|app|repo|project|library|cli|hook|agent|mcp(?:\\s+server)?|theme|status\\s?line|script|bot|wrapper|template|prompt\\s+pack)";
  const COMMUNITY_SIGNALS = [
    new RegExp("\\b(?:I|I've|I\\s+have|I'm|we|we've|we\\s+have)\\s+(?:just\\s+|finally\\s+|recently\\s+)?(?:built|made|created|wrote|released|shipped|launched|open[- ]?sourced|published|developed|coded|hacked\\s+together|put\\s+together|been\\s+(?:building|working\\s+on))\\b", "i"),
    new RegExp("\\b(?:my|our)\\s+(?:new\\s+|first\\s+|own\\s+|little\\s+|latest\\s+|open[- ]source\\s+|side\\s+)?(?:[\\w-]+\\s+){0,3}" + COMMUNITY_ARTIFACT + "\\b", "i"),
    /\b(?:check\s+out|introducing|meet)\s+my\b/i,
    /\b(?:community[- ]made|community|unofficial|fan[- ]made|third[- ]party|open[- ]source(?:d)?\s+by)\b/i,
    new RegExp("(?:mình|tôi|em|bọn\\s+mình|chúng\\s+tôi|team\\s+mình)\\s+(?:vừa\\s+|mới\\s+|đã\\s+)?(?:làm|viết|tạo|build|phát\\s+triển|code|ra\\s+mắt|chia\\s+sẻ|open[- ]?source|xây\\s+dựng)\\s+(?:được\\s+)?(?:một\\s+|cái\\s+|con\\s+|bộ\\s+)?(?:" + COMMUNITY_ARTIFACT + "|công\\s+cụ|ứng\\s+dụng|tiện\\s+ích|dự\\s+án|tính\\s+năng)", "iu"),
    /\b(?:cộng\s+đồng|không\s+chính\s+thức|bên\s+thứ\s+ba)\b/iu,
  ];

  const STRONG_SIGNAL_INDEXES = new Set([0, 1, 2, 4]);

  function handleFromUrl(sourceUrl) {
    const m = String(sourceUrl || "").match(/^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter|threads)\.(?:com|net)\/@?([A-Za-z0-9_.]{1,30})\/(?:status|post)\//i);
    return m ? m[1] : "";
  }

  function detectProvenance(options = {}) {
    const text = String(options.text || "");
    const author = String(options.author || "").trim();
    const sourceUrl = String(options.sourceUrl || "");
    const brands = PROVENANCE_BRANDS.filter((b) => b.re.test(text))
      // "Claude Code" already implies "Claude".
      .filter((b, _, all) => !(b.name === "Claude" && all.some((o) => o.name === "Claude Code")));
    const handle = handleFromUrl(sourceUrl);
    const signals = [];

    let host = "";
    try { host = new URL(sourceUrl).hostname; } catch (_) {}
    const officialAccount =
      (handle && OFFICIAL_HANDLES.has(handle.toLowerCase())) ||
      (host && OFFICIAL_DOMAINS.test(host));
    if (officialAccount) {
      return { kind: "official", brands, creator: handle || host, signals: ["official_account"] };
    }

    // First-person creation ("my new mod", "mình vừa viết plugin") is strong;
    // a "community" mention or a third-party repo link is weak.
    let strong = false;
    COMMUNITY_SIGNALS.forEach((re, index) => {
      if (!re.test(text)) return;
      signals.push(re.source.slice(0, 40));
      if (STRONG_SIGNAL_INDEXES.has(index)) strong = true;
    });
    const repoOwners = [...text.matchAll(/github\.com\/([A-Za-z0-9-]{1,39})\/[A-Za-z0-9_.-]+/gi)]
      .map((m) => m[1].toLowerCase());
    const communityRepo = repoOwners.find((owner) => !OFFICIAL_GITHUB_ORGS.has(owner));
    if (communityRepo) signals.push("github:" + communityRepo);

    // A news post about a vendor release that also mentions community work
    // ("Anthropic launched plugins; the community built 500") stays unknown.
    const vendorAnnouncement = brands.some((b) => new RegExp(
      "(?<![\\p{L}])(?:" + b.vendor + "|" + b.name.replace(/\s+/g, "\\s+") + ")\\s+(?:has\\s+|have\\s+|just\\s+|officially\\s+|vừa\\s+|đã\\s+|chính\\s+thức\\s+)*" +
        "(?:released|releases|launched|launches|announced|announces|introduced|introduces|ships|shipped|rolled\\s+out|ra\\s+mắt|công\\s+bố|phát\\s+hành|giới\\s+thiệu)",
      "iu",
    ).test(text));
    if (!brands.length || !signals.length || (vendorAnnouncement && !strong)) {
      return { kind: "unknown", brands, creator: "", signals };
    }
    const creator = handle ? "@" + handle : author || (communityRepo ? "tác giả repo " + communityRepo : "");
    return { kind: "community", brands, creator, signals };
  }

  function buildProvenanceInstruction(provenance) {
    if (!provenance || provenance.kind !== "community" || !provenance.brands.length) return "";
    const names = provenance.brands.map((b) => b.name);
    const vendors = [...new Set(provenance.brands.map((b) => b.vendor))];
    const who = provenance.creator
      ? "do " + provenance.creator + " (người dùng/lập trình viên cộng đồng) tạo ra"
      : "do một người dùng/lập trình viên cộng đồng tạo ra";
    return "NGUỒN GỐC SẢN PHẨM — DỮ KIỆN HỆ THỐNG ĐÃ XÁC ĐỊNH:\n" +
      "- Thứ được nói tới trong nguồn (mod, plugin, skill, repo, công cụ...) " + who + " cho " + names.join(", ") +
      ". Đây KHÔNG phải sản phẩm hay tính năng chính hãng của " + names.concat(vendors).filter((v, i, a) => a.indexOf(v) === i).join("/") + ".\n" +
      "- Chủ ngữ của tiêu đề và lead là chính mod/dự án đó hoặc tác giả của nó: viết \"Mod 'X' cho " + names[0] + " giúp…\", \"Lập trình viên tạo mod… cho " + names[0] + "\".\n" +
      "- CẤM viết " + names[0] + " / " + vendors[0] + " \"ra mắt\", \"giới thiệu\", \"bổ sung\", \"thêm\", \"cập nhật\", \"phát hành\" thứ này; CẤM gọi là \"tính năng mới của " + names[0] + "\" hay \"chính thức\".";
  }

  const VENDOR_ACTION =
    "(?:chính\\s+thức\\s+)?(?:vừa\\s+|đã\\s+|mới\\s+|sẽ\\s+)?(?:ra\\s+mắt|giới\\s+thiệu|công\\s+bố|tung\\s+ra|phát\\s+hành|bổ\\s+sung|thêm|trình\\s+làng|cập\\s+nhật|mang\\s+(?:đến|tới|lại)|có\\s+thêm|hỗ\\s+trợ\\s+thêm|cho\\s+ra\\s+mắt|mở\\s+rộng|nâng\\s+cấp|launch(?:es|ed)?|releases?d?|adds?)";

  // Returns an issue string when a community work is credited to the vendor.
  function findMisattribution(output, provenance) {
    if (!provenance || provenance.kind !== "community") return "";
    const paragraphs = String(output || "").split(/\n\s*\n/).filter((p) => p.trim());
    const head = paragraphs.slice(0, 2).join("\n");
    const subjects = [...new Set(provenance.brands.flatMap((b) => [b.name, b.vendor]))];
    for (const subject of subjects) {
      const name = subject.replace(/\s+/g, "\\s+");
      const active = new RegExp("(?<![\\p{L}\\p{N}])" + name + "\\s+" + VENDOR_ACTION + "(?![\\p{L}])", "iu");
      const passive = new RegExp("được\\s+" + name + "\\s+" + VENDOR_ACTION, "iu");
      const feature = new RegExp("(?:tính\\s+năng|chế\\s+độ|bản\\s+cập\\s+nhật)\\s+(?:mới\\s+)?(?:chính\\s+thức\\s+)?(?:của\\s+)?" + name + "(?![\\p{L}])", "iu");
      const match = head.match(active) || head.match(passive) || head.match(feature);
      if (match) {
        return "[!] Gán nhầm cho hãng: nguồn là mod/dự án cộng đồng" +
          (provenance.creator ? " của " + provenance.creator : "") +
          ", nhưng bài viết ghi \"" + match[0].trim() + "\" như thể " + subject + " làm ra.";
      }
    }
    return "";
  }

  const api = {
    detectProvenance,
    buildProvenanceInstruction,
    findMisattribution,
    countWords,
    buildLengthBudgetInstruction,
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
