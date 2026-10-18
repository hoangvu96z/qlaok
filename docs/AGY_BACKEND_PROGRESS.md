# Qlaok — AGY Backend Progress Report

## Status
- **Completed** (All backend deliverables implemented and verified against isolated PGlite SQL, API, review, and unit test suites).

## Completed Deliverables
1. **Additive Migration (`supabase/migrations/007_shop_tables.sql`)**:
   - Reviewed against `004_shop_memberships_and_order_integrity.sql` and `005_order_payment_atomic_invariants.sql` and verified for idempotent replay.
   - Created `public.shop_tables` (`id`, `shop_id`, `table_code`, `name`, `section`, `capacity`, `sort_order`, `is_active`, `is_archived`, `archived_at`, `created_at`, `updated_at`) with unique indexes on `(shop_id, LOWER(BTRIM(table_code)))` and `(shop_id, LOWER(BTRIM(name))) WHERE is_archived = FALSE`.
   - Added `public.orders.table_id TEXT DEFAULT NULL REFERENCES public.shop_tables(id) ON DELETE SET NULL`, index `idx_orders_shop_table_id`, and backfill for matching existing orders.
   - Added RLS policies (`shop_tables_select`, `shop_tables_owner_insert`, `shop_tables_owner_update`, `shop_tables_owner_delete`) and trigger `trg_enforce_shop_table_boundaries` (owner-only client mutations, prevents deleting tables referenced by historical orders, auto-deactivates on archive).
   - Updated `enforce_order_state_and_payment_invariants`, `commit_order_with_inventory`, `update_order_with_inventory`, and `settle_table_bill_atomic` preserving all `005` signatures, return shapes, stock delta directions, payment locks, and idempotency while enforcing cross-shop/inactive table validation, canonical `table_label` snapshotting, historical label preservation across rename/archive, and `table_id`-isolated bill settlement.
2. **Shared Types (`src/types/qlaok.ts`)**:
   - Exported `ShopTable`, `PublicShopTable`, `GuestTableResolution`, `TableOrderStats` (`TableOrderStatsRow`), `StorefrontShopBundle.tables`, `ShopOrder.table_id`, and `TableBillSummary.table_id`.
3. **Pure Client-Safe Helpers (`src/lib/table-helpers.ts`)**:
   - Exported `buildTableMenuUrl(baseUrl, slug, tableId)`, `filterSelectableTables(tables, shopId?)`, `resolveTableSelection(tables, { tableId, table })`, `summarizeOrdersByTable(orders, shopId, tables?)`, and `isTakeawayTableLabel(label)`.
4. **Server Store (`src/lib/shop-tables.ts`) & Storefront Bundle (`src/lib/db.ts`)**:
   - Implemented `dbGetShopTables`, `dbGetPublicShopTables`, `dbGetShopTableById`, `dbResolveOrderTableIdentity`, `dbCreateShopTable`, `dbUpdateShopTable`, `setShopTablesDbClientForTests`, `setShopTablesFileForTests`, `getLocalTablesFilePath`, `isShopTablesDbAuthoritative`, and `SEED_SHOP_TABLES`.
   - Isolated Node test process local store into a process-scoped `os.tmpdir()` file (`PROCESS_TEST_TABLES_FILE`) with `NODE_TEST_CONTEXT` / `--test` / `NODE_ENV === 'test'` detection so root unit/review tests never read or mutate `process.cwd()/.local-db/shop-tables.json`.
   - Updated `dbGetStorefrontBundle` in `src/lib/db.ts` to include `tables: ShopTable[]` (active unarchived only), failing closed on DB errors rather than silently substituting fallback tables.
5. **Order Engine (`src/lib/mpos-store.ts`) & API Routes (`src/app/api/tables/route.ts`, `src/app/api/orders/route.ts`)**:
   - Validated `table_id` / `table_code` / `table_label` in `dbCreateOrder` and `dbUpdateOrderStatus` BEFORE stock deduction; snapshotted canonical `table_label`; preserved historical `table_label` across table renames/archives; isolated `dbGetTableBill` and `dbSettleTableBill` by `table_id` (excluding legacy orders sharing a display name with a managed table).
   - Implemented `/api/tables` (`GET` public active-only for published shops vs `includeInactive=1`/`includeArchived=1` for authenticated permitted shop members/owner/admin; `POST`/`PATCH` strictly owner/admin; `DELETE` returns 405).
   - Updated `/api/orders` (`GET` `table_bill`, `POST` `create_order` & `settle_table_bill`, `PATCH` guest & staff flows) to accept `table_id` / `tableId` and `table_code` / `tableCode`.
6. **Backend Regression Tests (`tests/sql-review.test.mjs`, `tests/api-review.test.ts`, `tests/table-store-isolation-review.test.ts`, `tests/tables-independent-review.test.ts`)**:
   - Added SQL replay, RLS, trigger, and atomic RPC tests in `tests/sql-review.test.mjs`.
   - Added API-level `/api/tables`, `/api/shops?slug=...`, and `/api/orders` (`table_id` creation, spoofed label override, cross-shop/inactive/archived rejection, guest `PATCH` identity preservation, and name-reuse settlement isolation) tests in `tests/api-review.test.ts`.
   - Added `tests/table-store-isolation-review.test.ts` verifying that root Node tests isolate table storage in `os.tmpdir()` and leave `process.cwd()/.local-db/shop-tables.json` byte-for-byte untouched.
   - Verified all 4 independent review tests in `tests/tables-independent-review.test.ts` and all 48 review tests in `npm run test:review` pass.
