-- =========================================================================
-- QLAOK MIGRATION 009: TABLE SERVICE REQUESTS (CALL STAFF & REQUEST BILL)
-- =========================================================================
-- Persists guest service requests ("call_staff", "request_bill") initiated
-- from a verified managed-table QR menu.
-- Enforces strict RLS + trigger boundaries:
--   1. Only authenticated staff with `orders.view` (or shop owner) can SELECT
--      service requests for their shop (and receive Supabase Realtime events).
--   2. Direct PostgREST client INSERT/UPDATE/DELETE by anon/authenticated roles
--      is blocked; all writes go through the trusted server API after verifying
--      HMAC table QR proof (`POST`) or shop staff permissions (`PATCH`).
--   3. Status lifecycle is strictly monotonic:
--      pending -> acknowledged -> resolved (or pending -> resolved).
--   4. Service requests never mutate order payment_status or financial fields.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.table_service_requests (
  id TEXT PRIMARY KEY DEFAULT 'srv-' || substr(md5(random()::text), 1, 10),
  shop_id TEXT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  table_id TEXT NOT NULL REFERENCES public.shop_tables(id) ON DELETE CASCADE,
  table_code TEXT NOT NULL CHECK (btrim(table_code) <> ''),
  table_label TEXT NOT NULL CHECK (btrim(table_label) <> ''),
  request_type TEXT NOT NULL CHECK (request_type IN ('call_staff', 'request_bill')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'acknowledged', 'resolved')),
  visitor_lang TEXT NOT NULL DEFAULT 'vi' CHECK (visitor_lang IN ('vi', 'en', 'ko', 'ja', 'zh', 'es', 'it', 'ru')),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_table_service_requests_shop_status_created
  ON public.table_service_requests(shop_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_table_service_requests_table_type_created
  ON public.table_service_requests(shop_id, table_id, request_type, created_at DESC);

ALTER TABLE public.table_service_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff view shop service requests" ON public.table_service_requests;
CREATE POLICY "Staff view shop service requests" ON public.table_service_requests
  FOR SELECT
  TO authenticated
  USING (
    public.user_has_shop_permission(shop_id, 'orders.view')
    OR public.user_is_shop_owner(shop_id)
  );

REVOKE INSERT, UPDATE, DELETE ON public.table_service_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.table_service_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.table_service_requests TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_table_service_request_boundaries()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_table public.shop_tables%ROWTYPE;
BEGIN
  IF public.is_client_request_context() THEN
    RAISE EXCEPTION 'Direct client mutations on table_service_requests are not permitted. Use the server API.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_table
    FROM public.shop_tables
    WHERE id = NEW.table_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'INVALID_SHOP_TABLE: Table % does not exist.', NEW.table_id;
    END IF;

    IF v_table.shop_id IS DISTINCT FROM NEW.shop_id THEN
      RAISE EXCEPTION 'INVALID_TABLE_SHOP: Table % does not belong to shop %.', NEW.table_id, NEW.shop_id;
    END IF;

    IF NOT v_table.is_active OR v_table.is_archived THEN
      RAISE EXCEPTION 'INACTIVE_SHOP_TABLE: Table % is inactive or archived.', NEW.table_id;
    END IF;

    NEW.table_code := v_table.table_code;
    NEW.table_label := v_table.name;

    IF NEW.status = 'acknowledged' AND NEW.acknowledged_at IS NULL THEN
      NEW.acknowledged_at := now();
    ELSIF NEW.status = 'resolved' THEN
      IF NEW.acknowledged_at IS NULL THEN
        NEW.acknowledged_at := now();
      END IF;
      IF NEW.resolved_at IS NULL THEN
        NEW.resolved_at := now();
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.shop_id IS DISTINCT FROM OLD.shop_id
       OR NEW.table_id IS DISTINCT FROM OLD.table_id
       OR NEW.table_code IS DISTINCT FROM OLD.table_code
       OR NEW.table_label IS DISTINCT FROM OLD.table_label
       OR NEW.request_type IS DISTINCT FROM OLD.request_type
       OR NEW.visitor_lang IS DISTINCT FROM OLD.visitor_lang
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Immutable columns on table_service_requests cannot be modified.';
    END IF;

    IF OLD.status = 'resolved' AND NEW.status IS DISTINCT FROM 'resolved' THEN
      RAISE EXCEPTION 'INVALID_SERVICE_REQUEST_TRANSITION: Resolved service requests cannot transition back to %.', NEW.status;
    END IF;

    IF OLD.status = 'acknowledged' AND NEW.status = 'pending' THEN
      RAISE EXCEPTION 'INVALID_SERVICE_REQUEST_TRANSITION: Acknowledged service requests cannot transition back to pending.';
    END IF;

    IF NEW.status = 'acknowledged' AND NEW.acknowledged_at IS NULL THEN
      NEW.acknowledged_at := COALESCE(OLD.acknowledged_at, now());
    END IF;

    IF NEW.status = 'resolved' THEN
      NEW.acknowledged_at := COALESCE(NEW.acknowledged_at, OLD.acknowledged_at, now());
      NEW.acknowledged_by := COALESCE(NEW.acknowledged_by, OLD.acknowledged_by, NEW.resolved_by);
      IF NEW.resolved_at IS NULL THEN
        NEW.resolved_at := COALESCE(OLD.resolved_at, now());
      END IF;
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_table_service_request_boundaries ON public.table_service_requests;
CREATE TRIGGER trg_enforce_table_service_request_boundaries
  BEFORE INSERT OR UPDATE OR DELETE ON public.table_service_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_table_service_request_boundaries();

CREATE OR REPLACE FUNCTION public.create_table_service_request_atomic(
  p_request jsonb,
  p_cooldown_ms integer DEFAULT 60000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id text;
  v_shop_id text;
  v_table_id text;
  v_request_type text;
  v_visitor_lang text;
  v_created_at timestamptz;
  v_updated_at timestamptz;
  v_cooldown_ms integer;
  v_table public.shop_tables%ROWTYPE;
  v_existing public.table_service_requests%ROWTYPE;
  v_inserted public.table_service_requests%ROWTYPE;
BEGIN
  IF public.is_client_request_context() THEN
    RAISE EXCEPTION 'Direct client execution of create_table_service_request_atomic is not permitted.';
  END IF;

  IF p_request IS NULL OR jsonb_typeof(p_request) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_SERVICE_REQUEST_PAYLOAD: Request payload must be a JSON object.';
  END IF;

  v_id := COALESCE(NULLIF(btrim(p_request->>'id'), ''), 'srv-' || substr(md5(random()::text), 1, 10));
  v_shop_id := COALESCE(btrim(p_request->>'shop_id'), '');
  v_table_id := COALESCE(btrim(p_request->>'table_id'), '');
  v_request_type := COALESCE(btrim(p_request->>'request_type'), '');
  v_visitor_lang := COALESCE(NULLIF(btrim(p_request->>'visitor_lang'), ''), 'vi');
  IF v_visitor_lang NOT IN ('vi', 'en', 'ko', 'ja', 'zh', 'es', 'it', 'ru') THEN
    v_visitor_lang := 'vi';
  END IF;
  v_created_at := COALESCE(NULLIF(btrim(p_request->>'created_at'), '')::timestamptz, now());
  v_updated_at := COALESCE(NULLIF(btrim(p_request->>'updated_at'), '')::timestamptz, v_created_at);
  v_cooldown_ms := GREATEST(COALESCE(p_cooldown_ms, 60000), 0);

  IF v_shop_id = '' OR v_table_id = '' THEN
    RAISE EXCEPTION 'INVALID_SHOP_TABLE: shop_id and table_id are required.';
  END IF;

  IF v_request_type NOT IN ('call_staff', 'request_bill') THEN
    RAISE EXCEPTION 'INVALID_SERVICE_REQUEST_TYPE: Invalid service request type %.', v_request_type;
  END IF;

  -- Serialize concurrent requests for the same managed table at the DB transaction boundary
  SELECT * INTO v_table
  FROM public.shop_tables
  WHERE id = v_table_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_SHOP_TABLE: Table % does not exist.', v_table_id;
  END IF;

  IF v_table.shop_id IS DISTINCT FROM v_shop_id THEN
    RAISE EXCEPTION 'INVALID_TABLE_SHOP: Table % does not belong to shop %.', v_table_id, v_shop_id;
  END IF;

  IF NOT v_table.is_active OR v_table.is_archived THEN
    RAISE EXCEPTION 'INACTIVE_SHOP_TABLE: Table % is inactive or archived.', v_table_id;
  END IF;

  IF v_cooldown_ms > 0 THEN
    SELECT * INTO v_existing
    FROM public.table_service_requests
    WHERE shop_id = v_shop_id
      AND table_id = v_table_id
      AND request_type = v_request_type
      AND status IN ('pending', 'acknowledged')
      AND created_at >= (v_created_at - (v_cooldown_ms::text || ' milliseconds')::interval)
      AND created_at <= (v_created_at + (v_cooldown_ms::text || ' milliseconds')::interval)
    ORDER BY created_at DESC, id DESC
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'service_request', to_jsonb(v_existing),
        'deduplicated', true
      );
    END IF;
  END IF;

  INSERT INTO public.table_service_requests (
    id,
    shop_id,
    table_id,
    table_code,
    table_label,
    request_type,
    status,
    visitor_lang,
    created_at,
    updated_at
  )
  VALUES (
    v_id,
    v_shop_id,
    v_table_id,
    v_table.table_code,
    v_table.name,
    v_request_type,
    'pending',
    v_visitor_lang,
    v_created_at,
    v_updated_at
  )
  RETURNING * INTO v_inserted;

  RETURN jsonb_build_object(
    'service_request', to_jsonb(v_inserted),
    'deduplicated', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_table_service_request_atomic(jsonb, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_table_service_request_atomic(jsonb, integer) TO service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'table_service_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.table_service_requests;
  END IF;
END;
$$;
