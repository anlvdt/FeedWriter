# FeedWriter v2.3.0 - Changelog

**Release Date:** 2026-05-19

## 🎉 Major Features

### Shopee Affiliate Integration

- **Tự động tìm sản phẩm hot** trên Shopee dựa trên nội dung bài viết
- **Tạo affiliate link** tự động với Shopee Affiliate ID
- **Hiển thị top 5 sản phẩm** liên quan ngay trong panel tóm tắt
- **Tự động thêm vào Copy/Đăng Status** - Sản phẩm được format như link nguồn/repo
- **Thông tin chi tiết** cho mỗi sản phẩm:
  - Hình ảnh sản phẩm
  - Tên và giá (có highlight giảm giá)
  - Rating và số lượng đã bán
  - Link affiliate để mở sản phẩm

### Smart Product Discovery

- **Trích xuất từ khóa thông minh** từ nội dung
- **Lọc sản phẩm chất lượng:**
  - Đã bán ≥ 100 sản phẩm
  - Rating ≥ 4.5 sao
  - Sắp xếp theo độ hot (số lượng bán)
- **API integration** với Shopee Search API

## 🎨 UI/UX Improvements

### Accessibility (WCAG 2.1 AA Compliant)

- ✅ Tăng contrast ratio cho text (4.5:1 minimum)
- ✅ Focus visible cho keyboard navigation
- ✅ ARIA labels cho screen readers
- ✅ Reduced motion support

### Visual Enhancements

- **Product cards** với glassmorphism design
- **Loading skeleton** khi đang tìm sản phẩm
- **Hover effects** mượt mà cho product items
- **Responsive images** với lazy loading
- **Price highlighting** với discount badges

### Responsive Design

- **Mobile-first approach**
- **Breakpoints:**
  - Mobile: < 768px (full-screen modal)
  - Tablet: 768px - 1023px (80vw width)
  - Desktop: ≥ 1024px (520px width)
- **Touch-friendly** buttons và interactions

### Better Feedback

- **Progress indicators** khi streaming
- **Character count** hiển thị real-time
- **Loading states** cho mọi async operations
- **Error messages** rõ ràng và actionable

## ⚙️ Settings & Configuration

### New Settings

- **Shopee Affiliate ID** input field
- **Auto-find Shopee products** toggle
- **Tooltips** cho tất cả settings (? icon)
- **Settings backup/restore** system

### Settings UI

- **Accordion organization** cho dễ navigate
- **Field hints** giải thích từng option
- **Visual grouping** cho related settings
- **Shopee settings section** với highlight màu cam

## 🔧 Technical Improvements

### New Files

- `shopee-api.js` - Shopee API integration
- `SHOPEE_AFFILIATE_GUIDE.md` - User documentation
- `WAVE7_CHANGELOG.md` - This file

### Code Quality

- **Modular architecture** - Tách Shopee logic riêng
- **Error handling** - Graceful fallback khi API fails
- **Type safety** - JSDoc comments cho functions
- **Performance** - Caching và debouncing

### CSS Enhancements

- **Design tokens** - CSS custom properties
- **Typography scale** - Consistent font sizes
- **Spacing system** - 8px base unit
- **Color palette** - Accessible colors
- **Animation system** - Smooth transitions

## 📦 Dependencies

### No New Dependencies

- ✅ Zero external dependencies added
- ✅ Pure vanilla JavaScript
- ✅ Native Fetch API for Shopee requests
- ✅ No build step required

## 🐛 Bug Fixes

- Fixed panel width overflow on mobile devices
- Fixed tooltip positioning on small screens
- Fixed keyboard navigation focus states
- Fixed streaming progress indicator accuracy
- Fixed theme toggle not persisting

## 🚀 Performance

- **Lazy loading** cho product images
- **Debounced search** để tránh spam API
- **Caching** cho repeated searches
- **Skeleton loading** để improve perceived performance
- **Async/await** cho better error handling

## 📱 Browser Compatibility

- ✅ Chrome 90+ (tested)
- ✅ Edge 90+ (tested)
- ⚠️ Firefox - Manifest V3 differences (not tested)
- ❌ Safari - No Manifest V3 support

## 🔐 Security

- **No secrets in code** - Affiliate ID stored in chrome.storage
- **HTTPS only** - All Shopee API calls use HTTPS
- **Input validation** - Sanitize user inputs
- **CSP compliant** - No inline scripts

## 📊 Metrics

### Code Stats

- **Total lines:** ~2,550 (content.js)
- **New lines:** ~200 (Shopee integration)
- **CSS lines:** ~2,700 (content.css)
- **New CSS:** ~300 (Shopee products)

### File Sizes

- `shopee-api.js`: ~8KB
- `content.css`: ~65KB
- `content.js`: ~93KB
- Total extension: ~450KB (uncompressed)

## 🎯 Future Roadmap

### Planned for v2.4.0

- [ ] Manual product selection
- [ ] Multiple affiliate IDs support
- [ ] Product comparison feature
- [ ] Price tracking alerts
- [ ] Custom product templates

### Planned for v2.5.0

- [ ] Lazada integration
- [ ] Tiki integration
- [ ] TikTok Shop integration
- [ ] Multi-platform affiliate dashboard

## 📝 Migration Guide

### From v2.2.0 to v2.3.0

**No breaking changes.** All existing features work as before.

**New optional features:**
1. Open extension settings
2. Go to "Auto-pilot & Đăng bài" section
3. Find "🛍️ Shopee Affiliate" section
4. Enter your Affiliate ID (optional)
5. Enable "Tự động tìm sản phẩm Shopee liên quan"
6. Save settings

**If you don't configure Shopee:**
- Extension works exactly as v2.2.0
- No Shopee products will be shown
- No API calls to Shopee

## 🙏 Credits

### Contributors

- **Le An (anlvdt)** - Lead Developer
- **Community feedback** - UX improvements suggestions

### Inspiration

- Shopee Affiliate Program
- Material Design Guidelines
- WCAG 2.1 Accessibility Standards

## 📄 License

MIT License - Free to use and modify

## 🔗 Links

- **GitHub:** https://github.com/anlvdt/fb-post-summarizer
- **Issues:** https://github.com/anlvdt/fb-post-summarizer/issues
- **Shopee Affiliate:** https://affiliate.shopee.vn
- **Documentation:** See SHOPEE_AFFILIATE_GUIDE.md

---

## Breaking Changes

**None.** This is a backward-compatible release.

## Known Issues

1. **Shopee API rate limiting** - May fail if too many requests in short time
   - **Workaround:** Wait 30 seconds and try again

2. **Product relevance** - Sometimes products may not be highly relevant
   - **Workaround:** Use more specific keywords in content

3. **Mobile keyboard** - Panel may be covered by keyboard on some devices
   - **Workaround:** Scroll or close keyboard

## Deprecations

**None.** All existing APIs remain stable.

## Notes

- This release focuses on **monetization** and **UI/UX polish**
- Shopee integration is **opt-in** - won't affect users who don't enable it
- All new features are **thoroughly tested** on Chrome 120+
- **Performance impact** is minimal (< 100ms added to summary time)

---

**Full Changelog:** https://github.com/anlvdt/fb-post-summarizer/compare/v2.2.0...v2.3.0
