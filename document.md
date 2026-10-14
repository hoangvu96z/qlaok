# ĐẶC TẢ KỸ THUẬT & AI CODING BLUEPRINT: DỰ ÁN QLAOK ("QUÉT LÀ OK")

> **Hướng dẫn sử dụng cho AI Coding Agent (Cursor, Claude Code, Windsurf, Lovable, Bolt):**
> Tài liệu này là nguồn tham chiếu duy nhất (Single Source of Truth) để xây dựng nền tảng **Qlaok** (`qlaok.com` / `qlaok.vn`). Hãy tuân thủ tuyệt đối kiến trúc thư mục, Database Schema, TypeScript Interfaces, thiết kế API và quy tắc UI/UX bên dưới. Bạn có thể lưu file này thành `CLAUDE.md` hoặc `.cursorrules` ở thư mục gốc của dự án.

---

## 1. TỔNG QUAN SẢN PHẨM & ĐỊNH VỊ THƯƠNG HIỆU (PRODUCT OVERVIEW)

* **Tên thương hiệu:** **Qlaok** (Đọc là *"Q-là-OK"*, viết tắt của **QR Là OK**).
* **Slogan:** *"Quét là OK – Menu, Bảng giá & Web Đa Ngôn Ngữ Cho Mọi Cửa Hàng"*.
* **Mô hình kinh doanh:** B2B2C Micro-SaaS kết hợp Local Directory theo mô hình Freemium.
* **Đối tượng khách hàng (B2B - Chủ cửa hàng nhỏ):**
  1. **Ngành F&B (`fnb`):** Quán ăn, nhà hàng, cà phê, trà sữa, quán nhậu, xe đẩy đường phố.
  2. **Ngành Dịch vụ (`service`):** Tiệm Nail, Spa, Gội đầu dưỡng sinh, Massage, Salon tóc, Studio chụp ảnh, Karaoke, Phòng Gym, Tiệm giặt sấy.
  3. **Ngành Bán lẻ (`retail`):** Shop thời trang, cửa hàng lưu niệm, đặc sản địa phương, tiệm tạp hóa, nhà thuốc.
* **Đối tượng người dùng cuối (B2C - Khách quét mã):** Khách nội địa và khách du lịch/người nước ngoài (Hàn Quốc, Nhật Bản, Trung Quốc/Đài Loan, Âu Mỹ) cần xem menu/bảng giá trên điện thoại ngay lập tức mà không cần tải ứng dụng.

### 5 Trụ cột tính năng cốt lõi (Core Features)
1. **Menu / Bảng giá 5 ngôn ngữ tự động bằng AI:**
   * Chủ quán chỉ nhập **Tiếng Việt (`vi`)**.
   * AI tự động dịch sang 4 ngôn ngữ: **Tiếng Anh (`en`)**, **Tiếng Hàn (`ko`)**, **Tiếng Nhật (`ja`)**, **Tiếng Trung Giản Thể (`zh`)** theo đúng văn phong ẩm thực/dịch vụ.
   * Khi khách quét mã QR, hệ thống tự động đọc `navigator.language` hoặc `Accept-Language` trên trình duyệt điện thoại để hiển thị đúng ngôn ngữ của khách ngay lập tức.
2. **AI Vision Menu Scanner (Tạo menu từ ảnh chụp):**
   * Chủ quán tải lên 1–3 ảnh chụp menu giấy hoặc ảnh chụp màn hình GrabFood/ShopeeFood.
   * AI tự động bóc tách Danh mục (Categories), Tên món/dịch vụ, Mô tả và Giá tiền để tạo menu số chỉ trong 10 giây.
3. **Thao tác 1 chạm cho chủ quán trên điện thoại (Mobile-First CMS):**
   * Đổi giá tiền trực tiếp ngoài danh sách.
   * Nút gạt (Switch) **Còn hàng / Tạm hết** cập nhật theo thời gian thực (Realtime) lên màn hình của khách mà không cần in lại menu.
4. **Micro-Website & Hệ thống 2 Mã QR chuyên biệt:**
   * **Mã QR Cửa (`?src=door`):** Dán trước cửa tiệm hoặc quầy lễ tân. Quét vào sẽ mở **Trang Thông Tin Cửa Hàng** (Ảnh không gian, trạng thái Đang mở/Đã đóng cửa, nút Copy mật khẩu Wi-Fi 1 chạm, bản đồ chỉ đường Google Maps, bài viết khuyến mãi, nút dẫn tới đánh giá Google Maps, và nút mở xem Menu/Bảng giá).
   * **Mã QR Bàn/Quầy (`?src=table`):** Đặt tại bàn ăn hoặc ghế làm dịch vụ. Quét vào sẽ mở **thẳng vào trang Menu / Bảng giá / Danh mục sản phẩm**.
5. **Thẻ "Đưa Nhân Viên Xem" (Show to Staff Card - Giải quyết bất đồng ngôn ngữ):**
   * Khách nước ngoài chọn món/dịch vụ kèm tùy chọn (VD: *Ít đá, Không hành, Làm móng gel*) bằng ngôn ngữ của họ -> Bấm nút **"Gọi món / Đưa nhân viên xem"** -> Màn hình bật lên một thẻ chữ **Tiếng Việt kích thước lớn, độ tương phản cao** kèm số lượng để khách đưa màn hình cho nhân viên/chủ quán xem (và tùy chọn bắn đơn về Zalo/Telegram của quán).

---

## 2. KIẾN TRÚC CÔNG NGHỆ (TECH STACK & CONSTRAINTS)

AI Coder bắt buộc sử dụng các thư viện và công nghệ sau:

* **Framework:** `Next.js 15+` (App Router, Server Actions, React 19, TypeScript Strict Mode).
* **Styling & UI Components:**
  * `Tailwind CSS` + `shadcn/ui` (Radix UI primitives).
  * Icons: `lucide-react`.
  * Animation: `framer-motion` (dùng cho Bottom Sheet giỏ hàng và thẻ Show-to-Staff).
* **Database & Authentication:** `Supabase` (`@supabase/ssr`, `@supabase/supabase-js`).
  * Auth: Đăng nhập bằng Google OAuth hoặc Email/Phone OTP.
  * Database: PostgreSQL kết hợp `JSONB` cho dữ liệu đa ngôn ngữ (`i18n`).
  * Realtime: Supabase Realtime Broadcast/Postgres Changes cho trạng thái `is_available`.
* **Object Storage (Lưu trữ ảnh):** `Cloudflare R2` (thông qua `@aws-sdk/client-s3` và `@aws-sdk/s3-request-presigner`).
  * Bắt buộc nén ảnh phía Client bằng `browser-image-compression` sang định dạng `.webp` (chiều rộng tối đa `800px`, dung lượng `< 150KB`) trước khi upload lên R2.
* **AI Engine:** Google Gemini API (`@google/genai` sử dụng model `gemini-2.5-flash`) với tính năng `responseSchema` (Structured Outputs) để đảm bảo kết quả trả về luôn là JSON hợp lệ $100\%$.
* **QR Code & Print Studio:** `qrcode.react` (tạo QR có logo giữa) + `html-to-image` (xuất ảnh PNG Standee A6 độ phân giải cao để in ấn).
* **Thanh toán tự động (Subscription Billing):** Tích hợp mã `VietQR` động + Webhook nhận biến động số dư từ `SePay` hoặc `PayOS`.

---

## 3. CẤU TRÚC THƯ MỤC DỰ ÁN (PROJECT DIRECTORY STRUCTURE)

```text
qlaok/
├── src/
│   ├── app/
│   │   ├── (marketing)/                  # Trang chủ giới thiệu Qlaok & Danh bạ quán (Directory)
│   │   │   ├── page.tsx                  # Landing Page + Khám phá cửa hàng nổi bật
│   │   │   ├── explore/page.tsx          # Trang Directory lọc theo ngành (F&B, Spa, Retail) & khu vực
│   │   │   └── pricing/page.tsx          # Bảng giá gói Free, Basic, Premium
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx            # Đăng nhập Google / Email
│   │   │   └── onboarding/page.tsx       # Wizard 3 bước tạo quán lần đầu
│   │   ├── (dashboard)/                  # Giao diện quản trị của chủ quán (Mobile-First CMS)
│   │   │   ├── dashboard/
│   │   │   │   ├── page.tsx              # Tổng quan + Thống kê lượt quét QR & Top món
│   │   │   │   ├── catalog/page.tsx      # Quản lý Danh mục & Món/Dịch vụ (Quick Toggle & Edit)
│   │   │   │   ├── ai-scanner/page.tsx   # Tải ảnh menu giấy -> AI OCR bóc tách tự động
│   │   │   │   ├── posts/page.tsx        # Đăng tin khuyến mãi / Thông báo của quán
│   │   │   │   ├── qr-studio/page.tsx    # Tạo & tải mẫu in 2 mã QR (QR Cửa & QR Bàn)
│   │   │   │   ├── settings/page.tsx     # Sửa thông tin quán, Giờ mở cửa, Wi-Fi, Ngôn ngữ
│   │   │   │   └── billing/page.tsx      # Nâng cấp gói cước qua VietQR
│   │   ├── (storefront)/                 # Giao diện khách hàng khi quét QR (Tốc độ cực nhanh)
│   │   │   └── s/
│   │   │       └── [slug]/
│   │   │           ├── layout.tsx        # Khung Mobile (max-w-md mx-auto), phát hiện ngôn ngữ
│   │   │           ├── page.tsx          # Trang Micro-Website (Mặc định khi quét QR Cửa ?src=door)
│   │   │           └── menu/
│   │   │               └── page.tsx      # Trang Menu/Bảng giá (Mặc định khi quét QR Bàn ?src=table)
│   │   └── api/
│   │       ├── ai/
│   │       │   ├── translate/route.ts    # API dịch tự động từ Tiếng Việt sang EN, KO, JA, ZH
│   │       │   └── ocr-menu/route.ts     # API đọc ảnh chụp menu thành JSON
│   │       ├── upload/route.ts           # Tạo Presigned URL upload ảnh lên Cloudflare R2
│   │       ├── analytics/track/route.ts  # Ghi nhận sự kiện quét QR & click xem món
│   │       └── webhooks/
│   │           └── payment/route.ts      # Webhook SePay/PayOS tự động kích hoạt gói trả phí
│   ├── components/
│   │   ├── ui/                           # Các component của shadcn/ui
│   │   ├── storefront/                   # Các component phía khách quét QR
│   │   │   ├── LanguageSwitcher.tsx      # Thanh chọn cờ 5 nước (VI, EN, KO, JA, ZH)
│   │   │   ├── WifiBadge.tsx             # Nút hiển thị & Copy mật khẩu Wi-Fi 1 chạm
│   │   │   ├── VerticalRenderer.tsx      # Tự động đổi UI theo loại hình: F&B / Service / Retail
│   │   │   ├── ShowToStaffModal.tsx      # Màn hình chữ Tiếng Việt to rõ để đưa nhân viên xem
│   │   │   └── ItemDetailDrawer.tsx      # Bottom sheet xem chi tiết món & ghi chú
│   │   └── dashboard/                    # Các component phía chủ quán
│   │       ├── QuickItemRow.tsx          # Dòng sản phẩm có Switch Còn/Hết & sửa giá nhanh
│   │       ├── TranslationEditorModal.tsx# Popup xem và chỉnh sửa tay 5 ngôn ngữ
│   │       └── PrintableStandee.tsx      # Mẫu thiết kế Standee QR A6 để xuất ra ảnh/PDF
│   ├── lib/
│   │   ├── supabase/                     # Cấu hình Supabase Client & Server
│   │   ├── gemini.ts                     # Khởi tạo Gemini AI Client & Schemas
│   │   ├── r2.ts                         # Cấu hình Cloudflare R2 Client
│   │   ├── i18n-helper.ts                # Hàm lấy text theo ngôn ngữ khách + fallback về 'vi'
│   │   └── plan-limits.ts                # Kiểm tra giới hạn gói (Free/Basic/Premium)
│   └── types/
│       └── qlaok.ts                      # Toàn bộ TypeScript Interfaces của hệ thống
```

---

## 4. THIẾT KẾ CƠ SỞ DỮ LIỆU HOÀN CHỈNH (SUPABASE SQL SCHEMA)

Chạy toàn bộ đoạn mã SQL dưới đây trong **Supabase SQL Editor** để khởi tạo đầy đủ bảng, kiểu dữ liệu, Index, Trigger kiểm tra giới hạn gói cước và Row Level Security (RLS):

```sql
-- 1. Khởi tạo Extensions & Enums
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE plan_tier AS ENUM ('free', 'basic', 'premium');
CREATE TYPE business_vertical AS ENUM ('fnb', 'service', 'retail');
CREATE TYPE analytics_event_type AS ENUM ('scan_door', 'scan_table', 'item_view', 'show_to_staff', 'wifi_copy');

-- 2. Bảng profiles (Mở rộng từ auth.users của Supabase)
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255),
    phone VARCHAR(30),
    full_name VARCHAR(100),
    plan plan_tier NOT NULL DEFAULT 'free',
    plan_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Bảng shops (Thông tin cửa hàng & Cấu hình Micro-Website)
CREATE TABLE public.shops (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    slug VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    vertical business_vertical NOT NULL DEFAULT 'fnb',
    tagline_i18n JSONB NOT NULL DEFAULT '{"vi": ""}'::jsonb,
    description_i18n JSONB NOT NULL DEFAULT '{"vi": ""}'::jsonb,
    logo_url TEXT,
    cover_urls TEXT[] DEFAULT '{}',
    address TEXT,
    city VARCHAR(100) DEFAULT 'Đà Nẵng',
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

-- 4. Bảng categories (Danh mục món ăn / Nhóm dịch vụ / Nhóm sản phẩm)
CREATE TABLE public.categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    name_i18n JSONB NOT NULL DEFAULT '{"vi": "Danh mục mới"}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Bảng items (Món ăn / Dịch vụ / Sản phẩm)
CREATE TABLE public.items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    price NUMERIC(12, 0) NOT NULL DEFAULT 0,
    compare_at_price NUMERIC(12, 0), -- Giá gốc trước khi giảm (nếu có)
    unit_i18n JSONB DEFAULT '{"vi": "phần", "en": "portion", "ko": "인분", "ja": "人前", "zh": "份"}'::jsonb,
    duration_mins INTEGER, -- Dùng riêng cho ngành Service (VD: 60 phút massage/làm nail)
    image_url TEXT,
    is_available BOOLEAN NOT NULL DEFAULT TRUE, -- Nút gạt Còn hàng / Hết hàng
    is_featured BOOLEAN NOT NULL DEFAULT FALSE, -- Món Best Seller / Dịch vụ nổi bật
    name_i18n JSONB NOT NULL DEFAULT '{"vi": ""}'::jsonb,
    desc_i18n JSONB NOT NULL DEFAULT '{"vi": ""}'::jsonb,
    options_json JSONB DEFAULT '[]'::jsonb, -- Tùy chọn thêm (VD: Ít đá, Không hành, Size M/L)
    view_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Bảng posts (Bài viết khuyến mãi / Thông báo trên trang thông tin cửa hàng)
CREATE TABLE public.posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    title_i18n JSONB NOT NULL DEFAULT '{"vi": ""}'::jsonb,
    content_i18n JSONB NOT NULL DEFAULT '{"vi": ""}'::jsonb,
    banner_url TEXT,
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Bảng analytics_events (Thống kê lượt quét QR và hành vi khách hàng)
CREATE TABLE public.analytics_events (
    id BIGSERIAL PRIMARY KEY,
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    event_type analytics_event_type NOT NULL,
    item_id UUID REFERENCES public.items(id) ON DELETE SET NULL,
    visitor_lang VARCHAR(10) DEFAULT 'vi',
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Bảng payment_transactions (Lịch sử thanh toán nâng cấp gói qua VietQR)
CREATE TABLE public.payment_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    order_code VARCHAR(50) UNIQUE NOT NULL, -- Nội dung chuyển khoản (VD: QLAOKP98231)
    target_plan plan_tier NOT NULL,
    amount NUMERIC(12, 0) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, completed, failed
    bank_ref_id VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- 9. Tạo Indexes tối ưu tốc độ truy vấn
CREATE INDEX idx_shops_slug ON public.shops(slug);
CREATE INDEX idx_shops_owner ON public.shops(owner_id);
CREATE INDEX idx_categories_shop ON public.categories(shop_id, sort_order);
CREATE INDEX idx_items_shop_cat ON public.items(shop_id, category_id, sort_order);
CREATE INDEX idx_analytics_shop_date ON public.analytics_events(shop_id, created_at DESC);

-- 10. Trigger kiểm tra giới hạn số lượng món theo gói cước (Free: 5, Basic: 25, Premium: Unlimited)
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

CREATE TRIGGER enforce_item_limit
BEFORE INSERT ON public.items
FOR EACH ROW EXECUTE FUNCTION check_item_plan_limit();

-- 11. Thiết lập Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

-- Policy: Khách vãng lai (Public) được quyền XEM (SELECT) các cửa hàng, danh mục, món ăn, bài viết
CREATE POLICY "Public can view published shops" ON public.shops FOR SELECT USING (is_published = true);
CREATE POLICY "Public can view active categories" ON public.categories FOR SELECT USING (true);
CREATE POLICY "Public can view items" ON public.items FOR SELECT USING (true);
CREATE POLICY "Public can view active posts" ON public.posts FOR SELECT USING (is_active = true);
CREATE POLICY "Public can insert analytics" ON public.analytics_events FOR INSERT WITH CHECK (true);

-- Policy: Chủ cửa hàng được toàn quyền (ALL) trên dữ liệu của chính mình
CREATE POLICY "Owners manage own profile" ON public.profiles FOR ALL USING (auth.uid() = id);
CREATE POLICY "Owners manage own shops" ON public.shops FOR ALL USING (auth.uid() = owner_id);
CREATE POLICY "Owners manage own categories" ON public.categories FOR ALL USING (
    shop_id IN (SELECT id FROM public.shops WHERE owner_id = auth.uid())
);
CREATE POLICY "Owners manage own items" ON public.items FOR ALL USING (
    shop_id IN (SELECT id FROM public.shops WHERE owner_id = auth.uid())
);
CREATE POLICY "Owners manage own posts" ON public.posts FOR ALL USING (
    shop_id IN (SELECT id FROM public.shops WHERE owner_id = auth.uid())
);
CREATE POLICY "Owners view own analytics" ON public.analytics_events FOR SELECT USING (
    shop_id IN (SELECT id FROM public.shops WHERE owner_id = auth.uid())
);
```

---

## 5. ĐỊNH NGHĨA TYPESCRIPT INTERFACES (`src/types/qlaok.ts`)

```typescript
export type SupportedLocale = 'vi' | 'en' | 'ko' | 'ja' | 'zh';
export type PlanTier = 'free' | 'basic' | 'premium';
export type BusinessVertical = 'fnb' | 'service' | 'retail';

export interface I18nText {
  vi: string;
  en?: string;
  ko?: string;
  ja?: string;
  zh?: string;
}

export interface WifiInfo {
  ssid: string;
  password?: string;
}

export interface DaySchedule {
  open: string;   // Format "HH:mm" e.g. "08:00"
  close: string;  // Format "HH:mm" e.g. "22:00"
  closed: boolean;
}

export type OpeningHours = Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', DaySchedule>;

export interface ItemOptionChoice {
  id: string;
  label_i18n: I18nText;
  extra_price: number;
}

export interface ItemOptionGroup {
  id: string;
  name_i18n: I18nText; // VD: {"vi": "Mức đá", "en": "Ice Level", "ko": "얼음 양"}
  required: boolean;
  choices: ItemOptionChoice[];
}

export interface Shop {
  id: string;
  owner_id: string;
  slug: string;
  name: string;
  vertical: BusinessVertical;
  tagline_i18n: I18nText;
  description_i18n: I18nText;
  logo_url: string | null;
  cover_urls: string[];
  address: string | null;
  city: string;
  google_maps_url: string | null;
  google_review_url: string | null;
  phone_contact: string | null;
  zalo_phone: string | null;
  wifi_info: WifiInfo;
  opening_hours: OpeningHours;
  supported_langs: SupportedLocale[];
  currency: string;
  theme_config: {
    primaryColor: string;
    layout: 'grid' | 'list';
  };
}

export interface Category {
  id: string;
  shop_id: string;
  sort_order: number;
  name_i18n: I18nText;
  is_active: boolean;
}

export interface CatalogItem {
  id: string;
  shop_id: string;
  category_id: string;
  sort_order: number;
  price: number;
  compare_at_price?: number | null;
  unit_i18n?: I18nText;
  duration_mins?: number | null; // Dùng cho Tiệm Nail, Spa, Massage, Karaoke
  image_url: string | null;
  is_available: boolean;
  is_featured: boolean;
  name_i18n: I18nText;
  desc_i18n: I18nText;
  options_json: ItemOptionGroup[];
  view_count: number;
}

export interface CartSelection {
  item: CatalogItem;
  quantity: number;
  selectedChoices: ItemOptionChoice[];
  customNote: string;
}
```

---

## 6. LOGIC NGHIỆP VỤ CỐT LÕI & TÍCH HỢP AI (CORE BUSINESS LOGIC & AI PROMPTS)

### 6.1. Cơ chế tự động nhận diện ngôn ngữ điện thoại khách hàng (`src/lib/i18n-helper.ts`)
Khi khách hàng quét mã QR, không bắt khách phải chọn ngôn ngữ thủ công mà tự động khớp theo thứ tự ưu tiên:
1. Query parameter trên URL (nếu khách chủ động bấm đổi cờ: `?lang=ko`).
2. Giá trị lưu trong `localStorage.getItem('qlaok_lang')`.
3. Ngôn ngữ cài đặt trên trình duyệt điện thoại của khách (`navigator.language`, ví dụ `ko-KR` -> cắt lấy `ko`, `zh-CN` hoặc `zh-TW` -> quy về `zh`, `ja-JP` -> `ja`, `en-US` -> `en`).
4. Kiểm tra xem ngôn ngữ đó có nằm trong mảng `shop.supported_langs` của quán hay không. Nếu không hỗ trợ (hoặc quán đang dùng gói Free chỉ có 1 ngôn ngữ), fallback về `'en'` (nếu có) hoặc `'vi'`.

```typescript
import { I18nText, SupportedLocale } from '@/types/qlaok';

export function detectVisitorLocale(supportedLangs: SupportedLocale[]): SupportedLocale {
  if (typeof window === 'undefined') return 'vi';
  
  const saved = localStorage.getItem('qlaok_lang') as SupportedLocale | null;
  if (saved && supportedLangs.includes(saved)) return saved;

  const browserLang = navigator.language.toLowerCase();
  let detected: SupportedLocale = 'vi';

  if (browserLang.startsWith('ko')) detected = 'ko';
  else if (browserLang.startsWith('ja')) detected = 'ja';
  else if (browserLang.startsWith('zh')) detected = 'zh';
  else if (browserLang.startsWith('vi')) detected = 'vi';
  else detected = 'en'; // Mặc định khách quốc tế khác sẽ hiển thị Tiếng Anh

  if (supportedLangs.includes(detected)) return detected;
  if (supportedLangs.includes('en')) return 'en';
  return 'vi';
}

export function tField(field: I18nText | undefined | null, locale: SupportedLocale): string {
  if (!field) return '';
  return field[locale] || field.en || field.vi || '';
}
```

---

### 6.2. API AI Dịch Đa Ngôn Ngữ Chuẩn Ngữ Cảnh (`src/app/api/ai/translate/route.ts`)
Đặc điểm ăn tiền của **Qlaok** là dịch các món đặc sản Việt Nam hoặc thuật ngữ tiệm Nail/Spa sao cho khách Hàn, Nhật, Trung, Tây đọc hiểu ngay bản chất món đó chứ không dịch word-by-word ngô nghê.

```typescript
import { NextResponse } from 'next/server';
import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export async function POST(req: Request) {
  try {
    const { vertical, categoryNameVi, itemNameVi, itemDescVi } = await req.json();

    const systemInstruction = `
Bạn là chuyên gia bản địa hóa Menu Ẩm thực (F&B), Bảng giá Dịch vụ (Nail, Spa, Massage, Gym, Giặt sấy) và Danh mục Bán lẻ tại Việt Nam.
Nhiệm vụ: Dịch nội dung Tiếng Việt sang 4 ngôn ngữ: Tiếng Anh (en), Tiếng Hàn (ko), Tiếng Nhật (ja), và Tiếng Trung Giản Thể (zh).
Quy tắc dịch:
1. Ngành hiện tại của cửa hàng là: "${vertical}".
2. Với món ăn Việt Nam đặc trưng (VD: Bạc xỉu, Phở tái nạm, Bún chả, Bánh tráng trộn), hãy dịch tên món kèm giải thích ngắn gọn bản chất nguyên liệu để khách nước ngoài hiểu ngay (VD: "Bạc xỉu" -> en: "Vietnamese Sweetened Condensed Milk Coffee (Bac Xiu)", ko: "연유가 듬뿍 들어간 베트남식 달콤한 라떼 (박씨우)").
3. Với ngành Dịch vụ (Nail, Spa, Gội đầu dưỡng sinh), dùng đúng thuật ngữ bản xứ mà khách Hàn/Nhật/Trung hay tìm kiếm (VD: "Gội đầu dưỡng sinh" -> ko: "베트남식 두피 케어 & 힐링 샴푸", en: "Herbal Relaxing Head Spa & Massage").
4. Nếu mô tả tiếng Việt (itemDescVi) bị bỏ trống, hãy tự động viết một câu mô tả hấp dẫn ngắn gọn (dưới 18 từ) bằng cả 5 ngôn ngữ dựa trên tên món/dịch vụ.
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: JSON.stringify({ categoryNameVi, itemNameVi, itemDescVi }),
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            category_i18n: {
              type: Type.OBJECT,
              properties: {
                vi: { type: Type.STRING },
                en: { type: Type.STRING },
                ko: { type: Type.STRING },
                ja: { type: Type.STRING },
                zh: { type: Type.STRING },
              },
              required: ['vi', 'en', 'ko', 'ja', 'zh'],
            },
            name_i18n: {
              type: Type.OBJECT,
              properties: {
                vi: { type: Type.STRING },
                en: { type: Type.STRING },
                ko: { type: Type.STRING },
                ja: { type: Type.STRING },
                zh: { type: Type.STRING },
              },
              required: ['vi', 'en', 'ko', 'ja', 'zh'],
            },
            desc_i18n: {
              type: Type.OBJECT,
              properties: {
                vi: { type: Type.STRING },
                en: { type: Type.STRING },
                ko: { type: Type.STRING },
                ja: { type: Type.STRING },
                zh: { type: Type.STRING },
              },
              required: ['vi', 'en', 'ko', 'ja', 'zh'],
            },
          },
          required: ['name_i18n', 'desc_i18n'],
        },
      },
    });

    return NextResponse.json(JSON.parse(response.text || '{}'));
  } catch (error) {
    console.error('Translation Error:', error);
    return NextResponse.json({ error: 'Failed to translate' }, { status: 500 });
  }
}
```

---

### 6.3. API AI Vision OCR - Đọc Ảnh Chụp Menu Giấy (`src/app/api/ai/ocr-menu/route.ts`)
Cho phép chủ quán chụp ảnh tờ thực đơn ép plastic hoặc bảng giá tiệm nail, AI tự động trích xuất ra danh sách và dịch luôn sang 5 thứ tiếng:

```typescript
import { NextResponse } from 'next/server';
import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export async function POST(req: Request) {
  try {
    const { imageBase64, mimeType, vertical } = await req.json();

    const prompt = `
Hãy đọc hình ảnh menu / bảng giá này của cửa hàng thuộc lĩnh vực "${vertical}".
Trích xuất toàn bộ danh mục (categories) và các món/dịch vụ (items) bên trong.
Quy tắc xử lý giá tiền:
- Nếu giá trên menu ghi dạng rút gọn như "35k", "35.000", hoặc "35", hãy quy đổi chuẩn về số nguyên VNĐ là 35000.
- Đồng thời dịch luôn tên danh mục, tên món và mô tả sang 5 ngôn ngữ (vi, en, ko, ja, zh).
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        { inlineData: { data: imageBase64, mimeType } },
        { text: prompt }
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            categories: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name_i18n: {
                    type: Type.OBJECT,
                    properties: {
                      vi: { type: Type.STRING },
                      en: { type: Type.STRING },
                      ko: { type: Type.STRING },
                      ja: { type: Type.STRING },
                      zh: { type: Type.STRING },
                    },
                    required: ['vi', 'en', 'ko', 'ja', 'zh'],
                  },
                  items: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        price: { type: Type.NUMBER },
                        duration_mins: { type: Type.NUMBER, nullable: true },
                        name_i18n: {
                          type: Type.OBJECT,
                          properties: {
                            vi: { type: Type.STRING },
                            en: { type: Type.STRING },
                            ko: { type: Type.STRING },
                            ja: { type: Type.STRING },
                            zh: { type: Type.STRING },
                          },
                          required: ['vi', 'en', 'ko', 'ja', 'zh'],
                        },
                        desc_i18n: {
                          type: Type.OBJECT,
                          properties: {
                            vi: { type: Type.STRING },
                            en: { type: Type.STRING },
                            ko: { type: Type.STRING },
                            ja: { type: Type.STRING },
                            zh: { type: Type.STRING },
                          },
                          required: ['vi', 'en', 'ko', 'ja', 'zh'],
                        },
                      },
                      required: ['price', 'name_i18n', 'desc_i18n'],
                    },
                  },
                },
                required: ['name_i18n', 'items'],
              },
            },
          },
          required: ['categories'],
        },
      },
    });

    return NextResponse.json(JSON.parse(response.text || '{}'));
  } catch (error) {
    console.error('OCR Error:', error);
    return NextResponse.json({ error: 'OCR extraction failed' }, { status: 500 });
  }
}
```

---

### 6.4. Ma trận tùy biến Giao diện theo Ngành nghề (`VerticalRenderer.tsx`)
Cùng một cấu trúc dữ liệu `items`, nhưng giao diện phía khách hàng (`s/[slug]/menu`) phải thay đổi theo `shop.vertical`:

| Thuộc tính | 1. Ăn uống (`fnb`) | 2. Dịch vụ (`service` - Nail, Spa, Gym, Giặt sấy) | 3. Bán lẻ (`retail` - Shop, Tạp hóa) |
| :--- | :--- | :--- | :--- |
| **Tên gọi Tab chính** | Thực đơn (Menu) | Bảng giá dịch vụ (Price List) | Danh sách sản phẩm (Catalog) |
| **Bố cục hiển thị** | Danh sách ngang có ảnh vuông bo góc (`80x80px`) bên phải và nút `+` thêm món nhanh. | Bảng giá dạng dòng (Row list) thanh lịch, hiển thị rõ **Thời lượng** (`duration_mins`, VD: `⏱ 60 phút`) và giá tiền chấm bi nối (`......`). | Lưới 2 cột (2-Column Grid) với ảnh sản phẩm lớn tỷ lệ `1:1` giống Shopee/Instagram. |
| **Ghi chú nhanh (Quick Tags)** | `Không hành`, `Ít đá`, `Ít ngọt`, `Không cay`, `Mang về`. | `Đặt lịch trước`, `Làm nhẹ tay`, `Tư vấn tại quầy`. | `Kiểm tra size/màu`, `Đóng gói quà tặng`. |
| **Nút Hành động chính (Bottom Bar)** | **"Gọi món / Đưa nhân viên xem"** (Bật thẻ `ShowToStaffModal` chữ Tiếng Việt to rõ). | **"Chọn dịch vụ & Đưa lễ tân xem"** hoặc **"Nhắn Zalo đặt lịch"**. | **"Xem giỏ hàng & Hỏi nhân viên"**. |

---

## 7. QUY TRÌNH 6 BƯỚC PROMPT ĐỂ ĐƯA CHO AI CODE (COPY-PASTE WORKFLOW)

Để AI (như Cursor, Claude Code, hoặc Windsurf) không bị quá tải hoặc sinh code thiếu sót, hãy copy-paste lần lượt **6 câu lệnh (Prompts)** dưới đây theo đúng thứ tự:

### Bước 1: Khởi tạo Base, Database Types & Supabase Connection
> **Copy câu lệnh này đưa cho AI:**
> "Dựa vào file `master_plan_qr_saas.md`, hãy khởi tạo cấu trúc thư mục cho dự án **Qlaok** trên Next.js App Router + Tailwind CSS + shadcn/ui. Hãy tạo file `src/types/qlaok.ts` chứa toàn bộ TypeScript Interfaces, file `src/lib/i18n-helper.ts` chứa logic tự động phát hiện ngôn ngữ trình duyệt khách hàng (`vi`, `en`, `ko`, `ja`, `zh`), và cấu hình Supabase Client/Server tại `src/lib/supabase/`. Đồng thời tạo dữ liệu mẫu (Mock Seed Data) của 3 cửa hàng mẫu gồm: 1 Quán Phở & Cafe (`fnb`), 1 Tiệm Nail & Spa (`service`), và 1 Cửa hàng Đặc sản & Lưu niệm (`retail`) với đầy đủ bản dịch 5 ngôn ngữ để có thể test giao diện ngay."

### Bước 2: Xây dựng Giao diện Khách hàng khi quét QR (`Storefront` & 2 luồng QR)
> **Copy câu lệnh này đưa cho AI:**
> "Tiếp theo, hãy xây dựng hoàn chỉnh phân hệ `(storefront)/s/[slug]` theo đúng thiết kế trong `master_plan_qr_saas.md`:
> 1. Trang `/s/[slug]/page.tsx` (Mở ra khi khách quét **QR ở cửa** `?src=door`): Hiển thị ảnh bìa, logo, trạng thái Đang mở cửa/Đã đóng cửa dựa theo giờ hiện tại, thẻ `WifiBadge` bấm 1 chạm là copy mật khẩu Wi-Fi, nút mở Google Maps chỉ đường, danh sách bài đăng khuyến mãi (`posts`), nút dẫn tới đánh giá Google Maps, và nút nổi bật để chuyển sang trang Menu/Bảng giá.
> 2. Trang `/s/[slug]/menu/page.tsx` (Mở thẳng khi khách quét **QR tại bàn** `?src=table`): Có thanh `LanguageSwitcher` 5 ngôn ngữ kèm cờ quốc gia ở trên cùng, thanh tìm kiếm nhanh, thanh trượt danh mục dính ở đầu trang (Sticky Category Tabs), và component `VerticalRenderer` tự động biến đổi giao diện theo loại hình `fnb`, `service`, hoặc `retail`.
> 3. Xây dựng `ShowToStaffModal.tsx`: Khi khách nước ngoài chọn món/dịch vụ và ghi chú xong, bấm nút dưới đáy màn hình sẽ bật lên một thẻ toàn màn hình hiển thị danh sách món bằng **Tiếng Việt chữ cực to, rõ ràng** kèm tổng tiền dự kiến để khách chỉ việc đưa màn hình điện thoại cho nhân viên phục vụ xem."

### Bước 3: Xây dựng Giao diện Quản trị cho Chủ quán (`Mobile-First CMS Dashboard`)
> **Copy câu lệnh này đưa cho AI:**
> "Hãy xây dựng phân hệ `(dashboard)/dashboard` dành cho chủ cửa hàng của **Qlaok**, tối ưu hóa cho màn hình điện thoại:
> 1. Trang `/dashboard/catalog/page.tsx`: Quản lý Danh mục và Món/Dịch vụ. Mỗi dòng món (`QuickItemRow.tsx`) phải có nút gạt Switch **Còn hàng / Tạm hết** (`is_available`) và ô sửa giá nhanh ngay bên ngoài mà không cần mở popup. Khi món bị gạt sang 'Tạm hết', bên giao diện khách hàng món đó lập tức hiện nhãn 'Tạm hết / Sold out' và làm mờ.
> 2. Tạo `TranslationEditorModal.tsx`: Khi chủ quán thêm món mới bằng Tiếng Việt và bấm 'Dịch tự động bằng AI', gọi tới `/api/ai/translate` để điền tự động 4 ngôn ngữ (`en`, `ko`, `ja`, `zh`) và cho phép chủ quán xem hoặc sửa lại từng ngôn ngữ trước khi lưu."

### Bước 4: Xây dựng Tính năng AI Vision Quét Ảnh Menu & QR Print Studio
> **Copy câu lệnh này đưa cho AI:**
> "Hãy xây dựng 2 tính năng chiến lược trong Dashboard của **Qlaok**:
> 1. Trang `/dashboard/ai-scanner/page.tsx` cùng API `/api/ai/ocr-menu/route.ts`: Cho phép chủ quán tải lên ảnh chụp menu giấy hoặc ảnh chụp màn hình GrabFood. Gửi ảnh qua Gemini 2.5 Flash để bóc tách thành danh sách Categories và Items (kèm bản dịch 5 thứ tiếng), hiển thị bảng xem trước (Preview) cho phép chỉnh sửa rồi bấm 'Lưu toàn bộ vào cửa hàng'.
> 2. Trang `/dashboard/qr-studio/page.tsx` cùng component `PrintableStandee.tsx`: Tự động sinh 2 mã QR riêng biệt: **Mã QR Dán Cửa** (`/s/[slug]?src=door`) và **Mã QR Đặt Bàn/Quầy** (`/s/[slug]/menu?src=table`). Thiết kế sẵn khung Standee in ấn đẹp mắt có tên quán, mật khẩu Wi-Fi, dòng chữ mời quét bằng 5 thứ tiếng (Việt - Anh - Hàn - Nhật - Trung) và nút 'Tải ảnh PNG chất lượng cao để in'."

### Bước 5: Xây dựng Hệ thống Thống kê (Analytics) & Thanh toán Gói cước (Paywall + VietQR)
> **Copy câu lệnh này đưa cho AI:**
> "Hãy hoàn thiện hệ thống thống kê và thu phí (Freemium) cho **Qlaok**:
> 1. Tạo API `/api/analytics/track/route.ts` và trang `/dashboard/page.tsx`: Hiển thị tổng lượt quét QR Cửa, lượt quét QR Bàn, biểu đồ tỷ lệ ngôn ngữ của khách (bao nhiêu % khách Hàn, Anh, Nhật, Trung, Việt), và Top 5 món/dịch vụ được khách bấm xem nhiều nhất.
> 2. Tạo trang `/dashboard/billing/page.tsx` và logic kiểm tra giới hạn gói (`src/lib/plan-limits.ts`): Gói Miễn Phí (0đ - tối đa 5 món, 1 ngôn ngữ), Gói Cơ Bản (39.000đ/tháng - tối đa 25 món, 3 ngôn ngữ), Gói Premium (69.000đ/tháng - không giới hạn món, đủ 5 ngôn ngữ, mở khóa AI OCR quét ảnh menu). Hiển thị mã VietQR động kèm nội dung chuyển khoản tự động và tạo Webhook `/api/webhooks/payment/route.ts` để tự động nâng cấp gói khi nhận được tiền."

### Bước 6: Xây dựng Trang chủ Landing Page & Cổng Khám Phá (Directory)
> **Copy câu lệnh này đưa cho AI:**
> "Cuối cùng, hãy xây dựng trang chủ `(marketing)/page.tsx` và trang khám phá `/explore/page.tsx` cho thương hiệu **Qlaok**:
> 1. Phần Hero giới thiệu rõ thông điệp *'Qlaok - Quét là OK: Tạo Menu, Bảng giá đa ngôn ngữ & Trang web riêng cho cửa hàng chỉ trong 2 phút'*, có bản Demo tương tác trực tiếp ngay trên trang chủ (cho phép người xem bấm thử chuyển đổi giữa Quán Ăn, Tiệm Nail Spa, Shop Bán Lẻ và bấm thử đổi 5 ngôn ngữ Việt, Anh, Hàn, Nhật, Trung).
> 2. Phần Directory hiển thị danh sách các cửa hàng đang sử dụng Qlaok có bộ lọc theo ngành nghề và thành phố để hỗ trợ SEO tự nhiên."