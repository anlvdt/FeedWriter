# 🧪 Testing Guide - FeedWriter API Keys

Hướng dẫn test API keys sau khi migration models mới.

## 🎯 Mục đích Test

Xác nhận các API keys hoạt động với models mới sau migration:
- ✅ Groq: `openai/gpt-oss-120b` (thay vì `llama-3.3-70b-versatile`)
- ✅ OpenRouter: `openai/gpt-oss-120b` (thay vì `meta-llama/llama-3.3-70b-instruct`)
- ✅ Gemini: `gemini-2.0-flash` (không đổi)
- ✅ Cerebras: `gpt-oss-120b` (không đổi)
- ✅ SambaNova: `Meta-Llama-3.3-70B-Instruct` (không đổi)

---

## 📦 Method 1: Test qua Extension (Khuyến nghị)

Đây là cách dễ nhất và chính xác nhất vì test trong môi trường thực tế.

### Bước 1: Load Extension

```bash
# Mở Chrome hoặc Edge
# Vào chrome://extensions/
# Bật Developer mode
# Click "Load unpacked"
# Chọn thư mục: /Users/anle/Desktop/01_DEV_PROJECTS/MyApps/FeedWriter
```

### Bước 2: Thêm API Key

1. Click icon FeedWriter trên thanh toolbar
2. Chuyển sang tab **"Khóa API"**
3. Dán API key vào ô input
4. Click nút **"+"** để thêm key

### Bước 3: Test Connection

1. Sau khi thêm key, click nút **"Test kết nối"**
2. Đợi vài giây...
3. Kết quả sẽ hiện ngay dưới nút:
   - ✅ **Thành công**: `Groq — OK` hoặc `Gemini — OK`
   - ❌ **Thất bại**: Hiển thị lỗi cụ thể

### Các lỗi thường gặp:

| Lỗi | Nguyên nhân | Giải pháp |
|-----|-------------|-----------|
| `Rate limited` | Đã vượt quota free tier | Đợi vài phút hoặc dùng key khác |
| `Key không hợp lệ` | Key sai hoặc hết hạn | Tạo key mới từ dashboard |
| `Lỗi mạng` | Không có internet hoặc firewall | Kiểm tra kết nối |
| `429 Too Many Requests` | Quá nhiều requests | Đợi reset (thường mỗi ngày) |

---

## 💻 Method 2: Test qua Node.js Script

Nếu bạn muốn test nhanh mà không cần load extension.

### Yêu cầu

```bash
# Đảm bảo có Node.js (v14+)
node --version
```

### Test một key cụ thể

```bash
# Test Groq key
API_KEY=gsk_xxxxxxxxxx node test-api-keys.js

# Test Gemini key
API_KEY=AIzaxxxxxxxxxx PROVIDER=gemini node test-api-keys.js

# Test Cerebras key
API_KEY=csk-xxxxxxxxxx node test-api-keys.js

# Test SambaNova key (UUID format)
API_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx PROVIDER=sambanova node test-api-keys.js

# Test OpenRouter key
API_KEY=sk-or-xxxxxxxxxx node test-api-keys.js
```

### Kết quả mong đợi

```
=== FeedWriter API Keys Test ===

Models after migration:
  groq: openai/gpt-oss-120b
  gemini: gemini-2.0-flash
  cerebras: gpt-oss-120b
  sambanova: Meta-Llama-3.3-70B-Instruct
  openrouter: openai/gpt-oss-120b

Testing single key for provider: groq

Testing Groq API...
✓ Groq (openai/gpt-oss-120b): OK

✓ Test passed!
```

---

## 🔍 Method 3: Test Manual bằng curl

Test trực tiếp API endpoints (advanced users).

### Test Groq

```bash
curl -X POST https://api.groq.com/openai/v1/chat/completions \
  -H "Authorization: Bearer gsk_xxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-oss-120b",
    "messages": [
      {"role": "system", "content": "You are a test bot."},
      {"role": "user", "content": "Say OK"}
    ],
    "max_tokens": 50
  }'
```

### Test Gemini

```bash
curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=AIzaxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{"parts": [{"text": "Say OK"}]}],
    "generationConfig": {"maxOutputTokens": 50}
  }'
```

### Test Cerebras

```bash
curl -X POST https://api.cerebras.ai/v1/chat/completions \
  -H "Authorization: Bearer csk-xxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-oss-120b",
    "messages": [
      {"role": "system", "content": "You are a test bot."},
      {"role": "user", "content": "Say OK"}
    ],
    "max_tokens": 50
  }'
```

### Test OpenRouter

```bash
curl -X POST https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer sk-or-xxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -H "HTTP-Referer: https://github.com/anlvdt/fb-post-summarizer" \
  -H "X-Title: FeedWriter" \
  -d '{
    "model": "openai/gpt-oss-120b",
    "messages": [
      {"role": "system", "content": "You are a test bot."},
      {"role": "user", "content": "Say OK"}
    ],
    "max_tokens": 50
  }'
```

---

## 🚀 Method 4: Test trong Production

Test thực tế với bài viết thật.

### Test Summarize

1. Mở Facebook: https://www.facebook.com
2. Tìm một bài viết dài
3. Bôi đen nội dung bài viết
4. Nhấn **Ctrl+Shift+S** (hoặc Cmd+Shift+S trên Mac)
5. Popup summary sẽ xuất hiện và stream text

### Kiểm tra:

- ✅ Text có stream ra từng chữ không?
- ✅ Summary có ý nghĩa không?
- ✅ Có lỗi nào hiện không?
- ✅ Copy status hoạt động không?

### Test Cross-platform

Thử trên các platforms khác:
- Twitter/X: https://x.com
- LinkedIn: https://www.linkedin.com
- Threads: https://www.threads.net
- Reddit: https://www.reddit.com

---

## 📊 Checklist Test hoàn chỉnh

### ✅ Pre-deployment Checks

- [ ] Tất cả API keys test pass trong extension
- [ ] Test summarize ít nhất 5 bài viết khác nhau
- [ ] Test trên ít nhất 2 platforms (FB + X)
- [ ] Test với content tiếng Việt và tiếng Anh
- [ ] Test khi rate limit (đảm bảo fallback works)
- [ ] Test multi-key rotation (nếu có nhiều keys)
- [ ] Test khi offline (error handling)

### ✅ Post-deployment Monitoring

Sau khi deploy, theo dõi trong 24-48h đầu:

1. **Check Error Logs**
   - Mở Console (F12) khi dùng extension
   - Xem có error `404` hoặc `model not found` không

2. **Monitor Rate Limits**
   - Groq: 100K tokens/day (free)
   - Cerebras: 1M tokens/day (free)
   - Gemini: 1500 requests/day (free)

3. **Performance Metrics**
   - TTFT (Time to First Token): < 2 giây
   - Total response time: < 10 giây
   - Streaming smooth không bị lag

---

## 🆘 Troubleshooting

### Lỗi: "llama-3.3-70b-versatile not found"

**Nguyên nhân**: Code chưa được cập nhật  
**Giải pháp**: 
```bash
# Kiểm tra các file đã update chưa
grep -r "llama-3.3-70b-versatile" *.js
# Phải trả về empty hoặc chỉ trong comments
```

### Lỗi: "Model not supported"

**Nguyên nhân**: Provider chưa hỗ trợ model mới  
**Giải pháp**: Xem MODEL_MIGRATION_NOTES.md để check compatibility

### Keys bị rate limit liên tục

**Nguyên nhân**: Dùng quá nhiều trong ngày  
**Giải pháp**:
1. Thêm nhiều keys từ providers khác
2. Giảm usage bằng cách tăng `minLength` trong settings
3. Cache summaries để tránh gọi lại

### Extension bị "Extension context invalidated"

**Nguyên nhân**: Extension bị reload trong lúc test  
**Giải pháp**: 
1. Đóng popup
2. Reload extension manually
3. Mở lại popup và test lại

---

## 📝 Report Issues

Nếu gặp vấn đề, thu thập thông tin:

```
1. Provider nào bị lỗi? (Groq, Gemini, Cerebras, SambaNova, OpenRouter)
2. Error message đầy đủ?
3. HTTP status code? (401, 403, 404, 429, 500...)
4. Đang test trong extension hay script?
5. Screenshot console logs (nếu có)
```

Gửi report về: https://github.com/anlvdt/fb-post-summarizer/issues

---

## 🎓 Lấy Free API Keys

| Provider | Link | Limit | Prefix |
|----------|------|-------|--------|
| **Groq** | [console.groq.com/keys](https://console.groq.com/keys) | 100K tok/day | `gsk_` |
| **Cerebras** | [cloud.cerebras.ai](https://cloud.cerebras.ai) | 1M tok/day | `csk-` |
| **SambaNova** | [cloud.sambanova.ai](https://cloud.sambanova.ai) | $5 free, 20M tok/day | UUID |
| **Gemini** | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | 1500 req/day | `AIza` |
| **OpenRouter** | [openrouter.ai/keys](https://openrouter.ai/keys) | 50 req/day | `sk-or-` |

---

## ✨ Tips

1. **Đăng ký nhiều accounts**: Mỗi email = 1 set keys mới
2. **Rotate keys**: Thêm nhiều keys để tăng quota
3. **Monitor usage**: Check dashboard của mỗi provider hàng ngày
4. **Backup keys**: Export keys thường xuyên (Extension → API Keys → Export)
5. **Test before peak hours**: Test vào sáng sớm khi ít user dùng

---

**Good luck testing! 🚀**
