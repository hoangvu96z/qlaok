# Bảng dữ liệu, chart và export

Rà soát: 20/10/2026.

## Phạm vi bảng

9 bảng dữ liệu tương tác trên web: 4 tab Báo cáo (đơn, bàn, ngày, món), 4 bảng Super Admin (tổng quan quán, người dùng, đơn hàng toàn hệ thống, giao dịch), 1 lịch sử giao dịch Billing. Dùng `react-data-table-component` qua wrapper dùng chung `AppDataTable` để thống nhất theme, ngôn ngữ và hành vi bảng.

React Native hiện dùng View/Text cho các danh sách, không có HTML table. Không đưa thư viện React DOM này vào mobile. HTML table trong mẫu in hóa đơn là bố cục in tĩnh, được giữ lại để in trên trình duyệt và giấy nhiệt.

## Chart hiện tại

Không có Recharts, Chart.js hay thư viện chart chuyên dụng trong manifest web/mobile. Dashboard web tự vẽ biểu đồ đường/miền và vòng tròn bằng SVG, cột và thanh bằng CSS; mobile dùng View/Text và style. Lucide/Ionicons là icon, không phải thư viện chart. Lượt thay đổi này không đổi công nghệ chart.

## Sai lệch export được phát hiện

- Các nút export cũ xuất dữ liệu đơn/chi tiết món cố định, không theo tab tổng hợp người dùng đang xem.
- File gọi là Excel `.xls` thực chất là HTML, không phải workbook Excel chuẩn.
- Export chỉ phân biệt paid/unpaid nên đơn refunded bị ghi thành chưa thu.
- Tổng hợp theo ngày cộng cả đơn chưa thu/hoàn tiền vào doanh thu, trong khi KPI thực thu và tổng hợp bàn chỉ cộng đơn đã thu không bị hủy.

## Quy ước export mới

- CSV/XLSX xuất tab hiện tại, cột dữ liệu của tab, bộ lọc và thứ tự sắp xếp hiện tại; không xuất cột nút thao tác hoặc trường nội bộ không có trên bảng.
- Người dùng chọn rõ toàn bộ kết quả đã lọc (mặc định) hoặc trang đang xem. Phân trang chỉ giới hạn export khi đã chọn phạm vi trang hiện tại.
- CSV có UTF-8 BOM, quote/escape dấu phẩy, dấu nháy và xuống dòng. Nội dung có thể bị phần mềm bảng tính hiểu thành công thức được xử lý thành text.
- XLSX thật được tạo bằng ExcelJS, tải thư viện khi người dùng xuất file. Sheet Report chứa bảng, sheet Filters lưu ngữ cảnh xuất; số tiền được lưu dạng số và mã dạng text.
- Thực thu chỉ gồm đơn paid không bị hủy. Trạng thái phục vụ độc lập trạng thái thu tiền. Giá trị món trước giảm giá theo đơn/hoàn tiền phải được ghi rõ, không gọi nhầm là tiền thực thu hoặc tự chia giảm giá vào từng món.
- Không xuất dữ liệu đang tải, bị lỗi hoặc còn thuộc quán trước khi đổi quán. Không tự chạy migration hay đổi quyền server.

## Kiểm chứng

CodeGraph đã dùng: explore khu vực report/export/table/chart; node reports, dashboard, manifest dependency, types, order pricing, dashboard context và auth-session. Các file chịu tác động: reports, admin, billing, wrapper AppDataTable, report-view, table-export và manifest dependency. Không đổi API, schema, quyền hay mobile UI.

- Typecheck web/mobile: đạt.
- Unit web: 66; review: 58; SQL: 1; mobile: 18 — đều đạt.
- Chromium với API giả lập: 4 bảng Reports, 4 bảng Admin và Billing render; sort/phân trang, đổi VI/EN, tìm kiếm, phạm vi export và trạng thái rỗng được kiểm tra. Billing và Reports kiểm tra chiều rộng 390px.
- Tải và đọc lại 7 cặp CSV/XLSX: trang đơn hiện tại, toàn bộ đơn đã lọc, bàn, ngày, món, tìm kiếm VI và tìm kiếm EN. Đối chiếu tiêu đề, số dòng và thứ tự với UI; workbook có sheet Report/Filters và số tiền dạng số. Dữ liệu quán khác bị loại. Export bàn giữ mã, khu vực và trạng thái bàn đang hiển thị.
- API đơn trả lỗi 500: có thông báo lỗi và khóa export; không xuất dữ liệu cũ.
- Chưa kiểm thử tải dữ liệu thật/ghi DB production hoặc các thao tác quản trị có thay đổi dữ liệu. Các kiểm tra trình duyệt dùng dữ liệu cô lập, không ghi DB.

Build production (`npm run build`): đạt sau khi dừng dev server. `git diff --check`: đạt.


## Sửa lỗi theme và ngôn ngữ sau phản hồi UI

Rà soát lại ngày 20/10/2026: kiểm tra trước đó chấp nhận bảng Admin luôn tối là kỳ vọng sai. Bốn bảng Admin phải dùng theme hiện tại của ứng dụng, không ép dark trong light mode. Kiểm chứng cần đo màu nền/chữ thực tế của bảng khi chuyển light → dark → light và qua cả bốn tab, không chỉ kiểm tra render thành công.

Storefront có miền ngôn ngữ riêng tám locale; helper chỉ phân biệt VI/EN không phù hợp cho checkout/tracking. Thông báo hệ thống (kể cả thiếu QR, chọn bàn, lỗi và nhãn hỗ trợ truy cập) phải dùng locale khách chọn. Tên/nội dung do quán nhập có thể giữ nguyên khi chưa có bản dịch; tên món tiếng Việt kèm bản dịch là hành vi đối chiếu với quầy, không phải nhãn hệ thống.
