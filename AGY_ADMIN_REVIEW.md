# AGY Super Admin Review & Remediation (`AGY_ADMIN_REVIEW.md`)

## 1. Root Cause Analysis

### 1.1. Why `/admin` Rendered Sidebar & Header While Main Content Was Completely Blank
1. **Unconditional `kpis` Guard on Default Tab (`overview`)**:
   - In [`src/app/(admin)/admin/page.tsx`](file:///Users/hoangvu96z/Documents/qlaok/src/app/(admin)/admin/page.tsx), when a Super Admin profile was present in `localStorage` (`qlaok_auth_owner_v1`) or immediately after logging in via the Super Admin Gate, `adminUser` became truthy and the page rendered the Left Sidebar and Top Bar (`● Hệ thống Trực tuyến`), while `<main>` only rendered `{activeTab === 'overview' && kpis && (...)}`.
   - While `fetchAdminData()` was in-flight (`loading === true`, `data === null`) **or** whenever `GET /api/admin` failed with HTTP 500 (`data` remained `null`, `kpis === undefined`), `<main>` rendered nothing below the Top Bar—leaving the entire main viewport blank after the transient toast disappeared.
2. **Misleading Hardcoded Online Indicator**:
   - The Top Bar hardcoded `● Hệ thống Trực tuyến` (`bg-emerald-500/15 text-emerald-300`) regardless of whether `GET /api/admin` was still loading, had failed with HTTP 500, or had not yet connected to Supabase.
3. **Silent Session Expiry Transition (`401`/`403`)**:
   - When `GET /api/admin` returned `401` or `403` (e.g., stale `localStorage` profile without a valid signed session token/cookie), `fetchAdminData()` called `setAdminUser(null)` and `showToastMessage('error', ...)`, switching immediately to the Super Admin Login Gate (`!adminUser`), which **did not render `toast`** and **did not set `loginError`**, dropping the error message completely.
4. **Missing Empty States Across Tabs**:
   - When `GET /api/admin` succeeded with empty collections (`owners: []`, `shops: []`, `orders: []`, `transactions: []`, `langBreakdown: []`, `tableCounts: {}`), the Overview tables/cards and Tabs 2–6 rendered empty table shells without persistent empty-state explanations or retry actions.

### 1.2. Why `/api/admin` and `/api/auth` Failed or Silently Degraded After Strict RLS (`migrations 003–005`) & Production Secret Enforcement
1. **Service-Role Requirement Under Strict RLS (`003_security_rls_and_atomic_mpos.sql` – `005_p0_rls_privilege_hardening.sql`)**:
   - Migrations `003`–`005` revoked broad `anon`/`authenticated` access on `profiles`, `analytics_events`, `payment_transactions`, `orders`, and `shop_memberships`, restricting global reads and admin mutations to `service_role`.
   - [`getSupabaseDbClient()`](file:///Users/hoangvu96z/Documents/qlaok/src/lib/db.ts) silently fell back to `getSupabaseAnonKey()` (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`) when `SUPABASE_SERVICE_ROLE_KEY` was unset or misconfigured.
   - In [`src/app/api/admin/route.ts`](file:///Users/hoangvu96z/Documents/qlaok/src/app/api/admin/route.ts), `GET /api/admin` destructured `{ data: profilesData }` across all 7 tables while **ignoring `.error`** and defaulting `data || []`. Under an anon/publishable key or DB failure, RLS errors were silently turned into empty arrays or partial failures without surfacing the root cause.
   - In [`src/lib/auth-credentials.ts`](file:///Users/hoangvu96z/Documents/qlaok/src/lib/auth-credentials.ts), `ensureSuperAdminSeeded()` ignored `select` / `upsert` / `update` errors and returned a fabricated in-memory fallback profile when `profiles` writes were blocked by RLS.
2. **Unhandled Production `SESSION_SECRET` Exception**:
   - In [`src/lib/server-auth.ts`](file:///Users/hoangvu96z/Documents/qlaok/src/lib/server-auth.ts), `getSigningSecret()` throws in production when `SESSION_SECRET` (or fallback signing secret >= 16 chars) is missing. `requireAuthenticatedUser()` and `requireSuperAdmin()` called `verifyRequestUser(req)` without a `try/catch`, risking an unhandled exception instead of a structured JSON 500 response (`code: 'SERVER_AUTH_MISCONFIGURED'`).

### 1.3. Why Notification & Icon Colors Were Too Pale in Light and Dark Modes
1. [`ThemeToggle`](file:///Users/hoangvu96z/Documents/qlaok/src/components/ui/ThemeToggle.tsx) defaults to Light Mode (`'light'`), activating `html:not(.dark) .theme-surface-page` overrides in [`src/app/globals.css`](file:///Users/hoangvu96z/Documents/qlaok/src/app/globals.css).
2. In Light Mode, `.theme-surface-page .bg-slate-900` inverted the toast and card backgrounds to `#ffffff` (white), while:
   - `text-rose-200`, `text-rose-300` (`#fda4af`), and `text-rose-400` (`#fb7185`) had **no light-mode overrides**, yielding ~`1.8:1–1.95:1` contrast on white.
   - `text-sky-300`/`400` and `text-purple-300`/`400` (used on KPI icons and badges) had **no light-mode overrides**.
   - `text-amber-300`/`400` mapped to `#d97706` (`3.19:1` on white) and `text-emerald-300`/`400` mapped to `#059669` (`3.76:1` on white), both below the WCAG AA `4.5:1` threshold for small UI text and icons.

---

## 2. Concrete Changes Made

1. **[`src/lib/db.ts`](file:///Users/hoangvu96z/Documents/qlaok/src/lib/db.ts)**:
   - Added `hasSupabaseServiceRoleKey()` and `requireSupabaseServiceRoleClient(contextLabel)` to verify that `SUPABASE_SERVICE_ROLE_KEY` is present and is not a publishable key (`sb_publishable_*`), not identical to the anon key, and not a JWT with `role !== 'service_role'`.
   - Keyed `cachedAdminClient` by `${url}::${key}` (`cachedAdminClientKey`) so environment updates never reuse a stale anon client.
   - Added `setSupabaseDbClientForTests()` for deterministic unit/review testing without weakening production checks.
2. **[`src/lib/server-auth.ts`](file:///Users/hoangvu96z/Documents/qlaok/src/lib/server-auth.ts)**:
   - Exported `isServerSigningSecretConfigured()`.
   - Wrapped `verifyRequestUser(req)` inside `requireAuthenticatedUser()` and `requireSuperAdmin()` in `try/catch` to return a structured HTTP 500 JSON response (`code: 'SERVER_AUTH_MISCONFIGURED'`) if production signing secrets are missing.
3. **[`src/lib/auth-credentials.ts`](file:///Users/hoangvu96z/Documents/qlaok/src/lib/auth-credentials.ts) & [`src/app/api/auth/route.ts`](file:///Users/hoangvu96z/Documents/qlaok/src/app/api/auth/route.ts)**:
   - Updated `ensureSuperAdminSeeded()` to use `requireSupabaseServiceRoleClient()` and explicitly check `selectErr`, `upsertErr`, and `updateErr` instead of returning a fabricated profile on DB failure.
   - Updated `GET /api/auth` and `POST /api/auth` (`action === 'login'`) to check DB errors on `profiles` and `shops` queries and return explicit HTTP 500 errors rather than misleading 404s.
4. **[`src/app/api/admin/route.ts`](file:///Users/hoangvu96z/Documents/qlaok/src/app/api/admin/route.ts)**:
   - Enforced `requireSupabaseServiceRoleClient('Super Admin API (/api/admin)')` and `ensureSupabaseReadyAndSeeded()` in both `GET` and `POST`.
   - Checked `.error` on all 7 table queries in `GET /api/admin` (`profiles`, `shops`, `categories`, `items`, `posts`, `analytics_events`, `payment_transactions`), returning HTTP 500 (`code: 'ADMIN_DB_QUERY_FAILED'`) if any query fails.
   - Checked `.error` on all cascading deletes and `reseed_demo_data` upserts in `POST /api/admin`.
5. **[`src/app/globals.css`](file:///Users/hoangvu96z/Documents/qlaok/src/app/globals.css)**:
   - Added `color-scheme: light` / `color-scheme: dark`.
   - Upgraded `html:not(.dark) .theme-surface-page` semantic text, icon, border, and surface tint rules so all semantic hues meet WCAG AA contrast (`>= 4.5:1` on light surfaces):
     - Rose (`text-rose-200/300/400/500`): `#9f1239` / `#be123c` (`~6.3:1–8.2:1`) on `#ffe4e6` / `#fff1f2` tint surfaces.
     - Emerald (`text-emerald-200/300/400/500`): `#065f46` / `#047857` (`~5.48:1–7.3:1`) on `#d1fae5` / `#ecfdf5` tint surfaces.
     - Amber (`text-amber-200/300/400/500`): `#92400e` / `#b45309` (`~5.02:1–7.1:1`) on `#fef3c7` / `#fffbeb` tint surfaces.
     - Sky (`text-sky-200/300/400/500`): `#0369a1` (`~5.86:1`) on `#e0f2fe` tint surfaces.
     - Purple (`text-purple-200/300/400/500`): `#6d28d9` (`~6.42:1`) on `#f3e8ff` tint surfaces.
     - Neutral secondary (`text-slate-400/500`): `#475569` (`~7.58:1`).
6. **[`src/app/(admin)/admin/page.tsx`](file:///Users/hoangvu96z/Documents/qlaok/src/app/(admin)/admin/page.tsx)**:
   - Added persistent `loadError` state and safe JSON response parsing (`parseApiJson`).
   - Distinguished the Top Bar status badge (`data-testid="admin-api-status"`):
     - `● Đang đồng bộ API Quản trị...` while initial fetch is in-flight.
     - `● Lỗi kết nối API Quản trị` when `loadError` is present.
     - `● API Quản trị Trực tuyến` only when `data && !loadError && data.systemHealth?.supabaseConnected`.
   - Added a persistent **Error State Card** (`data-testid="admin-error-state"`, `role="alert"`) with actionable **`Thử tải lại dữ liệu`** (`onClick={fetchAdminData}`) and **`Đăng nhập lại`** buttons.
   - Added a persistent **Loading State Card** (`data-testid="admin-loading-state"`, `role="status"`) while `!data && loading`.
   - Added persistent **Empty States** with actionable retry (`Tải lại dữ liệu` / `Làm mới`) and filter-reset (`Xóa bộ lọc`) buttons across all 6 tabs (`overview`, `owners`, `shops`, `orders`, `billing`, `system`).
   - Preserved `401`/`403` session error messages into `loginError` and rendered `toast` on the Super Admin Login Gate.
   - Upgraded toast notification and KPI/section icons to high-contrast semantic badge containers in both light and dark modes.
7. **[`tests/admin-review.test.ts`](file:///Users/hoangvu96z/Documents/qlaok/tests/admin-review.test.ts)**:
   - Added regression tests covering `requireSupabaseServiceRoleClient`, missing production `SESSION_SECRET` handling in `requireSuperAdmin`/`requireAuthenticatedUser`, `/api/admin` auth & missing service-role rejection, `/api/admin` DB query error propagation, and `POST /api/auth` Super Admin profile DB error propagation.

---

## 3. Verification & Checks Run

All verification commands succeeded with zero errors:
- `npm run typecheck` (`tsc --noEmit --incremental false`) — **PASS**
- `npm run test:unit` (66 unit tests across 9 suites) — **PASS (66/66)**
- `npm run test:review` (22 review & RLS tests including `tests/admin-review.test.ts`) — **PASS (22/22)**
- `npm run test:sql` (PGlite isolated PostgreSQL migrations `001`–`005` + strict RLS boundaries) — **PASS (1/1)**

---

## 4. Remaining Uncertainties & Operational Notes

- **Production Environment Variables**: Because strict RLS (`migrations 003–005`) and production session signing are enforced without fake-data fallbacks, the production deployment **must** have:
  1. A valid `SUPABASE_SERVICE_ROLE_KEY` (with `service_role` privileges, not `sb_publishable_*` or `anon`).
  2. A configured `SESSION_SECRET` (at least 16 characters) and `SUPER_ADMIN_DEFAULT_PASSWORD` (or existing hashed Super Admin credential).
  If either is missing in production, `/admin` will now immediately display a persistent, high-contrast error card identifying the exact server configuration issue (`MISSING_SERVICE_ROLE_KEY` or `SERVER_AUTH_MISCONFIGURED`) with a retry action rather than rendering a blank page.

## Parent review and browser verification

- Reproduced the original blank main content with a loopback HTTP 500 fixture.
- Verified the persistent error card, accurate API status, retry recovery and empty
  dashboard on the actual Next UI through `tests/admin-ui-fixture.mjs`.
- Checked light/dark themes visually. Fixed an additional contrast defect: dark
  rose/emerald notification backgrounds were not adapted with their light-mode
  text tokens. Light-mode error panels and toasts now use light semantic surfaces.
- Kept destructive admin action branches at their prior implementation; expanded
  deletion/reseeding changes from AGY were outside this bug-fix scope.
- Added regression proving existing stored Super Admin password authenticates
  with a readable profile and leaves its scrypt hash unchanged.
- Production screenshot's old `404` message follows credential verification and
  an empty profile lookup. It does not by itself prove an account was deleted.
  Actual VPS service-role configuration and authenticated production login still
  require verification. No production account or password has been changed.

UI harness: run Next locally on 3101, then `node tests/admin-ui-fixture.mjs`.
Open `http://127.0.0.1:3100/admin` with fixture password `fixture-password`.
It intercepts auth/admin requests locally and never forwards API calls to a real
backend. First admin request returns 500; retry returns an empty valid dashboard.
Screenshots: `/tmp/qlaok-admin-ui/error-light.png`, `error-dark.png` and
`overview-light.png` (local fixtures, not production data).

## Follow-up Finding: Shared `cachedAdminClient` Session Contamination via `signInWithPassword` / `signUp`

- **Why the Super Admin Account Appeared Missing/Unusable (No Account Was Deleted)**:
  - In [`src/lib/db.ts`](file:///Users/hoangvu96z/Documents/qlaok/src/lib/db.ts), `getSupabaseDbClient()` caches a single module-level `cachedAdminClient` created with `SUPABASE_SERVICE_ROLE_KEY`.
  - In [`src/app/api/auth/route.ts`](file:///Users/hoangvu96z/Documents/qlaok/src/app/api/auth/route.ts), `sb.auth.signUp()` and `sb.auth.signInWithPassword()` were called directly on that shared `getSupabaseDbClient()` instance.
  - Even with `persistSession: false`, `@supabase/supabase-js` stores the signed-in user's session in memory (`currentSession`) on that client instance and `SupabaseClient._getSessionToken()` + `fetchWithAuth()` replaces `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` with `Authorization: Bearer <user_access_token>` (`role: authenticated`) on all subsequent `sb.from(...)` PostgREST queries.
  - Once any user signed in or registered via Supabase Auth, the shared `cachedAdminClient` executed subsequent `profiles` / `shops` / `/api/admin` queries under that user's `authenticated` JWT instead of `service_role`. Under strict RLS (`migrations 003–005`), `profiles` queries only return rows where `auth.uid() = id`, causing Super Admin profile lookups/seeding (`id = 'super-admin-001'`) and `/api/admin` queries to return empty results or RLS errors (`42501`), making the account appear deleted.
- **Fix Applied (`src/lib/db.ts` & `src/app/api/auth/route.ts`)**:
  - Added [`createSupabasePublicAuthClient()`](file:///Users/hoangvu96z/Documents/qlaok/src/lib/db.ts#L129-L154) in [`src/lib/db.ts`](file:///Users/hoangvu96z/Documents/qlaok/src/lib/db.ts), creating a fresh, uncached, non-persistent client (`persistSession: false`, `autoRefreshToken: false`, `detectSessionInUrl: false`) preferring `getSupabaseAnonKey()` (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
  - Hardened [`getSupabaseDbClient()`](file:///Users/hoangvu96z/Documents/qlaok/src/lib/db.ts#L73-L122) so `_getSessionToken` always returns `null` (keeping `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` intact on all PostgREST/Storage calls) and delegated `client.auth.signInWithPassword` / `client.auth.signUp` to `createSupabasePublicAuthClient()`.
  - Updated [`src/app/api/auth/route.ts`](file:///Users/hoangvu96z/Documents/qlaok/src/app/api/auth/route.ts) to call `createSupabasePublicAuthClient()` for `signUp`, `signInWithPassword`, and `getUser(supabaseAccessToken)` while leaving stored credentials untouched.
- **Verification**:
  - Added mocked-`fetch` regression in [`tests/admin-review.test.ts`](file:///Users/hoangvu96z/Documents/qlaok/tests/admin-review.test.ts#L326-L604) (no network calls) verifying that `/auth/v1/signup` and `/auth/v1/token` use the publishable/anon key while all subsequent `/rest/v1/*` queries during owner registration, owner password login, Super Admin login, and `GET /api/admin` retain `Authorization: Bearer <service_role_key>` (`7/7` tests passing in `tests/admin-review.test.ts`, `tsc --noEmit` passing).


Final review: removed AGY's monkey patches of private Supabase `_getSessionToken`
and `auth` methods. Public authentication now uses separate fresh clients through
supported SDK APIs; the database singleton is never used for password login or
signup. Mocked HTTP regression still passes and proves admin DB requests retain
the backend authorization after both login and signup. Final local validation:
typecheck, 24 review tests and production build passed. User confirmed the VPS
currently lacks a backend service-role/secret key; production recovery requires
adding it to the VPS application's environment before authenticated verification.
