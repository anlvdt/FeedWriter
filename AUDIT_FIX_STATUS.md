# FeedWriter — trạng thái triển khai kế hoạch audit

Ngày cập nhật: 2026-09-23. Đối chiếu với `AUDIT_IMPROVEMENT_PLAN.md`. `Implemented` nghĩa là đã sửa trong mã và có kiểm thử chỉ định; **không** đồng nghĩa đã kiểm thử trên website thật hoặc đo đầu ra AI thật.

| ID | Trạng thái | Bằng chứng / giới hạn |
|---|---|---|
| A01–A02 | Implemented | Migration chung cho popup và worker; hợp nhất local/sync/legacy, xác nhận ghi local rồi mới xóa sync. `tests/api-key-store.test.mjs`; `tests/extension-smoke.py` xác nhận migration sau restart với key giả. Chưa thử trên profile có key thật. |
| A03 | Implemented, live unverified | Stop/Close settle Promise, dọn timer/port; request cũ không ghi lên request mới. `tests/summary-cancel.test.mjs`, `tests/x-screenshot.test.mjs`. Chưa chạy provider streaming thật. |
| A04–A05, A15, A19 | Implemented, live unverified | Resolver thêm container các nền tảng; cache metadata theo dấu bài; Reddit hydrate muộn; inline và batch dùng `extractPostContent`. `tests/browser-fixture.py` kiểm tra DOM giả Facebook/X/Threads/LinkedIn/Reddit. Layout website thật có thể thay đổi. |
| A06 | Implemented | `[]` là không ảnh, checkbox dùng được cả khi chỉ có một ảnh; không tự thêm lại ảnh chính. `tests/history-and-selection.test.mjs`. |
| A07 | Implemented | Clear/Undo/save đi qua hàng đợi service worker, giữ bản ghi mới và ID bản cũ. `tests/history-and-selection.test.mjs`. |
| A08 | Implemented | Popup truyền toàn bộ text; worker giới hạn 24.000 ký tự và trả `truncated`. `tests/translate-scope.test.mjs`. |
| A09 | Implemented | Checkbox Unicode Bold đọc tường minh; backup chứa auto settings và model overrides. `tests/settings-backup.test.mjs`. |
| A10–A12 | Implemented, live unverified | Reddit từ chối khi editor mơ hồ/trống; upload ảnh thiếu báo lỗi; paste Facebook chờ mọi chunk và ảnh trước khi báo sẵn sàng. `tests/browser-fixture.py` kiểm tra Reddit 0/1/2 editor và paste 28.000 ký tự + ảnh. Chưa kiểm tra tốc độ render ảnh và UI composer thật trên mọi nền tảng. |
| A13–A14 | Implemented, live unverified | Pending token chỉ xóa sau ACK; claim theo tab; prepared draft không dán trùng trên cùng trang, composer rỗng sau reload được điền lại; URL Facebook dùng chung `cleanSourceUrl`. `tests/pending-handoff.test.mjs`, `tests/url-clean.test.mjs`. Chưa kiểm thử đồng thời hai tab Chrome thật. |
| A16–A17 | Implemented | Cache dịch phân biệt hoa/thường; cuộn trong tooltip không đóng tooltip. `tests/translate-scope.test.mjs`, `tests/browser-fixture.py`. |
| A18 | Implemented | `sync-local.sh` verify ba bundle trước và sau sync; nhánh thành công và nhánh stale được chạy trong thư mục tạm. |
| H01 | Prepared, baseline pending | `benchmarks/headlines/cases.json` có 10 nguồn giả định và rubric; `score.mjs` tính kết quả của hai người chấm. Chưa chạy model để lấy baseline. |
| H02, H04 | Pending | Theo thứ tự của plan, chỉ chỉnh prompt/chốt ngưỡng sau khi có cùng bộ đầu ra từ provider/tone và chấm độc lập. Không gọi API trả phí hoặc tự nhận chất lượng 90% khi chưa đo. |
| H03 | Partially implemented | Bỏ tên/trần 16 từ gây hiểu lầm, giữ câu dài đủ nghĩa; cảnh báo số không có trong nguồn, tiêu đề rỗng và clickbait. `tests/headline-guard.test.mjs`. Chưa có kiểm tra ngữ nghĩa tự động đủ tin cậy để chứng nhận mọi tiêu đề đúng fact. |
| S01 | Confirmed/fixed in fixture | Double-click giả bị chặn bằng `isTrusted`; fixture Chrome offline xác nhận không gọi dịch. Hạn mức/cooldown của bridge vẫn cần cân nhắc riêng nếu phát hiện lạm dụng bằng thao tác thật. |
| S02 | Confirmed/fixed in fixture | Đọc HTML theo stream có trần byte và deadline thân response. `tests/limited-response.test.mjs`. |
| S03 | Mitigated, live unverified | Kiểm tra lại active tab sau `captureVisibleTab`; chưa tái hiện chuyển tab giữa hai thời điểm trong Chrome thật. |
| S04 | Confirmed/mitigated in isolated fixture | Chromium với hostname công khai được map vào HTTPS loopback đã tạo 1 request trước sửa. Sau sửa, metadata chỉ tự tải từ host nguồn được phép (`github.com`, `gitlab.com`, `arxiv.org`, `www.arxiv.org`), cổng HTTPS chuẩn và redirect trong cùng danh sách; chạy lại fixture cho 0 request loopback. `tests/enrichment-fetch.test.mjs` kiểm tra host giả, cổng lạ và redirect. Link trực tiếp của các host khác vẫn xuất hiện, chỉ bỏ metadata tự tải. Không bảo vệ trường hợp DNS của chính host được phép bị kiểm soát ở tầng mạng. |
| S05 | Confirmed/fixed in isolated extension | Khóa `storage.local` và `storage.sync` cho trusted context trước migration/đọc key; content script đọc setting qua allowlist message. `tests/key-access-boundary.test.mjs`, `tests/extension-smoke.py`: content script bị từ chối đọc cả hai kho, không nhận sự kiện thay đổi key; bridge trả setting allowlist; migration từ sync sau restart thành công với key giả. Chưa thử profile có key thật. |

## Cổng kiểm tra

- `npm run build` sinh ba bundle từ source; `npm run test:all` kiểm tra cú pháp, bundle và Node suite.
- `npm run test:browser-fixture` dùng profile Chrome tạm với HTML offline, không đăng bài hoặc gọi provider. Cần Python Playwright và Chrome/Chromium; có thể đặt `FEEDWRITER_TEST_CHROME`.
- `npm run test:extension-smoke` nạp extension thực trong Chromium Playwright với profile tạm và key giả; xác nhận service worker, popup, cách ly storage, setting bridge, chặn rút gọn link chưa được opt-in, dọn bản sao lịch sử sau restart và migration key. Cần Python Playwright cùng Chromium do Playwright cài đặt (`python3 -m playwright install chromium`). Không truy cập provider hoặc website thật.
- `.github/workflows/ci.yml` chạy cả Node suite và hai fixture Chromium trong CI.
- Bản Google Chrome cài trên máy không khởi động extension qua cờ `--load-extension`; kiểm thử extension dùng Chromium Playwright với `channel="chromium"`.
- `git diff --check` phải sạch. `scripts/sync-local.sh` đã được thử với bundle đúng và bundle stale trong thư mục tạm.

## Việc cần môi trường ngoài fixture

1. Chạy profile extension riêng trên layout Facebook/Threads/X/LinkedIn/Reddit hiện tại, dùng post giả và provider stub; dừng ở bản nháp, không bấm đăng.
2. Thu output của cùng 10 ca tiêu đề với provider/tone cố định, ghi vào `benchmarks/headlines/runs/*.json`, để hai người chấm độc lập; sau đó mới quyết định thay prompt H02 và chốt H04.
3. Thử chuyển tab đúng lúc screenshot S03. S04 đã qua fixture DNS/loopback cô lập; S05 đã qua smoke test sau restart với profile/key giả. Cần xác nhận trên cấu hình dùng thật trước phát hành.

## Sửa bổ sung sau lần audit lại

| Mục | Trạng thái | Bằng chứng / giới hạn |
|---|---|---|
| R01 · Xóa lịch sử | Implemented | Worker tạo alarm 30 giây cho `historyBackup`, dọn khi alarm chạy và đối chiếu lại khi khởi động; nếu không tạo được alarm thì xóa bản sao ngay và popup không hứa hoàn tác. `tests/history-and-selection.test.mjs`, `tests/extension-smoke.py`. Alarm Chrome có thể chạy trễ khi máy ngủ; bản sao quá hạn được dọn khi trình duyệt hoạt động lại. |
| R02 · URL nguồn qua shortener | Implemented | Thêm consent mới mặc định tắt, không dùng lại giá trị `autoShortenLinks` cũ như sự đồng ý; worker kiểm tra consent trước khi gọi dịch vụ, bản xem trước không gọi shortener. UI nêu đủ bốn dịch vụ có thể nhận URL. `tests/shortener-consent.test.mjs`, `tests/extension-smoke.py`. |
| R03 · Tải ảnh | Implemented | Đọc response theo stream với giới hạn 12 MB và deadline thân response, kể cả server không khai `Content-Length`. `tests/limited-response.test.mjs`. Chưa thử trên CDN thật với mạng chậm. |
| R04 · Nhận lại bản nháp | Implemented | Tab mới có thể nhận lại record khi tab cũ đã đóng, và `prepared` được reset để điền lại editor. Tab cũ còn tồn tại vẫn giữ claim. `tests/pending-claim.test.mjs`. Chưa kiểm thử chuyển tab thật. |
| R05 · Trạng thái ảnh khi đăng | Implemented, live unverified | Các adapter từ chối số ảnh vượt giới hạn; LinkedIn từ chối nếu tải thiếu ảnh. UI chỉ nói đã điền bản nháp và yêu cầu kiểm tra ảnh trên website trước khi bấm Đăng; khi Reddit mới chuyển sang trang soạn, UI nói đang chờ bản nháp. Số file gửi vào input không bị diễn giải là đã upload xong. `tests/media-confirmation.test.mjs`. Chưa có tín hiệu DOM upload thành công ổn định trên từng website. |
| R06 · Migration key trùng | Implemented | Loại bỏ đường migration cũ không được chờ trong `onInstalled`; chỉ dùng `FeedWriterApiKeyStore.migrate`. Kiểm thử migration chung và smoke test extension sau restart vẫn qua. |
| R07 · CI browser | Implemented | CI cài Playwright/Chromium và chạy `test:browser-fixture`, `test:extension-smoke` sau Node suite. Chưa có kết quả từ CI từ xa cho thay đổi chưa đẩy lên. |

Kiểm tra cục bộ sau sửa: `npm run test:all` đạt 364/364 bài kiểm tra; `npm run test:browser-fixture`, `npm run test:extension-smoke` và `git diff --check` đều đạt. Kết quả này chưa thay thế thử nghiệm với provider và giao diện các website thật.

## Bổ sung: đảo tác nhân trong tiêu đề/lead tiếng Việt

Ví dụ "Claude Code tắt đề xuất prompt..." được tái hiện: trước sửa, hậu xử lý cho `quality: good` dù nguồn nói người dùng tắt tùy chọn trong Claude Code. Prompt cũ lặp quy tắc đặt sản phẩm đầu câu rồi gắn động từ, làm model dễ đổi tác nhân; quy tắc viết trực tiếp cũng dễ biến nhận định cá nhân thành hành động của sản phẩm. Đã sửa chính sách tiêu đề/lead để xác định tác nhân trước khi chọn cấu trúc, thêm ví dụ đúng/sai và giữ mức chắc chắn của một người dùng. Guardrail nguồn–đầu ra nay cảnh báo `warn` cho mẫu đảo tác nhân này thay vì chứng nhận `good`; không tự viết lại câu vì phép thay thế máy móc có thể đổi nghĩa. `tests/headline-guard.test.mjs` và `tests/system-prompt.test.mjs` kiểm tra trường hợp sai, đúng và hành động thật của sản phẩm. Sau sửa, Node suite đạt 364/364. Hiệu quả sinh văn bản cần được đo với provider thật theo H01–H04.
