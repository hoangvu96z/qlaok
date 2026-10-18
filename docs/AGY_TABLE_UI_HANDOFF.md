# AGY Table UI — Handoff Report for Codex

## 1. CodeGraph Queries Executed
- `codegraph status` & `codegraph sync`
- `codegraph explore "storefront menu ShowToStaffModal qr-studio PrintableStandee reports PosCounterWorkspace"`
- `codegraph query "table_label QUICK_TABLES TABLE_PRESETS PrintableStandee"`
- `codegraph callers "ShowToStaffModal"`, `codegraph callers "PrintableStandee"`, `codegraph callers "PosCounterWorkspace"`
- `codegraph node "ShopTable"`, `codegraph node "startOrderLiveSync"`, `codegraph node "getAuthHeaders"`
- `codegraph node -f` on:
  - `src/lib/table-helpers.ts`
  - `src/app/(storefront)/s/[slug]/menu/page.tsx`
  - `src/components/storefront/ShowToStaffModal.tsx`
  - `src/components/dashboard/PrintableStandee.tsx`
  - `src/components/dashboard/ShopTableManager.tsx`
  - `src/app/(dashboard)/dashboard/qr-studio/page.tsx`
  - `src/app/(dashboard)/dashboard/reports/page.tsx`
  - `src/components/dashboard/PosCounterWorkspace.tsx`

## 2. Modified & Created Files (Affected Areas)
- `src/app/(storefront)/s/[slug]/menu/page.tsx`
  - Header retains compact `<LanguageSwitcher compact />`, adds `<ThemeToggle compact />`, and removes the duplicate horizontal 8-flag row.
  - Resolves `?tableId=` and legacy `?table=` against active shop tables (`filterSelectableTables` + `resolveTableSelection` from `@/lib/table-helpers`).
  - Auto-selects valid active table QR; displays `data-testid="menu-table-resolution-warning"` for invalid/inactive/archived/foreign QR and requires explicit table or Takeaway choice.
  - Preserves cart, active/editing order, and table choice across 4s polling and locale changes (`prevShopSlugRef`).
- `src/components/storefront/ShowToStaffModal.tsx`
  - Replaces hardcoded `QUICK_TABLES` with configured active `ShopTable[]` (`filterSelectableTables`) + Takeaway (`Mang về`).
  - Submits canonical `table_id` and `table_label` to `POST /api/orders`; preserves existing unpaid order's `table_id` and historical `table_label` snapshot on `PATCH /api/orders` unless explicitly changed.
  - Light-by-default modal surfaces with explicit `dark:` variants (`bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100`) and strictly white high-contrast VietQR container (`qr-light-surface bg-white`, `#ffffff`).
- `src/components/dashboard/PrintableStandee.tsx`
  - Supports per-table QR URL generation via `buildTableMenuUrl(baseUrl, shop.slug, resolvedTableId)` (`/s/{slug}/menu?src=table&tableId={id}`), displaying the table name, section, and code on the white A6 standee card while retaining generic door (`?src=door`) and generic table (`?src=table`) standees.
- `src/components/dashboard/ShopTableManager.tsx`
  - Reusable dashboard table management component for QR Studio (`data-testid="qr-studio-table-management"`).
  - Loads tables via `/api/tables?shopId=...&includeInactive=1&includeArchived=1` with `getAuthHeaders()`, discards stale shop responses, and shows loading/empty/error+retry states.
  - Owner CRUD (`POST /api/tables`, `PATCH /api/tables`) for create, edit (`name`, `table_code`, `section`, `capacity`), activate/deactivate, and archive/restore (no hard-delete). Non-owners see read-only mode (`data-testid="table-manager-readonly-banner"`).
  - Generates per-table QR URLs with copy link, open menu, and printable standee preview/download via `PrintableStandee`.
- `src/app/(dashboard)/dashboard/qr-studio/page.tsx`
  - Integrates `ShopTableManager` with a discoverable `#table-management` heading/jump link while retaining generic Door (`?src=door`) and Table (`?src=table`) standee cards.
- `src/app/(dashboard)/dashboard/reports/page.tsx`
  - Passes `getAuthHeaders()` to `/api/orders` and `/api/tables?shopId=...&includeInactive=1&includeArchived=1`, discarding stale shop responses.
  - Computes per-table statistics via `summarizeOrdersByTable(filteredOrders, activeShop.id, shopTables)` and renders `data-testid="reports-per-table-summary"`, the `🪑 Theo bàn` tab, Excel export rows, and order-row historical label vs current renamed table indicators.
- `src/components/dashboard/PosCounterWorkspace.tsx`
  - Loads active managed tables with `getAuthHeaders()`, replaces hardcoded `TABLE_PRESETS` (`Bàn 01..08`) with managed active tables + non-table presets (`Mang về / Tại quầy`, `Giao hàng (Ship)`), sends `table_id` and `getAuthHeaders` on `POST`/`PATCH /api/orders`, and preserves POS draft across locale changes.
- `tests/agy-table-ui.test.ts`
  - Focused UI regression and helper integration tests covering all 5 requirements.

## 3. Verification Executed & Results
- `codegraph sync`: Up to date (`0` stale files).
- `node --experimental-strip-types --import ./tests/register-ts.mjs --test tests/agy-table-ui.test.ts tests/tables-independent-review.test.ts`:
  - **9 / 9 tests passed** (`5` UI contract & helper integration tests in `tests/agy-table-ui.test.ts` + `4` backend/RLS/table review tests in `tests/tables-independent-review.test.ts`).
- `npm run typecheck` (`tsc --noEmit --incremental false`):
  - **Passed with 0 errors**.

## 4. Unverified / Remaining Items for Codex Coordinator
- Per instructions, production `npm run build` and live browser E2E runs were not executed while sibling agents may be active; Codex coordinator owns full integration test suite, production build, and live browser QA.
