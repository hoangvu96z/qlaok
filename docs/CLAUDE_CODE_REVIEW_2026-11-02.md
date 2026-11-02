# Claude CLI code review — 2026-11-02

## Trạng thái

**Chưa hoàn tất review toàn bộ codebase.** Các lần chạy Claude CLI với ngữ cảnh repository-wide không tạo ra verdict dùng được: một phiên vượt giới hạn 32 MB do nội dung/attachment tích lũy trong conversation; phiên thử tiếp theo không sinh output. Không dùng những phiên đó làm kết luận review.

Trong lúc chia nhỏ phạm vi, Claude CLI hoàn tất một lượt chỉ đọc cho call path tra cứu shop storefront bằng slug. Kết quả và bản sửa hẹp được ghi tại [mục 189 trong review ngày 27/10](./CLAUDE_CODE_REVIEW_2026-10-27.md#189-claude-cli-review-gi%E1%BB%9Bi-h%E1%BA%A1n-storefront-slug-lookup-v%C3%A0-x%E1%BB%AD-l%C3%BD-l%E1%BB%97i-truy-v%E1%BA%A5n-2026-11-02).

## Phạm vi Claude đã xem

- `GET /api/shops?slug=qlaok` và điều kiện trả về 404.
- Chuẩn hóa slug, tra canonical slug rồi tra `shop_slug_aliases`.
- Kiểm tra shop có public/được phép xem hay không.
- Quan hệ giữa route shell `/s/qlaok/menu` và request dữ liệu shop phía client.

## Finding và sửa

Hai truy vấn `shops` trong canonical lookup và alias-to-shop lookup bỏ qua thuộc tính `error`. Lỗi database hoặc quyền truy cập có thể bị diễn giải thành “không tìm thấy shop”, khiến API trả 404 gây hiểu sai nguyên nhân.

`src/lib/db.ts` hiện ném lỗi ổn định `STOREFRONT_SHOP_LOOKUP_FAILED` hoặc `STOREFRONT_SHOP_ALIAS_LOOKUP_FAILED` khi các truy vấn đó lỗi; thông báo DB thô không được đưa vào lỗi ứng dụng. Hành vi không tìm thấy row hợp lệ vẫn là `null`. Regression nằm trong `tests/storefront-shop-lookup-review.test.ts`.

## Không kết luận được

404 production hiện tại chưa xác định được là do không có canonical/alias row, shop chưa public, lỗi query, cấu hình production hay artifact. HTML 200 chỉ xác nhận route shell tải được. Lượt này không truy vấn DB production và không chứng minh production 404 đã được khắc phục.

## Kiểm tra cục bộ

- Test mới: 4/4 pass.
- `npm run test:unit`: 144/144 pass.
- `npm run test:review`: 470/470 pass.
- `npm run typecheck`: pass.
- `npm run lint`: pass, 0 lỗi; còn warning ESLint hiện hữu.
- `npm run build`: pass.
- `git diff --check`: pass.
