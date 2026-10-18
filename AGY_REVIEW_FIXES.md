> **Tài liệu lịch sử / đặc tả.** Nhãn cập nhật 18/10/2026: nội dung bên dưới giữ theo thời điểm ghi, không phải xác nhận trạng thái hiện tại. Xem [README](README.md), [ARCHITECTURE](ARCHITECTURE.md), [APP_REVIEW](docs/APP_REVIEW.md) và [quy trình CodeGraph bắt buộc](docs/CODEGRAPH_WORKFLOW.md) cho task tiếp theo. Không dùng mật khẩu mẫu hoặc chỉ dẫn khởi tạo index trong tài liệu cũ.

> Codex kiểm chứng bổ sung bằng `npm run test:sql` (PostgreSQL cô lập, chạy migration và thao tác RLS thật). Bốn test chỉ so khớp chuỗi source SQL đã được thay bằng kiểm thử thực thi; ba test membership DB mock vẫn giữ.

# AGY Review Fixes Report (Pre-Merge Blocker Resolution)

## Phạm vi thay đổi (Strict Scope)
Theo đúng yêu cầu phối hợp song song với Codex, chỉ chỉnh sửa và bổ sung các file sau (giữ nguyên toàn bộ các file khác, bao gồm `tests/unit.test.ts`):
1. `src/lib/shop-permissions.ts`
2. `supabase/migrations/004_memberships_billing_payments_audit.sql`
3. `tests/shop-permissions-and-rls.test.ts` (test suite độc lập kiểm chứng các blocker)
4. `AGY_REVIEW_FIXES.md` (báo cáo chi tiết)

---

## Chi tiết các Blocker đã xử lý

### 1. Authoritative & Fail-Closed Membership DB + Đồng bộ Schema `email` / `full_name`
- **Tách biệt rõ chế độ Supabase Authoritative và Local Demo / Test (`src/lib/shop-permissions.ts`)**:
  - Bổ sung `isShopMembershipDbAuthoritative()`: trả về `true` khi Supabase đã được cấu hình (`NEXT_PUBLIC_SUPABASE_URL` + key hợp lệ và không bật cờ test/local `QLAOK_MEMBERSHIP_MODE=local` / `QLAOK_FORCE_LOCAL_MEMBERSHIPS=1`).
  - Khi Supabase được cấu hình:
    - `dbGetShopMemberships(shopId)` và `dbGetUserShopMemberships(userId)` **chỉ truy vấn trực tiếp bảng `public.shop_memberships`**, tuyệt đối **không union/merge hay fallback về `.local-db/shop-memberships.json` hoặc seed demo**. Nhờ đó, nhân sự bị xóa hoặc bị thu hồi quyền (`is_active = false`) trên DB sẽ lập tức mất quyền truy cập.
    - Nếu truy vấn DB (`shop_memberships` hoặc `shops` trong `resolveUserShopMembership`) gặp lỗi hoặc ngoại lệ, hệ thống **fail closed** (trả về `[]` hoặc `null`), không fallback về `SEED_SHOPS` hay dữ liệu local.
    - `dbUpsertShopMembership` và `dbDeleteShopMembership` ghi trực tiếp vào `public.shop_memberships` (không ghi đệm `.local-db/shop-memberships.json`) và **không swallow lỗi DB write** — nếu Supabase trả về `error` hoặc ném ngoại lệ, hàm sẽ throw lỗi rõ ràng (`DB_UPSERT_MEMBERSHIP_FAILED` / `DB_DELETE_MEMBERSHIP_FAILED`).
  - Chế độ Local Demo (`.local-db/shop-memberships.json`) chỉ được dùng khi thật sự chưa cấu hình Supabase hoặc khi chạy ở chế độ local test rõ ràng.
- **Sửa mismatch cột `email` và `full_name` (`supabase/migrations/004_memberships_billing_payments_audit.sql`)**:
  - Bổ sung cột `email TEXT DEFAULT NULL` và `full_name TEXT DEFAULT NULL` vào định nghĩa `CREATE TABLE IF NOT EXISTS public.shop_memberships` cũng như lệnh idempotent `ALTER TABLE public.shop_memberships ADD COLUMN IF NOT EXISTS email TEXT DEFAULT NULL, ADD COLUMN IF NOT EXISTS full_name TEXT DEFAULT NULL;`.
  - Gỡ bỏ ràng buộc khóa ngoại cứng `shop_memberships_user_id_fkey` (`ALTER TABLE public.shop_memberships DROP CONSTRAINT IF EXISTS shop_memberships_user_id_fkey;`) để việc thêm nhân sự qua `dbUpsertShopMembership` không bị lỗi FK khi tài khoản nhân viên chưa có dòng trong `public.profiles`.
  - Cập nhật câu lệnh backfill owner trong migration `004` lấy kèm `p.email, p.full_name` từ `public.profiles` (`LEFT JOIN`).

### 2. Khóa chặt RLS & Trigger cập nhật `public.orders` + Loại bỏ phụ thuộc `request.jwt.claim.role`
- **RLS `public.orders` (`supabase/migrations/004_memberships_billing_payments_audit.sql`)**:
  - Giữ `"orders_owner_select"` (`FOR SELECT`) dùng `public.user_has_shop_permission(shop_id, 'orders.view')` để nhân viên (`staff`), thu ngân (`cashier`) và chủ quán (`owner`) nhận cập nhật đơn hàng realtime (read-only).
  - Thu hẹp `"orders_owner_update"` (`FOR UPDATE`) chỉ cho phép chủ quán thật (`public.user_is_shop_owner(shop_id)` — kiểm tra `shops.owner_id = auth.uid()::text`) để tương thích legacy nếu cần; `staff` và `cashier` không thể sửa trực tiếp bảng `public.orders` từ client mà bắt buộc đi qua Server API (`/api/orders` dùng `service_role` kiểm quyền granular).
- **Không dựa vào `current_setting('request.jwt.claim.role', true) = 'authenticated'`**:
  - Tạo hàm `public.is_client_request_context()` (`SECURITY INVOKER`, fail-closed): kiểm tra đầy đủ `request.jwt.claim.role`, `request.jwt.claims->>'role'`, `current_setting('role', true)`, `CURRENT_USER`, `SESSION_USER`, và `auth.uid()`. Chỉ trả về `FALSE` khi ngữ cảnh thực sự là `service_role` hoặc phiên quản trị DB trực tiếp (`postgres`/`supabase_admin` không mang JWT user). Nếu thiếu `request.jwt.claim.role` nhưng có `CURRENT_USER IN ('anon', 'authenticated')` hoặc có `auth.uid()`, hàm vẫn nhận diện đúng là client request (fail-closed).
- **Trigger `public.enforce_order_permission_boundaries()`**:
  - Chặn mọi thao tác update trực tiếp từ client nếu không phải chủ quán gốc (`public.user_is_shop_owner(OLD.shop_id)`).
  - Chặn sửa các trường định danh/bảo mật bất biến (`id`, `shop_id`, `order_code`, `tracking_token`).
  - Chặn đảo ngược `payment_status` từ `'paid'` hoặc `'refunded'` về `'unpaid'`, hoặc sửa trạng thái của đơn đã `'refunded'`.
  - Kiểm tra chặt quyền `payment.collect`, `payment.refund`, `discount.apply` (chỉ khi đơn còn `'unpaid'`), và `orders.edit_items` (khi thay đổi `items` hoặc `total_amount`, và chỉ khi đơn còn `'unpaid'`).

### 3. Khóa chặt RLS `public.shops` và `public.shop_memberships` chống leo thang đặc quyền + Đảm bảo Idempotency `003 -> 004`
- **RLS & Trigger `public.shops`**:
  - Đổi `"shops_owner_update"` từ `user_has_shop_permission(id, 'settings.manage')` về chỉ chủ quán thật (`USING (auth.uid()::text = owner_id) WITH CHECK (auth.uid()::text = owner_id)`), ngăn nhân sự có `settings.manage` sửa trực tiếp `owner_id` hoặc cấu hình ngân hàng `theme_config->'paymentQr'` qua Supabase client.
  - Bổ sung trigger `trg_enforce_shop_update_boundaries` (`BEFORE UPDATE ON public.shops`) chặn sửa `id`/`owner_id`, yêu cầu `user_is_shop_owner(OLD.id)`, và bắt buộc quyền `settings.bank` nếu `theme_config->'paymentQr'` thay đổi.
- **RLS & Trigger `public.shop_memberships`**:
  - Đổi `"shop_memberships_manage"` (`FOR ALL`) từ `user_has_shop_permission(shop_id, 'staff.manage')` về chỉ chủ quán thật (`USING (public.user_is_shop_owner(shop_id)) WITH CHECK (public.user_is_shop_owner(shop_id))`), kèm trigger `trg_enforce_shop_membership_boundaries`, ngăn tài khoản chỉ có `members.manage` tự cấp quyền `owner` trực tiếp trên DB. Mọi thao tác quản lý thành viên đều đi qua Server API.
- **Tính Idempotent khi chạy `003 -> 004` (và chạy lại `004` nhiều lần)**:
  - Toàn bộ bảng, cột, chỉ mục, constraint (`orders_payment_status_check` dùng vòng lặp xóa mọi check constraint cũ trên `payment_status` + `DROP CONSTRAINT IF EXISTS`), function (`CREATE OR REPLACE FUNCTION`), policy (`DROP POLICY IF EXISTS`), và trigger (`DROP TRIGGER IF EXISTS`) đều hoàn toàn idempotent.

---

## Kiểm chứng (Verification)
- Đã kiểm chứng trên PostgreSQL cô lập hoàn toàn bằng `@electric-sql/pglite` (tuyệt đối **không chạm DB thật**):
  1. `node --experimental-strip-types --import ./tests/register-ts.mjs --test tests/shop-permissions-and-rls.test.ts` -> **8/8 pass** (bao gồm chạy `001 -> 002 -> 003 -> 004` + chạy lại `003 -> 004` idempotent trên PGlite, kiểm chứng cột `email`/`full_name`, RLS và trigger chặn revert `paid -> unpaid` & sửa `tracking_token` ngay cả khi thiếu `request.jwt.claim.role`).
  2. `node --test tests/sql-review.test.mjs` -> **pass** (PGlite isolated PostgreSQL kiểm chứng boundary `staff`/`cashier`/`anon`/`service_role` trên `orders`, `shops`, `shop_memberships`).
  3. `src/lib/shop-permissions.ts` và `tests/shop-permissions-and-rls.test.ts` hoàn toàn sạch lỗi TypeScript.

