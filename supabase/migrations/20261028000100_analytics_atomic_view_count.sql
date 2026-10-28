CREATE OR REPLACE FUNCTION public.increment_item_view_count(
  p_shop_id text,
  p_item_id text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  next_view_count integer;
BEGIN
  UPDATE public.items
  SET view_count = COALESCE(view_count, 0) + 1
  WHERE shop_id = p_shop_id
    AND id = p_item_id
  RETURNING view_count INTO next_view_count;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_NOT_IN_SHOP';
  END IF;

  RETURN next_view_count;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_item_view_count(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_item_view_count(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.increment_item_view_count(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_item_view_count(text, text) TO service_role;
