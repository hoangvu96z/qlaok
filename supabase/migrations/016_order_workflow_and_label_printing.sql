-- ============================================================================
-- Migration 016: Order Workflow Step & Item-Label Print Counter Columns
--
-- Additive schema extension on public.orders:
-- 1. Adds workflow_step_id TEXT (nullable, defaults to NULL so existing orders
--    remain valid and resolve dynamically from canonical orders.status).
-- 2. Adds label_printed_count INTEGER NOT NULL DEFAULT 0 with nonnegative check
--    constraint orders_label_printed_count_check (label_printed_count >= 0).
-- 3. Preserves all existing orders.status constraints, triggers, payment
--    invariants, RPCs, and RLS policies without modification.
-- ============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS workflow_step_id TEXT,
  ADD COLUMN IF NOT EXISTS label_printed_count INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_label_printed_count_check'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_label_printed_count_check
      CHECK (label_printed_count >= 0);
  END IF;
END
$$;
