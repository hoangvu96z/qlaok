import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  buildMigrationPsqlArgs,
  checksumSql,
  migrateSelfHosted,
  notifyPostgrestSchemaReload,
  planMigrations,
  startsWithPostgrestSchemaReloadNotification,
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
    reloadSchema: () => {},
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
        reloadSchema: () => {},
        log: () => {},
      }),
    /SQL failed/
  );
  assert.deepEqual(saved, ['001_first.sql']);
});

test('self-hosted migration runner reloads PostgREST schema once after all successful pending migrations', () => {
  const events = [];
  const psqlCalls = [];
  notifyPostgrestSchemaReload((args) => psqlCalls.push(args));
  assert.deepEqual(psqlCalls, [['-c', "NOTIFY pgrst, 'reload schema';"]]);

  const appliedAlready = {
    filename: '001_first.sql',
    sql: 'CREATE TABLE public.first_table (id TEXT PRIMARY KEY);',
    checksum: 'a'.repeat(64),
  };
  const pendingOne = {
    filename: '002_second.sql',
    sql: 'CREATE FUNCTION public.second_fn() RETURNS integer LANGUAGE sql AS $$ SELECT 1; $$;',
    checksum: 'b'.repeat(64),
  };
  const pendingTwo = {
    filename: '003_third.sql',
    sql: 'GRANT EXECUTE ON FUNCTION public.second_fn() TO service_role;',
    checksum: 'c'.repeat(64),
  };

  migrateSelfHosted({
    migrations: [pendingTwo, appliedAlready, pendingOne],
    history: new Map([[appliedAlready.filename, appliedAlready.checksum]]),
    applyMigration: (entry) => events.push(`apply:${entry.filename}`),
    saveMigration: (entry) => events.push(`save:${entry.filename}`),
    reloadSchema: () => events.push('reload'),
    log: () => {},
  });

  assert.deepEqual(events, [
    'apply:002_second.sql',
    'save:002_second.sql',
    'apply:003_third.sql',
    'save:003_third.sql',
    'reload',
  ]);
});

test('self-hosted migration runner does not reload schema when there are no pending migrations', () => {
  let reloads = 0;
  const migration = {
    filename: '001_first.sql',
    sql: 'SELECT 1;',
    checksum: 'a'.repeat(64),
  };

  migrateSelfHosted({
    migrations: [migration],
    history: new Map([[migration.filename, migration.checksum]]),
    applyMigration: () => {
      throw new Error('should not apply');
    },
    saveMigration: () => {
      throw new Error('should not save');
    },
    reloadSchema: () => {
      reloads += 1;
    },
    log: () => {},
  });

  migrateSelfHosted({
    migrations: [],
    history: new Map(),
    applyMigration: () => {},
    saveMigration: () => {},
    reloadSchema: () => {
      reloads += 1;
    },
    log: () => {},
  });

  assert.equal(reloads, 0);
});

test('self-hosted migration runner does not reload schema after an apply or save failure', () => {
  let reloads = 0;
  const first = {
    filename: '001_first.sql',
    sql: 'SELECT 1;',
    checksum: 'a'.repeat(64),
  };
  const second = {
    filename: '002_second.sql',
    sql: 'SELECT 2;',
    checksum: 'b'.repeat(64),
  };

  assert.throws(
    () =>
      migrateSelfHosted({
        migrations: [first, second],
        history: new Map(),
        applyMigration: (entry) => {
          if (entry.filename === '002_second.sql') {
            throw new Error('second migration SQL failed');
          }
        },
        saveMigration: () => {},
        reloadSchema: () => {
          reloads += 1;
        },
        log: () => {},
      }),
    /second migration SQL failed/
  );
  assert.equal(reloads, 0);

  assert.throws(
    () =>
      migrateSelfHosted({
        migrations: [first],
        history: new Map(),
        applyMigration: () => {},
        saveMigration: () => {
          throw new Error('schema_migrations write failed');
        },
        reloadSchema: () => {
          reloads += 1;
        },
        log: () => {},
      }),
    /schema_migrations write failed/
  );
  assert.equal(reloads, 0);
});

test('self-hosted migration runner avoids duplicate reload when the final migration already notifies', () => {
  const latestReloadMigrationUrl = new URL(
    '../supabase/migrations/20261030000200_reload_postgrest_schema_cache.sql',
    import.meta.url
  );
  const latestReloadSql = fs.readFileSync(latestReloadMigrationUrl, 'utf8');
  assert.equal(startsWithPostgrestSchemaReloadNotification(latestReloadSql), true);
  assert.equal(
    startsWithPostgrestSchemaReloadNotification(
      "-- NOTIFY pgrst, 'reload schema';\nSELECT 1;"
    ),
    false
  );
  assert.equal(
    startsWithPostgrestSchemaReloadNotification("NOTIFY pgrst, 'reload config';"),
    false
  );
  assert.equal(
    startsWithPostgrestSchemaReloadNotification(`DO $$ BEGIN
      NOTIFY pgrst, 'reload schema';
    END $$;`),
    false
  );
  assert.equal(
    startsWithPostgrestSchemaReloadNotification(
      "SELECT 'NOTIFY pgrst, ''reload schema'';';"
    ),
    false
  );

  let reloadsWhenFinalNotifies = 0;
  migrateSelfHosted({
    migrations: [
      {
        filename: '20261030000100_prev.sql',
        sql: 'SELECT 1;',
        checksum: 'a'.repeat(64),
      },
      {
        filename: '20261030000200_reload_postgrest_schema_cache.sql',
        sql: latestReloadSql,
        checksum: checksumSql(latestReloadSql),
      },
    ],
    history: new Map(),
    applyMigration: () => {},
    saveMigration: () => {},
    reloadSchema: () => {
      reloadsWhenFinalNotifies += 1;
    },
    log: () => {},
  });
  assert.equal(reloadsWhenFinalNotifies, 0);

  let reloadsWhenOnlyEarlierNotifies = 0;
  migrateSelfHosted({
    migrations: [
      {
        filename: '20261030000200_reload_postgrest_schema_cache.sql',
        sql: latestReloadSql,
        checksum: checksumSql(latestReloadSql),
      },
      {
        filename: '20261030000300_new_rpc.sql',
        sql: 'CREATE FUNCTION public.new_rpc() RETURNS void LANGUAGE sql AS $$ SELECT; $$;',
        checksum: 'c'.repeat(64),
      },
    ],
    history: new Map(),
    applyMigration: () => {},
    saveMigration: () => {},
    reloadSchema: () => {
      reloadsWhenOnlyEarlierNotifies += 1;
    },
    log: () => {},
  });
  assert.equal(reloadsWhenOnlyEarlierNotifies, 1);
});

test('self-hosted migration checksums SQL text with SHA-256', () => {
  assert.equal(
    checksumSql('SELECT 1;'),
    '17db4fd369edb9244b9f91d9aeed145c3d04ad8ba6e95d06247f07a63527d11a'
  );
});
