# Review trước merge — 17/10/2026

Review đối chiếu từ `origin/main` 7863dd7, gồm sửa mobile của Codex và phần triển khai tiếp của AGY. Báo cáo AGY ban đầu là mô tả triển khai, không phải kết luận độc lập rằng mọi thay đổi đã an toàn để deploy.

## Phát hiện đã yêu cầu sửa

- RLS cho phép `orders.view` cập nhật thẳng tổng tiền và nội dung đơn; đã tái hiện bằng PostgreSQL cô lập. Cần chặn mutations trực tiếp của staff/cashier, dùng API có kiểm quyền.
- Membership từ local file không được ghi đè hoặc phục hồi quyền đã revoke trong DB thật; lỗi ghi DB không được báo thành công.
- Không được trả thành công đã thu/hoàn tiền nếu ghi DB thất bại, hoặc fallback biến refunded thành unpaid.
- API analytics phải yêu cầu xác thực kể cả caller không gửi token.
- Quyền ngân hàng phải kiểm tra cả `paymentQr` và `paymentConfig`; phối hợp sửa appearance/promotion không được bỏ qua quyền riêng.
- Người được cấp `members.manage` không được tự cấp owner; mutations membership yêu cầu owner/admin.
- Chỉnh category/item không được chiếm ID hoặc dùng category của shop khác.
- In web dừng nếu API từ chối; escape nội dung do khách nhập và sandbox iframe để không thực thi markup/script khi in.
- Xem trước trên mobile không được tăng bộ đếm in hoặc tuyên bố đã ghi nhận in phần cứng.
- Client gửi tổng tiền đang thấy để server từ chối checkout khi giá thay đổi. Hủy đơn paid cần xác nhận hoàn tiền riêng.

## Triển khai

Workflow đã có sẵn trigger deploy và migration Supabase khi push main. Thay đổi workflow sắp xếp lại thành verify -> migrate -> deploy, deploy đúng commit SHA đã kiểm tra. Chưa chạy workflow hoặc migration production trong phiên review này.

Bản này cần schema mới cùng server service-role và secret ký session được cấu hình đúng. `SESSION_SECRET` (hoặc secret server đã hỗ trợ) phải dài ít nhất 16 ký tự; production không được dùng secret mặc định trong source.

Kiểm thử thiết bị iOS/Android, máy in phần cứng và giao dịch ngân hàng thật chưa được thực hiện. Web in qua browser dialog chỉ ghi nhận lần yêu cầu in, không xác nhận máy in đã xuất giấy. Webhook gói SaaS chưa phải đối soát tự động tiền merchant.

## Kiểm chứng bản cuối

- Typecheck web/mobile và production build đã chạy local.
- 66 unit test hiện có, 9 test API client mobile, các regression API/giá/membership và PostgreSQL đều chạy cô lập.
- `tests/order-review.test.ts` nối engine TypeScript tới migration PostgreSQL thật trong bộ nhớ: DB write failure không đổi paid; catalog pricing; payment độc lập fulfillment; khóa đảo ngược payment; khóa guest edit sau nhận; batch-payment replay không thu round mới.
- Các RPC `SECURITY DEFINER` đã revoke quyền PUBLIC/anon/authenticated và chỉ grant service_role; test SQL kiểm tra ranh giới này.
- Đã sửa hai kỳ vọng test cũ dùng giá client 55.000 thay vì giá catalog 65.000; fixture tổng/discount nay kiểm tra giá catalog.

Engine dùng DB làm nguồn chính khi có cấu hình; không ghép các order chỉ nằm trong `.local-db` vào phản hồi DB. Khi rollout từ bản dùng fallback cũ, cần đối chiếu/backup các giao dịch chỉ có ở `.local-db` trước khi chuyển sang DB authoritative. Chưa thực hiện đối chiếu dữ liệu production. Audit file cục bộ và các trường người thu/hoàn đã lưu; chưa triển khai payment ledger và audit transaction hoàn chỉnh cho chốt ca.

## Deployment migration recovery (2026-10-18)

Run 39080044191 passed verify but failed migration 003 with duplicate bank reference
23505. Added 002z before 003: locks plan payment transactions, archives the entire
conflicting group in `payment_bank_ref_conflicts` (RLS, service-role read only),
retains the earliest reference by created_at/id and clears only other reference
assignments. No transaction is deleted; amount/status/plan/entitlement stay intact.
The retained row is a deterministic replay guard, not a financial reconciliation
verdict. Review archived conflicts manually to reconcile any legacy double credit.
Unique index creation is in the same transaction, protecting against new duplicates.
PGlite regression reproduces the original index failure, verifies complete archive,
unchanged payment fields, rerun safety, replay rejection and restricted archive reads.
Also fixed midnight opening hours: zero hours must not fall through to defaults.
