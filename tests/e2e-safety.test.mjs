import assert from 'node:assert/strict';
import test from 'node:test';
import { canRunMutatingE2e, resolveE2eBaseUrl } from './e2e-safety.mjs';

test('E2E base URL allows only loopback HTTP origins', () => {
  assert.equal(resolveE2eBaseUrl(), 'http://localhost:3000');
  assert.equal(resolveE2eBaseUrl('http://127.0.0.1:4312/'), 'http://127.0.0.1:4312');
  assert.equal(resolveE2eBaseUrl('http://[::1]:3000'), 'http://[::1]:3000');
});

test('E2E base URL rejects remote hosts, TLS, credentials, and URL paths', () => {
  for (const value of [
    'https://qlaok.vunph.click',
    'https://example.supabase.co',
    'http://10.0.0.8:3000',
    'https://localhost:3000',
    'http://user:password@localhost:3000',
    'http://localhost:3000/proxy',
    'http://localhost:3000/?shop=production',
  ]) {
    assert.throws(() => resolveE2eBaseUrl(value), /loopback HTTP origin/);
  }
});

test('mutating E2E tests require both explicit disposable-DB flags', () => {
  assert.equal(canRunMutatingE2e({}), false);
  assert.equal(canRunMutatingE2e({ E2E_ALLOW_MUTATIONS: '1' }), false);
  assert.equal(canRunMutatingE2e({ E2E_DISPOSABLE_DATABASE: '1' }), false);
  assert.equal(
    canRunMutatingE2e({
      E2E_ALLOW_MUTATIONS: 'true',
      E2E_DISPOSABLE_DATABASE: '1',
    }),
    false
  );
  assert.equal(
    canRunMutatingE2e({
      E2E_ALLOW_MUTATIONS: '1',
      E2E_DISPOSABLE_DATABASE: '1',
    }),
    true
  );
});
