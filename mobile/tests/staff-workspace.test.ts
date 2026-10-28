import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  clearStaffSession,
  createInMemoryStaffSessionStorage,
  loadStaffSession,
  loginStaff,
  type MobileStaffSession,
  resetStaffSessionMemoryForTest,
  STAFF_SESSION_REVOKED_CODE,
  StaffAuthError,
} from '../src/lib/staff-session.ts';
import {
  createStaffApiClient,
  StaffApiError,
} from '../src/lib/staff-api.ts';
import * as staffOrderingModule from '../src/lib/staff-ordering.ts';
import {
  type AssistedOrderPayload,
  buildAssistedOrderPayload,
  createCartLine,
  createTableSelection,
  generateAssistedOrderIdempotencyKey,
  type StaffCartLine,
  type StaffCatalogItem,
  type StaffCategory,
  type StaffTable,
} from '../src/lib/staff-ordering.ts';
import * as pushNotificationsModule from '../src/lib/push-notifications.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_ROOT = path.resolve(__dirname, '..');

/**
 * Transpiles a mobile `.tsx` module in memory using TypeScript and evaluates its
 * pure exported helpers against real staff-session / staff-api / staff-ordering /
 * push-notifications modules while stubbing React Native UI primitives.
 */
function loadMobileTsxExports<T>(
  relativePathFromMobileRoot: string,
  extraStubs: Record<string, unknown> = {}
): T {
  const fullPath = path.join(MOBILE_ROOT, relativePathFromMobileRoot);
  const source = fs.readFileSync(fullPath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
    fileName: fullPath,
  });

  const exportsObj: Record<string, unknown> = {};
  const moduleObj = { exports: exportsObj };

  const reactStub = {
    memo: (fn: unknown) => fn,
    useCallback: (fn: unknown) => fn,
    useEffect: () => {},
    useMemo: (fn: () => unknown) => fn(),
    useRef: (initial: unknown) => ({ current: initial }),
    useState: (initial: unknown) => [
      typeof initial === 'function' ? (initial as () => unknown)() : initial,
      () => {},
    ],
    createElement: () => null,
  };

  const reactNativeStub = {
    ActivityIndicator: 'ActivityIndicator',
    Alert: { alert: () => {} },
    AppState: {
      currentState: 'active',
      addEventListener: () => ({ remove: () => {} }),
    },
    FlatList: 'FlatList',
    Image: 'Image',
    KeyboardAvoidingView: 'KeyboardAvoidingView',
    Linking: { openURL: async () => {} },
    Modal: 'Modal',
    Platform: { OS: 'ios' },
    RefreshControl: 'RefreshControl',
    SafeAreaView: 'SafeAreaView',
    ScrollView: 'ScrollView',
    StyleSheet: { create: <S>(styles: S): S => styles },
    Text: 'Text',
    TextInput: 'TextInput',
    TouchableOpacity: 'TouchableOpacity',
    View: 'View',
  };

  const customRequire = (id: string): unknown => {
    if (id in extraStubs) return extraStubs[id];
    if (id === 'react') return reactStub;
    if (id === 'react-native') return reactNativeStub;
    if (id === 'expo-status-bar') return { StatusBar: 'StatusBar' };
    if (id === '@expo/vector-icons') return { Ionicons: 'Ionicons' };
    if (id.endsWith('/staff-session') || id.endsWith('/staff-session.ts')) {
      return {
        clearStaffSession,
        createInMemoryStaffSessionStorage,
        loadStaffSession,
        loginStaff,
        STAFF_SESSION_REVOKED_CODE,
        StaffAuthError,
        redactSensitiveText: (
          msg: string,
          secrets: ReadonlyArray<string | null | undefined>
        ) => {
          let out = String(msg || '');
          for (const s of secrets) {
            if (s) out = out.split(s).join('[REDACTED]');
          }
          return out;
        },
      };
    }
    if (id.endsWith('/staff-api') || id.endsWith('/staff-api.ts')) {
      return {
        createStaffApiClient,
        StaffApiError,
        staffApi: createStaffApiClient(),
      };
    }
    if (id.endsWith('/staff-ordering') || id.endsWith('/staff-ordering.ts')) {
      return staffOrderingModule;
    }
    if (
      id.endsWith('/push-notifications') ||
      id.endsWith('/push-notifications.ts')
    ) {
      return pushNotificationsModule;
    }
    if (id.endsWith('/MobileI18nProvider')) {
      return {
        MobileI18nProvider: 'MobileI18nProvider',
        MobileLanguageSwitcher: 'MobileLanguageSwitcher',
        useMobileI18n: () => ({
          locale: 'vi',
          t: (k: string) => k,
          tb: (vi: string) => vi,
        }),
      };
    }
    if (id.endsWith('/AssistedOrderScreen')) {
      return { AssistedOrderScreen: 'AssistedOrderScreen' };
    }
    if (id.endsWith('/mobileStyles')) {
      return { styles: {} };
    }
    if (id.endsWith('/supabase')) {
      return {
        PRODUCTION_API_URL: 'https://qlaok.vunph.click',
        fetchApi: async () => new Response('{}', { status: 200 }),
        formatVnd: (n: number) => `${n}đ`,
        supabase: {
          auth: {
            getSession: async () => ({ data: { session: null }, error: null }),
            onAuthStateChange: () => ({
              data: { subscription: { unsubscribe: () => {} } },
            }),
            signInWithPassword: async () => ({ error: null }),
            signOut: async () => ({ error: null }),
            startAutoRefresh: () => {},
            stopAutoRefresh: () => {},
          },
        },
      };
    }
    return {};
  };

  const runner = new Function(
    'exports',
    'require',
    'module',
    '__filename',
    '__dirname',
    transpiled.outputText
  );
  runner(
    exportsObj,
    customRequire,
    moduleObj,
    fullPath,
    path.dirname(fullPath)
  );
  return moduleObj.exports as T;
}

interface StaffWorkspaceModuleExports {
  canStaffCreateAssistedOrders: (
    session: MobileStaffSession | null | undefined
  ) => boolean;
  normalizeStaffOptionGroups: (
    raw: unknown
  ) => staffOrderingModule.StaffOptionGroup[];
  normalizeStaffCatalogPayload: (
    raw: unknown,
    expectedShopId: string
  ) => {
    shopName?: string;
    categories: StaffCategory[];
    items: StaffCatalogItem[];
  };
  normalizeStaffTablesPayload: (
    raw: unknown,
    expectedShopId: string
  ) => StaffTable[];
  loadStaffWorkspaceContext: (params: {
    shopId: string;
    api?: ReturnType<typeof createStaffApiClient>;
  }) => Promise<{
    shopName?: string;
    categories: StaffCategory[];
    items: StaffCatalogItem[];
    tables: StaffTable[];
  }>;
  submitStaffAssistedOrder: (params: {
    payload: AssistedOrderPayload;
    expectedShopId: string;
    api?: ReturnType<typeof createStaffApiClient>;
  }) => Promise<{
    orderId: string;
    orderCode: string;
    tableId: string | null;
    tableLabel: string;
    totalAmount?: number;
    status: string;
    paymentStatus: 'unpaid';
  }>;
}

interface AuthScreenModuleExports {
  formatStaffLoginError: (
    err: unknown,
    locale: 'vi' | 'en',
    secretsToRedact?: ReadonlyArray<string | null | undefined>
  ) => string;
  defaultOwnerResetRequest: (options: {
    baseUrl: string;
    email: string;
    lang?: 'vi' | 'en';
  }) => Promise<{ ok: boolean }>;
}

interface AppModuleExports {
  resolveMobileWorkspaceRoute: (params: {
    ownerReady: boolean;
    staffReady: boolean;
    ownerSession: { user: { id: string } } | null;
    staffSession: MobileStaffSession | null;
    staffSessionExpired?: boolean;
  }) =>
    | { kind: 'loading' }
    | { kind: 'staff'; staffSession: MobileStaffSession }
    | { kind: 'owner'; ownerSession: { user: { id: string } } }
    | { kind: 'auth'; staffSessionExpired: boolean };
  executeStaffSignOutCleanup: (options?: {
    clearStaff?: () => Promise<void>;
    hasOwnerSession?: boolean;
    getOwnerSession?: () => Promise<{
      data?: { session: { user: { id: string } } | null } | null;
      error?: unknown;
    }>;
    ownerApiCall?: (path: string, init?: RequestInit) => Promise<Response>;
    signOutOwner?: () => Promise<{ error?: { message?: string } | null } | void>;
  }) => Promise<{
    staffCleared: boolean;
    ownerCleaned: boolean;
  }>;
}

function makeStaffSessionFixture(
  overrides: Partial<MobileStaffSession> & {
    permissions?: MobileStaffSession['membership']['permissions'];
    isActive?: boolean;
    role?: 'cashier' | 'staff';
  } = {}
): MobileStaffSession {
  const shopId = overrides.activeShopId ?? 'shop-pho-1';
  const role = overrides.role ?? 'staff';
  return {
    accessToken:
      overrides.accessToken ?? 'qlaok-staff-hmac.payload.signature',
    activeShopId: shopId,
    user: overrides.user ?? {
      id: 'staff-acct-11111111-2222-4333-8444-555555555555',
      username: 'phuc_vu_ban_01',
      full_name: 'Phục Vụ Bàn 01',
      role,
      shop_id: shopId,
      account_type: 'staff',
    },
    shop: overrides.shop ?? {
      id: shopId,
      owner_id: 'owner-1',
      slug: 'pho-hoi-an',
      name: 'Phở Hội An',
      vertical: 'fnb',
      city: 'Đà Nẵng',
      supported_langs: ['vi', 'en'],
      is_published: true,
    },
    membership: overrides.membership ?? {
      id: 'mem-staff-01',
      shop_id: shopId,
      user_id: 'staff-acct-11111111-2222-4333-8444-555555555555',
      role,
      permissions: overrides.permissions ?? ['orders.create'],
      is_active: overrides.isActive ?? true,
    },
  };
}

test.beforeEach(() => {
  resetStaffSessionMemoryForTest();
});

test('AuthScreen dual-login mode: exposes owner/staff switch, isolates staff fields, and formats generic/rate-limit errors without leaking secrets', () => {
  const authScreenSource = fs.readFileSync(
    path.join(MOBILE_ROOT, 'src/components/AuthScreen.tsx'),
    'utf8'
  );

  // 1. Two-mode switch for owner and staff
  assert.match(authScreenSource, /testID="auth-mode-owner"/);
  assert.match(authScreenSource, /testID="auth-mode-staff"/);

  // 2. Staff mode has shopIdentifier, username, password, and submit button
  assert.match(authScreenSource, /testID="staff-shop-identifier-input"/);
  assert.match(authScreenSource, /testID="staff-username-input"/);
  assert.match(authScreenSource, /testID="staff-password-input"/);
  assert.match(authScreenSource, /testID="staff-login-submit-btn"/);

  // 3. Uses loginStaff and passes stored session to typed onStaffLoginSuccess
  assert.match(authScreenSource, /loginStaff/);
  assert.match(authScreenSource, /onStaffLoginSuccess\?\.\(session\)/);

  // 4. Staff branch does not show email registration, email recovery, or createStorePrompt
  const staffBranchMatch = authScreenSource.match(
    /accountMode\s*===\s*['"]staff['"]\s*\?\s*\([\s\S]*?\)\s*:\s*\(/
  );
  assert.ok(staffBranchMatch, 'staff mode conditional branch must exist');
  const staffBranch = staffBranchMatch[0];
  assert.doesNotMatch(staffBranch, /auth\.emailLabel/);
  assert.doesNotMatch(staffBranch, /auth\.forgotPasswordPrompt/);
  assert.doesNotMatch(staffBranch, /auth\.createStorePrompt/);
  assert.doesNotMatch(staffBranch, /requestMobilePasswordRecovery/);
  assert.doesNotMatch(staffBranch, /completeMobilePasswordRecoveryWithCode/);

  // 5. Owner branch uses Zitadel OIDC PKCE login, fail-closed config banner, and createStorePrompt (never Supabase password login)
  assert.match(authScreenSource, /startOwnerOidcLogin/);
  assert.match(authScreenSource, /resolveMobileZitadelOidcConfig/);
  assert.match(authScreenSource, /testID="owner-oidc-login-btn"/);
  assert.match(authScreenSource, /testID="owner-oidc-config-error"/);
  assert.match(authScreenSource, /auth\.createStorePrompt/);
  assert.doesNotMatch(authScreenSource, /supabase\.auth\.signInWithPassword/);

  // 6. Never logs credentials or token
  assert.doesNotMatch(authScreenSource, /console\.(log|info|warn|error|debug)/);

  // 7. Runtime check on formatStaffLoginError in VI and EN
  const { formatStaffLoginError } = loadMobileTsxExports<AuthScreenModuleExports>(
    'src/components/AuthScreen.tsx'
  );

  const rateLimitErr = new StaffAuthError('Too many attempts', {
    status: 429,
    code: 'STAFF_LOGIN_RATE_LIMITED',
    retryAfterSec: 120,
  });
  assert.match(formatStaffLoginError(rateLimitErr, 'vi'), /120 giây/);
  assert.match(formatStaffLoginError(rateLimitErr, 'en'), /120 seconds/);

  const generic401Err = new StaffAuthError(
    'Thông tin cửa hàng, tên đăng nhập hoặc mật khẩu không đúng.',
    { status: 401, code: 'INVALID_STAFF_CREDENTIALS' }
  );
  assert.match(formatStaffLoginError(generic401Err, 'vi'), /không đúng/);
  assert.equal(
    formatStaffLoginError(generic401Err, 'en'),
    'The store name, username, or password is incorrect.'
  );

  // Unknown errors use safe, user-facing copy instead of exposing details
  const leakedErr = new Error('Failed login for secretPass#99');
  const redactedMsg = formatStaffLoginError(leakedErr, 'vi', ['secretPass#99']);
  assert.doesNotMatch(redactedMsg, /secretPass#99/);
  assert.match(redactedMsg, /liên hệ hỗ trợ Qlaok/);
});

test('AuthScreen owner in-app password reset: provides email form, sent confirmation, x-qlaok-client header, and never logs credentials', async () => {
  const authScreenSource = fs.readFileSync(
    path.join(MOBILE_ROOT, 'src/components/AuthScreen.tsx'),
    'utf8'
  );

  // 1. forgot_password step and testIDs exist
  assert.match(
    authScreenSource,
    /ownerFlowStep\s*===\s*['"]forgot_password['"]/
  );
  assert.match(authScreenSource, /testID="owner-reset-email-input"/);
  assert.match(authScreenSource, /testID="owner-reset-submit-btn"/);
  assert.match(authScreenSource, /testID="owner-reset-sent-notice"/);
  assert.match(authScreenSource, /testID="owner-reset-resend-btn"/);
  assert.match(authScreenSource, /testID="owner-reset-back-btn"/);

  // 2. "Quên mật khẩu?" button switches to forgot_password instead of hosted oidc
  const forgotBtnMatch = authScreenSource.match(
    /<TouchableOpacity[\s\S]*?testID="owner-oidc-reset-btn"[\s\S]*?<\/TouchableOpacity>/
  );
  assert.ok(forgotBtnMatch, 'owner-oidc-reset-btn must exist');
  assert.match(
    forgotBtnMatch[0],
    /setOwnerFlowStep\(['"]forgot_password['"]\)/
  );
  assert.doesNotMatch(
    forgotBtnMatch[0],
    /handleStartOwnerOidc\(['"]reset['"]\)/
  );

  // 3. Header contains x-qlaok-client: mobile-native
  assert.match(
    authScreenSource,
    /['"]x-qlaok-client['"]:\s*['"]mobile-native['"]/
  );

  // 4. Runtime test of defaultOwnerResetRequest
  const { defaultOwnerResetRequest } =
    loadMobileTsxExports<AuthScreenModuleExports>(
      'src/components/AuthScreen.tsx'
    );

  const prevFetch = globalThis.fetch;
  try {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: Record<string, unknown> = {};

    globalThis.fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = (init?.headers as Record<string, string>) || {};
      capturedBody = JSON.parse(String(init?.body || '{}'));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const res = await defaultOwnerResetRequest({
      baseUrl: 'https://qlaok.vunph.click',
      email: 'owner@example.test',
      lang: 'vi',
    });
    assert.deepEqual(res, { ok: true });
    assert.equal(
      capturedUrl,
      'https://qlaok.vunph.click/api/auth/login-ui?lang=vi'
    );
    assert.equal(capturedHeaders['x-qlaok-client'], 'mobile-native');
    assert.equal(capturedBody.action, 'password_reset_request');
    assert.equal(capturedBody.email, 'owner@example.test');
    assert.equal(capturedBody.lang, 'vi');

    // 5. Rate limit error handling
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          ok: false,
          code: 'LOGIN_RATE_LIMITED',
          error:
            'Bạn thao tác quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.',
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );

    await assert.rejects(
      () =>
        defaultOwnerResetRequest({
          baseUrl: 'https://qlaok.vunph.click',
          email: 'owner@example.test',
          lang: 'vi',
        }),
      (err: unknown) =>
        err instanceof Error &&
        err.message.includes('Bạn thao tác quá nhiều lần')
    );
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('App session routing: waits for both owner and staff boot, separates StaffWorkspace from owner Workspace, and cleans coexisting owner on staff sign-out', async () => {
  const { resolveMobileWorkspaceRoute, executeStaffSignOutCleanup } =
    loadMobileTsxExports<AppModuleExports>('App.tsx');

  const staffSession = makeStaffSessionFixture();
  const ownerSession = { user: { id: 'owner-supabase-uuid-1' } };

  // 1. Neither ready or only one ready -> stays in loading state (no dashboard flash)
  assert.deepEqual(
    resolveMobileWorkspaceRoute({
      ownerReady: false,
      staffReady: false,
      ownerSession: null,
      staffSession: null,
    }),
    { kind: 'loading' }
  );
  assert.deepEqual(
    resolveMobileWorkspaceRoute({
      ownerReady: true,
      staffReady: false,
      ownerSession,
      staffSession,
    }),
    { kind: 'loading' }
  );
  assert.deepEqual(
    resolveMobileWorkspaceRoute({
      ownerReady: false,
      staffReady: true,
      ownerSession: null,
      staffSession,
    }),
    { kind: 'loading' }
  );

  // 2. Staff session routes to StaffWorkspace (never owner Workspace)
  const routedStaff = resolveMobileWorkspaceRoute({
    ownerReady: true,
    staffReady: true,
    ownerSession: null,
    staffSession,
  });
  assert.equal(routedStaff.kind, 'staff');
  if (routedStaff.kind === 'staff') {
    assert.equal(routedStaff.staffSession.activeShopId, 'shop-pho-1');
  }

  // 3. Owner session routes to owner Workspace when no staff session is active
  const routedOwner = resolveMobileWorkspaceRoute({
    ownerReady: true,
    staffReady: true,
    ownerSession,
    staffSession: null,
  });
  assert.deepEqual(routedOwner, {
    kind: 'owner',
    ownerSession,
  });

  // 4. When staffApi signals sessionCleared due to 401/revocation, routes immediately to auth with expired notice without logging out owner
  const routedExpired = resolveMobileWorkspaceRoute({
    ownerReady: true,
    staffReady: true,
    ownerSession,
    staffSession: null,
    staffSessionExpired: true,
  });
  assert.deepEqual(routedExpired, {
    kind: 'auth',
    staffSessionExpired: true,
  });

  // 5. Explicit staff sign-out clears staff session AND cleans coexisting owner session via unregisterPushOnLogout before returning to login
  const callOrder: string[] = [];
  const pushState = pushNotificationsModule.getSharedMobilePushRegistrationState();
  pushState.expoPushToken = 'ExponentPushToken[ownerLogoutCleanup]';
  pushState.lastRegisteredScope =
    'owner-supabase-uuid-1:shop-a:ExponentPushToken[ownerLogoutCleanup]:vi';
  pushState.registeredShopIds.add('shop-a');
  const cleanupResult = await executeStaffSignOutCleanup({
    clearStaff: async () => {
      callOrder.push('clearStaffSession');
    },
    hasOwnerSession: true,
    ownerApiCall: async (url, init) => {
      callOrder.push(`ownerPushApi:${init?.method || 'GET'}:${url}`);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
    signOutOwner: async () => {
      callOrder.push('supabase.auth.signOut');
    },
  });

  assert.deepEqual(cleanupResult, {
    staffCleared: true,
    ownerCleaned: true,
  });
  assert.deepEqual(callOrder, [
    'clearStaffSession',
    'ownerPushApi:DELETE:/api/push-tokens',
    'supabase.auth.signOut',
  ]);
});

test('StaffWorkspace permission guard: requires active membership and orders.create, and does NOT require orders.view', () => {
  const { canStaffCreateAssistedOrders } =
    loadMobileTsxExports<StaffWorkspaceModuleExports>(
      'src/components/staff/StaffWorkspace.tsx'
    );

  // 1. Staff with orders.create ONLY (no orders.view) -> allowed!
  const createOnlySession = makeStaffSessionFixture({
    permissions: ['orders.create'],
  });
  assert.equal(canStaffCreateAssistedOrders(createOnlySession), true);

  // 2. Staff with orders.view ONLY (missing orders.create) -> denied!
  const viewOnlySession = makeStaffSessionFixture({
    permissions: ['orders.view', 'orders.fulfill'],
  });
  assert.equal(canStaffCreateAssistedOrders(viewOnlySession), false);

  // 3. Inactive membership -> denied!
  const inactiveSession = makeStaffSessionFixture({
    permissions: ['orders.create'],
    isActive: false,
  });
  assert.equal(canStaffCreateAssistedOrders(inactiveSession), false);

  // 4. Cross-shop mismatch in session -> denied!
  const mismatchedShopSession = makeStaffSessionFixture({
    activeShopId: 'shop-pho-1',
    membership: {
      id: 'mem-1',
      shop_id: 'shop-other-99',
      user_id: 'staff-acct-11111111-2222-4333-8444-555555555555',
      role: 'staff',
      permissions: ['orders.create'],
      is_active: true,
    },
  });
  assert.equal(canStaffCreateAssistedOrders(mismatchedShopSession), false);
});

test('StaffWorkspace source & architecture boundary: no Supabase queries, no order polling, no orders list/KDS, no payment/discount/fulfillment controls', () => {
  const staffWorkspaceSource = fs.readFileSync(
    path.join(MOBILE_ROOT, 'src/components/staff/StaffWorkspace.tsx'),
    'utf8'
  );

  // 1. Never imports or queries Supabase directly
  assert.doesNotMatch(staffWorkspaceSource, /supabase\.from\(/);
  assert.doesNotMatch(staffWorkspaceSource, /supabase\.auth/);
  assert.doesNotMatch(staffWorkspaceSource, /from\s+['"][^'"]*supabase['"]/);

  // 2. Never uses owner realtime orders hook, push notifications hook, or order polling
  assert.doesNotMatch(staffWorkspaceSource, /useShopRealtimeOrders/);
  assert.doesNotMatch(staffWorkspaceSource, /useMobilePushNotifications/);
  assert.doesNotMatch(staffWorkspaceSource, /setInterval\(/);
  assert.doesNotMatch(staffWorkspaceSource, /\/api\/orders\?/);
  assert.doesNotMatch(staffWorkspaceSource, /view=kds/);

  // 3. Uses staffApi for catalog, tables, and POST /api/orders only
  assert.match(staffWorkspaceSource, /\/api\/catalog\?/);
  assert.match(staffWorkspaceSource, /\/api\/tables\?/);
  assert.match(staffWorkspaceSource, /api\(['"]\/api\/orders['"]/);

  // 4. Never exposes payment collection, discounts, custom prices, or fulfillment transitions
  assert.doesNotMatch(staffWorkspaceSource, /payment\.collect/);
  assert.doesNotMatch(staffWorkspaceSource, /discount\.apply/);
  assert.doesNotMatch(staffWorkspaceSource, /orders\.fulfill/);
  assert.doesNotMatch(staffWorkspaceSource, /settle_table_bill/);
  assert.doesNotMatch(staffWorkspaceSource, /markCompletedImmediately/);
});

test('StaffWorkspace context loading: maps full catalog options_json and active tables while defensively ignoring cross-shop rows', async () => {
  const { loadStaffWorkspaceContext } =
    loadMobileTsxExports<StaffWorkspaceModuleExports>(
      'src/components/staff/StaffWorkspace.tsx'
    );

  const storage = createInMemoryStaffSessionStorage();
  const staffSession = makeStaffSessionFixture({
    accessToken: 'staff-token-fixed-shop-1',
    activeShopId: 'shop-pho-1',
  });
  await loginStaff({
    shopIdentifier: 'pho-hoi-an',
    username: 'phuc_vu_ban_01',
    password: 'SecretPassword123',
    storage,
    fetchRequest: async () =>
      Response.json(
        {
          user: staffSession.user,
          shops: [],
          memberShops: [staffSession.shop],
          memberships: [staffSession.membership],
          activeShopId: staffSession.activeShopId,
          accessToken: staffSession.accessToken,
        },
        { status: 200 }
      ),
  });

  const capturedApiCalls: Array<{ url: string; auth: string | null }> = [];
  const api = createStaffApiClient({
    baseUrl: 'http://dev:3000',
    storage,
    fetchRequest: async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      capturedApiCalls.push({
        url,
        auth: headers.get('authorization'),
      });

      if (url === 'http://dev:3000/api/catalog?shopId=shop-pho-1') {
        return Response.json(
          {
            shop: { id: 'shop-pho-1', name: 'Phở Hội An Chính Gốc' },
            categories: [
              {
                id: 'cat-pho',
                shop_id: 'shop-pho-1',
                name_i18n: { vi: 'Phở truyền thống', en: 'Traditional Pho' },
                sort_order: 1,
                is_active: true,
              },
              {
                id: 'cat-foreign',
                shop_id: 'shop-other-2',
                name_i18n: { vi: 'Danh mục quán khác' },
                sort_order: 2,
                is_active: true,
              },
            ],
            items: [
              {
                id: 'item-pho-tai',
                shop_id: 'shop-pho-1',
                category_id: 'cat-pho',
                price: 55000,
                is_available: true,
                stock_quantity: 12,
                name_i18n: { vi: 'Phở tái nạm', en: 'Rare & Flank Beef Pho' },
                options_json: [
                  {
                    id: 'grp-size',
                    name_i18n: { vi: 'Cỡ tô', en: 'Bowl Size' },
                    required: true,
                    choices: [
                      {
                        id: 'size-regular',
                        label_i18n: { vi: 'Tô thường', en: 'Regular' },
                        extra_price: 0,
                      },
                      {
                        id: 'size-special',
                        label_i18n: { vi: 'Tô đặc biệt', en: 'Special' },
                        extra_price: 15000,
                      },
                    ],
                  },
                ],
              },
              {
                id: 'item-foreign',
                shop_id: 'shop-other-2',
                category_id: 'cat-foreign',
                price: 99000,
                is_available: true,
                name_i18n: { vi: 'Món quán khác' },
              },
            ],
          },
          { status: 200 }
        );
      }

      if (url === 'http://dev:3000/api/tables?shopId=shop-pho-1') {
        return Response.json(
          {
            tables: [
              {
                id: 'tbl-a1',
                shop_id: 'shop-pho-1',
                name: 'Bàn A1',
                table_code: 'A1',
                section: 'Tầng 1',
                capacity: 4,
                sort_order: 1,
                is_active: true,
                is_archived: false,
              },
              {
                id: 'tbl-inactive',
                shop_id: 'shop-pho-1',
                name: 'Bàn Tạm Ngưng',
                table_code: 'A2',
                sort_order: 2,
                is_active: false,
                is_archived: false,
              },
              {
                id: 'tbl-archived',
                shop_id: 'shop-pho-1',
                name: 'Bàn Lưu Trữ',
                table_code: 'A3',
                sort_order: 3,
                is_active: true,
                is_archived: true,
              },
              {
                id: 'tbl-foreign',
                shop_id: 'shop-other-2',
                name: 'Bàn Quán Khác',
                table_code: 'X1',
                sort_order: 0,
                is_active: true,
                is_archived: false,
              },
            ],
          },
          { status: 200 }
        );
      }

      return new Response('Not Found', { status: 404 });
    },
  });

  const ctx = await loadStaffWorkspaceContext({
    shopId: 'shop-pho-1',
    api,
  });

  assert.equal(capturedApiCalls.length, 2);
  for (const call of capturedApiCalls) {
    assert.equal(call.auth, 'Bearer staff-token-fixed-shop-1');
  }

  assert.equal(ctx.shopName, 'Phở Hội An Chính Gốc');
  assert.equal(ctx.categories.length, 1);
  assert.equal(ctx.categories[0].id, 'cat-pho');

  assert.equal(ctx.items.length, 1);
  assert.equal(ctx.items[0].id, 'item-pho-tai');
  assert.equal(ctx.items[0].options_json?.length, 1);
  assert.equal(ctx.items[0].options_json?.[0].id, 'grp-size');
  assert.equal(ctx.items[0].options_json?.[0].required, true);
  assert.equal(ctx.items[0].options_json?.[0].choices.length, 2);
  assert.equal(ctx.items[0].options_json?.[0].choices[1].extra_price, 15000);

  // Only active, non-archived table from shop-pho-1 is returned with canonical ID/code/name
  assert.equal(ctx.tables.length, 1);
  assert.deepEqual(ctx.tables[0], {
    id: 'tbl-a1',
    shop_id: 'shop-pho-1',
    name: 'Bàn A1',
    table_code: 'A1',
    section: 'Tầng 1',
    capacity: 4,
    sort_order: 1,
    is_active: true,
    is_archived: false,
  });
});

test('End-to-end staff order submission: sends Bearer token + counter_pos payload, accepts 201, preserves cart & idempotency key on error for retry, and enforces unpaid invariant', async () => {
  const { submitStaffAssistedOrder } =
    loadMobileTsxExports<StaffWorkspaceModuleExports>(
      'src/components/staff/StaffWorkspace.tsx'
    );

  const storage = createInMemoryStaffSessionStorage();
  const staffSession = makeStaffSessionFixture({
    accessToken: 'staff-token-order-create-only',
    activeShopId: 'shop-pho-1',
    permissions: ['orders.create'], // No orders.view needed!
  });

  await loginStaff({
    shopIdentifier: 'pho-hoi-an',
    username: 'phuc_vu_ban_01',
    password: 'SecretPassword123',
    storage,
    fetchRequest: async () =>
      Response.json(
        {
          user: staffSession.user,
          shops: [],
          memberShops: [staffSession.shop],
          memberships: [staffSession.membership],
          activeShopId: staffSession.activeShopId,
          accessToken: staffSession.accessToken,
        },
        { status: 200 }
      ),
  });

  const activeTable: StaffTable = {
    id: 'tbl-a1',
    shop_id: 'shop-pho-1',
    name: 'Bàn A1',
    table_code: 'A1',
    is_active: true,
    is_archived: false,
  };

  const phoItem: StaffCatalogItem = {
    id: 'item-pho-tai',
    shop_id: 'shop-pho-1',
    category_id: 'cat-pho',
    price: 55000,
    is_available: true,
    name_i18n: { vi: 'Phở tái nạm', en: 'Rare & Flank Beef Pho' },
    options_json: [
      {
        id: 'grp-size',
        name_i18n: { vi: 'Cỡ tô', en: 'Bowl Size' },
        required: true,
        choices: [
          {
            id: 'size-special',
            label_i18n: { vi: 'Tô đặc biệt', en: 'Special' },
            extra_price: 15000,
          },
        ],
      },
    ],
  };

  let cart: StaffCartLine[] = [
    createCartLine(
      phoItem,
      2,
      [
        {
          id: 'size-special',
          label_i18n: { vi: 'Tô đặc biệt', en: 'Special' },
          extra_price: 15000,
        },
      ],
      'Ít hành, nước trong'
    ),
  ];
  let currentIdempotencyKey = generateAssistedOrderIdempotencyKey('shop-pho-1');
  const initialIdempotencyKey = currentIdempotencyKey;

  let shouldFailNetwork = true;
  const submittedPostBodies: Array<{
    auth: string | null;
    body: Record<string, unknown>;
  }> = [];

  const api = createStaffApiClient({
    baseUrl: 'http://dev:3000',
    storage,
    fetchRequest: async (input, init) => {
      const url = String(input);
      assert.equal(url, 'http://dev:3000/api/orders');
      assert.equal(init?.method, 'POST');
      const headers = new Headers(init?.headers);
      const parsedBody = JSON.parse(String(init?.body || '{}')) as Record<
        string,
        unknown
      >;
      submittedPostBodies.push({
        auth: headers.get('authorization'),
        body: parsedBody,
      });

      if (shouldFailNetwork) {
        throw new Error('Network connection lost');
      }

      return Response.json(
        {
          order: {
            id: 'ord-created-201',
            order_code: 'POS-8821',
            shop_id: 'shop-pho-1',
            source: 'counter_pos',
            table_id: 'tbl-a1',
            table_label: 'Bàn A1',
            status: 'new',
            payment_status: 'unpaid',
            total_amount: 140000,
          },
        },
        { status: 201 }
      );
    },
  });

  // Attempt 1: Network failure -> cart AND idempotencyKey are retained for retry
  const payloadAttempt1 = buildAssistedOrderPayload({
    shopId: 'shop-pho-1',
    table: createTableSelection(activeTable),
    cart,
    idempotencyKey: currentIdempotencyKey,
    visitorLang: 'vi',
  });

  await assert.rejects(
    async () => {
      await submitStaffAssistedOrder({
        payload: payloadAttempt1,
        expectedShopId: 'shop-pho-1',
        api,
      });
      // Only reached on 201 success
      cart = [];
      currentIdempotencyKey = generateAssistedOrderIdempotencyKey('shop-pho-1');
    },
    /Network connection lost/
  );

  // Cart & idempotency key are still intact after network failure!
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 2);
  assert.equal(currentIdempotencyKey, initialIdempotencyKey);
  assert.ok(await loadStaffSession(storage), 'staff session remains stored after network error');

  // Attempt 2: Retry with the exact same cart and idempotency key -> succeeds with HTTP 201
  shouldFailNetwork = false;
  const payloadAttempt2 = buildAssistedOrderPayload({
    shopId: 'shop-pho-1',
    table: createTableSelection(activeTable),
    cart,
    idempotencyKey: currentIdempotencyKey,
    visitorLang: 'vi',
  });

  const confirmed = await submitStaffAssistedOrder({
    payload: payloadAttempt2,
    expectedShopId: 'shop-pho-1',
    api,
  });
  cart = [];
  currentIdempotencyKey = generateAssistedOrderIdempotencyKey('shop-pho-1');

  assert.equal(submittedPostBodies.length, 2);
  // Both attempts used the exact same idempotency_key and staff Bearer token
  assert.equal(
    submittedPostBodies[0].auth,
    'Bearer staff-token-order-create-only'
  );
  assert.equal(
    submittedPostBodies[1].auth,
    'Bearer staff-token-order-create-only'
  );
  assert.equal(
    submittedPostBodies[0].body.idempotency_key,
    initialIdempotencyKey
  );
  assert.equal(
    submittedPostBodies[1].body.idempotency_key,
    initialIdempotencyKey
  );

  // Verify exact POST /api/orders payload contract
  const finalBody = submittedPostBodies[1].body;
  assert.equal(finalBody.shop_id, 'shop-pho-1');
  assert.equal(finalBody.source, 'counter_pos');
  assert.equal(finalBody.table_id, 'tbl-a1');
  assert.equal(finalBody.table_label, 'Bàn A1');
  assert.equal(finalBody.visitor_lang, 'vi');
  assert.equal(finalBody.payment_status, undefined);
  assert.equal(finalBody.discount_amount, undefined);
  assert.equal(finalBody.status, undefined);

  const postedLines = finalBody.items as Array<Record<string, unknown>>;
  assert.equal(postedLines.length, 1);
  assert.equal(postedLines[0].item_id, 'item-pho-tai');
  assert.equal(postedLines[0].quantity, 2);
  assert.equal(postedLines[0].custom_note, 'Ít hành, nước trong');
  assert.deepEqual(postedLines[0].selected_choices, [
    {
      id: 'size-special',
      label_i18n: { vi: 'Tô đặc biệt', en: 'Special' },
      extra_price: 15000,
    },
  ]);

  // Verify confirmed order summary and unpaid invariant
  assert.deepEqual(confirmed, {
    orderId: 'ord-created-201',
    orderCode: 'POS-8821',
    tableId: 'tbl-a1',
    tableLabel: 'Bàn A1',
    totalAmount: 140000,
    status: 'new',
    paymentStatus: 'unpaid',
  });
  assert.equal(cart.length, 0);
  assert.notEqual(currentIdempotencyKey, initialIdempotencyKey);

  // Verify unpaid invariant enforcement if server ever returned paid
  const paidApi = createStaffApiClient({
    baseUrl: 'http://dev:3000',
    storage,
    fetchRequest: async () =>
      Response.json(
        {
          order: {
            id: 'ord-invalid-paid',
            shop_id: 'shop-pho-1',
            payment_status: 'paid',
          },
        },
        { status: 201 }
      ),
  });

  await assert.rejects(
    () =>
      submitStaffAssistedOrder({
        payload: payloadAttempt2,
        expectedShopId: 'shop-pho-1',
        api: paidApi,
      }),
    /unpaid/i
  );

  // Verify rejection of non-201 status and missing order.id
  const non201Api = createStaffApiClient({
    baseUrl: 'http://dev:3000',
    storage,
    fetchRequest: async () =>
      Response.json(
        { order: { id: 'ord-200', shop_id: 'shop-pho-1', payment_status: 'unpaid' } },
        { status: 200 }
      ),
  });
  await assert.rejects(
    () =>
      submitStaffAssistedOrder({
        payload: payloadAttempt2,
        expectedShopId: 'shop-pho-1',
        api: non201Api,
      }),
    /HTTP 200/
  );

  const missingIdApi = createStaffApiClient({
    baseUrl: 'http://dev:3000',
    storage,
    fetchRequest: async () =>
      Response.json({ order: { shop_id: 'shop-pho-1' } }, { status: 201 }),
  });
  await assert.rejects(
    () =>
      submitStaffAssistedOrder({
        payload: payloadAttempt2,
        expectedShopId: 'shop-pho-1',
        api: missingIdApi,
      }),
    /order\.id/
  );

  // Verify 403 STAFF_SESSION_REVOKED clears stored staff session and signals sessionCleared = true
  const revokedApi = createStaffApiClient({
    baseUrl: 'http://dev:3000',
    storage,
    fetchRequest: async () =>
      Response.json(
        {
          error: 'Phiên đăng nhập nhân viên đã hết hạn hoặc bị thu hồi.',
          code: STAFF_SESSION_REVOKED_CODE,
        },
        { status: 403 }
      ),
  });

  await assert.rejects(
    () =>
      submitStaffAssistedOrder({
        payload: payloadAttempt2,
        expectedShopId: 'shop-pho-1',
        api: revokedApi,
      }),
    (err: unknown) => {
      assert.ok(err instanceof StaffApiError);
      assert.equal(err.status, 403);
      assert.equal(err.code, STAFF_SESSION_REVOKED_CODE);
      assert.equal(err.sessionCleared, true);
      return true;
    }
  );
  assert.equal(await loadStaffSession(storage), null);
});
