#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REQUIRED_PROJECT_REF,
  validateDatabaseUrl,
  redactSecrets,
} from './backup-qlaok-db.mjs';

/**
 * Preflight Demo Reset Inspection for Qlaok (Supabase project kftmrjmmympztzztunxf).
 * Security: Validates database URL syntax and official target host.
 * Reads URL only from QLAOK_DATABASE_URL env; never from CLI args or stdout.
 * Executes read-only psql SELECT without shell, returning JSON table/auth/migration counts.
 */

export const PUBLIC_TABLES = Object.freeze([
  'schema_migrations',
  'provinces',
  'profiles',
  'payment_transactions',
  'payment_bank_ref_conflicts',
  'shops',
  'shop_slug_aliases',
  'categories',
  'items',
  'posts',
  'analytics_events',
  'shop_tables',
  'orders',
  'order_audit_logs',
  'admin_audit_logs',
  'table_service_requests',
  'shop_memberships',
  'shop_staff_credentials',
  'staff_login_rate_limits',
  'mobile_push_tokens',
  'shop_sepay_configs',
  'sepay_webhook_events',
]);

export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../supabase/migrations'
);

export function getExpectedMigrationFilenames(migrationsDir = MIGRATIONS_DIR) {
  const entries = readdirSync(migrationsDir);
  return entries
    .filter((file) => typeof file === 'string' && file.endsWith('.sql'))
    .sort();
}

export function isNonNegativeSafeInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export const PREFLIGHT_SQL = `
SELECT json_build_object(
  'tables', json_build_object(
    'schema_migrations', (SELECT COUNT(*)::int FROM public.schema_migrations),
    'provinces', (SELECT COUNT(*)::int FROM public.provinces),
    'profiles', (SELECT COUNT(*)::int FROM public.profiles),
    'payment_transactions', (SELECT COUNT(*)::int FROM public.payment_transactions),
    'payment_bank_ref_conflicts', (SELECT COUNT(*)::int FROM public.payment_bank_ref_conflicts),
    'shops', (SELECT COUNT(*)::int FROM public.shops),
    'shop_slug_aliases', (SELECT COUNT(*)::int FROM public.shop_slug_aliases),
    'categories', (SELECT COUNT(*)::int FROM public.categories),
    'items', (SELECT COUNT(*)::int FROM public.items),
    'posts', (SELECT COUNT(*)::int FROM public.posts),
    'analytics_events', (SELECT COUNT(*)::int FROM public.analytics_events),
    'shop_tables', (SELECT COUNT(*)::int FROM public.shop_tables),
    'orders', (SELECT COUNT(*)::int FROM public.orders),
    'order_audit_logs', (SELECT COUNT(*)::int FROM public.order_audit_logs),
    'admin_audit_logs', (SELECT COUNT(*)::int FROM public.admin_audit_logs),
    'table_service_requests', (SELECT COUNT(*)::int FROM public.table_service_requests),
    'shop_memberships', (SELECT COUNT(*)::int FROM public.shop_memberships),
    'shop_staff_credentials', (SELECT COUNT(*)::int FROM public.shop_staff_credentials),
    'staff_login_rate_limits', (SELECT COUNT(*)::int FROM public.staff_login_rate_limits),
    'mobile_push_tokens', (SELECT COUNT(*)::int FROM public.mobile_push_tokens),
    'shop_sepay_configs', (SELECT COUNT(*)::int FROM public.shop_sepay_configs),
    'sepay_webhook_events', (SELECT COUNT(*)::int FROM public.sepay_webhook_events)
  ),
  'auth_users_count', (SELECT COUNT(*)::int FROM auth.users),
  'migrations', json_build_object(
    'count', (SELECT COUNT(*)::int FROM public.schema_migrations),
    'filenames', (SELECT COALESCE(json_agg(filename ORDER BY filename), '[]'::json) FROM public.schema_migrations)
  )
)::text;
`.trim();

export function parsePreflightArgs(argv = []) {
  let projectRef = '';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--project-ref') {
      projectRef = argv[++i] || '';
    } else if (arg.startsWith('--project-ref=')) {
      projectRef = arg.slice(14);
    } else if (arg === '--help' || arg === '-h') {
      return { help: true };
    } else if (/^(postgres|postgresql):\/\//i.test(arg) || arg.startsWith('--db') || arg.startsWith('--url')) {
      throw new Error('Database URL must never be passed via CLI arguments.');
    } else {
      throw new Error('Unknown option provided. Database credentials and arguments must not be passed via CLI.');
    }
  }
  if (!projectRef) {
    throw new Error(`--project-ref is required and must be exact '${REQUIRED_PROJECT_REF}'.`);
  }
  if (projectRef !== REQUIRED_PROJECT_REF) {
    throw new Error(`--project-ref is required and must be exact '${REQUIRED_PROJECT_REF}'.`);
  }
  return { projectRef };
}

export function executePreflight(options = {}, env = process.env, deps = {}) {
  const projectRef = options.projectRef;
  if (!projectRef || projectRef !== REQUIRED_PROJECT_REF) {
    throw new Error(`--project-ref is required and must be exact '${REQUIRED_PROJECT_REF}'.`);
  }

  const rawUrl = env.QLAOK_DATABASE_URL;
  const { hostname, port, database, username, password, sslmode } = validateDatabaseUrl(rawUrl, projectRef);

  const spawn = deps.spawnSync || spawnSync;
  const childEnv = {
    ...env,
    PGDATABASE: database,
    PGHOST: hostname,
    PGPORT: port,
    PGUSER: username,
    PGPASSWORD: password,
    PGSSLMODE: sslmode,
  };

  const psqlArgs = ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', PREFLIGHT_SQL];
  const res = spawn('psql', psqlArgs, {
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  if (res.error || res.status !== 0) {
    const exitCode =
      res.status !== null && res.status !== undefined
        ? res.status
        : res.error?.code || 'error';
    throw new Error(`psql failed with exit code ${exitCode}.`);
  }

  const rawOutput = (res.stdout ? res.stdout.toString('utf8') : '').trim();
  if (!rawOutput) {
    throw new Error('psql returned empty output.');
  }

  let data;
  try {
    data = JSON.parse(rawOutput);
  } catch {
    throw new Error('psql returned invalid JSON output.');
  }

  if (!data || typeof data !== 'object' || !data.tables || typeof data.tables !== 'object') {
    throw new Error('Preflight result missing expected tables structure.');
  }

  const normalizedTables = {};
  for (const table of PUBLIC_TABLES) {
    const count = data.tables[table];
    if (typeof count !== 'number') {
      throw new Error(`Preflight result missing count for table: ${table}`);
    }
    if (!isNonNegativeSafeInteger(count)) {
      throw new Error(`Preflight result invalid count for table: ${table}`);
    }
    normalizedTables[table] = count;
  }

  const authUsersCount =
    typeof data.auth_users_count === 'number'
      ? data.auth_users_count
      : data.auth_users?.count;

  if (authUsersCount === undefined || authUsersCount === null || typeof authUsersCount !== 'number') {
    throw new Error('Preflight result missing auth.users count.');
  }
  if (!isNonNegativeSafeInteger(authUsersCount)) {
    throw new Error('Preflight result invalid auth.users count.');
  }

  if (
    !data.migrations ||
    typeof data.migrations !== 'object' ||
    typeof data.migrations.count !== 'number' ||
    !Array.isArray(data.migrations.filenames)
  ) {
    throw new Error('Preflight result missing migrations count or filenames list.');
  }

  if (!isNonNegativeSafeInteger(data.migrations.count)) {
    throw new Error('Preflight result invalid migrations count.');
  }

  if (data.migrations.count !== data.migrations.filenames.length) {
    throw new Error(
      `Migrations count (${data.migrations.count}) does not match filenames list length (${data.migrations.filenames.length}).`
    );
  }

  const migrationsDir = deps.migrationsDir || MIGRATIONS_DIR;
  const expectedFilenames =
    deps.expectedMigrations || getExpectedMigrationFilenames(migrationsDir);
  const expectedSet = new Set(expectedFilenames);

  if (data.migrations.count !== expectedFilenames.length) {
    throw new Error(
      `Migrations count (${data.migrations.count}) does not match expected local migration count (${expectedFilenames.length}).`
    );
  }

  const seenFilenames = new Set();
  for (const filename of data.migrations.filenames) {
    if (typeof filename !== 'string' || !filename.trim()) {
      throw new Error('Preflight migration filenames list contains invalid entry.');
    }
    if (seenFilenames.has(filename)) {
      throw new Error(`Duplicate migration filename found: ${filename}`);
    }
    seenFilenames.add(filename);
    if (!expectedSet.has(filename)) {
      throw new Error(`Unknown migration filename found: ${filename}`);
    }
  }

  for (const expected of expectedFilenames) {
    if (!seenFilenames.has(expected)) {
      throw new Error(`Missing expected migration filename: ${expected}`);
    }
  }

  return {
    tables: normalizedTables,
    auth_users_count: authUsersCount,
    migrations: {
      count: data.migrations.count,
      filenames: [...data.migrations.filenames],
    },
  };
}

export const runPreflight = executePreflight;

export function runPreflightCli(argv = process.argv.slice(2), env = process.env, deps = {}) {
  const args = parsePreflightArgs(argv);
  if (args.help) {
    console.log(
      'Usage: QLAOK_DATABASE_URL=... node scripts/preflight-demo-reset.mjs --project-ref kftmrjmmympztzztunxf'
    );
    return;
  }
  const result = executePreflight(args, env, deps);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runPreflightCli();
  } catch (err) {
    console.error(`❌ Preflight failed: ${redactSecrets(err.message)}`);
    process.exit(1);
  }
}
