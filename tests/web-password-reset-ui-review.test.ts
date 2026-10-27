import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { POST as loginUiPost } from '../src/app/api/auth/login-ui/route';
import {
  resetAuthEmailTestHooks,
  setAuthEmailSenderForTests,
  type AuthEmailSendPayload,
} from '../src/lib/auth-email';
import {
  buildQlaokPasswordResetUrl,
  buildZitadelPasswordResetUrlTemplate,
  resetZitadelLoginUiRateLimitsForTests,
} from '../src/lib/zitadel-login-ui';

test('Production password reset links ignore caller-controlled origins', () => {
  const mutableEnv = process.env as Record<string, string | undefined>;
  const previousNodeEnv = mutableEnv.NODE_ENV;
  const previousRedirectUri = mutableEnv.ZITADEL_REDIRECT_URI;
  mutableEnv.NODE_ENV = 'production';
  delete mutableEnv.ZITADEL_REDIRECT_URI;
  try {
    assert.equal(
      buildZitadelPasswordResetUrlTemplate('https://attacker.example', {
        issuerUrl: 'https://auth.vunph.click',
        webRedirectUri: 'https://attacker.example/api/auth/callback',
      }),
      'https://qlaok.vunph.click/login?mode=reset&userID={{.UserID}}&code={{.Code}}&orgID={{.OrgID}}'
    );
    assert.equal(
      buildQlaokPasswordResetUrl({
        origin: 'https://attacker.example',
        userId: '289911223344556677',
        code: '123456',
        lang: 'vi',
        config: {
          issuerUrl: 'https://auth.vunph.click',
          webRedirectUri: 'https://attacker.example/api/auth/callback',
        },
      }),
      'https://qlaok.vunph.click/login?mode=reset&userID=289911223344556677&code=123456&lang=vi'
    );
  } finally {
    if (previousNodeEnv === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previousNodeEnv;
    if (previousRedirectUri === undefined) {
      delete mutableEnv.ZITADEL_REDIRECT_URI;
    } else {
      mutableEnv.ZITADEL_REDIRECT_URI = previousRedirectUri;
    }
  }
});

test('Web login page password reset UI contract and source review', () => {
  const loginPageSource = fs.readFileSync(
    path.join(process.cwd(), 'src/app/(auth)/login/page.tsx'),
    'utf8'
  );

  // 1. Password reset mode states exist
  assert.match(loginPageSource, /resetStep/);
  assert.match(loginPageSource, /'request_form'/);
  assert.match(loginPageSource, /'request_sent'/);
  assert.match(loginPageSource, /'complete_form'/);
  assert.match(loginPageSource, /'complete_success'/);

  // 2. Extracts userID / userId and code / verificationCode from URL parameters
  assert.match(loginPageSource, /searchParams\.get\(['"]userID['"]\)/);
  assert.match(loginPageSource, /searchParams\.get\(['"]code['"]\)/);

  // 3. Strips one-time userID and code without deleting authRequest or other parameters
  assert.match(loginPageSource, /searchParams\.delete\(['"]userID['"]\)/);
  assert.match(loginPageSource, /searchParams\.delete\(['"]code['"]\)/);
  assert.match(loginPageSource, /window\.history\.replaceState/);
  assert.doesNotMatch(
    loginPageSource,
    /searchParams\.delete\(['"]authRequest['"]\)/
  );

  // 4. Submits password_reset_request and password_reset_complete to POST /api/auth/login-ui
  assert.match(loginPageSource, /action:\s*['"]password_reset_request['"]/);
  assert.match(loginPageSource, /action:\s*['"]password_reset_complete['"]/);
  assert.match(loginPageSource, /\/api\/auth\/login-ui/);

  // 5. TestIDs for the forms and inputs
  assert.match(loginPageSource, /data-testid="login-reset-email-input"/);
  assert.match(loginPageSource, /data-testid="login-reset-submit-btn"/);
  assert.match(loginPageSource, /data-testid="login-reset-new-password-input"/);
  assert.match(loginPageSource, /data-testid="login-reset-confirm-password-input"/);
  assert.match(loginPageSource, /data-testid="login-reset-complete-submit-btn"/);
  assert.match(loginPageSource, /data-testid="login-reset-back-to-signin-btn"/);

  // 6. Enforces strong password criteria on client side
  assert.match(loginPageSource, /\[a-z\]/);
  assert.match(loginPageSource, /\[A-Z\]/);
  assert.match(loginPageSource, /\[0-9\]/);
  assert.match(loginPageSource, /\[\^A-Za-z0-9\\s\]/);

  // 7. When mode === 'reset', never redirects to hosted Zitadel OIDC
  const resetHandlerMatch = loginPageSource.match(
    /if\s*\(mode\s*===\s*['"]reset['"]\)\s*\{[\s\S]*?return;\s*\}/
  );
  assert.ok(resetHandlerMatch, 'mode === "reset" must return directly in handleSubmit');
  assert.doesNotMatch(
    resetHandlerMatch[0],
    /handleOwnerOidcRedirect/,
    'Reset handler must not redirect to OIDC start'
  );

  // 8. Never uses Supabase auth for recovery
  assert.doesNotMatch(loginPageSource, /supabase.*resetPassword/i);
  assert.doesNotMatch(loginPageSource, /supabase.*recovery/i);

  // 9. Never logs credentials, email, password, or tokens
  assert.doesNotMatch(loginPageSource, /console\.(log|info|warn|error|debug)/);
});

test('Web password reset API integration: simulates client request and complete flows via POST /api/auth/login-ui', async () => {
  const prevFetch = globalThis.fetch;
  const prevIssuer = process.env.ZITADEL_ISSUER_URL;
  const prevPat = process.env.ZITADEL_LOGIN_CLIENT_PAT;
  const prevWebClient = process.env.ZITADEL_CLIENT_ID;

  process.env.ZITADEL_ISSUER_URL = 'https://auth.example.test';
  process.env.ZITADEL_LOGIN_CLIENT_PAT = 'test-service-pat';
  process.env.ZITADEL_CLIENT_ID = 'test-web-client';
  resetZitadelLoginUiRateLimitsForTests();

  try {
    const sentEmails: AuthEmailSendPayload[] = [];
    setAuthEmailSenderForTests(async (payload) => {
      sentEmails.push(payload);
    });
    let resetRequestBody: Record<string, unknown> | null = null;
    let passwordCompletionBody: Record<string, unknown> | null = null;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/v2/users') && method === 'POST') {
        return new Response(
          JSON.stringify({
            result: [
              {
                userId: '289911223344556677',
                state: 'USER_STATE_ACTIVE',
                human: {
                  email: {
                    email: 'owner@example.test',
                    isVerified: true,
                  },
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (
        url.endsWith('/v2/users/289911223344556677/password_reset') &&
        method === 'POST'
      ) {
        resetRequestBody = JSON.parse(String(init?.body || '{}'));
        return new Response(JSON.stringify({ verificationCode: '123456' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (
        url.endsWith('/v2/users/289911223344556677/password') &&
        method === 'POST'
      ) {
        passwordCompletionBody = JSON.parse(String(init?.body || '{}'));
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200 });
    };

    // 1. Password reset request from web client
    const reqRes = await loginUiPost(
      new Request('https://qlaok.vunph.click/api/auth/login-ui', {
        method: 'POST',
        headers: {
          Origin: 'https://qlaok.vunph.click',
          'Content-Type': 'application/json',
          'X-Real-IP': '203.0.113.195',
        },
        body: JSON.stringify({
          action: 'password_reset_request',
          email: 'owner@example.test',
          lang: 'vi',
        }),
      })
    );
    assert.equal(reqRes.status, 200);
    const reqBody = (await reqRes.json()) as Record<string, unknown>;
    assert.deepEqual(reqBody, { ok: true });
    assert.deepEqual(resetRequestBody, {
      returnCode: {},
    });
    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0]?.kind, 'password_reset');
    assert.equal(sentEmails[0]?.locale, 'vi');
    assert.equal(
      sentEmails[0]?.actionUrl,
      'https://qlaok.vunph.click/login?mode=reset&userID=289911223344556677&code=123456&lang=vi'
    );

    // 2. Password reset complete with matching valid parameters
    const compRes = await loginUiPost(
      new Request('https://qlaok.vunph.click/api/auth/login-ui', {
        method: 'POST',
        headers: {
          Origin: 'https://qlaok.vunph.click',
          'Content-Type': 'application/json',
          'X-Real-IP': '203.0.113.195',
        },
        body: JSON.stringify({
          action: 'password_reset_complete',
          userID: '289911223344556677',
          code: '123456',
          password: 'NewStrongPassword@2026',
          confirmPassword: 'NewStrongPassword@2026',
          lang: 'vi',
        }),
      })
    );
    assert.equal(compRes.status, 200);
    const compBody = (await compRes.json()) as Record<string, unknown>;
    assert.deepEqual(compBody, { ok: true });
    assert.deepEqual(passwordCompletionBody, {
      newPassword: {
        password: 'NewStrongPassword@2026',
        changeRequired: false,
      },
      verificationCode: '123456',
    });
  } finally {
    resetAuthEmailTestHooks();
    globalThis.fetch = prevFetch;
    if (prevIssuer === undefined) delete process.env.ZITADEL_ISSUER_URL;
    else process.env.ZITADEL_ISSUER_URL = prevIssuer;
    if (prevPat === undefined) delete process.env.ZITADEL_LOGIN_CLIENT_PAT;
    else process.env.ZITADEL_LOGIN_CLIENT_PAT = prevPat;
    if (prevWebClient === undefined) delete process.env.ZITADEL_CLIENT_ID;
    else process.env.ZITADEL_CLIENT_ID = prevWebClient;
    resetZitadelLoginUiRateLimitsForTests();
  }
});
