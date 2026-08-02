/**
 * Pure heuristic scoring by content profile.
 *
 * Mirrors background.js heuristicScore — keep in sync when production logic changes.
 *
 * Profiles:
 *   tech      — AI/security/tech creator (default, current behavior)
 *   general   — higher baseline, weaker niche AI boost, softer lifestyle penalties
 *
 * CommonJS for node:test via createRequire.
 */
"use strict";

const VALID_PROFILES = ["tech", "general"];

const AI_BRANDS = [
  "claude",
  "anthropic",
  "chatgpt",
  "openai",
  "gpt-4",
  "gpt-3",
  "gpt4",
  "gemini",
  "google deepmind",
  "llama",
  "mistral",
  "deepseek",
  "qwen",
  "grok",
  "copilot",
  "perplexity",
  "midjourney",
  "sora",
  "dall-e",
  "stable diffusion",
  "runway ml",
  "large language model",
  "trí tuệ nhân tạo",
  "google ai studio",
  "notebooklm",
  "meta ai",
  "microsoft ai",
  "amazon bedrock",
];

const FREE_SIGNALS = [
  "miễn phí",
  "free tier",
  "free plan",
  "dùng thử",
  "trial ",
  "gói miễn",
  "đăng ký miễn",
  "tháng miễn phí",
  "promo code",
];

const SECURITY_KEYWORDS = [
  "data breach",
  "rò rỉ dữ liệu",
  "lộ dữ liệu",
  "rò rỉ thông tin",
  "tấn công mạng",
  "tin tặc",
  "hacker attack",
  "ransomware",
  "malware",
  "mã độc",
  "phishing",
  "lỗ hổng bảo mật",
  "bảo mật nghiêm trọng",
  "zero-day",
  "vulnerability",
  "exploit",
  "an ninh mạng",
];

const TECH_BRANDS = [
  "iphone",
  "ipad",
  "macbook",
  "apple silicon",
  "vision pro",
  "samsung galaxy",
  "pixel phone",
  "oneplus",
  "nvidia",
  "rtx ",
  "geforce",
  "h100",
  "a100",
  "microsoft",
  "windows 11",
  "azure",
  "google cloud",
  "qualcomm",
  "snapdragon",
  " tsmc",
  "intel core",
];

const TECH_TOPICS = [
  "machine learning",
  "deep learning",
  "neural network",
  "llm",
  "github",
  "open source",
  "mã nguồn mở",
  "lập trình",
  "developer",
  "kỹ sư phần mềm",
  "bảo mật",
  "cybersecurity",
  "startup",
  "unicorn",
  "gọi vốn",
  "funding",
  "series a",
  "series b",
  "chip ",
  "vi xử lý",
  "bán dẫn",
  "semiconductor",
  "python",
  "javascript",
  "typescript",
  "react",
  "docker",
  "kubernetes",
  "aws ",
  "devops",
  "cicd",
  "api ",
  "framework",
];

const TIP_KEYWORDS = [
  "hướng dẫn",
  "tutorial",
  "tips",
  "thủ thuật",
  "mẹo hay",
  "tối ưu",
  "productivity",
];

const TECH_ANCHORS = [
  "điện thoại",
  "máy tính",
  "laptop",
  "app ",
  "phần mềm",
  "chrome",
  "android",
  "ios ",
];

const NEWS_KEYWORDS = [
  "ra mắt",
  "vừa ra mắt",
  "chính thức ra",
  "công bố",
  "announce",
  "phiên bản mới",
  "cập nhật mới",
  "billion",
  "triệu usd",
  "funding",
  "nghiên cứu mới",
  "research paper",
];

// Hard-sell spam — always penalized (all profiles)
const SPAM_KEYWORDS = [
  "mua ngay",
  "giá sốc",
  "flash sale",
  "voucher",
  "mã giảm",
  "shopee.vn",
  "lazada.vn",
  "tiki.vn",
  "dm để",
  "inbox để",
  "liên hệ ngay",
  "số lượng có hạn",
  "free ship",
  "miễn phí vận chuyển",
];

const OFF_TOPIC_KEYWORDS = [
  "chúc mừng sinh nhật",
  "happy birthday",
  "bóc phốt",
  "drama",
  "sao hàn",
  "kpop",
  "phim bộ",
  "bóng đá",
  "ngoại hạng anh",
  "công thức nấu",
  "cách nấu",
  "tuyển dụng",
  "cần tuyển",
  "chiêm tinh",
  "tarot",
  "tử vi",
];

// Lifestyle keywords: lighter penalty on "general" (not pure drama)
const LIFESTYLE_KEYWORDS = [
  "công thức nấu",
  "cách nấu",
  "du lịch",
  "thời trang",
  "làm đẹp",
  "skincare",
  "fitness",
  "workout",
];

// Product/review/deal content worth summarizing in the general profile.
const PRODUCT_REVIEW_SIGNALS = [
  "review",
  "đánh giá",
  "trải nghiệm",
  "so sánh",
  "ưu nhược điểm",
  "sản phẩm",
  "unboxing",
  "mở hộp",
  "giá bán",
  "có nên mua",
  "worth buying",
  "deal ",
  "khuyến mãi",
  "giảm giá",
  "shopee",
  "lazada",
  "tiki",
  "affiliate",
  "link mua",
  "mua ở đâu",
  "best buy",
  "nên mua",
];

function countHits(lower, keywords) {
  let n = 0;
  for (const kw of keywords) {
    if (lower.includes(kw)) n++;
  }
  return n;
}

function sumBoost(lower, keywords, perHit, maxBoost) {
  let boost = 0;
  for (const kw of keywords) {
    if (lower.includes(kw)) boost = Math.min(boost + perHit, maxBoost);
  }
  return boost;
}

/**
 * @param {string} text
 * @param {'tech'|'general'} [profile='tech']
 * @returns {number} integer score 1–9
 */
function scoreText(text, profile = "tech") {
  if (!text || text.length < 30) return 1;

  const p = VALID_PROFILES.includes(profile) ? profile : "tech";
  const lower = text.toLowerCase();

  // Baseline: tech=3 (strict), general=4 (more balanced)
  let score = p === "general" ? 4 : 3;

  // --- AI brands ---
  // tech: +3/hit max +6 | general: +1.5/hit max +3
  const aiPer = p === "tech" ? 3 : 1.5;
  const aiMax = p === "tech" ? 6 : 3;
  const aiBoost = sumBoost(lower, AI_BRANDS, aiPer, aiMax);
  score += aiBoost;

  // Free-tier on AI content
  if (aiBoost > 0 && FREE_SIGNALS.some((kw) => lower.includes(kw))) {
    score += p === "tech" ? 2 : 1;
  }

  // Security (strongest on tech)
  const secHits = countHits(lower, SECURITY_KEYWORDS);
  if (secHits >= 2) score += p === "tech" ? 2.5 : 1.5;
  else if (secHits === 1) score += p === "tech" ? 1.5 : 1;

  // Tech brands
  const brandPer = p === "tech" ? 2 : 1;
  const brandMax = p === "tech" ? 3 : 2;
  score += sumBoost(lower, TECH_BRANDS, brandPer, brandMax);

  // Tech topics
  const topicHits = countHits(lower, TECH_TOPICS);
  const topicCap = p === "tech" ? 2 : 1;
  score += Math.min(topicHits, topicCap);

  // Tips + tech anchors
  const hasTip = TIP_KEYWORDS.some((kw) => lower.includes(kw));
  const hasTechAnchor = TECH_ANCHORS.some((kw) => lower.includes(kw));
  if (hasTip && hasTechAnchor) score += p === "general" ? 1 : 1.5;
  else if (hasTip) score += p === "general" ? 0.6 : 0.3;

  // News
  if (NEWS_KEYWORDS.some((kw) => lower.includes(kw))) score += 1;

  // URL
  if (/https?:\/\//.test(text)) score += 0.5;

  // --- Product/review signals ---
  if (p === "general") {
    // Mild interest in useful product content
    score += sumBoost(lower, PRODUCT_REVIEW_SIGNALS, 0.5, 1.5);
  }

  // --- Spam hard-sell (all profiles, hard penalty) ---
  // Pure spam like "mua ngay flash sale shopee" should stay low everywhere.
  // hard-sell spam keywords still get full -3/hit cap -5.
  const spamHits = countHits(lower, SPAM_KEYWORDS);
  score -= Math.min(spamHits * 3, 5);

  // --- Off-topic / drama ---
  // general: softer on lifestyle, still penalize pure drama
  let offTopicHits = 0;
  for (const kw of OFF_TOPIC_KEYWORDS) {
    if (!lower.includes(kw)) continue;
    if (
      p === "general" &&
      LIFESTYLE_KEYWORDS.includes(kw)
    ) {
      offTopicHits += 0.4; // soft
    } else {
      offTopicHits += 1;
    }
  }
  // Extra lifestyle soft-check for general (keywords not in OFF_TOPIC)
  if (p === "general") {
    for (const kw of LIFESTYLE_KEYWORDS) {
      if (OFF_TOPIC_KEYWORDS.includes(kw)) continue;
      if (lower.includes(kw)) offTopicHits += 0.3;
    }
  }
  const offCap = p === "general" ? 2.5 : 4;
  const offPer = p === "general" ? 1.2 : 2;
  score -= Math.min(offTopicHits * offPer, offCap);

  // Length
  if (text.length < 100) score -= 1;
  if (text.length >= 200 && text.length <= 3000) score += 0.5;

  return Math.max(1, Math.min(9, Math.round(score)));
}

const scoringProfile = {
  scoreText,
  VALID_PROFILES,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = scoringProfile;
}

if (typeof globalThis !== "undefined") {
  globalThis.FeedWriterScoringProfile = scoringProfile;
}
