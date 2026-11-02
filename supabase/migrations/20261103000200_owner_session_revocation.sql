-- Bind owner/admin HMAC sessions to a server-side generation so logout can
-- revoke every previously issued session for one profile immediately.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_session_version_positive;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_session_version_positive
  CHECK (session_version >= 1);

CREATE OR REPLACE FUNCTION public.prevent_client_owner_session_version_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF public.is_client_request_context() THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.session_version IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'FORBIDDEN_OWNER_SESSION_VERSION_MUTATION: Không được phép tự thay đổi phiên đăng nhập từ phía client.';
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.session_version IS DISTINCT FROM OLD.session_version THEN
        RAISE EXCEPTION 'FORBIDDEN_OWNER_SESSION_VERSION_MUTATION: Không được phép tự thay đổi phiên đăng nhập từ phía client.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.prevent_client_owner_session_version_mutation() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prevent_client_owner_session_version_mutation()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_client_owner_session_version_mutation()
  TO service_role;

DROP TRIGGER IF EXISTS trg_prevent_client_owner_session_version_mutation
  ON public.profiles;
CREATE TRIGGER trg_prevent_client_owner_session_version_mutation
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_client_owner_session_version_mutation();

CREATE OR REPLACE FUNCTION public.revoke_owner_session(
  p_profile_id TEXT,
  p_expected_version INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_next_version INTEGER;
BEGIN
  UPDATE public.profiles
  SET session_version = session_version + 1
  WHERE id = p_profile_id
    AND session_version = p_expected_version
  RETURNING session_version INTO v_next_version;

  RETURN v_next_version;
END;
$function$;

ALTER FUNCTION public.revoke_owner_session(TEXT, INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.revoke_owner_session(TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_owner_session(TEXT, INTEGER)
  TO service_role;

-- PostgREST requests can bypass the Qlaok API, so bind every authenticated RLS
-- policy to the same profile generation used by server-issued JWTs. Missing
-- `sv` remains generation 1 for already-issued tokens and is revoked by bumping
-- the profile row.
CREATE OR REPLACE FUNCTION public.is_current_owner_session()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = auth.uid()::TEXT
      AND profile.session_version = CASE
        WHEN auth.jwt() ->> 'sv' IS NULL THEN 1
        WHEN auth.jwt() ->> 'sv' ~ '^[1-9][0-9]{0,9}$' THEN
          CASE
            WHEN (auth.jwt() ->> 'sv')::BIGINT <= 2147483647
              THEN (auth.jwt() ->> 'sv')::INTEGER
            ELSE NULL
          END
        ELSE NULL
      END
  );
$function$;

ALTER FUNCTION public.is_current_owner_session() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_current_owner_session()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_current_owner_session()
  TO authenticated, service_role;

-- Restrictive policies are ANDed with each table's existing permissive policy,
-- so an authenticated JWT with an old `sv` cannot use direct Supabase access.
DO $owner_session_rls$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'analytics_events',
    'categories',
    'items',
    'mobile_push_tokens',
    'order_audit_logs',
    'orders',
    'payment_transactions',
    'posts',
    'profiles',
    'provinces',
    'sepay_webhook_events',
    'shop_memberships',
    'shop_sepay_configs',
    'shop_slug_aliases',
    'shop_staff_credentials',
    'shop_tables',
    'shops',
    'staff_login_rate_limits'
  ] LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      'require_current_owner_session',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.is_current_owner_session()) WITH CHECK (public.is_current_owner_session())',
      'require_current_owner_session',
      table_name
    );
  END LOOP;
END;
$owner_session_rls$;
