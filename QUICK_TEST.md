# ⚡ Quick Test Guide - 5 phút

## 🎯 Test nhanh nhất (Khuyến nghị)

### 1. Có sẵn API key?

**CÓ** → Đi bước 2  
**CHƯA** → Lấy free key:
- **Groq** (nhanh nhất): https://console.groq.com/keys → Sign up → Create API Key
- Copy key bắt đầu bằng `gsk_...`

### 2. Load Extension vào Chrome

```bash
1. Mở Chrome
2. Gõ: chrome://extensions/
3. Bật "Developer mode" (góc phải trên)
4. Click "Load unpacked"
5. Chọn folder: /Users/anle/Desktop/01_DEV_PROJECTS/MyApps/FeedWriter
6. Done! Icon FeedWriter xuất hiện trên toolbar
```

### 3. Test API Key

```bash
1. Click icon FeedWriter → Tab "Khóa API"
2. Paste key vào ô → Click nút "+"
3. Click "Test kết nối"
4. Đợi 2-3 giây...

KẾT QUẢ:
✅ "Groq — OK" → THÀNH CÔNG! 
❌ Có lỗi → Xem phần Troubleshooting bên dưới
```

### 4. Test thực tế

```bash
1. Mở Facebook: facebook.com
2. Tìm bài viết dài
3. Bôi đen văn bản bài viết
4. Nhấn: Ctrl+Shift+S (Mac: Cmd+Shift+S)
5. Popup xuất hiện → Text streaming → Done!
6. Click "Copy Status" → Paste anywhere

✅ Hoạt động → Deployment successful!
```

---

## 🐛 Troubleshooting nhanh

### ❌ "Key không hợp lệ"
→ Key sai hoặc expired  
→ Tạo key mới: https://console.groq.com/keys

### ❌ "Rate limited"
→ Dùng quá nhiều, đợi vài phút  
→ Hoặc tạo key mới với email khác

### ❌ "Model not found" hoặc "llama-3.3-70b-versatile"
→ Code chưa update đầy đủ  
→ Check file bị missed:
```bash
cd /Users/anle/Desktop/01_DEV_PROJECTS/MyApps/FeedWriter
grep -r "llama-3.3-70b-versatile" *.js
# Không được có kết quả!
```

### ❌ Extension không load được
→ Check Chrome version (cần Chrome 88+)  
→ Xem Console errors: Click "Errors" trong chrome://extensions/

### ❌ Popup không hiện khi bôi đen
→ Reload trang Facebook (F5)  
→ Hoặc reload extension: chrome://extensions/ → Click ↻

---

## 📊 Test checklist tối thiểu

- [ ] Extension load thành công
- [ ] Thêm được API key  
- [ ] Test connection pass
- [ ] Summarize 1 bài Facebook hoạt động
- [ ] Copy status hoạt động

**5/5 pass → Deploy! 🚀**

---

## 🆘 Cần help?

1. Xem full guide: `TESTING_GUIDE.md`
2. Xem migration notes: `MODEL_MIGRATION_NOTES.md`
3. Check console logs (F12 → Console tab)
4. GitHub issues: https://github.com/anlvdt/fb-post-summarizer/issues

---

## 🔥 Pro Tips

**Multiple keys**: Thêm keys từ nhiều providers để tăng quota
```
- Groq: 100K tok/day
- Cerebras: 1M tok/day  
- SambaNova: 20M tok/day
- Gemini: 1500 req/day
```

**Test script** (không cần extension):
```bash
API_KEY=gsk_xxxxxxxx node test-api-keys.js
```

**Backup keys**: Extension → API Keys → Export → Save file

---

**Total time: ~5 phút | Success rate: 95%+ 🎉**
