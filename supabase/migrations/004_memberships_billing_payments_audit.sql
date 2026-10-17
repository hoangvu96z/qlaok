-- ============================================================================
-- QLAOK SHOP MEMBERSHIPS, GRANULAR RLS, TABLE BILLING & PAYMENT AUDIT (004)
-- 1. Shop Memberships (owner, cashier, staff) + email/full_name + granular permissions JSONB
-- 2. Order Audit Logs for status, item, discount, payment, and refund changes
-- 3. Extended Orders schema: session_id, bill_version, promo/manual discount,
--    payment_status ('unpaid' | 'paid' | 'refunded'), payment_idempotency_key,
--    paid_at/paid_by, refunded_at/refund_reason/refunded_by, waste_recorded,
--    and thermal ticket print counters
-- 4. Hardened RLS & Trigger helpers (fail-closed without relying on request.jwt.claim.role):
--    - Staff/cashier have realtime SELECT on orders; direct client mutations on
--      orders, shops, and shop_memberships are restricted to server/service_role
--      (with legacy direct owner compatibility and strict trigger boundaries).
-- ============================================================================

-- 1. Shop Memberships Table (aligned with ShopMembership record in src/lib/shop-permissions.ts)
CREATE TABLE IF NOT EXISTS public.shop_memberships (
    id TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    email TEXT DEFAULT NULL,
    full_name TEXT DEFAULT NULL,
    role VARCHAR(24) NOT NULL CHECK (role IN ('owner', 'cashier', 'staff')),
    permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (shop_id, user_id)
);

-- Ensure columns and constraints are idempotent if 004 was partially applied earlier
ALTER TABLE public.shop_memberships
ADD COLUMN IF NOT EXISTS email TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS full_name TEXT DEFAULT NULL;

ALTER TABLE public.shop_memberships
DROP CONSTRAINT IF EXISTS shop_memberships_user_id_fkey;

CREATE INDEX IF NOT EXISTS idx_shop_memberships_shop_user
ON public.shop_memberships(shop_id, user_id)
WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_shop_memberships_user
ON public.shop_memberships(user_id)
WHERE is_active = TRUE;

ALTER TABLE public.shop_memberships ENABLE ROW LEVEL SECURITY;

-- Backfill owner memberships for existing shops (idempotent)
INSERT INTO public.shop_memberships (id, shop_id, user_id, email, full_name, role, permissions, is_active)
SELECT
    'mem-owner-' || s.id || '-' || s.owner_id,
    s.id,
    s.owner_id,
    p.email,
    p.full_name,
    'owner',
    '["orders.view","orders.create","orders.fulfill","orders.edit_items","orders.cancel_unpaid","orders.print_kitchen","orders.print_provisional","payment.collect","discount.apply","payment.refund","catalog.view","catalog.manage","promotions.manage","settings.manage","settings.bank","reports.view","members.manage"]'::jsonb,
    TRUE
FROM public.shops s
LEFT JOIN public.profiles p ON p.id = s.owner_id
WHERE s.owner_id IS NOT NULL
ON CONFLICT (shop_id, user_id) DO UPDATE SET
    role = 'owner',
    email = COALESCE(public.shop_memberships.email, EXCLUDED.email),
    full_name = COALESCE(public.shop_memberships.full_name, EXCLUDED.full_name),
    is_active = TRUE;

-- 2. Order Audit Logs Table
CREATE TABLE IF NOT EXISTS public.order_audit_logs (
    id TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    order_id TEXT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    actor_user_id TEXT NOT NULL,
    actor_role VARCHAR(32) NOT NULL,
    action VARCHAR(64) NOT NULL,
    previous_state JSONB DEFAULT NULL,
    next_state JSONB DEFAULT NULL,
    reason TEXT DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_audit_logs_shop_order
ON public.order_audit_logs(shop_id, order_id, created_at DESC);

ALTER TABLE public.order_audit_logs ENABLE ROW LEVEL SECURITY;

-- 3. Extend Orders Table for Table Sessions, Discounts, Refunds, Waste & Print Counters
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12, 0) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS session_id VARCHAR(120) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS bill_version INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS promo_discount_amount NUMERIC(12, 0) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS manual_discount_amount NUMERIC(12, 0) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS discount_code VARCHAR(64) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS discount_reason TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS payment_idempotency_key VARCHAR(120) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS paid_by TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS refund_reason TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS refunded_by TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS waste_recorded BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS print_count INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS kitchen_printed_count INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS provisional_printed_count INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS receipt_printed_count INTEGER NOT NULL DEFAULT 0;

-- Allow 'refunded' in orders.payment_status check constraint (idempotent)
DO $$
DECLARE
    con_rec RECORD;
BEGIN
    FOR con_rec IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        JOIN pg_namespace n ON t.relnamespace = n.oid
        WHERE n.nspname = 'public'
          AND t.relname = 'orders'
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) ILIKE '%payment_status%'
    LOOP
        EXECUTE format('ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS %I', con_rec.conname);
    END LOOP;
END $$;

ALTER TABLE public.orders
DROP CONSTRAINT IF EXISTS orders_payment_status_check;

ALTER TABLE public.orders
ADD CONSTRAINT orders_payment_status_check
CHECK (payment_status IN ('unpaid', 'paid', 'refunded'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_shop_payment_idempotency
ON public.orders(shop_id, payment_idempotency_key)
WHERE payment_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_shop_session
ON public.orders(shop_id, session_id);

-- 4. Security Context & Permission Helper Functions for RLS and Triggers

-- 4.1 Fail-closed client context detector (does NOT rely solely on request.jwt.claim.role)
CREATE OR REPLACE FUNCTION public.is_client_request_context()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    jwt_role TEXT;
    claims_json TEXT;
    active_role TEXT;
    uid_text TEXT;
BEGIN
    jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
    IF jwt_role IS NULL THEN
        claims_json := NULLIF(current_setting('request.jwt.claims', true), '');
        IF claims_json IS NOT NULL THEN
            BEGIN
                jwt_role := NULLIF(claims_json::jsonb ->> 'role', '');
            EXCEPTION WHEN OTHERS THEN
                jwt_role := NULL;
            END;
        END IF;
    END IF;

    active_role := COALESCE(NULLIF(current_setting('role', true), ''), CURRENT_USER);

    -- Explicit service_role is trusted backend server execution
    IF jwt_role = 'service_role'
       OR active_role = 'service_role'
       OR CURRENT_USER = 'service_role'
       OR SESSION_USER = 'service_role' THEN
        RETURN FALSE;
    END IF;

    -- PostgREST anon/authenticated roles or any non-service JWT role are client requests
    IF active_role IN ('anon', 'authenticated')
       OR CURRENT_USER IN ('anon', 'authenticated')
       OR SESSION_USER IN ('anon', 'authenticated')
       OR jwt_role IS NOT NULL THEN
        RETURN TRUE;
    END IF;

    -- If auth.uid() is populated (e.g. JWT sub claim set without role claim), treat as client request
    BEGIN
        uid_text := NULLIF(auth.uid()::text, '');
    EXCEPTION WHEN OTHERS THEN
        uid_text := NULL;
    END;

    IF uid_text IS NOT NULL THEN
        RETURN TRUE;
    END IF;

    -- Direct database admin/migration session (postgres / supabase_admin) with no client JWT
    RETURN FALSE;
END;
$$;

-- 4.2 True shop owner helper (strictly verifies public.shops.owner_id = auth.uid())
CREATE OR REPLACE FUNCTION public.user_is_shop_owner(target_shop_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_user_id TEXT;
BEGIN
    BEGIN
        current_user_id := NULLIF(auth.uid()::text, '');
    EXCEPTION WHEN OTHERS THEN
        current_user_id := NULL;
    END;

    IF current_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM public.shops s
        WHERE s.id = target_shop_id
          AND s.owner_id = current_user_id
    );
END;
$$;

-- 4.3 Granular shop permission helper
CREATE OR REPLACE FUNCTION public.user_has_shop_permission(
    target_shop_id TEXT,
    required_permission TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_user_id TEXT;
    alt_permission TEXT;
BEGIN
    BEGIN
        current_user_id := NULLIF(auth.uid()::text, '');
    EXCEPTION WHEN OTHERS THEN
        current_user_id := NULL;
    END;

    IF current_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- True shop owner always holds all permissions on their shop
    IF EXISTS (
        SELECT 1 FROM public.shops s
        WHERE s.id = target_shop_id
          AND s.owner_id = current_user_id
    ) THEN
        RETURN TRUE;
    END IF;

    alt_permission := CASE required_permission
        WHEN 'order.view' THEN 'orders.view'
        WHEN 'orders.view' THEN 'order.view'
        WHEN 'order.refund' THEN 'payment.refund'
        WHEN 'payment.refund' THEN 'order.refund'
        WHEN 'staff.manage' THEN 'members.manage'
        WHEN 'members.manage' THEN 'staff.manage'
        WHEN 'inventory.adjust' THEN 'catalog.manage'
        ELSE required_permission
    END;

    -- Active shop member with either owner role or the specific permission in JSONB array
    RETURN EXISTS (
        SELECT 1 FROM public.shop_memberships m
        WHERE m.shop_id = target_shop_id
          AND m.user_id = current_user_id
          AND m.is_active = TRUE
          AND (
              m.role = 'owner'
              OR m.permissions ? required_permission
              OR m.permissions ? alt_permission
          )
    );
END;
$$;

-- 4.4 Harden profile plan escalation trigger to not rely solely on request.jwt.claim.role
CREATE OR REPLACE FUNCTION public.prevent_client_profile_plan_escalation()
RETURNS TRIGGER AS $$
BEGIN
    IF public.is_client_request_context() THEN
        IF NEW.plan IS DISTINCT FROM OLD.plan OR NEW.plan_expires_at IS DISTINCT FROM OLD.plan_expires_at THEN
            RAISE EXCEPTION 'FORBIDDEN_PLAN_MUTATION: Không được phép tự thay đổi gói cước từ phía client.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_profile_plan_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_profile_plan_escalation
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_client_profile_plan_escalation();

-- 5. Align RLS Policies & Triggers with Strict Ownership and Granular Server API Boundaries

-- 5.1 Shop Memberships:
-- Members can view their own membership; members.manage / owner can view shop memberships.
-- Direct client mutations on shop_memberships are restricted strictly to the true shop owner
-- (preventing members.manage from self-granting owner role or escalating privileges directly).
DROP POLICY IF EXISTS "shop_memberships_select" ON public.shop_memberships;
CREATE POLICY "shop_memberships_select"
ON public.shop_memberships FOR SELECT
USING (
    user_id = auth.uid()::text
    OR public.user_is_shop_owner(shop_id)
    OR public.user_has_shop_permission(shop_id, 'members.manage')
);

DROP POLICY IF EXISTS "shop_memberships_manage" ON public.shop_memberships;
CREATE POLICY "shop_memberships_manage"
ON public.shop_memberships FOR ALL
USING (public.user_is_shop_owner(shop_id))
WITH CHECK (public.user_is_shop_owner(shop_id));

CREATE OR REPLACE FUNCTION public.enforce_shop_membership_boundaries()
RETURNS TRIGGER AS $$
DECLARE
    target_shop TEXT;
BEGIN
    IF public.is_client_request_context() THEN
        target_shop := COALESCE(NEW.shop_id, OLD.shop_id);
        IF NOT public.user_is_shop_owner(target_shop) THEN
            RAISE EXCEPTION 'FORBIDDEN_MEMBERSHIP_MUTATION: Chỉ chủ quán gốc hoặc máy chủ mới được phép thay đổi trực tiếp phân quyền nhân sự.';
        END IF;
        IF TG_OP = 'UPDATE' AND NEW.shop_id IS DISTINCT FROM OLD.shop_id THEN
            RAISE EXCEPTION 'FORBIDDEN_MEMBERSHIP_SHOP_CHANGE: Không được phép chuyển nhân sự sang cửa hàng khác.';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_shop_membership_boundaries ON public.shop_memberships;
CREATE TRIGGER trg_enforce_shop_membership_boundaries
BEFORE INSERT OR UPDATE OR DELETE ON public.shop_memberships
FOR EACH ROW EXECUTE FUNCTION public.enforce_shop_membership_boundaries();

-- 5.2 Shops:
-- Public can read published shops; active shop members (orders.view) can read assigned shop.
-- Direct client mutations on shops are restricted strictly to the true shop owner (owner_id = auth.uid()::text);
-- delegated staff with settings.manage / promotions.manage / settings.bank must mutate via server API.
DROP POLICY IF EXISTS "shops_public_or_owner_select" ON public.shops;
CREATE POLICY "shops_public_or_owner_select"
ON public.shops FOR SELECT
USING (
    is_published = TRUE
    OR owner_id = auth.uid()::text
    OR public.user_has_shop_permission(id, 'orders.view')
);

DROP POLICY IF EXISTS "shops_owner_insert" ON public.shops;
CREATE POLICY "shops_owner_insert"
ON public.shops FOR INSERT
WITH CHECK (auth.uid()::text = owner_id);

DROP POLICY IF EXISTS "shops_owner_update" ON public.shops;
CREATE POLICY "shops_owner_update"
ON public.shops FOR UPDATE
USING (auth.uid()::text = owner_id)
WITH CHECK (auth.uid()::text = owner_id);

DROP POLICY IF EXISTS "shops_owner_delete" ON public.shops;
CREATE POLICY "shops_owner_delete"
ON public.shops FOR DELETE
USING (auth.uid()::text = owner_id);

CREATE OR REPLACE FUNCTION public.enforce_shop_update_boundaries()
RETURNS TRIGGER AS $$
BEGIN
    IF public.is_client_request_context() THEN
        IF NEW.id IS DISTINCT FROM OLD.id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
            RAISE EXCEPTION 'FORBIDDEN_SHOP_OWNERSHIP_MUTATION: Không được phép thay đổi định danh hoặc quyền sở hữu cửa hàng từ phía client.';
        END IF;

        IF NOT public.user_is_shop_owner(OLD.id) THEN
            RAISE EXCEPTION 'FORBIDDEN_SHOP_DIRECT_UPDATE: Chỉ chủ quán gốc mới được cập nhật trực tiếp bảng shops; nhân sự ủy quyền phải gọi qua API máy chủ.';
        END IF;

        IF (NEW.theme_config -> 'paymentQr') IS DISTINCT FROM (OLD.theme_config -> 'paymentQr')
           OR (NEW.theme_config -> 'paymentConfig') IS DISTINCT FROM (OLD.theme_config -> 'paymentConfig') THEN
            IF NOT public.user_has_shop_permission(OLD.id, 'settings.bank') THEN
                RAISE EXCEPTION 'FORBIDDEN_BANK_SETTINGS_MUTATION: Tài khoản không có quyền thay đổi cấu hình tài khoản ngân hàng (settings.bank).';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_shop_update_boundaries ON public.shops;
CREATE TRIGGER trg_enforce_shop_update_boundaries
BEFORE UPDATE ON public.shops
FOR EACH ROW EXECUTE FUNCTION public.enforce_shop_update_boundaries();

-- 5.3 Categories & Items: Members with orders.view / catalog.view can read; catalog.manage / inventory.adjust can write
DROP POLICY IF EXISTS "categories_public_or_owner_select" ON public.categories;
CREATE POLICY "categories_public_or_owner_select"
ON public.categories FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.shops s
        WHERE s.id = categories.shop_id
          AND (
              s.is_published = TRUE
              OR public.user_has_shop_permission(s.id, 'orders.view')
              OR public.user_has_shop_permission(s.id, 'catalog.view')
          )
    )
);

DROP POLICY IF EXISTS "categories_owner_write" ON public.categories;
CREATE POLICY "categories_owner_write"
ON public.categories FOR ALL
USING (public.user_has_shop_permission(shop_id, 'catalog.manage'))
WITH CHECK (public.user_has_shop_permission(shop_id, 'catalog.manage'));

DROP POLICY IF EXISTS "items_public_or_owner_select" ON public.items;
CREATE POLICY "items_public_or_owner_select"
ON public.items FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.shops s
        WHERE s.id = items.shop_id
          AND (
              s.is_published = TRUE
              OR public.user_has_shop_permission(s.id, 'orders.view')
              OR public.user_has_shop_permission(s.id, 'catalog.view')
          )
    )
);

DROP POLICY IF EXISTS "items_owner_write" ON public.items;
CREATE POLICY "items_owner_write"
ON public.items FOR ALL
USING (
    public.user_has_shop_permission(shop_id, 'catalog.manage')
    OR public.user_has_shop_permission(shop_id, 'inventory.adjust')
)
WITH CHECK (
    public.user_has_shop_permission(shop_id, 'catalog.manage')
    OR public.user_has_shop_permission(shop_id, 'inventory.adjust')
);

-- 5.4 Orders:
-- Active shop members with orders.view have read-only SELECT access (enabling Supabase Realtime subscriptions).
-- Direct client mutations on orders are restricted strictly to server/service_role (and legacy direct shop owner);
-- staff and cashier CANNOT directly UPDATE/INSERT/DELETE public.orders and must go through server API (/api/orders).
DROP POLICY IF EXISTS "Allow all orders access" ON public.orders;
DROP POLICY IF EXISTS "orders_owner_select" ON public.orders;
CREATE POLICY "orders_owner_select"
ON public.orders FOR SELECT
USING (
    public.user_has_shop_permission(shop_id, 'orders.view')
    AND (public.user_has_shop_permission(shop_id, 'reports.view')
         OR (status <> 'cancelled' AND (status <> 'completed' OR payment_status = 'unpaid')))
);

DROP POLICY IF EXISTS "orders_owner_update" ON public.orders;
CREATE POLICY "orders_owner_update"
ON public.orders FOR UPDATE
USING (public.user_is_shop_owner(shop_id))
WITH CHECK (public.user_is_shop_owner(shop_id));

CREATE OR REPLACE FUNCTION public.enforce_order_permission_boundaries()
RETURNS TRIGGER AS $$
BEGIN
    IF public.is_client_request_context() THEN
        -- Direct client mutations on orders are restricted to true shop owner only; staff/cashier are read-only
        IF NOT public.user_is_shop_owner(OLD.shop_id) THEN
            RAISE EXCEPTION 'FORBIDDEN_ORDER_DIRECT_MUTATION: Nhân viên và thu ngân chỉ có quyền xem đơn hàng realtime; mọi thao tác cập nhật phải qua máy chủ API.';
        END IF;

        -- Immutable identity & routing fields cannot be altered from client context
        IF NEW.id IS DISTINCT FROM OLD.id
           OR NEW.shop_id IS DISTINCT FROM OLD.shop_id
           OR NEW.order_code IS DISTINCT FROM OLD.order_code
           OR NEW.tracking_token IS DISTINCT FROM OLD.tracking_token THEN
            RAISE EXCEPTION 'FORBIDDEN_ORDER_IMMUTABLE_FIELD: Không được phép thay đổi mã đơn, cửa hàng hoặc tracking_token của đơn hàng.';
        END IF;

        -- Prevent reverting paid/refunded orders back to unpaid or mutating refunded payment status
        IF (OLD.payment_status IN ('paid', 'refunded') AND NEW.payment_status = 'unpaid')
           OR (OLD.payment_status = 'refunded' AND NEW.payment_status IS DISTINCT FROM 'refunded') THEN
            RAISE EXCEPTION 'FORBIDDEN_PAYMENT_STATUS_REVERT: Không được phép đảo ngược trạng thái thanh toán của đơn hàng đã thu tiền hoặc đã hoàn tiền.';
        END IF;

        -- Collecting payment requires payment.collect
        IF NEW.payment_status = 'paid' AND OLD.payment_status IS DISTINCT FROM 'paid' THEN
            IF NOT public.user_has_shop_permission(OLD.shop_id, 'payment.collect') THEN
                RAISE EXCEPTION 'FORBIDDEN_PAYMENT_COLLECT: Nhân viên không có quyền xác nhận thu tiền.';
            END IF;
        END IF;

        -- Refunding requires payment.refund / order.refund
        IF NEW.payment_status = 'refunded' AND OLD.payment_status IS DISTINCT FROM 'refunded' THEN
            IF NOT public.user_has_shop_permission(OLD.shop_id, 'payment.refund') THEN
                RAISE EXCEPTION 'FORBIDDEN_ORDER_REFUND: Tài khoản không có quyền hoàn tiền đơn hàng.';
            END IF;
        END IF;

        -- Applying or changing discounts requires discount.apply and unpaid order
        IF NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
           OR NEW.manual_discount_amount IS DISTINCT FROM OLD.manual_discount_amount
           OR NEW.promo_discount_amount IS DISTINCT FROM OLD.promo_discount_amount
           OR NEW.discount_code IS DISTINCT FROM OLD.discount_code THEN
            IF OLD.payment_status <> 'unpaid' THEN
                RAISE EXCEPTION 'FORBIDDEN_DISCOUNT_AFTER_PAYMENT: Không được phép sửa giảm giá sau khi đơn đã thanh toán.';
            END IF;
            IF NOT public.user_has_shop_permission(OLD.shop_id, 'discount.apply') THEN
                RAISE EXCEPTION 'FORBIDDEN_DISCOUNT_APPLY: Nhân viên không có quyền áp dụng giảm giá.';
            END IF;
        END IF;

        -- Editing order items or total_amount requires orders.edit_items and unpaid order
        IF NEW.items IS DISTINCT FROM OLD.items
           OR NEW.total_amount IS DISTINCT FROM OLD.total_amount THEN
            IF OLD.payment_status <> 'unpaid' THEN
                RAISE EXCEPTION 'FORBIDDEN_ITEMS_EDIT_AFTER_PAYMENT: Không được phép sửa món hoặc tổng tiền sau khi đơn đã thanh toán.';
            END IF;
            IF NOT public.user_has_shop_permission(OLD.shop_id, 'orders.edit_items') THEN
                RAISE EXCEPTION 'FORBIDDEN_ORDER_EDIT_ITEMS: Nhân viên không có quyền chỉnh sửa món/tổng tiền đơn hàng.';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_order_permission_boundaries ON public.orders;
CREATE TRIGGER trg_enforce_order_permission_boundaries
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_order_permission_boundaries();

-- 5.5 Analytics Events & Order Audit Logs: Restricted to reports.view
DROP POLICY IF EXISTS "analytics_owner_select" ON public.analytics_events;
CREATE POLICY "analytics_owner_select"
ON public.analytics_events FOR SELECT
USING (public.user_has_shop_permission(shop_id, 'reports.view'));

DROP POLICY IF EXISTS "order_audit_logs_select" ON public.order_audit_logs;
CREATE POLICY "order_audit_logs_select"
ON public.order_audit_logs FOR SELECT
USING (public.user_has_shop_permission(shop_id, 'reports.view'));

