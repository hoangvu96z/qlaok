import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePreflightArgs,
  executePreflight,
  runPreflight,
  runPreflightCli,
  PUBLIC_TABLES,
  PREFLIGHT_SQL,
  MIGRATIONS_DIR,
  getExpectedMigrationFilenames,
  isNonNegativeSafeInteger,
} from '../scripts/preflight-demo-reset.mjs';
import { REQUIRED_PROJECT_REF } from '../scripts/backup-qlaok-db.mjs';

const VALID_DIRECT_URL =
  'postgresql://postgres:my%20secret%21@db.kftmrjmmympztzztunxf.supabase.co:5432/postgres';
const VALID_POOLER_URL =
  'postgresql://postgres.kftmrjmmympztzztunxf:my%20secret%21@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres';

const EXPECTED_MIGRATIONS = getExpectedMigrationFilenames();

function createSamplePayload() {
  const tables = {};
  for (const t of PUBLIC_TABLES) {
    tables[t] = 0;
  }
  tables.schema_migrations = EXPECTED_MIGRATIONS.length;
  tables.provinces = 34;
  tables.shops = 3;
  tables.items = 11;

  return {
    tables,
    auth_users_count: 2,
    migrations: {
      count: EXPECTED_MIGRATIONS.length,
      filenames: [...EXPECTED_MIGRATIONS],
    },
  };
}

test('parsePreflightArgs: requires exact project ref and rejects missing or mismatched ref', () => {
  assert.throws(() => parsePreflightArgs([]), /--project-ref is required/);
  assert.throws(
    () => parsePreflightArgs(['--project-ref', 'wrong-ref']),
    /must be exact 'kftmrjmmympztzztunxf'/
  );
  assert.throws(
    () => parsePreflightArgs(['--project-ref=otherref']),
    /must be exact 'kftmrjmmympztzztunxf'/
  );

  const parsed = parsePreflightArgs(['--project-ref', REQUIRED_PROJECT_REF]);
  assert.equal(parsed.projectRef, REQUIRED_PROJECT_REF);

  const helpParsed = parsePreflightArgs(['--help']);
  assert.equal(helpParsed.help, true);
});

test('parsePreflightArgs: rejects database URL in CLI arguments and does not leak secrets', () => {
  assert.throws(
    () => parsePreflightArgs(['--project-ref', REQUIRED_PROJECT_REF, 'postgresql://user:pass@host/db']),
    /Database URL must never be passed via CLI arguments/
  );
  assert.throws(
    () => parsePreflightArgs(['--project-ref', REQUIRED_PROJECT_REF, '--db=postgres']),
    /Database URL must never be passed via CLI arguments/
  );
  assert.throws(
    () => parsePreflightArgs(['--project-ref', REQUIRED_PROJECT_REF, '--url=postgres://...']),
    /Database URL must never be passed via CLI arguments/
  );

  const secretArg = '--secret-token=topsecret12345';
  try {
    parsePreflightArgs(['--project-ref', REQUIRED_PROJECT_REF, secretArg]);
    assert.fail('Expected parsePreflightArgs to throw');
  } catch (err) {
    assert.match(err.message, /Unknown option provided/);
    assert.equal(err.message.includes('topsecret12345'), false);
    assert.equal(err.message.includes(secretArg), false);
  }
});

test('executePreflight: guards URL target and never executes subprocess on invalid input', () => {
  let spawnCalls = 0;
  const mockSpawn = () => {
    spawnCalls++;
    return { status: 0, stdout: Buffer.from('{}') };
  };

  const invalidInputs = [
    { opts: { projectRef: 'wrong-ref' }, env: { QLAOK_DATABASE_URL: VALID_DIRECT_URL } },
    { opts: { projectRef: REQUIRED_PROJECT_REF }, env: { QLAOK_DATABASE_URL: '' } },
    { opts: { projectRef: REQUIRED_PROJECT_REF }, env: { QLAOK_DATABASE_URL: 'http://localhost:3000' } },
    {
      opts: { projectRef: REQUIRED_PROJECT_REF },
      env: { QLAOK_DATABASE_URL: 'postgresql://postgres:pass@localhost:5432/postgres' },
    },
    {
      opts: { projectRef: REQUIRED_PROJECT_REF },
      env: { QLAOK_DATABASE_URL: 'postgresql://postgres:pass@db.otherproject.supabase.co:5432/postgres' },
    },
    {
      opts: { projectRef: REQUIRED_PROJECT_REF },
      env: { QLAOK_DATABASE_URL: 'postgresql://postgres:pass@db.kftmrjmmympztzztunxf.supabase.co:6543/postgres' },
    },
    {
      opts: { projectRef: REQUIRED_PROJECT_REF },
      env: { QLAOK_DATABASE_URL: 'postgresql://postgres:pass@db.kftmrjmmympztzztunxf.supabase.co:5432/otherdb' },
    },
    {
      opts: { projectRef: REQUIRED_PROJECT_REF },
      env: { QLAOK_DATABASE_URL: 'postgresql://postgres.wrongref:pass@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres' },
    },
  ];

  for (const { opts, env } of invalidInputs) {
    assert.throws(
      () => executePreflight(opts, env, { spawnSync: mockSpawn }),
      Error
    );
  }

  assert.equal(spawnCalls, 0, 'Subprocess must not be spawned on invalid input');
});

test('executePreflight: passes credentials safely via PG* env without shell or secrets in argv', () => {
  let capturedCall = null;
  const payload = createSamplePayload();
  const mockSpawn = (cmd, args, opts) => {
    capturedCall = { cmd, args, opts };
    return {
      status: 0,
      stdout: Buffer.from(JSON.stringify(payload)),
    };
  };

  const result = executePreflight(
    { projectRef: REQUIRED_PROJECT_REF },
    { QLAOK_DATABASE_URL: VALID_POOLER_URL },
    { spawnSync: mockSpawn }
  );

  assert.equal(result.auth_users_count, 2);
  assert.equal(result.tables.schema_migrations, EXPECTED_MIGRATIONS.length);
  assert.equal(result.migrations.filenames.length, EXPECTED_MIGRATIONS.length);
  assert.deepEqual(result.migrations.filenames, EXPECTED_MIGRATIONS);
  assert.equal(result.migrations.count, EXPECTED_MIGRATIONS.length);

  assert.equal(capturedCall.cmd, 'psql');
  assert.deepEqual(capturedCall.args, [
    '-X',
    '-A',
    '-t',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    PREFLIGHT_SQL,
  ]);

  // Ensure shell is disabled
  assert.equal(capturedCall.opts.shell, false);

  // Ensure no password or database URL in argv
  for (const arg of capturedCall.args) {
    assert.equal(arg.includes('my secret!'), false);
    assert.equal(arg.includes('my%20secret%21'), false);
    assert.equal(arg.includes('pooler.supabase.com'), false);
  }

  // Ensure connection parameters passed strictly through PG* env
  assert.equal(capturedCall.opts.env.PGDATABASE, 'postgres');
  assert.equal(capturedCall.opts.env.PGHOST, 'aws-0-ap-southeast-1.pooler.supabase.com');
  assert.equal(capturedCall.opts.env.PGPORT, '5432');
  assert.equal(capturedCall.opts.env.PGUSER, 'postgres.kftmrjmmympztzztunxf');
  assert.equal(capturedCall.opts.env.PGPASSWORD, 'my secret!');
  assert.equal(capturedCall.opts.env.PGSSLMODE, 'require');
});

test('executePreflight: parses JSON counts and verifies all 21 public tables', () => {
  const payload = createSamplePayload();
  const mockSpawn = () => ({
    status: 0,
    stdout: Buffer.from(JSON.stringify(payload)),
  });

  const result = runPreflight(
    { projectRef: REQUIRED_PROJECT_REF },
    { QLAOK_DATABASE_URL: VALID_DIRECT_URL },
    { spawnSync: mockSpawn }
  );

  assert.equal(Object.keys(result.tables).length, 21);
  for (const table of PUBLIC_TABLES) {
    assert.equal(typeof result.tables[table], 'number');
    assert.equal(Number.isSafeInteger(result.tables[table]), true);
  }
  assert.equal(result.auth_users_count, 2);
  assert.equal(result.migrations.count, EXPECTED_MIGRATIONS.length);
  assert.deepEqual(result.migrations.filenames, EXPECTED_MIGRATIONS);

  // Missing table in JSON throws validation error
  const incompletePayload = createSamplePayload();
  delete incompletePayload.tables.shops;
  assert.throws(
    () =>
      executePreflight(
        { projectRef: REQUIRED_PROJECT_REF },
        { QLAOK_DATABASE_URL: VALID_DIRECT_URL },
        { spawnSync: () => ({ status: 0, stdout: Buffer.from(JSON.stringify(incompletePayload)) }) }
      ),
    /missing count for table: shops/
  );

  // Missing auth_users count throws validation error
  const noAuthPayload = createSamplePayload();
  delete noAuthPayload.auth_users_count;
  assert.throws(
    () =>
      executePreflight(
        { projectRef: REQUIRED_PROJECT_REF },
        { QLAOK_DATABASE_URL: VALID_DIRECT_URL },
        { spawnSync: () => ({ status: 0, stdout: Buffer.from(JSON.stringify(noAuthPayload)) }) }
      ),
    /missing auth\.users count/
  );

  // Missing migrations throws validation error
  const noMigrationsPayload = createSamplePayload();
  delete noMigrationsPayload.migrations;
  assert.throws(
    () =>
      executePreflight(
        { projectRef: REQUIRED_PROJECT_REF },
        { QLAOK_DATABASE_URL: VALID_DIRECT_URL },
        { spawnSync: () => ({ status: 0, stdout: Buffer.from(JSON.stringify(noMigrationsPayload)) }) }
      ),
    /missing migrations count or filenames/
  );
});

test('executePreflight: rejects migrations when count does not match filenames length (current bug fix)', () => {
  const payload = createSamplePayload();
  payload.migrations.filenames = ['001_init_qlaok.sql', '019_revoke_staff_trigger_execute.sql'];
  // payload.migrations.count is EXPECTED_MIGRATIONS.length, but filenames only has 2 entries
  assert.throws(
    () =>
      executePreflight(
        { projectRef: REQUIRED_PROJECT_REF },
        { QLAOK_DATABASE_URL: VALID_DIRECT_URL },
        { spawnSync: () => ({ status: 0, stdout: Buffer.from(JSON.stringify(payload)) }) }
      ),
    new RegExp(
      `Migrations count \\(${EXPECTED_MIGRATIONS.length}\\) does not match filenames list length \\(2\\)`
    )
  );
});

test('executePreflight: rejects migrations payload with missing expected migration filename', () => {
  const payload = createSamplePayload();
  payload.migrations.filenames = EXPECTED_MIGRATIONS.filter(
    (f) => f !== '002z_reconcile_legacy_bank_refs.sql'
  );
  payload.migrations.count = payload.migrations.filenames.length;
  payload.tables.schema_migrations = payload.migrations.count;

  assert.throws(
    () =>
      executePreflight(
        { projectRef: REQUIRED_PROJECT_REF },
        { QLAOK_DATABASE_URL: VALID_DIRECT_URL },
        { spawnSync: () => ({ status: 0, stdout: Buffer.from(JSON.stringify(payload)) }) }
      ),
    new RegExp(
      `Migrations count \\(${EXPECTED_MIGRATIONS.length - 1}\\) does not match expected local migration count \\(${EXPECTED_MIGRATIONS.length}\\)`
    )
  );

  // Also test when count is EXPECTED_MIGRATIONS.length but 002z is replaced by another duplicate file
  const replacedPayload = createSamplePayload();
  replacedPayload.migrations.filenames = EXPECTED_MIGRATIONS.map((f) =>
    f === '002z_reconcile_legacy_bank_refs.sql' ? '001_init_qlaok.sql' : f
  );
  assert.throws(
    () =>
      executePreflight(
        { projectRef: REQUIRED_PROJECT_REF },
        { QLAOK_DATABASE_URL: VALID_DIRECT_URL },
        { spawnSync: () => ({ status: 0, stdout: Buffer.from(JSON.stringify(replacedPayload)) }) }
      ),
    /Duplicate migration filename found: 001_init_qlaok\.sql/
  );
});

test('executePreflight: rejects migrations payload with extra or unknown migration filename', () => {
  const payload = createSamplePayload();
  payload.migrations.filenames = [...EXPECTED_MIGRATIONS, '999_extra_migration.sql'];
  payload.migrations.count = payload.migrations.filenames.length;
  payload.tables.schema_migrations = payload.migrations.count;

  assert.throws(
    () =>
      executePreflight(
        { projectRef: REQUIRED_PROJECT_REF },
        { QLAOK_DATABASE_URL: VALID_DIRECT_URL },
        { spawnSync: () => ({ status: 0, stdout: Buffer.from(JSON.stringify(payload)) }) }
      ),
    new RegExp(
      `Migrations count \\(${EXPECTED_MIGRATIONS.length + 1}\\) does not match expected local migration count \\(${EXPECTED_MIGRATIONS.length}\\)`
    )
  );

  // Also test when count remains EXPECTED_MIGRATIONS.length but an entry is replaced by an unknown file
  const swappedPayload = createSamplePayload();
  swappedPayload.migrations.filenames = [
    ...EXPECTED_MIGRATIONS.slice(0, -1),
    '999_unknown_migration.sql',
  ];
  assert.throws(
    () =>
      executePreflight(
        { projectRef: REQUIRED_PROJECT_REF },
        { QLAOK_DATABASE_URL: VALID_DIRECT_URL },
        { spawnSync: () => ({ status: 0, stdout: Buffer.from(JSON.stringify(swappedPayload)) }) }
      ),
    /Unknown migration filename found: 999_unknown_migration\.sql/
  );
});

test('executePreflight: rejects migrations payload with duplicate migration filename', () => {
  const payload = createSamplePayload();
  payload.migrations.filenames = [
    EXPECTED_MIGRATIONS[0],
    EXPECTED_MIGRATIONS[0],
    ...EXPECTED_MIGRATIONS.slice(2),
  ];

  assert.throws(
    () =>
      executePreflight(
        { projectRef: REQUIRED_PROJECT_REF },
        { QLAOK_DATABASE_URL: VALID_DIRECT_URL },
        { spawnSync: () => ({ status: 0, stdout: Buffer.from(JSON.stringify(payload)) }) }
      ),
    /Duplicate migration filename found: 001_init_qlaok\.sql/
  );
});

test('executePreflight: rejects negative or non-safe-integer count values', () => {
  const invalidCases = [
    {
      name: 'negative table count',
      mutate: (p) => {
        p.tables.shops = -1;
      },
      expected: /invalid count for table: shops/,
    },
    {
      name: 'floating-point table count',
      mutate: (p) => {
        p.tables.provinces = 12.5;
      },
      expected: /invalid count for table: provinces/,
    },
    {
      name: 'negative auth_users_count',
      mutate: (p) => {
        p.auth_users_count = -5;
      },
      expected: /invalid auth\.users count/,
    },
    {
      name: 'floating auth_users_count',
      mutate: (p) => {
        p.auth_users_count = 2.7;
      },
      expected: /invalid auth\.users count/,
    },
    {
      name: 'negative migrations count',
      mutate: (p) => {
        p.migrations.count = -1;
      },
      expected: /invalid migrations count/,
    },
    {
      name: 'non-safe integer table count',
      mutate: (p) => {
        p.tables.orders = Number.MAX_SAFE_INTEGER + 100;
      },
      expected: /invalid count for table: orders/,
    },
  ];

  for (const { name, mutate, expected } of invalidCases) {
    const payload = createSamplePayload();
    mutate(payload);
    assert.throws(
      () =>
        executePreflight(
          { projectRef: REQUIRED_PROJECT_REF },
          { QLAOK_DATABASE_URL: VALID_DIRECT_URL },
          { spawnSync: () => ({ status: 0, stdout: Buffer.from(JSON.stringify(payload)) }) }
        ),
      expected,
      `Expected case '${name}' to throw matching ${expected}`
    );
  }
});

test('executePreflight: returns a new normalized object and drops arbitrary or injected PII fields', () => {
  const payload = createSamplePayload();
  payload.injected_pii = {
    user_email: 'customer@example.com',
    user_phone: '+84987654321',
    auth_secret_token: 'leak_secret',
  };
  payload.arbitrary_debug = 'drop_this';
  payload.auth_users = { count: 2, leaked_hash: 'argon2$...' };
  payload.tables.injected_pii_table = 100;
  payload.migrations.extra_debug_info = 'leak';

  const result = executePreflight(
    { projectRef: REQUIRED_PROJECT_REF },
    { QLAOK_DATABASE_URL: VALID_DIRECT_URL },
    { spawnSync: () => ({ status: 0, stdout: Buffer.from(JSON.stringify(payload)) }) }
  );

  // Assert arbitrary / PII fields are completely dropped
  assert.equal(result.injected_pii, undefined);
  assert.equal('injected_pii' in result, false);
  assert.equal(result.arbitrary_debug, undefined);
  assert.equal('arbitrary_debug' in result, false);
  assert.equal(result.auth_users, undefined);
  assert.equal('auth_users' in result, false);
  assert.equal(result.tables.injected_pii_table, undefined);
  assert.equal('injected_pii_table' in result.tables, false);
  assert.equal(result.migrations.extra_debug_info, undefined);
  assert.equal('extra_debug_info' in result.migrations, false);

  // Assert exact keys on the normalized root object
  assert.deepEqual(Object.keys(result).sort(), ['auth_users_count', 'migrations', 'tables']);
  // Assert exact approved tables
  assert.deepEqual(Object.keys(result.tables).sort(), [...PUBLIC_TABLES].sort());
  // Assert exact approved migration keys
  assert.deepEqual(Object.keys(result.migrations).sort(), ['count', 'filenames']);

  // Assert count values preserved accurately
  assert.equal(result.auth_users_count, 2);
  assert.equal(result.migrations.count, EXPECTED_MIGRATIONS.length);
  assert.deepEqual(result.migrations.filenames, EXPECTED_MIGRATIONS);
});

test('isNonNegativeSafeInteger: correctly identifies non-negative safe integers', () => {
  assert.equal(isNonNegativeSafeInteger(0), true);
  assert.equal(isNonNegativeSafeInteger(20), true);
  assert.equal(isNonNegativeSafeInteger(-1), false);
  assert.equal(isNonNegativeSafeInteger(1.5), false);
  assert.equal(isNonNegativeSafeInteger('20'), false);
  assert.equal(isNonNegativeSafeInteger(NaN), false);
  assert.equal(isNonNegativeSafeInteger(Infinity), false);
  assert.equal(isNonNegativeSafeInteger(Number.MAX_SAFE_INTEGER + 10), false);
});

test('getExpectedMigrationFilenames: sources exact 27 local migrations including 002z CWD-independently', () => {
  assert.ok(MIGRATIONS_DIR.endsWith('supabase/migrations'));
  const filenames = getExpectedMigrationFilenames();
  assert.equal(filenames.length, 27);
  assert.equal(filenames.includes('002z_reconcile_legacy_bank_refs.sql'), true);
  assert.equal(filenames.includes('001_init_qlaok.sql'), true);
  assert.equal(filenames.includes('019_revoke_staff_trigger_execute.sql'), true);
  assert.equal(filenames.includes('020_remove_legacy_base64_images.sql'), true);
  assert.equal(filenames.includes('021_zitadel_identity_mapping.sql'), true);
  assert.equal(filenames.includes('022_postgres_realtime_notifications.sql'), true);
  assert.equal(
    filenames.includes('023_restore_record_staff_login_failure_atomic.sql'),
    true
  );
  assert.equal(
    filenames.includes('20261028000100_analytics_atomic_view_count.sql'),
    true
  );
  assert.equal(
    filenames.includes('20261028000200_floor_plan_active_orders_index.sql'),
    true
  );
  assert.equal(
    filenames.includes('20261028000300_orders_order_code_unique.sql'),
    true
  );
  for (const fn of filenames) {
    assert.match(fn, /^[0-9]+[a-z]?_.*\.sql$/);
  }
});

test('PREFLIGHT_SQL: does not contain duplicate auth_users object and selects auth_users_count', () => {
  assert.equal(PREFLIGHT_SQL.includes("'auth_users',"), false);
  assert.equal(PREFLIGHT_SQL.includes("'auth_users_count',"), true);
});

test('executePreflight: fails closed on subprocess error or invalid JSON without leaking raw stderr', () => {
  const sensitiveErrorText = 'psql: error: password=supersecretpass auth failed';
  const mockFailingSpawn = () => ({
    status: 2,
    error: null,
    stderr: Buffer.from(sensitiveErrorText),
  });

  try {
    executePreflight(
      { projectRef: REQUIRED_PROJECT_REF },
      { QLAOK_DATABASE_URL: VALID_DIRECT_URL },
      { spawnSync: mockFailingSpawn }
    );
    assert.fail('Expected executePreflight to throw');
  } catch (err) {
    assert.match(err.message, /psql failed with exit code 2/);
    assert.equal(err.message.includes('supersecretpass'), false);
    assert.equal(err.message.includes(sensitiveErrorText), false);
  }

  // Empty output
  assert.throws(
    () =>
      executePreflight(
        { projectRef: REQUIRED_PROJECT_REF },
        { QLAOK_DATABASE_URL: VALID_DIRECT_URL },
        { spawnSync: () => ({ status: 0, stdout: Buffer.from('') }) }
      ),
    /psql returned empty output/
  );

  // Malformed non-JSON output
  assert.throws(
    () =>
      executePreflight(
        { projectRef: REQUIRED_PROJECT_REF },
        { QLAOK_DATABASE_URL: VALID_DIRECT_URL },
        { spawnSync: () => ({ status: 0, stdout: Buffer.from('FATAL: server error\n') }) }
      ),
    /psql returned invalid JSON output/
  );
});

test('runPreflightCli: prints JSON result and handles help flag', () => {
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  try {
    // Test --help
    const helpRes = runPreflightCli(['--help']);
    assert.equal(helpRes, undefined);
    assert.match(logs[0], /Usage: QLAOK_DATABASE_URL=\.\.\./);

    // Test success
    const payload = createSamplePayload();
    const result = runPreflightCli(
      ['--project-ref', REQUIRED_PROJECT_REF],
      { QLAOK_DATABASE_URL: VALID_DIRECT_URL },
      { spawnSync: () => ({ status: 0, stdout: Buffer.from(JSON.stringify(payload)) }) }
    );
    assert.equal(result.auth_users_count, 2);
    const printedJson = JSON.parse(logs[1]);
    assert.equal(printedJson.tables.provinces, 34);
  } finally {
    console.log = origLog;
  }
});
