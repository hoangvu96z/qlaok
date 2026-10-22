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

1. **Webhook SaaS (ghi nhận ngày 18/10/2026 — đã đóng ngày 22/10/2026):** Thời điểm 18/10, `verifyWebhookSignatureOrSecret` còn secret fallback trong source khi không cấu hình env. *Cập nhật hiện trạng 22/10/2026:* `getConfiguredWebhookSecret` và `verifyWebhookSignatureOrSecret` tại `src/app/api/webhooks/payment/route.ts` đã bỏ hoàn toàn secret mặc định; khi thiếu hoặc để trống `PAYMENT_WEBHOOK_SECRET`, endpoint từ chối mọi callback với HTTP `503`.
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

1. **Webhook thanh toán gói SaaS (`src/app/api/webhooks/payment/route.ts`):** Đã loại bỏ hoàn toàn secret fallback mặc định. `getConfiguredWebhookSecret()` trả `null` khi thiếu/trống `PAYMENT_WEBHOOK_SECRET` và `verifyWebhookSignatureOrSecret()` trả HTTP `503` từ chối mọi callback; so sánh header secret/HMAC dùng `crypto.timingSafeEqual`.
2. **Khôi phục mật khẩu / OTP (`src/lib/auth-recovery.ts`, `mobile/src/lib/auth-recovery.ts`):** Đồng bộ chuẩn hóa email, kiểm tra tài khoản không hỗ trợ recovery, phân loại lỗi rate-limit/network/provider và xác thực mã OTP/token recovery giữa web và mobile.
3. **Bộ chuyển ngôn ngữ Storefront (`src/components/storefront/LanguageSwitcher.tsx`, `src/lib/i18n-helper.ts`, `/s/[slug]`, `/s/[slug]/menu`):** Tôn trọng đúng danh sách `supported_langs` đã cấu hình của quán (chuẩn hóa qua `normalizeShopSupportedLangs`, mặc định `['vi', 'en']` khi chưa có cấu hình hợp lệ, và giới hạn theo gói chủ quán qua `getAllowedLocalesForPlan`), chỉ hiển thị và chọn trong đúng danh sách ngôn ngữ được quán hỗ trợ.
4. **Onboarding an toàn khi thử lại (`src/lib/onboarding-flow.ts`, `src/app/(auth)/onboarding/page.tsx`):** Khi tạo quán thành công nhưng bước `bulk_import` danh mục/món đầu tiên gặp lỗi một phần, luồng giữ lại `draftShop` đã lưu và dùng cặp ID ổn định (`onboarding:<shopId>:first-category`, `onboarding:<shopId>:first-item`) để thử nhập lại an toàn mà không tạo trùng quán hoặc trùng danh mục/món.
5. **Kiểm tra gói và quyền AI OCR (`src/app/api/ai/ocr-menu/route.ts`, `src/app/api/ai/_lib/guard.ts`):** `requireAiOcrPlan` xác định đúng chủ sở hữu của quán đang chọn mà người gọi được phép truy cập để kiểm tra gói có `allowAiOcr` (`403 PLAN_FEATURE_LOCKED` nếu gói không mở), đồng thời bắt buộc nhân viên/thu ngân phải có quyền chuẩn `catalog.manage` (`403 INSUFFICIENT_SHOP_PERMISSION`).
6. **Lý do hoàn tiền và hủy đơn trên Mobile & Server (`mobile/src/lib/order-actions.ts`, `mobile/src/components/tabs/OrdersTab.tsx`, `mobile/App.tsx`, `src/app/api/orders/route.ts`):** Mobile mở hộp thoại yêu cầu nhập lý do theo ngôn ngữ VI/EN đang chọn trước khi gửi yêu cầu hủy đơn hoặc hoàn tiền (và chặn hủy trực tiếp đơn đã thu tiền khi chưa hoàn tiền); server kiểm tra bắt buộc lý do không rỗng, tối đa 500 ký tự (`CANCEL_REASON_REQUIRED`, `REFUND_REASON_REQUIRED`, `REASON_TOO_LONG`) và lưu `cancelled_reason` / `refund_reason` vào đơn cùng bản ghi audit.
7. **Bảo lưu bí danh đường dẫn (Slug Aliases) cho QR đã in (`supabase/migrations/014_shop_slug_aliases.sql`, `src/lib/db.ts`, `src/lib/table-helpers.ts`, `src/app/api/shops/route.ts`, `src/app/api/admin/route.ts`, `/s/[slug]`, `/s/[slug]/menu`):** Khi chủ quán hoặc Super Admin đổi `slug`, đường dẫn cũ được lưu bền vững vào `public.shop_slug_aliases` (ngăn đụng độ với quán khác, hỗ trợ đổi nhiều lần hoặc hoàn nguyên về slug cũ của chính quán và không bao giờ che khuất slug canonical đang hoạt động). Truy vấn qua slug cũ phân giải về đúng quán (tôn trọng `is_published` và quyền owner/member/admin), xác thực chữ ký HMAC của QR bàn (`tableQrVerified`) theo `shop.id` và chuyển hướng (`router.replace`) sang URL canonical hiện tại với đầy đủ tham số truy vấn (`src`, `tableId`, `sig`, `table`, `lang`).
8. **Phản hồi trạng thái degraded của Health Check (`src/app/api/health/route.ts`, `tests/admin-review.test.ts`):** `GET /api/health` khi readiness thất bại (hoặc bảng/seed gặp lỗi) trả `status: 'degraded'` cùng mã HTTP `503` (thay vì trả `status: ok`), đồng thời không auto-seed dữ liệu mẫu trên môi trường `NODE_ENV=production`. Giữ nguyên lưu ý vận hành: mã HTTP `200` từ health check chỉ chứng minh Supabase đã sẵn sàng/kết nối, không chứng minh mọi dịch vụ hoặc nhà cung cấp tùy chọn bên ngoài (như Cloudflare R2, Gemini/AI) đều hoạt động.

### Kết quả kiểm chứng tại root (23/10/2026)

- Web/mobile typecheck: **pass** (`npm run typecheck`, `npm run typecheck --prefix mobile`).
- Unit tests: **108/108** pass (`npm run test:unit`).
- Review tests: **120/120** pass (`npm run test:review`).
- SQL tests: **1/1** pass (`npm run test:sql`).
- Mobile tests: **40/40** pass (`npm test --prefix mobile`).
- Production build: **pass** (`npm run build`).

### Hạng mục chưa kiểm chứng (Unverified)

- Chưa kiểm chứng browser E2E ghi dữ liệu trực tiếp và luồng gửi email qua live SMTP.
- Chưa kiểm chứng nhận push notification trên thiết bị vật lý (APNs/FCM thật).
- Chưa kiểm chứng in phần cứng trên máy in nhiệt/POS thật và hành vi môi trường production thực tế.
