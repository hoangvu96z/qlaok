> Báo cáo nền của lượt rà soát tài liệu ban đầu. Task bàn/theme/UI triển khai sau đó đã hoàn tất; xem [kết quả kiểm thử hiện tại](CODEX_TABLES_REVIEW.md) và [hướng dẫn quản lý bàn](TABLE_MANAGEMENT.md).

# Rà soát app và tài liệu — 18/10/2026

## Phạm vi và phương pháp

Rà soát cấu trúc và các luồng chính qua CodeGraph explore/node, status/files, manifest, migration inventory, CI và tài liệu có sẵn. Mục tiêu là chuẩn bị context/rules cho task tiếp, không sửa nghiệp vụ hoặc chạy deployment. Kết quả không phải kiểm toán bảo mật toàn bộ source hay xác minh production.

## Các chênh lệch đã chỉnh trong tài liệu hiện hành

| Nội dung cũ | Hiện trạng đã đối chiếu |
| --- | --- |
| Menu 5 ngôn ngữ | Type hỗ trợ 8, Premium maxLangs 8; quản trị VI/EN riêng |
| Node >=20 đủ cho mọi kiểm tra | Hướng dẫn dùng Node 24 như verify CI và test strip-types |
| Chỉ migration 001/002 | Có thêm 002z, 003, 004, 005, 006 |
| Web subscribe trực tiếp/nhận đơn đồng nghĩa thu tiền | Web SSE broker; payment và fulfillment độc lập |
| Local JSON đồng bộ/offline như DB thật | Orders dùng DB authoritative khi được cấu hình; không ghép local vào canonical response |
| Mobile mới có overview/catalog/settings | Có orders, promotions, membership, Supabase Auth và VI/EN |
| Doanh thu mobile ước tính từ Show to Staff | Hướng dẫn phân biệt order revenue và analytics tương tác |
| Route `/api/items` | Không có trong cây route hiện tại |
| Mật khẩu admin mẫu | Chỉ khởi tạo credential khi cấu hình env rõ ràng |
| Test count cố định và “100%” sẵn sàng | Chỉ ghi kết quả của lần chạy, giữ giới hạn thiết bị/ngân hàng/production |
| CodeGraph là gợi ý | Rule bắt buộc với MCP → CLI → báo lỗi/dừng sửa code nếu không có fallback được phép |

## Điểm cần theo dõi cho task tiếp

1. **Webhook SaaS:** `verifyWebhookSignatureOrSecret` còn secret fallback trong source khi không cấu hình env. Đã ghi hạn chế; chưa sửa vì lượt này chỉ tài liệu/rules. Cần hardening riêng và regression nếu đổi hành vi.
2. **Health:** `GET /api/health` gọi seed và vẫn trả `status: ok` dù readiness false; không dùng HTTP 200 làm bằng chứng mọi dịch vụ hoạt động.
3. **Khả năng mở rộng:** order reload/statistics còn dựa lịch sử đầy đủ; catalog không có stream riêng.
4. **Tooling:** root `lint` dùng `next lint`, thiếu cấu hình/dependency ESLint; không khẳng định lint pass. CodeGraph status cảnh báo index từ engine cũ; graph không thay compiler/test.
5. **Tài chính/vận hành:** cần đối chiếu legacy bank-ref archive và local-only orders trước rollout tương ứng; chốt ca/ledger và kiểm thử thiết bị/máy in còn giới hạn trong notes hiện có.

Đây là các giới hạn quan sát được hoặc được ghi nhận từ review trước, không phải task triển khai đã được người dùng yêu cầu trong lượt này.

## Tài liệu/rule sau cập nhật

- `README.md`: entry point vận hành hiện tại.
- `ARCHITECTURE.md`: bản đồ route/core, auth, orders/payment, realtime, locale, rollout và giới hạn.
- `AGENTS.md`: quy tắc root cho Codex và coding agent.
- `.agent/rules/codegraph.md`: always-on rule cho AGY/Antigravity.
- `GEMINI.md`: entry point bổ sung cho AGY/Gemini.
- `docs/CODEGRAPH_WORKFLOW.md`: workflow chung, ngoại lệ và bằng chứng bàn giao.
- `mobile/README.md`: hướng dẫn mobile và giới hạn thiết bị.
- Báo cáo cũ, roadmap và đặc tả giữ nội dung lịch sử, thêm nhãn và link hiện trạng để không bị hiểu là trạng thái latest.

## Kiểm chứng lượt này

Đã chạy và pass ngày 18/10/2026:

- `npm run typecheck` và `npm run typecheck --prefix mobile`.
- `npm run test:unit`, `npm run test:review` (38 pass), `npm run test:sql` (1 pass), `npm test --prefix mobile` (18 pass).
- `git diff --check` và kiểm tra tồn tại các link file Markdown trong README/architecture/rules/review/mobile README.

Node cảnh báo MODULE_TYPELESS_PACKAGE_JSON ở các test TypeScript; suite vẫn exit 0. Chưa chạy build trong lượt chỉ sửa Markdown/rules này; kết quả build trong notes cũ thuộc lượt trước. Không chạy E2E ghi dữ liệu, migration production, deploy, máy in hoặc thiết bị thật. Không sửa source nghiệp vụ.
