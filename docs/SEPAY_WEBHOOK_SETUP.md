# Đối soát tự động VietQR cho đơn hàng khách tại quán qua SePay

Tài liệu kỹ thuật và hướng dẫn cấu hình tính năng tự động gạch nợ đơn hàng khách (`ShopOrder`) khi chuyển khoản VietQR qua SePay.

> **Tách biệt hoàn toàn với nâng cấp gói SaaS:**
> - `/api/webhooks/payment` dùng `PAYMENT_WEBHOOK_SECRET` chỉ phục vụ chủ quán thanh toán nâng cấp gói SaaS (`Basic`/`Premium`) cho nền tảng Qlaok.
> - `/api/webhooks/sepay/[shopId]` dùng khóa HMAC riêng của từng cửa hàng (mã hóa AES-256-GCM tại DB bằng `SEPAY_SECRET_ENCRYPTION_KEY`) chỉ phục vụ đối soát tiền khách thanh toán đơn hàng (`public.orders`) cho chính cửa hàng đó.

---

## 1. Biến môi trường bắt buộc phía Server

Thêm biến môi trường sau vào `.env.local` / môi trường production trên server (tuyệt đối **không** đặt tiền tố `NEXT_PUBLIC_` hay `EXPO_PUBLIC_`):

```bash
# Khóa chủ (Master Key) tối thiểu 32 ký tự để mã hóa AES-256-GCM khóa HMAC SePay của từng cửa hàng.
# Không có giá trị mặc định: nếu thiếu hoặc < 32 ký tự, API lưu cấu hình và nhận webhook trả 503.
SEPAY_SECRET_ENCRYPTION_KEY=replace-with-at-least-32-char-random-sepay-encryption-key
```

Có thể sinh khóa ngẫu nhiên bằng lệnh:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 2. Lưu trữ khóa bí mật và ranh giới bảo mật (RLS)

1. **Tách khỏi `theme_config` / dữ liệu công khai của cửa hàng:**
   - Khóa HMAC SePay của từng quán được lưu riêng trong bảng `public.shop_sepay_configs` (`supabase/migrations/011_sepay_order_reconciliation.sql`), **không** nằm trong `public.shops.theme_config`.
   - Trigger SQL `trg_prevent_sepay_secret_in_shop_theme` và hàm kiểm tra `assertNoSePaySecretInThemeConfig` tại `POST/PATCH /api/shops` chặn mọi nỗ lực ghi `sepaySecret`, `webhookSecret`, `secret_ciphertext`, `hmacSecret` vào `theme_config`.
2. **Mã hóa tại chỗ (Encryption at Rest):**
   - Trước khi ghi xuống DB, server dẫn xuất khóa con bằng `HKDF-SHA256(SEPAY_SECRET_ENCRYPTION_KEY)` và mã hóa bằng `AES-256-GCM` với IV 96-bit ngẫu nhiên, gắn `shop_id` làm Additional Authenticated Data (`AAD = qlaok:sepay:shop:<shopId>:v1`). Ciphertext của quán A không thể giải mã dưới ngữ cảnh quán B.
3. **Quyền Chủ quán (Owner-only) & Redaction:**
   - Chỉ Chủ quán (`owner`) hoặc Super Admin mới được xem trạng thái cấu hình hoặc cập nhật/xóa khóa HMAC SePay (`GET /api/shops?action=sepay_config&shopId=...`, `POST /api/shops` với `action: 'upsert_sepay_config' | 'delete_sepay_config'`, hoặc `GET /api/webhooks/sepay/[shopId]`). Thu ngân (`cashier`) và Nhân viên (`staff`) bị từ chối `403`.
   - Mọi response API trả về cho chủ quán chỉ gồm trạng thái đã cấu hình (`configured`, `enabled`, `hasSecret`, `callbackUrl`, `expectedAccountNumber`, `transferPrefix`, `updatedAt`), **không bao giờ** trả lại plaintext secret hay ciphertext.
4. **Row Level Security (RLS):**
   - `public.shop_sepay_configs` và `public.sepay_webhook_events` bật RLS với policy `AS RESTRICTIVE` chỉ cho phép `auth.role() = 'service_role'`, đồng thời `REVOKE ALL` khỏi `PUBLIC, anon, authenticated`.

---

## 3. Hợp đồng xác thực & đối soát Webhook SePay

Theo tài liệu chính thức của SePay:
- [Xác thực Webhook HMAC-SHA256](https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc)
- [Tích hợp Webhooks SePay](https://docs.sepay.vn/tich-hop-webhooks.html)

### 3.1. Giới hạn kích thước raw body & xác thực chữ ký số trước khi parse JSON
- **Giới hạn kích thước raw body (`64 KiB`):** Trước khi cấp phát bộ đệm hoặc xác thực chữ ký, endpoint kiểm tra cả `Content-Length` và luồng dữ liệu (`req.body` stream) với ngưỡng tối đa `SEPAY_MAX_WEBHOOK_BODY_BYTES = 65536` (`64 KiB`). Mọi request vượt ngưỡng bị ngắt luồng ngay lập tức và trả `413 PAYLOAD_TOO_LARGE` mà không parse JSON hay ghi ledger.
- Header yêu cầu:
  - `X-SePay-Signature: sha256=<hex_digest>`
  - `X-SePay-Timestamp: <timestamp>`
- Chuỗi ký: `{timestamp}.{raw_body}` trên đúng mảng byte nguyên bản trước khi gọi `JSON.parse`.
- So sánh bằng `crypto.timingSafeEqual`. Nếu chữ ký sai, thiếu header hoặc body bị chỉnh sửa dù chỉ 1 ký tự khoảng trắng, endpoint trả `401` ngay lập tức.

### 3.2. Các điều kiện an toàn bắt buộc trước khi gạch nợ
Một giao dịch từ SePay chỉ được phép đánh dấu đơn hàng là `paid` khi thỏa mãn **đồng thời** tất cả điều kiện sau:
1. **Đúng cửa hàng (`shopId`):** Webhook gửi tới `/api/webhooks/sepay/[shopId]` chỉ giải mã khóa và tìm đơn trong phạm vi `shopId` đó.
2. **Giao dịch tiền vào (`transferType === 'in'`):** Giao dịch tiền ra (`out`) bị từ chối (`422 OUTBOUND_TRANSFER`).
3. **Khớp tài khoản ngân hàng nhận tiền (`accountNumber`):** Cửa hàng phải đang bật chế độ VietQR tự động (`vietqr_auto`) và `payload.accountNumber` (sau khi chuẩn hóa) phải khớp chính xác với số tài khoản nhận tiền đã cấu hình của quán (`422 ACCOUNT_NUMBER_MISMATCH` hoặc `422 SHOP_BANK_ACCOUNT_NOT_CONFIGURED`).
4. **Khớp duy nhất mã đơn (`order_code`) kèm tiền tố chuyển khoản (`transferPrefix`) và chống đụng độ liên cửa hàng:**
   - Nội dung chuyển khoản (`content`/`code`) phải chứa mã `ORD-<số>` đứng ngay sau tiền tố đã cấu hình của quán (mặc định `QLAOK`, hỗ trợ cả dạng ngân hàng tự xóa khoảng trắng hoặc dấu gạch ngang như `QLAOK ORD-1234` hoặc `QLAOKORD1234`, đồng thời không khớp nhầm tiền tố dài hơn của quán khác như `QLAOK-SPA ORD-1234`).
   - Nếu nội dung nhắc tới từ 2 mã `ORD-...` khác nhau trở lên, giao dịch bị từ chối do mơ hồ (`409 AMBIGUOUS_ORDER_CODE`).
   - Mã đơn trích xuất được phải tồn tại duy nhất trong chính cửa hàng đó (`422 ORDER_NOT_FOUND`).
   - **Bảo vệ chống gạch nợ kép khi nhiều cửa hàng dùng chung tài khoản nhận tiền (SePay fan-out):** Khi tạo đơn mới, `dbCreateOrder` đảm bảo `order_code` không trùng trên toàn hệ thống. Ngoài ra, nếu hai cửa hàng dùng chung cùng một số tài khoản ngân hàng và cùng `transferPrefix` lại đang có đơn VietQR trùng `order_code` (ví dụ đơn cũ/legacy), cả hai đầu nhận webhook đều từ chối an toàn (`409 AMBIGUOUS_ORDER_CODE`) và không đánh dấu `paid` cho bất kỳ đơn nào cho tới khi tách biệt `transferPrefix`.
5. **Trạng thái và phương thức của đơn hàng:**
   - `payment_method === 'vietqr'` (đơn tiền mặt `cash` bị từ chối `422 PAYMENT_METHOD_NOT_VIETQR`).
   - `status !== 'cancelled'` (đơn đã hủy bị từ chối `409 ORDER_CANCELLED`).
   - `payment_status === 'unpaid'` (đơn đã thanh toán bởi giao dịch khác bị từ chối `409 ORDER_ALREADY_PAID`).
6. **Khớp chính xác số tiền VND (`transferAmount === total_amount`):** Chuyển thiếu hoặc thừa dù 1 VND đều bị từ chối (`422 AMOUNT_MISMATCH`) và tuyệt đối không tự động đánh dấu `paid`.

### 3.3. Tính nguyên tử, chống lặp (Idempotency), tự phục hồi khi retry và độc lập với trạng thái phục vụ
- Thực thi trong PostgreSQL qua RPC `public.reconcile_sepay_order_payment_atomic` (`SECURITY DEFINER`, khóa `pg_advisory_xact_lock` toàn cục + theo cửa hàng và `FOR UPDATE` trên dòng `public.orders`):
  - **Lặp lại sau khi đã gạch nợ (`outcome = 'reconciled'`):** Nếu SePay gửi lại cùng `(shop_id, id)` với cùng `payload_hash` sau khi giao dịch đã đối soát thành công, RPC tăng `delivery_count` và endpoint trả `200 { "success": true, "reconciled": true, "duplicate": true }` mà không ghi trùng hay đổi `paid_at`.
  - **Tự phục hồi khi SePay retry các giao dịch bị từ chối tạm thời (`outcome = 'rejected'`):** Nếu lần gửi đầu bị từ chối tạm thời (ví dụ `ORDER_NOT_FOUND` do webhook tới sớm hơn thời điểm đơn kịp commit, hoặc chủ quán vừa sửa lại số tài khoản/`transferPrefix`), khi SePay retry cùng `(shop_id, id)` với đúng `payload_hash` ban đầu, hệ thống sẽ **đánh giá lại** theo trạng thái đơn/cấu hình hiện tại để gạch nợ thành công một lần duy nhất thay vì kẹt vĩnh viễn ở trạng thái từ chối.
  - **Tái sử dụng xung đột & chống gạch nợ chéo toàn cục:** Nếu cùng `id` sự kiện nhưng payload thay đổi (`payload_hash` khác), hoặc `sepay_transaction_id` / `reference_code` đã được dùng để gạch nợ (`outcome = 'reconciled'`) cho bất kỳ đơn hàng nào khác (kể cả ở cửa hàng khác), hệ thống từ chối với `409 CONFLICTING_WEBHOOK_EVENT` hoặc `409 REFERENCE_CODE_ALREADY_USED` (được bảo vệ bởi unique index toàn cục `idx_sepay_webhook_events_global_reconciled_tx` và `idx_sepay_webhook_events_global_reconciled_ref`).
  - **Độc lập hoàn toàn giữa Thanh toán và Phục vụ/Bếp:** Khi đối soát thành công, chỉ cập nhật `payment_status = 'paid'`, `paid_at`, `paid_by = 'sepay:<txId>:<refCode>'`, `payment_idempotency_key = 'sepay:<shopId>:<txId>'` và ghi `order_audit_logs`. Trường `status` (`new`, `preparing`, `completed`), tổng tiền và tồn kho **không bao giờ** bị thay đổi bởi webhook thanh toán.
  - Sau khi commit thành công, `OrderEventsBroker.notifyOrderChange(shopId, orderId)` phát tín hiệu SSE để cả màn hình POS/KDS của quán và màn hình theo dõi đơn của khách tự động cập nhật trạng thái `Đã thanh toán`.

---

## 4. Các bước cài đặt trên Qlaok & SePay Dashboard

1. **Bước 1 — Cấu hình tài khoản nhận tiền VietQR trên Qlaok:**
   - Đăng nhập bằng tài khoản **Chủ quán (`owner`)** → vào `/dashboard/settings` → tab **Ngân hàng & VietQR**.
   - Chọn chế độ **Tự động tạo mã VietQR chuẩn Napas247**, chọn ngân hàng, nhập chính xác **Số tài khoản nhận tiền** (khớp với số tài khoản hoặc VA nhận webhook trên SePay) và **Tiền tố nội dung CK** (mặc định `QLAOK`), sau đó bấm **Lưu cài đặt**.
   - **Lưu ý quan trọng khi nhiều cửa hàng dùng chung một tài khoản ngân hàng:** Nếu bạn đăng ký nhiều Callback URL của nhiều cửa hàng vào cùng một tài khoản ngân hàng trên SePay, **bắt buộc** đặt **Tiền tố nội dung CK (`transferPrefix`) khác nhau** cho từng cửa hàng (ví dụ: `QLAOK-Q1`, `QLAOK-Q3`) để phân tách nội dung chuyển khoản rõ ràng.
2. **Bước 2 — Cấu hình khóa bí mật HMAC và lấy Callback URL:**
   - Ngay bên dưới khung cấu hình VietQR trong tab **Ngân hàng & VietQR**, tại mục **Đối soát tự động VietQR qua SePay (Webhook)**:
   - Sao chép **Callback URL riêng của quán** (`https://<ten-mien>/api/webhooks/sepay/<shopId>`).
   - Nhập **Secret Key (HMAC-SHA256)** của bạn (tối thiểu 16 ký tự), bật công tắc kích hoạt và bấm **Lưu cấu hình SePay**.
3. **Bước 3 — Cấu hình trên SePay Dashboard (`https://my.sepay.vn`):**
   - Vào mục **Tích hợp Webhooks** → **Thêm Webhook**.
   - **Gọi tới URL:** Dán đúng Callback URL riêng của quán (`/api/webhooks/sepay/<shopId>`).
   - **Sự kiện:** Chỉ khi có **Tiền vào (`in`)** trên tài khoản ngân hàng của quán.
   - **Kiểu chứng thực:** Chọn **HMAC-SHA256 (`X-SePay-Signature` + `X-SePay-Timestamp`)** và nhập cùng **Secret Key** đã lưu ở Bước 2.
   - **Kiểu dữ liệu:** `application/json`.
