# Quản lý bàn và QR riêng — 22/10/2026

## Chủ quán thao tác

1. Mở **Mã QR & Sơ đồ bàn** tại `/dashboard/qr-studio`, tới phần **Quản lý bàn**.
2. Tạo bàn với tên, mã (có thể sinh tự động), khu vực và sức chứa. Owner/admin được chỉnh sửa; nhân viên không có quyền quản lý chỉ xem.
3. Chọn bàn để xem standee, sao chép/mở link hoặc tải PNG. URL QR quản lý chứa ID bàn ổn định kèm chữ ký HMAC do server tạo, gắn chặt với cặp `shop/table` (`/s/{slug}/menu?src=table&tableId={id}&sig={qr_sig}`), tên/mã/khu vực hiển thị trên standee. Danh sách bàn public (`GET /api/tables` không có cờ quản lý, hoặc bundle storefront) tuyệt đối không trả về chữ ký `qr_sig`. QR Cửa và QR menu chung vẫn được giữ.
4. Đổi tên không làm mất liên kết QR hoặc chữ ký (vì chữ ký tính trên `shop_id` và `table_id`). Khi tạm ngưng hoặc lưu trữ, bàn không nhận đơn mới; đơn cũ và số tiền vẫn giữ để xử lý tiếp. Lưu trữ thay cho xóa vĩnh viễn; có thể khôi phục rồi bật phục vụ lại.
5. **Khóa ký `SESSION_SECRET`:** Khuyến nghị cấu hình `SESSION_SECRET` ổn định trên production (tối thiểu 16 ký tự). Việc đổi `SESSION_SECRET` sẽ làm mất hiệu lực toàn bộ chữ ký trên các mã QR bàn đã in và bắt buộc phải xuất/in lại bảng QR.

Tính năng quản lý bàn này nằm trên web. Mobile vẫn đọc và xử lý đơn theo contract tương thích; chưa có màn hình CRUD bàn native mới.

## Khách quét QR

Link riêng của từng bàn có dạng `/s/{slug}/menu?src=table&tableId={id}&sig={qr_sig}`. Menu chỉ tự chọn và khóa đúng bàn khi bàn đang hoạt động trong quán đó **và** chữ ký `sig` hợp lệ (`GET /api/shops?slug=...&tableId=...&sig=...` trả về `tableQrVerified: true`). Mọi đơn gọi tại bàn ẩn danh (`POST /api/orders`) bắt buộc phải kèm chữ ký HMAC hợp lệ (`table_qr_sig`) cho đúng cặp `shop_id + table_id` kể cả khi client bỏ cờ `qr_table_mode`; mọi hành vi sửa `tableId`, xóa hoặc làm sai lệch chữ ký đều bị server từ chối (`MISSING_TABLE_QR_SIGNATURE` / `INVALID_TABLE_QR_SIGNATURE`) trước khi trừ kho và hiển thị thông báo lỗi đã bản địa hóa theo ngôn ngữ khách đang xem. Khi khách tự sửa đơn trước khi quầy tiếp nhận (`PATCH /api/orders` bằng `trackingToken`), đơn giữ nguyên bàn hiện tại hoặc bắt buộc chứng minh `table_qr_sig` hợp lệ nếu đổi sang bàn khác.

QR Cửa (`/s/{slug}?src=door`), QR menu chung hoặc link bàn thiếu/sai chữ ký không khóa menu và không cho phép tự chọn bàn bất kỳ; khách vẫn xem thực đơn bình thường, có thể chọn **Mang về** hoặc quét lại đúng mã QR đặt tại bàn để gọi món tại bàn. Nhân viên/chủ quán đã xác thực tại quầy POS (`orders.create`) vẫn tạo và điều chỉnh đơn theo bàn bình thường mà không cần chữ ký QR khách.

Link sai, bàn khác quán, thiếu chữ ký hoặc đã tạm ngưng/lưu trữ hiện thông báo và hướng dẫn chọn **Mang về** hoặc quét lại QR tại bàn. Khi gửi đơn, server xác minh ID bàn, chữ ký HMAC và lấy tên chuẩn để lưu snapshot; không tin tên bàn do client gửi kèm ID.

Link cũ `?table=` có thể resolve bằng tên/mã bàn đang cấu hình. Đơn legacy không có ID vẫn đọc được và tách khỏi nhóm bàn quản lý; không lấy tên trùng làm bằng chứng là cùng một bàn.

## Báo cáo

Mở `/dashboard/reports`, chọn **Theo bàn**. Bộ lọc ngày theo giờ Việt Nam, trạng thái đơn, thanh toán, source và tìm kiếm tác động lên số liệu. Muốn thấy đơn hủy thì chọn bộ lọc có gồm đơn hủy.

- Số đơn và doanh thu đã thu là hai chỉ số riêng.
- Doanh thu đã thu chỉ gồm paid và không hủy; unpaid, refunded và cancelled hiển thị riêng.
- Cùng ID bàn tiếp tục gộp sau đổi tên/lưu trữ; tên trên từng đơn giữ nguyên tại thời điểm tạo.
- Mang về và đơn legacy có nhóm riêng; export theo bàn dùng cùng dữ liệu đang lọc.

## Schema và kiểm chứng

Cần áp dụng `supabase/migrations/007_shop_tables.sql` sau migration 006 trước khi triển khai source mới. Migration thêm `shop_tables`, `orders.table_id`, RLS/indexes/triggers và mở rộng RPC; không chạy migration thật trong lượt phát triển này.

Xem [review độc lập của Codex](CODEX_TABLES_REVIEW.md) cho lệnh test và giới hạn. Kiểm thử dùng PGlite/fixtures và render component thực; chưa xác minh thao tác trình duyệt, quét camera hoặc máy in phần cứng trong lượt này.
