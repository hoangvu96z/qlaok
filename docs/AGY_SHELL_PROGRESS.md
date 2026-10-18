# AGY Shell & Base Theme Progress (`docs/AGY_SHELL_PROGRESS.md`)

## Scope
Owned exclusively by the AGY Shell & Base Theme sub-agent:
- `src/app/(dashboard)/dashboard/layout.tsx`
- `src/components/ui/ThemeToggle.tsx`
- `src/app/layout.tsx`
- `src/components/ui/AppI18nProvider.tsx`
- `src/app/(storefront)/s/[slug]/layout.tsx`
- `src/components/storefront/StorefrontCustomDecor.tsx`

## Checklist
- [x] **CodeGraph exploration & node inspection**: Queried `codegraph status`, `codegraph files`, `codegraph explore`, `codegraph callers`, and `codegraph node` for all owned files and callers.
- [x] **Dashboard Sidebar Single Edge Arrow Toggle (`src/app/(dashboard)/dashboard/layout.tsx`)**:
  - Kept the single desktop collapse/expand arrow button on the right edge of `<aside>` (`data-testid="sidebar-edge-toggle"`) with `aria-label`, `aria-expanded={!isSidebarCollapsed}`, `title`, and `localStorage` persistence (`qlaok_cms_sidebar_collapsed`).
  - Removed the redundant toggle button inside `<aside>` brand header and the redundant `data-testid="header-collapse-menu"` button in `<header>`.
  - Preserved mobile bottom navigation bar.
- [x] **Remove Black Full-Width Super-Admin Impersonation Strip (`src/app/(dashboard)/dashboard/layout.tsx`)**:
  - Removed the full-width `bg-slate-950` impersonation strip above `<header>`.
  - Retained safe, discoverable exit impersonation (`stopAdminImpersonation(); router.push('/admin')`) in the desktop sidebar (`data-testid="sidebar-exit-impersonation"`), top header bar (`data-testid="header-exit-impersonation"`), and mobile bottom navigation (`data-testid="mobile-exit-impersonation"`).
- [x] **Base Theme & `ThemeToggle` (`src/components/ui/ThemeToggle.tsx`, `src/app/layout.tsx`, `src/components/ui/AppI18nProvider.tsx`)**:
  - Default theme is strictly `light` when no preference is stored (`<html lang="vi" data-theme="light" className="light ...">`).
  - Added support for `ThemePreference = 'light' | 'dark' | 'system'` with helpers (`normalizeThemePreference`, `getStoredThemePreference`, `resolveEffectiveTheme`, `getInitialTheme`, `applyThemeToDom`, `setThemePreference`) while keeping existing `ThemeToggle`, `getInitialTheme`, and `applyThemeToDom` exports backwards-compatible.
  - Guarded `window.localStorage` property getter access inside `try/catch` in `getStoredThemePreference` and `setThemePreference` with an in-memory fallback (`inMemoryThemePreference`) so environments where `window.localStorage` getter throws `SecurityError` default cleanly to `light` and still update DOM/in-memory state when a theme is chosen.
  - Device `prefers-color-scheme: dark` updates are honored **only** when preference is explicitly set to `'system'`.
  - Global theme initialization and storage/custom-event synchronization added in `AppI18nProvider`.
- [x] **Storefront Outer Layout & `StorefrontCustomDecor` (`src/app/(storefront)/s/[slug]/layout.tsx`, `src/components/storefront/StorefrontCustomDecor.tsx`)**:
  - Made `StorefrontLayout` outer wrapper theme-aware (`bg-slate-100/80 dark:bg-slate-950` and `bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100`).
  - Removed `qr-light-surface` from full-page `getStorefrontBackgroundProps` (`clean` and `warm` styles) and non-QR storefront cards/popups (`StorefrontPromoBanner` voucher chip, `StorefrontFlashSaleSection` item cards, `StorefrontWelcomePopup` modal) so explicit dark mode works cleanly while actual QR code frames retain `.qr-light-surface`.
- [x] **Verification**:
  - Ran `codegraph sync` and `codegraph status`.
  - Verified `/tmp/qlaok-theme-component-qa.mjs` passes all checks (`PASS: default light, explicit theme and system preference resolution`, `PASS: inaccessible localStorage getter falls back to light`, `PASS: actual confirmation component server-rendered with managed table and canonical cart labels`).
  - Verified `node --import ./tests/register-ts.mjs --test tests/app-i18n-review.test.ts` passes (`5/5`).
