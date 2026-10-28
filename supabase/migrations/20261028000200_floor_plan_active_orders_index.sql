CREATE INDEX IF NOT EXISTS idx_orders_floor_plan_open_by_shop
  ON public.orders (shop_id, status, payment_status);
