import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createSupabaseRestProxyServer } from '../scripts/e2e-supabase-rest-proxy.mjs';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function close(server) {
  if (server.listening) {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

test('Supabase REST proxy strips only /rest/v1 and preserves request/response', async () => {
  const upstreamRequests = [];
  const upstream = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      upstreamRequests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        apikey: request.headers.apikey,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      response.writeHead(201, {
        'content-type': 'application/json',
        'x-upstream': 'postgrest-test',
      });
      response.end(JSON.stringify({ accepted: true }));
    });
  });
  const upstreamPort = await listen(upstream);
  const proxy = createSupabaseRestProxyServer(
    `http://127.0.0.1:${upstreamPort}`
  );
  const proxyPort = await listen(proxy);

  try {
    const response = await fetch(
      `http://127.0.0.1:${proxyPort}/rest/v1/shops?select=id`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-service-role-token',
          apikey: 'test-api-key',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: 'isolated-test' }),
      }
    );

    assert.equal(response.status, 201);
    assert.equal(response.headers.get('x-upstream'), 'postgrest-test');
    assert.deepEqual(await response.json(), { accepted: true });
    assert.deepEqual(upstreamRequests, [
      {
        method: 'POST',
        url: '/shops?select=id',
        authorization: 'Bearer test-service-role-token',
        apikey: 'test-api-key',
        body: JSON.stringify({ name: 'isolated-test' }),
      },
    ]);
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test('Supabase REST proxy rejects paths outside the PostgREST API prefix', async () => {
  const upstream = http.createServer((_request, response) => {
    response.writeHead(204);
    response.end();
  });
  const upstreamPort = await listen(upstream);
  const proxy = createSupabaseRestProxyServer(
    `http://127.0.0.1:${upstreamPort}`
  );
  const proxyPort = await listen(proxy);

  try {
    const response = await fetch(`http://127.0.0.1:${proxyPort}/auth/v1/user`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Not found' });
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test('Supabase REST proxy refuses non-loopback or non-HTTP upstreams', () => {
  assert.throws(
    () => createSupabaseRestProxyServer('http://example.com:3000'),
    /loopback HTTP origin/
  );
  assert.throws(
    () => createSupabaseRestProxyServer('https://127.0.0.1:3000'),
    /loopback HTTP origin/
  );
  assert.throws(
    () => createSupabaseRestProxyServer('http://user:pass@127.0.0.1:3000'),
    /loopback HTTP origin/
  );
});
