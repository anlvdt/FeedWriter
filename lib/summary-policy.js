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
    "openai", "open-source", "open source", "llm", "cli", "pc", "pipeline", "plugin", "post", "prompt", "ram", "sdk", "share",
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
    "microkernel", "multimodal", "oauth", "ota update",
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
    "agi", "asi", "cdn", "crm", "cuda", "cve", "ddr", "dlss",
    "ecc", "erp", "fov", "fps", "gan", "gpt", "hdr", "ide", "iot",
    "isp", "json", "k8s", "mcp", "moe", "nlp", "npu", "nvme",
    "ocr", "oled", "ota", "pcie", "pwa", "pwm", "rag", "rest", "rpc",
    "rtx", "saas", "sdk", "sla", "soc", "sql", "ssh", "ssl", "sso",
    "tdp", "tls", "tps", "tpu", "ui", "ux", "vpn", "vram", "wan", "wasm",
  ]);

  // Full names for acronyms the model has guessed wrong ("MCP: giao diện
  // quản lý phiên"). Facts, not style: the glossary must use these.
  const GLOSSARY_EXPANSIONS = {
    mcp: "Model Context Protocol, giao thức mở để AI kết nối với công cụ và nguồn dữ liệu",
    rag: "Retrieval-Augmented Generation, kỹ thuật cho AI tra cứu tài liệu trước khi trả lời",
    moe: "Mixture of Experts, kiến trúc chỉ kích hoạt một phần mô hình cho mỗi yêu cầu",
    npu: "Neural Processing Unit, bộ xử lý chuyên cho tác vụ AI",
    tpu: "Tensor Processing Unit, chip AI của Google",
    agi: "Artificial General Intelligence, trí tuệ nhân tạo tổng quát",
    lora: "Low-Rank Adaptation, cách tinh chỉnh mô hình bằng ít tham số",
    sso: "Single Sign-On, đăng nhập một lần cho nhiều dịch vụ",
    cve: "Common Vulnerabilities and Exposures, mã định danh lỗ hổng bảo mật",
    ota: "Over-the-Air, cập nhật qua mạng không dây",
    vram: "bộ nhớ của card đồ họa",
    tps: "tokens per second, số token tạo ra mỗi giây",
    saas: "Software as a Service, phần mềm dùng qua internet theo thuê bao",
    sla: "Service Level Agreement, cam kết chất lượng dịch vụ",
  };

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
    // A digit alone does not make a token a term: "T3", "K3", "H100" are
    // product names, and the model invented descriptions for them.
    // A versioned standard (DDR5, PCIE5) still counts when its letters are a
    // known acronym.
    return KNOWN_TECH_ACRONYMS.has(normalized) ||
      KNOWN_TECH_ACRONYMS.has(normalized.replace(/\d+$/, "")) ||
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
    const expansions = glossary.candidates
      .map((item) => GLOSSARY_EXPANSIONS[normalizeText(item.term)] ? item.term + " = " + GLOSSARY_EXPANSIONS[normalizeText(item.term)] : "")
      .filter(Boolean);
    return [
      "QUYẾT ĐỊNH GIẢI THÍCH THUẬT NGỮ: INCLUDE.",
      "- Chỉ được giải thích các thuật ngữ sau: " + terms + ".",
      ...(expansions.length ? ["- Nghĩa chuẩn (bắt buộc dùng, không tự suy đoán): " + expansions.join("; ") + "."] : []),
      "- Không giải thích tên sản phẩm, công ty hay dự án. Nếu không chắc nghĩa của thuật ngữ thì bỏ mục đó.",
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
    // A list of links is content to keep, not prose to compress.
    if (extractSourceLinks(text).length >= LINK_LIST_MIN) return "";
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
    // Vendors do not call their own features "mods": "one of those Mods that
    // should be installed in every Claude Code setup" is community work.
    /\bmods?\b/i,
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
    return { kind: "community", brands, creator, signals, noun: artifactNoun(text) };
  }

  // What the source calls the thing. "Mod" was hard-coded in the example,
  // so every community repo came back as "Mod … cho Claude Code".
  const ARTIFACT_KINDS = [
    { re: /\bmods?\b/i, noun: "mod" },
    { re: /\bplug-?ins?\b/i, noun: "plugin" },
    { re: /\bskills?\b/i, noun: "skill" },
    { re: /\bmcp\s+servers?\b/i, noun: "MCP server" },
    { re: /\b(?:browser\s+)?extensions?\b/i, noun: "tiện ích mở rộng" },
    { re: /\bstatus\s?line\b/i, noun: "status line" },
    { re: /\b(?:cli|command[- ]line)\b/i, noun: "công cụ dòng lệnh" },
    { re: /\b(?:apps?|application)\b/i, noun: "ứng dụng" },
    { re: /\b(?:librar(?:y|ies)|sdk|framework)\b/i, noun: "thư viện" },
    { re: /\b(?:tools?|visuali[sz]er|dashboard|monitor|viewer|utility)\b/i, noun: "công cụ" },
    { re: /(?:\bmình|\btôi|\bem)\s+(?:vừa\s+)?(?:làm|viết|tạo)\s+(?:một\s+|cái\s+)?(plugin|skill|mod|công\s+cụ|ứng\s+dụng|tiện\s+ích)/iu, noun: null },
  ];

  function artifactNoun(text) {
    const source = String(text || "");
    for (const kind of ARTIFACT_KINDS) {
      const m = source.match(kind.re);
      if (m) return kind.noun || m[1].toLowerCase();
    }
    return "dự án";
  }

  function buildProvenanceInstruction(provenance) {
    if (!provenance || provenance.kind !== "community" || !provenance.brands.length) return "";
    const names = provenance.brands.map((b) => b.name);
    const vendors = [...new Set(provenance.brands.map((b) => b.vendor))];
    const noun = provenance.noun || "dự án";
    const who = provenance.creator
      ? "do " + provenance.creator + " (người dùng/lập trình viên cộng đồng) tạo ra"
      : "do một người dùng/lập trình viên cộng đồng tạo ra";
    const products = names.length > 1
      ? names.join(", ") + " (nêu đủ các sản phẩm này, KHÔNG gắn riêng cho một sản phẩm)"
      : names[0];
    return "NGUỒN GỐC SẢN PHẨM — DỮ KIỆN HỆ THỐNG ĐÃ XÁC ĐỊNH:\n" +
      "- Thứ được nói tới trong nguồn là " + noun + " " + who + ", dùng với " + products +
      ". Đây KHÔNG phải sản phẩm hay tính năng chính hãng của " + names.concat(vendors).filter((v, i, a) => a.indexOf(v) === i).join("/") + ".\n" +
      "- Gọi đúng loại theo nguồn: \"" + noun + "\". " +
      (noun === "mod" ? "" : "KHÔNG gọi là \"mod\" vì nguồn không dùng từ này. ") +
      "Chủ ngữ của tiêu đề và lead là chính " + noun + " đó (theo tên riêng) hoặc tác giả của nó.\n" +
      "- CẤM viết " + names[0] + " / " + vendors[0] + " \"ra mắt\", \"giới thiệu\", \"bổ sung\", \"thêm\", \"cập nhật\", \"phát hành\" thứ này; CẤM gọi là \"tính năng mới của " + names[0] + "\" hay \"chính thức\".";
  }

  // "Mod …" when the source never says mod: a wrong kind, usually copied from
  // a prompt example. Returns an issue string or "".
  function findWrongArtifactKind(output, sourceText) {
    if (/\bmods?\b/i.test(String(sourceText || ""))) return "";
    if (!/(?<![\p{L}\p{N}])mods?(?![\p{L}\p{N}])/iu.test(String(output || ""))) return "";
    return "[!] Gọi sai loại sản phẩm: nguồn không gọi đây là mod; dùng đúng loại (" + artifactNoun(sourceText) + ").";
  }

  // Fallback after the revision pass: replace a leftover "mod" with the kind
  // the source uses.
  function replaceWrongArtifactKind(output, sourceText) {
    if (!findWrongArtifactKind(output, sourceText)) return String(output || "");
    const noun = artifactNoun(sourceText);
    return String(output || "").replace(/(?<![\p{L}\p{N}])(mods?)(?![\p{L}\p{N}])/giu, (m) =>
      m === m.toUpperCase() ? noun.toUpperCase() : m[0] === "M" ? noun.charAt(0).toUpperCase() + noun.slice(1) : noun);
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
      const active = new RegExp("(?<![\\p{L}\\p{N}])" + name + "(?:\\s*,[^,.\\n]{1,80},)?\\s+" + VENDOR_ACTION + "(?![\\p{L}])", "iu");
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

  // === SOURCE LINKS: list posts ("10 GitHub projects for…") ===
  // The output must carry every link of the source. The model is told which
  // links exist, the output is checked, and missing ones are appended.
  const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/gi;

  function cleanUrl(url) {
    return String(url || "").replace(/[.,;:!?…»”’]+$/u, "");
  }

  // A display-truncated link ("github.com/x/skills…QuoteLuong") or one glued
  // to the post's time and view count ("vercel.app1:5883730K") cannot be
  // required or appended: it would publish a broken URL.
  function isUsableUrl(url) {
    if (/…|\.{3}/.test(url)) return false;
    try {
      const parsed = new URL(url);
      return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(parsed.hostname) && !parsed.port;
    } catch (_) {
      return false;
    }
  }

  function urlKey(url) {
    return cleanUrl(url)
      .toLowerCase()
      .replace(/^https?:\/\/(?:www\.)?/, "")
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "");
  }

  function labelFromUrl(url) {
    const path = cleanUrl(url).replace(/^https?:\/\/[^/]+\/?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
    const parts = path.split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : cleanUrl(url).replace(/^https?:\/\//, "");
  }

  function extractSourceLinks(text) {
    const lines = String(text || "").split("\n");
    const links = [];
    const seen = new Set();
    lines.forEach((line, index) => {
      let previousEnd = 0;
      for (const match of line.matchAll(URL_RE)) {
        const before = line.slice(previousEnd, match.index);
        previousEnd = match.index + match[0].length;
        const url = cleanUrl(match[0]);
        const key = urlKey(url);
        if (!key || seen.has(key) || !isUsableUrl(url)) continue;
        seen.add(key);
        // Label: text before the URL on the same line, else the nearest
        // short non-link line above it ("01 OpenScholar"), else the repo name.
        let label = before.replace(/^[\s.,;:)]+/u, "").replace(/[▸►▶•·\-*→:–—(\[\s]+$/u, "").replace(/^[\s▸►▶•·\-*]+/u, "").trim();
        if (!label || label.length > 60) {
          label = "";
          for (let i = index - 1; i >= Math.max(0, index - 2); i--) {
            const prev = lines[i].trim();
            if (!prev) continue;
            if (!/https?:\/\//i.test(prev) && prev.length <= 60) label = prev;
            break;
          }
        }
        label = label.replace(/^\d{1,3}[.)]?\s+/, "").trim() || labelFromUrl(url);
        links.push({ url, label });
      }
    });
    return links;
  }

  // Two or more links means the links are part of the content, not a footer.
  const LINK_LIST_MIN = 2;

  function buildLinksInstruction(links) {
    if (!Array.isArray(links) || links.length < LINK_LIST_MIN) return "";
    return "LINK TRONG NGUỒN — BẮT BUỘC GIỮ ĐỦ " + links.length + " LINK:\n" +
      links.map((link) => "- " + link.label + ": " + link.url).join("\n") + "\n" +
      (links.length >= 3
        ? "- Nguồn là danh sách. Giữ MỌI mục và đúng thứ tự, nhóm như nguồn; mỗi mục một dòng: \"· Tên: mô tả ngắn bằng tiếng Việt — link\".\n"
        : "- Đặt mỗi link ngay sau ý nó minh chứng trong bài.\n") +
      "- Chép link NGUYÊN VĂN như trên (không rút gọn, không đổi chữ hoa/thường, không bọc markdown [..](..)). Không gom link xuống cuối bài, không bỏ mục nào để rút ngắn.";
  }

  function findMissingLinks(output, links) {
    if (!Array.isArray(links) || !links.length) return [];
    const present = new Set([...String(output || "").matchAll(URL_RE)].map((m) => urlKey(m[0])));
    return links.filter((link) => !present.has(urlKey(link.url)));
  }

  function appendMissingLinks(output, missing) {
    if (!Array.isArray(missing) || !missing.length) return String(output || "");
    return String(output || "").trimEnd() + "\n\nLiên kết:\n" +
      missing.map((link) => "· " + link.label + ": " + link.url).join("\n");
  }

  // === SUGGESTIONS STATED AS FACT ===
  // "Add Gemini 4 Argon to the paid plans, and they get hard to beat" is the
  // author's suggestion; it came back as "Antigravity cũng bổ sung Gemini 4
  // Argon". Find imperative/conditional additions in the source and check the
  // output hedges every sentence that mentions them.
  const SUGGESTION_RES = [
    /(?:^|[.!?]\s+|\n)\s*(?:[Jj]ust\s+)?(?:[Aa]dd|[Ii]magine|[Gg]ive\s+(?:it|them|us))\s+([A-Z][\w.+-]*(?:\s+[A-Z0-9][\w.+-]*){0,4})/g,
    /\bif\s+(?:they|you|we|\w+)\s+(?:add|adds|added|ship|ships|release|releases|bring|brings)\s+([A-Z][\w.+-]*(?:\s+[A-Z0-9][\w.+-]*){0,4})/gi,
    /\b(?:would|could|should)\s+(?:add|ship|release|bring)\s+([A-Z][\w.+-]*(?:\s+[A-Z0-9][\w.+-]*){0,4})/gi,
  ];
  const HEDGE_RE = /(?<![\p{L}])(?:nếu|giá\s+như|giả\s+sử|có\s+thể|đề\s+xuất|gợi\s+ý|kiến\s+nghị|nên|kỳ\s+vọng|mong\s+muốn|cho\s+rằng|khi\s+được|chưa)(?![\p{L}])/iu;

  function findSuggestedAsFact(output, sourceText) {
    const source = String(sourceText || "");
    const names = new Set();
    for (const re of SUGGESTION_RES) {
      re.lastIndex = 0;
      for (const m of source.matchAll(re)) names.add(m[1].trim());
    }
    if (!names.size) return "";
    const sentences = String(output || "").split(/(?<=[.!?…])\s+|\n+/);
    for (const name of names) {
      const needle = name.toLowerCase();
      const stated = sentences.find((s) => s.toLowerCase().includes(needle) && !HEDGE_RE.test(s));
      if (stated) {
        return "[!] Biến giả định thành sự thật: nguồn chỉ đề xuất/giả định về " + name +
          ", nhưng bài viết ghi như việc đã xảy ra (\"" + stated.trim().slice(0, 90) + "\").";
      }
    }
    return "";
  }

  const api = {
    findSuggestedAsFact,
    GLOSSARY_EXPANSIONS,
    extractSourceLinks,
    buildLinksInstruction,
    findMissingLinks,
    appendMissingLinks,
    detectProvenance,
    buildProvenanceInstruction,
    findMisattribution,
    artifactNoun,
    findWrongArtifactKind,
    replaceWrongArtifactKind,
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
