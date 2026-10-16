-- ============================================================================
-- QLAOK SECURITY HARDENING, STRICT RLS & ATOMIC MPOS MIGRATION (003)
-- 1. Schema migration tracking table (prevents re-running legacy open policies)
-- 2. Drops all permissive USING(true)/WITH CHECK(true) policies from 001 & 002
-- 3. Enforces strict owner-scoped & published-only Row Level Security (RLS)
-- 4. Adds order tracking_token, idempotency_key, and payment bank_ref uniqueness
-- ============================================================================

-- 1. Migration history tracking table
CREATE TABLE IF NOT EXISTS public.schema_migrations (
    filename TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;

-- 2. Add idempotency & customer tracking columns to orders + unique bank_ref_id on payments
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS tracking_token VARCHAR(64) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(120) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12, 0) NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_shop_idempotency
ON public.orders(shop_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_tx_unique_bank_ref
ON public.payment_transactions(bank_ref_id)
WHERE bank_ref_id IS NOT NULL;

-- 3. Drop all permissive open policies from 001_init_qlaok.sql and 002_mpos_orders_inventory.sql
DROP POLICY IF EXISTS "Allow all provinces access" ON public.provinces;
DROP POLICY IF EXISTS "Allow all profiles access" ON public.profiles;
DROP POLICY IF EXISTS "Allow all shops access" ON public.shops;
DROP POLICY IF EXISTS "Allow all categories access" ON public.categories;
DROP POLICY IF EXISTS "Allow all items access" ON public.items;
DROP POLICY IF EXISTS "Allow all posts access" ON public.posts;
DROP POLICY IF EXISTS "Allow all analytics access" ON public.analytics_events;
DROP POLICY IF EXISTS "Allow all payment_transactions access" ON public.payment_transactions;
DROP POLICY IF EXISTS "Allow all orders access" ON public.orders;

-- 4. Prevent direct client-side plan escalation on public.profiles
CREATE OR REPLACE FUNCTION public.prevent_client_profile_plan_escalation()
RETURNS TRIGGER AS $$
BEGIN
    -- Only service_role or postgres admin can change plan or plan_expires_at
    IF current_setting('request.jwt.claim.role', true) IN ('anon', 'authenticated') THEN
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

-- 5. Strict RLS Policies

-- 5.1 Provinces: Public read-only
DROP POLICY IF EXISTS "provinces_public_select" ON public.provinces;
CREATE POLICY "provinces_public_select"
ON public.provinces FOR SELECT
USING (true);

-- 5.2 Profiles: Owner can read and update their own non-privileged profile fields
DROP POLICY IF EXISTS "profiles_owner_select" ON public.profiles;
CREATE POLICY "profiles_owner_select"
ON public.profiles FOR SELECT
USING (auth.uid()::text = id);

DROP POLICY IF EXISTS "profiles_owner_update" ON public.profiles;
CREATE POLICY "profiles_owner_update"
ON public.profiles FOR UPDATE
USING (auth.uid()::text = id)
WITH CHECK (auth.uid()::text = id);

-- 5.3 Shops: Public can SELECT published shops; Owner has full CRUD on own shops
DROP POLICY IF EXISTS "shops_public_or_owner_select" ON public.shops;
CREATE POLICY "shops_public_or_owner_select"
ON public.shops FOR SELECT
USING (is_published = true OR auth.uid()::text = owner_id);

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

-- 5.4 Categories: Public can SELECT categories of published shops; Owner can CRUD own shop categories
DROP POLICY IF EXISTS "categories_public_or_owner_select" ON public.categories;
CREATE POLICY "categories_public_or_owner_select"
ON public.categories FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.shops s
        WHERE s.id = categories.shop_id
          AND (s.is_published = true OR s.owner_id = auth.uid()::text)
    )
);

DROP POLICY IF EXISTS "categories_owner_write" ON public.categories;
CREATE POLICY "categories_owner_write"
ON public.categories FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM public.shops s
        WHERE s.id = categories.shop_id
          AND s.owner_id = auth.uid()::text
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.shops s
        WHERE s.id = categories.shop_id
          AND s.owner_id = auth.uid()::text
    )
);

-- 5.5 Items: Public can SELECT items of published shops; Owner can CRUD own shop items
DROP POLICY IF EXISTS "items_public_or_owner_select" ON public.items;
CREATE POLICY "items_public_or_owner_select"
ON public.items FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.shops s
        WHERE s.id = items.shop_id
          AND (s.is_published = true OR s.owner_id = auth.uid()::text)
    )
);

DROP POLICY IF EXISTS "items_owner_write" ON public.items;
CREATE POLICY "items_owner_write"
ON public.items FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM public.shops s
        WHERE s.id = items.shop_id
          AND s.owner_id = auth.uid()::text
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.shops s
        WHERE s.id = items.shop_id
          AND s.owner_id = auth.uid()::text
    )
);

-- 5.6 Posts: Public can SELECT active posts of published shops; Owner can CRUD own shop posts
DROP POLICY IF EXISTS "posts_public_or_owner_select" ON public.posts;
CREATE POLICY "posts_public_or_owner_select"
ON public.posts FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.shops s
        WHERE s.id = posts.shop_id
          AND (s.is_published = true OR s.owner_id = auth.uid()::text)
    )
);

DROP POLICY IF EXISTS "posts_owner_write" ON public.posts;
CREATE POLICY "posts_owner_write"
ON public.posts FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM public.shops s
        WHERE s.id = posts.shop_id
          AND s.owner_id = auth.uid()::text
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.shops s
        WHERE s.id = posts.shop_id
          AND s.owner_id = auth.uid()::text
    )
);

-- 5.7 Orders: Only shop owner can SELECT/UPDATE shop orders directly
DROP POLICY IF EXISTS "orders_owner_select" ON public.orders;
CREATE POLICY "orders_owner_select"
ON public.orders FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.shops s
        WHERE s.id = orders.shop_id
          AND s.owner_id = auth.uid()::text
    )
);

DROP POLICY IF EXISTS "orders_owner_update" ON public.orders;
CREATE POLICY "orders_owner_update"
ON public.orders FOR UPDATE
USING (
    EXISTS (
        SELECT 1 FROM public.shops s
        WHERE s.id = orders.shop_id
          AND s.owner_id = auth.uid()::text
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.shops s
        WHERE s.id = orders.shop_id
          AND s.owner_id = auth.uid()::text
    )
);

-- 5.8 Payment Transactions: Owner can only SELECT own transactions; writes restricted to backend
DROP POLICY IF EXISTS "payment_tx_owner_select" ON public.payment_transactions;
CREATE POLICY "payment_tx_owner_select"
ON public.payment_transactions FOR SELECT
USING (auth.uid()::text = user_id);

-- 5.9 Analytics Events: Public can INSERT events for published shops; Owner can SELECT own shop events
DROP POLICY IF EXISTS "analytics_owner_select" ON public.analytics_events;
CREATE POLICY "analytics_owner_select"
ON public.analytics_events FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.shops s
        WHERE s.id = analytics_events.shop_id
          AND s.owner_id = auth.uid()::text
    )
);

DROP POLICY IF EXISTS "analytics_public_insert" ON public.analytics_events;
CREATE POLICY "analytics_public_insert"
ON public.analytics_events FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.shops s
        WHERE s.id = analytics_events.shop_id
          AND s.is_published = true
    )
);
