# Qlaok ("Quét Là OK") – Menu, Bảng giá & Web Đa Ngôn Ngữ Cho Mọi Cửa Hàng

Nền tảng Micro-SaaS B2B2C giúp các chủ cửa hàng tại Việt Nam (**Quán ăn/Cafe F&B**, **Tiệm Nail/Spa/Massage**, **Shop Đặc sản/Bán lẻ**) tạo **Menu / Bảng giá 5 ngôn ngữ tự động bằng AI (`VI`, `EN`, `KO`, `JA`, `ZH`)** và hệ thống **2 Mã QR chuyên biệt (QR Cửa & QR Bàn)** chỉ trong 2 phút.

## 🚀 Chạy dự án tại Local (`http://localhost:3000`)

```bash
npm install
npm run dev
```

Hệ thống được thiết kế theo kiến trúc **Local-First + Cloud-Ready**:
- Hoạt động ngay lập tức với **Local Persistent Database (`.local-db/db.json`)** cùng dữ liệu mẫu 3 cửa hàng đủ 5 ngôn ngữ mà không bắt buộc phải cấu hình biến môi trường Cloud.
- Khi điền các biến môi trường (`NEXT_PUBLIC_SUPABASE_URL`, `GEMINI_API_KEY`, `R2_ACCOUNT_ID`...), hệ thống tự động kích hoạt **Google Gemini 2.5 Flash**, **Supabase Database/Auth**, và **Cloudflare R2**.

## 🔗 Các Đường Dẫn Trải Nghiệm Chính

- **Trang chủ & Live Demo 3 ngành / 5 ngôn ngữ:** `http://localhost:3000/`
- **Danh bạ khám phá cửa hàng (Directory):** `http://localhost:3000/explore`
- **Trang Quản trị Chủ quán (Mobile-First CMS):** `http://localhost:3000/dashboard`
- **Quản lý Danh mục & Món (Gạt Còn/Hết & Đổi giá 1 chạm):** `http://localhost:3000/dashboard/catalog`
- **AI Vision Quét Ảnh Menu Giấy:** `http://localhost:3000/dashboard/ai-scanner`
- **Tạo & Tải mẫu in 2 Mã QR (Standee A6):** `http://localhost:3000/dashboard/qr-studio`
- **Nâng cấp gói cước qua VietQR & Test Webhook:** `http://localhost:3000/dashboard/billing`
- **3 Cửa Hàng Mẫu (Luồng QR Cửa & QR Bàn):**
  1. **F&B (`fnb`):** `http://localhost:3000/s/pho-hoi-an` | Menu: `http://localhost:3000/s/pho-hoi-an/menu`
  2. **Spa & Nail (`service`):** `http://localhost:3000/s/linh-spa-nail` | Bảng giá: `http://localhost:3000/s/linh-spa-nail/menu`
  3. **Bán lẻ (`retail`):** `http://localhost:3000/s/dac-san-mien-trung` | Sản phẩm: `http://localhost:3000/s/dac-san-mien-trung/menu`
