# Bộ đánh giá tiêu đề FeedWriter

`cases.json` chứa 10 nguồn giả định, không dùng dữ liệu cá nhân. Mỗi mẫu có góc chính, fact phụ, mức chắc chắn, thành phần bắt buộc, điều không được khẳng định và tiêu đề tham chiếu. Tiêu đề tham chiếu không phải chuỗi đáp án duy nhất.

Để đo baseline và bản sửa, chạy cùng cấu hình provider/tone/prompt trên 10 `source`; lưu tiêu đề thực tế và thời gian xử lý vào `runs/<name>.json` theo mẫu `[{"id":"release-short","provider":"stub-or-provider","tone":"default","headline":"...","latency_ms":123,"reviewers":[{"fact":true,"certainty":true,"complete":true,"concise":true,"natural":true},{"fact":true,"certainty":true,"complete":true,"concise":true,"natural":true}]}]`. Hai người đọc chấm độc lập từng tiêu chí. Ghi chú lý do khi một tiêu chí false. Không dùng lời gọi API trả phí trong CI.

Chạy `node benchmarks/headlines/score.mjs runs/<name>.json` để kiểm tra đủ mẫu, in tỷ lệ từng tiêu chí, tỷ lệ cả hai người chấm nhận tiêu đề rõ và gọn, và các ca cần xử lý. Không chấp nhận tiêu đề bịa fact/số, đổi mức chắc chắn hoặc thiếu chủ thể/chủ điểm dù tiêu đề nghe tự nhiên. Mục tiêu 90% rõ và gọn là mục tiêu đề xuất trong plan; chỉ chốt sau khi đo baseline thực tế.
