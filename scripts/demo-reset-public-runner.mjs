import {
  REQUIRED_PROJECT_REF,
  validateDatabaseUrl,
  executeBackup,
} from './backup-qlaok-db.mjs';
import { executePreflight } from './preflight-demo-reset.mjs';
import { executePreparedDemoSql } from './demo-reset-psql.mjs';
import { buildDemoPublicResetTransactionSql } from './demo-reset-transaction.mjs';
import { buildDemoSeedRows } from './demo-reset-owner-seed.mjs';
import { DEMO_PURGE_TABLES } from './demo-reset-purge.mjs';
import { DEMO_SEED_TABLES } from './demo-reset-seed-sql.mjs';

/**
 * Synchronously verifies preflight state and produces a verified backup
 * before any destructive public demo reset operations are allowed to proceed.
 *
 * @param {object} options
 * @param {string} options.projectRef
 * @param {boolean} options.execute
 * @param {boolean} options.maintenanceConfirmed
 * @param {string} [options.backupOutputDir]
 * @param {Record<string, string | undefined>} [env=process.env]
 * @param {{
 *   executePreflight?: typeof executePreflight,
 *   executeBackup?: typeof executeBackup
 * }} [deps={}]
 * @returns {{ before: any, backup: { success: true, path: string, size: number } }}
 */
export function prepareDemoPublicReset(options = {}, env = process.env, deps = {}) {
  if (!options || typeof options !== 'object') {
    throw new Error('Invalid options object provided to prepareDemoPublicReset.');
  }

  if (options.projectRef !== REQUIRED_PROJECT_REF) {
    throw new Error(`Project ref must match exact required project ref '${REQUIRED_PROJECT_REF}'.`);
  }

  if (options.execute !== true) {
    throw new Error("Execution aborted: options.execute must be explicitly set to true.");
  }

  if (options.maintenanceConfirmed !== true) {
    throw new Error("Execution aborted: options.maintenanceConfirmed must be explicitly set to true.");
  }

  // Validate database URL from environment before invoking any dependency calls
  validateDatabaseUrl(env?.QLAOK_DATABASE_URL, REQUIRED_PROJECT_REF);

  const preflightFn = deps.executePreflight || executePreflight;
  const backupFn = deps.executeBackup || executeBackup;

  const before = preflightFn({ projectRef: options.projectRef }, env);

  const backupOptions = {
    projectRef: options.projectRef,
    ...(options.backupOutputDir !== undefined ? { outputDir: options.backupOutputDir } : {}),
  };

  const backupResult = backupFn(backupOptions, env);

  if (
    !backupResult ||
    typeof backupResult !== 'object' ||
    backupResult.success !== true ||
    typeof backupResult.path !== 'string' ||
    !backupResult.path.trim() ||
    typeof backupResult.size !== 'number' ||
    !Number.isFinite(backupResult.size) ||
    backupResult.size <= 0
  ) {
    throw new Error('Backup failed or produced an invalid backup result.');
  }

  return {
    before,
    backup: backupResult,
  };
}

/**
 * Asynchronously executes the public demo database reset within a single transaction,
 * verifying database state before and after execution.
 *
 * @param {object} options
 * @param {string} options.projectRef
 * @param {boolean} options.execute
 * @param {boolean} options.maintenanceConfirmed
 * @param {string} [options.backupOutputDir]
 * @param {Record<string, string | undefined>} [env=process.env]
 * @param {{
 *   executePreflight?: typeof executePreflight,
 *   executeBackup?: typeof executeBackup,
 *   buildSql?: () => Promise<string> | string,
 *   executePreparedSql?: typeof executePreparedDemoSql,
 *   buildRows?: () => Promise<Record<string, Array<Record<string, unknown>>>> | Record<string, Array<Record<string, unknown>>>
 * }} [deps={}]
 * @returns {Promise<{ backupPath: string, backupSize: number, tableCounts: Record<string, number> }>}
 */
export async function executeDemoPublicReset(options = {}, env = process.env, deps = {}) {
  const { before, backup } = prepareDemoPublicReset(options, env, deps);

  const buildRowsFn = deps.buildRows || buildDemoSeedRows;
  const rowsByTable = await buildRowsFn();
  const seedTableSet = new Set(DEMO_SEED_TABLES);
  if (!rowsByTable || typeof rowsByTable !== 'object') {
    throw new Error('Seed rows unavailable before execution.');
  }
  for (const table of DEMO_SEED_TABLES) {
    if (!Array.isArray(rowsByTable[table]) || rowsByTable[table].length === 0) {
      throw new Error(`Missing or empty seed table "${table}" before execution.`);
    }
  }

  const buildSqlFn = deps.buildSql || buildDemoPublicResetTransactionSql;
  const sql = await buildSqlFn();

  const executePreparedSqlFn = deps.executePreparedSql || executePreparedDemoSql;
  const execResult = await executePreparedSqlFn(sql, env, deps);
  if (!execResult || execResult.success !== true) {
    throw new Error('Prepared SQL execution failed.');
  }

  const preflightFn = deps.executePreflight || executePreflight;
  let after;
  try {
    after = await preflightFn({ projectRef: options.projectRef }, env, deps);
  } catch {
    throw new Error('Postflight verification failed after commit; recovery required: preflight execution failed.');
  }

  if (!after || typeof after !== 'object' || !after.tables || typeof after.tables !== 'object') {
    throw new Error('Postflight verification failed after commit; recovery required: invalid postflight result.');
  }

  for (const table of DEMO_PURGE_TABLES) {
    const expected = seedTableSet.has(table) ? rowsByTable[table].length : 0;
    const actual = after.tables[table];
    if (actual !== expected) {
      throw new Error(
        `Postflight verification failed after commit; recovery required: table "${table}" count mismatch (expected ${expected}, got ${actual}).`
      );
    }
  }

  if (before?.tables?.provinces !== after.tables.provinces) {
    throw new Error(
      `Postflight verification failed after commit; recovery required: provinces count mismatch (before ${before?.tables?.provinces}, after ${after.tables.provinces}).`
    );
  }

  if (
    before?.tables?.schema_migrations !== after.tables.schema_migrations ||
    before?.migrations?.count !== after?.migrations?.count
  ) {
    throw new Error('Postflight verification failed after commit; recovery required: schema_migrations count mismatch.');
  }

  const beforeFiles = before?.migrations?.filenames;
  const afterFiles = after?.migrations?.filenames;
  const filenamesMatch =
    Array.isArray(beforeFiles) &&
    Array.isArray(afterFiles) &&
    beforeFiles.length === afterFiles.length &&
    beforeFiles.every((file, index) => file === afterFiles[index]);

  if (!filenamesMatch) {
    throw new Error('Postflight verification failed after commit; recovery required: migration filenames list mismatch.');
  }

  if (before?.auth_users_count !== after.auth_users_count) {
    throw new Error(
      `Postflight verification failed after commit; recovery required: auth_users_count mismatch (before ${before?.auth_users_count}, after ${after.auth_users_count}).`
    );
  }

  return {
    backupPath: backup.path,
    backupSize: backup.size,
    tableCounts: after.tables,
  };
}
