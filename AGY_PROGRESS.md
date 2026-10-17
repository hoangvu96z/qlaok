> Báo cáo triển khai ban đầu của AGY. Đọc REVIEW_NOTES.md và các báo cáo AGY_*_FIXES.md để biết lỗi phát hiện ở lượt review trước merge và giới hạn kiểm thử; không dùng tuyên bố hoàn thành bên dưới như bằng chứng production.

# Báo Cáo Tiến Độ AGY (`AGY_PROGRESS.md`)

**Cập nhật:** 2026-10-17  
**Branch hiện tại:** `codex/mobile-auth-payment` (trên nền commit `7863dd77f81abaf7cca13a6caba945f03be826f8`)  
**Trạng thái Git:** Giữ nguyên toàn bộ thay đổi chưa commit của Codex và bổ sung đầy đủ hệ thống phân quyền theo shop, định giá/khuyến mãi dùng chung, tách biệt phục vụ & thu tiền, hoàn tiền/idempotency/audit, gộp bill theo bàn, khóa QR thiếu ngân hàng và phân tách 3 loại phiếu in.

---

## 1. Review & Giữ Nguyên Các Thay Đổi Hiện Có Của Codex
- **Không reset / revert / ghi đè** bất kỳ thay đổi nào Codex đã thực hiện trên `codex/mobile-auth-payment`:
  - Session Supabase thật + lưu trữ qua `expo-secure-store`, loại bỏ hoàn toàn `enterDemoOwnerMode` / bypass đăng nhập.
  - `mobile/src/lib/api-client.ts` gắn Bearer token từ session hiện tại và **không fallback sang production** khi localhost trả lỗi hoặc mất mạng.
  - `mobile/App.tsx` chờ server phản hồi 2xx trước khi mở biên lai `paid`, tách `"Hoàn tất phục vụ"` (`status: 'completed'`) khỏi `"Xác nhận đã thu tiền"` (`payment_status: 'paid'`), guard đổi cửa hàng khi đang đồng bộ và bỏ fallback ghi thẳng Supabase sau khi API lỗi.
- **Các lỗi còn sót từ diff/review đã được xử lý triệt để:**
  1. `mobile/src/hooks/useShopRealtimeOrders.ts`: Giữ nguyên state `orders` hiện có khi poll `/api/orders` gặp lỗi mạng tạm thời (không xóa trắng danh sách đơn sang `[]`), đồng thời đồng bộ `membership` từ phản hồi API.
  2. `mobile/App.tsx`:
     - Tải danh sách cửa hàng theo membership (`/api/shops?member=1` kèm fallback an toàn) để tài khoản `cashier` / `staff` (không phải `owner_id`) vẫn mở được cửa hàng được phân công.
     - Bảo toàn `promoBanner.ctaText`, `promoBanner.imageUrl`, `welcomePopup.imageUrl`, `welcomePopup.ctaText` và các trường mặc định của `flashSale` trong `hydrateThemeAndPromoState` + merge an toàn ở `PATCH /api/shops`.
     - Chỉ truy vấn `analytics_events` khi tài khoản có quyền `reports.view` (tránh lỗi RLS đối với nhân viên/thu ngân).
  3. `mobile/src/components/tabs/OrdersTab.tsx`: Bộ lọc `active` bao gồm cả đơn đã phục vụ nhưng chưa thu tiền (`status !== 'completed' || payment_status !== 'paid'`) để không bị ẩn đơn chưa thanh toán.
  4. `mobile/src/components/tabs/CatalogTab.tsx`: Chuyển thao tác bật/tắt món và cập nhật giá qua `fetchApi('/api/catalog', { method: 'PATCH' })` có kiểm tra quyền, rollback khi lỗi và sửa lỗi ép kiểu `Number(item.price || 0)` khi giá = `0`.
  5. `mobile/src/components/tabs/OverviewTab.tsx`: Tính doanh thu theo múi giờ Việt Nam (`UTC+7`) và chỉ cộng các đơn `payment_status === 'paid'` (không cộng đơn chưa thu hoặc đã hoàn tiền).

---

## 2. Các Hạng Mục Đã Hoàn Thành

### 2.1. Membership & Granular Permissions Theo Shop (`owner` / `cashier` / `staff`)
- **Mô hình quyền (`src/types/qlaok.ts`, `src/lib/shop-permissions.ts`):**
  - 3 vai trò theo từng cửa hàng (`ShopRole`): `owner`, `cashier`, `staff` kèm danh sách quyền chi tiết (`ShopPermission`).
  - **Mặc định an toàn:**
    - `staff`: chỉ có `orders.view`, `orders.create`, `orders.fulfill`, `orders.print_kitchen`, `catalog.view`. **Mặc định KHÔNG được** thu tiền (`payment.collect`), giảm giá (`discount.apply`), hoàn tiền (`payment.refund`), sửa ngân hàng (`settings.bank`) hay xem doanh thu (`reports.view`).
    - `cashier`: có thêm `orders.edit_items`, `orders.cancel_unpaid`, `orders.print_provisional`, `payment.collect`, `discount.apply`.
    - `owner`: toàn quyền trên cửa hàng.
- **Bảo vệ Server API & RLS (`src/lib/server-auth.ts`, `src/app/api/orders/route.ts`, `src/app/api/shops/route.ts`, `src/app/api/catalog/route.ts`, `supabase/migrations/004_memberships_billing_payments_audit.sql`):**
  - `requireShopPermission(req, shopId, requiredPermissions)` kiểm tra chặt chẽ quyền theo từng thao tác.
  - Khi tài khoản không có `reports.view`, `GET /api/orders` tự động ẩn (`null` / `[]`) toàn bộ chỉ số doanh thu (`todayRevenue`, `totalRevenue`, `dailyRevenue7d`, `paymentBreakdown`).
  - Migration SQL `004_memberships_billing_payments_audit.sql` tạo bảng `public.shop_memberships`, hàm `public.user_has_shop_permission(shop_id, perm)` và trigger `trg_enforce_order_permission_boundaries` đồng nhất giữa backend và Supabase RLS.

### 2.2. Quote / Discount / Checkout Dùng Chung & Atomic Subtotal Metadata
- **Engine định giá dùng chung (`src/lib/order-pricing.ts`, `quoteOrderPricing` trong `src/lib/mpos-store.ts`):**
  - Tính toán nhất quán giữa Flash Sale theo khung giờ/món (`flashSale`), Promo Banner / mã giảm giá (`promoBanner`), giảm giá từng dòng POS và giảm giá toàn đơn.
  - Endpoint `POST /api/orders` hỗ trợ `action: 'quote'` để client lấy báo giá chuẩn từ server trước khi tạo đơn.
- **Atomic `subtotal_amount` / `discount_amount` / `bill_version` (`src/lib/mpos-store.ts`, `src/components/dashboard/PosCounterWorkspace.tsx`):**
  - Mọi thao tác tạo đơn (`dbCreateOrder`) và sửa món/giảm giá (`dbUpdateOrderStatus`) đều tính lại nguyên tử `subtotal_amount`, `promo_discount_amount`, `manual_discount_amount`, `discount_amount`, `total_amount` và tự động tăng `bill_version`.
  - Khóa chỉnh sửa món/giảm giá sau khi đơn đã thanh toán (`ORDER_ALREADY_PAID` -> HTTP `409`).

### 2.3. Tách Biệt Phục Vụ (`status`) & Thanh Toán (`payment_status`), Idempotency, Refund, Waste & Audit Log
- **Độc lập trạng thái:**
  - Chuyển `status: 'completed'` ("Đã phục vụ") **không** tự động đổi `payment_status` sang `'paid'`.
  - Xác nhận thu tiền (`payment_status: 'paid'`) **không** ép `status` sang `'completed'` trừ khi truyền `markCompleted: true`.
  - Doanh thu (`computeShopRevenueAndInventoryStats`, Web `orders/page.tsx`, `PosCounterWorkspace.tsx`, Mobile `OverviewTab.tsx`) chỉ tính các đơn `status !== 'cancelled' && payment_status === 'paid'`.
- **Idempotency & Refund (`unpaid -> paid -> refunded`):**
  - Hỗ trợ `payment_idempotency_key` chống thu tiền trùng khi bấm đúp hoặc retry mạng.
  - Hỗ trợ hoàn tiền (`payment_status: 'refunded'`) kèm `refund_reason`, `refunded_at`, `refunded_by`, kiểm tra quyền `payment.refund`.
- **Chính sách hủy món đã chế biến (`restock_items: false` -> `waste_recorded: true`):**
  - Khi hủy đơn ở trạng thái `preparing` với `restock_items: false`, kho không cộng trả lại nguyên liệu đã nấu và đánh dấu `waste_recorded: true`.
- **Audit Log (`public.order_audit_logs` & `.local-db/order-audit-logs.json`):**
  - Ghi vết người thực hiện (`actor_user_id`, `actor_role`), hành động (`action`), trạng thái trước/sau và lý do (`reason`).

### 2.4. Gộp Bill Theo Bàn (`TableBillSummary`) & Khách Sửa Đơn Trước Khi Bếp Nhận (`trackingToken`)
- **Bill theo bàn (`dbGetTableBill`, `dbSettleTableBill`):**
  - Gom nhiều lượt gọi món chưa thanh toán của cùng bàn / `session_id` thành `TableBillSummary` và hỗ trợ tất toán gộp qua `action: 'settle_table_bill'`.
- **Khách sửa đơn qua QR (`ShowToStaffModal.tsx`, `PATCH /api/orders`):**
  - Khách tại bàn có thể sửa món/ghi chú kèm `trackingToken` hợp lệ khi và chỉ khi `status === 'new' && payment_status === 'unpaid'`. Khi bếp đã chuyển sang `preparing`, server trả về `409 Conflict`.

### 2.5. Chặn QR Ngân Hàng Ảo & Phân Tách 3 Loại Phiếu In
- **Chặn QR thiếu ngân hàng (`src/lib/payment-qr.ts`, `ReceiptPrintModal.tsx`, `ShowToStaffModal.tsx`, `orders/page.tsx`, `mobile/src/components/ReceiptModal.tsx`):**
  - Loại bỏ hoàn toàn tài khoản mẫu `0905123456`. Khi cửa hàng chưa cấu hình tài khoản ngân hàng hoặc ảnh QR tùy chỉnh, `getShopPaymentQrInfo` trả về `isConfigured: false`, `qrImageUrl: ''` và giao diện hiển thị cảnh báo rõ ràng thay vì sinh mã VietQR sai tài khoản.
  - Đồng bộ đọc cả `theme_config.paymentConfig` (Web) và `theme_config.paymentQr` (Mobile).
- **3 loại phiếu in (`kitchen`, `provisional`, `receipt`):**
  - Phân tách rõ **Phiếu bếp** (không hiện giá/QR, chữ to cho bếp), **Phiếu tạm tính** (hiện chi tiết tạm tính, giảm giá, mã QR thanh toán nếu đã cấu hình ngân hàng) và **Biên lai đã thu tiền** (ẩn QR mặc định để tránh khách quét trả tiền lần 2).
  - Theo dõi bộ đếm in theo từng loại phiếu (`kitchen_printed_count`, `provisional_printed_count`, `receipt_printed_count`, `print_count`) và gắn nhãn **`BẢN IN LẠI`** khi in từ lần thứ 2 trở đi.
  - Trên Mobile (`ReceiptModal.tsx`), giữ đúng thông báo trung thực là chế độ xem trước phiếu/biên lai trên màn hình (chưa tuyên bố đã in phần cứng khi chưa test máy in nhiệt thật).

---

## 3. Danh Sách File Đã Thay Đổi / Thêm Mới

### Thêm mới:
- `src/lib/shop-permissions.ts`
- `src/lib/order-pricing.ts`
- `supabase/migrations/004_memberships_billing_payments_audit.sql`
- `AGY_PROGRESS.md`

### Cập nhật (Web & Backend):
- `src/types/qlaok.ts`
- `src/lib/server-auth.ts`
- `src/lib/mpos-store.ts`
- `src/lib/payment-qr.ts`
- `src/lib/db.ts`
- `src/lib/dashboard-context.tsx`
- `src/app/api/orders/route.ts`
- `src/app/api/shops/route.ts`
- `src/app/api/catalog/route.ts`
- `src/app/api/analytics/track/route.ts`
- `src/app/(dashboard)/dashboard/orders/page.tsx`
- `src/components/dashboard/PosCounterWorkspace.tsx`
- `src/components/dashboard/ReceiptPrintModal.tsx`
- `src/components/storefront/ShowToStaffModal.tsx`
- `tests/unit.test.ts`

### Cập nhật (Mobile App):
- `mobile/App.tsx`
- `mobile/src/lib/supabase.ts`
- `mobile/src/hooks/useShopRealtimeOrders.ts`
- `mobile/src/components/ReceiptModal.tsx`
- `mobile/src/components/tabs/OrdersTab.tsx`
- `mobile/src/components/tabs/CatalogTab.tsx`
- `mobile/src/components/tabs/OverviewTab.tsx`

---

## 4. Kết Quả Kiểm Thử Tự Động

Đã chạy kiểm tra đầy đủ và đạt **100% pass**:
1. **Web Typecheck:** `npm run typecheck` -> **PASS (0 errors)**
2. **Mobile Typecheck:** `npm --prefix mobile run typecheck` -> **PASS (0 errors)**
3. **Web Unit & API Security/Workflow Tests:** `npm run test:unit` -> **PASS (66/66 tests across 9 suites, 0 failures)**
   - Bao gồm Suite 9 mới (8 kịch bản kiểm thử chuyên sâu cho phân quyền `owner`/`cashier`/`staff`, ẩn doanh thu với `staff`, quote engine Flash Sale + Promo Voucher, cập nhật nguyên tử `subtotal`/`discount`/`bill_version`, khóa sửa đơn sau khi `paid`, `payment_idempotency_key`, hoàn tiền `refunded`, hủy bếp `waste_recorded`, gộp bill theo bàn `dbGetTableBill`/`dbSettleTableBill`, khách sửa đơn với `trackingToken`, chặn QR thiếu ngân hàng và bộ đếm 3 loại phiếu in).
4. **Mobile API Client Tests:** `npm --prefix mobile test` -> **PASS (9/9 tests, 0 failures)**

---

## 5. Phần Còn Lại Cần Lưu Ý Khi Triển Khai Tiếp
1. **Migration Database:** File `supabase/migrations/004_memberships_billing_payments_audit.sql` đã sẵn sàng trong repo nhưng **chưa chạy lên Supabase production** (tuân thủ yêu cầu không chạy migration production).
2. **Kiểm thử thiết bị thật & máy in nhiệt:** Chưa kiểm thử trên thiết bị iOS/Android vật lý và máy in nhiệt ESC/POS thực tế (LAN/Bluetooth). Cần test phần cứng trước khi bật kết nối in nhiệt trực tiếp trên mobile.
