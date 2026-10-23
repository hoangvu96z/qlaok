> Báo cáo nền của lượt rà soát tài liệu ban đầu (18/10/2026, giữ nguyên tính lịch sử bên dưới). Xem thêm phần **Cập nhật rà soát và đóng lỗi — 23/10/2026** ở cuối tài liệu, [kết quả kiểm thử bàn/theme](CODEX_TABLES_REVIEW.md) và [hướng dẫn quản lý bàn](TABLE_MANAGEMENT.md).

# Rà soát app và tài liệu — 18/10/2026 (Lịch sử)

## Phạm vi và phương pháp

Rà soát cấu trúc và các luồng chính qua CodeGraph explore/node, status/files, manifest, migration inventory, CI và tài liệu có sẵn. Mục tiêu là chuẩn bị context/rules cho task tiếp, không sửa nghiệp vụ hoặc chạy deployment. Kết quả không phải kiểm toán bảo mật toàn bộ source hay xác minh production.

## Các chênh lệch đã chỉnh trong tài liệu hiện hành

| Nội dung cũ | Hiện trạng đã đối chiếu |
| --- | --- |
| Menu 5 ngôn ngữ | Type hỗ trợ 8, Premium maxLangs 8; quản trị VI/EN riêng |
| Node >=20 đủ cho mọi kiểm tra | Hướng dẫn dùng Node 24 như verify CI và test strip-types |
| Chỉ migration 001/002 | Có thêm 002z, 003, 004, 005, 006 |
| Web subscribe trực tiếp/nhận đơn đồng nghĩa thu tiền | Web SSE broker; payment và fulfillment độc lập |
| Local JSON đồng bộ/offline như DB thật | Orders dùng DB authoritative khi được cấu hình; không ghép local vào canonical response |
| Mobile mới có overview/catalog/settings | Có orders, promotions, membership, Supabase Auth và VI/EN |
| Doanh thu mobile ước tính từ Show to Staff | Hướng dẫn phân biệt order revenue và analytics tương tác |
| Route `/api/items` | Không có trong cây route hiện tại |
| Mật khẩu admin mẫu | Chỉ khởi tạo credential khi cấu hình env rõ ràng |
| Test count cố định và “100%” sẵn sàng | Chỉ ghi kết quả của lần chạy, giữ giới hạn thiết bị/ngân hàng/production |
| CodeGraph là gợi ý | Rule bắt buộc với MCP → CLI → báo lỗi/dừng sửa code nếu không có fallback được phép |

## Điểm cần theo dõi cho task tiếp

1. **Webhook SaaS (ghi nhận ngày 18/10/2026 — đã đóng và gia cố bảo mật ngày 23/10/2026):** Thời điểm 18/10, `verifyWebhookSignatureOrSecret` còn secret fallback trong source khi không cấu hình env. *Cập nhật hiện trạng 22/10/2026 - 23/10/2026:* `getConfiguredWebhookSecret` và `verifyWebhookSignatureOrSecret` tại `src/app/api/webhooks/payment/route.ts` đã bỏ hoàn toàn secret mặc định (HTTP `503` khi thiếu env). Đã hoàn tất đóng các hạng mục trọng yếu của Section 1.5: bắt buộc số tiền dương hợp lệ (`PAYMENT_AMOUNT_REQUIRED` / `INVALID_PAYMENT_AMOUNT`), kiểm tra hướng giao dịch tiền vào (`INVALID_TRANSFER_TYPE` khi `transferType !== 'in'`), loại bỏ triệt để fallback `SEED_TRANSACTIONS` khi lỗi tra cứu DB (fail-closed HTTP `500`, bảo toàn HTTP `404` khi không tìm thấy đơn), và hoàn tất tích hợp RPC nguyên tử `complete_payment_webhook_atomic` (migration 015) đồng bộ trạng thái đơn thanh toán và nâng gói profile trong cùng transaction Postgres, loại bỏ fallback 2 bước ghi client. *Hạng mục Section 1.5 còn mở cần theo dõi tiếp:* Phạm vi tài khoản thanh toán / định danh tài khoản nhận tiền đa quán (billing-account scoping) vẫn tiếp tục mở để hoàn thiện ở các đợt phát triển tiếp theo.
2. **Health (ghi nhận ngày 18/10/2026 — đã đóng/đối chiếu ngày 23/10/2026):** Thời điểm 18/10 ghi nhận `GET /api/health` gọi seed và vẫn trả `status: ok` dù readiness false. *Cập nhật hiện trạng 23/10/2026:* Code hiện tại (`src/app/api/health/route.ts`) và test hồi quy (`tests/admin-review.test.ts`) xác nhận khi readiness thất bại, endpoint trả `status: 'degraded'` và HTTP `503`. Vẫn giữ lưu ý: HTTP 200 đơn thuần không làm bằng chứng mọi dịch vụ hoặc provider tùy chọn đều hoạt động.
3. **Khả năng mở rộng:** order reload/statistics còn dựa lịch sử đầy đủ; catalog không có stream riêng.
4. **Tooling:** root `lint` dùng `next lint`, thiếu cấu hình/dependency ESLint; không khẳng định lint pass. CodeGraph status cảnh báo index từ engine cũ; graph không thay compiler/test.
5. **Tài chính/vận hành:** cần đối chiếu legacy bank-ref archive và local-only orders trước rollout tương ứng; chốt ca/ledger và kiểm thử thiết bị/máy in còn giới hạn trong notes hiện có.

Đây là các giới hạn quan sát được hoặc được ghi nhận từ review trước, không phải task triển khai đã được người dùng yêu cầu trong lượt này.

## Tài liệu/rule sau cập nhật

- `README.md`: entry point vận hành hiện tại.
- `ARCHITECTURE.md`: bản đồ route/core, auth, orders/payment, realtime, locale, rollout và giới hạn.
- `AGENTS.md`: quy tắc root cho Codex và coding agent.
- `.agent/rules/codegraph.md`: always-on rule cho AGY/Antigravity.
- `GEMINI.md`: entry point bổ sung cho AGY/Gemini.
- `docs/CODEGRAPH_WORKFLOW.md`: workflow chung, ngoại lệ và bằng chứng bàn giao.
- `mobile/README.md`: hướng dẫn mobile và giới hạn thiết bị.
- Báo cáo cũ, roadmap và đặc tả giữ nội dung lịch sử, thêm nhãn và link hiện trạng để không bị hiểu là trạng thái latest.

## Kiểm chứng lượt này

Đã chạy và pass ngày 18/10/2026:

- `npm run typecheck` và `npm run typecheck --prefix mobile`.
- `npm run test:unit`, `npm run test:review` (38 pass), `npm run test:sql` (1 pass), `npm test --prefix mobile` (18 pass).
- `git diff --check` và kiểm tra tồn tại các link file Markdown trong README/architecture/rules/review/mobile README.

Node cảnh báo MODULE_TYPELESS_PACKAGE_JSON ở các test TypeScript; suite vẫn exit 0. Chưa chạy build trong lượt chỉ sửa Markdown/rules này; kết quả build trong notes cũ thuộc lượt trước. Không chạy E2E ghi dữ liệu, migration production, deploy, máy in hoặc thiết bị thật. Không sửa source nghiệp vụ.

---

## Cập nhật rà soát và đóng lỗi — 23/10/2026

### Các lỗi và hành vi đã xác minh đóng trong source hiện tại

1. **Webhook thanh toán gói SaaS (`src/app/api/webhooks/payment/route.ts`, `src/lib/db.ts`, `tests/billing-ai-review.test.ts`, `tests/unit.test.ts`):** Đã loại bỏ hoàn toàn secret fallback mặc định (`getConfiguredWebhookSecret()` trả `null` khi thiếu/trống `PAYMENT_WEBHOOK_SECRET` và `verifyWebhookSignatureOrSecret()` trả HTTP `503` từ chối mọi callback; so sánh header secret/HMAC dùng `crypto.timingSafeEqual`). Đồng thời đóng dứt điểm các hạng mục cốt lõi của Section 1.5:
   - Sau khi xác thực webhook và trích xuất mã đơn `orderCode`, mọi callback không phải dev-simulator bắt buộc phải có số tiền chuyển khoản hợp lệ, hữu hạn và dương (`> 0`) trong `transferAmount` hoặc `amount` (trả HTTP `400 PAYMENT_AMOUNT_REQUIRED` nếu thiếu; trả HTTP `400 INVALID_PAYMENT_AMOUNT` nếu số tiền <= 0 hoặc sai định dạng; trả HTTP `400 PAYMENT_AMOUNT_MISMATCH` nếu nhỏ hơn giá gói yêu cầu). Bảo toàn luồng giả lập `PAYMENT_DEV_SIMULATE` ngoài production cho chủ quán kiểm thử mà không cần chuyển khoản thật. Super Admin gọi webhook callback vẫn bắt buộc phải truyền số tiền (hoặc sử dụng action `switch_plan_direct`).
   - Kiểm tra hướng giao dịch: khi payload chứa `transferType`, chỉ chấp nhận giá trị `in` (không phân biệt hoa thường), từ chối dứt khoát mọi giá trị khác như `out` với HTTP `400 INVALID_TRANSFER_TYPE`. Cho phép không truyền `transferType` đối với các nhà cung cấp không gửi trường này.
   - Loại bỏ hoàn toàn fallback `SEED_TRANSACTIONS` trong `dbCompletePaymentWebhook` khi lỗi tra cứu DB: xử lý cả exception bị ném lẫn kết quả Supabase `{ error }` thành thất bại (HTTP `500` từ route); không bao giờ báo thành công hoặc gạch nợ đơn mẫu sau lỗi DB; bảo toàn mã HTTP `404 PAYMENT_ORDER_NOT_FOUND` khi DB hoạt động bình thường nhưng không tìm thấy đơn.
   - Tích hợp RPC nguyên tử `complete_payment_webhook_atomic` (migration 015): khóa advisory lock và row-level lock `FOR UPDATE` trên dòng giao dịch `payment_transactions` để serialize các callback gửi đồng thời; cập nhật trạng thái đơn (`completed`, `bank_ref_id`, `completed_at`) và hồ sơ người dùng (`plan`, `plan_expires_at = now() + 30 days`) trong cùng transaction Postgres; xóa bỏ hoàn toàn fallback 2 bước ghi client và RPC cũ `complete_saas_payment_order_atomic`. Khi RPC không khả dụng, hệ thống fail-closed ngay lập tức (`DB_RPC_UNAVAILABLE`), không tự ý ghi client; dữ liệu dòng DB khóa và kết quả RPC là nguồn chân lý duy nhất (server-authoritative) cho `owner_id`, `target_plan` và `amount` mà không sử dụng `ownerId` từ session hoặc caller admin; phân giải mã tham chiếu an toàn tất định (`FT-${order_code}`) khi thiếu mã từ provider; hỗ trợ cờ `allowUnverifiedAmount` (`p_allow_unverified_amount=true`) duy nhất cho luồng `isDevSandboxSimulator` ngoài production; xử lý idempotency khi đơn đã hoàn tất trước đó (`status: 'already_completed'`) trả HTTP 200 không cộng dồn thời hạn gói; ánh xạ mã lỗi HTTP chuẩn xác: `404` cho `PAYMENT_ORDER_NOT_FOUND`, `400` cho `PAYMENT_AMOUNT_MISMATCH` / `DUPLICATE_BANK_REF` / `MISSING_BANK_REF` / `INVALID_PAYMENT_AMOUNT`, và `409` cho `PAYMENT_ORDER_NOT_PENDING`.
   - *Hạng mục Section 1.5 còn mở:* Tiếp tục duy trì mở theo dõi đối với phạm vi tài khoản thanh toán đa người dùng (billing-account scoping: gắn kết chặt chẽ từng đơn/webhook với tài khoản nhận tiền cụ thể hoặc cấu hình đa cổng thanh toán).
2. **Khôi phục mật khẩu / OTP (`src/lib/auth-recovery.ts`, `mobile/src/lib/auth-recovery.ts`):** Đồng bộ chuẩn hóa email, kiểm tra tài khoản không hỗ trợ recovery, phân loại lỗi rate-limit/network/provider và xác thực mã OTP/token recovery giữa web và mobile.
3. **Bộ chuyển ngôn ngữ Storefront và phân giải gói chủ quán (`src/components/storefront/LanguageSwitcher.tsx`, `src/lib/db.ts`, `src/lib/i18n-helper.ts`, `/s/[slug]`, `/s/[slug]/menu`, `tests/app-i18n-review.test.ts`):** Tôn trọng đúng danh sách `supported_langs` đã cấu hình của quán (chuẩn hóa qua `normalizeShopSupportedLangs`, mặc định `['vi', 'en']` khi chưa có cấu hình hợp lệ, và giới hạn theo gói chủ quán qua `getAllowedLocalesForPlan`), chỉ hiển thị và chọn trong đúng danh sách ngôn ngữ được quán hỗ trợ. Đã đóng dứt điểm residual audit 1.4: trong chế độ Supabase/DB, `dbGetStorefrontBundle` (`src/lib/db.ts`) truy vấn chính xác `profiles.plan` theo `shop.owner_id` của quán đang phân giải (thay vì trả cứng `ownerPlan: 'premium'`), không suy đoán từ profile người đăng nhập/thành viên hoặc profile đầu tiên, và áp dụng cơ chế fail-closed chuẩn (khi thiếu profile, lỗi query hoặc giá trị gói không hợp lệ đều mặc định về `free`), ngăn chặn hiển thị vượt quá số ngôn ngữ theo gói của chủ quán trên trang cửa và menu công khai.
4. **Onboarding an toàn khi thử lại và luồng tạo quán riêng cho nhân viên (`src/lib/onboarding-flow.ts`, `src/app/(auth)/onboarding/page.tsx`, `tests/staff-routing-review.test.ts`):** Khi tạo quán thành công nhưng bước `bulk_import` danh mục/món đầu tiên gặp lỗi một phần, luồng giữ lại `draftShop` đã lưu và dùng cặp ID ổn định (`onboarding:<shopId>:first-category`, `onboarding:<shopId>:first-item`) để thử nhập lại an toàn mà không tạo trùng quán hoặc trùng danh mục/món. Đồng thời, khi tài khoản nhân viên chưa sở hữu quán nào (`owned === 0`, `member > 0`) truy cập onboarding, modal quán hiện có hiển thị nút song ngữ "Tạo cửa hàng riêng" / "Create your own store" (`data-testid="onboarding-create-own-shop"`) cho phép gỡ rào cản (`setExistingShops(null)`) và mở wizard tạo quán độc lập an toàn, trong khi nút tạo thêm chi nhánh (`onboarding-create-branch`) được giữ nguyên dành riêng cho chủ quán (`owned > 0`), có test hồi quy xác minh điều kiện, nhãn, test id và handler trong `tests/staff-routing-review.test.ts`.
5. **Kiểm tra gói và quyền AI OCR (`src/app/api/ai/ocr-menu/route.ts`, `src/app/api/ai/_lib/guard.ts`):** `requireAiOcrPlan` xác định đúng chủ sở hữu của quán đang chọn mà người gọi được phép truy cập để kiểm tra gói có `allowAiOcr` (`403 PLAN_FEATURE_LOCKED` nếu gói không mở), đồng thời bắt buộc nhân viên/thu ngân phải có quyền chuẩn `catalog.manage` (`403 INSUFFICIENT_SHOP_PERMISSION`).
6. **Lý do hoàn tiền và hủy đơn trên Mobile & Server (`mobile/src/lib/order-actions.ts`, `mobile/src/components/tabs/OrdersTab.tsx`, `mobile/App.tsx`, `src/app/api/orders/route.ts`):** Mobile mở hộp thoại yêu cầu nhập lý do theo ngôn ngữ VI/EN đang chọn trước khi gửi yêu cầu hủy đơn hoặc hoàn tiền (và chặn hủy trực tiếp đơn đã thu tiền khi chưa hoàn tiền); server kiểm tra bắt buộc lý do không rỗng, tối đa 500 ký tự (`CANCEL_REASON_REQUIRED`, `REFUND_REASON_REQUIRED`, `REASON_TOO_LONG`) và lưu `cancelled_reason` / `refund_reason` vào đơn cùng bản ghi audit.
7. **Khách tự hủy đơn qua mã theo dõi (`src/app/api/orders/route.ts`, `src/components/storefront/ShowToStaffModal.tsx`, `src/lib/mpos-store.ts`, `tests/unit.test.ts`):** Khách hàng có thể tự hủy đơn trực tiếp trên Storefront qua modal theo dõi đơn (`ShowToStaffModal.tsx`), xác thực quyền qua `tracking_token` (hoặc header `x-tracking-token`). Hệ thống áp dụng chốt chặn bảo vệ nghiêm ngặt: chỉ cho phép tự hủy khi đơn đang ở trạng thái mới (`new`) và chưa thanh toán (`unpaid`); khi hợp lệ, đơn chuyển sang trạng thái đã hủy (`cancelled`), tự động hoàn lại tồn kho (`stock_quantity`) đúng một lần qua `mpos-store` và ghi nhận nhật ký kiểm toán `customer_cancel_order`. Mọi nỗ lực hủy với token sai/không hợp lệ (`403 INVALID_TRACKING_TOKEN`), thiếu token khi gọi nặc danh (`401`), hủy khi đơn đã được quán tiếp nhận/chế biến hoặc đã thanh toán (`409 ORDER_ALREADY_ACCEPTED`), cũng như các yêu cầu chỉnh sửa món hay hủy lặp lại sau khi đơn đã hủy đều bị từ chối dứt khoát.
8. **Bảo lưu bí danh đường dẫn (Slug Aliases) cho QR đã in (`supabase/migrations/014_shop_slug_aliases.sql`, `src/lib/db.ts`, `src/lib/table-helpers.ts`, `src/app/api/shops/route.ts`, `src/app/api/admin/route.ts`, `/s/[slug]`, `/s/[slug]/menu`):** Khi chủ quán hoặc Super Admin đổi `slug`, đường dẫn cũ được lưu bền vững vào `public.shop_slug_aliases` (ngăn đụng độ với quán khác, hỗ trợ đổi nhiều lần hoặc hoàn nguyên về slug cũ của chính quán và không bao giờ che khuất slug canonical đang hoạt động). Truy vấn qua slug cũ phân giải về đúng quán (tôn trọng `is_published` và quyền owner/member/admin), xác thực chữ ký HMAC của QR bàn (`tableQrVerified`) theo `shop.id` và chuyển hướng (`router.replace`) sang URL canonical hiện tại với đầy đủ tham số truy vấn (`src`, `tableId`, `sig`, `table`, `lang`).
9. **Phản hồi trạng thái degraded của Health Check (`src/app/api/health/route.ts`, `tests/admin-review.test.ts`):** `GET /api/health` khi readiness thất bại (hoặc bảng/seed gặp lỗi) trả `status: 'degraded'` cùng mã HTTP `503` (thay vì trả `status: ok`), đồng thời không auto-seed dữ liệu mẫu trên môi trường `NODE_ENV=production`. Giữ nguyên lưu ý vận hành: mã HTTP `200` từ health check chỉ chứng minh Supabase đã sẵn sàng/kết nối, không chứng minh mọi dịch vụ hoặc nhà cung cấp tùy chọn bên ngoài (như Cloudflare R2, Gemini/AI) đều hoạt động.
10. **Chống trùng lặp đồng bộ realtime đơn hàng giữa DashboardShell và CounterOrdersPage (Audit 1.3.4, `src/lib/dashboard-nav.ts`, `src/app/(dashboard)/dashboard/layout.tsx`, `tests/order-live-review.test.ts`):** Phân định ranh giới route rõ ràng qua `isOrdersDashboardRoute` và `shouldDashboardShellSyncOrders`. Trên đường dẫn `/dashboard/orders` và các route con `/dashboard/orders/...`, `DashboardShell` tạm ngưng hoàn toàn kết nối SSE `startOrderLiveSync`, bỏ qua fetch ban đầu và đóng/không đăng ký BroadcastChannel làm mới đơn, để `CounterOrdersPage` là bên duy nhất quản lý dữ liệu, âm báo và thông báo đơn tại đây. Trên các route dashboard khác, layout duy trì SSE ngầm, BroadcastChannel và âm báo nhắc nhở; khi chuyển hướng vào/ra khỏi route đơn hàng, subscription được dọn dẹp (hủy SSE, đóng BroadcastChannel; layout vô hiệu hóa scope và bỏ qua response in-flight cũ, không hủy request mạng qua AbortController) và tái khởi động sạch sẽ không còn race condition hay callback rác.

### Kết quả kiểm chứng tại root (23/10/2026)

- Web/mobile typecheck: **pass** (`npm run typecheck`, `npm run typecheck --prefix mobile`).
- Unit tests: **109/109** pass (`npm run test:unit`).
- Review tests: **133/133** pass (`npm run test:review`).
- SQL tests: **1/1** pass (`npm run test:sql`).
- Mobile tests: **40/40** pass (`npm test --prefix mobile`).
- Production build: **pass** (`npm run build`).

### Hạng mục chưa kiểm chứng (Unverified)

- Chưa kiểm chứng browser E2E ghi dữ liệu trực tiếp và luồng gửi email qua live SMTP.
- Chưa kiểm chứng nhận push notification trên thiết bị vật lý (APNs/FCM thật).
- Chưa kiểm chứng in phần cứng trên máy in nhiệt/POS thật và hành vi môi trường production thực tế.
