# Qlaok Mobile Owner App (React Native + Expo)

Ứng dụng di động dành riêng cho **Chủ quán Qlaok** (iOS & Android) kết nối trực tiếp tới cùng cơ sở dữ liệu **Supabase (`https://kftmrjmmympztzztunxf.supabase.co`)** với phiên bản Web.

## 🚀 Tính năng chính trên Mobile App
1. **📊 Doanh thu & Lượt quét QR (`Overview`)**:
   - Xem doanh thu ước tính từ lượt khách đưa màn hình gọi món (`Show to Staff`).
   - Theo dõi tổng lượt quét **QR Cửa**, **QR Bàn**, lượt khách kết nối **Wi-Fi**, và **Top món bán chạy nhất**.
2. **🍜 Quản lý Thực đơn 1 chạm (`Catalog`)**:
   - **Gạt Còn món / Hết hàng (`Switch`) 1 chạm** — đồng bộ tức thì lên Supabase & Web Storefront.
   - Tăng/giảm giá nhanh (`-5k` / `+5k`) và thêm món mới ngay trên điện thoại.
3. **⚙️ Cài đặt Cửa hàng & Wi-Fi (`Settings`)**:
   - Đổi tên cửa hàng, Tỉnh/Thành phố (34 tỉnh thành), Số điện thoại/Zalo và mật khẩu Wi-Fi.

## 🛠️ Cách chạy ứng dụng React Native (Expo)

```bash
cd mobile
npm install
npx expo start
```

- Tải ứng dụng **Expo Go** trên iPhone (App Store) hoặc Android (Google Play), quét mã QR hiển thị trên terminal để chạy trực tiếp trên điện thoại thật.
- Biến môi trường Supabase đã được cấu hình sẵn trong [`mobile/.env`](./.env).
