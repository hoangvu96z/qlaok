-- ============================================================================
-- QLAOK (Q-Smart) — Migration 007: Merchant-Managed Shop Tables & Order Table Link
-- 1. Adds public.shop_tables with shop-scoped unique table_code and active name,
--    RLS policies, owner-only mutation boundary trigger, and archive protection
-- 2. Adds public.orders.table_id foreign key + index + historical table_label snapshot
-- 3. Extends enforce_order_state_and_payment_invariants and atomic RPCs
--    (commit_order_with_inventory, update_order_with_inventory, settle_table_bill_atomic)
--    to validate table ownership/activity while preserving all 004/005 invariants
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.shop_tables (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    shop_id TEXT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    table_code TEXT NOT NULL,
    name TEXT NOT NULL,
    section TEXT NOT NULL DEFAULT '',
    capacity INTEGER NOT NULL DEFAULT 4 CHECK (capacity >= 1 AND capacity <= 200),
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    archived_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_tables_shop_code_unique
    ON public.shop_tables (shop_id, LOWER(BTRIM(table_code)));

CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_tables_shop_active_name_unique
    ON public.shop_tables (shop_id, LOWER(BTRIM(name)))
    WHERE is_archived = FALSE;

CREATE INDEX IF NOT EXISTS idx_shop_tables_shop_sort
    ON public.shop_tables (shop_id, is_archived, is_active, sort_order);

-- Seed default managed tables for seeded demo shops when present
INSERT INTO public.shop_tables (
    id,
    shop_id,
    table_code,
    name,
    section,
    capacity,
    sort_order,
    is_active,
    is_archived
)
SELECT
    v.id,
    v.shop_id,
    v.table_code,
    v.name,
    v.section,
    v.capacity,
    v.sort_order,
    TRUE,
    FALSE
FROM (
    VALUES
        ('tbl-fnb-01', 'shop-fnb-001', 'T01', 'Bàn 01', 'Tầng 1', 4, 1),
        ('tbl-fnb-02', 'shop-fnb-001', 'T02', 'Bàn 02', 'Tầng 1', 4, 2),
        ('tbl-fnb-03', 'shop-fnb-001', 'T03', 'Bàn 03', 'Tầng 1', 4, 3),
        ('tbl-fnb-04', 'shop-fnb-001', 'T04', 'Bàn 04', 'Tầng 1', 4, 4),
        ('tbl-fnb-05', 'shop-fnb-001', 'T05', 'Bàn 05', 'Tầng 1', 6, 5),
        ('tbl-fnb-06', 'shop-fnb-001', 'T06', 'Bàn 06', 'Tầng 2', 4, 6),
        ('tbl-fnb-07', 'shop-fnb-001', 'T07', 'Bàn 07', 'Tầng 2', 4, 7),
        ('tbl-fnb-08', 'shop-fnb-001', 'T08', 'Bàn 08', 'Tầng 2', 6, 8),
        ('tbl-fnb-09', 'shop-fnb-001', 'T09', 'Bàn 09', 'Sân vườn', 4, 9),
        ('tbl-fnb-10', 'shop-fnb-001', 'T10', 'Bàn 10', 'Sân vườn', 6, 10),
        ('tbl-fnb-11', 'shop-fnb-001', 'T11', 'Bàn 11', 'Sân vườn', 4, 11),
        ('tbl-fnb-12', 'shop-fnb-001', 'T12', 'Bàn 12', 'Phòng VIP', 8, 12),
        ('tbl-service-01', 'shop-service-001', 'R01', 'Phòng 01', 'Khu Spa', 2, 1),
        ('tbl-service-02', 'shop-service-001', 'R02', 'Phòng 02', 'Khu Spa', 2, 2),
        ('tbl-service-03', 'shop-service-001', 'R03', 'Phòng VIP 01', 'Khu VIP', 4, 3),
        ('tbl-service2-01', 'shop-service-002', 'R01', 'Phòng 01', 'Khu Spa', 2, 1),
        ('tbl-service2-02', 'shop-service-002', 'R02', 'Phòng 02', 'Khu Spa', 2, 2),
        ('tbl-service2-03', 'shop-service-002', 'R03', 'Phòng VIP 01', 'Khu VIP', 4, 3),
        ('tbl-retail-01', 'shop-retail-001', 'C01', 'Quầy 01', 'Khu chính', 2, 1),
        ('tbl-retail-02', 'shop-retail-001', 'C02', 'Quầy 02', 'Khu chính', 2, 2),
        ('tbl-retail3-01', 'shop-retail-003', 'C01', 'Quầy 01', 'Khu chính', 2, 1),
        ('tbl-retail3-02', 'shop-retail-003', 'C02', 'Quầy 02', 'Khu chính', 2, 2)
) AS v(id, shop_id, table_code, name, section, capacity, sort_order)
WHERE EXISTS (
    SELECT 1 FROM public.shops s WHERE s.id = v.shop_id
)
ON CONFLICT DO NOTHING;

-- Add table_id column to orders while keeping table_label as historical snapshot
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS table_id TEXT DEFAULT NULL REFERENCES public.shop_tables(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_shop_table_id
    ON public.orders (shop_id, table_id, created_at DESC);

-- Backfill existing orders that match a seeded/configured table name or code in the same shop
UPDATE public.orders o
SET table_id = st.id
FROM public.shop_tables st
WHERE o.table_id IS NULL
  AND o.shop_id = st.shop_id
  AND (
      LOWER(BTRIM(COALESCE(o.table_label, ''))) = LOWER(BTRIM(st.name))
      OR LOWER(BTRIM(COALESCE(o.table_label, ''))) = LOWER(BTRIM(st.table_code))
  );

-- Enable RLS and enforce owner-only table mutations
ALTER TABLE public.shop_tables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shop_tables_select" ON public.shop_tables;
DROP POLICY IF EXISTS "shop_tables_owner_insert" ON public.shop_tables;
DROP POLICY IF EXISTS "shop_tables_owner_update" ON public.shop_tables;
DROP POLICY IF EXISTS "shop_tables_owner_delete" ON public.shop_tables;

CREATE POLICY "shop_tables_select"
ON public.shop_tables FOR SELECT
USING (
    public.user_is_shop_owner(shop_id)
    OR public.user_has_shop_permission(shop_id, 'orders.view')
    OR public.user_has_shop_permission(shop_id, 'catalog.view')
    OR (
        is_active = TRUE
        AND is_archived = FALSE
        AND EXISTS (
            SELECT 1
            FROM public.shops s
            WHERE s.id = shop_tables.shop_id
              AND s.is_published = TRUE
        )
    )
);

CREATE POLICY "shop_tables_owner_insert"
ON public.shop_tables FOR INSERT
WITH CHECK (public.user_is_shop_owner(shop_id));

CREATE POLICY "shop_tables_owner_update"
ON public.shop_tables FOR UPDATE
USING (public.user_is_shop_owner(shop_id))
WITH CHECK (public.user_is_shop_owner(shop_id));

CREATE POLICY "shop_tables_owner_delete"
ON public.shop_tables FOR DELETE
USING (public.user_is_shop_owner(shop_id));

CREATE OR REPLACE FUNCTION public.enforce_shop_table_boundaries()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_target_shop_id TEXT;
BEGIN
    v_target_shop_id := COALESCE(NEW.shop_id, OLD.shop_id);

    IF public.is_client_request_context() AND NOT public.user_is_shop_owner(v_target_shop_id) THEN
        RAISE EXCEPTION 'OWNER_TABLE_PERMISSION_REQUIRED: Chỉ chủ quán gốc hoặc máy chủ mới được phép thay đổi danh sách bàn.';
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF EXISTS (SELECT 1 FROM public.orders o WHERE o.table_id = OLD.id) THEN
            RAISE EXCEPTION 'TABLE_HAS_HISTORICAL_ORDERS_ARCHIVE_INSTEAD: Bàn đã có lịch sử đơn hàng, vui lòng lưu trữ (archive) thay vì xóa vĩnh viễn.';
        END IF;
        RETURN OLD;
    END IF;

    NEW.table_code := BTRIM(COALESCE(NEW.table_code, ''));
    NEW.name := BTRIM(COALESCE(NEW.name, ''));
    NEW.section := BTRIM(COALESCE(NEW.section, ''));

    IF NEW.table_code = '' THEN
        RAISE EXCEPTION 'TABLE_CODE_REQUIRED: Mã bàn không được để trống.';
    END IF;

    IF NEW.name = '' THEN
        RAISE EXCEPTION 'TABLE_NAME_REQUIRED: Tên bàn không được để trống.';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.id IS DISTINCT FROM OLD.id OR NEW.shop_id IS DISTINCT FROM OLD.shop_id THEN
            RAISE EXCEPTION 'IMMUTABLE_SHOP_TABLE_IDENTITY: Không được phép thay đổi id hoặc shop_id của bàn.';
        END IF;
        NEW.updated_at := NOW();
    END IF;

    IF COALESCE(NEW.is_archived, FALSE) = TRUE THEN
        NEW.is_active := FALSE;
        NEW.archived_at := COALESCE(NEW.archived_at, NOW());
    ELSE
        NEW.is_archived := FALSE;
        NEW.archived_at := NULL;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_shop_table_boundaries ON public.shop_tables;
CREATE TRIGGER trg_enforce_shop_table_boundaries
BEFORE INSERT OR UPDATE OR DELETE ON public.shop_tables
FOR EACH ROW EXECUTE FUNCTION public.enforce_shop_table_boundaries();

-- Extend order state & payment invariants trigger with table_id ownership and active checks
CREATE OR REPLACE FUNCTION public.enforce_order_state_and_payment_invariants()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_table public.shop_tables%ROWTYPE;
BEGIN
    IF NEW.status NOT IN ('new', 'preparing', 'completed', 'cancelled') THEN
        RAISE EXCEPTION 'INVALID_STATUS: Trạng thái đơn "%" không hợp lệ.', NEW.status;
    END IF;

    IF NEW.payment_status NOT IN ('unpaid', 'paid', 'refunded') THEN
        RAISE EXCEPTION 'INVALID_PAYMENT_STATUS: Trạng thái thanh toán "%" không hợp lệ.', NEW.payment_status;
    END IF;

    IF NEW.table_id IS NOT NULL AND BTRIM(NEW.table_id) = '' THEN
        NEW.table_id := NULL;
    END IF;

    IF NEW.table_id IS NOT NULL THEN
        SELECT * INTO v_table
        FROM public.shop_tables
        WHERE id = NEW.table_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'INVALID_SHOP_TABLE: Bàn "%" không tồn tại.', NEW.table_id;
        END IF;

        IF v_table.shop_id IS DISTINCT FROM NEW.shop_id THEN
            RAISE EXCEPTION 'INVALID_TABLE_SHOP: Bàn "%" không thuộc cửa hàng này.', NEW.table_id;
        END IF;

        IF TG_OP = 'INSERT' OR NEW.table_id IS DISTINCT FROM OLD.table_id THEN
            IF v_table.is_active IS NOT TRUE OR v_table.is_archived IS TRUE THEN
                RAISE EXCEPTION 'INACTIVE_SHOP_TABLE: Bàn "%" hiện đang tạm ngưng hoặc đã lưu trữ.', v_table.name;
            END IF;
            NEW.table_label := v_table.name;
        ELSIF BTRIM(COALESCE(NEW.table_label, '')) = '' THEN
            NEW.table_label := v_table.name;
        END IF;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.payment_status = 'refunded' THEN
            RAISE EXCEPTION 'INVALID_PAYMENT_TRANSITION: Không thể tạo đơn mới ở trạng thái hoàn tiền (refunded).';
        END IF;
        IF NEW.status = 'cancelled' AND NEW.payment_status = 'paid' THEN
            RAISE EXCEPTION 'INVALID_PAYMENT_TRANSITION: Không thể thu tiền cho đơn hàng đã hủy (cancelled).';
        END IF;
        RETURN NEW;
    END IF;

    -- TG_OP = 'UPDATE'
    IF OLD.status = 'completed' AND NEW.status = 'new' THEN
        RAISE EXCEPTION 'INVALID_STATE_TRANSITION: Đơn hàng đã hoàn tất không thể chuyển ngược về trạng thái mới.';
    END IF;

    IF OLD.payment_status = 'paid' AND NEW.payment_status = 'unpaid' THEN
        RAISE EXCEPTION 'INVALID_PAYMENT_TRANSITION: Đơn hàng đã thanh toán (paid) không thể chuyển ngược về chưa thanh toán (unpaid).';
    END IF;

    IF OLD.payment_status = 'refunded' AND NEW.payment_status <> 'refunded' THEN
        RAISE EXCEPTION 'INVALID_PAYMENT_TRANSITION: Đơn hàng đã hoàn tiền (refunded) không thể chuyển sang "%".', NEW.payment_status;
    END IF;

    IF OLD.payment_status = 'unpaid' AND NEW.payment_status = 'refunded' THEN
        RAISE EXCEPTION 'INVALID_PAYMENT_TRANSITION: Đơn hàng chưa thanh toán (unpaid) không thể hoàn tiền (refunded).';
    END IF;

    IF (OLD.status = 'cancelled' OR NEW.status = 'cancelled')
       AND NEW.payment_status = 'paid'
       AND OLD.payment_status <> 'paid' THEN
        RAISE EXCEPTION 'INVALID_PAYMENT_TRANSITION: Không thể xác nhận thu tiền cho đơn hàng đã hủy (cancelled).';
    END IF;

    IF OLD.payment_status = 'refunded' AND OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
        RAISE EXCEPTION 'INVALID_STATE_TRANSITION: Đơn hàng đã hoàn tiền và hủy không thể mở lại.';
    END IF;

    -- Lock items, subtotal, discounts, total, and table assignment once order is paid or refunded
    IF OLD.payment_status IN ('paid', 'refunded') THEN
        IF NEW.items IS DISTINCT FROM OLD.items
           OR NEW.subtotal_amount IS DISTINCT FROM OLD.subtotal_amount
           OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
           OR NEW.promo_discount_amount IS DISTINCT FROM OLD.promo_discount_amount
           OR NEW.manual_discount_amount IS DISTINCT FROM OLD.manual_discount_amount
           OR NEW.discount_code IS DISTINCT FROM OLD.discount_code
           OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
           OR NEW.table_id IS DISTINCT FROM OLD.table_id
           OR NEW.table_label IS DISTINCT FROM OLD.table_label THEN
            RAISE EXCEPTION 'ORDER_ALREADY_PAID: Không thể sửa món, bàn hoặc giảm giá khi đơn hàng đã thanh toán hoặc đã hoàn tiền.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- Update atomic order creation RPC to support table_id / table_code and snapshot table_label
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

CREATE OR REPLACE FUNCTION public.settle_table_bill_atomic(
    p_shop_id TEXT,
    p_session_id TEXT DEFAULT NULL,
    p_table_label TEXT DEFAULT NULL,
    p_payment_method TEXT DEFAULT 'cash',
    p_payment_idempotency_key TEXT DEFAULT NULL,
    p_paid_by TEXT DEFAULT NULL,
    p_mark_completed BOOLEAN DEFAULT FALSE,
    p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_session TEXT;
    v_table TEXT;
    v_target_table_id TEXT;
    v_batch_key TEXT;
    v_replayed JSONB;
    v_settled JSONB;
BEGIN
    IF BTRIM(COALESCE(p_shop_id, '')) = '' THEN
        RAISE EXCEPTION 'MISSING_SHOP_ID: Thiếu mã cửa hàng (shop_id).';
    END IF;

    v_session := NULLIF(BTRIM(COALESCE(p_session_id, '')), '');
    v_table := NULLIF(LOWER(BTRIM(COALESCE(p_table_label, ''))), '');
    v_batch_key := NULLIF(BTRIM(COALESCE(p_payment_idempotency_key, '')), '');

    IF v_session IS NULL AND v_table IS NULL THEN
        RAISE EXCEPTION 'TABLE_BILL_EMPTY: Vui lòng cung cấp session_id hoặc table_label để tất toán bàn.';
    END IF;

    IF v_session IS NULL AND v_table IS NOT NULL THEN
        -- First prefer exact match on shop_tables.id in this shop
        SELECT st.id INTO v_target_table_id
        FROM public.shop_tables st
        WHERE st.shop_id = p_shop_id
          AND LOWER(BTRIM(st.id)) = v_table
        LIMIT 1;

        -- Otherwise match an unarchived managed table by code or name
        IF v_target_table_id IS NULL THEN
            SELECT st.id INTO v_target_table_id
            FROM public.shop_tables st
            WHERE st.shop_id = p_shop_id
              AND st.is_archived = FALSE
              AND (
                  LOWER(BTRIM(st.name)) = v_table
                  OR LOWER(BTRIM(st.table_code)) = v_table
              )
            ORDER BY st.is_active DESC, st.sort_order ASC
            LIMIT 1;
        END IF;
    END IF;

    -- 1. Check idempotent replay first: if v_batch_key was already processed,
    --    return the exact orders settled by that key without charging any new rounds!
    IF v_batch_key IS NOT NULL THEN
        PERFORM 1
        FROM public.orders o
        WHERE o.shop_id = p_shop_id
          AND (
              o.payment_idempotency_key = v_batch_key
              OR LEFT(o.payment_idempotency_key, LENGTH(v_batch_key) + 1) = v_batch_key || ':'
          )
        FOR UPDATE;

        IF FOUND THEN
            IF v_session IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.orders o
                WHERE o.shop_id = p_shop_id
                  AND (o.payment_idempotency_key = v_batch_key OR LEFT(o.payment_idempotency_key, LENGTH(v_batch_key) + 1) = v_batch_key || ':')
                  AND COALESCE(o.session_id, '') <> v_session
            ) THEN
                RAISE EXCEPTION 'DUPLICATE_PAYMENT_IDEMPOTENCY_KEY: Mã khóa thanh toán gộp bàn đã được sử dụng cho phiên bàn khác.';
            END IF;

            IF v_session IS NULL AND v_table IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.orders o
                WHERE o.shop_id = p_shop_id
                  AND (o.payment_idempotency_key = v_batch_key OR LEFT(o.payment_idempotency_key, LENGTH(v_batch_key) + 1) = v_batch_key || ':')
                  AND (
                      (v_target_table_id IS NOT NULL AND COALESCE(o.table_id, '') <> v_target_table_id)
                      OR (v_target_table_id IS NULL AND LOWER(BTRIM(o.table_label)) <> v_table)
                  )
            ) THEN
                RAISE EXCEPTION 'DUPLICATE_PAYMENT_IDEMPOTENCY_KEY: Mã khóa thanh toán gộp bàn đã được sử dụng cho bàn khác.';
            END IF;

            SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY o.created_at ASC), '[]'::jsonb)
            INTO v_replayed
            FROM public.orders o
            WHERE o.shop_id = p_shop_id
              AND (
                  o.payment_idempotency_key = v_batch_key
                  OR LEFT(o.payment_idempotency_key, LENGTH(v_batch_key) + 1) = v_batch_key || ':'
              );

            RETURN v_replayed;
        END IF;
    ELSE
        v_batch_key := 'pay-table-' || EXTRACT(EPOCH FROM p_now)::BIGINT::TEXT;
    END IF;

    -- 2. Lock strictly UNPAID, non-cancelled orders for the target session or table
    PERFORM 1
    FROM public.orders o
    WHERE o.shop_id = p_shop_id
      AND o.status <> 'cancelled'
      AND o.payment_status = 'unpaid'
      AND (
          (v_session IS NOT NULL AND o.session_id = v_session)
          OR (
              v_session IS NULL
              AND v_table IS NOT NULL
              AND (
                  (v_target_table_id IS NOT NULL AND o.table_id = v_target_table_id)
                  OR (v_target_table_id IS NULL AND o.table_id IS NULL AND LOWER(BTRIM(o.table_label)) = v_table)
              )
          )
      )
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'TABLE_BILL_EMPTY: Không tìm thấy đơn hàng chưa thanh toán nào cho bàn này.';
    END IF;

    WITH updated_rows AS (
        UPDATE public.orders o
        SET
            status = CASE WHEN p_mark_completed THEN 'completed' ELSE o.status END,
            payment_method = COALESCE(NULLIF(BTRIM(p_payment_method), ''), o.payment_method),
            payment_status = 'paid',
            payment_idempotency_key = v_batch_key || ':' || o.id,
            paid_at = p_now,
            paid_by = COALESCE(NULLIF(BTRIM(p_paid_by), ''), o.paid_by),
            updated_at = p_now
        WHERE o.shop_id = p_shop_id
          AND o.status <> 'cancelled'
          AND o.payment_status = 'unpaid'
          AND (
              (v_session IS NOT NULL AND o.session_id = v_session)
              OR (
                  v_session IS NULL
                  AND v_table IS NOT NULL
                  AND (
                      (v_target_table_id IS NOT NULL AND o.table_id = v_target_table_id)
                      OR (v_target_table_id IS NULL AND o.table_id IS NULL AND LOWER(BTRIM(o.table_label)) = v_table)
                  )
              )
          )
        RETURNING o.*
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(u) ORDER BY u.created_at ASC), '[]'::jsonb)
    INTO v_settled
    FROM updated_rows u;

    RETURN v_settled;
END;
$$;

GRANT SELECT ON public.shop_tables TO anon, authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON public.shop_tables TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.commit_order_with_inventory(JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_order_with_inventory(TEXT, JSONB, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_table_bill_atomic(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.commit_order_with_inventory(JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_order_with_inventory(TEXT, JSONB, JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_table_bill_atomic(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ) TO service_role;
