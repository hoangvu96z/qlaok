-- Keep catalog, shop deletion, and analytics mutations behind trusted server paths.
-- The application uses the service_role client for these mutations; mobile and
-- browser PostgREST clients only need read access to items and shops.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.items FROM PUBLIC, anon, authenticated;
DO $revoke_item_column_writes$
DECLARE
  item_columns TEXT;
BEGIN
  SELECT string_agg(format('%I', attname), ', ' ORDER BY attnum)
  INTO item_columns
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'public.items'::regclass
    AND attnum > 0
    AND NOT attisdropped;

  IF item_columns IS NOT NULL THEN
    EXECUTE format(
      'REVOKE INSERT (%1$s), UPDATE (%1$s) ON TABLE public.items FROM PUBLIC, anon, authenticated',
      item_columns
    );
  END IF;
END;
$revoke_item_column_writes$;
DROP POLICY IF EXISTS "items_owner_write" ON public.items;
DROP POLICY IF EXISTS "items_manager_select" ON public.items;
CREATE POLICY "items_manager_select"
ON public.items FOR SELECT
USING (
  public.user_has_shop_permission(shop_id, 'catalog.manage')
  OR public.user_has_shop_permission(shop_id, 'inventory.adjust')
);

-- Shop deletion cascades into orders and other historical records. The reviewed
-- admin_delete_owner_atomic RPC remains the only application deletion path.
REVOKE DELETE ON TABLE public.shops FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "shops_owner_delete" ON public.shops;

-- Analytics writes must pass through record_analytics_event_atomic.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.analytics_events FROM PUBLIC, anon, authenticated;
DO $revoke_analytics_column_inserts$
DECLARE
  analytics_columns TEXT;
BEGIN
  SELECT string_agg(format('%I', attname), ', ' ORDER BY attnum)
  INTO analytics_columns
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'public.analytics_events'::regclass
    AND attnum > 0
    AND NOT attisdropped;

  IF analytics_columns IS NOT NULL THEN
    EXECUTE format(
      'REVOKE INSERT (%s) ON TABLE public.analytics_events FROM PUBLIC, anon, authenticated',
      analytics_columns
    );
  END IF;
END;
$revoke_analytics_column_inserts$;
REVOKE USAGE, SELECT ON SEQUENCE public.analytics_events_id_seq FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "analytics_public_insert" ON public.analytics_events;

-- The trigger must see the owner's plan despite caller RLS and serialize item
-- creation per shop so concurrent inserts cannot race past Free/Basic limits.
CREATE OR REPLACE FUNCTION public.check_item_plan_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  owner_plan public.plan_tier;
  current_count INTEGER;
BEGIN
  IF NEW.shop_id IS NULL OR BTRIM(NEW.shop_id) = '' THEN
    RAISE EXCEPTION 'SHOP_NOT_FOUND';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('qlaok:item-plan:' || NEW.shop_id, 0)
  );

  SELECT p.plan INTO owner_plan
  FROM public.shops AS s
  LEFT JOIN public.profiles AS p ON p.id = s.owner_id
  WHERE s.id = NEW.shop_id;

  -- Let the existing shop_id foreign key retain its normal error for an
  -- unknown shop; an existing shop without an owner plan must fail closed.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF owner_plan IS NULL THEN
    RAISE EXCEPTION 'OWNER_PLAN_UNAVAILABLE';
  END IF;

  SELECT COUNT(*) INTO current_count
  FROM public.items
  WHERE shop_id = NEW.shop_id;

  IF owner_plan = 'free'::public.plan_tier AND current_count >= 5 THEN
    RAISE EXCEPTION 'PLAN_LIMIT_REACHED: Gói Miễn Phí chỉ hỗ trợ tối đa 5 món/dịch vụ. Vui lòng nâng cấp gói.';
  ELSIF owner_plan = 'basic'::public.plan_tier AND current_count >= 25 THEN
    RAISE EXCEPTION 'PLAN_LIMIT_REACHED: Gói Cơ Bản chỉ hỗ trợ tối đa 25 món/dịch vụ. Vui lòng nâng cấp lên gói Premium.';
  END IF;

  RETURN NEW;
END;
$$;

-- Migrations run as the database administrator; the trigger owner must bypass
-- RLS to count the authoritative plan/catalog rows for any PostgREST caller.
ALTER FUNCTION public.check_item_plan_limit() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.check_item_plan_limit() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
