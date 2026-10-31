CREATE OR REPLACE FUNCTION public.record_analytics_event_atomic(
  p_shop_id text,
  p_event_type public.analytics_event_type,
  p_item_id text DEFAULT NULL,
  p_visitor_lang text DEFAULT 'vi',
  p_user_agent text DEFAULT 'unknown'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_event public.analytics_events%ROWTYPE;
  v_item_id text := NULLIF(BTRIM(p_item_id), '');
  v_visitor_lang text := COALESCE(NULLIF(BTRIM(p_visitor_lang), ''), 'vi');
BEGIN
  IF p_shop_id IS NULL OR BTRIM(p_shop_id) = '' THEN
    RAISE EXCEPTION 'SHOP_NOT_TRACKABLE';
  END IF;

  IF v_visitor_lang NOT IN ('vi', 'en', 'ko', 'ja', 'zh', 'es', 'it', 'ru') THEN
    RAISE EXCEPTION 'INVALID_VISITOR_LANG';
  END IF;

  PERFORM 1
  FROM public.shops
  WHERE id = p_shop_id
    AND is_published IS DISTINCT FROM FALSE
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHOP_NOT_TRACKABLE';
  END IF;

  IF p_event_type = 'item_view'::public.analytics_event_type THEN
    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'ITEM_NOT_IN_SHOP';
    END IF;

    PERFORM 1
    FROM public.items
    WHERE id = v_item_id
      AND shop_id = p_shop_id
    FOR KEY SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ITEM_NOT_IN_SHOP';
    END IF;
  ELSE
    v_item_id := NULL;
  END IF;

  INSERT INTO public.analytics_events (
    shop_id,
    event_type,
    item_id,
    visitor_lang,
    user_agent
  ) VALUES (
    p_shop_id,
    p_event_type,
    v_item_id,
    v_visitor_lang,
    COALESCE(p_user_agent, 'unknown')
  )
  RETURNING * INTO v_event;

  IF p_event_type = 'item_view'::public.analytics_event_type THEN
    PERFORM public.increment_item_view_count(p_shop_id, v_item_id);
  END IF;

  RETURN TO_JSONB(v_event);
END;
$$;

REVOKE ALL ON FUNCTION public.record_analytics_event_atomic(
  text,
  public.analytics_event_type,
  text,
  text,
  text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_analytics_event_atomic(
  text,
  public.analytics_event_type,
  text,
  text,
  text
) FROM anon;
REVOKE ALL ON FUNCTION public.record_analytics_event_atomic(
  text,
  public.analytics_event_type,
  text,
  text,
  text
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_analytics_event_atomic(
  text,
  public.analytics_event_type,
  text,
  text,
  text
) TO service_role;

NOTIFY pgrst, 'reload schema';
