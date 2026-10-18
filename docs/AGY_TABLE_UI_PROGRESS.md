# AGY Table UI — Progress Log

## 1. Scope & Ownership Compliance
- **Owned files edited/created**:
  - `src/app/(storefront)/s/[slug]/menu/page.tsx`
  - `src/components/storefront/ShowToStaffModal.tsx`
  - `src/components/dashboard/PrintableStandee.tsx`
  - `src/components/dashboard/ShopTableManager.tsx` (new reusable dashboard table management component)
  - `src/app/(dashboard)/dashboard/qr-studio/page.tsx`
  - `src/app/(dashboard)/dashboard/reports/page.tsx`
  - `src/components/dashboard/PosCounterWorkspace.tsx`
  - `tests/agy-table-ui.test.ts` (new UI regression test suite)
  - `docs/AGY_TABLE_UI_PROGRESS.md`
  - `docs/AGY_TABLE_UI_HANDOFF.md`
- **Shell & Backend files untouched**: Did not edit shell-owned files (`src/app/(dashboard)/dashboard/layout.tsx`, `src/components/ui/ThemeToggle.tsx`, `src/app/layout.tsx`, `src/components/ui/AppI18nProvider.tsx`, `src/components/storefront/StorefrontCustomDecor.tsx`, storefront layout) or backend-owned files (`src/types/qlaok.ts`, `src/lib/shop-tables.ts`, `src/lib/table-helpers.ts`, `src/lib/mpos-store.ts`, `src/lib/db.ts`, `src/app/api/**`, `supabase/migrations/007_shop_tables.sql`, `tests/tables-independent-review.test.ts`).

## 2. CodeGraph Workflow Log
- Executed `codegraph status` and `codegraph sync` before and after source edits.
- Executed `codegraph explore`, `codegraph query`, `codegraph callers`, and `codegraph node`:
  - `codegraph explore "storefront menu ShowToStaffModal qr-studio PrintableStandee reports PosCounterWorkspace"`
  - `codegraph node "ShopTable"`, `codegraph node "startOrderLiveSync"`, `codegraph node "getAuthHeaders"`
  - `codegraph node -f` across `src/lib/table-helpers.ts`, `src/app/(storefront)/s/[slug]/menu/page.tsx`, `src/components/storefront/ShowToStaffModal.tsx`, `src/components/dashboard/PrintableStandee.tsx`, `src/components/dashboard/ShopTableManager.tsx`, `src/app/(dashboard)/dashboard/qr-studio/page.tsx`, `src/app/(dashboard)/dashboard/reports/page.tsx`, and `src/components/dashboard/PosCounterWorkspace.tsx`.

## 3. Incremental Milestones Completed
1. **Storefront Menu (`src/app/(storefront)/s/[slug]/menu/page.tsx`)**:
   - Retained compact `<LanguageSwitcher compact />` and added `<ThemeToggle compact />` in the sticky header; removed the duplicate horizontal 8-language flag row.
   - Loaded active `ShopTable[]` from `/api/shops?slug=...` (`data.tables`) with fallback to `/api/tables?shopId=...` and visible error/retry banner (`data-testid="menu-tables-load-error"`).
   - Resolved `?tableId=...` and legacy `?table=...` via `resolveTableSelection` and `filterSelectableTables` from `@/lib/table-helpers`.
   - Valid QR auto-selects the table; invalid/inactive/archived/foreign QR renders `data-testid="menu-table-resolution-warning"` requiring explicit table or Takeaway selection (never silently defaulting to `'Bàn 01'`).
   - Preserved `cart`, `lastOrder`, `editingOrder`, and `userTableChoice` across 4-second catalog polling and locale changes, resetting only when `slug` (shop) changes.
2. **Guest Order Modal (`src/components/storefront/ShowToStaffModal.tsx`)**:
   - Replaced hardcoded `QUICK_TABLES` chips with configured active `ShopTable[]` chips (`filterSelectableTables`) + Takeaway (`Mang về`).
   - Submits canonical `table_id` (`string | null`) and `table_label` to `POST /api/orders`.
   - Preserves existing unpaid order identity (`table_id`) and historical `table_label` snapshot during `PATCH /api/orders` unless explicitly changed by the guest.
   - Converted all modal confirmation, payment, live order tracker, empty, edit, and error states from forced-dark to light-by-default with explicit `dark:` variants while keeping the VietQR container strictly white (`qr-light-surface bg-white`, `#ffffff`).
3. **QR Studio & Table Management (`src/components/dashboard/PrintableStandee.tsx`, `src/components/dashboard/ShopTableManager.tsx`, `src/app/(dashboard)/dashboard/qr-studio/page.tsx`)**:
   - Updated `PrintableStandee.tsx` to accept `table?: ShopTable | null` and generate `/s/{slug}/menu?src=table&tableId={id}` via `buildTableMenuUrl`, displaying the table name/section/code on the white A6 standee card while retaining generic door (`?src=door`) and generic table (`?src=table`) standees.
   - Created `ShopTableManager.tsx` supporting owner table create, edit (`name`, `table_code`, `section`, `capacity`), activate/deactivate, and archive/restore via `/api/tables` using `getAuthHeaders()`, with read-only mode for non-owners (`data-testid="table-manager-readonly-banner"`), stale-shop response protection, loading/empty/error+retry states, and no hard-delete.
4. **Reports Per-Table Summary (`src/app/(dashboard)/dashboard/reports/page.tsx`)**:
   - Added `getAuthHeaders()` when fetching `/api/orders` and `/api/tables?shopId=...&includeInactive=1&includeArchived=1`.
   - Integrated `summarizeOrdersByTable(filteredOrders, activeShop.id, shopTables)` from `@/lib/table-helpers` to render `data-testid="reports-per-table-summary"`, the `🪑 Theo bàn` view tab, Excel export table summary rows, and historical snapshot vs current renamed table indicators.
5. **Counter POS Table Selection (`src/components/dashboard/PosCounterWorkspace.tsx`)**:
   - Replaced hardcoded `TABLE_PRESETS` (`Bàn 01..08`) with managed active `ShopTable[]` loaded from `/api/tables?shopId=...` using `getAuthHeaders()` plus non-table presets (`Mang về / Tại quầy`, `Giao hàng (Ship)`).
   - Submits `table_id: selectedTableId` and `headers: getAuthHeaders({ 'Content-Type': 'application/json' })` on `POST /api/orders` and `PATCH /api/orders`, preserving existing order `table_id` and `table_label` when editing an unpaid bill and keeping POS draft intact across locale switches.
