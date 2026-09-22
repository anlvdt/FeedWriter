# Hướng dẫn Shopee Affiliate

## Tổng quan

Khi bật Shopee Affiliate, FeedWriter chọn luân phiên một sản phẩm từ danh sách gợi ý preload, tạo link tìm kiếm Shopee kèm Affiliate ID, thử rút gọn link và chèn gợi ý mua sắm vào nội dung copy hoặc comment nguồn.

Link được cache theo ngày và theo Affiliate ID. Short-link thành công cũng được cache để hạn chế request ra dịch vụ ngoài.

## Quy trình

```text
Chọn một sản phẩm gợi ý luân phiên
    ↓
Tạo link tìm kiếm Shopee + aff_sid
    ↓
Thử rút gọn qua is.gd, v.gd, da.gd, TinyURL
    ↓
Cache short-link nếu thành công
    ↓
Chèn một gợi ý mua sắm khi copy hoặc đăng status
```

Nếu toàn bộ dịch vụ rút gọn lỗi hoặc hết thời gian chờ, FeedWriter dùng link Shopee gốc. Link dài vẫn giữ `aff_sid`.

## Cài đặt

1. Đăng ký tại <https://affiliate.shopee.vn>.
2. Mở FeedWriter và vào phần cài đặt.
3. Nhập **Shopee Affiliate ID**.
4. Bật **Tự động tìm sản phẩm Shopee liên quan**.
5. Lưu cài đặt.

Không bắt buộc nhập Affiliate ID. Khi để trống, link vẫn mở trang tìm kiếm Shopee nhưng không có tracking commission.

## Nội dung được chèn

```text
🛍️ GỢI Ý MUA SẮM:
· Sản phẩm: AirPods Pro 2 USB-C
· Link Shopee: https://is.gd/example
```

FeedWriter hiện chèn **một** gợi ý luân phiên. Đây là link tìm kiếm Shopee theo tên sản phẩm, không phải deep-link tới một shop cụ thể.

## Xử lý sự cố

### Link không được rút gọn

Nguyên nhân thường gặp:

- Dịch vụ shortener bị chặn mạng, rate limit hoặc tạm ngừng.
- Service worker của extension vừa reload.
- Dịch vụ shortener trả dữ liệu không hợp lệ.

FeedWriter tự fallback về link gốc để không làm mất link affiliate. Thử copy lại sau; kết quả short-link thành công sẽ được cache.

### Đổi Affiliate ID nhưng link vẫn cũ

Từ bản sửa này, cache link Shopee gắn với Affiliate ID. Sau khi lưu ID mới, lần tạo gợi ý tiếp theo sẽ sinh link mới.

### Link không có commission

1. Kiểm tra Affiliate ID trong cài đặt.
2. Mở link gốc và xác nhận query có `aff_sid=`.
3. Xác nhận tài khoản Affiliate đã được Shopee duyệt.
4. Liên hệ Shopee Affiliate nếu tracking vẫn không ghi nhận.

## Lưu ý

- Short-link miễn phí phụ thuộc dịch vụ bên thứ ba.
- Khi cần kiểm tra tracking, dùng `originalLink` hoặc mở short-link và kiểm tra URL đích.
- Danh sách preload là gợi ý phổ biến, chưa phân tích ngữ nghĩa theo từng bài viết.
