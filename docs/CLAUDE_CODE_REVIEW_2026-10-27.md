# Qlaok — Rà soát toàn bộ codebase (Backend · Database · Supabase · SQL · UI · i18n · Mobile)

**Ngày:** 27/10/2026
**Người rà:** Claude Code (rà tĩnh + chạy check + probe runtime cục bộ)
**Baseline tham chiếu:** [25/10/2026](./CLAUDE_CODE_REVIEW_2026-10-25.md), [AGY 26/10/2026](./AGY_CODE_REVIEW_2026-10-26.md), [mở rộng vòng 2–9 26/10/2026](./QLAOK_CODE_REVIEW_EXPANSION_2026-10-26.md)
**Phạm vi:** 141 file TS/TSX (~97.572 dòng `src`), 21 route handler, 24 file migration SQL (`001`–`023` + `002z`), `mobile/src` (29 file), `scripts/`, `supabase/self-hosted/`, CI workflow, 69 file test. **Vòng này phủ thêm ba tầng trước đây chưa rà sâu:** tầng UI/component (`src/components/dashboard/*`, `src/app/(dashboard)/**`), i18n (`src/lib/i18n-helper.ts` + chuỗi hardcode), và toàn bộ app mobile (`mobile/App.tsx`, `mobile/src/**`).
**Trạng thái làm việc khi rà:** cây làm việc có WIP chưa commit (thêm `src/lib/auth-email.ts`, `src/lib/auth-email-templates.ts`, sửa `zitadel-login-ui.ts`, `login-ui/route.ts`, 2 file test). Các kết luận dưới đây phản ánh **đúng trạng thái đĩa tại thời điểm rà**.

---

## 1. Kết luận tổng quát

**Codebase ở mức tốt, trên trung bình rõ rệt so với mặt bằng dự án cùng quy mô.** Kiến trúc tách lớp rõ (route → `lib` domain → RPC SQL), các bất biến nghiệp vụ quan trọng (giá do server quyết, fulfillment tách payment, atomic order/inventory) được cưỡng chế ở **cả hai tầng** TypeScript và PostgreSQL. Phần database là điểm mạnh nhất: RLS bật toàn bộ bảng, `SECURITY DEFINER` ghim `search_path`, RPC nghiệp vụ `REVOKE` khỏi `PUBLIC/anon/authenticated` và chỉ `GRANT` cho `service_role`.

**Điểm yếu tập trung ở ba chỗ: biên (edge), vận hành, và tầng UI điều khiển ghi dữ liệu.** Các endpoint công khai (catalog, posts, analytics, health) chưa lọc dữ liệu nội bộ; một số secret mặc định còn trong mã nguồn; đường fallback local JSON (`mpos-store`, `shop-tables`) nuốt lỗi ghi; **không có backup tự động nào cho PostgreSQL tự host** và script deploy đang âm thầm rollback `.local-db`; audit trail ghi vào file không ai đọc; và **trạng thái CI hiện đang đỏ** (typecheck + lint + e2e + 3 test review fail, tất cả nằm ngoài `src/`).

Nghiêm trọng nhất về nghiệp vụ là một nhóm lỗi mà lớp bảo vệ phía server **không thể** bắt, vì client tự gửi con số nó tin là đúng: nút "Hoàn tất" ở trang admin ghi thẳng `payment_status: 'paid'` cho đơn chưa thu tiền (P1-5), nút "Huỷ" tự hoàn tiền ngầm bỏ qua cổng xác nhận của `/api/orders` (P1-6), và POS "Sửa đơn" làm **mất giảm giá** nên tổng tiền tăng sau khi lưu (P1-4). Ba lỗi này nằm ở UI, không nằm ở SQL hay route — đó là lý do các bộ test hiện có (đều kiểm hàm server) không thấy chúng.

| Hạng mục | Đánh giá |
| --- | --- |
| Kiến trúc backend (route/lib separation) | Tốt |
| Authorization theo endpoint | Tốt, có vài lỗ hổng công khai |
| **Authorization ở tầng UI** | **Trung bình — nút hiện không khớp quyền server (P2-14, P2-15)** |
| Database schema & index | Tốt |
| RLS & SECURITY DEFINER | Rất tốt (8 hàm trigger chưa `REVOKE`, rủi ro thấp) |
| Chất lượng SQL / migration | Tốt, có checksum guard; **runner thiếu transaction** |
| Cách dùng Supabase client | Tốt (gatekey rõ ràng) |
| **Bất biến nghiệp vụ ở UI (payment/giảm giá)** | **Yếu — 3 lỗi P1 ở POS + admin** |
| Secret management | **Yếu** (1 key hardcode + 2 default password + 1 secret dùng 2 mục đích) |
| Test coverage | Khá (69 file test) nhưng CI đang đỏ; **0 test cho vòng hydrate/ghi của UI** |
| Realtime | Tốt (SSE + LISTEN/NOTIFY, payload tối thiểu) |
| Mobile | Tốt (fail closed, không chạm `*.supabase.co`); **auth flow ghim prod host (P2-16)** |
| i18n | Trung bình — 2 miền locale tách đúng, nhưng lọt chuỗi VI hardcode (P3-18, P3-19, P3-29) và `?lang=` khoá switcher (P2-18) |
| **Vận hành / backup** | **Yếu — không có backup tự động nào cho PostgreSQL tự host; deploy rollback `.local-db`** |
| Audit trail | **Yếu — ghi mà không ai đọc, không rotate, quyền 644** |
| Repo hygiene | Trung bình (tracked zip/tsbuildinfo, `.agy-runs` lọt lint, `mobile/src/lib/auth-recovery.ts` chết) |

---

## 2. Kiến trúc Backend

### 2.1 Phân lớp — đúng và nhất quán

```
src/app/api/**/route.ts      ← biên HTTP: parse, auth guard, mã lỗi, HTTP status
src/lib/db.ts                ← truy vấn Supabase/PostgREST, seed, readiness cache
src/lib/mpos-store.ts        ← domain đơn hàng/POS (3.605 dòng)
src/lib/sepay-reconciliation.ts ← đối soát SePay (2.226 dòng)
src/lib/staff-accounts.ts    ← tài khoản nhân viên (2.226 dòng)
src/lib/server-auth.ts       ← phiên HMAC, JWT PostgREST, Zitadel JWKS, guard quyền
supabase/migrations/00N.sql  ← bảng, RLS, RPC nguyên tử, trigger bất biến
```

Route handler **không tự viết SQL**; mọi mutation đi qua hàm `lib` → RPC. Đây là kỷ luật tốt và hiếm gặp: nó khiến việc kiểm tra bất biến chỉ cần làm ở một chỗ.

**Nhận xét:** `route.ts` vẫn khá dày (admin 855 dòng, orders 1.044 dòng, auth 938 dòng). Chấp nhận được, nhưng nếu tiếp tục phình nên tách thành `_lib/` theo domain (đã có tiền lệ tốt: `src/app/api/ai/_lib/guard.ts`).

### 2.2 Authorization — mô hình guard nhất quán

Mọi route nghiệp vụ dùng đúng bộ guard trong `src/lib/server-auth.ts`:

| Guard | Dùng cho |
| --- | --- |
| `requireAuthenticatedUser` | upload, sync_user |
| `requireSuperAdmin` | `admin` (cả GET và POST) |
| `requireShopOwnerOrAdmin` | posts write, sepay GET |
| `requireShopPermission(shopId, perm)` | catalog write, orders, analytics GET, tables, service-requests PATCH |
| `requireShopOwnerOrAdmin` / `isStaffSessionUser` | upload (chặn nhân viên) |
| tracking token + `verifyGuestOrderTrackingToken` | orders GET của khách, SSE theo orderId |

Kiểm tra chéo shop được xử lý đúng: `requireShopPermission` trả `403 FORBIDDEN_CROSS_SHOP_ACCESS`, `404` khi shop không tồn tại, fail closed khi DB lỗi (`shop-permissions.ts` — `resolveUserShopMembership`).

**Điểm trừ:** repo **không có `src/middleware.ts`**. Toàn bộ auth là trách nhiệm từng route. Đã kiểm 21 route, hiện không có route nào quên guard ở mutation, nhưng đây là mô hình dễ hỏng khi thêm route mới. Cân nhắc middleware chỉ để gắn header/CSRF, không thay guard.

### 2.3 Endpoint công khai — cần siết

| Endpoint | Auth | Vấn đề |
| --- | --- | --- |
| `GET /api/catalog` (`catalog/route.ts:163`) | không | Trả **nguyên row `shops`** gồm `owner_id`, `theme_config`, `opening_hours`, kể cả shop **chưa publish** |
| `GET /api/posts` (`posts/route.ts:10`) | không | Không lọc `is_active`; **không có `shopId` thì trả bài của shop đầu tiên trong DB** (`db.ts:1722-1730`) |
| `POST /api/analytics/track` (`track/route.ts:22`) | không | Nhận `shop_id`/`event_type`/`item_id` tuỳ ý, không validate tồn tại, không rate limit |
| `GET /api/health` | không | Lộ `aiProvider`, baseUrl gateway, model, và **count toàn bộ bảng** |
| `POST /api/service-requests` | chữ ký QR bàn | Đúng thiết kế, có `idempotency_key` |
| `POST /api/webhooks/sepay/[shopId]` | HMAC theo shop | Đúng thiết kế |

Kiểm chứng runtime (dev server cục bộ):

```
GET /api/catalog?shopId=shop-fnb-001  → 200, shop có owner_id=True, theme_config=True
GET /api/posts                        → 200, trả post của shop-fnb-001 (shop đầu tiên)
GET /api/shops                        → 200, 9 shop
GET /api/health                       → 200, dataSource=self-hosted-postgres, counts đầy đủ
```

**Tác động:** `owner_id` là UUID profile chủ quán — lộ ra ngoài tạo điều kiện dò ID cho các endpoint khác. `theme_config` chứa cấu hình khuyến mãi/SePay-adjacent; cần rà lại xem có trường secret nào lọt (đã có migration `011` chặn secret trong `theme_config`, nên rủi ro thấp nhưng vẫn nên whitelist cột).

**Hướng sửa:** whitelist cột trả về (`select('id,slug,name,vertical,tagline_i18n,...')`), thêm `.eq('is_published', true)` khi không phải owner, và đổi mặc định "shop đầu tiên" thành lỗi `400 SHOP_ID_REQUIRED`.

### 2.4 Định giá & bất biến thanh toán — làm đúng

- Giá luôn tính ở server: `computeSharedOrderQuote` (`src/lib/order-pricing.ts:150+`) dùng `original_unit_price ?? unit_price` + `extra_price`, chỉ áp flash sale khi `applyShopPromotions`, chỉ áp giảm giá dòng khi `canApplyManualDiscount`.
- Client gửi `expected_total` → server re-quote → lệch thì `409 PRICE_CHANGED` (`orders/route.ts` POST).
- Giá gói SaaS cố định server-side: `OFFICIAL_PLAN_PRICES_VND` (`db.ts:2045`), admin không được ghi đè (`webhooks/payment/route.ts`).
- Fulfillment và payment độc lập: `assertPaymentTransition` chặn `paid → unpaid`, chặn `refunded → unpaid`; `PATCH /api/orders` cho khách tự sửa chỉ khi `status === 'new'` **và** `payment_status === 'unpaid'`.
- Khoá idempotency: partial unique index ở DB + kiểm tra replay trước khi commit.

Đây là phần **được làm cẩn thận nhất** ở tầng server. Không tìm thấy đường nào để client tự đặt giá hoặc tự chuyển trạng thái thanh toán **qua `/api/orders`**.

**Nhưng mô hình này có một lỗ ở tầng thứ ba mà cả ba lớp trên đều không phủ:** các lớp bảo vệ đều kiểm *giá trị* gửi lên, không kiểm *ý định* của người gửi. Ba đường ghi tiền dưới đây gửi những giá trị hợp lệ về mặt kỹ thuật nhưng sai về nghiệp vụ:

| Đường | Gửi gì | Hậu quả | Finding |
| --- | --- | --- | --- |
| Admin "Hoàn tất" | `{status:'completed', payment_status:'paid'}` | Đơn chưa thu tiền thành đã trả tiền, có `paid_at` + idempotency key giả | P1-5 |
| Admin "Huỷ" | `{status:'cancelled'}` | Server tự `refunded` đơn đã `paid`, không lý do, không xác nhận | P1-6 |
| POS "Sửa đơn" | `discount_amount: 0` + `expected_total` tự tính sai | Giảm giá mất, tổng tiền tăng, `409` không bắt được | P1-4 |

Điểm chung: `assertPaymentTransition` chỉ chặn *chiều* chuyển trạng thái, còn `unpaid → paid` là chiều hợp lệ. Trigger SQL cũng vậy. Nên kết luận đúng là: **bất biến được cưỡng chế ở SQL/TS, nhưng "ai được phép khởi phát chuyển trạng thái đó" thì không được cưỡng chế ở bất kỳ đâu** — kể cả tầng quyền, vì nhánh `update_order_status` trong `admin/route.ts:738-756` không kiểm `payment.collect` (khác với `/api/orders` PATCH, nơi `payment_status !== undefined` luôn kéo theo `requiredPerms.add('payment.collect')` — `orders/route.ts:860-862`).

### 2.5 Realtime — thiết kế đúng

`src/lib/order-events.ts` (`handleOrderEventsRequest`) + migration `022`:

- SSE qua `ReadableStream`, backend là PostgreSQL `LISTEN/NOTIFY` trên channel `qlaok_order_events`.
- Payload **tối thiểu**: `table`, `op`, `orderId`, `shopId` — không có dữ liệu khách/món/thanh toán.
- Trigger `AFTER ... RETURN NULL`, `SECURITY DEFINER` + `SET search_path = public, pg_temp`, không đột biến dữ liệu nghiệp vụ, không đổi RLS (đúng ràng buộc "never weaken RLS to enable realtime").
- Vòng đời: stream 120s, heartbeat 15s, revalidate quyền 45s, queue có giới hạn, client fallback 30s.

Không có điểm trừ đáng kể. Một lưu ý: trigger này là `SECURITY DEFINER` nhưng **không có `REVOKE EXECUTE`** — xem mục 3.4.

### 2.6 Vận hành: CI/CD, migration, backup

Luồng thật (`.github/workflows/verify-pr.yml`, `deploy.yml`):

```
PR        → verify: npm ci ×2 → typecheck ×2 → test:unit / test:review / test:sql / test:db-reset / mobile test → build
push main → verify (như trên) → SSH VPS: backup .local-db → git reset --hard <sha> → restore → migrate → npm ci → build → pm2 restart → check-order-realtime
```

**Đúng:** verify là **cổng bắt buộc** trước deploy (`needs: verify`, `if: needs.verify.result == 'success'`); deploy đúng SHA (`git reset --hard ${{ github.sha }}`), không deploy nhánh trôi; migration chạy **trước** build nên app mới không bao giờ chạy trên schema cũ; `pm2 delete` chỉ đụng app `qlaok`, không đụng app khác; `env -i` + chỉ giữ `HOME/PATH/PM2_HOME/NODE_ENV` để tiến trình SSH không ghi đè `.env.local` — chi tiết đúng và có ghi trong `docs/SELF_HOSTED_POSTGRES_ZITADEL.md:85`.

**Sai (chi tiết ở P2-10, P2-11, 3.5):**

1. **Backup `.local-db` qua `/tmp` không có cleanup → rollback dữ liệu ở deploy #2.** Đã tái hiện.
2. **Migration runner không có transaction** → file lỗi giữa đường để lại schema nửa vời.
3. **Không có backup DB tự host nào.** Script duy nhất (`backup-qlaok-db.mjs`) khoá cứng Supabase Cloud (`REQUIRED_PROJECT_REF`).
4. `node scripts/check-order-realtime.mjs` chạy **sau** `pm2 start` trong `set -eu` → nếu probe fail, **deploy bị đánh dấu thất bại nhưng bản mới đã live**, không có rollback. Trạng thái "deploy đỏ" vì thế không đồng nghĩa "production còn bản cũ".
5. `test:e2e` **không** chạy ở cả hai workflow.

### 2.7 Tầng UI/dashboard — mô hình quyền không nhất quán, và không có test cho vòng ghi

Đây là tầng mà vòng rà này bổ sung. Cấu trúc component tốt: `src/components/dashboard/*` là các khối trình bày có prop tường minh, `src/app/(dashboard)/**/page.tsx` giữ state + gọi API, và mọi mutation đều đi qua `fetch('/api/...')` với `getAuthHeaders()`. Không tìm thấy chỗ nào component tự gọi Supabase.

**Ba vấn đề hệ thống:**

1. **Quyền được kiểm ở ba nơi khác nhau, với ba quy ước khác nhau.** Cùng một trang catalog: bulk action có `canManageCatalog`/`canAdjustInventory` (`catalog/page.tsx:717, 814, 996, 1087`), `QuickItemRow` không có cờ nào, còn handler cá nhân thì **không** kiểm — dựa hoàn toàn vào server `403` rồi rollback. Trang orders thì ngược lại: `canRefundOrder`/`canEditItems`/`canCancelUnpaid` có, `canApplyDiscount` không (P2-15). Trang settings thì server đòi ALL-of hai quyền trong khi nav chỉ cần một (P2-14).

2. **Không có test nào phủ "vòng ghi" của UI.** 69 file test (133 unit + 336 review + 6 sql + 106 mobile) đều kiểm hàm thuần (`computeSharedOrderQuote`, `assertPaymentTransition`, `hasShopPermission`), route handler, hoặc — với 21 file — **regex trên source component** (`assert.match(adminPageSource, /disabled=\{actionBusy \|\| !canReseedDemoData\}/)` kiểu `tests/admin-review.test.ts:954-967`). Kiểu test thứ ba chỉ chứng minh "chuỗi này có trong file", không chứng minh hành vi; nó cũng không bắt được payload sai. Không có test nào mô phỏng: hydrate state từ một đơn có sẵn → người dùng bấm lưu → assert payload. Kiểm cụ thể: `grep -rn "PosCounterWorkspace" tests/` → **0 kết quả**; `grep -rn "update_order_status" tests/` → **0 kết quả**. Đúng hai khoảng trống này chứa cả ba P1 mới (P1-4 mất giảm giá, P1-5 paid-on-complete, P1-6 auto-refund). Một test kiểu `hydrate → serialize → so với input` sẽ bắt P1-4 ngay; một test kiểu `render nút → assert payload` sẽ bắt P1-5.

3. **Optimistic update không đồng bộ với response.** Đây là pattern lặp lại có chủ đích (tốt cho UX) nhưng chỉ đúng khi có rollback: catalog desktop có rollback đầy đủ (`handleUpdatePrice` `:373-376`, `handleDeleteItem` `:479-494`), còn mobile thì không (P3-25). Không có quy ước chung nào ghi "optimistic phải rollback".

**Điểm tốt nên giữ:** `orders/page.tsx:714-727` phân biệt rõ hành động phá huỷ (default-deny khi membership chưa tải) và không phá huỷ (optimistic default) — đây là quy ước đúng, nên đưa vào các trang khác.

### 2.8 i18n — hai miền tách đúng, nhưng chuỗi hardcode vẫn lọt vào dữ liệu

Hai miền locale tách rõ và **không** trộn: storefront 8 ngôn ngữ (`vi/en/ko/ja/zh/es/it/ru`, giới hạn theo gói qua `maxLangs` 1/3/8) và app domain VI/EN (`AppI18nProvider`). `tField` có chuỗi fallback `locale → en → vi` (`i18n-helper.ts:142-152`), `getGuestOrderLabels` merge EN làm nền (`:1549-1551`) — thiếu key thì rơi về EN chứ không crash. Thiết kế này đúng.

**Nhưng "không crash" cũng có nghĩa là thiếu bản dịch không ai phát hiện.** Ba biểu hiện:

1. **Thiếu key lặng lẽ** — `errorTrackingToken` chỉ có ở EN + VI (P3-19). Không có script nào so sánh tập key giữa các locale.
2. **Chuỗi người dùng tạo ra bị đóng băng vào tiếng Việt** — banner khuyến mãi (`PromotionsTab.tsx:80-92`) và text giảm giá trong POS (`PosCounterWorkspace.tsx:729`) sinh chuỗi VI rồi **lưu vào DB** hoặc ghi vào `custom_note` của đơn. Đây không phải lỗi dịch mà là lỗi dữ liệu: nó không thể sửa bằng cách thêm bản dịch sau này.
3. **Định dạng tiền tệ hardcode** — `formatCurrency` luôn `vi-VN` + `đ` (P3-18), nên không có đường nào hiển thị VND theo locale khác dù UI đã đổi ngôn ngữ.

Ngoài ra `?lang=` bị áp lại mỗi render (P2-18) làm switcher thành nút chết trên đúng trang mà email dẫn tới — lỗi nhỏ nhưng nằm ngay cửa vào của toàn bộ luồng đăng ký/đặt lại mật khẩu.

### 2.9 Mobile — fail closed đúng, nhưng cấu hình build làm hỏng hai tính năng

`mobile/src/lib/api-client.ts` là lớp gọi API tốt nhất trong repo về mặt fail-closed: không có token → throw; mỗi request một host, **không replay mutation sang host khác** (`:16`); có guard chống đệ quy `onUnauthorized` (`:22, :63-79`); timeout 15s có abort. `supabase.ts:109,142` từ chối `*.supabase.co`, không có key server nào trong `EXPO_PUBLIC_*`, SecureStore tách phiên owner/nhân viên.

Hai điều làm phần tốt đó không phát huy tác dụng, và cả hai đều là lỗi cấu hình chứ không phải logic:

1. **Host bị chọn sai cho luồng đăng nhập.** `AuthScreen` mặc định `PRODUCTION_API_URL` (`:182`) và `App.tsx:369-380` không truyền override ⇒ toàn bộ login/register/reset/OIDC đi thẳng production, bỏ qua `EXPO_PUBLIC_API_URL` (P2-16). Ngược lại `resolveApiBaseUrl` nhánh env **không bắt buộc HTTPS** (P2-17).
2. **Hai tính năng bị tắt mà không có cảnh báo build.** Push: `app.json` `extra.eas.projectId` rỗng (P3-27) ⇒ không có token ⇒ nhánh "unavailable" — im lặng. Phục hồi phiên: `auth-recovery.ts` 465 dòng không ai import (P3-26) trong khi `App.tsx` có logic recovery riêng.

Thêm hai lỗi state nhỏ nhưng cùng một dạng "xoá trước, làm sau": push unregister xoá state trước khi gọi DELETE (P3-22), OIDC callback đánh dấu đã xử lý trước khi exchange (P3-24).

---

## 3. Database · Supabase · SQL

### 3.1 Cách dùng Supabase

Đây là điểm đáng khen: dự án **không** dùng Supabase như một BaaS mặc định, mà dùng nó như lớp PostgREST trên PostgreSQL tự host.

- `dataSource: 'self-hosted-postgres'` (`health/route.ts`), khớp `ARCHITECTURE.md` và `docs/SELF_HOSTED_POSTGRES_ZITADEL.md`.
- `getSupabaseDbClient()` (`db.ts:93`) chọn key theo thứ tự `SUPABASE_SERVICE_ROLE_KEY` → anon key.
- `hasSupabaseServiceRoleKey()` (`db.ts`) **từ chối** key `sb_publishable_*`, từ chối key trùng anon, và decode JWT để kiểm `role === 'service_role'`. Đây là gatekeeping đúng và hiếm gặp.
- `requireSupabaseServiceRoleClient()` ném `MISSING_SERVICE_ROLE_KEY` thay vì âm thầm hạ quyền.
- `createSupabasePublicAuthClient()` tách client để không làm nhiễm client dùng chung.
- Auto-seed chỉ khi `NODE_ENV !== 'production'` (`db.ts:174`), không cache lỗi, không short-circuit DB rỗng ở production.

**Hạn chế (đã ghi trong ARCHITECTURE.md, xác nhận là đúng):**
- `loadMergedOrders` dùng `.select('*')` với `limit = STATS_ORDER_PAGE_SIZE = 1000` (`mpos-store.ts:3258, 1202-1216`) → shop vượt 1.000 đơn sẽ **cắt âm thầm** ở dashboard. Chưa có phân trang.
- 30 chỗ `select('*')` trong `db.ts`, 10 trong `mpos-store.ts`. Với bảng `shops`/`profiles` điều này trực tiếp gây rò rỉ cột ra API công khai.

### 3.2 Schema & index

- 21 bảng, **tất cả** đều có `ENABLE ROW LEVEL SECURITY` (kiểm bằng grep qua toàn bộ migration).
- Index phủ đúng truy vấn thực tế: `orders(shop_id, status)`, `orders(shop_id, payment_status)`, `orders(shop_id, table_id)`, `orders(session_id)`, unique partial index cho `idempotency_key`, `shop_memberships(staff user single-shop)`, `shop_memberships(shop_id, username)`, `shops(slug)`, `shops(owner_id)`, `sepay_webhook_events`, `push_tokens`, `staff_login_rate_limits`.
- `012` thêm `layout_x/layout_y` với `CHECK [0,100]` + index `idx_orders_shop_table_floor_status` — đúng kiểu thêm constraint có kiểm chứng.
- Khoá ngoại có `ON DELETE` tường minh (`CASCADE` cho catalog/post, `SET NULL` cho `item_id` của analytics) — không có cascade mù.

**Thiếu:** không có unique constraint ở DB cho `orders.order_code`. Code sinh mã với 30 lần thử + kiểm tra tồn tại (`dbCreateOrder`), nhưng giữa hai instance vẫn có cửa sổ race. Đã được nêu ở báo cáo 25/10 (`T6`) và **vẫn còn**.

### 3.3 RLS

Mô hình tiến hoá đúng hướng:

1. `001`/`002` tạo policy `USING (true)` (giai đoạn đầu).
2. `003` **drop toàn bộ** policy permissive và thay bằng policy chặt: `profiles_owner_select/update`, `posts_public_or_owner_select`, `posts_owner_write`, cùng trigger `prevent_client_profile_plan_escalation`.
3. `004` thêm `shop_memberships`, `order_audit_logs`, các helper `is_client_request_context()`, `user_is_shop_owner()`, `user_has_shop_permission()` (`SECURITY DEFINER`, `SET search_path = public`), và trigger biên cho membership/shop/order.

Đã kiểm: **không còn** policy `USING (true)` nào sót lại ở trạng thái cuối (8 lần xuất hiện đều nằm trong `001`/`002`, đã bị `003:34-38` drop).

Có test SQL thật cho RLS: `tests/shop-permissions-and-rls.test.ts` + `tests/sql-review.test.mjs` khẳng định member chỉ đọc được đơn được gán, đọc được toàn bộ `shop_tables`, và bị `permission denied` khi gọi thẳng `commit_order_with_inventory` hay đọc `payment_bank_ref_conflicts`.

### 3.4 SECURITY DEFINER — kỷ luật tốt, 8 hàm trigger còn hở

Đếm lại đầy đủ bằng script trên 14 file migration: **33 hàm `SECURITY DEFINER`**, trong đó **21 hàm có `REVOKE ... ON FUNCTION` + `GRANT EXECUTE ... TO service_role`**, 2 hàm helper RLS (`004` `user_is_shop_owner`, `user_has_shop_permission`) cố ý grant cho `anon/authenticated` — đúng. **8 hàm còn lại không có revoke cấp hàm:**

| Migration | Hàm | Kiểu trả về |
| --- | --- | --- |
| `007_shop_tables.sql:161` | `enforce_shop_table_boundaries()` | `TRIGGER` |
| `008_mobile_push_tokens.sql` | `enforce_mobile_push_tokens_boundaries()` | `TRIGGER` |
| `011_sepay_order_reconciliation.sql:44` | `enforce_shop_sepay_configs_boundaries()` | `TRIGGER` |
| `011_sepay_order_reconciliation.sql:187` | `enforce_sepay_webhook_events_boundaries()` | `TRIGGER` |
| `014_shop_slug_aliases.sql:40,83,142` | `enforce_shop_slug_aliases_boundaries()`, `validate_shop_slug_and_aliases()`, `record_shop_slug_alias_on_update()` | `TRIGGER` |
| `022_postgres_realtime_notifications.sql:18` | `notify_order_events()` | `trigger` |

Cả 8 hàm đều `RETURNS TRIGGER`. PostgreSQL **không cho gọi trực tiếp** hàm `RETURNS trigger` ngoài ngữ cảnh trigger (`ERROR: trigger functions can only be called as triggers`), nên rủi ro thực tế **thấp**. Nhưng đây là sai lệch so với chuẩn nội bộ mà chính repo đặt ra: `019_revoke_staff_trigger_execute.sql:8-9` đã phải revoke đúng loại hàm này cho `018`. Nên bổ sung cho đồng nhất, và để nếu sau này ai đổi signature sang hàm thường thì không mở lỗ.

`REVOKE` hiện có đúng và đủ cho toàn bộ hàm nghiệp vụ: `005`/`007`/`017` (commit/update order, settle table bill), `009`, `010`, `011` reconcile, `015`, `018` (8 hàm), `023`.

### 3.5 Chất lượng SQL

- Mọi migration idempotent (`CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS`, `CREATE OR REPLACE FUNCTION`).
- `scripts/migrate-self-hosted.mjs:19-36` `planMigrations` **ném lỗi** khi checksum lệch (`Migration checksum changed after application`) — đúng, **không có nhánh bỏ qua**. **Báo cáo AGY `#15` ("checksum mismatch bị bỏ qua") là sai** — rút lại finding đó.
- Ghi lịch sử bằng `INSERT ... ON CONFLICT DO UPDATE` (`migrate-self-hosted.mjs:113`).
- `002z_reconcile_legacy_bank_refs.sql` là migration dữ liệu có archive trước khi tạo unique index — cách làm đúng, có test xác nhận giữ nguyên cả nhóm xung đột.

**Điểm trừ:**

1. **Runner không chạy trong một transaction.** `runPsql` (`:40-62`) gọi `sudo -n -u postgres psql -X -q -v ON_ERROR_STOP=1 -d <db>` — `-1`/`--single-transaction` **không có**. `ON_ERROR_STOP=1` chỉ dừng ở câu lỗi đầu tiên; mọi câu trước đó trong cùng file **đã commit**. Với migration nhiều bước kiểu `DROP CONSTRAINT` rồi `ADD CONSTRAINT` (`004:128-132`, `005:45-49`), một lỗi giữa file để lại schema ở trạng thái nửa vời mà checksum trong `schema_migrations` cũng không được ghi → lần deploy sau chạy lại từ đầu trên schema đã đổi. Hướng sửa: thêm `-1` vào mảng args của `runPsql`, hoặc bọc mỗi file trong `BEGIN; ... COMMIT;`.
2. SQL dài dòng, nhiều file >900 dòng (`018` 1.013 dòng, `011` 900+). Không sai, nhưng rất khó review. Nên tách theo nhóm hàm cho các migration tiếp theo.

---

## 4. Findings theo mức độ

### P1

#### P1-1. Khoá gateway AI hardcode làm fallback trong mã nguồn

- **Vị trí:** `src/lib/gemini.ts:14-15`
- **Bằng chứng:**
  ```ts
  const apiKey =
    process.env.AI_API_KEY || 'sk-07c9f002b12e445e-luaxyd-d0592739';
  ```
- **Điều kiện:** biến `AI_API_KEY` không được đặt. Xảy ra khi deploy thiếu env, hoặc khi build/CI thiếu env.
- **Tác động:** key sống trong git history (`git show HEAD:src/lib/gemini.ts` xác nhận **đã commit**, không chỉ ở working tree). Bất kỳ ai có repo đều gọi được gateway bằng credit của dự án. Đây là secrets-in-source, không phải "default dev".
- **Hướng sửa:** xoá literal, trả `null` khi thiếu key (đường fallback `parseRawOcrTextFallback`/`smartFallbackTranslate` đã có sẵn), **và rotate key trên gateway** — xoá khỏi code không làm key cũ an toàn.

#### P1-2. `demo_login` cấp phiên owner không cần mật khẩu, không có gate môi trường

- **Vị trí:** `src/app/api/auth/route.ts:784-789`
- **Bằng chứng:**
  ```ts
  if (
    action === 'demo_login' ||
    (action === 'login' &&
      normalizedEmail === 'chuquan@qlaok.vn' &&
      password === 'qlaok123456')
  ) { ... issueSessionToken({ role: 'owner', is_admin: false }) }
  ```
- **Tác động:** `POST /api/auth {"action":"demo_login"}` trả access token + cookie `qlaok_session` của owner `SEED_PROFILE`, TTL 7 ngày, cho **bất kỳ ai**, không cần NODE_ENV, không cần shop tồn tại ở production. Đồng thời nhánh `login` legacy chấp nhận **mật khẩu dùng chung** `qlaok123456`.
- **Ghi chú:** hiện trên máy dev bị chặn gián tiếp vì server chạy production-mode và thiếu `SESSION_SECRET` (trả `500`), nhưng đó là **tai nạn cấu hình**, không phải kiểm soát.
- **Hướng sửa:** chỉ bật `demo_login` khi `NODE_ENV !== 'production'` **và** có cờ tường minh; xoá nhánh `login` + `qlaok123456`; thêm test khẳng định production trả `403`.

#### P1-3. Mật khẩu mặc định dùng chung `qlaok123456` cho owner mới/reset

- **Vị trí:** `src/app/api/admin/route.ts:522-523`; `src/app/(admin)/admin/page.tsx:484, 509, 2218-2219`
- **Bằng chứng:**
  ```ts
  const finalPassword = password && password.length >= 6 ? password : 'qlaok123456';
  ```
- **Tác động:** tạo tài khoản chủ quán mà không nhập mật khẩu → mật khẩu công khai trong tài liệu/giao diện. Kể cả chủ động reset cũng có thể rơi về giá trị này.
- **Trạng thái:** **vẫn tồn tại**, đã được nêu ở báo cáo 25/10 và AGY `#27`. Chưa sửa.
- **Hướng sửa:** bắt buộc mật khẩu tối thiểu 12 ký tự khi `create_owner`; nếu không có thì sinh mật khẩu ngẫu nhiên và buộc đổi ở lần đăng nhập đầu; xoá chuỗi khỏi UI và placeholder.

#### P1-4. POS "Sửa đơn": giảm giá của đơn bị mất, tổng tiền **tăng** sau khi lưu

- **Vị trí:** `src/components/dashboard/PosCounterWorkspace.tsx:94-176` (`hydratePosLinesFromOrder`), `:412-427` (`totals`), `:723-757` (payload dòng), `:784`, `:796` (`discount_amount: totals.totalDiscount`)
- **Bằng chứng — cơ chế chính xác (đã truy hết đường):**
  1. Server **luôn** canonicalise giá dòng về giá catalog: `validateAndPriceOrderLines` đặt `unit_price: authoritativeUnitPrice` và `original_unit_price: authoritativeUnitPrice` (`mpos-store.ts:1030-1033`), với `authoritativeUnitPrice = dbItem.price` (`:947-949`). Toàn bộ giảm giá của một dòng **chỉ** còn nằm ở `orders.discount_amount`, không nằm ở `unit_price` của dòng.
  2. `hydratePosLinesFromOrder` quyết định "giá tuỳ chỉnh" bằng `hasCustomPrice = lineUnitPrice !== Number(fallbackItem.price)` (`:162-166`). Vì (1), `lineUnitPrice === catalog price` ⇒ `hasCustomPrice === false` ⇒ `customUnitPrice: undefined`.
  3. Hàm này **không đọc `order.discount_amount`** ở bất kỳ đâu, và đặt `discountPercent: 0` (`:167`).
  4. Do đó `calcLineAmounts` (`:381-409`) tính `grossUnit = catalogPrice + extra` và `discMultiplier = 1` ⇒ mỗi dòng `discountSaved = 0` ⇒ `totals.totalDiscount === 0` (`:419-422`).
  5. Payload gửi `discount_amount: totals.totalDiscount` = **0**, đồng thời `unit_price: effectiveUnitPrice` = `basePrice` = giá catalog (`:738-746`) — nên cả đường giảm giá dòng cũng bằng 0.
  6. `expected_total: totals.grandTotal` (`:785, :797`) được tính từ chính state đã sai, nên server re-quote ra **đúng** con số đó ⇒ `409 PRICE_CHANGED` (`orders/route.ts:548-557`) **không** bắt được.
- **Điều kiện:** mở bất kỳ đơn nào có `discount_amount > 0` — không chỉ đơn tạo tay, mà cả đơn có khuyến mãi shop (`promo_discount_amount` cũng gộp vào `discount_amount`) — rồi bấm "Lưu" mà không sửa gì.
- **Tác động:** tổng tiền đơn **tăng** đúng bằng phần giảm giá đã mất. Khách được báo giá thấp hơn, quán thu nhiều hơn — không cảnh báo, không log. Vì điểm (6), lớp bảo vệ `expected_total` không những không chặn mà còn **xác nhận** con số sai.
- **Vì sao test hiện có không thấy:** `tests/` kiểm `computeSharedOrderQuote` và `validateAndPriceOrderLines` (tầng server, đúng cả hai), không có test nào mô phỏng hydrate → hiển thị → resubmit.
- **Hướng sửa:** đọc `order.discount_amount` khi hydrate (phân bổ lại thành `discountPercent` hoặc thành `customUnitPrice` trên các dòng), giữ nguyên khi không sửa; thêm test round-trip: tạo đơn có `discount_amount` → hydrate → serialize → assert payload giữ nguyên `discount_amount`. Đồng thời tách rõ `promo_discount_amount` khỏi `manual_discount_amount` khi resubmit, vì hiện POS gộp cả hai thành một và gửi `apply_shop_promotions: false`.

#### P1-5. Admin "Hoàn tất" ghi `payment_status: 'paid'` cho đơn chưa thu tiền — vi phạm bất biến fulfillment ≠ payment

- **Vị trí:** `src/app/(admin)/admin/page.tsx:1195-1210` → `src/app/api/admin/route.ts:738-756` → `src/lib/mpos-store.ts:2571-2578`
- **Bằng chứng:** nút "Hoàn tất" gửi hai trường cùng lúc:
  ```tsx
  runAdminAction({ action: 'update_order_status', orderId: order.id,
                   status: 'completed', payment_status: 'paid' }, ...)
  ```
  Route chuyển thẳng cả hai vào `dbUpdateOrderStatus(orderId, { status, payment_method, payment_status })`; tại `mpos-store.ts:2577` nó set `paid_at` và (nếu thiếu) **tự sinh** `payment_idempotency_key: 'pay-${Date.now()}-...'`.
- **Tác động:** bất kỳ đơn nào — kể cả đơn chưa thanh toán, đơn chuyển khoản đang chờ đối soát — chỉ cần admin bấm "Hoàn tất" là thành **đã trả tiền**, có `paid_at`, có idempotency key giả. Bốn hệ quả:
  1. **Vi phạm bất biến cốt lõi** ghi trong `AGENTS.md` và `ARCHITECTURE.md` ("completing service must not mark an order paid"). Trigger SQL `enforce_order_state_and_payment_invariants` **không chặn** chiều `unpaid → paid`, và `assertPaymentTransition` (`mpos-store.ts:872-878`) cũng không — nên đây là **lỗ hổng thiết kế ở tầng UI affordance**, không phải guard bị vô hiệu.
  2. **Sai lệch doanh thu và đối soát SePay.** Đơn có tiền vào thật sau đó sẽ không còn khớp ledger; `reconcile_sepay_order_payment_atomic` gặp đơn đã `paid` với key khác.
  3. **Không audit, không idempotency thật.** `recordAdminAuditLog` (`admin/route.ts:409`) ghi **trước** dispatch (xem P2-12), và key tự sinh theo `Date.now()` nên retry tạo key mới ⇒ mất tính idempotent.
  4. **Không có bước xác nhận.** `runAdminAction` (`admin/page.tsx:398-421`) gọi `fetch` thẳng — không hộp thoại. Trong khi đó cùng thao tác ở dashboard (`orders/page.tsx:763-787`) có `confirm` với mô tả "Chỉ xác nhận khi đã nhận đủ tiền từ khách" và bảng tóm tắt đơn. Một đường có rào, đường kia không có.
- **Hướng sửa:** nút "Hoàn tất" chỉ gửi `{ status: 'completed' }`. Nếu cần thao tác "thu tiền", làm thành hành động riêng có xác nhận + phương thức thanh toán + audit ghi sau khi thành công. Thêm test khẳng định `update_order_status` từ chối `payment_status` khi caller không có `payment.collect`, và rằng `completed` không tự set `paid`.

#### P1-6. Admin "Huỷ" đơn đã trả tiền tự động hoàn tiền, bỏ qua toàn bộ cổng xác nhận của `/api/orders`

- **Vị trí:** `src/app/(admin)/admin/page.tsx:1219-1235` → `src/lib/mpos-store.ts:2525-2533`
- **Bằng chứng:** UI chỉ gửi `{ status: 'cancelled' }`; server tự đổi trạng thái thanh toán:
  ```ts
  if (existing.payment_status === 'paid' && nextStatus === 'cancelled' &&
      patch.payment_status === undefined) { nextPaymentStatus = 'refunded'; }
  ```
- **Tác động:** một cú bấm "Huỷ" trong bảng admin **hoàn tiền** đơn. So sánh trực tiếp với ba đường tương đương trong repo — cả ba đều chặt hơn:
  1. `/api/orders` PATCH trả **`409`** khi `status === 'cancelled'` mà đơn đã `paid` và `payment_status !== 'refunded'`: *"Đơn đã thu tiền: hãy xác nhận hoàn tiền trước khi hủy."* (`orders/route.ts:909-911`).
  2. Hoàn tiền qua route đó bắt buộc **`REFUND_REASON_REQUIRED`** (`:928-941`).
  3. Dashboard tuân thủ cả hai: `requestCancelOrder` (`orders/page.tsx:790-846`) chỉ gửi `{status:'cancelled', restock_items, cancelled_reason}` và có hộp thoại + lý do bắt buộc; muốn huỷ đơn đã trả tiền thì phải gọi `requestRefundOrder` riêng (`:848-878`), cũng có lý do bắt buộc.

  Nhánh admin đi vòng qua **cả ba**: `admin/route.ts:738-749` gọi `dbUpdateOrderStatus` trực tiếp, không qua `/api/orders`, nên không có `409`, không có `REFUND_REASON_REQUIRED`, và `dbUpdateOrderStatus` tự sinh `refunded` với `refund_reason = undefined`. Toast lại nói "Đã hủy đơn và hoàn tồn kho" — **không nhắc tới hoàn tiền**, nên người bấm không biết mình vừa làm gì.
- **Hướng sửa:** bỏ auto-refund ngầm trong `dbUpdateOrderStatus`; biến hoàn tiền thành hành động tường minh (`refund_order`) có lý do bắt buộc, có audit, và áp **cùng** luật cho mọi caller. Nếu buộc phải giữ auto-refund thì UI admin phải xác nhận hai bước và nói rõ "sẽ hoàn tiền".

#### P1-7. Chuyển shop ở trang Catalog: response cũ ghi đè state, thao tác ghi nhắm sai shop

- **Vị trí:** `src/app/(dashboard)/dashboard/catalog/page.tsx:113-146` (`loadCatalog`), `:148-162` (effect reset khi `activeShop` đổi)
- **Bằng chứng:** `loadCatalog` **không** giữ request sequence, không so `shop.id` tại thời điểm response về; nó `setCategories(...)`/`setItems(...)`/`setOwnerPlan(...)` vô điều kiện (`:124-137`). Effect `:148-162` reset state rồi `void loadCatalog(false)` — request của shop A vẫn đang bay. `loadCatalog` phụ thuộc `[activeShop]` nên mỗi lần đổi shop là một closure mới, nhưng **không** request nào bị huỷ hay bị từ chối khi về muộn.
- **Tác động:** mạng chậm hoặc người dùng bấm đổi shop nhanh ⇒ (a) danh mục/món của **shop trước** hiện dưới tên shop mới; (b) nguy hiểm hơn: `upsertItem` (`:241-252`) gửi nguyên `item` **kèm `shop_id`** lấy từ chính state đang lẫn — nên một lần sửa giá có thể ghi vào shop mà người dùng không nhìn thấy. Server có chặn theo `shop_id` + quyền (nên không vượt được quyền của chính họ), nhưng với owner nhiều quán thì dữ liệu đi **sang quán khác**.
- **Hướng sửa:** dùng `AbortController` hoặc đếm `requestId` + so `shop.id` trước khi `setState`; lấy `shop_id` từ `activeShop` tại thời điểm submit, không từ object `item` đang giữ.

### P2

#### P2-1. `GET /api/catalog` công khai trả nguyên row `shops`, và trả **dữ liệu seed** khi `shopId` không tồn tại

- **Vị trí:** `src/app/api/catalog/route.ts:164-174`; `src/lib/db.ts:1309-1324`
- **Bằng chứng:** `sb.from('shops').select('*')` không lọc `is_published`, không whitelist cột; response giữ nguyên object `shop`. Probe runtime xác nhận trả `owner_id` và `theme_config`. Thêm nữa (`db.ts:1317-1324`): shop không tồn tại → `return { shop: SEED_SHOPS[0], categories: [], items: [], profile: SEED_PROFILE, ownerPlan: 'free' }` thay vì `404`.
- **Tác động:** (a) lộ UUID chủ quán + cấu hình theme của shop chưa publish; (b) shop chưa publish vẫn liệt kê được nếu biết `shopId`; (c) **`shopId` sai/không tồn tại trả 200 kèm dữ liệu seed** — storefront hiển thị một quán không có thật, và client không phân biệt được "shop rỗng" với "shop không tồn tại".
- **Hướng sửa:** whitelist cột public; thêm điều kiện `is_published` cho caller ẩn danh (dùng lại `dbGetStorefrontBundle` đã có sẵn `allowUnpublished`/`allowedUnpublishedShopIds`); trả `404 SHOP_NOT_FOUND` khi `shopId` được truyền mà không có row.

#### P2-2. `GET /api/posts` công khai, không lọc `is_active`, mặc định shop đầu tiên

- **Vị trí:** `src/app/api/posts/route.ts:10-15`; `src/lib/db.ts:1718-1741`
- **Bằng chứng:** `dbGetShopPosts` khi không có `shopId` chọn `shops` `.limit(1).single()`; query `posts` không có `.eq('is_active', true)`. Probe: `GET /api/posts` → trả 1 post của `shop-fnb-001`.
- **Tác động:** nội dung nháp của shop bất kỳ đọc được mà không cần quyền; và endpoint "quên tham số" lại trả dữ liệu của một shop cố định — sai ngữ nghĩa nguy hiểm hơn lỗi 400.
- **Hướng sửa:** lọc `is_active`; trả `400 SHOP_ID_REQUIRED` khi thiếu `shopId`.

#### P2-3. `POST /api/analytics/track` không xác thực + tăng `view_count` kiểu read-modify-write

- **Vị trí:** `src/app/api/analytics/track/route.ts:22-52`; `src/lib/db.ts:1782-1818`
- **Bằng chứng:** POST không guard nào; nhận `shop_id`/`event_type`/`item_id` nguyên văn; `view_count` đọc rồi ghi `(current.view_count || 0) + 1` (`db.ts:1806-1817`). Thêm: khối tăng `view_count` chạy **trước** `if (error) throw` (`db.ts:1818`), nên insert event thất bại vẫn bump `view_count`.
- **Tác động:** (a) bơm sự kiện không giới hạn làm sai lệch báo cáo và phình bảng; (b) `item_id` không kiểm thuộc shop nào → ghi event trỏ tới item của quán khác; (c) race mất lượt khi nhiều khách xem cùng lúc; (d) `view_count` tăng cả khi event không ghi được.
- **Hướng sửa:** validate `shop_id` tồn tại + `item_id ∈ shop`, rate limit theo IP, và thay read-modify-write bằng RPC `UPDATE items SET view_count = view_count + 1` gọi **sau** khi insert thành công.

#### P2-4. `SESSION_SECRET` fallback tái dùng service-role key / webhook secret

- **Vị trí:** `src/lib/server-auth.ts:84-96`
- **Bằng chứng:** `process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PAYMENT_WEBHOOK_SECRET`, và fallback literal dev `qlaok-server-hmac-secret-key-v2-do-not-share-in-client`.
- **Tác động:** một secret dùng cho hai mục đích (frogging). Nếu service-role key lộ (ví dụ log, snapshot `.local-db`, backup) thì kẻ tấn công **ký được phiên owner**. Dev literal fallback cũng khiến mọi máy dev phát hành token có thể giả từ máy khác.
- **Hướng sửa:** chỉ đọc `SESSION_SECRET`; production thiếu thì throw (đã có); dev thì sinh secret ngẫu nhiên theo process và log cảnh báo.

#### P2-5. Chữ ký webhook SePay không kiểm độ mới của timestamp

- **Vị trí:** `src/lib/sepay-reconciliation.ts:690-746`
- **Bằng chứng:** `verifySePayWebhookSignature` kiểm định dạng `sha256=<64hex>`, HMAC trên `${timestamp}.` + raw body, `timingSafeEqual` — nhưng **không so `timestamp` với thời gian hiện tại**.
- **Tác động:** request hợp lệ bị bắt được có thể replay vô hạn. Rủi ro bị giảm bởi ledger idempotent `sepay_webhook_events`, nhưng idempotency chỉ chặn trùng *event*, không chặn việc dùng lại chữ ký cho body khác (không thể, vì body nằm trong HMAC) — nên tác động thực tế là **thấp nhưng nên có**: một cửa sổ ±5 phút là tiêu chuẩn.
- **Hướng sửa:** thêm `Math.abs(now - Number(timestamp)) <= 300` (timestamp đã được kiểm không chứa CRLF), đặt sau bước parse số.

#### P2-6. `writeStore` nuốt lỗi ghi đĩa

- **Vị trí:** `src/lib/mpos-store.ts:580-589`
- **Bằng chứng:**
  ```ts
  try { fs.writeFileSync(...) } catch (err) { console.error('Failed to persist mpos-store.json:', err); }
  ```
- **Tác động:** ở chế độ local (không DB), một mutation có thể trả thành công trong khi dữ liệu **không** được lưu. Đi ngược bất biến "never report successful writes after DB failures".
- **Phạm vi:** chế độ DB `dbCreateOrder` đã ném `DB_COMMIT_REQUIRED`/`DB_COMMIT_FAILED` đúng; vấn đề chỉ ở nhánh file-backed. Vẫn nên sửa vì nhánh này vẫn dùng được ở dev/demo.
- **Hướng sửa:** `writeStore` phải `throw`; nơi gọi quyết định có coi là lỗi nghiệp vụ hay không.

#### P2-7. Floor plan tải toàn bộ lịch sử đơn, trả 500 khi >10.000

- **Vị trí:** `src/app/api/tables/floor-plan/route.ts:18, 51, 80-106`
- **Bằng chứng:** `MAX_RECORDS = 10000`, phân trang 500, và `records.length === MAX_RECORDS` + còn hàng → ném `MAX_RECORDS_EXCEEDED_*` → HTTP 500.
- **Tác động:** shop nhiều lịch sử mất sơ đồ bàn và số tiền chưa thu.
- **Trạng thái:** đã nêu ở AGY `#1`/`#30`, vẫn còn.
- **Hướng sửa:** lọc đơn ở query theo đúng điều kiện tổng hợp cần (chưa huỷ đang mở, hoặc chưa thanh toán), hoặc tính tổng hợp bằng SQL.

#### P2-8. `GET /api/health` lộ cấu hình nội bộ

- **Vị trí:** `src/app/api/health/route.ts:57-65`
- **Bằng chứng:** trả `aiProvider` gồm baseUrl gateway, tên model text/vision; `counts` của 6 bảng.
- **Tác động:** trinh sát hạ tầng miễn phí; counts cho biết quy mô dữ liệu thật.
- **Hướng sửa:** tách `/api/health` (chỉ `{status}`) khỏi `/api/health/detail` (yêu cầu `requireSuperAdmin`).

#### P2-9. `tests/e2e.test.mjs` chứa URL + publishable key Supabase cloud và assert lỗi thời; CI không chạy e2e

- **Vị trí:** `tests/e2e.test.mjs:43` (`assert.equal(data.dataSource, "supabase")`), `:406-408` (`https://kftmrjmmympztzztunxf.supabase.co` + `sb_publishable_...`)
- **Bằng chứng:** test #12 dựng client Supabase cloud trực tiếp; test #1 assert `dataSource === 'supabase'` trong khi runtime trả `'self-hosted-postgres'`; token lấy từ `demo_login` (`:5-17`).
- **Tác động:** bộ e2e **không thể xanh** trong kiến trúc hiện tại; và nó vẫn trỏ vào hạ tầng Supabase cloud mà dự án đã rời bỏ. Vì `.github/workflows/{verify-pr,deploy}.yml` chỉ chạy `typecheck / test:unit / test:review / test:sql / test:db-reset / mobile test / build` — **không chạy `npm run test:e2e`** — nên drift này vô hình trong CI.
- **Hướng sửa:** chuyển e2e sang PostgREST tự host (hoặc base URL qua env), bỏ assert `'supabase'`, bỏ key hardcode, và thêm e2e vào một job có server test.

#### P2-10. Deploy script "backup" `.local-db` qua `/tmp` làm **lùi dữ liệu** ở deploy thứ hai trở đi

- **Vị trí:** `.github/workflows/deploy.yml:49-58`
- **Bằng chứng:**
  ```yaml
  if [ -d ".local-db" ]; then cp -r .local-db /tmp/qlaok_local_db_backup || true; fi
  git fetch origin main
  git reset --hard ${{ github.sha }}
  if [ -d "/tmp/qlaok_local_db_backup" ]; then mkdir -p .local-db; cp -r /tmp/qlaok_local_db_backup/* .local-db/ 2>/dev/null || true; fi
  ```
  Không có `rm -rf /tmp/qlaok_local_db_backup` ở đầu **hoặc** cuối script.
- **Đã tái hiện** bằng hai thư mục mô phỏng đúng chuỗi lệnh trên (`/tmp/deploysim` → `/tmp/ds2`):
  - Deploy #1 tạo `/tmp/qlaok_local_db_backup` với snapshot `{"v":1}`.
  - Deploy #2: `cp -r .local-db /tmp/qlaok_local_db_backup` **không thay thế** thư mục đã tồn tại — nó copy vào trong, thành `/tmp/qlaok_local_db_backup/.local-db/`. Bước restore sau đó `cp -r /tmp/qlaok_local_db_backup/* .local-db/` đè file hiện tại bằng **snapshot cũ của deploy #1** và tạo thêm `.local-db/.local-db/` lồng nhau.
  - Kết quả đo được: `mpos-store.json` `{"v":2}` → `{"v":1}`; `order-audit.log.jsonl` mất dòng `log-2`.
- **Tác động:** mọi thay đổi `.local-db` giữa hai deploy bị rollback âm thầm. Tệ hơn: `git reset --hard` **không** xoá thư mục untracked bị gitignore (đã kiểm trong `/tmp/nt5` với `.gitignore` đã commit) — nên backup/restore này **hoàn toàn không cần thiết**, chỉ có tác dụng phá dữ liệu. Thêm nữa `/tmp` world-readable, nên `.local-db/auth-credentials.json` và `sepay-private.json` bị phơi trong suốt thời gian deploy.
- **Hướng sửa:** xoá cả hai block backup/restore. Nếu thật sự cần giữ, dùng `mktemp -d` + `trap 'rm -rf' EXIT` và copy **một chiều vào** rồi không restore.

#### P2-11. Không có backup tự động nào cho PostgreSQL tự host

- **Vị trí:** `scripts/backup-qlaok-db.mjs`, `.github/workflows/deploy.yml`, `docs/SELF_HOSTED_POSTGRES_ZITADEL.md:77`
- **Bằng chứng:** `grep -rn pg_dump scripts docs .github` chỉ ra **một** script, `scripts/backup-qlaok-db.mjs`, và script này **chỉ chấp nhận Supabase Cloud**: `REQUIRED_PROJECT_REF = 'kftmrjmmympztzztunxf'`, `validateDatabaseUrl` chỉ cho host khớp `^db\.<ref>\.supabase\.(co|com)$` hoặc `aws-<idx>-<region>.pooler.supabase.com`, từ chối port 6543. Không có cron/systemd timer nào trong repo; `deploy.yml` không có bước backup. Tài liệu tự thừa nhận: "backup PostgreSQL tự host cần chạy bằng `pg_dump` trên VPS…" — tức là **thủ công**.
- **Tác động:** dự án đã cutover sang PostgreSQL tự host nhưng công cụ backup duy nhất vẫn khoá cứng vào hạ tầng đã bỏ. Một lỗi đĩa/`DROP` sai là mất toàn bộ dữ liệu quán, không có điểm khôi phục. Đây là rủi ro vận hành cao nhất trong báo cáo, cao hơn mọi finding code.
- **Hướng sửa:** script backup riêng cho self-hosted (`pg_dump --format=custom` qua `sudo -n -u postgres`, giữ nguyên `redactSecrets`, `openSync(dest,'wx',0o600)`, `pg_restore --list` verify TOC), gắn vào timer systemd hằng ngày, và ghi `restore` đã diễn tập vào docs.

#### P2-12. Audit trail: ghi mà không ai đọc, không rotate, world-readable; log admin ghi **trước** khi thực thi

- **Vị trí:** `src/lib/server-auth.ts:1042-1110`; 13 call site (`admin/route.ts:409`, `orders/route.ts:337,404,617,819,1001`, `service-requests/route.ts:126,253`, `sepay-reconciliation.ts:1636,2026`)
- **Bằng chứng:**
  ```ts
  try { fs.appendFileSync(AUDIT_LOG_FILE, `${JSON.stringify(payload)}\n`, 'utf8'); }
  catch { /* ignore fs write error in read-only containers */ }
  ```
  Trên máy này: `order-audit.log.jsonl` = 5.021.928 B, `admin-audit.log.jsonl` = 288.648 B, cả hai mode `-rw-r--r--`. `grep -rn 'admin-audit.log.jsonl\|order-audit.log.jsonl' src scripts tests` → **không có reader nào**, chỉ có writer và một test. Không rotation, không size cap.
- **Hai lỗi riêng biệt:**
  1. **Không đọc được + không xoay vòng + quyền 644.** Audit trail không phục vụ điều tra gì (không UI, không script export, không query), file lớn dần vô hạn, và mọi user trên VPS đọc được toàn bộ hoạt động của mọi quán. Vừa vô dụng vừa là rò rỉ dữ liệu.
  2. **Thứ tự ghi không nhất quán.** `admin/route.ts:409` gọi `recordAdminAuditLog` **trước** khối `switch` dispatch → hành động thất bại vẫn sinh bản ghi "đã làm". `orders/route.ts:337` ghi **sau** `dbSettleTableBill` thành công — đúng. Cùng một thư viện, hai quy ước trái nhau.
- **Đồng thời bảng `public.order_audit_logs` bị bỏ rơi:** có DDL (`004:69-79`), index (`004:82`), RLS (`004:85`) và policy cho `reports.view` (`004:555-558`), nhưng **chỉ một** câu `INSERT` trong toàn repo — `011_sepay_order_reconciliation.sql:845`, bên trong RPC reconcile. **Zero tham chiếu từ TypeScript.** Vậy: audit thao tác người dùng → file JSONL; audit SePay → bảng SQL. Hai nửa hệ thống không nối nhau.
- **Hướng sửa:** chọn **một** nơi lưu (bảng `order_audit_logs` + bảng `admin_audit_logs` là lựa chọn đúng: có RLS, có policy, query được), ghi **sau** khi mutation thành công trong cùng transaction khi có thể, bỏ hẳn JSONL; nếu tạm giữ file thì `chmod 600`, đặt trong thư mục ngoài `cwd`, và log lỗi ghi thay vì nuốt.

#### P2-13. Kho credential owner/admin là state chết: ghi được nhưng không bao giờ đọc

- **Vị trí:** `src/lib/auth-credentials.ts`; `src/app/api/admin/route.ts:150-156, 553-558, 577-582, 621-623`; `src/app/api/auth/route.ts:817-826`
- **Bằng chứng:** `hashPassword`/`verifyPassword` (scrypt, `timingSafeEqual`, có nhánh legacy sha256) được dùng đúng. Nhưng `verifyPassword` chỉ được gọi ở **hai** chỗ: `staff-accounts.ts:97` (dummy hash chống timing) và `staff-accounts.ts:2074` (đăng nhập nhân viên). Các entry owner/admin do `admin/route.ts` ghi vào `.local-db/auth-credentials.json` **không có đường đọc nào** — đăng nhập owner đi qua Zitadel và trả `OIDC_REQUIRED` (`auth/route.ts:817-826`).
- **Tác động:** mật khẩu owner (kể cả mật khẩu mặc định ở P1-3) được hash và lưu vào file **không có tác dụng xác thực gì**, nhưng vẫn là bí mật nằm trên đĩa với quyền mặc định, và vẫn bị copy sang `/tmp` mỗi deploy (P2-10). Người vận hành tin rằng "đã có mật khẩu" trong khi thực tế chỉ có một nhánh chết.
- **Hướng sửa:** xoá phần ghi credential owner trong `admin/route.ts` và seed `INITIAL_SUPER_ADMIN_PASSWORD`; nếu cần break-glass thì làm thành cơ chế tường minh có test và có đường đọc.

#### P2-14. Trang Settings đòi **đồng thời** `settings.manage` + `settings.bank` ⇒ lưu một phần là mất toàn bộ

- **Vị trí:** `src/app/api/shops/route.ts:763-772, 783-789`; `src/lib/shop-permissions.ts:325-332` (`hasShopPermission` dùng `.every()`)
- **Bằng chứng:** mỗi key theme đổi được cộng *thêm* một permission vào `requiredPerms`, rồi `requireShopPermission(req, id, Array.from(requiredPerms))` yêu cầu **ALL-of**:
  ```ts
  if (bankKeys.includes(key)) requiredPerms.add('settings.bank');
  else if (promoKeys.includes(key)) requiredPerms.add('promotions.manage');
  else requiredPerms.add('settings.manage');
  ...
  if (Object.keys(patch).some((k) => k !== 'theme_config') || !requiredPerms.size) {
    requiredPerms.add('settings.manage');
  }
  ```
- **Tác động:** vai trò có `settings.manage` nhưng không có `settings.bank` **không lưu được gì cả** — vì `nextThemeConfig` luôn chứa `paymentConfig` (`settings/page.tsx:591-597`) và form luôn gửi kèm `theme_config` cùng các field khác (`:615-650`), nên `requiredPerms` luôn có **cả hai**. Kết quả là `403` cho toàn bộ form (tên quán, địa chỉ, giờ mở cửa, ngôn ngữ) vì một field ngân hàng mà người dùng không hề sửa. Lỗi trả về là thông báo quyền chung chung, không chỉ ra field nào.
- **Nghịch lý ở điều hướng:** `dashboard-nav.ts:49` cho vào `/dashboard/settings` chỉ với `settings.manage`, nên member `settings.bank`-only **không thấy menu** dù có một trong hai quyền; ngược lại member `settings.manage`-only vào được nhưng không lưu được. Hiện **không vai trò mặc định nào** có hai quyền này (`owner` có tất cả, `cashier`/`staff` không có cả hai — `shop-permissions.ts:274-296`), nên lỗi chỉ lộ ra với membership cấu hình tay — nhưng đó chính là tính năng `members.manage` cho phép.
- **Hướng sửa:** kiểm quyền **theo từng nhóm field** rồi chỉ patch nhóm được phép (giống cách `catalog/route.ts` làm với `buildInventoryOnlyItemPatch`), hoặc trả `403` kèm danh sách field bị từ chối; và cho `dashboard-nav` dùng `anyOf: ['settings.manage','settings.bank']`.

#### P2-15. UI catalog/POS hiện nút mà server chắc chắn `403` — không có prop quyền

- **Vị trí:** `src/components/dashboard/QuickItemRow.tsx:25-38` (props không có cờ quyền) dùng ở `src/app/(dashboard)/dashboard/catalog/page.tsx:2011-2027`; `src/components/dashboard/PosCounterWorkspace.tsx:46-71` (props không có `canApplyDiscount`) dùng ở `src/app/(dashboard)/dashboard/orders/page.tsx:1435-1450`
- **Bằng chứng:**
  1. `QuickItemRow` render đủ nút giá / ảnh / `is_featured` / xoá (`:573`, `:626`) bất kể membership. Trang catalog **có** tính `canManageCatalog`/`canAdjustInventory` (`page.tsx:663-667`) và dùng chúng cho bulk actions (`:717, :814, :996, :1087`) + form, nhưng **không truyền** xuống `QuickItemRow`.
  2. Server chặn đúng: `upsert_item` đổi field ngoài tồn kho ⇒ cần `catalog.manage` (`shop-permissions.ts:225-234`), `inventory.adjust`-only bị `buildInventoryOnlyItemPatch` lọc còn `is_available`/`stock_quantity` (`:242-257`); `DELETE /api/catalog?itemId=` yêu cầu `catalog.manage` (`catalog/route.ts:987-992`).
  3. POS: numpad có `% Giảm` (`PosCounterWorkspace.tsx:1484`) và ô giá tuỳ chỉnh, nhưng `orders/route.ts:506-525` trả `403 INSUFFICIENT_SHOP_PERMISSION` khi có `discount_amount > 0` hoặc dòng giảm giá mà thiếu `discount.apply`. `orders/page.tsx` có `canRefundOrder`/`canEditItems`/`canCancelUnpaid` (`:725-727`) nhưng **không** có `canApplyDiscount`.
- **Tác động (mức độ thật, đã kiểm từng handler):** các handler của `QuickItemRow` **có** rollback khi server từ chối (`handleUpdatePrice` `:373-376`, `handleUpdateImage` `:448`, `handleToggleFeatured` `:430`, `handleDeleteItem` `:479-494`), nên không ghi sai dữ liệu. Thiệt hại là UX và niềm tin: nhân viên role kho gõ giá mới → thấy giá đổi → toast "Không thể lưu" → giá nhảy về; còn với **xoá** thì phải bấm qua hộp thoại xác nhận "sẽ bị xóa vĩnh viễn" rồi mới bị từ chối. Ở POS thì tệ hơn: `403` xảy ra lúc bấm "Lưu đơn", tức là sau khi đã nhập cả đơn cho khách.
- **Hướng sửa:** truyền cờ quyền xuống `QuickItemRow`/`PosCounterWorkspace` (đã có sẵn pattern `hasPermission` ở `orders/page.tsx:708`), disable/ẩn theo cờ, và giữ server làm lớp thứ hai.

#### P2-16. Ứng dụng mobile ghim `PRODUCTION_API_URL` cho luồng đăng nhập, bỏ qua `EXPO_PUBLIC_API_URL`

- **Vị trí:** `mobile/src/components/AuthScreen.tsx:182` (`apiBaseUrl = PRODUCTION_API_URL`) dùng ở `:348, :404, :472, :545`; `mobile/App.tsx:369-380` render `<AuthScreen ... />` **không truyền `apiBaseUrl`**; trong khi phần còn lại dùng `API_BASE_URL` (`App.tsx:215, :256, :296`)
- **Bằng chứng:** `resolveApiBaseUrl()` (`mobile/src/lib/supabase.ts:35-87`) đã xử lý đúng env / Metro LAN / emulator loopback, và `App.tsx` dùng nó. Nhưng `AuthScreen` mặc định nhận `PRODUCTION_API_URL` và không được override ⇒ mọi request đăng nhập (owner login, staff login, register, reset, OIDC exchange) đi thẳng lên **production** dù app đang chạy dev trỏ vào server khác.
- **Tác động:** dev/staging đăng nhập vào production; test tài khoản thật trên prod; và trên máy dev không có mạng tới prod thì không đăng nhập được dù `EXPO_PUBLIC_API_URL` đúng. `Linking.openURL(PRODUCTION_API_URL)` (`:1646`) còn mở trang prod trên trình duyệt thiết bị.
- **Hướng sửa:** `App.tsx` truyền `apiBaseUrl={API_BASE_URL}`; đổi default trong `AuthScreen` thành tham số bắt buộc hoặc `API_BASE_URL`.

#### P2-17. `resolveApiBaseUrl` không bắt buộc HTTPS; phiên owner (JWT) có thể đi qua `http://`

- **Vị trí:** `mobile/src/lib/supabase.ts:35-87`
- **Bằng chứng:** nhánh `envUrl` chỉ kiểm *có phải localhost không*, rồi `return envUrl.replace(/\/+$/,'')` — không kiểm scheme. Nhánh `__DEV__` trả `http://<ip>:3000`. Nhánh production trả `PRODUCTION_API_URL` (https), nhưng nhánh env thắng trước.
- **Tác động:** một `.env` bị đặt `EXPO_PUBLIC_API_URL=http://...` trên bản build production sẽ khiến token owner + mật khẩu nhân viên đi trên kênh rõ. Hiện chỉ có một lớp phòng vệ (mobile từ chối `*.supabase.co` ở `:109,:142`) — lớp đó không giúp gì cho PostgREST tự host.
- **Hướng sửa:** trong `!__DEV__`, từ chối mọi base URL không phải `https:`; trong `__DEV__` cho phép `http:` nhưng chỉ với host loopback/RFC1918.

#### P2-18. `?lang=` trên trang login khoá luôn bộ chuyển ngôn ngữ và ghi đè lựa chọn của người dùng

- **Vị trí:** `src/app/(auth)/login/page.tsx:258-265`
- **Bằng chứng:**
  ```ts
  useEffect(() => {
    const langParam = searchParams.get('lang') || searchParams.get('locale');
    if (langParam === 'en' || langParam === 'vi') { if (langParam !== locale) setLocale(langParam); }
  }, [searchParams, locale, setLocale]);
  ```
  `locale` nằm trong dependency array, nên mỗi lần người dùng đổi ngôn ngữ effect chạy lại và **ép về** giá trị `?lang=`. `setLocale` lại persist qua `setStoredAppLocale` ⇒ lựa chọn "bị từ chối" vẫn ghi vào localStorage.
- **Tác động:** link email (`/login?mode=reset&lang=vi`, `auth-email-templates.ts:223, :294`) biến bộ chuyển ngôn ngữ thành nút không hoạt động. Người dùng nhận email tiếng Việt không thể đọc form bằng tiếng Anh.
- **Hướng sửa:** chỉ áp `lang` **một lần** khi mount (dùng `useRef` guard hoặc đọc initial state), không phụ thuộc `locale`.

#### P2-19. Lỗi bàn ăn trả nguyên văn message nội bộ ra storefront

- **Vị trí:** `src/app/api/tables/route.ts:126-133` (server trả `error.message` thô) → `src/app/(storefront)/s/[slug]/menu/page.tsx:379-385` (lưu nguyên `errData.error` vào state) → `src/lib/i18n-helper.ts:1189-1242` (`localizeStorefrontTableError` trả nguyên `error` nếu không khớp danh sách trắng)
- **Bằng chứng:** route `catch` dựng `message` từ `error.message` rồi trả thẳng; storefront đọc `errData?.error` và gán vào `tablesLoadError`; hàm localize chỉ map đúng **hai** chuỗi đã biết (`UI_LABELS.vi/en.tableQrInvalidError`) và hai regex nhãn bàn, mọi lỗi khác `return error`.
- **Tác động:** khách quét QR thấy chuỗi PostgREST/PostgreSQL (`permission denied for table shop_tables`, `relation ... does not exist`, chi tiết connection) — vừa rò rỉ schema, vừa không dùng được. Đi ngược quy ước repo: `localizeGuestOrderError` (`i18n-helper.ts:1557-1563`) map từ `code`/HTTP status và có comment "Never returns raw server text" — đây là ngoại lệ duy nhất vi phạm chính quy ước đó.
- **Hướng sửa:** route trả `{ error: <nhãn chung>, code }` thay vì `error.message`; localize trả `tablesLoadError` cho **mọi** trường hợp không khớp danh sách trắng; log message gốc ở server.

#### P2-20. Banner "8 ngôn ngữ" hardcode, không phụ thuộc `allowedLangs` của gói

- **Vị trí:** `src/app/(storefront)/s/[slug]/page.tsx:360`
- **Bằng chứng:** `🇻🇳 🇬🇧 🇰🇷 🇯🇵 🇨🇳 🇪🇸 🇮🇹 🇷🇺 • Multi-language Menu` là chuỗi literal, trong khi trang đã có `allowedLangs` từ `getAllowedLocalesForPlan` và gói Free/Pro giới hạn `maxLangs` 1/3.
- **Tác động:** quán gói Free chỉ có tiếng Việt vẫn quảng cáo 8 ngôn ngữ trên chính storefront của mình — quảng cáo sai, và tạo kỳ vọng khách bấm vào sẽ thấy menu đa ngữ.
- **Hướng sửa:** render từ `allowedLangs` (flag + tên ngôn ngữ), hoặc bỏ hẳn dòng này khi `allowedLangs.length < 2`.

#### P2-21. `register_start` trả `409 EMAIL_ALREADY_EXISTS` — cho phép dò tài khoản

- **Vị trí:** `src/lib/zitadel-login-ui.ts:1556`
- **Bằng chứng:** nhánh trùng email ném `new ZitadelLoginUiError('EMAIL_ALREADY_EXISTS', 409)`.
- **Tác động:** endpoint đăng ký công khai trở thành oracle xác nhận "email này đã có tài khoản Qlaok". Kết hợp với rate limit theo IP (`getClientIp` phụ thuộc `X-Real-IP`, xem §7) thì việc dò hàng loạt là khả thi, và mục tiêu dò là email khách hàng/quán thật.
- **Hướng sửa:** với email đã tồn tại, vẫn trả `200` và gửi email "tài khoản đã tồn tại, đây là link đăng nhập/đặt lại", chỉ khác nhau ở nội dung email — pattern chuẩn chống enumeration.

### P3

| # | Vấn đề | Vị trí |
| --- | --- | --- |
| P3-1 | `eslint.config.mjs` `ignores` (`:14-23`) thiếu `.agy-runs/**` (đã có trong `.gitignore`) → 3 error lint từ script QA trong `.agy-runs/qa/`, `.agy-runs/qa-catalog/` | `eslint.config.mjs:14-23` |
| P3-2 | `qlaok-handoff.zip` và `tsconfig.tsbuildinfo` được track trong git | `git ls-files` |
| P3-3 | `next.config.ts` `images.remotePatterns` hostname `'**'` — quá rộng (rủi ro thấp: repo **không** dùng `next/image`) | `next.config.ts:7-12` |
| P3-4 | `orders` GET và `analytics` GET fallback `'shop-fnb-001'` khi thiếu `shopId` — che giấu lỗi client và gắn cứng seed | `orders/route.ts:71`, `analytics/track/route.ts:12,14` |
| P3-5 | `public.orders.order_code` **không có unique constraint** — DDL `002_mpos_orders_inventory.sql:14` chỉ `VARCHAR(30) NOT NULL` (unique duy nhất trong `001:183` là của `payment_transactions`, không phải `orders`). Việc chống trùng chỉ dựa vào 30 lần thử + kiểm tra tồn tại ở ứng dụng → hai request đồng thời vẫn có thể sinh cùng mã | `002_mpos_orders_inventory.sql:14`; `mpos-store.ts` `dbCreateOrder` |
| P3-6 | 14 điểm `console.*` trong `src`; một số route `catch` chỉ trả message chung, không log có cấu trúc (upload cố ý im lặng — chấp nhận được để không lộ base64, nhưng nên log mã lỗi) | `upload/route.ts:150`, `analytics/track/route.ts:51` |
| P3-7 | Không có `middleware.ts`; auth hoàn toàn phụ thuộc kỷ luật từng route | `src/` |
| P3-8 | OCR server-side nhận `imageBase64` không giới hạn dung lượng/độ dài text trong route (chỉ có rate limit 10/10 phút/user) | `ai/ocr-menu/route.ts:69-79` |
| P3-9 | `writeLocalTablesStore` nuốt lỗi ghi (`catch { /* read-only environment fallback */ }`) và `readLocalTablesStore` tự re-seed `SEED_SHOP_TABLES` khi file mất/hỏng — âm thầm trả dữ liệu seed thay vì báo lỗi. Đối lập với `sepay-reconciliation.ts:214-221` nơi `writeLocalSePayStore` **throw** | `shop-tables.ts:490-518` |
| P3-10 | `getTableQrSigningSecret()` lặp lại đúng chuỗi fallback của `getSigningSecret()` (kể cả literal dev) **không có domain separation**, nên một secret ký cả session token lẫn QR bàn. `zitadel-oidc.ts:254` và `zitadel-login-ui.ts:859-877` đã làm đúng (HMAC tiền tố `qlaok-oidc-tx-v1`, `qlaok-zitadel-registration-ticket-v1`) — áp dụng cùng pattern | `shop-tables.ts:14-29`; `server-auth.ts:84-96` |
| P3-11 | `requireSuperAdmin` nhét `err.message` vào body 500 `SERVER_AUTH_MISCONFIGURED` — rò rỉ chi tiết nội bộ cho client | `server-auth.ts:649-690` |
| P3-12 | **Lệch tài liệu migration**: README liệt kê tới `020` (thiếu `021`, `022`, `023`); `ARCHITECTURE.md:145` và `docs/SELF_HOSTED_POSTGRES_ZITADEL.md:72` dừng ở `022` (thiếu `023`, dù `023` đã được commit). **Không tài liệu nào nhắc `023`**. README nói "`npm run db:migrate` thực thi qua Supabase Management API" trong khi `package.json:11` trỏ `scripts/migrate-self-hosted.mjs`; chính `SELF_HOSTED_POSTGRES_ZITADEL.md:72` lại nói "không gọi Supabase Management API". Cùng file `SELF_HOSTED_POSTGRES_ZITADEL.md` có **hai mục cùng đánh số `6.`** (`:77` và `:78`) | `README.md:110-118`, `ARCHITECTURE.md:145`, `docs/SELF_HOSTED_POSTGRES_ZITADEL.md:72,77,78` |
| P3-13 | Tính năng email mới (`auth-email.ts`, `auth-email-templates.ts`) không có biến `SMTP_*` nào trong `.env.example` (0 lần) hay `README.md` (0 lần) — chỉ `docs/SELF_HOSTED_POSTGRES_ZITADEL.md` nhắc 2 lần. Deploy mới sẽ rơi vào `EMAIL_SERVICE_NOT_CONFIGURED` (503) mà không có tài liệu chỉ đường | `.env.example`, `README.md` |
| P3-14 | Hai thư mục rỗng untracked: `src/app/__qa/floor-plan/` và `ops/zitadel-login/locales/` | `git status` |
| P3-15 | Nút "In tem"/"In tạm tính" trên thẻ đơn không gắn cờ quyền, trong khi `POST /api/orders {action:'record_print'}` yêu cầu `orders.print_kitchen` (kitchen/label) hoặc `orders.print_provisional` (provisional) tuỳ `ticketType` (`orders/route.ts:379-392`). Vai trò `staff` mặc định **không** có `orders.print_provisional` (`shop-permissions.ts:289-295`) ⇒ bấm "In tạm tính" luôn nhận `403` từ `ReceiptPrintModal.tsx:218`. Nút "Mã QR" thuần client (không gọi server) nên không phải lỗi quyền | `(dashboard)/dashboard/orders/page.tsx:2006-2060`; `orders/route.ts:379-392` |
| P3-16 | `handleTranslatePost` gọi `/api/ai/translate` bằng `fetch` trần, **không** kèm `getAuthHeaders()` → request thiếu `Authorization`, route trả `401`; nút "Dịch" ở trang khuyến mãi luôn hỏng | `(dashboard)/dashboard/posts/page.tsx:392-403`; `api/ai/translate/route.ts:18` |
| P3-17 | Toast dùng `setTimeout` không lưu handle, không cleanup khi unmount → `setState` sau unmount; nếu hai toast chồng nhau, timer cũ xoá toast mới | `(dashboard)/dashboard/catalog/page.tsx:189-193`; `components/dashboard/QuickItemRow.tsx:119,155` |
| P3-18 | `formatCurrency` hardcode `vi-VN` + hậu tố `đ` cho mọi VND, bất kể locale UI — dashboard EN vẫn hiện `1.234.567đ`. Còn sai với số âm/`NaN` (không guard) | `src/lib/i18n-helper.ts:147-153` |
| P3-19 | `errorTrackingToken` chỉ có trong `GUEST_ORDER_LABELS` bản EN (`:1298`) và VI (`:1350`); 5 locale còn lại (ko/ja/zh/es/it) thiếu key. `getGuestOrderLabels` (`:1549-1551`) merge EN làm nền nên không crash, nhưng khách Nhật/Hàn nhận chuỗi tiếng Anh giữa form tiếng Nhật | `src/lib/i18n-helper.ts:1258,1298,1350,1549-1551` |
| P3-20 | `<html lang="vi">` cứng trong khung email (`renderEmailFrame`) — email EN bị screen reader đọc bằng giọng Việt, và client có thể tự dịch sai. Locale đã có trong `params.lang` nhưng không được truyền xuống frame | `src/lib/auth-email-templates.ts:176` |
| P3-21 | **Hai bản sao logic origin đang trôi khỏi nhau.** `resolveTrustedQlaokEmailOrigin` (`auth-email-templates.ts:58-130`) và `resolvePasswordResetQlaokOrigin` (`zitadel-login-ui.ts:1905-1980`) gần như trùng, nhưng bản thứ hai đọc `config?.webRedirectUri` thay vì `process.env.ZITADEL_REDIRECT_URI` ở nhánh non-production, và có thể nhận `config` từ caller. Hai định nghĩa "origin tin cậy" cho cùng một mục đích là đúng loại lỗi sẽ phân kỳ thành lỗ hổng open-redirect | `src/lib/auth-email-templates.ts:58-130`; `src/lib/zitadel-login-ui.ts:1905-1980` (dùng ở `:1983`,`:2007`) |
| P3-22 | `unregisterMobilePushToken` xoá `lastRegisteredScope`/`expoPushToken`/`registeredShopIds` **trước** khi gọi `DELETE /api/push-tokens`, rồi `catch { unregistered = false }` — nếu mạng lỗi, state local đã mất nên lần đăng nhập sau không biết phải gỡ token cũ ⇒ token mồ côi tiếp tục nhận push của tài khoản trước trên thiết bị đã đổi chủ | `mobile/src/lib/push-notifications.ts:316-331` |
| P3-23 | Membership của owner không bao giờ bị prune: `{...membershipsRef.current, ...loadedMemberships}` chỉ merge, không xoá shop đã bị thu hồi quyền → tab vẫn hiện quán cũ cho tới khi khởi động lại app | `mobile/App.tsx:756-764` |
| P3-24 | OIDC callback được đánh dấu "đã xử lý" (`lastHandledCallbackUrlRef.current = url`) **trước** khi exchange xong. Exchange lỗi ⇒ bấm lại cùng link không làm gì (im lặng), người dùng phải tự đăng xuất/khởi động lại | `mobile/App.tsx:206-210` |
| P3-25 | `handleUpdateItemPrice` cập nhật giá lạc quan rồi `await fetchApi(...)` nhưng **không đọc body**: server trả `200` kèm item đã bị `buildInventoryOnlyItemPatch` lọc (role kho) hoặc bị clamp, UI vẫn hiện giá người dùng vừa gõ. `handleQuickAddItem` xoá form khi `res.ok` **kể cả khi `data.item` không có** → món không được tạo nhưng form trống, người dùng tưởng xong | `mobile/src/components/tabs/CatalogTab.tsx:136-163, 260-269` |
| P3-26 | `mobile/src/lib/auth-recovery.ts` 465 dòng, **0 importer** (grep cả `mobile/src`, `mobile/App.tsx`, `mobile/__tests__`) — dead code mang theo logic phục hồi phiên không ai chạy, dễ bị sửa nhầm tưởng là đường thật | `mobile/src/lib/auth-recovery.ts` |
| P3-27 | `app.json` `extra.eas.projectId` là chuỗi rỗng → `getExpoPushTokenAsync` không lấy được token, nên đăng ký push **luôn** rơi vào nhánh "unavailable" mà không có cảnh báo build-time. Thông báo đơn mới trên mobile vì thế không hoạt động ở bản build thật | `mobile/app.json:26-30` |
| P3-28 | `formatStaffLoginError(err, locale, _secretsToRedact = [])` — tham số thứ ba **hoàn toàn không dùng** trong thân hàm; tên gợi ý đã từng có bước che secret. Hiện chỉ là tham số chết, nhưng gây hiểu nhầm là đã có redaction | `mobile/src/components/AuthScreen.tsx:116-119` |
| P3-29 | Banner khuyến mãi tự sinh tiêu đề/phụ đề **chỉ tiếng Việt** (`Giảm ngay …`, `Áp dụng … khi đặt món qua QR`, `toàn thực đơn`) rồi lưu vào dữ liệu shop — quán đặt `supported_langs` EN vẫn phát banner tiếng Việt cho khách nước ngoài | `mobile/src/components/tabs/PromotionsTab.tsx:75-92` |

---

## 5. Những gì đang làm tốt (nên giữ)

1. **Gatekeeping service-role key** trong `db.ts` (`hasSupabaseServiceRoleKey`) — chặn `sb_publishable_*`, chặn key trùng anon, decode JWT kiểm `role`. Đây là thứ nhiều dự án Supabase làm sai.
2. **Không có `any`** trong `src` (0 lần `: any` / `<any>`), `strict` bật, 51/56 file `.tsx` là client component có ranh giới rõ.
3. **RPC nguyên tử** cho mọi mutation đa bảng: commit order + tồn kho, settle table bill, reconcile SePay, complete payment, staff account. Không có chỗ nào tự `UPDATE` hai bảng trong một route.
4. **`REVOKE`/`GRANT`** đúng cho **toàn bộ 21 hàm `SECURITY DEFINER` nghiệp vụ** (mọi hàm gọi được từ client đều bị revoke khỏi `PUBLIC/anon/authenticated`; 8 hàm trigger còn thiếu revoke nhưng PostgreSQL không cho gọi trực tiếp — xem 3.4). Đây là kỷ luật mà phần lớn dự án Supabase không có.
5. **Test thật cho bất biến**, không chỉ snapshot: RLS (`shop-permissions-and-rls`), pricing (`order-pricing`), transition (`assertPaymentTransition`), idempotency, `zitadel-custom-login-review` (735 dòng mới), `production-label-print-review`.
6. **Mobile fail closed**: `mobile/src/lib/supabase.ts:109,142` từ chối `*.supabase.co`, không có key server trong `EXPO_PUBLIC_*`, SecureStore tách phiên owner/nhân viên.
7. **Không track `.env` / `.local-db`**: `git check-ignore` xác nhận `.env`, `.env.local`, `.local-db/` đều bị ignore.
8. **Migration runner có checksum guard** và lịch sử trong `public.schema_migrations`.
9. **SePay**: secret mã hoá AES-256-GCM với shopId làm AAD, xác thực chữ ký **trước** `JSON.parse`, ledger idempotent, giới hạn body 64 KiB — thứ tự xử lý đúng chuẩn.
10. **Bất biến fulfillment ≠ payment** được cưỡng chế ba lớp: trigger SQL (`enforce_order_state_and_payment_invariants`), helper TS (`assertPaymentTransition`), và test.
11. **`catalog/route.ts` tách quyền theo *field* chứ theo *endpoint***: `getCatalogItemUpdatePermissionOptions` + `buildInventoryOnlyItemPatch` (`shop-permissions.ts:217-257`) nghĩa là role `inventory.adjust` gửi kèm giá cũng **không** ghi được giá — server chỉ patch đúng field kho. Đây là pattern đúng, nên áp dụng lại cho Settings (P2-14).
12. **`orders/page.tsx` default-deny cho hành động phá huỷ**: `canRefundOrder`/`canEditItems`/`canCancelUnpaid` (`:725-727`) fail closed khi membership chưa tải, trong khi capability không phá huỷ giữ optimistic default (`:714-723`) — phân biệt có chủ đích, đúng hướng. Thiếu duy nhất `canApplyDiscount` (P2-15).
13. **i18n storefront tách khỏi app domain** (`SUPPORTED_LOCALES` 8 vs app VI/EN) và `getGuestOrderLabels` merge EN làm nền (`i18n-helper.ts:1549-1551`) — thiếu key thì không crash, chỉ rơi về EN. Thiết kế chống vỡ đúng (dù chính nó che mất P3-19).
14. **`localizeGuestOrderError` map từ `code`/HTTP status, không trả text server** (`i18n-helper.ts:1557-1563`) — đúng nguyên tắc; `localizeStorefrontTableError` là ngoại lệ duy nhất đi ngược (P2-19).
15. **Mobile `createApiClient` fail closed**: không có token → throw; chỉ một host cho mỗi request, không replay mutation sang host khác; guard chống đệ quy 401 (`mobile/src/lib/api-client.ts:16-90`).
16. **`external_link_account` / OIDC PKCE** với transaction HMAC tiền tố `qlaok-oidc-tx-v1` và `qlaok-zitadel-registration-ticket-v1` — domain separation đúng, nên áp dụng cho QR bàn (P3-10).

---

## 6. Checks đã chạy (kết quả thật, không suy đoán)

Chạy lại toàn bộ ở lượt này (2026-10-27):

| Lệnh | Kết quả | Chi tiết |
| --- | --- | --- |
| `npm run typecheck` | **FAIL** (exit 2) | **24 lỗi TS, tất cả ở `tests/zitadel-custom-login-review.test.ts`, 0 ở `src/`**. Nguyên nhân: test WIP dùng signature mới của `auth-email-templates.ts` (`email`/`origin`) nhưng gọi kiểu cũ (`recipientEmail`/`appOrigin`) và còn `createMockRateLimitDbClient` chưa định nghĩa. `tests/web-password-reset-ui-review.test.ts:38` **đã hết lỗi** — đã chuyển sang object param |
| `npm run lint` | **FAIL** (exit 1) | `✖ 66 problems (27 errors, 39 warnings)`. **`src/` có 0 error**; 27 error chia: `tests/` 24 (6 `production-label-print-review`, 5 `realtime-review`, 4 `label-print-settings-review`, 3 `production-label-template-review`, 3 `unit`, 2 `ai-scanner-paywall-review`, 1 `zitadel-custom-login-review`) + `.agy-runs/` 3. Warning là `@next/next/no-img-element` và `react-hooks/exhaustive-deps` |
| `npm run test:unit` | **PASS** (exit 0) | 133/133 |
| `npm run test:sql` | **PASS** (exit 0) | 6/6 (RLS, unique index bank ref, publication idempotent…) |
| `npm run test:review` | **FAIL** (exit 1) | 333/336. Cả 3 fail thuộc **bộ test WIP chưa commit** `tests/auth-email-bilingual-review.test.ts`: (a) template VI/EN — code đọc `email`/`origin` (`auth-email-templates.ts:199-213`) trong khi test truyền `recipientEmail`/`appOrigin` → `INVALID_EMAIL_TEMPLATE_PARAMS`; (b) `ReferenceError: createMockRateLimitDbClient is not defined`; (c) một assert còn lại của cùng bộ |
| `npm run test:e2e` | **FAIL** | 4 pass / 9 fail. Nguyên nhân gốc: (a) test #1 assert `dataSource === 'supabase'` vs thực tế `'self-hosted-postgres'`; (b) `POST /api/auth {demo_login}` trả **500** `SESSION_SECRET (at least 16 characters) is required in production.` → test #3–#9 nhận 401; (c) test #13 `/api/orders` trả 400 thay vì 201 |
| `npm test --prefix mobile` | **PASS** | 106/106 |
| `npm run build` | **PASS** (exit 0) | Next.js standalone build thành công |
| `GET /api/health` | 200 | `{"status":"ok","dataSource":"self-hosted-postgres",...counts:{shops:9,categories:38,items:116,posts:4,analyticsEvents:0,provinces:34}}` |
| `POST /api/auth {demo_login}` | 500 | `SESSION_SECRET (at least 16 characters) is required in production.` |
| `GET /api/catalog?shopId=shop-fnb-001` | 200 | trả `owner_id` và `theme_config` trong object `shop` |
| `GET /api/posts` | 200 | trả post của `shop-fnb-001` (shop đầu tiên) |
| `codegraph status` | OK | 272 file, 4.465 node, 16.455 edge, index up-to-date |

**Đọc kết quả cho đúng:** `typecheck` và `test:review` fail **chỉ vì thư viện email mới chưa commit chưa đồng bộ với test của nó** — không phải hồi quy nghiệp vụ, và `src/` sạch ở cả typecheck lẫn lint. `test:e2e` fail do **assert lỗi thời + server thiếu `SESSION_SECRET`**, không phải logic. **Điểm cần chú ý:** cả ba nguyên nhân đỏ đều nằm ngoài `src/`, nên `verify-pr` sẽ đỏ và chặn merge cho tới khi WIP được hoàn tất — nhưng nếu ai đó "sửa" bằng cách nới assert e2e hoặc bỏ qua lint test thì chất lượng sẽ tụt mà không ai thấy. Đây là lý do nên đưa `npm run test:e2e` vào CI **cùng lúc** sửa nó, không phải trước.

---

## 7. Chưa xác minh

- **Không chạy migration lên DB thật.** Mọi kết luận về RLS/SECURITY DEFINER dựa trên đọc SQL + `test:sql` (6/6) cục bộ, không dựa trên `pg_policies` live. Chưa kiểm trạng thái thực tế của `public.schema_migrations` trên production — nên chưa biết `023` đã apply hay chưa, và chưa biết có migration nào bị apply nửa vời (xem 3.5 điểm trừ 1) hay không.
- **Không gọi Supabase MCP** trong phiên này (read-only, và phiên không dùng). Advisors/schema live chưa đối chiếu.
- **Không chạy e2e với server test sạch** (có `SESSION_SECRET` + `PAYMENT_DEV_SIMULATE`). Chưa xác định test #13 trả 400 vì dữ liệu, vì cờ giờ mở cửa (`SHOP_CLOSED`), hay vì thiếu token QR bàn.
- **Chưa chạy migration ngoài môi trường dev** — kết luận "runner không có transaction" (`migrate-self-hosted.mjs:44-56`) là đọc code, không phải quan sát một lần deploy thật bị hỏng giữa file.
- **Chưa kiểm chứng `X-Real-IP` do Nginx ghi đè.** `zitadel-login-ui.ts` `getClientIp` **chỉ** đọc `x-real-ip` và giả định reverse proxy ghi đè header này. Repo **không có** `nginx/*.conf` nào, nên giả định này không kiểm được từ code. Nếu Nginx thật không set `X-Real-IP`, mọi request rơi vào bucket `'unknown'` → rate limit gộp toàn bộ user thành một khoá (khoá người dùng hợp lệ) hoặc vô hiệu (nếu `unknown` bị loại). **Cần xác minh trên VPS.**
- **Chưa đối chiếu rằng `docs/SELF_HOSTED_POSTGRES_ZITADEL.md` khớp cấu hình Zitadel thật** (2 client, callback, subject mapping qua `profiles.zitadel_sub`).
- **Chưa kiểm GitHub Actions live** — không push, nên không có run để đối chiếu. Mọi nhận định về CI đọc từ `.github/workflows/*.yml`.
- **`.agy-runs/` và `.local-db/`** không đọc nội dung (đúng ràng buộc repo); chỉ `stat` kích thước/quyền để chứng minh P2-12.
- **Không render UI trên trình duyệt/thiết bị thật, không chạy app mobile.** Toàn bộ kết luận về dashboard, storefront, POS và mobile ở vòng này là **đọc source + suy luận luồng dữ liệu**, có đối chiếu chéo route ↔ component (ví dụ P1-5 đối chiếu `admin/page.tsx` → `admin/route.ts` → `mpos-store.ts` trên cùng một đường). Hệ quả cụ thể:
  - P1-4 (POS mất giảm giá) là **kết luận từ đọc code**, chưa tái hiện bằng một đơn thật. Đường đi đã kiểm từng mắt: hydrate đặt `discountPercent: 0` → `totals` cộng theo `discountPercent` → payload gửi `discount_amount: 0`. Chưa chứng minh bằng thao tác.
  - P1-5/P1-6 chưa thực thi trên DB thật: chưa quan sát một đơn `unpaid` thành `paid` có `paid_at`, cũng chưa quan sát `refunded` tự sinh. Kết luận dựa trên đọc ba tầng.
  - P1-7 (race đổi shop) là **phân tích khả năng**, chưa có repro bằng network throttle.
  - Các P3 về mobile (P3-22…P3-29) chưa chạy trên simulator/thiết bị; chưa kiểm push thật (một phần vì `eas.projectId` rỗng — P3-27).
- **Chưa kiểm accessibility** (contrast, focus, screen reader) cho bất kỳ màn hình nào; P3-20 (`<html lang="vi">`) là suy luận về hành vi screen reader, chưa đo.
- **Chưa xác định `mobile/src/lib/auth-recovery.ts` có phải dead code do refactor dở dang hay do bị bỏ có chủ đích** — chỉ khẳng định được 0 importer ở hiện tại. Lịch sử git chưa tra.

---

## 8. Thứ tự đề xuất sửa

Sắp theo **rủi ro mất dữ liệu/sai tiền/phơi bí mật trước**, thẩm mỹ sau.

1. **Rotate key gateway AI** rồi xoá literal `src/lib/gemini.ts:15`. Xoá khỏi code không làm key đã commit trong git history an toàn. (P1-1)
2. **Backup tự động PostgreSQL tự host** (P2-11) — hiện không có gì cả; đây là lỗ hổng vận hành lớn nhất. Làm `pg_dump` script + systemd timer **trước** mọi thay đổi schema khác.
3. **Bỏ block backup/restore `.local-db` trong deploy** (P2-10) — nó đang rollback dữ liệu âm thầm; xoá là hành động giảm rủi ro, không phải tăng.
4. **Admin "Hoàn tất" không được set `payment_status`** (P1-5). Sửa ở UI (`admin/page.tsx:1198-1201`) **và** thêm kiểm ở `admin/route.ts`: `payment_status` chỉ nhận khi caller có `payment.collect`, và trả `409` khi cố đánh dấu paid cho đơn đang chờ đối soát.
5. **Bỏ auto-refund ngầm khi huỷ** (P1-6) — biến thành hành động `refund_order` tường minh, dùng chung luật với `/api/orders` (`REFUND_REASON_REQUIRED`), và sửa toast cho đúng việc đã làm.
6. **POS "Sửa đơn" giữ nguyên giảm giá** (P1-4) — thêm `discount_amount` vào `PosOrderLine` hoặc phân bổ lại khi hydrate; kèm test round-trip hydrate → serialize.
7. **Gate `demo_login`** sau `NODE_ENV !== 'production'` + cờ tường minh; xoá nhánh `login`/`qlaok123456`. (P1-2)
8. **Bỏ mật khẩu mặc định** `qlaok123456` ở API + UI admin. (P1-3)
9. **Thêm `--single-transaction` cho migration runner** (3.5) — đây là điều kiện để các bước sau an toàn.
10. **Chặn race đổi shop ở catalog** (P1-7): `AbortController`/request-id + lấy `shop_id` từ `activeShop` lúc submit.
11. Whitelist cột cho `GET /api/catalog`, lọc `is_published`; sửa `GET /api/posts` lọc `is_active` + bắt buộc `shopId`. (P2-1, P2-2)
12. `SESSION_SECRET` chỉ đọc một biến duy nhất; domain-separate secret QR bàn. (P2-4, P3-10)
13. Validate + rate limit `analytics/track`; đổi `view_count` sang RPC tăng nguyên tử. (P2-3)
14. Hợp nhất audit trail về bảng SQL, ghi sau khi thành công; xoá JSONL hoặc `chmod 600` + rotation. (P2-12) — làm **cùng lúc** với bước 4/5, vì cả hai đều cần một bản ghi thao tác đáng tin.
15. Xoá nhánh credential owner chết. (P2-13)
16. **Siết quyền ở tầng UI**: truyền cờ quyền xuống `QuickItemRow` và `PosCounterWorkspace` (P2-15); kiểm quyền Settings theo nhóm field + sửa `dashboard-nav` (P2-14).
17. **Mobile: bỏ ghim `PRODUCTION_API_URL`** trong `AuthScreen` (P2-16) và bắt buộc HTTPS khi `!__DEV__` (P2-17) — sửa trước khi phát hành build tiếp theo.
18. Chống enumeration ở `register_start` (P2-21); `?lang=` chỉ áp một lần (P2-18); `localizeStorefrontTableError` trả nhãn i18n cho mọi lỗi (P2-19); banner theo `allowedLangs` (P2-20).
19. Sửa WIP để CI xanh: đồng bộ `auth-email-templates` với test, thêm `.agy-runs/**` vào eslint ignores, sửa `tests/e2e.test.mjs` (bỏ cloud ref + `dataSource`) **rồi** thêm e2e vào CI. (mục 6)
20. Thêm cửa sổ ±5 phút cho timestamp SePay; `writeStore`/`writeLocalTablesStore` throw; floor-plan lọc đơn ở query. (P2-5, P2-6, P2-7, P3-9)
21. Bổ sung `REVOKE EXECUTE` cho 8 hàm trigger (007/008/011×2/014×3/022). (3.4)
22. Dọn P3: `getAuthHeaders` cho `handleTranslatePost` (P3-16); `formatCurrency` theo locale (P3-18); `errorTrackingToken` cho 5 locale (P3-19); `<html lang>` theo `params.lang` (P3-20); gộp hai hàm resolve origin (P3-21); push unregister giữ state tới khi DELETE xong (P3-22); prune membership (P3-23); callback URL chỉ đánh dấu sau khi exchange thành công (P3-24); mobile catalog đọc lại body + revert (P3-25); xoá `auth-recovery.ts` (P3-26); điền `eas.projectId` (P3-27).
23. Thu hẹp `/api/health` (P2-8); bỏ tracked `qlaok-handoff.zip` + `tsconfig.tsbuildinfo` (P3-2); unique constraint `orders.order_code` (P3-5); cập nhật README/ARCHITECTURE tới `023` và ghi `SMTP_*` vào `.env.example` (P3-12, P3-13).

---

## 9. Handoff evidence (theo `AGENTS.md`)

**CodeGraph**
- `codegraph status` → index up-to-date (272 file / 4.465 node / 16.455 edge), engine cũ, **không rebuild**.
- `codegraph explore "order commit RPC authorization"` → blast radius: `rpc` (staff-accounts.ts:127, 14 caller, không có test phủ), `SharedOrderQuoteResult` (order-pricing.ts:136, 3 caller), `AssistedOrderPayload` (mobile, có test).
- `codegraph callers commit_order_with_inventory` → symbol không có trong index (RPC SQL, chỉ gọi qua `.rpc()` string) → đọc trực tiếp `supabase/migrations/005`, `007`, `017` và `db.ts`/`mpos-store.ts`.
- Đọc trực tiếp (migration SQL, config, test — unindexed hoặc cần byte-level) sau khi đã query. Gồm cả `.github/workflows/{deploy,verify-pr}.yml`, `scripts/{migrate-self-hosted,backup-qlaok-db,check-order-realtime,demo-reset-purge}.mjs`, `supabase/self-hosted/000_bootstrap.sql` — tất cả nằm ngoài index CodeGraph.
- **Vòng UI/i18n/mobile:** vẫn dùng `codegraph node`/`codegraph callers` để lấy caller trước khi đọc thân component; nhưng phần lớn kết luận của vòng này đến từ **truy vết chuỗi** (component → route → `lib` → RPC) chứ không từ symbol đơn lẻ. Ví dụ P1-5 đi `admin/page.tsx:1195` → `admin/route.ts:738` → `mpos-store.ts:2571`; P1-4 đi `order-pricing.ts:212` → `mpos-store.ts:1030` → `PosCounterWorkspace.tsx:162` → `:419` → `:784`. Đó là lý do kết luận đáng tin hơn đọc từng file riêng lẻ: chuỗi đã đóng kín ở cả hai đầu.

**Khu vực bị ảnh hưởng nếu sửa theo đề xuất**
`src/lib/gemini.ts`, `src/lib/server-auth.ts`, `src/lib/auth-credentials.ts`, `src/lib/shop-tables.ts`, `src/lib/db.ts`, `src/lib/mpos-store.ts`, `src/lib/sepay-reconciliation.ts`, `src/lib/auth-email*.ts`, `src/lib/i18n-helper.ts`, `src/lib/request-origin.ts`, `src/lib/zitadel-login-ui.ts`, `src/lib/dashboard-nav.ts`, `src/lib/shop-permissions.ts`, `src/components/dashboard/PosCounterWorkspace.tsx`, `src/components/dashboard/QuickItemRow.tsx`, `src/app/api/{auth,admin,catalog,posts,analytics/track,health,upload,tables,tables/floor-plan,orders,shops,ai/translate,webhooks/payment}/route.ts`, `src/app/(admin)/admin/page.tsx`, `src/app/(dashboard)/dashboard/{catalog,orders,posts,settings}/page.tsx`, `src/app/(auth)/login/page.tsx`, `src/app/(storefront)/s/[slug]/page.tsx`, `mobile/App.tsx`, `mobile/app.json`, `mobile/src/components/AuthScreen.tsx`, `mobile/src/components/tabs/{CatalogTab,PromotionsTab}.tsx`, `mobile/src/lib/{supabase,api-client,push-notifications}.ts`, `mobile/src/lib/auth-recovery.ts` (xoá), `supabase/migrations/` (chỉ **thêm** file mới — không sửa file đã apply, checksum guard sẽ chặn), `scripts/migrate-self-hosted.mjs`, `.github/workflows/deploy.yml`, `tests/e2e.test.mjs`, `tests/zitadel-custom-login-review.test.ts`, `tests/auth-email-bilingual-review.test.ts`, `eslint.config.mjs`, `next.config.ts`, `.gitignore`, `.env.example`, `README.md`, `ARCHITECTURE.md`.

**Checks đã chạy:** xem bảng mục 6 — typecheck FAIL (24 lỗi, 0 trong `src/`), lint FAIL (27 lỗi, 0 trong `src/`), test:unit PASS 133/133, test:sql PASS 6/6, test:review FAIL 333/336, test:e2e FAIL 4/13, mobile PASS 106/106, build PASS, health/demo_login/catalog/posts probe OK.

**Chưa xác minh:** mục 7 — đáng chú ý nhất là **không có test nào phủ vòng hydrate → sửa → resubmit của POS/admin**, đúng vùng chứa cả ba P1 mới (P1-4, P1-5, P1-6). Đây là khoảng trống test, không chỉ là khoảng trống rà soát.

**Không thay đổi source trong lượt rà này.** Chỉ tạo/cập nhật đúng file báo cáo này. Không commit, không push, không migrate, không deploy.

---

## 10. Kết quả xử lý sau review (2026-10-28)

> Trạng thái dưới đây phản ánh source hiện tại trong working tree; chưa commit, chưa áp dụng migration vào database và chưa deploy.

- **P1-1:** bỏ literal gateway key khỏi source. Key đã lộ trong lịch sử cần được chủ tài khoản rotate riêng.
- **P1-2–P1-7:** đã xử lý các đường demo/credential, giảm giá POS, trạng thái thanh toán admin, hủy/hoàn tiền và race chuyển shop catalog; đã bổ sung regression coverage cho các đường logic tương ứng.
- **P2-1–P2-21:** đã siết public catalog/posts/analytics/health, session secret và SePay replay, lỗi ghi local, truy vấn floor plan, e2e không còn cố định Supabase Cloud, deploy không backup nhầm `.local-db`, audit, credential chết, quyền Settings/catalog/POS/in, URL mobile, locale login, thông báo lỗi bàn, banner ngôn ngữ và email enumeration. Backup PostgreSQL tự host có script + systemd service/timer và runbook; timer chưa được cài trên VPS.
- **P2 migration runner (3.5):** runner tự host giờ dùng `--single-transaction` cho migration thường; hai migration lịch sử tự mở transaction được nhận diện và giữ nguyên byte/checksum. Bộ test runner xác nhận cả SQL thường, transaction tường minh và `DO` block.
- **P3-1–P3-25, P3-28:** đã xử lý các mục cấu hình, repo hygiene, fallback shop, unique mã đơn (migration mới có preflight và retry khi collision), giới hạn OCR, log lỗi an toàn, store write, QR secret, lỗi auth, tài liệu, quyền in, locale/email, push/OIDC state và phản hồi catalog mobile.
- **P3-7:** giữ dưới dạng khuyến nghị kiến trúc; các route mutation đã được rà guard, chưa có lỗi route cụ thể để sửa bằng middleware toàn cục.
- **P3-26:** file mobile không được app runtime import, nhưng `tests/unit.test.ts` còn import các helper của nó. Giữ file để không xóa API đang được test.
- **P3-27:** chưa thể bật push thật vì `mobile/app.json` không có `extra.eas.projectId` và repo/CLI hiện không cung cấp ID để điền. Không tự tạo hoặc đoán ID.
- **P3-29:** kết luận “khách EN thấy tiêu đề tiếng Việt” không khớp renderer storefront hiện tại: `getLocalizedPromoBannerStrings` tạo title/subtitle theo locale khác `vi`, chỉ dùng text lưu trong `banner` cho locale `vi`. Nội dung mobile preview vẫn có thể là tiếng Việt.

**Kiểm tra trước đây:** `npm run typecheck` thành công; `npm run lint` thành công với 0 lỗi và 40 cảnh báo; `git diff --check` thành công. Các test/build trong lượt trước chưa được chạy lại sau những thay đổi cuối.

**Kiểm tra regression mới nhất (2026-10-28):**

| Lệnh | Kết quả |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS — 0 lỗi, 40 cảnh báo |
| `npm run build` | PASS — Next.js production build hoàn tất |
| `npm run test:unit` | PASS — 133/133 |
| `npm run test:review` | PASS — 350/350 |
| `npm run test:sql` | PASS — 6/6 |
| `npm run test:db-reset` | PASS — backup, preflight và demo-reset suites đều thành công; preflight 21/21, demo-reset 6/6 |
| `node --test tests/self-hosted-migration-runner.test.mjs` | PASS — 7/7 |
| `npm --prefix mobile test` | PASS — 109/109 |
| `npm --prefix mobile run typecheck` | PASS |
| `node --check tests/e2e.test.mjs` | PASS — chỉ kiểm cú pháp |
| `git diff --check` | PASS |

Không chạy `npm run test:e2e`: các luồng trong suite có thể tạo/sửa/xóa đơn hàng, catalog, giao dịch và nội dung qua `TEST_BASE_URL`; chưa xác nhận được một máy chủ E2E cô lập. Không áp dụng migration hoặc deploy. Migration `20261028000300_orders_order_code_unique.sql` có preflight từ chối dữ liệu `order_code` trùng hiện có và cần được chạy theo quy trình triển khai có kiểm tra DB đích.

**Claude CLI:** đã gọi trực tiếp theo yêu cầu, không liệt kê model. CLI hiện cấu hình backend DeepSeek; dù có in cảnh báo `unrecognized_model`, nó vẫn tiếp tục chạy và tạo nhiều tool event/thay đổi. Đã dừng sau 361 lượt khi tiếp tục quét và khởi chạy lại kiểm tra mà không kết thúc; không có bản tổng kết cuối từ CLI. Các thay đổi còn lại được Codex đọc lại, sửa lỗi regression tìm thấy và xác minh độc lập bằng các lệnh trên; không xem lời khẳng định chưa kiểm chứng của CLI là bằng chứng.

**Còn cần thao tác ngoài source:** rotate key gateway AI đã từng nằm trong git history; cài systemd backup timer trên VPS; cung cấp EAS project ID thật để bật push. Lúc chạy các check local chưa migrate/deploy production; kết quả lần push sau được ghi ở mục 12. `P3-7` vẫn là khuyến nghị kiến trúc; `P3-26` được giữ vì test còn import helper; `P3-29` là kết luận không đúng với renderer storefront hiện tại, như đã giải thích ở trên.

## 11. Follow-up QA danh mục (2026-10-28)

- Pass 27 trên shop QA xác nhận API tạo/đổi tên/xóa category đều trả 200 và dọn fixture về baseline 1 category/1 item. Dashboard chưa có nút đổi tên; thao tác đổi tên của pass này đi trực tiếp qua API nên không được tính là UI coverage.
- Đã thêm editor đổi tên ngay trên chip danh mục, chỉ hiện thao tác tạo/sửa/xóa với quyền `catalog.manage`. Tên đổi được dịch best-effort; khi dịch lỗi, VI/EN dùng tên mới và không tái sử dụng bản dịch cũ.
- Regression: focused catalog test 9/9, `npm run test:review` 350/350, `npm run typecheck` PASS, `npm run lint` 0 lỗi/40 cảnh báo, `npm run build` PASS. Chưa deploy; thao tác lưu/reload bằng UI sẽ được xác minh sau deploy.
- Lượt gọi read-only Claude CLI trực tiếp cho follow-up này không trả kết quả sau hơn 2 phút sau cảnh báo `unrecognized_model: deepseek`; lần thử lại dùng cấu hình mặc định, không truyền model, vẫn không có kết quả sau khoảng 11 phút và đã dừng. Không liệt kê hay đổi model. Kết luận hiện tại dựa trên diff và kiểm tra độc lập của Codex.

## 12. Kết quả deploy commit 93e1218 (2026-10-28)

- GitHub Actions run `40624669110` chạy đúng SHA `93e121827138a0cf6efe33a6f31e294b646fcc3c`: verify, toàn bộ CI test và production build đều PASS.
- Job deploy đã apply thành công `20261028000100_analytics_atomic_view_count.sql` và `20261028000200_floor_plan_active_orders_index.sql`. `20261028000300_orders_order_code_unique.sql` dừng ở preflight: production có giá trị `public.orders.order_code` bị trùng. Không có order code hay ID đơn nào được đưa vào log.
- Migration runner chạy file thứ ba trong `--single-transaction`; do đó lần chạy lỗi không ghi migration này vào `schema_migrations`. Workflow dừng trước `npm ci`, build và bước restart PM2; không xác nhận app mới đã được phát hành. Probe chỉ status của `GET /api/health` sau đó trả `200`, nhưng endpoint này không xác nhận SHA đang chạy.
- Cần đối soát các order code lịch sử trùng trên VPS trước khi chạy lại migration. Chưa đổi dữ liệu đơn production; lần SSH đọc-only từ máy này bị từ chối tại bước xác minh host key, và môi trường hiện tại không có kết nối DB/Supabase MCP để truy vấn danh sách an toàn.

## 13. Đối soát production chỉ đọc — order code trùng (2026-10-28)

- Sau khi xác thực host key đã có trong `known_hosts`, kết nối `ubuntu@vunph.click` thành công bằng SSH agent hiện có. PostgreSQL tự host database `qlaok` được truy vấn bằng `psql` trong transaction `READ ONLY` (`transaction_read_only=on`), có giới hạn thời gian; transaction kết thúc bằng `ROLLBACK`. Không gửi hay lưu order code, ID đơn, thông tin khách hoặc private key.
- `public.orders` có **3 nhóm mã trùng / 6 đơn**, dư 3 giá trị so với ràng buộc unique. Cả sáu thuộc một quán; mỗi nhóm gồm hai đơn. Thành phần từng nhóm: `completed/paid + completed/paid`; `completed/paid + preparing/unpaid`; `cancelled/unpaid + preparing/unpaid`.
- Không có row `sepay_webhook_events` hoặc `order_audit_logs` liên kết theo `order_id` với sáu đơn; không có `payment_transactions.order_code` trùng những mã đó. Đây không chứng minh không có tham chiếu hoặc chứng từ bên ngoài database.
- `schema_migrations` xác nhận `20261028000100_analytics_atomic_view_count.sql` và `20261028000200_floor_plan_active_orders_index.sql` đã ghi nhận; `20261028000300_orders_order_code_unique.sql` chưa ghi nhận. Không có unique index trên riêng `public.orders.order_code`.
- Chưa đổi mã đơn, trạng thái, thanh toán, dữ liệu hay schema production; chưa chạy lại migration/deploy. Hai đơn chưa thanh toán còn đang chuẩn bị và hai đơn đã thanh toán trong cùng một nhóm khiến việc tự động chọn mã nào để đổi cần đối soát nghiệp vụ và tham chiếu lịch sử trước khi thực hiện.
- Đối chiếu hash shop ID với phiên đăng nhập owner QA riêng xác nhận quán có các đơn trùng **không phải shop QA**. Không ghi hash, shop ID hay dữ liệu khách vào báo cáo.
- Truy vấn metadata chỉ đọc bổ sung: hai khóa ngoại trỏ tới `orders` là `order_audit_logs.order_id` và `sepay_webhook_events.order_id`, cả hai trỏ `orders.id`, không trỏ `order_code`. Điều này không loại trừ tham chiếu bằng chuỗi không có khóa ngoại hoặc chứng từ bên ngoài; chưa đổi dữ liệu production.
- Metadata chỉ đọc tìm thấy các cột tên chứa `order` và `code` tại `orders.order_code`, `payment_transactions.order_code`, `sepay_webhook_events.extracted_order_code`. Đối chiếu aggregate chỉ đọc cho thấy 0 webhook có `extracted_order_code` khớp các mã trùng; không loại trừ cách lưu tham chiếu khác hoặc dữ liệu bên ngoài.

## 14. POS: khôi phục khi mất phản hồi (đang kiểm thử)

- Working tree bổ sung lưu yêu cầu POS trước khi gửi, thử lại cùng nội dung theo thao tác người dùng, đối chiếu khóa ở server và migration local ràng buộc khóa khi có yêu cầu đồng thời. Chưa commit, triển khai hay chạy migration trên production.
- Codex chạy kiểm thử tập trung: 6/6 bài POS, 9/9 bài SQL và typecheck thành công; lint các file liên quan không có lỗi, còn 3 cảnh báo ảnh. AGY Flash tạo `tests/pos-browser-recovery.test.mjs`; Codex chạy lại thành công trên Chrome với component POS thật và server giả lập: phản hồi 504 sau khi ghi, reload không gửi lại, thử lại cùng payload/khóa, một đơn trong fixture, ngữ cảnh tài khoản và lựa chọn in. Đây không phải kiểm thử API/database thật hoặc production.
- Chạy lại toàn bộ `npm run test:review` trên working tree hiện tại: 356/356 đạt, không có bài bỏ qua. Kết quả này không thay thế kiểm thử trên production.
- `npm run build` trên working tree hiện tại hoàn tất thành công; Next.js in cảnh báo lint, không báo lỗi build.
- AGY Flash tái hiện trong Chrome tình huống tab POS thứ hai giữ trạng thái đơn chờ cũ sau khi tab thứ nhất xác nhận và xóa yêu cầu. POS giờ theo dõi thay đổi storage đúng tài khoản/quán; test Chrome hai tab xác nhận tab thứ hai nhận trạng thái chờ, được mở lại sau khi tab đầu xong và gửi giỏ hàng riêng. Codex chạy hai test browser 2/2, typecheck và build đạt sau sửa. Test này không chứng minh loại bỏ mọi race ghi đồng thời giữa các tab hoặc thiết bị.
- Kiểm thử mô phỏng xen kẽ thao tác `getItem`/`setItem` cho thấy hai lời gọi `savePendingPosOrder` có thể cùng báo thành công nhưng chỉ lưu lại một yêu cầu. POS đã bổ sung Web Locks cho thao tác lưu/xóa cùng tài khoản/quán; trình duyệt không hỗ trợ khóa sẽ chặn thao tác an toàn. Kiểm thử giả lập khóa 4/4, browser 2/2 và typecheck đạt. Test Chrome hai tab dùng rào khóa để cả hai bắt đầu trước khi được phép ghi, xác nhận một đơn chờ không bị ghi đè và giỏ còn lại được giữ; chưa xác minh trên các trình duyệt/thiết bị mục tiêu. Chưa deploy.
- **Cập nhật quan trọng:** trong 5 lần chạy liên tiếp test Chrome hai tab với rào khóa, 3 lần thất bại: server fixture nhận hai POST cho hai giỏ khác nhau khi yêu cầu đầu còn chờ. Kết quả pass trước đó không ổn định; không coi Web Locks kết hợp `localStorage` hiện tại là đủ an toàn. Đang thay cơ chế lưu bằng giao dịch IndexedDB và sẽ kiểm thử lặp lại trước commit/deploy. Không có thay đổi production.
- Claude CLI được gọi trực tiếp để phản biện thiết kế IndexedDB. Các điểm phải xác minh khi nhận mã: chờ `transaction.oncomplete` trước khi gửi mạng, thử lại với cùng khóa, xử lý giao dịch abort/quota và đổi tài khoản/quán, cùng thử lại đồng thời không xóa yêu cầu khác. Đây là phân tích thiết kế, chưa phải kết quả kiểm thử mã.
- AGY Argon đã chuyển slot đơn chờ sang giao dịch IndexedDB; Codex kiểm tra mã xác nhận chỉ trả kết quả lưu sau `transaction.oncomplete`, tự sửa trường hợp dữ liệu legacy và IndexedDB xung đột để không xóa nhầm. Test recovery 7/7, browser 2/2, typecheck đạt; test Chrome hai tab lặp độc lập 5/5 đạt sau sửa. Chưa kiểm thử thiết bị mục tiêu hoặc production; POS chưa deploy.
- Kiểm tra bổ sung: nếu truy cập `window.indexedDB` ném lỗi, POS hiển thị cảnh báo thay vì gửi đơn; xác minh bằng Chrome với getter giả lập lỗi. Hai test browser và typecheck chạy lại đạt sau sửa; dữ liệu chờ cũ/mới xung đột được giữ lại và chặn gửi.
- Commit local `99ada1b` chứa sửa POS, migration và test. Trước commit, build thành công và `npm run test:review` đạt 360/360; chưa push/deploy vì migration `20261028000300` còn bị chặn bởi mã đơn trùng production. File báo cáo hiện vẫn là thay đổi working tree riêng, không nằm trong commit.
- Claude CLI được gọi trực tiếp để phân tích thiết kế. Nhận định của Claude là khuyến nghị, không phải bằng chứng đã đọc source: code hiện dùng RPC `commit_order_with_inventory`, canonical JSON và hash khóa theo tài khoản/quán. Rủi ro dữ liệu chờ bị mất khỏi trình duyệt, nhiều tab/thiết bị tạo các khóa khác nhau, và triển khai migration trên production vẫn cần kiểm tra hoặc phương án vận hành; không khẳng định đã giải quyết các trường hợp đó.
- Không triển khai khi migration `20261028000300` còn bị chặn bởi mã đơn trùng; việc đối soát và sửa dữ liệu production chưa được cho phép ngoài truy vấn chỉ đọc.
- Kiểm tra VPS chỉ đọc ngày 2026-10-28: `systemctl list-timers --all` và `systemctl list-unit-files` không liệt kê timer/unit backup Qlaok. Chưa cài hay kích hoạt backup; kết quả này không loại trừ một cơ chế backup khác ngoài systemd.
- Kiểm tra bổ sung chỉ đọc: VPS có `/usr/bin/node`, `pg_dump`, `pg_restore`, script backup hiện diện và checksum của script cùng module import khớp bản local; phân vùng `/var/backups` còn khoảng 28 GB tại thời điểm kiểm tra. `node --test tests/self-hosted-postgres-backup.test.mjs` đạt 4/4 với dependency giả lập. AGY tạo fixture PostgreSQL cục bộ; Codex chạy lại, tạo dump thật, khôi phục sang DB cục bộ tạm và kiểm tra dữ liệu giả, sau đó dọn fixture thành công. Chưa tạo hay diễn tập khôi phục archive production. Kích hoạt backup sẽ tạo bản sao dữ liệu production trên đĩa và cần được cho phép trong phạm vi truy cập hiện tại.

## 15. QA trang báo cáo chủ quán — đọc (2026-10-28)

- AGY Flash báo đã đăng nhập tài khoản QA và kiểm tra `/dashboard/reports` bằng Chrome: trang tải, chuyển giữa bốn tab, chọn hôm nay/tất cả/một ngày lịch sử và thấy thông báo rỗng; chỉ gửi request đọc dữ liệu ngoài POST đăng nhập. Bản ghi không chứa dữ liệu khách nằm trong `.agy-runs/owner-reports-test-evidence.json` (ignored).
- Cả khoảng tất cả lịch sử của shop QA được ghi nhận không có hàng, vì vậy lượt này chỉ cung cấp bằng chứng giao diện trạng thái rỗng, không chứng minh số liệu/tổng tiền khớp API khi có đơn. Evidence không ghi status/body cho từng API, Codex chưa xác minh độc lập các thao tác này; xuất file và in chưa được kiểm thử. Không tính trang báo cáo là đã QA đầy đủ.

## 16. QA danh sách nhân viên — đọc (2026-10-28)

- AGY Flash kiểm thử Chrome trên tài khoản QA; Codex đọc script và chạy lại: đăng nhập, mở khu vực nhân viên; API memberships trả 200, UI đếm 2 hàng và API đếm 2 membership không phải owner. Không có request thay đổi nghiệp vụ; bằng chứng đã ẩn thông tin nhạy cảm ở `.agy-runs/owner_staff_readonly_report.md`.
- Bản báo cáo gốc của AGY suy diễn sai rằng tổng 2 membership có bao gồm owner và selector trạng thái rỗng là của danh sách nhân viên; hai kết luận này không được script chứng minh và đã được chỉnh. Chưa so sánh danh tính từng dòng, xác nhận trạng thái active hoặc kiểm thử tạo/sửa/xóa/đổi quyền; không tính là QA đầy đủ.
- Codex chạy độc lập ba bộ `staff-accounts-review`, `staff-routing-review`, `shop-permissions-and-rls` trên fixture cục bộ: 16/16 test đạt. Các test gồm tạo/đổi quyền/reset/vô hiệu/xóa, tách shop và lỗi DB giả lập; không chứng minh các thao tác đó đã hoạt động trên production.
- AGY bổ sung bằng chứng bốn bộ test cục bộ 29/29; Codex chạy lại riêng `shop-members-manager-review` và `api-review`, 20/20 đạt. Các test manager là kiểm tra source contract, không phải thao tác UI thực. Báo cáo AGY ban đầu ghi không còn mục chưa kiểm chứng; đã chỉnh vì chưa kiểm tra thao tác ghi production, email thật hoặc rollback DB thật.

## 17. QA trang khuyến mãi và bản tin — đọc (2026-10-28)

- AGY Flash chạy Chrome với tài khoản QA; Codex kiểm tra script và chạy lại. Ba tab mở được; tab bản tin hiển thị 8 ngôn ngữ, trạng thái rỗng và 0 bài; `GET /api/posts` trả 200 và 0 bài active. Tab flash sale hiển thị 1 sản phẩm, `GET /api/catalog` trả 200 và 1 sản phẩm. Kiểm toán request ghi nhận 0 thao tác ghi nghiệp vụ; hai POST là đăng nhập.
- Codex bỏ fallback chọn shop đầu và chạy lại: `GET /api/shops` trả 200, tìm được cấu hình theo đúng ID đang lưu trong phiên QA; `promoBanner.enabled` và `flashSale.enabled` đều false. UI không có badge bật, nhưng lượt này không tương tác lưu hoặc xác minh persistence. Chưa kiểm thử tạo/xóa/ghim bài, lưu khuyến mãi hoặc dịch tự động trên production. Evidence ẩn thông tin nhạy cảm ở `.agy-runs/owner_posts_test_evidence.json`.

## 18. QA màn hình bếp — đọc (2026-10-28)

- AGY Flash chạy Chrome trên shop QA; Codex kiểm tra script và chạy lại. Màn hình báo kết nối trực tiếp, `GET /api/orders?...&view=kds` trả 200 và 1 đơn mới; bộ đếm cùng 1 card hiển thị khớp, bộ lọc mới có 1 card và đang chế biến có 0. Không ghi nhận request ghi nghiệp vụ.
- Đính chính bằng chứng AGY: listener mạng chỉ quan sát và đếm request, không chủ động chặn như mô tả ban đầu. Chưa thử chuyển trạng thái, hoàn tất bước bếp, kết nối lại sau mất mạng hoặc nội dung trạng thái khác; dữ liệu của shop QA không bị chỉnh sửa. Evidence ẩn thông tin nhạy cảm tại `.agy-runs/kitchen_test_evidence.json`.
- Codex chạy riêng `tests/order-workflow-review.test.ts` trên fixture cục bộ: 10/10 đạt, bao gồm xác thực workflow, chuyển bước qua API/RPC với PostgreSQL cô lập và bất biến hoàn tất phục vụ độc lập thanh toán. Chưa chứng minh thao tác trên UI production.

## 19. QA tổng quan chủ quán — đọc (2026-10-28)

- AGY Flash kiểm thử Chrome trên shop QA: trang tổng quan tải, `GET /api/analytics/track` trả 200, các giá trị hiển thị được ghi nhận khớp số API tương ứng trong lượt thử; chưa kiểm thử các thao tác ghi. Evidence tại `.agy-runs/dashboard_overview_test_evidence.json`.
- Codex đối chiếu ngữ nghĩa sau kết quả: giao diện tiếng Việt ghi “Tổng … đơn hoàn tất” nhưng dùng `totalOrdersCount`, trong khi `computeShopRevenueAndInventoryStats` đếm mọi đơn không bị hủy, gồm cả mới/đang làm. AGY Flash sửa nhãn VI/EN cho khớp, không đổi số; Codex chạy `dashboard-analytics-review` 8/8 đạt. Commit local `1ee9738`, chưa push/deploy vì migration production còn bị chặn.

## 20. QA trang gói dịch vụ — đọc (2026-10-28)

- AGY Flash kiểm tra Chrome trên đúng shop QA; Codex rà script, sửa phép đếm giao dịch để không mặc định 0 khi thiếu dữ liệu, rồi chạy lại. UI hiển thị gói Miễn phí, `GET /api/webhooks/payment` và `GET /api/shops` đều trả 200 với `profile.plan=free`; API có mảng giao dịch rỗng, UI hiển thị trạng thái rỗng. Không ghi nhận request ghi nghiệp vụ.
- Script giám sát request, không chặn request; các luồng tạo thanh toán, nâng cấp/đổi gói và webhook không được thử trên production. Trang không hiển thị số liệu dùng tài nguyên động nên chưa kiểm thử được mục đó. Evidence tại `.agy-runs/billing_test_evidence.json`.

## 21. QA khóa tính năng quét menu AI — đọc (2026-10-28)

- AGY Flash kiểm tra Chrome trên shop QA; Codex rà script và chạy lại thành công. `GET /api/catalog` ghi nhận `ownerPlan=free`, giao diện hiển thị đúng gói miễn phí và thông báo yêu cầu Premium; liên kết nâng cấp trỏ tới `/dashboard/billing`, liên kết về menu trỏ tới `/dashboard/catalog`. Không thấy các điều khiển tải ảnh, quét hoặc lưu menu; không ghi nhận request ghi nghiệp vụ trong lượt thử. Evidence tại `.agy-runs/ai_scanner_test_evidence.json`.
- Paywall là dialog không modal (`aria-modal=false`) với nhãn và mô tả; đây là thuộc tính thực tế, không phải bằng chứng kiểm thử đầy đủ khả năng truy cập. Listener chỉ quan sát request. Chưa kiểm thử gói Premium, upload, OCR, chỉnh sửa kết quả hoặc lưu menu; không kết luận chức năng scanner đã được QA đầy đủ.

## 22. QA sơ đồ bàn — đọc (2026-10-28)

- AGY Flash kiểm tra QR Studio trên phiên owner có tên shop QA; Codex rà script và chạy lại thành công. `GET /api/tables/floor-plan` trả 200, API, chú giải và marker cùng ghi nhận 1 bàn chờ thanh toán; không ghi nhận request ghi nghiệp vụ. Evidence tổng hợp tại `.agy-runs/floor_plan_test_evidence.json`.
- Đối chiếu shop dựa vào tên hiển thị, chưa chứng minh ID shop của response bằng một phép so sánh độc lập. Marker đã được chọn trước khi click (`true` cả trước và sau), nên chưa chứng minh thao tác chọn đổi trạng thái. Script đọc DOM ngay sau khi đổi bộ lọc, chưa xác minh trạng thái sau khi React cập nhật; không kết luận bộ lọc hoạt động đúng. Listener chỉ quan sát, không ngăn request.
- Chưa thử kéo thả vị trí, tạo/sửa/lưu trữ bàn hoặc thay đổi đơn và thanh toán trên production. Các trạng thái còn lại không có dữ liệu để đối chiếu; chưa coi flow này là QA đầy đủ.
- Follow-up: AGY sửa script để so sánh ID của request floor-plan với shop đang chọn, xác nhận shop thuộc owner QA và đúng tên qua API; Codex rà và chạy lại thành công, không lưu ID. Shop không có section để thử lọc và chỉ có một marker đã chọn sẵn, nên hai tương tác này vẫn chưa được xác minh. Kiểm tra tab trong script chưa đợi React cập nhật nên cũng chưa đủ bằng chứng kết luận hành vi lọc tab.

## 23. QA danh sách đơn chủ quán — đọc (2026-10-28)

- AGY Flash chạy Chrome và Codex rà script, chạy lại thành công: request `GET /api/orders` trả 200 và ID shop trùng phiên owner QA; UI và API đối chiếu số thẻ/badge các tab trạng thái, với 3 đơn mẫu: 1 mới, 1 hoàn tất, 1 đã hủy, cả 3 chưa thanh toán. Tab đang làm có trạng thái rỗng; không có dữ liệu đã thanh toán hoặc hoàn tiền để đối chiếu. Listener chỉ quan sát; không ghi nhận mutation nghiệp vụ. Evidence `.agy-runs/orders_test_evidence.json`.
- **Cần xử lý:** tab “Hôm nay” hiển thị badge 0 nhưng có 2 thẻ đơn. Source hiện tại cố ý đưa đơn còn hoạt động/chưa thanh toán từ ngày trước vào tab, và nếu hôm nay không có đơn thì hiển thị toàn bộ đơn không hủy. Do đó kiểm tra AGY gọi trường hợp này PASS theo logic hiện tại nhưng chưa đánh giá sự không khớp giữa nhãn/badge và nội dung; cần xác định cách trình bày mà vẫn giữ khả năng nhìn thấy đơn chưa xử lý, rồi sửa và kiểm thử.
- Chưa thử cập nhật trạng thái, thu tiền, hủy, hoàn tiền, sửa đơn hoặc in trên production. Chưa so sánh đầy đủ nội dung từng thẻ với API; số thẻ khớp không chứng minh mọi chi tiết đơn đúng.
- Follow-up sửa local trong commit `ba27c85`: nhãn tab phân biệt danh sách hỗn hợp với fallback lịch sử, số đếm theo số thẻ; giữ logic chọn đơn và KPI hôm nay. Codex chạy lại 27/27 test order-live/i18n, typecheck và `git diff --check` đạt. Chưa kiểm thử UI thực của bản sửa hoặc deploy production. AGY đã vô ý checkout báo cáo chưa commit; Codex khôi phục nội dung qua Git snapshot và thêm lại mục 23.
- QA UI local commit `ba27c85`: AGY Flash dựng Next.js/Chrome với API và SSE giả lập; Codex chặn thêm API local không được mock, tăng timeout khởi động, rồi chạy lại thành công 4 ca VI/EN. Ca chỉ có đơn cũ hiển thị nhãn lịch sử, badge bằng 3 card, KPI hôm nay 0; ca trộn đơn hôm nay và đơn cũ cần xử lý hiển thị badge 3 card, KPI 2 đơn và doanh thu của đơn đã trả trong ngày. Đây là fixture giả lập, không chứng minh production đã được deploy hoặc các API/thiết bị thực hoạt động.

## 24. QA cài đặt quán — đọc (2026-10-28)

- AGY Flash kiểm tra Chrome, Codex rà script và chạy lại thành công. `GET /api/shops` trả 200, đối chiếu shop đang chọn thuộc owner QA; script so sánh trong bộ nhớ 16 trường thông tin với API (bao gồm tên, slug, loại hình, địa chỉ và xác nhận giờ mở cửa) và báo khớp; sau reload chỉ xác minh lại riêng slug. Chuyển được 5 tab, không ghi nhận mutation nghiệp vụ. Evidence đã lược dữ liệu nhạy cảm tại `.agy-runs/settings_test_evidence.json`.
- Không dùng kết quả `service_request_notification_rule` làm bằng chứng khớp: script tự lấy giá trị kỳ vọng khi không tìm thấy radio được chọn. Các mục in tem, webhook và nhân viên chỉ kiểm tra phần tử xuất hiện, không kiểm tra chức năng. Listener chỉ quan sát request. Chưa sửa/lưu cài đặt hoặc kiểm tra save → reload trong lượt này; chưa coi settings đã QA đầy đủ.
- Follow-up quy tắc gọi nhân viên: AGY sửa selector để đọc trực tiếp cả hai radio và đánh dấu chưa xác minh nếu thiếu hoặc không rõ lựa chọn; Codex rà và chạy lại. UI chọn `all_order_staff`, khớp quy tắc server sau áp dụng giá trị mặc định của ứng dụng. Không thay đổi hay lưu cài đặt; chưa chứng minh thông báo thực tế được gửi tới đúng người nhận.
- QA lưu cài đặt local: AGY Flash dựng trang thật với API giả lập trong bộ nhớ, Codex rà chặn mạng và chạy lại thành công. Đổi tên quán và quy tắc gọi nhân viên, xác nhận payload PATCH, reload, GET giả lập và UI giữ hai giá trị; khi giả lập PATCH lỗi, UI báo lỗi, không báo lưu thành công và tên sau reload vẫn là giá trị đã lưu trước đó. Đây là kiểm thử với API giả lập, chưa chứng minh PostgreSQL hoặc production lưu thành công.
- QA API settings với PostgreSQL tạm cô lập: AGY Flash tạo cluster test trên localhost; Codex rà script và chạy lại, verdict `SUCCESS`. Gọi trực tiếp handler GET/PATCH với session ký bằng secret test và adapter Supabase test nối PostgreSQL: kiểm tra từ chối 401/403, lưu tên và quy tắc rồi đọc lại DB, từ chối rule không hợp lệ, và không báo thành công khi giả lập lỗi ghi. Đây không phải HTTP/PostgREST hoặc schema production hoàn chỉnh; lỗi DB được giả lập tại adapter. Không chứng minh luồng production hoặc việc gửi thông báo thực tế.
- QA người nhận thông báo gọi phục vụ local: AGY Flash kiểm tra logic chọn người nhận và đường dispatch với DB/transport giả lập; Codex rà script và chạy lại, 7 kịch bản đạt. Fixture xác nhận owner_only chỉ chọn owner; all_order_staff chọn owner và nhân viên có orders.view, loại nhân viên thiếu quyền, inactive và shop khác; kiểm tra thêm request thanh toán và chống gửi lặp. Không gửi push thật; chưa chứng minh gateway hoặc thiết bị nhận thông báo.

## 25. QA danh mục bổ sung — đọc (2026-10-29)

- AGY Flash kiểm tra Chrome và Codex chạy lại script: UI và API được script ghi nhận cùng 1 danh mục/1 sản phẩm, tên, giá, trạng thái và phân loại khớp; không ghi nhận request ghi nghiệp vụ. Evidence tại `.agy-runs/qa-owner-catalog-production-evidence.json`.
- Giới hạn quan trọng: script chỉ đối chiếu tên shop hoặc tìm shop cùng tên trong response, chưa chứng minh ID shop của request catalog khớp shop QA; không dùng kết quả đó làm bằng chứng chắc chắn về phạm vi shop. Với chỉ một sản phẩm và một danh mục, lượt tìm kiếm trùng sản phẩm và chọn danh mục đó không chứng minh lọc loại đúng các sản phẩm khác; selector click không bắt buộc tìm thấy nút. Chưa kiểm thử tạo/sửa/xóa, tồn kho, upload hoặc dữ liệu đa danh mục. Listener chỉ quan sát.
- Follow-up: AGY bổ sung so sánh ID shop đang chọn, shop thuộc owner và `shopId` của GET catalog; Codex rà và chạy lại đạt. Query tìm kiếm không khớp làm số thẻ về 0, xóa query khôi phục lại danh sách. Shop vẫn chỉ có một danh mục nên kiểm thử lọc phân loại nhiều danh mục vẫn chưa được xác minh; không ghi nhận request ghi nghiệp vụ.
- QA lọc danh mục local: AGY Flash dựng giao diện với 3 danh mục/25 sản phẩm và API giả lập; Codex rà script chặn mạng và chạy lại thành công. Kiểm tra từng dòng khi chọn từng danh mục, tìm kiếm có/không có kết quả, kết hợp tìm kiếm và danh mục, sang trang 2 rồi đổi bộ lọc, và đổi kích thước trang. Đây là UI với dữ liệu giả, chưa kiểm tra API/DB production đa danh mục hoặc các thao tác ghi.
- QA tạo/sửa sản phẩm local: AGY Flash dùng trang thật và API giả lập trong bộ nhớ; Codex rà script chặn mạng và chạy lại thành công. Kiểm tra tạo tên/giá/danh mục, sửa tên/giá và sửa giá inline rồi reload; giả lập lỗi tạo/sửa cho thấy thông báo lỗi, không thêm/sửa dữ liệu giả, giá inline rollback. Chưa kiểm thử lưu catalog qua API/DB thật, upload ảnh hoặc dịch AI.
- QA handler catalog với PostgreSQL local tạm: AGY Flash dựng fixture cô lập; Codex rà và chạy lại, verdict `SUCCESS`. Handler POST/GET tạo và sửa sản phẩm, đọc lại qua handler và SQL; fixture kiểm tra từ chối không đăng nhập, nhân viên thiếu quyền, shop khác, dữ liệu không hợp lệ và không báo thành công khi adapter giả lập lỗi ghi. Adapter Supabase là test SQL adapter, schema fixture không đầy đủ production; chưa xác minh PostgREST/HTTP hoặc DB production.
- QA tồn kho UI local: AGY Flash dùng API giả lập trong bộ nhớ; Codex rà script chặn mạng và chạy lại thành công. Kiểm tra bật/tắt bán, cập nhật số lượng, ngăn bật bán khi tồn kho bằng 0, thay đổi hàng loạt, reload; khi giả lập lỗi ghi, UI báo lỗi và hoàn lại giá trị trên fixture. Chưa xác minh cập nhật tồn kho qua API/database thật hay cạnh tranh với đơn đang bán.
- QA concurrency kho PostgreSQL tạm: AGY dùng RPC trích từ migration 017, Codex rà và chạy lại. Hai đơn cạnh tranh vượt tồn chỉ một đơn thành công; test cạn kho và rollback transaction chủ quán đạt trên schema fixture. Một kịch bản SQL trực tiếp tái hiện rủi ro ghi tồn tuyệt đối dựa trên số cũ: đơn xen giữa bị ghi đè số trừ. Đây chưa chứng minh đầy đủ đường UI/API thực tế và cần rà thêm trước khi sửa; không kết luận production đã bị ảnh hưởng.
- Xác nhận race qua handler catalog và PostgreSQL tạm (adapter thử nghiệm): AGY Argon dựng kịch bản, Codex chạy lại thành công. Khi đơn xen giữa đã bán hết 5 món, payload chỉnh giá kiểu UI chứa snapshot cũ khiến handler ghi lại stock 5, sold_count 0 và is_available=true; kịch bản chỉnh stock và import bảng tính cũng tái hiện ghi đè số cũ. Modal dịch chỉ gửi trường cần đổi không tái hiện lỗi stock. Cần sửa đồng bộ các caller và bảo vệ cập nhật stock cạnh tranh, sau đó kiểm thử regression; chưa sửa hoặc xác nhận ảnh hưởng thực tế production.
- Sửa local chống ghi đè tồn kho cạnh tranh & kiểm thử PostgreSQL tạm hai kết nối:
  - Caller UI (`src/app/(dashboard)/dashboard/catalog/page.tsx`, `src/components/dashboard/TranslationEditorModal.tsx`, `src/components/dashboard/CatalogExcelImportModal.tsx`, `src/lib/catalog-excel.ts`, `mobile/src/components/tabs/CatalogTab.tsx`) chỉ gửi các trường thực sự thay đổi; chỉnh giá/nổi bật/ảnh/bản dịch không gửi `stock_quantity`, `sold_count`, `is_available`; chỉnh tồn kho (kể cả `null` không giới hạn và import Excel có đổi tồn) gửi kèm `expected_stock_quantity` và tự tải lại danh mục mới nhất khi gặp `409 STOCK_CONFLICT`.
  - Server (`src/app/api/catalog/route.ts`, `src/lib/db.ts`, `src/lib/shop-permissions.ts`, `src/lib/mpos-store.ts`): `dbUpsertItem` không lấy `currentExistingStock` làm CAS thay thế khi thiếu `expected_stock_quantity`; mọi cập nhật `stock_quantity` trên món đã tồn tại (gồm `upsert_item`, `bulk_update_price_stock`, client legacy, batch Excel/mobile và `null`) bắt buộc có `expected_stock_quantity` khớp snapshot hiện tại kèm điều kiện CAS nguyên tử trên câu lệnh `UPDATE`, nếu thiếu hoặc lệch đều trả `409 STOCK_CONFLICT` có thông báo rõ; các lượt chỉnh giá/metadata (kể cả legacy spread giữ nguyên snapshot tồn cũ trước đơn hàng) tự lược bỏ `stock_quantity`/`is_available`/`sold_count` để giữ chỉnh giá mà không làm thay đổi tồn kho hay mất dữ liệu hợp lệ.
  - Khắc phục lỗi `npm run typecheck` tại `.next/types/app/(dashboard)/dashboard/layout.ts`: tách `NewOrderToastCard` và `TOAST_POSITION_CLASSES` sang `src/components/dashboard/NewOrderToastCard.tsx` để `src/app/(dashboard)/dashboard/layout.tsx` tuân thủ quy ước export của Next.js App Router layout.
  - Kiểm thử regression gọi trực tiếp handler `GET`/`POST /api/catalog` cùng PostgreSQL tạm 2 kết nối chạy RPC `commit_order_with_inventory` thật trong `tests/catalog-excel-and-pagination.test.ts` (cùng `tests/catalog-dashboard-review.test.ts`, `tests/unit.test.ts`, `tests/order-toast-interaction.test.ts`): đạt toàn bộ các kịch bản client cũ thiếu snapshot, race sau read, stale UI price edit, và bulk/Excel/null. Chưa commit hoặc deploy production.
- Hoàn tất sửa local commit `9c6a43e`: chống ghi đè tồn kho/số đã bán bởi snapshot cũ; cập nhật stock yêu cầu giá trị đối chiếu, trả conflict khi thay đổi; bật bán hàng loạt dùng transaction khóa hàng trong migration `20261029000100`. Codex chạy độc lập `test:sql` 9/9, `test:review` 365/365, typecheck web/mobile, lint và build đạt; test race PostgreSQL local 2 kết nối dùng adapter test. Chưa push/deploy và chưa áp dụng migration production: migration `20261028000300` còn bị chặn bởi order_code trùng. Client cũ muốn cập nhật tồn kho mà không gửi snapshot sẽ bị từ chối và cần cập nhật/tải lại.

- Claude CLI (DeepSeek) đã trả review read-only commit `9c6a43e`: xác nhận các rủi ro tương thích payload catalog, thông báo modal và tải lại sau conflict; bác bỏ nhận định mobile không reload vì code đã gọi `onReloadShopData`. Kết quả đầy đủ tại `.agy-runs/claude-stock-compat-review.txt` (artifact local); Claude không chạy test và không truy cập được CodeGraph qua quyền của CLI, nên đây là nhận định cần Codex xác minh độc lập, không phải bằng chứng test pass. AGY đang sửa, chưa commit.
- Codex đối chiếu `codegraph node mobile/src/components/tabs/CatalogTab.tsx`: các nhánh lỗi cập nhật trạng thái bán, giá và tồn kho hiện đều gọi `onReloadShopData`; xác nhận nhận định trước đó về việc thiếu lệnh reload mobile là sai. Chưa xác minh hành vi khi lần reload thất bại.
- Rà bổ sung mobile: AGY Flash thêm bảo vệ thứ tự request và shop đang chọn cho tải lại catalog; Codex chạy độc lập 10/10 test `mobile/tests/staff-workspace.test.ts` (bao gồm response chậm khi đổi shop, hai request cạnh tranh và fallback) cùng typecheck mobile đạt. Test dùng React/fetch giả lập; chưa xác minh thiết bị thật hoặc production. `npm run test:review` trước chỉnh mobile đạt 366/366, typecheck web và mobile đạt. Các thay đổi đang được rà, chưa commit.
- Rà diff API chưa commit bằng `codegraph node src/app/api/catalog/route.ts`: payload legacy đầy đủ chứa snapshot `is_available=true`, trong khi người khác đã tắt bán (`false`) và tồn không đổi, sẽ bị diễn giải là thao tác bật bán khi client chỉ đổi giá. Điều kiện tại nhánh `hasExplicitAvailabilityChange` không phân biệt được ý định với snapshot cũ; đây là nguy cơ ghi đè đồng thời theo phân tích mã, cần tái hiện và sửa trước commit. Claude CLI đang review độc lập; chưa khẳng định đã xảy ra trên production.
- Claude CLI review độc lập xác nhận theo phân tích source: snapshot trạng thái bán cũ có thể ghi đè thao tác tắt bán đồng thời khi sửa giá; đề xuất phân biệt ý định và dùng so sánh nguyên tử nếu hỗ trợ thay đổi kết hợp. Claude không chạy test hoặc CodeGraph do quyền CLI; AGY đang xử lý, chưa coi là đã sửa.
- Rà tiếp qua `codegraph node src/app/api/catalog/route.ts`: nhánh payload legacy có snapshot stock và chỉ khác `is_available` vẫn suy đoán toggle ở cả quyền quản lý và quyền kho. Payload lưu no-op cũ có thể giống hệt payload toggle nên cần từ chối thiếu baseline thay vì ghi đè; test hiện tại chưa chứng minh an toàn trường hợp này. Chưa commit.
- Commit local `3588f5e`: bảo vệ trạng thái bán trước snapshot cũ và cập nhật catalog mobile; snapshot không rõ ý định thiếu `expected_is_available` trả 409, cần tải lại. Codex chạy `test:review` 366/366, catalog API 37/37, typecheck web/mobile đạt; test PostgreSQL tạm hai kết nối xác minh nhánh tồn 0 từ chối thay đổi cạnh tranh. Chưa push/deploy hoặc kiểm tra thiết bị/production; migration mã đơn trùng vẫn chặn triển khai.
- QA khuyến mãi production chỉ đọc qua AGY Flash: báo cáo `.agy-runs/owner-promotions-qa.md` và evidence `.agy-runs/owner_posts_test_evidence.json` ghi GET shops/posts/catalog 200, trạng thái UI tương ứng, không ghi nhận request ghi nghiệp vụ. Codex rà script: request được ghi nhận sau khi phát sinh, không có chặn chủ động; hai POST thực tế là `/api/auth/login-ui` và `/api/auth`, báo cáo gọi cả hai login-ui là không chính xác. Chưa test lưu rồi tải lại hoặc xác minh commit local trên production.
- QA khuyến mãi local: AGY Flash kiểm tra banner và flash sale bằng Chromium với API giả lập và bộ nhớ tạm; Codex chạy lại script, xác nhận lưu → reload và giữ draft sau lỗi lưu trong fixture. Test component/API liên quan đạt 2/2; Codex sửa fixture test để typecheck và ESLint đạt. Chưa xác minh lưu thực tế trên production hoặc cơ sở dữ liệu thật; test mới chưa commit. Báo cáo `.agy-runs/promotions-persistence-local.md`.
- Codex chạy lại toàn bộ `npm run test:review` sau khi thêm test fixture: 367/367 đạt; `npm run typecheck` và ESLint cho file test mới cũng đạt.
- QA chi tiết đơn production: AGY Flash báo 3 đơn được đối chiếu trạng thái, tổng tiền, số lượng và giá dòng với API; có kiểm tra mở/đóng modal và số thẻ ở 7 tab, báo cáo `.agy-runs/owner-order-detail-readonly.md`. Codex rà script: có chặn chủ động request ghi nghiệp vụ nhưng xác thực cho phép cả `/api/auth` và `/api/auth/login-ui` cùng các đường dẫn auth khác; báo cáo chỉ nêu một endpoint là thiếu. Bộ lọc dùng chờ 600 ms và so số lượng thay vì so tập ID; so nhãn bàn có thể cho qua chuỗi rỗng, vì vậy chưa coi các phần đó là xác minh đầy đủ. Script còn ghi toàn bộ nội dung thẻ vào console, cần loại dữ liệu trước khi chạy lại; Codex chưa chạy xác minh độc lập. Chưa thử mutation đơn.
- Claude CLI (DeepSeek) hoàn tất rà read-only P2-12 tại `.agy-runs/claude-next-review.txt`: đề xuất xử lý audit đơn ghi file và khó truy vấn, cảnh báo một số sự kiện không có order ID phù hợp khóa ngoại bảng audit. Claude chưa chạy test, không dùng được CodeGraph trong phiên của nó; Codex đã bắt đầu đối chiếu bằng `codegraph explore` và chưa xác nhận đầy đủ hoặc sửa vấn đề này.
- Codex kiểm tra `codegraph node recordOrderAuditLog`, `appendPrivateAuditRecord` và route service request, đối chiếu migration `004`: xác nhận audit hiện ghi file, lỗi ghi được log rồi không truyền về caller; service request dùng ID của chính nó trong trường `orderId`, trong khi bảng SQL yêu cầu khóa ngoại tới orders. Chưa triển khai chuyển audit sang SQL; cần thiết kế ngữ nghĩa sự kiện và quyền đọc, tránh báo lỗi giao dịch đã commit như thất bại.
- QA đơn hàng follow-up: Codex rà và chạy lại độc lập script AGY, 7 tab khớp tập mã đơn so với API cho 3 đơn hiện có; nhãn bàn không rỗng, trạng thái/tổng tiền/số lượng/giá dòng và mở đóng modal in, QR đạt. Chặn chủ động request ghi nghiệp vụ; chỉ có POST xác thực. Tập rỗng `preparing` chưa kiểm thử đơn đang làm; chưa test thu tiền, hủy, hoàn tiền, sửa hoặc tạo đơn. Evidence `.agy-runs/owner-order-detail-followup.md`; bộ lọc đối chiếu quy tắc hiện tại, không chứng minh mọi quy tắc nghiệp vụ mong muốn.
- P2-12 audit đơn và admin — đã sửa và deploy: AGY Argon review độc lập; Codex xác minh bằng CodeGraph (`recordOrderAuditLog`, `dbInsertOrderAuditLogs`, route audit, quyền `reports.view`, migration runner và reset demo). Audit đơn lưu DB cho cả order/service request với subject/FK/shop integrity; settlement fan-out theo từng order ID và replay dùng ID ổn định; SePay giữ ID tương thích RPC; endpoint đọc giữ RLS `reports.view`. Admin audit có bảng riêng và API chỉ cho Super Admin; demo reset giữ bảng này và preflight đếm đủ 22 bảng. Migration mới `20261030000100_order_audit_logs_subjects.sql`, không sửa migration cũ.
  - Codex chạy: preflight demo reset 16/16; demo reset 4/4; admin review 11/11; order audit review 2/2; SQL review 9/9; DB reset suite đạt (backup 19/19, preflight/runner 21/21, demo reset 6/6); review suite 373/373; typecheck đạt; lint 0 lỗi và 40 cảnh báo; build đạt 41/41 trang; `git diff --check` đạt. Các test audit xác nhận replay không nhân đôi, thiếu service-role bị từ chối, cross-shop/mismatched subject bị chặn, audit immutable và admin history còn sau reset.
  - SSH bằng host key đã có trong `known_hosts`, truy vấn PostgreSQL production trong transaction chỉ đọc: không còn nhóm `order_code` trùng, unique index đã tồn tại, migration `20261028000300_orders_order_code_unique.sql` đã được ghi nhận. Không sửa dữ liệu production; migration audit mới chưa áp dụng và sẽ chạy qua workflow deploy sau push.
  - Claude CLI follow-up được gọi trực tiếp theo yêu cầu nhưng sau 29 phút chỉ in cảnh báo không nhận diện model `deepseek`, không tạo output; đã dừng và không tính là review hoàn tất. Dùng báo cáo Claude đã có tại `.agy-runs/claude-next-review.txt` cùng AGY và kiểm chứng CodeGraph/test của Codex; không đọc `.env` hoặc xuất dữ liệu production.
  - Follow-up: CI run `40921319647` trên SHA `14a9f963de08e50af95a849752ab42f3daddb53e` hoàn tất thành công, gồm build và bước deploy VPS. Đây là bằng chứng deploy cho migration audit; không có truy vấn production mới trong follow-up này.

## 27. Storefront QA: tương phản theo màu theme (2026-10-29)

- AGY Flash kiểm tra read-only storefront production trên đúng shop QA `Qlaok QA Staff Mobile 2026-10-24`: một language control, search match/no-match/clear, category chip, chuyển VI/EN, health/catalog reads và console đều đạt; không gửi business write. Báo cáo `.agy-runs/storefront-public-interactions-production-qa-2026-10-29.md`.
- Tính tương phản trên màu thật trong browser phát hiện giá món dùng nguyên `primaryColor` trên thẻ trắng: `#10b981` chỉ đạt `2.54:1`, dưới WCAG AA `4.5:1`. Cùng pattern tồn tại ở F&B/list, service, retail/grid và chi tiết món; nút màu brand dùng chữ/icon trắng cố định.
- Codex sửa local bằng helper tính contrast và điều chỉnh màu chữ accent tối thiểu theo màu người dùng chọn + màu nền thực tế. Với `#10b981`, giá dùng `#0c875e` đạt `4.52:1`; chữ/icon trên nền brand dùng foreground đen/trắng có contrast tốt nhất. Nền theme được giữ nguyên. Áp dụng cho ba layout sản phẩm, chi tiết món, nút thêm nhanh và biểu tượng Wi-Fi.
- Regression: `npm run test:review` 374/374; `npm run typecheck` PASS; ESLint các file đổi 0 lỗi, 3 cảnh báo `<img>` hiện hữu; `npm run build` PASS (41 route); `git diff --check` PASS. Commit `be49218` được CI run `40914823835` deploy thành công. Phần follow-up QA production ngày 30/10 ở dưới ghi lại phép đo với màu theme thực tế.
- Ngày 30/10, AGY Flash dùng Chrome kiểm tra chỉ đọc shop QA `test-shop-1` trên production (`/s/test-shop-1` và `/menu` đều HTTP 200), primary color `#8b5cf6`. Giá trên thẻ trắng đạt 4.50:1; header và icon màu tối trên tím đạt 4.76:1. Nút cửa dùng chữ trắng chỉ đạt 4.23:1, dưới AA. Search khớp/không khớp/xóa, category chip và language control hoạt động; console không có lỗi. Không có thao tác đơn hàng/dịch vụ; trang tự gửi một telemetry `POST /api/analytics/track` với `scan_door`, được giữ nguyên.
- Codex áp dụng cùng `getContrastTextColor(primaryColor)` cho hai CTA, logo Q và ô logo chữ cái; bỏ chữ trắng/opacity cố định trên các bề mặt primary. Thêm regression test kiểm tra cả bốn bề mặt. `npm run test:review` 377/377, typecheck đạt, ESLint 0 lỗi (3 cảnh báo `<img>` hiện hữu), build đạt 41 route. Commit `eabd621` được CI run `40980870667` verify và deploy success.
- AGY Flash đo lại sau deploy trên cùng shop: hai CTA, Q logo, ô logo chữ cái và icon đều dùng `#020617` trên `#8b5cf6`, đạt 4.76:1; giá `#8659ed` trên trắng đạt 4.50:1. Codex tính lại độc lập: lần lượt 4.7641:1 và 4.5011:1. Door/menu đều HTTP 200, console không lỗi, không có order/service request hoặc business write; chỉ có telemetry `scan_door` tự động được giữ nguyên.

## 28. Analytics item view 500 — đã sửa, deploy và xác minh production (2026-10-30)

- AGY Flash QA trên đúng shop thử nghiệm xác nhận trang menu, cart và quote hoạt động; khi mở chi tiết món, `POST /api/analytics/track` trả `500 {"error":"Failed to record analytics event"}`. Request là `item_view` của món `onboarding:shop-1792820716317:first-item`. Không tạo đơn hoặc thay đổi thanh toán/dịch vụ.
- Codex đối chiếu production bằng SSH đã xác thực host key và truy vấn PostgreSQL chỉ đọc: RPC `public.increment_item_view_count(text,text)` tồn tại, migration `20261028000100_analytics_atomic_view_count.sql` đã áp dụng, nhưng PostgREST access log ghi các lời gọi `/rpc/increment_item_view_count` trả 404. PostgREST chạy với schema `public`; cache chưa được nạp lại sau khi migration thêm RPC. DB ghi nhận 4 analytics event trong phút QA nhưng `items.view_count` vẫn là 0; đây là chênh lệch đã ghi vào production từ lượt kiểm tra, không xóa hoặc sửa các telemetry này.
- Đã thêm migration `20261030000200_reload_postgrest_schema_cache.sql` phát `NOTIFY pgrst, 'reload schema'`, và cập nhật `scripts/migrate-self-hosted.mjs` để tự phát một thông báo sau mỗi lô migration thành công (không phát khi không có migration hoặc có lỗi). Runner nhận diện lệnh top-level đầu tiên để tránh nhầm `NOTIFY` nằm trong comment, string hoặc thân `DO` block và tránh thông báo lặp nếu migration cuối đã tự phát lệnh này.
- Codex chạy `node --test tests/self-hosted-migration-runner.test.mjs` 11/11, `npm run test:sql` 13/13, `npm run test:db-reset` 46/46 và `git diff --check` đạt. CI run `40921319647` trên SHA `14a9f963de08e50af95a849752ab42f3daddb53e` có typecheck, toàn bộ unit/review/SQL/DB-reset/mobile tests, build và VPS deploy đều success.
- Sau deploy, Codex xác minh read-only migration marker đã được ghi vào `public.schema_migrations`; gọi đúng một `POST /api/analytics/track` cho món QA nhận HTTP 201 (trước fix trả 500). Truy vấn chỉ đọc xác nhận `items.view_count` tăng từ 0 lên 1 và tổng `item_view` events tăng từ 10 lên 11. Event test được giữ lại, không chỉnh/xóa telemetry production.
- CI run `40920791915` phát hiện test preflight demo reset hard-code tổng migration là 30; đổi thành 31 và thêm kiểm tra filename migration mới. `npm run test:db-reset` đạt 46/46 sau cập nhật. Commit `14a9f96` sau đó chạy CI `40921319647` thành công và được deploy; mục analytics đã được xác minh production ở trên.

## 29. Admin-created owner profile không thể liên kết với Zitadel (2026-10-30)

- Nguyên nhân: Super Admin tạo profile với ID `owner-<uuid>` và không có `zitadel_sub`; luồng OIDC cố ý không liên kết một profile hiện hữu chỉ dựa vào email. Vì vậy owner tạo trước không thể nhận profile/gói đã chọn khi đăng ký Zitadel.
- Đã thêm marker một lần `profiles.owner_invite_pending`. Migration `20261030000300_admin_owner_invitation_claims.sql` chỉ backfill ID đúng mẫu `owner-<UUID>` chưa có subject và có email; không đổi các ID `owner-*` tùy ý. Trigger mới chặn client tự bật/tắt marker; backend `service_role` và migration vẫn có thể quản lý.
- `POST /api/admin` kiểm tra plan hợp lệ, dò email không phân biệt hoa thường nhưng escape ký tự wildcard, từ chối email đã có profile và tạo profile chờ nhận lời mời. Giao diện nói rõ owner phải tự đăng ký và xác thực đúng email qua Zitadel; thao tác này không gửi email mời.
- Khi callback Zitadel có `email_verified === true`, backend chỉ claim marker nếu email chuẩn hóa khớp tuyệt đối; cập nhật `zitadel_sub` và tắt marker bằng compare-and-set để chỉ một subject nhận profile. Profile ID và plan giữ nguyên; các profile thường vẫn không được link bằng email. Trùng nhiều profile cùng email thì từ chối an toàn.
- AGY Flash review độc lập phát hiện lookup email ban đầu phân biệt hoa thường, backfill rộng theo `owner-%`, và khả năng client tự sửa marker. Codex sửa cả ba và thêm kiểm thử API, backfill chỉ UUID chính xác, quyền trigger, claim một lần và giữ plan. Claude CLI được gọi trực tiếp theo yêu cầu nhưng gateway chỉ trả cảnh báo không nhận diện `deepseek`, không có review output; không tính là review hoàn tất.
- Kiểm tra: `npm run test:review` 376/376; `npm run test:sql` 13/13; `npm run test:db-reset` 46/46; targeted auth/admin tests sau xử lý wildcard 44/44; `npm run typecheck` đạt; ESLint các file đổi 0 lỗi/cảnh báo; `npm run build` đạt 41 route; `git diff --check` đạt. Commit `df4e55272448be3a8c39a1355887ec3743607024` được CI run `40979596503` xác minh và deploy thành công; log deploy xác nhận migration `20261030000300_admin_owner_invitation_claims.sql` đã áp dụng và `GET /api/health` trả 200.

## 30. Production QA vòng đời danh mục qua UI (2026-10-30)

- AGY Flash (`gemini-3.8-flash-medium`, quota snapshot trước lượt chạy: 7.4% Gemini weekly còn lại) đăng nhập bằng tài khoản QA, xác nhận đúng shop `test shop 1`, rồi tạo, đổi tên và xóa một category fixture không có món qua `/dashboard/catalog`. `POST /api/catalog` trả 200 cho create và rename; `DELETE /api/catalog?categoryId=...` trả 200. API GET mới sau từng bước xác nhận cùng category ID và tên đã lưu.
- Sau reload, AGY thấy đúng category ID baseline ban đầu và không còn fixture. Codex xác minh độc lập thêm bằng `GET /api/catalog?shopId=...` trực tiếp từ `QA_BASE_URL`: HTTP 200, đúng một category baseline, fixture vắng mặt. Không có order/payment/service-request write; dữ liệu ban đầu được giữ nguyên.
- Browser ghi nhận một HTTP 402 từ một asset ảnh external, không có lỗi JavaScript/runtime của ứng dụng. Nguyên nhân asset chưa được truy ra; không tính là lỗi UI đã xác nhận.
- Bằng chứng chi tiết ở `.agy-runs/catalog-category-production-qa.md` (ignored, không commit). CodeGraph: explore `catalog category rename category editor handleAddCategory deleteCategory /api/catalog`, `GET /api/catalog shopId public storefront categories response`, và các truy vấn/`node` liên quan do AGY ghi trong handoff. Không sửa source nên không chạy lại bộ test/build.
- Claude CLI được gọi trực tiếp ở chế độ read-only, không liệt kê hoặc chọn model; CLI chỉ trả cảnh báo `unrecognized_model` cho gateway `deepseek` rồi lỗi thực thi, không có nhận xét code. Không tính đây là review hoàn tất.

## 31. Production QA lọc danh mục và tìm kiếm (2026-10-30)

- AGY Flash (`gemini-3.8-flash-medium`) đăng nhập shop QA, chụp baseline gồm một category có món và một sản phẩm, rồi tạo category fixture rỗng qua UI (`POST /api/catalog` 200). UI “Tất cả” và category gốc hiển thị đúng tập ID từ API; category rỗng hiển thị 0 món cùng empty state. Tìm kiếm khớp trả món, còn kết hợp từ khóa đó với category rỗng trả 0 món; xóa từ khóa khôi phục đúng danh sách.
- Xóa fixture qua dialog UI (`DELETE /api/catalog?categoryId=...` 200), tải lại trang và đối chiếu API: category IDs cùng mapping item-category trùng baseline; fixture không còn trong API hoặc DOM. Codex gọi độc lập `GET /api/catalog?shopId=...`: HTTP 200, đúng một category và một item baseline, fixture vắng mặt, mapping khớp chính xác. Không có order/payment/service-request write và không sửa file source.
- Browser ghi nhận một HTTP 402 từ asset ảnh external, không có lỗi JavaScript/runtime; nguyên nhân asset chưa được truy ra. Shop QA chỉ có một category có món, nên lượt này chưa chứng minh phân vùng giữa hai category cùng có món.
- Bằng chứng chi tiết tại `.agy-runs/catalog-filter-production-qa.md` (ignored, không commit). CodeGraph: `codegraph status`; `codegraph explore "selectedCategoryId category_id filter items currentPage dashboard catalog page"`; `codegraph explore "catalog category rename category editor handleAddCategory deleteCategory /api/catalog"`; `codegraph explore "POST /api/catalog action upsert_item create item new item stock_quantity is_available item_id"`; `codegraph node` cho catalog page, `QuickItemRow` và catalog API. Không sửa source nên không chạy lại test/build.

## 32. Production QA báo cáo, export và in bill — chỉ đọc (2026-10-30)

- AGY Flash (`gemini-3.8-flash-medium`) kiểm tra `/dashboard/reports` trên đúng `test shop 1`. Các GET `/api/shops`, `/api/orders`, `/api/tables` và `/api/orders/events` đều trả 200. Đã mở đủ bốn tab đơn hàng/bàn/ngày/món, chuyển các preset ngày, thử lọc trạng thái/thanh toán/phương thức/nguồn và tìm kiếm; bộ đếm, KPI và tổng tiền trong UI khớp phép tổng hợp in-memory từ API. Tập hiện có gồm 3 đơn: 2 hợp lệ, 1 hủy; số dư chưa thu là 300.000đ, thực thu 0đ.
- Export CSV/XLSX và export theo bàn tạo đúng cấu trúc/cỡ tập dữ liệu; file tạm bị xóa ngay sau khi kiểm header/số dòng. AGY chặn dialog hệ điều hành, gọi handler in phiếu từ modal, xác nhận handler chạy một lần và không lưu PDF. Không có POST/PUT/PATCH/DELETE nghiệp vụ hoặc cài đặt. Sau reload, trang trở về mặc định “Hôm nay” với trạng thái rỗng tương ứng; 0 lỗi JavaScript/console, 4 cảnh báo autoplay audio của browser.
- Chưa kiểm tra thao tác nhập tay vào date picker tùy chỉnh hoặc giấy in vật lý. Bằng chứng chi tiết tại `.agy-runs/report-page-readonly-production-qa.md` (ignored, không commit). CodeGraph status/sync/explore/query/node trước khi đọc source; các vùng: reports page, `report-view.ts`, `table-export.ts`, `ReceiptPrintModal`, API orders/tables. Chỉ sửa tài liệu nên không chạy lại test/build.

## 33. Follow-up danh sách nhân viên: khớp danh tính và trạng thái (2026-10-30)

- AGY Flash đối chiếu tab nhân viên của đúng shop QA với `GET /api/shops?action=memberships` (200) bằng ID nội bộ trong bộ nhớ, không ghi ID/tên/username/email. Hai membership không phải owner khớp 2/2 dòng UI về danh tính hiển thị, role và trạng thái; 2 active, 0 inactive (1 cashier, 1 staff). Nút làm mới và reload đều gọi GET 200, kết quả vẫn khớp; không có mutation hoặc lỗi runtime. Có một lỗi tải asset ảnh archived trả 402, không phải lỗi ứng dụng đã xác nhận.
- Không thử tạo/sửa/xóa, đổi quyền/trạng thái, mời nhân viên hay reset mật khẩu. Evidence đã quét lại để không chứa PII tại `.agy-runs/staff-list-identity-status-readonly-qa.md` (ignored). CodeGraph: `codegraph status`; explore/query `membership staff list`, `memberships`, `ShopMembersManager`, `ShopMembersManager loadMembers`; node component `ShopMembersManager`, API `/api/shops`, dashboard settings và auth. Không sửa source nên không chạy lại test/build.

## 34. Follow-up sơ đồ bàn: shop, marker và lọc khu vực (2026-10-30)

- Codex tiếp tục QA chỉ đọc trên QR Studio của shop QA. ID shop đang chọn khớp `shopId` của request floor-plan và danh tính shop đã đối chiếu với owner QA. `GET /api/tables/floor-plan` trả 200 với 1 bàn; chế độ sơ đồ hiển thị đúng 1 marker. Marker ban đầu đã được chọn (`data-selected=true`, `aria-pressed=true`).
- Chọn khu vực rỗng qua UI làm API subset và số marker cùng bằng 0; đổi lại “Tất cả” khôi phục 1 bàn/1 marker, khớp API và UI. Không phát sinh POST/PUT/PATCH/DELETE; console không ghi nhận lỗi. Chỉ có một bàn trong shop, nên chưa kiểm tra được lọc khu vực có bàn hoặc chuyển trạng thái chọn từ chưa chọn sang đã chọn.
- Không kéo thả, tạo/sửa/lưu trữ bàn hoặc thao tác đơn/thanh toán. Lượt này chỉ khép lại kiểm tra shop/API, marker ban đầu và trạng thái sau cập nhật bộ lọc; không coi sơ đồ bàn đã QA đầy đủ. Phiên browser đã đóng và snapshot chứa thông tin QA đã xóa.
- CodeGraph đã dùng trước khi đọc source: explore `QR Studio floor plan tables status filter selected marker toggle shop id active tabs table markers GET /api/tables/floor-plan`; node `ShopTableFloorPlanCanvas` và `src/components/ShopTableFloorPlanCanvas.tsx` quanh handler/marker selection. Chỉ cập nhật tài liệu; không chạy test/build. Không lưu ID bàn hoặc dữ liệu cá nhân trong evidence.
