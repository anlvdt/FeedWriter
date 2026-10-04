"use strict";

// StatusFormatter — Unified formatting engine for all platforms.
// Replaces scattered buildUnifiedStatusText, formatForFacebook, applyUnicodeFormatting.

const StatusFormatter = {

  // ── Platform profiles ──────────────────────────────────────────────

  profiles: {
    facebook: {
      unicodeBold: false,  // Disable Unicode bold - use plain text
      unicodeItalic: false,  // Disable Unicode italic
      titleUppercase: true,  // Keep title uppercase for emphasis
      titleEmoji: false,
      bulletChar: "·",
      numberStyle: "plain",
      sectionSeparator: "",
      footer: true,
      maxLength: 0,             // no limit
    },
    threads: {
      unicodeBold: false,
      unicodeItalic: false,
      titleUppercase: false,
      titleEmoji: false,
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
      titleEmoji: false,
      bulletChar: "·",
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
      bulletChar: "·",
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

    // Strip existing footers/separators FIRST (prevent duplication)
    // Must be aggressive — AI sometimes copies footer from examples or prior output
    text = text.replace(/\s*(?:[—-]\s*\n\s*)?Nguồn\s+dưới\s+(?:cmt|bình\s+luận|binh\s+luan)\s+đầu(?:\s+tiên)?\s*$/gi, "");
    text = text.replace(/━━━━━━━━━━\s*/g, "");
    text = text.replace(/\s*(?:👉\s*)?(?:Link gốc|Chi tiết)[\s&]*(?:nguồn|mã nguồn)?.*dưới\s+(?:bình\s+luận|cmt)\s+đầu(?:\s+tiên)?\s*$/gim, "");
    text = text.replace(/\s*(?:Chi tiết|Link gốc|Nguồn)\s*&?\s*$/gim, ""); // truncated footer like "Chi tiết &"
    text = text.replace(/(?:_{5,}|━━━━━━━━━━)\s*(?:|•)?\s*(?:Chi\s+tiết|Link\s+gốc|Nguồn)?.*$/gi, "");
    text = text.replace(/👉\s*/g, ""); // Remove any stray 👉 emoji
    text = text.replace(
      /\s*ℹ️?\s*Lưu ý:\s*Bài viết tổng hợp từ nguồn công khai, chưa dựa trên trải nghiệm trực tiếp\.\s*Vui lòng kiểm tra mức độ phù hợp trước khi sử dụng\.\s*$/i,
      "",
    );
    
    // Fix AI sometimes ignoring "write normally, system will uppercase" instruction
    // Check if the ENTIRE content (not just body) is mostly uppercase
    const testText = text.replace(/\s/g, ""); // Remove whitespace for testing
    
    // Count uppercase letters (Vietnamese + English) - comprehensive Unicode ranges
    const upperPattern = /[A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴĐ]/g;
    const actualUppercaseCount = (testText.match(upperPattern) || []).length;
    
    // Count total letters (both cases) - same Unicode ranges
    const allLetterPattern = /[A-Za-zÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴĐàáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/g;
    const totalLetters = (testText.match(allLetterPattern) || []).length;
    
    const uppercaseRatio = totalLetters > 0 ? actualUppercaseCount / totalLetters : 0;
    
    if (uppercaseRatio > 0.6) {
      // AI wrote everything in uppercase - normalize to proper case
      const lines = text.split("\n");
      
      text = lines.map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line; // Keep empty lines
        
        // Convert to lowercase first
        let normalized = line.toLowerCase();
        
        // Capitalize first letter of each sentence
        normalized = normalized.replace(/(^|[.!?]\s+)([a-zàáảãạăắằẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ])/g, 
          (match, prefix, char) => prefix + char.toUpperCase()
        );
        
        return normalized;
      }).join("\n");
    }

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

      // Glossary section — heading, then term: definition items.
      // Blank lines after the heading are common and must NOT close the section.
      if (this._isGlossaryHeading(trimmed)) {
        if (glossaryItems.length > 0) {
          blocks.push({ type: "glossary", items: [...glossaryItems] });
          glossaryItems = [];
        }
        inGlossary = true;
        continue;
      }
      if (inGlossary) {
        const isFooterLike = /^(?:👉\s*)?(?:━━|_{5,}|Chi\s+tiết.*dưới|Link\s+gốc|Nguồn\s+dưới)/i.test(trimmed);
        if (!trimmed) continue;
        if (isFooterLike) {
          if (glossaryItems.length > 0) {
            blocks.push({ type: "glossary", items: [...glossaryItems] });
            glossaryItems = [];
          }
          inGlossary = false;
          // fall through so the footer line is stripped below
        } else {
          const item = this._parseGlossaryItem(trimmed);
          if (item) {
            glossaryItems.push(item);
            continue;
          }
          if (glossaryItems.length > 0) {
            blocks.push({ type: "glossary", items: [...glossaryItems] });
            glossaryItems = [];
          }
          inGlossary = false;
          // Heading with leftover term-only junk (no definition) — drop it
          if (this._isOrphanGlossaryTerm(trimmed)) continue;
          // fall through and parse this line as normal content
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
      if (/^\s*(?:👉\s*)?(?:Chi tiết|Link gốc|Nguồn)/i.test(trimmed)) continue;
      if (/^━━━/.test(trimmed)) continue;

      // Skip leftover structure labels the model sometimes prints
      if (this._isStructureLabel(trimmed)) continue;

      // Title (first non-empty line)
      if (!titleFound) {
        titleFound = true;
        // Strip wrapping ** or leading emoji
        let titleText = trimmed
          .replace(/^\*{1,2}\s*/, "").replace(/\s*\*{1,2}$/, "")
          .replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+/u, "");
        titleText = this._stripStructurePrefix(titleText);
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

      // Bullet: · • - * · ▸ ▪ →  (collapse repeated markers like "· · **term**")
      if (trimmed.match(/^[·•\-*✓▸▪→]\s+/)) {
        const bulletText = this._collapseBulletPrefix(trimmed);
        if (bulletText) {
          blocks.push({ type: "bullet", text: bulletText });
          continue;
        }
      }

      // Standalone bullet marker — merge with next line
      if (/^[·•\-*✓▸▪→]$/.test(trimmed)) {
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j < lines.length && lines[j].trim()) {
          blocks.push({ type: "bullet", text: this._collapseBulletPrefix(lines[j].trim()) });
          i = j;
          continue;
        }
        continue;
      }

      // Inline bold: lines containing **text**
      const paraText = this._stripStructurePrefix(trimmed);
      if (paraText) blocks.push({ type: "paragraph", text: paraText });
    }

    // Flush remaining glossary
    if (glossaryItems.length > 0) {
      blocks.push({ type: "glossary", items: glossaryItems });
    }

    return blocks;
  },

  // ── Post-processor: drop extras, break walls of text ───────────────

  _postProcess(blocks) {
    let next = this._dropFillerClose(this._dropRunOnArticle(blocks));
    const types = {};
    for (const b of next) {
      types[b.type] = (types[b.type] || 0) + 1;
    }

    const hasHeaders = (types.header || 0) > 0;
    const hasBullets = (types.bullet || 0) > 0;
    const hasNumbers = (types.number || 0) > 0;
    const paraCount = types.paragraph || 0;
    const bulletCount = types.bullet || 0;

    // All-bullet narrative detection: when every content block is a bullet
    // and bullets are long sentences, merge them into paragraphs.
    // True lists have short items (< 80 chars avg). Narrative "bullets" are longer.
    if (hasBullets && !hasHeaders && !hasNumbers && paraCount === 0 && bulletCount >= 3) {
      const bullets = next.filter(b => b.type === "bullet");
      const avgLen = bullets.reduce((s, b) => s + b.text.length, 0) / bullets.length;
      if (avgLen > 60) {
        next = next.map(b => b.type === "bullet" ? { type: "paragraph", text: b.text } : b);
      }
    }

    const stillListed = next.some(b =>
      b.type === "header" || b.type === "bullet" || b.type === "number"
    );
    if (stillListed) return next;
    return this._breakWallOfText(next);
  },

  _looksLikeSecondTitle(text) {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    if (t.length < 16 || t.length > 140) return false;
    if (/[.!?…]$/.test(t)) return false;
    const letters = t.replace(
      /[^A-Za-zÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴĐàáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/g,
      "",
    );
    if (letters.length < 8) return false;
    const upper = (letters.match(
      /[A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴĐ]/g,
    ) || []).length;
    return upper / letters.length >= 0.62;
  },

  _dropRunOnArticle(blocks) {
    let contentParas = 0;
    let cut = -1;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.type === "glossary") break;
      if (b.type !== "paragraph") continue;
      if (this._isGlossaryHeading(b.text)) break;
      if (contentParas >= 1 && this._looksLikeSecondTitle(b.text)) {
        cut = i;
        break;
      }
      contentParas++;
    }
    if (cut < 0) return blocks;
    const kept = blocks.slice(0, cut);
    while (kept.length && kept[kept.length - 1].type === "blank") kept.pop();
    const glossary = blocks.slice(cut).filter((b) => b.type === "glossary");
    return kept.concat(glossary);
  },

  _GLOSSARY_HEADING_RE:
    /giải\s*thích\s*thuật\s*ngữ/iu,

  _isGlossaryHeading(text) {
    const t = String(text || "").trim().replace(/\*+/g, "").replace(/\s+/g, " ");
    if (!this._GLOSSARY_HEADING_RE.test(t)) return false;
    return t.length <= 48;
  },

  _isFillerClose(text) {
    return /bước tiến|đánh dấu|có trách nhiệm|đồng thời cho phép|quan trọng trong/i.test(
      String(text || ""),
    );
  },

  _dropFillerClose(blocks) {
    const out = blocks.slice();
    for (let i = out.length - 1; i >= 0; i--) {
      const b = out[i];
      if (b.type === "blank" || b.type === "glossary") continue;
      if (b.type === "paragraph" && this._isFillerClose(b.text)) {
        out.splice(i, 1);
        while (i < out.length && out[i] && out[i].type === "blank") out.splice(i, 1);
        while (i > 0 && out[i - 1] && out[i - 1].type === "blank") {
          out.splice(i - 1, 1);
          i--;
        }
      }
      break;
    }
    return out;
  },

  _parseGlossaryItem(line) {
    const cleaned = this._collapseBulletPrefix(String(line || "").trim());
    if (!cleaned || this._isGlossaryHeading(cleaned)) return null;
    const m = cleaned.match(/^(.{1,50}?)\s*[:：]\s*(.+)$/);
    if (!m) return null;
    const term = this._unwrapMarkdown(m[1]).trim();
    const def = this._unwrapMarkdown(m[2]).trim();
    if (!term || !def) return null;
    if (/[.!?]$/.test(term)) return null;
    if (def.length > 280) return null;
    return { term, def };
  },

  _isOrphanGlossaryTerm(line) {
    const cleaned = this._collapseBulletPrefix(String(line || "").trim());
    if (!cleaned) return true;
    if (cleaned.length > 50 || /[.!?]/.test(cleaned)) return false;
    if (cleaned.split(/\s+/).length > 6) return false;
    const parts = cleaned.split(/\s*[:：]\s*/);
    return parts.length < 2 || !parts[1];
  },

  _STRUCTURE_LABEL_RE:
    /^(?:\*{0,2}\s*)?(?:mở bài|thân bài|kết bài|kết luận|mở đầu|điểm chính|lead|opening|body|conclusion)\s*\*{0,2}\s*[:：.]?\s*$/i,

  _STRUCTURE_PREFIX_RE:
    /^(?:\*{0,2}\s*)?(?:mở bài|thân bài|kết bài|kết luận|mở đầu|điểm chính|lead|opening|body|conclusion)\s*\*{0,2}\s*[:：.\-–—]\s*/i,

  _isStructureLabel(text) {
    return this._STRUCTURE_LABEL_RE.test(String(text || "").trim());
  },

  _stripStructurePrefix(text) {
    return String(text || "").replace(this._STRUCTURE_PREFIX_RE, "").trim();
  },

  _splitSentences(text) {
    const src = String(text || "").replace(/\s+/g, " ").trim();
    if (!src) return [];

    const isUpper = (ch) =>
      /[A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ]/.test(ch);
    const isDigit = (ch) => ch >= "0" && ch <= "9";
    const abbrevTail = /(?:^|\s)(?:TS|ThS|PGS|GS|TP|Tp|Mr|Mrs|Ms|Dr|vs|v\.v|Inc|Ltd)\.$/i;

    const sentences = [];
    let buf = "";
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      buf += ch;
      if (ch !== "." && ch !== "!" && ch !== "?" && ch !== "…") continue;
      if (ch === "." && isDigit(src[i - 1]) && isDigit(src[i + 1])) continue;
      if (ch === "." && abbrevTail.test(buf)) continue;

      let j = i + 1;
      while (j < src.length && src[j] === " ") j++;
      if (j < src.length && !isUpper(src[j])) continue;

      const sentence = buf.trim();
      if (sentence) sentences.push(sentence);
      buf = "";
      i = j - 1;
    }
    if (buf.trim()) sentences.push(buf.trim());
    return sentences;
  },

  _groupSentencesIntoParagraphs(sentences) {
    const paras = [];
    for (let i = 0; i < sentences.length; i += 2) {
      paras.push(sentences.slice(i, i + 2).join(" "));
    }
    return paras;
  },

  _breakWallOfText(blocks) {
    const paraIdx = [];
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].type === "paragraph") paraIdx.push(i);
    }
    if (paraIdx.length === 0) return blocks;

    const sentences = [];
    for (const i of paraIdx) {
      const parts = this._splitSentences(blocks[i].text);
      if (parts.length) sentences.push(...parts);
      else if (blocks[i].text) sentences.push(blocks[i].text);
    }

    // Already broken into paragraphs — keep the author's breaks.
    if (paraIdx.length >= 2) return blocks;
    if (sentences.length < 2) return blocks;

    const grouped = this._groupSentencesIntoParagraphs(sentences);
    const first = paraIdx[0];
    const last = paraIdx[paraIdx.length - 1];
    const mid = [];
    grouped.forEach((text, i) => {
      if (i > 0) mid.push({ type: "blank" });
      mid.push({ type: "paragraph", text });
    });
    return blocks.slice(0, first).concat(mid, blocks.slice(last + 1));
  },

  // ── Renderer: blocks → platform-specific text ──────────────────────

  _render(blocks, profile, options = {}) {
    const lines = [];

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];

      switch (block.type) {
        case "title": {
          let t = this._unwrapMarkdown(block.text);
          if (profile.titleUppercase) {
            t = t.toUpperCase();
          }
          /* title emojis disabled */
          // Skip unicode bold on titles — uppercase already provides emphasis,
          // and mixed Vietnamese + bold-ASCII looks broken.
          lines.push(t);
          lines.push("");
          break;
        }

        case "header": {
          const blanksNeeded = 1;
          let trailingBlanks = 0;
          for (let j = lines.length - 1; j >= 0 && lines[j] === ""; j--) trailingBlanks++;
          for (let j = trailingBlanks; j < blanksNeeded && lines.length > 0; j++) {
            lines.push("");
          }
          let h = this._unwrapMarkdown(block.text);
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
          let t = this._applyInlineMarkup(block.text, profile);
          // Bold the first phrase before a colon/dash if present
          if (profile.unicodeBold) {
            t = t.replace(/^([^:–—]+)([::–—])/, (_, p, s) => this._toUnicodeBold(p) + s);
          }
          lines.push(prefix + " " + t);
          break;
        }

        case "bullet": {
          let t = this._applyInlineMarkup(this._collapseBulletPrefix(block.text), profile);
          if (profile.unicodeBold) {
            t = t.replace(/^([^:]+):/, (_, p) => this._toUnicodeBold(p) + ":");
          }
          if (t) lines.push(profile.bulletChar + " " + t);
          break;
        }

        case "paragraph": {
          let t = this._applyInlineMarkup(block.text, profile);
          // Separate consecutive paragraphs with a blank line
          if (i > 0 && blocks[i - 1].type === "paragraph") {
            lines.push("");
          }
          lines.push(t);
          break;
        }

        case "glossary": {
          let trailingBlanksG = 0;
          for (let j = lines.length - 1; j >= 0 && lines[j] === ""; j--) trailingBlanksG++;
          for (let j = trailingBlanksG; j < 1 && lines.length > 0; j++) {
            lines.push("");
          }
          const glossaryLabel = "Giải thích thuật ngữ:".toLocaleUpperCase("vi");
          if (profile.unicodeBold) {
            const bolded = this._toUnicodeBold(glossaryLabel);
            lines.push(bolded === glossaryLabel ? glossaryLabel : bolded);
          } else {
            lines.push(glossaryLabel);
          }
          for (const item of block.items) {
            const term = this._applyInlineMarkup(item.term, profile);
            const def = this._applyInlineMarkup(item.def || "", profile);
            if (def) {
              const termStr = profile.unicodeBold ? this._toUnicodeBold(term) : term;
              lines.push(profile.bulletChar + " " + termStr + ": " + def);
            } else if (term) {
              lines.push(profile.bulletChar + " " + term);
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

    let result = this._stripLeftoverMarkdown(lines.join("\n"));

    // Footer — extra blank line for visual separation from content
    if (profile.footer) {
      result += "\n\n" + this._buildFooter(options);
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
      ? "Link gốc & mã nguồn dưới bình luận đầu tiên"
      : "Chi tiết & nguồn dưới bình luận đầu tiên";
    const disclaimer =
      "ℹ️ Lưu ý: Bài viết tổng hợp từ nguồn công khai, chưa dựa trên trải nghiệm trực tiếp. " +
      "Vui lòng kiểm tra mức độ phù hợp trước khi sử dụng.";
    return disclaimer + "\n\n" + separator + "\n👉 " + cta;
  },

  _collapseBulletPrefix(text) {
    let t = String(text || "").trim();
    // *, - are list markers only when followed by space. Do not eat markdown **bold**.
    const marker = /^(?:[·•✓▸▪→]\s*|[-*]\s+)/;
    while (marker.test(t)) {
      const next = t.replace(marker, "").trim();
      if (next === t) break;
      t = next;
    }
    return t;
  },

  _unwrapMarkdown(text) {
    return this._applyInlineMarkup(text, { unicodeBold: false, unicodeItalic: false });
  },

  _applyInlineMarkup(text, profile) {
    let t = String(text || "");
    const bold = !!(profile && profile.unicodeBold);
    const italic = !!(profile && profile.unicodeItalic);
    t = t.replace(/\*\*\*(.+?)\*\*\*/g, (_, p) => (bold ? this._toUnicodeBold(p) : p));
    t = t.replace(/\*\*(.+?)\*\*/g, (_, p) => (bold ? this._toUnicodeBold(p) : p));
    t = t.replace(/__(.+?)__/g, (_, p) => (bold ? this._toUnicodeBold(p) : p));
    t = t.replace(/`([^`]+)`/g, "$1");
    t = t.replace(
      /(^|[\s([（])\*(?!\s)(.+?)(?<!\s)\*(?=[\s)\]）。,!?:;]|$)/g,
      (_, pre, p) => pre + (italic ? this._toUnicodeItalic(p) : p),
    );
    return this._stripLeftoverMarkdown(t);
  },

  _stripLeftoverMarkdown(text) {
    return String(text || "")
      .replace(/\*{1,3}/g, "")
      .replace(/_{3,}/g, "")
      .replace(/[ \t]{2,}/g, " ");
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

  // Title prefix icons removed — keep status text clean and professional.
  _detectEmoji(_title) {
    return "";
  },

  // ── HTML rendering for panel display ───────────────────────────────

  toDisplayHTML(rawText, options = {}) {
    const blocks = this._postProcess(this._parse(rawText));
    const htmlParts = [];

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      switch (block.type) {
        case "title":
          htmlParts.push(
            '<div class="fbs-title-line">' +
            this._escHtml(this._unwrapMarkdown(block.text)) + '</div>'
          );
          break;

        case "header":
          htmlParts.push(
            '<div class="fbs-section-header">' +
            this._escHtml(this._unwrapMarkdown(block.text)) + '</div>'
          );
          break;

        case "number": {
          const circled = this._circledNumber(block.num);
          let rendered = this._renderInlineMarkdown(block.text);
          if (!rendered.includes('<strong>') && rendered.includes(':')) {
            rendered = rendered.replace(/^([^:]+):/, '<strong>$1</strong>:');
          }
          htmlParts.push(
            '<div class="fbs-bullet">' +
            '<span class="fbs-bullet-marker">' + circled + '</span>' +
            '<span class="fbs-bullet-text">' + rendered + '</span></div>'
          );
          break;
        }

        case "bullet": {
          let rendered = this._renderInlineMarkdown(this._collapseBulletPrefix(block.text));
          if (!rendered.includes('<strong>') && rendered.includes(':')) {
            rendered = rendered.replace(/^([^:]+):/, '<strong>$1</strong>:');
          }
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

        case "blank": {
          const prev = i > 0 ? blocks[i - 1].type : null;
          const next = i < blocks.length - 1 ? blocks[i + 1].type : null;
          const listTypes = ["bullet", "number"];
          if (listTypes.includes(prev) && listTypes.includes(next)) break;
          if (prev === "title") break;
          if (prev === "paragraph" && next === "paragraph") break;
          htmlParts.push('<div class="fbs-para-break" aria-hidden="true"></div>');
          break;
        }
      }
    }

    // Footer — class-driven (ui.css v3), no inline zinc colors
    const hasRepo = !!options.hasRepo;
    htmlParts.push(
      '<div class="fbs-disclaimer">' +
      "Lưu ý: Bài viết tổng hợp từ nguồn công khai, chưa dựa trên trải nghiệm trực tiếp. " +
      "Vui lòng kiểm tra mức độ phù hợp trước khi sử dụng." +
      "</div>"
    );
    htmlParts.push(
      '<div class="fbs-source-footer">' +
      (hasRepo
        ? "Link gốc & mã nguồn dưới bình luận đầu tiên"
        : "Chi tiết & nguồn dưới bình luận đầu tiên") +
      "</div>"
    );

    return htmlParts.join("");
  },

  _renderInlineMarkdown(text) {
    let html = this._escHtml(text);
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    html = html.replace(/`([^`]+)`/g, "$1");
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/\*{1,3}/g, "");
    return html;
  },

  _renderGlossaryHTML(items) {
    if (!items || items.length === 0) return "";
    let html = '<div class="fbs-glossary">';
    html += '<div class="fbs-glossary-heading">';
    html += '<svg class="fbs-glossary-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">';
    html += '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>';
    html += '</svg>';
    html += 'GIẢI THÍCH THUẬT NGỮ';
    html += '</div>';
    for (const item of items) {
      html += '<div class="fbs-glossary-item">';
      html += '<span class="fbs-glossary-bullet">·</span>';
      html += '<div class="fbs-glossary-content">';
      // Term: Capitalize first letter only
      const termText = this._escHtml(this._unwrapMarkdown(item.term));
      const termCapitalized = termText.charAt(0).toUpperCase() + termText.slice(1);
      html += '<strong class="fbs-glossary-term">' + termCapitalized + '</strong>';
      // Definition: capitalize first letter
      if (item.def) {
        const defText = this._escHtml(this._unwrapMarkdown(item.def));
        const capitalized = defText.charAt(0).toUpperCase() + defText.slice(1);
        html += '<span class="fbs-glossary-def">: ' + capitalized + '</span>';
      }
      html += '</div>';
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

// ── FeedWriter.format namespace ───────────────────────────────────────
window.FeedWriter = window.FeedWriter || {};
window.FeedWriter.format = StatusFormatter;
