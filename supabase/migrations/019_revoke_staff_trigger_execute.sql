-- ============================================================================
-- QLAOK (Q-Smart) — Migration 019: Revoke Client Execute on Staff Boundary Trigger Helpers
-- Revokes inherited PUBLIC and explicit anon/authenticated EXECUTE privileges
-- on the trigger-only SECURITY DEFINER functions introduced in migration 018
-- while preserving BEFORE INSERT/UPDATE/DELETE trigger enforcement.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.enforce_shop_staff_credentials_boundaries() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_staff_login_rate_limits_boundaries() FROM PUBLIC, anon, authenticated;
