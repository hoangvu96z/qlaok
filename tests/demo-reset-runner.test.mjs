import assert from 'node:assert/strict';
import { test } from 'node:test';
import { executeDemoPublicReset } from '../scripts/demo-reset-public-runner.mjs';
import { executePreparedDemoSql } from '../scripts/demo-reset-psql.mjs';
import { DEMO_PURGE_TABLES } from '../scripts/demo-reset-purge.mjs';
import { DEMO_SEED_TABLES } from '../scripts/demo-reset-seed-sql.mjs';
import { REQUIRED_PROJECT_REF } from '../scripts/backup-qlaok-db.mjs';

const env = {
  QLAOK_DATABASE_URL: `postgresql://postgres:fixture-password@db.${REQUIRED_PROJECT_REF}.supabase.co:5432/postgres`,
};
const options = { projectRef: REQUIRED_PROJECT_REF, execute: true, maintenanceConfirmed: true };
const seedRows = Object.fromEntries(DEMO_SEED_TABLES.map((table) => [table, [{}]]));
const counts = Object.fromEntries(DEMO_PURGE_TABLES.map((table) => [table, table in seedRows ? 1 : 0]));

function result() {
  return {
    tables: { ...counts, provinces: 34, schema_migrations: 20 },
    migrations: { count: 20, filenames: ['001.sql', '019.sql'] },
    auth_users_count: 2,
  };
}

test('runner requires exact target, execution, maintenance and URL before any DB call', async () => {
  let calls = 0;
  const deps = { executePreflight: () => { calls++; return result(); } };
  for (const invalid of [
    { ...options, projectRef: 'wrong' },
    { ...options, execute: false },
    { ...options, maintenanceConfirmed: false },
  ]) {
    await assert.rejects(executeDemoPublicReset(invalid, env, deps));
  }
  await assert.rejects(executeDemoPublicReset(options, {}, deps), /QLAOK_DATABASE_URL/);
  assert.equal(calls, 0);
});

test('runner performs preflight, verified backup, SQL execution and postflight in order', async () => {
  const steps = [];
  const deps = {
    executePreflight: () => { steps.push('preflight'); return result(); },
    executeBackup: () => { steps.push('backup'); return { success: true, path: '/private/backup.dump', size: 1024 }; },
    buildSql: async () => { steps.push('sql'); return 'BEGIN;\nSELECT 1;\nCOMMIT;'; },
    executePreparedSql: (sql, passedEnv) => {
      steps.push('execute');
      assert.equal(sql, 'BEGIN;\nSELECT 1;\nCOMMIT;');
      assert.equal(passedEnv.QLAOK_DATABASE_URL, env.QLAOK_DATABASE_URL);
      return { success: true };
    },
    buildRows: async () => { steps.push('rows'); return seedRows; },
  };
  const value = await executeDemoPublicReset(options, env, deps);
  assert.deepEqual(steps, ['preflight', 'backup', 'rows', 'sql', 'execute', 'preflight']);
  assert.equal(value.backupPath, '/private/backup.dump');
  assert.equal(value.backupSize, 1024);
  assert.deepEqual(value.tableCounts, result().tables);
});

test('runner never executes SQL when preflight or backup fails', async () => {
  let executed = 0;
  await assert.rejects(executeDemoPublicReset(options, env, {
    executePreflight: () => { throw new Error('preflight failed'); },
    executePreparedSql: () => { executed++; return { success: true }; },
  }), /preflight failed/);
  await assert.rejects(executeDemoPublicReset(options, env, {
    executePreflight: result,
    executeBackup: () => ({ success: false }),
    executePreparedSql: () => { executed++; return { success: true }; },
  }), /Backup failed/);
  await assert.rejects(executeDemoPublicReset(options, env, {
    executePreflight: result,
    executeBackup: () => ({ success: true, path: '/private/backup.dump', size: 1024 }),
    buildRows: () => ({}),
    executePreparedSql: () => { executed++; return { success: true }; },
  }), /Missing or empty seed table/);
  assert.equal(executed, 0);
});

test('runner identifies post-commit verification failure without leaking credentials', async () => {
  let reads = 0;
  const deps = {
    executePreflight: () => {
      reads++;
      const value = result();
      if (reads === 2) value.tables.shops = 99;
      return value;
    },
    executeBackup: () => ({ success: true, path: '/private/backup.dump', size: 1024 }),
    buildSql: () => 'BEGIN; COMMIT;',
    executePreparedSql: () => ({ success: true }),
    buildRows: () => seedRows,
  };
  await assert.rejects(executeDemoPublicReset(options, env, deps), (error) => {
    assert.match(error.message, /after commit; recovery required/);
    assert.equal(error.message.includes('fixture-password'), false);
    return true;
  });
});

test('psql helper passes SQL through stdin and suppresses raw failure output', () => {
  let spawned = 0;
  const sql = 'BEGIN;\nSELECT 1;\nCOMMIT;';
  const result = executePreparedDemoSql(sql, env, {
    spawnSync(command, args, config) {
      spawned++;
      assert.equal(command, 'psql');
      assert.deepEqual(args, ['-X', '-v', 'ON_ERROR_STOP=1', '-f', '-']);
      assert.equal(config.input, sql);
      assert.equal(config.shell, false);
      assert.equal(config.env.PGDATABASE, 'postgres');
      assert.equal(config.env.PGPASSWORD, 'fixture-password');
      assert.equal(args.join(' ').includes('fixture-password'), false);
      return { status: 0 };
    },
  });
  assert.deepEqual(result, { success: true });
  assert.equal(spawned, 1);

  assert.throws(() => executePreparedDemoSql(sql, env, {
    spawnSync: () => ({ status: 2, stderr: Buffer.from('password=fixture-password') }),
  }), (error) => {
    assert.equal(error.message.includes('fixture-password'), false);
    assert.match(error.message, /psql execution failed/);
    return true;
  });
});
