# Qlaok Full Repository Read-Only Code Review — 2026-11-02

## 1. Executive Summary

This report records a read-only full-repository review of Qlaok across active web API routes, core server libraries, web UI surfaces, the Expo owner/staff mobile app (`mobile/`), operational scripts (`scripts/`), database migrations (`supabase/migrations/`), and the test suite (`tests/`). The review was conducted against `README.md`, `ARCHITECTURE.md`, `docs/CODEGRAPH_WORKFLOW.md`, and the closed items in `docs/CLAUDE_CODE_REVIEW_2026-10-27.md` (with special attention to sections 183–201).

All closed remediations from `docs/CLAUDE_CODE_REVIEW_2026-10-27.md` (including §§183–201) remain intact in the current working tree, and both web and mobile TypeScript checks pass cleanly (`0` errors). However, inspecting adjacent code paths and callers with CodeGraph uncovered **6 confirmed, actionable findings** (5 Medium / P2, 1 Low / P3) that were not covered by prior review passes:

1. **Public API projection gaps (`Medium / P2`):** Unauthenticated directory `GET /api/shops` (no query params, or empty `?ownerId=`) and public `GET /api/catalog?shopId=...` bypass `toPublicStorefrontShop(shop)`, leaking internal shop fields (`owner_id`, `telegram_chat_id`, `opening_hours_confirmed`, `created_at`, `updated_at`, `wifi_info.password` on directory listings) and internal `theme_config` properties (`labelPrintConfig`, `serviceRequestNotificationRule`).
2. **Pre-auth / unscoped DB lookups creating cross-shop resource existence oracles (`Medium / P2`):** `DELETE /api/catalog`, `POST /api/orders` (`action: 'record_print'`), and `PATCH /api/tables` perform privileged service-role lookups by resource ID before verifying authentication or scoping by `shopId` (same vulnerability class as closed §152 `DELETE /api/posts`), allowing unauthenticated `404` vs `401` probing and cross-shop `404` vs `403` probing. `DELETE /api/catalog` also ignores `.maybeSingle()` database errors, misreporting DB outages as `404`.
3. **Cross-shop item state oracle on `POST /api/catalog` (`action: 'upsert_item'`) (`Medium / P2`):** `existing` is fetched by `incoming.id` without verifying `existing.shop_id === targetShopId` before running `expected_stock_quantity` / `expected_is_available` compare-and-swap (CAS) checks, returning `409 STOCK_CONFLICT` vs `400 ITEM_NOT_IN_SHOP` based on another shop's live item state.
4. **Silent `SEED_ITEMS` fallback on `GET /api/orders` catalog query failure (`Medium / P2`):** After §198 hardened `dbGetShopCatalog` to throw on DB errors, `GET /api/orders` still wraps `dbGetShopCatalog(shopId)` in `try { ... } catch { catalogItems = SEED_ITEMS.filter(...); }`, returning HTTP `200` with `items: []` and falsified zero low-stock/out-of-stock statistics during transient DB errors and overwriting live mobile/web catalog item state.
5. **Mobile `Workspace` PostgREST fallback restores permissions for deactivated owners (`Medium / P2`):** When `fetchApi('/api/shops?member=1')` fails in `mobile/App.tsx`, the PostgREST fallback queries `shops` by `owner_id` without querying `shop_memberships`, leaving `activeMembership` as `null` so `hasPerm` falls back to `activeShop.owner_id === userId` (`true`) and re-enables all owner UI permissions for a deactivated owner membership.
6. **Mobile owner session validator downgrades `'basic'` plan to `'free'` (`Low / P3`):** `validateOwnerSession` in `mobile/src/lib/owner-session.ts` still normalizes `user.plan` against `'free' | 'pro' | 'premium'`, coercing canonical `'basic'`-tier owners returned by `/api/auth` to `'free'` in persisted mobile session state.

For safe incremental execution, the 6 findings naturally group into three small remediation batches:
- **Group A (Public & Cross-Shop API Boundaries):** Findings #1, #2, #3 (`src/app/api/shops/route.ts`, `src/app/api/catalog/route.ts`, `src/app/api/orders/route.ts`, `src/app/api/tables/route.ts`).
- **Group B (Order Read Error Integrity):** Finding #4 (`src/app/api/orders/route.ts`).
- **Group C (Mobile Fallback & Session Plan Normalization):** Findings #5, #6 (`mobile/App.tsx`, `mobile/src/lib/owner-session.ts`).

---

## 2. Reviewer Attribution & Claude CLI Fallback Disclosure

- **Primary CLI Failure:** The direct local `claude` CLI was invoked first using its configured DeepSeek route, and failed immediately before producing any review output with:
  `[claude-code:unrecognized_model]`
- **Authorized Fallback Reviewer:** Per user authorization, this review was executed by **Gemini 4 Argon (High)** via Antigravity CLI (`agy`) following the repository's mandatory CodeGraph workflow (`AGENTS.md`, `GEMINI.md`, `docs/CODEGRAPH_WORKFLOW.md`).
- **Attribution Notice:** This document reflects the analysis of **Gemini 4 Argon (High)** only and must **not** be represented as a Claude or DeepSeek verdict.

---

## 3. Confirmed Findings

### Finding 1 — [Medium / P2] Public directory `GET /api/shops` and public `GET /api/catalog?shopId=...` bypass `toPublicStorefrontShop` projection and leak internal shop/theme metadata

- **Severity:** Medium (P2 — Privacy / Public API Projection)
- **Exact Files & Lines:**
  - `src/app/api/shops/route.ts:297-306` (and `src/app/api/shops/route.ts:64-100` for `toPublicStorefrontShop`)
  - `src/app/api/catalog/route.ts:218-243`
- **Concrete Failure Scenario:**
  - In `docs/CLAUDE_CODE_REVIEW_2026-10-27.md` (§124 and §200), `GET /api/shops?slug=...` (`src/app/api/shops/route.ts:185`) and `GET /api/shops?shopId=...` (`src/app/api/shops/route.ts:216`) were hardened to project non-member responses through `toPublicStorefrontShop(shop)` (`src/app/api/shops/route.ts:64-100`), which strips internal columns (`owner_id`, `telegram_chat_id`, `opening_hours_confirmed`, `created_at`, `updated_at`) and internal `theme_config` properties (`labelPrintConfig`, `serviceRequestNotificationRule`, and arbitrary keys).
  - **Gap A (`GET /api/shops` public directory branch):** When an unauthenticated caller requests `GET /api/shops` with no query parameters (used by `src/app/(marketing)/explore/page.tsx:33`) or with an empty `?ownerId=`, execution reaches `src/app/api/shops/route.ts:297-306`:
    ```ts
    const data = await dbGetAllShopsAndProfile(undefined);
    return NextResponse.json({
      shops: data.shops.filter((s) => s.is_published !== false),
      user: null,
    });
    ```
    Because `dbGetAllShopsAndProfile` (`src/lib/db.ts:632-646`) executes `sb.from('shops').select('*')` with the privileged service-role client and the route does not map through `toPublicStorefrontShop`, every published shop's full database row—including `owner_id`, `telegram_chat_id`, `opening_hours_confirmed`, `created_at`, `updated_at`, `theme_config.labelPrintConfig`, `theme_config.serviceRequestNotificationRule`, and `wifi_info.password`—is returned to anonymous callers in a single bulk response.
  - **Gap B (`GET /api/catalog?shopId=...`):** In `src/app/api/catalog/route.ts:218-243`, `publicShop` is constructed inline instead of calling `toPublicStorefrontShop(shop)` when `!isMemberOrAdmin`. Line 235 includes `opening_hours_confirmed: shop.opening_hours_confirmed`, and line 238 passes raw `theme_config: shop.theme_config` without `toPublicStorefrontThemeConfig`, exposing internal printer configuration (`labelPrintConfig`) and staff notification rules (`serviceRequestNotificationRule`) to unauthenticated storefront callers.
- **Supporting Call Path:**
  - `GET /api/shops` (`src/app/api/shops/route.ts:163`) -> `ownerId` falsy (`line 221`) -> `memberOnly` false (`line 236`) -> `all` false (`line 286`) -> `dbGetAllShopsAndProfile(undefined)` (`line 301` -> `src/lib/db.ts:635`) -> unprojected `data.shops` returned (`line 303`).
  - `GET /api/catalog?shopId=<published-shop-id>` (`src/app/api/catalog/route.ts:154`) -> `dbGetShopCatalog(shopId)` (`line 169`) -> inline `publicShop` (`lines 218-243`) -> returned in `NextResponse.json({ shop: publicShop, ... })` (`line 245`).
- **Actionable Fix Direction:**
  1. Move or export `toPublicStorefrontShop` (and a directory variant that also strips `wifi_info` or `wifi_info.password` for cross-shop directory browsing) into `src/lib/public-catalog.ts`.
  2. In `src/app/api/shops/route.ts:302-306`, project non-admin directory results through `.map((s) => toPublicDirectoryShop(s))` and reject empty `?ownerId=` (`if (searchParams.has('ownerId') && !ownerId)`) with HTTP `400` or `401` instead of falling through to the public directory listing.
  3. In `src/app/api/catalog/route.ts:218-243`, return `toPublicStorefrontShop(shop)` when `!isMemberOrAdmin` so `GET /api/catalog` and `GET /api/shops` enforce the exact same public shop projection.

---

### Finding 2 — [Medium / P2] `DELETE /api/catalog`, `POST /api/orders` (`action: 'record_print'`), and `PATCH /api/tables` perform unauthenticated or unscoped privileged DB lookups before shop authorization, creating cross-shop resource existence oracles

- **Severity:** Medium (P2 — Authorization / Multi-Tenant Isolation / Error Handling)
- **Exact Files & Lines:**
  - `src/app/api/catalog/route.ts:1671-1766` (`DELETE`)
  - `src/app/api/orders/route.ts:463-500` (`POST` with `action === 'record_print'`)
  - `src/app/api/tables/route.ts:18-45, 198-212` (`PATCH`)
- **Concrete Failure Scenario:**
  - In `docs/CLAUDE_CODE_REVIEW_2026-10-27.md` (§152), `DELETE /api/posts` (`src/app/api/posts/route.ts:65-85`) was fixed because it queried the resource by `id` before authenticating or scoping to `shopId`, leaking `404` vs `401`/`403` across shops. Three other write endpoints still have the same defect:
  - **1. `DELETE /api/catalog` (`src/app/api/catalog/route.ts:1671-1766`):**
    - Lines 1678–1686 query `sb.from('items').select('id, shop_id').eq('id', itemId).maybeSingle()` using the service-role client **before** `requireShopPermission(req, existing.shop_id, 'catalog_manage')` (line 1688).
    - Lines 1722–1733 query `sb.from('categories').select('id, shop_id').eq('id', categoryId).maybeSingle()` **before** `requireShopPermission(req, existing.shop_id, 'catalog_manage')` (line 1735).
    - An unauthenticated caller probing item or category IDs receives `404 Item not found` / `404 Category not found` when the ID does not exist, and `401 Authentication required` when the ID exists (including items/categories in unpublished shops). An authenticated user from Shop A receives `403` when the ID exists in Shop B vs `404` when it does not.
    - Furthermore, neither `.maybeSingle()` call inspects `error`: if Supabase returns a transient query failure, `existing` is `null` and the handler returns HTTP `404` instead of HTTP `500`.
  - **2. `POST /api/orders` (`action: 'record_print'`, `src/app/api/orders/route.ts:463-500`):**
    - When `body.shopId` is omitted, line 480 calls `await dbGetOrderById(resolvedOrderId)` before any authentication check. If the order ID does not exist, line 482 returns `404 Order not found` to an unauthenticated caller; if the order ID exists in any shop, line 487 calls `requireShopPermission(req, targetShopId, 'orders_Print_Receipt')`, which returns `401` (unauthenticated) or `403` (authenticated member of another shop).
  - **3. `PATCH /api/tables` (`src/app/api/tables/route.ts:198-212`):**
    - When `shopId` is omitted from the request body, line 201 calls `await dbGetShopTableById(tableId)` after `requireAuthenticatedUser(req)` (line 200) but before verifying shop ownership. Any authenticated user can probe arbitrary `tableId` values across all shops: non-existent IDs return `404 SHOP_TABLE_NOT_FOUND` (line 206), whereas existing IDs in another shop return `403` from `requireShopOwnerOrAdmin` (line 210). Even when the caller passes their own `shopId` with another shop's `tableId`, `dbUpdateShopTable` throws `FORBIDDEN_CROSS_SHOP_TABLE`, which `mapTableErrorStatus` (`src/app/api/tables/route.ts:19, 43`) maps to HTTP `403` instead of `404`.
- **Supporting Call Path:**
  - `DELETE /api/catalog?itemId=<id>` (`src/app/api/catalog/route.ts:1671`) -> `sb.from('items').select('id, shop_id').eq('id', itemId).maybeSingle()` (`lines 1678-1682`) -> `404` if missing (`line 1685`) -> `requireShopPermission` (`line 1688`, returns `401`/`403` if present).
  - `POST /api/orders` (`{ action: 'record_print', orderId: '<id>' }`, `src/app/api/orders/route.ts:463`) -> `dbGetOrderById(resolvedOrderId)` (`line 480`) -> `404` if missing (`line 482`) -> `requireShopPermission` (`line 487`, returns `401`/`403` if present).
  - `PATCH /api/tables` (`{ id: '<id>', label: 'T1' }`, `src/app/api/tables/route.ts:154`) -> `dbGetShopTableById(tableId)` (`line 201`) -> `404` if missing (`line 203`) -> `requireShopOwnerOrAdmin` (`line 210`, returns `403` if present in another shop).
- **Actionable Fix Direction:**
  1. In `DELETE /api/catalog`, call `requireAuthenticatedUser(req)` before any database query, check `error` on `.maybeSingle()` (returning HTTP `500` on DB error), and either require `shopId` (scoping the lookup with `.eq('shop_id', shopId)` after `requireShopPermission`) or map cross-shop `403` from `requireShopPermission` to `404 Item not found` / `404 Category not found` so cross-shop existence is never distinguishable.
  2. In `POST /api/orders` (`action === 'record_print'`), call `requireAuthenticatedUser(req)` before `dbGetOrderById(resolvedOrderId)` and return `404 Order not found` when `order.shop_id` does not match an authorized shop for that user.
  3. In `PATCH /api/tables`, normalize cross-shop `requireShopOwnerOrAdmin` failures (when `shopId` was inferred from `dbGetShopTableById`) and `FORBIDDEN_CROSS_SHOP_TABLE` to HTTP `404 SHOP_TABLE_NOT_FOUND` (matching `DELETE /api/posts` in `src/app/api/posts/route.ts:65-85`).

---

### Finding 3 — [Medium / P2] `POST /api/catalog` (`action: 'upsert_item'`) loads `existing` item by `id` without scoping to `targetShopId`, leaking cross-shop item state via `409 STOCK_CONFLICT` before `dbUpsertItem` rejects

- **Severity:** Medium (P2 — Multi-Tenant Isolation / Authorization)
- **Exact File & Lines:**
  - `src/app/api/catalog/route.ts:279-292` (and lines `361-375`, `455-610`)
- **Concrete Failure Scenario:**
  - In `POST /api/catalog` (`action === 'upsert_item'`), after authorizing `targetShopId = String(incoming.shop_id || shopId || '').trim()`, lines 279–292 load `existing`:
    ```ts
    if (incoming.id && isSupabaseConfigured) {
      const { data: existingRow, error: existingErr } = await getSupabaseDbClient()
        .from('items')
        .select('*')
        .eq('id', String(incoming.id))
        .maybeSingle();
      ...
      existing = (existingRow as Item | null) || null;
    }
    ```
  - Notice that `existingRow` is not filtered by `.eq('shop_id', targetShopId)` and `existing.shop_id !== targetShopId` is never checked in the route handler.
  - If an authenticated member of Shop A (`targetShopId = 'shop-a'`) sends `POST /api/catalog` with `action: 'upsert_item'`, `shopId: 'shop-a'`, and `item: { id: '<shop-b-item-id>', shop_id: 'shop-a', ... }`, `existing` is populated with **Shop B's item row**.
  - Lines 294–610 then execute against Shop B's item row:
    - Lines 460–513 compare `expected_is_available` against `Boolean(existing.is_available)` and return `409 STOCK_CONFLICT` (`Item availability was updated on another device`) when it differs.
    - Lines 534–608 compare `expected_stock_quantity` against `existing.stock_quantity` and return `409 STOCK_CONFLICT` (`Stock quantity was updated on another device`) when it differs.
    - Only when the guessed values match Shop B's item does execution reach `dbUpsertItem` (`line 617`), which finally rejects with `400 ITEM_NOT_IN_SHOP` (`src/lib/db.ts:953`).
  - This allows any authenticated user of Shop A to probe the availability and exact `stock_quantity` of items belonging to Shop B.
- **Supporting Call Path:**
  - `POST /api/catalog` (`src/app/api/catalog/route.ts:251`) -> `action === 'upsert_item'` (`line 270`) -> `getSupabaseDbClient().from('items').select('*').eq('id', String(incoming.id)).maybeSingle()` (`lines 280-284`) -> CAS checks on `existing.is_available` / `existing.stock_quantity` (`lines 460-608`, returning `409 STOCK_CONFLICT`) -> `dbUpsertItem` (`line 617` -> `src/lib/db.ts:950-954`).
- **Actionable Fix Direction:**
  - Immediately after loading `existingRow` at `src/app/api/catalog/route.ts:291`, check:
    ```ts
    if (existing && existing.shop_id !== targetShopId) {
      return NextResponse.json(
        { success: false, code: 'ITEM_NOT_IN_SHOP', error: 'Item does not belong to target shop' },
        { status: 400 },
      );
    }
    ```
    before calling `getCatalogItemUpdatePermissionOptions` or evaluating any CAS precondition.

---

### Finding 4 — [Medium / P2] `GET /api/orders?shopId=...` silently catches `dbGetShopCatalog(shopId)` DB errors and falls back to `SEED_ITEMS`, returning HTTP 200 with empty catalog items and falsified zero low-stock/out-of-stock stats

- **Severity:** Medium (P2 — Persistence / Error Handling / Financial & Inventory State Integrity)
- **Exact File & Lines:**
  - `src/app/api/orders/route.ts:294-314`
- **Concrete Failure Scenario:**
  - In `docs/CLAUDE_CODE_REVIEW_2026-10-27.md` (§198), `dbGetShopCatalog` (`src/lib/db.ts:681-728`) was updated to throw `SHOP_CATALOG_SHOP_QUERY_FAILED`, `SHOP_CATALOG_CATEGORIES_QUERY_FAILED`, or `SHOP_CATALOG_ITEMS_QUERY_FAILED` when a Supabase query fails so callers do not mistake a database outage for an empty catalog.
  - However, `GET /api/orders` (`src/app/api/orders/route.ts:294-303`) wraps `dbGetShopCatalog(shopId)` in a `try / catch` that swallows all errors and falls back to `SEED_ITEMS`:
    ```ts
    let catalogItems: Item[];
    try {
      const cat = await dbGetShopCatalog(shopId);
      catalogItems = cat.items;
    } catch {
      catalogItems = SEED_ITEMS.filter((i) => i.shop_id === shopId);
    }
    ```
  - For any real production shop (`shopId !== 'shop-1'`), `SEED_ITEMS.filter((i) => i.shop_id === shopId)` evaluates to `[]` (and for `shop-1` it returns hardcoded demo items).
  - Consequently, if the `items` or `categories` query fails transiently during `GET /api/orders`:
    1. `dbCalculateStats(shopId, catalogItems)` (`line 305`) computes `lowStockCount: 0`, `outOfStockCount: 0`, and `lowStockItems: []`.
    2. `GET /api/orders` returns HTTP `200` with `items: []` and falsified inventory stats (`lines 307-314`).
    3. Connected clients—such as the mobile live-order sync hook (`mobile/App.tsx:651`, which passes `onItemsSynced: setItems` to `useLiveOrderSync`)—overwrite the shop's in-memory catalog item list with `[]`.
- **Supporting Call Path:**
  - `GET /api/orders?shopId=<id>` (`src/app/api/orders/route.ts:212`) -> `dbGetShopCatalog(shopId)` throws `SHOP_CATALOG_ITEMS_QUERY_FAILED` (`src/lib/db.ts:716`) -> caught at `src/app/api/orders/route.ts:299` -> `catalogItems = []` -> `dbCalculateStats(shopId, [])` (`line 305`) -> `NextResponse.json({ orders, tables, stats, items: [] })` with HTTP `200` (`line 307`).
- **Actionable Fix Direction:**
  - In `src/app/api/orders/route.ts:294-303`, only fall back to `SEED_ITEMS` when `!isOrderDbConfigured()` in non-production environments; when `isOrderDbConfigured()` is `true` (or `isSupabaseConfigured` is `true`), let `dbGetShopCatalog(shopId)` errors propagate to the route's outer `catch` block (`line 315`) so `GET /api/orders` returns HTTP `500` instead of corrupting client catalog/inventory state.

---

### Finding 5 — [Medium / P2] Mobile `Workspace` (`mobile/App.tsx`) PostgREST fallback when `/api/shops?member=1` fails omits `shop_memberships` and restores full owner permissions for deactivated shop owners

- **Severity:** Medium (P2 — Authorization / Mobile Permission Fallback)
- **Exact File & Lines:**
  - `mobile/App.tsx:577-590` (`hasPerm`)
  - `mobile/App.tsx:799-833` (`loadShopsAndData`)
- **Concrete Failure Scenario:**
  - `AGENTS.md` states: *"Never report successful writes after DB failures or restore permissions from local fallback."*
  - On the server (`src/lib/server-auth.ts:938-950`, `src/lib/shop-permissions.ts`), a shop owner who has an explicit `shop_memberships` row with `is_active: false` (or restricted permissions) is denied access (`403`).
  - In `mobile/App.tsx:577-590`, the mobile permission helper `hasPerm` checks `activeMembership` first, and only falls back to `activeShop.owner_id === userId` when `activeMembership` is `null`:
    ```ts
    const hasPerm = useCallback(
      (action: PermissionAction): boolean => {
        if (!activeShop) return false;
        if (activeMembership) {
          if (activeMembership.shop_id !== activeShop.id || !activeMembership.is_active) {
            return false;
          }
          return hasPermission(activeMembership.role, action, activeMembership.permissions_override);
        }
        return activeShop.owner_id === userId;
      },
      [activeMembership, activeShop, userId]
    );
    ```
  - In `loadShopsAndData` (`mobile/App.tsx:799-824`), when `fetchApi('/api/shops?member=1')` throws (e.g., transient network/502 error) and `postgrestClient` is available (`lines 814-821`), the fallback queries `postgrestClient.from('shops').select('*').eq('owner_id', userId)` and populates `loadedShops`, **but never queries `shop_memberships`**, leaving `loadedMemberships` as `{}` (`activeMembership = null`).
  - As a result, `hasPerm` takes the `activeMembership === null` branch and returns `activeShop.owner_id === userId` (`true`), restoring every permission in the mobile UI for an owner whose `shop_memberships.is_active` is `false` or whose `permissions_override` restricts actions.
- **Supporting Call Path:**
  - `loadShopsAndData` (`mobile/App.tsx:796`) -> `fetchApi('/api/shops?member=1')` throws (`line 801`) -> `catch` branch runs `postgrestClient.from('shops').select('*').eq('owner_id', userId)` (`lines 813-819`) -> `setMembershipsByShopId({})` (`line 833`) -> `activeMembership` evaluates to `null` (`line 574`) -> `hasPerm(action)` returns `activeShop.owner_id === userId` (`line 587`).
- **Actionable Fix Direction:**
  - In the `postgrestClient` fallback inside `loadShopsAndData` (`mobile/App.tsx:814-824`), query `postgrestClient.from('shop_memberships').select('*').eq('user_id', userId)` alongside `shops`. If the `shop_memberships` query fails, fail closed (do not populate `loadedShops` with assumed owner permissions); otherwise populate `loadedMemberships` before calling `setMembershipsByShopId(loadedMemberships)`.

---

### Finding 6 — [Low / P3] Mobile owner session validator (`mobile/src/lib/owner-session.ts`) types and normalizes `plan` as `'free' | 'pro' | 'premium'`, silently downgrading `'basic'`-tier owners to `'free'`

- **Severity:** Low (P3 — Plan Tier Consistency / Mobile Session State)
- **Exact File & Lines:**
  - `mobile/src/lib/owner-session.ts:59-70` (`MobileOwnerProfile`)
  - `mobile/src/lib/owner-session.ts:1040-1045` (`validateOwnerSession`)
- **Concrete Failure Scenario:**
  - Across the server and shared types (`src/types/qlaok.ts:2`, `src/lib/plan-limits.ts:19`, `src/app/api/auth/route.ts:51-55`), Qlaok's canonical plan tiers are `'free' | 'basic' | 'premium'` (with legacy `'pro'` normalized to `'basic'`).
  - However, `MobileOwnerProfile` in `mobile/src/lib/owner-session.ts:65` still declares `plan: 'free' | 'pro' | 'premium'`, and `validateOwnerSession` (`mobile/src/lib/owner-session.ts:1040-1045`) normalizes incoming `rawUser.plan` as:
    ```ts
    const normalizedPlan: MobileOwnerProfile['plan'] =
      rawUser.plan === 'premium' || rawUser.plan === 'pro'
        ? rawUser.plan
        : 'free';
    ```
  - When a `'basic'`-tier owner signs in via Zitadel OIDC (`oidc_mobile_exchange`) or revalidates via `POST /api/auth` (`sync_user`), the server returns `user.plan = 'basic'`. `validateOwnerSession` rejects `'basic'` and persists `user.plan = 'free'` in `MobileOwnerSession`. (Note: `mobile/App.tsx:222` later fetches `ownerProfile` via `/api/shops?ownerId=...` and normalizes `'pro' -> 'basic'`, which masks the bug after shops finish loading, but any consumer reading `ownerSession.user.plan` directly sees `'free'`.)
- **Supporting Call Path:**
  - `exchangeZitadelCodeForMobileSession` / `revalidateMobileOwnerSessionWithServer` (`mobile/src/lib/owner-session.ts:436, 750`) -> `validateOwnerSession` (`line 1001`) -> `normalizedPlan` check (`lines 1040-1045`) -> `'basic'` coerced to `'free'`.
- **Actionable Fix Direction:**
  - Update `MobileOwnerProfile['plan']` in `mobile/src/lib/owner-session.ts:65` to `'free' | 'basic' | 'premium'` and normalize `rawUser.plan === 'premium' ? 'premium' : rawUser.plan === 'basic' || rawUser.plan === 'pro' ? 'basic' : 'free'` in `validateOwnerSession` (`lines 1040-1045`).

---

## 4. Needs Verification

The following observation was noted during inspection of `src/app/api/shops/route.ts` and `src/app/(marketing)/explore/page.tsx`, and requires product-intent confirmation before changing behavior beyond Finding 1:

1. **Unauthenticated `GET /api/shops` directory endpoint scope (`src/app/api/shops/route.ts:297-306`):**
   - Even after applying `toPublicStorefrontShop(shop)` (and stripping `wifi_info.password`) per Finding 1, `GET /api/shops` with no query parameters returns all published shops in the database to power `/explore` (`src/app/(marketing)/explore/page.tsx:33`).
   - Confirm whether `/explore` is intended to remain a public directory of all published shops (using a minimal directory projection such as `{ id, name, slug, description, logo_url, cover_url, address, phone, opening_hours, template }`) or whether shops should have an explicit opt-in flag for public directory listing separate from `is_published`.

---

## 5. Checks and Read-Only Commands Performed

All commands below were executed locally in read-only mode from `/Users/hoangvu96z/Documents/qlaok`:

| Command | Exit Code | Result Summary |
| --- | --- | --- |
| `codegraph status` | `0` | Index up to date (`331` files, `5,377` nodes, `20,253` edges, SQLite WAL). |
| `git status --short` | `0` | Clean working tree prior to writing this report; only `docs/CODEBASE_REVIEW_2026-11-02.md` present after report creation. |
| `git diff --check` | `0` | No whitespace or merge marker issues (`0` output). |
| `npm run typecheck` | `0` | `tsc --noEmit --incremental false` passed with `0` errors. |
| `npm run typecheck --prefix mobile` | `0` | `tsc --noEmit` in `mobile/` passed with `0` errors. |

No production APIs, external services, browsers, local databases (`.local-db`), or `.env*` files were accessed or modified.

---

## 6. CodeGraph Queries and Affected Areas

### CodeGraph Explore Queries
1. `codegraph explore "API route handlers authorization guards requireShopPermission requireShopOwnerOrAdmin requireSuperAdmin public projection"`
2. `codegraph explore "public API projections GET /api/shops GET /api/catalog GET /api/tables GET /api/posts GET /api/health toPublicCatalogItem toPublicStorefrontShop"`
3. `codegraph explore "plan enforcement getPlanLimits getAllowedLocalesForPlan canAddItem requireAiOcrPlan PATCH /api/shops POST /api/catalog"`
4. `codegraph explore "explore page /api/shops directory callers"`
5. `codegraph explore "src/app/(marketing)/explore/page.tsx /api/shops"`
6. `codegraph explore "saas-payment-webhook sepay-reconciliation order-pricing dbGetTableBill webhooks/payment"`
7. `codegraph explore "auth login-ui callback admin audit upload ai translate ocr-menu staff-accounts"`
8. `codegraph explore "tables floor-plan service-requests push-tokens analytics/track order-events"`
9. `codegraph explore "server-auth zitadel-oidc zitadel-login-ui shop-permissions shop-tables service-requests push-notifications"`
10. `codegraph explore "dashboard orders catalog settings billing reports posts kitchen qr-studio ai-scanner"`
11. `codegraph explore "storefront s/[slug] ShowToStaffModal onboarding admin/page.tsx"`
12. `codegraph explore "mobile App.tsx mobile/src/components mobile/src/lib oidc-auth staff-api live-order-sync"`
13. `codegraph explore "scripts agy-run run-local-db migrate-owner-accounts-to-zitadel"`
14. `codegraph explore "mobile plan basic pro premium SettingsTab CatalogTab OverviewTab"`

### CodeGraph Node Inspections (`codegraph node ...`)
- **Web API Routes:** `src/app/api/shops/route.ts`, `src/app/api/catalog/route.ts`, `src/app/api/posts/route.ts`, `src/app/api/health/route.ts`, `src/app/api/orders/route.ts`, `src/app/api/orders/audit/route.ts`, `src/app/api/orders/events/route.ts`, `src/app/api/webhooks/payment/route.ts`, `src/app/api/webhooks/sepay/route.ts`, `src/app/api/auth/route.ts`, `src/app/api/auth/login-ui/route.ts`, `src/app/api/auth/callback/route.ts`, `src/app/api/admin/route.ts`, `src/app/api/admin/audit/route.ts`, `src/app/api/upload/route.ts`, `src/app/api/ai/_lib/guard.ts`, `src/app/api/ai/translate/route.ts`, `src/app/api/ai/ocr-menu/route.ts`, `src/app/api/tables/route.ts`, `src/app/api/tables/floor-plan/route.ts`, `src/app/api/service-requests/route.ts`, `src/app/api/push-tokens/route.ts`, `src/app/api/analytics/track/route.ts`.
- **Core Libraries & Web UI:** `src/lib/db.ts` (`dbGetAllShopsAndProfile`, `dbUpdateShop`, `dbUpsertCategory`, `dbUpsertItem`, `dbBulkImportCatalog`, `dbGetStorefrontBundle`, `dbCompletePaymentWebhook`), `src/lib/mpos-store.ts` (`dbCreateOrder`, `dbUpdateOrderStatus`, `dbSettleTableBill`, `dbGetTableBill`), `src/lib/server-auth.ts`, `src/lib/saas-payment-webhook.ts`, `src/lib/sepay-reconciliation.ts`, `src/lib/order-pricing.ts`, `src/lib/staff-accounts.ts`, `src/lib/order-events.ts`, `src/app/(marketing)/explore/page.tsx`.
- **Mobile & Tests:** `mobile/App.tsx`, `mobile/src/lib/owner-session.ts`, `mobile/src/lib/supabase.ts`, `mobile/src/components/staff/StaffWorkspace.tsx`, `mobile/src/components/tabs/SettingsTab.tsx`, `mobile/src/components/tabs/CatalogTab.tsx`, `tests/catalog-dashboard-review.test.ts`, `tests/app-i18n-review.test.ts`, `tests/catalog-read-errors-review.test.ts`, `tests/sepay-webhook-review.test.ts`.
- **Unindexed Docs & SQL Migrations Read Directly:** `README.md`, `ARCHITECTURE.md`, `docs/CODEGRAPH_WORKFLOW.md`, `docs/CLAUDE_CODE_REVIEW_2026-10-27.md`, `supabase/migrations/20261029000100_bulk_set_items_availability_atomic.sql`, `supabase/migrations/20261030000100_order_audit_logs_subjects.sql`, `supabase/migrations/20261101000100_analytics_event_view_count_atomic.sql`, `supabase/migrations/20261102000100_revoke_trigger_function_execute.sql`, `supabase/migrations/20261102000200_admin_delete_owner_shop_atomic.sql`.

### Affected Areas for Subsequent Fix Groups
- **Web API Routes:** `src/app/api/shops/route.ts`, `src/app/api/catalog/route.ts`, `src/app/api/orders/route.ts`, `src/app/api/tables/route.ts`.
- **Shared Public Projection Helpers:** `src/lib/public-catalog.ts` (or `src/app/api/shops/route.ts` shared export).
- **Mobile Owner App:** `mobile/App.tsx`, `mobile/src/lib/owner-session.ts`.
- **Tests:** `tests/catalog-read-errors-review.test.ts` (or new targeted regression test file covering Findings #1–#6).

---

## 7. Limitations

1. **Static & Local Read-Only Scope:** Per task rules, this review was strictly read-only against the local repository and did not query live Supabase production tables, Zitadel instances, or SePay webhooks.
2. **CodeGraph Engine Notice:** `codegraph status` reported that the index is up to date (`331` files) and was built by an earlier CodeGraph version; per `docs/CODEGRAPH_WORKFLOW.md`, the index was used as-is without recreating or upgrading it.
3. **Fallback Model Attribution:** Because the local `claude` CLI failed with `[claude-code:unrecognized_model]` on its configured DeepSeek route, all findings in this report were produced by the authorized fallback model, **Gemini 4 Argon (High)**.

## 8. Local Remediation Follow-up — 2026-11-02

The original review above was read-only. A follow-up local worktree change addresses all six findings; this section records that remediation and its verification.

1. **Public projections:** `/api/shops` directory entries and anonymous `/api/catalog` shop responses now use explicit allowlists. Directory responses omit owner/contact-routing fields, Wi-Fi passwords, and internal theme settings. Single-shop storefront responses retain customer-facing checkout and shop details.
2. **Resource lookup authorization:** Catalog deletion authenticates before looking up item/category IDs, then checks active shop membership and `catalog.manage`. `record_print` authenticates before order lookup and hides cross-shop IDs. Table updates with an inferred shop return the same not-found response for inaccessible tables. Catalog lookup DB errors now return 500 instead of masquerading as missing rows.
3. **Cross-shop catalog state:** `upsert_item` requires active membership before reading an item and rejects foreign-shop items before stock/availability compare-and-swap checks.
4. **Order read integrity:** Configured Supabase catalog failures propagate as request errors; only local development with Supabase unconfigured uses the seed catalog. A route regression test covers the configured-DB failure path.
5. **Inactive owner membership:** Owner resolution and owner shop listing preserve explicit inactive rows. Membership query failures in the include-inactive path fail closed rather than synthesizing active owner access. The mobile PostgREST fallback loads memberships alongside owned shops and rejects either query failure.
6. **Mobile plan normalization:** Canonical `basic` remains `basic`; legacy `pro` is normalized to `basic`.

### Follow-up Verification

| Check | Result |
| --- | --- |
| `npm run test:review` | Passed: 493 tests, 0 failures |
| `npm test --prefix mobile` | Passed: 123 tests, 0 failures |
| Focused API, catalog projection, service request, and owner-membership tests | Passed: 39 tests, 0 failures; the configured catalog-read failure regression also passes in the full suite |
| `npm run typecheck` | Passed |
| `npm run typecheck --prefix mobile` | Passed |
| `npm run build` | Passed |
| Changed-file ESLint | 0 errors; one existing `@next/next/no-img-element` warning in Explore |
| `git diff --check` | Passed |

These changes were verified locally. No production API, database, migration, or Cloudflare configuration was modified during remediation.
