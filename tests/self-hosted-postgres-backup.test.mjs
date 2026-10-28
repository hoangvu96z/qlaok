import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseSelfHostedBackupConfig,
  runSelfHostedPostgresBackup,
} from '../scripts/backup-self-hosted-postgres.mjs';

function withTempDir(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qlaok-pg-backup-'));
  try {
    return run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('self-hosted backup config requires a safe database name and absolute private destination', () => {
  assert.throws(() => parseSelfHostedBackupConfig({}), /QLAOK_DB_NAME is required/);
  assert.throws(
    () => parseSelfHostedBackupConfig({ QLAOK_DB_NAME: 'qlaok;drop' }),
    /simple PostgreSQL database name/
  );
  assert.throws(
    () =>
      parseSelfHostedBackupConfig({
        QLAOK_DB_NAME: 'qlaok',
        QLAOK_DB_BACKUP_DIR: 'relative/backups',
      }),
    /must be an absolute path/
  );
  assert.equal(
    parseSelfHostedBackupConfig({
      QLAOK_DB_NAME: 'qlaok',
      QLAOK_DB_BACKUP_DIR: '/tmp/qlaok-backups',
    }).retentionDays,
    14
  );
});

test('self-hosted backup uses custom pg_dump, verifies TOC, and writes private files', () => {
  withTempDir((directory) => {
    const backupDir = path.join(directory, 'backups');
    const calls = [];
    const result = runSelfHostedPostgresBackup({
      env: {
        PATH: '/usr/bin',
        HOME: directory,
        QLAOK_DB_NAME: 'qlaok',
        QLAOK_DB_BACKUP_DIR: backupDir,
      },
      now: new Date('2026-10-28T03:15:00.000Z'),
      spawnImpl(command, args, options) {
        calls.push({ command, args, options });
        if (command === 'pg_dump') {
          const outputPath = args[args.indexOf('--file') + 1];
          fs.writeFileSync(outputPath, Buffer.from('custom-format-dump'));
        }
        return { status: 0, stdout: '', stderr: '' };
      },
    });

    assert.equal(calls[0].command, 'pg_dump');
    assert.ok(calls[0].args.includes('--format=custom'));
    assert.ok(calls[0].args.includes('--dbname'));
    assert.deepEqual(calls[1].args.slice(0, 1), ['--list']);
    assert.equal(calls[0].options.env.PGPASSWORD, undefined);
    assert.equal(result.sizeBytes, Buffer.byteLength('custom-format-dump'));
    assert.equal(fs.statSync(backupDir).mode & 0o777, 0o700);
    assert.equal(fs.statSync(result.path).mode & 0o777, 0o600);
    assert.equal(fs.readFileSync(result.path, 'utf8'), 'custom-format-dump');
  });
});

test('self-hosted backup removes incomplete output when dump or TOC verification fails', () => {
  withTempDir((directory) => {
    const backupDir = path.join(directory, 'backups');
    assert.throws(
      () =>
        runSelfHostedPostgresBackup({
          env: {
            QLAOK_DB_NAME: 'qlaok',
            QLAOK_DB_BACKUP_DIR: backupDir,
          },
          spawnImpl(command, args) {
            if (command === 'pg_dump') {
              fs.writeFileSync(args[args.indexOf('--file') + 1], 'partial');
              return { status: 0, stderr: '' };
            }
            return { status: 1, stderr: 'corrupt backup' };
          },
        }),
      /pg_restore failed/
    );
    assert.deepEqual(fs.readdirSync(backupDir), []);
  });
});

test('self-hosted backup retains recent dumps and prunes expired dumps after verification', () => {
  withTempDir((directory) => {
    const backupDir = path.join(directory, 'backups');
    fs.mkdirSync(backupDir, { mode: 0o700 });
    const expired = path.join(backupDir, 'qlaok-postgres-expired.dump');
    const recent = path.join(backupDir, 'qlaok-postgres-recent.dump');
    fs.writeFileSync(expired, 'old');
    fs.writeFileSync(recent, 'recent');
    const now = new Date('2026-10-28T03:15:00.000Z');
    fs.utimesSync(expired, new Date('2026-10-01T00:00:00.000Z'), new Date('2026-10-01T00:00:00.000Z'));
    fs.utimesSync(recent, new Date('2026-10-27T00:00:00.000Z'), new Date('2026-10-27T00:00:00.000Z'));

    runSelfHostedPostgresBackup({
      env: {
        QLAOK_DB_NAME: 'qlaok',
        QLAOK_DB_BACKUP_DIR: backupDir,
        QLAOK_DB_BACKUP_RETENTION_DAYS: '14',
      },
      now,
      spawnImpl(command, args) {
        if (command === 'pg_dump') {
          fs.writeFileSync(args[args.indexOf('--file') + 1], 'new');
        }
        return { status: 0, stderr: '' };
      },
    });

    assert.equal(fs.existsSync(expired), false);
    assert.equal(fs.existsSync(recent), true);
  });
});
