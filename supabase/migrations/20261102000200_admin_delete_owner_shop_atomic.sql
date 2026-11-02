-- ============================================================================
-- Migration 20261102000200: Atomic Super Admin Owner & Shop Deletion RPCs
--
-- Closes the time-of-check/time-of-use (TOCTOU) race between history preflight
-- SELECTs and parent DELETEs in POST /api/admin (delete_owner, delete_shop):
-- 1. Restricted to trusted server execution (service_role); blocks direct
--    client execution via public.is_client_request_context() and REVOKE.
-- 2. Locks target root rows FOR UPDATE before inspecting history:
--    - public.admin_delete_owner_atomic locks public.profiles(id) FOR UPDATE,
--      enforces the root Super Admin deletion guard on the locked profile row,
--      then locks all owned public.shops rows in deterministic id ASC order
--      FOR UPDATE.
--    - public.admin_delete_shop_atomic locks public.shops(id) FOR UPDATE.
--    Because payment_transactions(user_id) and shops(owner_id) reference
--    public.profiles(id), and orders(shop_id), order_audit_logs(shop_id),
--    sepay_webhook_events(shop_id), and table_service_requests(shop_id) all
--    reference public.shops(id), any concurrent history or child-shop insert
--    must acquire FOR KEY SHARE on the parent row and serializes behind the
--    FOR UPDATE lock.
-- 3. Inspects the exact history tables on the locked parent rows and returns
--    structured conflict outcomes (OWNER_HAS_PAYMENT_HISTORY,
--    OWNER_HAS_BUSINESS_HISTORY, SHOP_HAS_HISTORY) without deleting any row.
-- 4. Executes the parent DELETE within the same RPC transaction when history
--    is empty and returns the deleted owner/shop metadata (including the
--    authoritative profile email and deleted shop IDs for post-commit cache
--    cleanup and audit logging).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_delete_owner_atomic(
  p_owner_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner_id TEXT;
  v_profile_id TEXT;
  v_profile_email TEXT;
  v_shop_ids TEXT[] := ARRAY[]::TEXT[];
  v_deleted_count INTEGER := 0;
BEGIN
  IF public.is_client_request_context() THEN
    RAISE EXCEPTION 'FORBIDDEN_CLIENT_RPC: Chỉ máy chủ xác thực mới được xóa tài khoản chủ quán.';
  END IF;

  v_owner_id := BTRIM(COALESCE(p_owner_id, ''));
  IF v_owner_id = '' THEN
    RAISE EXCEPTION 'INVALID_OWNER_ID: Thiếu ownerId.';
  END IF;

  SELECT p.id, p.email
  INTO v_profile_id, v_profile_email
  FROM public.profiles AS p
  WHERE p.id = v_owner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'deleted', false,
      'code', 'OWNER_NOT_FOUND',
      'error', 'Không tìm thấy tài khoản.'
    );
  END IF;

  IF v_profile_id = 'admin-hoangvu96z'
     OR lower(btrim(COALESCE(v_profile_email, ''))) = 'hoangvu96z@gmail.com' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'deleted', false,
      'code', 'SUPER_ADMIN_PROTECTED',
      'email', v_profile_email,
      'error', 'Không thể xóa tài khoản Super Admin tối cao!'
    );
  END IF;

  SELECT COALESCE(array_agg(locked_shops.id ORDER BY locked_shops.id ASC), ARRAY[]::TEXT[])
  INTO v_shop_ids
  FROM (
    SELECT s.id
    FROM public.shops AS s
    WHERE s.owner_id = v_owner_id
    ORDER BY s.id ASC
    FOR UPDATE
  ) AS locked_shops;

  IF EXISTS (
    SELECT 1
    FROM public.payment_transactions AS pt
    WHERE pt.user_id = v_owner_id
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'deleted', false,
      'code', 'OWNER_HAS_PAYMENT_HISTORY',
      'email', v_profile_email,
      'shop_ids', to_jsonb(v_shop_ids),
      'error', 'Không thể xóa tài khoản vì còn lịch sử thanh toán gắn với tài khoản này.'
    );
  END IF;

  IF COALESCE(array_length(v_shop_ids, 1), 0) > 0 THEN
    IF EXISTS (
      SELECT 1 FROM public.orders AS o WHERE o.shop_id = ANY(v_shop_ids)
    ) OR EXISTS (
      SELECT 1 FROM public.order_audit_logs AS oal WHERE oal.shop_id = ANY(v_shop_ids)
    ) OR EXISTS (
      SELECT 1 FROM public.sepay_webhook_events AS swe WHERE swe.shop_id = ANY(v_shop_ids)
    ) OR EXISTS (
      SELECT 1 FROM public.table_service_requests AS tsr WHERE tsr.shop_id = ANY(v_shop_ids)
    ) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'deleted', false,
        'code', 'OWNER_HAS_BUSINESS_HISTORY',
        'email', v_profile_email,
        'shop_ids', to_jsonb(v_shop_ids),
        'error', 'Không thể xóa tài khoản vì cửa hàng còn đơn hàng hoặc dữ liệu lịch sử.'
      );
    END IF;
  END IF;

  DELETE FROM public.profiles AS p
  WHERE p.id = v_owner_id;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  IF v_deleted_count <> 1 THEN
    RAISE EXCEPTION 'OWNER_DELETE_ROW_COUNT_MISMATCH: Expected 1 deleted profile row, got %.', v_deleted_count;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted', true,
    'owner_id', v_profile_id,
    'email', v_profile_email,
    'shop_ids', to_jsonb(v_shop_ids)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_owner_atomic(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_delete_owner_atomic(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_owner_atomic(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_delete_shop_atomic(
  p_shop_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shop_id TEXT;
  v_locked_shop_id TEXT;
  v_deleted_count INTEGER := 0;
BEGIN
  IF public.is_client_request_context() THEN
    RAISE EXCEPTION 'FORBIDDEN_CLIENT_RPC: Chỉ máy chủ xác thực mới được xóa cửa hàng.';
  END IF;

  v_shop_id := BTRIM(COALESCE(p_shop_id, ''));
  IF v_shop_id = '' THEN
    RAISE EXCEPTION 'INVALID_SHOP_ID: Thiếu shopId.';
  END IF;

  SELECT s.id
  INTO v_locked_shop_id
  FROM public.shops AS s
  WHERE s.id = v_shop_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'deleted', false,
      'code', 'SHOP_NOT_FOUND',
      'error', 'Không tìm thấy cửa hàng.'
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.orders AS o WHERE o.shop_id = v_shop_id
  ) OR EXISTS (
    SELECT 1 FROM public.order_audit_logs AS oal WHERE oal.shop_id = v_shop_id
  ) OR EXISTS (
    SELECT 1 FROM public.sepay_webhook_events AS swe WHERE swe.shop_id = v_shop_id
  ) OR EXISTS (
    SELECT 1 FROM public.table_service_requests AS tsr WHERE tsr.shop_id = v_shop_id
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'deleted', false,
      'code', 'SHOP_HAS_HISTORY',
      'shop_id', v_locked_shop_id,
      'error', 'Không thể xóa cửa hàng vì còn đơn hàng hoặc dữ liệu lịch sử.'
    );
  END IF;

  DELETE FROM public.shops AS s
  WHERE s.id = v_shop_id;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  IF v_deleted_count <> 1 THEN
    RAISE EXCEPTION 'SHOP_DELETE_ROW_COUNT_MISMATCH: Expected 1 deleted shop row, got %.', v_deleted_count;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted', true,
    'shop_id', v_locked_shop_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_shop_atomic(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_delete_shop_atomic(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_shop_atomic(TEXT) TO service_role;
