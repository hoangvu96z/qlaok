-- ============================================================================
-- Migration 017: Order Workflow Step & Label Print Counter RPC Support
-- Extends public.commit_order_with_inventory and public.update_order_with_inventory
-- (from 007_shop_tables.sql) to persist workflow_step_id and label_printed_count
-- (added in 016_order_workflow_and_label_printing.sql) while preserving all
-- table validation, inventory locking, idempotency, concurrency, and RLS guarantees.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.commit_order_with_inventory(
    p_order JSONB,
    p_inventory_deltas JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role TEXT;
    v_shop_id TEXT;
    v_idemp_key TEXT;
    v_pay_idemp_key TEXT;
    v_existing public.orders%ROWTYPE;
    v_inserted public.orders%ROWTYPE;
    v_delta_rec RECORD;
    v_item public.items%ROWTYPE;
    v_session_id TEXT;
    v_table_id TEXT;
    v_table_code TEXT;
    v_table_label TEXT;
    v_table public.shop_tables%ROWTYPE;
    v_payment_status TEXT;
BEGIN
    v_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
    v_shop_id := BTRIM(COALESCE(p_order->>'shop_id', ''));

    IF v_shop_id = '' THEN
        RAISE EXCEPTION 'MISSING_SHOP_ID: Thiếu mã cửa hàng (shop_id).';
    END IF;

    IF v_role IN ('anon', 'authenticated') THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.shops s
            WHERE s.id = v_shop_id
              AND (s.is_published = TRUE OR public.user_has_shop_permission(s.id, 'orders.create'))
        ) THEN
            RAISE EXCEPTION 'FORBIDDEN_ORDER_CREATE: Cửa hàng không tồn tại hoặc không có quyền tạo đơn.';
        END IF;
    END IF;

    v_idemp_key := NULLIF(BTRIM(COALESCE(p_order->>'idempotency_key', '')), '');
    IF v_idemp_key IS NOT NULL THEN
        SELECT * INTO v_existing
        FROM public.orders
        WHERE shop_id = v_shop_id
          AND idempotency_key = v_idemp_key
        FOR UPDATE;

        IF FOUND THEN
            RETURN to_jsonb(v_existing);
        END IF;
    END IF;

    v_pay_idemp_key := NULLIF(BTRIM(COALESCE(p_order->>'payment_idempotency_key', '')), '');
    IF v_pay_idemp_key IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM public.orders
            WHERE shop_id = v_shop_id
              AND payment_idempotency_key = v_pay_idemp_key
        ) THEN
            RAISE EXCEPTION 'DUPLICATE_PAYMENT_IDEMPOTENCY_KEY: Mã khóa thanh toán đã được sử dụng cho đơn hàng khác.';
        END IF;
    END IF;

    v_table_id := NULLIF(BTRIM(COALESCE(p_order->>'table_id', '')), '');
    v_table_code := NULLIF(BTRIM(COALESCE(p_order->>'table_code', '')), '');
    v_table_label := COALESCE(NULLIF(BTRIM(p_order->>'table_label'), ''), 'Bàn khách');

    IF v_table_id IS NOT NULL THEN
        SELECT * INTO v_table
        FROM public.shop_tables
        WHERE id = v_table_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'INVALID_SHOP_TABLE: Bàn "%" không tồn tại.', v_table_id;
        END IF;

        IF v_table.shop_id IS DISTINCT FROM v_shop_id THEN
            RAISE EXCEPTION 'INVALID_TABLE_SHOP: Bàn "%" không thuộc cửa hàng này.', v_table_id;
        END IF;

        IF v_table.is_active IS NOT TRUE OR v_table.is_archived IS TRUE THEN
            RAISE EXCEPTION 'INACTIVE_SHOP_TABLE: Bàn "%" hiện đang tạm ngưng hoặc đã lưu trữ.', v_table.name;
        END IF;

        v_table_label := v_table.name;
    ELSIF v_table_code IS NOT NULL THEN
        SELECT * INTO v_table
        FROM public.shop_tables
        WHERE shop_id = v_shop_id
          AND LOWER(BTRIM(table_code)) = LOWER(v_table_code)
        LIMIT 1;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'INVALID_SHOP_TABLE: Mã bàn "%" không tồn tại.', v_table_code;
        END IF;

        IF v_table.is_active IS NOT TRUE OR v_table.is_archived IS TRUE THEN
            RAISE EXCEPTION 'INACTIVE_SHOP_TABLE: Bàn "%" hiện đang tạm ngưng hoặc đã lưu trữ.', v_table.name;
        END IF;

        v_table_id := v_table.id;
        v_table_label := v_table.name;
    END IF;

    -- Lock and deduct inventory in deterministic item_id order to prevent deadlocks
    FOR v_delta_rec IN
        SELECT
            BTRIM(COALESCE(elem->>'item_id', '')) AS item_id,
            COALESCE((elem->>'delta')::INTEGER, 0) AS delta
        FROM jsonb_array_elements(COALESCE(p_inventory_deltas, '[]'::jsonb)) AS elem
        WHERE COALESCE((elem->>'delta')::INTEGER, 0) > 0
        ORDER BY BTRIM(COALESCE(elem->>'item_id', '')) ASC
    LOOP
        SELECT * INTO v_item
        FROM public.items
        WHERE id = v_delta_rec.item_id
          AND shop_id = v_shop_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'ITEM_NOT_IN_SHOP: Món "%" không tồn tại hoặc không thuộc cửa hàng này.', v_delta_rec.item_id;
        END IF;

        IF v_item.is_available IS FALSE THEN
            RAISE EXCEPTION 'ITEM_UNAVAILABLE: Món "%" hiện đã tạm hết hàng.', COALESCE(v_item.name_i18n->>'vi', v_item.id);
        END IF;

        IF v_item.stock_quantity IS NOT NULL AND v_item.stock_quantity < v_delta_rec.delta THEN
            RAISE EXCEPTION 'Món "%" chỉ còn % phần trong kho.', COALESCE(v_item.name_i18n->>'vi', v_item.id), v_item.stock_quantity;
        END IF;

        UPDATE public.items
        SET
            stock_quantity = CASE
                WHEN stock_quantity IS NULL THEN NULL
                ELSE GREATEST(0, stock_quantity - v_delta_rec.delta)
            END,
            sold_count = COALESCE(sold_count, 0) + v_delta_rec.delta,
            is_available = CASE
                WHEN stock_quantity IS NOT NULL AND (stock_quantity - v_delta_rec.delta) <= 0 THEN FALSE
                ELSE is_available
            END
        WHERE id = v_item.id;
    END LOOP;

    v_payment_status := COALESCE(NULLIF(BTRIM(p_order->>'payment_status'), ''), 'unpaid');
    v_session_id := NULLIF(BTRIM(COALESCE(p_order->>'session_id', '')), '');

    IF v_session_id IS NULL AND v_payment_status = 'unpaid' THEN
        SELECT o.session_id INTO v_session_id
        FROM public.orders o
        WHERE o.shop_id = v_shop_id
          AND o.status <> 'cancelled'
          AND o.payment_status = 'unpaid'
          AND (
              (v_table_id IS NOT NULL AND o.table_id = v_table_id)
              OR (v_table_id IS NULL AND o.table_id IS NULL AND LOWER(BTRIM(o.table_label)) = LOWER(v_table_label))
          )
          AND o.session_id IS NOT NULL
        ORDER BY o.created_at DESC
        LIMIT 1;
    END IF;

    IF v_session_id IS NULL THEN
        v_session_id := 'sess-' || v_shop_id || '-' || EXTRACT(EPOCH FROM NOW())::BIGINT::TEXT;
    END IF;

    INSERT INTO public.orders (
        id,
        order_code,
        shop_id,
        table_id,
        table_label,
        session_id,
        bill_version,
        visitor_lang,
        customer_note,
        status,
        workflow_step_id,
        payment_method,
        payment_status,
        subtotal_amount,
        discount_amount,
        promo_discount_amount,
        manual_discount_amount,
        discount_code,
        discount_reason,
        total_amount,
        items,
        source,
        tracking_token,
        idempotency_key,
        payment_idempotency_key,
        paid_at,
        paid_by,
        refunded_at,
        refund_reason,
        refunded_by,
        cancelled_reason,
        cancel_reason,
        waste_recorded,
        print_count,
        kitchen_printed_count,
        provisional_printed_count,
        receipt_printed_count,
        label_printed_count,
        last_printed_at,
        last_printed_by,
        created_at,
        updated_at
    ) VALUES (
        COALESCE(NULLIF(BTRIM(p_order->>'id'), ''), 'ord-' || EXTRACT(EPOCH FROM NOW())::BIGINT::TEXT),
        COALESCE(NULLIF(BTRIM(p_order->>'order_code'), ''), 'ORD-000'),
        v_shop_id,
        v_table_id,
        v_table_label,
        v_session_id,
        GREATEST(1, COALESCE((p_order->>'bill_version')::INTEGER, 1)),
        COALESCE(NULLIF(BTRIM(p_order->>'visitor_lang'), ''), 'vi'),
        COALESCE(p_order->>'customer_note', ''),
        COALESCE(NULLIF(BTRIM(p_order->>'status'), ''), 'new'),
        NULLIF(BTRIM(COALESCE(p_order->>'workflow_step_id', '')), ''),
        COALESCE(NULLIF(BTRIM(p_order->>'payment_method'), ''), 'cash'),
        v_payment_status,
        COALESCE((p_order->>'subtotal_amount')::NUMERIC, 0),
        COALESCE((p_order->>'discount_amount')::NUMERIC, 0),
        COALESCE((p_order->>'promo_discount_amount')::NUMERIC, 0),
        COALESCE((p_order->>'manual_discount_amount')::NUMERIC, 0),
        NULLIF(BTRIM(COALESCE(p_order->>'discount_code', '')), ''),
        NULLIF(BTRIM(COALESCE(p_order->>'discount_reason', '')), ''),
        COALESCE((p_order->>'total_amount')::NUMERIC, 0),
        COALESCE(p_order->'items', '[]'::jsonb),
        COALESCE(NULLIF(BTRIM(p_order->>'source'), ''), 'qr_table'),
        NULLIF(BTRIM(COALESCE(p_order->>'tracking_token', '')), ''),
        v_idemp_key,
        v_pay_idemp_key,
        CASE WHEN NULLIF(BTRIM(COALESCE(p_order->>'paid_at', '')), '') IS NOT NULL
             THEN (p_order->>'paid_at')::TIMESTAMPTZ ELSE NULL END,
        NULLIF(BTRIM(COALESCE(p_order->>'paid_by', '')), ''),
        CASE WHEN NULLIF(BTRIM(COALESCE(p_order->>'refunded_at', '')), '') IS NOT NULL
             THEN (p_order->>'refunded_at')::TIMESTAMPTZ ELSE NULL END,
        NULLIF(BTRIM(COALESCE(p_order->>'refund_reason', '')), ''),
        NULLIF(BTRIM(COALESCE(p_order->>'refunded_by', '')), ''),
        NULLIF(BTRIM(COALESCE(p_order->>'cancelled_reason', '')), ''),
        NULLIF(BTRIM(COALESCE(p_order->>'cancel_reason', p_order->>'cancelled_reason', '')), ''),
        COALESCE((p_order->>'waste_recorded')::BOOLEAN, FALSE),
        COALESCE((p_order->>'print_count')::INTEGER, 0),
        COALESCE((p_order->>'kitchen_printed_count')::INTEGER, 0),
        COALESCE((p_order->>'provisional_printed_count')::INTEGER, 0),
        COALESCE((p_order->>'receipt_printed_count')::INTEGER, 0),
        GREATEST(0, COALESCE((p_order->>'label_printed_count')::INTEGER, 0)),
        CASE WHEN NULLIF(BTRIM(COALESCE(p_order->>'last_printed_at', '')), '') IS NOT NULL
             THEN (p_order->>'last_printed_at')::TIMESTAMPTZ ELSE NULL END,
        NULLIF(BTRIM(COALESCE(p_order->>'last_printed_by', '')), ''),
        COALESCE((p_order->>'created_at')::TIMESTAMPTZ, NOW()),
        COALESCE((p_order->>'updated_at')::TIMESTAMPTZ, NOW())
    )
    RETURNING * INTO v_inserted;

    RETURN to_jsonb(v_inserted);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_order_with_inventory(
    p_order_id TEXT,
    p_order JSONB,
    p_inventory_deltas JSONB DEFAULT '[]'::jsonb,
    p_guards JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_existing public.orders%ROWTYPE;
    v_updated public.orders%ROWTYPE;
    v_delta_rec RECORD;
    v_item public.items%ROWTYPE;
    v_expected_bill_version INTEGER;
    v_expected_updated_at TIMESTAMPTZ;
    v_expected_status TEXT;
    v_expected_payment_status TEXT;
    v_require_new_unpaid BOOLEAN;
    v_pay_idemp_key TEXT;
    v_next_table_id TEXT;
    v_next_table_label TEXT;
    v_table public.shop_tables%ROWTYPE;
BEGIN
    SELECT * INTO v_existing
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy đơn hàng.';
    END IF;

    -- Customer pre-acceptance guard inside DB transaction
    v_require_new_unpaid := COALESCE((p_guards->>'require_new_unpaid')::BOOLEAN, FALSE);
    IF v_require_new_unpaid THEN
        IF v_existing.status <> 'new' OR v_existing.payment_status <> 'unpaid' THEN
            RAISE EXCEPTION 'ORDER_ALREADY_PAID: CUSTOMER_EDIT_LOCKED: Đơn hàng đã được bếp tiếp nhận hoặc đã thanh toán, không thể tự chỉnh sửa.';
        END IF;
    END IF;

    -- Optimistic concurrency guards inside DB transaction
    IF NULLIF(BTRIM(COALESCE(p_guards->>'expected_bill_version', '')), '') IS NOT NULL THEN
        v_expected_bill_version := (p_guards->>'expected_bill_version')::INTEGER;
        IF v_existing.bill_version <> v_expected_bill_version THEN
            RAISE EXCEPTION 'ORDER_ALREADY_PAID: CONCURRENT_BILL_VERSION: Hóa đơn đã thay đổi (bill_version không khớp).';
        END IF;
    END IF;

    IF NULLIF(BTRIM(COALESCE(p_guards->>'expected_updated_at', '')), '') IS NOT NULL THEN
        v_expected_updated_at := (p_guards->>'expected_updated_at')::TIMESTAMPTZ;
        IF v_existing.updated_at <> v_expected_updated_at THEN
            RAISE EXCEPTION 'ORDER_ALREADY_PAID: CONCURRENT_MODIFICATION: Đơn hàng đã được cập nhật bởi phiên khác (updated_at không khớp).';
        END IF;
    END IF;

    v_expected_status := NULLIF(BTRIM(COALESCE(p_guards->>'expected_status', '')), '');
    IF v_expected_status IS NOT NULL AND v_existing.status <> v_expected_status THEN
        RAISE EXCEPTION 'ORDER_ALREADY_PAID: CONCURRENT_STATUS_CONFLICT: Trạng thái đơn hàng hiện tại (%) không khớp với kỳ vọng (%).', v_existing.status, v_expected_status;
    END IF;

    v_expected_payment_status := NULLIF(BTRIM(COALESCE(p_guards->>'expected_payment_status', '')), '');
    IF v_expected_payment_status IS NOT NULL AND v_existing.payment_status <> v_expected_payment_status THEN
        RAISE EXCEPTION 'ORDER_ALREADY_PAID: CONCURRENT_PAYMENT_STATUS_CONFLICT: Trạng thái thanh toán hiện tại (%) không khớp với kỳ vọng (%).', v_existing.payment_status, v_expected_payment_status;
    END IF;

    v_pay_idemp_key := NULLIF(BTRIM(COALESCE(p_order->>'payment_idempotency_key', '')), '');
    IF v_pay_idemp_key IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM public.orders
            WHERE shop_id = v_existing.shop_id
              AND payment_idempotency_key = v_pay_idemp_key
              AND id <> v_existing.id
        ) THEN
            RAISE EXCEPTION 'DUPLICATE_PAYMENT_IDEMPOTENCY_KEY: Mã khóa thanh toán đã được sử dụng cho đơn hàng khác.';
        END IF;
    END IF;

    v_next_table_id := CASE
        WHEN p_order ? 'table_id' THEN NULLIF(BTRIM(COALESCE(p_order->>'table_id', '')), '')
        ELSE v_existing.table_id
    END;
    v_next_table_label := COALESCE(NULLIF(BTRIM(p_order->>'table_label'), ''), v_existing.table_label);

    IF v_next_table_id IS NOT NULL AND v_next_table_id IS DISTINCT FROM v_existing.table_id THEN
        SELECT * INTO v_table
        FROM public.shop_tables
        WHERE id = v_next_table_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'INVALID_SHOP_TABLE: Bàn "%" không tồn tại.', v_next_table_id;
        END IF;

        IF v_table.shop_id IS DISTINCT FROM v_existing.shop_id THEN
            RAISE EXCEPTION 'INVALID_TABLE_SHOP: Bàn "%" không thuộc cửa hàng này.', v_next_table_id;
        END IF;

        IF v_table.is_active IS NOT TRUE OR v_table.is_archived IS TRUE THEN
            RAISE EXCEPTION 'INACTIVE_SHOP_TABLE: Bàn "%" hiện đang tạm ngưng hoặc đã lưu trữ.', v_table.name;
        END IF;

        v_next_table_label := v_table.name;
    END IF;

    -- Apply inventory deltas atomically under FOR UPDATE lock
    FOR v_delta_rec IN
        SELECT
            BTRIM(COALESCE(elem->>'item_id', '')) AS item_id,
            COALESCE((elem->>'delta')::INTEGER, 0) AS delta
        FROM jsonb_array_elements(COALESCE(p_inventory_deltas, '[]'::jsonb)) AS elem
        WHERE COALESCE((elem->>'delta')::INTEGER, 0) <> 0
        ORDER BY BTRIM(COALESCE(elem->>'item_id', '')) ASC
    LOOP
        SELECT * INTO v_item
        FROM public.items
        WHERE id = v_delta_rec.item_id
          AND shop_id = v_existing.shop_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'ITEM_NOT_IN_SHOP: Món "%" không tồn tại hoặc không thuộc cửa hàng này.', v_delta_rec.item_id;
        END IF;

        IF v_delta_rec.delta > 0 THEN
            IF v_item.is_available IS FALSE THEN
                RAISE EXCEPTION 'ITEM_UNAVAILABLE: Món "%" hiện đã tạm hết hàng.', COALESCE(v_item.name_i18n->>'vi', v_item.id);
            END IF;
            IF v_item.stock_quantity IS NOT NULL AND v_item.stock_quantity < v_delta_rec.delta THEN
                RAISE EXCEPTION 'Món "%" chỉ còn % phần trong kho.', COALESCE(v_item.name_i18n->>'vi', v_item.id), v_item.stock_quantity;
            END IF;

            UPDATE public.items
            SET
                stock_quantity = CASE
                    WHEN stock_quantity IS NULL THEN NULL
                    ELSE GREATEST(0, stock_quantity - v_delta_rec.delta)
                END,
                sold_count = COALESCE(sold_count, 0) + v_delta_rec.delta,
                is_available = CASE
                    WHEN stock_quantity IS NOT NULL AND (stock_quantity - v_delta_rec.delta) <= 0 THEN FALSE
                    ELSE is_available
                END
            WHERE id = v_item.id;
        ELSE
            -- Restoring stock (delta < 0)
            UPDATE public.items
            SET
                stock_quantity = CASE
                    WHEN stock_quantity IS NULL THEN NULL
                    ELSE stock_quantity + ABS(v_delta_rec.delta)
                END,
                sold_count = GREATEST(0, COALESCE(sold_count, 0) - ABS(v_delta_rec.delta)),
                is_available = CASE
                    WHEN stock_quantity = 0 AND (stock_quantity + ABS(v_delta_rec.delta)) > 0 THEN TRUE
                    ELSE is_available
                END
            WHERE id = v_item.id;
        END IF;
    END LOOP;

    UPDATE public.orders
    SET
        table_id = v_next_table_id,
        table_label = v_next_table_label,
        customer_note = COALESCE(p_order->>'customer_note', customer_note),
        status = COALESCE(NULLIF(BTRIM(p_order->>'status'), ''), status),
        workflow_step_id = CASE
            WHEN p_order ? 'workflow_step_id' THEN NULLIF(BTRIM(COALESCE(p_order->>'workflow_step_id', '')), '')
            ELSE workflow_step_id
        END,
        payment_method = COALESCE(NULLIF(BTRIM(p_order->>'payment_method'), ''), payment_method),
        payment_status = COALESCE(NULLIF(BTRIM(p_order->>'payment_status'), ''), payment_status),
        subtotal_amount = COALESCE((p_order->>'subtotal_amount')::NUMERIC, subtotal_amount),
        discount_amount = COALESCE((p_order->>'discount_amount')::NUMERIC, discount_amount),
        promo_discount_amount = COALESCE((p_order->>'promo_discount_amount')::NUMERIC, promo_discount_amount),
        manual_discount_amount = COALESCE((p_order->>'manual_discount_amount')::NUMERIC, manual_discount_amount),
        discount_code = CASE
            WHEN p_order ? 'discount_code' THEN NULLIF(BTRIM(COALESCE(p_order->>'discount_code', '')), '')
            ELSE discount_code
        END,
        total_amount = COALESCE((p_order->>'total_amount')::NUMERIC, total_amount),
        bill_version = GREATEST(1, COALESCE((p_order->>'bill_version')::INTEGER, bill_version)),
        items = COALESCE(p_order->'items', items),
        payment_idempotency_key = COALESCE(v_pay_idemp_key, payment_idempotency_key),
        paid_at = CASE
            WHEN NULLIF(BTRIM(COALESCE(p_order->>'paid_at', '')), '') IS NOT NULL
            THEN (p_order->>'paid_at')::TIMESTAMPTZ
            ELSE paid_at
        END,
        paid_by = COALESCE(NULLIF(BTRIM(COALESCE(p_order->>'paid_by', '')), ''), paid_by),
        refunded_at = CASE
            WHEN NULLIF(BTRIM(COALESCE(p_order->>'refunded_at', '')), '') IS NOT NULL
            THEN (p_order->>'refunded_at')::TIMESTAMPTZ
            ELSE refunded_at
        END,
        refund_reason = COALESCE(NULLIF(BTRIM(COALESCE(p_order->>'refund_reason', '')), ''), refund_reason),
        refunded_by = COALESCE(NULLIF(BTRIM(COALESCE(p_order->>'refunded_by', '')), ''), refunded_by),
        cancelled_reason = CASE
            WHEN p_order ? 'cancelled_reason' THEN NULLIF(BTRIM(COALESCE(p_order->>'cancelled_reason', '')), '')
            ELSE cancelled_reason
        END,
        cancel_reason = CASE
            WHEN p_order ? 'cancelled_reason' THEN NULLIF(BTRIM(COALESCE(p_order->>'cancelled_reason', '')), '')
            ELSE cancel_reason
        END,
        waste_recorded = COALESCE((p_order->>'waste_recorded')::BOOLEAN, waste_recorded),
        print_count = COALESCE((p_order->>'print_count')::INTEGER, print_count),
        kitchen_printed_count = COALESCE((p_order->>'kitchen_printed_count')::INTEGER, kitchen_printed_count),
        provisional_printed_count = COALESCE((p_order->>'provisional_printed_count')::INTEGER, provisional_printed_count),
        receipt_printed_count = COALESCE((p_order->>'receipt_printed_count')::INTEGER, receipt_printed_count),
        label_printed_count = GREATEST(0, COALESCE((p_order->>'label_printed_count')::INTEGER, label_printed_count)),
        last_printed_at = CASE
            WHEN NULLIF(BTRIM(COALESCE(p_order->>'last_printed_at', '')), '') IS NOT NULL
            THEN (p_order->>'last_printed_at')::TIMESTAMPTZ
            ELSE last_printed_at
        END,
        updated_at = COALESCE((p_order->>'updated_at')::TIMESTAMPTZ, NOW())
    WHERE id = p_order_id
    RETURNING * INTO v_updated;

    RETURN to_jsonb(v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.commit_order_with_inventory(JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_order_with_inventory(TEXT, JSONB, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_order_with_inventory(JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_order_with_inventory(TEXT, JSONB, JSONB, JSONB) TO service_role;
