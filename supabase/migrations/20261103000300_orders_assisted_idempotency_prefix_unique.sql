-- Prevent concurrent assisted-order requests from reusing one staff/shop
-- attempt key with different request-intent fingerprints and both committing.
-- Stored key format:
--   assistv1:<actor_scope_hash16>:<raw_key_hash24>:<intent_fingerprint_hash24>
-- The stable attempt prefix is 51 characters.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.orders
    WHERE idempotency_key LIKE 'assistv1:%'
    GROUP BY shop_id, left(idempotency_key, 51)
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Duplicate public.orders assisted-order idempotency prefixes exist; reconcile the affected orders before applying idx_orders_shop_assistv1_idempotency_prefix.';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_shop_assistv1_idempotency_prefix
  ON public.orders (shop_id, left(idempotency_key, 51))
  WHERE idempotency_key LIKE 'assistv1:%';
