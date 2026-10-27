import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations');
const MIGRATION_FILE_PATTERN = /^\d+[A-Za-z]?_[A-Za-z0-9._-]+\.sql$/;

export function checksumSql(sql) {
  return crypto.createHash('sha256').update(sql, 'utf8').digest('hex');
}

export function planMigrations(migrations, history) {
  const apply = [];
  const skip = [];

  for (const migration of [...migrations].sort((a, b) => a.filename.localeCompare(b.filename))) {
    if (!MIGRATION_FILE_PATTERN.test(migration.filename)) {
      throw new Error(`Unsupported migration filename: ${migration.filename}`);
    }

    const recordedChecksum = history.get(migration.filename);
    if (recordedChecksum === undefined) {
      apply.push(migration);
      continue;
    }
    if (recordedChecksum !== migration.checksum) {
      throw new Error(
        `Migration checksum changed after application: ${migration.filename}`
      );
    }
    skip.push(migration.filename);
  }

  return { apply, skip };
}

function runPsql(args, { database, input } = {}) {
  const dbName = database || process.env.QLAOK_DB_NAME || 'qlaok';
  const result = spawnSync(
    'sudo',
    [
      '-n',
      '-u',
      'postgres',
      'psql',
      '-X',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
      '-d',
      dbName,
      ...args,
    ],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      input,
      maxBuffer: 8 * 1024 * 1024,
    }
  );

  if (result.error) {
    throw new Error(`Could not run PostgreSQL migration command: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim().slice(-1200);
    throw new Error(`PostgreSQL command failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout.trim();
}

function readLocalMigrations() {
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && MIGRATION_FILE_PATTERN.test(entry.name))
    .map((entry) => {
      const fullPath = path.join(MIGRATIONS_DIR, entry.name);
      return {
        filename: entry.name,
        fullPath,
        checksum: checksumSql(fs.readFileSync(fullPath, 'utf8')),
      };
    })
    .sort((a, b) => a.filename.localeCompare(b.filename));
}

function readMigrationHistory() {
  const output = runPsql([
    '-A',
    '-t',
    '-F',
    '\t',
    '-c',
    "SELECT filename, checksum FROM public.schema_migrations ORDER BY filename;",
  ]);
  const history = new Map();
  for (const row of output.split(/\r?\n/)) {
    if (!row) continue;
    const separator = row.indexOf('\t');
    if (separator < 1) {
      throw new Error('Unexpected self-hosted migration history response.');
    }
    history.set(row.slice(0, separator), row.slice(separator + 1));
  }
  return history;
}

function recordMigration(migration) {
  const filename = migration.filename.replace(/'/g, "''");
  const sql = `INSERT INTO public.schema_migrations (filename, checksum) VALUES ('${filename}', '${migration.checksum}') ON CONFLICT (filename) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = NOW();`;
  runPsql(['-c', sql]);
}

export function migrateSelfHosted({
  migrations = readLocalMigrations(),
  history = readMigrationHistory(),
  applyMigration = (migration) => runPsql(['-f', migration.fullPath]),
  saveMigration = recordMigration,
  log = console.log,
} = {}) {
  const plan = planMigrations(migrations, history);
  for (const filename of plan.skip) log(`Already applied: ${filename}`);
  for (const migration of plan.apply) {
    log(`Applying ${migration.filename}`);
    applyMigration(migration);
    saveMigration(migration);
    log(`Applied ${migration.filename}`);
  }
  log(`Self-hosted migrations complete (${plan.skip.length} already applied, ${plan.apply.length} applied).`);
  return plan;
}

function main() {
  migrateSelfHosted();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`Self-hosted migration failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  }
}
