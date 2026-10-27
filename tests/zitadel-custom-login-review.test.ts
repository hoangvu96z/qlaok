import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type AuthEmailSendPayload,
  AuthEmailError,
  renderPasswordResetEmail,
  renderRegistrationVerificationEmail,
  resetAuthEmailTestHooks,
  resolveAuthEmailSmtpConfig,
  sendAuthEmail,
  setAuthEmailSenderForTests,
  setNodemailerTransportFactoryForTests,
} from '../src/lib/auth-email';
import { setSupabaseDbClientForTests } from '../src/lib/db';
import {
  bootstrapZitadelOidcAuthRequestId,
  buildQlaokPasswordResetUrl,
  buildZitadelLoginUiRateLimitBucketKey,
  buildZitadelPasswordResetUrlTemplate,
  checkZitadelLoginUiRateLimit,
  completeZitadelLoginRequest,
  completeZitadelPasswordReset,
  completeZitadelRegistrationVerification,
  enforceZitadelLoginUiRateLimit,
  fetchZitadelLoginRequest,
  getClientIp,
  getHostedRegistrationUrl,
  isRegistrationLoginRequest,
  issueZitadelRegistrationTicket,
  PASSWORD_RESET_REQUEST_EMAIL_MAX_ATTEMPTS,
  PASSWORD_RESET_REQUEST_IP_MAX_ATTEMPTS,
  requestZitadelPasswordReset,
  resendZitadelRegistrationCode,
  resetZitadelLoginUiRateLimitsForTests,
  splitOwnerFullNameForZitadel,
  startZitadelRegistration,
  validateOwnerRegistrationPassword,
  verifyZitadelRegistrationTicket,
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
  sendEmail: async () => {},
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
  const fetchImpl: typeof fetch = async (input) => {
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

test('/api/auth/login-ui accepts same-origin POSTs through the HTTPS reverse proxy', async () => {
  const proxiedPost = await loginUiPost(
    new Request('http://127.0.0.1:3005/api/auth/login-ui', {
      method: 'POST',
      headers: {
        Origin: 'https://qlaok.example.test',
        Host: 'qlaok.example.test',
        'X-Forwarded-Proto': 'https',
        'Content-Type': 'application/json',
      },
      body: 'null',
    })
  );
  assert.equal(proxiedPost.status, 400);
  assert.equal((await proxiedPost.json()).code, 'INVALID_BODY');

  const crossSitePost = await loginUiPost(
    new Request('http://127.0.0.1:3005/api/auth/login-ui', {
      method: 'POST',
      headers: {
        Origin: 'https://attacker.example',
        Host: 'qlaok.example.test',
        'X-Forwarded-Proto': 'https',
        'Sec-Fetch-Site': 'cross-site',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ authRequestId }),
    })
  );
  assert.equal(crossSitePost.status, 403);
  assert.equal((await crossSitePost.json()).code, 'INVALID_ORIGIN');
});

test('splitOwnerFullNameForZitadel and validateOwnerRegistrationPassword enforce Qlaok owner registration rules', () => {
  const multiWord = splitOwnerFullNameForZitadel('  Nguyễn   Văn An  ');
  assert.deepEqual(multiWord, {
    displayName: 'Nguyễn Văn An',
    givenName: 'Nguyễn Văn',
    familyName: 'An',
  });

  const singleWord = splitOwnerFullNameForZitadel('Minh');
  assert.deepEqual(singleWord, {
    displayName: 'Minh',
    givenName: 'Minh',
    familyName: 'Minh',
  });

  assert.throws(
    () => splitOwnerFullNameForZitadel('A'),
    (err: unknown) =>
      err instanceof ZitadelLoginUiError && err.code === 'INVALID_FULL_NAME'
  );

  validateOwnerRegistrationPassword('StrongPass1!', 'StrongPass1!');

  for (const weak of ['short1!', 'alllowercase1!', 'ALLUPPERCASE1!', 'NoNumbers!', 'NoSymbol123']) {
    assert.throws(
      () => validateOwnerRegistrationPassword(weak, weak),
      (err: unknown) =>
        err instanceof ZitadelLoginUiError && err.code === 'PASSWORD_WEAK'
    );
  }

  assert.throws(
    () => validateOwnerRegistrationPassword('StrongPass1!', 'DifferentPass1!'),
    (err: unknown) =>
      err instanceof ZitadelLoginUiError && err.code === 'PASSWORD_MISMATCH'
  );
});

test('registration tickets are HMAC-signed, expire deterministically, and reject tampering', () => {
  const nowSec = 1_760_000_000;
  const ticket = issueZitadelRegistrationTicket({
    userId: '289911223344556677',
    email: 'NewOwner@Example.test',
    fullName: 'Nguyễn Văn An',
    authRequestId,
    clientKind: 'web',
    nowSeconds: nowSec,
    ttlSeconds: 900,
  });

  const verified = verifyZitadelRegistrationTicket(ticket, nowSec + 300);
  assert.equal(verified.userId, '289911223344556677');
  assert.equal(verified.email, 'newowner@example.test');
  assert.equal(verified.fullName, 'Nguyễn Văn An');
  assert.equal(verified.authRequestId, authRequestId);
  assert.equal(verified.clientKind, 'web');

  // Tampered signature rejected
  assert.throws(
    () => verifyZitadelRegistrationTicket(`${ticket}x`, nowSec + 300),
    (err: unknown) =>
      err instanceof ZitadelLoginUiError &&
      err.code === 'REGISTRATION_TICKET_INVALID'
  );

  // Expired ticket rejected
  assert.throws(
    () => verifyZitadelRegistrationTicket(ticket, nowSec + 901),
    (err: unknown) =>
      err instanceof ZitadelLoginUiError && err.code === 'REGISTRATION_EXPIRED'
  );
});

test('custom registration uses POST /v2/users/new with temporary password and returnCode, delivers Qlaok verification emails via SMTP, sets user password only after email/verify succeeds, and requests returnCode on resend', async () => {
  resetZitadelLoginUiRateLimitsForTests();
  const calls: Array<{
    url: string;
    method: string;
    auth: string;
    body?: Record<string, unknown>;
  }> = [];
  const deliveredEmails: AuthEmailSendPayload[] = [];
  const regConfig: ZitadelLoginUiConfig = {
    ...config,
    organizationId: 'org-qlaok-123',
    sendEmail: async (payload) => {
      deliveredEmails.push(payload);
    },
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method || 'GET';
    const headers = (init?.headers || {}) as Record<string, string>;
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : undefined;
    calls.push({ url, method, auth: headers.Authorization || '', body });

    if (
      url.endsWith(`/v2/oidc/auth_requests/${authRequestId}`) &&
      method === 'GET'
    ) {
      return response({
        authRequest: authRequest({
          state: 'state-reg-123',
          prompt: ['PROMPT_CREATE'],
        }),
      });
    }
    if (url.endsWith('/v2/users/new') && method === 'POST') {
      return response(
        { id: '289988776655443322', emailCode: '610492' },
        201
      );
    }
    if (
      url.endsWith('/v2/users/289988776655443322/email/resend') &&
      method === 'POST'
    ) {
      return response({ verificationCode: '849201' }, 200);
    }
    if (
      url.endsWith('/v2/users/289988776655443322/email/verify') &&
      method === 'POST'
    ) {
      if (body?.verificationCode !== '849201') {
        return response({ message: 'Invalid verification code' }, 400);
      }
      return response({}, 200);
    }
    if (
      url.endsWith('/v2/users/289988776655443322') &&
      method === 'PATCH'
    ) {
      return response({}, 200);
    }
    if (url.endsWith('/v2/sessions') && method === 'POST') {
      return response({
        sessionId: 'session-reg-1',
        sessionToken: 'session-tok-1',
      });
    }
    if (url.endsWith('/v2/sessions/session-reg-1') && method === 'PATCH') {
      return response({ sessionToken: 'session-tok-2' });
    }
    if (
      url.endsWith(`/v2/oidc/auth_requests/${authRequestId}`) &&
      method === 'POST'
    ) {
      return response({
        callbackUrl:
          'https://qlaok.example.test/api/auth/callback?code=reg-code-999&state=state-reg-123',
      });
    }
    throw new Error(`Unexpected ZITADEL call: ${method} ${url}`);
  };

  // Step 1: Start registration
  const started = await startZitadelRegistration({
    authRequestId,
    fullName: 'Trần Thị Bích',
    email: 'Bich.Tran@Example.test',
    password: 'StrongPass1!',
    confirmPassword: 'StrongPass1!',
    lang: 'vi',
    origin: 'https://qlaok.example.test',
    config: regConfig,
    fetchImpl,
  });

  assert.equal(started.email, 'bich.tran@example.test');
  assert.equal(started.authRequestId, authRequestId);
  assert.ok(started.registrationTicket);
  assert.equal(
    JSON.stringify(started).includes('610492'),
    false,
    'Verification code must never be returned in startZitadelRegistration response'
  );

  assert.equal(
    calls.some((c) => c.url.endsWith('/v2/users/human')),
    false,
    'Deprecated /v2/users/human must never be called'
  );
  const createCall = calls.find((c) => c.url.endsWith('/v2/users/new'));
  assert.ok(createCall);
  assert.equal(createCall.method, 'POST');
  assert.equal(createCall.auth, 'Bearer server-only-token');
  assert.equal(createCall.body?.organizationId, 'org-qlaok-123');
  assert.equal(createCall.body?.username, 'bich.tran@example.test');
  const humanPayload = createCall.body?.human as Record<string, unknown>;
  assert.ok(humanPayload);
  assert.deepEqual(humanPayload.profile, {
    givenName: 'Trần Thị',
    familyName: 'Bích',
    displayName: 'Trần Thị Bích',
    preferredLanguage: 'vi',
  });
  assert.deepEqual(humanPayload.email, {
    email: 'bich.tran@example.test',
    returnCode: {},
  });
  assert.equal(
    (humanPayload.email as Record<string, unknown>)?.sendCode,
    undefined
  );
  // Never marks email verified without proof
  assert.equal(
    (humanPayload.email as Record<string, unknown>)?.isVerified,
    undefined
  );
  // User-supplied password must NEVER reach POST /v2/users/new
  const createPassObj = humanPayload.password as Record<string, unknown>;
  assert.ok(createPassObj);
  assert.equal(typeof createPassObj.password, 'string');
  assert.notEqual(createPassObj.password, 'StrongPass1!');
  assert.ok(String(createPassObj.password).length >= 24);
  assert.equal(createPassObj.changeRequired, false);
  assert.equal(
    JSON.stringify(createCall.body).includes('StrongPass1!'),
    false,
    'User password must never be sent to CreateUser before email verification'
  );

  assert.equal(deliveredEmails.length, 1);
  assert.equal(deliveredEmails[0]?.kind, 'registration_verify');
  assert.equal(deliveredEmails[0]?.locale, 'vi');
  assert.equal(deliveredEmails[0]?.to, 'bich.tran@example.test');
  assert.match(deliveredEmails[0]?.html || '', /610492/);
  assert.match(deliveredEmails[0]?.text || '', /610492/);
  assert.doesNotMatch(
    deliveredEmails[0]?.html || '',
    /href="[^"]*610492[^"]*"/,
    'Registration email must never embed code in an auto-verify link'
  );

  // Step 2: Resend verification code requests { returnCode: {} } and delivers via SMTP
  const resent = await resendZitadelRegistrationCode({
    registrationTicket: started.registrationTicket,
    lang: 'en',
    origin: 'https://qlaok.example.test',
    config: regConfig,
    fetchImpl,
  });
  assert.equal(resent.email, 'bich.tran@example.test');
  assert.equal(
    JSON.stringify(resent).includes('849201'),
    false,
    'Verification code must never be returned in resendZitadelRegistrationCode response'
  );
  const resendCall = calls.find((c) =>
    c.url.endsWith('/v2/users/289988776655443322/email/resend')
  );
  assert.ok(resendCall);
  assert.equal(resendCall.method, 'POST');
  assert.deepEqual(resendCall.body, { returnCode: {} });
  assert.equal(deliveredEmails.length, 2);
  assert.equal(deliveredEmails[1]?.kind, 'registration_resend');
  assert.equal(deliveredEmails[1]?.locale, 'en');
  assert.match(deliveredEmails[1]?.html || '', /849201/);
  assert.match(deliveredEmails[1]?.text || '', /849201/);

  // Step 3: Wrong verification code must fail closed and NEVER set password or create a session
  await assert.rejects(
    () =>
      completeZitadelRegistrationVerification({
        registrationTicket: started.registrationTicket,
        verificationCode: '000000',
        password: 'StrongPass1!',
        origin: 'https://qlaok.example.test',
        config: regConfig,
        fetchImpl,
      }),
    (err: unknown) =>
      err instanceof ZitadelLoginUiError &&
      err.code === 'VERIFICATION_CODE_INVALID'
  );
  assert.equal(
    calls.some(
      (c) =>
        (c.url.endsWith('/v2/users/289988776655443322') &&
          c.method === 'PATCH') ||
        c.url.endsWith('/v2/users/289988776655443322/password')
    ),
    false,
    'Wrong email code must never trigger a password update'
  );
  assert.equal(
    calls.some((c) => c.url.endsWith('/v2/sessions')),
    false
  );

  // Step 4: Valid verification code verifies email, sets user's password via PATCH /v2/users/{id}, creates session, and finalizes OIDC authRequest
  const completed = await completeZitadelRegistrationVerification({
    registrationTicket: started.registrationTicket,
    verificationCode: '849 201',
    password: 'StrongPass1!',
    origin: 'https://qlaok.example.test',
    config: regConfig,
    fetchImpl,
  });

  assert.equal(
    completed.callbackUrl,
    'https://qlaok.example.test/api/auth/callback?code=reg-code-999&state=state-reg-123'
  );
  assert.equal(completed.email, 'bich.tran@example.test');
  assert.equal(completed.fullName, 'Trần Thị Bích');

  assert.equal(
    calls.some((c) => c.url.endsWith('/v2/users/289988776655443322/password')),
    false,
    'Deprecated POST /v2/users/{id}/password must never be called'
  );
  const passwordCallIdx = calls.findIndex(
    (c) =>
      c.url.endsWith('/v2/users/289988776655443322') && c.method === 'PATCH'
  );
  const verifyCallIdx = calls.lastIndexOf(
    calls.filter((c) =>
      c.url.endsWith('/v2/users/289988776655443322/email/verify')
    )[1]!
  );
  const sessionCallIdx = calls.findIndex((c) => c.url.endsWith('/v2/sessions'));
  assert.ok(passwordCallIdx > verifyCallIdx);
  assert.ok(sessionCallIdx > passwordCallIdx);
  assert.equal(
    calls[passwordCallIdx]?.url,
    'https://auth.example.test/v2/users/289988776655443322'
  );
  assert.equal(calls[passwordCallIdx]?.method, 'PATCH');
  assert.equal(calls[passwordCallIdx]?.auth, 'Bearer server-only-token');
  assert.deepEqual(calls[passwordCallIdx]?.body, {
    human: {
      password: {
        password: {
          password: 'StrongPass1!',
          changeRequired: false,
        },
      },
    },
  });
});

test('custom registration maps duplicate email errors, recovers unverified accounts without overwriting verified accounts, and handles post-verification login recovery', async () => {
  resetZitadelLoginUiRateLimitsForTests();
  const { client } = {
    client: {
      from() {
        return {
          select() {
            return {
              ilike() {
                return {
                  async limit() {
                    return { data: [], error: null };
                  },
                };
              },
              eq() {
                return {
                  async maybeSingle() {
                    return { data: null, error: null };
                  },
                };
              },
            };
          },
        };
      },
    },
  };
  setSupabaseDbClientForTests(client as never);

  try {
    // 1. Duplicate email with existing VERIFIED ZITADEL user -> EMAIL_ALREADY_EXISTS (409), never resends or overwrites password
    let resendCalledForVerified = false;
    await assert.rejects(
      () =>
        startZitadelRegistration({
          authRequestId,
          fullName: 'Nguyễn Văn An',
          email: 'existing@example.test',
          password: 'StrongPass1!',
          confirmPassword: 'StrongPass1!',
          origin: 'https://qlaok.example.test',
          config,
          fetchImpl: async (input, init) => {
            const url = String(input);
            const method = init?.method || 'GET';
            if (url.endsWith(`/v2/oidc/auth_requests/${authRequestId}`)) {
              return response({ authRequest: authRequest() });
            }
            if (url.endsWith('/v2/users/new') && method === 'POST') {
              return response(
                { code: 6, message: 'User already exists (ALREADY_EXISTS)' },
                400
              );
            }
            if (url.endsWith('/v2/users') && method === 'POST') {
              return response({
                result: [
                  {
                    userId: 'verified-user-111',
                    human: {
                      email: {
                        email: 'existing@example.test',
                        isVerified: true,
                      },
                    },
                  },
                ],
              });
            }
            if (url.includes('/email/resend')) {
              resendCalledForVerified = true;
              return response({}, 200);
            }
            throw new Error(`Unexpected call: ${method} ${url}`);
          },
        }),
      (err: unknown) =>
        err instanceof ZitadelLoginUiError &&
        err.code === 'EMAIL_ALREADY_EXISTS' &&
        err.status === 409
    );
    assert.equal(resendCalledForVerified, false);

    // 2. Duplicate email with existing UNVERIFIED ZITADEL user -> resends verification code and issues a fresh ticket for that userId
    let resendBodyForUnverified: Record<string, unknown> | undefined;
    const recovered = await startZitadelRegistration({
      authRequestId,
      fullName: 'Nguyễn Văn Chờ',
      email: 'pending@example.test',
      password: 'StrongPass1!',
      confirmPassword: 'StrongPass1!',
      origin: 'https://qlaok.example.test',
      config,
      fetchImpl: async (input, init) => {
        const url = String(input);
        const method = init?.method || 'GET';
        if (url.endsWith(`/v2/oidc/auth_requests/${authRequestId}`)) {
          return response({ authRequest: authRequest() });
        }
        if (url.endsWith('/v2/users/new') && method === 'POST') {
          return response({ message: 'User already exists' }, 409);
        }
        if (url.endsWith('/v2/users') && method === 'POST') {
          return response({
            result: [
              {
                id: 'unverified-user-222',
                human: {
                  email: {
                    email: 'pending@example.test',
                    isVerified: false,
                  },
                },
              },
            ],
          });
        }
        if (
          url.endsWith('/v2/users/unverified-user-222/email/resend') &&
          method === 'POST'
        ) {
          resendBodyForUnverified = JSON.parse(String(init?.body || '{}'));
          return response({ verificationCode: '314159' }, 200);
        }
        throw new Error(`Unexpected call: ${method} ${url}`);
      },
    });
    assert.equal(recovered.email, 'pending@example.test');
    assert.deepEqual(resendBodyForUnverified, { returnCode: {} });
    const decodedTicket = verifyZitadelRegistrationTicket(
      recovered.registrationTicket
    );
    assert.equal(decodedTicket.userId, 'unverified-user-222');

    // 3. Arbitrary HTTP 400 on resendZitadelRegistrationCode maps to REGISTRATION_RESEND_FAILED, NOT REGISTRATION_EXPIRED
    await assert.rejects(
      () =>
        resendZitadelRegistrationCode({
          registrationTicket: recovered.registrationTicket,
          origin: 'https://qlaok.example.test',
          config,
          fetchImpl: async (input) => {
            const url = String(input);
            if (url.endsWith(`/v2/oidc/auth_requests/${authRequestId}`)) {
              return response({ authRequest: authRequest() });
            }
            return response({ message: 'Failed precondition on resend' }, 400);
          },
        }),
      (err: unknown) =>
        err instanceof ZitadelLoginUiError &&
        err.code === 'REGISTRATION_RESEND_FAILED' &&
        err.status === 400
    );

    // 4. If email verification + password set succeed but OIDC authRequest handoff has expired, throws REGISTRATION_VERIFIED_LOGIN_REQUIRED (409)
    await assert.rejects(
      () =>
        completeZitadelRegistrationVerification({
          registrationTicket: recovered.registrationTicket,
          verificationCode: '123456',
          password: 'StrongPass1!',
          origin: 'https://qlaok.example.test',
          config,
          fetchImpl: async (input, init) => {
            const url = String(input);
            const method = init?.method || 'GET';
            if (
              url.endsWith('/v2/users/unverified-user-222/email/verify') &&
              method === 'POST'
            ) {
              return response({}, 200);
            }
            if (
              url.endsWith('/v2/users/unverified-user-222') &&
              method === 'PATCH'
            ) {
              return response({}, 200);
            }
            if (url.endsWith(`/v2/oidc/auth_requests/${authRequestId}`)) {
              return response({ message: 'Auth request expired' }, 404);
            }
            throw new Error(`Unexpected call: ${method} ${url}`);
          },
        }),
      (err: unknown) =>
        err instanceof ZitadelLoginUiError &&
        err.code === 'REGISTRATION_VERIFIED_LOGIN_REQUIRED' &&
        err.status === 409
    );

    // 5. Missing permission (403) -> REGISTRATION_SERVICE_NOT_CONFIGURED (503)
    await assert.rejects(
      () =>
        startZitadelRegistration({
          authRequestId,
          fullName: 'Nguyễn Văn An',
          email: 'new@example.test',
          password: 'StrongPass1!',
          confirmPassword: 'StrongPass1!',
          origin: 'https://qlaok.example.test',
          config,
          fetchImpl: async (input) => {
            const url = String(input);
            if (url.endsWith(`/v2/oidc/auth_requests/${authRequestId}`)) {
              return response({ authRequest: authRequest() });
            }
            return response({ message: 'Permission denied: user.write' }, 403);
          },
        }),
      (err: unknown) =>
        err instanceof ZitadelLoginUiError &&
        err.code === 'REGISTRATION_SERVICE_NOT_CONFIGURED' &&
        err.status === 503
    );

    // 6. Bootstrap mobile PKCE authorize URL -> extracts V2_ authRequestId from Location header
    const mobileAuthReqId = 'V2_777888999000111222';
    const extracted = await bootstrapZitadelOidcAuthRequestId({
      oidc: {
        clientId: config.mobileClientId,
        redirectUri: config.mobileRedirectUri,
        state: 'state_mobile_1234567890',
        nonce: 'nonce_mobile_1234567890',
        codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        codeChallengeMethod: 'S256',
        loginHint: 'mobileowner@example.test',
        lang: 'vi',
      },
      origin: 'https://qlaok.example.test',
      config,
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        assert.equal(url.pathname, '/oauth/v2/authorize');
        assert.equal(url.searchParams.get('client_id'), config.mobileClientId);
        assert.equal(
          url.searchParams.get('redirect_uri'),
          config.mobileRedirectUri
        );
        assert.equal(url.searchParams.get('prompt'), 'create');
        assert.equal(init?.redirect, 'manual');
        return new Response(null, {
          status: 302,
          headers: {
            Location: `https://qlaok.example.test/login?authRequest=${mobileAuthReqId}&lang=vi`,
          },
        });
      },
    });
    assert.equal(extracted, mobileAuthReqId);
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('getClientIp trusts only X-Real-IP, ignores spoofed X-Forwarded-For, and per-ticket failed OTP attempts + DB rate limits fail closed', async () => {
  resetZitadelLoginUiRateLimitsForTests();

  // 1. getClientIp ignores X-Forwarded-For and reads only X-Real-IP
  const reqSpoofedXff = new Request('https://qlaok.example.test/api/auth/login-ui', {
    headers: {
      'X-Real-IP': '198.51.100.77',
      'X-Forwarded-For': '203.0.113.5, 198.51.100.77',
    },
  });
  assert.equal(getClientIp(reqSpoofedXff), '198.51.100.77');

  const reqOnlyXff = new Request('https://qlaok.example.test/api/auth/login-ui', {
    headers: {
      'X-Forwarded-For': '203.0.113.99',
    },
  });
  assert.equal(getClientIp(reqOnlyXff), 'unknown');

  // 2.Hashed rate-limit bucket keys never contain raw IP, email, or ticket
  const bucketKey = buildZitadelLoginUiRateLimitBucketKey(
    'register_verify:198.51.100.77'
  );
  assert.match(bucketKey, /^rl-staff-[0-9a-f]{64}$/);
  assert.equal(bucketKey.includes('198.51.100.77'), false);

  // 3. Spoofed X-Forwarded-For cannot reset rate limits when X-Real-IP is the same
  const nowMs = 1_760_000_000_000;
  for (let i = 0; i < 3; i += 1) {
    const req = new Request('https://qlaok.example.test/api/auth/login-ui', {
      headers: {
        'X-Real-IP': '198.51.100.88',
        'X-Forwarded-For': `203.0.113.${i + 1}`,
      },
    });
    checkZitadelLoginUiRateLimit(
      `register_resend:${getClientIp(req)}`,
      3,
      60_000,
      nowMs + i * 100
    );
  }
  const fourthReq = new Request('https://qlaok.example.test/api/auth/login-ui', {
    headers: {
      'X-Real-IP': '198.51.100.88',
      'X-Forwarded-For': '203.0.113.250',
    },
  });
  assert.throws(
    () =>
      checkZitadelLoginUiRateLimit(
        `register_resend:${getClientIp(fourthReq)}`,
        3,
        60_000,
        nowMs + 500
      ),
    (err: unknown) =>
      err instanceof ZitadelLoginUiError &&
      err.code === 'LOGIN_RATE_LIMITED' &&
      err.status === 429
  );

  // 4. Strict failed-code attempt limit (5 failures) locks the registration ticket
  const ticket = issueZitadelRegistrationTicket({
    userId: '289900001111222233',
    email: 'lockout@example.test',
    fullName: 'Trần Văn Khóa',
    authRequestId,
    clientKind: 'web',
    nowSeconds: Math.floor(nowMs / 1000),
  });
  let verifyApiCalls = 0;
  const failingVerifyFetch: typeof fetch = async () => {
    verifyApiCalls += 1;
    return response({ message: 'Invalid verification code' }, 400);
  };

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await assert.rejects(
      () =>
        completeZitadelRegistrationVerification({
          registrationTicket: ticket,
          verificationCode: '111111',
          password: 'StrongPass1!',
          origin: 'https://qlaok.example.test',
          config,
          fetchImpl: failingVerifyFetch,
          nowSeconds: Math.floor(nowMs / 1000) + attempt,
        }),
      (err: unknown) =>
        err instanceof ZitadelLoginUiError &&
        err.code === 'VERIFICATION_CODE_INVALID'
    );
  }
  // 5th failed attempt triggers LOGIN_RATE_LIMITED (429)
  await assert.rejects(
    () =>
      completeZitadelRegistrationVerification({
        registrationTicket: ticket,
        verificationCode: '111111',
        password: 'StrongPass1!',
        origin: 'https://qlaok.example.test',
        config,
        fetchImpl: failingVerifyFetch,
        nowSeconds: Math.floor(nowMs / 1000) + 5,
      }),
    (err: unknown) =>
      err instanceof ZitadelLoginUiError &&
      err.code === 'LOGIN_RATE_LIMITED' &&
      err.status === 429
  );
  assert.equal(verifyApiCalls, 5);

  // 6th attempt is blocked BEFORE calling ZITADEL's /email/verify endpoint
  await assert.rejects(
    () =>
      completeZitadelRegistrationVerification({
        registrationTicket: ticket,
        verificationCode: '999999',
        password: 'StrongPass1!',
        origin: 'https://qlaok.example.test',
        config,
        fetchImpl: failingVerifyFetch,
        nowSeconds: Math.floor(nowMs / 1000) + 6,
      }),
    (err: unknown) =>
      err instanceof ZitadelLoginUiError &&
      err.code === 'LOGIN_RATE_LIMITED' &&
      err.status === 429
  );
  assert.equal(verifyApiCalls, 5);

  // 5. Durable PostgreSQL rate-limit RPC fails closed when RPC reports error
  const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://qlaok.vunph.click';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  setSupabaseDbClientForTests({
    async rpc() {
      return { data: null, error: { message: 'db connection refused' } };
    },
  } as never);
  try {
    await assert.rejects(
      () => enforceZitadelLoginUiRateLimit('login:198.51.100.99:user@test', 5),
      (err: unknown) =>
        err instanceof ZitadelLoginUiError &&
        err.code === 'LOGIN_RATE_LIMITED' &&
        err.status === 429
    );
  } finally {
    setSupabaseDbClientForTests(null);
    if (prevUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
    resetZitadelLoginUiRateLimitsForTests();
  }
});

test('enforceZitadelLoginUiRateLimit and registration verification failure tracking use exact RPC contract and convert ms to integer seconds', async () => {
  const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://qlaok.vunph.click';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

  const mockDbClient = {
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      if (fn === 'check_staff_login_rate_limit_atomic') {
        return { data: { allowed: true, failure_count: 0 }, error: null };
      }
      if (fn === 'record_staff_login_failure_atomic') {
        return {
          data: {
            allowed: true,
            newly_blocked: false,
            failure_count: 1,
            retry_after_sec: 0,
            blocked_until: null,
          },
          error: null,
        };
      }
      if (fn === 'reset_staff_login_rate_limit_atomic') {
        return { data: true, error: null };
      }
      throw new Error(`Unexpected RPC call: ${fn}`);
    },
  };

  setSupabaseDbClientForTests(mockDbClient as never);

  try {
    // 1. Test enforceZitadelLoginUiRateLimit default window (600,000 ms -> 600 s)
    const fixedNowMs = 1_760_000_000_000;
    await enforceZitadelLoginUiRateLimit('test-login-user@example.test', 12, 600_000, fixedNowMs);

    assert.equal(rpcCalls.length, 2);
    const [checkCall, recordCall] = rpcCalls;

    assert.equal(checkCall.fn, 'check_staff_login_rate_limit_atomic');
    assert.deepEqual(Object.keys(checkCall.args).sort(), ['p_bucket_key', 'p_now', 'p_window_seconds'].sort());
    assert.match(String(checkCall.args.p_bucket_key), /^rl-staff-[0-9a-f]{64}$/);
    assert.equal(checkCall.args.p_now, new Date(fixedNowMs).toISOString());
    assert.equal(checkCall.args.p_window_seconds, 600);

    assert.equal(recordCall.fn, 'record_staff_login_failure_atomic');
    assert.deepEqual(
      Object.keys(recordCall.args).sort(),
      ['p_block_seconds', 'p_bucket_key', 'p_max_attempts', 'p_now', 'p_window_seconds'].sort()
    );
    assert.equal(recordCall.args.p_block_seconds, 600);
    assert.equal(recordCall.args.p_window_seconds, 600);
    assert.equal(recordCall.args.p_max_attempts, 13); // maxAttempts + 1
    assert.equal(recordCall.args.p_now, new Date(fixedNowMs).toISOString());
    assert.match(String(recordCall.args.p_bucket_key), /^rl-staff-[0-9a-f]{64}$/);

    // Assert absence of outdated / unsupported argument names
    assert.equal('p_window_ms' in recordCall.args, false, 'must not pass p_window_ms');
    assert.equal('p_lockout_ms' in recordCall.args, false, 'must not pass p_lockout_ms');

    // 2. Test custom and sub-second millisecond-to-second conversion in enforceZitadelLoginUiRateLimit
    rpcCalls.length = 0;
    await enforceZitadelLoginUiRateLimit('custom-window@example.test', 5, 45_000, fixedNowMs);
    const customRecordCall = rpcCalls.find((c) => c.fn === 'record_staff_login_failure_atomic');
    assert.ok(customRecordCall);
    assert.equal(customRecordCall.args.p_window_seconds, 45);
    assert.equal(customRecordCall.args.p_block_seconds, 45);

    rpcCalls.length = 0;
    await enforceZitadelLoginUiRateLimit('fractional-window@example.test', 5, 1_500, fixedNowMs);
    const fractionalRecordCall = rpcCalls.find((c) => c.fn === 'record_staff_login_failure_atomic');
    assert.ok(fractionalRecordCall);
    assert.equal(fractionalRecordCall.args.p_window_seconds, 2);
    assert.equal(fractionalRecordCall.args.p_block_seconds, 2);

    // 3. Test registration verification failure tracking in completeZitadelRegistrationVerification
    rpcCalls.length = 0;
    const regTicket = issueZitadelRegistrationTicket({
      userId: '289900001111222233',
      email: 'rpc-contract-test@example.test',
      fullName: 'Test RPC User',
      authRequestId,
      clientKind: 'web',
      nowSeconds: Math.floor(fixedNowMs / 1000),
    });

    const failingVerifyFetch: typeof fetch = async () => {
      return response({ message: 'Invalid verification code' }, 400);
    };

    await assert.rejects(
      () =>
        completeZitadelRegistrationVerification({
          registrationTicket: regTicket,
          verificationCode: '123456',
          password: 'StrongPass1!',
          origin: 'https://qlaok.example.test',
          config,
          fetchImpl: failingVerifyFetch,
          nowSeconds: Math.floor(fixedNowMs / 1000),
        }),
      (err: unknown) =>
        err instanceof ZitadelLoginUiError &&
        err.code === 'VERIFICATION_CODE_INVALID'
    );

    // Must have recorded failure in both ticket bucket and user bucket
    const regRecordCalls = rpcCalls.filter((c) => c.fn === 'record_staff_login_failure_atomic');
    assert.equal(regRecordCalls.length, 2, 'records failure for ticket and user buckets');

    for (const call of regRecordCalls) {
      assert.deepEqual(
        Object.keys(call.args).sort(),
        ['p_block_seconds', 'p_bucket_key', 'p_max_attempts', 'p_now', 'p_window_seconds'].sort()
      );
      assert.equal(
        call.args.p_window_seconds,
        900,
        'REGISTRATION_VERIFY_LOCKOUT_MS (900_000 ms) converted to 900 seconds'
      );
      assert.equal(
        call.args.p_block_seconds,
        900,
        'REGISTRATION_VERIFY_LOCKOUT_MS (900_000 ms) converted to 900 seconds'
      );
      assert.equal(call.args.p_max_attempts, 5); // MAX_REGISTRATION_VERIFY_FAILURES
      assert.match(String(call.args.p_bucket_key), /^rl-staff-[0-9a-f]{64}$/);
      assert.equal('p_window_ms' in call.args, false, 'must not pass p_window_ms');
      assert.equal('p_lockout_ms' in call.args, false, 'must not pass p_lockout_ms');
    }
  } finally {
    setSupabaseDbClientForTests(null);
    if (prevUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
    resetZitadelLoginUiRateLimitsForTests();
  }
});

test('password_reset_request performs exact-email lookup, sends Qlaok reset URL template only for eligible verified human accounts, and returns identical {ok:true} without enumeration', async () => {
  resetZitadelLoginUiRateLimitsForTests();

  const qlaokOrigin = 'https://qlaok.vunph.click';
  const expectedTemplate =
    'https://qlaok.vunph.click/login?mode=reset&userID={{.UserID}}&code={{.Code}}&orgID={{.OrgID}}';
  assert.equal(
    buildZitadelPasswordResetUrlTemplate(qlaokOrigin, config),
    expectedTemplate
  );
  // Never points to Zitadel issuer host even if issuerUrl is passed as origin
  assert.equal(
    buildZitadelPasswordResetUrlTemplate(config.issuerUrl, {
      ...config,
      webRedirectUri: 'https://qlaok.vunph.click/api/auth/callback',
    }),
    expectedTemplate
  );

  const calls: Array<{
    url: string;
    method: string;
    auth: string;
    body?: Record<string, unknown>;
  }> = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method || 'GET';
    const headers = (init?.headers || {}) as Record<string, string>;
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : undefined;
    calls.push({ url, method, auth: headers.Authorization || '', body });

    if (url.endsWith('/v2/users') && method === 'POST') {
      const queries = body?.queries as Array<{
        emailQuery?: { emailAddress?: string; method?: string };
      }>;
      const emailAddress = queries?.[0]?.emailQuery?.emailAddress;
      assert.equal(
        queries?.[0]?.emailQuery?.method,
        'TEXT_QUERY_METHOD_EQUALS'
      );

      if (emailAddress === 'verified.owner@example.test') {
        return response({
          result: [
            {
              userId: '289911223344556677',
              state: 'USER_STATE_ACTIVE',
              human: {
                email: {
                  email: 'Verified.Owner@Example.test',
                  isVerified: true,
                },
              },
            },
          ],
        });
      }
      if (emailAddress === 'chuquan@qlaok.vn') {
        return response({
          result: [
            {
              userId: '289911223344558899',
              human: {
                email: {
                  email: 'chuquan@qlaok.vn',
                  isVerified: true,
                },
              },
            },
          ],
        });
      }
      if (emailAddress === 'unverified@example.test') {
        return response({
          result: [
            {
              userId: '289900000000000001',
              human: {
                email: {
                  email: 'unverified@example.test',
                  isVerified: false,
                },
              },
            },
          ],
        });
      }
      if (emailAddress === 'machine@example.test') {
        return response({
          result: [
            {
              userId: '289900000000000002',
              machine: { name: 'service-bot' },
            },
          ],
        });
      }
      if (emailAddress === 'locked@example.test') {
        return response({
          result: [
            {
              userId: '289900000000000003',
              state: 'USER_STATE_LOCKED',
              human: {
                email: {
                  email: 'locked@example.test',
                  isVerified: true,
                },
              },
            },
          ],
        });
      }
      return response({ result: [] });
    }

    if (
      (url.endsWith('/v2/users/289911223344556677/password_reset') ||
        url.endsWith('/v2/users/289911223344558899/password_reset')) &&
      method === 'POST'
    ) {
      return response({ verificationCode: '918273' }, 200);
    }

    throw new Error(`Unexpected ZITADEL request: ${method} ${url}`);
  };

  const sentResetEmails: AuthEmailSendPayload[] = [];
  const resetConfig: ZitadelLoginUiConfig = {
    ...config,
    sendEmail: async (payload) => {
      sentResetEmails.push(payload);
    },
  };

  // 1. Eligible verified human account triggers POST /v2/users/{user_id}/password_reset with returnCode and sends Qlaok reset email
  const okVerified = await requestZitadelPasswordReset({
    email: '  Verified.Owner@Example.test ',
    lang: 'vi',
    origin: qlaokOrigin,
    clientIp: '198.51.100.10',
    config: resetConfig,
    fetchImpl,
  });
  assert.deepEqual(okVerified, { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url, 'https://auth.example.test/v2/users');
  assert.equal(calls[0]?.auth, 'Bearer server-only-token');
  assert.deepEqual(calls[0]?.body, {
    query: { offset: '0', limit: 2, asc: true },
    queries: [
      {
        emailQuery: {
          emailAddress: 'verified.owner@example.test',
          method: 'TEXT_QUERY_METHOD_EQUALS',
        },
      },
    ],
  });
  assert.equal(
    calls[1]?.url,
    'https://auth.example.test/v2/users/289911223344556677/password_reset'
  );
  assert.equal(calls[1]?.auth, 'Bearer server-only-token');
  assert.deepEqual(calls[1]?.body, {
    returnCode: {},
  });
  assert.equal(sentResetEmails.length, 1);
  assert.equal(sentResetEmails[0]?.kind, 'password_reset');
  assert.equal(sentResetEmails[0]?.locale, 'vi');
  assert.equal(sentResetEmails[0]?.to, 'verified.owner@example.test');
  assert.equal(
    sentResetEmails[0]?.actionUrl,
    'https://qlaok.vunph.click/login?mode=reset&userID=289911223344556677&code=918273&lang=vi'
  );

  // 2. Unknown, unverified, machine, and locked accounts return identical { ok: true } and NEVER call /password_reset or send email
  for (const candidate of [
    'unknown@example.test',
    'unverified@example.test',
    'machine@example.test',
    'locked@example.test',
  ]) {
    calls.length = 0;
    sentResetEmails.length = 0;
    const res = await requestZitadelPasswordReset({
      email: candidate,
      origin: qlaokOrigin,
      clientIp: '198.51.100.11',
      config: resetConfig,
      fetchImpl,
    });
    assert.deepEqual(res, { ok: true });
    assert.equal(calls.length, 1, `Only search called for ${candidate}`);
    assert.equal(
      calls.some((c) => c.url.includes('/password_reset')),
      false,
      `Must not request password_reset for ${candidate}`
    );
    assert.equal(
      sentResetEmails.length,
      0,
      `Must not send reset email for ${candidate}`
    );
  }

  // 3. Previously reserved emails (e.g. chuquan@qlaok.vn) are not blocked by hardcoded exemptions
  calls.length = 0;
  sentResetEmails.length = 0;
  const okPreviouslyReserved = await requestZitadelPasswordReset({
    email: 'chuquan@qlaok.vn',
    lang: 'en',
    origin: qlaokOrigin,
    clientIp: '198.51.100.12',
    config: resetConfig,
    fetchImpl,
  });
  assert.deepEqual(okPreviouslyReserved, { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(
    calls[1]?.url,
    'https://auth.example.test/v2/users/289911223344558899/password_reset'
  );
  assert.equal(sentResetEmails.length, 1);
  assert.equal(sentResetEmails[0]?.locale, 'en');
  assert.equal(
    sentResetEmails[0]?.actionUrl,
    'https://qlaok.vunph.click/login?mode=reset&userID=289911223344558899&code=918273&lang=en'
  );
});

test('password_reset_request enforces IP and normalized-email rate limits with hashed keys and never stores or logs raw email/token', async () => {
  resetZitadelLoginUiRateLimitsForTests();
  const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://qlaok.vunph.click';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

  const recordedBucketKeys: string[] = [];
  const counts = new Map<string, number>();

  setSupabaseDbClientForTests({
    async rpc(fn: string, args: Record<string, unknown>) {
      const key = String(args.p_bucket_key || '');
      recordedBucketKeys.push(key);
      if (fn === 'check_staff_login_rate_limit_atomic') {
        const max = Number(args.p_max_attempts || 999);
        const current = counts.get(key) || 0;
        return { data: { allowed: current < max, failure_count: current }, error: null };
      }
      if (fn === 'record_staff_login_failure_atomic') {
        const max = Number(args.p_max_attempts || 999);
        const next = (counts.get(key) || 0) + 1;
        counts.set(key, next);
        const allowed = next < max;
        return {
          data: {
            allowed,
            newly_blocked: !allowed,
            failure_count: next,
            retry_after_sec: allowed ? 0 : 600,
            blocked_until: allowed ? null : new Date(Date.now() + 600_000).toISOString(),
          },
          error: null,
        };
      }
      if (fn === 'reset_staff_login_rate_limit_atomic') {
        counts.delete(key);
        return { data: true, error: null };
      }
      throw new Error(`Unexpected RPC: ${fn}`);
    },
  } as never);

  try {
    const fetchNoop: typeof fetch = async () => response({ result: [] });
    const targetEmail = 'RateLimit.Target@Example.test';

    for (let i = 0; i < PASSWORD_RESET_REQUEST_EMAIL_MAX_ATTEMPTS; i += 1) {
      const res = await requestZitadelPasswordReset({
        email: targetEmail,
        origin: 'https://qlaok.vunph.click',
        clientIp: `198.51.100.${50 + i}`,
        config,
        fetchImpl: fetchNoop,
      });
      assert.deepEqual(res, { ok: true });
    }

    // 6th request for the same normalized email (even from a new IP) is rate-limited
    await assert.rejects(
      () =>
        requestZitadelPasswordReset({
          email: '  ratelimit.target@example.test  ',
          origin: 'https://qlaok.vunph.click',
          clientIp: '198.51.100.200',
          config,
          fetchImpl: fetchNoop,
        }),
      (err: unknown) =>
        err instanceof ZitadelLoginUiError &&
        err.code === 'LOGIN_RATE_LIMITED' &&
        err.status === 429
    );

    // Every bucket key stored in DB is a SHA-256 hash and never contains the raw email or IP
    assert.ok(recordedBucketKeys.length > 0);
    for (const key of recordedBucketKeys) {
      assert.match(key, /^rl-staff-[0-9a-f]{64}$/);
      assert.equal(key.toLowerCase().includes('ratelimit.target'), false);
      assert.equal(key.includes('198.51.100'), false);
    }

    // Per-IP rate limit blocks excessive requests across different emails from the same IP
    counts.clear();
    for (let i = 0; i < PASSWORD_RESET_REQUEST_IP_MAX_ATTEMPTS; i += 1) {
      await requestZitadelPasswordReset({
        email: `user${i}@example.test`,
        origin: 'https://qlaok.vunph.click',
        clientIp: '198.51.100.77',
        config,
        fetchImpl: fetchNoop,
      });
    }
    await assert.rejects(
      () =>
        requestZitadelPasswordReset({
          email: 'another@example.test',
          origin: 'https://qlaok.vunph.click',
          clientIp: '198.51.100.77',
          config,
          fetchImpl: fetchNoop,
        }),
      (err: unknown) =>
        err instanceof ZitadelLoginUiError &&
        err.code === 'LOGIN_RATE_LIMITED' &&
        err.status === 429
    );
  } finally {
    setSupabaseDbClientForTests(null);
    if (prevUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
    resetZitadelLoginUiRateLimitsForTests();
  }
});

test('password_reset_complete validates bounded userID, code, and strong password, posts verificationCode to Zitadel, maps errors safely, and never calls login callback', async () => {
  resetZitadelLoginUiRateLimitsForTests();

  const calls: Array<{
    url: string;
    method: string;
    auth: string;
    body?: Record<string, unknown>;
  }> = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method || 'GET';
    const headers = (init?.headers || {}) as Record<string, string>;
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : undefined;
    calls.push({ url, method, auth: headers.Authorization || '', body });

    if (
      url.endsWith('/v2/users/289911223344556677/password') &&
      method === 'POST'
    ) {
      if (body?.verificationCode === 'expired99') {
        return response({ message: 'Password reset code has expired' }, 400);
      }
      if (body?.verificationCode !== '849201') {
        return response({ message: 'Password reset code is invalid' }, 400);
      }
      return response({ details: {} }, 200);
    }
    if (
      url.endsWith('/v2/users/999999999999999999/password') &&
      method === 'POST'
    ) {
      return response({ message: 'User not found' }, 404);
    }
    throw new Error(`Unexpected ZITADEL call: ${method} ${url}`);
  };

  // 1. Rejects malformed/unbounded/staff userID and invalid code before calling Zitadel
  for (const badUserId of [
    '',
    '   ',
    '../admin',
    'user/123',
    'staff-acct-123456',
    'a'.repeat(129),
  ]) {
    await assert.rejects(
      () =>
        completeZitadelPasswordReset({
          userID: badUserId,
          code: '849201',
          password: 'StrongPass1!',
          confirmPassword: 'StrongPass1!',
          origin: 'https://qlaok.vunph.click',
          config,
          fetchImpl,
        }),
      (err: unknown) =>
        err instanceof ZitadelLoginUiError &&
        err.code === 'VERIFICATION_CODE_INVALID' &&
        err.status === 400
    );
  }
  for (const badCode of ['', '12', 'bad/code', 'a'.repeat(129), '123\u0000456']) {
    await assert.rejects(
      () =>
        completeZitadelPasswordReset({
          userID: '289911223344556677',
          code: badCode,
          password: 'StrongPass1!',
          confirmPassword: 'StrongPass1!',
          origin: 'https://qlaok.vunph.click',
          config,
          fetchImpl,
        }),
      (err: unknown) =>
        err instanceof ZitadelLoginUiError &&
        err.code === 'VERIFICATION_CODE_INVALID' &&
        err.status === 400
    );
  }
  await assert.rejects(
    () =>
      completeZitadelPasswordReset({
        userID: '289911223344556677',
        code: '849201',
        password: 'weakpassword',
        confirmPassword: 'weakpassword',
        origin: 'https://qlaok.vunph.click',
        config,
        fetchImpl,
      }),
    (err: unknown) =>
      err instanceof ZitadelLoginUiError &&
      err.code === 'PASSWORD_WEAK' &&
      err.status === 400
  );
  await assert.rejects(
    () =>
      completeZitadelPasswordReset({
        userID: '289911223344556677',
        code: '849201',
        password: 'StrongPass1!',
        confirmPassword: 'MismatchPass1!',
        origin: 'https://qlaok.vunph.click',
        config,
        fetchImpl,
      }),
    (err: unknown) =>
      err instanceof ZitadelLoginUiError &&
      err.code === 'PASSWORD_MISMATCH' &&
      err.status === 400
  );
  assert.equal(calls.length, 0, 'Validation failures must never call Zitadel');

  // 2. Non-existent user (404) maps to VERIFICATION_CODE_INVALID (400) so arbitrary userIDs cannot be enumerated
  await assert.rejects(
    () =>
      completeZitadelPasswordReset({
        userID: '999999999999999999',
        code: '849201',
        password: 'StrongPass1!',
        confirmPassword: 'StrongPass1!',
        origin: 'https://qlaok.vunph.click',
        config,
        fetchImpl,
      }),
    (err: unknown) =>
      err instanceof ZitadelLoginUiError &&
      err.code === 'VERIFICATION_CODE_INVALID' &&
      err.status === 400
  );

  // 3. Expired code maps to VERIFICATION_CODE_EXPIRED (400) and invalid code maps to VERIFICATION_CODE_INVALID (400)
  await assert.rejects(
    () =>
      completeZitadelPasswordReset({
        userID: '289911223344556677',
        code: 'expired99',
        password: 'StrongPass1!',
        confirmPassword: 'StrongPass1!',
        origin: 'https://qlaok.vunph.click',
        config,
        fetchImpl,
      }),
    (err: unknown) =>
      err instanceof ZitadelLoginUiError &&
      err.code === 'VERIFICATION_CODE_EXPIRED' &&
      err.status === 400
  );
  await assert.rejects(
    () =>
      completeZitadelPasswordReset({
        userID: '289911223344556677',
        code: '000000',
        password: 'StrongPass1!',
        confirmPassword: 'StrongPass1!',
        origin: 'https://qlaok.vunph.click',
        config,
        fetchImpl,
      }),
    (err: unknown) =>
      err instanceof ZitadelLoginUiError &&
      err.code === 'VERIFICATION_CODE_INVALID' &&
      err.status === 400
  );

  // 4. Valid code completes via POST /v2/users/{user_id}/password with changeRequired=false and no login UI callback
  calls.length = 0;
  const completed = await completeZitadelPasswordReset({
    userID: '289911223344556677',
    code: '849 201',
    password: 'StrongPass1!',
    confirmPassword: 'StrongPass1!',
    origin: 'https://qlaok.vunph.click',
    config,
    fetchImpl,
  });
  assert.deepEqual(completed, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0]?.url,
    'https://auth.example.test/v2/users/289911223344556677/password'
  );
  assert.equal(calls[0]?.method, 'POST');
  assert.equal(calls[0]?.auth, 'Bearer server-only-token');
  assert.deepEqual(calls[0]?.body, {
    newPassword: {
      password: 'StrongPass1!',
      changeRequired: false,
    },
    verificationCode: '849201',
  });
  assert.equal(
    calls.some(
      (c) => c.url.includes('/v2/sessions') || c.url.includes('/auth_requests')
    ),
    false
  );

  // 5. Brute-force protection: 5 failed code attempts on a userID locks out further attempts (429) before calling Zitadel
  let postPasswordCalls = 0;
  const failingCodeFetch: typeof fetch = async () => {
    postPasswordCalls += 1;
    return response({ message: 'Invalid verification code' }, 400);
  };
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await assert.rejects(
      () =>
        completeZitadelPasswordReset({
          userID: '289977665544332211',
          code: '111111',
          password: 'StrongPass1!',
          confirmPassword: 'StrongPass1!',
          origin: 'https://qlaok.vunph.click',
          clientIp: `198.51.100.${100 + attempt}`,
          config,
          fetchImpl: failingCodeFetch,
        }),
      (err: unknown) =>
        err instanceof ZitadelLoginUiError &&
        err.code === 'VERIFICATION_CODE_INVALID'
    );
  }
  await assert.rejects(
    () =>
      completeZitadelPasswordReset({
        userID: '289977665544332211',
        code: '111111',
        password: 'StrongPass1!',
        confirmPassword: 'StrongPass1!',
        origin: 'https://qlaok.vunph.click',
        clientIp: '198.51.100.105',
        config,
        fetchImpl: failingCodeFetch,
      }),
    (err: unknown) =>
      err instanceof ZitadelLoginUiError &&
      err.code === 'LOGIN_RATE_LIMITED' &&
      err.status === 429
  );
  assert.equal(postPasswordCalls, 5);
  // 6th attempt is blocked BEFORE calling Zitadel
  await assert.rejects(
    () =>
      completeZitadelPasswordReset({
        userID: '289977665544332211',
        code: '849201',
        password: 'StrongPass1!',
        confirmPassword: 'StrongPass1!',
        origin: 'https://qlaok.vunph.click',
        clientIp: '198.51.100.106',
        config,
        fetchImpl: failingCodeFetch,
      }),
    (err: unknown) =>
      err instanceof ZitadelLoginUiError &&
      err.code === 'LOGIN_RATE_LIMITED' &&
      err.status === 429
  );
  assert.equal(postPasswordCalls, 5);
});

test('/api/auth/login-ui POST contract for password_reset_request and password_reset_complete handles Zitadel failures, localization, no-store headers, and credential redaction', async () => {
  resetZitadelLoginUiRateLimitsForTests();
  const prevIssuer = process.env.ZITADEL_ISSUER_URL;
  const prevPat = process.env.ZITADEL_LOGIN_CLIENT_PAT;
  const prevWebClient = process.env.ZITADEL_CLIENT_ID;
  const prevMobileClient = process.env.ZITADEL_MOBILE_CLIENT_ID;
  const prevFetch = globalThis.fetch;

  const sentinelSecretToken = 'pat-secret-sentinel-998877';
  const sentinelPassword = 'ResetPass!98765';
  const sentinelCode = '739182';

  process.env.ZITADEL_ISSUER_URL = 'https://auth.example.test';
  process.env.ZITADEL_LOGIN_CLIENT_PAT = sentinelSecretToken;
  process.env.ZITADEL_CLIENT_ID = 'web-client-123';
  process.env.ZITADEL_MOBILE_CLIENT_ID = 'mobile-client-123';

  const routeDeliveredEmails: AuthEmailSendPayload[] = [];
  setAuthEmailSenderForTests(async (payload) => {
    routeDeliveredEmails.push(payload);
  });

  let zitadelMode: 'ok' | 'unconfigured_403' | 'unavailable_503' | 'expired_code' = 'ok';

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    if (zitadelMode === 'unconfigured_403') {
      return response({ message: `Token ${sentinelSecretToken} denied` }, 403);
    }
    if (zitadelMode === 'unavailable_503') {
      return response({ message: 'upstream database down' }, 503);
    }
    if (url.endsWith('/v2/users') && method === 'POST') {
      return response({
        result: [
          {
            userId: '289911223344556677',
            human: {
              email: {
                email: 'owner@example.test',
                isVerified: true,
              },
            },
          },
        ],
      });
    }
    if (url.endsWith('/v2/users/289911223344556677/password_reset') && method === 'POST') {
      return response({ verificationCode: sentinelCode }, 200);
    }
    if (url.endsWith('/v2/users/289911223344556677/password') && method === 'POST') {
      if (zitadelMode === 'expired_code') {
        return response({ message: `Code ${sentinelCode} expired` }, 400);
      }
      return response({ details: {} }, 200);
    }
    throw new Error(`Unexpected fetch in route test: ${method} ${url}`);
  }) as typeof fetch;

  try {
    // 1. Request success returns HTTP 200 { ok: true } with Cache-Control: no-store and never leaks sentinelCode
    const reqSuccess = await loginUiPost(
      new Request('https://qlaok.vunph.click/api/auth/login-ui', {
        method: 'POST',
        headers: {
          Origin: 'https://qlaok.vunph.click',
          'X-Real-IP': '198.51.100.31',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'password_reset_request',
          email: 'owner@example.test',
          lang: 'vi',
        }),
      })
    );
    assert.equal(reqSuccess.status, 200);
    assert.equal(reqSuccess.headers.get('cache-control'), 'no-store');
    const reqSuccessJson = await reqSuccess.json();
    assert.deepEqual(reqSuccessJson, { ok: true });
    assert.equal(JSON.stringify(reqSuccessJson).includes(sentinelCode), false);
    assert.equal(routeDeliveredEmails.length, 1);
    assert.equal(routeDeliveredEmails[0]?.kind, 'password_reset');
    assert.equal(routeDeliveredEmails[0]?.locale, 'vi');

    // 2. Invalid email returns HTTP 400 { ok: false, code: 'INVALID_EMAIL', error }
    const badEmailRes = await loginUiPost(
      new Request('https://qlaok.vunph.click/api/auth/login-ui', {
        method: 'POST',
        headers: {
          Origin: 'https://qlaok.vunph.click',
          'X-Real-IP': '198.51.100.31',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'password_reset_request',
          email: 'not-an-email',
          lang: 'en',
        }),
      })
    );
    assert.equal(badEmailRes.status, 400);
    const badEmailBody = (await badEmailRes.json()) as Record<string, unknown>;
    assert.equal(badEmailBody.ok, false);
    assert.equal(badEmailBody.code, 'INVALID_EMAIL');
    assert.equal(badEmailBody.error, 'Please enter a valid email address.');

    // 3. Complete success returns HTTP 200 { ok: true }
    const completeSuccess = await loginUiPost(
      new Request('https://qlaok.vunph.click/api/auth/login-ui', {
        method: 'POST',
        headers: {
          Origin: 'https://qlaok.vunph.click',
          'X-Real-IP': '198.51.100.32',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'password_reset_complete',
          userID: '289911223344556677',
          code: sentinelCode,
          password: sentinelPassword,
          confirmPassword: sentinelPassword,
          lang: 'vi',
        }),
      })
    );
    assert.equal(completeSuccess.status, 200);
    assert.equal(completeSuccess.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await completeSuccess.json(), { ok: true });

    // 4. Expired code on password_reset_complete returns localized safe error and never leaks code/password/token
    zitadelMode = 'expired_code';
    const expiredRes = await loginUiPost(
      new Request('https://qlaok.vunph.click/api/auth/login-ui', {
        method: 'POST',
        headers: {
          Origin: 'https://qlaok.vunph.click',
          'X-Real-IP': '198.51.100.33',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'password_reset_complete',
          userID: '289911223344556677',
          code: sentinelCode,
          password: sentinelPassword,
          confirmPassword: sentinelPassword,
          lang: 'en',
        }),
      })
    );
    assert.equal(expiredRes.status, 400);
    const expiredJson = (await expiredRes.json()) as Record<string, unknown>;
    assert.deepEqual(expiredJson, {
      ok: false,
      code: 'VERIFICATION_CODE_EXPIRED',
      error:
        'The verification code has expired. Please request a new password reset email.',
    });

    // 5. Zitadel 403/503 failures map to 503 with safe localized messages and never leak secrets
    zitadelMode = 'unconfigured_403';
    const unconfRes = await loginUiPost(
      new Request('https://qlaok.vunph.click/api/auth/login-ui', {
        method: 'POST',
        headers: {
          Origin: 'https://qlaok.vunph.click',
          'X-Real-IP': '198.51.100.34',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'password_reset_request',
          email: 'owner@example.test',
          lang: 'vi',
        }),
      })
    );
    assert.equal(unconfRes.status, 503);
    const unconfRaw = JSON.stringify(await unconfRes.json());
    assert.equal(unconfRaw.includes(sentinelSecretToken), false);
    assert.equal(unconfRaw.includes('owner@example.test'), false);

    zitadelMode = 'unavailable_503';
    const unavailRes = await loginUiPost(
      new Request('https://qlaok.vunph.click/api/auth/login-ui', {
        method: 'POST',
        headers: {
          Origin: 'https://qlaok.vunph.click',
          'X-Real-IP': '198.51.100.35',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'password_reset_complete',
          userID: '289911223344556677',
          code: sentinelCode,
          password: sentinelPassword,
          confirmPassword: sentinelPassword,
          lang: 'vi',
        }),
      })
    );
    assert.equal(unavailRes.status, 503);
    const unavailBody = (await unavailRes.json()) as Record<string, unknown>;
    assert.deepEqual(unavailBody, {
      ok: false,
      code: 'ZITADEL_UNAVAILABLE',
      error: 'Chưa thể xử lý yêu cầu đặt lại mật khẩu lúc này. Vui lòng thử lại.',
    });
    const serializedUnavail = JSON.stringify(unavailBody);
    assert.equal(serializedUnavail.includes(sentinelSecretToken), false);
    assert.equal(serializedUnavail.includes(sentinelPassword), false);
    assert.equal(serializedUnavail.includes(sentinelCode), false);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevIssuer === undefined) delete process.env.ZITADEL_ISSUER_URL;
    else process.env.ZITADEL_ISSUER_URL = prevIssuer;
    if (prevPat === undefined) delete process.env.ZITADEL_LOGIN_CLIENT_PAT;
    else process.env.ZITADEL_LOGIN_CLIENT_PAT = prevPat;
    if (prevWebClient === undefined) delete process.env.ZITADEL_CLIENT_ID;
    else process.env.ZITADEL_CLIENT_ID = prevWebClient;
    if (prevMobileClient === undefined) delete process.env.ZITADEL_MOBILE_CLIENT_ID;
    else process.env.ZITADEL_MOBILE_CLIENT_ID = prevMobileClient;
    resetAuthEmailTestHooks();
    resetZitadelLoginUiRateLimitsForTests();
  }
});

test('Auth email templates escape names and reject untrusted reset links', () => {
  const rendered = renderRegistrationVerificationEmail({
    email: 'owner@example.test', fullName: '<script>alert(1)</script>',
    verificationCode: '849201', lang: 'vi', origin: 'https://qlaok.vunph.click',
  });
  assert.match(rendered.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(rendered.html, /<script>/);
  assert.doesNotMatch(rendered.html, /href="[^"]*849201/);
  assert.match(rendered.subject, /xác thực/i);
  assert.match(rendered.subject, /verify/i);
  assert.throws(() => renderPasswordResetEmail({
    email: 'owner@example.test', origin: 'https://qlaok.vunph.click',
    resetUrl: 'https://attacker.example/login?mode=reset&userID=123&code=123456',
  }), /UNTRUSTED_EMAIL_URL/);
});

test('SMTP configuration and transport fail closed without exposing secrets', async () => {
  assert.throws(() => resolveAuthEmailSmtpConfig({}), AuthEmailError);
  const env = {
    NODE_ENV: 'production', SMTP_HOST: 'smtp.qlaok.internal', SMTP_PORT: '465',
    SMTP_SECURE: 'true', SMTP_USER: 'mailer@qlaok.vunph.click',
    SMTP_PASS: 'super-secret-smtp-pass-999', SMTP_FROM: 'no-reply@qlaok.vunph.click',
    SMTP_FROM_NAME: 'Qlaok Auth', SMTP_TIMEOUT_MS: '8000',
  };
  assert.throws(() => resolveAuthEmailSmtpConfig({ ...env, NEXT_PUBLIC_SMTP_PASS: 'leaked' }), AuthEmailError);
  const smtpConfig = resolveAuthEmailSmtpConfig(env);
  assert.equal(smtpConfig.secure, true);
  assert.equal(smtpConfig.timeoutMs, 8000);
  assert.equal(smtpConfig.from, '"Qlaok Auth" <no-reply@qlaok.vunph.click>');
  const rendered = renderRegistrationVerificationEmail({ email: 'owner@example.test', verificationCode: '778899' });
  const observed: Array<{ to: string; from: string }> = [];
  let closed = 0;
  await sendAuthEmail({
    to: 'owner@example.test', rendered, smtpConfig,
    transportFactory: (cfg) => ({
      sendMail: async (message) => {
        assert.equal(cfg.host, env.SMTP_HOST);
        observed.push({ to: message.to, from: message.from });
        return { accepted: [message.to], rejected: [] };
      },
      close: () => { closed += 1; },
    }),
  });
  assert.deepEqual(observed, [{ to: 'owner@example.test', from: smtpConfig.from }]);
  assert.equal(closed, 1);
  await assert.rejects(() => sendAuthEmail({
    to: 'owner@example.test', rendered, smtpConfig,
    transportFactory: () => ({ sendMail: async () => { throw new Error('super-secret-smtp-pass-999 code 778899'); } }),
  }), (err: unknown) => {
    assert.ok(err instanceof AuthEmailError);
    assert.equal(err.code, 'EMAIL_DELIVERY_FAILED');
    assert.doesNotMatch(err.message, /super-secret|778899/);
    return true;
  });
});

test('Registration can recover an unverified user after mail delivery fails', async () => {
  resetZitadelLoginUiRateLimitsForTests();
  const delivered: AuthEmailSendPayload[] = [];
  let fail = true;
  let created = false;
  let resendBody: unknown;
  const testConfig: ZitadelLoginUiConfig = { ...config, sendEmail: async (payload) => {
    if (fail) throw new Error('SMTP unavailable');
    delivered.push(payload);
  } };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith(`/v2/oidc/auth_requests/${authRequestId}`)) return response({ authRequest: authRequest() });
    if (url.endsWith('/v2/users/new')) {
      if (created) return response({ message: 'User already exists' }, 409);
      created = true;
      const body = JSON.parse(String(init?.body || '{}'));
      assert.deepEqual(body.human.email.returnCode, {});
      assert.notEqual(body.human.password.password, 'StrongPass1!');
      return response({ userId: 'unverified-user-777', emailCode: '918273' });
    }
    if (url.endsWith('/v2/users')) return response({ result: [{ userId: 'unverified-user-777', human: { email: { email: 'retry-owner@example.test', isVerified: false } } }] });
    if (url.endsWith('/v2/users/unverified-user-777/email/resend')) {
      resendBody = JSON.parse(String(init?.body || '{}'));
      return response({ verificationCode: '554433' });
    }
    throw new Error('Unexpected request');
  };
  const args = {
    authRequestId, fullName: 'Lê Văn C', email: 'retry-owner@example.test',
    password: 'StrongPass1!', confirmPassword: 'StrongPass1!',
    origin: 'https://qlaok.example.test', config: testConfig, fetchImpl,
  };
  await assert.rejects(() => startZitadelRegistration(args), (err: unknown) => {
    assert.ok(err instanceof ZitadelLoginUiError);
    assert.equal(err.code, 'EMAIL_DELIVERY_FAILED');
    assert.doesNotMatch(err.message, /918273/);
    return true;
  });
  assert.equal(delivered.length, 0);
  fail = false;
  const recovered = await startZitadelRegistration(args);
  assert.equal(verifyZitadelRegistrationTicket(recovered.registrationTicket).userId, 'unverified-user-777');
  assert.deepEqual(resendBody, { returnCode: {} });
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].to, args.email);
  assert.match(delivered[0].text, /554433/);
  assert.doesNotMatch(JSON.stringify(recovered), /554433/);
});
