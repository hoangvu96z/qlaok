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
| i18n | Trung bình — 2 miền locale tách đúng, nhưng lọt chuỗi VI hardcode (P3-18, P3-19) và `?lang=` khoá switcher (P2-18); P3-29 đã được rút lại sau khi đối chiếu renderer storefront và mobile preview |
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

- **Cập nhật 2026-10-31:** `getAiConfig()` hiện chỉ dùng `AI_API_KEY` và trả `null` khi biến thiếu; fallback credential đã bị bỏ khỏi source. Giá trị từng xuất hiện trong repository công khai và vẫn nằm trong lịch sử Git. Cần rotate tại gateway; lượt này chưa có quyền quản trị gateway để xác nhận rotation. Giá trị trong báo cáo hiện được che.

- **Vị trí:** `src/lib/gemini.ts:14-15`
- **Bằng chứng:**
  ```ts
  const apiKey =
    process.env.AI_API_KEY || '[REDACTED]';
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
- **Trạng thái:** **đã xử lý trong source hiện tại**; đối chiếu lại ngày 30/10 tại mục 62. `create_owner` tạo hồ sơ lời mời pending qua Zitadel và không cấp mật khẩu mặc định.
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

- **Trạng thái hiện tại:** source đã whitelist các trường shop công khai, yêu cầu quyền khi shop chưa publish và trả `404 SHOP_NOT_FOUND` khi ID không tồn tại. Production QA chỉ đọc tại mục 77 xác nhận projection, trường hợp thiếu ID và ID không tồn tại; chưa probe trực tiếp một shop chưa publish.

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

#### P2-7. Floor plan trả 500 khi có hơn 10.000 đơn đang mở/chưa thanh toán

- **Vị trí tại thời điểm rà:** `src/app/api/tables/floor-plan/route.ts:18, 51, 80-106`
- **Bằng chứng tại thời điểm rà:** `MAX_RECORDS = 10000`, phân trang 500, và nếu còn kết quả sau bản ghi 10.000 thì route ném `MAX_RECORDS_EXCEEDED_*` → HTTP 500.
- **Tác động:** shop có hơn 10.000 ticket phù hợp điều kiện tổng hợp mất sơ đồ bàn và số tiền chưa thu.
- **Trạng thái:** đã sửa ở mục 49; route giữ query lọc trạng thái tại DB và tổng hợp order pages tăng dần, không còn trần 10.000 đơn.
- **Hướng sửa ban đầu:** lọc đúng đơn cần tổng hợp hoặc tính bằng SQL; mục 49 thực hiện lọc server-side + tổng hợp streaming.

#### P2-8. `GET /api/health` lộ cấu hình nội bộ

- **Vị trí:** `src/app/api/health/route.ts:57-65`
- **Bằng chứng:** trả `aiProvider` gồm baseUrl gateway, tên model text/vision; `counts` của 6 bảng.
- **Tác động:** trinh sát hạ tầng miễn phí; counts cho biết quy mô dữ liệu thật.
- **Trạng thái:** đã sửa trong source; response public chỉ còn status/service/timestamp, diagnostics được giữ sau `requireSuperAdmin`. Production follow-up và regression coverage ở mục 50.
- **Hướng sửa:** tách `/api/health` (chỉ `{status}`) khỏi `/api/health/detail` (yêu cầu `requireSuperAdmin`).

#### P2-9. E2E cần database disposable trong CI để chạy an toàn

- **Vị trí:** `tests/e2e.test.mjs` dùng `TEST_BASE_URL`; các nhóm test 5, 6, 7, 8, 9 và 13 ghi catalog, gói, bài viết, analytics, giao dịch và đơn vào shop demo cố định. CI cần fixture database dùng một lần trước khi bật các nhóm này.
- **Bằng chứng cập nhật:** các vấn đề cũ về URL/key Supabase Cloud và assert public `dataSource === "supabase"` không còn trong source hiện tại; test mobile đọc shop/catalog qua API Qlaok. Tuy vậy, E2E chưa có máy chủ và database disposable do CI quản lý, nên chưa thể chạy nguyên suite an toàn.
- **Tác động:** CI không có coverage HTTP E2E; chạy nhóm mutation với server nối production có thể sửa dữ liệu thật.
- **Trạng thái:** base URL bị giới hạn về HTTP loopback; các nhóm mutation được skip trừ khi người chạy đặt đồng thời `E2E_ALLOW_MUTATIONS=1` và `E2E_DISPOSABLE_DATABASE=1`. Unit coverage cho guard chạy trong `test:unit`. `scripts/run-e2e-ci.sh` tạo PostgreSQL 14 với `wal_level=logical`, áp bootstrap và mọi migration, chạy PostgREST cùng Next.js rồi dọn container; chỉ script này bật hai cờ mutation. Cả verify-PR và deploy workflow gọi runner trước build. Việc đóng P2-9 còn chờ Actions chạy thành công trên commit chứa thay đổi.
- **Hướng xử lý tiếp:** kiểm tra job E2E trên commit đầu tiên; xử lý lỗi runner/test nếu có rồi chỉ đóng P2-9 sau khi run của đúng SHA thành công.

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

- **Cập nhật 2026-10-31:** đã đóng theo source/test hiện tại; mục review lúc đầu phản ánh code cũ. Đăng ký email đã tồn tại dùng cùng HTTP 200 và cùng response shape như email mới; xem mục 84 để biết kiểm chứng độc lập và giới hạn.
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
| P3-29 | **Đã rút lại (2026-10-30):** banner tạo text tiếng Việt để lưu không đồng nghĩa khách EN nhìn thấy tiếng Việt. Storefront sinh title/subtitle theo locale hiện tại; mobile preview cũng có đủ bản dịch cho 8 locale. Regression coverage mới xác nhận mobile preview giữ đúng các chuỗi hiện có. | `mobile/src/components/tabs/PromotionsTab.tsx:75-92`; `src/components/storefront/StorefrontCustomDecor.tsx:442-507`; `mobile/src/lib/promo-preview-i18n.ts` |

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
- **P2-1–P2-21:** đã siết public catalog/posts/analytics/health, session secret và SePay replay, lỗi ghi local, truy vấn floor plan, e2e bỏ Supabase Cloud hardcode và có guard mutation (job CI với DB fixture vẫn mở; xem mục 51), deploy không backup nhầm `.local-db`, audit, credential chết, quyền Settings/catalog/POS/in, URL mobile, locale login, thông báo lỗi bàn, banner ngôn ngữ và email enumeration. Backup PostgreSQL tự host có script + systemd service/timer và runbook; timer chưa được cài trên VPS.
- **P2 migration runner (3.5):** runner tự host giờ dùng `--single-transaction` cho migration thường; hai migration lịch sử tự mở transaction được nhận diện và giữ nguyên byte/checksum. Bộ test runner xác nhận cả SQL thường, transaction tường minh và `DO` block.
- **P3-1–P3-25, P3-28:** đã xử lý các mục cấu hình, repo hygiene, fallback shop, unique mã đơn (migration mới có preflight và retry khi collision), giới hạn OCR, log lỗi an toàn, store write, QR secret, lỗi auth, tài liệu, quyền in, locale/email, push/OIDC state và phản hồi catalog mobile.
- **P3-7:** giữ dưới dạng khuyến nghị kiến trúc; các route mutation đã được rà guard, chưa có lỗi route cụ thể để sửa bằng middleware toàn cục.
- **P3-26:** file mobile không được app runtime import (mobile dùng luồng Zitadel tùy chỉnh qua `mobile/src/components/AuthScreen.tsx`); file dead helper đã được xóa hoàn toàn trong mục 73 và các test chuyển sang dùng `src/lib/auth-recovery.ts` của web.
- **P3-27:** chưa thể bật push thật vì `mobile/app.json` không có `extra.eas.projectId` và repo/CLI hiện không cung cấp ID để điền. Không tự tạo hoặc đoán ID.
- **P3-29:** kết luận “khách EN thấy tiêu đề tiếng Việt” không khớp renderer hiện tại. Storefront derive title/subtitle theo locale khác `vi`; mobile preview cũng đã có bản dịch cho 8 locale. Lượt rà 30/10 trích resolver ra helper và thêm regression tests cho đường render này; không đổi nội dung giao diện.

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

**Còn cần thao tác ngoài source:** rotate key gateway AI đã từng nằm trong git history; cài systemd backup timer trên VPS; cung cấp EAS project ID thật để bật push. Lúc chạy các check local chưa migrate/deploy production; kết quả lần push sau được ghi ở mục 12. `P3-7` vẫn là khuyến nghị kiến trúc; `P3-26` đã đóng bằng cách xóa helper mobile chết và cập nhật test/docs; `P3-29` là kết luận không đúng với renderer storefront hiện tại, như đã giải thích ở trên.

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

## 14. POS: khôi phục khi mất phản hồi (đã xác minh trên shop QA production)

- **Trạng thái cập nhật 2026-10-30:** commit POS `99ada1b` nằm trong commit production `2fd1265`; lần triển khai #163 được ghi nhận thành công, trang chủ và `/api/health` trả HTTP 200. POS đã được kiểm thử API thật bằng một fixture chưa thanh toán trên shop QA production bên dưới. Các dòng lịch sử “chưa deploy” chỉ đúng tại thời điểm được ghi. Chưa truy vấn trực tiếp `schema_migrations` để xác nhận trạng thái của `20261029000400_orders_pos_idempotency_prefix_unique.sql`.
- **Kiểm thử hồi quy cập nhật:** AGY Flash chạy test IndexedDB 7/7 và test Chrome hai tab 5/5 lần liên tiếp trên fixture tổng hợp cục bộ; Codex chạy độc lập lại 7/7 và 1/1. Working tree không đổi sau lượt AGY. Bằng chứng chỉ áp dụng cho các test local này, không chứng minh production E2E hoặc thiết bị/trình duyệt khác.
- **Production QA 2026-10-30 — retry sau mất phản hồi:** Codex dùng phiên owner QA và VietQR để tạo đúng một đơn unpaid. Playwright route chỉ giả lập 504 sau khi POST đầu đã trả thành công từ production; nút retry gửi lại body byte-identical với cùng `idempotency_key`, `source=counter_pos`, `payment_status=unpaid`. Network log có đúng hai POST: 504 ở trình duyệt rồi 201 khi retry; UI/API read-back chỉ có một fixture mới, không tạo đơn thứ hai. Codex hủy fixture đó bằng lý do QA; PATCH trả 200 với `status=cancelled`, `payment_status=unpaid`, `waste_recorded=false`; AGY Flash xác minh read-only cùng request/status/body và trạng thái cuối. Fixture vẫn nằm trong lịch sử hủy; active queue trở về số trước lượt test và paid total vẫn 0. Không sửa đơn cũ hoặc thu tiền. Đây là một lượt trên shop QA/browser hiện tại, chưa phải kiểm thử ma trận trình duyệt/thiết bị; số tồn kho không được đọc đối chiếu riêng.

- Bản working tree ban đầu bổ sung lưu yêu cầu POS trước khi gửi, thử lại cùng nội dung theo thao tác người dùng, đối chiếu khóa ở server và migration local ràng buộc khóa khi có yêu cầu đồng thời; tại thời điểm đó chưa commit, triển khai hay chạy migration trên production.
- Codex chạy kiểm thử tập trung: 6/6 bài POS, 9/9 bài SQL và typecheck thành công; lint các file liên quan không có lỗi, còn 3 cảnh báo ảnh. AGY Flash tạo `tests/pos-browser-recovery.test.mjs`; Codex chạy lại thành công trên Chrome với component POS thật và server giả lập: phản hồi 504 sau khi ghi, reload không gửi lại, thử lại cùng payload/khóa, một đơn trong fixture, ngữ cảnh tài khoản và lựa chọn in. Đây không phải kiểm thử API/database thật hoặc production.
- Chạy lại toàn bộ `npm run test:review` trên working tree hiện tại: 356/356 đạt, không có bài bỏ qua. Kết quả này không thay thế kiểm thử trên production.
- `npm run build` trên working tree hiện tại hoàn tất thành công; Next.js in cảnh báo lint, không báo lỗi build.
- AGY Flash tái hiện trong Chrome tình huống tab POS thứ hai giữ trạng thái đơn chờ cũ sau khi tab thứ nhất xác nhận và xóa yêu cầu. POS giờ theo dõi thay đổi storage đúng tài khoản/quán; test Chrome hai tab xác nhận tab thứ hai nhận trạng thái chờ, được mở lại sau khi tab đầu xong và gửi giỏ hàng riêng. Codex chạy hai test browser 2/2, typecheck và build đạt sau sửa. Test này không chứng minh loại bỏ mọi race ghi đồng thời giữa các tab hoặc thiết bị.
- Kiểm thử mô phỏng xen kẽ thao tác `getItem`/`setItem` cho thấy hai lời gọi `savePendingPosOrder` có thể cùng báo thành công nhưng chỉ lưu lại một yêu cầu. POS đã bổ sung Web Locks cho thao tác lưu/xóa cùng tài khoản/quán; trình duyệt không hỗ trợ khóa sẽ chặn thao tác an toàn. Kiểm thử giả lập khóa 4/4, browser 2/2 và typecheck đạt. Test Chrome hai tab dùng rào khóa để cả hai bắt đầu trước khi được phép ghi, xác nhận một đơn chờ không bị ghi đè và giỏ còn lại được giữ; chưa xác minh trên các trình duyệt/thiết bị mục tiêu. Chưa deploy ở thời điểm ghi nhận.
- **Cập nhật quan trọng tại thời điểm đó:** trong 5 lần chạy liên tiếp test Chrome hai tab với rào khóa, 3 lần thất bại: server fixture nhận hai POST cho hai giỏ khác nhau khi yêu cầu đầu còn chờ. Kết quả pass trước đó không ổn định; không coi Web Locks kết hợp `localStorage` hiện tại là đủ an toàn. Khi đó đang thay cơ chế lưu bằng giao dịch IndexedDB và dự định kiểm thử lặp lại trước commit/deploy. Không có thay đổi production ở lượt đó.
- Claude CLI được gọi trực tiếp để phản biện thiết kế IndexedDB. Các điểm phải xác minh khi nhận mã: chờ `transaction.oncomplete` trước khi gửi mạng, thử lại với cùng khóa, xử lý giao dịch abort/quota và đổi tài khoản/quán, cùng thử lại đồng thời không xóa yêu cầu khác. Đây là phân tích thiết kế, chưa phải kết quả kiểm thử mã.
- AGY Argon đã chuyển slot đơn chờ sang giao dịch IndexedDB; Codex kiểm tra mã xác nhận chỉ trả kết quả lưu sau `transaction.oncomplete`, tự sửa trường hợp dữ liệu legacy và IndexedDB xung đột để không xóa nhầm. Test recovery 7/7, browser 2/2, typecheck đạt; test Chrome hai tab lặp độc lập 5/5 đạt sau sửa. Tại thời điểm ghi nhận, chưa kiểm thử thiết bị mục tiêu hoặc production và POS chưa deploy.
- Kiểm tra bổ sung: nếu truy cập `window.indexedDB` ném lỗi, POS hiển thị cảnh báo thay vì gửi đơn; xác minh bằng Chrome với getter giả lập lỗi. Hai test browser và typecheck chạy lại đạt sau sửa; dữ liệu chờ cũ/mới xung đột được giữ lại và chặn gửi.
- Commit `99ada1b` chứa sửa POS, migration và test. Trước commit, build thành công và `npm run test:review` đạt 360/360; lúc đó chưa push/deploy vì migration `20261028000300` còn bị chặn bởi mã đơn trùng production. File báo cáo lúc ấy là thay đổi working tree riêng; trạng thái triển khai mới nhất được ghi ở đầu mục này.
- Claude CLI được gọi trực tiếp để phân tích thiết kế. Nhận định của Claude là khuyến nghị, không phải bằng chứng đã đọc source: code hiện dùng RPC `commit_order_with_inventory`, canonical JSON và hash khóa theo tài khoản/quán. Rủi ro dữ liệu chờ bị mất khỏi trình duyệt, nhiều tab/thiết bị tạo các khóa khác nhau, và triển khai migration trên production vẫn cần kiểm tra hoặc phương án vận hành; không khẳng định đã giải quyết các trường hợp đó.
- Tại thời điểm này, chưa triển khai vì migration `20261028000300` còn bị chặn bởi mã đơn trùng; việc đối soát và sửa production khi đó chưa được cho phép ngoài truy vấn chỉ đọc. Sau đó người dùng đã cho phép đối soát/sửa mã trùng; trạng thái deploy mới nhất nằm ở đầu mục này. Báo cáo hiện không có bằng chứng đủ để mô tả từng row production đã được đổi thế nào.
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
- **P2-12 audit follow-up 2026-10-31 — đã sửa:** audit đơn không còn ghi JSONL thêm khi DB insert thành công; JSONL chỉ dùng khi DB chưa cấu hình hoặc ghi DB thất bại, vẫn giữ mode `0600`, giới hạn xoay vòng và không làm mutation đã commit trả lỗi. PATCH lặp lại không đổi persisted business state không tạo audit mới cho `service_request`, thu tiền đơn đã trả, hoặc `update_order_status` Super Admin; admin no-op cũng không tạo `admin_audit_logs` row. So sánh bỏ qua top-level `updated_at`, chuẩn hóa timestamp thật (`*_at`) giữa `Date` và ISO string nhưng giữ nguyên so sánh văn bản ghi chú/lý do.
  - Regression thêm vào `tests/order-audit-review.test.ts` cho service-request replay, paid-payment replay, admin cancel/refund replay, DB-success không ghi JSONL, DB-failure vẫn fallback và mode `0600`. Test POS idempotency đổi sang đếm row trong DB và khẳng định không tạo JSONL trùng.
  - AGY Claude Sonnet 5.5 High triển khai theo task hẹp; quota snapshot trước run: Gemini 5% tuần, Claude/GPT 95% tuần. Codex rà diff độc lập; lượt review đầu bắt gặp assertion POS cũ còn kỳ vọng JSONL sau DB success và đã sửa assertion trước khi xác nhận suite cuối.
  - CodeGraph: `status`; `explore` cho service-request/order/admin replay và audit; `node` cho `recordOrderAuditLog`, `dbUpdateOrderStatus`, các PATCH route, helper replay và test audit/POS. Vùng ảnh hưởng: ba route PATCH, writer audit dùng chung, hai bộ test audit/POS; không đổi schema, quyền, subject/FK hoặc RPC.
  - Codex chạy: `npm run test:review` **391/391**; `npm run test:unit` **142/142**; `npm run test:sql` **13/13**; `npm run typecheck` đạt; `npm run lint` 0 lỗi, 41 cảnh báo sẵn có; ESLint các file thay đổi 0 lỗi; `npm run build` đạt, 41 route; `git diff --check` đạt. Production permission-only fix: `admin-audit.log.jsonl` đổi từ `0644` sang `0600`, giữ nguyên nội dung; sau deploy xác nhận lại `0600`.
  - Push/deploy follow-up: commit `67ea6bfdf88b6cbbd8ab483d83b67a74f40a6b04`; GitHub Actions run `41136965855` hoàn tất `success` cho verify và deploy. Workflow reset VPS đúng SHA, build/restart PM2 và xác nhận PostgreSQL triggers, Garage, health, order realtime; smoke bên ngoài xác nhận `/` và `/api/health` đều HTTP 200.

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

## 35. Production QA tồn kho nhanh qua UI (2026-10-30)

- Codex dùng Playwright trên shop QA, tạo một fixture món và thử tồn kho `null → 2 → 1 → 0 → 5 → null → 20`. Mỗi lần lưu gửi `expected_stock_quantity` đúng giá trị trước đó; sau GET, tồn kho khớp. Tồn kho bằng 0 tự chuyển món sang hết hàng; chuyển lên 5 khôi phục còn hàng; `null` được hiển thị là không giới hạn. Tắt/bật còn hàng giữ nguyên tồn kho 20, payload trạng thái không ghi đè tồn kho.
- Sau reload, API vẫn trả fixture với tồn kho 20/đang bán. Codex xóa đúng fixture trong dialog xác nhận của UI; DELETE trả 200. Reload và GET cuối xác nhận fixture vắng mặt, còn đúng một category và một item; hash SHA-256 của ID category, ID món gốc và liên kết món-category đều trùng baseline trước QA. Không chỉnh sửa món gốc; không tạo đơn hoặc thanh toán.
- Có một lỗi tải tài nguyên mạng trong console và một request GET ảnh lưu trữ trả 402 trong phiên; chưa chứng minh chúng là cùng một lỗi hay xác định nguyên nhân. Không thấy TypeError hoặc lỗi uncaught trong log console đã lược dữ liệu.
- Đây là QA một fixture trên production, không kiểm thử hai người cập nhật đồng thời, trừ kho qua đơn hàng, storefront/mobile hoặc quyền nhân viên. AGY Flash đã được khởi chạy nhưng bị ngắt trước khi thực hiện thao tác trình duyệt; không tính kết quả AGY là PASS. Không sửa source nên không chạy test/build.
- CodeGraph: `codegraph status`; explore `catalog page delete item handler confirm modal QuickItemRow onDelete`; query `onDelete`; node `src/app/(dashboard)/dashboard/catalog/page.tsx` quanh `handleUpdateStock`/`handleDeleteItem`. Khu vực ảnh hưởng: `QuickItemRow`, handler catalog chủ quán và API catalog. Evidence tổng hợp đã lược dữ liệu tại `.agy-runs/catalog-stock-production-qa.md` (ignored).

## 36. Production QA menu công khai và giỏ hàng — AGY Flash + Codex (2026-10-30)

- AGY Flash kiểm tra hai trang storefront công khai của shop QA: cửa và menu đều trả 200; UI và `GET /api/catalog` cùng có 1 category/1 item. `GET /api/shops?slug=...&view=menu` trả 200; `GET /api/catalog` thiếu `shopId` trả 400 `SHOP_ID_REQUIRED`. AGY mở/đóng chi tiết món, thêm món vào giỏ, xác nhận thanh giỏ xuất hiện, tăng/giảm số lượng, xóa món và reload với giỏ rỗng. Không gửi đơn, thanh toán hoặc yêu cầu dịch vụ.
- AGY ghi nhận 4 POST telemetry tự phát tới `/api/analytics/track` trả 201 (`scan_table`/`item_view`); không thấy mutation nghiệp vụ. Chỉ có tiếng Việt được bật ở shop nên dropdown mở được nhưng không thể thử chuyển locale sang EN. Dataset một món/một category cũng không cho kiểm tra lọc chéo category hay giỏ nhiều món. Console AGY: 0 lỗi/cảnh báo.
- Codex kiểm chứng độc lập: cửa/menu HTTP 200; API shop trả đúng slug, catalog API trả 200 với 1 category/1 item, thiếu `shopId` trả 400. Playwright riêng tái hiện thêm vào giỏ, mở drawer, tăng rồi giảm số lượng về 0, đóng drawer và reload; cart bar không còn. Phiên có 5 GET và 2 POST, cả hai POST đều là `/api/analytics/track` trả 201; không có POST orders, payment, service request hoặc mutation khác. Console riêng: 0 lỗi/cảnh báo. Hai telemetry POST trong phiên Codex là kết quả tự động của page/item interaction, không được xóa.
- Đây là kiểm tra storefront công khai, không dùng phiên owner hoặc credentials; không coi luồng checkout, tạo đơn, lựa chọn tiếng Anh, đa category hay nhiều món là đã QA. Evidence tổng hợp của AGY đã lược dữ liệu tại `.agy-runs/storefront-menu-production-qa-2026-10-30.md` (ignored). AGY run `2026-10-30T02-19-20-424Z-bd19fc15` kết thúc `SUCCESS`, 0 tracked-file changes.
- CodeGraph trước QA: `codegraph status`; explore `public storefront menu page catalog categories search language switch product detail cart API request endpoints`. Chỉ kiểm tra UI/API, không sửa source nên không chạy test/build.

## 37. P2-11: cài timer backup PostgreSQL tự host trên production (2026-10-30)

- Thêm `scripts/install-self-hosted-postgres-backup.mjs`; workflow deploy gọi installer bằng `sudo -n` trước mọi migration. Installer chỉ đọc khóa `QLAOK_DB_NAME` từ `.env.local`; khi khóa không có, dùng fallback `qlaok` giống `scripts/migrate-self-hosted.mjs`. Giá trị khác định dạng, trùng khóa hoặc cấu hình backup hiện có không khớp đều dừng deploy; cấu hình hợp lệ được giữ nguyên. Installer cài service/timer với quyền thư mục backup `postgres:postgres` `0700`, file env `root:postgres` `0640`, archive `0600`, giữ nguyên systemd hardening và cho phép service chạy tối đa 35 phút.
- Lần cài đầu chạy backup qua service, đợi `pg_restore --list` xác nhận archive rồi mới ghi marker một lần và bật timer. Các deploy kế tiếp xác nhận marker, timer enabled/active và không chạy lại full dump. Backup ban đầu lỗi sẽ dừng workflow trước migration; SSH command timeout tăng lên 40 phút để không cắt một backup lớn giữa chừng.
- Thêm test installer cho tạo/giữ cấu hình, cấu hình xung đột hoặc sai, fallback database trùng với migration, backup lỗi không tạo marker, không bật timer trước khi backup thành công, không đọc toàn bộ `.env.local`, quyền file/thư mục, và thứ tự installer trước migration. Đưa test vào `npm run test:backup`; cập nhật runbook khôi phục.
- CI/deploy run `40993327750` (SHA `39b59aff5fef9dbbf29cea7a865d10a53c8ca4b1`) dừng an toàn trước migration vì `.env.local` production không khai báo `QLAOK_DB_NAME`. CodeGraph xác nhận migration dùng fallback `qlaok`; sửa installer để theo đúng fallback hiện hữu. Run `40993641752` (SHA `c0679bbee4e5fa6d29681c0b090fc85a21982132`) chạy thành công: log deploy xác nhận “initial backup verified”, migration hoàn tất (32 đã áp dụng, 0 migration mới), app deploy thành công. Installer kiểm tra `systemctl is-enabled` và `is-active` đều thành công.
- Commit cuối `592e0a4c2c3772685abf40f8fd462ae845637c92` tăng SSH `command_timeout` lên 40 phút. Run `40994143198` trên đúng SHA này hoàn tất cả verify và deploy; log xác nhận marker backup ban đầu đã có, timer cài/active, migration và deploy đều thành công. Các lần deploy sau không tạo dump ban đầu lần nữa.
- Kiểm tra độc lập local: `npm run test:backup` 25/25; `node --check` hai file mới và `git diff --check` đạt. CI trên run cuối cũng qua typecheck web/mobile, unit/review/sql/DB-reset/mobile tests và build.
- CodeGraph: `codegraph status/sync`; explore/nodes cho `runSelfHostedPostgresBackup`, `parseSelfHostedBackupConfig`, `runPsql`, `readRuntimeDatabaseName`, installer và migration/deploy ordering. Vùng ảnh hưởng: deploy workflow, systemd backup service, helper installer, package test script và runbook. Chưa diễn tập khôi phục archive trên database tạm và chưa chờ chu kỳ timer chạy tự động. Bổ sung production QA chỉ đọc về dữ liệu: trước khi chạy, còn 28 GB trống và một archive `0600`; Codex trigger đúng systemd service hiện có một lần, service trả `Result=success`/exit `0`, `pg_restore --list` thành công, xuất hiện archive thứ hai mode `0600`, timer vẫn active và có lịch chạy kế tiếp. Không sửa DB hay tải archive khỏi VPS.

## 38. Follow-up production QA báo giá storefront (2026-10-30)

- AGY Flash kiểm tra UI giỏ hàng và quote API của shop QA trên production. Catalog tải `200`, có 1 category/1 item; giỏ hiển thị subtotal/total `150.000đ`. `POST /api/orders` với `action: "quote"` trả `200`, subtotal `150000`, discount `0`, total `150000`; trường hợp quote thiếu `shop_id` trả `400` với lỗi thiếu mã cửa hàng. UI và quote server khớp.
- Codex xác minh độc lập: directory `GET /api/shops` `200`, catalog `GET /api/catalog?shopId=...` `200` (1 category/1 item), quote API `200` (150000/0/150000), missing-shop validation `400`; tổng UI trong report AGY khớp quote. AGY dọn giỏ về rỗng và ghi nhận 0 console error.
- Không submit đơn, thanh toán, yêu cầu dịch vụ, in phiếu hoặc sửa catalog/cấu hình. Chỉ có telemetry analytics tự động khi mở storefront; không xóa telemetry. Do không có source change nên không chạy test/build.
- Phạm vi chưa QA: submit đơn thật, thanh toán, nhiều món/nhiều category. Evidence đã lược shop ID/slug/account tại `.agy-runs/storefront-checkout-quote-qa-2026-10-30.md`; AGY run `2026-10-30T03-06-12-424Z-ff945ba7`. CodeGraph queries: `storefront checkout submit order public menu cart create order API order flow`, `quoteOrderPricing action quote POST /api/orders pricing discounts items server authoritative`, `GET src/app/api/shops/route.ts public list`, `GET src/app/api/catalog/route.ts public catalog`.
- Follow-up P2-11 runtime: SSH với strict host-key checking xác nhận timer `enabled` và `active`; lịch kế tiếp do systemd báo `2026-10-31 03:18:24 CST`. Journal xác nhận initial service đã chạy thành công và `pg_restore --list` verify archive `316353 bytes` (log lúc `2026-10-30 10:50:11`). Lịch timer chưa tới kỳ chạy tự động; restore drill trên database tạm vẫn còn mở.

## 39. Storefront search không có empty state (2026-10-30)

- Production UI QA trước sửa: AGY Flash và Codex đều tìm đúng 1 món; truy vấn không khớp làm danh sách còn 0 món; nút xóa khôi phục lại đúng 1 món. Nhưng tất cả category biến mất mà không có thông báo. AGY ghi nhận 83 request đều là GET, 0 request mutation và 0 console error; Codex lặp lại độc lập luồng UI và cũng thấy trạng thái rỗng không có lời giải thích.
- Sửa `VerticalRenderer` để hiện thông báo `role="status"` chỉ khi query không rỗng và không còn kết quả trong category đang chọn. Có màu nền/chữ cho cả light và dark theme. Bổ sung `noSearchResults` cho đủ 8 locale (`vi`, `en`, `ko`, `ja`, `zh`, `es`, `it`, `ru`) và mở rộng test locale hiện có.
- Kiểm tra local: `npm run test:unit` đạt 134/134; `npm run typecheck` và `git diff --check` đạt. AGY Flash review đúng ba file, không tìm thấy lỗi; report sanitized tại `.agy-runs/no-search-results-review-2026-10-30.md`. Production UI đã xác nhận lỗi gốc; sau deploy, Codex xác nhận trên SHA `e4259865e75a58737f7ce5a67886e834ef9e1bcd` thông báo không kết quả có `role="status"`, nút xóa làm rỗng ô tìm kiếm và khôi phục lại sản phẩm gốc.
- CodeGraph: explore `VerticalRenderer storefront menu search input state setSearchQuery`; node `src/components/storefront/VerticalRenderer.tsx`, `src/lib/i18n-helper.ts` và `tests/unit.test.ts`; khu vực ảnh hưởng: danh sách món storefront, bộ nhãn i18n và kiểm tra locale. Không có thay đổi API, DB, giỏ hàng hay đơn hàng.

## 40. Follow-up sau deploy: search storefront, restore drill và QA nhiều danh mục (2026-10-30)

- GitHub Actions run `40997550766` trên đúng SHA `e4259865e75a58737f7ce5a67886e834ef9e1bcd` kết thúc `success`; cả verify và deploy thành công. Codex kiểm tra storefront production: truy vấn không khớp hiện thông báo tiếng Việt với `role="status"`; nút xóa trả ô tìm kiếm về rỗng và khôi phục đúng 1 sản phẩm. Không gửi đơn, thanh toán hoặc sửa dữ liệu danh mục.
- Diễn tập restore cục bộ trên PostgreSQL 14 cô lập, tắt TCP: tạo archive custom-format chỉ từ một bảng và một hàng dữ liệu tổng hợp; `pg_restore --list` thành công; restore sang database tạm bằng `--exit-on-error --no-owner --no-acl`; đối chiếu hàng khôi phục chính xác. Đã dừng server và xóa thư mục tạm. Không đọc hoặc sao chép backup production; đây chưa phải kiểm tra archive production trên staging.
- Follow-up nhiều category/món: AGY Flash run `2026-10-30T03-53-32-757Z-b4ec5efa` đã tạo qua dashboard một danh mục và hai món fixture, xác nhận save/reload, bộ lọc All/category trên dashboard và menu public, rồi xóa fixture qua UI. Evidence của AGY ghi số ID danh mục/món sau cleanup trùng baseline. Codex kiểm tra độc lập sau cleanup: `GET /api/catalog` trả `200`, dashboard có 1 danh mục/1 món; menu public có 1 section/1 thẻ món và không còn fixture. Event log ghi 110 lần gọi Playwright CLI, vượt giới hạn `<25` mà evidence ban đầu tuyên bố; đã sửa artifact để phản ánh đúng. Codex chỉ xác minh độc lập trạng thái cuối theo counts/UI, chưa lưu ID baseline vào artifact để đối chiếu lại. Có một asset tĩnh CDN trả `402`; không thấy lỗi runtime ứng dụng trong log AGY. Evidence đã lược thông tin tại `.agy-runs/storefront-multicategory-qa-evidence-2026-10-30-retry.md`. Không có sửa source code trong lượt QA này.
- P2-11: timer production đã `enabled`/`active`, backup khởi tạo được `pg_restore --list` xác nhận ở mục 38; chu kỳ định kỳ tiếp theo lúc kiểm tra là `2026-10-31 03:18:24 CST`. Chưa xác nhận chu kỳ tự chạy sau giờ này; chưa restore archive production trên staging riêng.
- Còn thao tác ngoài source: chủ tài khoản/provider cần rotate AI gateway key đã từng có trong git history và cung cấp EAS project ID thật để bật push (P3-27). Không đoán hoặc tự tạo ID.

## 41. Follow-up QA nhập tay bộ lọc ngày báo cáo (2026-10-30)

- Claude CLI rà tĩnh và xác nhận controls `single_day`/`custom_range` có nối state; CodeGraph truy vấn `computeEffectiveDateBounds`, `filterReportOrders`, `OrdersReportAndExportPage` và các đoạn date-control/API liên quan. Không phát hiện lỗi source trong luồng này.
- AGY Flash run `2026-10-30T04-10-12-789Z-cc0bd084` đã thao tác chọn một ngày, khoảng ngày thường/đảo ngược, rồi khôi phục preset hôm nay. AGY chọn `2026-10-25`–`2026-10-30`, vốn không có đơn; Codex đối chiếu đúng shop QA qua `GET /api/orders` (`200`): 3 đơn tổng, 2 đơn hợp lệ ngày `2026-10-24`. UI chọn ngày `2026-10-24` hiện 2 đơn; khoảng `2026-10-24`–`2026-10-25` và đảo đầu mút đều hiện 2, khớp aggregate API. Khôi phục “Hôm nay” về 0 đơn và gỡ date inputs khỏi DOM.
- Không có request ghi dữ liệu. Không xuất dữ liệu đơn hoặc thông tin khách. Codex đã thấy evidence AGY không chứng minh lọc trên ngày có dữ liệu và event log ghi 22 lần gọi Playwright CLI, vượt giới hạn 8 của task; sửa artifact local để phản ánh đúng, không giữ tuyên bố sai của AGY rằng chỉ gọi 8 lần. Không có source change.
- Evidence đã lược dữ liệu tại `.agy-runs/report-date-range-qa-2026-10-30.md`. Run dùng `gemini-3.8-flash-low`; phần kiểm chứng khớp aggregate API do Codex thực hiện độc lập.

## 42. QA lọc khu vực có bàn trên sơ đồ QR Studio (2026-10-30)

- AGY Flash tạo đúng một fixture cô lập trên shop QA qua UI QR Studio. Sau reload, API có 2 bàn đang hoạt động; lọc khu vực fixture hiển thị 1 bàn/1 marker, “Tất cả” hiển thị 2 marker. AGY archive fixture qua UI (`PATCH`), và báo API fixture là archived/inactive; nó cũng báo tập ID bàn hoạt động sau cleanup khớp baseline giữ trong bộ nhớ.
- Codex đọc lại độc lập, không ghi dữ liệu: `GET /api/tables/floor-plan` trả `200` với 1 bàn; `GET /api/tables?includeInactive=1&includeArchived=1` trả `200` với 7 bàn, gồm 1 active và 6 archived/inactive; bộ lọc UI ở `ALL` với 3 lựa chọn. Aggregate khớp baseline 1 active/5 archived cộng fixture đã archive. Codex không giữ tập ID ban đầu nên chưa thể tự đối chiếu ID; cũng không đếm marker độc lập sau cleanup.
- Event log ghi 4 lần gọi wrapper Playwright và 6 lệnh Playwright `npx` trực tiếp (10 browser-command events); claim trước của AGY “9 wrapper calls” sai. Số wrapper thực tế là 4, trong giới hạn 10. Một `POST` tạo fixture và một `PATCH` archive; không gọi `DELETE`, không thấy thao tác lên entity khác.
- CodeGraph trước khi đọc source: `codegraph status`; query `ShopTableManager`; explore `dashboard floor plan table map selectedArea area filter create archive table API /api/tables`; node `dbCreateShopTable`, `dbUpdateShopTable`, `ShopTableManager.tsx` và `src/app/api/tables/route.ts`. Khu vực ảnh hưởng: QR Studio, API quản lý bàn và bộ lọc floor plan. Không sửa source nên không chạy test/build; bằng chứng đã lược dữ liệu ở `.agy-runs/table-area-positive-filter-qa-2026-10-30.md` (ignored).

## 43. P1-4: POS giữ giảm giá khi lưu sửa đơn — production QA (2026-10-30)

- Claude CLI gọi trực tiếp theo cấu hình gateway `deepseek`; CLI in cảnh báo `unrecognized_model` nhưng vẫn trả nội dung review. Nhận xét không tìm thấy lỗi trực tiếp trong client/helper, đồng thời chỉ ra test helper chưa tự chứng minh dữ liệu được lưu qua API. Codex dùng CodeGraph kiểm tra `loadOrderIntoPos`, `buildPosOrderDiscountPayload`, `PATCH /api/orders` và `dbUpdateOrderStatus`: khi POS gửi `apply_shop_promotions=false`, route/store giữ lại promotion đã ghi trên đơn và tính riêng manual discount.
- Test tập trung `node --experimental-strip-types --import ./tests/register-ts.mjs --import ./tests/tsx-review-loader.mjs --test tests/pos-order-discounts-review.test.ts` đạt 5/5, gồm promo-only, manual-only, mixed discount, dữ liệu legacy và promo đã hết hạn.
- AGY Flash (`gemini-3.8-flash-low`; run `2026-10-30T05-13-00-681Z-56b85a96`; snapshot quota trước chạy: Gemini weekly còn 7%) xác nhận shop QA trước khi ghi. Tạo đúng một đơn POS VietQR unpaid với subtotal 150.000đ, giảm tay 15.000đ và total 135.000đ; mở `Sửa đơn`, không đổi món/giảm giá, lưu một lần. PATCH trả 200; read-back của AGY xác nhận discount 15.000đ, total 135.000đ, đơn vẫn unpaid.
- AGY hủy đúng fixture qua UI với lý do QA; PATCH trả 200. Codex tự đọc lại production qua phiên browser hiện có: GET trả 200, tìm đúng một fixture theo lý do, trạng thái `cancelled`/`unpaid`, discount 15.000đ, total 135.000đ, `waste_recorded=false`; tổng đơn active trở về baseline 1, paid vẫn 0, tồn kho `null` và availability vẫn true. Không sửa đơn có sẵn hoặc thu tiền.
- Evidence đã lược dữ liệu tại `.agy-runs/pos-discount-roundtrip-production-qa-2026-10-30.md`. AGY ghi nhận 3 mutation đúng phạm vi fixture (1 POST, 2 PATCH), không có source change. Codex xác minh độc lập trạng thái cuối; đối chiếu trước/sau lần edit dựa trên request/read-back được ghi trong artifact AGY. Coverage production chỉ là một shop/browser và giảm tay; promo/mixed chỉ được bao phủ bởi test cục bộ.
- Token telemetry của AGY run (raw, tách cache): `input_tokens=562777`, `output_tokens=11396`, `thinking_tokens=0`, `cache_read_tokens=6163824`, `total_tokens=574173`; thời gian khoảng 410 giây. Không dùng kết quả này để suy ra phần trăm quota.

## 44. P1-6 follow-up: admin ghi nhận hoàn tiền rồi hủy đơn (2026-10-30)

- Kiểm tra lại chuỗi CodeGraph từ `/admin` tới `POST /api/admin` và `dbUpdateOrderStatus`: backend đã buộc hủy đơn đã trả phải kèm `payment_status: 'refunded'`, `refund_reason` và `cancelled_reason`; thao tác hoàn tất vẫn chỉ đổi fulfillment. Khoảng trống còn lại là admin UI ẩn nút hủy với đơn đã trả nên không có đường ghi nhận hoàn tiền hợp lệ.
- Thêm nút riêng “Ghi nhận hoàn & hủy” cho đơn paid chưa hủy. UI hỏi hai lý do riêng, xác nhận số tiền trước khi gửi và nói rõ phải hoàn tiền thực tế trước; Qlaok chỉ ghi trạng thái, không chuyển tiền. Payload helper chỉ thêm trạng thái `refunded` cho đơn paid và vẫn giới hạn mỗi lý do ở 500 ký tự; hủy đơn unpaid/refunded không sửa payment state.
- Regression: `tests/admin-order-actions-review.test.ts` kiểm payload unpaid/paid, thiếu lý do, giới hạn độ dài, xác nhận UI và action hoàn tất chỉ gửi trạng thái. Cùng `tests/order-review.test.ts` và `tests/order-audit-review.test.ts`: 8/8 pass. `npm run typecheck`, ESLint ba file thay đổi, `npm run build` (41 route) và `git diff --check` đều đạt; build có các cảnh báo ảnh/hook sẵn có ngoài file sửa.
- CodeGraph queries: `codegraph explore "runAdminAction in src/app/(admin)/admin/page.tsx; paid order cancel button rendering; admin update_order_status payload construction"`; `codegraph node 'src/app/(admin)/admin/page.tsx' --offset 1138 --limit 72`; `codegraph node 'src/app/api/admin/route.ts' --offset 744 --limit 110`; `codegraph node 'src/lib/mpos-store.ts' --offset 2570 --limit 42`; `codegraph node 'src/app/(admin)/admin/page.tsx' --offset 1029 --limit 42`. Khu vực ảnh hưởng: Super Admin order quick actions và pure payload helper; API, store, SQL và schema không đổi.
- AGY Argon run `2026-10-30T05-33-23-361Z-21d9e2c0` lặp lại CodeGraph tracing mà không sửa file; Codex đã dừng run và hoàn tất diff nhỏ trực tiếp, rồi chạy lại các kiểm tra nêu trên.
- Chưa kiểm tra thao tác qua Super Admin browser session hoặc đơn paid thật trên production; việc ghi nhận hoàn tiền ngoài Qlaok phải hoàn tất trước thao tác.

## 45. Storefront khách đặt và tự hủy đơn — production QA (2026-10-30)

- AGY Flash run `2026-10-30T05-49-48-753Z-5004623b` thao tác đúng một luồng khách takeaway trên shop QA: thêm một món số lượng 1, xác nhận quote 150.000đ, gửi một đơn mới chưa thanh toán rồi tự hủy trước khi shop nhận. Network ghi đúng một `POST /api/orders` HTTP 201 và một `PATCH /api/orders` HTTP 200; không có thanh toán hay mutation dịch vụ/in ấn.
- Codex xác minh độc lập trên production bằng `GET /api/orders?orderId=…` kèm tracking token chỉ của fixture: HTTP 200, đúng đơn `cancelled/unpaid`, tổng tiền khớp quote, một dòng món số lượng 1 và marker QA khớp. `GET /api/catalog?shopId=…` cũng trả 200; món vẫn khả dụng và `stock_quantity` vẫn `null` như baseline tồn kho không giới hạn.
- Không có dữ liệu đơn có sẵn bị sửa; tracker khách được đóng và localStorage entry của fixture được dọn. Không phát sinh thanh toán. Context tạm có tracking token đã bị xóa sau khi Codex read-back; chỉ giữ báo cáo đã lược dữ liệu tại `.agy-runs/storefront-checkout-submit-qa-2026-10-30.md` (ignored).
- CodeGraph: `codegraph node src/app/api/orders/route.ts --offset 81 --limit 150`; `codegraph node src/app/api/orders/route.ts --offset 772 --limit 130`; `codegraph node src/app/api/catalog/route.ts --offset 180 --limit 90`. Khu vực đã kiểm tra: public guest tracking GET, guest pre-acceptance cancellation PATCH và catalog GET. Không sửa source nên không chạy test/build.
- Chưa kiểm tra dine-in với chữ ký QR bàn, thanh toán thực tế, hoặc đặt nhiều món/nhiều danh mục; các phần đó vẫn còn ngoài coverage của lượt này.

## 46. Storefront checkout nhiều món, nhiều danh mục — production QA (2026-10-30)

- Baseline shop QA `test shop 1` có 1 category/1 dịch vụ khả dụng. Codex dùng owner dashboard UI tạo đúng 1 category và 1 dịch vụ fixture giá 25.000đ, tồn kho không giới hạn; reload dashboard và public menu xác nhận lưu thành công, có 2 dịch vụ thuộc 2 category. Không sửa dữ liệu baseline.
- Guest storefront thêm đúng 1 dịch vụ baseline giá 150.000đ và 1 dịch vụ fixture giá 25.000đ; giỏ hiển thị hai dòng từ hai category, mỗi dòng quantity 1. `POST /api/orders` với `action: quote` trả 200, subtotal 175.000đ, discount 0đ, total 175.000đ, khớp UI.
- Gửi đúng một đơn có marker QA: `POST /api/orders` trả 201, `new/unpaid`, hai dòng và tổng 175.000đ. Hủy ngay qua guest tracker trước khi quầy nhận: `PATCH /api/orders` trả 200. Codex đọc lại độc lập bằng tracking token của fixture: GET 200, `cancelled/unpaid`, hai dòng, marker và total khớp. Không thanh toán; tồn kho baseline vẫn unlimited/khả dụng.
- Xóa riêng fixture item và category qua dashboard UI. API catalog sau cleanup trả 200 với đúng 1 category/1 item baseline, ID dịch vụ gốc và quan hệ category giữ nguyên; public menu không còn fixture. Đơn test vẫn đọc được ở trạng thái `cancelled/unpaid`. Đã đóng tracker, xóa capture/context chứa token, và đăng xuất QA account.
- AGY Flash được thử hai lần nhưng cả hai lần dừng trong bước dò source/docs, trước khi mở browser hoặc ghi dữ liệu; không tính là bằng chứng QA của AGY. Codex hoàn tất lượt này bằng Playwright CLI trực tiếp sau khi xác nhận catalog và đăng nhập đúng QA account. Không sửa source nên không chạy test/build.
- Console có 1 lỗi tải ảnh từ Supabase Storage HTTP 402 và 0 warning; không thấy lỗi runtime trong luồng checkout. Đây là asset bên ngoài, không được tính là lỗi quote/order.
- CodeGraph: `codegraph explore "ShowToStaffModal cart items quantity subtotal guest submit; VerticalRenderer add item to cart"`; `codegraph node src/app/api/orders/route.ts --offset 304 --limit 140`; `codegraph node quoteOrderPricing`; `codegraph node OrderLineItem src/types/qlaok.ts`; `codegraph node src/app/api/orders/route.ts --offset 81 --limit 150`; `codegraph node src/app/api/orders/route.ts --offset 772 --limit 130`; `codegraph node src/app/api/catalog/route.ts --offset 180 --limit 90`. Khu vực ảnh hưởng: cart/quote, guest order create/tracking/cancel và catalog; không đổi API, DB hay schema.

## 47. Storefront dine-in: QR bàn có chữ ký — production QA (2026-10-30)

- CodeGraph: `codegraph status` báo index up-to-date (296 file; engine index cũ). Truy vấn `ShopTableManager`, `buildTableMenuUrl`, `verifyTableQrSignature`, `GET /api/shops` và `resolveStorefrontMenuTableState`; đường đi gồm QR Studio tạo URL `tableId` + `sig`, API xác minh HMAC theo shop, rồi menu khóa lựa chọn bàn đã ký. Khu vực ảnh hưởng: QR Studio, public shop API và lựa chọn bàn storefront.
- QR Studio production trên shop QA `test shop 1` hiển thị một bàn hiện hữu đang hoạt động (`QA Table 01`, mã `QA01`), preview QR ghi đúng tên bàn và có link riêng `src=table` kèm `tableId`/chữ ký. Codex mở bằng nút “Mở thử”; storefront trả tiêu đề shop đúng, hiển thị `QA Table 01` cùng trạng thái “Đã xác định theo mã QR tại bàn”. Không tạo, sửa, lưu trữ hay đổi trạng thái bàn.
- Codex gọi lại public `GET /api/shops` trên chính URL có chữ ký: HTTP 200 và `tableQrVerified=true`. Thử lại cùng request sau khi đổi một ký tự chữ ký: HTTP 200 nhưng `tableQrVerified=false`. Không gửi đơn, yêu cầu phục vụ, thanh toán hay thay đổi catalog; không giữ URL, ID bàn hoặc chữ ký trong evidence.
- AGY Flash run `2026-10-30T06-26-07-225Z-21ffe950` mở được production dashboard/QR Studio trong phiên QA có sẵn; continuation `2026-10-30T06-29-26-443Z-b2bee5ce` bị dừng khi rơi vào vòng điều phối tác vụ nội bộ. AGY **không hoàn tất** kiểm tra chữ ký/API nên không tính là QA pass của AGY. Codex tự hoàn tất và kiểm tra độc lập như trên; không có source diff.
- Claude CLI được gọi ở chế độ read-only nhưng gateway cảnh báo model `deepseek` không được nhận dạng; lượt review chạm giới hạn 4 turns và không trả kết luận sử dụng được. Không xem cảnh báo đó là kết quả review.
- QA dùng Playwright CLI với phiên owner QA đã có; sau khi xong Codex đăng xuất và đóng browser. Không chạy test/build vì không thay đổi source.

## 48. Storefront search — production read-only QA (2026-10-30)

- Menu public của shop QA mở thành công. Tìm tên dịch vụ đang hiển thị giữ đúng thẻ kết quả; truy vấn không thể khớp hiện empty state có `role=status`; nút xóa khôi phục danh sách một thẻ.
- Console có 0 lỗi và 0 cảnh báo. Network summary ghi nhận `GET /api/shops` và storefront RSC đều HTTP 200; CLI không liệt kê 27 request tài nguyên tĩnh trong summary. Không thấy business write request và không thao tác giỏ/đơn/thanh toán/dịch vụ.
- AGY Flash run `2026-10-30T06-41-37-577Z-7572821d` dừng trước browser QA sau khoảng một phút dò setup Playwright/npm; không tính là AGY pass. Codex tự kiểm tra bằng Playwright CLI rồi đóng browser.
- Evidence đã lược thông tin tại `.agy-runs/storefront-search-readonly-qa-2026-10-30.md`. Không sửa source nên không chạy test/build.

## 49. P2-7: floor plan tổng hợp đơn theo trang, bỏ trần 10.000 đơn (2026-10-30)

- Giữ nguyên quyền `orders.view`, lọc `shop_id` và trạng thái phía database, kích thước trang 500, response 13 field, quy tắc trạng thái/số dư, cách giải `table_label` legacy và dedupe ID.
- Route tải tối đa 10.000 bàn như trước, sau đó đưa từng trang đơn phù hợp vào accumulator thuần; bộ nhớ không giữ toàn bộ order object. Không còn lỗi HTTP 500 chỉ vì có 10.001 đơn đang mở/chưa thanh toán.
- Regression API: 10.001 đơn trả HTTP 200 với `open_order_count=10001`, `unpaid_amount=10001000`; 21 page calls kết thúc ở range `10000..10499`, không chạy cap lookahead. Case đúng 10.000 và query errors tiếp tục được kiểm tra. Unit test xác nhận accumulator theo nhiều batch bằng kết quả xử lý cả mảng, kể cả ID trùng qua biên trang.
- AGY Argon Low run `2026-10-30T06-45-42-006Z-033f5c80` cập nhật route, helper và hai test; AGY chạy targeted suites 19/19 và typecheck. Codex chạy lại độc lập: targeted suites 19/19, `npm run typecheck`, ESLint trên bốn file source/test, `npm run build` (41 trang) và `git diff --check` đều đạt. Build có các cảnh báo `<img>`/hook sẵn có ngoài các file sửa.
- CodeGraph trước/sau sửa: `src/app/api/tables/floor-plan/route.ts MAX_RECORDS getShopOrders filter statuses`; `computeTableFloorPlanSummaries TableFloorPlanOrderInput tests/floor-plan-api-review.test.ts pagination range MAX_RECORDS_EXCEEDED`; sau sửa `createTableFloorPlanSummaryAccumulator computeTableFloorPlanSummaries processOrderPagesWithPagination floor-plan-api-review.test.ts table-floor-plan.test.ts`. Khu vực ảnh hưởng chỉ gồm floor-plan API, helper aggregation và hai test tương ứng.
- Claude CLI được gọi trực tiếp ở chế độ plan theo cấu hình DeepSeek; gateway báo `unrecognized_model deepseek` và không trả review sau khoảng 30 giây. Không tính đây là review pass. Chưa chạy full `test:review`/SQL suite hoặc production verification; chưa commit/push.

## 50. P2-8: khóa diagnostics của health endpoint và kiểm chứng response public (2026-10-30)

- Source hiện tại gọi `requireSuperAdmin`; khách/owner vẫn nhận health status công khai nhưng không nhận `dataSource`, cấu hình environment/AI hay counts. Diagnostics cho Super Admin vẫn hoạt động. Codex xác minh production `GET /api/health` trả HTTP 200 với đúng `status`, `service`, `timestamp`; không đọc hoặc ghi dữ liệu production.
- Thêm `tests/health-review.test.ts`: guest và owner chỉ nhận ba field công khai; Super Admin vẫn nhận đủ diagnostics và sáu count keys. Targeted test 2/2, `npm run typecheck` đạt, ESLint file test đạt.
- CodeGraph: `src/app/api/health/route.ts GET health aiProvider counts requireSuperAdmin health review tests`; `health` search; `ensureSupabaseReadyAndSeeded setSupabaseDbClientForTests getSupabaseDbClient test route health readiness`; `codegraph status` (297 files, up-to-date); `codegraph node tests/health-review.test.ts`. Khu vực ảnh hưởng: health route contract và regression test; không đổi route/source behavior.
- Follow-up P2-7: commit `bc92f03098a38c532c3f5b9cc8d46315e1f517ce` push main; workflow `41016611048` trên đúng SHA kết thúc `success` cho verify và deploy. Sau deploy, `/api/health` và menu shop QA đều HTTP 200.
- P2-8 regression test/docs đã được push trong commit `2c3f1356ac6255aedd4acee8794907a6dfd29649`; Actions run `41017395395` trên đúng SHA kết thúc `success` cho verify và deploy. Production health và menu đều HTTP 200.

## 51. P2-9: chạy E2E mutation trên PostgreSQL disposable trong CI (2026-10-30)

- Source hiện tại đã bỏ URL/key Supabase Cloud và assert health lỗi thời từ lần sửa trước. Lượt này thêm `tests/e2e-safety.mjs`: `TEST_BASE_URL` chỉ chấp nhận HTTP origin trên `localhost`, `127.0.0.1` hoặc `::1`, không credentials/path/query/fragment. Host production, Supabase và IP private khác đều bị từ chối trước request đầu tiên.
- Sáu nhóm có mutation (#5, #6, #7, #8, #9, #13) chỉ chạy nếu đồng thời có `E2E_ALLOW_MUTATIONS=1` và `E2E_DISPOSABLE_DATABASE=1`; mặc định chúng skip với lý do rõ ràng. `TEST_BASE_URL` chỉ chấp nhận HTTP loopback. Runner E2E dựng DB mới, bật logical replication, áp bootstrap/migrations, khởi chạy PostgREST và Next.js, rồi xóa container; verify-PR và deploy workflow chạy runner trước build.
- E2E mutation runner chưa chạy local vì máy không cài Docker. Nó sẽ được kiểm chứng trong GitHub Actions sau push; không có kết nối đến production hay ghi dữ liệu production.
- Kiểm tra Codex: `node --test tests/e2e-safety.test.mjs` 3/3; `npm run test:unit` 137/137; `npm run test:review` 383/383; `npm run test:sql` 13/13; `npm run test:db-reset`, `npm test --prefix mobile`, root/mobile typecheck và `npm run build` đều đạt. `node --check`, ESLint ba file E2E, YAML parse, `bash -n scripts/run-e2e-ci.sh` và `git diff --check` đều đạt. Build còn các warning React hook/`<img>` đã có từ trước.
- Actions run `41020929713` cho đúng commit `966ccf288b913a4cbce8f8d0b62462c658cd77d0` thất bại ở E2E: bootstrap và migrations đều áp dụng xong, nhưng `/api/health` trả 503 liên tục nên bước build/deploy bị skip. Migration 021 đã GRANT đủ quyền bảng seed cho `service_role`, nên không thêm quyền rộng.
- Actions run `41021950365` cho đúng commit `fd0e5f41e52a0e361fa8640937e53d8fc51dc751` tiếp tục thất bại ở readiness: probe trực tiếp `GET /shops` thành công, nhưng app gọi `/api/health` nhận `postgresMessage: "ERR: undefined"`; job chẩn đoán đầy đủ báo `postgresConfigured=true`, `postgresTablesReady=false` rồi skip build/deploy. Nguyên nhân là runner đặt URL vanilla PostgREST làm `NEXT_PUBLIC_SUPABASE_URL`: `supabase-js` tự thêm `/rest/v1`, trong khi PostgREST standalone đang phục vụ resource ở `/`. Probe cũ gọi root `/shops` nên không khớp đường dẫn thực tế của SDK. Xác minh theo source `supabase-js` và tài liệu API chính thức.
- Bản vá trong working tree thêm `scripts/e2e-supabase-rest-proxy.mjs`, chỉ bind loopback và chỉ chuyển `/rest/v1/*` về PostgREST; runner probe cùng URL mà SDK sẽ dùng. `tests/e2e-supabase-rest-proxy.test.mjs` kiểm tra rewrite/header/body/response, chặn path ngoài prefix, và từ chối upstream không phải loopback HTTP. `test:unit` hiện đạt 140/140, `bash -n scripts/run-e2e-ci.sh`, `node --check scripts/e2e-supabase-rest-proxy.mjs` và `git diff --check` đạt.
- Actions run `41022946349` đúng commit `5de0b6c78e2704f0cfd151e97a4d92482d9ab1bf`: readiness, 12 nhóm E2E, typecheck và toàn bộ unit/review/SQL/db-reset/mobile đều qua; nhóm 13 dừng trước khi tạo đơn vì seed `item-fnb-1` có `stock_quantity = null` (tồn kho không giới hạn), trong khi test cũ bắt buộc giá trị số. Test E2E được sửa để đặt tồn kho hữu hạn qua API với `expected_stock_quantity` CAS trước khi đặt đơn; thay đổi này chỉ chạy trong runner với PostgreSQL disposable.
- Actions run `41023579656` đúng commit `c299e22`: sau khi seed tồn kho, nhóm 13 đã tạo đơn, xác nhận trừ kho và đổi trạng thái bếp thành công; bước hủy trả HTTP 400 vì test thiếu `cancelled_reason` bắt buộc. Test hiện gửi lý do hủy riêng cho fixture E2E disposable. Chưa tính P2-9 hoàn tất; cần Actions mới chạy đủ E2E + build và deploy trên đúng SHA.
- Follow-up CodeGraph: `codegraph node tests/e2e.test.mjs` (nhóm 13); `codegraph node src/app/api/catalog/route.ts` (POST `upsert_item` + `expected_stock_quantity`); `codegraph node getCatalogItemUpdatePermissionOptions`; `codegraph node dbUpsertItem`; `codegraph node src/app/api/orders/route.ts` (PATCH cancellation validation). Ảnh hưởng chỉ gồm fixture E2E và báo cáo; `node --check tests/e2e.test.mjs`, `git diff --check` đạt. Máy local không có Docker nên lượt E2E mới, build, deploy và production health vẫn chờ GitHub Actions.
- CodeGraph: `codegraph status` (299 file, up-to-date); `codegraph explore "E2E tests mutation tests #5 #6 #7 #8 #9 #13; test:e2e; run-e2e-ci setup"`; `codegraph explore "issueSessionToken verifySessionToken SUPER_ADMIN_EMAIL requireSuperAdmin"`; `codegraph node issueSessionToken`; `codegraph node requireSuperAdmin`; `codegraph node fetchJson`; `codegraph node ensureAccessToken`; `codegraph node requireBillingOrderAuthority`; `codegraph node SEED_PROFILE`; `codegraph node isSupabaseConfigured`; `codegraph node shouldAutoSeedDemoData`; `codegraph node src/app/api/health/route.ts`. Vùng ảnh hưởng: E2E harness, demo/session/payment test setup, unit/review workflows và docs; không sửa API hoặc schema.
- AGY Argon Medium run `2026-10-30T07-09-56-904Z-d67f4ac1` đọc README/ARCHITECTURE và chạy các truy vấn CodeGraph nhưng bị dừng sau các khoảng im lặng dài trước khi chỉnh file; không tính là `SUCCESS` hay implementation. Claude CLI được gọi trực tiếp với yêu cầu hẹp; gateway báo `unrecognized_model deepseek`, chạm giới hạn 2 lượt và không trả review dùng được. Codex tự thực hiện và xác minh patch.
- AGY Claude Sonnet Medium phân tích CI read-only, ban đầu đưa giả thuyết sai thiếu GRANT; sau khi được cung cấp migration 021 và log Actions, đã rút lại, xác nhận cần probe PostgREST + health diagnostic; Codex chỉ giữ probe trong runner, không thay grants.
- Actions run `41023998206` trên đúng SHA `667b0d031a257fa7d66576cc1f90ef1fff2121e2` đã kết thúc `success`: root/mobile typecheck, unit/review/SQL/db-reset/mobile, E2E với PostgreSQL + PostgREST disposable và build đều qua. Deploy job `123959397334` cũng thành công; log xác nhận VPS `git reset --hard` đúng SHA trên, build hoàn tất và PM2 khởi động lại.
- Codex kiểm tra production sau deploy bằng GET: `/api/health` `200` (`status: ok`); public shop API `200` cho `test-shop-1` (gói free, 1 category, 1 item, 1 table, 0 posts); catalog và posts API `200`; menu tiếng Việt và URL `?lang=en` đều trả HTML `200`. AGY Flash Low run `2026-10-30T08-03-21-608Z-568d10d8` báo browser render món/dịch vụ, không có console error hoặc network response >=400; trang `?lang=en` vẫn hiển thị tiếng Việt đúng giới hạn `maxLangs: 1` của gói free. Codex xác nhận API/HTML độc lập; không sửa code storefront.
- Follow-up CodeGraph về QA storefront: `codegraph explore "For /s/[slug]/menu, trace lang query param, client locale initialization, localStorage qlaok_lang, and supportedLangs filtering"`; `codegraph node 'src/app/(storefront)/s/[slug]/menu/page.tsx' --file 'src/app/(storefront)/s/[slug]/menu/page.tsx' --offset 255 --limit 160`; truy vấn cùng file với `--offset 411 --limit 120`; `codegraph node detectVisitorLocale`. Vùng ảnh hưởng của P2-9 chỉ là proxy/runner và fixture E2E; không đổi API sản phẩm, schema hay dữ liệu production. Kiểm tra cú pháp/diff trước push đều đạt; CI chạy E2E thật trên disposable DB, build/deploy/health production đều đã được xác minh.
- **Trạng thái: ĐÃ ĐÓNG P2-9.** E2E disposable, build, deploy đúng SHA và health production đều success. Máy local vẫn không có Docker nên không lặp E2E ở local; việc này không còn là blocker vì CI đã chạy đúng runner với Postgres/PostgREST thật.

## 52. Follow-up kiểm tra cửa hàng công khai và trạng thái vận hành (2026-10-30)

- AGY Flash Low run `2026-10-30T08-26-31-158Z-b21539c6` kiểm tra trang cửa shop QA; Codex xác minh độc lập bằng Playwright ở viewport 390×844 và 1280×800. UI và các API shop/catalog/posts đều tải thành công; không tràn ngang, không có console error/warning hoặc GET lỗi. Gói free chỉ bật tiếng Việt (`maxLangs: 1`), nên `?lang=en` quay về tiếng Việt như thiết kế.
- Trang tự gửi analytics khi mở. Trước khi điều hướng, Codex cài route Playwright trả `204` giả lập cho `POST /api/analytics/track`; request duy nhất đó không đi tới production. Không tạo đơn, sửa catalog/cấu hình hoặc phát sinh business write. Evidence đã lược dữ liệu tại `.agy-runs/qa/storefront-door-readonly-qa-2026-10-30.md`.
- Kiểm tra VPS chỉ đọc: `nginx -t` thành công, Nginx active; vhost Qlaok đang đặt `X-Real-IP` thành `$remote_addr` và thêm `$proxy_add_x_forwarded_for` cho PostgREST và Next.js. Điều này xác nhận giả định reverse proxy trong mục “Chưa xác minh” ban đầu.
- Backup PostgreSQL: `qlaok-postgres-backup.timer` đang enabled/active, lần kiểm tra lúc `2026-10-30 15:35 CST` báo lịch kế tiếp `2026-10-31 03:15:45 CST`, chưa có `LastTriggerUSec`. Service khởi tạo có `Result=success`, exit `0`, nhưng timer chưa đến lần chạy định kỳ; không ghi là đã xác minh backup định kỳ. Chưa restore archive production trên staging riêng.
- CodeGraph: `codegraph status` (301 file, up-to-date); `codegraph explore "src/lib/gemini.ts AI gateway API key configuration literal secret key fail closed missing configuration"`; `codegraph node src/lib/gemini.ts --file src/lib/gemini.ts --offset 1 --limit 55`; `codegraph explore "mobile/app.json extra.eas.projectId Expo push token getExpoPushTokenAsync eas project info configuration"`. Source hiện không còn literal gateway key và trả `null` khi thiếu `AI_API_KEY`; lịch sử Git vẫn cần chủ tài khoản/provider rotate key. EAS `project:info` không thể xác minh vì CLI yêu cầu đăng nhập; chưa có project ID để bật push thật.
- Không sửa source trong follow-up này; không chạy test/build. Các mục còn cần bên ngoài repo hoặc lịch chạy là rotate gateway key, cung cấp EAS project ID, quan sát timer chạy định kỳ và restore backup production trên môi trường staging phù hợp. Không kiểm thử refund trên một đơn đã thanh toán thật.

## 53. Mobile Expo Web QA: đổi ngôn ngữ và lưu sau reload (2026-10-30)

- AGY Flash Low run `2026-10-30T08-49-07-498Z-93452775` và Codex Playwright độc lập kiểm tra màn đăng nhập mobile ở viewport `390×844`. Cả hai xác nhận VI → EN cập nhật nhãn và selected state; reload vẫn giữ EN. EN → VI rồi reload khôi phục đúng VI. `localStorage.qlaok_app_locale` lần lượt là `en` và `vi`.
- Expo Web chạy `EXPO_NO_DOTENV=1`, `EXPO_OFFLINE=1`; API/auth được trỏ tới loopback fixture, không đăng nhập. Network của Codex ghi 9 GET, tất cả `127.0.0.1:8083` và HTTP 200; không gọi fixture port 8090 hay host ngoài. Không có console error; có 2 cảnh báo React Native Web về `shadow*` và `pointerEvents` deprecated.
- AGY dùng 21 lệnh Playwright, hoàn tất `SUCCESS`, không đổi file tracked. Screenshot/evidence nằm ở `.agy-runs/mobile-locale-qa-final.png`. CodeGraph: `codegraph status`; `codegraph query MobileLanguageSwitcher`; `codegraph node mobile/src/components/MobileI18nProvider.tsx --offset 1 --limit 230`; `codegraph explore "getStoredMobileLocale loadPersistedMobileLocale savePersistedMobileLocale normalizeMobileLocale MobileLanguageSwitcher persistence storage key"`; `codegraph node mobile/src/lib/mobile-i18n.ts --offset 680 --limit 210`; `codegraph node MOBILE_LOCALE_STORAGE_KEY --file mobile/src/lib/mobile-i18n.ts`. Phạm vi: mobile auth-screen locale switcher, web localStorage và accessibility roles.
- Chỉ xác nhận Expo Web. Native SecureStore, iOS/Android cold start, owner OIDC và push vẫn chưa được kiểm tra trên thiết bị; Mac đang khóa nên không chạy được thao tác UI native. Không sửa source, không chạy test/build riêng; đã dừng browser, Metro, fixture và simulator sau QA.

## 54. Mobile staff catalog có button lồng nhau (2026-10-30)

- Trong QA web staff, React báo `<button>` nằm trong `<button>` ở product card. AGY Flash Low run `2026-10-30T09-21-32-715Z-bec667e1` đổi wrapper card thành `View`, giữ vùng thông tin sản phẩm và nút chọn món thành hai `TouchableOpacity` ngang hàng; cập nhật kiểm tra source tương ứng trong `mobile/tests/staff-ordering.test.ts`.
- CodeGraph trước khi sửa: `codegraph explore "AssistedOrderScreen product item card TouchableOpacity nested button Chọn món UI markup around products"`; `codegraph node mobile/src/components/staff/AssistedOrderScreen.tsx --file mobile/src/components/staff/AssistedOrderScreen.tsx --offset 470 --limit 85`; `codegraph node mobile/tests/staff-ordering.test.ts --file mobile/tests/staff-ordering.test.ts --offset 605 --limit 39`; `codegraph callers handleOpenItemConfig`. Khu vực ảnh hưởng: danh mục trong assisted staff ordering; API, schema, đơn hàng và quyền không đổi.
- Codex kiểm tra diff và CodeGraph sau sửa; `npm test --prefix mobile` đạt 112/112, `npm run typecheck --prefix mobile` đạt, `git diff --check` đạt. Expo Web bundle mới hiển thị hai nút riêng; log sau bundle mới không còn `validateDOMNesting`. Có hai cảnh báo RN Web deprecated `shadow*`/`pointerEvents`; một HTTP 409 trước đó do giới hạn login của loopback QA proxy, không tới production.
- QA production chỉ gọi `POST /api/auth` (200), `GET /api/tables` (200), `GET /api/catalog` (200). Chọn `QA Table 01`, đổi ngôn ngữ và xác nhận bàn vẫn được giữ; không gửi đơn hay ghi thay đổi nghiệp vụ. Evidence đã lược dữ liệu tại `.agy-runs/qa/mobile-staff-ordering-qa-2026-10-30.md`.
- Phạm vi chưa xác minh: native iOS/Android và gửi đơn thật; lượt này chỉ kiểm tra Expo Web ở trạng thái draft.

## 55. Mobile staff sign-in gợi ý tên shop không hợp lệ (2026-10-30)

- QA trước đó nhập tên hiển thị theo placeholder `Pho Hoi An` và nhận HTTP 401. CodeGraph xác nhận `resolveShopForStaffLogin` nhận slug/alias, shop ID hoặc storefront link, không tìm shop theo tên hiển thị.
- AGY Flash Low run `2026-10-30T09-39-43-662Z-f3983e4b` được dừng sau nhiều lượt quét chuỗi toàn repo vượt phạm vi; run không tạo thay đổi tracked. Codex sửa trực tiếp hai file sau khi đối chiếu CodeGraph: cập nhật label/accessibility label, mô tả, placeholder và lỗi credential sang slug/ID/link; thêm assertion hồi quy cho copy VI/EN và bỏ gợi ý tên hiển thị.
- CodeGraph: `codegraph explore "staff login Store name or link placeholder e.g. Pho Hoi An staff-shop-identifier-input resolveShopForStaffLogin extractShopIdentifierCandidate slug shop id link"`; `codegraph node src/lib/staff-accounts.ts --symbol resolveShopForStaffLogin`; `codegraph node mobile/src/components/AuthScreen.tsx --offset 740 --limit 280`; `codegraph node mobile/tests/staff-workspace.test.ts --offset 225 --limit 200`. Vùng ảnh hưởng: copy form staff sign-in và kiểm tra UI; không đổi API/auth behavior.
- `npm test --prefix mobile` đạt 112/112; `npm run typecheck --prefix mobile` và `git diff --check` đạt. Local Expo Web render cho thấy placeholder hợp lệ ở VI và EN, không phát sinh console error hay API request. Evidence đã lược dữ liệu tại `.agy-runs/qa/staff-login-shop-identifier-copy-2026-10-30.md`.
- Chưa phát hành Expo app: `mobile/app.json` chưa có EAS `projectId`, máy không có `EXPO_TOKEN`, repo không có workflow phát hành mobile. Workflow VPS chỉ build Next.js; deploy đó không đóng gói thay đổi trong `mobile/`. Native/OTA release chưa xác minh.

## 56. Production QA CAS catalog: snapshot cũ và cập nhật đồng thời (2026-10-30)

- Codex kiểm tra production qua dashboard owner của shop QA, không dùng dữ liệu khách hàng hoặc sửa món có sẵn. Baseline đọc được là 1 danh mục/1 món; tạo đúng một món fixture có marker QA riêng, giá 12.345đ, tồn kho 5 và trạng thái đang bán.
- Qua UI ở hai tab, tab thứ nhất cập nhật tồn kho 5 → 4; tab thứ hai vẫn giữ snapshot tồn kho 5 nhưng sửa giá 12.345đ → 12.346đ. GET catalog sau thao tác xác nhận giá mới được lưu, tồn kho vẫn 4 và trạng thái bán vẫn bật — snapshot UI cũ không ghi đè tồn kho.
- Gọi đồng thời hai POST `/api/catalog` với cùng `expected_is_available=true`, yêu cầu tắt bán. Một request trả HTTP 200, request còn lại trả HTTP 409 `STOCK_CONFLICT`. GET catalog xác nhận trạng thái cuối tắt bán, tồn kho 4 và giá 12.346đ; compare-and-swap chỉ cho một cập nhật trạng thái thắng.
- Xóa fixture qua dialog dashboard. GET catalog sau xóa và sau reload UI đều trở về 1 danh mục/1 món baseline; marker QA không còn. Không tạo hoặc sửa đơn hàng, thanh toán hay yêu cầu phục vụ; không sửa món baseline.
- Quan sát phụ: một asset ảnh Storage hiện hữu trả HTTP 402; request chẩn đoán đầu tiên dùng slug thay ID shop nên nhận HTTP 404; HTTP 409 ở trên là kết quả mong đợi của request cạnh tranh. Không có lỗi khác trong console QA.
- Evidence đã lược dữ liệu tại `.agy-runs/qa/catalog-concurrency-production-2026-10-30.md` (ignored). CodeGraph trước khi đọc source: `codegraph status`; `codegraph explore "src/app/api/catalog/route.ts POST upsert_item expected_stock_quantity is_available legacy payload metadata stock conflict stale snapshot caller UI bulk_update_price_stock"`; `codegraph node dbUpsertItem`; `codegraph node getCatalogItemUpdatePermissionOptions`; `codegraph callers dbUpsertItem`; `codegraph node src/app/api/catalog/route.ts --offset 264 --limit 310`; `codegraph explore "dashboard catalog create item save handler handleDeleteItem QuickItemRow delete item fixture cleanup shop_id category_id stock expected_stock_quantity"`; `codegraph explore "DELETE /api/catalog delete itemId item_id dbDeleteItem catalog item handler authorization"`. Khu vực đã xác minh: caller dashboard, catalog API, `dbUpsertItem` CAS và quyền catalog/kho.
- Không sửa source trong lượt này nên không chạy test/build và không tạo commit code. Production đang chạy commit trước đó có các guard CAS; kiểm chứng này bổ sung bằng chứng HTTP/UI thật cho cập nhật tồn kho và trạng thái bán đồng thời. AGY không được chạy trong lượt này; quota Gemini snapshot còn 5% tuần tại thời điểm chọn runner. Máy đang khóa nên Codex dùng Playwright CLI headless; hai HTTP status kiểm tra trực tiếp và bước cleanup được đối chiếu độc lập.

## 57. Mobile promo preview: xác nhận locale và hồi quy (2026-10-30)

- Đối chiếu lại P3-29: `getLocalizedPromoBannerStrings` dựng title/subtitle theo locale storefront; `PhoneViewer` vốn có nội dung cho đủ 8 ngôn ngữ. Nhận định “khách EN thấy banner tiếng Việt” là false positive, không phải lỗi hiển thị cần đổi copy.
- Trích phần resolve chuỗi promo/flash sale thành `mobile/src/lib/promo-preview-i18n.ts`; `PhoneViewer` dùng kết quả helper trực tiếp. Đây là refactor để test được, giữ nguyên chuỗi và cách fallback hiện có.
- Thêm `mobile/tests/promo-preview-i18n.test.ts`: kiểm tra đủ 8 locale, fallback tiếng Việt, badge/title/subtitle, giờ flash sale, phần trăm, `fixed_amount`, định dạng VND và fallback mặc định; có assertion cho chuỗi Nga và Ý.
- AGY Gemini Flash Low đã triển khai trong hai lượt `2026-10-30T10-16-27-395Z-ea7c93df` và `2026-10-30T10-20-48-751Z-19de6071`; Codex phát hiện và yêu cầu sửa ở lượt đầu helper chưa được nối vào `PhoneViewer`, rồi kiểm tra lại diff và caller.
- CodeGraph: `codegraph status`; `codegraph explore "resolveMobilePromoPreview PhoneViewer mobile promo preview localization test callers"`; `codegraph node mobile/tests/promo-preview-i18n.test.ts`; `codegraph node mobile/src/components/PhoneViewer.tsx`; `codegraph node resolveMobilePromoPreview`; `codegraph explore "getLocalizedPromoBannerStrings storefront locale promo banner localization"`; `codegraph node getLocalizedPromoBannerStrings`. Ảnh hưởng: mobile promo preview và regression tests; không đổi API, dữ liệu shop hoặc storefront runtime.
- Checks: `npm test --prefix mobile` PASS (118/118); `npm run typecheck --prefix mobile` PASS; `npm run test:unit` PASS (140/140); `npx eslint --no-ignore mobile/src/components/PhoneViewer.tsx mobile/src/lib/promo-preview-i18n.ts mobile/tests/promo-preview-i18n.test.ts` PASS; `git diff --check` PASS. Lệnh ESLint không có `--no-ignore` bỏ qua `mobile/`, nên đã chạy explicit để kiểm tra các file này.
- Chưa xác minh bằng bản native/OTA mobile hoặc EAS release; web deploy không phát hành binary Expo. CI và production web deploy được kiểm tra sau push và báo riêng trong handoff.

## 58. Đối soát lại unique order code production (2026-10-30)

- Dùng SSH host-key đã lưu và SSH agent hiện có; PostgreSQL được truy vấn trong transaction `READ ONLY`, `statement_timeout=8s`, kết thúc bằng `ROLLBACK`. Không dùng private key đã gửi trong chat và không đọc/export order code, order ID hay dữ liệu khách.
- Kết quả tổng hợp: `public.orders` hiện có 0 nhóm mã trùng, 0 duplicate rows; migration `20261028000300_orders_order_code_unique.sql` đã ghi nhận và index `idx_orders_order_code_unique` đang áp trên `orders.order_code`.
- Kiểm tra tham chiếu theo ID: không có `order_audit_logs.order_id` hoặc `sepay_webhook_events.order_id` mồ côi. Không chạy `UPDATE`, không sửa dữ liệu hay schema trong lượt này; các mã production đã được đối soát trước khi kiểm tra hiện tại, nhưng nguồn gốc/thời điểm thay đổi không xác định từ truy vấn chỉ đọc này.
- GitHub Actions run `41040617496` chạy đúng commit `04eff69faf7947c903e6516b80492820e9714470`; cả `verify` lẫn `Build & Deploy → qlaok.vunph.click` kết thúc `success`. `GET https://qlaok.vunph.click/api/health` trả HTTP 200 sau deploy.
- CodeGraph: `codegraph status`; `codegraph explore "orders order_code unique migration 20261028000300 payment_transactions sepay_webhook_events order_audit_logs references"`; `codegraph node dbCreateOrder`. Khu vực đã đối chiếu: order creation/retry, migration unique và các tham chiếu order ID.

## 59. KDS fulfillment và payment invariant — production QA (2026-10-30)

- CodeGraph: `codegraph status`; `codegraph explore "KDS kitchen screen status transition /api/orders workflow step complete service preserve payment status"`; `codegraph callers dbUpdateOrderStatus`; `codegraph node validateOrderWorkflowTransition`; truy vấn thêm KDS status/action/cancel; `codegraph node src/lib/mpos-store.ts --offset 2575 --limit 140`; `codegraph node src/app/api/orders/route.ts --offset 772 --limit 180`; `codegraph node src/app/api/orders/route.ts --offset 945 --limit 210`; `codegraph node src/lib/kitchen-display.ts --offset 1 --limit 260`. Khu vực đối chiếu: workflow transitions, KDS queue, cập nhật trạng thái đơn, hủy/hoàn kho và bất biến thanh toán độc lập với fulfillment.
- AGY Flash QA trên shop production dành cho QA dùng đúng một đơn takeaway tiền mặt chưa thanh toán. API tạo đơn trả `201`; các lần chuyển `new → preparing → completed` và bước hủy fixture đều trả `200`. AGY đọc lại `payment_status=unpaid` ở mỗi bước, fixture biến mất khỏi hàng chờ KDS sau khi hoàn tất và sau cleanup; hàng chờ còn đúng mức nền một đơn hiện hữu. Không sửa đơn có sẵn hay cấu hình shop. Mặt hàng thử có tồn kho không theo dõi (`stock_quantity=null`); `sold_count` sau cleanup bằng mức nền 2.
- Codex xác minh độc lập lần đọc cuối trực tiếp trên VPS qua SSH host key đã lưu, bằng transaction PostgreSQL `READ ONLY`, `statement_timeout=8s` và `ROLLBACK`: đúng một row cho fixture, trạng thái `cancelled`, `payment_status=unpaid`. Không ghi dữ liệu production. Bằng chứng chi tiết đã khử thông tin nhận dạng nằm trong artifact QA local bị ignore; file tham chiếu fixture cũng bị ignore và quyền truy cập là `600`.
- Checks: không có thay đổi source; chỉ cập nhật báo cáo này. `git diff --check` PASS. Không chạy test/build vì thay đổi chỉ là tài liệu. Bước KDS production QA đã được xác nhận; các hạng mục review còn lại chưa được bao phủ bởi lượt này.

## 60. QR bàn có chữ ký — AGY Flash và Codex xác minh độc lập (2026-10-30)

- AGY Flash Low run `2026-10-30T11-11-25-873Z-6896baa8` hoàn tất QA production chỉ đọc. Trong QR Studio, xác nhận shop QA và bàn `QA Table 01` đang hoạt động; link riêng có `src=table`, `tableId`, `sig` (không ghi giá trị vào evidence). URL hợp lệ mở storefront HTTP 200, báo đúng bàn và khóa lựa chọn bàn; signature bị đổi một ký tự trả HTTP 200 nhưng `tableQrVerified=false`, UI không khóa bàn và hiện fallback. API `GET /api/shops` được gọi riêng cho cả hai trường hợp với cùng kết quả. Analytics được Playwright mock thành `204`; không tạo đơn, yêu cầu dịch vụ, thanh toán hoặc chỉnh sửa bàn.
- Codex tái hiện độc lập bằng Playwright CLI: UI storefront hợp lệ hiển thị `QA Table 01` cùng “Đã xác định theo mã QR tại bàn”; API GET trả `200/true`. Codex sửa một ký tự signature chỉ trong bộ nhớ; API trả `200/false`, trang lỗi chữ ký không hiển thị bàn và mở lại lựa chọn. Network thấy `GET /api/shops` HTTP 200 và `POST /api/analytics/track` được route mock trả HTTP 204; console 0 lỗi, 0 cảnh báo. Sau QA, Codex đăng xuất, xóa session data, đóng browser và xóa các snapshot/console file cục bộ có URL hoặc thông tin QR.
- CodeGraph: `codegraph status`; `codegraph explore "signed QR table menu buildTableMenuUrl verifyTableQrSignature public shops API resolveStorefrontMenuTableState dine-in table state"`; `codegraph node buildTableMenuUrl`; `codegraph node verifyTableQrSignature`; `codegraph callers verifyTableQrSignature`; `codegraph node src/app/api/shops/route.ts --offset 138 --limit 16`; `codegraph explore "ShopTableManager table-specific QR preview tableId sig buildTableMenuUrl"`; `codegraph node src/components/dashboard/ShopTableManager.tsx --offset 1 --limit 135`. Khu vực đã kiểm: QR Studio, URL QR theo bàn, storefront menu và public shop API.
- Checks: source không đổi; chỉ thêm evidence QA vào báo cáo. `git diff --check` PASS. Không chạy test/build vì không sửa code. Chưa kiểm tra QR bàn bị archive/inactive, shop khác hoặc đặt đơn từ luồng bàn.

## 61. Storefront lọc chéo danh mục và giỏ nhiều món — AGY Flash + Codex đối chiếu API (2026-10-30)

- AGY Flash Low run `2026-10-30T11-26-03-327Z-c25ff890` chạy production QA trên shop thử nghiệm `test-shop-1`. Baseline có 1 category/1 item; tạo tạm 1 category và 1 item, xác nhận `GET /api/catalog` trả HTTP 200 với 2/2 và quan hệ item-category đúng. Không sửa record baseline.
- AGY mở public storefront với analytics được CDP mock HTTP 204 trước khi tải trang. UI xác nhận All hiện cả hai item; chọn từng category chỉ hiện item thuộc category tương ứng. Giỏ có đúng hai dòng, subtotal 235.000đ; xóa cả hai dòng đưa giỏ về rỗng. Không gửi checkout, đơn, thanh toán hoặc yêu cầu phục vụ.
- AGY xóa fixture item rồi category qua `DELETE /api/catalog`, cả hai trả HTTP 200. Đọc lại catalog xác nhận không còn fixture và baseline trở về đúng 1 category/1 item; báo cáo ghi nhận ID, tên, giá và khả dụng của record gốc giữ nguyên. Artifact chi tiết đã khử dữ liệu nằm ở `.agy-runs/qa/storefront-cross-category-cart-production-2026-10-30.md` (ignored, mode 600).
- Codex xác minh độc lập sau cleanup bằng public `GET /api/shops?slug=test-shop-1&view=menu`: HTTP 200, 1 category/1 item; không có fixture bổ sung. Đây là đối chiếu API cuối, không phải lượt chạy UI độc lập của Codex.
- CodeGraph: `codegraph status` (index up-to-date: 303 files, 4.983 nodes, 17.742 edges; engine index cũ); `codegraph explore "storefront catalog category item cart"`; `codegraph explore "api/catalog"`; `codegraph explore "storefront menu category filter cart"`; `codegraph node "src/app/api/catalog/route.ts"`; `codegraph node "src/app/(dashboard)/dashboard/catalog/page.tsx"`; `codegraph node "src/components/storefront/VerticalRenderer.tsx"`; `codegraph explore "ShowToStaffModal cart quantity"`. Vùng đã xem: catalog API, owner catalog mutations, storefront category filter, quick-add và cart modal.
- Checks: không sửa source; chỉ bổ sung evidence vào review log. `git diff --check` PASS. Không chạy test/build. Chưa kiểm tra gửi đơn từ giỏ nhiều danh mục hoặc thanh toán.

## 62. Đối chiếu lại P1-3: bỏ mật khẩu mặc định khi tạo/reset chủ quán (2026-10-30)

- Finding P1-3 trong phần đầu tài liệu đã lỗi thời: source hiện tại không còn chuỗi mật khẩu dùng chung và không tạo credential cho chủ quán từ trang Super Admin.
- `POST /api/admin` với `action: 'create_owner'` chỉ nhận email, tên, số điện thoại và gói; kiểm tra email trùng, rồi upsert hồ sơ `owner_invite_pending: true`, `zitadel_sub: null`. Payload không có trường password. Chủ quán claim hồ sơ sau khi đăng ký và xác thực đúng email qua Zitadel.
- UI form không có ô mật khẩu; nội dung xác nhận đây là lời mời và giải thích bước xác thực email. `reset_owner_password` trả HTTP 410 với mã `OWNER_PASSWORD_RESET_VIA_OIDC`, hướng người dùng sang luồng Quên mật khẩu Zitadel.
- CodeGraph: `codegraph status`; `codegraph explore "src/app/api/admin/route.ts owner creation action create_owner validate password invitation"`; `codegraph explore "src/app/(admin)/admin/page.tsx create owner form password placeholder create_owner reset owner"`; `codegraph node src/app/api/admin/route.ts --offset 400 --limit 160`; `codegraph node src/app/api/admin/route.ts --offset 540 --limit 85`; `codegraph node 'src/app/(admin)/admin/page.tsx' --offset 2185 --limit 100`; `codegraph node tests/admin-review.test.ts --offset 205 --limit 170`; `codegraph explore "create_owner owner_invite_pending admin invitation never provisioning password Zitadel"`. Ảnh hưởng đã kiểm: Super Admin create/reset UI, `/api/admin`, invitation profile helper và test hợp đồng.
- Checks: chạy đúng 2 test `owner password recovery through Zitadel` và `create_owner rejects mixed-case duplicate emails and writes a pending invitation` trong `tests/admin-review.test.ts`; **2/2 PASS**. Test xác nhận hồ sơ pending, `zitadel_sub=null`, payload upsert không chứa password, và reset cũ bị từ chối bằng 410. Lệnh test có cảnh báo dev về `SESSION_SECRET` thiếu và audit test fallback; không làm test fail.
- Không sửa source trong lần đối chiếu này. Finding P1-3 về mật khẩu mặc định được đóng; kết luận này không xác nhận các flow Zitadel trên thiết bị/production ngoài những phần đã được kiểm chứng riêng.

## 63. Diễn tập backup và restore PostgreSQL cục bộ cô lập (2026-10-30)

- Chạy `scripts/backup-self-hosted-postgres.mjs` với PostgreSQL disposable trên máy và fixture tổng hợp hai dòng; không kết nối hay sao chép dữ liệu production. Script tạo custom archive 1.742 byte và vượt bước `pg_restore --list`.
- Khôi phục archive vào database rỗng riêng bằng `pg_restore --exit-on-error --no-owner --no-acl`; truy vấn sau restore đọc đúng `2:sanitized-restore-drill,second-row`. Archive có mode `0600`.
- SSH chỉ đọc tới VPS: backup service `Result=success`, exit `0`, lần chạy gần nhất `2026-10-30 18:58:27 CST`; timer đã bật, chưa có lần timer định kỳ, lần kế tiếp `2026-10-31 03:18:45 CST` tại thời điểm kiểm tra.
- CodeGraph: `codegraph status`; `codegraph explore "backup-self-hosted-postgres.mjs pg_dump backup archive output permissions retention restore PostgreSQL"`; `codegraph explore "install-self-hosted-postgres-backup systemd timer service backup runbook"`; `codegraph node scripts/backup-self-hosted-postgres.mjs`; `codegraph node scripts/backup-qlaok-db.mjs`. Vùng đã kiểm: backup custom archive, kiểm mục lục, quyền file, systemd installer/timer và runbook.
- Evidence: `.agy-runs/qa/self-hosted-postgres-local-restore-drill-2026-10-30.md` (chỉ fixture tổng hợp và kết quả đã lược).
- Giới hạn: diễn tập local chứng minh script/archive có thể restore vào PostgreSQL cùng máy; chưa khôi phục archive production trên staging riêng và chưa quan sát timer chạy theo lịch.

## 64. Storefront yêu cầu phục vụ tại bàn — production QA (2026-10-30)

- CodeGraph: `codegraph status` báo index up-to-date (303 files; engine index cũ); `codegraph explore "POST /api/service-requests route dbCreateTableServiceRequest deduplication signed table QR"`; `codegraph node src/app/api/service-requests/route.ts`; `codegraph explore "menu-service-request-call-staff"`; `codegraph node 'src/app/(storefront)/s/[slug]/menu/page.tsx' --file 'src/app/(storefront)/s/[slug]/menu/page.tsx' --symbols-only`. Vùng đã kiểm: hai nút storefront, POST xác thực chữ ký/idempotency, PATCH trạng thái yêu cầu và owner panel.
- Preflight production chỉ đọc xác nhận bàn QA `QA01` đang hoạt động, chưa có yêu cầu phục vụ và không có mobile push token hoạt động. Analytics storefront được mock HTTP 204 trước khi mở menu.
- Từ menu QR đã ký, cả nút `Gọi phục vụ` và `Xin hóa đơn` đều hoạt động. `call_staff` hiện toast thành công; gửi lại trong cửa sổ chống trùng trả HTTP 200, `deduplicated=true`, giữ cùng yêu cầu pending. `request_bill` trả HTTP 201, `deduplicated=false`, trạng thái pending. API với chữ ký QR bị sửa một ký tự trả HTTP 403 `INVALID_TABLE_QR_SIGNATURE` và không tạo yêu cầu.
- Owner dashboard hiển thị đúng hai yêu cầu của bàn QA. Qua UI, cả hai chuyển `pending → acknowledged → resolved`; bốn PATCH đều HTTP 200. Panel không còn yêu cầu mở cho bàn QA. PostgreSQL production được đọc trong transaction `BEGIN READ ONLY ... ROLLBACK`: kết quả cuối có đúng `call_staff.resolved=1` và `request_bill.resolved=1`, không còn pending/acknowledged. Hai dòng resolved được giữ lại làm audit history vì API không có thao tác xóa.
- Lần gọi GET owner API trực tiếp không gửi bearer của dashboard nên bị 403; đây là kết quả auth mong đợi, không tính là lỗi feature. Owner UI và trạng thái cuối được đối chiếu riêng. Console ghi hai lỗi tải tài nguyên 403 do các GET thiếu bearer này và bốn cảnh báo autoplay AudioContext sau reload; các POST/PATCH trong luồng UI đều trả kết quả mong đợi.
- AGY Flash run `2026-10-30T12-40-41-303Z-64a40697` lặp CodeGraph exploration rồi bị dừng trước khi chạy browser/API; không tính là QA pass. Codex chạy Playwright trực tiếp và đọc lại DB production ở chế độ chỉ đọc. Evidence đã lược: `.agy-runs/qa/storefront-table-service-requests-production-2026-10-30.md` (mode `0600`); không lưu URL/chữ ký QR, table UUID, row ID hoặc credential.
- Không sửa source, đơn, thanh toán, catalog hay bàn; chỉ tạo hai yêu cầu QA và resolve chúng. Không chạy test/build vì thay đổi chỉ là tài liệu; kiểm tra `git diff --check` sau khi cập nhật. Chưa kiểm thử GET owner API có bearer hợp lệ độc lập ngoài giao diện dashboard.

## 65. Public posts và vòng đời bài thông báo — production QA (2026-10-30)

- AGY Flash Low run `2026-10-30T13-07-07-593Z-4de2df60` thực hiện 17 thao tác Playwright cho P2-2. CodeGraph: `codegraph status`; `codegraph explore "GET /api/posts require shopId active is_active dbGetShopPosts public storefront posts"`; `codegraph node src/app/api/posts/route.ts`. Phạm vi: validate `shopId`, danh sách bài theo shop và trạng thái active, UI chủ quán tạo/ghim/xóa, hiển thị bài ghim trên storefront.
- QA production trên shop thử nghiệm `test-shop-1`: baseline không có bài; tạo một bài active có marker duy nhất và ghim qua dashboard; reload giữ bài và trạng thái ghim; API public trả bài đúng shop; storefront hiển thị bài ghim. Tắt ghim, reload xác nhận `is_pinned=false`; bật lại, reload xác nhận `is_pinned=true`; xóa qua dashboard và xác nhận bài biến mất khỏi owner UI, owner/public API và storefront. Số bài sau cleanup bằng baseline (0).
- Analytics storefront được mock `POST /api/analytics/track` thành HTTP 204; không phát sinh analytics production. Không gọi API đơn hàng, thanh toán, bàn hay dịch vụ; không sửa bài có trước.
- Codex xác minh độc lập bằng GET production, không dùng bearer: `GET /api/posts` trả HTTP 400 `SHOP_ID_REQUIRED`; `GET /api/shops?slug=test-shop-1` và `GET /api/posts?shopId=…` đều HTTP 200; danh sách cuối rỗng (`postsCount=0`). Không ghi shop ID vào log.
- Evidence đã lược tại `.agy-runs/qa/storefront-post-lifecycle-p2-2-2026-10-30.md` (mode `0600`). Không thay đổi source hoặc test; `git diff --check` đạt. QA chưa bao phủ shop có bài đăng tồn tại trước đó hoặc các thao tác khác trên dashboard bài viết.

## 66. CI E2E PostgreSQL readiness race (2026-10-30)

- Commit tài liệu `8b675e8d2c0631f1c4905ca1a2116881650dc037` được đẩy lên `main`; GitHub Actions run `41061624182` chạy đúng SHA. Cài đặt, typecheck, unit/review/SQL/DB-reset và mobile tests đều pass. E2E fail trước bước migration với `psql` không kết nối được Unix socket; build và deploy bị skip.
- CodeGraph: `codegraph status`; `codegraph explore "scripts/run-e2e-ci.sh postgres Docker disposable database psql socket connection startup readiness"`. Script `.sh` không được index nên được đọc trực tiếp theo ngoại lệ file chưa index. Vùng ảnh hưởng: chỉ readiness loop của disposable PostgreSQL dùng bởi E2E CI.
- Nguyên nhân: `pg_isready` không truyền host dò Unix socket. Official Postgres Docker entrypoint dùng server tạm chỉ nghe socket trong giai đoạn init, nên probe có thể báo sẵn sàng trước server TCP cuối cùng; log xác nhận `psql` lỗi ngay sau lúc container image được tải. Xem [entrypoint của official image](https://github.com/docker-library/postgres/blob/master/docker-entrypoint.sh).
- Đã đổi probe thành `pg_isready -h 127.0.0.1 -U postgres -d "$db_name"` để đợi server TCP chính trước bootstrap SQL. AGY Flash Low review run `2026-10-30T13-18-06-715Z-46490cfc` xác nhận thay đổi tối thiểu. `bash -n scripts/run-e2e-ci.sh` và `git diff --check` đạt.
- E2E không chạy được tại máy local vì Docker CLI không cài đặt. GitHub Actions run `41062257872` trên đúng SHA `baa6312160a13983063a68d0ceae5ba9909fd295` đã pass toàn bộ dependency install, typecheck, unit/review/SQL/DB-reset/mobile, E2E và build; job deploy VPS cũng thành công. Sau deploy, homepage và `/api/health` đều HTTP 200. Bản sửa readiness đã được triển khai.

## 67. QA production read-only trang Orders chủ quán (2026-10-30)

- Dùng tài khoản QA từ `.env.testing` trong bộ nhớ; không ghi hoặc in credential. Chỉ cho phép `POST /api/auth/login-ui` và `POST /api/auth` để hoàn tất đăng nhập; chặn các phương thức ghi khác. Lượt QA thành công không phát sinh request ghi nghiệp vụ nào.
- Production `GET /api/shops` và `GET /api/orders` đều HTTP 200. Shop đang chọn khớp cấu hình QA. API trả 11 đơn; tab `all` hiển thị đủ 11 thẻ và đối chiếu đủ 11/11 với API.
- Bảy bộ lọc khớp số lượng tính độc lập từ API theo quy tắc hiện hành: `today` 5, `active` 5, `new` 4, `preparing` 0, `completed` 1, `cancelled` 6, `all` 11. Không thiếu hoặc thừa thẻ.
- Đối chiếu 11 thẻ: không có mismatch về nhãn thanh toán, số món, tên/số lượng/giá dòng món hay tổng tiền; badge trạng thái đều hiện. Năm badge dùng nhãn workflow tùy chỉnh không khớp bộ nhãn trạng thái mặc định; chưa đối chiếu ngữ nghĩa từng nhãn tùy chỉnh với cấu hình workflow nên không tính các trường hợp này là đã xác minh hoàn toàn.
- Không mở/in phiếu: chi tiết món và tiền đã hiển thị inline trên thẻ. Luồng modal in/đóng phiếu và tác động đếm lượt in chưa được kiểm tra. Browser console và page errors đều bằng 0.
- CodeGraph: `codegraph status`; `codegraph node 'src/app/(auth)/login/page.tsx' --offset 82 --limit 230`; `codegraph node 'src/app/(auth)/login/page.tsx' --offset 680 --limit 110`; `codegraph node 'src/app/(dashboard)/dashboard/orders/page.tsx' --offset 1430 --limit 220`; `codegraph node 'src/app/(dashboard)/dashboard/orders/page.tsx' --offset 1643 --limit 160`; `codegraph node 'src/app/(dashboard)/dashboard/orders/page.tsx' --offset 1703 --limit 80`; `codegraph node 'src/app/(dashboard)/dashboard/orders/page.tsx' --offset 1786 --limit 145`; `codegraph node formatCurrency`; các truy vấn trước đó `codegraph query todayTabState`, `codegraph query filterCounterTodayTabOrders`, `codegraph node filterCounterTodayTabOrders`, `codegraph node computeCounterTodayTabState`, `codegraph query useDashboard`, `codegraph explore "dashboard orders page filterTab order card data-testid receipt print modal QR modal"`. Vùng ảnh hưởng: đăng nhập chủ quán, shop đang chọn, API GET shops/orders, bộ lọc Orders và thẻ chi tiết đơn.
- AGY Flash Low đã chạy lại đúng script sau khi Codex sửa chọn system Chrome và submit form chủ quán; run `2026-10-30T13-48-37-551Z-8a7c108a` trả exit 0. Codex tự chạy lại độc lập, nhận cùng các số liệu và `git diff --check` cho phần log đạt. Không sửa source hoặc dữ liệu production.
- Claude CLI được gọi trực tiếp theo cấu hình máy nhưng gateway trả `unrecognized_model deepseek`; lượt Claude không tạo được review. Evidence QA đã lược thông tin tại `.agy-runs/orders_readonly_codex_2026-10-30.json` (mode `0600`). Chưa bao phủ modal in/đóng phiếu hoặc đối chiếu ngữ nghĩa năm nhãn workflow tùy chỉnh.

## 68. P1-5: khóa API admin không cho hoàn tất đơn đồng thời xác nhận đã thu tiền (2026-10-30)

- Logic đã có từ commit `93e1218`: `POST /api/admin` trả HTTP 400 `PAYMENT_STATUS_REQUIRES_VERIFIED_TRANSACTION` nếu `update_order_status` gửi `payment_status: 'paid'`; xác nhận thu tiền phải đi qua giao dịch đã kiểm chứng. UI khi hoàn tất chỉ gửi trạng thái fulfillment.
- Bổ sung regression test gọi trực tiếp `POST /api/admin` với `status: 'completed'` và `payment_status: 'paid'`. Test xác nhận đúng mã lỗi và ngoài truy vấn readiness chỉ đọc `shops`, API không tải/ghi đơn hàng trước khi từ chối payload.
- CodeGraph: `codegraph status`; `codegraph explore "tests/admin-review.test.ts adminPost POST /api/admin update_order_status requireSuperAdmin mock auth cookie"`; `codegraph explore "requireSupabaseServiceRoleClient hasSupabaseServiceRoleKey test override fake SUPABASE_SERVICE_ROLE_KEY NEXT_PUBLIC_SUPABASE_URL"`; `codegraph node src/app/api/admin/route.ts --offset 385 --limit 120`; `codegraph node src/app/api/admin/route.ts --offset 743 --limit 95`; `codegraph node tests/admin-review.test.ts --offset 1180 --limit 145`; `codegraph node tests/admin-review.test.ts --offset 1540 --limit 110`; `codegraph sync`; `codegraph affected tests/admin-review.test.ts`. Vùng ảnh hưởng: admin route, session Super Admin, Supabase readiness guard và regression test API.
- Checks: `tests/admin-review.test.ts` — **13/13 PASS**; toàn bộ `npm run test:review` — **384/384 PASS**; `git diff --check` đạt. Bộ review test có các cảnh báo `SESSION_SECRET`/audit ghi fixture, cảnh báo ESM của Node và lỗi dự kiến từ các test mô phỏng thất bại DB; không test nào fail.

## 69. Orders: đối chiếu nhãn badge với workflow/API QA (2026-10-30)

- Đăng nhập lại bằng tài khoản QA trong `.env.testing` sau khi storage state cũ hết hạn; không ghi credential vào evidence. Mở tab “Tất cả”, dùng API GET của shop và `/api/orders` với `includeCatalog=0&includeStats=0`; hai API đều HTTP 200.
- Đối chiếu đủ **11/11** badge UI với order API: 4 `new` → “Chờ bếp nhận”, 6 `cancelled` → “Đã hủy”, 1 `completed` → “Đã phục vụ”; **0 mismatch**. Shop không lưu `theme_config.orderWorkflow`, nên renderer dùng template built-in `classic_kitchen`. Năm nhãn trước đó bị ghi là “workflow tùy chỉnh” thực tế là nhãn step mặc định cho 4 đơn mới và 1 đơn hoàn tất; ngữ nghĩa khớp template.
- Chỉ có các request đăng nhập và GET để đọc dữ liệu QA; không có POST/PUT/PATCH/DELETE nghiệp vụ. Browser console sau đăng nhập: 0 error; đã đóng browser.
- CodeGraph: `codegraph status`; `codegraph node resolveShopOrderWorkflowConfig`; `codegraph node BUILT_IN_ORDER_WORKFLOW_TEMPLATES`; `codegraph node DEFAULT_CANONICAL_ORDER_STATUS_LABELS`; `codegraph node resolveStaffOrderStepLabel`; `codegraph node 'src/app/(dashboard)/dashboard/orders/page.tsx' --offset 1630 --limit 180`; `codegraph node src/app/api/shops/route.ts --offset 70 --limit 175`. Khu vực đã kiểm: GET shop/config, GET orders, `workflow_step_id`, template fallback và badge renderer.
- Không sửa source; đối chiếu production chỉ đọc, dùng tài khoản QA. `git diff --check` sẽ được chạy trước commit.

## 70. Orders: mở/đóng phiếu xem trước mà không ghi lượt in (2026-10-30)

- AGY Flash Low production QA run `2026-10-30T14-23-03-216Z-9ca7d824` dùng phiên browser riêng, tài khoản QA lấy trong bộ nhớ từ `.env.testing`. Modal `ReceiptPrintModal` mở từ nút “In tạm tính”, hiển thị các loại phiếu, khổ giấy và nút in; đóng bằng control “Đóng”. Không bấm in hoặc xác nhận thanh toán.
- Codex chạy lại độc lập trong phiên riêng: xác nhận modal và các tab phiếu hiển thị, click `button[aria-label="Đóng"]`, rồi xác nhận các tab và nút đóng biến mất. Lịch sử browser có 24 request dòng: 4 POST là đăng nhập (`/api/auth` và `/api/auth/login-ui`); **0 POST/PUT/PATCH/DELETE nghiệp vụ**, trong đó **0 POST `/api/orders`**. Không phát sinh lượt in, không sửa dữ liệu đơn.
- AGY báo session sạch có 0 console error/warning. Phiên Codex bắt đầu với storage state hết hạn và ghi nhận 1 console error trước đăng nhập; số error không tăng trong thao tác mở/đóng modal. Không thấy lỗi UI mới.
- CodeGraph: `codegraph status`; `codegraph explore "owner dashboard orders receipt print preview modal close button increment print count printOrder"`; `codegraph node ReceiptPrintModal`; `codegraph explore "src/app/(dashboard)/dashboard/orders/page.tsx ReceiptPrintModal selectedOrder onClose initialTicketType print button"`. Đường gọi ghi lượt in chỉ chạy từ thao tác in tường minh; nút đóng gọi `onClose`. Khu vực: Orders dashboard, `ReceiptPrintModal`, `POST /api/orders` action `record_print`.
- Không sửa source/test; chỉ bổ sung evidence QA. `git diff --check` đạt. Không chạy test/build riêng vì thay đổi chỉ là tài liệu; deploy workflow được kiểm tra độc lập theo commit mới.

## 71. QR Studio: lọc khu vực và marker sơ đồ bàn (2026-10-30)

- AGY Flash Low đã chạy production QA read-only run `2026-10-30T14-42-00-853Z-c8b2639b`. Codex tự kiểm chứng độc lập bằng Chrome CDP trên profile tạm; profile được xóa sau khi chạy.
- Guard ở tầng network chỉ cho phép GET/HEAD/OPTIONS và POST cùng origin vào `/api/auth`; chặn các request ghi khác. Kết quả: 84 GET, 2 POST đăng nhập, 0 lần gọi POST/PUT/PATCH/DELETE nghiệp vụ và không có request ghi bị chặn. Không tạo/sửa/lưu trữ bàn, kéo marker hoặc tạo đơn.
- `GET /api/tables/floor-plan` trả HTTP 200 với 1 bàn; legend và canvas đều hiển thị đúng 1 marker. Chọn lần lượt cả 2 khu vực không phải ALL cho 0 marker mỗi khu vực, khớp số bàn API; khôi phục ALL trả lại 1 marker.
- Marker duy nhất đã selected (`data-selected=true`, `aria-pressed=true`) từ lúc tải. Click giữ trạng thái selected; vì chỉ có một marker nên lượt này **không chứng minh transition** từ unselected sang selected.
- Console error: 0; page exception: 0. Không sửa source hoặc dữ liệu production.
- CodeGraph: `codegraph status` (index up-to-date, được xây bằng engine cũ); `codegraph explore "ShopTableFloorPlanCanvas marker data-selected aria-pressed selection click handler"`; `codegraph explore "ShopTableManager QR Studio area section filter selected section markers onSelectTable floor plan buttons data-testid"`; `codegraph explore "ShopTableFloorPlanCanvas marker role button aria-pressed data-selected selectedTableId onClick"`; `codegraph node ShopTableFloorPlanCanvas`; `codegraph node ShopTableManager`. Phạm vi: QR Studio, `ShopTableManager`, canvas sơ đồ bàn, GET `/api/tables/floor-plan` và bộ lọc khu vực.

## 72. Đối chiếu lại P1-2 và P1-7, khóa race khi chuyển shop ở Catalog (2026-10-30)

- **P1-2 — `demo_login`: fixed theo source/test.** `POST /api/auth` chỉ cho qua khi `NODE_ENV !== 'production'` và `ENABLE_DEMO_LOGIN === 'true'` (`src/app/api/auth/route.ts:780-795`); guard chạy trước `ensureSupabaseReadyAndSeeded()` (`:811`) và trước đoạn phát session owner (`:814-839`). Nhánh `login` trực tiếp vẫn trả `400 OIDC_REQUIRED` (`:798-808`), ngoại trừ nhánh staff login có định danh quán và mật khẩu riêng (`:622-683`). Regression test kiểm tra flag thiếu/sai, production kể cả khi bật flag, login seed cũ không có session, và demo login chỉ bật ở test mode (`tests/zitadel-oidc-auth-review.test.ts:1950-2083`). Đây là xác minh source/test; không gọi endpoint production trong lượt này.
- **P1-7 — đổi shop Catalog: fixed theo source và harness regression.** `loadCatalog` gắn từng response với shop ID và request sequence, bỏ response cũ (`src/app/(dashboard)/dashboard/catalog/page.tsx:311-356`; predicate `src/lib/dashboard-catalog.ts:16-26`). Các thao tác đơn giữ xác nhận shop/item; bulk handlers giữ `expectedShopId`, kiểm tra lại sau hộp xác nhận xóa và trước khi áp response/lỗi/toast/clear selection, đồng thời không xóa cờ pending của shop mới (`src/app/(dashboard)/dashboard/catalog/page.tsx:1156-1269`, `:1271-1473`, `:1475-1583`, `:1585-1734`). API nhận shop ID tường minh và vẫn kiểm membership/quyền trước khi ghi (`src/app/api/catalog/route.ts:671-678` cùng kiểm tra item/category thuộc shop đích). Request đã được gửi có thể hoàn tất trên shop khởi phát; response cũ không được áp vào UI shop mới. Hành vi này được ghi tại `docs/CATALOG_BULK_ACTIONS.md`.
- Regression harness mô phỏng chuyển shop khi hộp xóa đang mở (không gửi POST) và khi request availability đang bay; xác nhận response cũ không đổi `is_available` của món shop mới và không hiện success toast (`tests/catalog-dashboard-review.test.ts:1349-1538`). Predicate mới `isCurrentCatalogShop` có test cho ID khớp, khác, rỗng và unset (`src/lib/dashboard-catalog.ts:33-42`; `tests/catalog-dashboard-review.test.ts:69-112`).
- CodeGraph thực tế: `codegraph status`; `codegraph explore "POST /api/auth demo_login owner session production gate explicit flag legacy login"`; `codegraph explore "catalog page shop switch activeShopIdRef requestSeq stale response mutation submit shop_id"`; `codegraph node src/app/api/auth/route.ts --offset 620 --limit 250`; `codegraph node tests/zitadel-oidc-auth-review.test.ts --offset 1950 --limit 90`; `codegraph node 'src/app/(dashboard)/dashboard/catalog/page.tsx' --offset 210 --limit 220`; `codegraph node 'src/app/(dashboard)/dashboard/catalog/page.tsx' --offset 430 --limit 370`; `codegraph node 'src/app/(dashboard)/dashboard/catalog/page.tsx' --offset 1117 --limit 360`; `codegraph node 'src/app/(dashboard)/dashboard/catalog/page.tsx' --offset 1451 --limit 300`; `codegraph node src/app/api/catalog/route.ts --offset 495 --limit 260`; `codegraph node tests/catalog-dashboard-review.test.ts --offset 1 --limit 260`; `codegraph callers isCurrentCatalogShop`; `codegraph affected 'src/app/(dashboard)/dashboard/catalog/page.tsx' src/lib/dashboard-catalog.ts tests/catalog-dashboard-review.test.ts`; `codegraph sync`. Index up-to-date; engine warning remains.
- AGY Flash Low implementation run `2026-10-30T15-07-39-981Z-046cfc54`; Codex independently reviewed diff and strengthened the stale-response assertion. Checks: catalog dashboard test **12/12 PASS**, catalog API/Excel test **37/37 PASS**, full `npm run test:review` **385/385 PASS**, `npm run typecheck` PASS, ESLint on the three changed code files PASS, `git diff --check` PASS.
- **Follow-up live-browser attempt (2026-10-30) — inconclusive:** the synthetic shop B catalog GET did not match the Playwright route handler, reached the actual catalog API, and returned `404`; the browser scheduler race was therefore not exercised. The QA login's auth POSTs were allowed, but no catalog POST/PATCH/DELETE or database writes occurred. Production mutation behavior remains unverified; P1-7 is currently supported by source and regression-harness tests only. The browser harness needs its catalog route interception corrected before this live-browser check can close.

## 73. Đóng dứt điểm P3-26: xóa helper mobile dead code và cập nhật recovery test (2026-10-30)

- **Nguyên nhân và thực trạng:** `mobile/src/lib/auth-recovery.ts` vốn là dead code (466 dòng, 0 importer trong ứng dụng mobile runtime). Ứng dụng mobile sử dụng luồng Zitadel tùy chỉnh qua `mobile/src/components/AuthScreen.tsx` (`defaultOwnerResetRequest` gọi endpoint `/api/auth/login-ui`). Module này trước đó được giữ lại chỉ vì `tests/unit.test.ts` (test R.2) còn import và assert các helper OTP/request của nó.
- **Thay đổi thực hiện:**
  - Xóa hoàn toàn file dead code `mobile/src/lib/auth-recovery.ts`.
  - Cập nhật `tests/unit.test.ts`: gỡ bỏ import từ module mobile; loại bỏ các assertion/call chỉ phục vụ helper mobile cũ (phân giải URL mobile, `requestMobilePasswordRecovery`, `completeMobilePasswordRecoveryWithCode`); giữ nguyên toàn bộ assertion helper của web (`src/lib/auth-recovery.ts`) và các test bảo vệ quyền riêng tư/chống enumeration email của API `POST /api/auth` action `check_recovery`; chuyển assertion thông báo generic tiếng Việt sang gọi web helper `formatWebGenericPasswordRecoveryNotice`.
  - Cập nhật tiêu đề test R.2 phản ánh chính xác phạm vi test web và API hiện tại: không còn tuyên bố kiểm thử luồng mobile OTP recovery.
  - Cập nhật mục 2 tại `docs/APP_REVIEW.md` và các ghi chú tóm tắt P3-26 trong `docs/CLAUDE_CODE_REVIEW_2026-10-27.md`.
- **CodeGraph thực tế:**
  - `codegraph status`
  - `codegraph explore "mobile AuthScreen defaultOwnerResetRequest Zitadel auth-recovery imports"`
  - `codegraph node mobile/src/lib/auth-recovery.ts`
  - `codegraph node src/lib/auth-recovery.ts`
  - `codegraph callers PASSWORD_RECOVERY_LOGIN_MODE`
  - `codegraph callers completeMobilePasswordRecoveryWithCode`
  - `codegraph callers requestMobilePasswordRecovery`
  - `codegraph callers parseRecoveryUrlSignals`
  - `codegraph callers formatGenericPasswordRecoveryNotice`
  - `codegraph affected mobile/src/lib/auth-recovery.ts tests/unit.test.ts`
  - `codegraph sync`
- **Vùng ảnh hưởng:** `mobile/src/lib/auth-recovery.ts` (xóa), `tests/unit.test.ts` (test R.2), tài liệu đánh giá và review (`docs/APP_REVIEW.md`, `docs/CLAUDE_CODE_REVIEW_2026-10-27.md`).
- **Checks Codex chạy độc lập:** `npm run test:unit` **140/140 PASS**; `npm run test:review` **385/385 PASS**; `npm --prefix mobile test` **118/118 PASS**; `npm run typecheck` PASS; `npm --prefix mobile run typecheck` PASS; `npm run build` PASS; `npx eslint tests/unit.test.ts` PASS; `git diff --check` PASS. Build chỉ còn các warning lint ảnh/React hook hiện có ở file khác.
- **Unverified items:** Không chạy app mobile trên thiết bị và không gọi production auth; runtime auth không đổi. P1-7 live-browser scheduler race vẫn riêng lẻ chưa xác minh, như đã ghi ở mục 72.

## 74. Storefront ngôn ngữ theo gói — QA chỉ đọc (2026-10-31)

- AGY Flash Low chạy browser QA với đúng shop QA lấy từ `.env.testing`; không ghi thông tin nhận dạng shop, tài khoản, slug, ID, cookie hay token vào evidence. Network guard chỉ cho GET/HEAD/OPTIONS. 31 GET trả HTTP 200; một POST analytics tự động tới `/api/analytics/track` bị chặn tại browser trước khi tới server. Không có lỗi console/runtime và không có file source thay đổi.
- API read-back độc lập của Codex: `GET /api/shops?slug=…` trả 200 và khớp chính xác tên shop QA; `GET /api/catalog?shopId=…` trả 200, `ownerPlan=free`, 1 danh mục và 1 món. API projection chứa 8 mã cấu hình ngôn ngữ (`vi/en/ko/ja/zh/es/it/ru`), nhưng storefront gọi `getAllowedLocalesForPlan` với gói hiện hành; gói Free có `maxLangs=1`, nên danh sách hiệu lực chỉ còn `vi`. `LanguageSwitcher` chỉ render lựa chọn trong danh sách hiệu lực.
- Browser xác nhận UI chỉ có tiếng Việt và không hiện các lựa chọn không được gói hỗ trợ. Vì shop QA đang ở gói Free, không thể thực hiện chuyển sang EN hoặc kiểm tra persistence sau reload mà không đổi cấu hình shop; không đổi gói, cài đặt, fixture hay dữ liệu production. `qlaok_lang` ban đầu chưa có giá trị và trang mặc định `vi`.
- CodeGraph: `codegraph explore "storefront language switcher locale change supported_langs persistence"`; `codegraph node LanguageSwitcher`; `codegraph callers LanguageSwitcher`; `codegraph callers getAllowedLocalesForPlan`; `codegraph node PLAN_CONFIGS`; `codegraph node src/lib/plan-limits.ts --offset 72 --limit 65`; `codegraph node 'src/app/(storefront)/s/[slug]/page.tsx' --offset 35 --limit 65`; `codegraph node 'src/app/(storefront)/s/[slug]/menu/page.tsx' --offset 140 --limit 65`; `codegraph node src/app/api/shops/route.ts --offset 185 --limit 250`; `codegraph node src/app/api/catalog/route.ts --offset 186 --limit 75`. Phạm vi: `LanguageSwitcher`, hai trang storefront, `GET /api/shops`, `GET /api/catalog` và giới hạn locale theo gói.
- AGY run `2026-10-30T16-59-04-864Z-ae57b5c4` — `gemini-3.8-flash-low`, kết quả `SUCCESS`; Codex xác minh độc lập bằng hai GET production và CodeGraph. Không sửa source nên không chạy test/build; chỉ kiểm tra tài liệu bằng `git diff --check`.
- **Chưa xác minh:** API production của một shop Basic/Premium và cấu hình gói thực tế cho locale. UI chuyển locale và lưu qua reload trên fixture Premium được kiểm tra ở mục 76. P1-7 browser scheduler race được kiểm tra bổ sung trong browser QA cô lập tại mục 75; mục 72 ghi lại lần thử production trước đó chưa exercise được race.

## 75. P1-7 Catalog: browser QA cô lập race khi đổi shop (2026-10-31)

- Dùng Playwright CLI trên Next.js local tại HEAD `b7b7eced229c81df7cacfa76201e65dbc54e06cb`, với localStorage, hai shop và catalog response tổng hợp hoàn toàn giả. Route toàn bộ API trước khi mở `/dashboard/catalog`; mọi GET API được mock, request ngoài origin bị chặn, mọi method ngoài GET/HEAD/OPTIONS bị abort trước khi tới server.
- Giữ request Catalog của shop A chưa trả lời, chọn shop B trên selector thật, đợi item riêng của B hiển thị rồi mới trả response cũ của A. Sau response cũ, shop selector vẫn là B, item B còn hiển thị và không có item A nào xuất hiện.
- Kết quả network/runtime: 8 API GET được phục vụ bởi fixture; 0 write request và 0 external request; 0 page exception; console có 0 error và 0 warning (chỉ có thông báo INFO của React DevTools). Không chạm production API hoặc dữ liệu.
- Đây là browser regression QA cho frontend cùng commit đã deploy, không phải xác nhận hành vi mạng production. Kết hợp với source guard và regression harness tại mục 72, race response cũ khi đổi shop đã được exercise trong browser; lần thử production nêu ở mục 72 vẫn được giữ như bằng chứng lịch sử về giới hạn của lần thử đó.
- **CodeGraph:** `codegraph status`; `codegraph explore "DashboardShell shop selector activeShop selectShop dashboard layout"`; `codegraph explore "catalog dashboard shop selection race activeShopIdRef catalogLoadSequenceRef loadCatalog"`; `codegraph node 'src/app/(dashboard)/dashboard/catalog/page.tsx' --offset 260 --limit 155`; `codegraph node 'src/lib/dashboard-context.tsx' --offset 1 --limit 190`; `codegraph node 'src/lib/dashboard-context.tsx' --offset 175 --limit 115`; `codegraph node 'src/types/qlaok.ts' --offset 185 --limit 95`. Phạm vi: shop selector trong dashboard, `DashboardProvider.selectShop`, `loadCatalog`, request sequence guard và catalog UI.
- **Checks:** `npm run dev`; Playwright CLI controlled browser flow trên `/dashboard/catalog`; `git diff --check`. Không sửa source nên không chạy test/build.
- **Còn mở:** API production của shop Basic/Premium như mục 74; UI locale switch trên fixture Premium được kiểm tra tại mục 76. Các mục khác chưa được QA trong goal vẫn tiếp tục mở.

## 76. Storefront locale: chuyển sang EN và lưu qua reload trên fixture Premium (2026-10-31)

- AGY Flash Low run `476db34e-90cf-4666-af5e-8bb67c3d16f5` dùng browser Chrome và fixture tổng hợp `ownerPlan=premium`, `supported_langs=vi/en/ko/ja` trên frontend production. Codex chạy lại độc lập cùng flow. Không đọc `.env.testing`, không dùng tài khoản hoặc dữ liệu shop thật.
- Cả hai flow khởi đầu với giao diện VI, chọn EN, xác nhận `document.documentElement.lang=en`, lưu `qlaok_lang=en`, tagline tiếng Anh hiển thị; reload vẫn giữ EN và tagline tiếng Anh. AGY ghi nhận 67 request tổng: 63 asset cùng origin, 2 GET `/api/shops` được fixture mock, 2 POST analytics được mock 200; 0 business write không-mock, 0 external request, 0 page error và 0 console error. Codex độc lập xác nhận 2 API GET, 2 analytics POST mock, 0 external request và 0 runtime/console error.
- Browser gọi frontend tại production host nhưng response dữ liệu storefront trong browser được mock trước navigation; SSR metadata của synthetic slug là fallback “không tìm thấy cửa hàng”. Không có production API write. Đây chỉ xác nhận locale UI và localStorage khi plan cho phép nhiều ngôn ngữ; không xác nhận API production trả plan hoặc supported locales cho shop Basic/Premium thật.
- **CodeGraph:** `codegraph status`; `codegraph explore "LanguageSwitcher allowedLocales locale selection localStorage onChange storefront"`; `codegraph query detectVisitorLocale`; `codegraph node detectVisitorLocale`; `codegraph node 'src/app/(storefront)/s/[slug]/page.tsx' --offset 1 --limit 175`; `codegraph node 'src/components/storefront/LanguageSwitcher.tsx' --offset 1 --limit 145`. Phạm vi: `LanguageSwitcher`, trang storefront door, `detectVisitorLocale`, giới hạn locale theo gói.
- **Checks:** AGY Playwright QA; Codex Playwright CLI QA; `GET /api/health` sau deploy trả HTTP 200. Không sửa source nên không chạy test/build; CI trên commit `55e31df` đã chạy full suite và deploy success.
- **Còn mở:** Đối chiếu locale với API production trên shop Basic/Premium thật khi có shop phù hợp; không đổi plan hoặc dữ liệu production trong QA này.

## 77. P2-1: production QA public catalog sau khi whitelist response (2026-10-31)

- AGY Flash Low run `2026-10-30T17-46-45-032Z-288b00cc` gọi đúng 4 GET trên host production: resolve shop QA đã publish trong bộ nhớ, đọc catalog, thiếu `shopId`, và ID giả không tồn tại. Kết quả lần lượt: `200`, `200`, `400 SHOP_ID_REQUIRED`, `404 SHOP_NOT_FOUND`. Response catalog có `shop`, không có `owner_id`, và chỉ chứa trường trong allowlist; API trả 1 category và 1 item. Không ghi ID, slug, tên hay giá trị dữ liệu vào báo cáo.
- Codex gọi lại độc lập cùng bốn GET và xác nhận toàn bộ status, allowlist, `owner_id` absent, cùng số lượng category/item. Không đăng nhập, không gọi phương thức ghi, không sửa dữ liệu production hay source.
- **CodeGraph:** `codegraph status`; `codegraph node src/app/api/catalog/route.ts --offset 160 --limit 100`; `codegraph node dbGetShopCatalog`; `codegraph node src/app/api/shops/route.ts --offset 68 --limit 100`. Phạm vi: public shop lookup, projection `/api/catalog`, publish gate và xử lý shop không tồn tại.
- **Checks:** AGY Flash Low production QA **PASS**; Codex GET-only read-back **PASS**; `git diff --check` chạy trước commit. Không chạy test/build vì lượt này chỉ cập nhật tài liệu.
- **Chưa xác minh:** không probe trực tiếp shop chưa publish; quyền chặn caller ẩn danh được xác nhận từ source, chưa có fixture phù hợp để kiểm tra runtime.

## 78. P3-12: đồng bộ danh sách migration hiện hành trong tài liệu (2026-10-31)

- README đã liệt kê đến `20261030000200` nhưng còn thiếu `20261030000300_admin_owner_invitation_claims.sql`. Cùng migration mới cũng được thêm vào danh sách và phạm vi trạng thái trong `ARCHITECTURE.md` và `docs/SELF_HOSTED_POSTGRES_ZITADEL.md`.
- Migration bổ sung `profiles.owner_invite_pending`, đánh dấu các hồ sơ owner invitation cũ phù hợp và dùng trigger để chặn client tự tạo hoặc sửa cờ lời mời. Không sửa SQL hay trạng thái database.
- **Checks:** đối chiếu thứ tự với danh sách migration thực tế; `git diff --check`. Không chạy test/build vì chỉ sửa tài liệu.

## 79. Storefront theme contrast: sửa kết luận QA sai và đo lại trên production (2026-10-31)

- Bản QA đầu ghi 4.23:1 nhưng dùng ngưỡng luminance tự đặt `0.45`, không đo màu chữ thực tế đã render. Kết quả đó bị hủy, không dùng để kết luận giao diện lỗi.
- AGY Flash Low run `2026-10-30T18-18-00-534Z-c07abde0` đo DOM bằng Playwright CLI trên storefront production của tài khoản QA. CTA trang thông tin quán, tiêu đề và phụ đề sticky header của menu đều đạt **4.76:1** (WCAG AA normal text: 4.5:1). Màu nền render khớp màu theme đã chọn.
- Network: 60 GET trả HTTP 200; một POST analytics được mock thành HTTP 204; không có mutation nghiệp vụ, request external hoặc lỗi console/page. Report đã lược thông tin nhận dạng và màu hex nằm trong thư mục AGY local.
- CodeGraph: `codegraph status`; `codegraph explore "getAccessibleAccentTextColor getContrastTextColor storefront menu header primaryTextColor"`; `codegraph node src/lib/theme-contrast.ts`; `codegraph node 'src/app/(storefront)/s/[slug]/page.tsx' --offset 180 --limit 230`; `codegraph node 'src/app/(storefront)/s/[slug]/menu/page.tsx' --offset 780 --limit 160`; `codegraph node 'src/app/(storefront)/s/[slug]/menu/page.tsx' --offset 1025 --limit 70`. Codex đối chiếu `getContrastTextColor`/`isLightColor` và caller storefront; `tests/storefront-theme-header-review.test.ts` **6/6 PASS** với các nhóm màu khác nhau. Codex chưa chạy lại browser production độc lập; tỷ lệ live là bằng chứng từ lượt AGY.
- Phạm vi: `src/lib/theme-contrast.ts`, storefront door CTA và menu sticky header; source không đổi. Chỉ cập nhật QA record.

## 80. P2-1: regression test chặn catalog của shop chưa publish

- Bổ sung test route với shop/category/item/owner sentinel tổng hợp và request anonymous. `GET /api/catalog` phải trả đúng `404 SHOP_NOT_FOUND`, không có trường `shop`, `categories`, `items`, `ownerPlan` và không lộ sentinel.
- CodeGraph: `codegraph status`; `codegraph explore "GET /api/catalog is_published false unpublished shop owner_id projection shopId"`; `codegraph explore "catalog route publish gate tests GET SHOP_NOT_FOUND"`; `codegraph node src/app/api/catalog/route.ts --offset 160 --limit 200`; `codegraph node requireShopPermission`; `codegraph node requireAuthenticatedUser`; `codegraph callers createMockSupabaseForGetShopCatalog`; `codegraph node tests/unit.test.ts --offset 6588 --limit 160`; `codegraph node tests/unit.test.ts --offset 6740 --limit 230`. Ảnh hưởng chỉ gồm mock/test ở `tests/unit.test.ts`; route và behavior production không đổi.
- Checks Codex: test mới qua **1/1**; `npm run test:unit` **141/141 PASS**; `npm run typecheck` PASS; `git diff --check` PASS.
- Chưa gọi route bằng một shop unpublished thật trên production. Test xác nhận regression bằng DB mock cô lập; không tạo fixture hoặc ghi dữ liệu production.

## 81. P2-14: regression coverage cho quyền Settings theo nhóm field

- Source hiện tại đã tách quyền `settings.manage` và `settings.bank`: PATCH chỉ yêu cầu quyền cho nhóm field đổi; payload general settings có thể gửi lại bank block không đổi. `/dashboard/settings` cũng cho vào bằng một trong hai quyền. Lượt này không sửa route hoặc UI, chỉ bổ sung coverage API cho phần phân quyền hiện có.
- `R.3c PATCH /api/shops` giờ kiểm tra thành viên chỉ có `settings.manage` lưu được thông tin chung và gửi lại `paymentConfig` không đổi; payload chỉ có `theme_config` với cả hai block không đổi; quyền đó không đổi được số tài khoản; thành viên chỉ có `settings.bank` đổi được cấu hình ngân hàng nhưng không đổi được tên quán. Hai nhánh bị từ chối đều xác nhận không có DB update.
- AGY review run `2026-10-30T18-35-06-003Z-a829c492` (`claude-sonnet-5-5-low`, plan/read-only) không phát hiện lỗi trong bốn permission case và chỉ ra test ban đầu chưa chạm nhánh payload `theme_config` không đổi. Codex thêm case đó ở bước 8b và chạy lại test sau khi chỉnh. AGY không chạy test và không review phiên bản cuối sau bước 8b.
- **CodeGraph:** `codegraph status` (index up-to-date; engine cũ); `codegraph explore "GET /api/shops PATCH settings manage bank permission theme config field allowlist dashboard-nav anyOf settings page save"`; `codegraph node src/app/api/shops/route.ts --offset 714 --limit 140`; `codegraph node src/app/api/shops/route.ts --offset 843 --limit 216`; `codegraph node 'src/app/(dashboard)/dashboard/settings/page.tsx' --offset 570 --limit 100`; `codegraph node src/lib/dashboard-nav.ts`; `codegraph node requireShopPermission`; `codegraph node dbUpsertShopMembership`; `codegraph node ShopPaymentConfig`; `codegraph node ShopThemeConfig`; `codegraph node tests/unit.test.ts --offset 3740 --limit 310`; `codegraph node tests/unit.test.ts --offset 4030 --limit 180`. Phạm vi: PATCH `/api/shops`, payload trang Settings, yêu cầu điều hướng dashboard và regression test.
- **Checks Codex:** focused test `R.3c PATCH /api/shops` **1/1 PASS**; `npm run test:unit` **141/141 PASS**; `npm run typecheck` PASS; `git diff --check` PASS. Unit test hiện phát các cảnh báo dev `SESSION_SECRET` và MODULE_TYPELESS_PACKAGE_JSON; test vẫn pass.
- **Chưa xác minh:** không chạy browser hoặc production API với membership thật; hành vi được kiểm bằng route và membership giả lập. Phần UI chỉ được đối chiếu qua source và test điều hướng hiện có.

## 82. P2-15: khóa upload ảnh Catalog và giá tùy chỉnh POS theo quyền

- **Vấn đề:** thumbnail của món vẫn là upload input dù thành viên chỉ có `inventory.adjust`, làm lộ đường tải ảnh vốn thuộc `catalog.manage`. Trong POS, quyền `discount.apply` đã khóa chiết khấu nhưng chưa khóa chế độ nhập giá tùy chỉnh; API từ chối lưu nhưng UI vẫn cho thao tác.
- **Sửa:** `QuickItemRow` chỉ render thumbnail không tương tác cho người thiếu `catalog.manage`, chỉ render label/file input cho người có quyền đó, và handler upload cũng từ chối sớm nếu thiếu quyền. Stock controls vẫn dựa riêng vào `inventory.adjust`. POS ẩn nút Giá khi thiếu `discount.apply`, từ chối xử lý phím ở cả mode `disc` lẫn `price`, và chuyển về mode số lượng nếu quyền bị thu hồi khi component còn mở.
- **Regression coverage:** test render role chỉ có inventory xác nhận không có file input và vẫn có stock control; test role quản lý catalog xác nhận upload còn hoạt động. Test `isNumpadModeAllowed` xác nhận mode số lượng dùng được không cần quyền, còn chiết khấu/giá tùy chỉnh cần `discount.apply`.
- AGY implementation run `2026-10-30T18-47-05-987Z-1ffd8eb2` dùng `claude-sonnet-5-5-low` sau khi kiểm tra model/quota. AGY báo test mới 3/3, typecheck và diff check pass; đây là run triển khai, không phải review độc lập phiên bản cuối.
- **CodeGraph:** `codegraph status` (303 files, index up-to-date; engine cũ); `codegraph explore "QuickItemRow canManageCatalog thumbnail item-thumbnail-preview handleDirectPhotoSelect catalog image permissions"`; `codegraph explore "PosCounterWorkspace isNumpadModeAllowed canApplyDiscount price mode qty permission"`; `codegraph node tests/catalog-pos-permission-controls-review.test.ts`; `codegraph node src/components/dashboard/PosCounterWorkspace.tsx --offset 1825 --limit 40`; `codegraph node src/components/dashboard/QuickItemRow.tsx --offset 255 --limit 100`. Phạm vi gồm `QuickItemRow`, trang Catalog truyền quyền catalog/kho, POS truyền `discount.apply`, handler tải ảnh, chế độ numpad và regression test.
- **Checks Codex:** `npm run test:review` **388/388 PASS**; `npm run typecheck` PASS; `git diff --check` PASS. Test suite có warning cấu hình module và cảnh báo SESSION_SECRET trong môi trường test; không làm test thất bại.
- **Chưa xác minh:** không chạy browser/production với membership thật. POS UI ẩn nút Giá, effect reset mode và handler upload guard được đối chiếu qua source; test tự động kiểm tra helper phân quyền và markup Catalog, chưa render toàn bộ POS component hay gọi handler upload qua tương tác DOM.

## 83. Đối chiếu P2-16 đến P2-20: mobile API URL, locale và thông báo lỗi (2026-10-31)

- Đối chiếu CodeGraph cho thấy các mục này đã có implementation trong source; lượt này không sửa code. P2-16/17: mobile đọc `EXPO_PUBLIC_API_URL`, chỉ chấp nhận URL HTTPS ở production, cho phép HTTP loopback/private khi dev và có fallback theo platform; `AuthScreen` dùng chung `API_BASE_URL`. P2-18: `lang` trên URL login chỉ được áp dụng một lần qua ref guard, nên đổi ngôn ngữ thủ công sau đó không bị query ghi đè. P2-19: lỗi bảng/storefront được ánh xạ sang nhãn đã localize; thông báo không nhận diện dùng fallback chung thay vì lộ raw server message. P2-20: danh sách locale được suy ra từ plan bằng `getAllowedLocalesForPlan` và truyền vào storefront switcher.
- **CodeGraph:** `codegraph explore "mobile API_BASE_URL resolveMobileApiBaseUrl EXPO_PUBLIC_API_URL production HTTPS private HTTP dev; login lang useEffect useRef one-time query; localizeStorefrontTableError raw server errors; storefront allowed locales getAllowedLocalesForPlan language switcher"`. Phạm vi đối chiếu: `mobile/src/lib/api-base-url.ts`, `mobile/src/lib/supabase.ts`, `mobile/src/components/AuthScreen.tsx`, trang login, helper i18n lỗi bảng, storefront door/menu và test locale.
- **Checks Codex:** `node --experimental-strip-types --test mobile/tests/api-base-url.test.ts` **3/3 PASS**; `npm run test:unit` **141/141 PASS**; `npm run typecheck` PASS.
- **Chưa xác minh:** không chạy thiết bị iOS/Android hoặc gọi production API cho locale theo gói; kết luận ở đây dựa trên source và regression tests.

## 84. Đóng P2-21: chống dò email qua `register_start` (2026-10-31)

- **Kết quả:** implementation đã có trong source hiện tại. `register_start` trả cùng HTTP 200 và response keys (`authRequestId`, `email`, `registrationTicket`) cho email mới lẫn email tồn tại. Email đã xác thực được gửi hướng dẫn reset, không đổi mật khẩu; API cấp registration ticket chứa UUID ngẫu nhiên thay vì ID thật. Email chưa xác thực có thể nhận lại mã xác minh. Nếu người dùng thử verify decoy ticket, API chuẩn hóa tài khoản không tồn tại thành lỗi mã xác minh chung.
- **AGY Flash Low** read-only review run `2026-10-30T19-09-38-227Z-3b56355d`, conversation `2331a205-68ad-464f-bf76-2042c76691d8`: verdict PASS, 0 file thay đổi. AGY kiểm tra source, test và response route; Codex đối chiếu độc lập các nhánh và cách route ánh xạ lỗi decoy.
- **CodeGraph:** `codegraph status`; `codegraph explore "register_start registration email already exists case ZitadelLoginUiError EMAIL_ALREADY_EXISTS registration verify request"`; `codegraph node src/lib/zitadel-login-ui.ts --offset 1480 --limit 150`; `codegraph node src/lib/zitadel-login-ui.ts --offset 1620 --limit 125`; `codegraph node tests/zitadel-custom-login-review.test.ts --offset 805 --limit 200`; `codegraph node src/app/api/auth/login-ui/route.ts --offset 230 --limit 150`; `codegraph node src/app/api/auth/login-ui/route.ts --offset 390 --limit 55`. Phạm vi: public `register_start`, duplicate verified/unverified account recovery, ticket verification, and regression tests.
- **Checks:** AGY and Codex independently ran `node --experimental-strip-types --import ./tests/register-ts.mjs --test tests/zitadel-custom-login-review.test.ts`; Codex result **22/22 PASS**. Node emitted the existing `MODULE_TYPELESS_PACKAGE_JSON` warning only.
- **Chưa xác minh:** không gọi production Zitadel, không gửi email thật và không kiểm tra live email delivery trong lượt này.

## 85. P2-11 follow-up: giữ lịch backup ổn định qua deploy (2026-10-31)

- Sau deploy commit `31e7d59`, timer vẫn `enabled` + `active` nhưng lịch tự động ngày 31/10 không được ghi nhận; `LastTriggerUSec` ban đầu trống và `NextElapseUSecRealtime` chuyển sang ngày 1/11. Log trong khoảng 03:10–03:23 CST chỉ có service backup chạy thủ công, không có dòng timer trigger, nên nguyên nhân chính xác chưa được chứng minh. Installer cũ luôn ghi lại cả hai systemd unit, gọi `daemon-reload`, rồi `enable --now` ở mọi deploy; đây là đường có thể làm xáo lịch và cần loại bỏ thao tác thừa.
- Chạy bù theo runbook lúc 03:21 CST: service báo `Result=success`, `ExecMainStatus=0`; journal xác nhận archive được kiểm bằng `pg_restore --list`, 319589 bytes, owner `postgres:postgres`, mode `0600`. Không in hoặc sao chép nội dung backup. Timer hiện vẫn `enabled` + `active`; lần tự động tiếp theo được systemd lên lịch ngày `2026-11-01 03:19:21 CST`.
- **Sửa:** installer so sánh byte unit nguồn/đích, không thay file hoặc reload systemd khi nội dung không đổi; khôi phục `root:root`/`0644` ngay tại chỗ khi metadata lệch; chỉ `enable --now` khi timer bị tắt/ngừng hoạt động; chỉ restart timer khi unit timer thực sự đổi. Thay đổi riêng service không restart timer. Causal link với lần lỡ lịch vẫn là giả thuyết, chưa kết luận từ log hiện có.
- **AGY:** implementation `gemini-4-argon-medium`, run `2026-10-30T19-23-06-074Z-8bcb839b`; follow-up metadata sau review Codex, conversation tiếp nối `594931d3-c0c4-43f2-b994-81b25ce3f037`, run `2026-10-30T19-25-51-907Z-e5182542`. AGY chạy test installer; Codex tự đọc diff và phát hiện/đóng hồi quy quyền file.
- **CodeGraph:** `codegraph status`; `codegraph sync`; `codegraph explore "installSelfHostedPostgresBackup installUnit checkCommand repeated install timerUnitChanged"`; `codegraph explore "installUnit checkCommand installSelfHostedPostgresBackup root ownership metadata test unchanged install"`; `codegraph node scripts/install-self-hosted-postgres-backup.mjs`; `codegraph node tests/install-self-hosted-postgres-backup.test.mjs`. Phạm vi: systemd unit installer, trạng thái timer, regression tests và runbook backup.
- **Checks Codex:** `npm run test:backup` **26/26 PASS**; `npm run typecheck` PASS; ESLint hai file JS PASS; `git diff --check` PASS. Trước thay đổi installer, `npm run test:unit` cũng pass **141/141**.
- **Chưa xác minh:** chưa quan sát lần timer tự chạy kế tiếp dự kiến 1/11. Restore drill archive production vào PostgreSQL tạm đã hoàn tất và có caveat về logical replication tại mục 96.

- Deploy commit `f6402e9b0687f9a623af8096bd9d01659ea8f684` qua Actions run `41115585565` kết thúc `success` cả verify và deploy. Production đang chạy đúng SHA; `/api/health` và `/` HTTP 200. Timer giữ nguyên `active` + `enabled` và `NextElapseUSecRealtime=2026-11-01 03:19:21 CST`, trùng mốc đọc trước deploy; lần chạy tự động kế tiếp vẫn cần quan sát.

## 86. Đóng P2-10/P2-13: bỏ backup `.local-db` thừa và credential owner chết (2026-10-31)

- **P2-10:** workflow deploy hiện chỉ `git fetch`/`git reset --hard`; không còn nhắc `.local-db` hay copy qua `/tmp`. Thư mục bị Git ignore vẫn được giữ qua reset, nên không cần backup/restore copy gây rollback và lộ file. Thêm regression test vào `tests/e2e-safety.test.mjs`, kiểm tra workflow không tái xuất hiện `.local-db` hoặc `qlaok_local_db_backup`.
- **P2-13:** source hiện không còn writer `auth-credentials.json` hoặc `INITIAL_SUPER_ADMIN_PASSWORD`; tạo owner dùng hồ sơ lời mời Zitadel. `hashPassword` vẫn được dùng cho credentials nhân viên, không phải owner/admin. Test `tests/admin-review.test.ts` xác nhận biến password Super Admin cũ bị bỏ qua và không tạo file credential ở fixture. Không đọc, xóa hoặc kiểm tra nội dung `.local-db` production; nếu còn file credential lịch sử thì trạng thái tồn tại/quyền/cleanup chưa được xác minh.
- **CodeGraph:** `codegraph explore ".github/workflows/deploy.yml .local-db backup restore deploy copy /tmp rollback"`; `codegraph explore "tests/e2e-safety.test.mjs deploy workflow .local-db backup restore /tmp secret local db regression"`; `codegraph node tests/e2e-safety.test.mjs`; `codegraph node src/lib/auth-credentials.ts`; `codegraph explore "hashPassword verifyPassword auth-credentials admin create_owner owner password credentials"`; `codegraph node tests/admin-review.test.ts --offset 780 --limit 55`. Workflow YAML được đọc trực tiếp vì là config chưa được CodeGraph index.
- **Checks:** `node --test tests/e2e-safety.test.mjs` **4/4 PASS**; `npm run test:unit` **142/142 PASS**; `git diff --check` PASS.
- **Còn mở:** cần kiểm tra timer tự chạy tại kỳ tiếp theo; restore production backup vào database tạm vẫn cần chấp thuận riêng.

## 87. Đối chiếu P3 mobile: push, membership, OIDC, catalog và lỗi đăng nhập (2026-10-31)

- **P3-22:** `unregisterPushOnLogout` gửi DELETE trước khi sign-out; nếu DELETE trả 401 thì vẫn sign-out nhưng giữ token, scope và shop IDs trong local state để lần sau còn biết token cần cleanup. Test runtime xác nhận đúng thứ tự và state được giữ lại.
- **P3-23:** mỗi lần tải danh sách quán, app lọc membership theo các shop vừa tải rồi thay toàn bộ membership state bằng snapshot đó; không merge map cũ nên shop đã bị thu hồi quyền không còn được giữ lại trong state.
- **P3-24:** callback URL được khóa trong lúc exchange để tránh xử lý đồng thời; catch đặt ref về `null`, cho phép cùng URL thử lại sau lỗi exchange.
- **P3-25:** AGY sửa mobile Catalog để kiểm tra HTTP status và dữ liệu trả về, áp dụng giá chuẩn server, rollback và báo lỗi chung khi thất bại. Quick Add giữ nguyên ba ô nhập khi phản hồi thiếu item hoặc lỗi HTTP/mạng; chỉ thêm item và xóa draft khi response có item hợp lệ. Regression test chạy component qua runtime harness.
- **P3-28:** `formatStaffLoginError` hiện chỉ nhận lỗi và locale; tham số `_secretsToRedact` chết đã được gỡ. Lỗi không nhận diện trả thông báo chung, không đưa nội dung lỗi thô ra UI.
- **AGY:** P3-25 implementation dùng `gemini-3.8-flash-medium`, run `2026-10-30T19-39-44-760Z-681a3442`; follow-up đổi kiểu test `any` thành kiểu tường minh dùng `gemini-3.8-flash-low`, run `2026-10-30T19-44-29-053Z-d29ea3e7`. Codex đọc diff độc lập và chạy lại bộ test/typecheck.
- **CodeGraph:** `codegraph status`; `codegraph explore "unregisterMobilePushToken lastRegisteredScope expoPushToken registeredShopIds DELETE failure preserve state retry"`; `codegraph explore "mobile App membership loadedMemberships membership prune stale revoked shop current account"`; `codegraph node mobile/App.tsx --offset 740 --limit 60`; `codegraph node mobile/App.tsx --offset 195 --limit 45`; `codegraph node mobile/src/components/tabs/CatalogTab.tsx --offset 185 --limit 65`; `codegraph node mobile/src/components/tabs/CatalogTab.tsx --offset 305 --limit 75`; `codegraph node mobile/tests/push-notifications.test.ts --offset 285 --limit 75`; `codegraph node mobile/src/components/AuthScreen.tsx --offset 110 --limit 45`; `codegraph node mobile/tests/staff-workspace.test.ts --offset 1993 --limit 390`. Phạm vi: logout cleanup state, snapshot membership, OIDC retry, mobile catalog response/optimistic state, error-copy helper và regression coverage.
- **Checks Codex:** `npm test --prefix mobile` **119/119 PASS**; `npm run typecheck --prefix mobile` PASS; `git diff --check` PASS. ESLint mặc định bỏ qua `mobile/`; chạy `npx eslint --no-ignore mobile/tests/staff-workspace.test.ts` và đối chiếu cùng lệnh trên nội dung `HEAD` cho thấy 4 lỗi lint cũ ở các dòng 1671, 1927 (2), 1966 y hệt baseline, không còn lỗi `any` mới ở test P3-25.
- **Chưa xác minh:** không chạy app trên thiết bị hoặc tạo EAS build. Mobile source chưa được phát hành trong binary; P3-27 vẫn cần đúng EAS project ID từ chủ dự án. P3-23/P3-24 được đối chiếu source, chưa có test component riêng cho thu hồi membership hay retry callback.

## 88. Storefront home/menu: production GET API và browser smoke (2026-10-31)

- AGY Flash Low kiểm tra shop QA đã publish trên đúng host production, chỉ cho phép GET/HEAD/OPTIONS cùng origin và chặn request ngoài origin. Không ghi định danh shop, slug, ID, tài khoản hoặc token vào evidence.
- Bốn API công khai trả HTTP 200: storefront door bundle, menu bundle, catalog và tables. Response catalog không có `owner_id`; các bundle có 1 danh mục, 1 món và 1 bàn, posts trả 0. Shop QA thuộc gói Free.
- Browser mở storefront door và menu: cả hai HTTP 200, render nội dung tiếng Việt; lần lượt có 1/2 heading, 2/6 button và 1/1 image. Không có page exception hoặc request ngoài origin. Một POST analytics bị route guard chặn trước khi tới server; harness ghi nhận một console fetch error tương ứng với request bị chặn.
- **AGY:** `gemini-3.8-flash-low`, run `2026-10-30T19-51-21-345Z-ce8dffe5`, SUCCESS; không sửa file source. Codex chạy lại cùng harness độc lập và nhận các status/count/guard result tương ứng. Production read-back sau commit `aabbf7a3aa720d71a705fed2a61273f321c7ff8d`: `/api/health` và `/` HTTP 200; GitHub Actions run `41118000137` có cả `verify` và deploy success; VPS HEAD khớp SHA.
- **CodeGraph:** `codegraph status`; `codegraph node 'src/app/(storefront)/s/[slug]/page.tsx' --offset 41 --limit 105`; `codegraph node 'src/app/(storefront)/s/[slug]/menu/page.tsx' --offset 320 --limit 100`; `codegraph node src/app/api/shops/route.ts --offset 70 --limit 105`; `codegraph node src/app/api/catalog/route.ts --offset 160 --limit 100`; `codegraph node src/app/api/tables/route.ts --offset 58 --limit 90`. Phạm vi: storefront door/menu loaders và các GET public shops/catalog/tables.
- **Checks:** `node .agy-runs/qa-storefront-home-smoke.mjs` chạy lại độc lập; kiểm tra health/home production; `git diff --check`. Không sửa source nên không chạy test/build.
- **Còn mở:** shop QA là gói Free nên chưa kiểm tra API/browser cho gói Basic/Premium. Smoke này không tạo đơn, không xác nhận order/payment/refund mutations, và không kiểm tra authenticated owner endpoints. Đây là giới hạn QA rõ ràng, không phải kết luận các luồng đó đã đạt.

## 89. Mobile membership snapshot và OIDC callback retry: regression coverage (2026-10-31)

- **P3-23:** `filterMembershipsForShops` là helper được `loadShopsAndData` gọi để thay membership snapshot theo các shop mới trả về. Test xác nhận membership của shop đã bị thu hồi/biến mất bị loại, shop còn trong snapshot giữ nguyên membership, và danh sách rỗng xóa hết snapshot.
- **P3-24:** `processIncomingCallbackUrl` là đường xử lý callback mà `App` gọi. Test mock boundary `completeOwnerOidcCallback`, xác nhận URL không hợp lệ không exchange, callback lặp khi đang chạy bị chặn, thất bại cho phép thử lại đúng URL, thành công giữ dedupe và callback trùng sau thành công không exchange lần nữa.
- **AGY:** `gemini-3.8-flash-low`, run `2026-10-30T19-55-56-625Z-c9b95a9a`, SUCCESS; thay đổi giới hạn trong `mobile/App.tsx` và `mobile/tests/staff-workspace.test.ts`. Codex kiểm diff và bổ sung assertion cho trường hợp callback trùng trong lúc exchange còn pending.
- **CodeGraph:** `codegraph status`; `codegraph explore "mobile/App.tsx loadShopsAndData handleIncomingCallbackUrl"`; `codegraph node mobile/App.tsx --offset 750 --limit 200`; `codegraph node mobile/App.tsx --offset 205 --limit 35`; `codegraph node mobile/src/lib/owner-session.ts --offset 810 --limit 35`; `codegraph node mobile/src/lib/owner-session.ts --offset 1230 --limit 70`; Codex `codegraph explore "filterMembershipsForShops processIncomingCallbackUrl"`; `codegraph affected mobile/App.tsx`. Phạm vi: membership snapshot của `Workspace`, callback URL qua `App`/owner session và regression tests.
- **Checks Codex:** `npm test --prefix mobile` **121/121 PASS**; `npm run typecheck --prefix mobile` PASS; `git diff --check` PASS.
- **Chưa xác minh:** không chạy thiết bị thật, không gọi Zitadel/OIDC thật và không tạo EAS build. P3-27 vẫn cần EAS project ID chính xác trước khi có thể build.

## 90. Đối chiếu migration history PostgreSQL production (2026-10-31)

- Dùng SSH strict host-key checking và `sudo -u postgres psql` chỉ với `SELECT` trên `public.schema_migrations`; không truy vấn dữ liệu khách hàng và không ghi database.
- Production có 32 migration records; migration mới nhất là `20261030000300_admin_owner_invitation_claims.sql`. Codex tính SHA-256 trên 32 migration file hiện có và so sánh trong bộ nhớ với history production: **32/32 khớp**, 0 file thiếu, 0 record dư và 0 checksum mismatch.
- **CodeGraph:** `codegraph status`; `codegraph explore "scripts/migrate-self-hosted.mjs migration schema_migrations table applied_at version connection configuration"`; `codegraph explore "readLocalMigrations planMigrations migration checksum mismatch"`. Phạm vi: `readMigrationHistory`, `checksumSql`, `readLocalMigrations` và `planMigrations`.
- **Checks:** SSH chỉ đọc trả đúng production migration history; verify/deploy GitHub Actions run `41119914312` success trên SHA `14345a709ab908aa54fea2922e4f7f70bdc661a8`; VPS HEAD khớp SHA; `/api/health` và `/` HTTP 200; PostgreSQL backup timer `active` + `enabled`.
- **Còn mở:** lịch chạy tự động tiếp theo là `2026-11-01 03:19:21 CST`; chưa có evidence timer tự chạy tại kỳ này. Restore drill archive đã hoàn tất tại mục 96; logical replication cần cấu hình riêng nếu có consumer phụ thuộc.

## 91. Xác minh độc lập giới hạn gói và storefront QA (2026-10-31)

- AGY Flash Low run `2026-10-30T20-20-27-355Z-13df63d5` đăng nhập tài khoản QA trên đúng host production, chỉ tải danh sách shop và các storefront GET. Kết quả tổng hợp: 1 shop, gói Free 1, Basic 0, Premium 0; shop đã publish 1, chưa publish 0. Không thay đổi gói hoặc dữ liệu nghiệp vụ.
- Codex tự chạy lại luồng đăng nhập QA trong tiến trình cục bộ rồi đọc lại shop list. Kết quả khớp AGY: 1 Free, 0 Basic, 0 Premium; 1 published, 0 unpublished. Không in/ghi credential, cookie, token, shop ID, slug hoặc tên shop.
- Codex gọi độc lập bốn endpoint storefront của shop QA: door bundle, menu bundle, catalog và tables — cả bốn trả HTTP 200; catalog không có `owner_id`. Không gọi endpoint ghi đơn, thanh toán, bàn, catalog hoặc analytics.
- **CodeGraph:** `codegraph status`; `codegraph_explore` luồng login/authRequest và `GET /api/shops?member=1`; `codegraph_node` các file login page, `/api/auth`, `/api/auth/login-ui`, callback và `zitadel-oidc.ts`; `codegraph_explore "getZitadelIssuerUrl ZITADEL_ISSUER_URL issuerUrl default issuer"`. Phạm vi: auth QA, danh sách shop theo owner và public storefront door/menu/catalog/tables.
- **Evidence/checks:** Codex chạy `.agy-runs/qa-codex-independent-storefront-coverage.mjs`; output chỉ chứa status và aggregate counts. `git diff --check` chạy sau khi ghi mục này. Không sửa source nên không chạy test/build.
- **Còn mở:** tài khoản QA chưa có shop Basic/Premium; không thể xác nhận hành vi production theo hai gói nếu không có fixture phù hợp. Smoke cũng không kiểm thử authenticated owner APIs hay mutation flows.

## 92. Sửa keyboard accessibility cho thẻ món storefront (2026-10-31)

- **Vấn đề:** thẻ chi tiết món trong cả ba kiểu storefront (F&B/list, service/list, retail/grid) dùng `<div onClick>`, không nhận focus bằng bàn phím. Nút thêm nhanh nằm bên trong thẻ khiến cấu trúc tương tác không hợp lệ khi đổi thẻ sang button.
- **Sửa:** đổi vùng mở chi tiết thành native `<button type="button">` có focus ring; chuyển quick-add thành button sibling riêng; giữ trạng thái unavailable bằng thuộc tính `disabled`. Thay đổi giới hạn trong `src/components/storefront/VerticalRenderer.tsx`.
- **AGY QA:** Flash Low run `2026-10-30T20-58-40-589Z-b8548f7c`, report `.agy-runs/qa/storefront-keyboard-a11y-production-2026-10-31.md`. AGY mở JavaScript storefront production nhưng cấp catalog synthetic trong bộ nhớ qua intercept `GET /api/shops`; chỉ cho exact-origin `GET`, `HEAD`, `OPTIONS` đi qua và chặn request cross-origin hoặc method khác. Năm cấu hình layout/viewport đều HTTP 200, không có overflow ngang, 14/14 controls có tên truy cập được, không có lỗi trang. Kiểm tra Enter và Space mở/đóng drawer; search rỗng khớp hiển thị trạng thái không có kết quả rồi khôi phục món; category keyboard lọc danh sách. Hai analytics POST phát sinh khi mở drawer đã bị chặn ở browser.
- **Codex xác minh độc lập:** lặp lại năm layout/viewport trên fixture synthetic, xác nhận card là button native có tên, quick-add là sibling tách biệt, không có button lồng nhau; search, lọc category và thao tác drawer với Enter/Space hoạt động. Smoke GET trang `/s/test-shop-1/menu`, API public menu và `/api/health` trên production đều HTTP 200. Hai analytics POST bị route guard chặn; không tạo đơn, thanh toán, dịch vụ hay dữ liệu nghiệp vụ.
- **CodeGraph:** `codegraph status` (303 files, index up-to-date; engine cũ); `codegraph explore "StorefrontMenuPage VerticalRenderer ItemDetailDrawer handleOpenItem onQuickAdd category keyboard accessibility item card"`; `codegraph affected src/components/storefront/VerticalRenderer.tsx` (không có test files phụ thuộc). Phạm vi ảnh hưởng: ba renderer card variants, quick-add sibling, mở `ItemDetailDrawer` và lọc category.
- **Checks/deploy:** typecheck, focused lint và `git diff --check` pass trước khi commit. GitHub Actions run `41126534174` hoàn tất success trên SHA `a9882c470681c57ea02be491c8d6d2cf90a1c2d7`; job verify và deploy production đều success. Commit source đã push lên `main`.
- **Chưa xác minh:** fixture storefront không có option groups, ảnh hoặc bảng thật; không kiểm thử chọn option, submit order, payment webhook, touch/swipe hay dữ liệu catalog thật của shop. Production API chỉ được smoke bằng status code; QA không đọc hay sửa dữ liệu khách hàng. Máy local preview API không dùng được vì Supabase local báo `exceed_egress_quota`, nên không dùng kết quả local đó thay cho production.

## 93. Storefront option groups: ngữ nghĩa radio/checkbox và keyboard (2026-10-31)

- **Vấn đề:** các lựa chọn Size/Toppings trông như radio/checkbox nhưng thực tế là button chỉ đổi CSS; không khai báo trạng thái đang chọn cho trình đọc màn hình và không có ngữ nghĩa nhóm tùy chọn.
- **Sửa:** thay group bằng `fieldset`/`legend`, nối mô tả qua `aria-describedby`; lựa chọn bắt buộc dùng native radio cùng tên nhóm, lựa chọn tùy chọn dùng native checkbox. Giữ style card, thêm focus ring cho label khi input nhận focus. Bàn phím giờ theo chuẩn trình duyệt: radio di chuyển/chọn bằng phím mũi tên, checkbox bật/tắt bằng Space.
- **AGY Flash QA:** run `2026-10-30T21-14-57-195Z-d7d48afd` (`gemini-3.8-flash-low`) kiểm thử fixture synthetic trên bundle production trước sửa. Chức năng single-select, multi-select và tính tổng 30.000đ đều đúng; QA phát hiện `aria-pressed`/radio/checkbox semantics bị thiếu. Codex dùng kết quả đó để chọn native controls. Report tổng hợp baseline và kiểm tra sau deploy: `.agy-runs/qa/storefront-options-drawer-2026-10-31.md`.
- **Claude CLI review:** gửi lượt read-only qua Claude Code CLI đang cấu hình `deepseek`; review đề nghị dùng radio/checkbox native thay cho `aria-pressed` để thể hiện chính xác nhóm chọn một và nhóm chọn nhiều. Review không kết luận về order API/persistence vì không gọi endpoint.
- **CodeGraph:** `codegraph status` (index up-to-date); `codegraph explore "ItemDetailDrawer required option groups selectedChoices toggleChoice handleConfirm onAddToCart storefront cart order payload"`; `codegraph node ItemOptionGroup`; `codegraph node ItemOptionChoice`; `codegraph sync`; `codegraph node src/components/storefront/ItemDetailDrawer.tsx --offset 234 --limit 111`; `codegraph affected src/components/storefront/ItemDetailDrawer.tsx` (không có test files phụ thuộc). Ảnh hưởng giới hạn ở `ItemDetailDrawer` và lựa chọn option trong drawer; không đổi API contract hoặc định giá phía server.
- **Checks Codex:** `npm run typecheck` PASS; ESLint file mục tiêu không có lỗi (còn một warning `<img>` có sẵn ở line 145); `git diff --check` PASS. Sau deploy, Playwright với synthetic fixture ở 390×844 xác nhận fieldset/radio/checkbox, default Small, ArrowRight chọn Large, Space toggle topping, chọn đồng thời hai topping và tổng 30.000đ. Trang, `/api/health` và public menu API đều HTTP 200. Một analytics `POST /api/analytics/track` bị route guard chặn như dự kiến; 0 page exception, 0 cross-origin request, 0 `/api/orders` request.
- **CI/deploy:** GitHub Actions run `41130197854` success trên SHA `e6bd2b721f27840e5f631471e5bdaeaafea79001`; web/mobile typecheck, unit/review/SQL/DB-reset/mobile tests, disposable PostgreSQL/PostgREST E2E, build và deploy đều success.
- **Chưa xác minh:** fixture không có kết nối database; chưa gửi option payload đến order API, chưa xác minh server persistence/giá qua đơn hàng thật. Không tạo đơn hoặc sửa dữ liệu production. Ảnh browser sau deploy: `.playwright-cli/page-2026-10-30T21-29-35-174Z.png`.

## 94. P2-5: kiểm thử ranh giới timestamp webhook SePay (2026-10-31)

- **Kết quả:** source đã kiểm tra timestamp có chữ ký trong cửa sổ ±300 giây; bổ sung regression tests cho đúng hai biên ±300 giây (được nhận) và quá biên 1 ms (bị từ chối). Test dùng `nowMs` cố định nên không phụ thuộc đồng hồ thật.
- **Review:** AGY read-only run `2026-10-30T21-39-33-855Z-bb67ded8` đồng ý phần triển khai đúng và đề nghị thêm test timestamp tương lai/biên. Claude Code CLI được gọi trực tiếp với `--model deepseek`; CLI cảnh báo `unrecognized_model deepseek` nhưng trả review trước khi dừng, lưu ý rủi ro test phụ thuộc thời gian. Codex xác nhận test mới dùng thời gian cố định.
- **CodeGraph:** `codegraph explore "verifySePayWebhookSignature SEPAY_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS timestamp nowMs"`; `codegraph node tests/sepay-webhook-review.test.ts`. Phạm vi thay đổi: chỉ test chữ ký/timestamp webhook; không đổi endpoint hay xử lý thanh toán.
- **Checks/deploy:** focused SePay review test **1/1 PASS**; unit test SePay **1/1 PASS**; `npm run typecheck`, ESLint và `git diff --check` PASS. Commit test `a93d7083c0c4177f293fae5496f9afe4a54d7871`; Actions run `41132961612` trên đúng SHA thành công verify + deploy. Sau deploy `/` và `/api/health` HTTP 200.
- **Chưa xác minh:** không gửi webhook hoặc giao dịch thanh toán thật; bài kiểm tra bao phủ helper xác minh chữ ký.

## 95. P2-6: không nuốt lỗi ghi local store (2026-10-31)

- **Kết quả:** source hiện ném lỗi `MPOS_STORE_WRITE_FAILED` khi ghi mPOS local store lỗi và để lỗi filesystem của local table store truyền lên. Thêm hai test tạo đường dẫn không thể ghi (`ENOTDIR`), một cho mỗi store; fixture tạm được dọn trong `finally`.
- **CodeGraph:** `codegraph explore "writeStore MPOS_STORE_WRITE_FAILED writeLocalTablesStore setItemStockMetadata dbCreateShopTable"`; `codegraph node tests/local-store-write-review.test.ts`; `codegraph affected tests/local-store-write-review.test.ts` (không có file phụ thuộc khác). Phạm vi thay đổi chỉ là regression coverage cho hai nhánh lưu local.
- **Checks/deploy:** test mới **2/2 PASS**; `npm run typecheck`, ESLint hai test file và `git diff --check` PASS. Commit `59cedbec9d40b4a678d32995e1199184ccd37a6a`; Actions run `41133690129` trên đúng SHA thành công verify + deploy. Sau deploy `/` và `/api/health` HTTP 200.
- **Giới hạn:** kiểm thử lỗi filesystem trong thư mục tạm; không sửa dữ liệu shop hay database production.

## 96. P2-11: diễn tập restore archive PostgreSQL production (2026-10-31)

- **Backup/timer:** dùng SSH strict host-key checking để kiểm tra read-only. Timer `qlaok-postgres-backup.timer` vẫn `enabled` + `active`; lần chạy gần nhất `2026-10-31 03:21:33 CST`, lần kế tiếp systemd lên lịch `2026-11-01 03:19:21 CST`. Archive được dùng: `/var/backups/qlaok/postgres/qlaok-postgres-20261030T192133Z.dump` (319589 bytes); không in nội dung dump.
- **Restore drill:** tạo database PostgreSQL tạm có tên riêng, restore với `pg_restore --exit-on-error --no-owner --no-acl`, rồi chỉ kiểm tra metadata schema: có 22 bảng `public` và đủ ba bảng lõi `shops`, `orders`, `schema_migrations`. Database tạm được drop và xác nhận không còn. Không đọc/in row khách hàng và không sửa database `qlaok`.
- **Caveat được phát hiện:** `pg_restore` thành công nhưng cảnh báo `wal_level is insufficient to publish logical changes`. Production đang `wal_level=replica`; publication `supabase_realtime` liệt kê `public.orders` và `public.table_service_requests`, nhưng PostgreSQL không có logical replication slot và VPS không chạy Supabase Realtime service. CodeGraph xác nhận luồng order hiện tại dùng PostgreSQL `LISTEN/NOTIFY` → SSE; mobile cũng dùng authenticated SSE, còn POS recovery dùng `BroadcastChannel`. Không thấy consumer logical replication trong các luồng app đã kiểm tra. Vì vậy restore dữ liệu/schema đã thành công, nhưng chưa chứng minh publication có thể phục vụ consumer logical-replication; nếu khôi phục dịch vụ phụ thuộc publication thì phải cấu hình `wal_level=logical` trên target và kiểm tra lại sau restart.
- **CodeGraph:** `codegraph explore "OrderEventsBroker Postgres LISTEN NOTIFY SSE order events database realtime publication logical replication"`; `codegraph node OrderEventsBroker`; `codegraph node attachUpstream`; `codegraph explore "subscribePosRecoveryChanges PosCounterWorkspace Supabase realtime channel postgres_changes"`; `codegraph explore "source code usages supabase.channel postgres_changes on postgres_changes client-side realtime"`; `codegraph node mobile/tests/shop-realtime-orders.test.ts --offset 68 --limit 30`. Phạm vi: order event broker, mobile order SSE, POS local recovery channel và các subscription client.
- **Còn mở:** chưa đến giờ chạy tự động tiếp theo `2026-11-01 03:19:21 CST`; cần đối chiếu timer sau mốc đó. Restore drill không bao gồm `.local-db`, cấu hình VPS hoặc Garage object storage. Logical replication được ghi rõ là chưa xác minh/không bật trên production; không thay đổi PostgreSQL config hay publication trong lượt này.

## 97. Vá Next.js audit findings trên production dependency tree (2026-10-31)

- `npm audit --omit=dev` phát hiện root `next@15.5.27` còn trong phạm vi ảnh hưởng của GHSA-2464-fhr4-w9xw (RCE trong Image Optimization khi SVG được xử lý) và GHSA-p3m5-59mp-jv5r (DoS qua Server Actions). Bản vá là Next.js `15.5.28`; xem [advisory RCE](https://github.com/advisories/GHSA-2464-fhr4-w9xw) và [advisory DoS](https://github.com/advisories/GHSA-p3m5-59mp-jv5r).
- **Sửa:** nâng minimum root dependency từ `^15.1.6` lên `^15.5.28`, cập nhật lockfile và giới hạn PostCSS dưới Next ở `^8.5.30` để bỏ bản lồng `8.4.31`. Dependency tree xác nhận Next `15.5.28`, Sharp `0.35.5`, PostCSS `8.5.30` deduped. Không thay dependencies mobile/Expo.
- **CodeGraph:** `codegraph status`; `codegraph explore "Next.js Image Optimization API next/image image remotePatterns import Image"`; `codegraph explore "use server Server Actions App Router server action handlers"`; cùng các query `next/image`, `remotePatterns`, `use server`, `next.config.ts`, và `src/app/layout.tsx`. Không thấy import `next/image` hoặc Server Action directive trong indexed source; mutation hiện dùng Route Handlers. Blast radius là runtime Next.js và PostCSS, không đổi API/auth/pricing/realtime contracts.
- **Checks Codex:** tạo lockfile bằng npm `11.19.1` cùng phiên bản CI; `npm ci --dry-run` và `npm ci` pass; `npm ls next sharp postcss --all` pass; production `npm audit --omit=dev` không còn Next/PostCSS finding (critical/high = 0); unit **142/142**, review **391/391**, SQL **13/13**, typecheck pass, lint 0 lỗi/41 warning, build **41/41** trang, `git diff --check` pass.
- **Follow-up dependency security (2026-10-31):** thêm override hẹp `exceljs.uuid: ^11.1.1` và `postcss-selector-parser: ^6.1.5`, giữ `exceljs@4.4.0` và `tailwindcss@3.4.19`; lockfile thay đúng hai gói bắc cầu. `uuid@11.1.1` vá [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq); ExcelJS chỉ gọi `uuid.v4()`, còn advisory ảnh hưởng `v3/v5/v6`. Parser `6.1.5` vá [GHSA-rj75-hqrm-r3gf](https://github.com/advisories/GHSA-rj75-hqrm-r3gf); dependency này chỉ nằm trong Tailwind/PostCSS build tooling. Không đổi app source hay mobile dependencies.
- **Checks AGY + Codex:** npm 11.19.1 lockfile generation, `npm ci --dry-run`, `npm ci`, `npm ls exceljs uuid postcss-selector-parser --all`, full `npm audit` (**0 vulnerabilities**), `npm audit --omit=dev` (**0 vulnerabilities**), XLSX CommonJS smoke với ZIP signature, `npm run test:unit` **142/142**, `npm run typecheck`, `npm run build` (**41/41** trang) và `git diff --check` đều pass. Build giữ các warning lint hiện có; không có lỗi.
- **Kiểm thử E2E:** AGY thử `npm test`, wrapper chạy `test:unit` rồi `test:e2e` và kết thúc nonzero; không dùng kết quả này làm bằng chứng pass. Codex chạy `test:unit` riêng thành công; workflow sau push sẽ kiểm tra lại E2E trên PostgreSQL disposable và build trước deploy.
- **Còn mở trong review:** hai npm audit findings đã được xử lý ở dependency tree hiện tại. Các mục vận hành độc lập như lần auto-run kế tiếp của backup timer và EAS project ID vẫn mở ở các mục tương ứng.

## 98. Production QA chỉ đọc: owner dashboard và GET APIs (2026-10-31)

- AGY Flash Low chạy smoke sau đăng nhập bằng test account trên production. Chín route dashboard (`/dashboard`, orders, reports, catalog, QR Studio, posts, kitchen, settings, billing) và 13 GET API trong các nhóm shop/membership, analytics, catalog, orders/KDS/badge, tables/floor plan, posts, service requests, billing và SePay đều trả HTTP 200. API aggregate nhất quán: 4 đơn mới khớp KDS và badge; 1 bàn active khớp sơ đồ; 1 món khớp tổng catalog; posts và SaaS transactions rỗng. Tài khoản QA có một shop Free.
- **An toàn:** OIDC/login và `sync_user` được dùng để lập session. Codex đối chiếu nhánh `sync_user` qua CodeGraph: đọc profile/shop/membership rồi cấp session, không ghi profile trong nhánh này. GET SePay gọi `dbGetRedactedShopSePayConfig`; báo cáo không lưu giá trị cấu hình, thông tin tài khoản nhận tiền, cookie, token, email, shop ID/slug/tên hoặc response body thô. Không có business write tới production. Harness không giữ bộ đếm số write attempt bị chặn, nên số attempt bị chặn chưa xác định.
- **Giới hạn:** không có Chromium/Playwright. Các trang chỉ được xác minh là route authenticated trả server-rendered shell; chưa xác minh client-side data, UI empty state hay thao tác DOM. Chưa đăng nhập vai trò cashier/staff riêng. Shop QA chỉ có gói Free, nên Basic/Premium chưa được kiểm tra.
- **AGY:** `gemini-3.8-flash-low`, run `2026-10-30T22-55-11-000Z-fb18503c`, SUCCESS; không sửa file tracked. Báo cáo đã rà soát và lưu tại `.agy-runs/qa/owner-api-readonly-2026-10-31.md`.
- **CodeGraph:** `codegraph status`; `codegraph explore "authenticated owner dashboard pages shops orders reports catalog QR Studio tables posts staff kitchen settings billing GET API loaders"`; AGY query auth/dashboard/API; Codex `codegraph node src/app/api/auth/route.ts --offset 820 --limit 150`, `codegraph node src/app/api/auth/route.ts --offset 965 --limit 55`, `codegraph node 'src/app/api/webhooks/sepay/[shopId]/route.ts'`, `codegraph node dbGetRedactedShopSePayConfig`, `codegraph node toRedactedSePayConfig`. Ảnh hưởng được kiểm tra: owner dashboard route shells và GET handlers; không đổi source/API contract.
- **Kiểm tra Codex:** rà báo cáo đã lưu để xác nhận redaction và sửa các câu mô tả UI vượt quá bằng chứng; `git diff --check` PASS. Không chạy test/build vì chỉ cập nhật tài liệu, không thay đổi source.

## 99. Storefront hiển thị fallback khi ảnh món không tải được (2026-10-31)

- **Nguyên nhân:** drawer chi tiết và các card lưới/danh sách chỉ có ảnh mặc định khi thiếu `image_url`; URL có nhưng storage trả HTTP 402 thì trình duyệt để vùng ảnh trắng/broken-image. Kiểm tra chỉ đọc trước khi sửa đã xác nhận một ảnh storefront công khai trả 402.
- **Sửa:** thêm `StorefrontProductImage`, dùng emoji theo vertical (`fnb`, `service`, `retail`) khi URL thiếu hoặc sự kiện `img.onerror` xảy ra; reset lỗi khi URL đổi. Gắn vào drawer, grid/list và thẻ Flash Sale, giữ kích thước container, badge và nút phủ. Test regression 8 trường hợp được nối vào `npm run test:review`.
- **Giới hạn:** fallback giữ giao diện đọc được nhưng không khôi phục file ảnh đang lỗi ở storage; cần sửa trạng thái object/storage riêng để ảnh gốc hiển thị lại.
- **AGY:** `gemini-3.8-flash-low`, run `2026-10-30T23-40-09-944Z-f5569724`, SUCCESS. Khi kiểm tra độc lập, Codex phát hiện test TypeScript ban đầu làm `npm run typecheck` lỗi; chuyển test sang `.mjs`, bổ sung fixture đúng contract, và đưa test vào review suite.
- **CodeGraph:** `codegraph status`; `codegraph explore "StorefrontProductImage ItemDetailDrawer VerticalRenderer storefront product image load error fallback"`; `codegraph node src/components/storefront/ItemDetailDrawer.tsx --offset 135 --limit 40`; `codegraph node src/components/storefront/VerticalRenderer.tsx --offset 192 --limit 40`; `codegraph node src/components/storefront/VerticalRenderer.tsx --offset 345 --limit 38`; `codegraph explore "storefront product image image_url img flash sale promotion banner card menu"`; `codegraph node src/components/storefront/StorefrontCustomDecor.tsx --offset 1 --limit 52`; `codegraph node src/components/storefront/StorefrontCustomDecor.tsx --offset 872 --limit 30`; `codegraph explore "CatalogItem Category types qlaok required properties sort_order desc_i18n options_json view_count is_active"`; `codegraph node src/types/qlaok.ts --offset 230 --limit 42`.
- **Checks Codex:** focused regression **8/8 PASS**; `npm run test:review` **399/399 PASS**; `npm run test:unit` **142/142 PASS**; `npm run typecheck` PASS; ESLint 0 lỗi (có cảnh báo `@next/next/no-img-element`); `npm run build` thành công sau cả ba vùng render ảnh, sinh **41/41** trang; `git diff --check` PASS.

## 100. Database follow-up: phân trang đầy đủ cho thống kê đơn hàng (2026-10-31)

- Finding ban đầu ghi `loadMergedOrders` có thể làm dashboard thiếu thống kê khi shop vượt 1.000 đơn. CodeGraph xác nhận đường thống kê hiện gọi RPC `get_shop_order_stats_summary`; nếu RPC không tồn tại thì fallback `fetchAllShopOrdersPaginatedForStats` tải bằng `.range()` và ném `DB_STATS_PAGE_LIMIT_REACHED` khi client không hỗ trợ phân trang hoặc chạm giới hạn trang với trang cuối vẫn đầy. Vì vậy đường stats không trả tổng một phần âm thầm. Danh sách đơn chung vẫn giới hạn 1.000 đơn gần nhất theo thiết kế; KDS dùng nhánh query/phân trang riêng.
- Bổ sung `tests/order-stats-pagination-review.test.ts`: kiểm tra đọc đủ nhiều trang và dừng ở trang cuối ngắn, giữ filter shop và ID duy nhất; từ chối trả dữ liệu một trang khi client không có `.range()`; từ chối tổng một phần khi đạt `maxPages` với trang cuối đầy. Không đổi runtime source, schema hay API.
- **AGY:** `claude-sonnet-5-5-low`, run `2026-10-31T00-09-54-587Z-2f78c97e`, SUCCESS; thêm test bằng mock trong bộ nhớ, không gọi Supabase/production.
- **CodeGraph:** `codegraph status`; `codegraph explore "loadMergedOrders STATS_ORDER_PAGE_SIZE merge orders pagination stats"`; `codegraph callers fetchAllShopOrdersPaginatedForStats`; `codegraph explore "fetchAllShopOrdersPaginatedForStats range maxPages tests mock query"`; `codegraph explore "dbGetShopAnalyticsSummary get_shop_order_stats_summary stats server pagination"`; `codegraph node dbComputeShopRevenueAndInventoryStats`; `codegraph node loadMergedOrders`; `codegraph node normalizeOrderRecord`; `codegraph node tests/order-stats-pagination-review.test.ts`. Phạm vi: thống kê doanh thu/tồn kho, fallback đọc đơn phân trang và regression test; API contracts không đổi.
- **Checks Codex:** test focused **3/3 PASS**; `npm run test:review` **402/402 PASS**; `npm run typecheck` PASS; `git diff --check` PASS. Không chạy build vì chỉ thêm test.
- **Giới hạn:** chưa có shop production với hơn 1.000 đơn để đối chiếu thống kê live. Danh sách `/api/orders` thông thường tiếp tục trả tối đa 1.000 đơn gần nhất; mục follow-up này chỉ xác nhận đường thống kê không cắt tổng âm thầm.

## 101. QA client-side dashboard chủ quán trên production (2026-10-31)

- AGY Flash Low dùng phiên QA owner đã đăng nhập qua Zitadel và mở chín trang dashboard: overview, orders, reports, catalog, QR Studio, posts, kitchen, settings và billing. Cả chín route HTTP 200, client main render sau hydration, không có page exception; mỗi route có 10 button và 2 link hiển thị. Tổng cộng 336 same-origin GET/HEAD/OPTIONS trả 200.
- Browser guard chặn 18 `POST /api/analytics/track` tự phát, 0 request cross-origin và không click control có khả năng ghi. Không có order/catalog/settings/plan mutation trong phần UI smoke sau đăng nhập. Report đã khử thông tin lưu tại `.agy-runs/qa/owner-dashboard-smoke-2026-10-31.md`.
- **Giới hạn cần giữ rõ:** đăng nhập chạy qua OIDC callback; CodeGraph xác nhận callback gọi `resolveAndSyncZitadelOwnerProfile` với `allowInsert: true`. Hàm có thể bổ sung profile thiếu trường hoặc tạo profile mới. Browser report không đo số lần DB profile write ở bước auth, nên chỉ xác nhận không có business mutation sau đăng nhập; không kết luận toàn bộ phiên gồm auth tuyệt đối không ghi DB. Không kiểm tra staff/cashier hoặc gói Basic/Premium.
- **AGY:** `gemini-3.8-flash-low`, run `2026-10-31T00-20-02-989Z-ec81305c`, SUCCESS; không sửa source tracked.
- **CodeGraph/Codex:** `codegraph status`; AGY `codegraph explore "auth login session"`, `codegraph explore "oidc_start zitadel"`, `codegraph explore "login-ui action login authRequestId"`, `codegraph explore "isSameOriginRequest"`; Codex `codegraph node src/app/api/auth/route.ts --offset 450 --limit 165`, `codegraph node src/app/api/auth/callback/route.ts --offset 115 --limit 160`, `codegraph node src/app/api/auth/login-ui/route.ts --offset 235 --limit 110`, `codegraph node resolveAndSyncZitadelOwnerProfile`, `codegraph node src/lib/zitadel-oidc.ts --offset 1270 --limit 150`. Impact: login/session setup and dashboard client routes; no API/source changes.
- **Checks Codex:** reviewed the sanitized route table, guard counts and report redaction; verified deployed home and health responses are HTTP 200 and production branch SHA matched. No source changes, so no tests/build run for this QA-only entry.

## 102. Server validates option-group selections before order pricing (2026-10-31)

- **Vấn đề:** UI thể hiện nhóm `required` là radio (chọn đúng một) và nhóm tùy chọn là checkbox (không hoặc nhiều lựa chọn), nhưng `validateAndPriceOrderLines` chỉ dò từng choice trong một map phẳng. API có thể nhận đơn thiếu choice bắt buộc, nhiều choice trong cùng nhóm radio, hoặc gửi trùng một choice để cộng tiền nhiều lần.
- **Sửa:** validator giờ gắn choice với nhóm catalog, bắt buộc chọn một choice ở nhóm bắt buộc có lựa chọn, từ chối nhiều choice trong nhóm đó và từ chối choice trùng. Nhóm tùy chọn vẫn cho phép nhiều choice. Nhãn, ID, giá option và tổng tiền tiếp tục được chuẩn hóa/tính từ catalog phía server; alias tiếng Việt cũ vẫn được nhận.
- **Regression coverage:** fixture PostgreSQL cô lập kiểm tra thiếu nhóm bắt buộc, nhiều choice radio, choice checkbox trùng, nhiều checkbox hợp lệ, alias label, giá client giả và không ghi order khi đầu vào sai. Cập nhật các fixture đơn hiện hữu để gửi lựa chọn `size-m` hợp lệ theo catalog demo.
- **Model routing:** gọi trực tiếp Claude CLI với `--model deepseek` theo yêu cầu nhưng CLI trả `unrecognized_model` qua gateway đang cấu hình. AGY Argon High bắt đầu nhưng lặp truy vấn CodeGraph mà chưa chỉnh source; đã dừng lượt đó và Codex hoàn tất thay đổi, tự kiểm tra diff và test.
- **CodeGraph:** `codegraph status`; `codegraph explore "validateAndPriceOrderLines required option groups radio selection choices_json mpos-store dbCreateOrder POST /api/orders"`; `codegraph node validateAndPriceOrderLines`, `ItemDetailDrawer`, `ItemOptionGroup`, `quoteOrderPricing`, `dbCreateOrder`, `dbUpdateOrderStatus`, `tests/order-review.test.ts`; `codegraph affected src/lib/mpos-store.ts` xác định các test phụ thuộc `api-review`, `order-review`, `pos-idempotency-replay-review`, `realtime-review` và `tables-independent-review`. Phạm vi: tạo đơn QR/POS, sửa danh sách món chưa thanh toán và các regression fixtures; không đổi schema hay API contract.
- **Checks Codex:** regression subset **7/7 PASS**; `npm run test:review` **402/402 PASS**; `npm run typecheck` PASS; `git diff --check` PASS.
- **Giới hạn:** chưa tạo đơn giao dịch trên production; xác minh runtime production sẽ dựa trên deploy pipeline, không dùng dữ liệu khách để thử.
