# App copy and localization

## Language domains

- Web management, authentication, onboarding, Super Admin and public marketing pages support Vietnamese and English. Vietnamese is the default. `AppI18nProvider` renders the shared VI/EN selector and persists `qlaok_app_locale`; changing language does not navigate or replace the workspace.
- `src/lib/app-i18n.ts` contains typed shared keys, interpolation, fallback, language names and storage helpers. `t(key, params)` checks keys at compile time. `tx(vi, en, params)` keeps page-specific bilingual copy beside its component. Both accept `{name}` placeholders; missing English falls back to Vietnamese.
- Mobile uses its React 18 provider and typed resources in `mobile/src/lib/mobile-i18n.ts`, without importing the web React 19 provider. Native preferences use Expo SecureStore; web uses localStorage. Slow reads cannot replace a newer choice, and queued native writes preserve the last selection.
- Customer menus and phone previews retain their independent eight-language selection and `qlaok_lang` preference. Only the preview frame controls follow the management language. Customer pages own their document language; app preferences cannot change it.
- Shop names, merchant content, notes, promotion text and existing catalog translations are never rewritten by changing the app language. POS can display an existing English catalog translation and otherwise retains the original text.

## Copy conventions

Use short task names for navigation and buttons. Keep details in help text, tooltips and settings. Icon-only controls retain translated accessible names. The orders toolbar shows volume, such as “Chuông: Siêu to”, while sound-pattern descriptions stay in settings. Technical connection details are represented by a status dot with an accessible description.

Keep financial actions explicit: payment received, fulfillment and refund are separate states. A combined “Mark paid & complete” action names both effects. Labels must describe the number being displayed; total orders today must not be labeled unpaid orders.

`getPlanCopy` in `src/lib/plan-copy.ts` supplies both marketing pricing and management billing. Prices, quotas and feature flags remain in `PLAN_CONFIGS` and were not changed.

## Data loading

Language changes must not be dependencies of effects that reload and initialize store drafts. Request callbacks read current translations through refs when needed. The dashboard shell and orders view use authenticated order events, with the existing 30-second fallback when disconnected; the shell no longer polls every 3.5 seconds. See `REALTIME_NOTES.md`.

## Verification

- Web and mobile TypeScript checks pass.
- 66 unit tests, 38 review tests, 1 isolated PostgreSQL migration test and 18 mobile tests pass (123 total).
- The production Next build passes.
- Browser checks cover VI/EN switching and persistence, mobile management tabs, unsaved store drafts, the owner dashboard routes, Super Admin API-error/retry states and all six admin tabs. Orders layout is checked at 390, 768 and 1280 pixels.
- With both shell and orders event streams connected, a nine-second idle window produced zero order or catalog reloads. A disposable new-order event updated the order list without reloading the catalog.
- Local harnesses (`tests/order-ui-fixture.mjs`, `tests/admin-ui-fixture.mjs`, `tests/mobile-ui-fixture.mjs`) use disposable data and intercept API requests. They must never be deployed as application servers.

## Limits

Backend error details remain verbatim and may be Vietnamese even when the app is English. Server metadata and merchant text are not automatically translated. Existing Vietnam accounting dates, currency and permissions remain authoritative. Expo Web and mocked native storage were checked; physical iOS/Android devices and printer hardware were not tested in this change.

## Bổ sung bảng bàn và theme — 18/10/2026

Quản lý bàn và báo cáo theo bàn có copy VI/EN theo app locale. Menu vẫn giữ miền ngôn ngữ khách riêng; hàng cờ trùng dropdown đã được bỏ. Modal xác nhận dùng light mặc định và dark variants đồng bộ với preference toàn app, giữ khung QR thanh toán trắng. Cart và lựa chọn bàn được giữ khi đổi ngôn ngữ hoặc refresh catalog. Xem `docs/TABLE_MANAGEMENT.md` và kết quả kiểm thử mới ở `docs/CODEX_TABLES_REVIEW.md`; tổng số test trong phần Verification phía trên thuộc lượt i18n trước.
