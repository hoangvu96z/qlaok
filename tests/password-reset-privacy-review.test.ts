import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PASSWORD_RESET_REQUEST_EMAIL_MAX_ATTEMPTS,
  requestZitadelPasswordReset,
  resetZitadelLoginUiRateLimitsForTests,
  type ZitadelLoginUiConfig,
} from '../src/lib/zitadel-login-ui';

const config: ZitadelLoginUiConfig = {
  issuerUrl: 'https://auth.example.test',
  serviceToken: 'private-test-token',
  webClientId: 'web-client',
  mobileClientId: 'mobile-client',
  webRedirectUri: 'https://qlaok.example.test/api/auth/callback',
  mobileRedirectUri: 'qlaok://auth/callback',
};

test('password reset hides account eligibility on delivery and provider failures and retains rate limiting', async () => {
  resetZitadelLoginUiRateLimitsForTests();
  const oldLog = console.error;
  const logs: unknown[][] = [];
  console.error = (...args: unknown[]) => { logs.push(args); };
  const email = 'owner@example.test';
  const makeFetch = (mode: 'missing' | 'delivery' | 'provider' | 'badcode'): typeof fetch => async (input) => {
    const url = String(input);
    if (url.endsWith('/v2/users')) {
      return Response.json({ result: mode === 'missing' ? [] : [{ userId: '123456', state: 'USER_STATE_ACTIVE', human: { email: { email, isVerified: true } } }] });
    }
    if (url.endsWith('/password_reset')) {
      if (mode === 'provider') return new Response('{}', { status: 503 });
      return Response.json(mode === 'badcode' ? {} : { verificationCode: 'SECRET123' });
    }
    throw new Error('unexpected request');
  };
  try {
    for (const mode of ['missing', 'delivery', 'provider', 'badcode'] as const) {
      const result = await requestZitadelPasswordReset({
        email,
        origin: 'https://qlaok.example.test',
        clientIp: `test-${mode}`,
        config,
        fetchImpl: makeFetch(mode),
        sendEmail: async () => { throw new Error('private provider detail'); },
      });
      assert.deepEqual(result, { ok: true });
    }
    assert.equal(logs.length, 3);
    for (const args of logs) assert.deepEqual(args, ['Password reset email processing failed']);
    for (let attempt = 4; attempt < PASSWORD_RESET_REQUEST_EMAIL_MAX_ATTEMPTS; attempt++) {
      await requestZitadelPasswordReset({ email, origin: 'https://qlaok.example.test', clientIp: `test-extra-${attempt}`, config, fetchImpl: makeFetch('missing'), sendEmail: async () => {} });
    }
    await assert.rejects(
      requestZitadelPasswordReset({ email, origin: 'https://qlaok.example.test', clientIp: 'test-limit', config, fetchImpl: makeFetch('missing'), sendEmail: async () => {} }),
      (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'LOGIN_RATE_LIMITED'
    );
  } finally {
    console.error = oldLog;
    resetZitadelLoginUiRateLimitsForTests();
  }
});
