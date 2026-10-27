-- =========================================================================
-- QLAOK MIGRATION 022: POSTGRESQL REALTIME NOTIFICATIONS
-- =========================================================================
-- Publishes minimal notifications for INSERT/UPDATE/DELETE on public.orders
-- and public.table_service_requests over the 'qlaok_order_events' channel.
--
-- Security & Data Invariants:
--   1. Payloads contain ONLY minimal event metadata: table, eventType/action,
--      orderId (for orders), and shopId. Zero customer, item, or payment data.
--   2. Shop reassignment: when shop_id changes on UPDATE, both old and new
--      shops are notified so subscribers in both shops resync appropriately.
--   3. Deletions: derived from OLD (order_id, shop_id).
--   4. Triggers are AFTER triggers and RETURN NULL; never mutate business data.
--   5. Function is SECURITY DEFINER with restricted search_path.
--   6. RLS policies and table structures remain completely unchanged.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.notify_order_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_table text := TG_TABLE_NAME;
  v_op text := TG_OP;
  v_new_shop_id text;
  v_old_shop_id text;
  v_new_order_id text;
  v_old_order_id text;
BEGIN
  IF v_op = 'INSERT' THEN
    v_new_shop_id := NEW.shop_id::text;
    IF v_table = 'orders' THEN
      v_new_order_id := NEW.id::text;
    ELSE
      v_new_order_id := NULL;
    END IF;

    PERFORM pg_notify(
      'qlaok_order_events',
      json_build_object(
        'table', v_table,
        'eventType', v_op,
        'action', v_op,
        'orderId', v_new_order_id,
        'shopId', v_new_shop_id
      )::text
    );
  ELSIF v_op = 'UPDATE' THEN
    v_new_shop_id := NEW.shop_id::text;
    v_old_shop_id := OLD.shop_id::text;
    IF v_table = 'orders' THEN
      v_new_order_id := NEW.id::text;
      v_old_order_id := OLD.id::text;
    ELSE
      v_new_order_id := NULL;
      v_old_order_id := NULL;
    END IF;

    -- Notify for NEW shop
    PERFORM pg_notify(
      'qlaok_order_events',
      json_build_object(
        'table', v_table,
        'eventType', v_op,
        'action', v_op,
        'orderId', v_new_order_id,
        'shopId', v_new_shop_id
      )::text
    );

    -- If shop was reassigned, also notify the OLD shop so subscribers drop or refresh
    IF v_old_shop_id IS DISTINCT FROM v_new_shop_id AND v_old_shop_id IS NOT NULL THEN
      PERFORM pg_notify(
        'qlaok_order_events',
        json_build_object(
          'table', v_table,
          'eventType', v_op,
          'action', v_op,
          'orderId', coalesce(v_old_order_id, v_new_order_id),
          'shopId', v_old_shop_id
        )::text
      );
    END IF;
  ELSIF v_op = 'DELETE' THEN
    v_old_shop_id := OLD.shop_id::text;
    IF v_table = 'orders' THEN
      v_old_order_id := OLD.id::text;
    ELSE
      v_old_order_id := NULL;
    END IF;

    PERFORM pg_notify(
      'qlaok_order_events',
      json_build_object(
        'table', v_table,
        'eventType', v_op,
        'action', v_op,
        'orderId', v_old_order_id,
        'shopId', v_old_shop_id
      )::text
    );
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_realtime_notify ON public.orders;
CREATE TRIGGER trg_orders_realtime_notify
  AFTER INSERT OR UPDATE OR DELETE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_order_events();

DROP TRIGGER IF EXISTS trg_table_service_requests_realtime_notify ON public.table_service_requests;
CREATE TRIGGER trg_table_service_requests_realtime_notify
  AFTER INSERT OR UPDATE OR DELETE ON public.table_service_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_order_events();
