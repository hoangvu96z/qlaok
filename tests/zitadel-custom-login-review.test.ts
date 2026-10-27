import assert from 'node:assert/strict';
import test from 'node:test';
import {
  completeZitadelLoginRequest,
  fetchZitadelLoginRequest,
  getHostedRegistrationUrl,
  isRegistrationLoginRequest,
  type ZitadelLoginUiConfig,
  ZitadelLoginUiError,
} from '../src/lib/zitadel-login-ui';
import { GET as loginUiGet, POST as loginUiPost } from '../src/app/api/auth/login-ui/route';

const authRequestId = 'V2_224908753244265546';
const config: ZitadelLoginUiConfig = {
  issuerUrl: 'https://auth.example.test',
  serviceToken: 'server-only-token',
  webClientId: 'web-client',
  mobileClientId: 'mobile-client',
  webRedirectUri: 'https://qlaok.example.test/api/auth/callback',
  mobileRedirectUri: 'qlaok://auth/callback',
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function authRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: authRequestId,
    clientId: config.webClientId,
    redirectUri: config.webRedirectUri,
    loginHint: 'owner@example.test',
    ...overrides,
  };
}

test('registration keeps its original flow outside the custom password form', () => {
  const url = getHostedRegistrationUrl(
    {
      id: authRequestId,
      clientId: config.webClientId,
      redirectUri: config.webRedirectUri,
      prompt: ['create'],
    },
    config.issuerUrl
  );
  const parsed = new URL(url);
  assert.equal(parsed.origin, config.issuerUrl);
  assert.equal(parsed.pathname, '/ui/v2/login/loginname');
  assert.equal(parsed.searchParams.get('authRequest'), authRequestId);
});

test('custom login accepts only configured Qlaok clients and callbacks', async () => {
  await assert.rejects(
    () =>
      fetchZitadelLoginRequest(authRequestId, 'https://qlaok.example.test', {
        config,
        fetchImpl: async () =>
          response({
            authRequest: authRequest({
              clientId: 'untrusted-client',
              redirectUri: 'https://attacker.example/callback',
            }),
          }),
      }),
    (error: unknown) =>
      error instanceof ZitadelLoginUiError &&
      error.code === 'AUTH_REQUEST_INVALID'
  );
});

test('custom login uses the latest session token and returns only the checked callback', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith(`/v2/oidc/auth_requests/${authRequestId}`) && init?.method === 'GET') {
      return response({ authRequest: authRequest({ state: 'state-123' }) });
    }
    if (url.endsWith('/v2/sessions') && init?.method === 'POST') {
      return response({
        sessionId: 'session-123',
        sessionToken: 'first-session-token',
      });
    }
    if (url.endsWith('/v2/sessions/session-123') && init?.method === 'PATCH') {
      return response({ sessionToken: 'latest-session-token' });
    }
    if (
      url.endsWith(`/v2/oidc/auth_requests/${authRequestId}`) &&
      init?.method === 'POST'
    ) {
      const body = JSON.parse(String(init.body));
      assert.equal(body.session.sessionId, 'session-123');
      assert.equal(body.session.sessionToken, 'latest-session-token');
      return response({
        callbackUrl:
          'https://qlaok.example.test/api/auth/callback?code=auth-code&state=state-123',
      });
    }
    throw new Error('Unexpected Zitadel request');
  };

  const callbackUrl = await completeZitadelLoginRequest({
    authRequestId,
    loginName: 'owner@example.test',
    password: 'example-password',
    origin: 'https://qlaok.example.test',
    config,
    fetchImpl,
  });

  assert.equal(
    callbackUrl,
    'https://qlaok.example.test/api/auth/callback?code=auth-code&state=state-123'
  );
  assert.equal(calls.length, 4);
  assert.ok(
    calls.every(
      ({ init }) =>
        (init?.headers as Record<string, string>).Authorization ===
        'Bearer server-only-token'
    )
  );
  const passwordRequest = calls.find(({ url, init }) =>
    url.endsWith('/v2/sessions/session-123') && init?.method === 'PATCH'
  );
  assert.ok(passwordRequest);
  assert.match(String(passwordRequest?.init?.body), /example-password/);
});

test('custom login rejects callbacks outside the configured Qlaok URI', async () => {
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith(`/v2/oidc/auth_requests/${authRequestId}`) && init?.method === 'GET') {
      return response({ authRequest: authRequest({ state: 'state-123' }) });
    }
    if (url.endsWith('/v2/sessions')) {
      return response({
        sessionId: 'session-123',
        sessionToken: 'first-session-token',
      });
    }
    if (url.endsWith('/v2/sessions/session-123')) {
      return response({ sessionToken: 'latest-session-token' });
    }
    return response({
      callbackUrl:
        'https://attacker.example/callback?code=auth-code&state=state-123',
    });
  };

  await assert.rejects(
    () =>
      completeZitadelLoginRequest({
        authRequestId,
        loginName: 'owner@example.test',
        password: 'example-password',
        origin: 'https://qlaok.example.test',
        config,
        fetchImpl,
      }),
    (error: unknown) =>
      error instanceof ZitadelLoginUiError &&
      error.code === 'CALLBACK_URL_INVALID'
  );
});

test('a password rejection never finalizes the sign-in request', async () => {
  const requested: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    requested.push(url);
    if (url.endsWith(`/v2/oidc/auth_requests/${authRequestId}`)) {
      return response({ authRequest: authRequest() });
    }
    if (url.endsWith('/v2/sessions')) {
      return response({
        sessionId: 'session-123',
        sessionToken: 'first-session-token',
      });
    }
    return response({ message: 'invalid credentials' }, 400);
  };

  await assert.rejects(
    () =>
      completeZitadelLoginRequest({
        authRequestId,
        loginName: 'owner@example.test',
        password: 'wrong-password',
        origin: 'https://qlaok.example.test',
        config,
        fetchImpl,
      }),
    (error: unknown) =>
      error instanceof ZitadelLoginUiError &&
      error.code === 'LOGIN_REJECTED'
  );
  assert.equal(
    requested.some((url) =>
      url.endsWith(`/v2/oidc/auth_requests/${authRequestId}`)
    ),
    true
  );
  assert.equal(
    requested.filter((url) =>
      url.endsWith(`/v2/oidc/auth_requests/${authRequestId}`)
    ).length,
    1
  );
});

test('custom login normalizes ZITADEL PROMPT_CREATE enum and rejects mismatched authRequest.id', async () => {
  const parsed = await fetchZitadelLoginRequest(
    authRequestId,
    'https://qlaok.example.test',
    {
      config,
      fetchImpl: async () =>
        response({
          authRequest: authRequest({
            prompt: ['PROMPT_CREATE'],
          }),
        }),
    }
  );
  assert.deepEqual(parsed.prompt, ['create']);
  assert.equal(isRegistrationLoginRequest(parsed), true);

  await assert.rejects(
    () =>
      fetchZitadelLoginRequest(authRequestId, 'https://qlaok.example.test', {
        config,
        fetchImpl: async () =>
          response({
            authRequest: authRequest({
              id: 'V2_999999999999999999',
            }),
          }),
      }),
    (error: unknown) =>
      error instanceof ZitadelLoginUiError &&
      error.code === 'AUTH_REQUEST_INVALID' &&
      error.status === 400
  );
});

test('custom login maps expired/consumed authRequest on CreateCallback and rejects fragment or error callbacks', async () => {
  const expiredCallbackFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (
      url.endsWith(`/v2/oidc/auth_requests/${authRequestId}`) &&
      init?.method === 'GET'
    ) {
      return response({ authRequest: authRequest({ state: 'state-123' }) });
    }
    if (url.endsWith('/v2/sessions') && init?.method === 'POST') {
      return response({
        sessionId: 'session-123',
        sessionToken: 'first-session-token',
      });
    }
    if (url.endsWith('/v2/sessions/session-123') && init?.method === 'PATCH') {
      return response({ sessionToken: 'latest-session-token' });
    }
    return response({ message: 'Auth Request does not exist' }, 404);
  };

  await assert.rejects(
    () =>
      completeZitadelLoginRequest({
        authRequestId,
        loginName: 'owner@example.test',
        password: 'example-password',
        origin: 'https://qlaok.example.test',
        config,
        fetchImpl: expiredCallbackFetch,
      }),
    (error: unknown) =>
      error instanceof ZitadelLoginUiError &&
      error.code === 'AUTH_REQUEST_INVALID' &&
      error.status === 400
  );

  for (const invalidCallbackUrl of [
    'https://qlaok.example.test/api/auth/callback?code=auth-code&state=state-123#frag',
    'https://qlaok.example.test/api/auth/callback?code=auth-code&state=state-123&error=access_denied',
  ]) {
    await assert.rejects(
      () =>
        completeZitadelLoginRequest({
          authRequestId,
          loginName: 'owner@example.test',
          password: 'example-password',
          origin: 'https://qlaok.example.test',
          config,
          fetchImpl: async (input, init) => {
            const url = String(input);
            if (
              url.endsWith(`/v2/oidc/auth_requests/${authRequestId}`) &&
              init?.method === 'GET'
            ) {
              return response({
                authRequest: authRequest({ state: 'state-123' }),
              });
            }
            if (url.endsWith('/v2/sessions')) {
              return response({
                sessionId: 'session-123',
                sessionToken: 'first-session-token',
              });
            }
            if (url.endsWith('/v2/sessions/session-123')) {
              return response({ sessionToken: 'latest-session-token' });
            }
            return response({ callbackUrl: invalidCallbackUrl });
          },
        }),
      (error: unknown) =>
        error instanceof ZitadelLoginUiError &&
        error.code === 'CALLBACK_URL_INVALID' &&
        error.status === 502
    );
  }
});

test('/api/auth/login-ui enforces same-origin protection and rejects non-object JSON bodies', async () => {
  const crossSiteGet = await loginUiGet(
    new Request(
      `https://qlaok.example.test/api/auth/login-ui?authRequest=${authRequestId}`,
      {
        method: 'GET',
        headers: { Origin: 'https://attacker.example' },
      }
    )
  );
  assert.equal(crossSiteGet.status, 403);
  assert.equal((await crossSiteGet.json()).code, 'INVALID_ORIGIN');

  const missingOriginPost = await loginUiPost(
    new Request('https://qlaok.example.test/api/auth/login-ui', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authRequestId }),
    })
  );
  assert.equal(missingOriginPost.status, 403);
  assert.equal((await missingOriginPost.json()).code, 'INVALID_ORIGIN');

  for (const rawBody of ['null', '[]', '"string"']) {
    const nonObjectRes = await loginUiPost(
      new Request('https://qlaok.example.test/api/auth/login-ui', {
        method: 'POST',
        headers: {
          Origin: 'https://qlaok.example.test',
          'Content-Type': 'application/json',
        },
        body: rawBody,
      })
    );
    assert.equal(nonObjectRes.status, 400);
    assert.equal((await nonObjectRes.json()).code, 'INVALID_BODY');
  }
});
