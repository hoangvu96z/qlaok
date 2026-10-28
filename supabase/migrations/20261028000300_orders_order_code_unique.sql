-- Preserve existing order identifiers and refuse to apply if historical codes
-- already collide. Operators can then reconcile those rows before retrying.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.orders
    GROUP BY order_code
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Duplicate public.orders.order_code values exist; reconcile the affected orders before applying the unique index.';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_code_unique
  ON public.orders (order_code);
