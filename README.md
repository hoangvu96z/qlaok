# Qlaok — Quét Là OK

Cập nhật theo workspace ngày **23/10/2026**. Nền tảng menu/trang cửa hàng qua QR và mPOS cho F&B, dịch vụ và bán lẻ; gồm web khách hàng, dashboard chủ quán/thu ngân, Super Admin và ứng dụng Expo.

## Bắt đầu cho coding agent

**Bắt buộc dùng CodeGraph trước khi tìm/đọc/sửa code.** Codex đọc [AGENTS.md](AGENTS.md); AGY/Antigravity đọc [.agents/rules/codegraph.md](.agents/rules/codegraph.md) và [GEMINI.md](GEMINI.md). Rule AGY dùng `trigger: always_on` và nhúng đầy đủ chính sách mỗi lượt. Cấu hình agent: [AGENT_RULES.md](docs/AGENT_RULES.md). Quy trình CodeGraph: [CODEGRAPH_WORKFLOW.md](docs/CODEGRAPH_WORKFLOW.md). Codex có cấu hình GitHub MCP theo project để kiểm tra Actions mà không mở trang web; MCP CLI cần `GITHUB_PAT_TOKEN` trong môi trường user, không lưu token trong repo: [GitHub Actions workflow](docs/GITHUB_ACTIONS_WORKFLOW.md). Supabase MCP được cấu hình theo project cho Codex và AGY, giới hạn đúng project ở chế độ chỉ đọc; xem [hướng dẫn Supabase MCP](docs/SUPABASE_MCP.md).

## Chức năng hiện tại

Nhận diện Qlaok dùng logo **Q + menu** thống nhất trên web/PWA và mobile. Asset gốc, bản in và hướng dẫn xuất icon: [brand guide](docs/brand/README.md).

Homepage được rà lại nội dung VI/EN ngày 20/10/2026, tập trung vào nhu cầu chủ quán và thông tin gói thực tế. Xem [review nội dung homepage](docs/HOMEPAGE_COPY_REVIEW.md).

- QR Cửa `/s/[slug]`: thông tin quán, Wi-Fi, giờ mở cửa, bài viết/khuyến mãi. QR Bàn `/s/[slug]/menu`: catalog, tùy chọn, giỏ hàng, gửi đơn, theo dõi bằng token riêng và 2 nút hỗ trợ nhanh tại bàn đã xác thực QR (**Gọi phục vụ** / **Xin hóa đơn**). Khi chủ quán hoặc Super Admin đổi đường dẫn (`slug`), các đường dẫn cũ được bảo lưu bền vững trong `public.shop_slug_aliases` (ngăn đụng độ chéo quán), tự phân giải về đúng quán kèm xác thực chữ ký QR bàn và chuyển hướng (`router.replace`) sang URL chuẩn hiện tại với đầy đủ tham số truy vấn (`src`, `tableId`, `sig`, `table`, `lang`).
- Dashboard: tổng quan (kèm checklist thiết lập quán lần đầu 6/6 bước: thông tin quán/Wi-Fi, giờ mở cửa có tích xác nhận tường minh `opening_hours_confirmed` tại `/dashboard/settings#opening-hours-settings`, VietQR thanh toán, thực đơn, bàn & QR, công khai cửa hàng), đơn hàng/POS, màn hình bếp (KDS `/dashboard/kitchen`), catalog/tồn kho, báo cáo, bài viết, OCR, QR Studio, settings và billing. Quản lý thực đơn `/dashboard/catalog` thiết kế theo dạng danh sách hàng ngang gọn gàng (compact horizontal row) trên desktop, thao tác nhanh bật/tắt còn món, sửa giá bán và tồn kho trực tiếp (`inputMode="numeric"`, Enter/blur save, kiểm tra chặt chẽ giá trị nhập không tự biến đổi sai lệch, lưu lạc quan kèm rollback khi lỗi), tự co giãn không bị cắt xén điều khiển trên màn hình hẹp; phân trang thực đơn với các kích thước trang chuẩn chính xác `10, 20, 50, 100` món/trang, giữ bộ lọc và tự động đặt lại trang 1 khi đổi danh mục/tìm kiếm hoặc co trang khi đổi dữ liệu. Hỗ trợ xuất và nhập file Excel `.xlsx` để sửa giá bán và tồn kho hàng loạt: file xuất chứa ID món ổn định, danh mục, tên món, giá bán và tồn kho (tồn kho không giới hạn biểu diễn bằng `∞` và khôi phục thành `null`); nhập file đối chiếu theo ID món ổn định, chỉ cập nhật giá và tồn kho, không tạo mới hay xóa món, kiểm tra tính hợp lệ và hiển thị preview phân loại dòng thay đổi/không đổi/lỗi trước khi áp dụng, báo cáo chi tiết dòng thành công/thất bại và ngăn áp dụng lại bản xem trước cũ; đồng bộ ngữ nghĩa trạng thái hết hàng dẫn xuất (derived sold-out state: tồn kho về 0 tự động chuyển `is_available = false`, tăng tồn kho dương tự động chuyển `is_available = true`, không giới hạn giữ nguyên trạng thái); bảo vệ tuyệt đối các trường ID quán, tên, danh mục, options và quyền. Onboarding (`/onboarding`) giữ lại quán nháp đã lưu khi bước nhập thực đơn đầu tiên gặp lỗi và dùng ID ổn định (`onboarding:<shopId>:first-category`, `onboarding:<shopId>:first-item`) để thử nhập lại danh mục/món đầu tiên an toàn mà không tạo trùng quán hay món.
- mPOS & KDS: tạo/sửa đơn, màn hình bếp KDS (`/dashboard/kitchen` lọc đơn đang hoạt động `new/preparing` ưu tiên đơn cũ nhất trước, cảnh báo quá 15 phút và thao tác chạm `new → preparing → completed` chỉ bật cho thành viên có `orders.fulfill`), phục vụ, thu/hoàn tiền thủ công hoặc đối soát tự động VietQR cho đơn hàng khách qua SePay (`/api/webhooks/sepay/[shopId]`, tách biệt hoàn toàn với nâng cấp gói SaaS `/api/webhooks/payment`), giảm giá, hóa đơn theo bàn/session, ghi nhận yêu cầu in, nhận chuông/thông báo và tiếp nhận/hoàn tất yêu cầu phục vụ từ QR bàn (`pending → acknowledged → resolved`). Server định giá từ catalog; fulfillment `new/preparing/completed/cancelled` và yêu cầu xin hóa đơn độc lập hoàn toàn với payment `unpaid/paid/refunded`. Xem [hướng dẫn đối soát SePay](docs/SEPAY_WEBHOOK_SETUP.md).
- Quản lý bàn trên web tại `/dashboard/qr-studio`: tạo/sửa tên, mã bàn, khu vực, sức chứa, bật/tắt và lưu trữ; hỗ trợ sơ đồ mặt bằng (floor plan) với chế độ xem danh sách (list) và sơ đồ trực quan (map), bộ lọc trạng thái/khu vực, làm mới, chủ quán/quản trị kéo-thả hoặc dùng phím mũi tên di chuyển vị trí bàn (bước nhảy 2% mỗi lần bấm) với cập nhật lạc quan (rollback khi lỗi), canvas bảo toàn giới hạn mặc định `CANVAS_BOUNDS` (x 7/93, y 9/91) khi bề mặt đạt tối thiểu 1200x680px và tự co vào an toàn theo lề 80px ngang, 64px dọc trên các kích thước khác để không khuất thẻ bàn; mỗi bàn có QR riêng tự chọn bàn khi mở menu. Báo cáo có tab **Theo bàn**; đơn cũ giữ tên bàn lịch sử và được phân biệt với bàn quản lý/Mang về. Xem [hướng dẫn bàn](docs/TABLE_MANAGEMENT.md).
- Membership theo shop: `owner`, `cashier`, `staff`, kiểm quyền ở API. Super Admin tại `/admin` dùng kiểm tra quyền server.
- Storefront hỗ trợ **8 ngôn ngữ**: `vi/en/ko/ja/zh/es/it/ru`, giới hạn theo gói và cấu hình quán; bộ chuyển ngôn ngữ trên storefront tôn trọng đúng danh sách `supported_langs` đã cấu hình của quán (chuẩn hóa qua `normalizeShopSupportedLangs`, giới hạn theo gói của chủ quán). Giao diện quản trị, marketing, auth và mobile hỗ trợ **VI/EN**, mặc định VI; đây là hai miền ngôn ngữ riêng.
- AI dịch/OCR qua gateway OpenAI-compatible cấu hình `AI_*`, kết hợp Tesseract; upload ảnh qua R2. `/api/ai/ocr-menu` đối chiếu gói theo đúng chủ sở hữu của quán đang chọn đã được xác thực quyền và yêu cầu nhân viên/thu ngân có quyền chuẩn `catalog.manage`. Nội dung AI/OCR cần được merchant kiểm tra trước khi lưu.
- Mobile Expo có các tab tổng quan, catalog, đơn, khuyến mãi và settings; dùng Supabase Auth thật và API có Bearer token. Thao tác hoàn tiền/hủy đơn trên mobile yêu cầu nhập lý do theo ngôn ngữ VI/EN đang chọn; server kiểm tra hợp lệ (bắt buộc, tối đa 500 ký tự) và ghi nhận `refund_reason`/`cancelled_reason` vào đơn cùng audit log. Khi có cấu hình `EXPO_PUBLIC_EAS_PROJECT_ID` (hoặc `extra.eas.projectId`) và chứng chỉ APNs/FCM trên EAS, ứng dụng đăng ký Expo push token theo shop đang xem (cần quyền `orders.view`, tự thử lại khi lỗi mạng tạm thời), nhận thông báo đơn QR mới có âm báo và chạm mở đúng tab Đơn của quán đó (nếu quán không khả dụng hoặc không còn quyền `orders.view` sẽ báo lỗi rõ ràng, không tự chuyển sang quán khác); khi đăng xuất chủ động hoặc tự thoát phiên do HTTP 401 đều thử hủy token best-effort qua API xác thực trước khi xóa phiên local (nếu access token đã hết hạn/không hợp lệ khiến `DELETE /api/push-tokens` trả 401 thì không lặp đệ quy và vẫn xóa phiên local). In mobile hiện là preview/mô phỏng.

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
| Billing webhook | `PAYMENT_WEBHOOK_SECRET` | Xác thực callback thanh toán gói SaaS (`/api/webhooks/payment`, header `x-webhook-secret`/`Authorization: Apikey …` hoặc HMAC `x-webhook-signature`). **Bắt buộc**: không có giá trị mặc định; nếu thiếu, mọi webhook bị từ chối (503). Callback thanh toán thật bắt buộc `accountNumber` không rỗng và khớp một trong các số tài khoản nhận đã cấu hình trước khi hoàn tất thanh toán (thiếu cấu hình trả 503, thiếu hoặc lệch tài khoản bị từ chối với 400); dev simulator được miễn trừ |
| Tài khoản nhận SaaS (server allowlist) | `SAAS_BANK_ACCOUNTS` | Tùy chọn allowlist nhiều tài khoản nhận tiền SaaS phía server cho `/api/webhooks/payment`, định dạng JSON array chứa các chuỗi số tài khoản (VD: `["123456789","987654321"]`). Khi được cấu hình (chuỗi không rỗng), biến này có thẩm quyền cao nhất (authoritative) để xác thực callback: mọi tài khoản công khai hiển thị trong `NEXT_PUBLIC_SAAS_BANK_ACCOUNTS` bắt buộc phải nằm trong allowlist của server, nếu không callback cho tài khoản đó sẽ bị từ chối (400 RECEIVING_ACCOUNT_MISMATCH). Server chỉ parse mảng JSON của các chuỗi không rỗng, tự chuẩn hóa loại bỏ khoảng trắng và loại trùng giữ thứ tự xuất hiện đầu tiên. Nếu cấu hình sai định dạng (JSON lỗi, không phải mảng, mảng rỗng, hoặc phần tử không phải chuỗi/rỗng), hệ thống fail-closed về danh sách rỗng và từ chối 503 mọi callback (không fallback) |
| Tài khoản nhận SaaS (server legacy) | `SAAS_BANK_ACCOUNT` | Tùy chọn legacy ghi đè đơn lẻ phía server cho tài khoản nhận tiền thanh toán gói SaaS (`/api/webhooks/payment`). Khi được đặt tường minh, biến này có thẩm quyền cao nhất (authoritative) để xác thực callback; mọi tài khoản công khai hiển thị trong `NEXT_PUBLIC_SAAS_BANK_ACCOUNTS` phải trùng khớp với tài khoản này, nếu không callback sẽ bị từ chối (400 RECEIVING_ACCOUNT_MISMATCH). Khi `SAAS_BANK_ACCOUNTS` vắng mặt hoặc để trống, server dùng giá trị này làm tài khoản hợp lệ; nếu cả hai biến server đều vắng mặt hoặc để trống, webhook validation ưu tiên fallback về danh sách tài khoản hợp lệ từ `NEXT_PUBLIC_SAAS_BANK_ACCOUNTS` trước khi xét `NEXT_PUBLIC_SAAS_BANK_ACCOUNT` |
| SePay đơn hàng quán | `SEPAY_SECRET_ENCRYPTION_KEY` | Khóa chủ AES-256-GCM (tối thiểu 32 ký tự) để mã hóa tại chỗ khóa HMAC SePay của từng cửa hàng trong `public.shop_sepay_configs` cho `/api/webhooks/sepay/[shopId]`. **Bắt buộc** cho tính năng đối soát tự động đơn khách: không có mặc định; thiếu hoặc `< 32` ký tự → lưu cấu hình và nhận webhook trả 503 |
| Billing dev | `PAYMENT_DEV_SIMULATE` | Tùy chọn, chỉ ngoài production: `true` cho phép chủ quán giả lập webhook (`simulateWebhook`) cho đơn của chính mình. Quyền truy cập callback của Super Admin đã xác thực không bỏ qua đối chiếu `accountNumber`; chỉ bộ giả lập dev được kích hoạt tường minh (`isDevSandboxSimulator`) mới được miễn trừ |
| Billing VietQR (public multi-account) | `NEXT_PUBLIC_SAAS_BANK_ACCOUNTS` | Danh sách tài khoản nhận tiền SaaS công khai cho UI `/dashboard/billing` dạng JSON array: `[{"bin":"970436","account":"123456789","accountName":"Qlaok Co","bankName":"VCB"}, ...]`. Bắt buộc `bin` và `account` (chuỗi không rỗng); tùy chọn `accountName` (mặc định rỗng) và `bankName` (mặc định theo `bin`); bỏ qua hoàn toàn trường `id`. Thứ tự trong JSON là thứ tự hiển thị. **Lưu ý bảo mật:** Đây là thông tin công khai hiển thị trên mã QR nhận tiền (public recipient details only), tuyệt đối không chứa secret hay private key. Khi có từ 2 tài khoản hợp lệ trở lên, UI hiển thị bộ chọn tài khoản ngân hàng nhận tiền nhỏ gọn, song ngữ VI/EN; khi có đúng 1 tài khoản, hiển thị UI như cũ (không hiện bộ chọn). Nếu cấu hình sai định dạng (JSON lỗi, không phải mảng, mảng rỗng, hoặc phần tử không hợp lệ), fail-closed về không có tài khoản (ẩn QR) và không fallback về biến legacy. Khi server `SAAS_BANK_ACCOUNTS` hoặc `SAAS_BANK_ACCOUNT` được cấu hình tường minh, phía server có thẩm quyền tuyệt đối (authoritative) để xác thực callback; mọi tài khoản công khai hiển thị trong `NEXT_PUBLIC_SAAS_BANK_ACCOUNTS` khi đó bắt buộc phải nằm trong allowlist của server, nếu không callback cho tài khoản đó sẽ bị từ chối (400 RECEIVING_ACCOUNT_MISMATCH). Khi cả hai biến server `SAAS_BANK_*` đều vắng mặt/để trống, server dùng các số tài khoản đã chuẩn hóa từ danh sách này làm allowlist đối soát cho webhook trước khi fallback về biến legacy |
| Billing VietQR (public legacy) | `NEXT_PUBLIC_SAAS_BANK_BIN`, `NEXT_PUBLIC_SAAS_BANK_ACCOUNT`, `NEXT_PUBLIC_SAAS_BANK_ACCOUNT_NAME`, `NEXT_PUBLIC_SAAS_BANK_NAME` | Cấu hình tài khoản đơn lẻ legacy hiển thị QR ở `/dashboard/billing`. Chỉ được dùng khi `NEXT_PUBLIC_SAAS_BANK_ACCOUNTS` vắng mặt hoặc để trống. Thiếu BIN/số TK → trang hiện "chưa cấu hình thanh toán, liên hệ hỗ trợ" thay vì QR giả; `NEXT_PUBLIC_SAAS_BANK_ACCOUNT` làm fallback đối soát cuối cùng cho webhook khi cả hai biến server và biến danh sách công khai chưa đặt |
| Migration | `SUPABASE_ACCESS_TOKEN` | PAT dùng Management API; không cần cho client |
| AI | `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_VISION_MODEL` | Gateway text/vision |
| R2 | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `NEXT_PUBLIC_R2_PUBLIC_URL` | Upload và URL ảnh công khai |
| Mobile | Theo `mobile/.env.example` (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_KEY`, `EXPO_PUBLIC_API_URL`, tùy chọn `EXPO_PUBLIC_EAS_PROJECT_ID`) | Chỉ URL/public key và EAS project ID; không chứa backend secret. Push thiết bị thật cần EAS project ID + APNs/FCM credentials |

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
008_mobile_push_tokens.sql
009_table_service_requests.sql
010_shop_order_stats_summary.sql
011_sepay_order_reconciliation.sql
012_table_floor_plan.sql
013_opening_hours_confirmed.sql
014_shop_slug_aliases.sql
```

`npm run db:migrate` thực thi qua Supabase Management API theo cấu hình môi trường; chỉ chạy khi đã xác định đúng DB đích. `002z` lưu archive nhóm bank reference trùng trước khi tạo unique index; cần đối chiếu thủ công trường hợp lịch sử, không coi row giữ lại là kết luận đối soát.

Khi có cấu hình DB, orders đọc DB làm nguồn chính; lỗi DB không được coi là ghi thành công hoặc ghép đơn local vào dữ liệu thật. `.local-db` còn phục vụ một số phần legacy/dev; không phải cơ chế offline đồng bộ đầy đủ.

**Web:** Supabase Realtime → broker server → `/api/orders/events` SSE có xác thực → client tải lại dữ liệu qua API. Staff cần quyền shop; guest cần header `x-tracking-token`. Không mở public orders/RLS để client HMAC đăng ký trực tiếp. **Mobile:** Supabase Auth JWT → Postgres Changes, refresh canonical data qua API. Fallback 30 giây khi lỗi; dừng subscription/polling theo trạng thái màn hình/app. Xem [REALTIME_NOTES.md](REALTIME_NOTES.md).

## Bảng dữ liệu và export

Bảng web thống nhất qua `react-data-table-component`; export báo cáo dùng CSV và XLSX thật theo tab/bộ lọc đang xem. Xem [phạm vi, chart và quy ước export](docs/DATA_TABLES_AND_EXPORT.md). Trang quản lý thực đơn `/dashboard/catalog` hỗ trợ xuất và nhập file Excel `.xlsx` chuyên dụng bằng ExcelJS cho phép sửa giá và tồn kho hàng loạt với mã món ổn định, hỗ trợ biểu diễn và khôi phục tồn kho không giới hạn (`∞` ↔ `null`), và bảng xem trước (preview) phân loại dòng thay đổi/không đổi/lỗi trước khi lưu lên server.

## Kiểm tra

```bash
npm run lint
npm run typecheck
npm run typecheck --prefix mobile
npm run test:unit
npm run test:review
npm run test:sql
npm test --prefix mobile
npm run build
```

`test:sql` dùng PGlite cô lập, gồm migration bàn và ranh giới RLS; review tests gồm auth, quyền/RLS, giá, đơn, admin, realtime và i18n. Không đóng đinh tổng số test: lấy kết quả của lần chạy thực tế.

`npm test` root còn chạy `test:e2e`, có ghi dữ liệu qua server; chỉ dùng server/DB test dùng một lần, không trỏ production. Các fixture `tests/*-ui-fixture.mjs` chỉ phục vụ kiểm tra UI local. Script `lint` chạy qua ESLint CLI chuẩn (`eslint .`) dùng flat config `eslint.config.mjs` với `next/core-web-vitals` và `next/typescript` qua `@eslint/eslintrc` `FlatCompat` trên cặp phiên bản tương thích Next.js 15 (`eslint@^9.39.5`, `eslint-config-next@^15.1.6`, `@eslint/eslintrc@^3.3.7`), bảo đảm non-interactive, tất định và pass sạch (0 errors, 38 warnings được giữ nguyên để theo dõi). Lưu ý: ESLint 9 hiện đã chạm mốc upstream EOL (hết hỗ trợ chính thức từ upstream ESLint); cấu hình này là giải pháp tương thích hoạt động ổn định trên runtime Next.js 15 hiện tại và cần được rà soát/nâng cấp đồng bộ khi dự án thực hiện nâng cấp framework Next.js trong tương lai, không khẳng định toolchain lint đang ở phiên bản upstream còn được hỗ trợ.

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

Demo seed: `/s/pho-hoi-an`, `/s/linh-spa-nail`, `/s/dac-san-mien-trung`; thêm `/menu` cho menu. Các route làm việc: `/dashboard`, `/dashboard/orders`, `/dashboard/kitchen`, `/dashboard/catalog`, `/dashboard/reports`, `/dashboard/posts`, `/dashboard/settings`, `/dashboard/ai-scanner`, `/dashboard/qr-studio`, `/dashboard/billing`, `/admin`.

## Triển khai và giới hạn

Push `main` kích hoạt `.github/workflows/deploy.yml`: verify web/mobile + SQL + build → migration → SSH deploy đúng SHA → kiểm tra subscription orders. Workflow dùng PM2 và runtime env; đọc workflow trước khi sửa cổng hay deploy. Không push chỉ để cập nhật tài liệu nếu chưa có yêu cầu triển khai.

Máy in thật, thiết bị iOS/Android, giao dịch ngân hàng và trạng thái production cần kiểm chứng riêng. Web print ghi nhận yêu cầu in, không xác nhận đã ra giấy. Webhook nâng gói SaaS khác đối soát tiền khách trả cho merchant. Tổng hợp doanh thu/số lượng đơn của `GET /api/orders`, `dbGetShopAnalyticsSummary` và tab Tổng quan Mobile được tính phía server qua RPC `get_shop_order_stats_summary` (kèm fallback phân trang `.range()`) để không bị giới hạn 1000 dòng mặc định của PostgREST, trong khi danh sách `orders` chung trả về được giới hạn 1000 đơn gần nhất (riêng màn hình bếp KDS dùng `GET /api/orders?shopId=...&view=kds` lọc `new/preparing` tại DB và phân trang `.range()` để không làm khuất đơn đang chờ cũ sau 1000 đơn đã hoàn tất/hủy); audit/payment ledger cho chốt ca chưa hoàn chỉnh.

## Tài liệu

- [ARCHITECTURE.md](ARCHITECTURE.md): bản đồ code và luồng nghiệp vụ hiện tại.
- [docs/SEPAY_WEBHOOK_SETUP.md](docs/SEPAY_WEBHOOK_SETUP.md): đối soát tự động VietQR cho đơn hàng khách qua SePay (`/api/webhooks/sepay/[shopId]`), mã hóa secret AES-256-GCM và migration 011.
- [docs/TABLE_MANAGEMENT.md](docs/TABLE_MANAGEMENT.md): quản lý bàn, QR từng bàn, sơ đồ mặt bằng (floor plan), báo cáo và migration 007, 012.
- [docs/CODEX_TABLES_REVIEW.md](docs/CODEX_TABLES_REVIEW.md): kết quả kiểm tra độc lập và giới hạn của bản bàn/theme/UI.
- [docs/APP_REVIEW.md](docs/APP_REVIEW.md): kết quả rà soát, chênh lệch tài liệu và điểm cần theo dõi.
- [I18N_NOTES.md](I18N_NOTES.md), [REALTIME_NOTES.md](REALTIME_NOTES.md): chi tiết chuyên đề.
- [REVIEW_NOTES.md](REVIEW_NOTES.md), `AGY_*`: lịch sử review/triển khai; kết quả test trong đó thuộc thời điểm ghi.
- [TODO.md](TODO.md), [document.md](document.md): roadmap/đặc tả gốc, không dùng để khẳng định tính năng hiện tại đã hoàn tất.
