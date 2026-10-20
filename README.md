# Qlaok — Quét Là OK

Cập nhật theo workspace ngày **18/10/2026**. Nền tảng menu/trang cửa hàng qua QR và mPOS cho F&B, dịch vụ và bán lẻ; gồm web khách hàng, dashboard chủ quán/thu ngân, Super Admin và ứng dụng Expo.

## Bắt đầu cho coding agent

**Bắt buộc dùng CodeGraph trước khi tìm/đọc/sửa code.** Codex đọc [AGENTS.md](AGENTS.md); AGY/Antigravity đọc [.agents/rules/codegraph.md](.agents/rules/codegraph.md) và [GEMINI.md](GEMINI.md). Rule AGY dùng `trigger: always_on` và nhúng đầy đủ chính sách mỗi lượt. Cấu hình: [AGENT_RULES.md](docs/AGENT_RULES.md). Quy trình và ngoại lệ: [CODEGRAPH_WORKFLOW.md](docs/CODEGRAPH_WORKFLOW.md).

## Chức năng hiện tại

Nhận diện Qlaok dùng logo **Q + menu** thống nhất trên web/PWA và mobile. Asset gốc, bản in và hướng dẫn xuất icon: [brand guide](docs/brand/README.md).

Homepage được rà lại nội dung VI/EN ngày 20/10/2026, tập trung vào nhu cầu chủ quán và thông tin gói thực tế. Xem [review nội dung homepage](docs/HOMEPAGE_COPY_REVIEW.md).

- QR Cửa `/s/[slug]`: thông tin quán, Wi-Fi, giờ mở cửa, bài viết/khuyến mãi. QR Bàn `/s/[slug]/menu`: catalog, tùy chọn, giỏ hàng, gửi đơn và theo dõi bằng token riêng.
- Dashboard: tổng quan, đơn hàng/POS, catalog/tồn kho, báo cáo, bài viết, OCR, QR Studio, settings và billing.
- mPOS: tạo/sửa đơn, phục vụ, thu/hoàn tiền, giảm giá, hóa đơn theo bàn/session, ghi nhận yêu cầu in. Server định giá từ catalog; fulfillment `new/preparing/completed/cancelled` độc lập payment `unpaid/paid/refunded`.
- Quản lý bàn trên web tại `/dashboard/qr-studio`: tạo/sửa tên, mã bàn, khu vực, sức chứa, bật/tắt và lưu trữ; mỗi bàn có QR riêng tự chọn bàn khi mở menu. Báo cáo có tab **Theo bàn**; đơn cũ giữ tên bàn lịch sử và được phân biệt với bàn quản lý/Mang về. Xem [hướng dẫn bàn](docs/TABLE_MANAGEMENT.md).
- Membership theo shop: `owner`, `cashier`, `staff`, kiểm quyền ở API. Super Admin tại `/admin` dùng kiểm tra quyền server.
- Storefront hỗ trợ **8 ngôn ngữ**: `vi/en/ko/ja/zh/es/it/ru`, giới hạn theo gói và cấu hình quán. Giao diện quản trị, marketing, auth và mobile hỗ trợ **VI/EN**, mặc định VI; đây là hai miền ngôn ngữ riêng.
- AI dịch/OCR qua gateway OpenAI-compatible cấu hình `AI_*`, kết hợp Tesseract; upload ảnh qua R2. Nội dung AI/OCR cần được merchant kiểm tra trước khi lưu.
- Mobile Expo có các tab tổng quan, catalog, đơn, khuyến mãi và settings; dùng Supabase Auth thật và API có Bearer token. In mobile hiện là preview/mô phỏng.

| Gói | Giá cấu hình/tháng | Món tối đa | Ngôn ngữ tối đa | OCR | Theme |
| --- | ---: | ---: | ---: | --- | --- |
| Free | 0đ | 5 | 1 | Không | Không |
| Basic | 39.000đ | 25 | 3 | Không | Có |
| Premium | 69.000đ | 999999 (hiển thị không giới hạn) | 8 | Có | Có |

Nguồn cấu hình: `src/lib/plan-limits.ts`; copy dùng chung ở `src/lib/plan-copy.ts`, giá thanh toán server ở `src/lib/db.ts`.

## Chạy local

Dùng **Node.js 24** để khớp job verify CI và các test TypeScript strip-types; npm và lockfile đã có trong từng app.

```bash
npm ci
cp .env.example .env.local
# Điền biến môi trường của môi trường phát triển riêng
npm run dev
```

Web tại `http://localhost:3000`. Đây không phải app offline hoàn chỉnh: dữ liệu chính cần Supabase đã có schema. Khi bảng shop trống, một số đường đọc (gồm `/api/health`) có thể kích hoạt seed; health không phải probe thuần read-only. HTTP 200 hoặc `status: ok` chưa đủ: xem `environment.supabaseTablesReady` và `supabaseMessage`.

```bash
npm ci --prefix mobile
cp mobile/.env.example mobile/.env
npm start --prefix mobile
```

Điện thoại thật cần API URL qua IP LAN hoặc backend phát triển truy cập được. Xem [mobile/README.md](mobile/README.md).

## Biến môi trường

Sao chép mẫu, không commit giá trị thật.

| Nhóm | Biến | Vai trò |
| --- | --- | --- |
| Supabase public | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | URL và public key |
| Backend | `SUPABASE_SERVICE_ROLE_KEY` | DB đặc quyền/RPC/admin và realtime server; chỉ server |
| Phiên/khởi tạo | `SESSION_SECRET`, `INITIAL_SUPER_ADMIN_PASSWORD` | Secret ký phiên; mật khẩu khởi tạo admin chỉ khi cấu hình rõ |
| Billing webhook | `PAYMENT_WEBHOOK_SECRET` | Xác thực callback thanh toán gói SaaS |
| Migration | `SUPABASE_ACCESS_TOKEN` | PAT dùng Management API; không cần cho client |
| AI | `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_VISION_MODEL` | Gateway text/vision |
| R2 | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `NEXT_PUBLIC_R2_PUBLIC_URL` | Upload và URL ảnh công khai |
| Mobile | Theo `mobile/.env.example` | Chỉ URL/public key; không chứa backend secret |

Dùng secret phiên ngẫu nhiên tối thiểu 32 ký tự theo mẫu. Không dựa vào giá trị mặc định trong code cho deployment thật. Không chép service-role vào biến `NEXT_PUBLIC_*`/`EXPO_PUBLIC_*`.

## Database và realtime

Áp dụng **toàn bộ** migration theo thứ tự tên file vào môi trường đã chọn:

```text
001_init_qlaok.sql
002_mpos_orders_inventory.sql
002z_reconcile_legacy_bank_refs.sql
003_security_rls_and_atomic_mpos.sql
004_memberships_billing_payments_audit.sql
005_order_commit.sql
006_orders_realtime_publication.sql
007_shop_tables.sql
```

`npm run db:migrate` thực thi qua Supabase Management API theo cấu hình môi trường; chỉ chạy khi đã xác định đúng DB đích. `002z` lưu archive nhóm bank reference trùng trước khi tạo unique index; cần đối chiếu thủ công trường hợp lịch sử, không coi row giữ lại là kết luận đối soát.

Khi có cấu hình DB, orders đọc DB làm nguồn chính; lỗi DB không được coi là ghi thành công hoặc ghép đơn local vào dữ liệu thật. `.local-db` còn phục vụ một số phần legacy/dev; không phải cơ chế offline đồng bộ đầy đủ.

**Web:** Supabase Realtime → broker server → `/api/orders/events` SSE có xác thực → client tải lại dữ liệu qua API. Staff cần quyền shop; guest cần header `x-tracking-token`. Không mở public orders/RLS để client HMAC đăng ký trực tiếp. **Mobile:** Supabase Auth JWT → Postgres Changes, refresh canonical data qua API. Fallback 30 giây khi lỗi; dừng subscription/polling theo trạng thái màn hình/app. Xem [REALTIME_NOTES.md](REALTIME_NOTES.md).

## Kiểm tra

```bash
npm run typecheck
npm run typecheck --prefix mobile
npm run test:unit
npm run test:review
npm run test:sql
npm test --prefix mobile
npm run build
```

`test:sql` dùng PGlite cô lập, gồm migration bàn và ranh giới RLS; review tests gồm auth, quyền/RLS, giá, đơn, admin, realtime và i18n. Không đóng đinh tổng số test: lấy kết quả của lần chạy thực tế.

`npm test` root còn chạy `test:e2e`, có ghi dữ liệu qua server; chỉ dùng server/DB test dùng một lần, không trỏ production. Các fixture `tests/*-ui-fixture.mjs` chỉ phục vụ kiểm tra UI local. Script `lint` hiện là `next lint` và chưa có ESLint trong devDependencies; không coi đây là gate lint đã hoạt động trên Next 15.

## Cấu trúc và đường dẫn

```text
src/app/                 marketing, auth, admin, dashboard, storefront, API
src/components/          dashboard/POS, storefront, shared UI/i18n
src/lib/                 auth, permissions, DB, mPOS, pricing, realtime, AI/R2
src/types/qlaok.ts        contracts và locale/order/payment/membership types
mobile/                  Expo React 18 / React Native 0.76; tách web React 19
supabase/migrations/     schema, RLS, RPC và publication
scripts/                 migration, backend env và realtime deployment check
tests/                   unit, regression, SQL và local UI fixtures
```

Demo seed: `/s/pho-hoi-an`, `/s/linh-spa-nail`, `/s/dac-san-mien-trung`; thêm `/menu` cho menu. Các route làm việc: `/dashboard`, `/dashboard/orders`, `/dashboard/catalog`, `/dashboard/reports`, `/dashboard/posts`, `/dashboard/settings`, `/dashboard/ai-scanner`, `/dashboard/qr-studio`, `/dashboard/billing`, `/admin`.

## Triển khai và giới hạn

Push `main` kích hoạt `.github/workflows/deploy.yml`: verify web/mobile + SQL + build → migration → SSH deploy đúng SHA → kiểm tra subscription orders. Workflow dùng PM2 và runtime env; đọc workflow trước khi sửa cổng hay deploy. Không push chỉ để cập nhật tài liệu nếu chưa có yêu cầu triển khai.

Máy in thật, thiết bị iOS/Android, giao dịch ngân hàng và trạng thái production cần kiểm chứng riêng. Web print ghi nhận yêu cầu in, không xác nhận đã ra giấy. Webhook nâng gói SaaS khác đối soát tiền khách trả cho merchant. Orders/statistics còn tải lịch sử đầy đủ khi refresh; audit/payment ledger cho chốt ca chưa hoàn chỉnh.

## Tài liệu

- [ARCHITECTURE.md](ARCHITECTURE.md): bản đồ code và luồng nghiệp vụ hiện tại.
- [docs/TABLE_MANAGEMENT.md](docs/TABLE_MANAGEMENT.md): quản lý bàn, QR từng bàn, báo cáo và migration 007.
- [docs/CODEX_TABLES_REVIEW.md](docs/CODEX_TABLES_REVIEW.md): kết quả kiểm tra độc lập và giới hạn của bản bàn/theme/UI.
- [docs/APP_REVIEW.md](docs/APP_REVIEW.md): kết quả rà soát, chênh lệch tài liệu và điểm cần theo dõi.
- [I18N_NOTES.md](I18N_NOTES.md), [REALTIME_NOTES.md](REALTIME_NOTES.md): chi tiết chuyên đề.
- [REVIEW_NOTES.md](REVIEW_NOTES.md), `AGY_*`: lịch sử review/triển khai; kết quả test trong đó thuộc thời điểm ghi.
- [TODO.md](TODO.md), [document.md](document.md): roadmap/đặc tả gốc, không dùng để khẳng định tính năng hiện tại đã hoàn tất.
