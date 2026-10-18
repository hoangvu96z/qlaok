# Kết quả cuối — Codex review & kiểm thử bàn / UI / theme

Cập nhật 18/10/2026. Ba phiên **Antigravity CLI thực tế** thực hiện code theo phạm vi file riêng: backend/schema/API, shell/theme và table UI/QR/reports/POS. Codex giao contract, xem diff, thêm regression độc lập, yêu cầu sửa các lỗi tái hiện được và chạy lại kiểm tra. Không commit, push, deploy hoặc migrate production.

## Đã hoàn tất

- Desktop giữ một mũi tên collapse/expand có persistence; bỏ hai nút lặp. Bỏ thanh admin đen, giữ lối thoát xem thay trong navigation.
- Menu giữ dropdown ngôn ngữ compact, bỏ hàng cờ lặp. Modal xác nhận/payment/tracker có light mặc định và dark variants; preference theme đồng bộ toàn app và có nút đổi trên menu. Khung QR thực vẫn trắng.
- Web quản lý bàn trong `/dashboard/qr-studio`: tạo/sửa mã/tên/khu vực/sức chứa, bật/tắt, archive/restore; QR riêng chứa stable ID, tự chọn bàn khi mở menu, giữ generic QR và khả năng tải standee PNG.
- Server xác minh bàn cùng quán/hoạt động trước khi tạo đơn và trừ kho. Đơn cũ giữ snapshot label; rename/archive không phá lịch sử hay việc thanh toán. Managed table bills không gom nhầm bàn cũ hoặc legacy trùng tên.
- Reports có tab Theo bàn và export theo dữ liệu đang lọc, tách doanh thu đã thu/unpaid/refunded/cancelled, Mang về và legacy.
- Node tests dùng store bàn tạm theo process; regression sentinel chứng minh file `.local-db` giả của developer không bị đọc/ghi khi test.

## Kiểm chứng cuối do Codex chạy độc lập

| Kiểm tra | Kết quả |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run typecheck --prefix mobile` | Pass |
| `npm run test:unit` | 66 pass |
| `npm run test:review` | 48 pass |
| `npm run test:sql` | 1 pass, PGlite/migration/RLS/RPC |
| `npm test --prefix mobile` | 18 pass |
| `npm run build` | Pass trong bản sao source ở `/tmp/qlaok-final-build-check`, không có `.env` thật; đối chiếu `src/` trùng workspace |
| `git diff --check`, link Markdown, CodeGraph sync | Pass |

Tổng **133 test pass**. Các helper/loader SSR là test-only; không được dùng làm runtime ứng dụng. Test review mặc định đã bao gồm test lựa chọn bàn, cách ly store, regression engine/SQL và render React component thực với quick tags. Codex thay bộ source-regex checks do AGY tạo bằng test hành vi helper và render component; không dùng việc có chuỗi trong source làm bằng chứng thao tác UI chạy đúng.

Các lỗi đã tái hiện và yêu cầu AGY sửa: migration nháp dùng schema sai, DB mutation không có row vẫn trả thành công, preview bill gộp legacy khác tập settlement, getter localStorage bị chặn gây crash, endpoint/options SSE và quick-tag field sai, import/field TypeScript ở POS và test store chạm file dev. Tất cả các case regression liên quan đã pass trong vòng cuối.

## Giới hạn và rollout

Cần áp dụng `supabase/migrations/007_shop_tables.sql` sau 006 trước khi deploy. Chưa chạy migration/deploy thật. Chưa thử camera quét QR, tải PNG bằng browser, máy in hoặc thiết bị native trong lượt này.

Bước mở app loopback để kiểm tra trực quan bị cổng quyền trình duyệt từ chối. Không thử đi vòng qua trình duyệt/công cụ khác. Kiểm chứng UI trong lượt này gồm review code, TypeScript, production build và render component thực; không tuyên bố đã có browser E2E hoặc kiểm tra pixel/screenshot.

Hướng dẫn sử dụng: [TABLE_MANAGEMENT.md](TABLE_MANAGEMENT.md). Handoff của từng agent: [backend](AGY_BACKEND_HANDOFF.md), [shell/theme](AGY_SHELL_HANDOFF.md), [table UI](AGY_TABLE_UI_HANDOFF.md). Những kết quả trung gian dưới đây là lịch sử, đã được kết quả cuối thay thế.

---

# Codex independent review — tables and UI

Các mục lịch sử bên dưới ghi lại từng lỗi đã bắt được khi agent còn đang triển khai; phần Kết quả cuối ở đầu file là trạng thái hiện tại.

## Baseline

Before implementation: web typecheck, 38 review tests and the isolated SQL regression passed.

## First migration draft review

Independent `npm run test:sql` failed at `public.user_can_access_shop(text)` not existing. AGY was also running the SQL suite at this time; this is interim feedback, not a final finding against the finished change.

Review requirements for migration 007 before handoff:

- Use helper functions and columns that actually exist in migrations 001–006. The first draft mentioned `user_can_access_shop`, `is_trusted_server_mutation`, `order_items`, `items_json`, `customer_name`, `customer_phone`, `payment_note`, and printing timestamp columns that need explicit verification against current schema. Do not introduce alternate order models to add table identity.
- Preserve 005 RPC argument names, signatures, return shape, idempotency, stock delta direction, item availability and deterministic lock ordering. Existing TS `orderRpc` calls expect these exact contracts. Do not leave unprivileged overloads or obsolete implementations behind.
- Do not replace the full existing payment/state trigger with a simplified version. Unpaid item/price edits must remain possible through authorized flow; paid/refunded financial fields remain locked, completed→new remains forbidden.
- Stable table identity must persist through create/update/settlement, and historical label snapshots must survive rename/archive. Table-name reuse must not merge unrelated managed tables during settlement/reporting.
- Fresh migration run AND replay must pass isolated SQL and existing engine regression tests. Check invalid/inactive/cross-shop table writes and public/owner/cashier/staff RLS.

## Pending verification

- API authorization and table validation, QR resolution and invalid-link UX.
- UI collapse controls, impersonation exit, duplicate language controls, theme behavior.
- Reports by table with date/payment/status scope.
- Web/mobile typecheck, unit/review/SQL/mobile suites, production build and browser fixture checks.

## Second migration draft — independent checks

After AGY rewrote migration 007 against the actual schema:

- `npm run test:sql`: pass (existing migration/RLS regression).
- Existing `tests/order-review.test.ts`: pass (actual engine+PGlite, catalog pricing, payment/stock and replay semantics).
- Codex added `tests/tables-independent-review.test.ts`; focused `--test-name-pattern='table RLS'` passes: anonymous only sees active published tables, staff with settings/manage permissions cannot mutate, owner cannot change another shop, cross-shop/inactive order inserts fail, archived tables preserve historical order labels and cannot be deleted while referenced.
- The independent engine+managed-table test remains pending the TypeScript implementation; it is intentionally included in the normal review suite.

## Store/API review to resolve before completion

Current `dbCreateShopTable`/`dbUpdateShopTable` return a locally synthesized record when Supabase mutation returns `data: null, error: null`. A no-row update (for example concurrently deleted table or denied returning row) must not be reported as a successful persisted change. Require a returned canonical row or explicitly verify persistence. Also ensure Node tests use a disposable table store rather than writing `.local-db/shop-tables.json` in the developer checkout.

## Integration typecheck (while agents were still writing)

`npm run typecheck` at 18:19 reported:
- ShowToStaffModal.tsx: startOrderLiveSync accepts `query`, not `url`.
- ShowToStaffModal.tsx: quick tags have `{id,i18n}`, not `.label`.
- api-review.test.ts: fixture session role `merchant` is not allowed; existing signed session roles are owner/admin.

These need to be corrected by the owning agents before final suites. Browser UI opening on loopback was rejected by the browser permission gate; do not work around it via other browser surfaces. Use isolated tests and static/component render checks, and clearly record the missing browser QA.

## Confirmed bill identity mismatch

After first 4 independent tests passed, Codex added a stricter case to the existing independent engine test: a legacy order (`table_id=null`) shares the current display name of a managed table. `dbGetTableBill({table_id, table_label})` currently includes that legacy order via its OR branch, while migration 007's settlement deliberately excludes it for a resolved managed table. Preview and charged set must agree. Focused independent suite now fails this assertion; fix backend getter/local settlement to match SQL identity semantics, then rerun it. Do not weaken or edit Codex's assertion.

## UI integration details

ShowToStaffModal must keep existing `startOrderLiveSync({query: new URLSearchParams({orderId}).toString(),headers:...,onChange:...})`. The new `/api/orders/stream` URL does not exist; events remain `/api/orders/events` inside the sync helper. Don't replace guest live tracking while doing table/theme work. Quick tags use `.i18n`, not `.label`.
