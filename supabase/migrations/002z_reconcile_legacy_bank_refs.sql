-- Run before 003 adds the unique bank reference index. Legacy imports/webhooks
-- could attach one bank transfer to multiple plan-payment rows. Keep every
-- transaction and its financial fields; archive the full conflicting group for
-- manual reconciliation before removing duplicate reference assignments.
BEGIN;
LOCK TABLE public.payment_transactions IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS public.payment_bank_ref_conflicts (
    transaction_id TEXT PRIMARY KEY,
    original_bank_ref_id TEXT NOT NULL,
    retained_transaction_id TEXT NOT NULL,
    original_transaction JSONB NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.payment_bank_ref_conflicts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_bank_ref_conflicts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_bank_ref_conflicts TO service_role;

-- Deterministic retention is for replay protection only, not a determination of
-- which customer's entitlement is correct. Status, amount and plan are untouched.
WITH ranked AS (
    SELECT p.*,
        FIRST_VALUE(id) OVER (PARTITION BY bank_ref_id ORDER BY created_at, id) AS retained_id,
        COUNT(*) OVER (PARTITION BY bank_ref_id) AS ref_count
    FROM public.payment_transactions p WHERE bank_ref_id IS NOT NULL
)
INSERT INTO public.payment_bank_ref_conflicts
    (transaction_id, original_bank_ref_id, retained_transaction_id, original_transaction)
SELECT id, bank_ref_id, retained_id,
    (SELECT to_jsonb(p) FROM public.payment_transactions p WHERE p.id = ranked.id)
FROM ranked WHERE ref_count > 1
ON CONFLICT (transaction_id) DO NOTHING;

WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY bank_ref_id ORDER BY created_at, id) AS ref_rank
    FROM public.payment_transactions WHERE bank_ref_id IS NOT NULL
)
UPDATE public.payment_transactions p SET bank_ref_id = NULL
FROM ranked r WHERE p.id = r.id AND r.ref_rank > 1;

-- Create while the table is locked, so no duplicate can slip into the gap
-- between this repair and 003. Future duplicate transfers must still be rejected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_tx_unique_bank_ref
ON public.payment_transactions(bank_ref_id) WHERE bank_ref_id IS NOT NULL;
COMMIT;
