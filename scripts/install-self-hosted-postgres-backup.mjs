#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_APP_ROOT = '/var/www/qlaok.vunph.click';
const DEFAULT_BACKUP_DIR = '/var/backups/qlaok/postgres';
const DEFAULT_CONFIG_DIR = '/etc/qlaok';
const DEFAULT_SYSTEMD_DIR = '/etc/systemd/system';
const DEFAULT_STATE_DIR = '/var/lib/qlaok';
const CONFIG_NAME = 'postgres-backup.env';
const SERVICE_NAME = 'qlaok-postgres-backup.service';
const TIMER_NAME = 'qlaok-postgres-backup.timer';
const MARKER_NAME = 'postgres-backup-initial-verified-v1';
const INITIAL_BACKUP_MARKER = 'verified\n';
const DATABASE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,62}$/;
const ALLOWED_CONFIG_KEYS = new Set([
  'QLAOK_DB_NAME',
  'QLAOK_DB_BACKUP_DIR',
  'QLAOK_DB_BACKUP_RETENTION_DAYS',
]);

function assertRealDirectoryChain(directory, fsImpl, { createMissing = true } = {}) {
  const absolutePath = path.resolve(directory);
  const { root } = path.parse(absolutePath);
  let currentPath = root;

  for (const part of absolutePath.slice(root.length).split(path.sep).filter(Boolean)) {
    currentPath = path.join(currentPath, part);
    try {
      const stats = fsImpl.lstatSync(currentPath);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new Error('A required directory is not a real directory.');
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      if (!createMissing) {
        throw new Error('A required system directory is missing.');
      }
      try {
        fsImpl.mkdirSync(currentPath, { mode: 0o755 });
      } catch (mkdirError) {
        if (mkdirError?.code !== 'EEXIST') throw mkdirError;
      }
      const stats = fsImpl.lstatSync(currentPath);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new Error('A required directory is not a real directory.');
      }
    }
  }
}

function runCommand(command, args, spawnImpl, { timeout = 60 * 1000 } = {}) {
  const result = spawnImpl(command, args, {
    encoding: 'utf8',
    stdio: 'ignore',
    timeout,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Required system command failed: ${command}.`);
  }
}

function setOwnerAndMode(filePath, owner, mode, fsImpl, spawnImpl) {
  runCommand('chown', ['--', owner, filePath], spawnImpl);
  fsImpl.chmodSync(filePath, mode);
}

function ensureDirectory(directory, owner, mode, fsImpl, spawnImpl) {
  assertRealDirectoryChain(directory, fsImpl);
  setOwnerAndMode(directory, owner, mode, fsImpl, spawnImpl);
}

function parseDotEnvValue(rawValue) {
  const value = rawValue.trim();
  if (!value) return '';

  const quote = value[0];
  if (quote === '"' || quote === "'") {
    const closingQuote = value.indexOf(quote, 1);
    if (closingQuote < 0) throw new Error('QLAOK_DB_NAME in runtime config is invalid.');
    const trailing = value.slice(closingQuote + 1).trim();
    if (trailing && !trailing.startsWith('#')) {
      throw new Error('QLAOK_DB_NAME in runtime config is invalid.');
    }
    return value.slice(1, closingQuote);
  }

  const commentIndex = value.search(/\s+#/);
  return (commentIndex < 0 ? value : value.slice(0, commentIndex)).trim();
}

function readRuntimeDatabaseName(envFile, fsImpl) {
  const envStats = fsImpl.lstatSync(envFile);
  if (!envStats.isFile() || envStats.isSymbolicLink()) {
    throw new Error('Runtime config must be a regular file.');
  }
  const descriptor = fsImpl.openSync(
    envFile,
    fsImpl.constants.O_RDONLY | fsImpl.constants.O_NOFOLLOW
  );
  const buffer = Buffer.alloc(4096);
  let pending = '';
  let databaseName;
  let occurrences = 0;

  const consumeLine = (line) => {
    const match = /^\s*(?:export\s+)?QLAOK_DB_NAME\s*=(.*)$/.exec(line);
    if (!match) return;
    occurrences += 1;
    if (occurrences > 1) {
      throw new Error('Runtime config must define QLAOK_DB_NAME exactly once.');
    }
    databaseName = parseDotEnvValue(match[1]);
  };

  try {
    let bytesRead;
    while ((bytesRead = fsImpl.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      pending += buffer.toString('utf8', 0, bytesRead);
      let newlineIndex = pending.indexOf('\n');
      while (newlineIndex >= 0) {
        consumeLine(pending.slice(0, newlineIndex).replace(/\r$/, ''));
        pending = pending.slice(newlineIndex + 1);
        newlineIndex = pending.indexOf('\n');
      }
    }
    if (pending) consumeLine(pending.replace(/\r$/, ''));
  } finally {
    fsImpl.closeSync(descriptor);
  }

  if (occurrences !== 1 || !DATABASE_NAME_PATTERN.test(databaseName || '')) {
    throw new Error('Runtime config must contain a valid QLAOK_DB_NAME.');
  }
  return databaseName;
}

function parseBackupEnvironment(content, expectedBackupDir) {
  const values = Object.create(null);
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match || !ALLOWED_CONFIG_KEYS.has(match[1]) || Object.hasOwn(values, match[1])) {
      throw new Error('Existing backup config is invalid.');
    }
    values[match[1]] = match[2];
  }

  const databaseName = values.QLAOK_DB_NAME;
  const backupDir = values.QLAOK_DB_BACKUP_DIR;
  const retentionDays = values.QLAOK_DB_BACKUP_RETENTION_DAYS;
  if (
    !DATABASE_NAME_PATTERN.test(databaseName || '') ||
    !path.isAbsolute(backupDir || '') ||
    path.resolve(backupDir) !== path.resolve(expectedBackupDir) ||
    !/^\d{1,4}$/.test(retentionDays || '') ||
    Number(retentionDays) < 1 ||
    Number(retentionDays) > 3650
  ) {
    throw new Error('Existing backup config is invalid or conflicts with the backup service.');
  }
  return { databaseName, backupDir, retentionDays };
}

function ensureBackupConfig(configPath, databaseName, backupDir, fsImpl, spawnImpl) {
  try {
    const stats = fsImpl.lstatSync(configPath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error('Existing backup config must be a regular file.');
    }
    const existingContent = fsImpl.readFileSync(configPath, 'utf8');
    const existingConfig = parseBackupEnvironment(existingContent, backupDir);
    if (existingConfig.databaseName !== databaseName) {
      throw new Error('Existing backup config conflicts with the runtime database.');
    }
    setOwnerAndMode(configPath, 'root:postgres', 0o640, fsImpl, spawnImpl);
    return;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const content = [
    `QLAOK_DB_NAME=${databaseName}`,
    `QLAOK_DB_BACKUP_DIR=${backupDir}`,
    'QLAOK_DB_BACKUP_RETENTION_DAYS=14',
    '',
  ].join('\n');
  let descriptor;
  let created = false;
  try {
    descriptor = fsImpl.openSync(configPath, 'wx', 0o600);
    created = true;
    fsImpl.writeFileSync(descriptor, content, 'utf8');
    fsImpl.fsyncSync(descriptor);
    fsImpl.closeSync(descriptor);
    descriptor = undefined;
    setOwnerAndMode(configPath, 'root:postgres', 0o640, fsImpl, spawnImpl);
  } catch (error) {
    if (descriptor !== undefined) fsImpl.closeSync(descriptor);
    if (created) {
      try {
        fsImpl.unlinkSync(configPath);
      } catch {
        // The incomplete file may already have been removed.
      }
    }
    throw error;
  }
}

function installUnit(sourcePath, destinationPath, fsImpl, spawnImpl) {
  const sourceStats = fsImpl.lstatSync(sourcePath);
  if (!sourceStats.isFile() || sourceStats.isSymbolicLink()) {
    throw new Error('A systemd unit source is not a regular file.');
  }
  try {
    const destinationStats = fsImpl.lstatSync(destinationPath);
    if (!destinationStats.isFile() || destinationStats.isSymbolicLink()) {
      throw new Error('An installed systemd unit is not a regular file.');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const temporaryPath = `${destinationPath}.qlaok-tmp-${process.pid}`;
  const content = fsImpl.readFileSync(sourcePath);
  let descriptor;
  try {
    descriptor = fsImpl.openSync(temporaryPath, 'wx', 0o600);
    fsImpl.writeFileSync(descriptor, content);
    fsImpl.fsyncSync(descriptor);
    fsImpl.closeSync(descriptor);
    descriptor = undefined;
    setOwnerAndMode(temporaryPath, 'root:root', 0o644, fsImpl, spawnImpl);
    fsImpl.renameSync(temporaryPath, destinationPath);
  } catch (error) {
    if (descriptor !== undefined) fsImpl.closeSync(descriptor);
    try {
      fsImpl.unlinkSync(temporaryPath);
    } catch {
      // The temporary unit may already have been moved or removed.
    }
    throw error;
  }
}

function hasVerifiedInitialBackup(markerPath, fsImpl, spawnImpl) {
  try {
    const stats = fsImpl.lstatSync(markerPath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error('Backup installation marker is invalid.');
    }
    if (fsImpl.readFileSync(markerPath, 'utf8') !== INITIAL_BACKUP_MARKER) {
      throw new Error('Backup installation marker is invalid.');
    }
    setOwnerAndMode(markerPath, 'root:root', 0o600, fsImpl, spawnImpl);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function markInitialBackupVerified(markerPath, fsImpl, spawnImpl) {
  let descriptor;
  let created = false;
  try {
    descriptor = fsImpl.openSync(markerPath, 'wx', 0o600);
    created = true;
    fsImpl.writeFileSync(descriptor, INITIAL_BACKUP_MARKER, 'utf8');
    fsImpl.fsyncSync(descriptor);
    fsImpl.closeSync(descriptor);
    descriptor = undefined;
    setOwnerAndMode(markerPath, 'root:root', 0o600, fsImpl, spawnImpl);
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fsImpl.closeSync(descriptor);
      } catch {
        // Preserve the original setup failure.
      }
    }
    if (created) {
      try {
        fsImpl.unlinkSync(markerPath);
      } catch {
        // The incomplete marker may already have been removed.
      }
    }
    throw error;
  }
}

export function installSelfHostedPostgresBackup({
  appRoot = DEFAULT_APP_ROOT,
  configDir = DEFAULT_CONFIG_DIR,
  backupDir = DEFAULT_BACKUP_DIR,
  systemdDir = DEFAULT_SYSTEMD_DIR,
  stateDir = DEFAULT_STATE_DIR,
  fsImpl = fs,
  spawnImpl = spawnSync,
  isRoot = typeof process.getuid === 'function' && process.getuid() === 0,
} = {}) {
  if (!isRoot) throw new Error('Backup timer installer must run as root.');
  if (!path.isAbsolute(backupDir)) throw new Error('Backup destination must be absolute.');

  const runtimeDatabaseName = readRuntimeDatabaseName(
    path.join(appRoot, '.env.local'),
    fsImpl
  );
  const configPath = path.join(configDir, CONFIG_NAME);
  const markerPath = path.join(stateDir, MARKER_NAME);

  ensureDirectory(configDir, 'root:postgres', 0o750, fsImpl, spawnImpl);
  ensureBackupConfig(configPath, runtimeDatabaseName, backupDir, fsImpl, spawnImpl);
  ensureDirectory(backupDir, 'postgres:postgres', 0o700, fsImpl, spawnImpl);
  assertRealDirectoryChain(systemdDir, fsImpl, { createMissing: false });
  ensureDirectory(stateDir, 'root:root', 0o750, fsImpl, spawnImpl);

  installUnit(
    path.join(appRoot, 'ops/systemd', SERVICE_NAME),
    path.join(systemdDir, SERVICE_NAME),
    fsImpl,
    spawnImpl
  );
  installUnit(
    path.join(appRoot, 'ops/systemd', TIMER_NAME),
    path.join(systemdDir, TIMER_NAME),
    fsImpl,
    spawnImpl
  );

  runCommand('systemctl', ['daemon-reload'], spawnImpl);
  const initialBackupAlreadyVerified = hasVerifiedInitialBackup(
    markerPath,
    fsImpl,
    spawnImpl
  );
  if (!initialBackupAlreadyVerified) {
    try {
      runCommand('systemctl', ['start', SERVICE_NAME], spawnImpl, {
        timeout: 36 * 60 * 1000,
      });
    } catch {
      throw new Error('Initial PostgreSQL backup failed; deployment must stop before migrations.');
    }
    markInitialBackupVerified(markerPath, fsImpl, spawnImpl);
  }
  runCommand('systemctl', ['enable', '--now', TIMER_NAME], spawnImpl);
  runCommand('systemctl', ['is-enabled', '--quiet', TIMER_NAME], spawnImpl);
  runCommand('systemctl', ['is-active', '--quiet', TIMER_NAME], spawnImpl);

  return { initialBackupCreated: !initialBackupAlreadyVerified };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = installSelfHostedPostgresBackup();
    console.info(
      result.initialBackupCreated
        ? 'PostgreSQL backup timer installed; initial backup verified.'
        : 'PostgreSQL backup timer installed; prior initial backup is verified.'
    );
  } catch (error) {
    console.error(
      `PostgreSQL backup timer setup failed: ${error?.message || 'unknown error'}`
    );
    process.exit(1);
  }
}
