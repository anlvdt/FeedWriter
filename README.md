# FeedWriter

<p align="center">
  <img src="icons/icon128.png" width="80" alt="FeedWriter">
</p>

<p align="center">
  Chrome Extension — Tóm tắt bài viết, viết status bằng AI, dịch EN→VI (từ · đoạn · slang · collocations · shadowing).<br>
  Hỗ trợ workflow nguồn thủ công và bóc link Shopee.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.4.1-blue" alt="Version 2.4.1">
  <img src="https://img.shields.io/badge/manifest-v3-blue" alt="Manifest V3">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License">
  <img src="https://img.shields.io/badge/dependencies-zero-brightgreen" alt="Zero deps">
</p>

---

## Tính năng nổi bật

### Tóm tắt & Status

- **Tóm tắt** bài viết dài thành vài câu ngắn gọn (có hook tiêu đề)
- **Viết lại** thành status cá nhân
- **Đăng status + nguồn** trên Facebook với workflow copy/paste rõ ràng

### Dịch EN → VI (học tiếng Anh)

Tập trung **cách dùng thật** — slang, cụm hay đi kèm, luyện nói:

| Chế độ | Khi nào dùng | Output |
|--------|--------------|--------|
| **Từ / cụm** | Double-click hoặc bôi 1–vài từ | Phiên âm, nghĩa, register, slang, collocations, tip shadowing |
| **Đoạn văn** | Bôi đoạn dài hơn | Dịch trôi chảy + slang trong đoạn + collocations |
| **Slang** | Thành ngữ / internet slang | Nghĩa đen · nghĩa lóng · register · tương đương VI · ví dụ |
| **Collocations** | Học cụm hay đi kèm | verb+noun, adj+noun, prep patterns, cụm hay nhầm |
| **Shadowing** | Luyện nói | Dịch nghĩa · IPA · chia chunk · nhịp nhấn · mẹo luyện |

**Cách gọi:**

- Double-click từ tiếng Anh → tooltip dịch nhanh
- Bôi đen → floating toolbar: **Dịch · Slang · Cụm từ · Shadow**
- Chuột phải → FeedWriter → chọn chế độ dịch
- Phím tắt: `Ctrl+Shift+T` / `Cmd+Shift+T` (dịch auto)

### Khác

- **Bóc link Shopee**: bôi `shope.ee` → context menu → mở trang affiliate chính thức
- **Ẩn bài affiliate / quảng cáo** (tuỳ chọn trong cài đặt) — chỉ lọc feed, không còn “chế bài affiliate”

> **Đã gỡ:** chức năng **viết / chế bài Affiliate** bằng AI.

---

## Cài đặt

```bash
git clone https://github.com/anlvdt/fb-post-summarizer.git
```

1. Mở Chrome → `chrome://extensions/` → bật **Developer mode**
2. Click **Load unpacked** → chọn folder vừa clone
3. Click icon extension trên toolbar → nhập API Key → **Lưu**

### Lỗi `An unknown error occurred when fetching the script`

Chrome MV3 thường **không load ổn** extension trên volume ngoài (`/Volumes/EXTERNAL/...`), kể cả APFS local — sandbox fail khi fetch service worker / content scripts.

**Cách fix (khuyên dùng):**

```bash
./scripts/sync-local.sh
```

Script copy runtime sang:

`~/Library/Application Support/FeedWriter-ext`

Rồi **Load unpacked** (hoặc Reload) trỏ vào folder **local** đó — không trỏ `/Volumes/EXTERNAL/...`.

Sau mỗi lần sửa code trên EXTERNAL, chạy lại `./scripts/sync-local.sh` rồi Reload extension.

> Đổi path Load unpacked = **extension ID mới** → storage/API key trống. Dùng tab **Keys → Import** file recovery/export.
## Lấy API Key (miễn phí)

| Dịch vụ | Free tier | Link |
|---------|-----------|------|
| **Groq** (khuyên dùng) | 14.400 request/ngày | [console.groq.com/keys](https://console.groq.com/keys) |
| Google Gemini | 15 request/phút | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |

## Cách sử dụng

**Tóm tắt / Status**

- Nút **Tóm tắt** cạnh “Xem thêm” trên Facebook
- Bôi đen text → floating toolbar → **Tóm tắt**
- Chuột phải → FeedWriter → Tóm tắt
- Phím tắt: `Ctrl+Shift+S` / `Cmd+Shift+S`

**Đăng status + nguồn**

- Sau khi có kết quả, bấm **Đăng Status**
- Kiểm tra / dán link nguồn, bấm **Copy nguồn**, dán comment đầu tiên

**Dịch EN → VI**

- Double-click từ tiếng Anh
- Bôi cụm / đoạn → toolbar **Dịch / Slang / Cụm từ / Shadow**
- Chuột phải → **Dịch · Slang · Collocations · Shadowing**
- `Ctrl+Shift+T` dịch vùng chọn

**Bóc link Shopee**

- Bôi link `shope.ee` → chuột phải → **Bóc Link Shopee**

## Nền tảng

| Nền tảng | Trạng thái |
|----------|-----------|
| Facebook | Ổn định |
| X (Twitter) | Thử nghiệm |
| LinkedIn | Thử nghiệm |
| Reddit | Thử nghiệm |
| Threads | Thử nghiệm |
| Mọi trang https | Dịch (double-click / shortcut) |

## Privacy

- API key lưu local (`chrome.storage`)
- Nội dung gửi thẳng tới provider bạn chọn (Groq / Gemini / …)
- Không thu thập analytics riêng

## License

MIT
