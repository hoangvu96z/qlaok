# Quản lý bàn, sơ đồ mặt bằng và QR riêng — 22/10/2026

## Chủ quán thao tác

1. Mở **Mã QR & Sơ đồ bàn** tại `/dashboard/qr-studio`, tới phần **Quản lý bàn**.
2. Tạo bàn với tên, mã (có thể sinh tự động), khu vực và sức chứa. Owner/admin được chỉnh sửa; nhân viên không có quyền quản lý chỉ xem.
3. Chọn bàn để xem standee, sao chép/mở link hoặc tải PNG. URL QR quản lý chứa ID bàn ổn định kèm chữ ký HMAC do server tạo, gắn chặt với cặp `shop/table` (`/s/{slug}/menu?src=table&tableId={id}&sig={qr_sig}`), tên/mã/khu vực hiển thị trên standee. Danh sách bàn public (`GET /api/tables` không có cờ quản lý, hoặc bundle storefront) tuyệt đối không trả về chữ ký `qr_sig`. QR Cửa và QR menu chung vẫn được giữ.
4. Đổi tên không làm mất liên kết QR hoặc chữ ký (vì chữ ký tính trên `shop_id` và `table_id`). Khi tạm ngưng hoặc lưu trữ, bàn không nhận đơn mới; đơn cũ và số tiền vẫn giữ để xử lý tiếp. Lưu trữ thay cho xóa vĩnh viễn; có thể khôi phục rồi bật phục vụ lại.
5. **Chế độ xem danh sách (list) và sơ đồ mặt bằng (map):**
   - Chuyển đổi linh hoạt giữa chế độ xem danh sách truyền thống và sơ đồ mặt bằng trực quan qua thanh công cụ. Khi chọn tab bàn đã lưu trữ (`archived`), giao diện tự động chuyển về chế độ danh sách.
   - Hỗ trợ bộ lọc khu vực (Tất cả hoặc từng khu vực cụ thể), bộ lọc trạng thái (hiện tại / đã lưu trữ / tất cả), và nút làm mới (refresh) dữ liệu từ server.
6. **Bố trí và di chuyển bàn trên sơ đồ:**
   - Chủ quán hoặc quản trị viên có quyền (`canManageTables`) có thể kéo-thả bàn trực tiếp trên canvas hoặc chọn bàn rồi dùng phím mũi tên (ArrowUp, ArrowDown, ArrowLeft, ArrowRight) để điều chỉnh vị trí. Mỗi lần bấm phím mũi tên di chuyển 2 điểm phần trăm (2%) theo chiều tương ứng; không có hành vi Shift+5%.
   - Tọa độ bàn là tỷ lệ phần trăm nguyên `layout_x`, `layout_y` trong khoảng `[0, 100]`. Bàn chưa được thiết lập tọa độ (giá trị `null`) hiển thị theo lưới tự động phân bổ (fallback grid, cờ `isFallback: true`) mà không tự động ghi dữ liệu vào DB.
   - Thao tác di chuyển áp dụng cơ chế cập nhật lạc quan (optimistic update): cập nhật tức thì trên giao diện, gọi `PATCH /api/tables` và tự động hoàn tác (rollback) về tọa độ trước đó nếu lưu thất bại hoặc mất kết nối mạng.
   - Nhân viên không có quyền quản lý chỉ có thể xem sơ đồ, trạng thái bàn và đơn hàng, không được di chuyển vị trí bàn.
7. **Bảo toàn hiển thị trên các bề mặt (responsive bounds):**
   - Thuật toán `getSafeCanvasBounds` chỉ giữ nguyên giới hạn mặc định `CANVAS_BOUNDS` (X từ 7% đến 93%, Y từ 9% đến 91%) khi kích thước bề mặt canvas đo được đạt tối thiểu 1200x680px (ví dụ các kích thước desktop 1200x680 và 1248x680).
   - Với các kích thước khác hoặc màn hình hẹp, hàm tự động tính toán giới hạn an toàn theo kích thước thực tế với lề an toàn 80px theo chiều ngang (`horizontalPx: 80`) và 64px theo chiều dọc (`verticalPx: 64`) trong khi vẫn bảo toàn các giới hạn cơ sở (không nới rộng vượt quá 7/93% và 9/91%).
   - Các trường hợp kiểm chứng thực tế:
     - `358x420` (mobile): X từ 22.4% đến 77.6%, Y từ 15.3% đến 84.7%.
     - `808x505` (tablet/viewport 840x700): X từ 10% đến 90%, Y từ 12.7% đến 87.3%.
     - `800x500`: X từ 10% đến 90%, Y từ 12.8% đến 87.2%.
     - `1200x680` và `1248x680`: bảo toàn nguyên vẹn X 7% - 93% và Y 9% - 91%.
8. **Khóa ký `SESSION_SECRET`:** Khuyến nghị cấu hình `SESSION_SECRET` ổn định trên production (tối thiểu 16 ký tự). Việc đổi `SESSION_SECRET` sẽ làm mất hiệu lực toàn bộ chữ ký trên các mã QR bàn đã in và bắt buộc phải xuất/in lại bảng QR.

Tính năng quản lý bàn này nằm trên web. Mobile vẫn đọc và xử lý đơn theo contract tương thích; chưa có màn hình CRUD bàn native mới.

## API sơ đồ bàn và cập nhật vị trí

- **Truy vấn sơ đồ bàn (`GET /api/tables/floor-plan?shopId=...`):**
  - Yêu cầu xác thực phiên đăng nhập và quyền `orders.view` theo `shopId` (`requireShopPermission`). Thiếu `shopId` trả mã `400`.
  - Đọc danh sách bàn chưa lưu trữ (`is_archived = false`, bao gồm cả bàn tạm ngưng `is_active = false`) và toàn bộ đơn hàng của shop từ DB qua client `service-role`.
  - Phân trang an toàn với cỡ trang 500 bản ghi, chặn trần tối đa 10.000 bản ghi (vượt trần trả mã lỗi `500 TABLE_FLOOR_PLAN_FETCH_FAILED` an toàn, không rò rỉ thông điệp DB nội bộ).
  - Server tính toán trạng thái vận hành của từng bàn (`floor_status`) qua hàm thuần túy `computeTableFloorPlanSummaries`:
    - `inactive`: bàn đang tạm ngưng hoạt động (`is_active = false`).
    - `occupied`: bàn đang có đơn hàng chưa hủy ở trạng thái `new` hoặc `preparing`.
    - `waiting_payment`: bàn không có đơn đang làm nhưng có đơn đã hoàn tất (`completed`) chưa thanh toán (`unpaid`).
    - `free`: bàn đang hoạt động, không có đơn chờ xử lý hay chờ thu tiền.
  - Phản hồi trả về danh sách `tables` với `open_order_count` (số đơn `new`/`preparing` hoặc `completed` unpaid) và `unpaid_amount` (tổng tiền các đơn `unpaid` chưa hủy).
  - Khớp đơn hàng với bàn: ưu tiên khớp chính xác theo `shop_id` và `table_id`. Đơn cũ không có `table_id` chỉ fallback theo `table_label` khi nhãn khớp duy nhất một bàn trong shop và không phải nhãn Mang về.
- **Cập nhật vị trí bàn (`PATCH /api/tables`):**
  - Tái sử dụng contract cập nhật bàn hiện có, yêu cầu quyền owner hoặc admin của quán (`requireShopOwnerOrAdmin`).
  - Nhận payload gồm `shop_id`, `id` (hoặc `table_id`), cùng `layout_x`, `layout_y`.
  - Xác thực tọa độ (`validateTableLayoutCoordinate`): phải là số nguyên từ 0 đến 100 hoặc `null`; sai kiểu hoặc ngoài phạm vi trả về `400 INVALID_TABLE_LAYOUT_COORDINATE`.
  - Lưu trữ vào cột `layout_x`, `layout_y` của bảng `public.shop_tables` và trả về bản ghi bàn kèm chữ ký QR hợp lệ.

## Khách quét QR

Link riêng của từng bàn có dạng `/s/{slug}/menu?src=table&tableId={id}&sig={qr_sig}`. Menu chỉ tự chọn và khóa đúng bàn khi bàn đang hoạt động trong quán đó **và** chữ ký `sig` hợp lệ (`GET /api/shops?slug=...&tableId=...&sig=...` trả về `tableQrVerified: true`). Mọi đơn gọi tại bàn ẩn danh (`POST /api/orders`) bắt buộc phải kèm chữ ký HMAC hợp lệ (`table_qr_sig`) cho đúng cặp `shop_id + table_id` kể cả khi client bỏ cờ `qr_table_mode`; mọi hành vi sửa `tableId`, xóa hoặc làm sai lệch chữ ký đều bị server từ chối (`MISSING_TABLE_QR_SIGNATURE` / `INVALID_TABLE_QR_SIGNATURE`) trước khi trừ kho và hiển thị thông báo lỗi đã bản địa hóa theo ngôn ngữ khách đang xem. Khi khách tự sửa đơn trước khi quầy tiếp nhận (`PATCH /api/orders` bằng `trackingToken`), đơn giữ nguyên bàn hiện tại hoặc bắt buộc chứng minh `table_qr_sig` hợp lệ nếu đổi sang bàn khác.

Khi đang ở ngữ cảnh QR bàn quản lý đã xác thực hợp lệ (`lockedTable` + `tableQrVerified: true`, không phải Mang về và bàn đang hoạt động, kể cả khi đã qua giờ mở cửa niêm yết để khách đang ngồi tại bàn vẫn gọi được nhân viên/xin hóa đơn), thanh bàn hiển thị đúng 2 nút hỗ trợ nhanh đã bản địa hóa đủ 8 ngôn ngữ storefront: **🔔 Gọi phục vụ (`call_staff`)** và **🧾 Xin hóa đơn (`request_bill`)** gửi tới `POST /api/service-requests`. Server tái sử dụng kiểm tra chữ ký HMAC QR bàn (`dbResolveOrderTableIdentity` / `verifyTableQrSignature`), tự suy ra `shop_id`, `table_id`, `table_code` và `table_label` chuẩn từ bản ghi bàn (không tin `tableId`/`shopId`/`tableLabel` tùy ý từ client), chống spam bấm lặp theo từng cặp `(shop_id, table_id, request_type)` đang chờ xử lý, phát sự kiện realtime SSE + push notification + chuông báo tại `/dashboard/orders`, và cho phép nhân sự có quyền `orders.view` chuyển trạng thái `pending → acknowledged → resolved` (`PATCH /api/service-requests`). Yêu cầu xin hóa đơn (`request_bill`) tuyệt đối không tự động đánh dấu đơn `paid` hay sửa bất kỳ trường tài chính nào của đơn hàng. Hộp nút hỗ trợ tự ẩn hoàn toàn ở chế độ Mang về, menu chung hoặc khi QR bàn thiếu/sai chữ ký, tạm ngưng hoặc đã lưu trữ.

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

Cần áp dụng các migration theo thứ tự: `007_shop_tables.sql`, `009_table_service_requests.sql`, và `012_table_floor_plan.sql` trước khi triển khai source mới.
- Migration 007: thêm `shop_tables`, `orders.table_id`, RLS/indexes/triggers và mở rộng RPC.
- Migration 009: thêm `table_service_requests`, RLS cho nhân sự `orders.view`, trigger chặn client mutate trực tiếp, RPC nguyên tử `public.create_table_service_request_atomic` (khóa dòng `shop_tables` `FOR UPDATE` để chống trùng lặp khi gửi song song ở ranh giới transaction DB) và thêm bảng vào publication `supabase_realtime`.
- Migration 012: thêm cột `layout_x`, `layout_y` (INTEGER nullable, ràng buộc `CHECK` từ 0 đến 100) vào `public.shop_tables`, và partial index `idx_orders_shop_table_floor_status ON public.orders (shop_id, table_id, status, payment_status) WHERE table_id IS NOT NULL AND status <> 'cancelled'` tối ưu hóa truy vấn đơn cho sơ đồ bàn. Không khẳng định migration đã chạy trên production.

Kiểm chứng tính năng qua các bộ kiểm thử:
- `tests/table-floor-plan.test.ts`: kiểm tra logic tổng hợp trạng thái vận hành (`computeTableFloorPlanSummaries`), thứ tự ưu tiên trạng thái (đang làm > chờ thanh toán > trống), loại trừ đơn hủy, xử lý số tiền an toàn (loại trừ giá trị âm/NaN/Infinity) và cách ly ranh giới shop.
- `tests/floor-plan-api-review.test.ts`: kiểm tra endpoint `GET /api/tables/floor-plan` (yêu cầu quyền `orders.view`, thiếu `shopId` trả 400, phân trang 500 bản ghi, kiểm tra trần 10.000 bản ghi kích hoạt lỗi 500 an toàn, bảo mật thông báo lỗi nội bộ DB).
- `tests/floor-plan-canvas-review.test.ts` (chạy `tests/floor-plan-canvas-qa.mjs`): kiểm tra component `ShopTableFloorPlanCanvas` (tọa độ fallback grid, tính toán `getSafeCanvasBounds` và co lề an toàn 80px ngang/64px dọc trên màn hình hẹp/trung bình, bảo toàn 7/93% và 9/91% trên desktop rộng ≥ 1200x680, hiển thị nhãn/trạng thái/legend VI/EN, di chuyển phím mũi tên 2% mỗi lần bấm, chống click nhầm sau khi kéo qua `PostDragClickGuard`).
- `tests/shop-table-manager-review.test.ts`: kiểm tra tích hợp `ShopTableManager` (chuyển đổi list/map, tab lưu trữ khóa chế độ list, bộ lọc khu vực, phân tách dữ liệu QR thật không bịa `qr_sig`, cập nhật lạc quan và rollback khi PATCH thất bại, kiểm quyền quản lý `canManageTables`).
- `tests/tables-independent-review.test.ts`: bảo đảm toàn vẹn hợp đồng quản lý bàn, RLS, tính độc lập của thanh toán và chữ ký HMAC QR.

Ghi nhận kiểm thử thủ công qua trình duyệt (manual browser smoke validation):
- Đã kiểm tra trực quan cả 4 mép bàn tại các độ rộng màn hình 390px, 840px và 1280px.
- Xác nhận cơ chế triệt tiêu click ngay sau khi kéo (pointer-drag click suppression) giúp không kích hoạt chọn bàn ngoài ý muốn, sau đó click chuột thông thường vẫn chọn đúng bàn.
- Xác nhận các phím mũi tên lặp lại di chuyển mượt mà từng bước 2% và dừng đúng tại mép an toàn.
- Xác nhận nhả chuột ngoài vùng canvas (outside-release) không kích hoạt lưu dữ liệu tọa độ mới.
- Lưu ý: Đây là ghi nhận kiểm chứng thủ công trên trình duyệt (recorded validation), không phải khẳng định có bộ test tự động E2E hay kiểm thử trên thiết bị vật lý thật.
