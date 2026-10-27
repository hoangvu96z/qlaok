import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { createApiClient } from '../src/lib/api-client.ts';
import {
  clearOwnerSession,
  completeMobileOwnerRegistrationVerification,
  completeOwnerOidcCallback,
  computeMobileS256CodeChallenge,
  createExpoSecureStoreAdapter,
  createMobilePkcePair,
  DEFAULT_MOBILE_OIDC_REDIRECT_URI,
  DEFAULT_ZITADEL_ISSUER_URL,
  type ExpoCryptoLike,
  generateMobileRandomUrlSafe,
  generateRandomBytes,
  getOwnerAccessToken,
  getOwnerPostgrestToken,
  isOwnerOidcCallbackUrl,
  loadOwnerSession,
  MobileOwnerOidcError,
  OWNER_OIDC_TX_STORAGE_KEY,
  OWNER_OIDC_TX_TTL_MS,
  OWNER_SESSION_STORAGE_KEY,
  type OwnerSessionStorageAdapter,
  parseOwnerOidcCallbackUrl,
  prepareOwnerOidcAuthorizationRequest,
  requireOwnerPostgrestToken,
  resendMobileOwnerRegistrationCode,
  resetOwnerSessionMemoryForTest,
  resolveMobileZitadelOidcConfig,
  revalidateOwnerSession,
  saveOwnerSession,
  startMobileOwnerRegistration,
  startOwnerOidcLogin,
  validateOwnerSession,
  validatePostgrestTokenClaims,
} from '../src/lib/owner-session.ts';
import { buildOrderEventsSseHeaders } from '../src/lib/realtime-orders.ts';
import {
  clearStaffSession,
  loadStaffSession,
  saveStaffSession,
  STAFF_SESSION_STORAGE_KEY,
} from '../src/lib/staff-session.ts';

function createMemoryStorage(): OwnerSessionStorageAdapter & {
  dump(): Record<string, string>;
} {
  const map = new Map<string, string>();
  return {
    async getItem(key: string) {
      return map.get(key) ?? null;
    },
    async setItem(key: string, value: string) {
      map.set(key, value);
    },
    async removeItem(key: string) {
      map.delete(key);
    },
    dump() {
      return Object.fromEntries(map.entries());
    },
  };
}

function buildMockPostgrestJwt(payload: Record<string, unknown>): string {
  const headerB64 = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
    'utf8'
  ).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url'
  );
  const sigB64 = crypto
    .createHmac('sha256', 'test-postgrest-secret-at-least-32-chars!!')
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');
  return `${headerB64}.${payloadB64}.${sigB64}`;
}

test('PKCE S256 challenge matches RFC 7636 test vector and Node crypto SHA-256', () => {
  // RFC 7636 Appendix B test vector
  const rfcVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const rfcExpectedChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
  assert.equal(
    computeMobileS256CodeChallenge(rfcVerifier),
    rfcExpectedChallenge
  );

  const generated = createMobilePkcePair();
  assert.equal(generated.codeChallengeMethod, 'S256');
  assert.match(generated.codeVerifier, /^[A-Za-z0-9\-._~]{43,128}$/);
  const expectedNodeChallenge = crypto
    .createHash('sha256')
    .update(generated.codeVerifier, 'ascii')
    .digest('base64url');
  assert.equal(generated.codeChallenge, expectedNodeChallenge);

  assert.throws(
    () => computeMobileS256CodeChallenge('too-short'),
    (err: unknown) =>
      err instanceof MobileOwnerOidcError &&
      err.code === 'OIDC_PKCE_VERIFIER_INVALID'
  );
});

test('resolveMobileZitadelOidcConfig fails closed when EXPO_PUBLIC_ZITADEL_CLIENT_ID is absent or placeholder', () => {
  const missing = resolveMobileZitadelOidcConfig({});
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.code, 'OIDC_CLIENT_ID_MISSING');
  }

  const placeholder = resolveMobileZitadelOidcConfig({
    EXPO_PUBLIC_ZITADEL_CLIENT_ID: 'your-zitadel-mobile-client-id',
  });
  assert.equal(placeholder.ok, false);
  if (!placeholder.ok) {
    assert.equal(placeholder.code, 'OIDC_CLIENT_ID_MISSING');
  }

  const wrongRedirect = resolveMobileZitadelOidcConfig({
    EXPO_PUBLIC_ZITADEL_CLIENT_ID: '312345678901234567@qlaok',
    EXPO_PUBLIC_ZITADEL_REDIRECT_URI: 'https://evil.example.com/callback',
  });
  assert.equal(wrongRedirect.ok, false);
  if (!wrongRedirect.ok) {
    assert.equal(wrongRedirect.code, 'OIDC_REDIRECT_URI_INVALID');
  }

  const insecureIssuer = resolveMobileZitadelOidcConfig({
    EXPO_PUBLIC_ZITADEL_CLIENT_ID: '312345678901234567@qlaok',
    EXPO_PUBLIC_ZITADEL_ISSUER_URL: 'http://auth.vunph.click',
  });
  assert.equal(insecureIssuer.ok, false);
  if (!insecureIssuer.ok) {
    assert.equal(insecureIssuer.code, 'OIDC_ISSUER_INVALID');
  }

  const valid = resolveMobileZitadelOidcConfig({
    EXPO_PUBLIC_ZITADEL_CLIENT_ID: '312345678901234567@qlaok',
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.config.issuerUrl, DEFAULT_ZITADEL_ISSUER_URL);
    assert.equal(valid.config.redirectUri, DEFAULT_MOBILE_OIDC_REDIRECT_URI);
    assert.equal(valid.config.clientId, '312345678901234567@qlaok');
  }
});

test('startOwnerOidcLogin builds Authorization Code + PKCE URL with exact qlaok://auth/callback redirect and opens system browser', async () => {
  const storage = createMemoryStorage();
  const openedUrls: string[] = [];

  await assert.rejects(
    () =>
      startOwnerOidcLogin({
        env: {},
        storage,
        openUrl: async (url) => {
          openedUrls.push(url);
        },
      }),
    (err: unknown) =>
      err instanceof MobileOwnerOidcError &&
      err.code === 'OIDC_CLIENT_ID_MISSING'
  );
  assert.equal(openedUrls.length, 0);

  const result = await startOwnerOidcLogin({
    mode: 'login',
    loginHint: 'chuquan@qlaok.vn',
    lang: 'vi',
    env: {
      EXPO_PUBLIC_ZITADEL_CLIENT_ID: '312345678901234567@qlaok',
      EXPO_PUBLIC_ZITADEL_ISSUER_URL: 'https://auth.vunph.click',
    },
    storage,
    openUrl: async (url) => {
      openedUrls.push(url);
    },
  });

  assert.equal(openedUrls.length, 1);
  assert.equal(openedUrls[0], result.authorizeUrl);

  const parsedUrl = new URL(result.authorizeUrl);
  assert.equal(parsedUrl.origin, 'https://auth.vunph.click');
  assert.equal(parsedUrl.pathname, '/oauth/v2/authorize');
  assert.equal(
    parsedUrl.searchParams.get('client_id'),
    '312345678901234567@qlaok'
  );
  assert.equal(
    parsedUrl.searchParams.get('redirect_uri'),
    'qlaok://auth/callback'
  );
  assert.equal(parsedUrl.searchParams.get('response_type'), 'code');
  assert.equal(parsedUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(parsedUrl.searchParams.get('state'), result.transaction.state);
  assert.equal(parsedUrl.searchParams.get('nonce'), result.transaction.nonce);
  assert.equal(parsedUrl.searchParams.get('prompt'), 'login');
  assert.equal(parsedUrl.searchParams.get('login_hint'), 'chuquan@qlaok.vn');
  assert.equal(parsedUrl.searchParams.get('ui_locales'), 'vi');
  assert.equal(
    parsedUrl.searchParams.get('code_challenge'),
    computeMobileS256CodeChallenge(result.transaction.codeVerifier)
  );
});

test('parseOwnerOidcCallbackUrl rejects tokens in query or fragment and enforces qlaok://auth/callback', () => {
  assert.equal(
    isOwnerOidcCallbackUrl('qlaok://auth/callback?code=abc&state=xyz'),
    true
  );
  assert.equal(
    isOwnerOidcCallbackUrl('https://qlaok.vunph.click/api/auth/callback'),
    false
  );

  for (const forbiddenUrl of [
    'qlaok://auth/callback?code=abc&state=xyz&access_token=secret',
    'qlaok://auth/callback?code=abc&state=xyz&id_token=secret',
    'qlaok://auth/callback?code=abc&state=xyz&refresh_token=secret',
    'qlaok://auth/callback#access_token=secret&state=xyz',
  ]) {
    assert.throws(
      () => parseOwnerOidcCallbackUrl(forbiddenUrl),
      (err: unknown) =>
        err instanceof MobileOwnerOidcError &&
        err.code === 'OIDC_IMPLICIT_TOKEN_FORBIDDEN'
    );
  }

  assert.throws(
    () => parseOwnerOidcCallbackUrl('qlaok://auth/callback?code=only-code'),
    (err: unknown) =>
      err instanceof MobileOwnerOidcError &&
      err.code === 'OIDC_CALLBACK_MISSING_PARAMS'
  );
});

test('completeOwnerOidcCallback validates single-use state/nonce/PKCE, exchanges code via /api/auth, and persists owner session', async () => {
  const storage = createMemoryStorage();
  const nowMs = 1_760_000_000_000;
  const nowSec = Math.floor(nowMs / 1000);
  const ownerUuid = 'a3a30894-e8ae-415d-a3dc-7947b0399dd1';

  const prepared = await prepareOwnerOidcAuthorizationRequest({
    env: {
      EXPO_PUBLIC_ZITADEL_CLIENT_ID: '312345678901234567@qlaok',
    },
    storage,
    nowMs,
  });

  // 1. State mismatch clears pending transaction and fails closed
  await assert.rejects(
    () =>
      completeOwnerOidcCallback(
        'qlaok://auth/callback?code=auth-code-1&state=wrong-state',
        {
          baseUrl: 'https://qlaok.vunph.click',
          storage,
          nowMs: nowMs + 1000,
          fetchImpl: async () => {
            throw new Error('Must not call server when state mismatches');
          },
        }
      ),
    (err: unknown) =>
      err instanceof MobileOwnerOidcError && err.code === 'OIDC_STATE_MISMATCH'
  );
  assert.equal(await storage.getItem(OWNER_OIDC_TX_STORAGE_KEY), null);

  // 2. Re-prepare and complete valid callback
  const prepared2 = await prepareOwnerOidcAuthorizationRequest({
    env: {
      EXPO_PUBLIC_ZITADEL_CLIENT_ID: '312345678901234567@qlaok',
    },
    storage,
    nowMs,
  });

  const postgrestJwt = buildMockPostgrestJwt({
    sub: ownerUuid,
    role: 'authenticated',
    aud: 'authenticated',
    iss: 'qlaok-postgrest',
    exp: nowSec + 3600,
    iat: nowSec,
  });

  let capturedRequestBody: Record<string, unknown> = {};
  const session = await completeOwnerOidcCallback(
    `qlaok://auth/callback?code=valid-auth-code-123&state=${encodeURIComponent(
      prepared2.transaction.state
    )}`,
    {
      baseUrl: 'https://qlaok.vunph.click',
      storage,
      nowMs: nowMs + 5000,
      fetchImpl: async (input, init) => {
        assert.equal(String(input), 'https://qlaok.vunph.click/api/auth');
        assert.equal(init?.method, 'POST');
        capturedRequestBody = JSON.parse(
          String(init?.body || '{}')
        ) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            user: {
              id: ownerUuid,
              email: 'owner@qlaok.vn',
              full_name: 'Chủ Quán Hội An',
              plan: 'pro',
              role: 'owner',
              is_admin: false,
            },
            isAdmin: false,
            accessToken: 'qlaok-owner-hmac-payload.signature',
            expiresAt: nowSec + 86400,
            postgrestToken: postgrestJwt,
            postgrestExpiresAt: nowSec + 3600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      },
    }
  );

  assert.equal(capturedRequestBody.action, 'oidc_mobile_exchange');
  assert.equal(capturedRequestBody.code, 'valid-auth-code-123');
  assert.equal(
    capturedRequestBody.codeVerifier,
    prepared2.transaction.codeVerifier
  );
  assert.equal(capturedRequestBody.nonce, prepared2.transaction.nonce);
  assert.equal(capturedRequestBody.redirectUri, 'qlaok://auth/callback');
  assert.equal(capturedRequestBody.clientId, '312345678901234567@qlaok');

  assert.equal(session.user.id, ownerUuid);
  assert.equal(session.user.plan, 'pro');
  assert.equal(session.accessToken, 'qlaok-owner-hmac-payload.signature');
  assert.equal(session.postgrestToken, postgrestJwt);

  const loaded = await loadOwnerSession(storage, nowSec + 10);
  assert.ok(loaded);
  assert.equal(loaded.user.id, ownerUuid);
  assert.equal(
    await getOwnerAccessToken(storage, nowSec + 10),
    'qlaok-owner-hmac-payload.signature'
  );
  assert.equal(
    await getOwnerPostgrestToken(storage, nowSec + 10),
    postgrestJwt
  );

  // Replay of same callback URL fails closed because pending tx was consumed
  await assert.rejects(
    () =>
      completeOwnerOidcCallback(
        `qlaok://auth/callback?code=valid-auth-code-123&state=${encodeURIComponent(
          prepared2.transaction.state
        )}`,
        {
          baseUrl: 'https://qlaok.vunph.click',
          storage,
          nowMs: nowMs + 6000,
        }
      ),
    (err: unknown) =>
      err instanceof MobileOwnerOidcError &&
      err.code === 'OIDC_TRANSACTION_MISSING'
  );
});

test('revalidateOwnerSession retains valid owner session on transient 5xx/network errors and clears only on 401', async () => {
  const storage = createMemoryStorage();
  const nowSec = 1_760_000_000;
  const ownerUuid = '7d21f8ae-6b7c-414b-ba28-3f932ab062f7';

  await saveOwnerSession(
    {
      accessToken: 'owner-token-v1.sig',
      expiresAt: nowSec + 7200,
      user: {
        id: ownerUuid,
        email: 'owner2@qlaok.vn',
        full_name: 'Owner 2',
        plan: 'free',
        role: 'owner',
      },
      isAdmin: false,
    },
    { storage, nowSec }
  );

  // 1. Network failure must NOT clear session
  const netRes = await revalidateOwnerSession({
    baseUrl: 'https://qlaok.vunph.click',
    storage,
    nowSec: nowSec + 60,
    fetchImpl: async () => {
      throw new Error('ECONNRESET');
    },
  });
  assert.equal(netRes.status, 'transient_error');
  assert.ok(netRes.session);
  assert.ok(await loadOwnerSession(storage, nowSec + 60));

  // 2. HTTP 502 Bad Gateway must NOT clear session
  const fiveXxRes = await revalidateOwnerSession({
    baseUrl: 'https://qlaok.vunph.click',
    storage,
    nowSec: nowSec + 120,
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: 'Bad Gateway' }), { status: 502 }),
  });
  assert.equal(fiveXxRes.status, 'transient_error');
  assert.ok(fiveXxRes.session);
  assert.ok(await loadOwnerSession(storage, nowSec + 120));

  // 3. HTTP 401 Unauthorized clears owner session
  const unauthRes = await revalidateOwnerSession({
    baseUrl: 'https://qlaok.vunph.click',
    storage,
    nowSec: nowSec + 180,
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: 'Expired' }), { status: 401 }),
  });
  assert.equal(unauthRes.status, 'expired');
  assert.equal(unauthRes.session, null);
  assert.equal(await loadOwnerSession(storage, nowSec + 180), null);
});

test('PostgREST token validation fails closed when absent, expired, or non-authenticated role', async () => {
  const storage = createMemoryStorage();
  const nowSec = 1_760_000_000;
  const ownerUuid = '0a40219c-49d0-4391-a2df-c7a5f58237a5';

  // Reject service_role or anon tokens even if 3-part JWT
  const serviceRoleJwt = buildMockPostgrestJwt({
    sub: ownerUuid,
    role: 'service_role',
    exp: nowSec + 3600,
  });
  assert.equal(
    validatePostgrestTokenClaims(serviceRoleJwt, ownerUuid, nowSec),
    null
  );

  const anonRoleJwt = buildMockPostgrestJwt({
    sub: ownerUuid,
    role: 'anon',
    exp: nowSec + 3600,
  });
  assert.equal(
    validatePostgrestTokenClaims(anonRoleJwt, ownerUuid, nowSec),
    null
  );

  await saveOwnerSession(
    {
      accessToken: 'owner-token-only.sig',
      expiresAt: nowSec + 7200,
      postgrestToken: null,
      user: {
        id: ownerUuid,
        email: 'owner3@qlaok.vn',
        full_name: 'Owner 3',
        plan: 'free',
        role: 'owner',
      },
      isAdmin: false,
    },
    { storage, nowSec }
  );

  await assert.rejects(
    () => requireOwnerPostgrestToken(storage, nowSec + 10),
    (err: unknown) =>
      err instanceof MobileOwnerOidcError &&
      err.code === 'POSTGREST_AUTH_TOKEN_UNAVAILABLE'
  );
});

test('Owner session and Staff session remain strictly isolated in storage, validation, API client, and SSE headers', async () => {
  const storage = createMemoryStorage();
  const nowSec = Math.floor(Date.now() / 1000);
  const ownerUuid = '46767a29-2691-4d40-8da9-b48c6fa1da1a';

  // Staff payload must NEVER validate as an owner session
  assert.equal(
    validateOwnerSession(
      {
        accessToken: 'staff-token.sig',
        expiresAt: nowSec + 3600,
        user: {
          id: 'staff-acct-shop1-cashier01',
          email: 'staff@qlaok.local',
          full_name: 'Thu Ngân 01',
          role: 'cashier',
          account_type: 'staff',
          shop_id: 'shop-fnb-001',
        },
      },
      nowSec
    ),
    null
  );

  await saveOwnerSession(
    {
      accessToken: 'owner-bearer-token.sig',
      expiresAt: nowSec + 7200,
      user: {
        id: ownerUuid,
        email: 'owner4@qlaok.vn',
        full_name: 'Owner 4',
        plan: 'premium',
        role: 'owner',
      },
      isAdmin: false,
    },
    { storage, nowSec }
  );

  await saveStaffSession(
    {
      accessToken: 'staff-bearer-token.sig',
      activeShopId: 'shop-fnb-001',
      user: {
        id: 'staff-acct-shop-fnb-001-pv01',
        username: 'pv01',
        full_name: 'Phục Vụ 01',
        role: 'staff',
        account_type: 'staff',
        shop_id: 'shop-fnb-001',
      },
      shop: {
        id: 'shop-fnb-001',
        owner_id: ownerUuid,
        slug: 'pho-hoi-an',
        name: 'Phở Hội An',
        vertical: 'fnb',
        city: 'Đà Nẵng',
        supported_langs: ['vi', 'en'],
        is_published: true,
      },
      membership: {
        id: 'mem-001',
        shop_id: 'shop-fnb-001',
        user_id: 'staff-acct-shop-fnb-001-pv01',
        role: 'staff',
        permissions: ['orders.view', 'orders.create'],
        is_active: true,
      },
    },
    storage
  );

  const dumpBefore = storage.dump();
  assert.ok(dumpBefore[OWNER_SESSION_STORAGE_KEY]);
  assert.ok(dumpBefore[STAFF_SESSION_STORAGE_KEY]);

  // SSE headers use owner token
  const ownerToken = await getOwnerAccessToken(storage, nowSec);
  const sseHeaders = buildOrderEventsSseHeaders(ownerToken!);
  assert.equal(sseHeaders.Authorization, 'Bearer owner-bearer-token.sig');

  // Owner API client attaches owner token
  const ownerClient = createApiClient(
    'https://qlaok.vunph.click',
    () => getOwnerAccessToken(storage, nowSec),
    async (_url, init) => {
      const headers = new Headers(init?.headers || {});
      assert.equal(
        headers.get('Authorization'),
        'Bearer owner-bearer-token.sig'
      );
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
  );
  await ownerClient('/api/shops?member=1');

  // Clearing owner session on owner logout leaves staff session intact
  await clearOwnerSession({ storage, reason: 'logout' });
  assert.equal(await loadOwnerSession(storage, nowSec), null);
  const staffStillPresent = await loadStaffSession(storage);
  assert.ok(staffStillPresent);
  assert.equal(staffStillPresent.accessToken, 'staff-bearer-token.sig');

  await clearStaffSession(storage);
});

test('owner createExpoSecureStoreAdapter persists, loads, and clears native owner session with SecureStore and rejects web platform', async () => {
  const rawStore = new Map<string, string>();
  const calls: string[] = [];

  const mockExpoSecureStore = {
    getItemAsync: async (key: string) => {
      calls.push(`get:${key}`);
      return rawStore.get(key) ?? null;
    },
    setItemAsync: async (key: string, value: string) => {
      calls.push(`set:${key}`);
      rawStore.set(key, value);
    },
    deleteItemAsync: async (key: string) => {
      calls.push(`delete:${key}`);
      rawStore.delete(key);
    },
  };

  // Web platform does not use native SecureStore
  assert.equal(createExpoSecureStoreAdapter(mockExpoSecureStore, 'web'), null);
  assert.equal(createExpoSecureStoreAdapter(null, 'ios'), null);
  assert.equal(
    createExpoSecureStoreAdapter(
      { getItemAsync: mockExpoSecureStore.getItemAsync },
      'ios'
    ),
    null
  );

  // Native iOS uses SecureStore
  const nativeAdapter = createExpoSecureStoreAdapter(
    mockExpoSecureStore,
    'ios'
  );
  assert.ok(nativeAdapter);

  const nowSec = Math.floor(Date.now() / 1000);
  const validOwnerSession = {
    accessToken: 'owner-native-token.sig',
    expiresAt: nowSec + 3600,
    postgrestToken: null,
    postgrestExpiresAt: null,
    user: {
      id: '11111111-2222-4333-8444-555555555555',
      email: 'owner-native@qlaok.vn',
      full_name: 'Native Owner',
      plan: 'pro' as const,
      role: 'owner' as const,
    },
    isAdmin: false,
  };

  await saveOwnerSession(validOwnerSession, { storage: nativeAdapter, nowSec });
  assert.equal(rawStore.has(OWNER_SESSION_STORAGE_KEY), true);

  const loaded = await loadOwnerSession(nativeAdapter, nowSec);
  assert.ok(loaded);
  assert.equal(loaded.accessToken, 'owner-native-token.sig');
  assert.equal(loaded.user.id, '11111111-2222-4333-8444-555555555555');

  await clearOwnerSession({ storage: nativeAdapter });
  assert.equal(rawStore.has(OWNER_SESSION_STORAGE_KEY), false);
  assert.equal(await loadOwnerSession(nativeAdapter, nowSec), null);

  assert.deepEqual(calls, [
    `set:${OWNER_SESSION_STORAGE_KEY}`,
    `get:${OWNER_SESSION_STORAGE_KEY}`,
    `delete:${OWNER_SESSION_STORAGE_KEY}`,
    `delete:${OWNER_OIDC_TX_STORAGE_KEY}`,
    `get:${OWNER_SESSION_STORAGE_KEY}`,
  ]);
});

test('loadOwnerSession and saveOwnerSession without explicit storage resolve default memory fallback without native module crashes', async () => {
  resetOwnerSessionMemoryForTest();
  const nowSec = Math.floor(Date.now() / 1000);

  // Initial load returns null from memory fallback without throwing native module invariants
  assert.equal(await loadOwnerSession(undefined, nowSec), null);

  const testSession = {
    accessToken: 'owner-default-token.sig',
    expiresAt: nowSec + 1800,
    postgrestToken: null,
    postgrestExpiresAt: null,
    user: {
      id: '22222222-3333-4444-8555-666666666666',
      email: 'owner-default@qlaok.vn',
      full_name: 'Default Storage Owner',
      plan: 'free' as const,
      role: 'owner' as const,
    },
    isAdmin: false,
  };

  await saveOwnerSession(testSession, { nowSec });
  const loaded = await loadOwnerSession(undefined, nowSec);
  assert.ok(loaded);
  assert.equal(loaded.accessToken, 'owner-default-token.sig');

  await clearOwnerSession();
  assert.equal(await loadOwnerSession(undefined, nowSec), null);

  resetOwnerSessionMemoryForTest();
});

test('PKCE CSPRNG provider selection prefers WebCrypto, falls back to Expo Crypto getRandomValues on native, and never uses Math.random', async () => {
  const storage = createMemoryStorage();
  const validEnv = {
    EXPO_PUBLIC_ZITADEL_CLIENT_ID: '312345678901234567@qlaok',
  };

  let mathRandomCalled = false;
  const originalMathRandom = Math.random;
  Math.random = () => {
    mathRandomCalled = true;
    return originalMathRandom();
  };

  try {
    // 1. When both WebCrypto and Expo Crypto are available, WebCrypto is preferred
    let webCryptoCalls = 0;
    let expoCryptoCalls = 0;
    const mockWebCrypto = {
      getRandomValues<T extends Uint8Array>(arr: T): T {
        webCryptoCalls += 1;
        for (let i = 0; i < arr.length; i += 1) {
          arr[i] = (i + 17) & 0xff;
        }
        return arr;
      },
    };
    const mockExpoCrypto = {
      getRandomValues<T extends Uint8Array>(arr: T): T {
        expoCryptoCalls += 1;
        crypto.randomFillSync(arr);
        return arr;
      },
      getRandomBytes(_count: number): Uint8Array {
        throw new Error('getRandomBytes should not be called when getRandomValues exists');
      },
    };

    const webBytes = generateRandomBytes(32, {
      webCrypto: mockWebCrypto,
      expoCrypto: mockExpoCrypto,
    });
    assert.equal(webBytes.byteLength, 32);
    assert.equal(webBytes[0], 17);
    assert.equal(webCryptoCalls, 1);
    assert.equal(expoCryptoCalls, 0);

    // 2. When WebCrypto is unavailable (e.g. Hermes in Expo Go), Expo Crypto getRandomValues is used
    const nativeBytes = generateRandomBytes(32, {
      webCrypto: null,
      expoCrypto: mockExpoCrypto,
    });
    assert.equal(nativeBytes.byteLength, 32);
    assert.equal(expoCryptoCalls, 1);

    // 3. When WebCrypto stub throws, it falls through to Expo Crypto getRandomValues
    const throwingWebCrypto = {
      getRandomValues<T extends Uint8Array>(_arr: T): T {
        throw new Error('crypto.getRandomValues is not implemented');
      },
    };
    const fallbackBytes = generateRandomBytes(24, {
      webCrypto: throwingWebCrypto,
      expoCrypto: mockExpoCrypto,
    });
    assert.equal(fallbackBytes.byteLength, 24);
    assert.equal(expoCryptoCalls, 2);

    // 4. Full PKCE & OIDC authorization preparation works using Expo Crypto without WebCrypto
    const pkce = createMobilePkcePair(undefined, {
      webCrypto: null,
      expoCrypto: mockExpoCrypto,
    });
    assert.equal(pkce.codeChallengeMethod, 'S256');
    assert.match(pkce.codeVerifier, /^[A-Za-z0-9\-._~]{43,128}$/);
    const expectedChallenge = crypto
      .createHash('sha256')
      .update(pkce.codeVerifier, 'ascii')
      .digest('base64url');
    assert.equal(pkce.codeChallenge, expectedChallenge);

    const openedUrls: string[] = [];
    const started = await startOwnerOidcLogin({
      mode: 'login',
      loginHint: 'owner@qlaok.vn',
      lang: 'vi',
      env: validEnv,
      storage,
      randomSources: {
        webCrypto: null,
        expoCrypto: mockExpoCrypto,
      },
      openUrl: async (url) => {
        openedUrls.push(url);
      },
    });
    assert.equal(openedUrls.length, 1);
    const parsedUrl = new URL(started.authorizeUrl);
    assert.equal(parsedUrl.origin, DEFAULT_ZITADEL_ISSUER_URL);
    assert.equal(parsedUrl.pathname, '/oauth/v2/authorize');
    assert.equal(parsedUrl.searchParams.get('client_id'), '312345678901234567@qlaok');
    assert.equal(
      parsedUrl.searchParams.get('redirect_uri'),
      DEFAULT_MOBILE_OIDC_REDIRECT_URI
    );
    assert.equal(parsedUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(parsedUrl.searchParams.get('state'), started.transaction.state);
    assert.equal(parsedUrl.searchParams.get('nonce'), started.transaction.nonce);

    assert.equal(mathRandomCalled, false);
  } finally {
    Math.random = originalMathRandom;
  }
});

test('PKCE CSPRNG fails closed with OIDC_CSPRNG_UNAVAILABLE when both WebCrypto and Expo Crypto are unavailable or fail', async () => {
  const storage = createMemoryStorage();
  const validEnv = {
    EXPO_PUBLIC_ZITADEL_CLIENT_ID: '312345678901234567@qlaok',
  };

  let mathRandomCalled = false;
  const originalMathRandom = Math.random;
  Math.random = () => {
    mathRandomCalled = true;
    return originalMathRandom();
  };

  try {
    // 1. Both WebCrypto and Expo Crypto absent
    assert.throws(
      () => generateRandomBytes(32, { webCrypto: null, expoCrypto: null }),
      (err: unknown) =>
        err instanceof MobileOwnerOidcError &&
        err.code === 'OIDC_CSPRNG_UNAVAILABLE'
    );
    assert.throws(
      () =>
        generateMobileRandomUrlSafe(24, { webCrypto: null, expoCrypto: null }),
      (err: unknown) =>
        err instanceof MobileOwnerOidcError &&
        err.code === 'OIDC_CSPRNG_UNAVAILABLE'
    );
    assert.throws(
      () =>
        createMobilePkcePair(undefined, { webCrypto: null, expoCrypto: null }),
      (err: unknown) =>
        err instanceof MobileOwnerOidcError &&
        err.code === 'OIDC_CSPRNG_UNAVAILABLE'
    );
    await assert.rejects(
      () =>
        prepareOwnerOidcAuthorizationRequest({
          env: validEnv,
          storage,
          randomSources: { webCrypto: null, expoCrypto: null },
        }),
      (err: unknown) =>
        err instanceof MobileOwnerOidcError &&
        err.code === 'OIDC_CSPRNG_UNAVAILABLE'
    );

    // 2. If Expo Crypto getRandomValues throws, fail closed and do NOT fall back to getRandomBytes
    let getRandomBytesFallbackCalled = false;
    assert.throws(
      () =>
        generateRandomBytes(32, {
          webCrypto: null,
          expoCrypto: {
            getRandomValues() {
              throw new Error('SecRandomCopyBytes failed');
            },
            getRandomBytes(len: number) {
              getRandomBytesFallbackCalled = true;
              return new Uint8Array(len);
            },
          } as unknown as Partial<ExpoCryptoLike>,
        }),
      (err: unknown) =>
        err instanceof MobileOwnerOidcError &&
        err.code === 'OIDC_CSPRNG_UNAVAILABLE'
    );
    assert.equal(getRandomBytesFallbackCalled, false);

    // 3. A module exposing only getRandomBytes fails closed and that function is never invoked
    let legacyOnlyGetRandomBytesCalled = false;
    const legacyOnlyExpoCrypto = {
      getRandomBytes(len: number) {
        legacyOnlyGetRandomBytesCalled = true;
        return new Uint8Array(len);
      },
    };
    assert.throws(
      () =>
        generateRandomBytes(32, {
          webCrypto: null,
          expoCrypto: legacyOnlyExpoCrypto as unknown as Partial<ExpoCryptoLike>,
        }),
      (err: unknown) =>
        err instanceof MobileOwnerOidcError &&
        err.code === 'OIDC_CSPRNG_UNAVAILABLE'
    );
    assert.equal(legacyOnlyGetRandomBytesCalled, false);

    // 4. Invalid byteLength fails closed
    for (const invalidLen of [0, -16, 1025, Number.NaN, 12.5]) {
      assert.throws(
        () => generateRandomBytes(invalidLen),
        (err: unknown) =>
          err instanceof MobileOwnerOidcError &&
          err.code === 'OIDC_CSPRNG_UNAVAILABLE'
      );
    }

    assert.equal(mathRandomCalled, false);
  } finally {
    Math.random = originalMathRandom;
  }
});

test('mobile in-app owner registration and email verification keep PKCE codeVerifier in SecureStore and complete native callback exchange', async () => {
  const storage = createMemoryStorage();
  const nowMs = 1_760_000_000_000;
  const nowSec = Math.floor(nowMs / 1000);
  const ownerUuid = '8b55d12a-4c33-4111-9a22-112233445566';
  const validEnv = {
    EXPO_PUBLIC_ZITADEL_CLIENT_ID: '312345678901234567@qlaok',
  };

  const captured: {
    registerStart?: Record<string, unknown>;
    resend?: Record<string, unknown>;
    verify?: Record<string, unknown>;
    exchange?: Record<string, unknown>;
  } = {};

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers || {});
    const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;

    if (url.startsWith('https://qlaok.vunph.click/api/auth/login-ui')) {
      assert.equal(headers.get('X-Qlaok-Client'), 'mobile-native');
      assert.equal(headers.get('Origin'), 'https://qlaok.vunph.click');

      if (body.action === 'register_start') {
        captured.registerStart = body;
        if (body.email === 'duplicate@qlaok.vn') {
          return new Response(
            JSON.stringify({
              error: 'Email này đã được đăng ký tài khoản.',
              code: 'EMAIL_ALREADY_EXISTS',
            }),
            { status: 409, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({
            step: 'verify_email',
            registrationTicket: 'reg-ticket-abc.sig',
            authRequestId: 'V2_888999000111222333',
            email: body.email,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (body.action === 'register_resend') {
        captured.resend = body;
        return new Response(
          JSON.stringify({
            ok: true,
            email: 'newmobileowner@qlaok.vn',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (body.action === 'register_verify') {
        captured.verify = body;
        if (body.verificationCode !== '654321') {
          return new Response(
            JSON.stringify({
              error: 'Mã xác thực chưa đúng.',
              code: 'VERIFICATION_CODE_INVALID',
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }
        const oidcInit = captured.registerStart?.oidc as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            callbackUrl: `qlaok://auth/callback?code=mobile-reg-code-777&state=${encodeURIComponent(
              String(oidcInit?.state || '')
            )}`,
            email: 'newmobileowner@qlaok.vn',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    if (url === 'https://qlaok.vunph.click/api/auth') {
      captured.exchange = body;
      return new Response(
        JSON.stringify({
          user: {
            id: ownerUuid,
            email: 'newmobileowner@qlaok.vn',
            full_name: 'Chủ Quán Mới Mobile',
            plan: 'free',
            role: 'owner',
            is_admin: false,
          },
          isAdmin: false,
          accessToken: 'qlaok-mobile-new-owner-token.sig',
          expiresAt: nowSec + 86400,
          postgrestToken: null,
          postgrestExpiresAt: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  // 1. Duplicate email surfaces EMAIL_ALREADY_EXISTS
  await assert.rejects(
    () =>
      startMobileOwnerRegistration({
        baseUrl: 'https://qlaok.vunph.click',
        fullName: 'Chủ Quán Mới Mobile',
        email: 'duplicate@qlaok.vn',
        password: 'StrongPass1!',
        confirmPassword: 'StrongPass1!',
        lang: 'vi',
        env: validEnv,
        storage,
        fetchImpl,
        nowMs,
      }),
    (err: unknown) =>
      err instanceof MobileOwnerOidcError &&
      err.code === 'EMAIL_ALREADY_EXISTS' &&
      err.status === 409
  );

  // 2. Start registration stores PKCE transaction locally and sends only public S256 challenge
  const started = await startMobileOwnerRegistration({
    baseUrl: 'https://qlaok.vunph.click',
    fullName: 'Chủ Quán Mới Mobile',
    email: 'NewMobileOwner@qlaok.vn',
    password: 'StrongPass1!',
    confirmPassword: 'StrongPass1!',
    lang: 'vi',
    env: validEnv,
    storage,
    fetchImpl,
    nowMs,
  });

  assert.equal(started.registrationTicket, 'reg-ticket-abc.sig');
  assert.equal(started.email, 'newmobileowner@qlaok.vn');
  assert.ok(captured.registerStart);
  const sentOidc = captured.registerStart.oidc as Record<string, unknown>;
  assert.equal(sentOidc.clientId, '312345678901234567@qlaok');
  assert.equal(sentOidc.redirectUri, 'qlaok://auth/callback');
  assert.equal(sentOidc.codeChallengeMethod, 'S256');
  assert.equal(sentOidc.codeVerifier, undefined);

  // Pending PKCE transaction is in storage
  const rawStoredTx = await storage.getItem(OWNER_OIDC_TX_STORAGE_KEY);
  assert.ok(rawStoredTx);

  // 3. Resend code works
  const resent = await resendMobileOwnerRegistrationCode({
    baseUrl: 'https://qlaok.vunph.click',
    registrationTicket: started.registrationTicket,
    lang: 'vi',
    fetchImpl,
  });
  assert.equal(resent.email, 'newmobileowner@qlaok.vn');
  assert.equal(captured.resend?.registrationTicket, 'reg-ticket-abc.sig');

  // 4. Invalid OTP fails without consuming the pending PKCE transaction
  await assert.rejects(
    () =>
      completeMobileOwnerRegistrationVerification({
        baseUrl: 'https://qlaok.vunph.click',
        registrationTicket: started.registrationTicket,
        verificationCode: '000000',
        password: 'StrongPass1!',
        lang: 'vi',
        fetchImpl,
        storage,
        nowMs: nowMs + 2000,
      }),
    (err: unknown) =>
      err instanceof MobileOwnerOidcError &&
      err.code === 'VERIFICATION_CODE_INVALID'
  );
  assert.ok(
    await storage.getItem(OWNER_OIDC_TX_STORAGE_KEY),
    'Pending PKCE transaction must remain intact when OTP is wrong so user can retry'
  );

  // 5. Valid OTP verifies email, receives qlaok://auth/callback, exchanges PKCE code + codeVerifier, and saves session
  const session = await completeMobileOwnerRegistrationVerification({
    baseUrl: 'https://qlaok.vunph.click',
    registrationTicket: started.registrationTicket,
    verificationCode: '654321',
    password: 'StrongPass1!',
    lang: 'vi',
    fetchImpl,
    storage,
    nowMs: nowMs + 5000,
  });

  assert.equal(captured.verify?.verificationCode, '654321');
  assert.ok(captured.exchange);
  assert.equal(captured.exchange.action, 'oidc_mobile_exchange');
  assert.equal(captured.exchange.code, 'mobile-reg-code-777');
  assert.equal(session.user.id, ownerUuid);
  assert.equal(session.user.email, 'newmobileowner@qlaok.vn');
  assert.equal(session.user.plan, 'free');
  assert.equal(session.accessToken, 'qlaok-mobile-new-owner-token.sig');
  assert.equal(await storage.getItem(OWNER_OIDC_TX_STORAGE_KEY), null);
});

test('Mobile registration verification preflights the 15-minute PKCE transaction before consuming the OTP code and provides localized recovery when login handoff expires', async () => {
  assert.equal(
    OWNER_OIDC_TX_TTL_MS,
    15 * 60 * 1000,
    'Mobile OIDC transaction TTL must match the 15-minute registration ticket window'
  );

  const storage = createMemoryStorage();
  const nowMs = 1_760_005_000_000;
  let verifyApiCalled = false;

  // 1. Missing local PKCE transaction fails preflight BEFORE calling /api/auth/login-ui
  await assert.rejects(
    () =>
      completeMobileOwnerRegistrationVerification({
        baseUrl: 'https://qlaok.vunph.click',
        registrationTicket: 'reg-ticket-1.sig',
        verificationCode: '123456',
        password: 'StrongPass1!',
        lang: 'vi',
        storage,
        nowMs,
        fetchImpl: async () => {
          verifyApiCalled = true;
          throw new Error('Must not call server when local PKCE tx is missing');
        },
      }),
    (err: unknown) =>
      err instanceof MobileOwnerOidcError &&
      err.code === 'REGISTRATION_EXPIRED' &&
      err.status === 410 &&
      err.message.includes('Phiên đăng ký đã hết hạn')
  );
  assert.equal(
    verifyApiCalled,
    false,
    'Must not consume OTP when local PKCE tx is missing'
  );

  // 2. Expired local PKCE transaction (>15m) fails preflight BEFORE calling /api/auth/login-ui
  await prepareOwnerOidcAuthorizationRequest({
    env: {
      EXPO_PUBLIC_ZITADEL_CLIENT_ID: '312345678901234567@qlaok_mobile',
    },
    storage,
    nowMs,
  });

  await assert.rejects(
    () =>
      completeMobileOwnerRegistrationVerification({
        baseUrl: 'https://qlaok.vunph.click',
        registrationTicket: 'reg-ticket-2.sig',
        verificationCode: '123456',
        password: 'StrongPass1!',
        lang: 'en',
        storage,
        nowMs: nowMs + OWNER_OIDC_TX_TTL_MS + 1000,
        fetchImpl: async () => {
          verifyApiCalled = true;
          throw new Error('Must not call server when local PKCE tx is expired');
        },
      }),
    (err: unknown) =>
      err instanceof MobileOwnerOidcError &&
      err.code === 'REGISTRATION_EXPIRED' &&
      err.status === 410 &&
      err.message.includes('Your registration session has expired')
  );
  assert.equal(
    verifyApiCalled,
    false,
    'Must not consume OTP when local PKCE tx is expired'
  );

  // 3. Within the 15-minute window (e.g. at 12 minutes), preflight succeeds; if server returns REGISTRATION_VERIFIED_LOGIN_REQUIRED (409), mobile surfaces localized recovery
  await prepareOwnerOidcAuthorizationRequest({
    env: {
      EXPO_PUBLIC_ZITADEL_CLIENT_ID: '312345678901234567@qlaok_mobile',
    },
    storage,
    nowMs,
  });

  await assert.rejects(
    () =>
      completeMobileOwnerRegistrationVerification({
        baseUrl: 'https://qlaok.vunph.click',
        registrationTicket: 'reg-ticket-3.sig',
        verificationCode: '654321',
        password: 'StrongPass1!',
        lang: 'vi',
        storage,
        nowMs: nowMs + 12 * 60 * 1000,
        fetchImpl: async () => {
          verifyApiCalled = true;
          return new Response(
            JSON.stringify({
              code: 'REGISTRATION_VERIFIED_LOGIN_REQUIRED',
              error:
                'Email đã được xác thực thành công. Vui lòng đăng nhập bằng email và mật khẩu vừa tạo.',
            }),
            { status: 409, headers: { 'Content-Type': 'application/json' } }
          );
        },
      }),
    (err: unknown) =>
      err instanceof MobileOwnerOidcError &&
      err.code === 'REGISTRATION_VERIFIED_LOGIN_REQUIRED' &&
      err.status === 409 &&
      err.message.includes('Email đã được xác thực')
  );
  assert.equal(verifyApiCalled, true);

  // 4. If register_verify succeeds (200) and returns callbackUrl, but the subsequent callback exchange fails, mobile surfaces REGISTRATION_VERIFIED_LOGIN_REQUIRED instead of losing the verified user
  const prepared4 = await prepareOwnerOidcAuthorizationRequest({
    env: {
      EXPO_PUBLIC_ZITADEL_CLIENT_ID: '312345678901234567@qlaok_mobile',
    },
    storage,
    nowMs,
  });

  await assert.rejects(
    () =>
      completeMobileOwnerRegistrationVerification({
        baseUrl: 'https://qlaok.vunph.click',
        registrationTicket: 'reg-ticket-4.sig',
        verificationCode: '654321',
        password: 'StrongPass1!',
        lang: 'en',
        storage,
        nowMs: nowMs + 5000,
        fetchImpl: async (input) => {
          const url = String(input);
          if (url.includes('/api/auth/login-ui')) {
            return new Response(
              JSON.stringify({
                ok: true,
                callbackUrl: `qlaok://auth/callback?code=expired-code&state=${encodeURIComponent(
                  prepared4.transaction.state
                )}`,
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          return new Response(
            JSON.stringify({
              code: 'OIDC_TOKEN_EXCHANGE_FAILED',
              error: 'Code expired',
            }),
            { status: 502, headers: { 'Content-Type': 'application/json' } }
          );
        },
      }),
    (err: unknown) =>
      err instanceof MobileOwnerOidcError &&
      err.code === 'REGISTRATION_VERIFIED_LOGIN_REQUIRED' &&
      err.status === 409 &&
      err.message.includes('Your email has been verified')
  );
});

test('parseOwnerOidcCallbackUrl and completeOwnerOidcCallback localize errors in Vietnamese and English without vendor or protocol jargon', async () => {
  // 1. Implicit token rejection has zero "PKCE", "OIDC", or "Zitadel" in VI and EN
  for (const lang of ['vi', 'en'] as const) {
    assert.throws(
      () =>
        parseOwnerOidcCallbackUrl(
          'qlaok://auth/callback?code=abc&state=xyz&access_token=secret',
          lang
        ),
      (err: unknown) => {
        assert.ok(err instanceof MobileOwnerOidcError);
        assert.equal(err.code, 'OIDC_IMPLICIT_TOKEN_FORBIDDEN');
        assert.equal(/zitadel|oidc|pkce|authorization code/i.test(err.message), false);
        if (lang === 'vi') {
          assert.ok(err.message.includes('Phản hồi đăng nhập không an toàn'));
        } else {
          assert.ok(err.message.includes('Unsafe sign-in response rejected'));
        }
        return true;
      }
    );
  }

  // 2. Callback provider error in completeOwnerOidcCallback strips vendor names in VI and EN
  const storage = createMemoryStorage();
  const nowMs = 1_760_009_000_000;
  const preparedVi = await prepareOwnerOidcAuthorizationRequest({
    env: { EXPO_PUBLIC_ZITADEL_CLIENT_ID: '312345678901234567@qlaok_mobile' },
    storage,
    nowMs,
    lang: 'vi',
  });
  await assert.rejects(
    () =>
      completeOwnerOidcCallback(
        `qlaok://auth/callback?error=server_error&error_description=Zitadel+OIDC+PKCE+login+failed&state=${encodeURIComponent(
          preparedVi.transaction.state
        )}`,
        {
          baseUrl: 'https://qlaok.vunph.click',
          storage,
          nowMs: nowMs + 1000,
          lang: 'vi',
        }
      ),
    (err: unknown) => {
      assert.ok(err instanceof MobileOwnerOidcError);
      assert.equal(err.code, 'OIDC_PROVIDER_ERROR');
      assert.equal(/zitadel|oidc|pkce/i.test(err.message), false);
      assert.ok(err.message.includes('Đăng nhập không thành công'));
      return true;
    }
  );

  const preparedEn = await prepareOwnerOidcAuthorizationRequest({
    env: { EXPO_PUBLIC_ZITADEL_CLIENT_ID: '312345678901234567@qlaok_mobile' },
    storage,
    nowMs,
    lang: 'en',
  });
  await assert.rejects(
    () =>
      completeOwnerOidcCallback(
        `qlaok://auth/callback?error=server_error&error_description=Zitadel+OIDC+PKCE+login+failed&state=${encodeURIComponent(
          preparedEn.transaction.state
        )}`,
        {
          baseUrl: 'https://qlaok.vunph.click',
          storage,
          nowMs: nowMs + 1000,
          lang: 'en',
        }
      ),
    (err: unknown) => {
      assert.ok(err instanceof MobileOwnerOidcError);
      assert.equal(err.code, 'OIDC_PROVIDER_ERROR');
      assert.equal(/zitadel|oidc|pkce/i.test(err.message), false);
      assert.ok(err.message.includes('Sign-in could not be completed'));
      return true;
    }
  );

  // 3. completeOwnerOidcCallback localizes missing transaction in both VI and EN
  await assert.rejects(
    () =>
      completeOwnerOidcCallback(
        'qlaok://auth/callback?code=code-1&state=state-1',
        {
          baseUrl: 'https://qlaok.vunph.click',
          storage,
          lang: 'vi',
        }
      ),
    (err: unknown) =>
      err instanceof MobileOwnerOidcError &&
      err.code === 'OIDC_TRANSACTION_MISSING' &&
      err.message.includes('Không tìm thấy phiên đăng nhập đang chờ')
  );

  await assert.rejects(
    () =>
      completeOwnerOidcCallback(
        'qlaok://auth/callback?code=code-1&state=state-1',
        {
          baseUrl: 'https://qlaok.vunph.click',
          storage,
          lang: 'en',
        }
      ),
    (err: unknown) =>
      err instanceof MobileOwnerOidcError &&
      err.code === 'OIDC_TRANSACTION_MISSING' &&
      err.message.includes('No pending sign-in session was found')
  );
});