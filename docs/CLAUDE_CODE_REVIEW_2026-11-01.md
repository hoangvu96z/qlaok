# Focused authentication review — 2026-11-01

## Scope

Read-only Claude CLI review of `verifyRequestUser` (`src/lib/server-auth.ts:524-629`) and `requireShopPermission` (`:788-889`), followed by Codex verification of the related token, membership, permission, and profile-schema paths. This supplements the open findings in `docs/CLAUDE_CODE_REVIEW_2026-10-27.md`; it does not claim to complete that repository-wide review.

Claude found no new confirmed exploit in the two requested function ranges. It raised several out-of-range questions; Codex traced the relevant helpers and callers with CodeGraph before resolving them below.

## Results

### Authentication and authorization checks

- HMAC session verification requires an expiry and normalizes roles. Production HMAC sessions are shop-scoped staff sessions and are checked against active shop membership. Demo owner HMAC sessions are non-production and require the explicit demo environment gate.
- Zitadel JWT validation checks `exp` and `nbf` in `src/lib/zitadel-oidc.ts:1012-1030`. PostgREST JWT validation checks expiry in `src/lib/server-auth.ts:265-269`.
- Staff account lookup is scoped to the requested shop and checks active status, shop, role, username, and session version in `src/lib/staff-accounts.ts:2157-2225`.
- Order PATCH does not pass an empty permission requirement: `src/app/api/orders/route.ts:1017` adds `orders.fulfill` when the derived set is empty. Other callers pass named permissions such as `orders.view`, `reports.view`, or `settings.manage`.
- `requireSuperAdmin` requires both the admin role and an allowlisted email.

No new confirmed authorization bypass was found in these paths. The initial Claude uncertainty about expiry, shop membership, and empty permissions is resolved by the helper and caller checks above.

### Profile-role escalation hypothesis: false positive for repository schema

An earlier Claude pass reported that an owner could update `profiles.role` and `profiles.is_admin` through PostgREST, then receive admin access. That Critical verdict is withdrawn: the repository schema does not define either column.

- `supabase/migrations/001_init_qlaok.sql:78-87` defines `profiles` with `id`, `email`, `phone`, `full_name`, `plan`, `plan_expires_at`, `created_at`, and `updated_at` only.
- Repository migration search found no later migration adding `profiles.role` or `profiles.is_admin`.
- `tests/billing-ai-review.test.ts:1773-1832` documents the same schema and asserts that profile projections containing those columns are rejected.
- With this schema, a PATCH containing an unknown profile column fails schema validation (`PGRST204`) before SQL executes; the request cannot partially update the remaining field.

This is a repository-schema conclusion, not a live production schema verification. Supabase MCP was unavailable during this review, so out-of-band production schema drift remains unverified.

## Handoff

- CodeGraph areas queried: `verifyRequestUser`, `requireShopPermission`, token issuance/verification, active staff membership, orders permission callers, and profile/admin callers.
- Affected source areas: none; this review produced no source changes.
- Checks: Claude CLI smoke invocation returned `OK` with exit code `0`; Codex ran `git diff --check` and a trailing-whitespace scan. The AGY runner log shows `npm run test:sql` passed during its plan-mode audit, but no test counts were captured or independently checked.
- AGY: Gemini 4 Argon Medium run `2026-10-31T20-24-19-508Z-77c637a0` completed CodeGraph exploration and read-only schema tracing, then repeated tool reads instead of producing a final handoff. Codex stopped it (exit `130`); its partial work is not counted as an independent verdict.
- Remaining limitation: live production schema was not queried. Continue reviewing and resolving the open findings in `docs/CLAUDE_CODE_REVIEW_2026-10-27.md`.
