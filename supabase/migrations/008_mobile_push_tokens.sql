-- ============================================================================
-- QLAOK (Q-Smart) — Migration 008: Mobile Push Notification Tokens & Order Push Dispatch
-- 1. Adds public.mobile_push_tokens scoped to (user_id, shop_id, expo_push_token)
--    with locale, platform, device metadata, and timestamps
-- 2. Enforces strict RLS and client boundary trigger so direct anon/authenticated
--    client reads and mutations are rejected; only server/service_role accesses tokens
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mobile_push_tokens (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    user_id TEXT NOT NULL,
    shop_id TEXT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    expo_push_token TEXT NOT NULL,
    locale VARCHAR(8) NOT NULL DEFAULT 'vi' CHECK (locale IN ('vi', 'en')),
    platform VARCHAR(16) NOT NULL DEFAULT 'unknown' CHECK (platform IN ('ios', 'android', 'web', 'unknown')),
    device_name TEXT DEFAULT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT mobile_push_tokens_token_format_check CHECK (
        expo_push_token ~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_.-]+\]$'
    ),
    UNIQUE (user_id, shop_id, expo_push_token)
);

CREATE INDEX IF NOT EXISTS idx_mobile_push_tokens_shop_active
    ON public.mobile_push_tokens (shop_id, is_active)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_mobile_push_tokens_user_shop
    ON public.mobile_push_tokens (user_id, shop_id);

CREATE INDEX IF NOT EXISTS idx_mobile_push_tokens_token
    ON public.mobile_push_tokens (expo_push_token);

ALTER TABLE public.mobile_push_tokens ENABLE ROW LEVEL SECURITY;

-- Drop any pre-existing policies to guarantee server-only access
DROP POLICY IF EXISTS "mobile_push_tokens_select" ON public.mobile_push_tokens;
DROP POLICY IF EXISTS "mobile_push_tokens_insert" ON public.mobile_push_tokens;
DROP POLICY IF EXISTS "mobile_push_tokens_update" ON public.mobile_push_tokens;
DROP POLICY IF EXISTS "mobile_push_tokens_delete" ON public.mobile_push_tokens;
DROP POLICY IF EXISTS "mobile_push_tokens_service_only" ON public.mobile_push_tokens;

-- Restrictive RLS: client requests (anon/authenticated) are denied SELECT/INSERT/UPDATE/DELETE.
-- Server backend using service_role bypasses RLS (or passes NOT is_client_request_context()).
CREATE POLICY "mobile_push_tokens_service_only"
ON public.mobile_push_tokens
AS RESTRICTIVE
FOR ALL
USING (NOT public.is_client_request_context())
WITH CHECK (NOT public.is_client_request_context());

CREATE OR REPLACE FUNCTION public.enforce_mobile_push_tokens_boundaries()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF public.is_client_request_context() THEN
        RAISE EXCEPTION 'FORBIDDEN_PUSH_TOKEN_DIRECT_ACCESS: Push tokens chỉ được quản lý qua máy chủ API đã xác thực.';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    NEW.user_id := BTRIM(COALESCE(NEW.user_id, ''));
    NEW.shop_id := BTRIM(COALESCE(NEW.shop_id, ''));
    NEW.expo_push_token := BTRIM(COALESCE(NEW.expo_push_token, ''));
    NEW.locale := CASE
        WHEN LOWER(BTRIM(COALESCE(NEW.locale, ''))) LIKE 'en%' THEN 'en'
        ELSE 'vi'
    END;
    NEW.platform := CASE
        WHEN LOWER(BTRIM(COALESCE(NEW.platform, ''))) IN ('ios', 'android', 'web')
            THEN LOWER(BTRIM(NEW.platform))
        ELSE 'unknown'
    END;

    IF NEW.user_id = '' OR NEW.shop_id = '' OR NEW.expo_push_token = '' THEN
        RAISE EXCEPTION 'INVALID_PUSH_TOKEN_FIELDS: Thiếu user_id, shop_id hoặc expo_push_token.';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        NEW.updated_at := NOW();
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_mobile_push_tokens_boundaries ON public.mobile_push_tokens;
CREATE TRIGGER trg_enforce_mobile_push_tokens_boundaries
BEFORE INSERT OR UPDATE OR DELETE ON public.mobile_push_tokens
FOR EACH ROW EXECUTE FUNCTION public.enforce_mobile_push_tokens_boundaries();

-- Revoke direct table privileges from public/anon/authenticated; grant only to service_role
REVOKE ALL ON TABLE public.mobile_push_tokens FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mobile_push_tokens TO service_role;
