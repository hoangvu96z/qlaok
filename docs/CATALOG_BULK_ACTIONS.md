# Catalog bulk actions

Updated: 2026-10-24

The merchant catalog at `/dashboard/catalog` provides row selection and a compact bulk-action bar. A merchant can select individual rows or all visible rows on the current page. Selections remain active while paging through the same filtered catalog and are cleared when the shop, search query, or category changes, or after an action completes.

The bulk bar supports:

- **Set price**: applies one validated VND amount to selected items through the existing `bulk_update_price_stock` action. Per-item server results are reconciled against the selected IDs; missing or duplicate results count as failures. A partial result names the affected items and the page reloads server data.
- **Availability**: marks selected items available or temporarily sold out. The `bulk_update_availability` action writes only `items.is_available`; it does not modify `stock_quantity`.
- **Move category**: uses `bulk_move_items`. The result distinguishes moved items from items that already belonged to the destination category.
- **Delete**: requires an explicit confirmation with the selected count and uses `bulk_delete_items`. The UI removes items only after the server confirms the full requested batch.

## Permission and shop boundaries

The API is authoritative. Price changes, category moves, and deletes require active membership with `catalog.manage`. Availability changes require active membership with `catalog.manage` or `inventory.adjust`. Every catalog price write path (`POST /api/catalog` `upsert_item`, `bulk_import`, `bulk_update_price_stock`, and `dbUpsertItem` / `dbBulkImportCatalog`) enforces the shared integer-VND boundary (`0 <= price <= 1,000,000,000` via `parseCatalogPriceValue`) before writing; `bulk_import` validates all imported item prices before the first category or item write.

For `bulk_update_availability` (`bulk_set_availability`), the endpoint validates a boolean target and unique item IDs (maximum 2,000), then executes in one of two explicitly separated modes:
- **Real database mechanism (`typeof sb.rpc === 'function'`, required in production)**: Calls the PostgreSQL `SECURITY DEFINER` RPC `public.bulk_set_items_availability_atomic(p_shop_id, p_item_ids, p_is_available)` (`supabase/migrations/20261029000100_bulk_set_items_availability_atomic.sql`). Inside a single database transaction, the function locks all requested rows belonging to `p_shop_id` in deterministic `ORDER BY id` order using `FOR UPDATE`, rejects missing or cross-shop items with `ITEM_NOT_IN_SHOP` (HTTP 400), rejects any batch containing `stock_quantity = 0` when `p_is_available = true` with `ZERO_STOCK_CANNOT_MARK_AVAILABLE` and `zeroStockItemIds` (HTTP 409) before mutating any row (while allowing `stock_quantity IS NULL` unlimited stock and `stock_quantity > 0`), and updates all rows atomically (all-or-nothing) without ever performing a snapshot rollback that could overwrite concurrent updates on other items. Any database or RPC error returns HTTP 500 `DB_UPDATE_FAILED` with `updatedCount: 0, count: 0`.
- **Non-production unit-test mock fallback (`typeof sb.rpc !== 'function'`)**: Used only by lightweight test stubs that implement `sb.from('items')` without `.rpc`. Verifies shop membership of requested items, checks `stock_quantity === 0` before writing, applies the `.or('stock_quantity.is.null,stock_quantity.gt.0')` filter when enabling availability, and immediately returns HTTP 409 `BULK_AVAILABILITY_COUNT_MISMATCH` if the affected count does not match—never issuing a second compensating rollback `UPDATE` that could clobber concurrent writes.

For single-item `dbUpsertItem` (`upsert_item`), when `stock_quantity` is not being modified and `nextAvailable === true`, the `UPDATE` applies `.or('stock_quantity.is.null,stock_quantity.gt.0')`. If a concurrent order drains `stock_quantity` to `0` after the pre-read so the first `UPDATE` matches no row (`PGRST116`), `dbUpsertItem` re-reads the row and, only if `stock_quantity === 0`, executes a guarded `UPDATE ... WHERE id = ... AND shop_id = ... AND stock_quantity = 0` with `is_available: false`. If that fallback query fails with a database error, `dbUpsertItem` throws the database error; if the row no longer matches `stock_quantity = 0` (concurrent restock/race), it throws `STOCK_CONFLICT` (HTTP 409) and never fabricates in-memory availability success.

## Verification

The focused API coverage lives in `tests/catalog-excel-and-pagination.test.ts`; catalog row/page rendering coverage lives in `tests/catalog-dashboard-review.test.ts`.

```sh
npm run typecheck
npm run test:unit -- --test-name-pattern=catalog
npm run test:review
node --experimental-strip-types --import ./tests/register-ts.mjs --test tests/catalog-excel-and-pagination.test.ts tests/catalog-dashboard-review.test.ts
```
