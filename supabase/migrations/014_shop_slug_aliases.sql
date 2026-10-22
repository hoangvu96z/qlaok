-- ============================================================================
-- 014_shop_slug_aliases.sql
-- Preserve already-printed storefront & table QR URLs across shop slug changes
-- ============================================================================

-- 1. Durable Slug Aliases Table
CREATE TABLE IF NOT EXISTS public.shop_slug_aliases (
    slug VARCHAR(100) PRIMARY KEY,
    shop_id TEXT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT shop_slug_aliases_slug_normalized_check CHECK (
        btrim(slug) <> '' AND slug = lower(btrim(slug))
    )
);

CREATE INDEX IF NOT EXISTS idx_shop_slug_aliases_shop_id
ON public.shop_slug_aliases(shop_id);

ALTER TABLE public.shop_slug_aliases ENABLE ROW LEVEL SECURITY;

-- 2. RLS Policies for shop_slug_aliases
-- Public can resolve aliases only for published shops; owner/authorized members can resolve for their own shop.
DROP POLICY IF EXISTS "shop_slug_aliases_select" ON public.shop_slug_aliases;
CREATE POLICY "shop_slug_aliases_select"
ON public.shop_slug_aliases FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.shops s
        WHERE s.id = shop_slug_aliases.shop_id
          AND (
              s.is_published = TRUE
              OR s.owner_id = auth.uid()::text
              OR public.user_has_shop_permission(s.id, 'orders.view')
          )
    )
);

-- 3. Trigger enforcing client write boundaries & canonical non-shadowing on shop_slug_aliases
CREATE OR REPLACE FUNCTION public.enforce_shop_slug_aliases_boundaries()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF public.is_client_request_context()
       AND COALESCE(current_setting('qlaok.internal_slug_alias_sync', true), '') <> '1' THEN
        RAISE EXCEPTION 'FORBIDDEN_SHOP_SLUG_ALIAS_MUTATION: Không được phép chỉnh sửa trực tiếp bảng bí danh đường dẫn (shop_slug_aliases) từ phía client.';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    NEW.slug := lower(btrim(COALESCE(NEW.slug, '')));
    IF NEW.slug = '' THEN
        RAISE EXCEPTION 'INVALID_SHOP_SLUG_ALIAS: Đường dẫn bí danh không hợp lệ.';
    END IF;

    -- An alias must never shadow any shop's current canonical slug
    IF EXISTS (
        SELECT 1 FROM public.shops s
        WHERE lower(btrim(s.slug)) = NEW.slug
    ) THEN
        RAISE EXCEPTION 'SLUG_ALREADY_EXISTS: Đường dẫn cửa hàng (slug) đã được sử dụng, vui lòng chọn đường dẫn khác.';
    END IF;

    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_shop_slug_aliases_boundaries ON public.shop_slug_aliases;
CREATE TRIGGER trg_enforce_shop_slug_aliases_boundaries
BEFORE INSERT OR UPDATE OR DELETE ON public.shop_slug_aliases
FOR EACH ROW EXECUTE FUNCTION public.enforce_shop_slug_aliases_boundaries();

-- 4. BEFORE INSERT OR UPDATE trigger on shops:
--    - Normalizes NEW.slug
--    - Rejects collisions against any other shop's canonical slug or reserved alias
--    - Cleans up same-shop alias when a shop reverts to one of its own former slugs
CREATE OR REPLACE FUNCTION public.validate_shop_slug_and_aliases()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    normalized_new_slug TEXT;
    normalized_old_slug TEXT;
BEGIN
    normalized_new_slug := lower(btrim(COALESCE(NEW.slug, '')));
    IF normalized_new_slug = '' THEN
        RAISE EXCEPTION 'INVALID_SHOP_SLUG: Đường dẫn cửa hàng (slug) không hợp lệ.';
    END IF;
    NEW.slug := normalized_new_slug;

    IF TG_OP = 'UPDATE' THEN
        normalized_old_slug := lower(btrim(COALESCE(OLD.slug, '')));
        IF normalized_new_slug = normalized_old_slug THEN
            RETURN NEW;
        END IF;
    END IF;

    -- Reject if another shop currently owns this canonical slug
    IF EXISTS (
        SELECT 1 FROM public.shops s
        WHERE lower(btrim(s.slug)) = normalized_new_slug
          AND s.id <> NEW.id
    ) THEN
        RAISE EXCEPTION 'SLUG_ALREADY_EXISTS: Đường dẫn cửa hàng (slug) đã được sử dụng, vui lòng chọn đường dẫn khác.';
    END IF;

    -- Reject if another shop has reserved this slug as a historical alias
    IF EXISTS (
        SELECT 1 FROM public.shop_slug_aliases a
        WHERE a.slug = normalized_new_slug
          AND a.shop_id <> NEW.id
    ) THEN
        RAISE EXCEPTION 'SLUG_ALREADY_EXISTS: Đường dẫn cửa hàng (slug) đã được sử dụng, vui lòng chọn đường dẫn khác.';
    END IF;

    -- If this shop is reclaiming one of its own previous aliases, remove it from aliases
    PERFORM set_config('qlaok.internal_slug_alias_sync', '1', true);
    DELETE FROM public.shop_slug_aliases
    WHERE slug = normalized_new_slug
      AND shop_id = NEW.id;
    PERFORM set_config('qlaok.internal_slug_alias_sync', '0', true);

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_shop_slug_and_aliases ON public.shops;
CREATE TRIGGER trg_validate_shop_slug_and_aliases
BEFORE INSERT OR UPDATE OF slug ON public.shops
FOR EACH ROW EXECUTE FUNCTION public.validate_shop_slug_and_aliases();

-- 5. AFTER UPDATE trigger on shops:
--    - Atomically records OLD.slug in public.shop_slug_aliases whenever canonical slug changes
CREATE OR REPLACE FUNCTION public.record_shop_slug_alias_on_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    normalized_old_slug TEXT;
    normalized_new_slug TEXT;
BEGIN
    normalized_old_slug := lower(btrim(COALESCE(OLD.slug, '')));
    normalized_new_slug := lower(btrim(COALESCE(NEW.slug, '')));

    IF normalized_old_slug = '' OR normalized_old_slug = normalized_new_slug THEN
        RETURN NEW;
    END IF;

    PERFORM set_config('qlaok.internal_slug_alias_sync', '1', true);

    -- Remove NEW.slug from aliases of this shop if present (idempotent safety)
    DELETE FROM public.shop_slug_aliases
    WHERE slug = normalized_new_slug
      AND shop_id = NEW.id;

    -- Record OLD.slug as a durable alias pointing to this shop
    INSERT INTO public.shop_slug_aliases (slug, shop_id, created_at, updated_at)
    VALUES (normalized_old_slug, NEW.id, NOW(), NOW())
    ON CONFLICT (slug) DO UPDATE
    SET shop_id = EXCLUDED.shop_id,
        updated_at = NOW()
    WHERE public.shop_slug_aliases.shop_id = EXCLUDED.shop_id;

    PERFORM set_config('qlaok.internal_slug_alias_sync', '0', true);

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_shop_slug_alias_on_update ON public.shops;
CREATE TRIGGER trg_record_shop_slug_alias_on_update
AFTER UPDATE OF slug ON public.shops
FOR EACH ROW EXECUTE FUNCTION public.record_shop_slug_alias_on_update();
