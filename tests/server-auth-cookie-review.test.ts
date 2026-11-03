import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractRequestToken,
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
