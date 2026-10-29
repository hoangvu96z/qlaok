-- ============================================================================
-- Migration 20261030000200: Reload PostgREST Schema Cache
--
-- Refreshes PostgREST's cached schema and RPC metadata so already-applied
-- functions (including public.increment_item_view_count) and tables are
-- immediately visible to the REST API. Idempotent and mutates no schema or
-- customer/business data.
-- ============================================================================

NOTIFY pgrst, 'reload schema';
