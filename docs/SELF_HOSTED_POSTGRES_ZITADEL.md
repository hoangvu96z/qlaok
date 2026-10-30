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
- **Migration 023**: [`023_restore_record_staff_login_failure_atomic.sql`](../supabase/migrations/023_restore_record_staff_login_failure_atomic.sql)
  - Khôi phục RPC ghi nhận thất bại đăng nhập nhân viên theo cách nguyên tử.
- **Migrations 20261028000100 và 20261028000200**:
  [`20261028000100_analytics_atomic_view_count.sql`](../supabase/migrations/20261028000100_analytics_atomic_view_count.sql) và [`20261028000200_floor_plan_active_orders_index.sql`](../supabase/migrations/20261028000200_floor_plan_active_orders_index.sql)
  - Tăng lượt xem món nguyên tử và giới hạn index sơ đồ bàn cho đơn còn hiệu lực/chưa thanh toán.
- **Migration 20261028000300**: [`20261028000300_orders_order_code_unique.sql`](../supabase/migrations/20261028000300_orders_order_code_unique.sql)
  - Thêm unique index cho mã đơn; nếu dữ liệu lịch sử đã trùng, migration dừng và yêu cầu đối soát trước khi áp dụng, không tự đổi mã đơn.
- **Migration 20261030000200**: [`20261030000200_reload_postgrest_schema_cache.sql`](../supabase/migrations/20261030000200_reload_postgrest_schema_cache.sql)
  - Phát `NOTIFY pgrst, 'reload schema';` idempotent, không sửa đổi schema hay dữ liệu khách hàng/nghiệp vụ, để làm mới ngay schema cache của PostgREST cho các bảng và hàm RPC đã áp dụng trước đó (như `public.increment_item_view_count`).
- **Migration 20261030000300**: [`20261030000300_admin_owner_invitation_claims.sql`](../supabase/migrations/20261030000300_admin_owner_invitation_claims.sql)
  - Đánh dấu hồ sơ chủ quán do Super Admin tạo là lời mời một lần; trigger chặn client tự tạo hoặc sửa cờ `owner_invite_pending`, còn backend đáng tin cậy có thể cập nhật cờ này.

## 2. Trình tự áp dụng trên PostgreSQL 14 tự vận hành

Chỉ chạy trên môi trường PostgreSQL 14 đích khi được phép triển khai. Tuyệt đối không dùng tài khoản bypass RLS cho kết nối của người dùng cuối.

### Bước 1 — Chạy bootstrap trước migration

Thực thi [`supabase/self-hosted/000_bootstrap.sql`](../supabase/self-hosted/000_bootstrap.sql) bằng role quản trị DB (`postgres`):

```bash
psql -X -v ON_ERROR_STOP=1 -f supabase/self-hosted/000_bootstrap.sql
```

### Bước 2 — Áp dụng các migration còn thiếu theo thứ tự tên file

Trên VPS, dùng runner tự host (`scripts/migrate-self-hosted.mjs`):

```bash
npm run db:migrate
```

- **Hợp đồng single-transaction cho từng migration**: Mỗi migration còn thiếu chạy nguyên tử trong một transaction riêng (`psql --single-transaction -f ...`, ngoại trừ một số file lịch sử đã tự khai báo cặp `BEGIN; ... COMMIT;` ở mức cao nhất để bảo toàn checksum bất biến), từ chối file đã áp dụng nhưng bị thay đổi checksum, và chỉ ghi nhận vào `public.schema_migrations` sau khi SQL của file đó hoàn tất thành công.
- **Tự động làm mới schema cache của PostgREST**: Sau khi toàn bộ lô migration đang chờ (`pending`) đã áp dụng và lưu vào `public.schema_migrations` thành công, runner phát đúng một lệnh `NOTIFY pgrst, 'reload schema'` để các bảng/hàm RPC mới xuất hiện ngay trên REST API. Runner **không** phát `NOTIFY` khi không có migration mới, **không** phát `NOTIFY` nếu SQL hoặc bước ghi `public.schema_migrations` gặp lỗi, và tránh phát trùng lặp nếu migration cuối cùng trong lô đã có sẵn `NOTIFY pgrst, 'reload schema'`.

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

1. **PostgreSQL và RLS**: PostgreSQL 14 trên VPS là nguồn dữ liệu ứng dụng; PostgREST phục vụ API tương thích ở `https://qlaok.vunph.click/rest/v1`. Các migration tới `20261030000300_admin_owner_invitation_claims.sql` được chạy bằng `scripts/migrate-self-hosted.mjs` theo hợp đồng một transaction mỗi file, đối chiếu checksum trong `public.schema_migrations` và phát `NOTIFY pgrst, 'reload schema'` một lần sau khi lô migration mới hoàn tất; migration runner không gọi Supabase Management API.
2. **JWT/RLS**: backend xác minh phiên Qlaok hoặc Zitadel rồi chỉ cấp PostgREST JWT ngắn hạn `role: 'authenticated'` với UUID `public.profiles.id` đã xác thực. `service_role` chỉ tồn tại trong server config; client không nhận khóa bypass RLS.
3. **Realtime**: PostgreSQL triggers phát `LISTEN/NOTIFY`; broker web và ứng dụng mobile dùng SSE có xác thực qua API Qlaok. Mobile giữ polling 30 giây làm phương án phục hồi khi SSE gián đoạn.
4. **Object storage**: upload ứng dụng dùng Garage S3 trên `https://s3.vunph.click`, bucket `qlaok-media`, public media dưới `/media/`. Cloudflare R2 chỉ còn là đường dự phòng nếu được cấu hình; production hiện không cấu hình R2.
5. **Đăng nhập Zitadel**: project `Qlaok` đang hoạt động với hai client Authorization Code + PKCE: `Qlaok Web` (User Agent, callback `https://qlaok.vunph.click/api/auth/callback`) và `Qlaok Mobile` (Native, callback `qlaok://auth/callback`). Web Client ID đã cấu hình trong env VPS; Native Client ID nằm trong `mobile/.env.example` và env local bị ignore. Client IDs cũng được lưu trong file backup secrets có quyền hạn chế. Subject OIDC được đối chiếu qua `profiles.zitadel_sub`; session Qlaok và JWT PostgREST vẫn dùng UUID hồ sơ gốc. Luồng đăng nhập web cần được kiểm tra sau deploy; luồng deep link mobile cần kiểm tra trên thiết bị.
7. **Sao lưu/reset dữ liệu**: `scripts/backup-qlaok-db.mjs`, `scripts/preflight-demo-reset.mjs` và demo reset hiện vẫn có ràng buộc an toàn theo project Supabase cũ; không dùng các script reset này với database tự host. PostgreSQL tự host dùng `scripts/backup-self-hosted-postgres.mjs` cùng systemd service/timer hằng ngày trong `ops/systemd/`; xem hướng dẫn cài đặt và diễn tập khôi phục ở cuối tài liệu.
8. **Giao diện đăng nhập, tự đăng ký & đặt lại mật khẩu Qlaok (Web + Native Mobile)**: Với từng client Qlaok Web và Qlaok Mobile, đặt Custom base URL của màn hình đăng nhập mới thành `https://qlaok.vunph.click` (không thêm `/login`; máy chủ đăng nhập sẽ tự mở đường dẫn `/login?authRequest=...`). Màn hình Qlaok xử lý trọn vẹn cả đăng nhập lẫn tự đăng ký tài khoản Chủ quán (họ tên, email, mật khẩu, xác nhận mật khẩu và xác thực mã OTP email) ngay trong giao diện VI/EN của Qlaok trên cả Web (`/login`) và ứng dụng di động (`AuthScreen`), không chuyển hướng người dùng sang biểu mẫu mặc định của Zitadel (`auth.vunph.click/ui/v2/login/...`). API route `/api/auth/login-ui` phía máy chủ gọi User API v2 hiện hành (`POST /v2/users/new` với wrapper `human`, `returnCode: {}`, tùy chọn `organizationId` và mật khẩu tạm CSPRNG không hoàn trả; `POST /v2/users/{id}/email/verify`; `PATCH /v2/users/{id}` với `human.password` chỉ đặt mật khẩu người dùng sau khi xác thực OTP email thành công; `POST /v2/users/{id}/email/resend` với `{ "returnCode": {} }`; đặt lại mật khẩu qua `action=password_reset_request` tra cứu chính xác email tài khoản người dùng đã xác thực bằng `POST /v2/users` rồi gọi `POST /v2/users/{id}/password_reset` với `returnCode: {}`; máy chủ Qlaok gửi email chứa URL đặt lại mật khẩu trên domain Qlaok trả về phản hồi đồng nhất `{ ok: true }`, và hoàn tất qua `action=password_reset_complete` gọi `POST /v2/users/{id}/password` với `verificationCode` cùng `newPassword.changeRequired = false`) và Session/OIDC API v2 (`POST /v2/sessions`, `PATCH /v2/sessions/{id}`, `POST /v2/oidc/auth_requests/{id}`) rồi hoàn tất yêu cầu để giữ nguyên callback OIDC + PKCE hiện có (`/api/auth/callback` trên Web và `qlaok://auth/callback` → `/api/auth` `oidc_mobile_exchange` trên Mobile). Để chức năng đăng nhập, tự đăng ký, đặt lại mật khẩu và xác thực email hoạt động an toàn trên Zitadel:
   - Email xác thực đăng ký, gửi lại mã và đặt lại mật khẩu được dựng từ `src/lib/auth-email-templates.ts` và gửi bởi máy chủ Qlaok qua SMTP; mỗi thư gồm tiếng Việt và tiếng Anh, có logo Qlaok. Mã xác thực không xuất hiện trên URL đăng ký; người dùng nhập mã tại màn hình đăng ký đang mở. Thông báo bảo mật phát sinh trực tiếp trong Zitadel vẫn do Zitadel gửi và được cấu hình riêng.
   - Cấu hình server-only: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, tùy chọn `SMTP_FROM_NAME` và `SMTP_SECURE`. Không đưa các biến này vào `NEXT_PUBLIC_*`, `EXPO_PUBLIC_*`, Git hoặc log. Cấu hình SMTP phải tồn tại trên server trước khi triển khai; khi thiếu cấu hình, chức năng gửi email trả lỗi thay vì báo thành công.
   - Theo hướng dẫn [ZITADEL Administrator Hardening](https://zitadel.com/docs/guides/manage/console/administrator-hardening), sử dụng một tài khoản dịch vụ (machine user) chuyên biệt đặt trong organization hệ thống/quản trị riêng và **chỉ cấp duy nhất role `IAM_LOGIN_CLIENT`** (tập quyền mặc định của `IAM_LOGIN_CLIENT` đã bao gồm các quyền quản lý người dùng cần thiết cho luồng đăng ký của Custom Login UI). **Không** gán thêm `ORG_USER_MANAGER` hoặc kết hợp các role quản trị khác vào tài khoản dịch vụ đăng nhập này; cấu hình PAT của tài khoản này vào biến server-only `ZITADEL_LOGIN_CLIENT_PAT` (kèm tùy chọn `ZITADEL_ORGANIZATION_ID` cho organization đích của người dùng mới).
   - Không bao giờ gửi mật khẩu của người dùng vào `POST /v2/users/new` trước khi hộp thư được xác thực, không bao giờ đánh dấu `isVerified: true` khi chưa xác thực mã OTP email, và bắt buộc `email_verified === true` (fail-closed; nếu `id_token` thiếu claim này thì kiểm tra thêm UserInfo trước khi quyết định) mới cho phép tạo hồ sơ chủ quán mới hoặc bổ sung email vào `public.profiles`.
   - Không đưa PAT vào GitHub Actions, `NEXT_PUBLIC_*`, `EXPO_PUBLIC_*`, nhật ký hay tệp trong repository.

9. **Nạp biến môi trường khi deploy PM2**: Trong `.github/workflows/deploy.yml`, trước khi khởi chạy ứng dụng trên cổng `3005`, workflow chỉ xóa tiến trình PM2 `qlaok` cũ (`pm2 delete qlaok` — giữ nguyên mọi ứng dụng PM2 khác) rồi khởi chạy với `env -i` và chỉ giữ `HOME`, `PATH`, `PM2_HOME`, `NODE_ENV`. Môi trường sạch ngăn cấu hình cũ từ tiến trình/SSH ghi đè `.env.local`; Next.js sẽ nạp cấu hình runtime hiện hành từ file đó. Workflow sau đó `pm2 save` và kiểm tra realtime/health.

## Sao lưu PostgreSQL tự host hằng ngày

[`scripts/backup-self-hosted-postgres.mjs`](../scripts/backup-self-hosted-postgres.mjs) chạy `pg_dump --format=custom` qua Unix socket dưới tài khoản hệ điều hành `postgres`, kiểm tra bảng mục lục bằng `pg_restore --list`, đặt quyền file `0600`, và dọn bản cũ theo thời hạn lưu giữ. Script không nhận database URL hay mật khẩu; PostgreSQL peer authentication phải cho phép user `postgres` đọc database.

Workflow deploy gọi [`scripts/install-self-hosted-postgres-backup.mjs`](../scripts/install-self-hosted-postgres-backup.mjs) bằng `sudo` sau khi checkout mã mới và **trước migration**. Installer chỉ trích xuất `QLAOK_DB_NAME` từ `.env.local`; nếu khóa đó không có thì dùng fallback `qlaok`, giống `scripts/migrate-self-hosted.mjs`. Nó không in giá trị môi trường. Installer tạo `/etc/qlaok/postgres-backup.env` nếu chưa có, giữ nguyên file hiện có nếu cấu hình hợp lệ và trùng database runtime, đồng thời dừng deploy nếu file sai hoặc xung đột. Nó chỉ ghi lại từng file unit systemd (`service`/`timer`) và chạy `systemctl daemon-reload` khi nội dung unit thực sự thay đổi so với bản đã cài (giữ nguyên file không đổi từng byte và chỉ áp lại quyền `root:root` `0644` tại chỗ nếu metadata bị lệch, không reload systemd chỉ vì sửa metadata). Ở lần cài đầu, installer tạo đúng một backup ban đầu và kiểm tra bằng `pg_restore --list`, sau đó mới bật timer hằng ngày. Marker ở `/var/lib/qlaok/postgres-backup-initial-verified-v1` ngăn các deploy tiếp theo tạo dump đầy đủ. Ở các lần cài lặp lại thông thường khi cả hai unit không đổi và timer đã `enabled` + `active`, installer chỉ thực hiện kiểm tra trạng thái chỉ đọc (`is-enabled`/`is-active`) mà không reload systemd, không chạy `enable --now` hay `restart` timer; nếu timer bị tắt/ngừng hoạt động thì tự phục hồi bằng `enable --now`, còn nếu bản thân unit timer thay đổi khi đang `enabled` + `active` thì reload rồi `restart` timer để áp dụng lịch mới (thay đổi chỉ ở unit service không làm restart timer). Nếu backup đầu tiên lỗi, installer trả lỗi đã lược bỏ chi tiết nhạy cảm và `set -e` dừng deploy trước migration.

Installer yêu cầu Node.js tại `/usr/bin/node`, user `postgres`, group `postgres`, `pg_dump`, `pg_restore`, `systemctl`, và quyền `sudo -n` cho các thao tác cài đặt của user deploy. Nó giữ các quyền sau: thư mục backup `postgres:postgres` `0700`, file cấu hình `root:postgres` `0640`, archive `0600`, service chạy bằng OS user `postgres` với systemd hardening hiện có. `TimeoutStartSec=35min` cho phép backup lớn hoàn tất trong giới hạn 30 phút của `pg_dump`.

Nếu deploy không chạy qua GitHub Actions, chạy installer thủ công từ checkout production sau khi xác nhận `.env.local` chứa đúng `QLAOK_DB_NAME`:

```sh
sudo -n /usr/bin/node /var/www/qlaok.vunph.click/scripts/install-self-hosted-postgres-backup.mjs
```

Nếu deploy dừng ở bước backup ban đầu, kiểm tra trạng thái và log service (không gửi nội dung `.env.local`):

```sh
sudo systemctl status qlaok-postgres-backup.service --no-pager
sudo journalctl -u qlaok-postgres-backup.service -n 80 --no-pager
```

Sau khi xử lý nguyên nhân, chạy lại installer. Nếu backup đầu tiên thành công thì installer ghi marker và migration có thể chạy ở lần deploy kế tiếp; installer không thay thế cấu hình sai. Để yêu cầu một backup thủ công sau lần khởi tạo, chạy:

```sh
sudo systemctl start qlaok-postgres-backup.service
sudo systemctl status qlaok-postgres-backup.service
sudo ls -l /var/backups/qlaok/postgres
```

`pg_restore --list` chỉ xác nhận archive đọc được. Diễn tập khôi phục định kỳ trên database tạm/staging riêng: tạo database đích, chạy `pg_restore --exit-on-error --no-owner --no-acl --dbname=<temporary-db> <backup.dump>`, kiểm tra các bảng nghiệp vụ cần thiết rồi xóa database kiểm thử. Thay đổi này chưa thực hiện khôi phục trên production. Backup database không bao gồm `.local-db`, file cấu hình hay object storage Garage; cần có chính sách sao lưu riêng cho các tài sản đó.
