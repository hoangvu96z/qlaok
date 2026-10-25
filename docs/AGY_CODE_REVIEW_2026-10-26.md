# Qlaok Code Review — 2026-10-26

**Status:** Broad static review completed. This is a multi-area review, not a line-by-line audit of every file in the repository.

**Review method:** Four read-only AGY passes plus independent Codex verification. The 2026-10-26 deep follow-up used AGY Gemini 4 Argon High through the repository runner and CodeGraph; the index reported 256 files, 4,012 symbols, and 14,180 edges. Codex independently checked the added findings and rejected candidates that were already fixed, duplicated, or had no current first-party reproducer. This remained a static review: no application code was changed, no live database/provider/API call was made, and no test suite or build was run. Earlier targeted feature QA is listed separately below.

**Review coverage:** The indexed pass traced authentication/session validation, shop membership and permission checks, API handlers, shared database helpers, and their callers. It reviewed catalog, posts/promotions, shops/settings, orders/POS, payments and SePay, tables/QR/service requests, analytics, AI OCR/translation, health/upload, mobile owner/staff flows, migration scripts, SQL policy/trigger definitions, and deploy workflows. This is broad risk-based coverage; it does not claim a line-by-line audit of every file.

**Privacy:** This report contains no credential values, customer/shop/item names, business IDs, payment values, QR payloads, response bodies, or raw query values. A credential-like value found in source is deliberately not reproduced.

## Findings

### 1. [P1] Hard-coded AI credential is used as a fallback

**Location:** [`src/lib/gemini.ts`](../src/lib/gemini.ts:10)

`getAiConfig()` falls back to a credential literal when `AI_API_KEY` is unset. `call9RouterJson()` uses the resulting value in an Authorization Bearer header. Because the fallback is non-empty, an unset deployment secret does not fail closed; OCR and translation API requests can continue using the repository-embedded credential.

**Impact:** If the value is real or was ever valid, anyone with repository/history access can use it. An environment misconfiguration can also send merchant-provided text or images through that credential and incur unauthorized usage.

**Recommended action:** Remove the source fallback, require an explicitly configured runtime secret, rotate the credential if it is valid or has been deployed, and review repository history for prior exposure. The credential value is intentionally omitted here.

**Evidence:** CodeGraph source for `getAiConfig` and `call9RouterJson`; callers include the OCR and translation API routes. No external AI request was made during this review.

### 2. [P1] Unauthenticated catalog GET returns unrestricted shop and inventory records

**Location:** [`src/app/api/catalog/route.ts`](../src/app/api/catalog/route.ts:151), [`src/lib/db.ts`](../src/lib/db.ts:1308)

The catalog `GET` accepts an optional caller-supplied shop identifier and calls `dbGetShopCatalog()` without an authentication or shop-permission check. With no identifier, the helper selects the first shop row. In either path it selects the shop, categories, and items with `select('*')`, does not check whether the shop is published, and does not restrict items to those available for public display. The returned item shape includes inventory and sales fields.

The shared database client prefers `SUPABASE_SERVICE_ROLE_KEY` when configured, so database RLS does not protect this route under the normal server-role configuration.

**Impact:** An unauthenticated caller who can obtain a shop identifier can request unpublished shop data, inactive catalog entries, and per-item inventory/sales metadata. The response also includes the raw shop object.

**Recommended action:** Separate the owner management API from the public-menu API. Require shop authorization for management reads. For public menus, verify publication and project an allowlisted DTO containing only customer-facing fields; omit inventory, sales, and internal shop metadata.

**Verification limit:** Static CodeGraph review only. No production catalog response or identifier was requested.

### 3. [P2] Public shop and storefront responses include internal metadata and inventory fields

**Location:** [`src/app/api/shops/route.ts`](../src/app/api/shops/route.ts:117), [`src/app/api/shops/route.ts`](../src/app/api/shops/route.ts:150), [`src/lib/db.ts`](../src/lib/db.ts:886)

Unauthenticated public branches return complete shop rows for published shops. The directory and `shopId` branches load rows with `select('*')`; the `slug` storefront branch also loads item rows with `select('*')` and returns enriched inventory records. The shop type includes internal owner and notification metadata, while item records include stock and sales fields.

**Impact:** Public callers can enumerate published shops and receive fields that are not needed to render a storefront, including internal identifiers, notification configuration, and per-item inventory/sales metadata.

**Recommended action:** Return explicit public shop and item DTOs. Keep owner/admin reads separate and decide explicitly which customer-facing settings, such as payment or Wi-Fi details, should be public.

**Verification limit:** Static review only; no shop records were fetched for this finding.

### 4. [P2] Public posts reads expose inactive posts and draft content

**Location:** [`src/app/api/posts/route.ts`](../src/app/api/posts/route.ts:10), [`src/lib/db.ts`](../src/lib/db.ts:1659)

The posts `GET` accepts a caller-supplied shop identifier and returns `dbGetShopPosts()` without authentication. The helper selects every post for that shop and sorts the results, but does not filter by `is_active`. The returned records include localized titles and content. There is a second exposure path: the public PostgREST policy in `003_security_rls_and_atomic_mpos.sql` permits reads for every post whose shop is published, with no `posts.is_active` condition. This remains true even if the API route is later filtered.

**Impact:** A public caller can read inactive or unpublished promotion content for a shop.

**Recommended action:** Require owner/member permission for the management endpoint. If public promotion reads are needed, expose a separate endpoint that checks shop publication and returns active posts only.

**Evidence:** CodeGraph source for the posts route and `dbGetShopPosts`; migration `003_security_rls_and_atomic_mpos.sql:164-174`. No production post data was fetched.

### 5. [P2] Anyone can upload public images through `/api/upload`

**Location:** [`src/app/api/upload/route.ts`](../src/app/api/upload/route.ts:28), [`tests/upload-route-review.test.ts`](../tests/upload-route-review.test.ts:16)

The upload route accepts POSTs without checking an authenticated user or shop permission. When storage is configured, it writes image data to public R2 or Supabase Storage, or returns a presigned upload. MIME type and payload size are validated, but caller identity and per-user quotas are not. The existing route tests construct requests without authorization and assert successful storage behavior.

**Impact:** Anonymous callers can consume storage/egress and publish arbitrary allowed image files, potentially causing cost or content-abuse problems.

**Recommended action:** Require an authenticated owner/member with the appropriate shop permission, scope the storage key to that shop, and add rate/volume limits. Keep the existing MIME and size checks.

**Verification:** `tests/upload-route-review.test.ts` passed **8/8**. Those tests cover storage fallback, MIME, and size behavior; they do not verify authorization.

### 6. [P2] Public analytics ingestion can alter any item's view counter

**Location:** [`src/app/api/analytics/track/route.ts`](../src/app/api/analytics/track/route.ts:18), [`src/lib/db.ts`](../src/lib/db.ts:1724)

The analytics `POST` is intentionally public for storefront events, but it accepts caller-supplied `shop_id`, `event_type`, and `item_id` without checking that the item belongs to that shop, validating the event against the supported enum, or applying a request limit. For `item_view`, `dbRecordAnalyticsEvent()` updates `items.view_count` using only `item_id`; it does not include `shop_id` in the update predicate. It also performs this update before checking whether the analytics insert failed. The normal server database client uses the service-role key when configured, so database RLS does not constrain these helper writes.

**Impact:** A caller who can identify an item can forge its view count, including an item from another shop. A request with an invalid shop/event insert can still increment the item counter before the endpoint returns an error. This corrupts merchant analytics and creates cross-shop integrity violations.

**Recommended action:** Validate event type and locale at the route boundary, verify item/shop ownership for `item_view`, perform the counter update atomically with the event insert (or derive counts from events), and rate-limit public ingestion.

**Evidence:** CodeGraph nodes `POST` (`src/app/api/analytics/track/route.ts:18`) and `dbRecordAnalyticsEvent` (`src/lib/db.ts:1724`); migration `003_security_rls_and_atomic_mpos.sql:242-251` separately permits direct public inserts for published shops without verifying that `item_id` belongs to `shop_id`. No analytics requests were sent during review.

### 7. [P2] AI throttling is process-local and can be bypassed across instances

**Location:** [`src/app/api/ai/_lib/guard.ts`](../src/app/api/ai/_lib/guard.ts:40)

The shared AI guard stores recent requests in a module-level `Map`. The translation and OCR routes call this guard, but each server process or serverless instance has its own map, and a restart clears it. A user can therefore distribute requests across instances or cold starts to exceed the configured per-process window. OCR has an additional plan check; the in-memory throttle is the only shared guard visible here for translation.

**Impact:** The configured per-process limit does not bound cross-instance use, so authenticated callers can increase upstream AI usage and cost beyond that limit in a multi-instance deployment.

**Recommended action:** Move request accounting to a shared atomic store or provider-side quota and keep the local map only as an optional burst guard. Verify both endpoints use the same durable policy.

**Evidence:** CodeGraph nodes `consumeAiRateLimit` (`src/app/api/ai/_lib/guard.ts:47`) and `requireAiCaller` (`:74`); both AI routes call `requireAiCaller`. This is deployment-dependent; the review did not inspect live hosting topology or invoke an AI provider.

### 8. [P2] Translation endpoint skips the shop plan and returns all eight locales

**Location:** [`src/app/api/ai/translate/route.ts`](../src/app/api/ai/translate/route.ts:16), [`src/lib/plan-limits.ts`](../src/lib/plan-limits.ts:15)

`POST /api/ai/translate` checks only for a verified session and the process-local request throttle. It accepts no shop identifier, does not check the caller's shop membership or plan, and prompts the provider to return all eight locales. The plan configuration limits supported languages to one for Free, three for Basic, and eight for Premium; server-side translation does not apply those limits or filter its response.

**Impact:** Any authenticated account, including a lower-tier shop or a staff session, can call the paid translation provider directly and receive translations beyond that shop's configured plan. This bypasses the feature entitlement and can consume shared provider spend.

**Recommended action:** Require a verified shop membership and resolve the owner's plan server-side. Pass the allowed locale set into the translation request and reject or remove fields outside that plan before returning the response.

**Evidence:** CodeGraph node `src/app/api/ai/translate/route.ts` (guard and 8-language prompt); `src/lib/plan-limits.ts:15-63` (plan language limits). No AI provider request was made.

### 9. [P3] Public health endpoint exposes internal configuration and aggregate database counts

**Location:** [`src/app/api/health/route.ts`](../src/app/api/health/route.ts:7)

The unauthenticated `GET` returns configuration flags for Supabase, storage, and AI, upstream/model identifiers, aggregate counts for business tables, and raw Supabase error text when the backend is degraded. These details are not needed by a public liveness probe.

**Impact:** The response gives unauthenticated callers a deployment fingerprint and approximate business-data volume, and may expose database/schema error details during an outage.

**Recommended action:** Keep the public response to a minimal status and timestamp. Put dependency diagnostics, counts, provider identifiers, and raw errors behind an internal or authenticated health endpoint.

**Evidence:** CodeGraph node `src/app/api/health/route.ts`; no health endpoint was called during this review.

### 10. [P2] OCR endpoint has no server-side image or text size limit

**Location:** [`src/app/api/ai/ocr-menu/route.ts`](../src/app/api/ai/ocr-menu/route.ts:25)

After authentication, the endpoint parses the complete JSON body before its plan check. It accepts unbounded `imageBase64` and `rawOcrText`, decodes the image into a `Buffer`, runs Tesseract, and may forward the image or text to the AI provider. No route-level request-byte, decoded-image, dimension, or text-length limit is enforced in this handler. Client-side compression and the separate upload route's limit do not constrain direct calls to this endpoint.

**Impact:** An authenticated caller can send oversized inputs that consume memory/CPU during JSON parsing and OCR, and may cause large provider requests and costs. Actual exposure depends on hosting request limits, which were not inspected.

**Recommended action:** Enforce a request byte limit before JSON parsing, then validate decoded image size/dimensions, MIME type, and OCR text length before Tesseract or any provider call. Keep the plan gate and rate limit.

**Evidence:** CodeGraph node `src/app/api/ai/ocr-menu/route.ts:25-79`; no OCR request or provider call was made.

### 11. [P1] Public demo login issues an owner session without a production guard

**Location:** [`src/app/api/auth/route.ts`](../src/app/api/auth/route.ts:439), [`src/app/api/shops/route.ts`](../src/app/api/shops/route.ts:680), [`src/lib/db.ts`](../src/lib/db.ts:1101)

`POST /api/auth` accepts `action: "demo_login"` without first requiring an existing session or checking `NODE_ENV`. It signs a Qlaok session for the fixed demo profile with the `owner` role and sets the session cookie. The shop creation route accepts that signed session and assigns new shops to its subject; `dbCreateShop()` creates the missing profile row when needed. A caller can therefore use the public demo branch to create and control shops under that shared account. If demo-owned shops already exist in production, the same session also impersonates their owner.

**Impact:** Unauthenticated account takeover of the shared demo identity, including control of any shop data owned by that identity and the ability to create new shops under it.

**Recommended action:** Disable demo login in production at the server boundary. Remove the alternate hard-coded demo-credential login path from production builds, and keep demo data in an isolated environment and identity that cannot own real merchant records.

**Evidence:** CodeGraph nodes for the `POST` handler, `issueSessionToken`, `requireAuthenticatedUser`, `dbCreateShop`, and `resolveUserShopMembership`; the auth route has no production guard in the demo branch. This was verified statically; no login request was made.

### 12. [P2] `inventory.adjust` RLS permission grants all item mutations

**Location:** [`004_memberships_billing_payments_audit.sql`](../supabase/migrations/004_memberships_billing_payments_audit.sql:447), [`src/app/api/catalog/route.ts`](../src/app/api/catalog/route.ts:205)

The active `items_owner_write` policy is `FOR ALL` and permits either `catalog.manage` or `inventory.adjust` in both `USING` and `WITH CHECK`. A signed-in shop member with only `inventory.adjust` can therefore use authenticated Supabase REST directly to insert, update, or delete item rows and alter non-inventory columns such as name, price, category, or availability. The API route deliberately narrows such a member's update payload with `buildInventoryOnlyItemPatch()`, but the table policy does not preserve that restriction for direct client writes.

**Impact:** A limited inventory role can make catalog or destructive changes outside the server API's field-level permission checks.

**Recommended action:** Restrict direct table policies by operation and permission, or revoke direct item mutation from client roles and route writes through an authorization boundary that validates allowed columns. Add database-level tests for a member with `inventory.adjust` but without `catalog.manage`.

**Evidence:** Migration `004_memberships_billing_payments_audit.sql:447-456`; CodeGraph source for `getCatalogItemUpdatePermissionOptions`, `buildInventoryOnlyItemPatch`, and the `upsert_item` route. No database mutation was performed.

### 13. [P2] Item plan-limit trigger cannot read the shop owner's plan for delegated members

**Location:** [`001_init_qlaok.sql`](../supabase/migrations/001_init_qlaok.sql:201), [`003_security_rls_and_atomic_mpos.sql`](../supabase/migrations/003_security_rls_and_atomic_mpos.sql:71), [`004_memberships_billing_payments_audit.sql`](../supabase/migrations/004_memberships_billing_payments_audit.sql:448)

`check_item_plan_limit()` queries the shop owner's `profiles.plan`, but it is a default invoker-rights trigger function and contains no `SECURITY DEFINER` clause. The profile SELECT policy only exposes the caller's own profile. When a non-owner member with `catalog.manage` inserts an item directly through authenticated Supabase REST, the trigger's owner-profile lookup can return no row, leaving `user_plan` NULL; neither the Free nor Basic limit branch then runs. The `items_owner_write` policy permits that member's insert.

**Impact:** A delegated catalog member can exceed the shop's server-enforced item quota through direct table writes, bypassing the per-plan limit.

**Recommended action:** Perform the owner-plan lookup in a narrowly scoped, safe `SECURITY DEFINER` function or block direct client inserts and enforce the limit in the server transaction. Exercise the trigger with a non-owner member JWT in a database test.

**Evidence:** SQL source in migrations `001`, `003`, and `004` cited above. This conclusion follows from the function's invoker rights and the active profile/item RLS policies; no live database test was run.

### 14. [P2] Shop creation bypasses plan checks for initial languages and theme

**Location:** [`src/app/api/shops/route.ts`](../src/app/api/shops/route.ts:698), [`src/lib/db.ts`](../src/lib/db.ts:1159), [`src/lib/plan-limits.ts`](../src/lib/plan-limits.ts:15)

`POST /api/shops` checks for a SePay secret in the submitted theme, then passes the full request body to `dbCreateShop()`. The database helper spreads those fields into the inserted shop, including `supported_langs` and `theme_config`, without resolving the owner's plan. The same repository defines tier caps of one, three, and eight languages and disallows custom themes on Free, and the shop PATCH handler applies those checks only when settings are changed after creation.

**Impact:** An authenticated Free account can create a shop with tier-restricted initial settings, bypassing the server-side entitlement check enforced by the later Settings path.

**Recommended action:** Validate and allowlist the create payload, resolve the owner's plan on the server, and apply the same settings entitlement validator before inserting the initial shop.

**Evidence:** CodeGraph nodes for the shop `POST` handler and `dbCreateShop`; `getShopSettingsPlanRestriction()` in `src/lib/plan-limits.ts` is used by the PATCH flow, not the create flow. No shop was created during review.

### 15. [P2] Migration tracking skips checksum mismatches and replays migrations in the fallback path

**Location:** [`scripts/migrate-supabase.mjs`](../scripts/migrate-supabase.mjs:135), [`007_shop_tables.sql`](../supabase/migrations/007_shop_tables.sql:37)

The Management API branch reads stored `(filename, checksum)` rows and calculates the current file checksum, but skips any filename already present without comparing the stored checksum to the current one. Editing an already-applied migration therefore prints “already applied” and silently leaves the database on the old definition. The service-role RPC fallback behaves differently: it loops over every SQL file on every run without reading `schema_migrations`. Replaying migration 007 can reinsert deleted seeded table rows for the matching seeded shops.

**Impact:** The same migration command can leave schema changes unapplied in one credential configuration and replay data backfills/seeds in another, causing schema drift or surprising restoration of deleted seed data.

**Recommended action:** Treat applied migration files as immutable; compare stored and current checksums and fail with an actionable error on mismatch. Make both execution branches consult the same migration ledger and apply only unapplied files.

**Evidence:** CodeGraph source for `scripts/migrate-supabase.mjs:135-204`; migration `007_shop_tables.sql:37-86` seeds default tables with `ON CONFLICT DO NOTHING`. Static review only; no migration was run and no database was queried.

### 16. [P2] Promotion saves can overwrite newer settings or return a false 403 to authorized staff

**Location:** [`dashboard/posts/page.tsx`](../src/app/(dashboard)/dashboard/posts/page.tsx:323), [`mobile/App.tsx`](../mobile/App.tsx:921), [`src/app/api/shops/route.ts`](../src/app/api/shops/route.ts:741)

The web and mobile promotion save handlers spread the full `activeShop.theme_config` snapshot they currently have, then send the whole object with the promotion changes. The PATCH handler compares every incoming key against the latest `prevTheme`. A staff member with only `promotions.manage` is rejected as owner-only when their snapshot contains an owner-only key such as `orderWorkflow` whose value has since changed on the server, even if the staff member only changed a promotion field. When an owner saves that stale snapshot, its stale unrelated values can overwrite the newer database values.

**Impact:** Staff with the documented promotion permission can be blocked from saving promotions on shops with owner-only theme settings, and an owner promotion save can silently revert unrelated settings changed by another client.

**Recommended action:** Send only `promoBanner`, `welcomePopup`, and `flashSale` from both clients and merge those fields into the latest server-side theme. If multiple clients can edit overlapping fields, add version checks or conflict feedback.

**Evidence:** CodeGraph source for the web and mobile payloads (`dashboard/posts/page.tsx:319-340`, `mobile/App.tsx:931-950`) and the permission diff / merge in `src/app/api/shops/route.ts:741-798,991-1030`. Static analysis only; no concurrent sessions were exercised.

### 17. [P3] Clearing the cover photo field does not remove the saved cover

**Location:** [`dashboard/settings/page.tsx`](../src/app/(dashboard)/dashboard/settings/page.tsx:1077), [`dashboard/settings/page.tsx`](../src/app/(dashboard)/dashboard/settings/page.tsx:612)

The cover URL input accepts an empty value, but saving converts an empty `coverUrl` back to `activeShop.cover_urls || []`. The form therefore resubmits the existing cover list instead of clearing it. The preview also falls back to `activeShop.cover_urls` when the field is empty, and there is no separate clear control next to the input.

**Impact:** An owner cannot remove the current cover photo through this settings form; clearing the text and saving appears successful while the old image remains.

**Recommended action:** Track an explicit “clear cover” action or represent the edited cover list separately from the empty input, then submit an empty `cover_urls` array when the user clears it.

**Evidence:** CodeGraph source for the cover URL input (`dashboard/settings/page.tsx:1077-1124`), save payload (`:612-625`), and preview (`:751`). Static UI/data-flow review only; no browser session was run.

### 18. [P1] A shop owner can hijack another shop's post through the primary-key upsert

**Location:** [`src/app/api/posts/route.ts`](../src/app/api/posts/route.ts:17), [`src/lib/db.ts`](../src/lib/db.ts:1685)

`POST /api/posts` authorizes against the caller-supplied `body.shop_id`, then passes the entire body to `dbUpsertPost()`. The helper accepts a caller-supplied post `id` and upserts on `posts.id`, while also setting `shop_id` from the request. It never loads an existing post or verifies that its current `shop_id` matches the authorized shop. The server database client uses the service role, so the public `posts_owner_write` RLS policy does not stop this API mutation. Public posts reads expose post IDs, so the target ID is discoverable.

**Impact:** An owner of Shop A can submit the ID of a post from Shop B together with Shop A's own `shop_id`; the upsert overwrites the title/content and moves the post to Shop A, removing it from Shop B.

**Recommended action:** Before upserting, load an existing post by ID and reject any cross-shop match. Add a database trigger that prevents changing `posts.shop_id` on update, so direct service paths also preserve ownership.

**Evidence:** CodeGraph source for `POST /api/posts` (`src/app/api/posts/route.ts:17-25`) and `dbUpsertPost` (`src/lib/db.ts:1685-1711`); public read exposure is described in finding 4. Static analysis only; no post was changed.

### 19. [P1] Admin shop deletion erases catalog data before historical table orders make the delete fail

**Location:** [`src/app/api/admin/route.ts`](../src/app/api/admin/route.ts:599), [`src/app/api/admin/route.ts`](../src/app/api/admin/route.ts:655), [`007_shop_tables.sql`](../supabase/migrations/007_shop_tables.sql:13)

Both `delete_shop` and `delete_owner` issue separate PostgREST deletes for analytics, posts, items, and categories before attempting to delete the shop. The earlier calls are committed independently, and their returned errors are not checked. A shop deletion cascades to `shop_tables`; however, the `BEFORE DELETE` trigger `trg_enforce_shop_table_boundaries` raises `TABLE_HAS_HISTORICAL_ORDERS_ARCHIVE_INSTEAD` whenever a table still has an order referencing it. The shop delete then fails after the earlier catalog and post deletions have already succeeded. In `delete_owner`, the failed shop delete is also ignored before the handler attempts to delete the owner profile.

**Impact:** If a shop has an order linked to a managed table, a platform-admin delete can leave the shop and orders in place while permanently removing its menu, categories, posts, and analytics. The endpoint returns an error only after the partial loss.

**Recommended action:** Move the complete delete into a single transactional database operation, define how historical orders and managed tables should be retained or detached, and check every returned database error before continuing.

**Evidence:** CodeGraph source for admin deletion (`src/app/api/admin/route.ts:599-617,655-674`); unindexed SQL in `007_shop_tables.sql:13,89-94,145-201` defines the shop cascade, order reference, and blocking trigger. Static schema/control-flow analysis only; no deletion was attempted.

### 20. [P2] Shop hydration replaces configured locales with all eight languages

**Location:** [`src/lib/db.ts`](../src/lib/db.ts:355), [`src/lib/plan-limits.ts`](../src/lib/plan-limits.ts:96)

`hydrateShopWithSeedDefaults()` replaces every `supported_langs` array with `ALL_LOCALES` when it contains five or fewer entries, and appends all missing locales when it contains more. Every relevant database read uses this helper. The storefront then calls `getAllowedLocalesForPlan()`, which slices the hydrated array to the plan limit; the settings form also initializes its selection from the hydrated array. As a result, the storefront ignores a merchant's chosen locale order/subset, and settings presents all eight as selected. The PATCH handler also loads its comparison value through `dbGetShopById()`, which applies the same hydration, so a settings save that sends those eight locales can compare equal to the inflated value and skip its plan-limit check.

**Impact:** Basic shops can show a different three-language set than the merchant selected; Premium shops cannot restrict the storefront to a smaller selected set; and a save can persist eight locales for a lower plan without triggering the intended change check.

**Recommended action:** Preserve the non-empty array stored in `shops.supported_langs` during hydration. Apply plan limits to the raw persisted selection in the server write path, not to a synthesized read value.

**Evidence:** CodeGraph source for `hydrateShopWithSeedDefaults` (`src/lib/db.ts:355-420`), its database read callers, `getAllowedLocalesForPlan` (`src/lib/plan-limits.ts:96-104`), and the settings initialization/save and PATCH comparison (`dashboard/settings/page.tsx:421-425,645`; `src/app/api/shops/route.ts:722-724,816-850`). Static analysis only; no plan or storefront behavior was exercised.

### 21. [P2] Admin password reset changes the web credential but not Supabase Auth

**Location:** [`src/app/api/admin/route.ts`](../src/app/api/admin/route.ts:563), [`src/app/api/auth/route.ts`](../src/app/api/auth/route.ts:560), [`AuthScreen.tsx`](../mobile/src/components/AuthScreen.tsx:179)

The admin action writes a new password hash to the local `.local-db/auth-credentials.json` file and returns `{ ok: true }`; it does not update the user's Supabase Auth password. Web login prefers that local credential when present, while the mobile owner login calls `supabase.auth.signInWithPassword()` directly. Owner registration can create a Supabase Auth user and also store a local credential, so the two password records can diverge after an admin reset. The Super Admin create-owner path also creates a profile and file-based credential without provisioning a Supabase Auth user; those accounts cannot use mobile owner sign-in unless a separate Auth account is provisioned. This is additional evidence for the same cross-device credential mismatch, not a separate finding.

**Impact:** For an owner with a Supabase Auth account, the new password works through the web's local credential path but fails in the mobile app; the old password remains valid with Supabase Auth. The admin UI reports the reset as successful despite the split state.

**Recommended action:** Identify the account's authentication provider and update the Supabase Auth password for Supabase-backed owners. Update the local credential only for local-auth accounts, verify the owner ID/email pair, and surface local credential write failures instead of returning success.

**Evidence:** CodeGraph source for the admin reset (`src/app/api/admin/route.ts:563-583`), web login (`src/app/api/auth/route.ts:560-623`), credential-file writes (`src/lib/auth-credentials.ts:11-12,77-85`), and mobile owner sign-in (`mobile/src/components/AuthScreen.tsx:179-199`). Static review only; no password was changed.

### 22. [P1] Deployment can skip a migration that was never applied

**Location:** [`supabase-migrate.yml`](../.github/workflows/supabase-migrate.yml:25), [`deploy.yml`](../.github/workflows/deploy.yml:40), [`scripts/migrate-supabase.mjs`](../scripts/migrate-supabase.mjs:208)

The deploy workflow decides whether to call the migration workflow by diffing only the current push range for changed SQL files. If a push containing a migration fails in `verify` before migration runs, a follow-up push that fixes only application code has no migration diff, so the `migrate` job is skipped; the `deploy` condition explicitly permits a skipped migration job. Separately, the reusable migration workflow passes only the Supabase URL and access token; if these are absent or invalid and no service-role credentials are supplied, `migrate-supabase.mjs` logs a warning and returns normally, so CI reports a successful migration job without applying SQL.

**Impact:** The deployment can ship application code that expects a schema migration that is still pending, causing runtime failures or data-path inconsistencies.

**Recommended action:** Make the deploy gate check the database migration ledger for pending files on every deployment, and make the migration runner exit non-zero when it cannot authenticate or resolve the project. Do not treat a skipped migration job as safe when the database may still be behind.

**Evidence:** Workflow logic at `.github/workflows/deploy.yml:40-67`, credentials at `.github/workflows/supabase-migrate.yml:25-29`, and the normal-return path at `scripts/migrate-supabase.mjs:208-223`. Static workflow/script analysis only; no workflow was triggered.

### 23. [P2] Staff granted `promotions.manage` can open the Posts page but cannot manage posts

**Location:** [`dashboard-nav.ts`](../src/lib/dashboard-nav.ts:48), [`src/app/api/posts/route.ts`](../src/app/api/posts/route.ts:17)

Dashboard navigation grants `/dashboard/posts` to a member with `promotions.manage`. The Posts page uses that permission-gated route to create and update posts through `POST /api/posts` and delete them through `DELETE /api/posts`. Both API methods instead call `requireShopOwnerOrAdmin`, so a non-owner staff member who has the advertised permission gets HTTP 403 for those actions. This is a route/API authorization mismatch; it is separate from the cross-shop post ID issue in finding 18.

**Impact:** The shop can assign staff permission to manage promotions, but those staff cannot complete the advertised post actions. The page remains accessible, making the failure occur only when they try to save or delete.

**Recommended action:** Enforce `promotions.manage` on the server routes, resolving the target post's `shop_id` from the database for updates/deletes and preserving the cross-shop ID check from finding 18.

**Evidence:** `DASHBOARD_NAV_REQUIREMENTS['/dashboard/posts']` in `src/lib/dashboard-nav.ts:48`; `POST /api/posts` and `DELETE /api/posts` guard calls in `src/app/api/posts/route.ts:17-25,33-55`; page create, pin/update, and delete calls in `dashboard/posts/page.tsx:413-505`. Static analysis only; no staff session was used.

### 24. [P3] Welcome Popup preview is a silent no-op when unconfigured, then spontaneously appears upon subsequent discount edits

**Location:** [`src/app/(dashboard)/dashboard/posts/page.tsx`](../src/app/(dashboard)/dashboard/posts/page.tsx:81), [`src/app/(dashboard)/dashboard/posts/page.tsx`](../src/app/(dashboard)/dashboard/posts/page.tsx:264), [`src/app/(dashboard)/dashboard/posts/page.tsx`](../src/app/(dashboard)/dashboard/posts/page.tsx:525), [`src/components/storefront/StorefrontCustomDecor.tsx`](../src/components/storefront/StorefrontCustomDecor.tsx:941)

When an owner opens `/dashboard/posts`, `welcomePopup` defaults to `normalizeShopWelcomePopupConfig()` with `title: ''` if the shop has not yet configured a promotional popup. The page creates `previewShop` with `welcomePopup: { ...welcomePopup, enabled: true }` to enable live preview. When the owner clicks "Xem thử Popup" (Header) or "Mở thử Popup chào mừng toàn màn hình" (Sidebar), `previewPopupOpen` is set to `true`. However, `StorefrontWelcomePopup` enforces `if (!popup || !popup.enabled || !popup.title?.trim()) return null;`. Because the title is empty, the modal does not render, yielding a silent no-op without user feedback while leaving `previewPopupOpen: true` in component state. When the owner subsequently interacts with discount controls (e.g. clicking a preset discount percentage or typing an amount), `syncBannerCopyFromRule()` automatically derives and populates `welcomePopup.title`. Because `previewPopupOpen` was left `true`, the full-screen modal unexpectedly surfaces and intercepts pointer events across the dashboard while the owner is editing.

**Impact:** Degraded owner UX and confusion. The preview action appears broken initially, and later unprompted modal appearance obstructs the editing flow and blocks user input until dismissed.

**Recommended action:** Provide a fallback preview title (e.g. `welcomePopup.title || promoBanner.title || 'Ưu đãi chào mừng'`) in `previewShop.theme_config.welcomePopup`, or show an informative feedback toast when previewing an empty popup and reset `previewPopupOpen` to `false` when the modal cannot render.

**Evidence:** CodeGraph confirms the path: `normalizeShopWelcomePopupConfig()` defaults the title to an empty string; the preview button sets `previewPopupOpen` true; `StorefrontWelcomePopup` returns null while the title is empty; and `syncBannerCopyFromRule()` later derives a title from a discount change while `previewPopupOpen` remains true. Codex independently reproduced that exact order in a read-only browser pass against the configured QA host: initial-title-present `false`, modal after preview click `false`, modal after local percentage preset `true`, then closed `true`. The route guard allowed one auth POST and observed zero other writes; the focused run had zero console/page errors. The initial AGY Posts runner opened the preview after changing the discount preset and did not test this exact order; the exact-order reproduction is the Codex follow-up at `.gemini/antigravity-cli/brain/dac3fe7b-5fc2-4fcc-be35-8bd228199070/scratch/repro-popup-order-verified.mjs`. No promotion settings were saved.

## Confirmed safeguards

- `GET /api/orders` checks order-view permission for shop queues; customer tracking uses a tracking token and omits internal tokens from the returned order view.
- `GET /api/tables` requires authorization when inactive or archived tables are requested, and limits the public branch to public tables.
- Billing reads require an authenticated user. Payment-order creation checks owner/admin authority and takes the amount from server-side plan pricing. Webhook handling rejects requests when the configured secret is absent.
- The AI OCR route requires an authenticated caller, applies a per-user rate limit, and checks the owner's plan before invoking paid OCR.

These were static source checks; no payment or AI provider request was made.

## Additional areas reviewed by CodeGraph

- `POST /api/service-requests` verifies the canonical managed table and QR signature, derives shop/table identity from the database, validates request type, and delegates duplicate suppression to an atomic database RPC. Staff reads and state changes require `orders.view`; no customer data was fetched.
- `GET /api/orders/events` authorizes shop streams with `orders.view`; customer order streams use a tracking token and the broker emits minimal change events rather than order contents.
- `POST /api/analytics/track` is the intentionally public event-ingestion path reviewed here; finding 6 records its item-counter and validation gaps. Analytics summary reads require `reports.view`.
- AI translation and OCR both require a verified session and pass through the same in-memory throttle. OCR additionally checks the shop plan. The shared throttle limitation is recorded in finding 7.
- Translation lacks the shop/plan entitlement check present on OCR and always requests all eight locales; recorded in finding 8.
- OCR accepts caller-supplied image/text before invoking local OCR or AI; the missing server-side size bounds are recorded in finding 10.
- `GET /api/health` is unauthenticated and returns configuration/status detail; recorded in finding 9.
- Billing and SePay webhook checks reviewed statically include server-owned plan pricing, payment amount validation, webhook secrets/signatures, transfer direction/account checks, and duplicate-event handling.
- Mobile staff session/order paths were checked with focused tests and typecheck: 14 tests passed; `tsc --noEmit` passed. Tests cover storage isolation, token clearing rules, shop membership, `counter_pos` submission, retry key preservation, and the unpaid invariant.

## Candidates checked and not reported as findings

- **Order pricing and payment state:** order pricing is resolved from server catalog/configuration, and service completion remains separate from payment settlement.
- **Table QR and service requests:** public table requests require the signed table token and server-side managed-table validation.
- **SePay safeguards:** the review found server-side secret handling and atomic duplicate/replay checks; no live webhook was sent.
- **Staff session revocation:** staff requests re-check active membership and session version, so role/password changes invalidate older staff tokens.
- **Password reset identity binding:** the admin reset handler stores a `profileId` next to the email key, but the web login selects the actual profile by the submitted email from the database. The supplied profile ID was not treated as an account-takeover issue because this path does not use it to select the login session identity.

These exclusions are source-level checks, not runtime or production guarantees.

## QA completed

| Area | Evidence | Result |
|---|---|---|
| Owner Overview | `.agy-runs/qa-owner-overview-deep.md`; `tests/dashboard-analytics-review.test.ts` | AGY read-only pass; Codex tests **8/8** |
| Orders / POS | Prior review and production simulations; fix `ddbb79d5b28b60710e1dfd651e05e76d32405936` | Error state verified with writes blocked |
| KDS / Reports | `.agy-runs/qa-owner-kds-reports-deep.md` | Detailed read-only pass; mocked failure and recovery flows |
| Catalog | `.agy-runs/qa-owner-catalog-deep-readonly.md`; catalog review suites | AGY read-only pass; Codex tests **33/33** |
| QR Studio / Floor Plan | `.agy-runs/qa-owner-qr-studio-deep-readonly.md`; five focused suites | Read-only pass; Codex tests **29/29** |
| Upload route | `tests/upload-route-review.test.ts` | Codex tests **8/8**; authorization gap remains |
| Posts / Promotions | AGY page/API pass plus Codex exact-order preview repro; guarded Playwright artifacts under `.gemini/antigravity-cli/brain/dac3fe7b-5fc2-4fcc-be35-8bd228199070/scratch/` | Page/API checks **6/6** PASS; exact preview sequence reproduced; non-auth writes **0** |
| Owner Settings | `.agy-runs/qa-progress.md`; guarded Playwright result under `.gemini/antigravity-cli/brain/346bbba0-dce4-46b5-a454-14d8531c001e/scratch/` | Five tabs, deep-links, keyboard navigation, and GET APIs passed; 1 auth POST, 0 other writes, 0 errors; no new runtime finding |

Posts / Promotions was validated in a dedicated read-only browser/API pass on 2026-10-26 with strict Playwright route guarding (all non-read methods blocked, 0 write attempts, 0 console/page errors). The earlier interrupted multi-page attempt remains uncounted for AI Scanner / Billing.
Owner Settings was validated on 2026-10-26 across all five tabs, direct `#payments` / `#staff` links, keyboard navigation, and shop/catalog/membership/SePay GETs. The route guard allowed one auth POST and observed zero other writes; no settings values were modified or recorded. The focused run reported zero console/page errors.

## CodeGraph queries used

- `codegraph status`
- `codegraph explore "SETTINGS_TABS DashboardSettingsPage"`
- `codegraph explore "activeTab SETTINGS_TABS handleTabKeyDown"`
- `codegraph explore "ShopMembersManager ShopSePayWebhookManager"`
- `codegraph explore "ShopOrderWorkflowEditor fetch"`
- `codegraph explore "ShopLabelPrintSettingsEditor"`
- `codegraph explore "useDashboard activeShop"`
- `codegraph explore "settings-tabpanel settings-tab"`
- `codegraph explore "sepay_config memberships api/shops/route.ts"`
- `codegraph explore "DashboardProvider DashboardLayout layout.tsx"`
- `codegraph explore 'role="alert"'`
- `codegraph node 'src/app/(dashboard)/dashboard/settings/page.tsx'`
- `codegraph node 'src/components/dashboard/ShopMembersManager.tsx'`
- `codegraph node 'src/components/dashboard/ShopSePayWebhookManager.tsx'`
- `codegraph node 'src/components/dashboard/ShopOrderWorkflowEditor.tsx'`
- `codegraph node 'src/components/dashboard/ShopLabelPrintSettingsEditor.tsx'`
- `codegraph node 'src/lib/dashboard-context.tsx'`
- `codegraph node 'src/app/api/shops/route.ts'`
- `codegraph node 'src/app/(dashboard)/dashboard/layout.tsx'`
- `codegraph explore "dashboard/posts PostsPage /api/posts promotions discount read write form"`
- `codegraph explore "DashboardPostsPage"`
- `codegraph explore "studioTab isPreviewSidebarOpen"`
- `codegraph node 'src/app/(dashboard)/dashboard/posts/page.tsx'`
- `codegraph explore "StorefrontWelcomePopup"`
- `codegraph explore "GET /api/posts"`
- `codegraph node 'src/app/api/posts/route.ts'`
- `codegraph node 'src/app/api/catalog/route.ts'`
- `codegraph query getAuthHeaders`
- `codegraph node 'src/lib/auth-session.ts'`
- `codegraph node 'src/app/(auth)/login/page.tsx'`
- `codegraph node Post`
- `codegraph node CatalogItem`
- `codegraph node resolveLoginAuthMode`
- `codegraph explore "useDashboard dashboard-context"`
- `codegraph node 'src/lib/dashboard-context.tsx'`
- `codegraph node 'src/lib/dashboard-nav.ts'`
- `codegraph node 'src/components/dashboard/RightPreviewSidebar.tsx'`
- `codegraph node 'src/app/api/auth/route.ts'`
- `codegraph node normalizeShopWelcomePopupConfig`
- `codegraph node normalizeShopPromoBannerConfig`
- `codegraph explore "dashboard/ai-scanner AI Scanner OCR upload image /api/catalog scan"`
- `codegraph explore "dashboard/billing subscription plan payment webhook checkout /api/webhooks/payment"`
- `codegraph explore "orders.create counter_pos order pricing inventory discount server authoritative"`
- `codegraph explore "requireShopPermission requireShopOwnerOrAdmin RLS authorization admin shop order route"`
- `codegraph explore "payment webhook billing settlement idempotency transaction status amount"`
- `codegraph node dbGetShopPosts`, `codegraph node dbGetShopCatalog`, `codegraph node dbGetStorefrontBundle`, `codegraph node getSupabaseDbClient`
- `codegraph node Shop`, `codegraph node Post`, `codegraph node CatalogItem`, `codegraph node WifiInfo`, `codegraph node ShopThemeConfig`
- `codegraph node 'src/app/api/catalog/route.ts'`, `codegraph node 'src/app/api/orders/route.ts'`, `codegraph node 'src/app/api/tables/route.ts'`
- `codegraph node 'src/app/api/upload/route.ts'`, `codegraph node 'src/app/api/webhooks/payment/route.ts'`
- `codegraph explore "Next.js API route handlers under src/app/api GET POST PUT PATCH DELETE authentication authorization requireAuthenticatedUser requireShopPermission rate limit"`
- `codegraph explore "service requests route POST GET PATCH table qr signature authorization pending acknowledged resolved caller public"`
- `codegraph node 'src/app/api/service-requests/route.ts'`, `codegraph node dbCreateTableServiceRequest`
- `codegraph explore "orders events SSE route shop permission owner staff authentication token polling"`
- `codegraph node 'src/app/api/analytics/track/route.ts'`, `codegraph node dbRecordAnalyticsEvent`
- `codegraph node 'src/app/api/health/route.ts'`, `codegraph node ensureSupabaseReadyAndSeeded`, `codegraph node shouldAutoSeedDemoData`
- `codegraph node 'src/app/api/ai/ocr-menu/route.ts'`
- `codegraph node requireAiCaller`, `codegraph node consumeAiRateLimit`
- `codegraph explore "Supabase migrations RLS policies security definer grants public tables shop_memberships orders catalog"`
- `codegraph node 'src/app/api/posts/route.ts'`, `codegraph node 'src/app/api/admin/route.ts'`, `codegraph node 'src/app/api/auth/route.ts'`
- `codegraph node hydrateShopWithSeedDefaults`, `codegraph node getAllowedLocalesForPlan`, `codegraph node 'src/lib/dashboard-nav.ts'`
- `codegraph explore "promotions.manage dashboard posts page navigation menu allowed promotion staff access /api/posts owner admin authorization"`
- `codegraph explore "readCredentials auth login profileId credentials normalizedEmail issue session"`
- `codegraph explore "shop hydration supported_langs storefront plan locales settings PATCH comparison"`
- `codegraph explore "admin delete_shop delete_owner historical shop_tables orders cascade trigger partial delete"`
- Direct reads of the unindexed `007_shop_tables.sql` and GitHub Actions workflow YAML after CodeGraph source exploration, as permitted by the workflow exceptions.

## Still open

- Static review is broad but not an exhaustive line-by-line audit; marketing/legal content and every low-risk UI component were not individually reviewed.
- No tests, typecheck, build, or browser workflows were run in the latest static pass. Earlier targeted QA results are reported separately and do not validate these findings.
- Live Supabase schema/data/RLS/storage/realtime state, external provider behavior, and production VPS configuration were not inspected.
- No fixes or application source changes were made; this file is the review deliverable.

---

## Deep follow-up review (2026-10-26)

This follow-up broadens the risk-based static review across the web API, shared server libraries, dashboard and storefront, mobile owner/staff flows, SQL migrations, deployment workflows, migration scripts, and relevant invariant tests. The coverage table records the areas examined; this is not a line-by-line audit of every repository file. The confirmed findings below were checked against current CodeGraph source and, for SQL/workflow files, direct source. No live data was read and no write path was exercised.

### Prioritized summary of new findings (25–31)

| # | Severity | Area | Summary | Primary location(s) |
| --- | --- | --- | --- | --- |
| **25** | **[P1]** | VPS deployment & local state | A persistent backup directory causes later deployments to restore the first deployment's .local-db files over current credentials/configuration. | [.github/workflows/deploy.yml](../.github/workflows/deploy.yml:98), [src/lib/auth-credentials.ts](../src/lib/auth-credentials.ts:77) |
| **26** | **[P2]** | Super Admin account deletion | delete_owner checks an optional request email instead of resolving the target owner; omitting or mismatching it bypasses the Super Admin guard and enters the destructive deletion sequence. | [src/app/api/admin/route.ts](../src/app/api/admin/route.ts:586) |
| **27** | **[P1]** | Owner account creation | create_owner substitutes a shared repository default when password is absent or too short. | [src/app/api/admin/route.ts](../src/app/api/admin/route.ts:504) |
| **28** | **[P2]** | Owner identity and credentials | create_owner permits an existing email and overwrites its file-based credential mapping with a new profile ID, leaving the previous profile and shops attached to a different identity. | [src/app/api/admin/route.ts](../src/app/api/admin/route.ts:514), [001_init_qlaok.sql](../supabase/migrations/001_init_qlaok.sql:78) |
| **29** | **[P3]** | Billing GET | An authenticated staff account with no profiles row receives the global SEED_PROFILE fallback; the transactions query remains scoped to that staff ID. | [src/app/api/webhooks/payment/route.ts](../src/app/api/webhooks/payment/route.ts:328), [src/lib/db.ts](../src/lib/db.ts:1963) |
| **30** | **[P2]** | Table floor plan | The floor-plan endpoint reads every historical shop order, then returns HTTP 500 once the shop exceeds the 10,000-row cap. | [src/app/api/tables/floor-plan/route.ts](../src/app/api/tables/floor-plan/route.ts:17), [src/lib/table-floor-plan.ts](../src/lib/table-floor-plan.ts:97) |
| **31** | **[P2]** | Catalog price validation | upsert_item and bulk_import bypass the non-negative, 1-billion-VND price validation used by the bulk price action; the database column has no non-negative CHECK. | [src/app/api/catalog/route.ts](../src/app/api/catalog/route.ts:181), [src/lib/db.ts](../src/lib/db.ts:1443), [001_init_qlaok.sql](../supabase/migrations/001_init_qlaok.sql:141) |

### Codex independent review corrections

- **Rejected AGY's service-request foreign-key candidate:** Migration 018 explicitly drops both table_service_requests actor-column foreign keys at supabase/migrations/018_shop_staff_accounts.sql:69-73. The proposed staff status-update failure was not a finding and has been removed.
- **Did not promote the expected_total promotion mismatch:** the current mobile helper emits expected_total only for payment collection and does not combine it with item or discount edits. No current first-party caller was found that reaches the claimed 409 path. The mismatch remains a test candidate if a client later combines those fields.
- **Did not promote the stock-restock availability difference:** the catalog page sends is_available explicitly with its stock update. The helper preserves availability when that field is omitted, which may be intentional for callers that manage availability separately; no current UI failure was established.
- **Merged the migration-runner candidate into existing Finding 15:** checksum drift and replay through the service-role RPC fallback are already documented there, so no duplicate finding was added.
- **Updated existing Finding 21:** the admin create-owner path's missing Supabase Auth provisioning is additional evidence for the same web/mobile credential divergence and is documented under Finding 21.

### Detailed follow-up findings (25–31)

#### 25. [P1] Later VPS deployments restore the first deployment's stale .local-db snapshot

- **Locations:** .github/workflows/deploy.yml:98-109; src/lib/auth-credentials.ts:77-85; src/lib/db.ts:116-120.
- **Preconditions:** The deploy workflow runs on the persistent VPS and /tmp/qlaok_local_db_backup already exists from an earlier deployment.
- **Safe reproduction scenario:**
  1. On a deployment with no backup directory, cp -r .local-db /tmp/qlaok_local_db_backup creates the top-level snapshot.
  2. Change a local credential or local-store JSON file between deployments.
  3. On a later deployment, cp -r .local-db /tmp/qlaok_local_db_backup copies into /tmp/qlaok_local_db_backup/.local-db because the destination directory already exists; it does not refresh the older top-level snapshot.
  4. The restore command copies the stale top-level files back over .local-db, replacing current files with the earlier contents.
- **Concrete impact:** Owner credential mappings and local fallback/configuration stores can revert on deployment. The backup directory is not cleaned up. auth-credentials.ts writes the credential file without an explicit restrictive mode; whether another VPS account can read it depends on the runtime umask and actual permissions, which were not inspected.
- **Traced path:** deploy.yml backs up before git reset and restores the wildcard contents after reset. The source credential writer uses the persistent .local-db directory.
- **Remediation:** Replace the backup atomically on every deployment, use directory-safe copy semantics, restore only that run's snapshot, and remove it after a successful restore. Set and verify restrictive permissions for credential files.
- **Confidence / limits:** High for stale overwrite based on POSIX cp semantics and workflow order. Runtime file permissions and the live VPS backup contents were not checked.

#### 26. [P2] delete_owner trusts an optional request email for the Super Admin deletion guard

- **Locations:** src/app/api/admin/route.ts:586-627; src/lib/auth-session.ts:8-16.
- **Preconditions:** An authenticated Super Admin invokes delete_owner with the Super Admin profile ID and omits email or supplies a different email.
- **Safe reproduction scenario:** Send the authorized action with ownerId set to the protected account and no email. The guard calls isSuperAdminEmail(email), which returns false for a missing value, and the handler proceeds to delete shops and payment transactions before attempting to delete the profile.
- **Concrete impact:** The intended protection is bypassed and the destructive, multi-request deletion sequence runs against the protected account. Earlier deletes commit independently; whether the final profile deletion succeeds depends on remaining database constraints.
- **Traced path:** The guard at route.ts:592 evaluates only the optional body email. The target identity used for deletion is ownerId at route.ts:600-615. The operation does not resolve the target profile's email before the guard and is not wrapped in one transaction.
- **Remediation:** Resolve the target profile from ownerId and reject when it is the protected ID or a Super Admin profile. Perform the deletion in a transactional database operation and check every result.
- **Confidence / limits:** High that the guard can be bypassed and the destructive sequence entered; static review cannot establish whether the live database has a remaining constraint that blocks the final profile delete.

#### 27. [P1] create_owner assigns a shared default password when input is missing or too short

- **Locations:** src/app/api/admin/route.ts:504-560; src/lib/auth-credentials.ts:77-85.
- **Preconditions:** An authorized Super Admin calls create_owner with no password or a password shorter than the route's minimum.
- **Safe reproduction scenario:** Submit a valid owner email and omit password. The route selects its repository-embedded default, hashes it, and writes the hash to the shared credentials map instead of rejecting the request.
- **Concrete impact:** An account created through an incomplete request receives a predictable password shared with other accounts created the same way. The stored scrypt hash does not protect against someone who knows the shared default.
- **Remediation:** Reject missing or short passwords server-side. Prefer a one-time setup flow that does not create an account with a reusable default.
- **Confidence / limits:** High from the route branch. The default value itself is intentionally omitted from this report.

#### 28. [P2] create_owner overwrites credentials for an existing normalized email

- **Locations:** src/app/api/admin/route.ts:514-560; supabase/migrations/001_init_qlaok.sql:78-87; src/lib/auth-credentials.ts:14-18; src/lib/auth-session.ts:8-30.
- **Preconditions:** An authorized Super Admin creates an owner using an email already present in the credentials map or profiles table.
- **Safe reproduction scenario:** The route validates only email syntax, creates a random new profile ID, upserts on that new ID, and assigns creds[normalizedEmail] to the new profile ID. The profiles schema declares email but no uniqueness constraint in the repository migrations.
- **Concrete impact:** The existing email credential now resolves to the newly created profile while the previous profile and its shops remain attached to the old ID. Reusing the reserved Super Admin email also changes the profile ID behind that email-based admin identity.
- **Remediation:** Reject existing and reserved emails before creating the profile, enforce normalized-email uniqueness in the server/database design, and never overwrite an existing credential mapping as a side effect of account creation.
- **Confidence / limits:** High for the application path and repository schema. Live out-of-band database constraints and existing duplicate rows were not inspected.

#### 29. [P3] Billing GET returns the global seed profile for an authenticated identity with no profile row

- **Locations:** src/app/api/webhooks/payment/route.ts:328-340; src/lib/db.ts:1963-1984; src/lib/seed-data.ts:22-29.
- **Preconditions:** A valid shop-staff session is accepted by requireAuthenticatedUser, and its staff subject has no matching row in public.profiles.
- **Safe reproduction scenario:** A staff session requests GET /api/webhooks/payment. The handler resolves ownerId to the session subject; dbGetBillingData finds no profile for that ID and returns SEED_PROFILE. Its transactions query remains filtered to the staff subject.
- **Concrete impact:** The endpoint returns the global seeded profile object to a staff caller and can display misleading billing identity data. The static review found no disclosure of another owner's payment transactions through this path.
- **Remediation:** Require billing-owner/admin authorization for this response or return a missing-profile error. Avoid replacing a request-scoped missing profile with a global seed object.
- **Confidence / limits:** High for the fallback path and staff-token acceptance; low severity because the returned profile is static seed data and the transaction query remains scoped. No staff request was sent.

#### 30. [P2] Floor-plan reads all shop orders and fails above 10,000 lifetime rows

- **Locations:** src/app/api/tables/floor-plan/route.ts:17-19, 42-112, 134-186; src/lib/table-floor-plan.ts:97-199.
- **Preconditions:** A shop has at least 10,001 order rows in Supabase, including completed/paid or cancelled history.
- **Safe reproduction scenario:** Open the Floor Plan tab for a shop with more than 10,000 lifetime orders. The route pages every row filtered only by shop_id. fetchAllWithPagination stops at 10,000, performs a one-row lookahead, and throws MAX_RECORDS_EXCEEDED_ORDERS when another row exists; the route catches the error and returns HTTP 500.
- **Concrete impact:** The floor-plan endpoint stops loading after the shop crosses the fixed lifetime-row threshold even when only a small number of orders are currently open.
- **Remediation:** Filter the database query to the order states the summaries need (active orders and completed unpaid orders), or compute the summaries with a bounded database-side aggregate and indexed predicates.
- **Confidence / limits:** High for the threshold and unfiltered query. No production row counts were fetched.

#### 31. [P2] upsert_item and bulk_import bypass catalog price bounds

- **Locations:** src/app/api/catalog/route.ts:181-245, 357-364; src/lib/db.ts:1443-1592, 1602-1654; src/lib/catalog-excel.ts:153-191; supabase/migrations/001_init_qlaok.sql:136-154.
- **Preconditions:** A caller with the relevant catalog permission submits an item price through upsert_item or bulk_import.
- **Safe reproduction scenario:** Submit a negative numeric price through upsert_item or include one in a bulk_import item. Those branches pass values to dbUpsertItem/dbBulkImportCatalog without calling parseCatalogPriceValue. The shared price parser and bulk_update_price_stock path reject negative values and values above 1,000,000,000, but items.price is NUMERIC(12,0) NOT NULL without a non-negative CHECK.
- **Concrete impact:** Invalid negative or over-limit catalog prices can be stored through these actions despite the stricter bulk price endpoint. Order pricing clamps negative unit prices to zero, so the saved catalog value and order quote can disagree.
- **Remediation:** Validate finite integer prices in the shared database write path and bulk import before writing, enforce the product limit consistently, and add a database CHECK for non-negative values.
- **Confidence / limits:** High for the API/helper/schema path. No catalog write or live database query was performed.

### Repository-wide coverage matrix

| Area / Subsystem | Paths and flows examined | Result |
| --- | --- | --- |
| **Auth, sessions and permissions** | auth/session helpers, shop membership permissions, owner and staff login, password reset, admin account actions | Existing Findings #11, #12, #21, #23; new Findings #26-28. Admin create-owner's Auth mismatch is folded into #21. |
| **Shops, staff accounts and SePay configuration** | shops API, membership paths, staff account create/rotate/revoke, encrypted SePay config | Existing Findings #14, #16, #23; no further confirmed issue from this pass. |
| **Catalog and inventory** | catalog API, item/category write helpers, bulk actions, item price parser, catalog migration/schema | Existing Findings #12-13; new Finding #31. Stock-restock availability difference was not counted because current UI sends is_available with stock changes. |
| **Orders, pricing and settlement** | orders API, mPOS helpers, pricing quote, atomic workflow migration and settlement docs | Existing Findings #16 and #19; atomic workflow safeguards were inspected. No confirmed expected_total promotion mismatch because no current first-party caller combines that field with item/discount edits. |
| **Managed tables and floor plan** | table API, QR signatures, floor-plan query and summary helper | New Finding #30; QR signature and layout validation were checked. |
| **Table service requests** | request API/helper, cooldown RPC, migrations 009 and 018 | No new issue: migration 018 drops both actor-column profile foreign keys. |
| **Billing and SePay webhooks** | billing GET/POST, SePay webhook, reconciliation helper, setup docs | New Finding #29. Secret/signature and server-owned price checks were reviewed. |
| **Super Admin API and console** | admin API, console flows, owner create/delete/reset, plan changes | Existing Findings #19 and #21; new Findings #26-28. |
| **Realtime, push, uploads, AI, posts and health** | SSE broker/routes, push-token ownership, upload route, OCR/translation, posts, analytics, health | Existing Findings #4-10, #18, #23-24; no additional confirmed issue in SSE/push during this pass. |
| **Dashboard, onboarding and storefront** | orders, kitchen, catalog, reports, billing, QR studio, AI scanner, onboarding and public storefront pages | Existing Findings #3, #17, #20, #23-24; new Finding #29. |
| **Mobile owner and staff app** | mobile auth/session storage, staff workspace and assisted orders, order action payloads | Existing Finding #21; admin-created account Auth mismatch folded into #21. Staff storage isolation and current expected_total caller were checked. |
| **SQL, RLS, triggers and RPCs** | 21 repository migration files inventoried: 001, 002, 002z, 003-020. Focused source review covered migration paths tied to findings, RLS/trigger/RPC behavior, the 002z payment-reference reconciliation, and 012 floor-plan constraints; this was not a line-by-line audit of every migration. | Existing Findings #12-15, #19-20, #22; new Finding #31. Migration 018 drops both service-request actor FKs; no FK finding retained. |
| **Operational scripts, CI/CD and tests** | migration runner, preflight scripts, deploy workflows, SQL review tests | Existing Findings #15 and #22; new Finding #25. Migration-runner candidate was merged into #15. |

---

### Follow-up CodeGraph queries and verification log

- `codegraph status` (verified index up to date: 256 files, 4,012 nodes, 14,180 edges)
- `codegraph explore "server-auth verifyRequestUser requireShopPermission verifyActiveShopStaffSession auth-session auth-credentials staff-accounts"`
- `codegraph node src/lib/server-auth.ts`, `codegraph node src/lib/auth-session.ts`, `codegraph node src/lib/auth-credentials.ts`, `codegraph node ALL_SHOP_PERMISSIONS`, `codegraph node DEFAULT_ROLE_PERMISSIONS`, `codegraph node authenticateShopStaffLogin`, `codegraph node verifyActiveShopStaffSession`
- `codegraph explore "api/auth POST login register staff_login demo_login reset password recovery"`
- `codegraph explore "api/shops POST PATCH DELETE memberships staff_member sepay_config slug aliases"`
- `codegraph explore "api/catalog POST PUT PATCH DELETE upsert_item bulk_update_price_stock bulk_move_items bulk_delete_items bulk_update_availability"`
- `codegraph explore "api/orders mpos-store order-pricing order-workflow"`
- `codegraph explore "webhooks/payment webhooks/sepay sepay-reconciliation saas-bank-accounts"`
- `codegraph explore "api/admin admin/page.tsx Super Admin"`
- `codegraph explore "migrate-supabase migrations sql"`, `codegraph explore "sql-migrations.test.ts"`
- `codegraph node src/app/api/auth/route.ts`, `codegraph node src/app/api/shops/route.ts`, `codegraph node src/app/api/catalog/route.ts`, `codegraph node src/app/api/orders/route.ts`
- `codegraph explore "PATCH src/app/api/orders/route.ts requiredPerms"`
- `codegraph node dbCreateOrder`, `codegraph node dbUpdateOrderStatus`, `codegraph node dbSettleTableBill`, `codegraph node dbRecordOrderPrint`
- `codegraph node src/lib/order-pricing.ts`, `codegraph node processSePayShopWebhook`, `codegraph node dbUpsertShopSePayConfig`
- `codegraph node src/app/api/webhooks/payment/route.ts`, `codegraph node src/app/api/webhooks/sepay/[shopId]/route.ts`, `codegraph node src/app/api/admin/route.ts`
- `codegraph node dbUpsertCategory`, `codegraph node dbUpsertItem`, `codegraph node dbBulkImportCatalog`, `codegraph node dbGetBillingData`, `codegraph node dbCreatePaymentOrder`, `codegraph node dbCompletePaymentWebhook`, `codegraph node dbSetProfilePlan`, `codegraph node dbCreateShop`, `codegraph node dbUpdateShop`
- `codegraph node dbComputeShopRevenueAndInventoryStats`, `codegraph node computeShopRevenueAndInventoryStats`, `codegraph node normalizeStatsFromRpcPayload`, `codegraph node orderInventoryDelta`, `codegraph node orderStockDemand`, `codegraph node assertPaymentTransition`, `codegraph node normalizeOrderRecord`
- `codegraph explore "api/tables floor-plan shop-tables table-floor-plan table-helpers"`
- `codegraph explore "api/service-requests service-requests"`
- `codegraph explore "api/orders/events order-events order-live-sync"`
- `codegraph explore "api/push-tokens push-notifications"`
- `codegraph explore "api/upload r2 supabase-storage"`
- `codegraph node src/app/api/tables/route.ts`, `codegraph node src/app/api/tables/floor-plan/route.ts`, `codegraph node src/app/api/service-requests/route.ts`, `codegraph node dbUpdateServiceRequestStatus`, `codegraph node src/app/api/orders/events/route.ts`, `codegraph node src/app/api/push-tokens/route.ts`, `codegraph node src/app/api/upload/route.ts`
- `codegraph explore "api/tables ShopTableFloorPlanCanvas onMoveTable"`, `codegraph explore "dashboard/orders/page.tsx floor-plan onMoveTable"`
- `codegraph node src/app/(dashboard)/dashboard/orders/page.tsx`, `codegraph node src/app/(dashboard)/dashboard/billing/page.tsx`, `codegraph node src/app/(dashboard)/dashboard/reports/page.tsx`
- `codegraph explore "dashboard/kitchen/page.tsx dashboard/catalog/page.tsx"`, `codegraph explore "dashboard/reports/page.tsx dashboard/billing/page.tsx dashboard/qr-studio/page.tsx"`, `codegraph explore "dashboard/ai-scanner/page.tsx onboarding/page.tsx onboarding-flow.ts"`, `codegraph explore "s/[slug]/page.tsx s/[slug]/menu/page.tsx ShowToStaffModal.tsx"`
- `codegraph node src/lib/onboarding-flow.ts`, `codegraph node "src/app/(auth)/onboarding/page.tsx"`
- `codegraph explore "mobile/App.tsx AuthScreen.tsx StaffWorkspace.tsx AssistedOrderScreen.tsx order-actions.ts"`
- `codegraph node mobile/src/lib/order-actions.ts`, `codegraph node loginStaff`, `codegraph node StaffWorkspace`
- Direct reads of selected unindexed SQL migrations numbered 001–020 plus 002z, operational scripts (`scripts/migrate-supabase.mjs`, `scripts/preflight-demo-reset.mjs`), CI/CD workflows (`.github/workflows/deploy.yml`, `.github/workflows/supabase-migrate.yml`), and `tests/sql-review.test.mjs` after CodeGraph exploration.
- Codex independent queries: codegraph explore PATCH /api/orders expected_total callers; codegraph explore 002z_reconcile_legacy_bank_refs.sql and 012_table_floor_plan.sql; codegraph explore profile email uniqueness and item price constraints; codegraph explore writeCredentials local store file permissions.
- Codex independent nodes: requireAuthenticatedUser, verifyRequestUser, dbGetBillingData, dbUpdateServiceRequestStatus, buildOrderStatusPatchPayload, computeTableFloorPlanSummaries, dbUpsertItem, dbBulkImportCatalog, and writeCredentials.
- Direct SQL/workflow checks confirmed migration 018 drops both service-request actor FKs, migration 002z archives conflicting payment-reference rows before nulling duplicate references, and migration 012 adds floor-plan coordinate checks. A filename inventory found 21 SQL migration files; no line-by-line claim is made for the complete set.
- The migration scan found no repository unique constraint on profiles.email and no SQL CHECK constraint on items.price; the live database was not queried.
