/**
 * Qlaok Demo Database Reset — Seed SQL Generator
 *
 * Emits deterministic INSERT statements for demo seed rows using PostgreSQL
 * json_populate_record with collision-free dollar-quoted string literals.
 */

import { buildDemoSeedRows } from './demo-reset-owner-seed.mjs';

export const DEMO_SEED_TABLES = Object.freeze([
  'profiles',
  'shops',
  'shop_memberships',
  'shop_tables',
  'categories',
  'items',
  'posts',
  'payment_transactions',
  'analytics_events',
]);

const IDENTIFIER_REGEX = /^[a-z_][a-z0-9_]*$/;

/**
 * Generates a dollar-quote tag that does not collide with any substring in the JSON payload.
 * e.g. $seed$, $seed_1$, $seed_2$, etc.
 */
function createSafeDollarQuote(content) {
  let tag = '$seed$';
  let counter = 1;
  while (content.includes(tag)) {
    tag = `$seed_${counter}$`;
    counter += 1;
  }
  return tag;
}

/**
 * Builds deterministic INSERT statements from seed rows.
 *
 * @param {Record<string, Array<Record<string, unknown>>>} [explicitRows]
 * @returns {Promise<string>} SQL script containing all INSERT statements
 */
export async function buildDemoSeedSql(explicitRows) {
  const rowsByTable = explicitRows !== undefined ? explicitRows : await buildDemoSeedRows();

  if (!rowsByTable || typeof rowsByTable !== 'object' || Array.isArray(rowsByTable)) {
    throw new TypeError('Seed rows must be a non-empty, non-array object.');
  }

  const statements = [];

  for (const table of DEMO_SEED_TABLES) {
    if (!IDENTIFIER_REGEX.test(table)) {
      throw new Error(`Invalid table name: "${table}"`);
    }

    const rows = rowsByTable[table];
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error(`Missing or empty rows for mandatory seed table "${table}".`);
    }

    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new TypeError(`Row in table "${table}" must be a non-empty, non-array object.`);
      }

      const keys = Object.keys(row);
      if (keys.length === 0) {
        throw new Error(`Row in table "${table}" has no properties.`);
      }

      for (const key of keys) {
        if (!IDENTIFIER_REGEX.test(key)) {
          throw new Error(`Invalid column identifier "${key}" in table "${table}".`);
        }
      }

      const columnsList = keys.join(', ');
      const jsonPayload = JSON.stringify(row);
      const tag = createSafeDollarQuote(jsonPayload);

      statements.push(
        `INSERT INTO public.${table} (${columnsList}) SELECT ${columnsList} FROM json_populate_record(NULL::public.${table}, ${tag}${jsonPayload}${tag}::json);`
      );
    }
  }

  return statements.join('\n');
}
