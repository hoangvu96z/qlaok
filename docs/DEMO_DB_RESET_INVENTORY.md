# Qlaok Demo Database Reset — Table Inventory & Reset Gap Analysis

Updated: **2026-10-25**. Scope: read-only schema and seed inventory from repository migrations (`001`–`019`) and server modules. No live database connection or destructive SQL is executed in this document.

- **Target Supabase Project Reference (identification only):** `kftmrjmmympztzztunxf`
- **Migration range analyzed:** `supabase/migrations/001_init_qlaok.sql` through `019_revoke_staff_trigger_execute.sql`

---

## 1. App-Owned `public` Tables (Migrations `001`–`019`)

Migrations `001`–`019` create **21 tables** in the `public` schema: **19 application data tables**, **1 static reference table** (`public.provinces`), and **1 migration tracking table** (`public.schema_migrations`).

| # | Table (`public.*`) | Created / Altered In | Primary Key | Outbound Foreign Keys (`ON DELETE` behavior) | Reset Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | `schema_migrations` | `003` (`scripts/migrate-supabase.mjs`) | `filename` (`TEXT`) | None | **Preserve** (tracks applied migrations `001`–`019` & checksums) |
| 2 | `provinces` | `001` | `code` (`VARCHAR(50)`) | None | **Preserve / Re-upsert** (34 canonical VN provinces/cities) |
| 3 | `profiles` | `001`, `003`, `004` | `id` (`TEXT`) | None in `public` (logical link to `auth.users.id` or demo/admin IDs) | **Reset & Re-seed** (`SEED_PROFILE` + Super Admin profile + any preserved QA owner profile) |
| 4 | `payment_transactions` | `001`, `002z`, `003`, `015` | `id` (`TEXT`) | `user_id` → `profiles(id)` (`CASCADE`) | **Reset & Re-seed** (`SEED_TRANSACTIONS`) |
| 5 | `payment_bank_ref_conflicts` | `002z` | `transaction_id` (`TEXT`) | None (stores `transaction_id`, `retained_transaction_id` as plain `TEXT`) | **Clear** (legacy duplicate bank-ref archive) |
| 6 | `shops` | `001`, `003`, `004`, `011`, `013`, `014`, `018` | `id` (`TEXT`) | `owner_id` → `profiles(id)` (`CASCADE`) | **Reset & Re-seed** (`SEED_SHOPS`) |
| 7 | `shop_slug_aliases` | `014` | `slug` (`VARCHAR(100)`) | `shop_id` → `shops(id)` (`CASCADE`) | **Clear** (historical slug redirects) |
| 8 | `categories` | `001`, `003`, `004` | `id` (`TEXT`) | `shop_id` → `shops(id)` (`CASCADE`) | **Reset & Re-seed** (`SEED_CATEGORIES`) |
| 9 | `items` | `001`, `002`, `003`, `004` | `id` (`TEXT`) | `shop_id` → `shops(id)` (`CASCADE`); `category_id` → `categories(id)` (`CASCADE`) | **Reset & Re-seed** (`SEED_ITEMS` + stock/sold counters) |
| 10 | `posts` | `001`, `003` | `id` (`TEXT`) | `shop_id` → `shops(id)` (`CASCADE`) | **Reset & Re-seed** (`SEED_POSTS`) |
| 11 | `analytics_events` | `001`, `003`, `004` | `id` (`BIGSERIAL`) | `shop_id` → `shops(id)` (`CASCADE`); `item_id` → `items(id)` (`SET NULL`) | **Reset & Re-seed** (`SEED_ANALYTICS`) |
| 12 | `shop_tables` | `007`, `012` | `id` (`TEXT`) | `shop_id` → `shops(id)` (`CASCADE`) | **Reset & Re-seed** (demo managed tables per shop) |
| 13 | `orders` | `002`, `003`, `004`, `005`, `006`, `007`, `010`, `012`, `016`, `017` | `id` (`TEXT`) | `shop_id` → `shops(id)` (`CASCADE`); `table_id` → `shop_tables(id)` (`SET NULL`) | **Reset** (optionally seed demo orders if desired) |
| 14 | `order_audit_logs` | `004` | `id` (`TEXT`) | `shop_id` → `shops(id)` (`CASCADE`); `order_id` → `orders(id)` (`CASCADE`) | **Clear** |
| 15 | `table_service_requests` | `009`, `018` | `id` (`TEXT`) | `shop_id` → `shops(id)` (`CASCADE`); `table_id` → `shop_tables(id)` (`CASCADE`) *(Note: `acknowledged_by`/`resolved_by` FKs to `profiles` were dropped in `018`)* | **Clear** |
| 16 | `shop_memberships` | `004`, `018` | `id` (`TEXT`) | `shop_id` → `shops(id)` (`CASCADE`) (`user_id` has no FK constraint; dropped in `004`) | **Reset & Re-seed** (owner memberships for `SEED_SHOPS`) |
| 17 | `shop_staff_credentials` | `018`, `019` | `user_id` (`TEXT`) | `shop_id` → `shops(id)` (`CASCADE`) | **Clear** (or re-seed only if QA staff accounts are explicitly requested) |
| 18 | `staff_login_rate_limits` | `018`, `019` | `bucket_key` (`TEXT`) | None (hashed rate-limit buckets `rl-staff-*`) | **Clear** (no FK to `shops`; must be deleted explicitly) |
| 19 | `mobile_push_tokens` | `008` | `id` (`TEXT`) | `shop_id` → `shops(id)` (`CASCADE`) | **Clear** |
| 20 | `shop_sepay_configs` | `011` | `shop_id` (`TEXT`) | `shop_id` → `shops(id)` (`CASCADE`) | **Clear** |
| 21 | `sepay_webhook_events` | `011` | `id` (`TEXT`) | `shop_id` → `shops(id)` (`CASCADE`); `order_id` → `orders(id)` (`SET NULL`) | **Clear** |

---

## 2. Foreign-Key & Trigger Dependencies Relevant to Deletion

Even though most child tables reference `public.shops(id) ON DELETE CASCADE` and `public.shops` references `public.profiles(id) ON DELETE CASCADE`, **two database triggers block naive parent-first cascading deletes**:

1. **`public.sepay_webhook_events` → `public.orders` (`ON DELETE SET NULL` blocked by trigger):**
   - `sepay_webhook_events.order_id` references `public.orders(id) ON DELETE SET NULL`.
   - However, `trg_enforce_sepay_webhook_events_boundaries` (`011_sepay_order_reconciliation.sql`) runs `BEFORE UPDATE ON public.sepay_webhook_events` and raises `IMMUTABLE_SEPAY_EVENT_OUTCOME` if `OLD.outcome = 'reconciled'` and `NEW.order_id IS DISTINCT FROM OLD.order_id`.
   - Deleting a reconciled row in `public.orders` before deleting `public.sepay_webhook_events` triggers `ON DELETE SET NULL` on `sepay_webhook_events.order_id`, which fails in the `BEFORE UPDATE` trigger. **`public.sepay_webhook_events` must be deleted before `public.orders`.**
2. **`public.orders` → `public.shop_tables` (`BEFORE DELETE` trigger blocks table deletion when orders exist):**
   - `orders.table_id` references `public.shop_tables(id) ON DELETE SET NULL`.
   - However, `trg_enforce_shop_table_boundaries` (`007_shop_tables.sql`) runs `BEFORE DELETE ON public.shop_tables` — prior to the FK `ON DELETE SET NULL` action — and raises `TABLE_HAS_HISTORICAL_ORDERS_ARCHIVE_INSTEAD` if `EXISTS (SELECT 1 FROM public.orders o WHERE o.table_id = OLD.id)`.
   - **`public.orders` must be deleted before `public.shop_tables` (and before cascading deletes from `public.shops` or `public.profiles`).**
3. **Unlinked Tables Without Shop/Profile Foreign Keys:**
   - `public.staff_login_rate_limits` and `public.payment_bank_ref_conflicts` have no foreign keys to `shops` or `profiles` and require explicit cleanup.
4. **Insert-Order Trigger Constraint (`enforce_item_limit` on `public.items`):**
   - `check_item_plan_limit()` (`001_init_qlaok.sql`) joins `public.shops` and `public.profiles` on `BEFORE INSERT ON public.items` to enforce item quotas (`free`: 5, `basic`: 25, `premium`: unlimited).
   - During re-seeding, `public.profiles` (with `plan = 'premium'`) and `public.shops` must be inserted before `public.categories` and `public.items`.

### Required Child-First Deletion Order (Conceptual Sequence)

To avoid all FK and trigger conflicts without disabling triggers or altering constraints, app data tables must be cleared in this leaf-to-root order under a privileged server/admin context (`NOT public.is_client_request_context()`):

1. **Standalone / Webhook / Audit leaves:** `staff_login_rate_limits` → `payment_bank_ref_conflicts` → `sepay_webhook_events` → `order_audit_logs`
2. **Orders & Table Service leaves:** `orders` → `table_service_requests`
3. **Shop-scoped operational & config tables:** `shop_tables` → `mobile_push_tokens` → `shop_sepay_configs` → `shop_staff_credentials` → `shop_memberships` → `shop_slug_aliases`
4. **Storefront & content tables:** `analytics_events` → `posts` → `items` → `categories`
5. **Root tenant & billing tables:** `payment_transactions` → `shops` → `profiles`
6. **Untouched tables:** `provinces` (keep or re-upsert 34 provinces) and `schema_migrations` (keep intact).

---

## 3. Existing Demo Seed Coverage & Gaps

| Target Area | Current Seed Source in Repo | Written to Supabase by `ensureSupabaseReadyAndSeeded`? | Written to Supabase by `POST /api/admin` (`reseed_demo_data`)? | Coverage Gap for Clean Demo Reset |
| --- | --- | --- | --- | --- |
| Demo Owner Profile (`owner-demo-001`, `chuquan@qlaok.vn`) | `SEED_PROFILE` (`src/lib/seed-data.ts`) | Yes (when `shops` is empty & non-prod) | Yes (non-prod only) | Does not create a matching `auth.users` row for Supabase Auth JWT login; relies on legacy/local credential fallback unless provisioned in `auth.users`. |
| Super Admin Profile (`admin-super-001`, `hoangvu96z@gmail.com`) | `ensureSuperAdminSeeded()` (`src/lib/auth-credentials.ts`) | No (runs on `/api/admin` or `/api/auth`) | No (runs on `GET /api/admin` or login) | Must be preserved or re-seeded via `ensureSuperAdminSeeded()` so Super Admin access is not lost. |
| 3 Demo Shops (`shop-fnb-001`, `shop-service-002`, `shop-retail-003`) | `SEED_SHOPS` (`src/lib/seed-data.ts`) | Yes (when `shops` is empty & non-prod) | Yes (non-prod only) | Covered for the 3 base shops (`pho-hoi-an`, `linh-spa-nail`, `dac-san-mien-trung`). |
| Categories (9 rows) & Items (11 rows) | `SEED_CATEGORIES`, `SEED_ITEMS` (`src/lib/seed-data.ts`) | Yes | Yes | `SEED_ITEMS` omits `stock_quantity` and `sold_count` (defaults to `NULL` / `0` in DB; demo stock/sold counts only exist in `buildInitialSeedStore()` in `src/lib/mpos-store.ts`). |
| Posts (5 rows) & SaaS Payment Tx (1 row) | `SEED_POSTS`, `SEED_TRANSACTIONS` (`src/lib/seed-data.ts`) | Yes | Yes | Covered. |
| Analytics Events (15 rows) | `SEED_ANALYTICS` (`src/lib/seed-data.ts`) | Yes (`.insert()` without `id`) | **No** (omitted in `reseed_demo_data`) | Repeated runs without clearing would duplicate rows; `reseed_demo_data` skips it entirely. |
| Managed Shop Tables (`tbl-fnb-01`..`12`, `tbl-service2-01`..`03`, `tbl-retail3-01`..`02`) | `007_shop_tables.sql` (one-time migration `INSERT`) & `SEED_SHOP_TABLES` (`src/lib/shop-tables.ts`) | **No** | **No** | Deleting `public.shops` cascades to `public.shop_tables`. Neither `ensureSupabaseReadyAndSeeded` nor `reseed_demo_data` re-inserts `shop_tables` into Supabase! Note ID naming difference: `007` uses `tbl-service2-01`..`03` and `tbl-retail3-01`..`02` for `shop-service-002`/`shop-retail-003`, whereas `SEED_SHOP_TABLES` uses `tbl-service-01`..`03` and `tbl-retail-01`..`02`. |
| Shop Memberships | `004_memberships_billing_payments_audit.sql` (one-time owner backfill) & `buildInitialSeedMemberships()` (`src/lib/shop-permissions.ts`) | **No** | **No** | Deleting `public.shops` cascades to `public.shop_memberships`. Owner memberships (`mem-owner-<shopId>-<ownerId>`) and any demo cashier/staff memberships are not re-seeded into Supabase by either function. |
| Demo mPOS Orders (12 rows) | `buildInitialSeedStore()` (`src/lib/mpos-store.ts`) | **No** (`.local-db/mpos-store.json` only) | **No** | When Supabase is configured (`isOrderDbConfigured() === true`), orders are read exclusively from `public.orders`. Demo orders in `mpos-store.ts` are never seeded into Supabase. |

### Why `reseed_demo_data` and `ensureSupabaseReadyAndSeeded` Are Insufficient

1. **Blocked in Production:** Both call `shouldAutoSeedDemoData()` (`process.env.NODE_ENV !== 'production'`). In production, `ensureSupabaseReadyAndSeeded()` is a no-op (`{ ready: true, seeded: false }`) and `POST /api/admin` with `action: 'reseed_demo_data'` returns HTTP `403 DEMO_RESEED_FORBIDDEN_IN_PRODUCTION`.
2. **Additive Upsert Only (No Cleanup):** `reseed_demo_data` only runs `.upsert(..., { onConflict: 'id' })` on 6 tables (`profiles`, `shops`, `categories`, `items`, `posts`, `payment_transactions`). It never deletes non-demo shops, test orders, service requests, audit logs, staff accounts, push tokens, slug aliases, or SePay events.
3. **Short-Circuits When Non-Empty:** `ensureSupabaseReadyAndSeeded()` checks `SELECT id FROM public.shops LIMIT 1` and immediately exits if at least one shop exists.
4. **Missing Relational Seed Steps:** Neither function seeds `public.shop_tables` or `public.shop_memberships` in Supabase after `public.shops` is cleared, leaving QR Studio / table selection empty in DB-authoritative mode.

---

## 4. Gap Between Resetting `public` App Tables vs. Entire Supabase Database

Resetting `public` app-owned tables is **not** equivalent to resetting a literal entire Supabase project (`kftmrjmmympztzztunxf`):

| Layer / Schema | Contents & Role in Qlaok | Impact of Resetting Only `public` App Tables | Handling Requirement for Demo Reset |
| --- | --- | --- | --- |
| **`auth.*` (`auth.users`, `auth.identities`, `auth.sessions`, `auth.refresh_tokens`)** | Managed by Supabase Auth (GoTrue). Stores email/password accounts, JWT sessions (used by Web & Mobile owner login), and OTP recovery states. | Deleting `public.profiles` does **not** delete `auth.users` or revoke active Supabase Auth refresh tokens; conversely, existing `auth.users` whose `public.profiles` row was deleted will lack a profile row until re-created or synced. | Inspect `auth.users` before reset. Decide explicitly which `auth.users` accounts (e.g., Super Admin, demo owner, or QA owner `hvtekshop@gmail.com`) are preserved vs. removed via Supabase Auth Admin API (`auth.admin.deleteUser` / `createUser`), and ensure every preserved `auth.users` account has a matching `public.profiles` row. |
| **`storage.*` (`storage.buckets`, `storage.objects`) & Cloudflare R2** | Supabase Storage schema (and external Cloudflare R2 bucket via `src/lib/r2.ts` for uploaded menu/cover images). | Truncating `public` tables leaves orphaned uploaded objects in R2 / `storage.objects` while `SEED_SHOPS`/`SEED_ITEMS` use external Unsplash URLs. | Do not drop `storage.*` system tables. Optionally prune unreferenced test uploads in R2/Storage only after backup verification. |
| **`realtime.*` & `pg_publication` (`supabase_realtime`)** | Supabase Realtime system schema and publication membership for `public.orders` (`006`) and `public.table_service_requests` (`009`). | Dropping/recreating tables would drop publication membership; row-level `DELETE` on `public` tables preserves publication membership and triggers `DELETE` change events to connected subscribers. | Never drop `public` tables during a data reset; use ordered `DELETE` (or controlled reset) so RLS policies, grants, triggers, and `supabase_realtime` publication membership remain intact. |
| **`supabase_migrations.*` / System Schemas (`extensions`, `pgsodium`, `vault`)** | Platform-managed metadata, `uuid-ossp`, and internal Supabase extensions. | Untouched by `public` data deletion. | Must never be modified or truncated by application reset scripts. |
| **Server-Local Filesystem (`.local-db/*.json`)** | Legacy/dev fallback files on VPS/local disk (`credentials.json`, `mpos-store.json`, `shop-tables.json`, `shop-memberships.json`). | Untouched by a Supabase SQL reset. While orders/tables/memberships use Supabase when configured, `src/lib/auth-credentials.ts` still reads `.local-db/credentials.json` for HMAC password login. | Any full environment reset on a target server must also account for `.local-db/credentials.json` (preserving or re-seeding Super Admin/demo credentials) so auth state does not drift from `public.profiles`. |

---

## 5. Safeguards & Sequence for a Future Backup-First Reset

Before any future task executes a demo reset on `kftmrjmmympztzztunxf`, the following sequence and safeguards are required:

1. **Explicit Authorization & Target Verification:**
   - Confirm explicit user authorization to run destructive writes against `kftmrjmmympztzztunxf`.
   - Verify the live schema and row counts via read-only inspection first (confirming all **20 migration files**, including `002z`, in `public.schema_migrations`). The user's authorization covers wiping the QA shop and its order `#ORD-769` as part of the full reset; do not silently preserve them.
   - With `QLAOK_DATABASE_URL` set only in the local process environment, run `npm run db:preflight -- --project-ref kftmrjmmympztzztunxf`. This read-only tool reports aggregate counts for the 21 expected `public` tables and `auth.users`, and rejects a migration list that differs from the repository's SQL files. It does not perform a backup or reset.
2. **Mandatory Pre-Reset Backup (Point-in-Time Snapshot):**
   - Export and verify a complete backup of all 21 `public` tables and `auth.users` metadata (e.g., `pg_dump` data/schema snapshot or verified JSON/SQL export stored in an untracked local backup directory with `chmod 600`) **before** any deletion.
   - **Automated Backup Wrapper (`scripts/backup-qlaok-db.mjs`):**
     ```bash
     # 1. Supply connection URL strictly in environment variable (never CLI arguments, files, or stdout)
     # Direct connection (port 5432):
     export QLAOK_DATABASE_URL="postgresql://postgres:[PASSWORD]@db.kftmrjmmympztzztunxf.supabase.co:5432/postgres"
     # Or shared session pooler (port 5432; reject transaction pooler 6543):
     # export QLAOK_DATABASE_URL="postgresql://postgres.kftmrjmmympztzztunxf:[PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"

     # 2. Run backup CLI (requires exact project ref; creates private dump atomically with mode 0600)
     node scripts/backup-qlaok-db.mjs --project-ref kftmrjmmympztzztunxf

     # Optional: specify custom private output directory outside tracked repo content
     node scripts/backup-qlaok-db.mjs --project-ref kftmrjmmympztzztunxf --output-dir /path/to/private-backups
     ```
     - Validates hostname and userinfo match official Supabase direct (`db.kftmrjmmympztzztunxf.supabase.co:5432`) or shared session pooler (`aws-<index>-<region>.pooler.supabase.com:5432` with username `postgres.kftmrjmmympztzztunxf` or `<role>.kftmrjmmympztzztunxf`), rejecting transaction pooler port 6543, fake ref hosts, unexpected query parameters, and URL fragments. Requires path `/postgres`.
     - Passes connection parameters strictly via individual child environment variables (`PGDATABASE=postgres`, `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGSSLMODE=require`), never setting `PGDATABASE` to a full URI and never passing credentials in CLI arguments (`argv`) or echoing subprocess stderr.
     - Creates destination dump file atomically with exclusive `wx` and mode `0600` before running `pg_dump` so the file is private throughout the write, refusing overwrite and preventing races.
     - Dumps `public` and `auth` data and schema; excludes system schemas.
     - *Scope notice:* External Cloudflare R2 images, Supabase Storage objects, and server-local `.local-db/*.json` fallback files are NOT backed up by pg_dump.
     - Fails closed and unlinks partial files on any failure; verifies archive with `pg_restore --list`, non-zero size, and both expected table entries (`public.shops` and `auth.users`). Never prints credentials or dump payloads.
   - Verify backup file integrity and non-zero row counts for existing shops, orders, profiles, and transactions.
3. **Maintenance Window / Quiet Upstream State:**
   - Pause or avoid concurrent webhook/order traffic during the reset transaction so SSE/Realtime subscribers and SePay/billing webhooks do not interleave with deletion.
4. **Single-Transaction Child-First Purge & Canonical Re-Seed:**
   - Execute the reset inside an explicit transaction (`BEGIN ... COMMIT`) under `service_role` / admin privileges (`is_client_request_context() = FALSE`).
   - `scripts/demo-reset-purge.mjs` contains the fixed 19-table deletion sequence. Its PGlite test exercises the webhook and table triggers. This module only builds SQL; it does not connect to a database or perform the reset.
   - `scripts/demo-reset-owner-seed.mjs` assembles the canonical demo owner, three shops, their owner memberships, and 17 tables from existing seed constants. It returns rows only; no database write is performed.
   - Keep `public.schema_migrations` and `public.provinces` intact (or idempotently upsert the 34 provinces).
   - Delete rows in the strict child-first order from Section 2 (`sepay_webhook_events` before `orders`; `orders` before `shop_tables`; leaf tables before `shops` and `profiles`).
   - Re-seed canonical demo state in parent-first order:
     1. `public.profiles` (`SEED_PROFILE` + Super Admin profile via `ensureSuperAdminSeeded` contract + any explicitly retained `auth.users` profiles)
     2. `public.shops` (`SEED_SHOPS`)
     3. `public.shop_memberships` (owner memberships for `SEED_SHOPS`)
     4. `public.shop_tables` (`SEED_SHOP_TABLES` aligned with `shop-fnb-001`, `shop-service-002`, `shop-retail-003`)
     5. `public.categories` (`SEED_CATEGORIES`)
     6. `public.items` (`SEED_ITEMS` with demo `stock_quantity` and `sold_count` values)
     7. `public.posts` (`SEED_POSTS`)
     8. `public.payment_transactions` (`SEED_TRANSACTIONS`)
     9. `public.analytics_events` (`SEED_ANALYTICS`)
     10. Optional demo `public.orders` (if non-empty initial mPOS order history is desired in Supabase mode)
5. **Post-Reset Verification:**
   - Verify exact row counts across all 21 `public` tables, confirm `public.schema_migrations` still lists all **20 migration files** (`001`–`019`, including `002z`), verify `auth.users` ↔ `public.profiles` alignment, and smoke-test `/api/health`, `/s/pho-hoi-an/menu`, and `/dashboard/orders`.
