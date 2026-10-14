-- ============================================================================
-- QLAOK ("QUÉT LÀ OK") - SUPABASE POSTGRESQL INITIAL MIGRATION
-- Chạy toàn bộ file này trong: Supabase Dashboard -> SQL Editor -> New Query
-- ============================================================================

-- 1. Khởi tạo Extensions & Enums (Idempotent)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$ BEGIN
    CREATE TYPE plan_tier AS ENUM ('free', 'basic', 'premium');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE business_vertical AS ENUM ('fnb', 'service', 'retail');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE analytics_event_type AS ENUM ('scan_door', 'scan_table', 'item_view', 'show_to_staff', 'wifi_copy');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Bảng provinces (Danh mục chuẩn 34 Tỉnh / Thành phố Việt Nam)
CREATE TABLE IF NOT EXISTS public.provinces (
    code VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    region VARCHAR(50) NOT NULL,
    merged_note TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO public.provinces (code, name, region, merged_note, sort_order) VALUES
    ('ha-noi', 'Hà Nội', 'Bắc Bộ', NULL, 1),
    ('tp-ho-chi-minh', 'TP. Hồ Chí Minh', 'Nam Bộ', 'TP.HCM, Bình Dương, Bà Rịa - Vũng Tàu', 2),
    ('da-nang', 'Đà Nẵng', 'Trung Bộ & Tây Nguyên', 'Đà Nẵng, Quảng Nam', 3),
    ('hai-phong', 'Hải Phòng', 'Bắc Bộ', 'Hải Phòng, Hải Dương', 4),
    ('can-tho', 'Cần Thơ', 'Nam Bộ', 'Cần Thơ, Sóc Trăng, Hậu Giang', 5),
    ('hue', 'Huế', 'Trung Bộ & Tây Nguyên', NULL, 6),
    ('quang-ninh', 'Quảng Ninh', 'Bắc Bộ', NULL, 7),
    ('bac-ninh', 'Bắc Ninh', 'Bắc Bộ', 'Bắc Ninh, Bắc Giang', 8),
    ('hung-yen', 'Hưng Yên', 'Bắc Bộ', 'Hưng Yên, Thái Bình', 9),
    ('ninh-binh', 'Ninh Bình', 'Bắc Bộ', 'Ninh Bình, Hà Nam, Nam Định', 10),
    ('phu-tho', 'Phú Thọ', 'Bắc Bộ', 'Phú Thọ, Vĩnh Phúc, Hòa Bình', 11),
    ('thai-nguyen', 'Thái Nguyên', 'Bắc Bộ', 'Thái Nguyên, Bắc Kạn', 12),
    ('lao-cai', 'Lào Cai', 'Bắc Bộ', 'Lào Cai, Yên Bái', 13),
    ('tuyen-quang', 'Tuyên Quang', 'Bắc Bộ', 'Tuyên Quang, Hà Giang', 14),
    ('lang-son', 'Lạng Sơn', 'Bắc Bộ', NULL, 15),
    ('cao-bang', 'Cao Bằng', 'Bắc Bộ', NULL, 16),
    ('son-la', 'Sơn La', 'Bắc Bộ', NULL, 17),
    ('dien-bien', 'Điện Biên', 'Bắc Bộ', NULL, 18),
    ('lai-chau', 'Lai Châu', 'Bắc Bộ', NULL, 19),
    ('thanh-hoa', 'Thanh Hóa', 'Trung Bộ & Tây Nguyên', NULL, 20),
    ('nghe-an', 'Nghệ An', 'Trung Bộ & Tây Nguyên', NULL, 21),
    ('ha-tinh', 'Hà Tĩnh', 'Trung Bộ & Tây Nguyên', NULL, 22),
    ('quang-tri', 'Quảng Trị', 'Trung Bộ & Tây Nguyên', 'Quảng Trị, Quảng Bình', 23),
    ('quang-ngai', 'Quảng Ngãi', 'Trung Bộ & Tây Nguyên', 'Quảng Ngãi, Kon Tum', 24),
    ('gia-lai', 'Gia Lai', 'Trung Bộ & Tây Nguyên', 'Gia Lai, Bình Định', 25),
    ('dak-lak', 'Đắk Lắk', 'Trung Bộ & Tây Nguyên', 'Đắk Lắk, Phú Yên', 26),
    ('khanh-hoa', 'Khánh Hòa', 'Trung Bộ & Tây Nguyên', 'Khánh Hòa, Ninh Thuận', 27),
    ('lam-dong', 'Lâm Đồng', 'Trung Bộ & Tây Nguyên', 'Lâm Đồng, Đắk Nông, Bình Thuận', 28),
    ('dong-nai', 'Đồng Nai', 'Nam Bộ', 'Đồng Nai, Bình Phước', 29),
    ('tay-ninh', 'Tây Ninh', 'Nam Bộ', 'Tây Ninh, Long An', 30),
    ('dong-thap', 'Đồng Tháp', 'Nam Bộ', 'Đồng Tháp, Tiền Giang', 31),
    ('vinh-long', 'Vĩnh Long', 'Nam Bộ', 'Vĩnh Long, Bến Tre, Trà Vinh', 32),
    ('an-giang', 'An Giang', 'Nam Bộ', 'An Giang, Kiên Giang', 33),
    ('ca-mau', 'Cà Mau', 'Nam Bộ', 'Cà Mau, Bạc Liêu', 34)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    region = EXCLUDED.region,
    merged_note = EXCLUDED.merged_note,
    sort_order = EXCLUDED.sort_order;

-- 3. Bảng profiles (Hỗ trợ cả UUID từ Supabase Auth và tài khoản Demo)
CREATE TABLE IF NOT EXISTS public.profiles (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    email VARCHAR(255),
    phone VARCHAR(30),
    full_name VARCHAR(100),
    plan plan_tier NOT NULL DEFAULT 'free',
    plan_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Bảng shops (Thông tin cửa hàng & Cấu hình Micro-Website trên 34 tỉnh thành)
CREATE TABLE IF NOT EXISTS public.shops (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    owner_id TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    slug VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    vertical business_vertical NOT NULL DEFAULT 'fnb',
    tagline_i18n JSONB NOT NULL DEFAULT '{"vi": ""}'::jsonb,
    description_i18n JSONB NOT NULL DEFAULT '{"vi": ""}'::jsonb,
    logo_url TEXT,
    cover_urls TEXT[] DEFAULT '{}',
    address TEXT,
    city VARCHAR(100) NOT NULL DEFAULT 'TP. Hồ Chí Minh',
    google_maps_url TEXT,
    google_review_url TEXT,
    phone_contact VARCHAR(30),
    zalo_phone VARCHAR(30),
    telegram_chat_id VARCHAR(100),
    wifi_info JSONB DEFAULT '{"ssid": "", "password": ""}'::jsonb,
    opening_hours JSONB DEFAULT '{
        "mon": {"open": "08:00", "close": "22:00", "closed": false},
        "tue": {"open": "08:00", "close": "22:00", "closed": false},
        "wed": {"open": "08:00", "close": "22:00", "closed": false},
        "thu": {"open": "08:00", "close": "22:00", "closed": false},
        "fri": {"open": "08:00", "close": "22:00", "closed": false},
        "sat": {"open": "08:00", "close": "22:00", "closed": false},
        "sun": {"open": "08:00", "close": "22:00", "closed": false}
    }'::jsonb,
    supported_langs TEXT[] NOT NULL DEFAULT ARRAY['vi'],
    currency VARCHAR(10) NOT NULL DEFAULT 'VND',
    theme_config JSONB NOT NULL DEFAULT '{"primaryColor": "#10b981", "layout": "grid"}'::jsonb,
    is_published BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Bảng categories (Danh mục món ăn / Nhóm dịch vụ / Nhóm sản phẩm)
CREATE TABLE IF NOT EXISTS public.categories (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    shop_id TEXT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    name_i18n JSONB NOT NULL DEFAULT '{"vi": "Danh mục mới"}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Bảng items (Món ăn / Dịch vụ / Sản phẩm)
CREATE TABLE IF NOT EXISTS public.items (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    shop_id TEXT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    category_id TEXT NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    price NUMERIC(12, 0) NOT NULL DEFAULT 0,
    compare_at_price NUMERIC(12, 0),
    unit_i18n JSONB DEFAULT '{"vi": "phần", "en": "portion", "ko": "인분", "ja": "人前", "zh": "份"}'::jsonb,
    duration_mins INTEGER,
    image_url TEXT,
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    is_featured BOOLEAN NOT NULL DEFAULT FALSE,
    name_i18n JSONB NOT NULL DEFAULT '{"vi": ""}'::jsonb,
    desc_i18n JSONB NOT NULL DEFAULT '{"vi": ""}'::jsonb,
    options_json JSONB DEFAULT '[]'::jsonb,
    view_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Bảng posts (Bài viết khuyến mãi / Thông báo trên trang thông tin cửa hàng)
CREATE TABLE IF NOT EXISTS public.posts (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    shop_id TEXT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    title_i18n JSONB NOT NULL DEFAULT '{"vi": ""}'::jsonb,
    content_i18n JSONB NOT NULL DEFAULT '{"vi": ""}'::jsonb,
    banner_url TEXT,
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Bảng analytics_events (Thống kê lượt quét QR và hành vi khách hàng)
CREATE TABLE IF NOT EXISTS public.analytics_events (
    id BIGSERIAL PRIMARY KEY,
    shop_id TEXT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    event_type analytics_event_type NOT NULL,
    item_id TEXT REFERENCES public.items(id) ON DELETE SET NULL,
    visitor_lang VARCHAR(10) DEFAULT 'vi',
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Bảng payment_transactions (Lịch sử thanh toán nâng cấp gói qua VietQR)
CREATE TABLE IF NOT EXISTS public.payment_transactions (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    user_id TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    order_code VARCHAR(50) UNIQUE NOT NULL,
    target_plan plan_tier NOT NULL,
    amount NUMERIC(12, 0) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    bank_ref_id VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- 10. Tạo Indexes tối ưu tốc độ truy vấn
CREATE INDEX IF NOT EXISTS idx_shops_slug ON public.shops(slug);
CREATE INDEX IF NOT EXISTS idx_shops_owner ON public.shops(owner_id);
CREATE INDEX IF NOT EXISTS idx_shops_city ON public.shops(city);
CREATE INDEX IF NOT EXISTS idx_categories_shop ON public.categories(shop_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_items_shop_cat ON public.items(shop_id, category_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_analytics_shop_date ON public.analytics_events(shop_id, created_at DESC);

-- 11. Trigger kiểm tra giới hạn số lượng món theo gói cước (Free: 5, Basic: 25, Premium: Unlimited)
CREATE OR REPLACE FUNCTION check_item_plan_limit()
RETURNS TRIGGER AS $$
DECLARE
    user_plan plan_tier;
    current_count INTEGER;
BEGIN
    SELECT p.plan INTO user_plan
    FROM public.shops s
    JOIN public.profiles p ON s.owner_id = p.id
    WHERE s.id = NEW.shop_id;

    SELECT COUNT(*) INTO current_count
    FROM public.items
    WHERE shop_id = NEW.shop_id;

    IF user_plan = 'free' AND current_count >= 5 THEN
        RAISE EXCEPTION 'PLAN_LIMIT_REACHED: Gói Miễn Phí chỉ hỗ trợ tối đa 5 món/dịch vụ. Vui lòng nâng cấp gói.';
    ELSIF user_plan = 'basic' AND current_count >= 25 THEN
        RAISE EXCEPTION 'PLAN_LIMIT_REACHED: Gói Cơ Bản chỉ hỗ trợ tối đa 25 món/dịch vụ. Vui lòng nâng cấp lên gói Premium.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_item_limit ON public.items;
CREATE TRIGGER enforce_item_limit
BEFORE INSERT ON public.items
FOR EACH ROW EXECUTE FUNCTION check_item_plan_limit();

-- 12. Thiết lập Row Level Security (RLS)
ALTER TABLE public.provinces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all provinces access" ON public.provinces;
CREATE POLICY "Allow all provinces access" ON public.provinces FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all profiles access" ON public.profiles;
CREATE POLICY "Allow all profiles access" ON public.profiles FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all shops access" ON public.shops;
CREATE POLICY "Allow all shops access" ON public.shops FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all categories access" ON public.categories;
CREATE POLICY "Allow all categories access" ON public.categories FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all items access" ON public.items;
CREATE POLICY "Allow all items access" ON public.items FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all posts access" ON public.posts;
CREATE POLICY "Allow all posts access" ON public.posts FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all analytics access" ON public.analytics_events;
CREATE POLICY "Allow all analytics access" ON public.analytics_events FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all payment_transactions access" ON public.payment_transactions;
CREATE POLICY "Allow all payment_transactions access" ON public.payment_transactions FOR ALL USING (true) WITH CHECK (true);
