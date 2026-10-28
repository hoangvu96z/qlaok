-- ============================================================================
-- Prevent concurrent Counter POS requests that reuse the same (shop_id, actor,
-- raw idempotency_key) with different request intents from committing two
-- distinct `posv1:<actor16>:<rawkey24>:<intent24>` orders.
--
-- Format of `posv1:` stored idempotency keys:
--   `posv1:<actor_scope_hash16>:<raw_key_hash24>:<intent_fingerprint_hash24>`
--   Prefix up to and including the third colon is 48 characters:
--   `left(idempotency_key, 48)` = `posv1:<actor16>:<rawkey24>:`
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.orders
    WHERE idempotency_key LIKE 'posv1:%'
    GROUP BY shop_id, left(idempotency_key, 48)
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Duplicate public.orders POS v1 idempotency key prefixes exist; reconcile the affected orders before applying idx_orders_shop_posv1_idempotency_prefix.';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_shop_posv1_idempotency_prefix
  ON public.orders (shop_id, left(idempotency_key, 48))
  WHERE idempotency_key LIKE 'posv1:%';
