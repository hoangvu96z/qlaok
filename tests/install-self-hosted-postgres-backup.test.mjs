import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installSelfHostedPostgresBackup } from '../scripts/install-self-hosted-postgres-backup.mjs';

function withFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qlaok-backup-installer-'));
  const fixtureRoot = fs.realpathSync(root);
  const paths = {
    appRoot: path.join(fixtureRoot, 'app'),
    configDir: path.join(fixtureRoot, 'etc/qlaok'),
    backupDir: path.join(fixtureRoot, 'backups/qlaok/postgres'),
    systemdDir: path.join(fixtureRoot, 'etc/systemd/system'),
    stateDir: path.join(fixtureRoot, 'state/qlaok'),
  };
  fs.mkdirSync(path.join(paths.appRoot, 'ops/systemd'), { recursive: true });
  fs.mkdirSync(paths.systemdDir, { recursive: true });
  fs.writeFileSync(
    path.join(paths.appRoot, '.env.local'),
    [
      'NEXT_PRIVATE_KEY=must-not-be-logged',
      'QLAOK_DB_NAME="qlaok" # runtime database',
      'ANOTHER_SECRET=also-must-not-be-logged',
      '',
    ].join('\n'),
    { mode: 0o600 }
  );
  fs.writeFileSync(
    path.join(paths.appRoot, 'ops/systemd/qlaok-postgres-backup.service'),
    '[Service]\nUser=postgres\n'
  );
  fs.writeFileSync(
    path.join(paths.appRoot, 'ops/systemd/qlaok-postgres-backup.timer'),
    '[Timer]\nOnCalendar=daily\n'
  );

  try {
    return run({
      root,
      paths,
      cleanup() {
        fs.rmSync(root, { recursive: true, force: true });
      },
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function createCommandRunner({ failInitialBackup = false } = {}) {
  const calls = [];
  return {
    calls,
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      if (
        failInitialBackup &&
        command === 'systemctl' &&
        args[0] === 'start' &&
        args[1] === 'qlaok-postgres-backup.service'
      ) {
        return { status: 1, stdout: '', stderr: 'private diagnostic must not escape' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
  };
}

function createFilesystemSpy() {
  const calls = [];
  const fsImpl = new Proxy(fs, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      return (...args) => {
        calls.push({ method: property, firstArgument: args[0] });
        return Reflect.apply(value, target, args);
      };
    },
  });
  return { fsImpl, calls };
}

function install(paths, spawnImpl, fsImpl = fs) {
  return installSelfHostedPostgresBackup({ ...paths, spawnImpl, fsImpl, isRoot: true });
}

test('installer creates a private config, enables the timer, and takes only one initial backup', () => {
  withFixture(({ paths }) => {
    const runner = createCommandRunner();
    const filesystem = createFilesystemSpy();
    const first = install(paths, runner.spawnImpl, filesystem.fsImpl);
    const second = install(paths, runner.spawnImpl, filesystem.fsImpl);
    const configPath = path.join(paths.configDir, 'postgres-backup.env');
    const markerPath = path.join(paths.stateDir, 'postgres-backup-initial-verified-v1');
    const servicePath = path.join(paths.systemdDir, 'qlaok-postgres-backup.service');
    const timerPath = path.join(paths.systemdDir, 'qlaok-postgres-backup.timer');
    const systemctlCalls = runner.calls
      .filter((call) => call.command === 'systemctl')
      .map((call) => call.args);

    assert.deepEqual(first, { initialBackupCreated: true });
    assert.deepEqual(second, { initialBackupCreated: false });
    assert.equal(
      fs.readFileSync(configPath, 'utf8'),
      `QLAOK_DB_NAME=qlaok\nQLAOK_DB_BACKUP_DIR=${paths.backupDir}\nQLAOK_DB_BACKUP_RETENTION_DAYS=14\n`
    );
    assert.equal(fs.statSync(configPath).mode & 0o777, 0o640);
    assert.equal(fs.statSync(paths.backupDir).mode & 0o777, 0o700);
    assert.equal(fs.statSync(markerPath).mode & 0o777, 0o600);
    assert.equal(fs.readFileSync(markerPath, 'utf8'), 'verified\n');
    assert.equal(fs.statSync(servicePath).mode & 0o777, 0o644);
    assert.equal(fs.statSync(timerPath).mode & 0o777, 0o644);
    assert.deepEqual(
      systemctlCalls,
      [
        ['daemon-reload'],
        ['start', 'qlaok-postgres-backup.service'],
        ['enable', '--now', 'qlaok-postgres-backup.timer'],
        ['is-enabled', '--quiet', 'qlaok-postgres-backup.timer'],
        ['is-active', '--quiet', 'qlaok-postgres-backup.timer'],
        ['daemon-reload'],
        ['enable', '--now', 'qlaok-postgres-backup.timer'],
        ['is-enabled', '--quiet', 'qlaok-postgres-backup.timer'],
        ['is-active', '--quiet', 'qlaok-postgres-backup.timer'],
      ]
    );
    const initialBackupCall = runner.calls.find(
      (call) =>
        call.command === 'systemctl' &&
        call.args[0] === 'start' &&
        call.args[1] === 'qlaok-postgres-backup.service'
    );
    assert.equal(initialBackupCall.options.timeout, 36 * 60 * 1000);
    const serviceUnit = fs.readFileSync(
      new URL('../ops/systemd/qlaok-postgres-backup.service', import.meta.url),
      'utf8'
    );
    assert.match(serviceUnit, /^User=postgres$/m);
    assert.match(serviceUnit, /^TimeoutStartSec=35min$/m);
    assert.match(serviceUnit, /^ProtectSystem=strict$/m);
    assert.match(serviceUnit, /^ReadWritePaths=\/var\/backups\/qlaok\/postgres$/m);
    const runtimeEnvFile = path.join(paths.appRoot, '.env.local');
    assert.ok(
      filesystem.calls.some(
        (call) => call.method === 'openSync' && call.firstArgument === runtimeEnvFile
      )
    );
    assert.equal(
      filesystem.calls.some(
        (call) => call.method === 'readFileSync' && call.firstArgument === runtimeEnvFile
      ),
      false
    );
    assert.ok(
      runner.calls.some((call) => call.command === 'chown' && call.args[1] === `postgres:postgres` && call.args.at(-1) === paths.backupDir)
    );
    assert.ok(
      runner.calls.some((call) => call.command === 'chown' && call.args[1] === `root:postgres` && call.args.at(-1) === configPath)
    );
    assert.equal(
      runner.calls.some((call) => JSON.stringify(call).includes('must-not-be-logged')),
      false
    );
  });
});

test('installer preserves a valid existing config without replacing retention settings', () => {
  withFixture(({ paths }) => {
    const configPath = path.join(paths.configDir, 'postgres-backup.env');
    fs.mkdirSync(paths.configDir, { recursive: true });
    const original = [
      '# operator-managed retention',
      'QLAOK_DB_NAME=qlaok',
      `QLAOK_DB_BACKUP_DIR=${paths.backupDir}`,
      'QLAOK_DB_BACKUP_RETENTION_DAYS=30',
      '',
    ].join('\n');
    fs.writeFileSync(configPath, original, { mode: 0o600 });
    const runner = createCommandRunner();

    install(paths, runner.spawnImpl);

    assert.equal(fs.readFileSync(configPath, 'utf8'), original);
    assert.equal(fs.statSync(configPath).mode & 0o777, 0o640);
  });
});

test('installer fails closed on invalid or conflicting existing config before enabling the timer', () => {
  for (const configFactory of [
    (paths) => `QLAOK_DB_NAME=qlaok\nQLAOK_DB_BACKUP_DIR=${paths.backupDir}\nQLAOK_DB_BACKUP_RETENTION_DAYS=0\n`,
    (paths) => `QLAOK_DB_NAME=other\nQLAOK_DB_BACKUP_DIR=${paths.backupDir}\nQLAOK_DB_BACKUP_RETENTION_DAYS=14\n`,
    () => 'QLAOK_DB_NAME=qlaok\nQLAOK_DB_BACKUP_DIR=/tmp/other\nQLAOK_DB_BACKUP_RETENTION_DAYS=14\n',
  ]) {
    withFixture(({ paths }) => {
      const configPath = path.join(paths.configDir, 'postgres-backup.env');
      fs.mkdirSync(paths.configDir, { recursive: true });
      const existingConfig = configFactory(paths);
      fs.writeFileSync(configPath, existingConfig);
      const runner = createCommandRunner();

      assert.throws(() => install(paths, runner.spawnImpl), /Existing backup config/);
      assert.equal(fs.readFileSync(configPath, 'utf8'), existingConfig);
      assert.equal(
        runner.calls.some((call) => call.command === 'systemctl'),
        false
      );
    });
  }
});

test('failed initial backup leaves no verified marker, and deploy runs installer before migrations', () => {
  withFixture(({ paths }) => {
    const runner = createCommandRunner({ failInitialBackup: true });
    const markerPath = path.join(paths.stateDir, 'postgres-backup-initial-verified-v1');

    assert.throws(
      () => install(paths, runner.spawnImpl),
      /Initial PostgreSQL backup failed; deployment must stop before migrations/
    );
    assert.equal(fs.existsSync(markerPath), false);
    assert.equal(
      JSON.stringify(runner.calls).includes('private diagnostic must not escape'),
      false
    );
    assert.equal(
      runner.calls.some(
        (call) => call.command === 'systemctl' && call.args[0] === 'enable'
      ),
      false
    );
  });

  const workflowPath = new URL('../.github/workflows/deploy.yml', import.meta.url);
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const deployScript = workflow.slice(workflow.indexOf('script: |'));
  const installerCall = deployScript.indexOf(
    'sudo -n /usr/bin/node /var/www/qlaok.vunph.click/scripts/install-self-hosted-postgres-backup.mjs'
  );
  const migrationsCall = deployScript.indexOf('node scripts/migrate-self-hosted.mjs');
  assert.match(deployScript, /set -eu/);
  assert.ok(installerCall >= 0 && migrationsCall > installerCall);
});

test('installer rejects duplicate and invalid database names and non-root execution', () => {
  for (const envContent of [
    'QLAOK_DB_NAME=qlaok\nQLAOK_DB_NAME=other\n',
    'QLAOK_DB_NAME=qlaok;drop\n',
    'QLAOK_DB_NAME=\n',
  ]) {
    withFixture(({ paths }) => {
      fs.writeFileSync(path.join(paths.appRoot, '.env.local'), envContent);
      const runner = createCommandRunner();
      assert.throws(() => install(paths, runner.spawnImpl), /QLAOK_DB_NAME/);
      assert.equal(runner.calls.length, 0);
    });
  }

  withFixture(({ paths }) => {
    const envFile = path.join(paths.appRoot, '.env.local');
    const target = path.join(paths.appRoot, 'runtime-config-copy');
    fs.renameSync(envFile, target);
    fs.symlinkSync(target, envFile);
    const runner = createCommandRunner();

    assert.throws(
      () => install(paths, runner.spawnImpl),
      /Runtime config must be a regular file/
    );
    assert.equal(runner.calls.length, 0);
  });

  withFixture(({ paths }) => {
    assert.throws(
      () => installSelfHostedPostgresBackup({ ...paths, isRoot: false }),
      /must run as root/
    );
  });
});

test('installer uses the same qlaok fallback as self-hosted migrations when the env key is absent', () => {
  withFixture(({ paths }) => {
    fs.writeFileSync(path.join(paths.appRoot, '.env.local'), 'OTHER_SETTING=value\n');
    const runner = createCommandRunner();

    install(paths, runner.spawnImpl);

    const config = fs.readFileSync(
      path.join(paths.configDir, 'postgres-backup.env'),
      'utf8'
    );
    assert.match(config, /^QLAOK_DB_NAME=qlaok$/m);
    assert.ok(
      runner.calls.some(
        (call) =>
          call.command === 'systemctl' &&
          call.args[0] === 'start' &&
          call.args[1] === 'qlaok-postgres-backup.service'
      )
    );
  });
});
