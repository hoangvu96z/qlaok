import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  createSupabasePublicAuthClient,
  getSupabaseDbClient,
  setSupabaseDbClientForTests,
} from '../src/lib/db';
import { resolveSupabaseApiUrl } from '../src/lib/supabase-url';

const envKeys = [
  'NODE_ENV',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;
const originalEnv = Object.fromEntries(
  envKeys.map((key) => [key, process.env[key]])
);
const mutableEnv = process.env as Record<string, string | undefined>;

afterEach(() => {
  setSupabaseDbClientForTests(null);
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete mutableEnv[key];
    else mutableEnv[key] = value;
  }
});

test('server URL validation accepts HTTPS and local loopback only outside production', () => {
  assert.equal(
    resolveSupabaseApiUrl(' https://qlaok.vunph.click/ '),
    'https://qlaok.vunph.click'
  );
  assert.equal(
    resolveSupabaseApiUrl('http://127.0.0.1:8090', true),
    'http://127.0.0.1:8090'
  );
  assert.equal(resolveSupabaseApiUrl('http://[::1]:8090', true), 'http://[::1]:8090');
  assert.throws(() => resolveSupabaseApiUrl('http://127.0.0.1:8090', false));
});

test('server URL validation rejects remote HTTP, malformed URLs, and embedded credentials without echoing them', () => {
  const rawUrls = [
    'http://api.example.test/private-path',
    'https://service-user:service-password@example.test',
    'ftp://api.example.test',
    'https://api.example.test/?token=do-not-echo',
    'not a URL',
  ];

  for (const rawUrl of rawUrls) {
    let thrown: unknown;
    try {
      resolveSupabaseApiUrl(rawUrl, true);
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown instanceof Error, 'invalid URL must be rejected');
    assert.equal(thrown.message.includes(rawUrl), false);
    assert.equal(thrown.message.includes('service-password'), false);
    assert.equal(thrown.message.includes('do-not-echo'), false);
  }
});

test('both server Supabase clients reject a remote HTTP endpoint before creating a client', () => {
  mutableEnv.NODE_ENV = 'test';
  mutableEnv.NEXT_PUBLIC_SUPABASE_URL = 'http://api.example.test';
  mutableEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
  mutableEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  delete mutableEnv.SUPABASE_SERVICE_ROLE_KEY;

  assert.throws(() => getSupabaseDbClient(), /must be an absolute HTTPS URL/);
  assert.throws(
    () => createSupabasePublicAuthClient(),
    /must be an absolute HTTPS URL/
  );
});

test('server Supabase clients preserve local loopback and test DB override workflows', () => {
  mutableEnv.NODE_ENV = 'test';
  mutableEnv.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:8090';
  mutableEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
  mutableEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  delete mutableEnv.SUPABASE_SERVICE_ROLE_KEY;

  assert.doesNotThrow(() => getSupabaseDbClient());
  assert.doesNotThrow(() => createSupabasePublicAuthClient());

  const testClient = {} as never;
  mutableEnv.NODE_ENV = 'production';
  mutableEnv.NEXT_PUBLIC_SUPABASE_URL = 'http://api.example.test';
  setSupabaseDbClientForTests(testClient);
  assert.equal(getSupabaseDbClient(), testClient);
  assert.equal(createSupabasePublicAuthClient(), testClient);
});
