# Catalog bulk actions

Updated: 2026-10-24

The merchant catalog at `/dashboard/catalog` provides row selection and a compact bulk-action bar. A merchant can select individual rows or all visible rows on the current page. Selections remain active while paging through the same filtered catalog and are cleared when the shop, search query, or category changes, or after an action completes.

The bulk bar supports:

- **Set price**: applies one validated VND amount to selected items through the existing `bulk_update_price_stock` action. Per-item server results are reconciled against the selected IDs; missing or duplicate results count as failures. A partial result names the affected items and the page reloads server data.
- **Availability**: marks selected items available or temporarily sold out. The `bulk_update_availability` action writes only `items.is_available`; it does not modify `stock_quantity`.
- **Move category**: uses `bulk_move_items`. The result distinguishes moved items from items that already belonged to the destination category.
- **Delete**: requires an explicit confirmation with the selected count and uses `bulk_delete_items`. The UI removes items only after the server confirms the full requested batch.

## Permission and shop boundaries

The API is authoritative. Price changes, category moves, and deletes require active membership with `catalog.manage`. Availability changes require active membership with `catalog.manage` or `inventory.adjust`. The availability endpoint validates a boolean target, unique item IDs (maximum 2,000), and verifies every item belongs to the requested shop before writing. It returns an error if the affected row count does not match the request. No schema or environment-variable change is required.

## Verification

The focused API coverage lives in `tests/catalog-excel-and-pagination.test.ts`; catalog row/page rendering coverage lives in `tests/catalog-dashboard-review.test.ts`.

```sh
npm run typecheck
npm run test:unit -- --test-name-pattern=catalog
npm run test:review
node --experimental-strip-types --import ./tests/register-ts.mjs --test tests/catalog-excel-and-pagination.test.ts tests/catalog-dashboard-review.test.ts
```
