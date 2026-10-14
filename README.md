# Qlaok ("Quét Là OK") – Menu, Bảng giá & Web Đa Ngôn Ngữ Cho Mọi Cửa Hàng

Nền tảng Micro-SaaS B2B2C giúp các chủ cửa hàng tại **34 Tỉnh / Thành phố Việt Nam** (**Quán ăn/Cafe F&B**, **Tiệm Nail/Spa/Massage**, **Shop Đặc sản/Bán lẻ**) tạo **Menu / Bảng giá 5 ngôn ngữ tự động bằng AI (`VI`, `EN`, `KO`, `JA`, `ZH`)** và hệ thống **2 Mã QR chuyên biệt (QR Cửa & QR Bàn)** chỉ trong 2 phút.

---

## 🛠️ 1. Yêu cầu hệ thống & Cài đặt nhanh

- **Node.js**: `>= 20.x`
- **Trình quản lý gói**: `npm`

```bash
# 1. Cài đặt dependencies
npm install

# 2. Tạo file biến môi trường từ file mẫu
cp .env.example .env.local

# 3. Chạy môi trường phát triển tại http://localhost:3000
npm run dev
```

---

## 🗄️ 2. Hướng dẫn Setup Supabase Database & Auth

Hệ thống sử dụng **Supabase (PostgreSQL + Auth)** làm cơ sở dữ liệu chính (kèm cơ chế fallback về `.local-db/db.json` khi chạy offline).

### Bước 1: Điền biến môi trường vào `.env.local`
Lấy thông tin trong **Supabase Dashboard → Project Settings → API** và điền vào file `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://kftmrjmmympztzztunxf.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
```

### Bước 2: Khởi tạo Bảng (Run SQL Migration)
1. Mở file [`supabase/migrations/001_init_qlaok.sql`](./supabase/migrations/001_init_qlaok.sql) và copy toàn bộ nội dung.
2. Truy cập **Supabase Dashboard → SQL Editor → New Query**.
3. Dán nội dung SQL vào và bấm **Run** (tạo đầy đủ 8 bảng: `provinces` gồm 34 tỉnh thành Việt Nam, `profiles`, `shops`, `categories`, `items`, `posts`, `analytics_events`, `payment_transactions` cùng Indexes, Trigger giới hạn gói cước và RLS Policies).

### Bước 3: Tự động nạp dữ liệu mẫu (Auto-Seed)
Ngay lần đầu tiên khởi động `npm run dev` (hoặc gọi `http://localhost:3000/api/health`), tầng dữ liệu [`src/lib/db.ts`](./src/lib/db.ts) sẽ kiểm tra bảng `public.shops` trên Supabase:
- Nếu bảng đang trống, hệ thống **tự động nạp (seed)** 3 cửa hàng mẫu đủ 5 ngôn ngữ (`pho-hoi-an`, `linh-spa-nail`, `dac-san-mien-trung`), 9 danh mục, 11 món/dịch vụ, 3 bài viết khuyến mãi và dữ liệu thống kê lên Supabase.
- Kiểm tra trạng thái kết nối bất cứ lúc nào tại: `http://localhost:3000/api/health` (`"dataSource": "supabase"`, `"supabaseTablesReady": true`).

---

## 🤖 3. Cấu hình AI Gemini & Cloudflare R2 (Tuỳ chọn)

Trong file `.env.local`, bạn có thể bổ sung thêm:

```env
# Google Gemini 2.5 Flash (Dịch tự động 5 ngôn ngữ & AI Vision đọc ảnh Menu giấy)
GEMINI_API_KEY=AIzaSy...

# Cloudflare R2 (Lưu trữ ảnh món ăn, logo, ảnh bìa đã nén WebP)
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=qlaok-assets
NEXT_PUBLIC_R2_PUBLIC_URL=https://pub-xxx.r2.dev
```
*(Nếu chưa điền `GEMINI_API_KEY` hoặc `R2_*`, hệ thống vẫn hoạt động đầy đủ với bộ từ điển AI thông minh tích hợp sẵn và bộ lưu trữ ảnh Base64/WebP nội bộ).*

---

## 📂 4. Kiến trúc Dự án (Frontend & Backend)

```text
qlaok/
├── supabase/
│   └── migrations/
│       └── 001_init_qlaok.sql        # Schema PostgreSQL + 34 Tỉnh thành Việt Nam + RLS
├── src/
│   ├── app/
│   │   ├── (marketing)/              # Trang chủ Landing Page (/), Bảng giá (/pricing), Khám phá (/explore)
│   │   ├── (auth)/                   # Đăng nhập Supabase OTP (/login), Tạo quán 3 bước (/onboarding)
│   │   ├── (dashboard)/dashboard/    # CMS Quản trị chủ quán: Tổng quan, Thực đơn, AI Scanner, QR Studio, Gói cước, Cài đặt
│   │   ├── (storefront)/s/[slug]/    # Giao diện Khách quét QR Cửa (/s/[slug]) & QR Bàn (/s/[slug]/menu)
│   │   └── api/                      # Hệ thống Backend API (Next.js App Router)
│   │       ├── shops/route.ts        # CRUD Cửa hàng & lấy Storefront Bundle
│   │       ├── catalog/route.ts      # CRUD Danh mục, Món ăn/Dịch vụ & Bulk Import
│   │       ├── posts/route.ts        # CRUD Bài viết khuyến mãi / thông báo
│   │       ├── analytics/track/      # Tracking lượt quét QR Cửa/Bàn, xem món, copy Wi-Fi
│   │       ├── ai/translate/         # Dịch tự động 1 chạm sang 5 ngôn ngữ (VI, EN, KO, JA, ZH)
│   │       ├── ai/ocr-menu/          # AI Vision bóc tách ảnh chụp thực đơn giấy
│   │       ├── webhooks/payment/     # Tạo đơn VietQR & xử lý Webhook nâng cấp gói tự động
│   │       ├── upload/route.ts       # Presigned URL upload ảnh Cloudflare R2
│   │       └── health/route.ts       # Kiểm tra kết nối Supabase, R2, Gemini & số lượng bản ghi
│   ├── components/
│   │   ├── dashboard/                # QuickItemRow, TranslationEditorModal, PrintableStandee (xuất PNG A6)
│   │   └── storefront/               # VerticalRenderer (3 giao diện F&B/Spa/Retail), ShowToStaffModal, LanguageSwitcher, WifiBadge
│   └── lib/
│       ├── db.ts                     # Tầng Database chính kết nối trực tiếp Supabase (kèm Auto-Seed & Fallback)
│       ├── supabase/                 # Khởi tạo Supabase Browser & Server SSR Client
│       ├── vietnam-provinces.ts      # Danh sách chuẩn 34 Tỉnh / Thành phố Việt Nam
│       ├── i18n-helper.ts            # Nhận diện ngôn ngữ máy khách, format tiền tệ, kiểm tra giờ đóng/mở cửa
│       ├── plan-limits.ts            # Logic phân quyền gói Free (5 món) / Basic (25 món) / Premium (Không giới hạn)
│       ├── gemini.ts                 # Tích hợp Google Gemini 2.5 Flash
│       └── r2.ts                     # Tích hợp Cloudflare R2 S3 SDK
```

---

## 🔗 5. Các Đường Dẫn Trải Nghiệm Chính

- **Trang chủ & Live Demo 3 ngành / 5 ngôn ngữ:** `http://localhost:3000/`
- **Danh bạ khám phá cửa hàng 34 tỉnh thành:** `http://localhost:3000/explore`
- **Đăng nhập / Tạo cửa hàng mới:** `http://localhost:3000/login` | `http://localhost:3000/onboarding`
- **Trang Quản trị Chủ quán (Mobile-First CMS):** `http://localhost:3000/dashboard`
- **Quản lý Danh mục & Món (Gạt Còn/Hết & Đổi giá 1 chạm):** `http://localhost:3000/dashboard/catalog`
- **AI Vision Quét Ảnh Menu Giấy:** `http://localhost:3000/dashboard/ai-scanner`
- **Tạo & Tải mẫu in 2 Mã QR (Standee A6 300DPI):** `http://localhost:3000/dashboard/qr-studio`
- **Nâng cấp gói cước qua VietQR & Test Webhook:** `http://localhost:3000/dashboard/billing`
- **3 Cửa Hàng Mẫu (Luồng QR Cửa & QR Bàn):**
  1. **F&B (`fnb`):** `http://localhost:3000/s/pho-hoi-an` | Menu: `http://localhost:3000/s/pho-hoi-an/menu`
  2. **Spa & Nail (`service`):** `http://localhost:3000/s/linh-spa-nail` | Bảng giá: `http://localhost:3000/s/linh-spa-nail/menu`
  3. **Bán lẻ (`retail`):** `http://localhost:3000/s/dac-san-mien-trung` | Sản phẩm: `http://localhost:3000/s/dac-san-mien-trung/menu`

---

## 🧪 6. Các Lệnh Kiểm Tra (Scripts)

```bash
# Kiểm tra lỗi TypeScript toàn dự án
npm run typecheck

# Chạy bộ kiểm thử tự động End-to-End (E2E)
npm test

# Build bản Production
npm run build
```
