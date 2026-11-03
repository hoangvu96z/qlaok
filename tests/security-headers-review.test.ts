import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Node's built-in type stripping needs the explicit TypeScript suffix.
import nextConfig from '../next.config.ts';

test('Next.js applies baseline security headers to every route', async () => {
  const rules = await nextConfig.headers?.();
  assert.ok(rules);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].source, '/:path*');

  const headers = new Map(rules[0].headers.map(({ key, value }) => [key, value]));
  assert.equal(headers.get('Content-Security-Policy'), "frame-ancestors 'self'");
  assert.equal(headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
  assert.equal(headers.get('Strict-Transport-Security'), 'max-age=31536000');
  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(headers.get('X-Frame-Options'), 'SAMEORIGIN');
});
