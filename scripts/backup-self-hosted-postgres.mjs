#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactSecrets } from './backup-qlaok-db.mjs';

const DEFAULT_BACKUP_DIR = '/var/backups/qlaok/postgres';
const MAX_RETENTION_DAYS = 3650;

export function parseSelfHostedBackupConfig(env = process.env) {
  const databaseName = String(env.QLAOK_DB_NAME || '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(databaseName)) {
    throw new Error('QLAOK_DB_NAME is required and must be a simple PostgreSQL database name.');
  }

  const backupDir = String(
    env.QLAOK_DB_BACKUP_DIR || DEFAULT_BACKUP_DIR
  ).trim();
  if (!path.isAbsolute(backupDir)) {
    throw new Error('QLAOK_DB_BACKUP_DIR must be an absolute path.');
  }

  const rawRetentionDays = String(env.QLAOK_DB_BACKUP_RETENTION_DAYS || '14').trim();
  if (!/^\d{1,4}$/.test(rawRetentionDays)) {
    throw new Error('QLAOK_DB_BACKUP_RETENTION_DAYS must be an integer from 1 to 3650.');
  }
  const retentionDays = Number(rawRetentionDays);
  if (retentionDays < 1 || retentionDays > MAX_RETENTION_DAYS) {
    throw new Error('QLAOK_DB_BACKUP_RETENTION_DAYS must be an integer from 1 to 3650.');
  }

  return {
    databaseName,
    backupDir: path.resolve(backupDir),
    retentionDays,
  };
}

function runCommand(command, args, spawnImpl, env) {
  const result = spawnImpl(command, args, {
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
    timeout: 30 * 60 * 1000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`${command} could not start: ${redactSecrets(result.error.message)}`);
  }
  if (result.status !== 0) {
    const detail = redactSecrets(String(result.stderr || '')).trim().slice(0, 400);
    throw new Error(
      `${command} failed${result.status === null ? '' : ` with exit ${result.status}`}${detail ? `: ${detail}` : '.'}`
    );
  }
  return result;
}

function removeExpiredBackups(fsImpl, backupDir, retentionDays, nowMs) {
  const cutoffMs = nowMs - retentionDays * 24 * 60 * 60 * 1000;
  const prefix = 'qlaok-postgres-';
  for (const name of fsImpl.readdirSync(backupDir)) {
    if (!name.startsWith(prefix) || !name.endsWith('.dump')) continue;
    const filePath = path.join(backupDir, name);
    const stats = fsImpl.lstatSync(filePath);
    if (!stats.isFile() || stats.mtimeMs >= cutoffMs) continue;
    fsImpl.unlinkSync(filePath);
  }
}

export function runSelfHostedPostgresBackup({
  env = process.env,
  now = new Date(),
  fsImpl = fs,
  spawnImpl = spawnSync,
} = {}) {
  const config = parseSelfHostedBackupConfig(env);
  fsImpl.mkdirSync(config.backupDir, { recursive: true, mode: 0o700 });
  const dirStats = fsImpl.lstatSync(config.backupDir);
  if (!dirStats.isDirectory() || dirStats.isSymbolicLink()) {
    throw new Error('Backup destination must be a real directory.');
  }
  fsImpl.chmodSync(config.backupDir, 0o700);

  const timestamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const fileName = `qlaok-postgres-${timestamp}.dump`;
  const finalPath = path.join(config.backupDir, fileName);
  const tempPath = path.join(
    config.backupDir,
    `.${fileName}.partial-${process.pid}`
  );
  const fileDescriptor = fsImpl.openSync(tempPath, 'wx', 0o600);
  fsImpl.closeSync(fileDescriptor);

  const commandEnv = {
    PATH: env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/bin',
    HOME: env.HOME || '/var/lib/postgresql',
    LANG: env.LANG || 'C.UTF-8',
  };

  try {
    runCommand(
      'pg_dump',
      [
        '--format=custom',
        '--no-owner',
        '--no-acl',
        '--no-password',
        '--file',
        tempPath,
        '--dbname',
        config.databaseName,
      ],
      spawnImpl,
      commandEnv
    );
    fsImpl.chmodSync(tempPath, 0o600);
    if (fsImpl.statSync(tempPath).size <= 0) {
      throw new Error('pg_dump produced an empty backup.');
    }

    runCommand('pg_restore', ['--list', tempPath], spawnImpl, commandEnv);
    fsImpl.renameSync(tempPath, finalPath);
    fsImpl.chmodSync(finalPath, 0o600);

    const warnings = [];
    try {
      removeExpiredBackups(
        fsImpl,
        config.backupDir,
        config.retentionDays,
        now.getTime()
      );
    } catch (error) {
      warnings.push(`Retention cleanup failed: ${redactSecrets(error.message)}`);
    }

    return {
      path: finalPath,
      sizeBytes: fsImpl.statSync(finalPath).size,
      warnings,
    };
  } catch (error) {
    try {
      fsImpl.unlinkSync(tempPath);
    } catch {
      // The incomplete backup may already have been removed.
    }
    throw error;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = runSelfHostedPostgresBackup();
    console.info(
      `Self-hosted PostgreSQL backup verified: ${result.path} (${result.sizeBytes} bytes)`
    );
    for (const warning of result.warnings) console.warn(warning);
  } catch (error) {
    console.error(`Self-hosted PostgreSQL backup failed: ${redactSecrets(error.message)}`);
    process.exit(1);
  }
}
