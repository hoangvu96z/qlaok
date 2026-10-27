-- ============================================================================
-- QLAOK (Q-Smart) — Migration 021: Zitadel Identity Mapping & Self-Hosted Grants
--
-- 1. Adds nullable `zitadel_sub` column to `public.profiles` with strict format
--    and 1:1 uniqueness constraints (`profiles_zitadel_sub_format_check`,
--    `profiles_zitadel_sub_key`) so Zitadel subjects map deterministically to
--    existing Qlaok user IDs (`profiles.id`) without altering existing UUIDs
--    or any foreign-key / historical actor relationships.
-- 2. Extends `public.prevent_client_profile_plan_escalation()` to block direct
--    client mutations of `profiles.id` or `profiles.zitadel_sub` alongside
--    `plan` and `plan_expires_at`.
-- 3. Applies narrowly scoped schema, table, sequence, and helper-function
--    privileges for `anon`, `authenticated`, and `service_role` required on
--    vanilla PostgreSQL 14 while keeping all server-only tables revoked from
--    `PUBLIC`, `anon`, and `authenticated`.
-- ============================================================================

-- 1. Zitadel subject mapping column & constraints on public.profiles
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS zitadel_sub TEXT DEFAULT NULL;

ALTER TABLE public.profiles
    DROP CONSTRAINT IF EXISTS profiles_zitadel_sub_format_check;

ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_zitadel_sub_format_check
    CHECK (
        zitadel_sub IS NULL
        OR (
            btrim(zitadel_sub) <> ''
            AND zitadel_sub = btrim(zitadel_sub)
            AND length(zitadel_sub) <= 128
            AND zitadel_sub !~ '[[:space:][:cntrl:]]'
        )
    );

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'profiles_zitadel_sub_key'
          AND conrelid = 'public.profiles'::regclass
    ) THEN
        ALTER TABLE public.profiles
            ADD CONSTRAINT profiles_zitadel_sub_key UNIQUE (zitadel_sub);
    END IF;
END
$$;

-- 2. Prevent direct client-side mutation of profiles.id, plan, plan_expires_at, or zitadel_sub
CREATE OR REPLACE FUNCTION public.prevent_client_profile_plan_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF public.is_client_request_context() THEN
        IF TG_OP = 'INSERT' THEN
            IF NEW.zitadel_sub IS NOT NULL THEN
                RAISE EXCEPTION 'FORBIDDEN_ZITADEL_SUBJECT_MUTATION: Không được phép tự gán liên kết định danh Zitadel từ phía client.';
            END IF;
        ELSIF TG_OP = 'UPDATE' THEN
            IF NEW.id IS DISTINCT FROM OLD.id THEN
                RAISE EXCEPTION 'FORBIDDEN_PROFILE_ID_MUTATION: Không được phép thay đổi mã định danh người dùng từ phía client.';
            END IF;
            IF NEW.plan IS DISTINCT FROM OLD.plan OR NEW.plan_expires_at IS DISTINCT FROM OLD.plan_expires_at THEN
                RAISE EXCEPTION 'FORBIDDEN_PLAN_MUTATION: Không được phép tự thay đổi gói cước từ phía client.';
            END IF;
            IF NEW.zitadel_sub IS DISTINCT FROM OLD.zitadel_sub THEN
                RAISE EXCEPTION 'FORBIDDEN_ZITADEL_SUBJECT_MUTATION: Không được phép tự thay đổi liên kết định danh Zitadel từ phía client.';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_profile_plan_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_profile_plan_escalation
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_client_profile_plan_escalation();

-- 3. Narrowly required schema, function, sequence, and table grants for PostgreSQL 14
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
        EXECUTE 'GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role';
        IF EXISTS (
            SELECT 1
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'auth'
              AND p.proname = 'uid'
              AND p.pronargs = 0
        ) THEN
            EXECUTE 'GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role';
        END IF;
    END IF;
END
$$;

GRANT EXECUTE ON FUNCTION public.is_client_request_context() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_is_shop_owner(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_has_shop_permission(TEXT, TEXT) TO anon, authenticated, service_role;

-- 3.1 Revoke all default/inherited client privileges first (fail-closed baseline)
REVOKE ALL ON TABLE
    public.schema_migrations,
    public.payment_bank_ref_conflicts,
    public.mobile_push_tokens,
    public.shop_sepay_configs,
    public.sepay_webhook_events,
    public.shop_staff_credentials,
    public.staff_login_rate_limits,
    public.provinces,
    public.profiles,
    public.shops,
    public.shop_slug_aliases,
    public.categories,
    public.items,
    public.posts,
    public.analytics_events,
    public.payment_transactions,
    public.shop_tables,
    public.orders,
    public.order_audit_logs,
    public.table_service_requests,
    public.shop_memberships
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON SEQUENCE public.analytics_events_id_seq FROM PUBLIC, anon, authenticated;

-- 3.2 Narrow grants for `anon` (storefront reads + published shop analytics insert; governed by RLS)
GRANT SELECT ON TABLE
    public.provinces,
    public.shops,
    public.shop_slug_aliases,
    public.categories,
    public.items,
    public.posts,
    public.shop_tables,
    public.orders
TO anon;

GRANT INSERT ON TABLE public.analytics_events TO anon;
GRANT USAGE, SELECT ON SEQUENCE public.analytics_events_id_seq TO anon;

-- 3.3 Narrow grants for `authenticated` (strictly governed by RLS policies and boundary triggers)
GRANT SELECT ON TABLE
    public.provinces,
    public.profiles,
    public.shops,
    public.shop_slug_aliases,
    public.categories,
    public.items,
    public.posts,
    public.analytics_events,
    public.payment_transactions,
    public.shop_tables,
    public.orders,
    public.order_audit_logs,
    public.table_service_requests,
    public.shop_memberships
TO authenticated;

GRANT INSERT ON TABLE
    public.shops,
    public.categories,
    public.items,
    public.posts,
    public.analytics_events,
    public.shop_tables,
    public.shop_memberships
TO authenticated;

GRANT UPDATE ON TABLE
    public.profiles,
    public.shops,
    public.categories,
    public.items,
    public.posts,
    public.shop_tables,
    public.orders,
    public.shop_memberships
TO authenticated;

GRANT DELETE ON TABLE
    public.shops,
    public.categories,
    public.items,
    public.posts,
    public.shop_tables,
    public.shop_memberships
TO authenticated;

GRANT USAGE, SELECT ON SEQUENCE public.analytics_events_id_seq TO authenticated;

-- 3.4 Grants for trusted backend `service_role`
GRANT SELECT ON TABLE
    public.schema_migrations,
    public.payment_bank_ref_conflicts
TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    public.provinces,
    public.profiles,
    public.shops,
    public.shop_slug_aliases,
    public.categories,
    public.items,
    public.posts,
    public.analytics_events,
    public.payment_transactions,
    public.shop_tables,
    public.orders,
    public.order_audit_logs,
    public.table_service_requests,
    public.shop_memberships,
    public.mobile_push_tokens,
    public.shop_sepay_configs,
    public.sepay_webhook_events,
    public.shop_staff_credentials,
    public.staff_login_rate_limits
TO service_role;

GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.analytics_events_id_seq TO service_role;
