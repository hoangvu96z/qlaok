-- =========================================================================
-- QLAOK MIGRATION 012: PERSISTENT TABLE FLOOR PLAN LAYOUT COORDINATES
-- =========================================================================
-- Adds nullable integer percentage coordinates (layout_x, layout_y in [0, 100])
-- to public.shop_tables so merchants can persist a visual table floor plan.
-- Old/unpositioned tables remain valid with NULL coordinates; no automatic
-- fallback coordinates are written.
-- =========================================================================

ALTER TABLE public.shop_tables
  ADD COLUMN IF NOT EXISTS layout_x INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS layout_y INTEGER DEFAULT NULL;

ALTER TABLE public.shop_tables
  DROP CONSTRAINT IF EXISTS shop_tables_layout_x_range_check;

ALTER TABLE public.shop_tables
  ADD CONSTRAINT shop_tables_layout_x_range_check
  CHECK (layout_x IS NULL OR (layout_x >= 0 AND layout_x <= 100));

ALTER TABLE public.shop_tables
  DROP CONSTRAINT IF EXISTS shop_tables_layout_y_range_check;

ALTER TABLE public.shop_tables
  ADD CONSTRAINT shop_tables_layout_y_range_check
  CHECK (layout_y IS NULL OR (layout_y >= 0 AND layout_y <= 100));

CREATE INDEX IF NOT EXISTS idx_orders_shop_table_floor_status
  ON public.orders (shop_id, table_id, status, payment_status)
  WHERE table_id IS NOT NULL AND status <> 'cancelled';
