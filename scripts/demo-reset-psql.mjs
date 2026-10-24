import { spawnSync } from 'node:child_process';
import {
  REQUIRED_PROJECT_REF,
  validateDatabaseUrl,
} from './backup-qlaok-db.mjs';

/**
 * Executes a prepared demo SQL script using `psql`.
 * Validates transaction boundaries and database target configuration.
 *
 * @param {string} sql
 * @param {Record<string, string | undefined>} [env=process.env]
 * @param {{ spawnSync?: typeof spawnSync }} [deps={}]
 * @returns {{ success: true }}
 */
export function executePreparedDemoSql(sql, env = process.env, deps = {}) {
  if (typeof sql !== 'string' || !sql.trim()) {
    throw new Error('Prepared SQL must be a non-empty string.');
  }

  const trimmedSql = sql.trim();
  if (!trimmedSql.startsWith('BEGIN;') || !trimmedSql.endsWith('COMMIT;')) {
    throw new Error('Prepared SQL must begin with "BEGIN;" and end with "COMMIT;".');
  }

  const rawUrl = env.QLAOK_DATABASE_URL;
  const validated = validateDatabaseUrl(rawUrl, REQUIRED_PROJECT_REF);

  const childEnv = {
    ...env,
    PGHOST: validated.hostname,
    PGPORT: validated.port,
    PGDATABASE: validated.database,
    PGUSER: validated.username,
    PGPASSWORD: validated.password,
    PGSSLMODE: validated.sslmode,
  };

  const spawn = deps.spawnSync || spawnSync;
  let res;
  try {
    res = spawn('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
      input: sql,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    throw new Error('psql execution failed.');
  }

  if (!res || res.error || res.status !== 0) {
    throw new Error('psql execution failed.');
  }

  return { success: true };
}
