-- ============================================================================
-- Migration 20261029000100: Atomic All-or-Nothing Bulk Catalog Availability RPC
--
-- Guarantees strict all-or-nothing transactional semantics for
-- POST /api/catalog (bulk_update_availability / bulk_set_availability):
-- 1. Restricted to trusted server execution (service_role); blocks direct
--    client execution via public.is_client_request_context() and REVOKE.
-- 2. Validates shop_id, boolean target availability, and 1..2000 unique
--    non-empty item IDs.
-- 3. Locks all requested rows in public.items for the target shop in
--    deterministic id ASC order (FOR UPDATE) — matching the lock order of
--    public.commit_order_with_inventory and public.update_order_with_inventory
--    to prevent deadlocks and re-read the latest committed stock_quantity.
-- 4. Verifies every requested item belongs to p_shop_id before any write;
--    if any item is missing or belongs to another shop, returns
--    ITEM_NOT_IN_SHOP with 0 rows modified.
-- 5. When p_is_available = TRUE, verifies on the locked rows that no item has
--    stock_quantity = 0 (allowing positive stock > 0 and unlimited NULL stock).
--    If any item has stock_quantity = 0 (initially or due to a concurrent order
--    draining stock before lock acquisition), returns
--    ZERO_STOCK_CANNOT_MARK_AVAILABLE with zero_stock_item_ids in request order
--    and modifies 0 rows — never performing partial updates or compensating
--    rollbacks that could overwrite concurrent updates on other items.
-- 6. Updates only public.items.is_available and verifies ROW_COUNT matches the
--    requested batch size, raising an exception to roll back the transaction on
--    any mismatch or database failure.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.bulk_set_items_availability_atomic(
  p_shop_id TEXT,
  p_item_ids TEXT[],
  p_is_available BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shop_id TEXT;
  v_normalized_ids TEXT[] := ARRAY[]::TEXT[];
  v_raw_id TEXT;
  v_trimmed_id TEXT;
  v_idx INTEGER;
  v_total_requested INTEGER;
  v_locked_count INTEGER := 0;
  v_zero_stock_ids TEXT[] := ARRAY[]::TEXT[];
  v_updated_count INTEGER := 0;
BEGIN
  IF public.is_client_request_context() THEN
    RAISE EXCEPTION 'FORBIDDEN_CLIENT_RPC: Chỉ máy chủ xác thực mới được cập nhật hàng loạt trạng thái thực đơn.';
  END IF;

  v_shop_id := BTRIM(COALESCE(p_shop_id, ''));
  IF v_shop_id = '' THEN
    RAISE EXCEPTION 'INVALID_SHOP_ID: Thiếu mã cửa hàng (shopId).';
  END IF;

  IF p_is_available IS NULL THEN
    RAISE EXCEPTION 'INVALID_AVAILABILITY: Trạng thái còn món (is_available) phải là kiểu boolean.';
  END IF;

  v_total_requested := COALESCE(array_length(p_item_ids, 1), 0);
  IF p_item_ids IS NULL OR v_total_requested = 0 THEN
    RAISE EXCEPTION 'INVALID_ITEM_IDS: Danh sách mã món (itemIds) phải là mảng không rỗng.';
  END IF;

  IF v_total_requested > 2000 THEN
    RAISE EXCEPTION 'TOO_MANY_ITEMS: Vượt quá giới hạn 2,000 món mỗi lần thao tác.';
  END IF;

  FOR v_idx IN 1..v_total_requested LOOP
    v_raw_id := p_item_ids[v_idx];
    IF v_raw_id IS NULL THEN
      RAISE EXCEPTION 'MALFORMED_ITEM_ID: Mã món tại vị trí % không hợp lệ (phải là chuỗi).', v_idx;
    END IF;
    v_trimmed_id := BTRIM(v_raw_id);
    IF v_trimmed_id = '' THEN
      RAISE EXCEPTION 'MALFORMED_ITEM_ID: Mã món tại vị trí % không được để trống.', v_idx;
    END IF;
    IF v_trimmed_id = ANY(v_normalized_ids) THEN
      RAISE EXCEPTION 'DUPLICATE_ITEM_ID: Mã món "%" bị trùng lặp trong yêu cầu.', v_trimmed_id;
    END IF;
    v_normalized_ids := array_append(v_normalized_ids, v_trimmed_id);
  END LOOP;

  -- Lock target items in deterministic id ASC order to prevent deadlocks with
  -- concurrent order commits and ensure latest committed stock_quantity is seen.
  SELECT count(*)::INTEGER
  INTO v_locked_count
  FROM (
    SELECT i.id
    FROM public.items AS i
    WHERE i.shop_id = v_shop_id
      AND i.id = ANY(v_normalized_ids)
    ORDER BY i.id ASC
    FOR UPDATE
  ) AS locked_rows;

  IF v_locked_count <> v_total_requested THEN
    RETURN jsonb_build_object(
      'success', false,
      'ok', false,
      'code', 'ITEM_NOT_IN_SHOP',
      'updated_count', 0,
      'count', 0,
      'error', 'Một hoặc nhiều món không tồn tại hoặc không thuộc cửa hàng này.'
    );
  END IF;

  IF p_is_available IS TRUE THEN
    SELECT COALESCE(array_agg(req.item_id ORDER BY req.ord ASC), ARRAY[]::TEXT[])
    INTO v_zero_stock_ids
    FROM unnest(v_normalized_ids) WITH ORDINALITY AS req(item_id, ord)
    JOIN public.items AS i
      ON i.id = req.item_id
     AND i.shop_id = v_shop_id
    WHERE i.stock_quantity = 0;

    IF COALESCE(array_length(v_zero_stock_ids, 1), 0) > 0 THEN
      RETURN jsonb_build_object(
        'success', false,
        'ok', false,
        'code', 'ZERO_STOCK_CANNOT_MARK_AVAILABLE',
        'updated_count', 0,
        'count', 0,
        'zero_stock_item_ids', to_jsonb(v_zero_stock_ids),
        'error', 'Không thể bật còn hàng cho món có tồn kho bằng 0. Vui lòng nhập thêm tồn kho hoặc chuyển món sang tồn kho không giới hạn (∞) trước.'
      );
    END IF;
  END IF;

  UPDATE public.items AS i
  SET is_available = p_is_available
  WHERE i.shop_id = v_shop_id
    AND i.id = ANY(v_normalized_ids)
    AND (NOT p_is_available OR i.stock_quantity IS NULL OR i.stock_quantity > 0);

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count <> v_total_requested THEN
    RAISE EXCEPTION 'BULK_AVAILABILITY_COUNT_MISMATCH: Số lượng món được cập nhật trạng thái không khớp với yêu cầu.';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'ok', true,
    'updated_count', v_updated_count,
    'count', v_updated_count,
    'is_available', p_is_available,
    'item_ids', to_jsonb(v_normalized_ids)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_set_items_availability_atomic(TEXT, TEXT[], BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bulk_set_items_availability_atomic(TEXT, TEXT[], BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.bulk_set_items_availability_atomic(TEXT, TEXT[], BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_set_items_availability_atomic(TEXT, TEXT[], BOOLEAN) TO service_role;
