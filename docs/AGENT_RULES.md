# Quy tắc tự nạp cho Codex và Antigravity CLI

Kiểm tra tài liệu chính thức ngày 18/10/2026: [Google Antigravity — Rules](https://www.antigravity.google/docs/rules/).

## Cấu hình trong repo

| File | Vai trò |
| --- | --- |
| `AGENTS.md` | Chính sách chung cho Codex và mọi coding agent ở toàn repo. |
| `GEMINI.md` | Entry point Antigravity ở workspace root. |
| `.agents/rules/codegraph.md` | Rule Antigravity `always_on`: nạp mỗi lượt, inline chính sách chung và quy trình CodeGraph. |
| `docs/CODEGRAPH_WORKFLOW.md` | Quy trình bắt buộc, ngoại lệ và bằng chứng bàn giao. |
| `docs/AGY_*`, `AGY_*.md` | Handoff/progress/review lịch sử; chỉ đọc khi liên quan task, không tự nạp thành rule. |

`.agents/rules/` là vị trí hiện tại theo tài liệu CLI. `.agent/rules/` là vị trí legacy vẫn được hỗ trợ; repo đã chuyển sang đường dẫn hiện tại và không giữ hai bản trùng nhau. Không cần chuyển báo cáo lịch sử vào rules hoặc thay cấu hình global ảnh hưởng dự án khác.

## GitHub Actions MCP

Use the project-scoped server in `.codex/config.toml` to inspect Actions for `hoangvu96z/qlaok`. GitHub's hosted MCP requires `GITHUB_PAT_TOKEN` in the user's process environment; never store it in the repository or `.env`. This endpoint does not support Dynamic Client Registration, so `codex mcp login github` cannot authenticate it. Use a GitHub MCP connector already provided by the Codex host, or configure the PAT described in [GitHub Actions workflow](GITHUB_ACTIONS_WORKFLOW.md). Commit matching and fallback rules are in [AGENTS.md](../AGENTS.md).

Rule có frontmatter `trigger: always_on` hợp lệ. Dùng `@[label](path)` để nhúng nội dung AGENTS.md và CODEGRAPH_WORKFLOW.md; đường dẫn tính từ file rule. Link Markdown thông thường chỉ là tham chiếu, không bảo đảm nhúng nội dung. Không dùng `manual`/`model_decision` cho quy tắc bắt buộc. Không đặt rule trong thư mục con của rules vì CLI mặc định chỉ quét file `.md` trực tiếp.

## Kiểm chứng và phạm vi cưỡng chế

Mở phiên `agy` mới từ repo root. Giao một task chỉ đọc định vị symbol mà không nhắc tên CodeGraph; kiểm tra transcript có `codegraph explore` trước khi đọc source, rồi `codegraph node` nếu cần. Yêu cầu agent báo quy trình bắt buộc và Rule ID `QLAOK_CODEGRAPH_ALWAYS_ON_V1` để đối chiếu nội dung được nạp. Nếu làm mobile, vẫn chạy CLI từ repo root và giao phạm vi `mobile/` để giữ đúng workspace/index.

`always_on` bảo đảm chính sách được đưa vào context theo cơ chế CLI; Markdown không phải sandbox hoặc hook chặn mọi lệnh vi phạm. Codex phải kiểm tra transcript/diff và tự chạy test trước khi chấp nhận kết quả. Khi thay rule, kiểm chứng bằng phiên mới; không dựa vào lời xác nhận trong hội thoại cũ.

## Kết quả kiểm chứng ngày 18/10/2026

- Chạy binary `agy` trong phiên mới, chế độ `plan`, từ repo root; prompt chỉ yêu cầu audit chỉ đọc và định vị `dbCreateOrder`, không nhắc CodeGraph hay đường dẫn rule.
- Agent tự nhận đúng `QLAOK_CODEGRAPH_ALWAYS_ON_V1`. Tool đầu tiên là `run_command` với `codegraph status && codegraph explore "dbCreateOrder" && codegraph query dbCreateOrder`; không có bước grep/đọc source trực tiếp trước đó.
- CLI trả `SUCCESS`; định vị được `src/lib/mpos-store.ts:1363` và các importers. Không sửa source trong probe.
- Kiểm tra frontmatter, các đường dẫn inline, loại bỏ rule legacy trùng và `git diff --check`: pass. Rule sau nhúng khoảng 8 KB, dưới giới hạn 24 KB/file.
- Phạm vi thay đổi: cấu hình agent và Markdown; không đổi hành vi app nên không chạy lại test ứng dụng. Probe xác nhận phiên mới ở repo root; chưa kiểm chứng mọi chế độ CLI/IDE hay hook cưỡng chế. Transcript tạm: `/tmp/qlaok-agy-rules-probe.ndjson` (không phải tài liệu được commit).
