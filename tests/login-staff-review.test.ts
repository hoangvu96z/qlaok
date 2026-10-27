import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  resolveLoginAuthMode,
  parseRecoveryUrlSignals,
} from '@/lib/auth-recovery';

describe('staff login URL mode resolution and auto-redirect preservation', () => {
  it('resolves mode=staff to staff auth mode and preserves other modes', () => {
    assert.equal(
      resolveLoginAuthMode({
        searchParams: new URLSearchParams('mode=staff'),
      }),
      'staff'
    );
    assert.equal(
      resolveLoginAuthMode({
        searchParams: new URLSearchParams('mode=STAFF'),
      }),
      'staff'
    );
    assert.equal(
      resolveLoginAuthMode({
        searchParams: new URLSearchParams('mode=register'),
      }),
      'register'
    );
    assert.equal(
      resolveLoginAuthMode({
        searchParams: new URLSearchParams('mode=otp'),
      }),
      'otp'
    );
    assert.equal(
      resolveLoginAuthMode({
        searchParams: new URLSearchParams('mode=login'),
      }),
      'password_login'
    );
    assert.equal(
      resolveLoginAuthMode({
        searchParams: new URLSearchParams(''),
      }),
      'password_login'
    );
  });

  it('allows password recovery signals to take precedence over staff mode parameter', () => {
    assert.equal(
      resolveLoginAuthMode({
        searchParams: new URLSearchParams('mode=staff&type=recovery'),
      }),
      'reset'
    );
    assert.equal(
      resolveLoginAuthMode({
        searchParams: new URLSearchParams('mode=staff&token_hash=th_xyz&type=recovery'),
      }),
      'reset'
    );
    const recoverySignals = parseRecoveryUrlSignals({
      searchParams: new URLSearchParams('mode=staff'),
      hash: '#access_token=sb-tok&type=recovery',
    });
    assert.equal(recoverySignals.isResetMode, true);
    assert.equal(
      resolveLoginAuthMode({
        searchParams: new URLSearchParams('mode=staff'),
        hash: '#access_token=sb-tok&type=recovery',
      }),
      'reset'
    );
  });

  it('preserves direct /login?mode=staff access without auto-redirecting stored owner accounts', () => {
    const loginSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/(auth)/login/page.tsx'),
      'utf8'
    );

    // Auto-redirect effect checks for mode parameter and ignores staff / reset modes
    assert.match(
      loginSource,
      /if\s*\(\s*!searchParams\.get\(['"]mode['"]\)\s*&&\s*mode\s*!==\s*['"]reset['"]\s*&&\s*mode\s*!==\s*['"]staff['"]\s*\)/
    );

    // URL searchParams effect updates mode to resolved staff mode on navigation
    assert.match(
      loginSource,
      /resolved\s*===\s*['"]staff['"]\s*\|\|\s*modeParam\s*===\s*['"]staff['"]/
    );
  });
});

describe('login page staff mode UI contract and field isolation', () => {
  const loginSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/app/(auth)/login/page.tsx'),
    'utf8'
  );

  it('includes labeled staff mode switch tab with required testid', () => {
    // Mode switcher tabs grid has 4 columns and includes staff button
    assert.match(loginSource, /grid\s+grid-cols-4/);
    assert.match(loginSource, /data-testid="login-mode-staff-btn"/);
    assert.match(
      loginSource,
      /tx\(\s*['"]Nhân viên['"]\s*,\s*['"]Staff['"]\s*\)/
    );
    assert.match(loginSource, /setMode\(['"]staff['"]\)/);
  });

  it('renders exactly three required staff fields with autocomplete and stable testids', () => {
    // Shop identifier field
    assert.match(loginSource, /data-testid="login-staff-shop-identifier"/);
    assert.match(
      loginSource,
      /tx\(\s*['"]Cửa hàng \(slug, ID hoặc liên kết\) \*['"]\s*,\s*['"]Store \(slug, ID, or storefront URL\) \*['"]\s*\)/
    );
    assert.match(loginSource, /autoComplete="organization"/);
    assert.match(loginSource, /spellCheck=\{false\}/);

    // Staff username field
    assert.match(loginSource, /data-testid="login-staff-username"/);
    assert.match(
      loginSource,
      /tx\(\s*['"]Tên đăng nhập \*['"]\s*,\s*['"]Username \*['"]\s*\)/
    );
    assert.match(loginSource, /autoComplete="username"/);

    // Staff password field
    assert.match(loginSource, /data-testid="login-staff-password"/);
    assert.match(
      loginSource,
      /tx\(\s*['"]Mật khẩu \*['"]\s*,\s*['"]Password \*['"]\s*\)/
    );
    assert.match(loginSource, /autoComplete="current-password"/);
    assert.match(loginSource, /type="password"/);
    assert.match(loginSource, /minLength=\{6\}/);

    // Shared form submit button with loading state guard
    assert.match(loginSource, /data-testid="login-submit-btn"/);
    assert.match(
      loginSource,
      /mode\s*===\s*['"]staff['"]\s*\?\s*tx\(\s*['"]Đăng nhập nhân viên['"]\s*,\s*['"]Staff sign-in['"]\s*\)/
    );
  });

  it('isolates staff form by hiding email, registration, OTP, recovery, and demo controls', () => {
    // When mode === 'staff', staff fields block is rendered; owner fields are in the alternate branch
    assert.match(loginSource, /\{mode\s*===\s*['"]staff['"]\s*\?\s*\(/);

    // Demo preview and owner sign-up footer are hidden when mode === 'staff'
    assert.match(loginSource, /\{mode\s*!==\s*['"]staff['"]\s*&&\s*\(/);
    assert.match(loginSource, /onClick=\{handleDemoLogin\}/);

    // Staff mode provides back-to-owner link to switch back to owner login
    assert.match(loginSource, /data-testid="login-staff-back-to-owner-btn"/);
    assert.match(
      loginSource,
      /tx\(\s*['"]← Quay lại đăng nhập chủ quán['"]\s*,\s*['"]← Back to owner sign-in['"]\s*\)/
    );
  });

  it('replaces owner login/register/reset with Zitadel OIDC PKCE without collecting owner passwords and preserves demo preview', () => {
    // Owner login/register/reset delegates to Zitadel OIDC start endpoint
    assert.match(loginSource, /action:\s*['"]oidc_start['"]/);
    assert.match(loginSource, /buildZitadelOidcStartHref/);
    assert.match(loginSource, /handleOwnerOidcRedirect/);

    // Browser never posts owner password login or register payloads to /api/auth
    assert.doesNotMatch(loginSource, /action:\s*['"]register['"]/);
    assert.doesNotMatch(loginSource, /signInWithOtp/);

    // Demo login and post-login routing helpers preserved
    assert.match(loginSource, /action:\s*['"]demo_login['"]/);
    assert.match(loginSource, /resolvePostLoginRoute\(/);
    assert.match(loginSource, /rememberActiveShop\(/);
  });
});

describe('staff login submission contract, session storage, and fixed routing', () => {
  const loginSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/app/(auth)/login/page.tsx'),
    'utf8'
  );

  it('posts staff_login contract to /api/auth with trimmed shop identifier and username', () => {
    assert.match(loginSource, /if\s*\(\s*mode\s*===\s*['"]staff['"]\s*\)\s*\{/);
    assert.match(loginSource, /action:\s*['"]staff_login['"]/);
    assert.match(loginSource, /shopIdentifier:\s*cleanShopIdentifier/);
    assert.match(loginSource, /username:\s*cleanUsername/);
    assert.match(loginSource, /password:\s*staffPassword/);
  });

  it('persists session, sets active shop ID, and routes directly to /dashboard/orders on success', () => {
    // Session persistence via setStoredAuthOwner
    assert.match(loginSource, /setStoredAuthOwner\(data\.user,\s*data\.accessToken\)/);

    // Active shop saved to qlaok_active_shop_id localStorage
    assert.match(
      loginSource,
      /localStorage\.setItem\(['"]qlaok_active_shop_id['"],\s*activeShopId\)/
    );

    // Fixed redirect to /dashboard/orders (never trusts arbitrary nextParam or /onboarding)
    assert.match(loginSource, /router\.push\(['"]\/dashboard\/orders['"]\)/);
  });

  it('handles invalid credentials and rate limit errors without corrupting owner auth', () => {
    // Missing or invalid payload triggers error before setStoredAuthOwner
    const staffBlockMatch = loginSource.match(
      /if\s*\(\s*mode\s*===\s*['"]staff['"]\s*\)\s*\{[\s\S]*?router\.push\(['"]\/dashboard\/orders['"]\);\s*return;\s*\}/
    );
    assert.ok(staffBlockMatch, 'staff submission block must be present');
    const staffBlock = staffBlockMatch[0];

    const errorThrowIndex = staffBlock.indexOf('throw new Error(');
    const storeAuthIndex = staffBlock.indexOf('setStoredAuthOwner(');
    assert.ok(errorThrowIndex > 0, 'must throw error on invalid/error response');
    assert.ok(storeAuthIndex > errorThrowIndex, 'setStoredAuthOwner must happen after validation');

    // Error is set in message state with type: error
    assert.match(loginSource, /setMessage\(\{\s*type:\s*['"]error['"]/);
  });
});
