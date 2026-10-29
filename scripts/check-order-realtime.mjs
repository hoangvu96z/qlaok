// Run on the application server after migration/deploy. No credentials or order
// payloads are logged, and no test records are written to the production DB.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client as PgClient } from 'pg';

const require = createRequire(import.meta.url);
try {
  require('@next/env').loadEnvConfig(process.cwd());
} catch {
  // environment already loaded
}

export function queryTriggersViaPsql(dbName = process.env.QLAOK_DB_NAME || 'qlaok') {
  const result = spawnSync(
    'sudo',
    [
      '-n',
      '-u',
      'postgres',
      'psql',
      '-X',
      '-q',
      '-t',
      '-A',
      '-d',
      dbName,
      '-c',
      "SELECT count(*)::int FROM pg_trigger WHERE tgname IN ('trg_orders_realtime_notify', 'trg_table_service_requests_realtime_notify');",
    ],
    { encoding: 'utf8' }
  );
  if (result.error || result.status !== 0) {
    throw new Error(`psql trigger check failed: ${result.stderr || result.error?.message}`);
  }
  return parseInt(result.stdout.trim(), 10);
}

const DEFAULT_STARTUP_ATTEMPTS = 15;
const DEFAULT_STARTUP_RETRY_MS = 1000;

async function retryStartupCheck(check, {
  attempts = DEFAULT_STARTUP_ATTEMPTS,
  retryDelayMs = DEFAULT_STARTUP_RETRY_MS,
  label,
} = {}) {
  let lastError = 'service is not ready';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await check();
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < attempts && retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastError}`);
}

export async function verifyPostgresTriggers({
  connectionString = process.env.QLAOK_DATABASE_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL,
  dbClient,
} = {}) {
  if (dbClient) {
    const res = await dbClient.query(
      "SELECT count(*)::int as count FROM pg_trigger WHERE tgname IN ('trg_orders_realtime_notify', 'trg_table_service_requests_realtime_notify');"
    );
    const count = parseInt(res?.rows?.[0]?.count ?? 0, 10);
    if (count < 2) {
      throw new Error(`Expected 2 realtime triggers in PostgreSQL, found ${count}. Run db:migrate.`);
    }
    return;
  }

  if (connectionString) {
    const client = new PgClient({
      connectionString,
      ssl:
        connectionString.includes('sslmode=require') ||
        connectionString.includes('supabase.co')
          ? { rejectUnauthorized: false }
          : undefined,
    });
    await client.connect();
    try {
      const res = await client.query(
        "SELECT count(*)::int as count FROM pg_trigger WHERE tgname IN ('trg_orders_realtime_notify', 'trg_table_service_requests_realtime_notify');"
      );
      const count = parseInt(res?.rows?.[0]?.count ?? 0, 10);
      if (count < 2) {
        throw new Error(`Expected 2 realtime triggers in PostgreSQL, found ${count}. Run db:migrate.`);
      }
    } finally {
      await client.end();
    }
    return;
  }

  // Fallback: try psql directly
  const count = queryTriggersViaPsql();
  if (count < 2) {
    throw new Error(`Expected 2 realtime triggers in PostgreSQL, found ${count}. Run db:migrate.`);
  }
}

export async function verifySseEndpoint({
  baseUrl = `http://localhost:${process.env.PORT || 3005}`,
  fetchFn = fetch,
  startupAttempts = DEFAULT_STARTUP_ATTEMPTS,
  retryDelayMs = DEFAULT_STARTUP_RETRY_MS,
} = {}) {
  await retryStartupCheck(async () => {
    // Missing params must return HTTP 400 (verifies route is mounted and active).
    const resBad = await fetchFn(`${baseUrl}/api/orders/events`);
    if (resBad.status !== 400) {
      throw new Error(`Expected HTTP 400 for missing parameters, got ${resBad.status}`);
    }

    // An unauthenticated shop stream must return 401/403 (verifies the auth guard).
    const resUnauth = await fetchFn(
      `${baseUrl}/api/orders/events?shopId=deploy-check-shop`
    );
    if (resUnauth.status !== 401 && resUnauth.status !== 403) {
      throw new Error(`Expected HTTP 401/403 without auth, got ${resUnauth.status}`);
    }
  }, {
    attempts: startupAttempts,
    retryDelayMs,
    label: 'Orders SSE endpoint verification',
  });
}

export async function verifyHealthEndpoint({
  baseUrl = `http://localhost:${process.env.PORT || 3005}`,
  fetchFn = fetch,
  startupAttempts = DEFAULT_STARTUP_ATTEMPTS,
  retryDelayMs = DEFAULT_STARTUP_RETRY_MS,
} = {}) {
  await retryStartupCheck(async () => {
    const response = await fetchFn(`${baseUrl}/api/health`);
    if (response.status !== 200) {
      throw new Error(`Expected HTTP 200 from /api/health, got ${response.status}`);
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error('/api/health returned invalid JSON');
    }
    if (payload?.status !== 'ok' || payload?.service !== 'qlaok-backend') {
      throw new Error('/api/health did not confirm application readiness');
    }
  }, {
    attempts: startupAttempts,
    retryDelayMs,
    label: 'Application health verification',
  });
}

export function verifyGarageConfiguration({ env = process.env } = {}) {
  const required = ['S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET_NAME', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_URL'];
  if (required.some((name) => !env[name])) {
    throw new Error('Garage configuration is incomplete');
  }
}

export async function verifyDeploymentRealtime(options = {}) {
  await verifyPostgresTriggers(options);
  verifyGarageConfiguration(options);
  await verifyHealthEndpoint(options);
  await verifySseEndpoint(options);
  console.log('PostgreSQL triggers, Garage configuration, application health, and order realtime verified.');
}

const isDirectExecution =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectExecution) {
  try {
    await verifyDeploymentRealtime();
  } catch (err) {
    console.error('Realtime verification failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
