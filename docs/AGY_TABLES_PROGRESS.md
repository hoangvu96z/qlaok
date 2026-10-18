> **Lịch sử kế hoạch ban đầu.** Task sau đó được Codex chia thành ba phiên Antigravity CLI: [backend](AGY_BACKEND_HANDOFF.md), [shell/theme](AGY_SHELL_HANDOFF.md), [table UI](AGY_TABLE_UI_HANDOFF.md). Kết quả tích hợp hiện tại xem [CODEX_TABLES_REVIEW](CODEX_TABLES_REVIEW.md); checkbox phía dưới thuộc thời điểm lập kế hoạch.

# AGY Tables, UI Cleanup & Theme Progress (`docs/AGY_TABLES_PROGRESS.md`)

## 1. Scope & Requirements Checklist
- [x] **Mandatory CodeGraph Exploration**: Ran `codegraph status`, `codegraph files`, `codegraph explore`, `codegraph callers`, and `codegraph node` across dashboard layout, storefront menu, `ShowToStaffModal`, theme toggle/root layout, QR studio, reports, orders/shops APIs, and `mpos-store` / `db`.
- [ ] **Req 1 — Dashboard Sidebar Toggle Cleanup (`src/app/(dashboard)/dashboard/layout.tsx`)**:
  - Keep **only one** desktop collapse/expand arrow button at the right edge of `<aside>` (`data-testid="sidebar-edge-toggle"`), accessible (`aria-label`, `aria-expanded`, `title`) and persisted in `localStorage` (`qlaok_cms_sidebar_collapsed`).
  - Remove duplicate toggle button inside the brand row of `<aside>` and duplicate `data-testid="header-collapse-menu"` button in `<header>`.
  - Preserve mobile drawer navigation.
- [ ] **Req 2 — Remove Super Admin Black Impersonation Banner (`src/app/(dashboard)/dashboard/layout.tsx`)**:
  - Remove the top full-width `bg-slate-950` black strip (`header.adminViewingShop` / `header.exitAdminView`).
  - Preserve a discoverable safe exit impersonation control in existing account/admin navigation (`stopAdminImpersonation(); router.push('/admin')`) on desktop sidebar and mobile header/drawer without a separate black bar.
- [ ] **Req 3 — Storefront Menu Duplicate Language Controls (`src/app/(storefront)/s/[slug]/menu/page.tsx`)**:
  - Keep the compact `<LanguageSwitcher ... compact />` dropdown in the menu top bar and remove the duplicate horizontal `<LanguageSwitcher ... />` flag row immediately below it.
  - Preserve marketing (`/`) and door (`/s/[slug]`) language selectors.
- [ ] **Req 4 — Light Default Theme & `ShowToStaffModal` (`src/components/storefront/ShowToStaffModal.tsx`, `src/components/ui/ThemeToggle.tsx`, `src/components/ui/AppI18nProvider.tsx`, `src/components/storefront/StorefrontCustomDecor.tsx`, `src/app/layout.tsx`, `src/app/(storefront)/s/[slug]/layout.tsx`, `src/app/(storefront)/s/[slug]/menu/page.tsx`)**:
  - Convert `ShowToStaffModal` from hardcoded dark surfaces (`bg-slate-950`, `bg-slate-900`, `text-white`) to consistent light default surfaces (`bg-slate-50 dark:bg-slate-950`, `bg-white dark:bg-slate-900`, `text-slate-900 dark:text-slate-100`, `border-slate-200 dark:border-slate-800`) across confirmation, table picker, payment selector, VietQR card (keeping `.qr-light-surface` on the QR frame), live order tracker, editing banner, empty cart, and error state.
  - Ensure root theme initialization defaults strictly to `light` when no explicit preference is saved (no auto-dark on mount), while supporting explicit user selection (`light`, `dark`, `system`) and providing a clean theme toggle on the storefront header too.
  - Remove `qr-light-surface` from the full-page storefront background wrapper in `StorefrontCustomDecor.tsx` so explicit dark mode works cleanly across storefront and modal while QR frames remain high-contrast light.
- [ ] **Req 5 — Merchant-Managed Tables & QR Auto-Selection**:
  - Add additive migration `supabase/migrations/007_shop_tables.sql` (`public.shop_tables`, `public.orders.table_id`, RLS, owner-only mutation boundary trigger, archive-vs-delete protection, and atomic RPC updates).
  - Implement server store & validation in `src/lib/shop-tables.ts`, `src/lib/mpos-store.ts`, `src/lib/db.ts`, `/api/shops`, `/api/orders`, and `/api/catalog`.
  - Owner can create, rename, activate/deactivate, and archive tables, and generate/copy/download QR per table in `/dashboard/qr-studio` (integrated with `PrintableStandee` and `/dashboard/orders`).
  - Storefront `/s/[slug]/menu` reads `?tableId=` / `?table=` QR params, auto-selects valid active shop table, replaces hardcoded `QUICK_TABLES` with configured active shop tables + Takeaway, and surfaces a clear warning/resolution banner if a scanned table QR is invalid, cross-shop, inactive, or archived (never silently assigning another table).
- [ ] **Req 6 — Reports by Managed Table (`src/app/(dashboard)/dashboard/reports/page.tsx`, `src/lib/mpos-store.ts`)**:
  - Compute per-table order statistics (`computeShopTableOrderStats`) for the selected date range (UTC+7 Vietnam time) using canonical payment rules (`paid` non-cancelled = collected revenue, `unpaid`/`pending` = unpaid, `refunded` = refunded, `cancelled` = cancelled).
  - Consolidate by `table_id` across table renames and archives, and distinguish Managed Tables, Takeaway, and Legacy/Unassigned rows without double counting or cross-shop leakage.
- [ ] **Verification & Documentation**:
  - Add unit, review, and SQL/PGlite tests; run `codegraph sync`, web/mobile `typecheck`, `test:unit`, `test:review`, `test:sql`, mobile tests, and `npm run build`.
  - Complete `docs/AGY_TABLES_HANDOFF.md` and update `README.md` / `ARCHITECTURE.md`.

## 2. CodeGraph Queries Executed So Far
- `codegraph status`
- `codegraph files`
- `codegraph explore "dashboard layout sidebar toggle impersonation ShowToStaffModal ThemeToggle"`
- `codegraph explore "QR studio PrintableStandee reports orders table_label PosCounterWorkspace"`
- `codegraph explore "mpos-store createOrder settleTableBill table_label api orders catalog"`
- `codegraph callers "dbCreateOrder"`
- `codegraph callers "ShowToStaffModal"`
- `codegraph callers "ThemeToggle"`
- `codegraph callers "PrintableStandee"`
- `codegraph node` on:
  - `src/app/(dashboard)/dashboard/layout.tsx`
  - `src/app/layout.tsx`
  - `src/components/ui/ThemeToggle.tsx`
  - `src/components/ui/AppI18nProvider.tsx`
  - `src/app/(storefront)/s/[slug]/menu/page.tsx`
  - `src/app/(storefront)/s/[slug]/page.tsx`
  - `src/app/(storefront)/s/[slug]/layout.tsx`
  - `src/components/storefront/ShowToStaffModal.tsx`
  - `src/components/storefront/StorefrontCustomDecor.tsx`
  - `src/app/(dashboard)/dashboard/qr-studio/page.tsx`
  - `src/components/dashboard/PrintableStandee.tsx`
  - `src/app/(dashboard)/dashboard/reports/page.tsx`
  - `src/components/dashboard/PosCounterWorkspace.tsx`
  - `src/app/api/orders/route.ts`
  - `src/app/api/shops/route.ts`
  - `src/app/api/catalog/route.ts`
  - `src/lib/mpos-store.ts`
  - `src/lib/db.ts`
  - `src/lib/shop-permissions.ts`
  - `src/lib/auth-session.ts`
  - `src/lib/app-i18n.ts`
  - `src/lib/i18n-helper.ts`
  - `src/types/qlaok.ts`
  - `mobile/src/lib/supabase.ts`
