# Self-Hosted PostgreSQL 14 & Zitadel Identity Foundation

Tài liệu này mô tả cấu hình Qlaok đang chạy trên PostgreSQL 14 tự vận hành (self-hosted VPS), PostgREST và Zitadel làm nhà cung cấp định danh (IdP).

## 1. Thành phần đã bổ sung

- **Bootstrap trước migration**: [`000_bootstrap.sql`](../supabase/self-hosted/000_bootstrap.sql)
  - Khởi tạo extension `uuid-ossp` trong schema `public`.
  - Tạo 3 role tương thích PostgREST/Supabase:
    - `anon` (`NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`)
    - `authenticated` (`NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`)
    - `service_role` (`NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS`)
  - Tạo schema `auth` và hàm `auth.uid() RETURNS uuid` fail-closed.
  - Tạo publication `supabase_realtime` để các migration [`006_orders_realtime_publication.sql`](../supabase/migrations/006_orders_realtime_publication.sql) và [`009_table_service_requests.sql`](../supabase/migrations/009_table_service_requests.sql) tự động đăng ký bảng `public.orders` và `public.table_service_requests`.
- **Migration 021**: [`021_zitadel_identity_mapping.sql`](../supabase/migrations/021_zitadel_identity_mapping.sql)
  - Thêm cột `zitadel_sub TEXT DEFAULT NULL` vào `public.profiles` kèm ràng buộc định dạng `profiles_zitadel_sub_format_check` (không rỗng, đã cắt khoảng trắng, tối đa 128 ký tự, không chứa khoảng trắng hay ký tự điều khiển) và ràng buộc duy nhất `profiles_zitadel_sub_key` (`UNIQUE (zitadel_sub)`).
  - Giữ nguyên tuyệt đối `public.profiles.id` (UUID người dùng hiện có) và mọi khóa ngoại / lịch sử định danh trên `shops.owner_id`, `shop_memberships.user_id`, `payment_transactions.user_id`, `orders`, `order_audit_logs`, `table_service_requests`, `mobile_push_tokens`, `shop_sepay_configs`.
  - Mở rộng trigger `trg_prevent_profile_plan_escalation` (`public.prevent_client_profile_plan_escalation()`) để chặn client (`anon`, `authenticated`) tự gán hoặc sửa `profiles.zitadel_sub` và `profiles.id` bên cạnh `plan` và `plan_expires_at`.
  - Cấp quyền (grants) tối thiểu trên schema `public`/`auth`, bảng, sequence và các hàm helper RLS cho `anon`, `authenticated`, `service_role` trên PostgreSQL 14 thuần mà không phụ thuộc vào `ALTER DEFAULT PRIVILEGES` của Supabase Cloud.
- **Ánh xạ subject OIDC**: `sub` của Zitadel là định danh opaque, không đảm bảo bằng UUID hồ sơ Qlaok. Backend tra `profiles.zitadel_sub` rồi tiếp tục dùng `profiles.id` UUID cho session và JWT PostgREST. Không đổi khóa hồ sơ/khóa ngoại và không tự liên kết hồ sơ cũ chỉ dựa vào email.
- **Migration 022**: [`022_postgres_realtime_notifications.sql`](../supabase/migrations/022_postgres_realtime_notifications.sql)
  - Thêm trigger PostgreSQL `LISTEN/NOTIFY` cho đơn hàng và yêu cầu phục vụ; web/mobile nhận sự kiện qua SSE của Qlaok.

## 2. Trình tự áp dụng trên PostgreSQL 14 tự vận hành

Chỉ chạy trên môi trường PostgreSQL 14 đích khi được phép triển khai. Tuyệt đối không dùng tài khoản bypass RLS cho kết nối của người dùng cuối.

### Bước 1 — Chạy bootstrap trước migration

Thực thi [`supabase/self-hosted/000_bootstrap.sql`](../supabase/self-hosted/000_bootstrap.sql) bằng role quản trị DB (`postgres`):

```bash
psql -X -v ON_ERROR_STOP=1 -f supabase/self-hosted/000_bootstrap.sql
```

### Bước 2 — Áp dụng các migration theo đúng thứ tự tên file (001 → 022)

Trên VPS, dùng runner tự host. Runner áp dụng migration còn thiếu, từ chối checksum đã đổi và chỉ ghi nhận migration sau khi SQL chạy thành công:

```bash
npm run db:migrate
```

### Bước 3 — Ánh xạ định danh Zitadel vào `public.profiles`

Khi đồng bộ người dùng sang Zitadel, liên kết `sub` của Zitadel vào cột `public.profiles.zitadel_sub` thông qua kết nối server (`service_role` hoặc DB admin) và **giữ nguyên `public.profiles.id` (UUID hiện tại)**:

```sql
-- Chạy từ kết nối server/service_role trong bước provision/import đã xác thực
-- quan hệ 1:1 giữa tài khoản Zitadel và hồ sơ Qlaok.
UPDATE public.profiles
SET zitadel_sub = '<zitadel_subject_id>',
    updated_at = NOW()
WHERE id = '<existing_qlaok_user_uuid>';
```

## 3. Ràng buộc bảo mật bắt buộc

1. **Ngữ nghĩa `auth.uid()` fail-closed**:
   - `auth.uid()` chỉ đọc ngữ cảnh JWT do PostgREST đã xác thực chữ ký (`request.jwt.claim.sub` và `request.jwt.claims->>'sub'`).
   - Không bao giờ đọc hoặc tin cậy HTTP headers (`request.headers`), cookies (`request.cookies`) hay dữ liệu body.
   - Khi role đang hoạt động hoặc claim `role` là `anon`, khi thiếu claim, khi JSON lỗi, hoặc khi `sub` không phải UUID hợp lệ (ví dụ: Zitadel `sub` dạng số nguyên chưa qua bước ánh xạ sang UUID hoặc `staff-acct-*`), `auth.uid()` trả về `NULL` (fail-closed), không gây lỗi ép kiểu và không cấp quyền. API Qlaok phải tra `zitadel_sub`, xác thực hồ sơ tương ứng rồi mới phát JWT PostgREST mang UUID của `profiles.id`.
2. **Cô lập role PostgREST**:
   - Role kết nối của PostgREST (`authenticator`) phải là `NOINHERIT` và chỉ chuyển sang `anon` hoặc `authenticated` cho các request từ trình duyệt/mobile.
   - `service_role` có `BYPASSRLS` nên **chỉ** được sử dụng ở backend server đáng tin cậy; tuyệt đối không cấp token `service_role` cho người dùng cuối hoặc đưa vào `NEXT_PUBLIC_*` / `EXPO_PUBLIC_*`.
3. **Bảo vệ dữ liệu nhạy cảm & bất biến nghiệp vụ**:
   - Các bảng chỉ dành cho server (`schema_migrations`, `payment_bank_ref_conflicts`, `mobile_push_tokens`, `shop_sepay_configs`, `sepay_webhook_events`, `shop_staff_credentials`, `staff_login_rate_limits`) bị `REVOKE ALL` khỏi `PUBLIC`, `anon`, `authenticated`.
   - Toàn bộ RLS policies và bất biến định giá, tồn kho, trạng thái phục vụ (`status`) tách biệt với thanh toán (`payment_status`) trong các migration `001`–`020` được giữ nguyên.

## 4. Trạng thái cắt chuyển và vận hành

1. **PostgreSQL và RLS**: PostgreSQL 14 trên VPS là nguồn dữ liệu ứng dụng; PostgREST phục vụ API tương thích ở `https://qlaok.vunph.click/rest/v1`. Các migration tới `022_postgres_realtime_notifications.sql` được chạy bằng `scripts/migrate-self-hosted.mjs`, đối chiếu checksum trong `public.schema_migrations`; migration này không gọi Supabase Management API.
2. **JWT/RLS**: backend xác minh phiên Qlaok hoặc Zitadel rồi chỉ cấp PostgREST JWT ngắn hạn `role: 'authenticated'` với UUID `public.profiles.id` đã xác thực. `service_role` chỉ tồn tại trong server config; client không nhận khóa bypass RLS.
3. **Realtime**: PostgreSQL triggers phát `LISTEN/NOTIFY`; broker web và ứng dụng mobile dùng SSE có xác thực qua API Qlaok. Mobile giữ polling 30 giây làm phương án phục hồi khi SSE gián đoạn.
4. **Object storage**: upload ứng dụng dùng Garage S3 trên `https://s3.vunph.click`, bucket `qlaok-media`, public media dưới `/media/`. Cloudflare R2 chỉ còn là đường dự phòng nếu được cấu hình; production hiện không cấu hình R2.
5. **Đăng nhập Zitadel**: project `Qlaok` đang hoạt động với hai client Authorization Code + PKCE: `Qlaok Web` (User Agent, callback `https://qlaok.vunph.click/api/auth/callback`) và `Qlaok Mobile` (Native, callback `qlaok://auth/callback`). Web Client ID đã cấu hình trong env VPS; Native Client ID nằm trong `mobile/.env.example` và env local bị ignore. Client IDs cũng được lưu trong file backup secrets có quyền hạn chế. Subject OIDC được đối chiếu qua `profiles.zitadel_sub`; session Qlaok và JWT PostgREST vẫn dùng UUID hồ sơ gốc. Luồng đăng nhập web cần được kiểm tra sau deploy; luồng deep link mobile cần kiểm tra trên thiết bị.
6. **Sao lưu/reset dữ liệu**: `scripts/backup-qlaok-db.mjs`, `scripts/preflight-demo-reset.mjs` và demo reset hiện vẫn có ràng buộc an toàn theo project Supabase cũ; không dùng các script reset này với database tự host. Các bản backup trước cutover được giữ trong thư mục backup hạn chế quyền trên VPS; backup PostgreSQL tự host cần chạy bằng `pg_dump` trên VPS với quyền PostgreSQL quản trị và lưu vào thư mục backup hạn chế quyền.
