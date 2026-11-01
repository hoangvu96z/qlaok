-- ============================================================================
-- QLAOK (Q-Smart) — Migration 20261102000100: Revoke Client Execute on SECURITY DEFINER Trigger Functions
-- Revokes inherited PUBLIC and explicit anon/authenticated EXECUTE privileges
-- on the eight zero-argument SECURITY DEFINER trigger functions introduced in
-- migrations 007, 008, 011, 014, and 022 while preserving trigger execution.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.enforce_shop_table_boundaries() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_mobile_push_tokens_boundaries() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_shop_sepay_configs_boundaries() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_sepay_webhook_events_boundaries() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_shop_slug_aliases_boundaries() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_shop_slug_and_aliases() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_shop_slug_alias_on_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_order_events() FROM PUBLIC, anon, authenticated;
