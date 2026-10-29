import assert from 'node:assert/strict';
import test from 'node:test';
import {
  verifyDeploymentRealtime,
  verifyHealthEndpoint,
  verifyGarageConfiguration,
  verifyPostgresTriggers,
  verifySseEndpoint,
} from '../scripts/check-order-realtime.mjs';

test('verifyPostgresTriggers: passes when both triggers exist in PostgreSQL', async () => {
  const queryLog = [];
  const mockDbClient = {
    async query(sql) {
      queryLog.push(sql);
      return {
        rows: [{ count: 2 }],
      };
    },
  };

  await verifyPostgresTriggers({ dbClient: mockDbClient });
  assert.equal(queryLog.length, 1);
  assert.match(queryLog[0], /trg_orders_realtime_notify/);
  assert.match(queryLog[0], /trg_table_service_requests_realtime_notify/);
  // Must NOT insert or modify any rows
  assert.doesNotMatch(queryLog[0], /INSERT|UPDATE|DELETE/);
});

test('verifyPostgresTriggers: rejects when triggers are missing or incomplete', async () => {
  const mockDbClient = {
    async query() {
      return {
        rows: [{ count: 1 }],
      };
    },
  };

  await assert.rejects(
    () => verifyPostgresTriggers({ dbClient: mockDbClient }),
    /Expected 2 realtime triggers in PostgreSQL, found 1/
  );
});

test('verifySseEndpoint: validates endpoint mounting and authentication guard without modifying data', async () => {
  const fetchCalls = [];
  const mockFetch = async (url) => {
    fetchCalls.push(url);
    if (url.endsWith('/api/orders/events')) {
      return { status: 400 };
    }
    if (url.includes('shopId=deploy-check-shop')) {
      return { status: 401 };
    }
    return { status: 404 };
  };

  await verifySseEndpoint({
    baseUrl: 'http://localhost:3005',
    fetchFn: mockFetch,
  });

  assert.equal(fetchCalls.length, 2);
  assert.equal(fetchCalls[0], 'http://localhost:3005/api/orders/events');
  assert.equal(
    fetchCalls[1],
    'http://localhost:3005/api/orders/events?shopId=deploy-check-shop'
  );
});

test('verifySseEndpoint: retries while PM2 is still starting the Next.js server', async () => {
  let fetchCalls = 0;
  const mockFetch = async (url) => {
    fetchCalls += 1;
    if (fetchCalls === 1) throw new Error('ECONNREFUSED');
    if (url.endsWith('/api/orders/events')) return { status: 400 };
    return { status: 401 };
  };

  await verifySseEndpoint({
    baseUrl: 'http://localhost:3005',
    fetchFn: mockFetch,
    startupAttempts: 3,
    retryDelayMs: 0,
  });
  assert.equal(fetchCalls, 3);
});

test('verifyHealthEndpoint: validates the public readiness response', async () => {
  const payload = {
    status: 'ok',
    service: 'qlaok-backend',
  };

  await verifyHealthEndpoint({
    baseUrl: 'http://localhost:3005',
    fetchFn: async () => ({ status: 200, json: async () => payload }),
  });

  await assert.rejects(
    () => verifyHealthEndpoint({
      baseUrl: 'http://localhost:3005',
      startupAttempts: 1,
      retryDelayMs: 0,
      fetchFn: async () => ({
        status: 200,
        json: async () => ({
          ...payload,
          status: 'degraded',
        }),
      }),
    }),
    /did not confirm application readiness/
  );
});

test('verifyGarageConfiguration: rejects missing server-side settings without exposing values', () => {
  const env = Object.fromEntries(['S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET_NAME', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_URL'].map((key) => [key, 'configured']));
  verifyGarageConfiguration({ env });
  delete env.S3_BUCKET_NAME;
  assert.throws(() => verifyGarageConfiguration({ env }), /Garage configuration is incomplete/);
});

test('verifySseEndpoint: rejects when endpoint returns unexpected error or 200 without auth', async () => {
  const failingFetch = async () => ({ status: 503 });

  await assert.rejects(
    () => verifySseEndpoint({
      baseUrl: 'http://localhost:3005',
      fetchFn: failingFetch,
      startupAttempts: 1,
      retryDelayMs: 0,
    }),
    /Expected HTTP 400 for missing parameters, got 503/
  );
});

test('verifyDeploymentRealtime: succeeds end-to-end with mock DB client and fetch', async () => {
  const mockDbClient = {
    async query() {
      return { rows: [{ count: 2 }] };
    },
  };
  const mockFetch = async (url) => {
    if (url.endsWith('/api/orders/events')) return { status: 400 };
    if (url.endsWith('/api/health')) {
      return {
        status: 200,
        json: async () => ({
          status: 'ok',
          service: 'qlaok-backend',
        }),
      };
    }
    return { status: 401 };
  };

  let loggedMessage = '';
  const origLog = console.log;
  console.log = (msg) => {
    loggedMessage = msg;
  };
  try {
    await verifyDeploymentRealtime({
      dbClient: mockDbClient,
      baseUrl: 'http://localhost:3005',
      fetchFn: mockFetch,
      env: Object.fromEntries(['S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET_NAME', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_URL'].map((key) => [key, 'configured'])),
    });
    assert.match(loggedMessage, /PostgreSQL triggers, Garage configuration, application health, and order realtime verified/);
  } finally {
    console.log = origLog;
  }
});
