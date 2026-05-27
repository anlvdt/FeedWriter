"use strict";

// StatusFormatter — Unified formatting engine for all platforms.
// Replaces scattered buildUnifiedStatusText, formatForFacebook, applyUnicodeFormatting.

const StatusFormatter = {

  // ── Platform profiles ──────────────────────────────────────────────

  profiles: {
    facebook: {
      unicodeBold: true,
      unicodeItalic: true,
      titleUppercase: true,
      titleEmoji: true,
      bulletChar: "▸",
      numberStyle: "circled",   // ① ② ③
      sectionSeparator: "",
      footer: true,
      maxLength: 0,             // no limit
    },
    threads: {
      unicodeBold: false,
      unicodeItalic: false,
      titleUppercase: false,
      titleEmoji: true,
      bulletChar: "·",
      numberStyle: "plain",     // 1. 2. 3.
      sectionSeparator: "",
      footer: false,
      maxLength: 500,
    },
    x: {
      unicodeBold: false,
      unicodeItalic: false,
      titleUppercase: false,
      titleEmoji: true,
      bulletChar: "→",
      numberStyle: "plain",
      sectionSeparator: "",
      footer: false,
      maxLength: 280,
    },
    linkedin: {
      unicodeBold: true,
      unicodeItalic: true,
      titleUppercase: false,
      titleEmoji: false,
      bulletChar: "▪",
      numberStyle: "plain",
      sectionSeparator: "—",
      footer: true,
      maxLength: 3000,
    },
    reddit: {
      unicodeBold: false,
      unicodeItalic: false,
      titleUppercase: false,
      titleEmoji: false,
      bulletChar: "-",
      numberStyle: "plain",
      sectionSeparator: "---",
      footer: false,
      maxLength: 0,
    },
  },

  // ── Main entry ─────────────────────────────────────────────────────

  format(rawText, platform = "facebook", options = {}) {
    const profile = this.profiles[platform] || this.profiles.facebook;
    let parsed = this._parse(rawText);
    parsed = this._postProcess(parsed);
    const formatted = this._render(parsed, profile, options);
    return formatted;
  },

  // Convenience: format for current SITE
  formatForCurrentSite(rawText, options = {}) {
    const platform = (typeof SITE !== "undefined") ? SITE : "facebook";
    return this.format(rawText, platform, options);
  },

  // ── Parser: raw text → structured blocks ───────────────────────────

  _parse(rawText) {
    let text = rawText.trim();

    // Strip existing footers/separators (prevent duplication)
    // Must be aggressive — AI sometimes copies footer from examples or prior output
    text = text.replace(/\s*(?:[—-]\s*\n\s*)?Nguồn\s+dưới\s+(?:cmt|bình\s+luận|binh\s+luan)\s+đầu(?:\s+tiên)?\s*$/gi, "");
    text = text.replace(/━━━━━━━━━━\s*/g, "");
    text = text.replace(/👉\s*(?:Link gốc|Chi tiết)[\s&]*(?:nguồn|mã nguồn)?.*dưới\s+(?:bình\s+luận|cmt)\s+đầu(?:\s+tiên)?\s*$/gim, "");
    text = text.replace(/👉\s*(?:Chi tiết|Link gốc|Nguồn)\s*&?\s*$/gim, ""); // truncated footer like "👉 Chi tiết &"
    text = text.replace(/(?:_{5,}|━━━━━━━━━━)\s*(?:👉|•)?\s*(?:Chi\s+tiết|Link\s+gốc|Nguồn)?.*$/gi, "");

    // Normalize markdown artifacts
    text = text.replace(/^\*{3}\s*/gm, "**");

    const lines = text.trim().split("\n");
    const blocks = [];
    let titleFound = false;
    let glossaryItems = [];
    let inGlossary = false;

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const trimmed = raw.trim();

      // Glossary section
      if (trimmed.match(/^\*{0,2}Giải thích thuật ngữ:?\*{0,2}$/i)) {
        inGlossary = true;
        glossaryItems = [];
        continue;
      }
      if (inGlossary) {
        // End glossary on: empty line, footer-like content, or separator
        const isFooterLike = /^👉|^━━|^_{5,}|Chi\s+tiết.*dưới|Link\s+gốc|Nguồn\s+dưới/i.test(trimmed);
        if (!trimmed || isFooterLike) {
          if (glossaryItems.length > 0) {
            blocks.push({ type: "glossary", items: [...glossaryItems] });
            glossaryItems = [];
          }
          inGlossary = false;
          if (!trimmed) {
            blocks.push({ type: "blank" }); // preserve spacing after glossary
          }
          // Don't continue — let footer-like lines fall through to be stripped/skipped
          if (isFooterLike) { /* fall through to normal line processing below */ }
          else continue;
        } else {
          const m = trimmed.match(/^[·•]\s*(.+?):\s*(.+)$/);
          if (m) {
            glossaryItems.push({ term: m[1], def: m[2] });
          } else {
            glossaryItems.push({ term: trimmed, def: "" });
          }
          continue;
        }
      }

      // Empty line or standalone decorative separators (|, ||, —, etc.)
      if (!trimmed || /^[\s|—–\-_]+$/.test(trimmed)) {
        if (blocks.length > 0 && blocks[blocks.length - 1].type !== "blank") {
          blocks.push({ type: "blank" });
        }
        continue;
      }

      // Skip footer-like lines (renderer adds its own footer)
      if (/^👉\s*(?:Chi tiết|Link gốc|Nguồn)/i.test(trimmed)) continue;
      if (/^━━━/.test(trimmed)) continue;

      // Title (first non-empty line)
      if (!titleFound) {
        titleFound = true;
        // Strip wrapping ** or leading emoji
        let titleText = trimmed
          .replace(/^\*{1,2}\s*/, "").replace(/\s*\*{1,2}$/, "")
          .replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+/u, "");
        blocks.push({ type: "title", text: titleText });
        continue;
      }

      // Section header: **Bold Header** or ## Header
      if (trimmed.match(/^\*\*[^*]+\*\*:?$/) || trimmed.match(/^#{1,3}\s+.+$/)) {
        const headerText = trimmed
          .replace(/^\*{1,2}\s*/, "")    // strip leading **
          .replace(/[\s*:]+$/, "")        // strip trailing **, colons, spaces
          .replace(/^#{1,3}\s+/, "");     // strip ## prefix
        blocks.push({ type: "header", text: headerText });
        continue;
      }

      // Heuristic header: short line (≤ 40 chars) not a bullet/number,
      // followed by bullet/numbered lines → treat as section header.
      // Catches AI output like "Điểm nổi bật" or "Lợi ích:" without **...**
      if (trimmed.length <= 40 && !trimmed.match(/^[·•\-*✓▸▪→\d]/) && titleFound) {
        // Look ahead: next non-empty line should be a bullet or number
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j < lines.length) {
          const nextTrimmed = lines[j].trim();
          if (nextTrimmed.match(/^[·•\-*✓▸▪→]\s+/) || nextTrimmed.match(/^\d+[.)]\s+/)) {
            const headerText = trimmed.replace(/[\s:]+$/, ""); // strip trailing colon/spaces
            blocks.push({ type: "header", text: headerText });
            continue;
          }
        }
      }

      // Numbered list: 1. or 1) or Bước 1:
      const numMatch = trimmed.match(/^(\d+)[.)]\s+(.+)$/) ||
                       trimmed.match(/^Bước\s+(\d+):?\s+(.+)$/i);
      if (numMatch) {
        blocks.push({ type: "number", num: parseInt(numMatch[1]), text: numMatch[2] });
        continue;
      }

      // Bullet: · • - * ✓ ▸ ▪ →
      if (trimmed.match(/^[·•\-*✓▸▪→]\s+/)) {
        const bulletText = trimmed.replace(/^[·•\-*✓▸▪→]\s+/, "").trim();
        // Skip empty bullets (marker + whitespace only)
        if (bulletText) {
          blocks.push({ type: "bullet", text: bulletText });
          continue;
        }
        // Fall through to standalone marker handling below
      }

      // Standalone bullet marker (✓ or · etc. on its own line) — merge with next line
      if (trimmed.match(/^[·•✓▸▪→]$/) || trimmed.match(/^[·•✓▸▪→]\s*$/)) {
        // Look ahead for the next non-empty line
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j < lines.length && lines[j].trim()) {
          blocks.push({ type: "bullet", text: lines[j].trim() });
          i = j; // skip to the merged line
          continue;
        }
        // No next line — just skip the lonely marker
        continue;
      }

      // Inline bold: lines containing **text**
      blocks.push({ type: "paragraph", text: trimmed });
    }

    // Flush remaining glossary
    if (glossaryItems.length > 0) {
      blocks.push({ type: "glossary", items: glossaryItems });
    }

    return blocks;
  },

  // ── Post-processor: fix structure when AI outputs flat paragraphs ──

  _postProcess(blocks) {
    // Count block types
    const types = {};
    for (const b of blocks) {
      types[b.type] = (types[b.type] || 0) + 1;
    }

    const hasHeaders = (types.header || 0) > 0;
    const hasBullets = (types.bullet || 0) > 0;
    const hasNumbers = (types.number || 0) > 0;
    const paraCount = types.paragraph || 0;

    // If already structured (has headers or bullets), pass through
    if (hasHeaders || hasBullets || hasNumbers) return blocks;

    // Only paragraphs (+ title + blank) — AI gave us wall of text
    if (paraCount < 1) return blocks;

    const result = [];
    for (const block of blocks) {
      if (block.type !== "paragraph") {
        result.push(block);
        continue;
      }

      // Split paragraph into sentences
      const sentences = block.text
        .split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(s => s.length > 8);

      if (sentences.length < 2) {
        result.push(block);
        continue;
      }

      // Process each sentence
      for (const sent of sentences) {
        // Detect inline enumerations: "...N vai trò: A, B, C, D và E"
        // Pattern: text before colon + comma-items + penultimate + và + last
        const enumMatch = sent.match(
          /^(.+?):\s*((?:[^,.\n]{1,40},\s*){2,}[^,.\n]{1,40}\s+(?:và|and)\s+[^.\n]{1,40})\.?\s*(.*)$/i
        );
        if (enumMatch) {
          const intro = enumMatch[1].trim();
          const listStr = enumMatch[2].trim();
          const remainder = (enumMatch[3] || "").trim();

          // Extract items: split on ", " and " và "
          const items = listStr
            .split(/,\s+(?:và|and)\s+|,\s+|\s+(?:và|and)\s+/i)
            .map(s => s.trim())
            .filter(s => s.length > 0 && s.length < 50);

          if (items.length >= 3) {
            result.push({ type: "paragraph", text: intro + ":" });
            result.push({ type: "blank" });
            for (const item of items) {
              result.push({ type: "bullet", text: item.replace(/\.\s*$/, "") });
            }
            if (remainder.length > 10) {
              result.push({ type: "blank" });
              result.push({ type: "paragraph", text: remainder.replace(/^\.\s*/, "") });
            }
            continue;
          }
        }

        // Regular sentence → bullet
        result.push({ type: "bullet", text: sent.replace(/\.\s*$/, "") });
      }
    }

    return result;
  },

  // ── Renderer: blocks → platform-specific text ──────────────────────

  _render(blocks, profile, options = {}) {
    const lines = [];

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];

      switch (block.type) {
        case "title": {
          let t = block.text;
          if (profile.titleUppercase) {
            t = t.toUpperCase();
          }
          if (profile.titleEmoji) {
            const emoji = this._detectEmoji(block.text);
            t = emoji + " " + t;
          }
          // Skip unicode bold on titles — uppercase already provides emphasis,
          // and mixed Vietnamese + bold-ASCII looks broken.
          lines.push(t);
          lines.push(""); // double blank after title for breathing room
          lines.push("");
          break;
        }

        case "header": {
          // Ensure 2 blank lines before each section header (visual section break)
          const blanksNeeded = 2;
          let trailingBlanks = 0;
          for (let j = lines.length - 1; j >= 0 && lines[j] === ""; j--) trailingBlanks++;
          for (let j = trailingBlanks; j < blanksNeeded && lines.length > 0; j++) {
            lines.push("");
          }
          let h = block.text;
          if (profile.unicodeBold) {
            const bolded = this._toUnicodeBold(h);
            // If bold produced no change (all Vietnamese), fall back to UPPERCASE
            h = (bolded === h) ? h.toUpperCase() : bolded;
          } else {
            h = h.toUpperCase();
          }
          lines.push(h);
          break;
        }

        case "number": {
          const prefix = profile.numberStyle === "circled"
            ? this._circledNumber(block.num)
            : block.num + ".";
          let t = block.text;
          // Bold the first phrase before a colon/dash if present
          if (profile.unicodeBold) {
            t = t.replace(/^([^:–—]+)([::–—])/, (_, p, s) => this._toUnicodeBold(p) + s);
          }
          lines.push(prefix + " " + t);
          break;
        }

        case "bullet": {
          let t = block.text;
          if (profile.unicodeBold) {
            // Bold text before first colon: "Term: explanation"
            t = t.replace(/^([^:]+):/, (_, p) => this._toUnicodeBold(p) + ":");
          }
          lines.push(profile.bulletChar + " " + t);
          break;
        }

        case "paragraph": {
          let t = block.text;
          if (profile.unicodeBold) {
            t = t.replace(/\*\*(.+?)\*\*/g, (_, p) => this._toUnicodeBold(p));
          } else {
            t = t.replace(/\*\*(.+?)\*\*/g, "$1");
          }
          if (profile.unicodeItalic) {
            t = t.replace(/\*(.+?)\*/g, (_, p) => this._toUnicodeItalic(p));
          } else {
            t = t.replace(/\*(.+?)\*/g, "$1");
          }
          lines.push(t);
          break;
        }

        case "glossary": {
          // 2 blank lines before glossary (same as section headers)
          let trailingBlanksG = 0;
          for (let j = lines.length - 1; j >= 0 && lines[j] === ""; j--) trailingBlanksG++;
          for (let j = trailingBlanksG; j < 2 && lines.length > 0; j++) {
            lines.push("");
          }
          const glossaryLabel = "Giải thích thuật ngữ:";
          if (profile.unicodeBold) {
            const bolded = this._toUnicodeBold(glossaryLabel);
            lines.push(bolded === glossaryLabel ? glossaryLabel.toUpperCase() : bolded);
          } else {
            lines.push(glossaryLabel);
          }
          for (const item of block.items) {
            if (item.def) {
              const termStr = profile.unicodeBold
                ? this._toUnicodeBold(item.term) : item.term;
              lines.push(profile.bulletChar + " " + termStr + ": " + item.def);
            } else {
              lines.push(profile.bulletChar + " " + item.term);
            }
          }
          break;
        }

        case "blank": {
          if (lines.length > 0 && lines[lines.length - 1] !== "") {
            lines.push("");
          }
          break;
        }
      }
    }

    // Clean trailing blanks
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

    let result = lines.join("\n");

    // Footer — extra blank line for visual separation from content
    if (profile.footer) {
      result += "\n\n\n" + this._buildFooter(options);
    }

    // Truncate if needed
    if (profile.maxLength > 0 && result.length > profile.maxLength) {
      result = result.substring(0, profile.maxLength - 3) + "...";
    }

    return result;
  },

  // ── Footer builder ─────────────────────────────────────────────────

  _buildFooter(options = {}) {
    const hasRepo = !!options.hasRepo;
    const separator = "━━━━━━━━━━";
    const cta = hasRepo
      ? "👉 Link gốc & mã nguồn dưới bình luận đầu tiên"
      : "👉 Chi tiết & nguồn dưới bình luận đầu tiên";
    return separator + "\n" + cta;
  },

  // ── Unicode transforms ─────────────────────────────────────────────

  // Unicode bold/italic: split by whitespace, only transform tokens where EVERY
  // character is ASCII (code ≤ 127). Vietnamese words (containing diacritics like
  // ữ, ề, ổ) are skipped entirely — no partial bolding within a word.
  _toUnicodeBold(str) {
    if (window.enableUnicodeBold === false) return str;
    return str.split(/(\s+)/).map(token => {
      if (/^\s+$/.test(token)) return token;
      // Skip any token containing non-ASCII (Vietnamese diacritics, etc.)
      if (/[^\x00-\x7F]/.test(token)) return token;
      let result = "";
      for (let i = 0; i < token.length; i++) {
        const c = token.charCodeAt(i);
        if (c >= 65 && c <= 90)       result += String.fromCodePoint(c + 120211); // U+1D5D4 (𝗔)
        else if (c >= 97 && c <= 122) result += String.fromCodePoint(c + 120205); // U+1D5EE (𝗮)
        else if (c >= 48 && c <= 57)  result += String.fromCodePoint(c + 120764); // U+1D7EC (𝟬)
        else result += token[i]; // punctuation stays as-is
      }
      return result;
    }).join("");
  },

  _toUnicodeItalic(str) {
    if (window.enableUnicodeBold === false) return str;
    return str.split(/(\s+)/).map(token => {
      if (/^\s+$/.test(token)) return token;
      if (/[^\x00-\x7F]/.test(token)) return token;
      let result = "";
      for (let i = 0; i < token.length; i++) {
        const c = token.charCodeAt(i);
        if (c >= 65 && c <= 90)       result += String.fromCodePoint(c + 120263); // U+1D608 (𝘈)
        else if (c >= 97 && c <= 122) result += String.fromCodePoint(c + 120257); // U+1D622 (𝘢)
        else result += token[i];
      }
      return result;
    }).join("");
  },

  _circledNumber(n) {
    if (n >= 1 && n <= 20) return String.fromCodePoint(0x245F + n); // ① ② ③ ...
    return n + ".";
  },

  // ── Emoji detection ────────────────────────────────────────────────

  _detectEmoji(title) {
    const l = title.toLowerCase();

    // Dev / Code
    if (l.match(/github|gitlab|git|repo|code|coding|lập trình|react|typescript|javascript|python|c\+\+|rust|go\b|java|sql|postgres|database|mã nguồn|framework|library|npm|package/)) return "💻";

    // UI/UX / Design
    if (l.match(/ui\b|ux\b|design|giao diện|css|tailwind|color|typography|font|figma|thẩm mỹ|phối màu/)) return "🎨";

    // Performance / Speed
    if (l.match(/performance|speed|optimization|fast|lcp|cwv|memory|leak|tốc độ|tối ưu|benchmark/)) return "⚡";

    // Security
    if (l.match(/security|privacy|auth|encryption|secure|hack|leak|bảo mật|quyền riêng tư|vulnerability/)) return "🔒";

    // Mobile
    if (l.match(/ios|android|mobile|swift|kotlin|flutter|react native|di động|smartphone/)) return "📱";

    // Web / Browser
    if (l.match(/web|chrome|extension|browser|firefox|edge|manifest|trình duyệt|tiện ích/)) return "🌐";

    // DevOps
    if (l.match(/docker|ci\b|cd\b|devops|deploy|build|setup|npm|yarn|pip|triển khai|kubernetes|k8s/)) return "🔧";

    // Analytics / SEO
    if (l.match(/analytics|chart|graph|growth|seo|traffic|thống kê|biểu đồ|conversion/)) return "📈";

    // Deep Learning / Research
    if (l.match(/paper|research|science|brain|cognitive|deep learning|neural|nghiên cứu|khoa học|trí não|model|training/)) return "🧠";

    // AI / Tech
    if (l.match(/ai\b|công nghệ|tech|phần mềm|app|tool|software|digital|chatgpt|claude|gemini|llm|gpt|copilot/)) return "🤖";

    // Business / Money
    if (l.match(/kinh doanh|tiền|thu nhập|doanh thu|marketing|bán hàng|business|money|revenue|startup|funding/)) return "💰";

    // Education / Learning
    if (l.match(/học|giáo dục|khóa học|kiến thức|kỹ năng|education|learning|course|skill|tutorial/)) return "📚";

    // News
    if (l.match(/tin tức|cập nhật|thông báo|mới|news|update|announcement|ra mắt|launch/)) return "📰";

    // Tips / Guide
    if (l.match(/tips|hướng dẫn|cách|bí quyết|mẹo|guide|how to/)) return "💡";

    // Warning
    if (l.match(/cảnh báo|quan trọng|chú ý|lưu ý|warning|important|alert|nguy hiểm|rủi ro/)) return "⚠️";

    // Success
    if (l.match(/thành công|đạt được|chiến thắng|kỷ lục|success|achievement|win|milestone/)) return "🎉";

    // Comparison / Versus
    if (l.match(/vs\b|versus|so sánh|đánh giá|review|comparison|benchmark/)) return "⚖️";

    // Open Source
    if (l.match(/open.?source|mã mở|free|miễn phí|community/)) return "🌟";

    return "📌";
  },

  // ── HTML rendering for panel display ───────────────────────────────

  toDisplayHTML(rawText, options = {}) {
    const blocks = this._postProcess(this._parse(rawText));
    const htmlParts = [];

    for (const block of blocks) {
      switch (block.type) {
        case "title":
          htmlParts.push(
            '<div class="fbs-title-line">' +
            this._escHtml(block.text).toUpperCase() + '</div>'
          );
          break;

        case "header":
          htmlParts.push(
            '<div class="fbs-section-header">' +
            this._escHtml(block.text) + '</div>'
          );
          break;

        case "number": {
          const circled = this._circledNumber(block.num);
          const rendered = this._renderInlineMarkdown(block.text);
          htmlParts.push(
            '<div class="fbs-bullet">' +
            '<span class="fbs-bullet-marker">' + circled + '</span>' +
            '<span class="fbs-bullet-text">' + rendered + '</span></div>'
          );
          break;
        }

        case "bullet": {
          const rendered = this._renderInlineMarkdown(block.text);
          htmlParts.push(
            '<div class="fbs-bullet">' +
            '<span class="fbs-bullet-marker">▸</span>' +
            '<span class="fbs-bullet-text">' + rendered + '</span></div>'
          );
          break;
        }

        case "paragraph": {
          const rendered = this._renderInlineMarkdown(block.text);
          htmlParts.push('<div class="fbs-para">' + rendered + '</div>');
          break;
        }

        case "glossary":
          htmlParts.push(this._renderGlossaryHTML(block.items));
          break;

        case "blank":
          htmlParts.push('<div style="height:6px;"></div>');
          break;
      }
    }

    // Footer — subtle, doesn't repeat if HTML already has one
    const hasRepo = !!options.hasRepo;
    htmlParts.push(
      '<div style="margin:16px 0 4px;border-top:1px solid rgba(255,255,255,0.08);padding-top:10px;text-align:center;font-size:11.5px;color:rgba(255,255,255,0.3);">' +
      '👉 ' + (hasRepo ? 'Link gốc & mã nguồn dưới bình luận đầu tiên' : 'Chi tiết & nguồn dưới bình luận đầu tiên') +
      '</div>'
    );

    return htmlParts.join("\n");
  },

  _renderInlineMarkdown(text) {
    let html = this._escHtml(text);
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    return html;
  },

  _renderGlossaryHTML(items) {
    if (!items || items.length === 0) return "";
    let html = '<div class="fbs-glossary">';
    html += '<div class="fbs-glossary-heading">Giải thích thuật ngữ</div>';
    for (const item of items) {
      html += '<div class="fbs-glossary-item">';
      html += '<strong>' + this._escHtml(item.term) + '</strong>';
      if (item.def) html += ': ' + this._escHtml(item.def);
      html += '</div>';
    }
    html += '</div>';
    return html;
  },

  _escHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  },
};
