# 📋 QLAOK ("Quét Là OK") - Feature TODO & Roadmap

> **Chiến lược thực thi (Local-First + Token Saving với CodeGraph):**
> - **CodeGraph Indexing:** Khởi tạo `.codegraph` ngay sau khi dựng khung dự án (`npx @colbymchenry/codegraph init -i`). Ở mọi feature tiếp theo, dùng CodeGraph (`search`, `context`, `callees`, `impact`) để định vị đúng symbol/file thay vì đọc toàn bộ file, giúp tiết kiệm tối đa token.
> - **Local Backend & UI First:** Chạy toàn bộ **Backend (Next.js Route Handlers `/api/*` + Local Persistent Store / SQLite-JSON DB + Mock AI/Upload fallback)** và **UI (Storefront + CMS Dashboard + Marketing)** trực tiếp trên `localhost:3000` trước khi kết nối dịch vụ Cloud thực tế (Supabase Cloud, Cloudflare R2, SePay).

---

## 🚀 Phase 0: Khởi tạo Base, CodeGraph & Local Backend/UI (Ưu tiên chạy ngay)
- [x] **0.1. Khởi tạo Next.js 15+ (App Router, React 19, TypeScript Strict, Tailwind CSS, Lucide, Framer Motion)**
- [x] **0.2. Khởi tạo CodeGraph (`.codegraph`)** để index toàn bộ symbol và tiết kiệm token trong suốt quá trình code
- [x] **0.3. Định nghĩa TypeScript Interfaces (`src/types/qlaok.ts`)**
  - `SupportedLocale` (`vi`, `en`, `ko`, `ja`, `zh`), `PlanTier`, `BusinessVertical` (`fnb`, `service`, `retail`)
  - `Shop`, `Category`, `CatalogItem`, `ItemOptionGroup`, `Post`, `AnalyticsEvent`, `PaymentTransaction`, `CartSelection`
- [x] **0.4. Xây dựng Local Backend Store & Seed Data (`src/lib/local-db.ts` & `src/lib/seed-data.ts`)**
  - Lưu trữ dữ liệu persistent tại local (`.local-db/db.json`) kèm adapter tương thích với Supabase (`src/lib/supabase/`)
  - Tạo sẵn **Seed Data 3 cửa hàng mẫu đủ 5 ngôn ngữ (`vi`, `en`, `ko`, `ja`, `zh`)**:
    1. **Ngành F&B (`fnb`):** *Phở & Cà Phê Phố Cổ* (`/s/pho-hoi-an`)
    2. **Ngành Dịch vụ (`service`):** *Linh Herbal Spa & Nail Studio* (`/s/linh-spa-nail`)
    3. **Ngành Bán lẻ (`retail`):** *Làng Quà Việt – Đặc Sản & Lưu Niệm* (`/s/dac-san-mien-trung`)
- [x] **0.5. Khởi chạy Local Server (`npm run dev`) kiểm tra cả Backend API (`/api/health`, `/api/shops`) và UI**

---

## 📱 Feature 1: Phân hệ Khách hàng quét QR (`Storefront` & 2 Luồng QR)
- [x] **1.1. Cơ chế tự động nhận diện ngôn ngữ (`src/lib/i18n-helper.ts`)**
  - Ưu tiên: `?lang=` -> `localStorage('qlaok_lang')` -> `navigator.language` (`ko`, `ja`, `zh`, `vi`, `en`) -> kiểm tra `shop.supported_langs` -> fallback `en` / `vi`.
- [x] **1.2. Khung Mobile Storefront (`src/app/(storefront)/s/[slug]/layout.tsx`)**
  - Giao diện chuẩn Mobile-first (`max-w-md mx-auto`), header nhẹ, tích hợp đổi ngôn ngữ nhanh.
- [x] **1.3. Luồng QR Cửa - Micro-Website (`src/app/(storefront)/s/[slug]/page.tsx` - `?src=door`)**
  - Ảnh bìa (Cover), Logo, Tên quán & Tagline đa ngôn ngữ.
  - Trạng thái **Đang mở cửa / Đã đóng cửa** tự động tính theo `opening_hours` và giờ hiện tại.
  - Component `WifiBadge.tsx`: Hiển thị tên Wi-Fi & nút **Copy mật khẩu 1 chạm** (kèm bắn event `wifi_copy`).
  - Nút mở Google Maps chỉ đường & nút Đánh giá Google Maps (`google_review_url`).
  - Danh sách bài viết khuyến mãi / thông báo (`posts`).
  - Nút CTA nổi bật chuyển sang trang Xem Menu / Bảng giá (`/s/[slug]/menu`).
- [x] **1.4. Luồng QR Bàn/Quầy - Menu & Bảng giá (`src/app/(storefront)/s/[slug]/menu/page.tsx` - `?src=table`)**
  - `LanguageSwitcher.tsx`: Thanh chọn cờ 5 nước (`VI`, `EN`, `KO`, `JA`, `ZH`).
  - Thanh tìm kiếm món/dịch vụ theo ngôn ngữ hiện tại + Sticky Category Tabs.
  - `VerticalRenderer.tsx`: Tự động biến đổi bố cục theo 3 ngành:
    - **`fnb`:** Danh sách ngang, ảnh vuông bo góc `80x80px`, nút `+` thêm nhanh, quick tags (`Không hành`, `Ít đá`, `Ít ngọt`, `Không cay`, `Mang về`).
    - **`service`:** Bảng giá dạng dòng thanh lịch, hiện thời lượng (`⏱ 60 phút`), dấu chấm nối `......`, quick tags (`Đặt lịch trước`, `Làm nhẹ tay`, `Tư vấn tại quầy`).
    - **`retail`:** Lưới 2 cột (`2-Column Grid`) ảnh tỷ lệ `1:1`, quick tags (`Kiểm tra size/màu`, `Đóng gói quà tặng`).
- [x] **1.5. Chi tiết món (`ItemDetailDrawer.tsx`) & Thẻ "Đưa Nhân Viên Xem" (`ShowToStaffModal.tsx`)**
  - Chọn số lượng, tùy chọn (`options_json`), ghi chú nhanh theo ngôn ngữ của khách.
  - Bấm nút hành động chính ở Bottom Bar -> Bật modal toàn màn hình **Chữ Tiếng Việt kích thước lớn, độ tương phản cao** kèm số lượng, ghi chú đã dịch về Tiếng Việt và tổng tiền tạm tính để đưa nhân viên xem (kèm nút gửi qua Zalo/Telegram của quán).

---

## 🛠️ Feature 2: Giao diện Quản trị Chủ quán (`Mobile-First CMS Dashboard`)
- [x] **2.1. Layout Quản trị & Chuyển đổi Cửa hàng/Ngành nghề (`src/app/(dashboard)/dashboard/layout.tsx`)**
  - Điều hướng Bottom Bar trên di động / Sidebar trên máy tính, cho phép chọn nhanh giữa các cửa hàng mẫu hoặc tạo cửa hàng mới.
- [x] **2.2. Quản lý Danh mục & Món/Dịch vụ (`src/app/(dashboard)/dashboard/catalog/page.tsx`)**
  - Thêm/Sửa/Xóa/Sắp xếp Danh mục (`categories`) và Món/Dịch vụ (`items`).
  - Component `QuickItemRow.tsx`:
    - **Switch 1 chạm Còn hàng / Tạm hết (`is_available`)**: Cập nhật tức thì sang giao diện khách hàng (hiện nhãn *Tạm hết / Sold out* và làm mờ).
    - **Ô sửa giá tiền trực tiếp** ngoài danh sách không cần mở popup.
- [x] **2.3. Chỉnh sửa Đa ngôn ngữ & Dịch AI (`TranslationEditorModal.tsx` & `/api/ai/translate`)**
  - Chủ quán nhập Tiếng Việt -> Bấm **"Dịch tự động bằng AI"** -> Gọi Backend `/api/ai/translate` (dùng Gemini 2.5 Flash với Structured Output JSON 5 ngôn ngữ, có chế độ Local Smart Translation fallback nếu chưa điền `GEMINI_API_KEY`).
  - Cho phép xem và chỉnh sửa tay từng ngôn ngữ (`vi`, `en`, `ko`, `ja`, `zh`) trước khi lưu.
- [x] **2.4. Quản lý Bài viết Khuyến mãi (`src/app/(dashboard)/dashboard/posts/page.tsx`)**
  - Tạo/Sửa/Ghim thông báo, chương trình khuyến mãi đa ngôn ngữ hiển thị ngoài trang QR Cửa.
- [x] **2.5. Cài đặt Cửa hàng (`src/app/(dashboard)/dashboard/settings/page.tsx`)**
  - Chỉnh sửa thông tin quán, loại hình (`fnb` / `service` / `retail`), giờ đóng/mở cửa 7 ngày, Wi-Fi SSID/Password, liên kết Google Maps/Review, Zalo, màu chủ đạo (`theme_config`) và ngôn ngữ hỗ trợ.

---

## 🤖 Feature 3: AI Vision Menu Scanner & QR Print Studio
- [x] **3.1. AI Vision Menu Scanner (`src/app/(dashboard)/dashboard/ai-scanner/page.tsx` & `/api/ai/ocr-menu`)**
  - Nén ảnh phía Client (`browser-image-compression` sang `.webp`, `<= 800px`, `< 150KB`).
  - Gửi ảnh chụp menu giấy / màn hình GrabFood lên `/api/ai/ocr-menu` để trích xuất tự động Categories + Items + quy đổi giá (`35k` -> `35000`) + dịch 5 ngôn ngữ (hỗ trợ cả Gemini 2.5 Flash thật và chế độ Demo OCR mẫu tại local).
  - Giao diện Preview cho phép chủ quán kiểm tra, sửa tên/giá rồi bấm **"Lưu toàn bộ vào cửa hàng"**.
- [x] **3.2. QR Code & Print Studio (`src/app/(dashboard)/dashboard/qr-studio/page.tsx` & `PrintableStandee.tsx`)**
  - Tự động sinh 2 mã QR riêng biệt bằng `qrcode.react`:
    1. **Mã QR Dán Cửa (`/s/[slug]?src=door`)**
    2. **Mã QR Đặt Bàn/Quầy (`/s/[slug]/menu?src=table`)**
  - Thiết kế mẫu Standee A6 in ấn có tên quán, Wi-Fi, lời mời quét 5 thứ tiếng (`VI - EN - KO - JA - ZH`) và xuất ảnh PNG độ phân giải cao bằng `html-to-image`.

---

## 📊 Feature 4: Hệ thống Thống kê (Analytics) & Gói cước (Billing + VietQR)
- [x] **4.1. Backend Tracking & Dashboard Thống kê (`/api/analytics/track` & `/dashboard/page.tsx`)**
  - Ghi nhận sự kiện: `scan_door`, `scan_table`, `item_view`, `show_to_staff`, `wifi_copy` kèm `visitor_lang`.
  - Trang Tổng quan (`/dashboard`): Thống kê lượt quét QR Cửa, QR Bàn, biểu đồ tỷ lệ ngôn ngữ khách hàng (`VI`, `EN`, `KO`, `JA`, `ZH`), và Top 5 món/dịch vụ được xem nhiều nhất.
- [x] **4.2. Giới hạn Gói cước & Nâng cấp qua VietQR (`src/lib/plan-limits.ts`, `/dashboard/billing/page.tsx`, `/api/webhooks/payment`)**
  - Kiểm tra giới hạn theo gói:
    - **Free (0đ):** Tối đa 5 món, 1 ngôn ngữ (`vi`).
    - **Basic (39.000đ/tháng):** Tối đa 25 món, 3 ngôn ngữ.
    - **Premium (69.000đ/tháng):** Không giới hạn món, đủ 5 ngôn ngữ, mở khóa AI Vision OCR.
  - Tạo mã **VietQR động** kèm nội dung chuyển khoản (`QLAOK...`) và nút **Giả lập thanh toán thành công (Local Webhook Test)** gọi tới `/api/webhooks/payment` để test nâng cấp gói ngay trên local.

---

## 🌐 Feature 5: Auth, Onboarding Wizard, Landing Page & Local Directory
- [x] **5.1. Đăng nhập & Onboarding 3 bước (`(auth)/login/page.tsx` & `(auth)/onboarding/page.tsx`)**
  - Hỗ trợ đăng nhập nhanh ở chế độ Local Demo hoặc Supabase Auth (Google OAuth / OTP).
  - Wizard 3 bước tạo quán mới trong 2 phút (Chọn ngành nghề -> Nhập tên & Wi-Fi -> Tạo món đầu tiên).
- [x] **5.2. Landing Page Thương hiệu Qlaok (`src/app/(marketing)/page.tsx` & `pricing/page.tsx`)**
  - Hero Section *"Qlaok - Quét là OK: Tạo Menu, Bảng giá đa ngôn ngữ & Trang web riêng cho cửa hàng chỉ trong 2 phút"*.
  - **Interactive Live Demo** ngay trên trang chủ: bấm chuyển đổi trực tiếp giữa 3 ngành (`Quán Ăn`, `Tiệm Nail/Spa`, `Shop Bán Lẻ`) và 5 ngôn ngữ (`VI`, `EN`, `KO`, `JA`, `ZH`).
- [x] **5.3. Cổng Khám Phá Địa Điểm (`src/app/(marketing)/explore/page.tsx`)**
  - Trang Directory tìm kiếm và lọc các cửa hàng đang dùng Qlaok theo ngành nghề (`fnb`, `service`, `retail`) và khu vực/thành phố (Đà Nẵng, Hà Nội, TP.HCM, Hội An...).

---

## 🗄️ Feature 6: Đồng bộ Supabase SQL Schema & Cloud Adapters
- [x] **6.1. Xuất file migration chuẩn (`supabase/migrations/001_init_qlaok.sql`)** từ đặc tả mục 4 trong `document.md`.
- [x] **6.2. Cấu hình Cloudflare R2 Presigned Upload (`/api/upload/route.ts` & `src/lib/r2.ts`)** kèm fallback lưu ảnh local (`public/uploads`) khi chạy ở môi trường dev local.
