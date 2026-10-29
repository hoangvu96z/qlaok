import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations');
const MIGRATION_FILE_PATTERN = /^\d+[A-Za-z]?_[A-Za-z0-9._-]+\.sql$/;
export const POSTGREST_SCHEMA_RELOAD_SQL = "NOTIFY pgrst, 'reload schema';";

export function checksumSql(sql) {
  return crypto.createHash('sha256').update(sql, 'utf8').digest('hex');
}

function stripSqlComments(sql) {
  return String(sql ?? '').replace(
    /[Ee]'(?:\\.|''|[^'\\])*'|'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\r\n]*|\/\*[\s\S]*?\*\//g,
    (match) => (match.startsWith('--') || match.startsWith('/*') ? ' ' : match)
  );
}

export function startsWithPostgrestSchemaReloadNotification(sql) {
  const firstStatement = stripSqlComments(sql).trimStart();
  return /^NOTIFY\s+PGRST\s*,\s*'reload schema'\s*;/i.test(firstStatement);
}

/**
 * Build psql arguments that make each migration atomic. A small number of
 * historical files already contain their own top-level BEGIN/COMMIT pair;
 * keep those files byte-for-byte unchanged because applied checksums are
 * immutable, and avoid nesting psql's transaction around them.
 */
export function buildMigrationPsqlArgs(migration) {
  const sql = String(migration.sql ?? '');
  const withoutLeadingComments = sql.replace(
    /^(?:(?:\s+)|(?:--[^\n]*(?:\n|$))|(?:\/\*[\s\S]*?\*\/))*/,
    ''
  );
  const withoutTrailingComments = sql.replace(
    /(?:(?:\s+)|(?:--[^\n]*(?:\n|$))|(?:\/\*[\s\S]*?\*\/))*$/,
    ''
  );
  const hasExplicitTransaction =
    /^BEGIN\s*;/i.test(withoutLeadingComments) &&
    /COMMIT\s*;$/i.test(withoutTrailingComments);
  return [
    ...(hasExplicitTransaction ? [] : ['--single-transaction']),
    '-f',
    migration.fullPath,
  ];
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
      const sql = fs.readFileSync(fullPath, 'utf8');
      return {
        filename: entry.name,
        fullPath,
        sql,
        checksum: checksumSql(sql),
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

export function notifyPostgrestSchemaReload(execPsql = runPsql) {
  execPsql(['-c', POSTGREST_SCHEMA_RELOAD_SQL]);
}

export function migrateSelfHosted({
  migrations = readLocalMigrations(),
  history = readMigrationHistory(),
  applyMigration = (migration) =>
    runPsql(buildMigrationPsqlArgs(migration)),
  saveMigration = recordMigration,
  reloadSchema = () => notifyPostgrestSchemaReload(),
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
  if (plan.apply.length > 0) {
    const finalMigration = plan.apply[plan.apply.length - 1];
    if (startsWithPostgrestSchemaReloadNotification(finalMigration?.sql)) {
      log(
        `PostgREST schema cache reload already included in ${finalMigration.filename}.`
      );
    } else {
      log('Reloading PostgREST schema cache...');
      reloadSchema();
      log('Reloaded PostgREST schema cache.');
    }
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
