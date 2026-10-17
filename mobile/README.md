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
- Tạo `.env` theo `.env.example` trước khi chạy.

## Session và API

Sao chép `.env.example` sang `.env` và điền Supabase cùng API của môi trường cần dùng.
Trên điện thoại, API local cần IP LAN của máy chạy Next.js. Dev không tự chuyển
request lỗi sang production; bản release mặc định dùng `https://qlaok.vunph.click`
nếu không đặt `EXPO_PUBLIC_API_URL`. Không đưa service-role key vào biến Expo.

Ứng dụng yêu cầu đăng nhập Supabase Auth thật; tài khoản demo không bỏ qua xác thực.
Session native lưu bằng Expo SecureStore, tự refresh khi app foreground và logout
xóa session local. Danh sách làm việc lấy từ membership theo từng shop (`owner`, `cashier`, `staff`).
Staff mặc định nhận/phục vụ đơn; cashier được thu tiền và áp giảm giá; owner quản trị shop.
Server kiểm tra từng quyền, giao diện chỉ hiển thị thao tác tương ứng. Cần áp dụng
các migration trong repo theo thứ tự trước khi chạy phiên bản này.

REST gửi Bearer token hiện tại, báo lỗi HTTP và timeout 15 giây. Không dùng dữ liệu
`theme_config.recent_orders` thay thế khi API từ chối. Xác nhận thu tiền chỉ mở
biên nhận từ đơn server trả về thành công; thao tác đã phục vụ giữ nguyên payment.
In trên mobile hiện vẫn là preview/mô phỏng, chưa tích hợp máy in.

Kiểm tra: `npm run typecheck` và `npm test` (Node 24 hỗ trợ strip types).
Chưa có kiểm thử thiết bị cho cold start, refresh token, SecureStore và máy in.

## Kiểm tra giao diện web bằng fixture local

Chạy hai terminal từ repo (sau khi cài dependencies trong `mobile`):

```bash
node tests/mobile-ui-fixture.mjs
```

```bash
cd mobile
BROWSER=none EXPO_PUBLIC_API_URL=http://127.0.0.1:8090 EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:8090 EXPO_PUBLIC_SUPABASE_KEY=fixture-publishable-key npx expo start --offline --port 8083
```

Mở http://localhost:8083. Tài khoản fixture: `owner@fixture.test`,
`cashier@fixture.test`, `staff@fixture.test`; mật khẩu `fixture-password`.
Fixture chỉ lắng nghe loopback, không kết nối production. Mỗi lần đăng nhập reset
đơn giả; lần thu tiền đầu trả 403, lần tiếp theo thành công để kiểm tra UI lỗi và
biên nhận. Mock HTTP này không thay thế integration Supabase, realtime hoặc kiểm
thử thiết bị thật.

Đã kiểm tra thủ công trên Expo Web: đăng nhập sai/đúng, session sau reload,
đăng xuất, chuyển quán A/B, thu tiền lỗi/thành công, hóa đơn, quyền staff và nhận
đơn ở viewport 390×844. Sửa lỗi thông báo đăng nhập/cập nhật đơn không hiển thị
trên web, nút hủy không xét quyền và bố cục thẻ đơn hẹp.
