import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checksumSql,
  migrateSelfHosted,
  planMigrations,
} from '../scripts/migrate-self-hosted.mjs';

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
