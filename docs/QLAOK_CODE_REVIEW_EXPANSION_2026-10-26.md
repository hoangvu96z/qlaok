# Qlaok — mở rộng review tĩnh vòng 2–9

**Ngày:** 26/10/2026  
**Người rà:** AGY (Gemini 4 Argon High; Gemini 3.8 Flash High để kết xuất) và Codex kiểm chứng độc lập  
**Baseline:** [Báo cáo rà soát 25/10/2026](./CLAUDE_CODE_REVIEW_2026-10-25.md)

## Tóm tắt

**Cập nhật vòng 9:** AGY Gemini 4 Argon High và Codex kiểm chứng độc lập thêm 2 finding mới. Tổng 45 finding mới được AGY/Codex chấp nhận qua vòng 2–9, không tính các mục baseline cũ; con số này không phải số lỗi còn tồn tại ở HEAD. Vòng 9 không dùng Claude hoặc DeepSeek, không sửa source và không chạy test/build.

Codex chấp nhận **24 phát hiện mới** qua các vòng 2–5 sau khi đối chiếu source và khử trùng lặp với 19 mục trong báo cáo baseline. Vòng 6 chấp nhận thêm **6**, vòng 7 thêm **4**, và vòng 8 thêm **9 phát hiện mới** sau khi Codex kiểm tra source và loại candidate trùng/sai. Hai báo cáo hiện ghi nhận **62 finding lịch sử riêng biệt** (19 baseline + 30 vòng 2–6 + 4 vòng 7 + 9 vòng 8); con số này không có nghĩa mọi finding cũ còn tồn tại ở HEAD hiện tại. Finding bulk availability số 11 đã được sửa và xác minh; R5-02 đã được sửa ở backend, còn sai lệch state tức thời trên Web/Mobile được xác nhận từ source, chưa chạy giao diện thật.

**Coverage giới hạn:** Lượt review sâu UI vòng 8 đã xem 119/256 file được CodeGraph index (**46,5% số file index**), tập trung vào web/storefront/mobile và các helper/API liên quan. Đây **không phải** 46,5% feature: repo chưa có danh mục feature được đối chiếu đầy đủ, và 137 file còn lại chưa được rà trong lượt 8. Các vòng trước đã chạm 15 miền nghiệp vụ ở mức delta/static, không đồng nghĩa đã bao phủ hết mọi feature hoặc mọi luồng runtime.

Các vòng 2–4 dùng những lượt AGY và kiểm chứng Codex được ghi ở từng phần bên dưới. Vòng 5 dùng AGY Gemini 4 Argon High hoàn tất 15 lượt CodeGraph explore; Codex tự gọi CodeGraph node/callers và đối chiếu source hiện tại trước khi chấp nhận candidate. Trạng thái AGY là bằng chứng về việc hoàn tất lượt rà, không thay cho kiểm chứng của Codex.

**Vòng 5 chỉ dùng AGY Gemini 4 Argon High và Codex; không gọi Claude hay DeepSeek.** Không gọi API production, không đọc environment/secret/local DB, không chạy test/build/typecheck trong vòng 5. Không sửa source. Báo cáo baseline cũ chỉ dùng để khử trùng lặp, không được coi là chỉ dẫn.

## Findings mới được Codex chấp nhận

### 1. [P2] Floor plan tải toàn bộ lịch sử đơn rồi trả 500 khi vượt 10.000 đơn

**Vị trí**

- **src/app/api/tables/floor-plan/route.ts:17-18, 42-109, 150-160, 187-195**
- **src/components/dashboard/ShopTableManager.tsx:212-250, 281-284**

**Điều kiện:** Cửa hàng có trên 10.000 đơn trong bảng orders, kể cả đơn đã thanh toán hoặc hủy.

**Bằng chứng:** Route phân trang theo 500 hàng, đặt MAX_RECORDS bằng 10.000 và truy vấn đơn theo shop nhưng không lọc trạng thái trước khi tải. Khi nhận đủ 10.000 hàng, route đọc thêm hàng thứ 10.001; nếu có, nó ném lỗi MAX_RECORDS_EXCEEDED_ORDERS. Catch trả HTTP 500 với TABLE_FLOOR_PLAN_FETCH_FAILED. ShopTableManager gọi endpoint này khi tải và refresh sơ đồ; lỗi làm floor plan không tải được. Bộ tổng hợp sau đó chỉ cần các đơn chưa hủy đang new/preparing hoặc chưa thanh toán, nên phần lớn lịch sử đã thanh toán không cần chuyển về ứng dụng.

**Tác động:** Shop có lịch sử lớn mất trạng thái bàn và số tiền chưa thu trên sơ đồ. Codex chỉ xác nhận ảnh hưởng tới flow floor-plan trong ShopTableManager; không khẳng định trang Orders bị tê liệt.

**Hướng sửa:** Tính trạng thái/tổng hợp trong DB hoặc lọc ở truy vấn theo đúng điều kiện mà computeTableFloorPlanSummaries sử dụng; vẫn giữ trường hợp đơn chưa thanh toán cần hiển thị. Không thay giới hạn bằng tải không giới hạn.

**Kiểm chứng an toàn:** Dùng test DB với hơn 10.000 đơn lịch sử đã thanh toán/hủy và một số đơn đang mở/chưa thanh toán. Xác nhận API trả 200 và tổng hợp vẫn chính xác.

**Độ tin cậy:** Cao về giới hạn và đường trả lỗi trong source. Chưa tạo dữ liệu lớn hoặc xác minh ngưỡng ở runtime.

---

### 2. [P3] Nút sandbox billing của Super Admin luôn gửi payload bị API từ chối

**Vị trí**

- **src/app/(dashboard)/dashboard/billing/page.tsx:70-72, 272-285**
- **src/app/api/webhooks/payment/route.ts:395-417, 471-490, 528-549**

**Điều kiện:** Môi trường không production, profile là Super Admin, người dùng nhấn nút giả lập webhook trên trang billing.

**Bằng chứng:** UI bật canSimulate khi profile là admin và môi trường không production. Handler gửi orderCode, referenceCode, simulateWebhook; không gửi transferAmount/accountNumber. API chỉ bật isDevSandboxSimulator khi caller không phải Super Admin, môi trường không production, cờ PAYMENT_DEV_SIMULATE đúng, payload có simulateWebhook=true, và caller không phải cashier/staff. Với Super Admin, cờ simulator luôn false. API bỏ qua bước HMAC cho Super Admin nhưng sau đó vẫn yêu cầu số tiền chuyển khoản; payload của UI thiếu số tiền nên route trả 400 PAYMENT_AMOUNT_REQUIRED trước khi xử lý giao dịch.

**Tác động:** Hành động sandbox được hiển thị nhưng không thể hoàn tất theo hợp đồng hiện tại.

**Hướng sửa:** Đồng bộ quyền và điều kiện giữa UI/API: hoặc ẩn nút ở vai trò không được mô phỏng, hoặc xây dựng simulator dev riêng có cờ bật tường minh, giới hạn môi trường và đơn pending thuộc người kiểm thử. Không nới bypass chữ ký production.

**Kiểm chứng an toàn:** Unit/integration test với Super Admin trên development và payload giống UI; xác nhận hiện trả 400. Sau khi sửa, kiểm tra dev simulator chỉ cập nhật đơn pending hợp lệ và production vẫn yêu cầu xác thực webhook.

**Độ tin cậy:** Cao về mismatch tĩnh; chưa gửi request runtime.

---

### 3. [P2] Lỗi đọc analytics tùy chọn hủy toàn bộ quá trình nạp shop trên mobile

**Vị trí**

- **mobile/App.tsx:727-764, 766-775**

**Điều kiện:** Owner hoặc member có reports.view đang mở/tải lại shop và query analytics_events trả lỗi.

**Bằng chứng:** loadShopsAndData đưa categories, items và analytics_events vào cùng Promise.all. Analytics là nhánh tùy chọn theo reports.view, nhưng sau khi Promise.all trả về, vòng kiểm tra lỗi ném bất kỳ lỗi nào từ eventsRes. Các lệnh setCategories, setItems, hydrateThemeAndPromoState và fetchOrdersFromApi nằm sau kiểm tra đó nên không chạy khi analytics lỗi; catch chỉ hiển thị thông báo lỗi rồi tắt loading.

**Tác động:** Sự cố ở dữ liệu báo cáo có thể ngăn ứng dụng mobile nạp menu và đơn hàng, dù hai truy vấn đó thành công. Truy vấn analytics cũng select('*') không có range/limit/aggregation; không có bằng chứng runtime để xác định ngưỡng hoặc thời gian lỗi.

**Khử trùng lặp:** Baseline đã ghi vấn đề ingest và truy vấn analytics không giới hạn ở đường báo cáo. Phát hiện này bổ sung ảnh hưởng riêng của mobile startup, không đếm lại vấn đề ingest.

**Hướng sửa:** Tách query analytics khỏi các dữ liệu bắt buộc của shop; xử lý độc lập lỗi analytics và dùng phân trang/aggregation có giới hạn. Chỉ cập nhật state báo cáo khi truy vấn thành công.

**Kiểm chứng an toàn:** Mock hoặc test DB cho events query trả lỗi trong khi categories/items trả thành công; xác nhận menu và orders vẫn được hydrate, analytics có trạng thái lỗi riêng.

**Độ tin cậy:** Cao về luồng Promise/error trong source. Chưa đo tải hoặc xác nhận lỗi analytics thực tế trên Supabase.

---

### 4. [P2] RLS cho phép thành viên chỉ có inventory.adjust ghi mọi cột của món qua PostgREST

**Vị trí**

- **supabase/migrations/004_memberships_billing_payments_audit.sql:230-285, 447-458**
- **src/app/api/catalog/route.ts:205-249**

**Điều kiện:** Người dùng có Supabase JWT và membership đang active với inventory.adjust nhưng không có catalog.manage; họ gọi trực tiếp Supabase REST lên public.items.

**Bằng chứng:** Policy items_owner_write áp dụng FOR ALL, cả USING và WITH CHECK đều cho phép catalog.manage hoặc inventory.adjust. Hàm user_has_shop_permission ràng buộc auth.uid, shop membership active và permission, nhưng không giới hạn loại thao tác hoặc cột được cập nhật. API Next.js xử lý tình huống này chặt hơn: create yêu cầu catalog.manage; người chỉ có inventory.adjust được đưa qua buildInventoryOnlyItemPatch. Client gọi trực tiếp PostgREST không đi qua bộ lọc payload của route. Policy DB vì vậy cho phép INSERT/DELETE và sửa cả trường giá/tên nếu role của Postgres có quyền table tương ứng.

**Tác động:** Ranh giới API catalog không được tái lập ở lớp DB. Thành viên được giao quyền chỉnh kho có thể vượt mục đích quyền đó và thay đổi cấu trúc/giá món qua API trực tiếp.

**Hướng sửa:** Tách quyền INSERT/DELETE sang catalog.manage. Với UPDATE, cần giới hạn các cột được phép cho inventory.adjust bằng thiết kế DB phù hợp (ví dụ trigger kiểm tra OLD/NEW), đồng thời giữ kiểm tra shop và permission hiện có.

**Kiểm chứng an toàn:** Trong test DB/PGlite với hai membership riêng biệt, thử insert/delete và đổi price/name bằng vai trò inventory.adjust-only; các thao tác phải bị từ chối, còn cập nhật stock/availability được phép. Xác nhận lại đường catalog.manage.

**Độ tin cậy:** Cao về policy hiện có và sự khác nhau với API. Quyền GRANT thực tế của Supabase role và schema live không được kiểm tra; điều kiện PostgREST cần quyền table ở runtime.

---

### 5. [P2] Deploy commit sau có thể bỏ qua migration còn pending của commit trước

**Vị trí**

- **.github/workflows/deploy.yml:31-67**

**Điều kiện:** Commit A thêm migration; migration job của A thất bại hoặc bị gián đoạn; commit B sau đó chỉ sửa code và không thêm migration.

**Bằng chứng:** migration-check so sánh github.event.before với github.sha để tìm migration chỉ trong commit range hiện tại. Với B, kết quả rỗng khiến has_migrations=false và migrate bị skipped. Điều kiện deploy vẫn cho phép chạy khi needs.migrate.result là skipped. Workflow không đối chiếu tập migration pending trong DB ở commit B trước khi deploy. Do đó A có thể chưa được áp dụng, trong khi B vẫn được đưa lên máy chủ.

**Tác động:** Code B phụ thuộc schema từ migration A có thể chạy trên DB chưa cập nhật.

**Hướng sửa:** Trước deploy, so sánh toàn bộ migration repository với schema_migrations trên DB hoặc chạy migrator idempotent trên mọi deploy. Nếu còn migration pending hoặc migrate không xác nhận success, chặn deploy.

**Kiểm chứng an toàn:** Workflow test với A thêm migration và migrate fail; B không thêm SQL. Xác nhận B vẫn phát hiện migration pending và không deploy trước khi migrate thành công.

**Độ tin cậy:** Cao về điều kiện workflow. Chưa cố tình làm lỗi migration trên production và không kiểm tra trạng thái schema live.

---

### 6. [P3] Manual dispatch của migration workflow có thể xanh dù không chạy migration

**Vị trí**

- **.github/workflows/supabase-migrate.yml:1-26**
- **scripts/migrate-supabase.mjs:102-123, 179-223, 225-227**

**Điều kiện:** Workflow Supabase migration được chạy thủ công bằng workflow_dispatch trong khi các credential không được cấp cho job.

**Bằng chứng:** workflow_call khai báo NEXT_PUBLIC_SUPABASE_URL và SUPABASE_ACCESS_TOKEN là required; nhưng workflow_dispatch là trigger độc lập. Job ánh xạ secrets vào env mà không tự xác nhận chúng tồn tại. Nếu thiếu cả access token và service-role key, main() rơi vào nhánh cuối, chỉ in hướng dẫn rồi kết thúc bình thường; main().catch chỉ đặt exit 1 khi có exception. Vì vậy runner có thể kết thúc exit 0 mà chưa thực hiện SQL.

**Tác động:** Người vận hành có thể hiểu nhầm rằng lần dispatch đã áp dụng migration.

**Hướng sửa:** Xác nhận credential trước bước chạy SQL và trả non-zero khi không đủ cấu hình; khai báo/kiểm tra secrets bắt buộc cả ở đường workflow_dispatch. Log rõ “không chạy migration” như trạng thái thất bại.

**Kiểm chứng an toàn:** Chạy workflow trong repo test với secrets thiếu; runner phải thất bại rõ ràng, không báo success. Với secrets hợp lệ, xác nhận checksum/migration row được cập nhật.

**Độ tin cậy:** Cao về nhánh no-op và cấu hình workflow. Không kiểm tra secret/repository setting, không dispatch workflow thật.

---

### 7. [P3] E2E có assertion không chứng minh ghi dữ liệu và webhook test gửi payload cũ

**Vị trí**

- **tests/e2e.test.mjs:404-442**
- **tests/e2e.test.mjs:338-355**
- **src/app/api/webhooks/payment/route.ts:395-417, 471-490, 528-549**

**Điều kiện:** Chạy npm run test:e2e với API theo hợp đồng hiện tại.

**Bằng chứng:**

1. Test 12 tạo Supabase client bằng publishable key, không đăng nhập client đó, cập nhật is_available rồi chỉ assert toggleErr === null. Kết quả không có lỗi không chứng minh có hàng nào được cập nhật; RLS có thể lọc target row và trả kết quả rỗng. Test cũng không đọc lại giá trị để xác nhận thay đổi/restoration.
2. Test 9 gửi webhook content/referenceCode và x-webhook-secret nhưng không có transferAmount/amount. Nó không gửi simulateWebhook=true. Route yêu cầu số tiền cho mọi request không phải dev simulator; do đó trả 400 PAYMENT_AMOUNT_REQUIRED trước khi xác nhận thanh toán, trong khi test assert status 200. Test cũng không gửi accountNumber, vốn là trường được kiểm tra sau đó.

**Tác động:** Test 12 có thể xanh dù availability không đổi; Test 9 không khớp hợp đồng API hiện tại và sẽ fail trước phần xác minh kết quả. Deploy workflow hiện chạy test:unit/review/sql/db-reset và mobile tests, không chạy test:e2e; các lỗi này có thể không được bắt bởi verify job.

**Hướng sửa:** Test RLS phải xác nhận số hàng/đọc lại; nếu mục đích là test mobile flow, gọi đúng catalog API. Cập nhật webhook fixture thành payload hợp lệ theo route hiện tại hoặc chuyển kiểm tra sandbox sang test riêng có điều kiện dev. Assert status cho mọi bước chuẩn bị gói/test data.

**Kiểm chứng an toàn:** Chạy bằng test DB hoặc mock route; không dùng production credentials. Không chạy test trong lượt review này.

**Độ tin cậy:** Cao về mismatch giữa source test và route; kết quả chạy thực tế chưa được xác nhận.

## Candidate đã đối chiếu nhưng không tính là finding mới

- **Bypass HMAC cho Super Admin ở payment webhook:** Source cho phép Super Admin đã xác thực bỏ qua bước HMAC, nhưng route cũng có action switch_plan_direct chỉ dành cho Super Admin để cấp gói thủ công. Chưa có bằng chứng rằng bypass tạo quyền vượt quá quyền quản trị đã có; không ghi đây là exploit production. Mismatch sandbox UI/API ở finding 2 vẫn là lỗi chức năng riêng.
- **Mobile giữ membership đã bị thu hồi:** Khi tải lại, dbGetAllShopsAndProfile chỉ đưa membership active vào map/shop list; App thay danh sách shops theo response mới. Nếu không tìm được shop hiện hành, nó xóa activeShopId. Không đủ bằng chứng cho kết luận rằng stale membership giữ quyền truy cập sau refresh.
- **DashboardShell polling/SSE người không có orders.view:** Effect không kiểm tra permission trước khi mở hai request, nhưng GET badge và SSE đều yêu cầu orders.view. SSE helper dừng khi nhận 401/403; Codex không xác nhận leak dữ liệu hay vòng retry liên tục. Một cặp request bị từ chối lúc mở trang không được tính là finding ở mức độ này.
- **Rủi ro lộ dữ liệu từ backup /tmp trên VPS:** Workflow có lệnh copy backup, nhưng review tĩnh không chứng minh quyền file thực tế, thành phần dữ liệu trong bản backup, hoặc người dùng khác trên host có thể đọc nó. Không nhận kết luận exposure từ bản nháp.
- **Service-role fallback trên floor-plan ở dev/test:** Không có bằng chứng đây là lỗi production; đường này chủ động yêu cầu server-side service role. Không đề xuất fallback bằng token client.

## Phạm vi và evidence

### CodeGraph

Codex chạy CodeGraph trước khi đọc source và kiểm chứng lại các domain AGY nêu:

- Floor plan: route, fetchAllWithPagination, MAX_RECORDS, ShopTableManager fetchFloorPlan.
- Billing: handleSimulateWebhookSuccess, isDevSandboxSimulator, webhook amount/account validation, direct Super Admin action.
- Mobile: loadShopsAndData, dbGetAllShopsAndProfile, active membership filtering, analytics query.
- RLS: catalog route permission filtering và migration 004 items_owner_write.
- CI/migration: deploy migration-check/migrate/deploy, reusable migration workflow, migrate-supabase runner.
- E2E: setup/access token, test 9 webhook, test 12 item availability.
- Dashboard sync: shouldDashboardShellSyncOrders, checkLiveOrders, orders badge GET, SSE permission check and unauthorized stop.

### Checks thực tế

- Đã đọc/đối chiếu CodeGraph node/explore và các cấu hình SQL/YAML không được CodeGraph index.
- Đã kiểm tra hiện trạng Git: không có thay đổi source; tài liệu baseline cũ vẫn còn nguyên. Báo cáo vòng 2 này là file mới.
- Không gọi API production, không mở browser, không đọc .env/.env.testing/secret/local DB.
- Không chạy tests, build hoặc typecheck. AGY event log có nhãn check test:passed trên một số node, nhưng Codex kiểm tra command events và không thấy lệnh test/build/typecheck; không coi nhãn đó là kết quả chạy test.
- AGY Argon gặp lỗi DNS ở lượt đầu. Conversation được tiếp tục bằng Gemini Flash để ghi bản nháp; runner vẫn kết thúc ERROR do lượt trước bị interrupt. Codex đã đối chiếu độc lập các finding trên với source, không dựa vào trạng thái runner để chấp nhận chúng.

### Chưa xác minh

- Tình trạng schema/RLS/GRANT thực tế trên Supabase production.
- Quyền truy cập và số lượng dữ liệu analytics/order trong production.
- Kịch bản 10.001 orders trên test DB, payment sandbox UI runtime, direct PostgREST calls, failure/recovery CI, workflow_dispatch thiếu secrets, và kết quả chạy E2E.
- Bàn: tạo/sửa/kích hoạt/lưu trữ/khôi phục và persistence vị trí vẫn chưa kiểm thử bằng mutation. API hiện không hỗ trợ xóa vĩnh viễn bàn; không tạo fixture live có thể để lại dữ liệu archive.

## CodeGraph queries tiêu biểu của Codex

- floor plan: route + fetchAllWithPagination + MAX_RECORDS
- billing: DashboardBillingPage + simulate handler + webhook signature/amount
- mobile: loadShopsAndData + membershipsRef + analytics_events + shops membership endpoint
- RLS: items_owner_write + inventory.adjust/catalog.manage + catalog API boundary
- CI: deploy workflow migration-check/migrate/deploy + migration runner
- tests: E2E toggleErr, switch_plan_direct, webhook payload
- DashboardShell: orders badge, events SSE, permission, BroadcastChannel
- QR Studio: ShopTableManager floor-plan request

## Vòng 3 — phát hiện mới được Codex đối chiếu độc lập

AGY dùng Gemini 4 Argon High cho lượt phân tích vòng 3; Codex truy vấn CodeGraph và kiểm tra source từng candidate. Runner hoàn tất, nhưng trạng thái runner không thay thế kiểm chứng source. Vòng này chấp nhận 7 điểm dưới đây; không chấp nhận finding upload trùng baseline, kết luận `javascript:` thực thi, hay phần web của candidate permission polling. Không dùng Claude hoặc DeepSeek.

### 8. [P3] Staff Workspace giữ phiên cục bộ sau khi server từ chối staff đã bị thu hồi

**Vị trí**

- **src/lib/server-auth.ts:576-585**
- **mobile/src/lib/staff-api.ts:115-137**
- **mobile/src/components/staff/StaffWorkspace.tsx:600-624, 657-661**

**Điều kiện:** Membership/credential staff bị vô hiệu hóa trong lúc mobile Staff Workspace đang mở hoặc một request staff tiếp theo gặp trạng thái này.

**Bằng chứng:** `requireShopPermission` trả HTTP 403 chung, không có `STAFF_SESSION_REVOKED`, khi membership không còn active. Client chỉ xóa staff session với HTTP 401 hoặc mã lỗi `STAFF_SESSION_REVOKED`. `StaffWorkspace` chỉ gọi `onSessionExpired` khi `StaffApiError.sessionCleared` là true; vì vậy 403 chung được hiển thị như lỗi tải/lỗi thao tác, còn session cục bộ và màn hình staff vẫn tồn tại.

**Tác động và giới hạn:** Server vẫn chặn các request cần quyền; Codex không thấy bypass quyền hoặc khả năng đọc mới sau khi thu hồi. Lỗi là app không tự quay về xác thực và có thể giữ dữ liệu đã tải trong màn hình cho tới khi người dùng thoát hoặc app được tải lại.

**Hướng sửa:** Trả một mã lỗi riêng cho session staff mất hiệu lực và xử lý mã đó bằng cách xóa SecureStore/session state rồi chuyển về màn hình đăng nhập; giữ 403 permission denial thông thường để không đăng xuất nhầm staff còn hợp lệ.

**Kiểm chứng an toàn:** Trong test DB/mock, mở Staff Workspace, vô hiệu hóa membership/session rồi gọi API catalog hoặc tables; xác nhận request bị từ chối và app xóa session, còn một lỗi thiếu permission không xóa session.

**Độ tin cậy:** Cao về luồng xử lý 403 và điều kiện xóa phiên trong source; chưa chạy trên thiết bị.

### 9. [P2] SePay từ chối nhầm thanh toán khi mã đơn trùng và shop khác bật SePay

**Vị trí**

- **supabase/migrations/011_sepay_order_reconciliation.sql:681-709**
- **supabase/migrations/002_mpos_orders_inventory.sql:12-21**
- **src/lib/mpos-store.ts:1910-1945**

**Điều kiện:** Có hai đơn VietQR chưa hủy ở hai shop khác nhau nhưng dùng cùng `order_code` và transfer prefix; shop của đơn thứ hai có một `shop_sepay_configs` đang bật, dù tài khoản ngân hàng của shop đó không khớp tài khoản nhận tiền thực tế. Mã trùng có thể đến từ dữ liệu cũ hoặc race giữa bước kiểm tra mã và insert.

**Bằng chứng:** SQL collision check yêu cầu cùng `order_code` và transfer prefix, nhưng phần account condition là `account-number matches OR EXISTS(enabled SePay config)`. Nhánh `EXISTS` không so sánh số tài khoản. Vì vậy một cấu hình SePay khác ngân hàng vẫn làm kết quả `EXISTS` đúng và đặt reason `AMBIGUOUS_ORDER_CODE`. Schema khởi tạo khai báo `orders.order_code NOT NULL` nhưng không có unique constraint; `dbCreateOrder` kiểm tra mã trước rồi mới tiếp tục tạo order, nên kiểm tra đó không loại race đồng thời.

**Tác động:** Một khoản tiền vào đúng tài khoản và khớp đơn có thể bị từ chối đối soát, cần xử lý thủ công. Đây là lỗi có điều kiện; Codex không khẳng định mọi đơn VietQR hoặc mọi cấu hình SePay đều bị ảnh hưởng.

**Hướng sửa:** Nhánh kiểm tra collision chỉ nên coi shop khác là mơ hồ nếu account/bank evidence thực sự trùng theo cùng quy tắc chuẩn hóa. Bổ sung cơ chế unique phù hợp hoặc sinh mã đủ không gian để race không tạo duplicate; xử lý các duplicate hiện có trước khi thêm constraint.

**Kiểm chứng an toàn:** Dùng DB test với hai shop cùng prefix và order code, một shop có enabled config ở ngân hàng khác; xác nhận khoản chuyển đúng tài khoản không bị từ chối. Thêm case account thực sự trùng để bảo đảm vẫn fail closed khi mơ hồ.

**Độ tin cậy:** Cao về điều kiện SQL. Chưa kiểm tra dữ liệu/schema production; trường hợp cần duplicate order code nên tác động không phổ quát.

### 10. [P2] Catalog API có thể ghi lại Base64 ảnh vào `items.image_url` sau migration dọn dữ liệu

**Vị trí**

- **src/app/api/catalog/route.ts:181-250**
- **src/lib/db.ts:1444-1519, 1578-1602**
- **src/lib/db.ts:1328-1339**
- **supabase/migrations/020_remove_legacy_base64_images.sql:1-10, 33-53**

**Điều kiện:** Người có quyền `catalog.manage` tạo hoặc sửa món bằng `image_url` là một data URI Base64 lớn.

**Bằng chứng:** Route kiểm tra quyền và giá nhưng chuyển `incoming` vào `dbUpsertItem`; hàm này xác thực shop/category/giá nhưng không kiểm tra định dạng hoặc độ dài `image_url`. Nhánh insert lưu nguyên `item.image_url`, còn nhánh update trải rộng `dbSafeItem` vào update patch. Migration 020 chỉ xóa Base64 tồn tại tại thời điểm migration và xác nhận cleanup một lần; không thêm constraint ngăn bản ghi mới. Các catalog reads trả lại row/item và do đó tiếp tục chuyển payload ảnh inline.

**Tác động:** Một người quản lý catalog có thể làm phình bảng và tăng kích thước dữ liệu truyền cho catalog/storefront mỗi lần đọc. Không tính `javascript:` URL là thực thi mã; finding này chỉ nói về dữ liệu ảnh inline và payload/storage bloat.

**Hướng sửa:** Chặn data URI ở write boundary cho item image; yêu cầu URL HTTP(S) công khai đã upload, giới hạn độ dài và áp dụng cùng quy tắc cho mọi đường upsert/import. Có thể thêm DB constraint nếu tương thích với dữ liệu hiện có.

**Kiểm chứng an toàn:** Unit/API test tạo và sửa item với URL HTTP(S), data URI nhỏ và payload lớn; xác nhận URL thường được giữ, data URI bị từ chối trước khi ghi và response không trả lại Base64.

**Độ tin cậy:** Cao về write path của `items.image_url`; chưa kiểm tra runtime request limit hoặc quy mô ảnh thực tế.

### 11. [P3] Bulk bật lại món hết kho dù các đường upsert khác ép món về unavailable

**Vị trí**

- **src/app/api/catalog/route.ts:873-927**
- **src/lib/db.ts:1492-1502, 1584-1587**
- **src/lib/mpos-store.ts:1154-1192, 1888-1893**
- **src/lib/mpos-store.ts:3223-3225**

**Điều kiện:** Người quản lý chọn bulk bật món có `stock_quantity = 0`.

**Bằng chứng:** Bulk route cập nhật trực tiếp `{ is_available: true }` cho mọi item ID và trả `success: true` khi số hàng khớp. Đường `dbUpsertItem` ép `is_available` về false khi stock bằng 0; thống kê cũng đánh dấu món hết hàng khi `stock_quantity === 0`. Bulk route không kiểm tra stock trước khi update.

**Tác động:** Trạng thái lưu trữ báo còn bán trong khi màn tồn kho có thể vẫn đánh dấu hết hàng và order creation tiếp tục từ chối món hết kho. Đây là trạng thái và feedback không nhất quán, không phải đường vượt kiểm tra tồn kho.

**Hướng sửa:** Khi bulk bật món, loại món có stock bằng 0 hoặc trả danh sách item không thể bật cùng kết quả một phần rõ ràng; không trả success toàn bộ cho các item có trạng thái không thể áp dụng.

**Kiểm chứng an toàn:** Trong test DB, bulk bật nhóm gồm item còn hàng, không giới hạn tồn và stock bằng 0; xác nhận kết quả từng item nhất quán với trạng thái tồn kho và kiểm tra order vẫn từ chối món hết hàng.

**Độ tin cậy:** Cao về update path và invariant trong helper; chưa thử qua giao diện/API runtime.

### 12. [P3] Mobile Orders gọi API và retry mỗi 30 giây dù membership không có `orders.view`

**Vị trí**

- **mobile/App.tsx:450, 467-485, 727-765**
- **mobile/src/hooks/useTabNavigation.ts:14-22**
- **mobile/src/hooks/useShopRealtimeOrders.ts:158-190, 195-203, 256-260**
- **src/app/api/orders/route.ts:192-194**

**Điều kiện:** Staff đăng nhập mobile có quyền vào shop nhưng không có `orders.view`.

**Bằng chứng:** App có tính `canViewOrders`, nhưng effect chỉ chuyển khỏi overview/catalog/promotions/settings; không chặn tab Orders. Orders là tab mặc định, `loadShopsAndData` gọi `fetchOrdersFromApi` vô điều kiện, và hook khởi động fetch/realtime theo `isLoggedIn` + `shopId`, không theo quyền Orders. GET `/api/orders` từ chối bằng `requireShopPermission(..., 'orders.view')`. Hook biến lỗi thành `needsSyncRef = true`; safety interval gọi lại API mỗi 30 giây khi request trước lỗi.

**Tác động và giới hạn:** Server vẫn từ chối truy cập dữ liệu; không thấy leak. Mobile có thể hiển thị lỗi Orders và tiếp tục tạo request 403 định kỳ. AGY mô tả interval là 10 giây; source hiện tại là 30 giây. Candidate web DashboardShell cùng chủ đề đã bị loại ở vòng 2, nên finding này chỉ giới hạn ở luồng mobile.

**Hướng sửa:** Nếu role không có `orders.view`, chuyển sang tab họ được phép dùng hoặc hiển thị trạng thái thiếu quyền; không mount order hook, realtime subscription hay fallback retry cho shop đó.

**Kiểm chứng an toàn:** Dùng membership test chỉ có quyền catalog/settings; xác nhận app không gọi `/api/orders`, không mở subscription orders và không lặp request 403, trong khi server vẫn bảo vệ route.

**Độ tin cậy:** Cao về luồng mobile và server guard; chưa đo request trên thiết bị.

### 13. [P3] Push “gọi nhân viên/yêu cầu thanh toán” trên mobile mở Orders nhưng không có dữ liệu để xử lý yêu cầu

**Vị trí**

- **src/app/api/orders/route.ts:203-206, 260**
- **src/lib/push-notifications.ts:971-1023, 1081-1109**
- **mobile/src/lib/push-notifications.ts:440-477**
- **mobile/src/hooks/useShopRealtimeOrders.ts:158-190, 205-223**
- **mobile/src/components/tabs/OrdersTab.tsx:30-48**

**Điều kiện:** Staff nhận và chạm push của một `table_service_request` trên mobile.

**Bằng chứng:** Backend gửi push service request với `serviceRequestId` và type `table_service_request`. API Orders có trả `serviceRequests`, nhưng mobile hook chỉ đọc `orders`, `stats`, `items`, `membership`; realtime subscription chỉ nghe bảng `orders`. Bộ tách route cho notification chỉ lấy shop/order IDs và luôn trả tab `orders`; `OrdersTab` props không có service request hoặc callback để xử lý nó. Vì vậy `serviceRequestId` bị bỏ trên đường tap và app không có record/hành động tương ứng để hoàn tất yêu cầu.

**Tác động:** Push có thể báo khách gọi nhân viên/yêu cầu thanh toán nhưng nhân viên mobile không mở được yêu cầu cụ thể từ notification. Finding chỉ nói về mobile; khả năng xử lý trên dashboard web không được đánh giá ở đây.

**Hướng sửa:** Đưa service requests vào state/subscription mobile và thêm màn hình/hành động phù hợp; truyền `serviceRequestId` qua tap route và mở đúng yêu cầu. Nếu mobile chưa hỗ trợ, không gửi deep link giả định Orders có thể xử lý nó.

**Kiểm chứng an toàn:** Test notification tap cho từng request type; xác nhận ID được giữ, yêu cầu hiện trên UI, trạng thái pending cập nhật sau thao tác và subscription nhận thay đổi.

**Độ tin cậy:** Cao về payload, route resolver và props hiện tại; chưa thực hiện push thật.

### 14. [P2] Push token không bị hủy khi owner session kết thúc ngoài nút Logout

**Vị trí**

- **mobile/App.tsx:175-189, 275-286, 803-821**
- **mobile/src/hooks/useMobilePushNotifications.ts:79-149**
- **mobile/src/lib/push-notifications.ts:307-335**
- **src/lib/push-notifications.ts:422-450, 782-806**

**Điều kiện:** Owner đã đăng ký push cho shop; Supabase auth phát sự kiện sign-out/expired ngoài đường Logout có chủ đích; thiết bị sau đó được người khác sử dụng trong khi membership của owner vẫn active.

**Bằng chứng:** Auth-state callback trong App chỉ cập nhật `session`. Khi Workspace unmount, cleanup của hook hủy timer/listener nhưng không gọi `unregisterPushOnLogout`. Luồng logout có chủ đích mới gọi unregister trước `signOut`. Bản ghi server vẫn `is_active=true`; push dispatcher lấy active token theo shop rồi chọn các token có user vẫn nằm trong danh sách recipient có quyền. Vì session expiry không tự thu hồi membership, token cũ có thể tiếp tục nhận notification cho owner đó.

**Tác động và giới hạn:** Notification có thể xuất hiện trên thiết bị đã thoát tài khoản, gây lộ nội dung preview cho người đang cầm thiết bị dùng chung. Đây không phải bypass API: thao tác trong app vẫn cần phiên hợp lệ. Không khẳng định token được gửi cho người dùng không còn quyền; dispatcher có kiểm tra user recipient.

**Hướng sửa:** Khi auth kết thúc, chạy cleanup push có kiểm soát trước khi mất credential nếu API còn xác thực được; nếu không, đánh dấu token hết hạn/deactivate phía server theo cơ chế thiết bị hoặc lần đăng nhập tiếp theo. Không chặn local sign-out nếu cleanup thất bại.

**Kiểm chứng an toàn:** Mock auth-state sign-out không qua handler Logout; xác nhận token được unregister hoặc bị deactivate và không còn nằm trong tập token được dispatch. Thử riêng trường hợp cleanup API 401 để bảo đảm local sign-out vẫn hoàn tất.

**Độ tin cậy:** Cao về khác biệt giữa đường auth-state và Logout; tác động riêng tư phụ thuộc thiết bị được chia sẻ và owner còn quyền nhận push.

## Candidate vòng 3 đã loại hoặc thu hẹp

- **R3-03, upload Base64 không xác thực:** Không tính mới. Baseline đã có P1 về nhánh presigned upload công khai không yêu cầu auth/không giới hạn kích thước. Nhánh Base64 đã kiểm tra MIME khai báo, định dạng Base64 và giới hạn payload; thiếu magic-byte check/key collision chưa chứng minh được impact độc lập trong review này.
- **R3-04, `javascript:` URL thực thi:** Không chấp nhận. Source cho thấy có write validation thiếu, nhưng không đủ evidence về sink/browser behavior để nói URL này thực thi mã. Finding 10 chỉ ghi data URI và payload/storage bloat.
- **R3-06, web DashboardShell polling/SSE:** Không tính mới. Khớp candidate vòng 2 đã loại; Codex không thấy leak dữ liệu hay retry loop. Phần mobile được giữ riêng ở finding 12 với khoảng retry đúng là 30 giây.
- **R3-07, “staff-mode login” giữ token owner:** Không chấp nhận quan hệ nhân quả đó. Login staff không chứng minh đang thay owner session trong cùng Workspace. Finding 14 chỉ giữ trường hợp owner auth-state kết thúc ngoài handler Logout.

## Phạm vi kiểm chứng vòng 3

### CodeGraph và source

- CodeGraph status cho biết index có 256 file, 4.017 node, 14.349 edge và đang up-to-date.
- Truy vấn theo nhóm staff session/permission, SePay collision/order code, catalog image write, bulk availability/inventory, mobile orders permission/realtime, service-request payload/tap route và push token lifecycle.
- Đọc node/source có liên quan; SQL migration không được index được đọc trực tiếp theo workflow của repo.

### Checks và giới hạn

- AGY hoàn tất báo cáo Round 3 tại `.agy-runs/reviews/qlaok-deep-static-review-round3-2026-10-26.md`; Codex độc lập đối chiếu các candidate được nhận và thu hẹp các claim sai/trùng.
- Không chạy test, build, lint hoặc typecheck theo phạm vi review tĩnh; không gọi API production, không đọc secret/local DB và không thay đổi source.
- Không kiểm tra schema/dữ liệu/RLS production, thiết bị mobile thật, push provider thật, payload ảnh lớn trên runtime, hay các kịch bản DB test được mô tả trong từng finding.
- File baseline `docs/CLAUDE_CODE_REVIEW_2026-10-25.md` được giữ nguyên. Thay đổi của lượt này chỉ là bổ sung tài liệu review này.

---

## Bổ sung vòng 4 — AGY rà rộng, Codex kiểm chứng độc lập

**Ngày:** 26/10/2026  
**Phương pháp:** AGY Gemini 3.8 Flash High rà tĩnh; Codex kiểm tra lại từng candidate bằng CodeGraph và source hiện tại.  
**Phạm vi:** auth/session và shop ownership, tạo shop, AI translation và plan, luồng bàn/floor plan, webhook SePay, pricing/inventory/settlement, mobile, migration/RLS, dashboard/storefront.  
**Kết quả:** AGY đưa ra 5 candidate mới. Codex giữ lại 4 finding dưới đây và loại 1 candidate cấu hình webhook không phải lỗi code. Không sửa source, không gọi production API, không đọc environment/secret/local DB và không chạy test suite.

### 15. [P2] Supabase JWT có thể không khớp profile ID của shop owner cũ

**Vị trí**

- `src/app/api/auth/route.ts:495-510, 739-923`
- `src/app/api/shops/route.ts:700-705`
- `src/lib/server-auth.ts:313-345, 694-770`
- `mobile/src/lib/supabase.ts:101-116`
- `mobile/src/components/AuthScreen.tsx:179-199`

**Điều kiện:** Một profile owner có ID dạng `owner-<uuid>` được tạo bởi nhánh dự phòng khi Supabase `signUp` không trả về user ID; shop được tạo trong phiên HMAC đó; sau này cùng email được liên kết/tạo danh tính Supabase Auth và mobile gọi API bằng Supabase JWT trực tiếp.

**Bằng chứng:** `POST /api/auth` có thể lưu profile với ID `owner-${crypto.randomUUID()}` nếu không có `signUpRes.data.user.id` (route 495-527), rồi cấp HMAC session theo `profile.id` (541-557). `POST /api/shops` gán `owner_id` bằng `auth.user.sub` (700-705), vì vậy shop đó giữ ID cũ. Đường `sync_user` tìm profile theo email và giữ `profile.id` hiện có trước khi cấp HMAC session theo ID ấy (849-923). Tuy nhiên, khi một request gửi Supabase JWT trực tiếp, `verifyRequestUser` đặt `sub = data.user.id` (328-339); `requireActiveShopOwner` chỉ so `shop.owner_id === user.sub` hoặc tìm membership theo chính `user.sub` (737-760). Mobile đăng nhập qua `supabase.auth.signInWithPassword` và `fetchApi` gắn Supabase access token vào API request (AuthScreen 179-199; `supabase.ts` 101-116).

**Tác động và giới hạn:** Nếu hai định danh thực sự khác nhau, các thao tác owner-gated như quản lý nhân viên trả 403 cho chủ shop hợp lệ. Đây là lỗi tương thích/khả dụng; đường kiểm tra hiện tại fail closed, không cho thấy bypass quyền. Codex không kiểm tra tài khoản production nên chưa biết có profile đang gặp điều kiện này hay không.

**Hướng sửa:** Chuẩn hóa subject của Supabase JWT sang profile ID đã xác minh trước khi dùng cho quyền sở hữu, hoặc ngăn tạo tài khoản HMAC-only khi Supabase signup thất bại. Khi chuyển tài khoản cũ, cập nhật shop/membership theo một mapping có kiểm soát; không suy ra danh tính chỉ từ email chưa xác minh.

**Kiểm chứng an toàn:** Unit/integration test với profile `owner-...`, shop sở hữu bởi profile đó và Supabase JWT của user cùng email nhưng ID khác. Kiểm tra owner endpoint hoạt động sau khi mapping chuẩn hóa; thêm trường hợp UUID không thuộc shop để bảo đảm vẫn bị 403.

**Độ tin cậy:** Trung bình. Luồng tạo ID khác và phép so sánh trực tiếp được xác nhận trong source; việc tồn tại danh tính Supabase được liên kết với một profile fallback là phụ thuộc dữ liệu/tình huống và chưa được kiểm tra trên production.

### 16. [P2] API AI translation bỏ qua giới hạn gói và shop, trả lời đủ 8 ngôn ngữ

**Vị trí**

- `src/app/api/ai/translate/route.ts:16-19, 26-82`
- `src/app/api/ai/_lib/guard.ts:33-35, 74-101`
- `src/lib/plan-limits.ts:15-64`
- `src/components/dashboard/TranslationEditorModal.tsx:252-300`

**Điều kiện:** Người dùng có bất kỳ session hợp lệ nào gọi trực tiếp endpoint khi provider AI được cấu hình.

**Bằng chứng:** `/api/ai/translate` gọi `requireAiCaller` rồi nhận các trường nội dung; request không yêu cầu `shopId`, membership hoặc quyền `catalog.manage`. Guard chỉ xác thực session và giới hạn best-effort 30 yêu cầu/10 phút theo user trên từng server instance; không tra plan. Prompt của route yêu cầu bản dịch đủ 8 ngôn ngữ và response được trả lại nguyên trạng. Trong khi đó `PLAN_CONFIGS` công bố Free `maxLangs: 1`, Basic `3`, Premium `8`, và mô tả bản dịch AI tương ứng (plan-limits 15-64). `TranslationEditorModal` gọi cùng endpoint và đưa toàn bộ `name_i18n`/`desc_i18n` trả về vào state (252-300).

**Tác động và giới hạn:** Tài khoản Free/Basic hoặc tài khoản chưa có shop vẫn có thể tiêu thụ quota dịch AI và lấy nội dung 8 ngôn ngữ, vượt entitlement được công bố. Khi provider được cấu hình, request có thể tạo chi phí upstream; review tĩnh không xác minh cấu hình provider hay hóa đơn thực tế. Rate limit hiện có giảm tốc độ nhưng không thay thế quyền theo gói.

**Hướng sửa:** Gửi `shopId` từ caller, yêu cầu quyền `catalog.manage`, tra plan phía server và chỉ yêu cầu/trả về số locale cho phép; giữ rate limit như lớp bảo vệ bổ sung. Nếu dịch 8 ngôn ngữ được chủ ý mở cho mọi gói thì cập nhật cấu hình/mô tả gói thay vì giữ giới hạn trái ngược trong `PLAN_CONFIGS`.

**Kiểm chứng an toàn:** Request không session vẫn bị từ chối; Free nhận tối đa 1 locale, Basic 3, Premium 8; một user không thuộc shop bị từ chối. Dùng mock AI provider để xác nhận các request bị khóa không gọi upstream.

**Độ tin cậy:** Cao về thiếu plan/shop guard và cấu hình 1/3/8 ngôn ngữ trong source; chưa kiểm tra chi phí hoặc cấu hình runtime.

### 17. [P3] Hai yêu cầu tạo shop cùng mili giây có thể đụng primary key

**Vị trí**

- `src/lib/db.ts:1160-1175`
- `src/app/api/shops/route.ts:700-710`
- `supabase/migrations/001_init_qlaok.sql:90-92`

**Điều kiện:** Hai request tạo shop cùng lúc tới đoạn sinh ID trong cùng mili giây.

**Bằng chứng:** `dbCreateShop` ghi đè ID mặc định của DB bằng `shop-${Date.now()}` (1160-1166). Schema khai báo `shops.id TEXT PRIMARY KEY` (migration 001:90-92). Nếu hai request lấy cùng timestamp, insert thứ hai đụng unique constraint. Route bắt lỗi nhưng trả HTTP 400 trực tiếp, không sinh ID mới hoặc retry (shops route 707-710).

**Tác động:** Một trong hai lần onboarding có thể thất bại khi có concurrency đủ cao. Đây không phải lỗi toàn bộ shop và người dùng có thể thử lại; tần suất thực tế chưa đo.

**Hướng sửa:** Dùng UUID/entropy ngẫu nhiên như các entity khác trong repo, hoặc retry có giới hạn khi nhận lỗi unique constraint. Không dùng timestamp đơn độc làm primary key.

**Kiểm chứng an toàn:** Cố định `Date.now()` trong kiểm thử và tạo hai shop đồng thời; xác nhận hai ID khác nhau hoặc một request retry thành công, không trả lỗi duplicate key.

**Độ tin cậy:** Cao về khả năng collision và phản hồi lỗi trong source; chưa đo được tần suất production.

### 18. [P3] Lưu trữ bàn khi còn nợ làm mất chỉ báo tiền chưa thu trên floor plan

**Vị trí**

- `src/app/api/tables/route.ts:175-250`
- `src/lib/shop-tables.ts:904-1065`
- `src/app/api/tables/floor-plan/route.ts:42-120`
- `src/lib/table-floor-plan.ts:97-199`
- `src/components/dashboard/ShopTableManager.tsx:514-583`

**Điều kiện:** Owner lưu trữ một bàn (`is_archived=true`) khi bàn vẫn có đơn chưa hủy đang phục vụ hoặc chưa thanh toán.

**Bằng chứng:** PATCH `/api/tables` chuyển `is_archived` tới `dbUpdateShopTable` mà không kiểm tra đơn chưa thanh toán; helper cập nhật trạng thái bàn nhưng không tra orders (tables route 228-250; shop-tables 904-1065). `ShopTableManager.handlePatchTableState` gọi PATCH ngay cho bàn được chọn và báo lịch sử đơn được giữ (514-583). Floor-plan route truy vấn orders của shop nhưng chỉ lấy tables có `is_archived=false` (floor-plan route 137-160); hàm tổng hợp cũng bỏ bàn archived trước khi cộng `open_order_count`/`unpaid_amount` (table-floor-plan 138-176). Vì vậy khoản nợ vẫn còn trong orders nhưng không còn được hiển thị trên bảng floor plan đó.

**Tác động và giới hạn:** Nhân viên/owner có thể bỏ sót số đơn và số tiền chưa thu khi theo dõi mặt bằng bàn. Không có bằng chứng rằng order bị xóa, bị đánh dấu paid, hoặc tổng doanh thu ở trang Orders bị thay đổi; đây là mất chỉ báo vận hành tại floor plan.

**Hướng sửa:** Từ chối archive ở server với HTTP 409 khi còn order chưa hủy/chưa thanh toán gắn với bàn; hoặc tiếp tục đưa archived table vào floor-plan response cho đến khi các order liên quan được tất toán. Giữ kiểm tra ở server, không chỉ khóa nút trong UI.

**Kiểm chứng an toàn:** Với bàn có một order unpaid, PATCH archive phải trả 409 hoặc floor plan vẫn hiển thị đúng `open_order_count`/`unpaid_amount`. Sau khi order được trả, archive thành công và bàn được ẩn theo thiết kế.

**Độ tin cậy:** Cao về việc endpoint cho phép archive và floor plan loại archived table; chưa xác minh trên runtime.

### Candidate bị loại sau kiểm chứng Codex

- **SePay root endpoint trả `MISSING_SHOP_ID` nếu không có query param:** Không tính là bug. Cấu hình được tạo bởi `buildShopSePayCallbackPath`/`buildShopSePayCallbackUrl` dùng `/api/webhooks/sepay/{shopId}` (`src/lib/sepay-reconciliation.ts:399-416`), và hướng dẫn vận hành yêu cầu sao chép đúng callback URL riêng này (`docs/SEPAY_WEBHOOK_SETUP.md`, mục cấu hình SePay). Root route không có `shopId` chỉ là request thiếu cấu hình; không phải callback URL chuẩn của tính năng.

### Phạm vi kiểm chứng vòng 4

- CodeGraph status: 256 file, 4.017 node, 14.357 edge; index up-to-date nhưng được build bởi engine cũ. AGY và Codex dùng `explore`, `node`, `callers` để lần theo auth, catalog/AI, order, shop/table, floor plan, webhook và callers liên quan.
- Codex đối chiếu 5 candidate AGY với source hiện tại: giữ 4 finding trên; loại candidate root SePay vì docs và callback builder xác nhận shop-scoped URL.
- Rà soát tĩnh, không chạy test/build/lint, không gọi production, không đọc environment hay dữ liệu khách hàng. Các điều kiện phụ thuộc dữ liệu production, concurrency và provider runtime vẫn chưa được xác minh.
- AGY ghi bản nháp chi tiết trong `.agy-runs/reviews/qlaok-full-codebase-review-round4-2026-10-26.md`; file này chỉ là artifact tạm, các finding được giữ lại ở phần trên sau khi Codex kiểm chứng.

## Bổ sung vòng 5 — rà tĩnh toàn codebase bằng AGY và Codex

**Ngày:** 26/10/2026  
**Mô hình:** AGY Gemini 4 Argon High; Codex kiểm chứng độc lập. Không gọi Claude hoặc DeepSeek.  
**Baseline:** 19 finding trong báo cáo 25/10 và 18 finding đã ghi ở vòng 2–4 trong tài liệu này. Baseline chỉ dùng để khử trùng lặp, không phải chỉ dẫn.  
**Kết quả vòng 5:** Codex nhận **6 finding mới** dưới đây. Ba sai lệch E2E bổ sung được gộp vào finding số 7 đã có; test 9 và 12 trong draft trùng finding đó nên không đếm lại.

### Độ bao phủ

AGY hoàn thành 15 truy vấn CodeGraph `explore` riêng biệt, sau đó dùng `node`, `callers` và `query` để lần theo source/caller. Codex lặp lại các truy vấn cần thiết và kiểm tra line hiện tại trước khi nhận finding.

| Pass | Miền đã rà | CodeGraph `explore` |
|---|---|---|
| 1 | Đăng ký/đăng nhập, session, khôi phục mật khẩu, đồng bộ profile | `verifyRequestUser createSessionToken verifySessionToken auth-recovery staff_login sync_user` |
| 2 | Shop ownership, tenant, membership, permission và RLS | `requireShopPermission requireActiveShopOwner requireSuperAdmin resolveShopAccessContext` |
| 3 | Storefront, QR, bàn, giỏ hàng và gửi đơn | `dbGetStorefrontBundle resolveStorefrontCanonicalRedirect resolveScopedTableQrVerification ShowToStaffModal` |
| 4 | Tính giá và quote phía server | `computeSharedOrderQuote quoteOrderPricing validateAndPriceOrderLines` |
| 5 | Tạo đơn, trừ kho, trạng thái hết hàng và RPC | `dbCreateOrder commit_order_with_inventory update_order_with_inventory bulk_update_availability` |
| 6 | Fulfillment, thanh toán, hoàn tiền, tất toán bill | `dbUpdateOrderStatus dbSettleTableBill dbRecordOrderPrint order-workflow` |
| 7 | Webhook SePay và thanh toán gói | `reconcile_sepay_order_payment_atomic verifySePayWebhookSignature selectSaasPublicBankConfig` |
| 8 | Table session, service request, archive, floor plan | `dbCreateTableServiceRequest dbUpdateServiceRequestStatus computeTableFloorPlanSummaries dbUpdateShopTable` |
| 9 | Settings, giới hạn gói, quyền sửa | `dbUpdateShop normalizeShopSupportedLangs getAllowedLocalesForPlan validateOrderWorkflowConfig` |
| 10 | Mobile staff auth, token, logout, realtime và polling | `StaffWorkspace AssistedOrderScreen staffApi useShopRealtimeOrders useMobilePushNotifications` |
| 11 | Upload, URL, HTML escaping, dữ liệu nhạy cảm | `createR2PresignedUploadUrl renderProductionLabelDocument redactSensitiveText uploadToSupabaseStorage` |
| 12 | API limits, rate limit, truy vấn và SSE | `ensureSupabaseReadyAndSeeded subscribeShopOrderEvents subscribeGuestOrderEvents checkStaffLoginRateLimit dbGetShopActiveKitchenOrders` |
| 13 | Migration, RLS, backup, deployment scripts | `migrate-supabase backup-qlaok-db check-order-realtime demo-reset-public-runner configure-backend-env` |
| 14 | Unit/E2E assertion và contract drift | `e2e.test.mjs sql-review.test.mjs order-review.test.ts staff-accounts-review.test.ts` |
| 15 | Onboarding, Excel import/export, KDS, push và Admin | `parseCatalogWorkbook buildCatalogImportPreview executeOnboardingImportStep dispatchNewGuestOrderPushNotifications` |

### Phát hiện mới được Codex xác minh

#### [R5-01] [P2] Đổi mật khẩu ở Supabase không đồng bộ với credential cục bộ; mật khẩu đã thu hồi vẫn dùng được trên Web

**Vị trí:** `src/app/api/auth/route.ts:495-538, 593-617`; `src/app/(auth)/login/page.tsx:570-596`; `src/lib/auth-recovery.ts:329-388`; `mobile/src/lib/auth-recovery.ts:390-456`; `src/app/api/admin/route.ts:563-584`; `src/lib/auth-credentials.ts:11-18, 64-85`; `mobile/src/components/AuthScreen.tsx:179-199`.

**Điều kiện:** Tài khoản owner có entry trong `.local-db/auth-credentials.json` — entry này được ghi khi đăng ký nếu filesystem cho phép. Tình huống xảy ra sau khi owner tự khôi phục mật khẩu hoặc Super Admin dùng `reset_owner_password`; tác động cụ thể tùy Web/Mobile và việc file cục bộ còn tồn tại, ghi được, và bền vững giữa các request.

**Bằng chứng và tác động:** `register` tạo tài khoản Supabase rồi đồng thời ghi hash mật khẩu vào `auth-credentials.json`. Luồng tự khôi phục trên Web/Mobile gọi `supabase.auth.updateUser({ password })`; nhánh `sync_user` sau đó chỉ tra/tạo `profiles` và cấp session, không sửa credential file. Khi đăng nhập Web, nếu `readCredentials()` tìm thấy entry thì API so hash cục bộ trước; hash sai trả 401 ngay và không gọi `signInWithPassword`. Vì vậy mật khẩu mới có thể bị từ chối trên Web trong khi mật khẩu cũ vẫn qua được kiểm tra cục bộ. Theo chiều ngược lại, `reset_owner_password` chỉ ghi hash mới vào file; Mobile đăng nhập trực tiếp bằng Supabase Auth nên vẫn dùng mật khẩu Supabase cũ.

Đây là lỗi lệch hai nguồn xác thực, khác finding baseline về việc API bỏ qua lỗi ghi file: finding này xảy ra cả khi việc ghi file thành công.

**Hướng sửa:** Chọn một nguồn chân lý cho mật khẩu. Khi Supabase Auth được cấu hình, xác thực Web qua Supabase thay vì để credential cục bộ cũ chặn password mới; thao tác Admin reset phải cập nhật Supabase Auth bằng API server-side được bảo vệ và xử lý lỗi trước khi báo thành công. Không dựa vào filesystem cục bộ như kho xác thực bền vững trên môi trường nhiều instance.

**Kiểm chứng an toàn đề xuất:** Với Supabase mock và credential file tạm, đăng ký rồi đổi password bằng từng luồng Web/Admin; xác nhận mật khẩu mới dùng được ở Web và Mobile, mật khẩu cũ bị từ chối trên cả hai. Vòng review này không chạy test hay chạm tài khoản thật.

**Độ tin cậy:** Cao về hai nhánh lưu/đọc trong source; việc file tồn tại và được chia sẻ giữa request là điều kiện triển khai, chưa kiểm tra runtime.

#### [R5-02] [P2] API upsert một món có thể bật món tồn kho 0; UI vẫn báo thành công khi server ép về unavailable

**Vị trí:** `src/app/api/catalog/route.ts:193-262`; `src/lib/db.ts:1444-1519`; `src/lib/shop-permissions.ts:217-263`; `src/app/(dashboard)/dashboard/catalog/page.tsx:219-279`; `mobile/src/components/tabs/CatalogTab.tsx:56-82`.

**Điều kiện:** Gọi `POST /api/catalog` với `action: "upsert_item"` cho item có stock bằng 0.

**Bằng chứng và tác động:** Bản sửa `dbUpsertItem` đọc tồn kho hiện tại nếu payload không gửi `stock_quantity`, rồi tính `effectiveStock`; khi tồn kho hiệu lực bằng 0, `is_available` được ép thành false. Nếu payload gửi `stock_quantity: 0` và `is_available: true`, DB lưu `false` nhưng API vẫn trả HTTP 200 cùng item đã chuẩn hóa `{ item }`. Web `sendCatalogMutation` chỉ kiểm tra `res.ok`, bỏ qua response body; `handleToggleAvailable` không rollback sau HTTP 200 và hiện toast “Đã bật còn món”. Mobile cập nhật optimistic trước khi gọi API, bỏ qua response body và chỉ reload trong nhánh lỗi; HTTP 200 không vào nhánh đó. Vì vậy state ngay sau mutation được source xác định là còn `true` ở cả hai client trong khi DB là `false`. Đây là sai lệch state/feedback tức thời đã chứng minh tĩnh; chưa khẳng định nó tồn tại vô thời hạn vì chưa kiểm tra các cập nhật nền sau đó. Luồng tạo đơn vẫn gọi `assertAggregatedStockAvailable` trước khi commit, nên finding này nói về trạng thái catalog/feedback sai; không kết luận khách mua được hàng khi tồn kho bằng 0.

Đây là nhánh **single-item upsert**, khác finding vòng 3 về bulk availability. Guard bulk hiện có đã được kiểm tra riêng ở trạng thái cuối vòng 5.

**Hướng sửa:** Tính trạng thái từ tồn kho hiện có cộng với payload trước khi ghi; từ chối `is_available: true` khi stock 0 hoặc trả kết quả một phần rõ ràng. Sau mutation, client dùng item server trả về thay vì chỉ dựa vào 2xx.

**Kiểm chứng an toàn đề xuất:** Với item test có stock 0, thử payload chỉ có `is_available: true` và payload có cả `stock_quantity: 0`; xác nhận server không lưu available=true, response báo không thành công hoặc phản ánh trạng thái cuối, UI rollback/reconcile. Chưa chạy test trong vòng review này.

**Độ tin cậy:** Cao về nhánh payload thiếu stock và cách hai client xử lý response; chưa tạo item trên runtime.

#### [R5-03] [P2] Đơn takeaway độc lập dùng chung `session_id` và một lần tất toán có thể đánh dấu paid cho nhiều khách

**Vị trí:** `src/components/storefront/ShowToStaffModal.tsx:651-706`; `src/lib/shop-tables.ts:611-716`; `src/lib/mpos-store.ts:1986-2006, 2762-2785`; `supabase/migrations/017_order_workflow_rpc.sql:157-176`; `src/app/api/orders/route.ts:308-352`; `supabase/migrations/007_shop_tables.sql:893-944`.

**Điều kiện:** Tạo một đơn guest takeaway chưa trả tiền khi trong danh sách order đang nạp của shop đã có đơn takeaway unpaid cùng `table_label` — mặc định là `Mang về` — và chưa bị hủy.

**Bằng chứng và tác động:** Storefront gửi order takeaway với `table_id: null` và nhãn `Mang về`. `dbResolveOrderTableIdentity` giữ nhãn takeaway nhưng trả `table_id: null`. Khi tạo đơn chưa trả tiền, `dbCreateOrder` tìm trong orders đã nạp đơn chưa hủy có cùng shop, cùng label tableless và reuse `session_id`; migration `commit_order_with_inventory` cũng có fallback theo `shop_id + table_id NULL + table_label` nếu nhận order chưa có session. Vì thế đơn takeaway mới có thể vào cùng session với khách trước khi đơn trước được tất toán.

Endpoint `POST /api/orders` action `settle_table_bill` nhận `session_id` hoặc table label, yêu cầu quyền `payment.collect`; RPC `settle_table_bill_atomic` cập nhật toàn bộ đơn unpaid, non-cancelled trong session thành `paid`. Một lần thu bill của một đơn takeaway do đó có thể đổi trạng thái thanh toán của đơn thuộc khách khác. Đây là vấn đề ghép session theo nhãn chung, khác finding baseline về bill đọc thiếu khi vượt giới hạn 1.000 đơn.

**Hướng sửa:** Không dùng label dùng chung để nhận diện phiên của khách takeaway. Tạo session/checkout key riêng cho từng khách/đơn takeaway; API tất toán takeaway phải nêu rõ tập order IDs hoặc session riêng, rồi khóa/đối chiếu chính tập đó trong transaction.

**Kiểm chứng an toàn đề xuất:** Trong test DB, tạo hai đơn unpaid takeaway độc lập cùng shop, sau đó tất toán một session; đơn còn lại phải giữ `payment_status: unpaid`. Không thực hiện trên production.

**Độ tin cậy:** Cao về luật tái sử dụng session và phạm vi update của RPC; chưa kiểm tra UI thu ngân hoặc dữ liệu thật.

#### [R5-04] [P2] Mobile luôn gửi `backgroundStyle: clean`, khiến Free owner không lưu được settings khi shop chưa có style này

**Vị trí:** `mobile/App.tsx:513-521, 973-1005`; `src/lib/db.ts:356-421, 642-653, 1102-1175`; `src/app/api/shops/route.ts:829-908`; `src/lib/plan-limits.ts:116-148`.

**Điều kiện:** Owner gói Free lưu settings từ mobile cho shop có `theme_config.backgroundStyle` chưa được lưu. Đây thường là shop chưa qua bước lưu giao diện; helper hydrate của shop mới chỉ bổ sung `primaryColor` và `layout`, không thêm `backgroundStyle`.

**Bằng chứng và tác động:** Mobile hydrate state bằng `tc?.backgroundStyle || 'clean'`, rồi `handleSaveSettings` luôn gửi `backgroundStyle` trong `theme_config`, kể cả khi người dùng chỉ đổi tên, địa chỉ, số điện thoại hoặc Wi-Fi. API PATCH so sánh custom theme keys với `existingShop.theme_config`; do giá trị lưu trước là undefined và incoming là `clean`, `customThemeChanged` thành true. Với plan Free, `getShopSettingsPlanRestriction` trả `PLAN_FEATURE_LOCKED`; API dừng trước khi lưu toàn bộ settings. Thao tác giao diện tổng quát bị khóa bởi một giá trị mặc định do client tự thêm.

**Hướng sửa:** Không gửi `backgroundStyle`/các custom theme key khi người dùng không sửa giao diện hoặc không có quyền/gói tương ứng; hoặc chuẩn hóa default ở server và trong dữ liệu trước phép so sánh plan.

**Kiểm chứng an toàn đề xuất:** Dùng shop test Free không có `backgroundStyle`; PATCH chỉ thay `name`/`wifi_info` từ mobile phải thành công và không tự ghi custom theme. Khi người dùng chủ động đổi giao diện Free, server vẫn phải chặn.

**Độ tin cậy:** Cao về giá trị state, payload và plan guard; chưa thử trên DB thật.

#### [R5-05] [P2] Form Settings gửi payment config cùng profile fields, nên permission `settings.manage` và `settings.bank` bị buộc vào cùng một lần lưu

**Vị trí:** `src/app/(dashboard)/dashboard/settings/page.tsx:568-650`; `src/app/api/shops/route.ts:736-795`; `src/lib/server-auth.ts:507-607`; `src/lib/shop-permissions.ts:319-332`.

**Điều kiện:** Member có `settings.manage` nhưng không có `settings.bank` lưu thông tin cửa hàng trong trường hợp payment config được form chuẩn hóa khác giá trị đang lưu — ví dụ shop chưa có `paymentConfig`, hoặc tên tài khoản được suy ra theo tên shop vừa đổi.

**Bằng chứng và tác động:** `performSaveSettings` luôn xây `cleanedPaymentConfig`, đính kèm nó trong `theme_config`, đồng thời gửi các trường cấp cao nhất như name, address, phone, Wi-Fi, giờ mở cửa và các locale. API thêm `settings.bank` nếu `paymentConfig` khác `prevTheme`; chỉ cần có bất kỳ khóa patch ngoài `theme_config`, API cũng thêm `settings.manage`. `requireShopPermission` nhận mảng quyền và `hasShopPermission` yêu cầu **mọi** quyền trong mảng. Do đó một member được phép quản lý thông tin shop có thể nhận 403 khi lưu chỉ vì payload có payment config mà member không được phép sửa.

**Hướng sửa:** UI chỉ gửi payment config khi actor có `settings.bank` và có thay đổi trường đó; API đánh giá quyền theo các giá trị thực sự đổi, không suy quyền từ sự hiện diện của key unchanged. Tách PATCH theo nhóm quyền sẽ tránh việc một field không liên quan chặn cả form.

**Kiểm chứng an toàn đề xuất:** Với membership chỉ có `settings.manage`, save tên/Wi-Fi khi payment config chưa có phải không sửa bank data và không bị 403. Với cấu hình bank thực sự đổi, membership thiếu `settings.bank` vẫn phải bị từ chối.

**Độ tin cậy:** Cao về payload luôn gửi và cách server ghép mảng quyền; chưa chạy request với hai cấu hình membership.

#### [R5-06] [P3] Migration script replay mọi SQL ở nhánh `SUPABASE_SERVICE_ROLE_KEY` và ghi đè `applied_at`

**Vị trí:** `scripts/migrate-supabase.mjs:123-179, 181-208`.

**Điều kiện:** Chạy script với `SUPABASE_SERVICE_ROLE_KEY` và `SUPABASE_URL` nhưng không có cặp hợp lệ `SUPABASE_ACCESS_TOKEN` + project ref để vào nhánh Management API.

**Bằng chứng và tác động:** Nhánh Management API đọc `public.schema_migrations`, so checksum và skip filename đã áp dụng. Nhánh service-role tạo bảng migration rồi lặp qua toàn bộ file `.sql` mà không đọc danh sách/checksum; sau mỗi lần thực thi nó `ON CONFLICT` cập nhật `applied_at = NOW()`. Chạy lại script qua nhánh này vì vậy replay mọi migration và làm mất mốc thời gian áp dụng ban đầu; nếu một migration không idempotent, lần chạy sau còn có thể dừng giữa chừng.

Lỗi Management API không tự rơi xuống nhánh service-role: exception đi tới `main().catch`. Trigger chỉ là nhánh Management API không được chọn và service-role branch được dùng. Review không khẳng định các migration hiện có đều thất bại khi replay.

**Hướng sửa:** Dùng chung logic đọc `schema_migrations`, đối chiếu checksum, báo lỗi khi checksum lịch sử đổi và chỉ chạy file chưa áp dụng ở cả hai nhánh. Không cập nhật `applied_at` cho migration đã được ghi nhận.

**Kiểm chứng an toàn đề xuất:** Mock PostgREST/RPC cho một migration đã áp dụng và một migration mới; xác nhận nhánh service-role skip migration cũ, chỉ gửi migration mới và giữ nguyên `applied_at`. Không gọi DB thật.

**Độ tin cậy:** Cao về nhánh điều khiển và SQL upsert; mức độ hỏng phụ thuộc việc chạy nhánh này và nội dung/idempotency của migration.

### Bổ sung vào finding số 7 — E2E có plan setup bị từ chối và test QR thiếu định danh

AGY draft gộp Tests 5, 6, 9, 12, 13. Codex xác nhận Tests 9 và 12 đã có trong finding số 7; bổ sung hai mismatch mới dưới đây. Candidate Test 13 cũng được giữ lại sau khi kiểm tra API guard hiện tại.

1. `tests/e2e.test.mjs:9-20` lấy token qua `action: "demo_login"`; `src/app/api/auth/route.ts:439-468` trả session role owner. Nhưng Tests 5 và 6 gọi `switch_plan_direct` mà bỏ qua response (`tests/e2e.test.mjs:133-136, 224-252`), trong khi `src/app/api/webhooks/payment/route.ts:377-391` chỉ cho Super Admin và trả 403 cho owner. Các test này không thiết lập trạng thái plan mà phần assertion sau giả định; kết quả phụ thuộc plan có sẵn của fixture.
2. Test 13 gửi `source: "qr_table"`, label `Bàn E2E-09`, nhưng không có `table_id` hay chữ ký (`tests/e2e.test.mjs:455-477`). Với guest không có quyền `orders.create`, route đặt `requireTableQrSig = true` khi request không phải anonymous takeaway (`src/app/api/orders/route.ts:575-594`); `dbResolveOrderTableIdentity` từ chối thiếu table ID/signature (`src/lib/shop-tables.ts:625-634`). Test này không dựng bàn/QR hợp lệ nên không chứng minh luồng đặt bàn có xác thực.

**Hướng khắc phục cho phần bổ sung:** Test setup phải dùng tài khoản Super Admin hợp lệ hoặc fixture/mock server-side plan helper và assert response trước khi tiếp tục. Test 13 cần lấy bàn hợp lệ cùng QR signature từ fixture API rồi dọn đơn; không gọi production. Chưa chạy `test:e2e` trong review này.

### Trạng thái finding cũ được kiểm tra lại ở HEAD hiện tại

- Finding bulk zero-stock ở vòng 3, mục 11, không còn đúng với source hiện tại: `src/app/api/catalog/route.ts:885-901` kiểm tra stock bằng 0 và trả 409 `ZERO_STOCK_CANNOT_MARK_AVAILABLE` trước khi update. Lượt QA sau deploy trước đó đã xác nhận thao tác **Bật còn hàng** từ Catalog nhận 409 và fixture được xóa; evidence nằm trong `.agy-runs/qa-catalog/postdeploy-zero-stock-availability-final-result.json`. Nên đọc mục 11 là lịch sử finding đã được sửa/xác minh; R5-02 ở trên là lỗi khác tại đường upsert từng món.
- **R5-02 được sửa một phần sau vòng review:** commit `9f160e9` cập nhật `dbUpsertItem` để đọc `stock_quantity` hiện tại và ép `is_available=false` khi tồn kho hiệu lực bằng 0, kể cả payload `upsert_item` bỏ qua `stock_quantity`. Unit suite và Actions trên đúng commit pass; QA production độc lập của AGY và Codex tạo item zero-stock, gửi `is_available=true` không kèm tồn kho, đọc lại xác nhận vẫn unavailable, rồi xóa fixture. Evidence: `.agy-runs/handoffs/catalog-zero-stock-upsert-postdeploy-2026-10-26.md` và `.agy-runs/handoffs/catalog-zero-stock-upsert-postdeploy-codex-verification-2026-10-26.md`.
- **Phần UI còn mở trong R5-02 — xác nhận tĩnh, chưa runtime:** CodeGraph recheck của AGY Gemini 3.8 Flash High và Codex xác nhận API trả HTTP 200 với item `is_available: false`, còn Web/Mobile bỏ response và giữ optimistic `true` trong state ngay sau thao tác; Web còn hiện toast thành công. Chưa thao tác trên trình duyệt hoặc thiết bị thật, và chưa kiểm tra liệu một luồng refresh nền có cập nhật state sau đó. Đây vẫn là lỗi client cần sửa; không đánh dấu toàn bộ R5-02 là đã khắc phục.
- Finding baseline về bill GET bị giới hạn 1.000 đơn là một nhánh khác với R5-03: baseline nói GET có thể tính thiếu khi cùng một session rất lớn; R5-03 nói các khách takeaway độc lập bị gom vào cùng session từ lúc tạo order.

### Kiểm chứng và giới hạn vòng 5

- **CodeGraph:** AGY chạy `codegraph status`, 15 truy vấn `explore` ở ma trận trên, cùng `node`/`callers`/`query`. Codex kiểm tra thêm source hiện tại cho auth/password, catalog upsert, tableless takeaway/session/settlement RPC, mobile settings/plan gating, Settings permission checks, migration script và E2E setup/QR guard. Index báo 256 file, 4.017 nodes, 14.357 edges, up-to-date; engine index cũ hơn bản cài hiện tại.
- **AGY:** Gemini 4 Argon High; runner kết thúc `SUCCESS`, 0 application-source files changed. Bản nháp candidate: `.agy-runs/reviews/qlaok-full-codebase-review-round5-2026-10-26.md`.
- **Codex nhận:** 6 finding mới. Codex hạ R5-01 từ P1 trong draft AGY xuống P2 vì tác động phụ thuộc file credential còn tồn tại/bền vững; sửa điều kiện trigger của R5-06; loại đếm trùng cho Tests 9/12 và chỉ gộp phần Test 5/6/13 vào finding 7 đã có.
- **Không chạy:** unit/E2E tests, build, lint, typecheck; không gọi API/DB/provider production, không đọc `.env*`, secrets hay dữ liệu `.local-db`. Các điều kiện về credential file, membership thực tế, plan/account dữ liệu và provider vẫn chưa được xác minh runtime.
- **Thay đổi trong lượt này:** Chỉ cập nhật tài liệu review này; không sửa source, migrations, workflows hay test files.

## 5. Review tĩnh vòng 6 — AGY Gemini 4 Argon High + Codex

**Ngày:** 26/10/2026  
**HEAD được rà:** 0c47e1dd587c4dc6f7ebecfb8664e2969d1c2925  
**Phạm vi:** AGY chạy 20 lượt CodeGraph explore; Codex tự kiểm tra lại từng candidate được nhận, các caller, nhánh xử lý liên quan và counterexample của draft. CodeGraph báo index up-to-date với 256 file. Bản draft và ma trận 20 pass: .agy-runs/reviews/qlaok-full-codebase-review-round6-2026-10-26.md. Bản đối chiếu độc lập: .agy-runs/reviews/qlaok-full-codebase-review-round6-codex-verification-2026-10-26.md.

**Độ phủ:** auth và vòng đời owner; phân quyền tenant; tạo/xóa shop; storefront; QR/table và sửa đơn khách; server/client pricing; catalog và inventory; order, thanh toán, hủy và refund; SePay/subscription webhook; table/session/service request; settings và plan; Super Admin; mobile owner/staff; realtime và push; upload/import/export/report; giới hạn API và DB; RLS/RPC và migrations; CI/deploy/backup; unit/E2E contracts và các file còn lại trong index. Đây là rà tĩnh theo luồng và cấu trúc, không phải xác nhận mọi nhánh bằng runtime.

**Kết quả:** 6 finding mới được Codex chấp nhận sau khi thu hẹp phạm vi. Vòng này không dùng Claude hoặc DeepSeek. Không sửa source, migration, workflow hay test. Không gọi API/DB/provider production, không đọc secrets, .env hoặc dữ liệu .local-db.

### R6-01 — [P1] Xóa owner chỉ xóa profile, cho phép tài khoản Auth đăng nhập lại và giữ membership ở shop khác

**Vị trí**

- src/app/api/admin/route.ts:586-626
- src/app/api/auth/route.ts:612-655, 739-784, 849-875
- src/lib/shop-permissions.ts:565-590
- supabase/migrations/004_memberships_billing_payments_audit.sql:16-36

**Điều kiện:** Super Admin xóa owner có Supabase Auth account và account đó còn membership active tại ít nhất một shop khác.

**Bằng chứng:** Nhánh delete_owner xóa các shop do owner sở hữu, payment_transactions và public.profiles; không xóa Supabase Auth user hoặc membership ở shop khác. Cột shop_memberships.user_id là TEXT, migration bỏ foreign key của cột này, nên xóa profile không cascade membership. Đường login bằng Supabase password gọi auth.signInWithPassword; khi profile không còn, route upsert lại public.profiles bằng cùng auth user ID. dbGetUserShopMemberships tiếp tục trả các membership is_active=true còn lại.

**Tác động:** Tài khoản bị Super Admin xóa có thể đăng nhập lại, dựng lại profile và tiếp tục nhận quyền ở shop khác thông qua membership còn sót. Nếu không còn membership khác, phần đã chứng minh vẫn là profile có thể được tạo lại; không khẳng định user được phục hồi quyền vào shop đã xóa.

**Hướng sửa:** Khi xóa owner, xử lý nhất quán Auth user, membership và push token theo chính sách xóa tài khoản; nếu owner còn được mời vào shop khác, yêu cầu chuyển giao hoặc thu hồi membership rõ ràng trước khi hoàn tất. Kiểm tra lỗi từng bước và dùng quy trình có thể phục hồi thay vì báo xóa thành công một phần.

**Kiểm chứng an toàn đề xuất:** Test DB/Auth giả lập một owner có một shop sở hữu và membership active ở shop B. Sau delete_owner, thử đăng nhập bằng Auth và đọc membership; kỳ vọng theo chính sách xóa được xác định, không để access cũ tồn tại ngoài ý muốn.

**Độ tin cậy:** Cao về đường xóa profile, profile recreation và membership query; chưa thử Supabase Auth hoặc dữ liệu live.

### R6-02 — [P2] Giá fixed promo theo món trên Storefront khác quote server khi mua nhiều đơn vị

**Vị trí**

- src/components/storefront/StorefrontCustomDecor.tsx:104-198, 513-555
- src/app/(storefront)/s/[slug]/menu/page.tsx:704-734
- src/components/storefront/ShowToStaffModal.tsx:579-603, 628-707
- src/lib/order-pricing.ts:150-303
- src/app/api/orders/route.ts:548-556

**Điều kiện:** PromoBanner bật, applyScope=selected_items, minOrderAmount bằng 0, discountType fixed, món được chọn có số lượng từ hai trở lên và khách tạo đơn QR.

**Bằng chứng:** getItemEffectivePrice trừ discountValue khỏi từng đơn vị; menu đưa giá đã giảm vào effectiveItems và đồng bộ vào giỏ. Ví dụ món giá 100.000đ, giảm cố định 15.000đ, số lượng 3: Storefront tính giá món là 85.000đ mỗi đơn vị. calculateOrderPromoDiscount trả discountAmount=0 cho nhánh selected_items với ngưỡng 0 vì cho rằng giảm giá đã áp vào từng món. Nhưng quote server tính promoBannerDiscountAmount ở cấp order và fixed chỉ bằng discountValue một lần. ShowToStaffModal gửi các món nhưng không gửi expected_total; route chỉ so giá nếu field đó được gửi. Server có thể lưu tổng 285.000đ trong khi khách thấy 255.000đ.

**Khử diễn giải sai trong draft:** Không chấp nhận nhận định bị giảm lần hai trong calculateOrderPromoDiscount: nhánh này trả 0. Cũng không chấp nhận nhận định server bỏ qua startDate của Flash Sale: isFlashSaleActiveNow kiểm tra ngày bắt đầu/kết thúc và khung giờ. Finding này chỉ giữ sai lệch fixed selected-item promo đã chứng minh.

**Tác động:** Khách có thể đặt và được chấp nhận với tổng server cao hơn tổng hiển thị; không có PRICE_CHANGED vì payload không gửi expected_total.

**Hướng sửa:** Thống nhất fixed promo là giảm theo đơn vị hay theo đơn, dùng cùng công thức ở client/server, và gửi expected_total để phát hiện quote thay đổi trước khi tạo đơn. Không dùng giá client làm giá authoritative.

**Kiểm chứng an toàn đề xuất:** Quote case fixed 15.000đ, selected item, quantity 3 ở client và server; xác nhận giá hiển thị, expected_total và order quote khớp. Thêm kiểm tra promo hết hạn và Flash Sale ngoài giờ.

**Độ tin cậy:** Cao về hai công thức và payload; chưa gửi đơn runtime.

### R6-03 — [P2] Mở sửa đơn POS làm rơi chiết khấu; chế độ nhập giá cao hơn catalog bị quote từ chối

**Vị trí**

- src/components/dashboard/PosCounterWorkspace.tsx:94-175, 379-428, 667-689, 715-801
- src/lib/mpos-store.ts:889-952, 1026-1048, 2444-2455, 2542-2544
- src/app/api/orders/route.ts:548-556

**Điều kiện và bằng chứng — chiết khấu:** Khi hydrate một đơn để sửa, UI đặt discountPercent=0 và loại nội dung Giảm ... khỏi custom_note; không hydrate order.discount_amount thành state giảm giá. Khi gửi, UI tính lại totals từ các dòng hiện tại và gửi discount_amount=totals.totalDiscount. Nếu cashier mở rồi lưu đơn có chiết khấu trước đó nhưng không tạo lại mức giảm trên từng dòng, payload gửi 0. dbUpdateOrderStatus nhận discount_amount được chỉ định, dựng lại quote và thay tổng chiết khấu cũ.

**Điều kiện và bằng chứng — giá nhập thủ công:** Chế độ customUnitPrice nhận mọi số không âm, kể cả cao hơn giá catalog. Payload gửi giá này và expected_total theo tổng UI. validateAndPriceOrderLines thay unit_price bằng giá catalog; route so expected_total với quote server và trả 409 PRICE_CHANGED khi hai tổng khác nhau.

**Tác động:** Lưu đơn đã sửa có thể xóa chiết khấu hiện hữu. Một giá cao hơn catalog được chấp nhận trong giao diện nhưng không thể lưu theo quote authoritative hiện tại.

**Hướng sửa:** Hydrate và giữ nguyên chiết khấu khi mở sửa, tách manual/order discount khỏi line editor và chỉ cập nhật khi cashier thay đổi. Với customUnitPrice, làm rõ hợp đồng giá; nếu server luôn dùng catalog thì giới hạn UI/hiển thị giá nhập không hợp lệ trước submit.

**Kiểm chứng an toàn đề xuất:** Tạo order fixture có line discount và order-level discount, mở/sửa/lưu không đổi món rồi so sánh tổng/metadata. Thử giá custom thấp hơn, bằng và cao hơn catalog để khớp lỗi UI với quote server.

**Độ tin cậy:** Cao về hydrate, payload, server override và expected-total check; chưa chạy POS hay DB test.

### R6-04 — [P3] Lỗi DELETE bài viết bị đổi thành HTTP 200 và UI không báo thất bại

**Vị trí**

- src/app/api/posts/route.ts:33-55
- src/lib/db.ts:1773-1779
- src/app/(dashboard)/dashboard/posts/page.tsx:485-523

**Điều kiện:** Supabase trả lỗi cho DELETE public.posts.

**Bằng chứng:** dbDeletePost trả false khi Supabase trả error thay vì ném lỗi. API luôn trả JSON {deleted} với HTTP 200. Dashboard chỉ kiểm tra res.ok; vì vậy deleted=false vẫn đi vào loadPosts như một thao tác thành công, không đặt postsError.

**Tác động:** Bài không bị xóa nhưng giao diện không cho biết thao tác thất bại. Điều này trái với invariant trong AGENTS.md: không báo ghi thành công sau lỗi DB.

**Hướng sửa:** Ném lỗi hoặc trả non-2xx khi DB delete lỗi; client xác nhận deleted=true trước khi reload/trả trạng thái hoàn tất.

**Kiểm chứng an toàn đề xuất:** Mock lỗi DELETE và xác nhận API trả non-2xx cùng thông báo; kiểm tra UI giữ bài và hiển thị lỗi.

**Độ tin cậy:** Cao về nhánh lỗi; chưa mô phỏng DB failure runtime.

### R6-06 — [P3] Khách sửa đơn vẫn thấy toggle phương thức thanh toán nhưng lựa chọn không được gửi

**Vị trí**

- src/components/storefront/ShowToStaffModal.tsx:401-417, 670-713, 1355-1387
- src/app/api/orders/route.ts:680-718, 806-817

**Điều kiện:** Khách mở lại đơn chưa được quán tiếp nhận, đổi Cash/VietQR rồi gửi yêu cầu sửa.

**Bằng chứng:** Modal khôi phục paymentMethod từ editingOrder và vẫn render hai nút toggle. Tuy nhiên requestBody trong nhánh isEditingExisting chỉ gửi order_id, tracking_token, table, customer_note và items; không có payment_method. Nhánh customer preacceptance của PATCH gọi cập nhật đơn mà không chuyển payment_method vào dbUpdateOrderStatus.

**Tác động:** Toggle đổi trạng thái hiển thị nhưng phương thức thanh toán của đơn không đổi; khách có thể nghĩ đơn đã chuyển từ tiền mặt sang VietQR hoặc ngược lại.

**Hướng sửa:** Ẩn/khóa toggle trong chế độ sửa nếu khách không được đổi phương thức; hoặc hỗ trợ trường này qua nhánh PATCH đúng quyền và phản hồi phương thức cuối cùng từ server. Không chỉ thêm field ở client nếu server không cho phép.

**Kiểm chứng an toàn đề xuất:** Với order guest chưa được nhận, đổi lần lượt cash/vietqr và kiểm tra payload, PATCH response và giá trị đọc lại. Nếu nghiệp vụ khóa payment method, xác nhận nút bị vô hiệu hóa.

**Độ tin cậy:** Cao về UI và request contract; chưa chạy trình duyệt/API.

### R6-07 — [P2] Super Admin đổi trạng thái order không ghi transition/reason vào order audit

**Vị trí**

- src/app/api/admin/route.ts:399-419, 737-753
- src/lib/server-auth.ts:782-844, 816-844
- src/lib/mpos-store.ts:2521-2551, 2552-2590
- src/app/api/orders/route.ts:600-675

**Điều kiện:** Super Admin dùng action update_order_status, đặc biệt khi hủy đơn đã thanh toán.

**Bằng chứng:** POST admin ghi một admin audit tổng quát gồm actor, action và targetId, nhưng details không chứa status/payment_status trước-sau. Nhánh update_order_status chỉ chuyển status, payment_method và payment_status vào dbUpdateOrderStatus; không nhận reason hoặc actor fields. Helper tự chuyển đơn đã paid sang refunded khi hủy và hỗ trợ cancelled_reason/refund_reason/paid_by/refunded_by, nhưng nhánh admin không cung cấp các trường này. recordOrderAuditLog cho order-level before/after được gọi từ POST/PATCH /api/orders, không được gọi từ nhánh admin.

**Giới hạn diễn giải:** Draft AGY nói nhánh này bỏ qua mọi audit. Điều đó không chính xác vì recordAdminAuditLog vẫn ghi actor/action/target; finding chỉ là thiếu bản ghi chi tiết cho chuyển trạng thái order và lý do, trong đó có chuyển hủy-paid sang refund.

**Tác động:** Có thể truy được ai gọi action nào cho order nào, nhưng log admin không cho biết chuyển trạng thái/thanh toán nào đã xảy ra hoặc lý do hủy/hoàn tiền; hồ sơ order không có actor/reason tương ứng từ nhánh này.

**Hướng sửa:** Ghi order audit với before/after và actor khi admin đổi trạng thái; yêu cầu cancellation/refund reason ở đúng các transition cần lý do. Chỉ ghi audit thành công sau khi DB update thành công hoặc lưu kết quả thất bại riêng.

**Kiểm chứng an toàn đề xuất:** Mock Super Admin hủy order paid; so sánh admin audit, order audit, payment_status, actor và reason. Xác nhận thao tác thất bại không tạo event “đã đổi” gây hiểu sai.

**Độ tin cậy:** Cao về payload truyền vào helper và danh sách caller của order audit; chưa chạy transition runtime.

### 5.1. Claim trùng lặp, bị bác bỏ hoặc được thu hẹp so với draft AGY

| Candidate trong draft AGY | Kết luận Codex |
| :--- | :--- |
| R6-02: nói promo selected_items bị giảm hai lần | Bác phần double-discount: calculateOrderPromoDiscount trả discountAmount=0 ở nhánh minOrderAmount <= 0; chỉ nhận mismatch fixed unit-vs-order đã nêu ở finding R6-02. |
| R6-04: upsert bài viết chéo shop | Trùng finding “Owner một shop có thể ghi đè bài của shop khác bằng ID đã biết” trong baseline 25/10; không đếm lại. Lỗi DELETE trả false/200 là finding mới, được ghi riêng ở R6-04. |
| R6-05: owner inactive bị khóa nhưng vẫn được phép qua membership/RLS | Không nhận: generic owner resolution và RLS có đường bypass owner_id riêng; source chưa chứng minh đây là trái với chính sách nghiệp vụ hay mở quyền sai. |
| R6-06: discount_code không được gửi khi khách sửa đơn; hậu tố [KM ...] bị lặp | Không nhận claim mất discount_code vì server giữ quote/code theo order hiện hữu; hậu tố ghi chú có thể lặp nhưng tác động nhỏ và cần xác nhận contract note trước khi tính là finding độc lập. Giữ finding payment_method toggle vì state hiển thị nhưng bị loại khỏi request. |
| R6-08: thiếu migration credential/skip migration pending | Trùng: workflow_dispatch không có credential được ghi ở Vòng 3 Mục 6; migration pending bị bỏ qua ở commit sau được ghi ở Vòng 3 Mục 5; service-role replay migration là R5-06. Không đếm lại. |
| R6-09: RLS lọc hết category inactive/item unavailable của member | Bác nhận định về inactive/unavailable: policy hiện tại không lọc is_active/is_available; SELECT cho phép shop published hoặc permission orders.view/catalog.view. Biến thể custom role chỉ có catalog.manage/inventory.adjust cần chứng minh app path hiển thị và chưa được nhận. |
| R6-07: admin order status không có bất kỳ audit nào | Thu hẹp: có admin audit tổng quát; thiếu order transition detail/reason/actor fields như mô tả tại finding R6-07. |

### 5.2. CodeGraph và kiểm tra

- **AGY:** Gemini 4 Argon High; 20 pass CodeGraph explore; run 2026-10-26T05-38-09-086Z-42d385a6 kết thúc SUCCESS. Draft tạo trong .agy-runs/reviews; không thay đổi application source. Không gọi Claude hoặc DeepSeek.
- **Codex:** Đối chiếu owner delete với Auth login/profile sync và active membership query; fixed promo client/server quote và expected_total; hydrate/submit POS và server-authoritative price; DELETE API/helper/UI; customer edit request với payment toggle; admin audit, order audit callers và cancel-to-refund path. Đọc SQL migration 004 và các workflow/doc không nằm trong CodeGraph qua file source.
- **CodeGraph:** status up-to-date; truy vấn explore/node/callers quanh auth, tenant, pricing, POS, posts, order routes, audit, deploy, RLS. Danh sách query chính xác và từng phạm vi source nằm trong Codex verification handoff.
- **Không chạy:** tests, build, typecheck, lint hoặc live API/DB. Không kiểm tra schema production, dữ liệu production, Supabase Auth thật hay thao tác thanh toán. Kịch bản kiểm chứng ở từng finding là đề xuất, chưa được chạy.
- **Thay đổi trong vòng 6:** chỉ tài liệu review này và các file làm việc bị ignore trong .agy-runs; không sửa application source, migration, workflow hoặc tests.

## Vòng 7 — AGY Gemini 3.8 Flash High và Codex xác minh độc lập

**Ngày:** 26/10/2026  
**Phạm vi:** Rà delta trên 15 miền mã được theo dõi, gồm auth/staff, phân quyền và tenant, storefront/QR, pricing/order/fulfillment, inventory, analytics/realtime/push, admin, migrations/RLS, scripts/deploy và AI/upload. Dùng CodeGraph trước khi lần theo source; các migration SQL chưa được index được đọc trực tiếp theo ngoại lệ trong `docs/CODEGRAPH_WORKFLOW.md`.  
**AGY:** run `2026-10-26T06-44-43-087Z-ca1efeb5`, conversation `7e40068b-d756-4b41-b2b5-af985e81aa65`, model `gemini-3.8-flash-high`, effort `high`, kết thúc `SUCCESS` sau 471 giây. AGY đưa ra 6 candidate; Codex đối chiếu source hiện tại, sửa mức độ/diễn giải, khử trùng lặp và bác candidate sai.  
**Kết quả:** 4 finding mới được chấp nhận dưới đây; R7-03 là một tình huống riêng bổ sung cho finding đọc/tất toán bill trong báo cáo baseline, không tính thêm vào tổng số; R7-01 và R7-06 không được tính là lỗi mới.

### R7-02 — [P2] PATCH lặp trạng thái `refunded` ghi đè người thực hiện hoàn tiền ban đầu

**Vị trí:** `src/app/api/orders/route.ts:848-865, 928-951, 977-989`; `src/lib/mpos-store.ts:872-879, 2577-2585`.

**Điều kiện:** Đơn đã có `payment_status === 'refunded'`; thành viên có quyền `payment.refund` gửi PATCH có `payment_status: 'refunded'` lần nữa.

**Bằng chứng:** `isRefunding` đúng với mọi payload `payment_status === 'refunded'`, không kiểm tra trạng thái cũ. Nhánh yêu cầu lý do hoàn tiền chỉ chạy khi đơn chưa refunded. `assertPaymentTransition` cho phép giữ trạng thái refunded; route vẫn gửi `refunded_by: auth.user.sub`. `dbUpdateOrderStatus` ghi `patch.refunded_by || existing.refunded_by`, nên lần PATCH lặp thay actor ban đầu bằng người gửi lần sau.

**Tác động:** Trường `orders.refunded_by` mất giá trị của người thực sự thực hiện lần hoàn tiền đầu tiên. Đây là sai lệch audit tài chính; không phải claim rằng một PATCH chỉ sửa ghi chú sẽ luôn gây lỗi — payload phải gửi lại `payment_status: 'refunded'`.

**Hướng sửa:** Chỉ gửi `refunded_by` khi `payment_status` chuyển từ trạng thái khác sang `refunded`; xử lý cùng trạng thái như lệnh idempotent và giữ actor cũ.

**Độ tin cậy:** Cao về nhánh route và phép merge; chưa chạy PATCH qua DB/runtime. Khác R6-07: finding này làm sai field actor trong bản ghi order, còn R6-07 nói về thiếu order-transition detail trong audit của Super Admin.

### R7-03 — Bổ sung cho finding baseline về GET bill/tất toán: phiên có cả đơn đã trả và chưa trả trả tổng gộp dưới trạng thái `unpaid`

**Không tính là finding mới riêng:** Đây là một tình huống thứ hai của cùng hợp đồng GET table bill trong finding `[P2] API đọc hóa đơn bàn có thể tính thiếu trong khi API tất toán thu hết các đơn của phiên` ở báo cáo baseline. Giữ số đếm không trùng.

**Vị trí:** `src/lib/mpos-store.ts:2682-2695, 2708-2713, 2730-2757`; `src/app/api/orders/route.ts:108-128`; `src/types/qlaok.ts:464-482`; `supabase/migrations/007_shop_tables.sql` trong hàm `settle_table_bill_atomic`.

**Bằng chứng:** Khi GET `action=table_bill` có `sessionId`, nhánh lọc trả về mọi order cùng `session_id` trừ order đã cancelled; nhánh này không lọc `payment_status`. `total_amount` cộng tất cả các order đó. Summary chỉ báo `paid` khi mọi order đều paid, nên phiên có một order paid và một order unpaid sẽ trả gross total của cả hai nhưng `payment_status: 'unpaid'`. `TableBillSummary` không có trường `unpaid_amount`. Ngược lại, RPC tất toán chỉ khóa/cập nhật order `payment_status = 'unpaid'` và response của nó chỉ tổng hợp các order vừa được settle.

**Tác động và giới hạn:** GET response có thể không biểu diễn số dư cần thu nếu consumer hiểu `total_amount` là amount due. CodeGraph không tìm thấy UI nội bộ gọi trực tiếp action này; vì vậy xác nhận hiện tại là sai lệch API contract và rủi ro có điều kiện với client tiêu thụ API. Không khẳng định đã có double-charge thực tế.

**Hướng sửa:** Tách `gross_total` khỏi `unpaid_amount`/`paid_amount`; hoặc chỉ tổng hợp order chưa trả cho amount due. Giữ hành vi settlement authoritative ở server và thêm kiểm tra phiên bản/tổng nếu caller cần xác nhận số tiền trước khi thu.

### R7-04a — [P2] Super Admin chỉ đọc 1.000 order mới nhất trên toàn platform

**Vị trí:** `src/lib/mpos-store.ts:1202-1218, 1336-1338, 3258`; `src/app/api/admin/route.ts:76-101, 185-225, 338-358`.

**Điều kiện:** Supabase đang dùng và toàn platform có hơn 1.000 order.

**Bằng chứng:** `loadMergedOrders()` không có `shopId` khi được gọi bởi `dbGetAllOrders()`. Trong DB mode, query sắp theo `created_at DESC`, giới hạn bằng `STATS_ORDER_PAGE_SIZE = 1000`, rồi chỉ trả các hàng đó; không có vòng phân trang. GET `/api/admin` dùng chính mảng này để tạo `orders`, `totalOrders`, số lượng theo trạng thái, `ordersCount` và `shopGmv` theo shop.

**Tác động:** Order cũ hơn 1.000 order mới nhất biến mất khỏi response quản trị và KPI. Shop chỉ có lịch sử cũ có thể hiện `ordersCount = 0` và `shopGmv = 0`, dù DB vẫn có order.

**Hướng sửa:** Dùng query tổng hợp theo shop/trạng thái ở DB hoặc phân trang đầy đủ theo cursor; không dùng giới hạn dành cho stats trên đường `dbGetAllOrders`.

**Độ tin cậy:** Cao về giới hạn và caller; chưa kiểm thử với database có trên 1.000 order.

### R7-04b — [P2] Cột “Doanh thu” Super Admin cộng order chưa trả và đã hoàn tiền

**Vị trí:** `src/app/api/admin/route.ts:190-196`; `src/app/(admin)/admin/page.tsx:827-839`; đối chiếu `src/lib/mpos-store.ts:2968-3002`.

**Điều kiện:** Shop có order không cancelled với `payment_status` là `unpaid` hoặc `refunded`.

**Bằng chứng:** API tạo `shopOrders` bằng điều kiện `shop_id` khớp và `status !== 'cancelled'`, rồi cộng `total_amount` của tất cả kết quả vào `shopGmv`; không xét `payment_status`. UI gắn `shopGmv` vào cột “Doanh thu”. Trong khi đó, phép tính doanh thu đã thu của shop lọc `payment_status === 'paid'` và tính riêng `todayUnpaidAmount`, `todayRefundedAmount`, `totalRefundedAmount`.

**Tác động:** Con số hiển thị là doanh thu có thể bao gồm tiền chưa thu hoặc đã hoàn, làm sai so sánh tình hình shop và tổng hợp admin. Đây là lỗi riêng với giới hạn 1.000 order ở R7-04a; hai điểm có thể cùng ảnh hưởng một con số.

**Hướng sửa:** Nếu cột là doanh thu đã thu, chỉ cộng order paid và xác định riêng cách trừ refund; nếu muốn hiển thị gross order value, đổi nhãn và cung cấp unpaid/refunded tách biệt.

**Độ tin cậy:** Cao về điều kiện lọc và nhãn UI; chưa so sánh với dữ liệu production.

### R7-05 — [P3] PATCH không thể xóa cấu hình promo lồng bằng `null`

**Vị trí:** `src/app/api/shops/route.ts:991-1017`.

**Điều kiện:** API caller muốn xóa hẳn `promoBanner`, `welcomePopup` hoặc `flashSale` bằng cách gửi giá trị `null` trong `theme_config`.

**Bằng chứng:** Ba nhánh dùng kiểm tra truthy (`incomingTheme.<key> ? merge : prevTheme.<key>`); khi caller gửi `null`, API lấy giá trị cũ thay vì xóa. Cùng object đó, `paymentQr` phân biệt `undefined` với giá trị `null` và cho phép clear. Dashboard Promotions hiện lưu object cấu hình đầy đủ và có thể tắt banner bằng `enabled: false`; chưa tìm thấy nút UI nào gửi `null` để xóa.

**Tác động và giới hạn:** Caller theo hợp đồng PATCH muốn reset nested config sẽ nhận HTTP thành công nhưng cấu hình cũ vẫn được giữ. Chưa xác nhận lỗi có thể được kích hoạt qua UI hiện tại; đây là giới hạn API cho thao tác clear rõ ràng, mức P3.

**Hướng sửa:** Phân biệt key bị bỏ qua với key có mặt và `null` bằng `hasOwnProperty`/kiểu patch tường minh; thêm kiểm tra API cho partial update và explicit clear.

**Độ tin cậy:** Cao về phép merge; caller hiện tại gửi `null` chưa được tìm thấy.

### Candidate vòng 7 không được tính

| Candidate AGY | Kết luận Codex |
| :--- | :--- |
| R7-01: staff PATCH table service request vướng FK `public.profiles` | Bác: dù migration 009 ban đầu khai báo hai FK, `supabase/migrations/018_shop_staff_accounts.sql:69-73` (kiểm tra hiện tại) có `DROP CONSTRAINT IF EXISTS table_service_requests_acknowledged_by_fkey` và `...resolved_by_fkey` để cho phép staff ID. Draft AGY đọc migration 018 nhưng bỏ sót đoạn sửa này; không còn căn cứ cho claim lỗi 23503 theo schema migration hiện tại. Chưa kiểm tra schema production. |
| R7-06: nhánh staff trong `sync_user` tại auth route không thể tới | Đúng là block staff lặp sau pre-verification early-return, nhưng chỉ là dead duplicate code, không tạo failure hiện tại có thể quan sát được. Không nhận là finding sản phẩm; có thể dọn trong một thay đổi refactor riêng nếu được yêu cầu. |

### CodeGraph, checks và giới hạn vòng 7

- **CodeGraph trước review:** `codegraph status` báo index synchronized; AGY chạy các truy vấn explore/node/callers liệt kê trong `.agy-runs/handoffs/qlaok-static-review-round7-deep-delta-2026-10-26-coverage.json`. Codex đối chiếu lại `dbUpdateServiceRequestStatus`, `PATCH /api/orders`, `dbUpdateOrderStatus`, `dbGetTableBill`, `dbSettleTableBill`, `loadMergedOrders`, `dbGetAllOrders`, `/api/admin`, `computeShopRevenueAndInventoryStats`, `/api/shops` và các caller UI liên quan.
- **SQL chưa được index:** Đọc migration 009, 007 và 018 trực tiếp sau khi truy vấn CodeGraph khu vực liên quan; migration 018 đã bác candidate R7-01.
- **Một truy vấn CodeGraph node của AGY lỗi:** các candidate được giữ đều được Codex đọc lại bằng node/explore thành công; claim FK được kiểm tra trực tiếp trong migration mới hơn. Lỗi truy vấn đó không được dùng làm bằng chứng.
- **Không chạy:** tests, build, typecheck, lint, Supabase production inspection, API production hoặc payment flow. Các finding là static source review; quy mô dữ liệu/ảnh hưởng runtime chưa được đo.
- **Thay đổi vòng 7:** chỉ báo cáo này được cập nhật. Application source, migration, workflow và tests không bị sửa.

## Vòng 8 — AGY Gemini 4 Argon High và Codex xác minh độc lập

**Ngày:** 26/10/2026  
**Phạm vi:** Rà sâu UI web, storefront, mobile và helper/API liên quan. AGY báo đã xem 119 trong 256 file được CodeGraph index (46,5% file index); 137 file còn lại không thuộc lượt này. Đây là số file, không phải tỷ lệ feature.  
**AGY:** run ban đầu `2026-10-26T07-15-01-587Z-0c7a330d` bị ngắt sau khi ngừng phát tiến độ; tiếp tục cùng conversation `d41e49fd-727a-444a-bd19-c0640825f1ab` bằng run `2026-10-26T07-47-09-384Z-0dfbf22f`, model Gemini 4 Argon High, kết thúc `SUCCESS`. Chỉ dùng AGY và Codex; không gọi Claude hoặc DeepSeek.  
**Kết quả:** 9 finding mới dưới đây sau khi Codex đọc lại source qua CodeGraph và khử trùng lặp. Draft đầy đủ của AGY nằm tại `.agy-runs/reviews/qlaok-ui-coverage-round8-2026-10-26.md`.

### R8-01 — [P2] POS không sửa được đơn chưa thu tiền có khuyến mãi/voucher

**Vị trí:** `src/components/dashboard/PosCounterWorkspace.tsx:767-803`; `src/app/api/orders/route.ts:894-906, 977-999`; `src/lib/mpos-store.ts:2444-2456, 2542-2544`.

**Điều kiện và bằng chứng:** Đơn QR chưa thanh toán đã lưu `promo_discount_amount` hoặc `discount_code`. POS gửi `expected_total` kèm `apply_shop_promotions: false`. Route kiểm tra tổng không khuyến mãi rồi gọi `dbUpdateOrderStatus` nhưng không chuyển tiếp cờ này. Ở store, cờ bị thiếu khiến phép tính quay về mặc định áp khuyến mãi theo dữ liệu đơn cũ; tổng mới khác `expected_total` và server trả 409. Vì vậy người dùng không thể lưu thay đổi món/bàn/ghi chú qua POS trong tình huống này.

**Hướng sửa:** Dùng cùng một chính sách promotion cho pre-check và cập nhật DB; bảo toàn hoặc chủ động tính lại code/discount của đơn khi sửa.

**Độ tin cậy:** Cao về luồng source; chưa chạy API/DB runtime. Finding khác R6-03 (POS làm mất line discount/custom price).

### R8-03 — [P2] Giá Flash Sale trên storefront không kiểm tra lịch chạy

**Vị trí:** `src/components/storefront/StorefrontCustomDecor.tsx:126-153, 713-785`; `src/lib/order-pricing.ts:85-134`; `src/components/storefront/ShowToStaffModal.tsx:584-608, 689-718`.

**Điều kiện và bằng chứng:** Cửa hàng có Flash Sale bật với ngày/giờ/thứ giới hạn; khách xem ngoài khung giờ. `getItemEffectivePrice` chỉ kiểm tra `enabled`, mức giảm và item ID; banner cũng không ẩn khi hết lịch. Server `getItemFlashSalePrice` có gọi `isFlashSaleActiveNow` và sẽ tính giá gốc. Luồng tạo đơn storefront không gửi `expected_total`, nên khách có thể thấy/đặt đơn theo giá giảm nhưng đơn được tạo với giá đầy đủ.

**Hướng sửa:** Dùng chung logic xác định Flash Sale đang hoạt động giữa client/server, và gửi/kiểm tra tổng dự kiến để UI báo thay đổi giá trước khi tạo đơn.

**Độ tin cậy:** Cao về khác biệt logic; chưa đặt đơn runtime. Việc thiếu `expected_total` đã có trong baseline; phần finding mới là client bỏ qua lịch sale và lệch giá với server.

### R8-04 — [P2] Cập nhật thanh toán có thể làm tiến bước workflow ngoài ý muốn

**Vị trí:** `src/lib/order-workflow.ts:1178-1213`; `src/lib/mpos-store.ts:2295-2315`; `src/app/api/orders/route.ts:720-722, 977-999`; dashboard receipt modal `src/app/(dashboard)/dashboard/orders/page.tsx:2674-2692`; mobile `mobile/src/components/tabs/OrdersTab.tsx:445-519`.

**Điều kiện và bằng chứng:** Shop cấu hình nhiều bước workflow trong cùng một stage. Resolver, khi nhận status hiện tại cùng thay đổi khác (ví dụ chỉ thu tiền), tìm bước tiếp theo khớp stage trước khi xử lý nhánh “chỉ sửa field”; nếu có đúng một bước, nó ghi `workflow_step_id` tiếp theo. Các UI này không gửi ID bước tường minh. Ở chiều khác, thao tác đổi stage từ mobile chỉ gửi status; workflow có nhiều bước tiếp theo tương ứng có thể bị từ chối là ambiguous/invalid.

**Tác động:** Thu tiền có thể đổi bước chuẩn bị mà nhân viên không chọn; một số cấu hình workflow khiến nút Nhận đơn/Đã phục vụ lỗi.

**Hướng sửa:** Tách cập nhật thanh toán khỏi transition; mọi thao tác transition trong workflow tùy chỉnh nên chọn/gửi `workflow_step_id` cụ thể và hiển thị lỗi cấu hình rõ ràng.

**Độ tin cậy:** Cao về resolver và payload UI; chưa chạy workflow cấu hình thực tế.

### R8-05 — [P2] Lưu sửa đơn POS vẫn đòi quyền thu tiền dù không đổi trạng thái thanh toán

**Vị trí:** `src/components/dashboard/PosCounterWorkspace.tsx:767-803, 1391-1405`; `src/app/api/orders/route.ts:860-862, 887-891`.

**Điều kiện và bằng chứng:** Nhân viên có `orders.edit_items` nhưng không có `payment.collect` sửa một đơn chưa thu tiền. POS luôn gửi lại `payment_status` và `payment_method`; route thêm `payment.collect` chỉ vì các trường này xuất hiện, không so sánh giá trị mới với đơn hiện tại. Nút lưu đơn chưa thu vẫn hiện và gọi cùng handler, nên request bị 403 dù nhân viên không thực hiện thu tiền.

**Hướng sửa:** Chỉ yêu cầu quyền thu/hoàn khi payment state hoặc phương thức thực sự thay đổi; hoặc không gửi payment fields trong hành động lưu đơn chưa thu.

**Độ tin cậy:** Cao về payload và nhánh quyền; điều kiện phụ thuộc membership được cấp tập quyền như trên.

### R8-06 — [P3] Nhập giá âm trong Translation Editor bị biến thành giá dương

**Vị trí:** `src/components/dashboard/TranslationEditorModal.tsx:352-355, 556-562`; `src/app/(dashboard)/dashboard/ai-scanner/page.tsx:457`.

**Bằng chứng:** Hai handler loại mọi ký tự không phải chữ số trước khi chuyển giá sang number. Input giá là `type="number"` nhưng không có `min`; vì vậy nhập giá âm như `-45000` có thể được parse thành `45000` thay vì bị báo không hợp lệ. Không tính claim về sai lệch trạng thái tồn kho của candidate AGY vì nhánh Mobile đã cập nhật `stock_quantity` và `is_available` nhất quán trong state cục bộ; phần zero-stock Translation Editor trùng finding R5-02.

**Hướng sửa:** Parse bằng quy tắc tiền tệ có validation rõ ràng; từ chối số âm và không xóa dấu trước khi kiểm tra input.

**Độ tin cậy:** Cao về parser và input; chưa thử thao tác trên giao diện.

### R8-07 — [P2] Dịch bài viết không hiển thị lỗi API và có thể chuyển sang tab tiếng Anh rỗng

**Vị trí:** `src/app/(dashboard)/dashboard/posts/page.tsx:391-410`; `src/app/api/ai/translate/route.ts:16-19`; `src/app/api/ai/_lib/guard.ts:74-102`.

**Điều kiện và bằng chứng:** Handler gọi `/api/ai/translate` không dùng `getAuthHeaders()`, không kiểm tra `res.ok` và chuyển `activeLangTab` sang `en` kể cả khi body lỗi/không có bản dịch. Cookie `qlaok_session` vẫn được browser gửi trong request same-origin; lỗi thiếu auth headers giới hạn ở phiên dựa trên Supabase Bearer JWT. Các lỗi 401/429/500 cũng không có nhánh báo lỗi riêng.

**Hướng sửa:** Dùng `getAuthHeaders()`, kiểm tra `res.ok`, chỉ chuyển tab khi nhận đủ dữ liệu dịch; đặt thông báo lỗi cho người dùng.

**Độ tin cậy:** Cao về nhánh xử lý; chưa xác định tỷ lệ phiên Bearer trong production.

### R8-08 — [P2] Mobile hiện nút nhận/hoàn tất đơn cho thành viên thiếu `orders.fulfill`

**Vị trí:** `mobile/src/components/tabs/OrdersTab.tsx:445-519`; `mobile/App.tsx:450-458, 1482-1497`; `src/app/api/orders/route.ts:878-884`.

**Bằng chứng:** OrdersTab render hành động theo status đơn mà không nhận/check cờ `canFulfill`. App truyền cờ quyền thu tiền/hoàn tiền/hủy nhưng không truyền quyền fulfill. API lại yêu cầu `orders.fulfill` khi đổi status. Nhân viên chỉ có quyền xem đơn vì vậy thấy nút nhưng thao tác bị server từ chối.

**Hướng sửa:** Truyền quyền fulfill vào OrdersTab và ẩn/disable transition actions khi thiếu quyền; giữ server authorization như hiện tại.

**Độ tin cậy:** Cao về UI/API; chưa xác minh với tài khoản mobile runtime.

### R8-09 — [P3] Sửa đơn khách hàng nối lặp hậu tố khuyến mãi vào ghi chú

**Vị trí:** `src/components/storefront/ShowToStaffModal.tsx:413-415, 624-627, 684-706`.

**Bằng chứng:** Khi mở đơn cũ, modal nạp nguyên `customer_note`, có thể đã gồm hậu tố `[KM ...]`; cả nhánh sửa và nhánh gửi đều nối thêm hậu tố hiện tại. Mỗi lần sửa đơn có thể thêm một bản nữa, đồng thời giữ lại nội dung khuyến mãi cũ trong note.

**Hướng sửa:** Lưu note và thông tin promo ở trường riêng, hoặc loại hậu tố do hệ thống tạo ra trước khi thêm giá trị mới.

**Độ tin cậy:** Cao về cách dựng request; chưa xác minh cách staff sử dụng/diễn giải note.

### R8-10 — [P3] Onboarding đổi giá 0 thành 35.000đ khi tạo món đầu tiên

**Vị trí:** `src/lib/onboarding-flow.ts:321-345`; input `src/app/(auth)/onboarding/page.tsx:681-687`; `src/lib/catalog-excel.ts:5-6`.

**Bằng chứng:** Onboarding parse `firstItemPrice` bằng `Number(...digits...) || 35000`; giá 0 vì vậy bị thay bằng 35.000đ. Catalog đặt `MIN_CATALOG_ITEM_PRICE = 0`, nên mức 0 được hệ thống chấp nhận ở các đường nhập khác. Input onboarding là `type="number"`, không khai báo `min`/`step`; không đưa claim về số thập phân vào finding này.

**Hướng sửa:** Phân biệt input rỗng/không hợp lệ với số 0; không dùng `||` để áp giá mặc định.

**Độ tin cậy:** Cao về phép chuyển đổi và giới hạn giá; chưa chạy onboarding runtime.

### Candidate vòng 8 không tính hoặc được gộp

| Candidate AGY | Kết luận Codex |
| :--- | :--- |
| R8-02: POS line discount/custom price | Trùng R6-03; không đếm lại. |
| R8-06: UI stale state khi stock về 0 | Phần Translation Editor trùng R5-02; khẳng định Mobile không cập nhật `is_available` là sai vì handler đã cập nhật cả stock và availability trong state. Chỉ giữ lỗi parser giá âm ở finding R8-06. |

### CodeGraph, kiểm tra và giới hạn vòng 8

- **CodeGraph:** Index báo synchronized/up-to-date, 256 file, 4.017 node, 14.329 edge. AGY chạy explore/node/callers trên các luồng POS/order pricing/workflow/storefront/catalog/AI/posts/mobile; Codex đọc lại các symbol trọng yếu và caller liên quan trước khi chấp nhận finding.
- **Độ bao phủ:** 119/256 file index được rà ở lượt sâu UI này. Số 46,5% là phép chia số file, không phải feature coverage. 137 file chưa được xem ở vòng 8; các vòng trước chỉ rà delta trên một số miền. Vì chưa có inventory toàn bộ feature/luồng và ma trận kiểm chứng runtime, không thể khẳng định phần trăm feature đã review.
- **Không chạy:** tests, build, typecheck, lint, API/DB runtime hoặc thao tác production. Đây là static source review; các kịch bản thực tế và quy mô ảnh hưởng chưa được xác nhận.
- **Thay đổi vòng 8:** cập nhật tài liệu review và file handoff bị ignore trong `.agy-runs`; không sửa application source, migration, workflow hoặc tests.

## Vòng 9 — AGY Gemini 4 Argon High và Codex xác minh độc lập

**Ngày:** 26/10/2026  
**AGY run:** `2026-10-26T10-00-58-201Z-502f37c7`, effort High, terminal `SUCCESS`, 660 giây; 0 file thay đổi. Vòng này chỉ dùng AGY và Codex.

### Findings mới Codex xác nhận từ source

#### R9-01 — [P2] `resolveBackupPath` cho phép ghi bản dump vào thư mục tracked khi chạy script từ thư mục con

**Vị trí:** `scripts/backup-qlaok-db.mjs:153-169, 172-180, 219-221`; `.gitignore:1-8`.

**Điều kiện:** Người vận hành chạy script khi `cwd` là một thư mục con trong repository, rồi chọn `--output-file` trỏ ra khỏi `cwd` nhưng vẫn nằm trong một thư mục tracked. Ví dụ từ `mobile/`, đường dẫn `../src/production.dump` trỏ vào `src/` của repository.

**Đường chạy:** `executeBackup` truyền `process.cwd()` vào `resolveBackupPath`. Hàm resolve đích theo `cwd`, rồi chỉ kiểm tra top-level path khi `path.relative(cwd, dest)` không bắt đầu bằng `..`. Với ví dụ trên, `rel` bắt đầu bằng `..`, nên nhánh kiểm tra allowlist bị bỏ qua. Hàm tiếp tục tạo file và gọi `pg_dump` với cả schema `public` và `auth`. `.gitignore` không loại trừ file dump trong `src/`.

**Tác động:** Một lệnh backup hợp lệ nhưng chạy từ thư mục con có thể đặt dữ liệu shop và `auth.users` vào cây source được Git theo dõi. File được tạo mode `0600`, nhưng vẫn có thể bị stage/commit nhầm nếu người vận hành không nhận ra đường dẫn đã thoát khỏi vùng backup dự kiến.

**Độ tin cậy và giới hạn:** Cao về việc path check bỏ qua trường hợp `..`; chưa thực thi `pg_dump` hoặc tạo dump thật. Codex kiểm tra `resolveBackupPath`, caller `executeBackup`, tham số `pg_dump` và ignore rules. Không đọc database hoặc secrets.

#### R9-02 — [P3] Kiểm tra realtime sau deploy chỉ kiểm tra `orders`, bỏ sót bảng service request mà broker cũng cần

**Vị trí:** `scripts/check-order-realtime.mjs:11-20`; `.github/workflows/deploy.yml:120-122`; `src/lib/order-events.ts:337-347`.

**Bằng chứng:** Workflow chạy `check-order-realtime.mjs` sau health check. Script chỉ đăng ký `postgres_changes` cho bảng `orders` rồi coi `SUBSCRIBED` là thành công. `OrderEventsBroker.ensureUpstream` đăng ký cả `orders` và `table_service_requests` trên cùng một channel. Vì vậy post-deploy smoke check không xác nhận được binding realtime của `table_service_requests`; deploy có thể xanh dù luồng cập nhật yêu cầu gọi nhân viên/yêu cầu hóa đơn chưa được kiểm tra.

**Tác động:** Lỗi cấu hình realtime riêng cho service request có thể lọt qua smoke check sau deploy và chỉ lộ ra khi cửa hàng dùng luồng này.

**Độ tin cậy và giới hạn:** Cao về khác biệt giữa hai danh sách bảng; tình trạng publication và phản hồi channel thực tế của Supabase chưa được kiểm tra live. Không gọi production API/DB.

### Candidate không được tính là finding mới

- Deploy restore bản `.local-db` cũ: trùng finding 25 trong `docs/AGY_CODE_REVIEW_2026-10-26.md`; không đếm lại.
- Migration checksum drift: đã nằm trong finding 15 của `docs/AGY_CODE_REVIEW_2026-10-26.md`; không đếm lại. Tác động partial failure giữa hai HTTP request chưa được tách thành finding riêng ở vòng này.
- Dependency injection trong demo reset runner: khác biệt chủ yếu ở test seam; đường chạy CLI mặc định vẫn truyền các dependency đồng bộ như thiết kế hiện tại, chưa chứng minh lỗi production.
- Service worker fallback có thể resolve `undefined` khi offline, nhưng không có offline behavior contract được xác nhận và request vốn đã mất mạng; không tính là lỗi sản phẩm mới ở vòng này.

### CodeGraph, kiểm tra và giới hạn vòng 9

- **CodeGraph:** `codegraph status`; các truy vấn `explore` về migration/backup, demo reset, deploy workflow, service worker và `.local-db`; `node` cho `resolveBackupPath`, `parseBackupArgs`, `executeBackup`, `prepareDemoPublicReset`, `executePreflight`, `executeDemoPublicReset`, `runBackupCli`, `ensureUpstream`, `scripts/check-order-realtime.mjs`, `public/sw.js`, `PwaInstallBanner`, `buildDemoPublicResetTransactionSql`, `buildDemoSeedRows`; `callers resolveBackupPath`; `query CACHE_NAME`.
- **Đã kiểm tra trực tiếp:** workflow YAML và `.gitignore` (các file không được CodeGraph index), sau khi query CodeGraph cho các luồng liên quan.
- **Không chạy:** tests, build, lint, typecheck, migrations, backup/reset hoặc lệnh deploy; không gọi API/DB production và không mở `.env*`/`.local-db`.
- **Phạm vi:** static review trên nhóm release automation, backup/reset và service worker; chưa hoàn tất review mọi file hoặc mọi feature trong repository. Con số 46,5% là coverage số file của lượt sâu UI vòng 8, không phải feature coverage.

