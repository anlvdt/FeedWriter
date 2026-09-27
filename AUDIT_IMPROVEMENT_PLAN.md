# FeedWriter — kế hoạch cải tiến từ audit ứng dụng và tiêu đề

Ngày lập: 2026-09-23. Mốc nguồn: commit `2b25434707c531fbf7c89ca5198938c52592cd22`.

Kế hoạch này hợp nhất [audit ứng dụng](/Users/anle/security-audit-skill/FeedWriter/run-1/REPORT.md) và phần audit khả năng viết tiêu đề trong cùng báo cáo. Audit dựa chủ yếu vào mã nguồn; 18 lỗi ứng dụng là các đường mã có điều kiện gây lỗi, còn chất lượng tiêu đề và các dẫn mối bảo mật chưa được đo bằng trình duyệt hoặc bộ mẫu thực tế. Vì vậy mỗi mục dưới đây tách rõ **sửa lỗi đã thấy trong mã** với **đo/kiểm chứng trước khi quyết định sửa**. Không coi việc pass kiểm tra cú pháp là bằng chứng hành vi đúng.

## Kết quả cần đạt

1. Cập nhật extension không làm giảm tập API key còn dùng được, không ghi đè lịch sử mới khi Undo, và hủy tác vụ luôn giải phóng trạng thái UI.
2. Nội dung được tóm tắt gắn đúng bài và nguồn. Bản nháp đăng bài chỉ chứa ảnh người dùng đã chọn, đủ text/ảnh trước khi báo sẵn sàng, và có đường phục hồi khi handoff lỗi.
3. Tiêu đề chọn đúng **một góc tin chính** và nêu đủ chủ thể, hành động/thay đổi, kết quả hoặc tác động cần thiết để hiểu góc đó. Các fact phụ nằm ở lead/thân bài. Tiêu đề gọn nhờ biên tập, không nhờ cắt số từ làm mất nghĩa.
4. Mỗi lỗi có ca hồi quy ở tầng thích hợp; luồng phụ thuộc DOM có fixture hoặc kiểm thử trình duyệt. File runtime sinh ra luôn khớp source trước khi phát hành.
5. Năm dẫn mối bảo mật chỉ được phân loại sau khi có bằng chứng từ fixture an toàn hoặc thông tin cấu hình; chưa gán severity từ audit hiện tại.

## Quy ước ưu tiên và thứ tự

| Mức | Nghĩa | Nhóm |
|---|---|---|
| P0 | Có thể mất dữ liệu/khóa hoặc lặng lẽ tạo bản nháp sai | Key migration, Undo history, ảnh bỏ chọn, source metadata |
| P1 | Chặn chức năng, báo thành công sai, hoặc chất lượng đầu ra cốt lõi | Hủy summary, DOM resolver, handoff, editor/media, tiêu đề |
| P2 | Lỗi cục bộ hoặc cải thiện tính rõ ràng | Cài đặt, dịch, tooltip, link, deploy script |

Thứ tự khuyến nghị: **nền kiểm chứng → bảo toàn dữ liệu → vòng đời summary/trích xuất → bản nháp đăng bài → tiêu đề → dịch/cài đặt → bảo mật/đóng gói**. Có thể làm song song các nhóm không sửa cùng file; các thay đổi vào `background.js`, `popup.js`, `content.js` nên đi theo PR nhỏ để tránh xung đột.

## Giai đoạn 0 — khóa baseline và bổ sung khả năng kiểm chứng

**Phạm vi.** Ghi lại đầu ra của `npm run test:all` trên môi trường có thể chạy mã ứng dụng trong sandbox đạt đủ giới hạn; CI Ubuntu hiện có là điểm bắt đầu cho unit tests. Dùng profile Chrome riêng với dữ liệu giả cho browser tests, không gọi API trả phí, không đăng bài thật. Lưu ít nhất một fixture DOM cho mỗi platform và phiên bản màn hình cần kiểm tra. Không sao chép cookie, khóa hoặc nội dung người dùng vào fixture. Tạo bảng mapping từ các mục A01–A19/H01–H04 bên dưới tới test/fixture và trạng thái `passed / failed / unverified`.

**Đầu ra.** Baseline CI và checklist browser có thể lặp lại; nếu môi trường hiện tại chưa áp được giới hạn bộ nhớ, chạy kiểm thử động trong container/CI phù hợp và giữ trạng thái `unverified` ở máy này. Không sửa hành vi sản phẩm trong PR baseline.

**Điều kiện xong.** Ba lệnh `verify:dom`, `verify:composer`, `verify:sw` và suite Node được ghi nhận; browser profile riêng chứng minh ít nhất một luồng tóm tắt, dịch và chuẩn bị bản nháp với provider stub. Mỗi ca không chạy được ghi lý do cụ thể.

## Giai đoạn 1 — bảo toàn key, lịch sử và cài đặt

### A01–A02 · Hợp nhất API key an toàn (P0)

- **Nguồn:** `popup.js:683-726`, `background.js:118-142`, `bg-api.js:180-207`.
- **Thiết kế:** một hàm hợp nhất thuần theo từng provider nhận `local.apiKeys`, `sync.apiKeys`, và `sync.apiKey` cũ; chỉ dùng `local.backupApiKeys` để phục hồi khi primary rỗng/không có, tránh tự khôi phục key người dùng đã cố ý xóa. Chuẩn hóa chỉ các provider được hỗ trợ, loại key rỗng/trùng, giữ thứ tự ổn định. Popup và worker dùng cùng thuật toán; `backupApiKeys` không được bị thay bằng tập rỗng khi backup còn key và primary chưa có key. Ghi local thành công, đọc lại/kiểm tra tập key không suy giảm, rồi mới xóa bản sync cũ. Nếu bất kỳ bước nào lỗi, giữ bản cũ để thử lại. Không log giá trị key.
- **Hồi quy:** local A + sync B; local rỗng + backup A + sync `{}`; legacy `apiKey`; nhiều provider; duplicate; lỗi khi ghi local hoặc xóa sync; migration chạy lại hai lần phải cho cùng kết quả. Tất cả fixture dùng khóa giả.
- **Điều kiện xong:** không có fixture nào làm mất key hợp lệ; popup và worker cùng nhìn thấy một tập key sau migration; xóa sync chỉ xảy ra sau khi bản local được xác nhận.

### A07 · Undo lịch sử không làm mất bản ghi mới (P0)

- **Nguồn:** `popup.js:1485-1517`, `background.js:3128-3162`.
- **Thiết kế:** Clear lưu snapshot cùng mốc/ID thao tác. Undo hợp nhất snapshot với các entry được tạo sau Clear, không `set({history: snapshot})` mù. Dùng cùng hàng đợi hoặc cơ chế cập nhật tuần tự cho thao tác lịch sử ở popup/worker; nếu không thể dùng một hàng đợi xuyên context, đọc lại và hợp nhất theo ID ổn định ngay trước ghi, xử lý xung đột rõ ràng. Giữ giới hạn `HISTORY_MAX_ITEMS/BYTES`.
- **Hồi quy:** Clear → summary mới → Undo; Clear → Undo không có entry mới; hai summary đồng thời; backup hết hạn; popup đóng/mở lại. Không nhân đôi bản ghi.
- **Điều kiện xong:** Undo phục hồi bản cũ và giữ bản mới; thao tác hết hạn không khôi phục ngoài ý muốn.

### A09 · Đọc đúng cài đặt đã tắt (P2)

- **Nguồn:** `popup.html:100`, `popup.js:445-461`, `:509`.
- **Thiết kế:** mọi checkbox được gán tường minh từ giá trị lưu, đặc biệt `enableUnicodeBold=false`; không phụ thuộc trạng thái `checked` mặc định của HTML. Kiểm tra thêm backup/restore có bao gồm các setting đang hoạt động như `autoSummarize`, `autoShortenLinks`, `modelOverrides` trước khi đổi schema.
- **Hồi quy:** lưu false → mở lại popup → lưu setting khác → false vẫn giữ; backup/restore giữ đầy đủ các setting đã chọn.
- **Điều kiện xong:** giao diện và storage khớp sau reload, không có giá trị bị đảo khi lưu mục không liên quan.

## Giai đoạn 2 — vòng đời tóm tắt và nhận dạng bài

### A03 · Hủy một yêu cầu phải kết thúc đúng một lần (P1)

- **Nguồn:** `content.js:1824-1839`, `:3413-3425`, `:3713-3726`, `:4939-4942`.
- **Thiết kế:** giữ `requestId`/finalizer cho mỗi lần summary. Stop, Close, disconnect, timeout, lỗi và `done` đều đi qua một hàm settle idempotent; clear timer/port, rồi mới cập nhật `isSummarizing`/UI. Callback cũ không được ghi lên overlay của request mới.
- **Hồi quy:** Stop trước token, Stop sau token, Close, worker disconnect, timeout, Stop rồi tóm tắt lại ngay, `done` đến sát Stop.
- **Điều kiện xong:** Promise luôn settle; `aria-busy` được gỡ; request mới không nhận chunk của request cũ.

### A04–A05–A15 · Một nhận dạng post dùng chung cho scan, metadata, ảnh (P0/P1)

- **Nguồn:** `content-dom.js:450-473`, `:1593-1605`, `:2046-2164`; `content.js:843-865`, `:5345-5396`.
- **Thiết kế:** resolver trả về container theo platform mà cả scanner và extractor chấp nhận. Khi không có container, extractor trả kết quả rỗng có dấu hiệu kiểm tra được, không dereference null. Cache metadata/permalink/author/ảnh dùng post identity hoặc stamp; khi DOM node đổi identity phải invalidation đồng bộ. Reddit chỉ đánh dấu `fbsScanned` sau khi body đủ điều kiện và nút mount thành công; observer dùng cùng tập selector với scanner.
- **Hồi quy:** DOM fixture Facebook/Threads/LinkedIn/X/Reddit; container thiếu ancestor; Reddit shell được hydrate sau; cùng node đổi bài trong 90 giây; một bài có hai khối nội dung; card khác trên trang permalink. Test phải kiểm tra cả text và nguồn, không chỉ việc nút xuất hiện.
- **Điều kiện xong:** không crash; bài hydrate muộn vẫn có nút; tóm tắt bài mới không dùng author/link/ngày của bài cũ.

### A19 · Thống nhất text đầu vào cho các cách tóm tắt (P1)

Phát hiện bổ sung trong audit source: inline path dùng một `textContent` đã nén whitespace, còn expanded/batch dùng extractor khác (`content.js:4924-4939`, `content-dom.js:2777-2791`). Gom về một extractor giữ ranh giới đoạn và nhiều node anh em không trùng lặp; xử lý share gồm lời dẫn và nội dung gốc theo chính sách rõ ràng. Kiểm tra cùng post ở inline, expanded và batch cho cùng tập fact đầu vào. Không cần ép output AI giống hệt nhau.

## Giai đoạn 3 — bản nháp và handoff đăng bài

### A06 · Tôn trọng chính xác ảnh được chọn (P0)

- **Nguồn:** `post-data.js:21-33`, `content-composer.js:667-716`.
- **Thiết kế:** `allImages === undefined` mới được fallback sang ảnh chính; `[]` nghĩa là không chọn ảnh. Nếu đã có mảng chọn, không tự thêm `imageUrl`. Chuẩn hóa/trừ trùng rồi mới giới hạn số ảnh; hiển thị đúng số ảnh sẽ gửi.
- **Hồi quy:** chọn tất cả, bỏ ảnh đầu, bỏ mọi ảnh, chỉ chọn ảnh thứ hai, trùng URL, hơn 10 ảnh.
- **Điều kiện xong:** danh sách ảnh trong `PostData`, pending storage và composer đích bằng đúng lựa chọn hợp lệ của người dùng.

### A10–A11–A12 · Chỉ báo sẵn sàng khi bản nháp thực sự đủ (P1)

- **Nguồn:** `poster-reddit.js:78-101`, `poster-facebook.js:70-99`, `dom-helpers.js:95-119`, `content-composer.js:1127-1189`.
- **Thiết kế:** adapter trả kết quả có `textInserted`, `requestedImages`, `attachedImages`, `failedImages`, `needsManualPublish`. Reddit tìm editor thuộc đúng composer, kiểm tra editor tồn tại và text được chèn; không chọn phần tử thứ ba theo thứ tự document. Hàm dán chunk trả Promise chỉ resolve sau chunk cuối; ảnh bắt đầu sau text. Không nuốt lỗi ảnh một phần: người dùng thấy ảnh nào thiếu và có quyền tiếp tục không ảnh/ít ảnh hoặc thử lại. Không đánh dấu pending hoàn tất trước khi trạng thái bản nháp rõ ràng.
- **Hồi quy:** 0/1/2/nhiều editor; editor sai dialog; 28.000 ký tự + ảnh; download 0/một phần/toàn bộ; user đóng overlay trong lúc chờ; refresh sau lỗi. Kiểm tra thứ tự DOM events, text cuối và số ảnh được đính kèm.
- **Điều kiện xong:** không có `ok:true` khi body rỗng ngoài chủ ý; UI không hiện “sẵn sàng” khi text/ảnh đang xử lý hoặc thiếu ảnh mà chưa được chấp nhận.

### A13–A14 · Handoff có thể phục hồi và nguồn đúng (P1/P2)

- **Nguồn:** `content.js:5627-5678`, `content-composer.js:385-400`.
- **Thiết kế:** token pending chỉ xóa sau ACK thành công. Tách trạng thái `not_prepared / prepared / acknowledged` để reload sau lỗi ACK không dán lại text/ảnh. Giới hạn một consumer đang claim token; xử lý mở hai tab và token hết hạn. Chuẩn hóa URL Facebook theo loại: giữ `fbid`, `v`, `story_fbid/id` và các tham số thật sự định danh, bỏ tracking; dùng một helper giữa extraction và composer.
- **Hồi quy:** ACK lỗi rồi reload; hai tab cùng token; token hết hạn; `photo.php?fbid=123`, `watch?v=123`, group permalink; URL có tracking.
- **Điều kiện xong:** retry không làm mất token hoặc dán trùng; link nguồn sau chuẩn hóa vẫn mở đúng bài.

## Giai đoạn 4 — tiêu đề: đo trước, sửa có bằng chứng

### H01 · Tạo bộ đánh giá nguồn → tiêu đề (P1, làm trước H02–H04)

- **Nguồn hiện tại:** `bg-prompts.js:5-23`, `background.js:1902-1922`, `:2022-2127`, `tests/headline-guard.test.mjs`.
- **Dữ liệu:** bộ mẫu nhỏ nhưng đa dạng, loại bỏ dữ liệu riêng tư. Mỗi mẫu có `source`, `key_fact` (góc chính), `supporting_facts`, `certainty` (xác nhận/tin đồn/trải nghiệm), `must_keep` (chủ thể, hành động, kết quả, số liệu/điều kiện nếu thiết yếu), `must_not_claim`, một hoặc vài tiêu đề tham chiếu và lý do. Gồm tin ngắn/dài, hai fact cạnh tranh, giá/số liệu, ngày, bug tác động, tin đồn, post cá nhân, bài thiếu tên chủ thể, thuật ngữ CNTT, bài có shared content.
- **Chấm:** tách 5 tiêu chí: đúng fact; giữ mức chắc chắn; đủ thông tin cho góc đã chọn; gọn/không lặp; tự nhiên và không clickbait. Dùng đánh giá người đọc độc lập trên cùng mẫu; ghi lỗi theo nhóm, độ dài tiêu đề và provider/tone. Không so khớp chuỗi với một tiêu đề mẫu duy nhất.
- **Baseline/điều kiện xong:** đo trước khi thay đổi prompt; tất cả mẫu có nhãn nguồn và lý do; thống kê pass theo từng tiêu chí và ví dụ lỗi đại diện. Chưa đặt ngưỡng từ cứng làm điều kiện đạt.

### H02 · Rút prompt theo tiêu chí rõ, không lặp chỉ dẫn (P1)

Prompt hiện lặp nhiều quy tắc về hook, một ý, tính xác thực ở template và invariant. Sau baseline, đặt thứ tự: (1) fact và mức chắc chắn; (2) góc chính/chủ thể–hành động–kết quả; (3) câu ngắn tự nhiên; (4) hook chỉ từ fact có thật. Fact phụ chuyển xuống lead. Bảo đảm custom prompt/tone không đảo thứ tự này. So sánh trước/sau bằng cùng bộ mẫu và cùng cấu hình provider; chỉ giữ sửa đổi làm giảm lỗi có chứng cứ, không dựa vào cảm giác một vài ví dụ.

### H03 · Guardrail chỉ xử lý lỗi có thể xác định (P1)

`clampHeadlineWords` hiện nhận `MAX_HEADLINE_WORDS=16` nhưng cố ý không áp trần cứng vì từng cắt dở cụm. Giữ nguyên nguyên tắc đó. Tách tên hàm phản ánh đúng chức năng (loại đuôi dang dở), bỏ tham số/hằng gây hiểu lầm nếu không dùng. Bổ sung kiểm tra có giới hạn cho tiêu đề rỗng/thiếu chủ thể, đuôi dang dở, cụm clickbait và số liệu không có trong nguồn. Trường hợp không thể sửa cơ học mà vẫn chắc nghĩa phải **đánh dấu cần viết lại**, không tự cắt hoặc tự khẳng định fact. Nếu dùng một lần viết lại bằng AI, giới hạn số lần và có fallback cho người dùng; đo chi phí/độ trễ bằng stub trước. Test cả tiêu đề hợp lệ dài hơn 16 từ để tránh regression.

### H04 · Chốt tiêu chí chất lượng (P1)

Trên bộ mẫu H01, không mẫu nào được chấp nhận nếu bịa số liệu, đổi mức chắc chắn, mất chủ thể hoặc cắt dở kết quả thiết yếu. Mục tiêu biên tập đề xuất: ít nhất 90% tiêu đề được cả hai người chấm nhận là rõ và gọn; mẫu không đạt vẫn hiển thị cảnh báo/sửa tay thay vì bị gọi là “good”. Báo cáo riêng kết quả từng tone/provider và thời gian xử lý. Con số 90% là **mục tiêu cần phê chuẩn bằng baseline**, không phải chất lượng đã quan sát hay bảo đảm tuyệt đối.

**Phụ thuộc quan trọng:** H01 cần nguồn đầu vào đúng từ giai đoạn 2. Nếu extractor thiếu fact, không thể giải quyết đầy đủ tiêu đề bằng prompt.

## Giai đoạn 5 — dịch, settings và đóng gói

| ID | Việc | Tệp chính | Kiểm chứng xong |
|---|---|---|---|
| A08 | Bỏ việc cắt 24.000 ký tự ở popup hoặc truyền cờ `truncated` đáng tin; hiển thị phạm vi đã dịch | `popup.js`, `background.js` | Trang >24.000 ký tự hiện cảnh báo đúng; phần được dịch xác định rõ |
| A16 | Phân biệt chữ hoa/thường trong key cache khi nghĩa có thể khác (`US`/`us`) | `background.js` | Hai đầu vào không trả lẫn `word`/bản dịch; cache cùng đầu vào vẫn hit |
| A17 | Scroll trong tooltip không tự đóng tooltip; scroll trang vẫn đóng nếu phù hợp UX | `translate.js`, `translate.css` | Dịch dài có thể cuộn đến cuối; ngoài tooltip vẫn hành xử như thiết kế |
| A18 | `sync-local.sh` build/verify cả ba runtime, bỏ `|| true`, chỉ báo success khi toàn bộ bước đạt | `scripts/sync-local.sh` | Cố ý làm stale một runtime hoặc build lỗi thì script fail và không báo synced thành công |

## Giai đoạn 6 — xác minh các dẫn mối bảo mật

Các mục S01–S05 ở [NEEDS-VALIDATION](/Users/anle/security-audit-skill/FeedWriter/run-1/NEEDS-VALIDATION.md) **chưa là lỗ hổng xác nhận**. Dùng fixture giả và sandbox có đủ chặn mạng ngoài, giới hạn CPU/bộ nhớ/disk/thời gian. Phân loại `confirmed / refuted / unresolved` trước khi quyết định sửa; không gọi provider trả phí hoặc endpoint đang dùng thật.

| ID | Giả thuyết | Bước quyết định | Sửa nếu được xác nhận |
|---|---|---|---|
| S01 | Trang phát `dblclick` giả để gọi dịch dùng quota | Trang fixture chọn chữ và dispatch event; stub đếm yêu cầu | Chỉ nhận tương tác thật, có hạn mức/cooldown ở cầu nối đáng tin |
| S02 | Đọc response không giới hạn trước khi slice; timeout dừng ở headers | Local streaming body thiếu `Content-Length`, đo byte đã đọc và thời điểm abort | Đọc stream có trần byte và deadline tới hết body |
| S03 | Đổi tab giữa identity check và screenshot | Hai tab dummy, chuyển tab có kiểm soát | Kiểm tra identity sau capture hoặc dùng API gắn với tab |
| S04 | Tên miền public resolve vào mạng riêng khi enrich | DNS/loopback fixture cô lập, xem browser policy và redirect | Chặn địa chỉ đích cuối/giới hạn domain theo nhu cầu nếu đường mạng thực sự mở |
| S05 | Lỗi `setAccessLevel` để lộ khóa ở context không tin cậy | Mock lỗi, trạng thái legacy sync, kiểm tra quyền đọc | Fail closed cho đường key, hoàn thành migration trước khi phục vụ request |

## Các cổng kiểm tra trước khi phát hành

1. `npm run build` khi đã sửa source; `npm run test:all` và ba lệnh verify trên runtime đã sinh. Không coi Node tests là thay thế browser tests.
2. Browser profile riêng: Facebook/Threads/X/LinkedIn/Reddit với fixture hoặc tài khoản thử nghiệm, kiểm tra tóm tắt, nguồn, hủy, bản nháp text/ảnh và reload sau lỗi. Dừng ở “bản nháp sẵn sàng”; không tự động đăng bài trong kiểm thử.
3. H01/H04 có báo cáo so sánh baseline và bản mới; mọi tiêu đề sai fact/mức chắc chắn hoặc thiếu góc chính đều được triage. Chấp nhận bản dài khi rút ngắn sẽ mất nghĩa, nhưng ghi nhận là chưa gọn.
4. `sync-local.sh` thử cả nhánh thành công và lỗi. Kiểm tra file runtime ở thư mục đích trùng source của commit phát hành.
5. Không đóng một hạng mục dựa trên regex test lặp lại code; test cần mô phỏng điều kiện gây lỗi và kiểm tra kết quả người dùng thấy. Ghi rõ hạng mục nào còn phụ thuộc layout trang thật hoặc cấu hình Chrome.

## Đề xuất chia PR

1. **PR dữ liệu:** A01, A02, A07, A09; nếu quá rộng, tách key migration khỏi history/settings.
2. **PR summary lifecycle:** A03.
3. **PR extraction:** A04, A05, A15, A19.
4. **PR chọn ảnh:** A06.
5. **PR handoff/composer:** A10–A14, tách Reddit editor và Facebook paste/media nếu review khó.
6. **PR headline benchmark:** H01; chỉ thêm fixtures/rubric/baseline.
7. **PR headline behavior:** H02–H04 dựa trên kết quả H01.
8. **PR dịch và packaging:** A08, A16–A18, chia tiếp theo file để giảm xung đột.
9. **PR bảo mật:** chỉ cho S-item đã được xác minh, mỗi root cause một PR với ca tái hiện an toàn.

Mỗi PR mô tả trigger, hành vi trước/sau, kết quả test và giới hạn còn lại. Các file `service-worker.js`, `content-dom-runtime.js`, `content-composer-runtime.js` được sinh từ source tương ứng; sửa source rồi build, không chỉnh bundle bằng tay.
