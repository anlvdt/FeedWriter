# Hướng dẫn sử dụng tính năng Shopee Affiliate

## Tổng quan

FeedWriter v2.3.0 đã tích hợp tính năng tự động tìm sản phẩm hot và tạo Shopee affiliate link. Khi bạn tóm tắt một bài viết, extension sẽ:

1. **Tự động phân tích** nội dung để tìm từ khóa sản phẩm
2. **Tìm kiếm** 5 sản phẩm hot nhất trên Tiki (API mở của Việt Nam)
3. **Tạo Shopee search link** với từ khóa + Affiliate ID của bạn
4. **Rút gọn link** bằng TinyURL hoặc is.gd
5. **Hiển thị** danh sách sản phẩm ngay trong panel tóm tắt

## Cách hoạt động

### Quy trình tự động

```
Nội dung bài viết
    ↓
Trích xuất từ khóa (AI)
    ↓
Tìm sản phẩm trên Tiki API (open, free)
    ↓
Tạo Shopee search link + Affiliate ID
    ↓
Rút gọn link (TinyURL/is.gd)
    ↓
Hiển thị trong panel
```

### Tại sao dùng Tiki API?

- ✅ **Open API** - Không cần authentication
- ✅ **Miễn phí** - Không giới hạn request
- ✅ **Dữ liệu Việt Nam** - Sản phẩm phù hợp thị trường VN
- ✅ **Chất lượng cao** - Tiki có review và rating đáng tin cậy

### Tại sao không dùng Shopee API?

- ❌ Shopee không cung cấp public API
- ❌ Cần authentication phức tạp
- ❌ CORS policy block requests từ browser

### Giải pháp của chúng tôi

1. **Tìm sản phẩm** trên Tiki (có API mở)
2. **Tạo link tìm kiếm** trên Shopee với từ khóa
3. **Thêm Affiliate ID** vào link
4. **Rút gọn link** để dễ chia sẻ

## Cài đặt

### Bước 1: Đăng ký Shopee Affiliate Program

1. Truy cập: https://affiliate.shopee.vn
2. Đăng ký tài khoản affiliate
3. Sau khi được duyệt, lấy **Affiliate ID** của bạn

### Bước 2: Cấu hình trong Extension

1. Mở **FeedWriter Extension** (click icon trên thanh toolbar)
2. Chuyển sang tab **"Cài đặt"**
3. Mở accordion **"Auto-pilot & Đăng bài"**
4. Tìm phần **"🛍️ Shopee Affiliate"**
5. Nhập **Shopee Affiliate ID** của bạn vào ô input
6. Bật checkbox **"Tự động tìm sản phẩm Shopee liên quan"**
7. Click **"Lưu cài đặt"**

## Cách sử dụng

### Tóm tắt bài viết với Shopee Products

1. **Bôi đen** đoạn văn bản trên Facebook/X/LinkedIn/Reddit
2. Click nút **"Tóm tắt"** hoặc nhấn `Ctrl+Shift+S`
3. Đợi AI tóm tắt nội dung
4. **Sản phẩm Shopee** sẽ tự động xuất hiện bên dưới phần tóm tắt

### Thông tin hiển thị cho mỗi sản phẩm

- **Hình ảnh** sản phẩm (từ Tiki)
- **Tên** sản phẩm
- **Giá** hiện tại (và giá gốc nếu có giảm giá)
- **% Giảm giá** (nếu có)
- **Đánh giá** (rating/5 sao)
- **Số lượng đã bán** (từ Tiki)
- **Link tìm kiếm Shopee** (đã rút gọn, có affiliate ID)

### Copy nội dung với affiliate links

Khi bạn click **"Copy"** hoặc **"Đăng Status"**, nội dung sẽ tự động bao gồm:
- Phần tóm tắt
- Danh sách 5 sản phẩm với Shopee affiliate links (đã rút gọn)
- Format giống như link nguồn/repo/download

Bạn có thể paste trực tiếp vào Facebook status để chia sẻ.

## Tính năng nâng cao

### Tự động tìm sản phẩm hot

Extension sử dụng thuật toán thông minh để:
- **Trích xuất từ khóa** quan trọng từ nội dung
- **Tìm kiếm trên Tiki API** - Sản phẩm chất lượng cao
- **Tạo Shopee search link** - Với affiliate tracking
- **Rút gọn link** - TinyURL hoặc is.gd
- **Hiển thị top 5** sản phẩm phù hợp nhất

### Rate Limiting

Extension tự động xử lý rate limit:
- **Tiki API:** 1 request / 3 giây
- **TinyURL:** 1 request / 60 giây
- **is.gd:** 1 request / 30 giây

Nếu vượt rate limit, extension sẽ tự động chờ và retry.

### Shopee Search Link Format

Link tìm kiếm Shopee được tạo với format:
```
https://shopee.vn/search?keyword={product_name}&order=desc&sortBy=sales&aff_sid={your_id}
```

Sau đó được rút gọn thành:
```
https://tinyurl.com/abc123
hoặc
https://is.gd/xyz789
```

## Lợi ích

### Cho Content Creator
- ✅ **Tăng thu nhập** từ affiliate commission
- ✅ **Tiết kiệm thời gian** tìm sản phẩm liên quan
- ✅ **Tăng giá trị** cho bài viết của bạn
- ✅ **Tự động hóa** quy trình tạo nội dung affiliate

### Cho người đọc
- ✅ **Dễ dàng tìm** sản phẩm liên quan đến nội dung
- ✅ **Xem ngay** giá, rating, số lượng bán
- ✅ **Click 1 lần** để mở sản phẩm trên Shopee

## Ví dụ thực tế

### Ví dụ 1: Bài viết về công nghệ

**Nội dung gốc:**
> "iPhone 15 Pro Max có camera 48MP, chip A17 Pro mạnh mẽ, pin trâu..."

**Kết quả:**
- Extension tự động tìm 5 sản phẩm:
  - Ốp lưng iPhone 15 Pro Max
  - Cường lực iPhone 15 Pro Max
  - Sạc nhanh 20W
  - Tai nghe AirPods Pro
  - Cáp sạc USB-C

### Ví dụ 2: Bài viết về làm đẹp

**Nội dung gốc:**
> "Serum vitamin C giúp làm sáng da, mờ thâm nám hiệu quả..."

**Kết quả:**
- Extension tự động tìm 5 sản phẩm:
  - Serum Vitamin C Some By Mi
  - Kem chống nắng Anessa
  - Sữa rửa mặt Cetaphil
  - Mặt nạ giấy Mediheal
  - Toner AHA BHA PHA

## Troubleshooting

### Không tìm thấy sản phẩm

**Nguyên nhân:**
- Nội dung quá ngắn hoặc không có từ khóa rõ ràng
- Từ khóa không có trên Tiki
- Lỗi kết nối Tiki API
- Rate limit (quá nhiều requests)

**Giải pháp:**
- Thử tóm tắt đoạn văn bản dài hơn
- Đảm bảo nội dung có từ khóa sản phẩm cụ thể
- Kiểm tra kết nối internet
- Đợi 3-5 giây và thử lại

### Link rút gọn không hoạt động

**Nguyên nhân:**
- TinyURL hoặc is.gd bị rate limit
- Lỗi kết nối URL shortener

**Giải pháp:**
- Extension sẽ tự động fallback sang link gốc
- Link gốc vẫn có affiliate ID, chỉ dài hơn
- Đợi 1 phút và thử lại để có link ngắn

### Affiliate link không có commission

**Nguyên nhân:**
- Chưa nhập Affiliate ID
- Affiliate ID không đúng format
- Link bị modify sau khi rút gọn

**Giải pháp:**
- Kiểm tra lại Affiliate ID trong settings
- Đảm bảo ID là số (VD: 12345678)
- Test link bằng cách click và kiểm tra URL có `aff_sid=`
- Liên hệ Shopee Affiliate support nếu vẫn lỗi

### Sản phẩm hiển thị không liên quan

**Nguyên nhân:**
- Thuật toán trích xuất từ khóa chưa chính xác
- Tiki không có sản phẩm phù hợp
- Nội dung có nhiều chủ đề khác nhau

**Giải pháp:**
- Bôi đen đoạn văn bản cụ thể hơn
- Tập trung vào 1 chủ đề chính
- Sản phẩm từ Tiki chỉ là gợi ý, user vẫn search trên Shopee

## FAQ

### Q: Tôi có cần Affiliate ID không?

**A:** Không bắt buộc. Nếu không có Affiliate ID, extension vẫn tìm và hiển thị sản phẩm, nhưng link sẽ không có commission tracking.

### Q: Tại sao dùng Tiki để tìm sản phẩm mà không phải Shopee?

**A:** Shopee không cung cấp public API. Chúng tôi dùng Tiki API (mở và miễn phí) để tìm sản phẩm, sau đó tạo link tìm kiếm trên Shopee với affiliate tracking.

### Q: Link có dẫn đến đúng sản phẩm trên Shopee không?

**A:** Link dẫn đến **trang tìm kiếm Shopee** với từ khóa sản phẩm. User sẽ thấy các sản phẩm tương tự trên Shopee và có thể chọn mua. Affiliate tracking vẫn hoạt động.

### Q: Tôi có thể tắt tính năng này không?

**A:** Có. Bỏ tick checkbox "Tự động tìm sản phẩm Shopee liên quan" trong settings.

### Q: Extension có tốn phí không?

**A:** Không. Tính năng này hoàn toàn miễn phí. Tiki API là open và free. URL shortener cũng miễn phí.

### Q: Tôi có thể chọn sản phẩm khác không?

**A:** Hiện tại extension tự động chọn top 5 sản phẩm từ Tiki. User có thể click link để search trên Shopee và chọn sản phẩm khác.

### Q: Commission rate là bao nhiêu?

**A:** Commission rate do Shopee Affiliate Program quy định, thường từ 1-10% tùy danh mục sản phẩm. Xem chi tiết tại: https://affiliate.shopee.vn

### Q: Rate limit là gì và ảnh hưởng như thế nào?

**A:** Rate limit là giới hạn số request/thời gian:
- **Tiki API:** 1 request / 3 giây
- **TinyURL:** 1 request / 60 giây  
- **is.gd:** 1 request / 30 giây

Extension tự động xử lý và chờ nếu vượt limit. User không cần làm gì.

### Q: Link rút gọn có hết hạn không?

**A:** TinyURL và is.gd links không hết hạn. Tuy nhiên, nếu service ngừng hoạt động, link sẽ không dùng được. Extension sẽ fallback sang link gốc nếu shortener fails.

## Cập nhật

### Version 2.3.0 (2026-05-19)

**Tính năng mới:**
- ✅ Tự động tìm sản phẩm hot trên Shopee
- ✅ Tạo affiliate link với Shopee Affiliate ID
- ✅ Hiển thị 5 sản phẩm liên quan trong panel tóm tắt
- ✅ Loading skeleton khi đang tìm sản phẩm
- ✅ Responsive design cho mobile

**UI/UX Improvements:**
- ✅ Cải thiện contrast ratio (WCAG AA compliant)
- ✅ Thêm tooltips cho các settings
- ✅ Responsive panel cho mobile/tablet
- ✅ Loading states với progress indicator
- ✅ Better error messages

## Liên hệ & Hỗ trợ

- **GitHub Issues:** https://github.com/anlvdt/fb-post-summarizer/issues
- **Email:** anlvdt@gmail.com
- **Facebook:** [Your Facebook Page]

## License

MIT License - Free to use

---

**Lưu ý:** Tính năng này tuân thủ chính sách của Shopee Affiliate Program. Vui lòng đọc kỹ điều khoản sử dụng tại https://affiliate.shopee.vn/terms
