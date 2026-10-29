-- ============================================================================
-- Migration 20261030000100: Order Audit Logs Subject Semantics & Boundaries
--
-- Fixes P2-12 order audit persistence and subject integrity:
-- 1. Extends public.order_audit_logs in-place to support both:
--      - subject_type = 'order' (order_id -> public.orders(id) ON DELETE CASCADE)
--      - subject_type = 'service_request' (service_request_id ->
--        public.table_service_requests(id) ON DELETE CASCADE)
-- 2. Adds structured details JSONB for operational context (e.g. table bill
--    settlement metadata, print counts, SePay webhook metadata).
-- 3. Forbids comma-joined order IDs and mismatched subject/FK combinations via
--    order_audit_logs_subject_check.
-- 4. Enforces server-only append semantics and cross-shop subject integrity via
--    public.enforce_order_audit_logs_boundaries():
--      - Rejects direct client (anon/authenticated) INSERT/UPDATE/DELETE even if
--        broad table grants are present.
--      - Rejects UPDATE mutations so audit rows are immutable once written.
--      - Normalizes legacy order-only inserts (such as migration 011 SePay RPC)
--        so subject_type='order' and subject_id=order_id are populated
--        automatically before CHECK constraints evaluate.
--      - Verifies the target order or service request belongs to NEW.shop_id.
-- 5. Preserves strict RLS on public.order_audit_logs (SELECT requires
--    public.user_has_shop_permission(shop_id, 'reports.view')).
-- ============================================================================

ALTER TABLE public.order_audit_logs
  ADD COLUMN IF NOT EXISTS subject_type VARCHAR(32) NOT NULL DEFAULT 'order';

ALTER TABLE public.order_audit_logs
  ADD COLUMN IF NOT EXISTS subject_id TEXT;

ALTER TABLE public.order_audit_logs
  ADD COLUMN IF NOT EXISTS service_request_id TEXT REFERENCES public.table_service_requests(id) ON DELETE CASCADE;

ALTER TABLE public.order_audit_logs
  ADD COLUMN IF NOT EXISTS details JSONB DEFAULT NULL;

ALTER TABLE public.order_audit_logs
  ALTER COLUMN order_id DROP NOT NULL;

UPDATE public.order_audit_logs
SET
  subject_type = COALESCE(NULLIF(BTRIM(subject_type), ''), 'order'),
  subject_id = COALESCE(NULLIF(BTRIM(subject_id), ''), order_id)
WHERE subject_id IS NULL
  AND order_id IS NOT NULL;

ALTER TABLE public.order_audit_logs
  ALTER COLUMN subject_id SET NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_order_audit_logs_boundaries()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.is_client_request_context() THEN
    RAISE EXCEPTION 'FORBIDDEN_ORDER_AUDIT_DIRECT_MUTATION: Direct client mutations on order_audit_logs are forbidden.';
  END IF;

  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'IMMUTABLE_ORDER_AUDIT_LOG: Audit log records cannot be truncated.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'IMMUTABLE_ORDER_AUDIT_LOG: Audit log records are append-only and cannot be updated.';
  END IF;

  NEW.shop_id := BTRIM(COALESCE(NEW.shop_id, ''));
  IF NEW.shop_id = '' THEN
    RAISE EXCEPTION 'INVALID_ORDER_AUDIT_SHOP_ID: shop_id is required.';
  END IF;

  NEW.order_id := NULLIF(BTRIM(COALESCE(NEW.order_id, '')), '');
  NEW.service_request_id := NULLIF(BTRIM(COALESCE(NEW.service_request_id, '')), '');
  NEW.subject_type := LOWER(BTRIM(COALESCE(NEW.subject_type, '')));
  NEW.subject_id := NULLIF(BTRIM(COALESCE(NEW.subject_id, '')), '');

  IF NEW.service_request_id IS NOT NULL
     AND NEW.order_id IS NULL
     AND (NEW.subject_type = '' OR NEW.subject_type = 'order') THEN
    NEW.subject_type := 'service_request';
  ELSIF NEW.subject_type = '' THEN
    NEW.subject_type := 'order';
  END IF;

  IF NEW.subject_type = 'order' THEN
    IF NEW.order_id IS NULL AND NEW.subject_id IS NOT NULL THEN
      NEW.order_id := NEW.subject_id;
    END IF;
    IF NEW.subject_id IS NULL AND NEW.order_id IS NOT NULL THEN
      NEW.subject_id := NEW.order_id;
    END IF;

    IF NEW.order_id IS NULL
       OR NEW.service_request_id IS NOT NULL
       OR NEW.subject_id IS DISTINCT FROM NEW.order_id
       OR position(',' in NEW.order_id) > 0 THEN
      RAISE EXCEPTION 'INVALID_ORDER_AUDIT_SUBJECT: Order audit log requires a single non-empty order_id matching subject_id and null service_request_id.';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.orders AS o
      WHERE o.id = NEW.order_id
        AND o.shop_id = NEW.shop_id
    ) THEN
      RAISE EXCEPTION 'ORDER_AUDIT_SHOP_MISMATCH: Order "%" does not exist in shop "%".', NEW.order_id, NEW.shop_id;
    END IF;
  ELSIF NEW.subject_type = 'service_request' THEN
    IF NEW.service_request_id IS NULL AND NEW.subject_id IS NOT NULL THEN
      NEW.service_request_id := NEW.subject_id;
    END IF;
    IF NEW.subject_id IS NULL AND NEW.service_request_id IS NOT NULL THEN
      NEW.subject_id := NEW.service_request_id;
    END IF;

    IF NEW.service_request_id IS NULL
       OR NEW.order_id IS NOT NULL
       OR NEW.subject_id IS DISTINCT FROM NEW.service_request_id
       OR position(',' in NEW.service_request_id) > 0 THEN
      RAISE EXCEPTION 'INVALID_SERVICE_REQUEST_AUDIT_SUBJECT: Service request audit log requires a single non-empty service_request_id matching subject_id and null order_id.';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.table_service_requests AS sr
      WHERE sr.id = NEW.service_request_id
        AND sr.shop_id = NEW.shop_id
    ) THEN
      RAISE EXCEPTION 'SERVICE_REQUEST_AUDIT_SHOP_MISMATCH: Service request "%" does not exist in shop "%".', NEW.service_request_id, NEW.shop_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'INVALID_ORDER_AUDIT_SUBJECT_TYPE: Unsupported subject_type "%".', NEW.subject_type;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_order_audit_logs_boundaries() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_order_audit_logs_boundaries() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_order_audit_logs_boundaries() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_order_audit_logs_boundaries() TO service_role;

DROP TRIGGER IF EXISTS trg_enforce_order_audit_logs_boundaries ON public.order_audit_logs;
CREATE TRIGGER trg_enforce_order_audit_logs_boundaries
  BEFORE INSERT OR UPDATE OR DELETE ON public.order_audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_order_audit_logs_boundaries();

DROP TRIGGER IF EXISTS trg_prevent_order_audit_logs_truncate ON public.order_audit_logs;
CREATE TRIGGER trg_prevent_order_audit_logs_truncate
  BEFORE TRUNCATE ON public.order_audit_logs
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.enforce_order_audit_logs_boundaries();

ALTER TABLE public.order_audit_logs
  DROP CONSTRAINT IF EXISTS order_audit_logs_subject_check;

ALTER TABLE public.order_audit_logs
  ADD CONSTRAINT order_audit_logs_subject_check CHECK (
    (
      subject_type = 'order'
      AND order_id IS NOT NULL
      AND service_request_id IS NULL
      AND subject_id = order_id
      AND btrim(subject_id) <> ''
      AND position(',' in order_id) = 0
    )
    OR (
      subject_type = 'service_request'
      AND service_request_id IS NOT NULL
      AND order_id IS NULL
      AND subject_id = service_request_id
      AND btrim(subject_id) <> ''
      AND position(',' in service_request_id) = 0
    )
  );

CREATE INDEX IF NOT EXISTS idx_order_audit_logs_shop_created
  ON public.order_audit_logs(shop_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_audit_logs_shop_subject
  ON public.order_audit_logs(shop_id, subject_type, subject_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_audit_logs_shop_service_request
  ON public.order_audit_logs(shop_id, service_request_id, created_at DESC)
  WHERE service_request_id IS NOT NULL;

ALTER TABLE public.order_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS order_audit_logs_select ON public.order_audit_logs;
CREATE POLICY order_audit_logs_select ON public.order_audit_logs
  FOR SELECT USING (
    public.user_has_shop_permission(shop_id, 'reports.view')
  );

REVOKE ALL ON public.order_audit_logs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.order_audit_logs TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.order_audit_logs TO service_role;

-- Super Admin actions are global and therefore do not belong to a shop-scoped
-- order audit row. Persist them separately, preserve these records during demo
-- resets, and expose reads only through the authenticated Super Admin API.
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  actor_email TEXT NOT NULL DEFAULT '',
  action VARCHAR(100) NOT NULL,
  target_id TEXT,
  details JSONB DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT admin_audit_logs_action_nonempty CHECK (btrim(action) <> '')
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created
  ON public.admin_audit_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_action_created
  ON public.admin_audit_logs(action, created_at DESC);

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.enforce_admin_audit_logs_boundaries()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.is_client_request_context() THEN
    RAISE EXCEPTION 'FORBIDDEN_ADMIN_AUDIT_DIRECT_MUTATION: Direct client mutations on admin_audit_logs are forbidden.';
  END IF;

  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'IMMUTABLE_ADMIN_AUDIT_LOG: Admin audit rows cannot be truncated.';
  END IF;

  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'IMMUTABLE_ADMIN_AUDIT_LOG: Admin audit rows are append-only.';
  END IF;

  NEW.actor_user_id := BTRIM(COALESCE(NEW.actor_user_id, ''));
  NEW.actor_email := LOWER(BTRIM(COALESCE(NEW.actor_email, '')));
  NEW.action := BTRIM(COALESCE(NEW.action, ''));
  IF NEW.actor_user_id = '' OR NEW.action = '' THEN
    RAISE EXCEPTION 'INVALID_ADMIN_AUDIT_RECORD: actor_user_id and action are required.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_admin_audit_logs_boundaries() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_admin_audit_logs_boundaries() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_admin_audit_logs_boundaries() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_admin_audit_logs_boundaries() TO service_role;

DROP TRIGGER IF EXISTS trg_enforce_admin_audit_logs_boundaries ON public.admin_audit_logs;
CREATE TRIGGER trg_enforce_admin_audit_logs_boundaries
  BEFORE INSERT OR UPDATE OR DELETE ON public.admin_audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_admin_audit_logs_boundaries();

DROP TRIGGER IF EXISTS trg_prevent_admin_audit_logs_truncate ON public.admin_audit_logs;
CREATE TRIGGER trg_prevent_admin_audit_logs_truncate
  BEFORE TRUNCATE ON public.admin_audit_logs
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.enforce_admin_audit_logs_boundaries();

REVOKE ALL ON public.admin_audit_logs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.admin_audit_logs TO service_role;
