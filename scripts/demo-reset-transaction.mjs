/**
 * Qlaok Demo Database Reset — Transaction SQL Generator
 *
 * Scope: Combines deterministic app-table purge and seed SQL into a single
 * transactional script wrapped with `BEGIN;`, child-first DELETEs, seed INSERTs,
 * an atomic PostgreSQL PL/pgSQL verification block asserting exact COUNT(*)
 * for all 19 DEMO_PURGE_TABLES, and `COMMIT;`.
 *
 * Invariants:
 * - Pure SQL string generation: no database connection or execution side effects.
 * - Reuses canonical builders: `buildDemoSeedRows()`, `buildDemoPurgeSql()`, `buildDemoSeedSql(rows)`.
 * - Asserts exact counts for all 19 `DEMO_PURGE_TABLES` (9 seeded tables with positive counts,
 *   10 unseeded application tables with exactly 0).
 * - Identifier checks ensure only fixed valid table names from `DEMO_PURGE_TABLES` are queried.
 * - Any verification count mismatch raises a PostgreSQL EXCEPTION, immediately rolling back the transaction.
 * - Zero DDL, RLS, trigger changes, auth/system schemas, or dynamic user input.
 */

import { DEMO_PURGE_TABLES, buildDemoPurgeSql } from './demo-reset-purge.mjs';
import { DEMO_SEED_TABLES, buildDemoSeedSql } from './demo-reset-seed-sql.mjs';
import { buildDemoSeedRows } from './demo-reset-owner-seed.mjs';

const IDENTIFIER_REGEX = /^[a-z_][a-z0-9_]*$/;

/**
 * Builds deterministic PL/pgSQL DO block asserting table counts for all 19 DEMO_PURGE_TABLES.
 *
 * @param {Record<string, Array<Record<string, unknown>>>} rowsByTable
 * @returns {string} PostgreSQL DO block string
 */
function buildVerificationBlock(rowsByTable) {
  const seedTableSet = new Set(DEMO_SEED_TABLES);
  const statements = [];

  for (const table of DEMO_PURGE_TABLES) {
    if (!IDENTIFIER_REGEX.test(table)) {
      throw new Error(`Invalid table identifier: "${table}"`);
    }

    let expectedCount = 0;
    if (seedTableSet.has(table)) {
      const rows = rowsByTable[table];
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error(`Missing or empty rows for expected seed table "${table}".`);
      }
      expectedCount = rows.length;
    }

    if (!Number.isSafeInteger(expectedCount) || expectedCount < 0) {
      throw new TypeError(`Expected count for "${table}" must be a non-negative safe integer.`);
    }

    statements.push(
      `  SELECT COUNT(*) INTO actual_count FROM public.${table};`,
      `  IF actual_count <> ${expectedCount} THEN`,
      `    RAISE EXCEPTION 'Demo reset verification failed for public.%: expected %, got %', '${table}', ${expectedCount}, actual_count;`,
      `  END IF;`
    );
  }

  return [
    'DO $qlaok_verify$',
    'DECLARE',
    '  actual_count bigint;',
    'BEGIN',
    ...statements,
    'END $qlaok_verify$;',
  ].join('\n');
}

/**
 * Builds the complete public demo reset transaction SQL script.
 *
 * @returns {Promise<string>} SQL script wrapped in BEGIN/COMMIT with DO verification block
 */
export async function buildDemoPublicResetTransactionSql() {
  const rows = await buildDemoSeedRows();
  const purgeSql = buildDemoPurgeSql();
  const seedSql = await buildDemoSeedSql(rows);
  const verifySql = buildVerificationBlock(rows);

  return [
    'BEGIN;',
    purgeSql,
    seedSql,
    verifySql,
    'COMMIT;',
  ].join('\n');
}
