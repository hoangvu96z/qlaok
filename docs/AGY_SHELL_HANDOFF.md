# AGY Shell Cleanup & Base Theme Handoff (`docs/AGY_SHELL_HANDOFF.md`)

## 1. CodeGraph Evidence
```text
CodeGraph:
- status: `codegraph status` / `codegraph sync` (129 files, up to date)
- explore:
  - `codegraph explore "dashboard layout sidebar toggle impersonation ShowToStaffModal ThemeToggle"`
  - `codegraph explore "QR studio PrintableStandee reports orders table_label PosCounterWorkspace"`
  - `codegraph explore "qlaok_theme getInitialTheme applyThemeToDom ThemeToggle"`
- callers:
  - `codegraph callers getStorefrontBackgroundProps`
  - `codegraph callers ThemeToggle`
- node:
  - `codegraph node src/app/(dashboard)/dashboard/layout.tsx`
  - `codegraph node src/app/layout.tsx`
  - `codegraph node src/components/ui/ThemeToggle.tsx`
  - `codegraph node src/components/ui/AppI18nProvider.tsx`
  - `codegraph node src/app/(storefront)/s/[slug]/layout.tsx`
  - `codegraph node src/components/storefront/StorefrontCustomDecor.tsx`
  - `codegraph node tests/app-i18n-review.test.ts`
```

## 2. Files Modified (Strictly Within Owned Scope)
1. **`src/app/(dashboard)/dashboard/layout.tsx`**:
   - Kept **only one** desktop sidebar collapse/expand toggle button at the right edge of `<aside>` (`data-testid="sidebar-edge-toggle"`), with `aria-label={sidebarToggleLabel}`, `aria-expanded={!isSidebarCollapsed}`, `title={sidebarToggleLabel}`, and `localStorage` persistence under `qlaok_cms_sidebar_collapsed`.
   - Removed the duplicate collapse/expand button inside the `<aside>` brand header row and the duplicate `data-testid="header-collapse-menu"` button inside `<header>`.
   - Removed the full-width black super-admin impersonation banner (`bg-slate-950 text-amber-300 ...`) above `<header>`.
   - Retained safe, discoverable exit impersonation (`stopAdminImpersonation(); router.push('/admin')`) in the desktop `<aside>` footer (`data-testid="sidebar-exit-impersonation"`), top `<header>` bar (`data-testid="header-exit-impersonation"`), and mobile bottom `<nav>` (`data-testid="mobile-exit-impersonation"`).
2. **`src/components/ui/ThemeToggle.tsx`**:
   - Preserved existing `ThemeMode`, `getInitialTheme`, `applyThemeToDom`, and `ThemeToggle` exports while adding `ThemePreference = 'light' | 'dark' | 'system'`, `THEME_STORAGE_KEY`, `THEME_CHANGE_EVENT`, `normalizeThemePreference`, `getStoredThemePreference`, `resolveEffectiveTheme`, and `setThemePreference`.
   - Default theme is strictly `'light'` when no preference is stored.
   - **Follow-up Fix (Inaccessible `window.localStorage` Getter)**: Moved `window.localStorage` property access inside `try/catch` in both `getStoredThemePreference` and `setThemePreference` and added an in-memory fallback (`inMemoryThemePreference`). When `window.localStorage` getter throws `SecurityError`, initialization safely defaults to `'light'`, and choosing a theme still updates the DOM, `inMemoryThemePreference`, and dispatches `qlaok_theme_change` without requiring persistent storage.
   - Device `prefers-color-scheme: dark` media query changes only affect the active theme when the active preference is `'system'`.
   - Added optional `compact?: boolean` and `allowSystem?: boolean` props to `<ThemeToggle />` so storefront/other headers can render a compact or 3-state toggle without breaking existing callers.
3. **`src/app/layout.tsx`**:
   - Initialized `<html lang="vi" data-theme="light" className="light ...">` and dark-mode aware `<body>` classes (`bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100`).
4. **`src/components/ui/AppI18nProvider.tsx`**:
   - Initialized saved theme preference globally on mount (`applyThemeToDom(getStoredThemePreference())`) and synchronized across `storage`, `qlaok_theme_change`, and `prefers-color-scheme` (when set to `'system'`) so routes without a mounted `<ThemeToggle />` still honor saved theme preference and default to light.
5. **`src/app/(storefront)/s/[slug]/layout.tsx`**:
   - Updated outer storefront containers to be theme-aware (`bg-slate-100/80 dark:bg-slate-950` and `bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 ring-slate-200/70 dark:ring-slate-800`).
6. **`src/components/storefront/StorefrontCustomDecor.tsx`**:
   - Removed `qr-light-surface` and `!bg-*` overrides from full-page `getStorefrontBackgroundProps` (`clean` and `warm` styles) so explicit dark mode works across the storefront while default remains light.
   - Removed `qr-light-surface` from non-QR storefront elements (`StorefrontPromoBanner` voucher button, `StorefrontFlashSaleSection` item cards, `StorefrontWelcomePopup` container) and added dark-mode classes while preserving `.qr-light-surface` on actual QR frames and the dashboard phone preview frame.

## 3. Coordination Notes for Sibling Agents & Codex
- `<ThemeToggle />` can be imported from `@/components/ui/ThemeToggle` with optional `compact` / `allowSystem` props (e.g., `<ThemeToggle compact />` in storefront header).
- No files outside this agent's owned scope (`ShowToStaffModal.tsx`, `s/[slug]/menu/page.tsx`, `qr-studio/page.tsx`, `reports/page.tsx`, `PosCounterWorkspace.tsx`, `src/lib/app-i18n.ts`, backend/types/helpers/migrations, or Codex tests) were modified.

## 4. Verification Run
- `node --experimental-strip-types --import ./tests/register-ts.mjs --import /tmp/qlaok-tsx-qa-register.mjs /tmp/qlaok-theme-component-qa.mjs`:
  - `PASS: default light, explicit theme and system preference resolution`
  - `PASS: inaccessible localStorage getter falls back to light`
  - `PASS: actual confirmation component server-rendered with managed table and canonical cart labels`
- Focused regression check for `setThemePreference` & `getStoredThemePreference` under throwing `window.localStorage` getter: Passed (updates DOM `classList`/`data-theme`/`data-theme-preference`, dispatches `qlaok_theme_change`, and retains in-memory preference across `light`/`dark`/`system`).
- `node --import ./tests/register-ts.mjs --test tests/app-i18n-review.test.ts`: Passed (`5/5` tests pass).
- `codegraph sync && codegraph status`: Passed (`129` files indexed, up to date).
