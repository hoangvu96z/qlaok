import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMigrationPsqlArgs,
  checksumSql,
  migrateSelfHosted,
  planMigrations,
} from '../scripts/migrate-self-hosted.mjs';

test('self-hosted migration psql args wrap ordinary SQL in one transaction', () => {
  assert.deepEqual(
    buildMigrationPsqlArgs({
      fullPath: '/migrations/003_orders.sql',
      sql: 'ALTER TABLE public.orders ADD COLUMN note TEXT;',
    }),
    ['--single-transaction', '-f', '/migrations/003_orders.sql']
  );
});

test('self-hosted migration psql args do not double-wrap explicit transaction files', () => {
  assert.deepEqual(
    buildMigrationPsqlArgs({
      fullPath: '/migrations/002z_reconcile.sql',
      sql: '-- historical migration\nBEGIN;\nUPDATE public.payment_transactions SET bank_ref_id = NULL;\nCOMMIT;\n',
    }),
    ['-f', '/migrations/002z_reconcile.sql']
  );
});

test('self-hosted migration psql args wrap DO blocks that are not top-level transactions', () => {
  assert.deepEqual(
    buildMigrationPsqlArgs({
      fullPath: '/migrations/004_guard.sql',
      sql: `DO $$
BEGIN
  PERFORM 1;
END;
$$;`,
    }),
    ['--single-transaction', '-f', '/migrations/004_guard.sql']
  );
});

test('self-hosted migration planning applies missing migrations in filename order', () => {
  const first = { filename: '002_second.sql', checksum: 'b'.repeat(64) };
  const second = { filename: '001_first.sql', checksum: 'a'.repeat(64) };
  const hotfix = { filename: '002z_hotfix.sql', checksum: 'c'.repeat(64) };
  const plan = planMigrations([first, second, hotfix], new Map());

  assert.deepEqual(plan.apply.map((migration) => migration.filename), [
    '001_first.sql',
    '002_second.sql',
    '002z_hotfix.sql',
  ]);
  assert.deepEqual(plan.skip, []);
});

test('self-hosted migration planning skips matching history and rejects changed files', () => {
  const migration = { filename: '001_first.sql', checksum: 'a'.repeat(64) };

  assert.deepEqual(planMigrations([migration], new Map([['001_first.sql', migration.checksum]])), {
    apply: [],
    skip: ['001_first.sql'],
  });
  assert.throws(
    () => planMigrations([migration], new Map([['001_first.sql', 'b'.repeat(64)]])),
    /checksum changed after application/
  );
});

test('self-hosted migration runner records only a migration after its SQL succeeds', () => {
  const applied = [];
  const saved = [];
  const migration = { filename: '001_first.sql', checksum: 'a'.repeat(64) };

  migrateSelfHosted({
    migrations: [migration],
    history: new Map(),
    applyMigration: (entry) => applied.push(entry.filename),
    saveMigration: (entry) => saved.push(entry.filename),
    log: () => {},
  });

  assert.deepEqual(applied, ['001_first.sql']);
  assert.deepEqual(saved, ['001_first.sql']);

  assert.throws(
    () =>
      migrateSelfHosted({
        migrations: [migration],
        history: new Map(),
        applyMigration: () => {
          throw new Error('SQL failed');
        },
        saveMigration: (entry) => saved.push(entry.filename),
        log: () => {},
      }),
    /SQL failed/
  );
  assert.deepEqual(saved, ['001_first.sql']);
});

test('self-hosted migration checksums SQL text with SHA-256', () => {
  assert.equal(
    checksumSql('SELECT 1;'),
    '17db4fd369edb9244b9f91d9aeed145c3d04ad8ba6e95d06247f07a63527d11a'
  );
});
