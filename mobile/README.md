# Qlaok Mobile — Expo Owner / Cashier / Staff

Cập nhật 22/10/2026. Expo SDK 52, React 18, React Native 0.76; kết nối Supabase Auth và backend được cấu hình trong môi trường. Dùng CodeGraph từ repo root trước khi sửa code theo [AGENTS.md](../AGENTS.md) và [workflow](../docs/CODEGRAPH_WORKFLOW.md).

## Chức năng hiện tại

- Tổng quan doanh thu đơn hàng và analytics QR đọc trực tiếp `stats` tổng hợp phía server từ `GET /api/orders` (không bị giới hạn 1000 dòng của danh sách `orders` và không coi Show to Staff hay đơn hoàn tất chưa thanh toán là doanh thu thực thu).
- Catalog: tình trạng món, giá và tồn kho theo quyền server.
- Đơn mPOS: nhận/phục vụ, thu tiền và thao tác theo membership; realtime Postgres Changes với JWT, canonical reload qua API, fallback 30 giây khi lỗi.
- Thông báo đẩy (Push Notifications): dùng `expo-notifications` (kênh Android `qlaok-orders`, phát âm báo cả khi mở app). Xin quyền và lấy Expo push token khi có `EXPO_PUBLIC_EAS_PROJECT_ID` (hoặc `extra.eas.projectId`), đăng ký qua `POST /api/push-tokens` khi đăng nhập/đổi quán (yêu cầu quyền `orders.view`, tự thử lại khi lỗi mạng tạm thời), thử hủy best-effort qua `DELETE /api/push-tokens` trước khi xóa phiên đăng nhập local cả khi đăng xuất chủ động lẫn khi API trả HTTP 401 (chặn đệ quy 401; nếu access token đã hết hạn/không hợp lệ nên `DELETE /api/push-tokens` cũng bị từ chối thì vẫn xóa phiên local bình thường), và mở đúng quán + tab Đơn khi chạm thông báo đơn QR mới (nếu quán đích không còn khả dụng hoặc mất quyền `orders.view`, báo lỗi rõ và không tự chuyển sang quán khác). Để gửi tới thiết bị iOS/Android thật cần cấu hình EAS project ID và chứng chỉ APNs/FCM trên EAS.
- Khuyến mãi và settings theo quyền shop; chuyển cửa hàng theo membership owner/cashier/staff.
- VI/EN mặc định VI, locale native lưu SecureStore; catalog/khách hàng có miền 8 ngôn ngữ riêng theo gói.
- Biên nhận trên mobile là preview/mô phỏng, chưa xác nhận in phần cứng.

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

Kiểm tra từ thư mục mobile: `npm run typecheck` và `npm test` (dùng Node 24 như verify CI).
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
