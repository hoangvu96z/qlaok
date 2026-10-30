#!/usr/bin/env node

import http from 'node:http';
import { pathToFileURL } from 'node:url';

const REST_PREFIX = '/rest/v1';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTS.has(hostname.replace(/^\[|\]$/g, '').toLowerCase());
}

export function createSupabaseRestProxyServer(upstreamOrigin) {
  const upstream = new URL(upstreamOrigin);
  if (
    upstream.protocol !== 'http:' ||
    !isLoopbackHost(upstream.hostname) ||
    upstream.username ||
    upstream.password ||
    upstream.pathname !== '/' ||
    upstream.search ||
    upstream.hash
  ) {
    throw new Error('E2E PostgREST upstream must be a loopback HTTP origin.');
  }

  return http.createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    if (
      requestUrl.pathname !== REST_PREFIX &&
      !requestUrl.pathname.startsWith(`${REST_PREFIX}/`)
    ) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    const upstreamUrl = new URL(upstream);
    upstreamUrl.pathname = requestUrl.pathname.slice(REST_PREFIX.length) || '/';
    upstreamUrl.search = requestUrl.search;

    const headers = Object.fromEntries(
      Object.entries(request.headers).filter(
        ([name]) => !HOP_BY_HOP_HEADERS.has(name.toLowerCase())
      )
    );
    headers.host = upstream.host;

    const upstreamRequest = http.request(
      upstreamUrl,
      { method: request.method, headers },
      (upstreamResponse) => {
        const responseHeaders = Object.fromEntries(
          Object.entries(upstreamResponse.headers).filter(
            ([name]) => !HOP_BY_HOP_HEADERS.has(name.toLowerCase())
          )
        );
        response.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
        upstreamResponse.pipe(response);
      }
    );

    upstreamRequest.on('error', () => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.writeHead(502, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'PostgREST upstream unavailable' }));
    });

    request.pipe(upstreamRequest);
  });
}

async function startProxy() {
  const upstreamOrigin = process.env.E2E_POSTGREST_ORIGIN;
  const port = Number(process.env.E2E_SUPABASE_REST_PROXY_PORT);
  if (!upstreamOrigin || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      'Set E2E_POSTGREST_ORIGIN and E2E_SUPABASE_REST_PROXY_PORT for the disposable E2E runner.'
    );
  }

  const server = createSupabaseRestProxyServer(upstreamOrigin);
  server.listen(port, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  const stop = () => server.close(() => process.exit(0));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startProxy().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Proxy failed to start.');
    process.exitCode = 1;
  });
}
