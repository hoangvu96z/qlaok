-- Remove legacy inline image payloads from Postgres so catalog/shop reads do not
-- repeatedly transfer Base64 blobs. Public HTTP(S) URLs and all other records
-- remain unchanged; inline image bytes are intentionally discarded.
BEGIN;

UPDATE public.items
SET image_url = NULL,
    updated_at = NOW()
WHERE image_url IS NOT NULL
  AND btrim(image_url) ILIKE 'data:image/%;base64,%';

UPDATE public.shops AS shop
SET logo_url = CASE
      WHEN btrim(shop.logo_url) ILIKE 'data:image/%;base64,%' THEN NULL
      ELSE shop.logo_url
    END,
    cover_urls = CASE
      WHEN shop.cover_urls IS NULL THEN NULL
      ELSE ARRAY(
        SELECT cover.value
        FROM unnest(shop.cover_urls) AS cover(value)
        WHERE btrim(cover.value) NOT ILIKE 'data:image/%;base64,%'
      )
    END,
    updated_at = NOW()
WHERE btrim(shop.logo_url) ILIKE 'data:image/%;base64,%'
   OR EXISTS (
        SELECT 1
        FROM unnest(COALESCE(shop.cover_urls, ARRAY[]::TEXT[])) AS cover(value)
        WHERE btrim(cover.value) ILIKE 'data:image/%;base64,%'
      );

DO $migration$
BEGIN
  IF EXISTS (
       SELECT 1
       FROM public.items
       WHERE btrim(image_url) ILIKE 'data:image/%;base64,%'
     )
     OR EXISTS (
       SELECT 1
       FROM public.shops
       WHERE btrim(logo_url) ILIKE 'data:image/%;base64,%'
          OR EXISTS (
               SELECT 1
               FROM unnest(COALESCE(cover_urls, ARRAY[]::TEXT[])) AS cover(value)
               WHERE btrim(cover.value) ILIKE 'data:image/%;base64,%'
             )
     ) THEN
    RAISE EXCEPTION 'Legacy inline Base64 image data remains in public item/shop image fields';
  END IF;
END;
$migration$;

COMMIT;
