import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractRequestToken,
  requireSuperAdmin,
  SESSION_COOKIE_NAME,
} from '../src/lib/server-auth';

function requestWithCookie(cookie: string): Request {
  return new Request('https://qlaok.test/api/auth', {
    headers: { cookie },
  });
}

test('malformed owner-session cookie is treated as unauthenticated', () => {
  assert.equal(
    extractRequestToken(requestWithCookie(`${SESSION_COOKIE_NAME}=%`)),
    null
  );
});

test('malformed owner-session cookie does not hide a later valid duplicate cookie', () => {
  assert.equal(
    extractRequestToken(
      requestWithCookie(`${SESSION_COOKIE_NAME}=%; ${SESSION_COOKIE_NAME}=valid%2Etoken`)
    ),
    'valid.token'
  );
});

test('valid encoded owner-session cookies are still decoded', () => {
  assert.equal(
    extractRequestToken(
      requestWithCookie(`${SESSION_COOKIE_NAME}=signed%2Esession%2Dtoken`)
    ),
    'signed.session-token'
  );
});

test('requireSuperAdmin returns generic SERVER_AUTH_MISCONFIGURED error without exposing internal SESSION_SECRET message', async () => {
  const env = process.env as Record<string, string | undefined>;
  const prevNodeEnv = env.NODE_ENV;
  const hasNodeEnv = Object.prototype.hasOwnProperty.call(env, 'NODE_ENV');
  const prevSessionSecret = env.SESSION_SECRET;
  const hasSessionSecret = Object.prototype.hasOwnProperty.call(
    env,
    'SESSION_SECRET'
  );

  try {
    env.NODE_ENV = 'production';
    delete env.SESSION_SECRET;

    const result = await requireSuperAdmin(
      requestWithCookie(`${SESSION_COOKIE_NAME}=payload.signature`)
    );
    assert.equal(result.user, undefined);
    assert.ok(result.errorResponse);
    assert.equal(result.errorResponse.status, 500);

    const bodyText = await result.errorResponse.text();
    assert.equal(bodyText.includes('SESSION_SECRET'), false);

    const body = JSON.parse(bodyText) as { error?: string; code?: string };
    assert.equal(body.code, 'SERVER_AUTH_MISCONFIGURED');
    assert.equal(
      body.error,
      'Lỗi cấu hình xác thực phiên quản trị trên máy chủ.'
    );
  } finally {
    if (hasNodeEnv) {
      env.NODE_ENV = prevNodeEnv;
    } else {
      delete env.NODE_ENV;
    }
    if (hasSessionSecret) {
      env.SESSION_SECRET = prevSessionSecret;
    } else {
      delete env.SESSION_SECRET;
    }
  }
});
