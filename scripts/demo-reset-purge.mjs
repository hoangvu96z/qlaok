/**
 * Qlaok Demo Database Reset — App-Table Purge SQL Builder
 *
 * Scope: Generates deterministic, schema-qualified DELETE statements for the
 * 19 application data tables in `public` in strict child-first (leaf-to-root)
 * dependency order.
 *
 * Invariants:
 * - Deletes `public.sepay_webhook_events` before `public.orders` so deleting
 *   reconciled orders never triggers `ON DELETE SET NULL` into the
 *   `IMMUTABLE_SEPAY_EVENT_OUTCOME` BEFORE UPDATE trigger.
 * - Deletes `public.orders` before `public.shop_tables` so deleting tables
 *   never trips the `TABLE_HAS_HISTORICAL_ORDERS_ARCHIVE_INSTEAD` BEFORE DELETE
 *   trigger.
 * - Deletes all child tables before parent `public.shops` and `public.profiles`.
 * - Explicitly deletes unlinked `public.staff_login_rate_limits` and
 *   `public.payment_bank_ref_conflicts` tables.
 * - Preserves `public.provinces` and `public.schema_migrations`.
 * - Never touches `auth`, `storage`, `realtime`, migrations, RLS, or triggers.
 * - Does not include `BEGIN` / `COMMIT` (the reset executor wraps purge + seed
 *   in a single transaction).
 * - Pure static module: no dynamic user input and no database connection.
 */

export const DEMO_PURGE_TABLES = Object.freeze([
  // 1. Standalone / webhook / audit leaves
  'staff_login_rate_limits',
  'payment_bank_ref_conflicts',
  'sepay_webhook_events',
  'order_audit_logs',
  // 2. Orders & table service leaves
  'orders',
  'table_service_requests',
  // 3. Shop-scoped operational & config tables
  'shop_tables',
  'mobile_push_tokens',
  'shop_sepay_configs',
  'shop_staff_credentials',
  'shop_memberships',
  'shop_slug_aliases',
  // 4. Storefront & content tables
  'analytics_events',
  'posts',
  'items',
  'categories',
  // 5. Root tenant & billing tables
  'payment_transactions',
  'shops',
  'profiles',
]);

export const PRESERVED_PUBLIC_TABLES = Object.freeze([
  'admin_audit_logs',
  'provinces',
  'schema_migrations',
]);

export const DEMO_PURGE_STATEMENTS = Object.freeze(
  DEMO_PURGE_TABLES.map((table) => `DELETE FROM public.${table};`)
);

export function buildDemoPurgeSql() {
  if (arguments.length > 0) {
    throw new Error('buildDemoPurgeSql does not accept dynamic arguments.');
  }
  return DEMO_PURGE_STATEMENTS.join('\n');
}
