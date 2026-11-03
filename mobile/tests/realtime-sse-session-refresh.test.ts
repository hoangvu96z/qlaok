import assert from 'node:assert/strict';
import test from 'node:test';
import { didOwnerAccessTokenRefresh } from '../src/lib/owner-session.ts';

test('mobile order SSE recognizes a changed owner token after session sync', () => {
  assert.equal(
    didOwnerAccessTokenRefresh(
      'expired-or-old-token',
      { accessToken: 'refreshed-token' },
      'sync'
    ),
    true
  );
});

test('mobile order SSE does not reconnect for the same token or unrelated session changes', () => {
  const currentToken = 'current-token';
  const currentSession = { accessToken: currentToken };

  assert.equal(
    didOwnerAccessTokenRefresh(currentToken, currentSession, 'sync'),
    false
  );
  assert.equal(
    didOwnerAccessTokenRefresh(
      currentToken,
      { accessToken: 'new-token' },
      'login'
    ),
    false
  );
  assert.equal(didOwnerAccessTokenRefresh(currentToken, null, 'logout'), false);
  assert.equal(didOwnerAccessTokenRefresh(currentToken, null, 'expired'), false);
  assert.equal(didOwnerAccessTokenRefresh(currentToken, null, 'sync'), false);
  assert.equal(
    didOwnerAccessTokenRefresh(currentToken, { accessToken: '' }, 'sync'),
    false
  );
});
