-- =========================================================================
-- QLAOK MIGRATION 013: PERSISTENT OPENING HOURS OWNER CONFIRMATION
-- =========================================================================
-- Adds a boolean opening_hours_confirmed column (NOT NULL DEFAULT FALSE)
-- to public.shops so the first-run setup checklist only marks opening hours
-- complete after the shop owner explicitly reviews and confirms them.
-- Existing and newly onboarded shops default to FALSE.
-- =========================================================================

ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS opening_hours_confirmed BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.shops
  SET opening_hours_confirmed = FALSE
  WHERE opening_hours_confirmed IS NULL;

ALTER TABLE public.shops
  ALTER COLUMN opening_hours_confirmed SET DEFAULT FALSE,
  ALTER COLUMN opening_hours_confirmed SET NOT NULL;
