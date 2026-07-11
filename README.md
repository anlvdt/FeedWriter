# FeedWriter

<p align="center">
  <img src="icons/icon128.png" width="80" alt="FeedWriter">
</p>

<p align="center">
  Chrome Extension — Tóm tắt bài viết, viết status & affiliate bằng AI.<br>
  Hỗ trợ workflow nguồn thủ công, bóc link Shopee và dịch từ vựng Anh → Việt.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.5.1-blue" alt="Version 2.5.1">
  <img src="https://img.shields.io/badge/manifest-v3-blue" alt="Manifest V3">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License">
  <img src="https://img.shields.io/badge/dependencies-zero-brightgreen" alt="Zero deps">
</p>

---

## Tính năng mới v2.5.1

### Hardening & architecture

- **ACTION_SCHEMAS** — validate mọi message background (sender + payload).
- **FeedWriter namespace** — `FeedWriter.dom` / `.composer` / `.format` / `.runtime` (giữ alias `window.fbs*`).
- **Scoring profile** — lọc feed: Tech / Tổng quát / Review-sản phẩm.
- **Provider health** — xem rate-limit & last-used trên tab Keys.
- **84 pure tests** (message schema, provider rotation, scoring, formatter…).

### v2.5.0 (trước đó)

- Labs gate auto-post + optional permissions.
- Floating toolbar multi-mode, Mac shortcuts, composer ← Sửa lại.
- IO-gated scan, zero-dep `npm test`.

### Workflow đăng status và nguồn (v2.4+)

- **Dán nguồn thủ công nhanh hơn**: ô link nguồn tự được chọn, có nút Paste để dùng link bạn vừa copy.
- **Không tự copy nguồn sai** sau khi mở composer; bạn kiểm tra/dán nguồn trước khi đăng.
- **Bóc link Shopee**: mở trang tạo link affiliate chính thức để tạo link hợp lệ.
- **Tự động đăng repo GitHub**: Labs / rủi ro — bật trong popup sau khi xác nhận, cần đăng nhập Facebook.

👉 **[Xem hướng dẫn chi tiết](SHOPEE_AFFILIATE_GUIDE.md)**

---

## Tổng quan

Extension giúp bạn xử lý nội dung trên Facebook nhanh hơn:

- **Tóm tắt** bài viết dài thành vài câu ngắn gọn
- **Viết lại** thành status cá nhân ở ngôi thứ nhất
- **Chế bài affiliate** từ bài review sản phẩm
- **Bóc link Shopee** để tạo affiliate link thủ công qua trang chính thức
- **Dịch từ** tiếng Anh sang tiếng Việt bằng double-click

Mọi thứ chạy bằng AI (Groq hoặc Gemini), API key miễn phí, không thu thập dữ liệu.

## Demo

| Tóm tắt bài viết | Viết Status | Dịch từ |
|---|---|---|
| Click nút cạnh "Xem thêm" | Shift+Click hoặc floating toolbar | Double-click từ tiếng Anh |

## Cài đặt

```bash
git clone https://github.com/anlvdt/fb-post-summarizer.git
```

1. Mở Chrome → `chrome://extensions/` → bật **Developer mode**
2. Click **Load unpacked** → chọn folder vừa clone
3. Click icon extension trên toolbar → nhập API Key → **Lưu**

## Lấy API Key (miễn phí)

| Dịch vụ | Free tier | Link |
|---------|-----------|------|
| **Groq** (khuyên dùng) | 14.400 request/ngày | [console.groq.com/keys](https://console.groq.com/keys) |
| Google Gemini | 15 request/phút | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |

## Cách sử dụng

**Tóm tắt / Status / Affiliate:**
- Nút **Tóm tắt** tự động hiện cạnh "Xem thêm" trên Facebook
- Bôi đen text → floating toolbar hiện lên → chọn chế độ
- Chuột phải → context menu → chọn tính năng
- Phím tắt: `Ctrl+Shift+S` (tóm tắt) · `Ctrl+Shift+A` (affiliate)

**Đăng status + nguồn:**
- Sau khi có kết quả, bấm **Đăng Status**
- Copy link nguồn đúng từ bài gốc nếu app nhận sai
- Bấm **Paste** ở ô "Link bài gốc" để dán đè nguồn
- Kiểm tra preview comment nguồn, bấm **Copy nguồn**, rồi dán vào comment đầu tiên

**Dịch từ vựng:**
- Double-click vào từ tiếng Anh bất kỳ → tooltip hiện phiên âm + nghĩa

**Bóc link Shopee:**
- Bôi đen link `shope.ee` → chuột phải → **Bóc Link Shopee**
- Extension mở trang Shopee Affiliate chính thức để bạn tạo custom affiliate link hợp lệ

**Tự động đăng repo GitHub:**
- Bật trong popup → Cài đặt → "Tự động đăng repo GitHub"
- Tính năng này mở tab Facebook nền và tự thao tác đăng bài
- Lưu ý: tự động hóa Facebook có rủi ro bị hạn chế tài khoản; nên dùng thận trọng

## Tính năng nổi bật

**11 prompt templates**

| Nhóm | Templates |
|------|-----------|
| Tóm tắt | Mặc định · Ngắn gọn · Chi tiết · Bullet points · Giữ cấu trúc |
| Status | Ngôi thứ nhất · Cực ngắn · Cảm xúc |
| Affiliate | Review chân thật · Soft sell · Storytelling |

**Chất lượng output**
- Quy tắc chính tả VnReview tích hợp (số, tiền tệ, ngày tháng, viết hoa)
- Post-processing tự động: phát hiện copy nguyên văn (n-gram), câu lặp, auto-fix chính tả
- Nhận biết nền tảng nguồn để điều chỉnh giọng văn

**Tùy biến**
- Chọn độ dài output: ngắn / vừa / dài
- Chọn phong cách tóm tắt
- Thêm hướng dẫn bổ sung riêng
- Tự viết prompt hoàn toàn

## Nền tảng

| Nền tảng | Trạng thái |
|----------|-----------|
| Facebook | ✅ Ổn định — đã test kỹ |
| X (Twitter) | 🧪 Thử nghiệm |
| LinkedIn | 🧪 Thử nghiệm |
| Reddit | 🧪 Thử nghiệm |
| Threads | 🧪 Thử nghiệm |

## Cấu trúc project

```
├── manifest.json        # Chrome extension config
├── background.js        # Service worker: API calls, message router, alarms
├── bg-api.js            # API key rotation, provider calls, prompt assembly
├── bg-prompts.js        # Prompt templates
├── content-dom.js       # DOM extraction, source/link/image detection
├── content-composer.js  # Composer/posting workflow
├── content.js           # Content UI, scan loop, streaming summary
├── translate.js         # Double-click translation tooltip
├── status-formatter.js  # Text formatter for platform output
├── poster-*.js          # Cross-platform posting adapters
├── content.css          # Styles cho overlay, tooltip, buttons
├── translate.css        # Styles cho tooltip dịch
├── popup.html           # Popup settings UI
├── popup.js             # Popup logic
├── popup.css            # Popup styles
├── lib/pure-logic.js    # Pure functions for unit tests (mirror of runtime algorithms)
├── tests/               # node:test harness (npm test)
├── package.json         # test + check scripts only (no runtime deps)
├── AUDIT_REPORT.md      # Deep audit hiện trạng
├── UPGRADE_BACKLOG.md   # Roadmap cải tiến có acceptance criteria
├── icons/               # Extension icons (16, 48, 128)
├── LICENSE              # MIT
└── README.md
```

## Kiến trúc

```
INPUT GUARDRAILS          validate length, sanitize
        ↓
SMART PROMPT ASSEMBLY     11 templates + platform hints + VnReview rules
        ↓
LLM (Groq / Gemini)      streaming response
        ↓
OUTPUT GUARDRAILS         copy detection, repetition, length, auto-fix
        ↓
UI                        overlay panel + quality warnings
```

## Tech stack

- Chrome Extension Manifest V3
- Groq API (Llama 3.3 70B) / Google Gemini 2.0 Flash
- Vanilla JS — zero dependencies, zero build step

## Tests

Zero npm install. Uses Node’s built-in test runner (`node:test`).

```bash
# Requires Node 18+
npm test

# Syntax-check main extension scripts
npm run check
```

Pure algorithms under test live in `lib/pure-logic.js` (mirrors content/background logic).  
`status-formatter.js` is loaded in a VM sandbox by the formatter tests.

## Contributing

Mọi đóng góp đều được chào đón.

1. Fork repo
2. Tạo branch: `git checkout -b feature/ten-tinh-nang`
3. Commit & push
4. Tạo Pull Request

**Cần help:**
- Test & fix cho X, LinkedIn, Reddit, Threads
- Cải thiện prompt templates
- Bug reports

**Quy tắc:**
- Zero dependencies — không thêm npm package
- Vanilla JS — không framework
- Test trên Chrome trước khi tạo PR

## License

[MIT](LICENSE) — [Le An](https://github.com/anlvdt)
