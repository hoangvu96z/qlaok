import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { buildDemoSeedSql } from '../scripts/demo-reset-seed-sql.mjs';
import { buildDemoSeedRows } from '../scripts/demo-reset-owner-seed.mjs';
import { buildDemoPublicResetTransactionSql } from '../scripts/demo-reset-transaction.mjs';

test('full migration schema accepts demo seed, purge, and reseed in one transaction', async () => {
  const db = new PGlite({ extensions: { uuid_ossp } });
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users (id TEXT PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
    await db.exec('CREATE PUBLICATION supabase_realtime');

    const files = fs.readdirSync('supabase/migrations').filter((file) => file.endsWith('.sql')).sort();
    for (const file of files) {
      await db.exec(fs.readFileSync(path.join('supabase/migrations', file), 'utf8'));
    }
    await db.query('INSERT INTO auth.users(id) VALUES ($1)', ['demo-auth-user']);
    await db.query('INSERT INTO public.schema_migrations(filename, checksum) VALUES ($1, $2)', [files[0], 'fixture']);

    const seedRows = await buildDemoSeedRows();
    const expectedCounts = Object.fromEntries(Object.entries(seedRows).map(([table, rows]) => [table, rows.length]));
    const seedSql = await buildDemoSeedSql();
    await db.exec(`BEGIN;\n${seedSql}\nCOMMIT;`);

    await db.exec(`INSERT INTO public.profiles(id) VALUES ('dirty-owner');
      INSERT INTO public.shops(id, owner_id, slug, name) VALUES ('dirty-shop', 'dirty-owner', 'dirty-shop', 'Dirty Shop');`);
    const provincesBefore = Number((await db.query('SELECT COUNT(*)::int AS n FROM public.provinces')).rows[0].n);

    await db.exec(await buildDemoPublicResetTransactionSql());

    for (const [table, expected] of Object.entries(expectedCounts)) {
      const actual = Number((await db.query(`SELECT COUNT(*)::int AS n FROM public.${table}`)).rows[0].n);
      assert.equal(actual, expected, `${table} should have canonical demo count`);
    }
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM public.profiles WHERE id = 'dirty-owner'")).rows[0].n, 0);
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM public.shops WHERE id = 'dirty-shop'")).rows[0].n, 0);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM auth.users')).rows[0].n, 1);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM public.schema_migrations')).rows[0].n, 1);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM public.provinces')).rows[0].n, provincesBefore);

    await db.exec("INSERT INTO public.profiles(id) VALUES ('rollback-owner')");
    const validSql = await buildDemoPublicResetTransactionSql();
    const profileCheck = 'SELECT COUNT(*) INTO actual_count FROM public.profiles;\n  IF actual_count <> 1 THEN';
    assert.ok(validSql.includes(profileCheck));
    const invalidVerificationSql = validSql.replace(
      profileCheck,
      'SELECT COUNT(*) INTO actual_count FROM public.profiles;\n  IF actual_count <> 999 THEN'
    );
    await assert.rejects(db.exec(invalidVerificationSql), /Demo reset verification failed for public\.profiles/);
    await db.exec('ROLLBACK;');
    assert.equal(
      (await db.query("SELECT COUNT(*)::int AS n FROM public.profiles WHERE id = 'rollback-owner'")).rows[0].n,
      1,
      'failed verification must roll back the purge and preserve pre-reset data'
    );
  } finally {
    await db.close();
  }
});

test('seed builder fails closed when a canonical table is missing', async () => {
  await assert.rejects(buildDemoSeedSql({}), /profiles.*missing|missing.*profiles/i);
});
