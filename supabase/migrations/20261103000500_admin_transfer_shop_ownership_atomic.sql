-- Keep shop ownership and shop membership permissions in sync during a
-- Super Admin transfer. A former owner must not retain owner access through
-- an active shop_memberships row after shops.owner_id changes.
CREATE OR REPLACE FUNCTION public.admin_transfer_shop_ownership_atomic(
  p_shop_id TEXT,
  p_new_owner_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_shop_id TEXT;
  v_new_owner_id TEXT;
  v_new_owner_email TEXT;
  v_new_owner_full_name TEXT;
  v_old_owner_id TEXT;
  v_shop public.shops%ROWTYPE;
BEGIN
  IF public.is_client_request_context() THEN
    RAISE EXCEPTION 'FORBIDDEN_CLIENT_RPC: Chỉ máy chủ xác thực mới được chuyển quyền cửa hàng.';
  END IF;

  v_shop_id := NULLIF(BTRIM(COALESCE(p_shop_id, '')), '');
  v_new_owner_id := NULLIF(BTRIM(COALESCE(p_new_owner_id, '')), '');
  IF v_shop_id IS NULL OR v_new_owner_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_OWNER_TRANSFER: Thiếu shopId hoặc ownerId.';
  END IF;

  SELECT p.id, p.email, p.full_name
  INTO v_new_owner_id, v_new_owner_email, v_new_owner_full_name
  FROM public.profiles AS p
  WHERE p.id = v_new_owner_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'OWNER_NOT_FOUND',
      'shop_id', v_shop_id,
      'new_owner_id', v_new_owner_id
    );
  END IF;

  -- Keep lock order profile → shop, matching admin_delete_owner_atomic.
  SELECT s.*
  INTO v_shop
  FROM public.shops AS s
  WHERE s.id = v_shop_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'SHOP_NOT_FOUND',
      'shop_id', v_shop_id
    );
  END IF;

  v_old_owner_id := v_shop.owner_id;
  IF v_old_owner_id IS DISTINCT FROM v_new_owner_id THEN
    UPDATE public.shops AS s
    SET owner_id = v_new_owner_id,
        updated_at = pg_catalog.clock_timestamp()
    WHERE s.id = v_shop_id
    RETURNING s.* INTO v_shop;

    IF v_old_owner_id IS NOT NULL THEN
      UPDATE public.shop_memberships AS m
      SET is_active = FALSE,
          updated_at = pg_catalog.clock_timestamp()
      WHERE m.shop_id = v_shop_id
        AND m.user_id = v_old_owner_id
        AND m.is_active = TRUE;
    END IF;
  END IF;

  INSERT INTO public.shop_memberships (
    id,
    shop_id,
    user_id,
    email,
    full_name,
    role,
    permissions,
    is_active,
    created_at,
    updated_at
  )
  VALUES (
    'mem-' || v_shop_id || '-' || v_new_owner_id,
    v_shop_id,
    v_new_owner_id,
    v_new_owner_email,
    v_new_owner_full_name,
    'owner',
    '[]'::JSONB,
    TRUE,
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp()
  )
  ON CONFLICT (shop_id, user_id) DO UPDATE
  SET email = EXCLUDED.email,
      full_name = EXCLUDED.full_name,
      role = 'owner',
      permissions = '[]'::JSONB,
      is_active = TRUE,
      updated_at = pg_catalog.clock_timestamp();

  RETURN jsonb_build_object(
    'ok', true,
    'shop_id', v_shop_id,
    'old_owner_id', v_old_owner_id,
    'new_owner_id', v_new_owner_id,
    'shop', pg_catalog.to_jsonb(v_shop)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_transfer_shop_ownership_atomic(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_transfer_shop_ownership_atomic(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_transfer_shop_ownership_atomic(TEXT, TEXT)
  TO service_role;
