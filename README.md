# Qlaok ("Quét Là OK") – Hệ Thống mPOS, Gọi Món Tại Bàn & Web Đa Ngôn Ngữ Cho Mọi Cửa Hàng

Nền tảng Micro-SaaS B2B2C giúp các chủ cửa hàng tại **34 Tỉnh / Thành phố Việt Nam** (**Quán ăn/Cafe F&B**, **Tiệm Nail/Spa/Massage**, **Shop Đặc sản/Bán lẻ**) tạo **Menu / Bảng giá 5 ngôn ngữ tự động bằng AI (`VI`, `EN`, `KO`, `JA`, `ZH`)**, hệ thống **2 Mã QR chuyên biệt (QR Cửa & QR Bàn)** và **Màn hình Thu ngân / Bếp mPOS Realtime** (tự động nhận đơn từ bàn, báo chuông, quản lý số lượng tồn kho và thống kê doanh thu).

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

Hệ thống sử dụng **Supabase (PostgreSQL + Auth)** làm cơ sở dữ liệu chính (kèm cơ chế đồng bộ tồn kho/đơn hàng tại `.local-db/mpos-store.json` & `.local-db/db.json`).

### Bước 1: Điền biến môi trường vào `.env.local`
Lấy thông tin trong **Supabase Dashboard → Project Settings → API** và điền vào file `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://kftmrjmmympztzztunxf.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
```

### Bước 2: Khởi tạo & Cập nhật Bảng Tự Động (`npm run db:migrate`)
Bạn có thể chọn **1 trong 2 cách** sau để chạy toàn bộ các file SQL trong [`supabase/migrations/`](./supabase/migrations/):

- **Cách A – Chạy tự động bằng 1 lệnh CLI (`npm run db:migrate`) hoặc GitHub Actions CI/CD:**
  1. Tạo 1 **Personal Access Token (`sbp_...`)** tại `https://supabase.com/dashboard/account/tokens`.
  2. Điền vào `.env.local`: `SUPABASE_ACCESS_TOKEN=sbp_...`
  3. Chạy lệnh:
     ```bash
     npm run db:migrate
     ```
     Script [`scripts/migrate-supabase.mjs`](./scripts/migrate-supabase.mjs) sẽ tự động quét mọi file `.sql` theo thứ tự (`001_init_qlaok.sql`, `002_mpos_orders_inventory.sql`, ...) và thực thi trực tiếp lên Supabase qua HTTPS Management API. Ngoài ra, workflow [`.github/workflows/supabase-migrate.yml`](./.github/workflows/supabase-migrate.yml) sẽ tự động deploy các file `.sql` mới mỗi khi `git push` lên nhánh `main`.
- **Cách B – Chạy thủ công trên giao diện Web:**
  1. Mở [`supabase/migrations/001_init_qlaok.sql`](./supabase/migrations/001_init_qlaok.sql) và [`supabase/migrations/002_mpos_orders_inventory.sql`](./supabase/migrations/002_mpos_orders_inventory.sql).
  2. Vào **Supabase Dashboard → SQL Editor → New Query**, dán nội dung và bấm **Run**.

### Bước 3: Tự động nạp dữ liệu mẫu (Auto-Seed)
Ngay lần đầu tiên khởi động `npm run dev` (hoặc gọi `http://localhost:3000/api/health`), tầng dữ liệu [`src/lib/db.ts`](./src/lib/db.ts) và [`src/lib/mpos-store.ts`](./src/lib/mpos-store.ts) sẽ kiểm tra dữ liệu mẫu:
- Tự động nạp 3 cửa hàng mẫu đủ 5 ngôn ngữ (`pho-hoi-an`, `linh-spa-nail`, `dac-san-mien-trung`), 9 danh mục, 11 món/dịch vụ kèm số lượng tồn kho (`stock_quantity`), đơn hàng mPOS mẫu và thống kê doanh thu 7 ngày.
- Kiểm tra trạng thái kết nối bất cứ lúc nào tại: `http://localhost:3000/api/health` (`"dataSource": "supabase"`, `"supabaseTablesReady": true`).

---

## 🔔 3. Luồng Gọi Món Tại Bàn (mPOS Realtime) & Quản Lý Tồn Kho

1. **Khách quét QR tại bàn (`/s/[slug]/menu`):**
   - Chọn món / dịch vụ bằng 1 trong 5 ngôn ngữ (`VI`, `EN`, `KO`, `JA`, `ZH`), chọn tùy chọn/topping và ghi chú dị ứng.
   - Chọn số bàn (`Bàn 01`, `Bàn 02`... hoặc `Mang về`), phương thức thanh toán (`Tiền mặt` / `Chuyển khoản QR`) và bấm **🚀 Gửi Đơn Xuống Quầy / Bếp Ngay**.
   - Theo dõi trực tiếp trạng thái đơn hàng 3 bước ngay trên điện thoại: **Chờ quầy xác nhận (`new`) → Đang chế biến (`preparing`) → Đã phục vụ & Hoàn tất (`completed`)**.
2. **Màn hình Quầy Thu Ngân & Bếp (`/dashboard/orders`):**
   - Tự động phát **chuông báo âm thanh (Web Audio API)** + hiện **Toast thông báo nổi** và badge số đơn mới trên thanh điều hướng ngay khi khách gửi đơn.
   - Nhân viên bấm **Nhận đơn & Báo bếp**, **Đã phục vụ & Hoàn tất**, bật **Mã VietQR tự động điền số tiền theo bàn** hoặc **Tạo đơn nhanh tại quầy (POS)**.
3. **Tự động Trừ Tồn Kho & Khóa Món Hết Hàng (`/dashboard/catalog`):**
   - Mỗi món hỗ trợ cấu hình **Số lượng tồn (`stock_quantity`)** trực tiếp trên dòng món (hoặc để trống `∞` nếu không giới hạn).
   - Khi khách đặt món, hệ thống tự động trừ `stock_quantity` và cộng `sold_count`.
   - Khi `stock_quantity` về `0`, món tự động chuyển sang **`is_available = false` (Tạm hết)** trên cả Supabase lẫn màn hình menu của khách. Nếu hủy đơn, tồn kho được hoàn lại tự động.
4. **Thống kê Doanh Thu & Món Bán Chạy (`/dashboard`):**
   - Hiển thị **Doanh thu hôm nay**, **Tổng doanh thu lũy kế**, **Giá trị trung bình/đơn (AOV)**, **Biểu đồ doanh thu 7 ngày gần nhất**, **Cảnh báo món sắp hết hàng (`<= 5`)** và **Top món bán chạy nhất**.
5. **Ứng dụng Mobile Chủ Quán & Thu Ngân (`mobile/App.tsx` – React Native / Expo):**
   - Tích hợp **Tab `🔔 Đơn mPOS`** theo dõi đơn gọi món tại bàn theo thời gian thực, tự động **rung điện thoại (`Vibration.vibrate`) + hiện Banner thông báo nổi** khi có đơn mới, bấm **Nhận đơn & Báo bếp** / **Hoàn tất & Thu tiền** / **Hủy đơn**, chỉnh nhanh số lượng tồn kho (`-1`, `+5`, `∞`) và xem doanh thu thực tế.

---

## 🤖 4. Cấu hình 9Router AI & Tesseract OCR + Cloudflare R2

Trong file `.env.local`, hệ thống sử dụng cổng **9Router AI** (cấu hình tự do qua `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_VISION_MODEL`) kết hợp **Tesseract.js (`vie+eng`)** để vừa dịch món ăn vừa đọc ảnh chụp Menu giấy thực tế với bất kỳ model AI nào:

```env
# 9Router AI Server (combo1 cho dịch văn bản, combo2 cho quét ảnh/OCR)
AI_BASE_URL=https://vunph.click/v1
AI_API_KEY=sk-07c9f002b12e445e-luaxyd-d0592739
AI_MODEL=combo1
AI_VISION_MODEL=combo2

# Cloudflare R2 (Tuỳ chọn - Lưu trữ ảnh món ăn, logo, ảnh bìa đã nén WebP)
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=qlaok-assets
NEXT_PUBLIC_R2_PUBLIC_URL=https://pub-xxx.r2.dev
```

---

## 📂 5. Kiến trúc Dự án (Frontend & Backend)

```text
qlaok/
├── supabase/
│   └── migrations/
│       ├── 001_init_qlaok.sql              # Schema PostgreSQL + 34 Tỉnh thành Việt Nam + RLS
│       └── 002_mpos_orders_inventory.sql   # Bảng orders & cột tồn kho stock_quantity, sold_count
├── src/
│   ├── app/
│   │   ├── (marketing)/                    # Trang chủ Landing Page (/), Bảng giá (/pricing), Khám phá (/explore)
│   │   ├── (auth)/                         # Đăng nhập Supabase OTP (/login), Tạo quán 3 bước (/onboarding)
│   │   ├── (dashboard)/dashboard/          # CMS & mPOS Chủ quán: Tổng quan Doanh thu, Đơn hàng mPOS (/orders), Menu/Tồn kho (/catalog), AI Scanner, QR Studio
│   │   ├── (storefront)/s/[slug]/          # Giao diện Khách quét QR Cửa (/s/[slug]) & QR Bàn gọi món (/s/[slug]/menu)
│   │   └── api/                            # Hệ thống Backend API (Next.js App Router)
│   │       ├── orders/route.ts             # API Đơn hàng mPOS (Tạo đơn từ bàn/quầy, trừ tồn kho, cập nhật trạng thái)
│   │       ├── shops/route.ts              # CRUD Cửa hàng & lấy Storefront Bundle
│   │       ├── catalog/route.ts            # CRUD Danh mục, Món ăn/Dịch vụ, Tồn kho & Bulk Import
│   │       ├── items/route.ts              # Lấy danh sách món kèm tồn kho cho POS & Mobile
│   │       ├── posts/route.ts              # CRUD Bài viết khuyến mãi / thông báo
│   │       ├── analytics/track/            # Thống kê Doanh thu 7 ngày, Top bán chạy, Tồn kho & Lượt quét QR
│   │       ├── ai/translate/               # Dịch tự động 1 chạm sang 5 ngôn ngữ qua AI_MODEL
│   │       ├── ai/ocr-menu/                # Tesseract OCR (vie+eng) + AI_VISION_MODEL bóc tách ảnh chụp thực đơn giấy
│   │       ├── webhooks/payment/           # Tạo đơn VietQR & xử lý Webhook nâng cấp gói tự động
│   │       ├── upload/route.ts             # Presigned URL upload ảnh Cloudflare R2
│   │       └── health/route.ts             # Kiểm tra kết nối Supabase, R2, AI & số lượng bản ghi
│   ├── components/
│   │   ├── dashboard/                      # QuickItemRow (chỉnh giá & tồn kho 1 chạm), TranslationEditorModal, PrintableStandee
│   │   └── storefront/                     # VerticalRenderer (hiển thị tồn kho), ShowToStaffModal (Gửi đơn mPOS & Live Tracker)
│   └── lib/
│       ├── db.ts                           # Tầng Database chính kết nối trực tiếp Supabase
│       ├── mpos-store.ts                   # Engine xử lý Đơn hàng mPOS, trừ/hoàn tồn kho tự động & thống kê doanh thu
│       ├── vietnam-provinces.ts            # Danh sách chuẩn 34 Tỉnh / Thành phố Việt Nam
│       ├── i18n-helper.ts                  # Nhận diện ngôn ngữ máy khách, format tiền tệ, kiểm tra giờ đóng/mở cửa
│       ├── plan-limits.ts                  # Logic phân quyền gói Free / Basic / Premium
│       └── gemini.ts                       # Tích hợp 9Router AI (AI_MODEL & AI_VISION_MODEL)
```

---

## 🔗 6. Các Đường Dẫn Trải Nghiệm Chính

- **Trang chủ & Live Demo 3 ngành / 5 ngôn ngữ:** `http://localhost:3000/`
- **Danh bạ khám phá cửa hàng 34 tỉnh thành:** `http://localhost:3000/explore`
- **Trang Quản trị Doanh thu & Biểu đồ 7 ngày:** `http://localhost:3000/dashboard`
- **Màn hình Quầy Thu Ngân & Bếp (mPOS Orders):** `http://localhost:3000/dashboard/orders`
- **Quản lý Menu, Giá & Số lượng Tồn kho:** `http://localhost:3000/dashboard/catalog`
- **Quét Ảnh Menu Giấy (Tesseract OCR + AI):** `http://localhost:3000/dashboard/ai-scanner`
- **Tạo & Tải mẫu in 2 Mã QR (Standee A6 300DPI):** `http://localhost:3000/dashboard/qr-studio`
- **3 Cửa Hàng Mẫu (Luồng QR Cửa & QR Bàn Gọi Món Trực Tiếp):**
  1. **F&B (`fnb`):** `http://localhost:3000/s/pho-hoi-an` | Gọi món tại bàn: `http://localhost:3000/s/pho-hoi-an/menu`
  2. **Spa & Nail (`service`):** `http://localhost:3000/s/linh-spa-nail` | Đặt dịch vụ: `http://localhost:3000/s/linh-spa-nail/menu`
  3. **Bán lẻ (`retail`):** `http://localhost:3000/s/dac-san-mien-trung` | Mua hàng: `http://localhost:3000/s/dac-san-mien-trung/menu`

---

## 🧪 7. Các Lệnh Kiểm Tra (Scripts)

```bash
# Kiểm tra lỗi TypeScript toàn dự án
npm run typecheck

# Chạy 49 Unit Tests (7 Suites: 34 Tỉnh thành, i18n 5 ngôn ngữ, Plan Limits, AI/OCR Parser, R2, Seed Data, mPOS Engine & Tồn kho)
npm run test:unit

# Chạy 13 bài kiểm thử End-to-End (E2E API + Supabase + 19 Routes + mPOS Flow)
npm run test:e2e

# Chạy toàn bộ 62 bài kiểm thử (Unit Tests + E2E Tests)
npm test

# Build bản Production
npm run build
```
