import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveMobileApiBaseUrl } from '../src/lib/api-base-url.ts';

const productionApiUrl = 'https://api.qlaok.example';

test('production API URLs require HTTPS and fall back safely for HTTP overrides', () => {
  assert.equal(
    resolveMobileApiBaseUrl({
      envUrl: 'http://api.qlaok.example',
      isDev: false,
      platform: 'ios',
      productionApiUrl,
    }),
    productionApiUrl
  );
  assert.equal(
    resolveMobileApiBaseUrl({
      envUrl: 'https://api.other.example/',
      isDev: false,
      platform: 'ios',
      productionApiUrl,
    }),
    'https://api.other.example'
  );
});

test('development HTTP API URLs are limited to loopback and RFC1918 hosts', () => {
  assert.equal(
    resolveMobileApiBaseUrl({
      envUrl: 'http://192.168.1.42:3000',
      isDev: true,
      platform: 'ios',
      productionApiUrl,
    }),
    'http://192.168.1.42:3000'
  );
  assert.equal(
    resolveMobileApiBaseUrl({
      envUrl: 'http://public.example:3000',
      isDev: true,
      platform: 'android',
      productionApiUrl,
    }),
    'http://10.0.2.2:3000'
  );
});

test('development localhost overrides resolve to Metro or Android emulator addresses', () => {
  assert.equal(
    resolveMobileApiBaseUrl({
      envUrl: 'http://localhost:3000',
      isDev: true,
      platform: 'ios',
      metroHostIp: '192.168.1.17',
      productionApiUrl,
    }),
    'http://192.168.1.17:3000'
  );
  assert.equal(
    resolveMobileApiBaseUrl({
      envUrl: 'http://localhost:3000',
      isDev: true,
      platform: 'android',
      productionApiUrl,
    }),
    'http://10.0.2.2:3000'
  );
});
