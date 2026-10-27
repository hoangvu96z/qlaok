import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { GET as authGet, POST as authPost } from '@/app/api/auth/route';
import { GET as authCallbackGet } from '@/app/api/auth/callback/route';
import { setSupabaseDbClientForTests } from '@/lib/db';
import { SUPER_ADMIN_EMAIL } from '@/lib/auth-session';
import {
  issuePostgrestAuthenticatedJwt,
  issueSessionToken,
  requireAuthenticatedUser,
  requireSuperAdmin,
  SESSION_COOKIE_NAME,
  verifyPostgrestAuthenticatedJwt,
  verifyRequestUser,
  verifySessionToken,
} from '@/lib/server-auth';
import {
  clearZitadelOidcCaches,
  computeS256CodeChallenge,
  createPkcePair,
  DEFAULT_MOBILE_REDIRECT_URI,
  DEFAULT_ZITADEL_ISSUER_URL,
  issueOidcTransactionCookieValue,
  isValidZitadelSub,
  isValidUuidSub,
  OIDC_TX_COOKIE_NAME,
  setZitadelOidcTestHooks,
  verifyOidcTransactionCookieValue,
  type ZitadelDiscoveryDocument,
  type ZitadelJwk,
} from '@/lib/zitadel-oidc';

const TEST_ISSUER = DEFAULT_ZITADEL_ISSUER_URL; // https://auth.vunph.click
const TEST_CLIENT_ID = 'qlaok-web-pkce-client-001';
const TEST_REDIRECT_URI = 'https://qlaok.vunph.click/api/auth/callback';

const EXISTING_IMPORTED_UUIDS = [
  'a3a30894-e8ae-415d-a3dc-7947b0399dd1',
  '7d21f8ae-6b7c-414b-ba28-3f932ab062f7',
  '0a40219c-49d0-4391-a2df-c7a5f58237a5',
  '46767a29-2691-4d40-8da9-b48c6fa1da1a',
] as const;

const { publicKey: rsaPublicKey, privateKey: rsaPrivateKey } =
  crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: wrongRsaPrivateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});

const exportedJwk = rsaPublicKey.export({ format: 'jwk' }) as ZitadelJwk;
const TEST_JWK: ZitadelJwk = {
  ...exportedJwk,
  kid: 'zitadel-key-2026-01',
  use: 'sig',
  alg: 'RS256',
};

const TEST_DISCOVERY: ZitadelDiscoveryDocument = {
  issuer: TEST_ISSUER,
  authorization_endpoint: `${TEST_ISSUER}/oauth/v2/authorize`,
  token_endpoint: `${TEST_ISSUER}/oauth/v2/token`,
  userinfo_endpoint: `${TEST_ISSUER}/oidc/v1/userinfo`,
  end_session_endpoint: `${TEST_ISSUER}/oidc/v1/end_session`,
  jwks_uri: `${TEST_ISSUER}/oauth/v2/keys`,
};

function signTestJwt(
  payload: Record<string, unknown>,
  options?: {
    kid?: string;
    alg?: string;
    privateKey?: crypto.KeyObject;
  }
): string {
  const alg = options?.alg ?? 'RS256';
  const kid = options?.kid ?? TEST_JWK.kid;
  const headerB64 = Buffer.from(
    JSON.stringify({ alg, typ: 'JWT', ...(kid ? { kid } : {}) }),
    'utf8'
  ).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url'
  );
  const signingInput = `${headerB64}.${payloadB64}`;
  if (alg === 'none') {
    return `${signingInput}.`;
  }
  const key = options?.privateKey ?? rsaPrivateKey;
  const sig = crypto
    .sign('RSA-SHA256', Buffer.from(signingInput, 'ascii'), key)
    .toString('base64url');
  return `${signingInput}.${sig}`;
}

function extractCookieValue(
  res: Response,
  cookieName: string
): string | undefined {
  const setCookies =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie') || ''].filter(Boolean);
  for (const header of setCookies) {
    const firstPart = header.split(';')[0] || '';
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx === -1) continue;
    const name = firstPart.slice(0, eqIdx).trim();
    if (name === cookieName) {
      return decodeURIComponent(firstPart.slice(eqIdx + 1).trim());
    }
  }
  return undefined;
}

function createInMemoryOidcDb(initialProfiles: Array<Record<string, unknown>>, initialShops: Array<Record<string, unknown>> = []) {
  const profiles = initialProfiles.map((p) => ({ ...p }));
  const shops = initialShops.map((s) => ({ ...s }));
  const profileWrites: Array<{ op: 'insert' | 'update' | 'upsert'; payload: Record<string, unknown> }> = [];

  const client = {
    from(table: string) {
      if (table === 'profiles') {
        return {
          select() {
            return {
              eq(col: string, val: unknown) {
                const match =
                  profiles.find(
                    (p) => {
                      const actual = String(p[col] ?? '');
                      const expected = String(val ?? '');
                      return col === 'zitadel_sub'
                        ? actual === expected
                        : actual.toLowerCase() === expected.toLowerCase();
                    }
                  ) ?? null;
                return {
                  maybeSingle: async () => ({ data: match, error: null }),
                  single: async () => ({ data: match, error: null }),
                };
              },
              ilike(col: string, val: unknown) {
                const matches = profiles.filter(
                  (p) =>
                    String(p[col] ?? '').toLowerCase() ===
                    String(val ?? '').toLowerCase()
                );
                return {
                  limit: async (n: number) => ({
                    data: matches.slice(0, n),
                    error: null,
                  }),
                  maybeSingle: async () => ({
                    data: matches[0] ?? null,
                    error: null,
                  }),
                };
              },
            };
          },
          async insert(payload: Record<string, unknown>) {
            profileWrites.push({ op: 'insert', payload: { ...payload } });
            profiles.push({ ...payload });
            return { data: payload, error: null };
          },
          update(patch: Record<string, unknown>) {
            return {
              async eq(col: string, val: unknown) {
                profileWrites.push({ op: 'update', payload: { ...patch } });
                for (let i = 0; i < profiles.length; i++) {
                  if (
                    String(profiles[i][col] ?? '').toLowerCase() ===
                    String(val ?? '').toLowerCase()
                  ) {
                    profiles[i] = { ...profiles[i], ...patch };
                  }
                }
                return { data: null, error: null };
              },
            };
          },
        };
      }

      if (table === 'shops') {
        return {
          select(_cols?: string, opts?: { count?: string; head?: boolean }) {
            if (opts?.head) {
              return Promise.resolve({
                data: null,
                count: shops.length,
                error: null,
              });
            }
            return {
              limit: async (n: number) => ({
                data: shops.slice(0, n),
                error: null,
              }),
              eq(col: string, val: unknown) {
                const filtered = shops.filter((s) => s[col] === val);
                return {
                  order: async () => ({ data: filtered, error: null }),
                  maybeSingle: async () => ({
                    data: filtered[0] ?? null,
                    error: null,
                  }),
                };
              },
              in(col: string, vals: unknown[]) {
                const filtered = shops.filter((s) => vals.includes(s[col]));
                return Promise.resolve({ data: filtered, error: null });
              },
            };
          },
        };
      }

      if (table === 'provinces') {
        return {
          select() {
            return Promise.resolve({ data: null, count: 34, error: null });
          },
        };
      }

      if (table === 'shop_memberships') {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
        };
      }

      return {
        select() {
          return Promise.resolve({ data: [], error: null });
        },
      };
    },
  };

  return { client, profiles, shops, profileWrites };
}

test('PKCE S256 challenge, OIDC transaction cookie signing/expiry, and UUID subject validation', () => {
  // 1. S256 PKCE RFC 7636 Appendix B test vector verification
  const rfcVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  assert.equal(
    computeS256CodeChallenge(rfcVerifier),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
  );

  const pair = createPkcePair();
  assert.equal(pair.codeChallengeMethod, 'S256');
  assert.ok(pair.codeVerifier.length >= 43);
  assert.equal(
    pair.codeChallenge,
    computeS256CodeChallenge(pair.codeVerifier)
  );

  // 2. Signed OIDC transaction cookie verification and tamper/expiry rejection
  const issued = issueOidcTransactionCookieValue({
    redirectUri: TEST_REDIRECT_URI,
    nextPath: 'https://evil.example/phish', // must be sanitized to /dashboard
    mode: 'register',
  });
  assert.equal(issued.transaction.nextPath, '/dashboard');
  assert.equal(issued.transaction.mode, 'register');

  const verified = verifyOidcTransactionCookieValue(issued.cookieValue);
  assert.ok(verified);
  assert.equal(verified.state, issued.transaction.state);
  assert.equal(verified.nonce, issued.transaction.nonce);
  assert.equal(verified.codeVerifier, issued.transaction.codeVerifier);

  // Tampered signature rejected
  assert.equal(
    verifyOidcTransactionCookieValue(`${issued.cookieValue}tamper`),
    null
  );

  // Expired cookie rejected
  assert.equal(
    verifyOidcTransactionCookieValue(
      issued.cookieValue,
      issued.transaction.exp + 1
    ),
    null
  );

  // 3. Qlaok/PostgREST IDs stay UUID-only; Zitadel's OIDC sub is opaque.
  for (const uuid of EXISTING_IMPORTED_UUIDS) {
    assert.equal(isValidUuidSub(uuid), true);
    assert.equal(isValidUuidSub(uuid.toUpperCase()), true);
    assert.equal(isValidUuidSub(` ${uuid}`), false);
    assert.equal(isValidUuidSub(`${uuid} `), false);
    assert.equal(isValidUuidSub(`\t${uuid}\n`), false);
  }
  assert.equal(isValidUuidSub('staff-acct-99999'), false);
  assert.equal(isValidUuidSub('284910293847102938'), false);
  assert.equal(isValidUuidSub('owner-fnb-001'), false);
  assert.equal(isValidUuidSub(''), false);
  assert.equal(isValidZitadelSub('284910293847102938'), true);
  assert.equal(isValidZitadelSub('user-id@qlaok'), true);
  assert.equal(isValidZitadelSub(EXISTING_IMPORTED_UUIDS[0]), true);
  assert.equal(isValidZitadelSub('staff-acct-99999'), false);
  assert.equal(isValidZitadelSub(' id-with-space'), false);
  assert.equal(isValidZitadelSub('id-with-space '), false);
  assert.equal(isValidZitadelSub('id\nwith-control'), false);
  assert.equal(isValidZitadelSub('người-dùng'), false);
  assert.equal(isValidZitadelSub('a'.repeat(129)), false);
  assert.equal(isValidZitadelSub(''), false);
});

test('getOidcSigningSecret fails closed in production without SESSION_SECRET and never falls back to SUPABASE_SERVICE_ROLE_KEY or PAYMENT_WEBHOOK_SECRET', async () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevSessionSecret = process.env.SESSION_SECRET;
  const prevServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const prevWebhookSecret = process.env.PAYMENT_WEBHOOK_SECRET;
  const prevClientId = process.env.ZITADEL_CLIENT_ID;

  try {
    process.env.ZITADEL_CLIENT_ID = TEST_CLIENT_ID;
    delete process.env.SESSION_SECRET;
    process.env.SUPABASE_SERVICE_ROLE_KEY =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service-role-key-secret-value';
    process.env.PAYMENT_WEBHOOK_SECRET =
      'payment-webhook-secret-value-at-least-32-chars';

    // 1. In non-production without SESSION_SECRET, uses dev fallback and ignores SUPABASE_SERVICE_ROLE_KEY / PAYMENT_WEBHOOK_SECRET
    (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
    const devIssued = issueOidcTransactionCookieValue({
      redirectUri: TEST_REDIRECT_URI,
      nextPath: '/dashboard',
      mode: 'login',
    });
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'different-service-role-key-000000000';
    process.env.PAYMENT_WEBHOOK_SECRET = 'different-webhook-secret-00000000000';
    assert.ok(
      verifyOidcTransactionCookieValue(devIssued.cookieValue),
      'Dev fallback cookie verification must not depend on SUPABASE_SERVICE_ROLE_KEY or PAYMENT_WEBHOOK_SECRET'
    );

    // 2. In production without SESSION_SECRET (or with < 16 chars), fails closed even when SUPABASE_SERVICE_ROLE_KEY and PAYMENT_WEBHOOK_SECRET are set
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    assert.throws(
      () =>
        issueOidcTransactionCookieValue({
          redirectUri: TEST_REDIRECT_URI,
          nextPath: '/dashboard',
          mode: 'login',
        }),
      (err: unknown) =>
        err instanceof Error &&
        (err as { code?: string }).code === 'OIDC_SESSION_SECRET_MISSING'
    );

    assert.equal(
      verifyOidcTransactionCookieValue(devIssued.cookieValue),
      null,
      'Production verification must fail closed and reject dev-signed cookies when SESSION_SECRET is missing'
    );

    process.env.SESSION_SECRET = 'short-secret';
    assert.throws(
      () =>
        issueOidcTransactionCookieValue({
          redirectUri: TEST_REDIRECT_URI,
          nextPath: '/dashboard',
          mode: 'login',
        }),
      (err: unknown) =>
        err instanceof Error &&
        (err as { code?: string }).code === 'OIDC_SESSION_SECRET_MISSING'
    );

    const getStartRes = await authGet(
      new Request('https://qlaok.vunph.click/api/auth?action=oidc_start')
    );
    assert.equal(getStartRes.status, 500);
    assert.equal(
      (await getStartRes.json()).code,
      'OIDC_SESSION_SECRET_MISSING'
    );

    // 3. In production with valid dedicated SESSION_SECRET (>= 16 chars), signing and verification succeed
    process.env.SESSION_SECRET =
      'dedicated-production-session-secret-32-chars!';
    const prodIssued = issueOidcTransactionCookieValue({
      redirectUri: TEST_REDIRECT_URI,
      nextPath: '/dashboard',
      mode: 'login',
    });
    const prodVerified = verifyOidcTransactionCookieValue(
      prodIssued.cookieValue
    );
    assert.ok(prodVerified);
    assert.equal(prodVerified.state, prodIssued.transaction.state);
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = prevNodeEnv;
    if (prevSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = prevSessionSecret;
    if (prevServiceRoleKey === undefined)
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevServiceRoleKey;
    if (prevWebhookSecret === undefined)
      delete process.env.PAYMENT_WEBHOOK_SECRET;
    else process.env.PAYMENT_WEBHOOK_SECRET = prevWebhookSecret;
    if (prevClientId === undefined) delete process.env.ZITADEL_CLIENT_ID;
    else process.env.ZITADEL_CLIENT_ID = prevClientId;
  }
});

test('GET /api/auth?action=oidc_start and POST oidc_start build Zitadel PKCE URL and set HttpOnly transaction cookie', async () => {
  process.env.ZITADEL_ISSUER_URL = TEST_ISSUER;
  process.env.ZITADEL_CLIENT_ID = TEST_CLIENT_ID;
  process.env.ZITADEL_REDIRECT_URI = TEST_REDIRECT_URI;

  try {
    const startRes = await authGet(
      new Request(
        'https://qlaok.vunph.click/api/auth?action=oidc_start&mode=register&next=/dashboard/orders&login_hint=Owner@Example.com&lang=vi'
      )
    );
    assert.equal(startRes.status, 302);
    const location = startRes.headers.get('location') || '';
    assert.ok(location.startsWith(`${TEST_ISSUER}/oauth/v2/authorize?`));

    const authUrl = new URL(location);
    assert.equal(authUrl.searchParams.get('client_id'), TEST_CLIENT_ID);
    assert.equal(authUrl.searchParams.get('redirect_uri'), TEST_REDIRECT_URI);
    assert.equal(authUrl.searchParams.get('response_type'), 'code');
    assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authUrl.searchParams.get('prompt'), 'create');
    assert.equal(
      authUrl.searchParams.get('login_hint'),
      'Owner@Example.com'
    );
    assert.equal(authUrl.searchParams.get('ui_locales'), 'vi');

    const rawTxCookie = extractCookieValue(startRes, OIDC_TX_COOKIE_NAME);
    assert.ok(rawTxCookie, 'Must set qlaok_oidc_tx HttpOnly cookie');
    const tx = verifyOidcTransactionCookieValue(rawTxCookie);
    assert.ok(tx);
    assert.equal(tx.state, authUrl.searchParams.get('state'));
    assert.equal(tx.nonce, authUrl.searchParams.get('nonce'));
    assert.equal(
      computeS256CodeChallenge(tx.codeVerifier),
      authUrl.searchParams.get('code_challenge')
    );
    assert.equal(tx.nextPath, '/dashboard/orders');

    const postStartRes = await authPost(
      new Request('https://qlaok.vunph.click/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'oidc_start',
          mode: 'login',
          next: '/dashboard',
          loginHint: 'merchant@qlaok.vn',
        }),
      })
    );
    assert.equal(postStartRes.status, 200);
    const postStartJson = (await postStartRes.json()) as {
      authorizeUrl?: string;
      codeChallengeMethod?: string;
    };
    assert.equal(postStartJson.codeChallengeMethod, 'S256');
    assert.ok(
      postStartJson.authorizeUrl?.startsWith(`${TEST_ISSUER}/oauth/v2/authorize?`)
    );
    assert.ok(extractCookieValue(postStartRes, OIDC_TX_COOKIE_NAME));
  } finally {
    delete process.env.ZITADEL_CLIENT_ID;
    delete process.env.ZITADEL_REDIRECT_URI;
  }
});

test('GET /api/auth/callback rejects missing params, state mismatch, bad signature, wrong issuer/aud/nonce, expired token, and non-UUID sub', async () => {
  process.env.ZITADEL_ISSUER_URL = TEST_ISSUER;
  process.env.ZITADEL_CLIENT_ID = TEST_CLIENT_ID;
  process.env.ZITADEL_REDIRECT_URI = TEST_REDIRECT_URI;
  clearZitadelOidcCaches();

  const { cookieValue, transaction } = issueOidcTransactionCookieValue({
    redirectUri: TEST_REDIRECT_URI,
    nextPath: '/dashboard',
    mode: 'login',
  });

  let nextTokenEndpointIdToken = '';
  const nextTokenEndpointStatus = 200;

  setZitadelOidcTestHooks({
    discovery: TEST_DISCOVERY,
    jwks: { keys: [TEST_JWK] },
    fetch: (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === TEST_DISCOVERY.token_endpoint) {
        if (nextTokenEndpointStatus !== 200) {
          return new Response(
            JSON.stringify({ error: 'invalid_grant' }),
            { status: nextTokenEndpointStatus }
          );
        }
        return new Response(
          JSON.stringify({
            access_token: 'mock-access-token',
            token_type: 'Bearer',
            expires_in: 3600,
            id_token: nextTokenEndpointIdToken,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch,
  });

  try {
    // 1. Missing code/state -> 400 OIDC_MISSING_PARAMS
    const missingRes = await authCallbackGet(
      new Request('https://qlaok.vunph.click/api/auth/callback')
    );
    assert.equal(missingRes.status, 400);
    assert.equal((await missingRes.json()).code, 'OIDC_MISSING_PARAMS');

    // 2. Missing cookie -> 400 OIDC_INVALID_TRANSACTION
    const noCookieRes = await authCallbackGet(
      new Request(
        `https://qlaok.vunph.click/api/auth/callback?code=abc&state=${transaction.state}`
      )
    );
    assert.equal(noCookieRes.status, 400);
    assert.equal((await noCookieRes.json()).code, 'OIDC_INVALID_TRANSACTION');

    // 3. State mismatch -> 400 OIDC_STATE_MISMATCH
    const badStateRes = await authCallbackGet(
      new Request(
        'https://qlaok.vunph.click/api/auth/callback?code=abc&state=wrong-state',
        {
          headers: { Cookie: `${OIDC_TX_COOKIE_NAME}=${cookieValue}` },
        }
      )
    );
    assert.equal(badStateRes.status, 400);
    assert.equal((await badStateRes.json()).code, 'OIDC_STATE_MISMATCH');

    // 4. Browser HTML navigation on error redirects 302 to /login?error=...
    const htmlErrRes = await authCallbackGet(
      new Request(
        'https://qlaok.vunph.click/api/auth/callback?error=access_denied&error_description=User+cancelled',
        {
          headers: { Accept: 'text/html,application/xhtml+xml' },
        }
      )
    );
    assert.equal(htmlErrRes.status, 302);
    const errLoc = new URL(htmlErrRes.headers.get('location') || '');
    assert.equal(errLoc.pathname, '/login');
    assert.equal(errLoc.searchParams.get('error_code'), 'OIDC_PROVIDER_ERROR');

    const nowSec = Math.floor(Date.now() / 1000);
    const validBaseClaims = {
      iss: TEST_ISSUER,
      aud: TEST_CLIENT_ID,
      sub: EXISTING_IMPORTED_UUIDS[1],
      email: 'owner2@qlaok.vn',
      nonce: transaction.nonce,
      iat: nowSec - 10,
      exp: nowSec + 3600,
    };

    // 5. Invalid cryptographic signature (wrong RSA private key) -> 401 OIDC_TOKEN_INVALID_SIGNATURE
    nextTokenEndpointIdToken = signTestJwt(validBaseClaims, {
      privateKey: wrongRsaPrivateKey,
    });
    const badSigRes = await authCallbackGet(
      new Request(
        `https://qlaok.vunph.click/api/auth/callback?code=code1&state=${transaction.state}`,
        { headers: { Cookie: `${OIDC_TX_COOKIE_NAME}=${cookieValue}` } }
      )
    );
    assert.equal(badSigRes.status, 401);
    assert.equal(
      (await badSigRes.json()).code,
      'OIDC_TOKEN_INVALID_SIGNATURE'
    );

    // 6. Wrong issuer -> 401 OIDC_TOKEN_INVALID_ISSUER
    nextTokenEndpointIdToken = signTestJwt({
      ...validBaseClaims,
      iss: 'https://evil-idp.example.com',
    });
    const badIssRes = await authCallbackGet(
      new Request(
        `https://qlaok.vunph.click/api/auth/callback?code=code1&state=${transaction.state}`,
        { headers: { Cookie: `${OIDC_TX_COOKIE_NAME}=${cookieValue}` } }
      )
    );
    assert.equal(badIssRes.status, 401);
    assert.equal((await badIssRes.json()).code, 'OIDC_TOKEN_INVALID_ISSUER');

    // 7. Wrong audience -> 401 OIDC_TOKEN_INVALID_AUDIENCE
    nextTokenEndpointIdToken = signTestJwt({
      ...validBaseClaims,
      aud: 'other-client-id',
    });
    const badAudRes = await authCallbackGet(
      new Request(
        `https://qlaok.vunph.click/api/auth/callback?code=code1&state=${transaction.state}`,
        { headers: { Cookie: `${OIDC_TX_COOKIE_NAME}=${cookieValue}` } }
      )
    );
    assert.equal(badAudRes.status, 401);
    assert.equal((await badAudRes.json()).code, 'OIDC_TOKEN_INVALID_AUDIENCE');

    // 8. Expired token -> 401 OIDC_TOKEN_EXPIRED
    nextTokenEndpointIdToken = signTestJwt({
      ...validBaseClaims,
      exp: nowSec - 120,
    });
    const expiredRes = await authCallbackGet(
      new Request(
        `https://qlaok.vunph.click/api/auth/callback?code=code1&state=${transaction.state}`,
        { headers: { Cookie: `${OIDC_TX_COOKIE_NAME}=${cookieValue}` } }
      )
    );
    assert.equal(expiredRes.status, 401);
    assert.equal((await expiredRes.json()).code, 'OIDC_TOKEN_EXPIRED');

    // 9. Nonce mismatch -> 401 OIDC_NONCE_MISMATCH
    nextTokenEndpointIdToken = signTestJwt({
      ...validBaseClaims,
      nonce: 'wrong-nonce-value',
    });
    const badNonceRes = await authCallbackGet(
      new Request(
        `https://qlaok.vunph.click/api/auth/callback?code=code1&state=${transaction.state}`,
        { headers: { Cookie: `${OIDC_TX_COOKIE_NAME}=${cookieValue}` } }
      )
    );
    assert.equal(badNonceRes.status, 401);
    assert.equal((await badNonceRes.json()).code, 'OIDC_NONCE_MISMATCH');

    // 10. Shop-scoped staff IDs are never valid owner identities.
    for (const invalidSub of ['staff-acct-12345']) {
      nextTokenEndpointIdToken = signTestJwt({
        ...validBaseClaims,
        sub: invalidSub,
      });
      const badSubRes = await authCallbackGet(
        new Request(
          `https://qlaok.vunph.click/api/auth/callback?code=code1&state=${transaction.state}`,
          { headers: { Cookie: `${OIDC_TX_COOKIE_NAME}=${cookieValue}` } }
        )
      );
      assert.equal(badSubRes.status, 403);
      assert.equal((await badSubRes.json()).code, 'INVALID_OIDC_SUB');
    }
  } finally {
    setZitadelOidcTestHooks(null);
    clearZitadelOidcCaches();
    delete process.env.ZITADEL_CLIENT_ID;
    delete process.env.ZITADEL_REDIRECT_URI;
  }
});

test('GET /api/auth/callback maps opaque Zitadel subjects to stable Qlaok UUID profiles and creates mapped free profiles', async () => {
  process.env.ZITADEL_ISSUER_URL = TEST_ISSUER;
  process.env.ZITADEL_CLIENT_ID = TEST_CLIENT_ID;
  process.env.ZITADEL_REDIRECT_URI = TEST_REDIRECT_URI;
  clearZitadelOidcCaches();

  const existingOwnerUuid = EXISTING_IMPORTED_UUIDS[1]; // 7d21f8ae-6b7c-414b-ba28-3f932ab062f7
  const existingOwnerSub = '298347928374923874';
  const superAdminUuid = EXISTING_IMPORTED_UUIDS[0]; // a3a30894-e8ae-415d-a3dc-7947b0399dd1
  const newOwnerSub = 'new-zitadel-user-2026-01';

  const { client, profiles, profileWrites } = createInMemoryOidcDb(
    [
      {
        id: superAdminUuid,
        email: SUPER_ADMIN_EMAIL,
        full_name: 'Hoàng Vũ (Super Admin)',
        phone: '0905649696',
        plan: 'premium',
        plan_expires_at: '2030-12-31T23:59:59Z',
      },
      {
        id: existingOwnerUuid,
        zitadel_sub: existingOwnerSub,
        email: 'existing-pro@qlaok.vn',
        full_name: 'Chủ Quán Pro',
        phone: '0911222333',
        plan: 'pro',
        plan_expires_at: '2028-06-30T23:59:59Z',
      },
    ],
    [
      {
        id: 'shop-existing-001',
        owner_id: existingOwnerUuid,
        slug: 'quan-pro-01',
        name: 'Quán Pro 01',
        vertical: 'fnb',
        is_published: true,
      },
    ]
  );

  setSupabaseDbClientForTests(client as never);

  let currentIdToken = '';
  let currentUserInfo: Record<string, unknown> | null = null;
  let lastExchangedVerifier = '';

  setZitadelOidcTestHooks({
    discovery: TEST_DISCOVERY,
    jwks: { keys: [TEST_JWK] },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === TEST_DISCOVERY.token_endpoint) {
        const params = new URLSearchParams(String(init?.body || ''));
        lastExchangedVerifier = params.get('code_verifier') || '';
        return new Response(
          JSON.stringify({
            access_token: 'mock-access-token',
            token_type: 'Bearer',
            expires_in: 3600,
            id_token: currentIdToken,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url === TEST_DISCOVERY.userinfo_endpoint && currentUserInfo) {
        return new Response(JSON.stringify(currentUserInfo), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch,
  });

  try {
    const nowSec = Math.floor(Date.now() / 1000);

    // Case A: An opaque Zitadel subject resolves to the original Qlaok UUID and preserves billing.
    {
      const txIssued = issueOidcTransactionCookieValue({
        redirectUri: TEST_REDIRECT_URI,
        nextPath: '/dashboard/orders',
        mode: 'login',
      });
      currentIdToken = signTestJwt({
        iss: TEST_ISSUER,
        aud: TEST_CLIENT_ID,
        sub: existingOwnerSub,
        email: 'existing-pro@qlaok.vn',
        name: 'Different Zitadel Display Name',
        role: 'admin', // Forged admin claim in JWT must be ignored!
        is_admin: true,
        nonce: txIssued.transaction.nonce,
        iat: nowSec - 5,
        exp: nowSec + 3600,
      });

      const res = await authCallbackGet(
        new Request(
          `http://localhost:3005/api/auth/callback?code=code-pro&state=${txIssued.transaction.state}`,
          {
            headers: {
              Cookie: `${OIDC_TX_COOKIE_NAME}=${txIssued.cookieValue}`,
              Host: 'qlaok.vunph.click',
              'X-Forwarded-Proto': 'https',
            },
          }
        )
      );
      assert.equal(res.status, 302);
      assert.equal(lastExchangedVerifier, txIssued.transaction.codeVerifier);
      assert.equal(
        res.headers.get('location'),
        'https://qlaok.vunph.click/dashboard/orders'
      );

      const sessionCookie = extractCookieValue(res, SESSION_COOKIE_NAME);
      assert.ok(sessionCookie, 'Must issue qlaok_session cookie');
      const decodedSession = verifySessionToken(sessionCookie);
      assert.ok(decodedSession);
      assert.equal(decodedSession.sub, existingOwnerUuid);
      assert.equal(decodedSession.email, 'existing-pro@qlaok.vn');
      assert.equal(
        decodedSession.role,
        'owner',
        'Must never grant admin from JWT claim'
      );

      const syncRes = await authPost(
        new Request('https://qlaok.vunph.click/api/auth', {
          method: 'POST',
          headers: {
            Cookie: `${SESSION_COOKIE_NAME}=${sessionCookie}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action: 'sync_user' }),
        })
      );
      assert.equal(syncRes.status, 200);
      const syncBody = await syncRes.json();
      assert.equal(syncBody.user.id, existingOwnerUuid);
      assert.equal(syncBody.user.email, 'existing-pro@qlaok.vn');
      assert.equal(syncBody.user.plan, 'pro');

      // Existing profile plan & expiry must be completely untouched (zero overwrites)
      const storedPro = profiles.find((p) => p.id === existingOwnerUuid)!;
      assert.equal(storedPro.plan, 'pro');
      assert.equal(storedPro.plan_expires_at, '2028-06-30T23:59:59Z');
      assert.equal(storedPro.full_name, 'Chủ Quán Pro');
      assert.equal(profileWrites.length, 0);
    }

    // Case B: A new Zitadel subject gets a random stable Qlaok UUID profile mapping.
    {
      const txIssued = issueOidcTransactionCookieValue({
        redirectUri: TEST_REDIRECT_URI,
        nextPath: '/dashboard',
        mode: 'register',
      });
      currentIdToken = signTestJwt({
        iss: TEST_ISSUER,
        aud: TEST_CLIENT_ID,
        sub: newOwnerSub,
        email: 'brandnew@qlaok.vn',
        name: 'Nguyễn Văn Mới',
        phone_number: '0988777666',
        nonce: txIssued.transaction.nonce,
        iat: nowSec - 5,
        exp: nowSec + 3600,
      });

      const res = await authCallbackGet(
        new Request(
          `https://qlaok.vunph.click/api/auth/callback?code=code-new&state=${txIssued.transaction.state}`,
          {
            headers: {
              Cookie: `${OIDC_TX_COOKIE_NAME}=${txIssued.cookieValue}`,
            },
          }
        )
      );
      assert.equal(res.status, 302);
      assert.equal(
        res.headers.get('location'),
        'https://qlaok.vunph.click/onboarding'
      );

      const createdRow = profiles.find((p) => p.zitadel_sub === newOwnerSub);
      assert.ok(createdRow, 'Must persist the opaque Zitadel subject mapping');
      assert.equal(typeof createdRow.id, 'string');
      assert.equal(isValidUuidSub(createdRow.id), true);
      assert.notEqual(createdRow.id, newOwnerSub);
      assert.equal(createdRow.email, 'brandnew@qlaok.vn');
      assert.equal(createdRow.full_name, 'Nguyễn Văn Mới');
      assert.equal(createdRow.phone, '0988777666');
      assert.equal(createdRow.plan, 'free');
    }

    // Case C: UserInfo fallback accepts an opaque, exact subject when id_token lacks profile claims.
    {
      const txIssued = issueOidcTransactionCookieValue({
        redirectUri: TEST_REDIRECT_URI,
        nextPath: '/dashboard',
        mode: 'register',
      });
      const userInfoSub = 'CaseSensitive-Opaque-Subject-01';
      currentIdToken = signTestJwt({
        iss: TEST_ISSUER,
        aud: TEST_CLIENT_ID,
        sub: userInfoSub,
        nonce: txIssued.transaction.nonce,
        iat: nowSec - 5,
        exp: nowSec + 3600,
      });
      currentUserInfo = {
        sub: userInfoSub,
        email: 'userinfo-fallback@qlaok.vn',
        email_verified: true,
        name: 'UserInfo Fallback',
      };

      const res = await authCallbackGet(
        new Request(
          `https://qlaok.vunph.click/api/auth/callback?code=code-userinfo&state=${txIssued.transaction.state}`,
          {
            headers: {
              Cookie: `${OIDC_TX_COOKIE_NAME}=${txIssued.cookieValue}`,
            },
          }
        )
      );
      assert.equal(res.status, 302);
      assert.equal(
        res.headers.get('location'),
        'https://qlaok.vunph.click/onboarding'
      );
      const userInfoProfile = profiles.find(
        (p) => p.zitadel_sub === userInfoSub
      );
      assert.ok(userInfoProfile);
      assert.equal(userInfoProfile.email, 'userinfo-fallback@qlaok.vn');
      assert.equal(userInfoProfile.full_name, 'UserInfo Fallback');
      assert.equal(isValidUuidSub(userInfoProfile.id), true);
      currentUserInfo = null;
    }

    // Case D: UserInfo must return the exact case-sensitive id_token subject.
    {
      const txIssued = issueOidcTransactionCookieValue({
        redirectUri: TEST_REDIRECT_URI,
        nextPath: '/dashboard',
        mode: 'register',
      });
      const idTokenSub = 'Opaque-Sub-Exact-Case';
      currentIdToken = signTestJwt({
        iss: TEST_ISSUER,
        aud: TEST_CLIENT_ID,
        sub: idTokenSub,
        nonce: txIssued.transaction.nonce,
        iat: nowSec - 5,
        exp: nowSec + 3600,
      });
      currentUserInfo = {
        sub: idTokenSub.toLowerCase(),
        email: 'mismatched-userinfo@qlaok.vn',
        name: 'Mismatched UserInfo',
      };

      const res = await authCallbackGet(
        new Request(
          `https://qlaok.vunph.click/api/auth/callback?code=code-userinfo-mismatch&state=${txIssued.transaction.state}`,
          {
            headers: {
              Cookie: `${OIDC_TX_COOKIE_NAME}=${txIssued.cookieValue}`,
            },
          }
        )
      );
      assert.equal(res.status, 401);
      assert.equal((await res.json()).code, 'OIDC_USERINFO_SUB_MISMATCH');
      assert.equal(
        profiles.some((p) => p.email === 'mismatched-userinfo@qlaok.vn'),
        false
      );
      currentUserInfo = null;
    }

    // Case E: Email collision with a different UUID is rejected (409 OIDC_PROFILE_ID_CONFLICT) — never re-keys existing profile
    {
      const txIssued = issueOidcTransactionCookieValue({
        redirectUri: TEST_REDIRECT_URI,
        nextPath: '/dashboard',
        mode: 'login',
      });
      const conflictingUuid = '11111111-2222-4333-8444-555555555555';
      currentIdToken = signTestJwt({
        iss: TEST_ISSUER,
        aud: TEST_CLIENT_ID,
        sub: conflictingUuid,
        email: 'existing-pro@qlaok.vn', // already belongs to existingOwnerUuid!
        nonce: txIssued.transaction.nonce,
        iat: nowSec - 5,
        exp: nowSec + 3600,
      });

      const res = await authCallbackGet(
        new Request(
          `https://qlaok.vunph.click/api/auth/callback?code=code-conflict&state=${txIssued.transaction.state}`,
          {
            headers: {
              Cookie: `${OIDC_TX_COOKIE_NAME}=${txIssued.cookieValue}`,
            },
          }
        )
      );
      assert.equal(res.status, 409);
      assert.equal((await res.json()).code, 'OIDC_PROFILE_ID_CONFLICT');
    }

    // Case F: Super Admin UUID (a3a30894-e8ae-415d-a3dc-7947b0399dd1) routes to /admin with role=admin
    {
      const txIssued = issueOidcTransactionCookieValue({
        redirectUri: TEST_REDIRECT_URI,
        nextPath: '/dashboard',
        mode: 'login',
      });
      currentIdToken = signTestJwt({
        iss: TEST_ISSUER,
        aud: TEST_CLIENT_ID,
        sub: superAdminUuid,
        email: SUPER_ADMIN_EMAIL,
        nonce: txIssued.transaction.nonce,
        iat: nowSec - 5,
        exp: nowSec + 3600,
      });

      const res = await authCallbackGet(
        new Request(
          `https://qlaok.vunph.click/api/auth/callback?code=code-admin&state=${txIssued.transaction.state}`,
          {
            headers: {
              Cookie: `${OIDC_TX_COOKIE_NAME}=${txIssued.cookieValue}`,
            },
          }
        )
      );
      assert.equal(res.status, 302);
      assert.equal(
        res.headers.get('location'),
        'https://qlaok.vunph.click/admin'
      );

      const sessionCookie = extractCookieValue(res, SESSION_COOKIE_NAME);
      const decoded = verifySessionToken(sessionCookie!);
      assert.ok(decoded);
      assert.equal(decoded.sub, superAdminUuid);
      assert.equal(decoded.role, 'admin');
    }

    // Case G: If Super Admin profile does not exist in DB, an unprovisioned UUID cannot auto-create a Super Admin profile from token email
    {
      const adminIdx = profiles.findIndex((p) => p.id === superAdminUuid);
      if (adminIdx !== -1) profiles.splice(adminIdx, 1);

      const txIssued = issueOidcTransactionCookieValue({
        redirectUri: TEST_REDIRECT_URI,
        nextPath: '/admin',
        mode: 'register',
      });
      currentIdToken = signTestJwt({
        iss: TEST_ISSUER,
        aud: TEST_CLIENT_ID,
        sub: '33333333-4444-4555-8666-777777777777',
        email: SUPER_ADMIN_EMAIL,
        nonce: txIssued.transaction.nonce,
        iat: nowSec - 5,
        exp: nowSec + 3600,
      });

      const res = await authCallbackGet(
        new Request(
          `https://qlaok.vunph.click/api/auth/callback?code=code-fake-admin&state=${txIssued.transaction.state}`,
          {
            headers: {
              Cookie: `${OIDC_TX_COOKIE_NAME}=${txIssued.cookieValue}`,
            },
          }
        )
      );
      assert.equal(res.status, 403);
      assert.equal(
        (await res.json()).code,
        'FORBIDDEN_SUPER_ADMIN_AUTO_CREATE'
      );
    }
  } finally {
    setSupabaseDbClientForTests(null);
    setZitadelOidcTestHooks(null);
    clearZitadelOidcCaches();
    delete process.env.ZITADEL_CLIENT_ID;
    delete process.env.ZITADEL_REDIRECT_URI;
  }
});

test('verifyRequestUser accepts Qlaok sessions, staff sessions, and verified Zitadel JWTs while rejecting invalid JWTs and forged admin claims', async () => {
  process.env.ZITADEL_ISSUER_URL = TEST_ISSUER;
  process.env.ZITADEL_CLIENT_ID = TEST_CLIENT_ID;
  clearZitadelOidcCaches();

  const ownerUuid = EXISTING_IMPORTED_UUIDS[2]; // 0a40219c-49d0-4391-a2df-c7a5f58237a5
  const adminUuid = EXISTING_IMPORTED_UUIDS[0]; // a3a30894-e8ae-415d-a3dc-7947b0399dd1

  const { client } = createInMemoryOidcDb([
    {
      id: ownerUuid,
      zitadel_sub: 'zitadel-owner-opaque-01',
      email: 'merchant3@qlaok.vn',
      full_name: 'Merchant 3',
      plan: 'free',
    },
    {
      id: adminUuid,
      email: SUPER_ADMIN_EMAIL,
      full_name: 'Super Admin',
      plan: 'premium',
    },
  ]);

  setSupabaseDbClientForTests(client as never);
  setZitadelOidcTestHooks({
    discovery: TEST_DISCOVERY,
    jwks: { keys: [TEST_JWK] },
  });

  try {
    const nowSec = Math.floor(Date.now() / 1000);

    // 1. Opaque Zitadel sub resolves through the DB map; forged claims cannot change DB authority.
    const ownerJwt = signTestJwt({
      iss: TEST_ISSUER,
      aud: [TEST_CLIENT_ID, 'other-resource'],
      sub: 'zitadel-owner-opaque-01',
      email: SUPER_ADMIN_EMAIL, // Forged Super Admin email claim in JWT must be ignored in favor of canonical DB profile email
      role: 'admin',
      is_admin: true,
      iat: nowSec - 10,
      exp: nowSec + 600,
    });

    const verifiedOwner = await verifyRequestUser(
      new Request('https://qlaok.vunph.click/api/shops', {
        headers: { Authorization: `Bearer ${ownerJwt}` },
      })
    );
    assert.ok(verifiedOwner);
    assert.equal(verifiedOwner.sub, ownerUuid);
    assert.equal(verifiedOwner.email, 'merchant3@qlaok.vn');
    assert.equal(verifiedOwner.role, 'owner');
    assert.equal(verifiedOwner.account_type, 'owner');

    const adminGuardForOwner = await requireSuperAdmin(
      new Request('https://qlaok.vunph.click/api/admin', {
        headers: { Authorization: `Bearer ${ownerJwt}` },
      })
    );
    assert.ok(adminGuardForOwner.errorResponse);
    assert.equal(adminGuardForOwner.errorResponse.status, 403);

    // 2. Valid Zitadel JWT for Super Admin (even when email is resolved from DB by UUID sub) -> verified as 'admin'
    const adminJwtWithoutEmailClaim = signTestJwt({
      iss: TEST_ISSUER,
      aud: TEST_CLIENT_ID,
      sub: adminUuid,
      iat: nowSec - 10,
      exp: nowSec + 600,
    });

    const verifiedAdmin = await verifyRequestUser(
      new Request('https://qlaok.vunph.click/api/admin', {
        headers: { Authorization: `Bearer ${adminJwtWithoutEmailClaim}` },
      })
    );
    assert.ok(verifiedAdmin);
    assert.equal(verifiedAdmin.sub, adminUuid);
    assert.equal(verifiedAdmin.email, SUPER_ADMIN_EMAIL);
    assert.equal(verifiedAdmin.role, 'admin');

    // 3. Zitadel JWT with staff subject or malformed subject is rejected (null)
    const staffSubJwt = signTestJwt({
      iss: TEST_ISSUER,
      aud: TEST_CLIENT_ID,
      sub: 'staff-acct-shop1-cashier',
      iat: nowSec - 10,
      exp: nowSec + 600,
    });
    assert.equal(
      await verifyRequestUser(
        new Request('https://qlaok.vunph.click/api/orders', {
          headers: { Authorization: `Bearer ${staffSubJwt}` },
        })
      ),
      null
    );

    const paddedUuidJwt = signTestJwt({
      iss: TEST_ISSUER,
      aud: TEST_CLIENT_ID,
      sub: ` ${ownerUuid} `,
      email: 'merchant3@qlaok.vn',
      iat: nowSec - 10,
      exp: nowSec + 600,
    });
    assert.equal(
      await verifyRequestUser(
        new Request('https://qlaok.vunph.click/api/orders', {
          headers: { Authorization: `Bearer ${paddedUuidJwt}` },
        })
      ),
      null,
      'Whitespace-padded UUID sub must be rejected rather than trimmed'
    );

    // 4. Validly signed Zitadel JWT for a UUID with NO public.profiles row (or unsynced row without email) fails closed (null / 401) — even if token email is SUPER_ADMIN_EMAIL
    const unprovisionedUuid = '99999999-8888-4777-8666-555555555555';
    const unprovisionedAdminJwt = signTestJwt({
      iss: TEST_ISSUER,
      aud: TEST_CLIENT_ID,
      sub: unprovisionedUuid,
      email: SUPER_ADMIN_EMAIL,
      role: 'admin',
      is_admin: true,
      iat: nowSec - 10,
      exp: nowSec + 600,
    });
    assert.equal(
      await verifyRequestUser(
        new Request('https://qlaok.vunph.click/api/shops', {
          headers: { Authorization: `Bearer ${unprovisionedAdminJwt}` },
        })
      ),
      null,
      'Missing public.profiles row must fail closed and never authorize owner or admin from token claims'
    );
    const unprovisionedGuard = await requireAuthenticatedUser(
      new Request('https://qlaok.vunph.click/api/shops', {
        headers: { Authorization: `Bearer ${unprovisionedAdminJwt}` },
      })
    );
    assert.ok(unprovisionedGuard.errorResponse);
    assert.equal(unprovisionedGuard.errorResponse.status, 401);

    const unsyncedEmailDb = createInMemoryOidcDb([
      {
        id: unprovisionedUuid,
        email: '',
        full_name: 'Incomplete Row',
        plan: 'free',
      },
    ]);
    setSupabaseDbClientForTests(unsyncedEmailDb.client as never);
    assert.equal(
      await verifyRequestUser(
        new Request('https://qlaok.vunph.click/api/shops', {
          headers: { Authorization: `Bearer ${unprovisionedAdminJwt}` },
        })
      ),
      null,
      'Profile row with empty email must fail closed and never fall back to token email'
    );

    // 5. Database error or thrown exception during profile lookup fails closed (null) while staff HMAC tokens remain unaffected
    const staffHmacToken = issueSessionToken({
      id: 'staff-acct-001',
      username: 'thungan01',
      shop_id: 'shop-fnb-001',
      account_type: 'staff',
      role: 'cashier',
      sv: 1,
    });

    const erroringDbClient = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({
                    data: null,
                    error: { message: 'connection refused to postgres' },
                  }),
                };
              },
            };
          },
        };
      },
    };
    setSupabaseDbClientForTests(erroringDbClient as never);

    assert.equal(
      await verifyRequestUser(
        new Request('https://qlaok.vunph.click/api/shops', {
          headers: { Authorization: `Bearer ${ownerJwt}` },
        })
      ),
      null,
      'DB query error on public.profiles must fail closed for Zitadel JWT'
    );
    assert.equal(
      await verifyRequestUser(
        new Request('https://qlaok.vunph.click/api/admin', {
          headers: { Authorization: `Bearer ${adminJwtWithoutEmailClaim}` },
        })
      ),
      null,
      'DB query error on public.profiles must fail closed for Admin Zitadel JWT'
    );

    const throwingDbClient = {
      from() {
        throw new Error('Unexpected database pool crash');
      },
    };
    setSupabaseDbClientForTests(throwingDbClient as never);

    assert.equal(
      await verifyRequestUser(
        new Request('https://qlaok.vunph.click/api/shops', {
          headers: { Authorization: `Bearer ${ownerJwt}` },
        })
      ),
      null,
      'Thrown DB exception on public.profiles must fail closed for Zitadel JWT'
    );

    // 6. Signed Qlaok staff session token (Bearer and Cookie) continues to be accepted by verifyRequestUser even when DB throws
    const verifiedStaffBearer = await verifyRequestUser(
      new Request('https://qlaok.vunph.click/api/orders', {
        headers: { Authorization: `Bearer ${staffHmacToken}` },
      })
    );
    assert.ok(verifiedStaffBearer);
    assert.equal(verifiedStaffBearer.sub, 'staff-acct-001');
    assert.equal(verifiedStaffBearer.account_type, 'staff');
    assert.equal(verifiedStaffBearer.shop_id, 'shop-fnb-001');
    assert.equal(verifiedStaffBearer.role, 'cashier');

    const verifiedStaffCookie = await verifyRequestUser(
      new Request('https://qlaok.vunph.click/api/orders', {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${staffHmacToken}` },
      })
    );
    assert.ok(verifiedStaffCookie);
    assert.equal(verifiedStaffCookie.sub, 'staff-acct-001');
    assert.equal(verifiedStaffCookie.account_type, 'staff');
    assert.equal(verifiedStaffCookie.shop_id, 'shop-fnb-001');
    assert.equal(verifiedStaffCookie.role, 'cashier');
  } finally {
    setSupabaseDbClientForTests(null);
    setZitadelOidcTestHooks(null);
    clearZitadelOidcCaches();
    delete process.env.ZITADEL_CLIENT_ID;
  }
});

test('POST /api/auth action=oidc_mobile_exchange enforces qlaok://auth/callback, PKCE, nonce, audience, profile sync, and PostgREST authenticated JWT minting', async () => {
  const mobileClientId = '312345678901234567@qlaok_mobile';
  const mobileOwnerSub = 'Mobile-Case-Sensitive-Sub-01';
  const existingOwnerUuid = EXISTING_IMPORTED_UUIDS[1]; // 7d21f8ae-6b7c-414b-ba28-3f932ab062f7
  const nowSec = Math.floor(Date.now() / 1000);
  const pkce = createPkcePair();

  delete process.env.ZITADEL_CLIENT_ID;
  delete process.env.NEXT_PUBLIC_ZITADEL_CLIENT_ID;
  delete process.env.ZITADEL_MOBILE_CLIENT_ID;
  delete process.env.EXPO_PUBLIC_ZITADEL_CLIENT_ID;
  delete process.env.PGRST_JWT_SECRET;
  delete process.env.SUPABASE_JWT_SECRET;

  // 1. Fail closed when mobile client ID is not configured
  {
    const res = await authPost(
      new Request('https://qlaok.vunph.click/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'oidc_mobile_exchange',
          code: 'code-1',
          codeVerifier: pkce.codeVerifier,
          redirectUri: DEFAULT_MOBILE_REDIRECT_URI,
          nonce: 'nonce-1',
        }),
      })
    );
    assert.equal(res.status, 500);
    assert.equal((await res.json()).code, 'ZITADEL_CLIENT_ID_MISSING');
  }

  process.env.ZITADEL_ISSUER_URL = TEST_ISSUER;
  process.env.ZITADEL_MOBILE_CLIENT_ID = mobileClientId;

  // 2. Reject mismatched redirectUri (must be qlaok://auth/callback)
  {
    const res = await authPost(
      new Request('https://qlaok.vunph.click/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'oidc_mobile_exchange',
          code: 'code-1',
          codeVerifier: pkce.codeVerifier,
          redirectUri: 'https://qlaok.vunph.click/api/auth/callback',
          nonce: 'nonce-1',
          clientId: mobileClientId,
        }),
      })
    );
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, 'OIDC_REDIRECT_URI_MISMATCH');
  }

  // 3. Reject mismatched clientId or invalid PKCE verifier
  {
    const badClientRes = await authPost(
      new Request('https://qlaok.vunph.click/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'oidc_mobile_exchange',
          code: 'code-1',
          codeVerifier: pkce.codeVerifier,
          redirectUri: DEFAULT_MOBILE_REDIRECT_URI,
          nonce: 'nonce-1',
          clientId: 'wrong-client-id',
        }),
      })
    );
    assert.equal(badClientRes.status, 400);
    assert.equal((await badClientRes.json()).code, 'OIDC_CLIENT_ID_MISMATCH');

    const badPkceRes = await authPost(
      new Request('https://qlaok.vunph.click/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'oidc_mobile_exchange',
          code: 'code-1',
          codeVerifier: 'short',
          redirectUri: DEFAULT_MOBILE_REDIRECT_URI,
          nonce: 'nonce-1',
          clientId: mobileClientId,
        }),
      })
    );
    assert.equal(badPkceRes.status, 400);
    assert.equal((await badPkceRes.json()).code, 'OIDC_PKCE_VERIFIER_INVALID');
  }

  // 4. Valid mobile exchange preserves existing owner profile plan and issues Qlaok session + PostgREST authenticated JWT
  const { client, profileWrites } = createInMemoryOidcDb(
    [
      {
        id: existingOwnerUuid,
        zitadel_sub: mobileOwnerSub,
        email: 'owner.mobile@qlaok.vn',
        full_name: 'Chủ Quán Đà Nẵng',
        plan: 'pro',
        plan_expires_at: '2027-06-01T00:00:00.000Z',
        role: 'owner',
        is_admin: false,
      },
    ],
    [
      {
        id: 'shop-mobile-001',
        owner_id: existingOwnerUuid,
        slug: 'bun-cha-ca-dn',
        name: 'Bún Chả Cá Đà Nẵng',
      },
    ]
  );
  setSupabaseDbClientForTests(client as never);

  const expectedNonce = 'mobile-nonce-xyz-987';
  const idToken = signTestJwt({
    iss: TEST_ISSUER,
    aud: mobileClientId,
    sub: mobileOwnerSub,
    name: 'Overridden Name Ignored Because Profile Has Name',
    nonce: expectedNonce,
    iat: nowSec - 5,
    exp: nowSec + 3600,
  });

  let capturedTokenParams = new URLSearchParams();
  let mobileUserInfoSub = mobileOwnerSub;
  setZitadelOidcTestHooks({
    discovery: TEST_DISCOVERY,
    jwks: { keys: [TEST_JWK] },
    nowSeconds: () => nowSec,
    fetch: async (input, init) => {
      const url = String(input);
      if (url === TEST_DISCOVERY.token_endpoint) {
        capturedTokenParams = new URLSearchParams(String(init?.body || ''));
        return new Response(
          JSON.stringify({
            access_token: 'zitadel-access-token',
            token_type: 'Bearer',
            expires_in: 3600,
            id_token: idToken,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url === TEST_DISCOVERY.userinfo_endpoint) {
        return new Response(
          JSON.stringify({
            sub: mobileUserInfoSub,
            email: 'owner.mobile@qlaok.vn',
            email_verified: true,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    },
  });

  try {
    // 4a. Without PGRST_JWT_SECRET configured -> postgrestToken is null (fail-closed, never anon/service_role)
    const resWithoutPgSecret = await authPost(
      new Request('https://qlaok.vunph.click/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'oidc_mobile_exchange',
          code: 'mobile-auth-code-001',
          codeVerifier: pkce.codeVerifier,
          redirectUri: DEFAULT_MOBILE_REDIRECT_URI,
          nonce: expectedNonce,
          state: 'mobile-state-001',
          expectedState: 'mobile-state-001',
          clientId: mobileClientId,
        }),
      })
    );
    assert.equal(resWithoutPgSecret.status, 200);
    const dataWithoutPg = await resWithoutPgSecret.json();
    assert.equal(capturedTokenParams.get('grant_type'), 'authorization_code');
    assert.equal(capturedTokenParams.get('client_id'), mobileClientId);
    assert.equal(
      capturedTokenParams.get('redirect_uri'),
      'qlaok://auth/callback'
    );
    assert.equal(capturedTokenParams.get('code_verifier'), pkce.codeVerifier);

    assert.equal(dataWithoutPg.user.id, existingOwnerUuid);
    assert.equal(dataWithoutPg.user.plan, 'pro');
    assert.equal(dataWithoutPg.user.full_name, 'Chủ Quán Đà Nẵng');
    assert.equal(typeof dataWithoutPg.accessToken, 'string');
    assert.equal(dataWithoutPg.postgrestToken, null);

    // 4b. With PGRST_JWT_SECRET configured -> issues short-lived HS256 JWT with role='authenticated' and sub=existingOwnerUuid
    process.env.PGRST_JWT_SECRET =
      'self-hosted-postgrest-jwt-secret-key-minimum-32-chars!!';

    const resWithPgSecret = await authPost(
      new Request('https://qlaok.vunph.click/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'oidc_mobile_exchange',
          code: 'mobile-auth-code-002',
          codeVerifier: pkce.codeVerifier,
          redirectUri: DEFAULT_MOBILE_REDIRECT_URI,
          nonce: expectedNonce,
          state: 'mobile-state-002',
          expectedState: 'mobile-state-002',
          clientId: mobileClientId,
        }),
      })
    );
    assert.equal(resWithPgSecret.status, 200);
    const dataWithPg = await resWithPgSecret.json();
    assert.equal(typeof dataWithPg.postgrestToken, 'string');

    const verifiedPgClaims = verifyPostgrestAuthenticatedJwt(
      dataWithPg.postgrestToken,
      nowSec
    );
    assert.ok(verifiedPgClaims);
    assert.equal(verifiedPgClaims.sub, existingOwnerUuid);
    assert.equal(verifiedPgClaims.role, 'authenticated');
    assert.equal(verifiedPgClaims.aud, 'authenticated');
    assert.equal(verifiedPgClaims.iss, 'qlaok-postgrest');
    assert.equal(verifiedPgClaims.exp - verifiedPgClaims.iat, 3600);

    // Verify verifyRequestUser also accepts the issued PostgREST authenticated JWT
    const verifiedFromReq = await verifyRequestUser(
      new Request('https://qlaok.vunph.click/api/shops', {
        headers: { Authorization: `Bearer ${dataWithPg.postgrestToken}` },
      })
    );
    assert.ok(verifiedFromReq);
    assert.equal(verifiedFromReq.sub, existingOwnerUuid);
    assert.equal(verifiedFromReq.role, 'owner');

    // A case-only subject mismatch must fail closed before profile synchronization.
    mobileUserInfoSub = mobileOwnerSub.toLowerCase();
    const mismatchedUserInfoRes = await authPost(
      new Request('https://qlaok.vunph.click/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'oidc_mobile_exchange',
          code: 'mobile-auth-code-userinfo-mismatch',
          codeVerifier: pkce.codeVerifier,
          redirectUri: DEFAULT_MOBILE_REDIRECT_URI,
          nonce: expectedNonce,
          clientId: mobileClientId,
        }),
      })
    );
    assert.equal(mismatchedUserInfoRes.status, 401);
    assert.equal(
      (await mismatchedUserInfoRes.json()).code,
      'OIDC_USERINFO_SUB_MISMATCH'
    );
    assert.equal(profileWrites.length, 0);

    // Verify issuePostgrestAuthenticatedJwt refuses staff IDs and non-UUIDs
    assert.equal(
      issuePostgrestAuthenticatedJwt({
        sub: 'staff-acct-shop1-cashier',
        email: 'staff@qlaok.local',
      }),
      null
    );
    assert.equal(
      issuePostgrestAuthenticatedJwt({
        sub: 'owner-fnb-001',
        email: 'chuquan@qlaok.vn',
      }),
      null
    );
  } finally {
    setSupabaseDbClientForTests(null);
    setZitadelOidcTestHooks(null);
    clearZitadelOidcCaches();
    delete process.env.ZITADEL_MOBILE_CLIENT_ID;
    delete process.env.PGRST_JWT_SECRET;
  }
});
