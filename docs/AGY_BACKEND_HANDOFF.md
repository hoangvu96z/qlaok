# Qlaok — AGY Backend Handoff Report

## 1. Summary of Backend Implementation
This handoff covers the backend-only scope defined in `/tmp/qlaok-table-contract.md` and `docs/CODEX_TABLES_REVIEW.md`. No UI components, pages, layouts, theme files, or Codex independent tests (`tests/tables-independent-review.test.ts`) were modified by this session.

## 2. Changed & Created Backend Files
- `supabase/migrations/007_shop_tables.sql` *(new)* — Additive PostgreSQL migration defining `public.shop_tables`, `public.orders.table_id`, unique indexes, demo table seeds, RLS policies (`shop_tables_select`, `shop_tables_owner_insert`, `shop_tables_owner_update`, `shop_tables_owner_delete`), boundary trigger (`trg_enforce_shop_table_boundaries`), and updated order/settlement RPCs (`enforce_order_state_and_payment_invariants`, `commit_order_with_inventory`, `update_order_with_inventory`, `settle_table_bill_atomic`) preserving all `004`/`005` invariants and idempotency.
- `src/types/qlaok.ts` — Added `ShopTable`, `PublicShopTable`, `GuestTableResolution`, `TableOrderStats` (`TableOrderStatsRow`), `StorefrontShopBundle.tables`, `ShopOrder.table_id`, and `TableBillSummary.table_id`.
- `src/lib/table-helpers.ts` *(new)* — Pure client-safe helpers:
  - `buildTableMenuUrl(baseUrl, slug, tableId)`
  - `filterSelectableTables(tables, shopId?)`
  - `resolveTableSelection(tables, { tableId, table })`
  - `summarizeOrdersByTable(orders, shopId, tables?)`
  - `isTakeawayTableLabel(label)`
- `src/lib/shop-tables.ts` *(new)* — Authoritative server store for `shop_tables`:
  - `dbGetShopTables(shopId, { includeInactive, includeArchived })`
  - `dbGetPublicShopTables(shopId)`
  - `dbGetShopTableById(tableId)`
  - `dbResolveOrderTableIdentity({ shop_id, table_id, table_code, table_label, strictTableSelection })`
  - `dbCreateShopTable(input)` (fails closed when DB returns error or null row)
  - `dbUpdateShopTable(input)` (fails closed when DB returns error or null row; enforces same-shop boundary and auto-deactivates on archive)
  - `setShopTablesDbClientForTests(client)`
  - `setShopTablesFileForTests(filePath)` & `getLocalTablesFilePath()` (uses a process-scoped `os.tmpdir()` store `qlaok-shop-tables-test-<pid>-<timestamp>/shop-tables.json` when running under Node test runtime via `NODE_TEST_CONTEXT` / `--test` / `NODE_ENV === 'test'`, never touching developer `process.cwd()/.local-db/shop-tables.json`)
- `src/lib/db.ts` — Exported `isSupabaseDbClientOverriddenForTests()` and updated `dbGetStorefrontBundle` to return `tables: ShopTable[]` (active unarchived only via `dbGetPublicShopTables`), surfacing DB errors instead of silently substituting fallback tables.
- `src/lib/mpos-store.ts` — Updated `normalizeOrderRecord`, `dbCreateOrder`, `dbUpdateOrderStatus`, `dbGetTableBill`, `dbSettleTableBill`, and `summarizeSettledOrders`:
  - Validates `table_id` / `table_code` / `table_label` before stock deduction so invalid/inactive/cross-shop tables never deduct stock or create orders.
  - Snapshots canonical `ShopTable.name` into `orders.table_label` when `table_id` is resolved.
  - Preserves historical `orders.table_label` and `orders.table_id` across table renames/archives during unpaid edits and payment settlement.
  - Isolates `dbGetTableBill` and `dbSettleTableBill` by `table_id` for managed tables so archived tables or legacy orders sharing a display name are never merged into an active managed table's bill.
- `src/app/api/tables/route.ts` *(new)* — Implemented `GET`, `POST`, `PATCH`, and `DELETE` (405 archive-only guard) following `/tmp/qlaok-table-contract.md`.
- `src/app/api/orders/route.ts` — Updated `GET` (`table_bill`), `POST` (`create_order`, `settle_table_bill`), and `PATCH` (both guest `trackingToken` self-edit and staff `orders.edit_items` flows) to accept and validate `table_id` / `tableId` and `table_code` / `tableCode`.
- `tests/sql-review.test.mjs` — Added idempotent replay of `007_shop_tables.sql`, `shop_tables` RLS assertions (`anon`, `staff`, `cashier`, `owner`), `TABLE_HAS_HISTORICAL_ORDERS_ARCHIVE_INSTEAD` delete trigger check, `commit_order_with_inventory` cross-shop/inactive table rejection, and `settle_table_bill_atomic` name-reuse isolation.
- `tests/api-review.test.ts` — Added API-level regression tests for `/api/tables`, `/api/shops?slug=pho-hoi-an` bundle tables, and `/api/orders` (`POST`, guest `PATCH`, `settle_table_bill`) with managed `table_id`.
- `tests/table-store-isolation-review.test.ts` *(new)* — Regression test verifying that root Node test processes isolate `shop-tables` storage under `os.tmpdir()` and never read or mutate `process.cwd()/.local-db/shop-tables.json`.

## 3. CodeGraph Workflow Queries Executed
- `codegraph status`
- `codegraph sync`
- `codegraph explore "dbGetStorefrontBundle StorefrontShopBundle"`
- `codegraph explore "setSupabaseDbClientForTests setMposDbClientForTests"`
- `codegraph explore "requireShopPermission getRequestShopMembership requireAuthenticatedUser"`
- `codegraph explore "normalizeOrderRecord dbCreateOrder dbUpdateOrderStatus"`
- `codegraph explore "dbGetTableBill dbSettleTableBill"`
- `codegraph explore "trackingToken PATCH /api/orders"`
- `codegraph explore "SEED_SHOPS"`
- `codegraph explore "filterSelectableTables"`
- `codegraph node "getLocalTablesFilePath"`
- `codegraph node "readLocalTablesStore"`
- `codegraph node "writeLocalTablesStore"`
- `codegraph node "src/lib/shop-tables.ts"`
- `codegraph node "src/types/qlaok.ts"`
- `codegraph node "src/lib/db.ts"`
- `codegraph node "src/lib/mpos-store.ts"`
- `codegraph node "src/app/api/orders/route.ts"`
- `codegraph node "src/app/api/shops/route.ts"`
- `codegraph node "src/components/dashboard/ShopTableManager.tsx"`
- `codegraph node "src/components/dashboard/PosCounterWorkspace.tsx"`
- `codegraph node "tests/sql-review.test.mjs"`
- `codegraph node "tests/api-review.test.ts"`
- `codegraph callers "dbGetStorefrontBundle"`
- `codegraph callers "src/lib/table-helpers.ts"`

## 4. Validation Commands & Results
1. **SQL Migration, Replay, RLS & Atomic RPC Tests**:
   - Command: `npm run test:sql`
   - Result: **PASS** (1/1 suite, including `007_shop_tables.sql` idempotent replay, RLS boundaries for `anon`/`staff`/`cashier`/`owner`, archive trigger, and `settle_table_bill_atomic` table_id isolation).
2. **Review & Independent Table Tests**:
   - Command: `npm run test:review`
   - Result: **PASS** (48/48 tests, including `tests/table-store-isolation-review.test.ts`, all 4 tests in `tests/tables-independent-review.test.ts`, and `/api/tables` + `/api/orders` + `/api/shops` tests in `tests/api-review.test.ts`).
3. **Unit & Security Hardening Tests**:
   - Command: `npm run test:unit`
   - Result: **PASS** (66/66 tests across 9 suites).
4. **TypeScript Typecheck**:
   - Command: `npm run typecheck`
   - Result: All backend files (`src/types/qlaok.ts`, `src/lib/table-helpers.ts`, `src/lib/shop-tables.ts`, `src/lib/db.ts`, `src/lib/mpos-store.ts`, `src/app/api/tables/route.ts`, `src/app/api/orders/route.ts`, `tests/api-review.test.ts`, `tests/table-store-isolation-review.test.ts`, `tests/tables-independent-review.test.ts`) have **0 TypeScript errors**.

## 5. Migration & Unverified Environment Notes
- **Migration Required**: `supabase/migrations/007_shop_tables.sql` is additive and must be applied to target Supabase environments before deploying managed-table features. No live/production migration was executed during this session.
- **Unverified**: Production Supabase deployment, physical receipt printers, and mobile physical devices were not accessed or claimed verified.
