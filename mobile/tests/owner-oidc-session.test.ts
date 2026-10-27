import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { createApiClient } from '../src/lib/api-client.ts';
import {
  clearOwnerSession,
  completeOwnerOidcCallback,
  computeMobileS256CodeChallenge,
  createMobilePkcePair,
  DEFAULT_MOBILE_OIDC_REDIRECT_URI,
  DEFAULT_ZITADEL_ISSUER_URL,
  getOwnerAccessToken,
  getOwnerPostgrestToken,
  isOwnerOidcCallbackUrl,
  loadOwnerSession,
  MobileOwnerOidcError,
  OWNER_OIDC_TX_STORAGE_KEY,
  OWNER_SESSION_STORAGE_KEY,
  type OwnerSessionStorageAdapter,
  parseOwnerOidcCallbackUrl,
  prepareOwnerOidcAuthorizationRequest,
  requireOwnerPostgrestToken,
  resolveMobileZitadelOidcConfig,
  revalidateOwnerSession,
  saveOwnerSession,
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
