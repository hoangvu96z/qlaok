# Báo cáo rà soát Qlaok — 25/10/2026

## Tóm tắt

Baseline của Codex có **13 finding** (2 P1, 10 P2, 1 P3). Lượt review tĩnh độc lập của AGY bổ sung **6 finding không trùng baseline** (3 P1, 1 P2, 2 P3); một candidate catalog trùng finding đã có và một candidate xóa shop bị loại sau khi đối chiếu migration. Tổng cộng ghi nhận **19 finding** (5 P1, 11 P2, 3 P3). Trong đó finding khuyến mãi Web đã được sửa, commit `5b71b8b` và deploy thành công; hiện còn **18 finding chưa xử lý** (5 P1, 10 P2, 3 P3).

**Đây chưa phải review từng dòng của toàn bộ codebase.** CodeGraph có 256 file; AGY đọc sâu 58 file nguồn và 15/19 migration, theo các miền được liệt kê trong phần bổ sung. Claude Code CLI không tạo được kết quả do máy đang ép model DeepSeek qua 9router và không có phiên đăng nhập khi bỏ cấu hình đó; phần review mở rộng được ghi rõ là của AGY, không phải Claude. Phần đánh giá finding là static review, không chạy test/build/API production để xác minh từng vấn đề. Riêng bản sửa khuyến mãi được chạy test cục bộ, CI đầy đủ và deploy production ở Actions run `40203348447`; smoke check dashboard sau deploy chỉ đọc.

## Phát hiện

### [P1] Credential mặc định của gateway AI nằm trong mã nguồn được theo dõi

- **Vị trí:** `src/lib/gemini.ts:10-27, 39-60`; caller `src/app/api/ai/translate/route.ts:16-20, 40-73` và `src/app/api/ai/ocr-menu/route.ts:25-28, 91-100`.
- **Điều kiện:** `AI_API_KEY` không được cấu hình. `getAiConfig()` thay giá trị thiếu bằng một chuỗi credential hardcode; vì vậy cấu hình không bao giờ rỗng và nhánh local-only ở các route AI không được chọn.
- **Bằng chứng:** `call9RouterJson()` lấy cấu hình này rồi gửi nó trong header `Authorization: Bearer ...` tới gateway; file chứa giá trị mặc định đang được Git theo dõi. Cả dịch thuật và OCR gọi helper này. Giá trị credential đã được lược bỏ khỏi báo cáo để không phát tán thêm.
- **Tác động:** Người có quyền đọc repository có thể lấy credential nếu nó còn dùng được; người gọi tính năng AI có thể tiêu thụ quota gateway của credential đó. Giá trị mặc định còn làm dữ liệu dịch/OCR được gửi ra gateway ngay cả khi môi trường không khai báo `AI_API_KEY`.
- **Khắc phục:** Thu hồi/rotate credential nếu còn hiệu lực; xóa giá trị khỏi source và lịch sử Git phù hợp; chỉ đọc secret từ môi trường quản lý an toàn và fail closed khi thiếu. Kiểm tra usage của gateway để xác định có lượt gọi ngoài dự kiến.
- **Độ tin cậy:** Cao về việc có credential-looking fallback trong tracked source và nó đi vào header request; chưa xác minh credential còn hiệu lực hay kiểm tra usage gateway.

### [P1] API upload công khai có thể cấp URL ghi R2 không giới hạn kích thước

- **Vị trí:** `src/app/api/upload/route.ts:28-47, 155-166`; `src/lib/r2.ts:47-64`.
- **Điều kiện:** R2 được cấu hình. Bất kỳ client nào gọi `POST /api/upload` mà bỏ `base64Data` có thể vào nhánh cấp presigned URL. Route không gọi `requireAuthenticatedUser`/`requireShopPermission`, không kiểm tra shop sở hữu ảnh và không có rate limit trong call path.
- **Bằng chứng:** Nhánh presigned trả `uploadUrl` và `publicUrl`. `createR2PresignedUploadUrl` ký lệnh `PutObject` với `Bucket`, `Key`, `ContentType`, hết hạn sau 3.600 giây; không đặt content-length hoặc điều kiện dung lượng. Giới hạn 5 MiB ở route chỉ áp dụng cho payload Base64, không áp dụng cho URL presigned.
- **Tái hiện tĩnh:** Gửi request không đăng nhập với `fileName` và MIME ảnh được chấp nhận, bỏ `base64Data`; khi R2 sẵn sàng, route trả URL PUT cùng URL công khai.
- **Tác động:** Người ngoài có thể ghi ảnh vào bucket public trong thời hạn URL, dùng dung lượng của cửa hàng và đăng nội dung không do chủ cửa hàng kiểm soát. Mức độ thực tế phụ thuộc R2 có bật ở production hay không.
- **Khắc phục:** Yêu cầu quyền theo shop trước khi cấp URL; ràng buộc object key vào shop đã xác thực; giới hạn kích thước bằng chính sách presigned có điều kiện dung lượng hoặc proxy upload phía server; thêm quota/rate limit và cơ chế xóa object mồ côi.
- **Độ tin cậy:** Cao về thiếu kiểm soát trong mã; chưa kiểm tra cấu hình R2 production hoặc thử tải lên thật.

### [P2] API analytics công khai cho phép bơm sự kiện và làm phình dữ liệu báo cáo

- **Vị trí:** `src/app/api/analytics/track/route.ts:18-49`; `src/lib/db.ts:1724-1762, 1844-1848, 1903-1959`.
- **Điều kiện:** Endpoint được gọi lặp lại với `shop_id` hợp lệ và event type hợp lệ (`scan_door`, `scan_table`, `item_view`, `show_to_staff`, `wifi_copy`). Route không xác thực người gọi, giới hạn tần suất hoặc ràng buộc `item_id` thuộc shop.
- **Bằng chứng:** `POST` nhận `shop_id`, `event_type`, `item_id` từ body rồi gọi `dbRecordAnalyticsEvent`. Helper chèn từng event. Báo cáo analytics lấy event theo shop, sắp xếp theo ngày nhưng không phân trang/đặt limit, rồi tính số lượt scan và sự kiện từ toàn bộ kết quả.
- **Tác động:** Người ngoài có thể làm sai số liệu scan/lượt xem, tăng số hàng phải lưu và khiến mỗi lần mở báo cáo phải tải/xử lý thêm toàn bộ lịch sử event. Nếu server dùng service role thì RLS không giới hạn được luồng insert này; quyền DB production chưa được kiểm tra.
- **Khắc phục:** Giữ khả năng ghi event của storefront nhưng thêm rate limit theo IP/thiết bị, token ký ngắn hạn theo shop, xác thực `item_id` thuộc shop; đặt retention/aggregation và phân trang hoặc truy vấn tổng hợp phía DB.
- **Độ tin cậy:** Cao về đường ghi/đọc không có giới hạn trong mã; chưa chạy kiểm thử tải hoặc xác minh quyền DB production.

### [P2] AI OCR không giới hạn dung lượng ảnh hoặc độ dài văn bản đầu vào

- **Vị trí:** `src/app/api/ai/ocr-menu/route.ts:25-79, 101-149`; `src/app/api/ai/_lib/guard.ts:24-35, 47-71`.
- **Điều kiện:** Người dùng có phiên hợp lệ và shop được phép dùng OCR gửi `imageBase64` hoặc `rawOcrText` rất lớn. Route parse toàn bộ JSON rồi có thể đưa ảnh qua Tesseract và đưa toàn bộ `extractedText` vào prompt AI. Không thấy giới hạn byte/ký tự/kích thước pixel tại route.
- **Bằng chứng:** Guard giới hạn số request theo user (OCR: 10 mỗi 10 phút) nhưng lưu bộ đếm trong `Map` của từng server instance; giới hạn request không chặn một payload đơn rất lớn. OCR dùng `Buffer.from`/`Tesseract.recognize`, sau đó ghép nguyên văn bản vào prompt.
- **Tác động:** Một số ít request lớn có thể tiêu thụ nhiều RAM/CPU hoặc token, làm chậm/đẩy lỗi các request khác. Giới hạn body từ reverse proxy/runtime có thể giảm rủi ro nhưng chưa xác minh cấu hình triển khai.
- **Khắc phục:** Đọc body có giới hạn byte trước khi parse JSON; giới hạn kích thước ảnh sau decode và số pixel; giới hạn ký tự OCR/translation trước khi gọi model; trả 413/400 nhất quán.
- **Độ tin cậy:** Cao về thiếu giới hạn ở tầng ứng dụng; mức khai thác phụ thuộc reverse proxy/runtime và quyền AI của tài khoản.

### [P2 — ĐÃ SỬA VÀ DEPLOY] Form khuyến mãi web có thể lưu mức giảm mặc định hoặc mang cấu hình shop trước sang shop khác

- **Vị trí:** `src/app/(dashboard)/dashboard/posts/page.tsx:114-128, 195-283, 356-377`; đối chiếu fallback an toàn ở `mobile/App.tsx:524-617`; hiệu lực giảm giá tại `src/lib/order-pricing.ts:238-294`.
- **Trạng thái:** Finding lịch sử đã được xử lý ở commit `5b71b8b140d3f83f9e6eab2d64d2e3f75e06c401`. Workflow deploy run `40203348447` kết thúc `success`; trang production sau deploy hiển thị banner `Tắt` và tiêu đề/mô tả trống cho shop QA. Không lưu thay đổi trên production.
- **Điều kiện:** Shop chưa có `theme_config.promoBanner` và người quản lý mở Promotions rồi bấm “Lưu & áp dụng”; hoặc người quản lý chuyển sang shop khác chưa có khóa cấu hình này mà vẫn ở cùng component rồi lưu.
- **Bằng chứng trước bản sửa:** State ban đầu của web đặt `promoBanner.enabled=true`, giảm 15%, ngưỡng 100.000đ và mã voucher mặc định. Effect chỉ gọi `setPromoBanner` khi `tc.promoBanner` tồn tại, không reset khi khóa thiếu; tương tự welcome popup/flash sale cũng không được reset khi chuyển shop. `handleSavePromotions` gửi các state hiện tại vào `PATCH /api/shops`. Mobile có nhánh `else` đặt promo disabled khi config thiếu. Quote phía server sẽ áp dụng banner khi mã nhập khớp và đơn đạt ngưỡng.
- **Tác động:** Một thao tác lưu cấu hình khác có thể vô tình bật hoặc mang sang shop một chương trình giảm giá; đơn đủ điều kiện dùng mã mặc định có thể được giảm 15%. Nếu state đến từ shop trước, mức/mã/món áp dụng của shop đó có thể bị ghi lên shop hiện tại.
- **Khắc phục:** Dùng hàm hydrate chung có default disabled cho promo và reset cả ba state mỗi khi `activeShop` đổi, kể cả khi config thiếu; tránh prefill một voucher có thể sử dụng được trước khi chủ shop cấu hình rõ ràng. Thêm kiểm thử chuyển shop và shop không có config.
- **Độ tin cậy:** Cao về state mặc định, nhánh hydrate, PATCH và công thức quote; chưa bấm lưu hoặc tạo đơn trên production để tránh kích hoạt giảm giá.

### [P2] Tài khoản chủ quán mới có thể nhận mật khẩu mặc định dùng chung

- **Vị trí:** `src/app/api/admin/route.ts:522-560`; `src/app/(admin)/admin/page.tsx:481-523`; luồng đăng nhập `src/app/api/auth/route.ts:593-601`.
- **Điều kiện:** Superadmin tạo tài khoản mà bỏ trống mật khẩu hoặc gửi mật khẩu ngắn hơn 6 ký tự. API thay bằng `qlaok123456`; giao diện cũng tự gửi mật khẩu này nếu ô trống. Form reset mật khẩu điền sẵn cùng chuỗi.
- **Tác động:** Tài khoản giữ mật khẩu được biết trước có thể bị đăng nhập trái phép nếu email bị lộ hoặc đoán được. Không thấy nhánh buộc đổi mật khẩu ở lần đăng nhập đầu trong luồng đã kiểm tra.
- **Khắc phục:** Từ chối mật khẩu trống/yếu; bỏ giá trị mặc định khỏi form reset; dùng lời mời tạo mật khẩu một lần hoặc bắt buộc đổi mật khẩu trước khi vào dashboard.
- **Độ tin cậy:** Cao — giá trị mặc định đi từ form/API tới credential và có thể dùng trong đăng nhập. Chưa thử đăng nhập tài khoản production.

### [P2] API báo tạo/reset mật khẩu thành công dù ghi credential thất bại

- **Vị trí:** `src/lib/auth-credentials.ts:64-85`; `src/app/api/admin/route.ts:553-560, 576-583`.
- **Điều kiện:** Ghi `.local-db/auth-credentials.json` thất bại do quyền filesystem, hết dung lượng hoặc lỗi I/O.
- **Bằng chứng:** `writeCredentials()` bắt mọi lỗi rồi bỏ qua. Cả nhánh tạo owner và reset password gọi hàm này nhưng không kiểm tra kết quả; sau đó vẫn trả HTTP 201 hoặc `{ ok: true }`.
- **Tác động:** Tạo owner có thể để lại profile nhưng không có credential đăng nhập bền vững; reset password có thể trả thành công trong khi hash cũ vẫn còn hoặc hash mới chỉ tồn tại trong bộ nhớ. Người vận hành không biết cần khôi phục thao tác.
- **Khắc phục:** Để lỗi ghi truyền về caller; chỉ trả thành công sau khi lưu bền vững; ghi atomic qua file tạm và rename, kèm kiểm thử mô phỏng filesystem lỗi.
- **Độ tin cậy:** Cao về nhánh lỗi và response; chưa mô phỏng lỗi filesystem lúc chạy.

### [P2] API đọc hóa đơn bàn có thể tính thiếu trong khi API tất toán thu hết các đơn của phiên

- **Vị trí:** `src/lib/mpos-store.ts:1202-1218, 1340-1342, 2665-2700, 2762-2785`; `src/app/api/orders/route.ts:108-128, 308-352`; `supabase/migrations/007_shop_tables.sql:892-944`.
- **Điều kiện:** Supabase đang dùng, một phiên bàn còn đơn unpaid cũ hơn 1.000 đơn mới nhất của shop.
- **Bằng chứng:** `loadMergedOrders()` giới hạn danh sách ở `STATS_ORDER_PAGE_SIZE = 1000` (`src/lib/mpos-store.ts:3256`); `dbGetTableBill()` lọc session từ danh sách bị giới hạn và cộng tổng số đó. Trái lại, `settle_table_bill_atomic` khóa và cập nhật mọi đơn unpaid, không cancelled, có cùng `shop_id` + `session_id`. API tất toán không nhận `expected_total` để phát hiện chênh lệch trước khi đánh dấu đã thu tiền.
- **Tác động:** Nếu client dùng GET hóa đơn để hiển thị số cần thu rồi gọi API tất toán, tổng hiển thị có thể thiếu hoặc rỗng trong khi nhiều đơn hơn bị chuyển sang paid. Không tìm thấy client UI nội bộ gọi `action=table_bill`; ảnh hưởng hiện xác nhận ở hợp đồng API, chưa xác nhận màn hình sản phẩm đang gặp.
- **Khắc phục:** Đọc bill trực tiếp theo `shop_id` + `session_id`/phân trang đầy đủ; thêm `expected_total` hoặc `bill_version` vào lệnh tất toán và từ chối nếu dữ liệu đã đổi.
- **Độ tin cậy:** Cao về khác biệt giữa hai đường đọc/ghi; tác động phụ thuộc client gọi API đọc hóa đơn và điều kiện vượt 1.000 đơn.

### [P3] Cập nhật `view_count` có thể mất lượt khi nhiều khách xem cùng lúc

- **Vị trí:** `src/lib/db.ts:1746-1758, 1942-1945`.
- **Điều kiện:** Hai hoặc nhiều `item_view` cho cùng một món chạy đồng thời.
- **Bằng chứng:** `dbRecordAnalyticsEvent()` đọc `view_count`, cộng 1 trong ứng dụng rồi ghi giá trị mới. Hai request có thể cùng đọc `n` và cùng ghi `n+1`, dù đã chèn hai event. Trang analytics dùng `view_count` để xếp top items.
- **Tác động:** Số lượt xem bị thiếu và thứ hạng món có thể sai khi có traffic đồng thời; event log vẫn có thể ghi đủ.
- **Khắc phục:** Tăng nguyên tử bằng RPC/SQL `view_count = view_count + 1` hoặc lấy tổng từ event đã ghi thay vì read-modify-write.
- **Độ tin cậy:** Cao về race trong call path; chưa mô phỏng tải đồng thời.

### [P2] API public đọc được bài viết chưa hoạt động

- **Vị trí:** `src/app/api/posts/route.ts:10-14`; `src/lib/db.ts:92-100, 1659-1682`; `supabase/migrations/003_security_rls_and_atomic_mpos.sql:164-175`.
- **Điều kiện:** Gọi `GET /api/posts?shopId=<id>` không cần đăng nhập. `dbGetShopPosts` dùng `getSupabaseDbClient`, ưu tiên service-role key; truy vấn chọn `*` theo shop nhưng không lọc `is_active` hoặc trạng thái publish của shop. Migration ghi chú public chỉ được đọc bài active của shop đã publish, nhưng policy thực tế chỉ kiểm tra shop published/owner và cũng không lọc `posts.is_active`.
- **Bằng chứng:** Route không gọi auth; helper trả tất cả hàng khớp `shop_id`. Client DB phía server lấy `SUPABASE_SERVICE_ROLE_KEY` trước anon key nên có thể bỏ qua RLS. Ngay cả anon policy hiện tại cũng không kiểm tra `is_active`.
- **Tác động:** Khách chưa đăng nhập có thể xem nội dung bài đã tắt; khi service-role được cấu hình, họ còn có thể đọc bài của shop chưa publish nếu biết shop ID.
- **Khắc phục:** Tách truy vấn public khỏi truy vấn quản trị; bắt buộc public chỉ lấy bài `is_active=true` và shop `is_published=true`. Nếu API quản trị cần bài draft, yêu cầu quyền shop trước khi trả chúng. Sửa policy SQL để khớp điều kiện active trong comment.
- **Độ tin cậy:** Cao — điều kiện truy vấn, auth route và lựa chọn service-role đều thấy trực tiếp trong mã; chưa gọi endpoint production.

### [P2] Owner một shop có thể ghi đè bài của shop khác bằng ID đã biết

- **Vị trí:** `src/app/api/posts/route.ts:17-25`; `src/lib/db.ts:92-100, 1685-1711`; `supabase/migrations/001_init_qlaok.sql:156-160`.
- **Điều kiện:** Chủ shop A đăng nhập và gửi `POST /api/posts` với `shop_id` của A nhưng `id` của một bài thuộc shop B. ID bài là public/đọc được qua GET; khi server dùng service-role client, thao tác upsert không bị policy RLS giới hạn.
- **Bằng chứng:** Route chỉ xác thực quyền trên `body.shop_id`, rồi chuyển toàn bộ body sang `dbUpsertPost`. Helper giữ nguyên `post.id` và upsert với `onConflict: 'id'`; khóa chính `posts.id` là duy nhất toàn bảng. Không có bước đọc ID cũ để so sánh shop sở hữu.
- **Tác động:** Bài của shop B bị đổi nội dung và chuyển sang shop A; dữ liệu công khai của một tenant có thể bị tenant khác phá hoại.
- **Khắc phục:** Tạo mới bằng ID do server sinh. Với cập nhật, tải bản ghi cũ và xác nhận `existing.shop_id === auth.shop.id`, rồi cập nhật theo cả `id` lẫn `shop_id` trong truy vấn.
- **Độ tin cậy:** Cao về đường code; điều kiện service-role phụ thuộc cấu hình backend, chưa thử trên production.

### [P2] API catalog công khai làm lộ dữ liệu của shop chưa publish

- **Vị trí:** `src/app/api/catalog/route.ts:151-160`; `src/lib/db.ts:1308-1378`; đối chiếu `src/app/api/shops/route.ts:117-163`.
- **Điều kiện:** Người gọi biết `shopId` của một shop đang `is_published=false` và gửi `GET /api/catalog?shopId=<shopId>` không có phiên đăng nhập.
- **Bằng chứng:** `GET /api/catalog` gọi `dbGetShopCatalog` mà không xác thực caller hoặc kiểm tra `is_published`. Helper truy vấn shop chỉ theo `id`, dùng `select('*')`, rồi trả các hàng categories và items cùng shop. Trong khi đó `/api/shops?shopId=...` từ chối shop chưa publish với người không phải thành viên; tra storefront bằng slug cũng kiểm tra quyền xem shop trước khi trả bundle.
- **Tác động:** Bản nháp catalog và các trường cấu hình shop có thể bị đọc trước khi chủ quán publish hoặc sau khi họ ẩn shop. Bản ghi shop chứa cả thông tin liên hệ, Wi-Fi và cấu hình giao diện/thanh toán; mức nhạy cảm phụ thuộc giá trị đã lưu trong từng shop.
- **Tái hiện tĩnh:** Không gửi auth header; gọi `GET /api/catalog?shopId=<ID của shop chưa publish>`. Handler hiện vẫn trả `{ shop, categories, items, ownerPlan }` thay vì 404/401/403.
- **Khắc phục:** Tách API quản lý catalog có xác thực khỏi public storefront. Với endpoint public, kiểm tra shop đã publish và chỉ trả projection cần cho menu công khai; với shop draft, yêu cầu quyền shop hoặc trả 404.
- **Độ tin cậy:** Cao về nhánh thiếu kiểm tra trong mã; chưa gọi production endpoint hoặc xác minh dữ liệu của shop chưa publish.

### [P2] Nhân viên chỉ có quyền xem đơn vẫn có thể đóng yêu cầu phục vụ

- **Vị trí:** `src/app/api/service-requests/route.ts:222-251`; `src/lib/shop-permissions.ts:12-31, 101-161`.
- **Điều kiện:** Chủ shop cấp cho một tài khoản nhân viên quyền tùy chỉnh chỉ gồm `orders.view` (được validator chấp nhận), rồi nhân viên đó gọi `PATCH /api/service-requests` với trạng thái `acknowledged` hoặc `resolved`.
- **Bằng chứng:** Nhánh `PATCH` chỉ gọi `requireShopPermission(..., 'orders.view')` trước khi gọi `dbUpdateServiceRequestStatus`; danh sách quyền cho phép cấu hình `orders.view` riêng và không yêu cầu `orders.fulfill` hoặc quyền ghi khác. Helper cập nhật trạng thái rồi lưu các mốc acknowledged/resolved; trạng thái `resolved` không thể chuyển ngược theo kiểm tra transition.
- **Tác động:** Nhân viên được cấu hình chỉ để đọc danh sách vẫn có thể tiếp nhận hoặc đóng yêu cầu bàn, làm mất yêu cầu khỏi luồng xử lý và không thể mở lại yêu cầu đã resolved qua API này.
- **Khắc phục:** Dùng một quyền ghi riêng cho việc xử lý yêu cầu phục vụ hoặc yêu cầu quyền phù hợp như `orders.fulfill` trước khi cho phép PATCH; giữ `orders.view` cho GET.
- **Độ tin cậy:** Cao về kiểm tra permission và đường ghi trong mã; chưa gửi request trong môi trường chạy.

## Phạm vi đã rà soát

| Khu vực | Mã/luồng đã xem | Kết quả và giới hạn |
|---|---|---|
| Auth, session, quyền shop | `src/lib/server-auth.ts`, `src/lib/shop-permissions.ts`, `src/lib/auth-credentials.ts`, các nhánh liên quan trong `src/app/api/admin/route.ts` và `src/app/api/auth/route.ts` | Xác nhận hai vấn đề mật khẩu/credential; chưa chạy test auth hay luồng đăng nhập browser. |
| Đơn hàng, bill bàn, thanh toán | `src/lib/mpos-store.ts` (`loadMergedOrders`, `dbGetTableBill`, `dbSettleTableBill`, `dbUpdateOrderStatus`), `src/app/api/orders/route.ts`, RPC trong migration 007 | Xác nhận sai khác giới hạn đọc/tất toán; chưa chạy DB transaction hoặc đối chiếu production. |
| Tồn kho và giá | Phần tạo/cập nhật order trong `src/lib/mpos-store.ts`, call path của `commit_order_with_inventory` | Mã đi qua RPC giao dịch khi bật DB; chỉ rà soát các đường truy vấn liên quan, chưa rà từng promotion/discount rule. |
| Upload và object storage | `src/app/api/upload/route.ts`, `src/lib/r2.ts`, `src/lib/upload-helper.ts` | Xác nhận nhánh cấp URL không có auth/size bound; chưa thử với bucket production. |
| Catalog và shop publication | `src/app/api/catalog/route.ts`, `src/lib/db.ts` (`dbGetShopCatalog`), `src/app/api/shops/route.ts` | Bổ sung lỗi đọc catalog shop chưa publish; chưa gọi production API. |
| Catalog mutations và phân quyền | `src/app/api/catalog/route.ts` (`upsert_item`, bulk availability/import, delete), `dbUpsertItem`, `getCatalogItemUpdatePermissionOptions` | Đã kiểm tra caller và helper; helper xác minh category cùng shop và chặn ID món hiện hữu thuộc shop khác. Chưa chạy kiểm thử runtime. |
| Analytics | `src/app/api/analytics/track/route.ts`, `dbRecordAnalyticsEvent`, `dbGetShopAnalyticsSummary`, `AnalyticsEventType` | Xác nhận ingest công khai, summary không giới hạn số event và race tăng lượt xem; chưa chạy tải. |
| AI gateway, OCR và translation | `src/lib/gemini.ts` (`getAiConfig`, `call9RouterJson`), hai route AI và `src/app/api/ai/_lib/guard.ts` | Thêm finding credential hardcode; xác nhận route có session/rate limit và OCR có giới hạn đầu vào còn thiếu. Chưa kiểm tra hiệu lực credential hoặc usage gateway. |
| Promotions và giá giảm | Dashboard `posts/page.tsx`, `mobile/App.tsx`, `src/lib/order-pricing.ts`, `src/lib/mpos-store.ts` | Thêm finding state khuyến mãi web; đối chiếu với fallback mobile và quy tắc áp voucher phía server. Chưa thực hiện lưu hoặc đặt đơn runtime. |
| Shop settings và quản lý nhân viên | `src/app/api/shops/route.ts` (GET/POST/PATCH), `dbUpdateShop`, membership/staff helpers | Kiểm tra quyền theo nhóm trường, allowlist patch, nhánh mời/cấp quyền nhân viên. Không xác nhận thêm lỗi trong các nhánh vừa truy; chưa rà từng nhánh của route 1.044 dòng. |
| Định giá tạo đơn | `src/app/api/orders/route.ts`, `dbCreateOrder`, `validateAndPriceOrderLines`, `src/lib/order-pricing.ts` | Thấy server tải catalog, xác thực món/options và tính quote trước khi commit inventory; chưa chạy transaction hoặc kiểm tra mọi biến thể POS. |
| SePay/webhook | Một phần `src/lib/sepay-reconciliation.ts` và call path webhook đã xem trong lượt rà soát trước | Luồng HMAC/body limit đã được xem một phần; chưa review toàn bộ gateway thanh toán/refund. |
| Realtime và mobile | `src/lib/order-events.ts`, `src/lib/order-live-sync.ts`, một phần `mobile/src/components/tabs/OrdersTab.tsx` | Chỉ rà một số luồng; chưa bao phủ toàn bộ app mobile, auth và reconnect. |
| Dashboard, reports, QR, posts, billing | API posts và trang quản lý posts đã được truy sâu; catalog API và một phần trang catalog đã được đọc. | Reports, QR, billing UI và nhiều trang dashboard vẫn chưa rà từng route/component; không kết luận các phần đó không có lỗi. |
| Tables, service requests và realtime | `/api/tables`, `/api/service-requests`, `dbCreateTableServiceRequest`, `dbUpdateServiceRequestStatus`, RPC cooldown trong migration 009, `/api/orders/events` | Xác nhận PATCH service request chỉ yêu cầu `orders.view`; đã xem chữ ký QR, cooldown DB và xác thực/revalidate SSE; chưa kiểm thử runtime hoặc tải đồng thời. |
| Billing và webhook | `/api/webhooks/payment`, SePay shop webhook và một phần RPC reconciliation | Đã xem kiểm tra quyền, chữ ký/secret, số tiền và tài khoản nhận ở các đường đã truy; chưa xác minh cấu hình production hoặc toàn bộ luồng gateway/refund. |
| Membership và nhân viên | `/api/shops` membership actions, `shop-permissions.ts`, một phần `staff-accounts.ts`, mobile staff session/API client | Đã xem các nhánh mời/cấp quyền, tạo tài khoản và DTO/session; chưa rà mọi màn hình mobile hoặc toàn bộ credential lifecycle. |
| Migrations, CI, scripts, cấu hình | Migration 003 (posts/RLS), 007 (tables/bill), 009 (service request cooldown), 019 (trigger grants) và một số config | Rà các vùng liên quan trực tiếp tới finding; những migration khác, CI, scripts và cấu hình chưa review đầy đủ. |
| Tests | Đã thấy test liên quan trong CodeGraph (`tests/upload-route-review.test.ts`, `tests/admin-review.test.ts`, `tests/order-review.test.ts`, `tests/unit.test.ts`, v.v.) | Không chạy test/build và không kiểm tra toàn bộ assertion trong test. |

## Cách kiểm tra và giới hạn

- Đọc `AGENTS.md` do người dùng cung cấp và `docs/CODEGRAPH_WORKFLOW.md`; lượt baseline chạy `codegraph status` và ghi nhận 255 file. Trạng thái mới nhất là 256 file, 3.997 node, 13.959 edge; xem phần review mở rộng bên dưới.
- CodeGraph queries bổ sung lượt này: catalog public/projection và `dbUpsertItem` tenant guard; `DashboardPostsPage` hydrate/save promotions đối chiếu với mobile; `computeSharedOrderQuote`/`dbCreateOrder`; `call9RouterJson` và các route AI; `PATCH /api/shops`/`dbUpdateShop`; shop membership; RLS/public posts, analytics và service requests. SQL chưa index được đọc trực tiếp ở các migration ghi trong bảng.
- Claude Code CLI 2.1.310 đã được thử trong lượt baseline và các lần chạy tiếp theo. Cấu hình user của máy ép model DeepSeek qua 9router; CLI không nhận model này, còn khi bỏ nguồn cấu hình user thì báo chưa đăng nhập. Không có findings nào được ghi là kết quả của Claude.
- Đây là review tĩnh. Không chạy test, build hoặc API production; chỉ cập nhật báo cáo. Mọi finding cần được xác nhận lại trong môi trường triển khai trước khi xem là tái hiện runtime.
- Phần rà soát mở rộng đã truy thêm catalog/publication, tables/QR, service requests/cooldown, SSE, billing/webhooks, membership và một phần staff/mobile auth. **Vẫn chưa rà từng file UI/mobile/migration/test trong repository**, và không kết luận các khu vực chưa liệt kê là sạch lỗi.

## Review mở rộng độc lập của AGY — 25/10/2026

> **Nguồn review:** Claude Code CLI không tạo được kết quả trong phiên này. Cấu hình user của máy ép model DeepSeek qua 9router; khi loại cấu hình đó khỏi tiến trình, CLI báo chưa đăng nhập. Vì vậy phần dưới là static review độc lập do Gemini 4 Argon High thực hiện bằng AGY, sau đó Codex đối chiếu lại các finding và line liên quan. Không gán kết quả này cho Claude.

### Phạm vi và cách đọc kết quả

- CodeGraph ở trạng thái đồng bộ: 256 file, 3.997 symbol và 13.959 cạnh. AGY báo đã đọc trực tiếp 58/256 file nguồn trọng yếu, gồm 23/23 API route, các core library về auth/đơn hàng/thanh toán/catalog, dashboard/storefront và một phần mobile; thêm 15/19 migration SQL, workflow deploy, package và cấu hình Next.js. Đây là review sâu theo đường dữ liệu và ranh giới quyền, không phải đọc từng dòng của cả 256 file.
- AGY kiểm tra 17 candidate. Sau khi Codex đối chiếu: **6 finding mới không trùng baseline**, 1 candidate trùng finding catalog đã có, 1 candidate về xóa shop không được source/migration hỗ trợ, 8 candidate khác được bác bỏ sau khi kiểm tra guard, và 1 finding khuyến mãi Web trong baseline được sửa, commit và deploy ở `5b71b8b`.
- Gộp 6 finding mới với 13 finding baseline, báo cáo ghi nhận **19 finding lịch sử: 5 P1, 11 P2, 3 P3**. Finding P2 khuyến mãi Web đã resolved; còn **18 finding chưa xử lý: 5 P1, 10 P2, 3 P3**.
- Đây là phân tích tĩnh. Không gọi API production, không đọc `.env*` hoặc `.local-db`, không chạy test/build/typecheck. Các giả thuyết cần môi trường thật được ghi rõ trong từng finding.

### Findings mới đã đối chiếu

#### [P1] Cập nhật món có thể cộng lại giảm giá dòng món và làm giảm tổng tiền đơn nhiều lần

- **Độ tin cậy:** Cao về phép tính trong mã; chưa chạy request runtime.
- **Vị trí:** `src/lib/order-pricing.ts:209-225, 311-318`; `src/lib/mpos-store.ts:2406-2419, 2444-2455`; caller `src/app/api/orders/route.ts:977-999`.
- **Điều kiện:** Đơn còn unpaid có giảm giá thủ công theo dòng món; người cập nhật có quyền `discount.apply`; PATCH gửi `items` nhưng không gửi `discount_amount`.
- **Bằng chứng:** `computeSharedOrderQuote` tính `lineManualDiscountAmount` từ `custom_unit_price` hoặc `discount_percent`, rồi cộng giá trị đó với `manualOrderDiscountAmount` để ra `manual_discount_amount`. Khi cập nhật items, `dbUpdateOrderStatus` lại lấy `existing.manual_discount_amount` (đã gồm giảm giá dòng món ở lần tính trước) làm `manualOrderDiscountAmount`; quote mới tính lại giảm giá dòng món và cộng thêm lần nữa.
- **Tác động:** Ví dụ món 100.000đ được giảm dòng 10%: đơn ban đầu còn 90.000đ. Cập nhật lại danh sách món không truyền giảm giá cấp đơn có thể làm `manual_discount_amount` thành 20.000đ và tổng còn 80.000đ. Những lần cập nhật tiếp theo tiếp tục áp sai giảm giá; số tiền khách phải trả thấp hơn giá đúng.
- **Khắc phục:** Tách giảm giá cấp dòng khỏi giảm giá cấp đơn khi lưu/đọc; chỉ truyền phần order-level vào `manualOrderDiscountAmount`, rồi tính lại quote từ items hiện tại.
- **Scenario kiểm chứng an toàn:** Tạo đơn trong test DB/in-memory với món 100.000đ và line discount 10%; PATCH lại cùng items nhưng bỏ `discount_amount`; tổng và `manual_discount_amount` phải giữ ở 90.000đ/10.000đ.

#### [P1] Tiền kiểm `expected_total` và phép tính cập nhật đơn áp dụng hai chính sách khuyến mãi khác nhau

- **Độ tin cậy:** Cao về hai nhánh tính tiền; chưa chạy request runtime.
- **Vị trí:** `src/app/api/orders/route.ts:894-905, 977-999`; `src/lib/mpos-store.ts:2444-2455, 2542-2544`; `src/lib/mpos-store.ts:1105-1147`.
- **Điều kiện:** PATCH có cả `items` và `expected_total` trên đơn đã có promo, mã giảm giá hoặc giảm giá thủ công, nhất là khi khách QR/nhân viên không có `discount.apply` hoặc khi promo theo phần trăm phải tính lại sau khi đổi số lượng.
- **Bằng chứng:** Tiền kiểm trong route gọi `quoteOrderPricing` với `apply_shop_promotions: false` và `discount_amount` lấy từ đơn cũ. Sau đó `dbUpdateOrderStatus` tính lại quote với promo được bật theo trạng thái của đơn (`discount_code`/`promo_discount_amount`) và kiểm tra `expected_total` lần nữa. Với cùng items nhưng hai cấu hình đầu vào khác nhau, request có thể bị trả 409 trước khi cập nhật hoặc bị chặn ở bước thứ hai.
- **Tác động:** Khách hoặc nhân viên không thể lưu một thay đổi món hợp lệ trên các đơn đang có khuyến mãi/giảm giá, dù gửi tổng tiền khớp với một trong hai phép tính.
- **Khắc phục:** Chỉ dùng một phép tính quote phía server với đầy đủ context của đơn hiện tại; không tiền kiểm bằng quote khác chính sách. Giữ kiểm tra `expected_total` trong đường cập nhật nguyên tử.
- **Scenario kiểm chứng an toàn:** Tạo đơn có banner giảm 10%, đổi số lượng món và gửi `expected_total` theo tổng sau giảm; xác nhận route không trả 409 nếu tổng quote server cuối cùng trùng.

#### [P1] `demo_login` cấp session owner không cần mật khẩu và không bị tắt trên production

- **Độ tin cậy:** Cao về nhánh xác thực trong source; chưa gọi production.
- **Vị trí:** `src/app/api/auth/route.ts:439-469`; `src/lib/db.ts:1101-1154`; `src/app/api/shops/route.ts:698-706`.
- **Điều kiện:** Bất kỳ client chưa đăng nhập nào gửi `POST /api/auth` với `action: "demo_login"` khi endpoint auth hoạt động.
- **Bằng chứng:** Nhánh demo không yêu cầu password và không kiểm tra `NODE_ENV` hay cờ môi trường. Khi không có profile, code dùng `SEED_PROFILE`, phát hành HMAC session với role `owner` rồi gắn cookie. API tạo shop dùng `auth.user.sub` làm owner; helper tạo shop còn upsert profile nếu chưa có.
- **Tác động:** Người ngoài có thể đăng nhập dưới danh tính owner dùng chung của demo. Nếu danh tính đó có shop trong production, attacker có thể truy cập các shop đó; nếu chưa có, vẫn có thể tạo dữ liệu shop dưới danh tính này và dùng các API yêu cầu owner session.
- **Khắc phục:** Bỏ demo login khỏi production bằng allowlist môi trường được kiểm tra ngay trong route; không phát session từ profile seed khi thiếu bản ghi thật; ưu tiên xóa nhánh này khỏi production build.
- **Scenario kiểm chứng an toàn:** Unit test với `NODE_ENV=production` gửi `action: "demo_login"` không kèm credential và xác nhận trả 401/403, không có session cookie.

#### [P2] Mã đơn được kiểm tra trước khi ghi nhưng không có unique constraint ở DB để chặn race giữa server instances

- **Độ tin cậy:** Cao về thiếu invariant DB; race phụ thuộc triển khai nhiều instance.
- **Vị trí:** `src/lib/mpos-store.ts:697-704, 1814-1821, 1910-1945`; `supabase/migrations/002_mpos_orders_inventory.sql:13-19`; `supabase/migrations/005_order_commit.sql:126-136, 250-295`.
- **Điều kiện:** Database mode đang bật và hai process/serverless instance cùng tạo đơn; chúng chọn cùng một mã ngẫu nhiên chưa tồn tại và đều hoàn tất lookup trước khi bên nào insert.
- **Bằng chứng:** `dbCreateOrder` kiểm tra candidate trong store và truy vấn bảng orders trước khi gọi `commit_order_with_inventory`. `withOrderInventoryLock` chỉ là Promise queue trong bộ nhớ của một process. Schema khai báo `orders.order_code NOT NULL` nhưng không có unique constraint/index; RPC commit cũng insert mã nhận vào mà không kiểm tra uniqueness trong transaction.
- **Tác động:** Hai đơn có thể cùng mã hiển thị dù code yêu cầu mã đơn duy nhất toàn cục. Tra cứu, đọc mã từ chuyển khoản hoặc hỗ trợ khách hàng có thể trở nên mơ hồ; reconciliation có thể từ chối giao dịch khi gặp mã không duy nhất.
- **Khắc phục:** Đưa uniqueness xuống DB (theo quy tắc chuẩn hóa mã mà hệ thống dùng), xử lý conflict bằng cách sinh mã mới và retry; không dựa vào lookup trước insert hoặc mutex cục bộ.
- **Scenario kiểm chứng an toàn:** Dùng hai client DB độc lập và đồng bộ hóa ngay sau bước lookup; ép cùng candidate rồi tạo đơn đồng thời. Kết quả phải có một bên retry/nhận conflict, không được lưu hai hàng cùng mã.

#### [P3] Lỗi dịch bài viết không được hiển thị và giao diện vẫn chuyển sang tab tiếng Anh

- **Độ tin cậy:** Cao về nhánh UI; đây là lỗi phản hồi, không phải lỗi thiếu xác thực.
- **Vị trí:** `src/app/(dashboard)/dashboard/posts/page.tsx:390-410`; `src/app/api/ai/translate/route.ts:16-20`.
- **Điều kiện:** API trả HTTP 401/429 hoặc request mạng thất bại. Request cùng origin vẫn tự gửi cookie session; thiếu `getAuthHeaders()` không đủ để kết luận request chắc chắn thiếu auth.
- **Bằng chứng:** Handler parse JSON nhưng không kiểm tra `res.ok`, không catch lỗi và luôn gọi `setActiveLangTab('en')` sau khi parse. Guard của API có thể trả lỗi 401/429 trước khi có dữ liệu dịch.
- **Tác động:** Khi phiên hết hạn hoặc bị rate-limit, nội dung không dịch nhưng giao diện chuyển sang tab tiếng Anh trống/cũ và không báo lỗi; lỗi mạng có thể tạo rejected promise không được hiển thị.
- **Khắc phục:** Kiểm tra `res.ok`, giữ nguyên draft/tab khi lỗi, hiện thông báo retry; bắt lỗi mạng và dọn trạng thái `translating` như hiện tại.
- **Scenario kiểm chứng an toàn:** Mock API trả 429; xác nhận tab không đổi, nội dung draft được giữ và người dùng thấy thông báo lỗi.

#### [P3] Mobile vẫn có thể lưu cấu hình khuyến mãi mặc định hoặc của shop trước sau khi tải catalog lỗi

- **Độ tin cậy:** Cao về state flow; chưa kiểm thử runtime Mobile.
- **Vị trí:** `mobile/App.tsx:391-403, 718-762, 766-775, 921-961`; `mobile/src/components/tabs/PromotionsTab.tsx:26-41, 810-817`.
- **Điều kiện:** Mở hoặc chuyển shop; `activeShopId` được đổi ở dòng 720 nhưng một trong các truy vấn categories/items/analytics lỗi trước khi `hydrateThemeAndPromoState` chạy. `finally` kết thúc loading, trong khi state promotion vẫn giữ mặc định hoặc dữ liệu shop trước.
- **Bằng chứng:** State ban đầu bật banner 15% với voucher QLAOK15. Hydration chỉ chạy sau `Promise.all` và kiểm tra lỗi; catch chỉ hiện alert mà không reset state. PromotionsTab vẫn có nút lưu; `handleSavePromotions` ghi `promoBanner`, `welcomePopup` và `flashSale` hiện tại vào `activeShop.theme_config`.
- **Tác động:** Chủ quán có thể lưu cấu hình promotion không thuộc shop đang chọn hoặc bật khuyến mãi mặc định ngoài ý muốn.
- **Khắc phục:** Reset promotion về mặc định tắt ngay khi chọn shop mới; hydrate phần theme/promotion không phụ thuộc vào việc catalog/analytics tải thành công; không cho lưu promotion khi context shop chưa hydrate.
- **Scenario kiểm chứng an toàn:** Mock shop mới chưa có promo config và cho truy vấn items trả lỗi; sau khi UI hết loading, kiểm tra banner vẫn tắt và nút lưu không ghi state của shop trước.

### Đối chiếu các candidate của lượt AGY

| Candidate | Kết quả sau khi Codex đối chiếu |
|---|---|
| Cộng lặp giảm giá dòng món khi sửa items | Ghi nhận finding P1 ở trên. |
| `expected_total` lệch giữa route precheck và cập nhật | Ghi nhận finding P1 ở trên. |
| Demo login không mật khẩu trên production | Ghi nhận finding P1 ở trên. |
| Xóa shop bị chặn bởi `shop_tables`/`sepay_webhook_events`, khiến xóa dở catalog | **Loại:** migration 007 và 011 khai báo các FK shop_id này `ON DELETE CASCADE`; migration 002 cũng cho orders cascade theo shop. Không có evidence trong migration đã xem cho claim rằng chính các bảng đó chặn parent delete. Trạng thái schema live chưa xác minh. |
| GET catalog lộ shop chưa publish và dữ liệu shop | Trùng finding P2 catalog đã có trong baseline; không đếm lần hai. Lượt mới xác nhận route public gọi helper, helper `select('*')` shop theo ID và trả nguyên object; `getSupabaseDbClient` dùng service-role key nếu cấu hình. |
| Mã order_code có collision | Ghi nhận dưới dạng race giữa instance và thiếu unique constraint DB, không phải vì chỉ có 900 mã: code thử thêm dải mã dài hơn sau các lần đầu, nhưng vẫn không có DB invariant để chặn hai writer đồng thời. |
| Dịch bài viết thiếu auth header và bỏ qua HTTP error | Ghi nhận hẹp hơn ở P3: cookie cùng origin có thể xác thực; lỗi thực là không xử lý 401/429/network và vẫn chuyển tab. |
| Mobile promotion mặc định bật và giữ state khi đổi shop | Ghi nhận finding P3 ở trên; khác finding Web baseline đã có bản sửa local. |

### Các candidate đã bác bỏ sau khi kiểm tra caller/guard

1. Tự đăng ký owner rồi tự đặt `role=admin` hoặc `plan=premium`: nhánh register gán `owner`/`free`; trigger DB chặn client tự nâng quyền/gói.
2. Storefront SSR lộ trực tiếp password Wi-Fi hoặc webhook secret: đường `dbGetShopBySlug`/`toPublicStorefrontShop` lọc dữ liệu nhạy cảm. Candidate catalog API được giữ riêng ở finding baseline vì đi qua helper khác.
3. Upload R2 bị SSRF/path traversal qua tên file: route giới hạn MIME/payload và chuẩn hóa key; vấn đề presigned URL công khai đã được ghi riêng ở baseline.
4. SePay đánh dấu paid khi thiếu tiền hoặc phát lại webhook: RPC khóa order, kiểm tra amount, dedupe transaction và không đổi paid với amount mismatch.
5. Khách QR sửa order sau khi quán nhận hoặc tự gửi manual discount: PATCH chỉ mở mutation trước acceptance và chặn các field nhạy cảm.
6. Đọc trộm SSE cross-shop: route yêu cầu shop permission hoặc tracking token ràng buộc order/shop trước khi đăng ký listener.
7. Hoàn tất phục vụ làm đơn tự chuyển paid: fulfillment và payment status vẫn là hai state riêng trong helper và trigger.
8. Mobile offline queue phát lại thu tiền/xóa món: queue chỉ nhận các chuyển trạng thái phục vụ an toàn, có `expected_updated_at`, và dừng khi server trả conflict/unauthorized.

### Coverage và phần chưa xác minh

| Miền | Đã xem | Chưa xác minh |
|---|---|---|
| API/auth/tenant | Toàn bộ 23 API route theo AGY handoff; middleware, server-auth, permission helpers | Runtime auth/session và cấu hình Supabase production |
| Orders/pricing/inventory | `mpos-store`, `order-pricing`, route orders, order RPCs | Tải đồng thời nhiều instance trong môi trường thật |
| Payment/webhook/billing | Payment routes, SePay reconciliation, các migration liên quan | Payload/live config từ nhà cung cấp |
| Catalog/storefront/QR/upload | Catalog, upload, R2 security helper, tables/service request/analytics, storefront entry | Các component storefront nhỏ và R2 production config |
| Dashboard/UI | Posts, settings, orders, catalog và layout/context chính | Các trang phụ như analytics/QR/team/kitchen chưa đọc chi tiết |
| Mobile | App shell, session, staff API/offline/realtime, promotions | Một số modal/UI phụ; chưa chạy app runtime |
| DB/RLS/migrations | DB layer và 15/19 migration, gồm RLS/RPC/triggers liên quan | 4 migration còn lại và live Supabase schema |
| Integrations/jobs | Push, notifications, SSE broker, printer/AI helpers | Expo Push và printer network thật |
| CI/scripts/config | Deploy workflow, package, Next config, demo reset script | Các script phụ chưa đọc hết; không đọc secrets/env |
| Tests | Unit/order workflow tests liên quan findings | Không đọc toàn bộ test directory và không chạy test/build/typecheck |

### CodeGraph queries và checks

AGY báo chạy `codegraph status`, `codegraph files`, 11 truy vấn `codegraph explore` theo nhóm auth, orders/pricing, payment, catalog/upload, promotions, mobile, DB/migrations, integrations, scripts và tests; dùng `codegraph node` trên 58 file nguồn. Codex cũng đã chạy truy vấn trực tiếp cho các symbol liên quan tới pricing, auth, catalog, shop deletion, order code, translation và mobile promotions để xác nhận line/caller.

AGY runner xác nhận `SUCCESS`, process exit 0, **0 file thay đổi**. Event log có các lệnh CodeGraph, `git status` và `git diff`; không có lệnh test/build/typecheck. Không gọi API production. Các candidate chỉ được kiểm tra tĩnh, chưa được xác nhận runtime.
