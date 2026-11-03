import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSelfHostedPostgrestUrl } from '../src/lib/postgrest-url.ts';

test('PostgREST URLs accept HTTPS and normalize the REST endpoint suffix', () => {
  assert.equal(
    normalizeSelfHostedPostgrestUrl(
      ' https://qlaok.vunph.click/rest/v1/ ',
      false
    ),
    'https://qlaok.vunph.click'
  );
});

test('remote HTTP is rejected in production and in development', () => {
  assert.equal(
    normalizeSelfHostedPostgrestUrl('http://api.example.test/rest/v1', false),
    null
  );
  assert.equal(
    normalizeSelfHostedPostgrestUrl('http://api.example.test/rest/v1', true),
    null
  );
  assert.equal(
    normalizeSelfHostedPostgrestUrl('http://fc-example.test/rest/v1', true),
    null
  );
});

test('development HTTP remains limited to loopback and private device-network hosts', () => {
  for (const url of [
    'http://localhost:8090',
    'http://127.0.0.1:8090/rest/v1',
    'http://[::1]:8090',
    'http://10.0.2.2:8090',
    'http://192.168.1.17:8090',
    'http://[fc00::1]:8090',
  ]) {
    assert.ok(normalizeSelfHostedPostgrestUrl(url, true), url);
    assert.equal(normalizeSelfHostedPostgrestUrl(url, false), null, url);
  }
});

test('malformed, unsupported, credential-bearing, and decorated URLs fail closed', () => {
  for (const url of [
    'not a URL',
    'ftp://localhost:8090',
    'http://user:password@localhost:8090',
    'https://qlaok.vunph.click/?token=do-not-use',
    'https://qlaok.vunph.click/#fragment',
  ]) {
    assert.equal(normalizeSelfHostedPostgrestUrl(url, true), null, url);
  }
});
