# Catalog bulk actions

Updated: 2026-10-24

The merchant catalog at `/dashboard/catalog` provides row selection and a compact bulk-action bar. A merchant can select individual rows or all visible rows on the current page. Selections remain active while paging through the same filtered catalog and are cleared when the shop, search query, or category changes, or after an action completes.

The bulk bar supports:

- **Set price**: applies one validated VND amount to selected items through the existing `bulk_update_price_stock` action. Per-item server results are reconciled against the selected IDs; missing or duplicate results count as failures. A partial result names the affected items and the page reloads server data.
- **Availability**: marks selected items available or temporarily sold out. The `bulk_update_availability` action writes only `items.is_available`; it does not modify `stock_quantity`.
- **Move category**: uses `bulk_move_items`. The result distinguishes moved items from items that already belonged to the destination category.
- **Delete**: requires an explicit confirmation with the selected count and uses `bulk_delete_items`. The UI removes items only after the server confirms the full requested batch.

Bulk operations stay bound to the shop shown when the action starts. Bulk delete checks the shop again after its confirmation dialog, so confirming after switching shops does not send the old selection. If a request was already sent before switching, the server may finish it for the originating shop; the old response is ignored by the newly selected shop's UI, and returning to the originating shop reloads its catalog.

## Permission and shop boundaries

The API is authoritative. Price changes, category moves, and deletes require active membership with `catalog.manage`. Availability changes require active membership with `catalog.manage` or `inventory.adjust`. Every catalog price write path (`POST /api/catalog` `upsert_item`, `bulk_import`, `bulk_update_price_stock`, and `dbUpsertItem` / `dbBulkImportCatalog`) enforces the shared integer-VND boundary (`0 <= price <= 1,000,000,000` via `parseCatalogPriceValue`) before writing; `bulk_import` validates all imported item prices before the first category or item write.

For `bulk_update_availability` (`bulk_set_availability`), the endpoint validates a boolean target and unique item IDs (maximum 2,000), then executes in one of two explicitly separated modes:
- **Real database mechanism (`typeof sb.rpc === 'function'`, required in production)**: Calls the PostgreSQL `SECURITY DEFINER` RPC `public.bulk_set_items_availability_atomic(p_shop_id, p_item_ids, p_is_available)` (`supabase/migrations/20261029000100_bulk_set_items_availability_atomic.sql`). Inside a single database transaction, the function locks all requested rows belonging to `p_shop_id` in deterministic `ORDER BY id` order using `FOR UPDATE`, rejects missing or cross-shop items with `ITEM_NOT_IN_SHOP` (HTTP 400), rejects any batch containing `stock_quantity = 0` when `p_is_available = true` with `ZERO_STOCK_CANNOT_MARK_AVAILABLE` and `zeroStockItemIds` (HTTP 409) before mutating any row (while allowing `stock_quantity IS NULL` unlimited stock and `stock_quantity > 0`), and updates all rows atomically (all-or-nothing) without ever performing a snapshot rollback that could overwrite concurrent updates on other items. Any database or RPC error returns HTTP 500 `DB_UPDATE_FAILED` with `updatedCount: 0, count: 0`.
- **Non-production unit-test mock fallback (`typeof sb.rpc !== 'function'`)**: Used only by lightweight test stubs that implement `sb.from('items')` without `.rpc`. Verifies shop membership of requested items, checks `stock_quantity === 0` before writing, applies the `.or('stock_quantity.is.null,stock_quantity.gt.0')` filter when enabling availability, and immediately returns HTTP 409 `BULK_AVAILABILITY_COUNT_MISMATCH` if the affected count does not match—never issuing a second compensating rollback `UPDATE` that could clobber concurrent writes.

For single-item `dbUpsertItem` (`upsert_item`), when `stock_quantity` is not being modified and `nextAvailable === true`, the `UPDATE` applies `.or('stock_quantity.is.null,stock_quantity.gt.0')`. If a concurrent order drains `stock_quantity` to `0` after the pre-read so the first `UPDATE` matches no row (`PGRST116`), `dbUpsertItem` re-reads the row and, only if `stock_quantity === 0`, executes a guarded `UPDATE ... WHERE id = ... AND shop_id = ... AND stock_quantity = 0` with `is_available: false`. If that fallback query fails with a database error, `dbUpsertItem` throws the database error; if the row no longer matches `stock_quantity = 0` (concurrent restock/race), it throws `STOCK_CONFLICT` (HTTP 409) and never fabricates in-memory availability success.

When an existing item is updated via `POST /api/catalog` (`action: 'upsert_item'`) with a legacy full-item snapshot that includes `stock_quantity` without `expected_stock_quantity`:
- If `stock_quantity` is an echoed snapshot (either unchanged from the database row or conserved across order commits / order-cancellation restocks where `stock_quantity + sold_count` is invariant), the server strips `stock_quantity` and `sold_count` so concurrent inventory is never overwritten. In both owner (`catalog.manage`) and inventory-only (`inventory.adjust`) paths, if `is_available` differs from the database row without `expected_is_available` / `expectedIsAvailable`, the server rejects the ambiguous legacy full snapshot with HTTP 409 `STOCK_CONFLICT` so neither a concurrent availability toggle (`true -> false` or `false -> true`) nor a requested change is silently lost or misinferred from an echoed stock payload. When non-inventory catalog fields change (such as `price`) and `is_available` matches the database row (or is a stale pre-exhaustion `is_available: true` snapshot after orders drained stock to `0`), `is_available` is stripped. Callers that toggle availability on a full snapshot must supply `expected_is_available` (`boolean`) for compare-and-set verification (`409 STOCK_CONFLICT` on mismatch; `400 INVALID_EXPECTED_AVAILABILITY` if non-boolean). Legitimate narrow availability toggles (omitting stock fields), snapshot updates with explicit `expected_is_available`, and no-op full-item saves (`200 OK`) remain supported.
- If `stock_quantity` differs from the database row and `stock_quantity + sold_count` is not conserved (e.g., another staff member manually adjusted stock while `expected_stock_quantity` was omitted), the server fails closed with HTTP 409 `STOCK_CONFLICT` rather than guessing whether to overwrite live stock or drop an intended stock edit.
- On Web (`/dashboard/catalog` and `TranslationEditorModal`) and Mobile (`CatalogTab` / `mobile/App.tsx`), HTTP 409 conflicts (`STOCK_CONFLICT`, `ZERO_STOCK_CANNOT_MARK_AVAILABLE`, `BULK_*_COUNT_MISMATCH`) refresh catalog state in the background without unmounting or clearing unsaved user drafts (open modal fields, bulk selection/price/category inputs, category draft, or Mobile Quick Add / Settings / Promotions drafts). When `TranslationEditorModal` saves an item with `is_available: true` whose server-returned `item.is_available` is `false` due to `0` stock, the modal remains open, syncs its checkbox to `false`, and displays an inline explanation instead of a false-positive availability toast.

## Verification

The focused API coverage lives in `tests/catalog-excel-and-pagination.test.ts`; catalog row/page rendering coverage lives in `tests/catalog-dashboard-review.test.ts`.

```sh
npm run typecheck
npm run test:unit -- --test-name-pattern=catalog
npm run test:review
node --experimental-strip-types --import ./tests/register-ts.mjs --test tests/catalog-excel-and-pagination.test.ts tests/catalog-dashboard-review.test.ts
```
