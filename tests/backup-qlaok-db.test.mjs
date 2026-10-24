import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  parseBackupArgs,
  validateDatabaseUrl,
  resolveBackupPath,
  executeBackup,
  redactSecrets,
  REQUIRED_PROJECT_REF,
} from '../scripts/backup-qlaok-db.mjs';

const VALID_DIRECT_URL =
  'postgresql://postgres:my%20secret%21@db.kftmrjmmympztzztunxf.supabase.co:5432/postgres';
const VALID_POOLER_URL =
  'postgresql://postgres.kftmrjmmympztzztunxf:my%20secret%21@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres';
const VALID_CUSTOM_ROLE_POOLER_URL =
  'postgresql://custom_role.kftmrjmmympztzztunxf:my%20secret%21@aws-1-us-east-1.pooler.supabase.com:5432/postgres';

test('parseBackupArgs: requires exact project ref and rejects missing or mismatched ref', () => {
  assert.throws(
    () => parseBackupArgs([]),
    /--project-ref is required/
  );
  assert.throws(
    () => parseBackupArgs(['--project-ref', 'wrongprojectref123']),
    /must be exact 'kftmrjmmympztzztunxf'/
  );
  assert.throws(
    () => parseBackupArgs(['--project-ref=anotherref']),
    /must be exact 'kftmrjmmympztzztunxf'/
  );

  const parsed = parseBackupArgs(['--project-ref', REQUIRED_PROJECT_REF]);
  assert.equal(parsed.projectRef, REQUIRED_PROJECT_REF);
  assert.equal(parsed.outputDir, '');
  assert.equal(parsed.outputFile, '');
});

test('parseBackupArgs: rejects connection URL passed as CLI argument or flag', () => {
  assert.throws(
    () => parseBackupArgs(['--project-ref', REQUIRED_PROJECT_REF, 'postgresql://user:pass@host/db']),
    /Database URL must never be passed via CLI arguments/
  );
  assert.throws(
    () => parseBackupArgs(['--project-ref', REQUIRED_PROJECT_REF, '--db=postgres']),
    /Database URL must never be passed via CLI arguments/
  );
  assert.throws(
    () => parseBackupArgs(['--project-ref', REQUIRED_PROJECT_REF, '--url=postgresql://...']),
    /Database URL must never be passed via CLI arguments/
  );
  assert.throws(
    () => parseBackupArgs(['--project-ref', REQUIRED_PROJECT_REF, '--unknown-flag']),
    /Unknown option/
  );
});

test('parseBackupArgs: does not leak secret values from unknown options or invalid project ref', () => {
  const secretArg = '--secret-api-key=supersecretvalue123';
  try {
    parseBackupArgs(['--project-ref', REQUIRED_PROJECT_REF, secretArg]);
    assert.fail('Expected parseBackupArgs to throw');
  } catch (err) {
    assert.match(err.message, /Unknown option/);
    assert.equal(err.message.includes('supersecretvalue123'), false);
    assert.equal(err.message.includes(secretArg), false);
  }

  const secretRef = 'secretref-password123';
  try {
    parseBackupArgs([`--project-ref=${secretRef}`]);
    assert.fail('Expected parseBackupArgs to throw');
  } catch (err) {
    assert.match(err.message, /must be exact 'kftmrjmmympztzztunxf'/);
    assert.equal(err.message.includes(secretRef), false);
  }
});

test('validateDatabaseUrl: requires non-empty QLAOK_DATABASE_URL', () => {
  assert.throws(() => validateDatabaseUrl(''), /QLAOK_DATABASE_URL environment variable is required/);
  assert.throws(() => validateDatabaseUrl('   '), /QLAOK_DATABASE_URL environment variable is required/);
  assert.throws(() => validateDatabaseUrl(null), /QLAOK_DATABASE_URL environment variable is required/);
  assert.throws(() => validateDatabaseUrl('not a url'), /not a valid URL/);
  assert.throws(() => validateDatabaseUrl('http://localhost:3000'), /Invalid URL protocol/);
});

test('validateDatabaseUrl: accepts official Supabase direct and shared session pooler host forms', () => {
  const direct = validateDatabaseUrl(VALID_DIRECT_URL, REQUIRED_PROJECT_REF);
  assert.equal(direct.hostname, 'db.kftmrjmmympztzztunxf.supabase.co');
  assert.equal(direct.port, '5432');
  assert.equal(direct.database, 'postgres');
  assert.equal(direct.username, 'postgres');
  assert.equal(direct.password, 'my secret!');
  assert.equal(direct.sslmode, 'require');
  assert.equal(direct.isDirect, true);
  assert.equal(direct.isPooler, false);

  const pooler = validateDatabaseUrl(VALID_POOLER_URL, REQUIRED_PROJECT_REF);
  assert.equal(pooler.hostname, 'aws-0-ap-southeast-1.pooler.supabase.com');
  assert.equal(pooler.port, '5432');
  assert.equal(pooler.database, 'postgres');
  assert.equal(pooler.username, 'postgres.kftmrjmmympztzztunxf');
  assert.equal(pooler.sslmode, 'require');
  assert.equal(pooler.isDirect, false);
  assert.equal(pooler.isPooler, true);

  const customRolePooler = validateDatabaseUrl(VALID_CUSTOM_ROLE_POOLER_URL, REQUIRED_PROJECT_REF);
  assert.equal(customRolePooler.hostname, 'aws-1-us-east-1.pooler.supabase.com');
  assert.equal(customRolePooler.username, 'custom_role.kftmrjmmympztzztunxf');
});

test('validateDatabaseUrl: rejects fake ref pooler host forms and spoofed domains', () => {
  // Fake pooler hosts where ref was placed directly in host
  assert.throws(
    () =>
      validateDatabaseUrl(
        'postgresql://postgres.kftmrjmmympztzztunxf:pass@kftmrjmmympztzztunxf.pooler.supabase.com:5432/postgres',
        REQUIRED_PROJECT_REF
      ),
    /not an official Supabase direct\/pooler host/
  );
  assert.throws(
    () =>
      validateDatabaseUrl(
        'postgresql://postgres.kftmrjmmympztzztunxf:pass@aws-0.kftmrjmmympztzztunxf.pooler.supabase.com:5432/postgres',
        REQUIRED_PROJECT_REF
      ),
    /not an official Supabase direct\/pooler host/
  );

  // Localhost, wrong projects, spoofed suffix
  assert.throws(
    () => validateDatabaseUrl('postgresql://postgres:pass@localhost:5432/postgres', REQUIRED_PROJECT_REF),
    /not an official Supabase direct\/pooler host/
  );
  assert.throws(
    () => validateDatabaseUrl('postgresql://postgres:pass@db.otherproject.supabase.co:5432/postgres', REQUIRED_PROJECT_REF),
    /not an official Supabase direct\/pooler host/
  );
  assert.throws(
    () => validateDatabaseUrl('postgresql://postgres:pass@aws-0-ap-southeast-1.pooler.supabase.com.attacker.com:5432/postgres', REQUIRED_PROJECT_REF),
    /not an official Supabase direct\/pooler host/
  );
  assert.throws(
    () => validateDatabaseUrl('postgresql://postgres:pass@db.kftmrjmmympztzztunxf.supabase.co.attacker.com:5432/postgres', REQUIRED_PROJECT_REF),
    /not an official Supabase direct\/pooler host/
  );
});

test('validateDatabaseUrl: rejects transaction pooler port 6543 and non-5432 ports', () => {
  assert.throws(
    () =>
      validateDatabaseUrl(
        'postgresql://postgres.kftmrjmmympztzztunxf:pass@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres',
        REQUIRED_PROJECT_REF
      ),
    /Transaction pooler port 6543 is not supported for pg_dump/
  );
  assert.throws(
    () =>
      validateDatabaseUrl(
        'postgresql://postgres:pass@db.kftmrjmmympztzztunxf.supabase.co:6543/postgres',
        REQUIRED_PROJECT_REF
      ),
    /Transaction pooler port 6543 is not supported for pg_dump/
  );
  assert.throws(
    () =>
      validateDatabaseUrl(
        'postgresql://postgres:pass@db.kftmrjmmympztzztunxf.supabase.co:5433/postgres',
        REQUIRED_PROJECT_REF
      ),
    /Port '5433' is not supported/
  );
});

test('validateDatabaseUrl: requires /postgres path and rejects fragments or unexpected query params', () => {
  // Path must be exactly /postgres
  assert.throws(
    () =>
      validateDatabaseUrl(
        'postgresql://postgres:pass@db.kftmrjmmympztzztunxf.supabase.co:5432/otherdb',
        REQUIRED_PROJECT_REF
      ),
    /Database path must be '\/postgres'/
  );
  assert.throws(
    () =>
      validateDatabaseUrl(
        'postgresql://postgres:pass@db.kftmrjmmympztzztunxf.supabase.co:5432/',
        REQUIRED_PROJECT_REF
      ),
    /Database path must be '\/postgres'/
  );

  // Reject URL fragments
  assert.throws(
    () =>
      validateDatabaseUrl(
        'postgresql://postgres:pass@db.kftmrjmmympztzztunxf.supabase.co:5432/postgres#frag',
        REQUIRED_PROJECT_REF
      ),
    /Database URL must not contain URL fragments or hash/
  );

  // Reject unexpected query params
  assert.throws(
    () =>
      validateDatabaseUrl(
        'postgresql://postgres:pass@db.kftmrjmmympztzztunxf.supabase.co:5432/postgres?token=secret123',
        REQUIRED_PROJECT_REF
      ),
    /unexpected query parameter/
  );

  // Reject insecure sslmode
  assert.throws(
    () =>
      validateDatabaseUrl(
        'postgresql://postgres:pass@db.kftmrjmmympztzztunxf.supabase.co:5432/postgres?sslmode=disable',
        REQUIRED_PROJECT_REF
      ),
    /Insecure or unsupported sslmode query parameter/
  );

  // Permit safe sslmodes
  const requireMode = validateDatabaseUrl(
    'postgresql://postgres:pass@db.kftmrjmmympztzztunxf.supabase.co:5432/postgres?sslmode=require',
    REQUIRED_PROJECT_REF
  );
  assert.equal(requireMode.sslmode, 'require');

  const verifyFullMode = validateDatabaseUrl(
    'postgresql://postgres:pass@db.kftmrjmmympztzztunxf.supabase.co:5432/postgres?sslmode=verify-full',
    REQUIRED_PROJECT_REF
  );
  assert.equal(verifyFullMode.sslmode, 'verify-full');
});

test('validateDatabaseUrl: rejects userinfo anomalies and enforces project ref in pooler username', () => {
  // Missing username or password
  assert.throws(
    () => validateDatabaseUrl('postgresql://:secret@db.kftmrjmmympztzztunxf.supabase.co:5432/postgres', REQUIRED_PROJECT_REF),
    /must contain non-empty username and password/
  );
  assert.throws(
    () => validateDatabaseUrl('postgresql://postgres@db.kftmrjmmympztzztunxf.supabase.co:5432/postgres', REQUIRED_PROJECT_REF),
    /must contain non-empty username and password/
  );

  // Pooler connection requires project ref in username
  assert.throws(
    () =>
      validateDatabaseUrl(
        'postgresql://postgres:pass@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
        REQUIRED_PROJECT_REF
      ),
    /Pooler connection username must include project ref suffix/
  );

  // Pooler connection with wrong project ref in username
  assert.throws(
    () =>
      validateDatabaseUrl(
        'postgresql://postgres.wrongref:pass@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
        REQUIRED_PROJECT_REF
      ),
    /Pooler connection username must include project ref suffix/
  );

  // Direct connection with mismatched project ref suffix
  assert.throws(
    () =>
      validateDatabaseUrl(
        'postgresql://postgres.wrongref:pass@db.kftmrjmmympztzztunxf.supabase.co:5432/postgres',
        REQUIRED_PROJECT_REF
      ),
    /Userinfo project ref suffix does not match expected ref/
  );
});

test('resolveBackupPath: rejects paths in tracked repo folders and enforces safe destinations', () => {
  const cwd = '/workspace/qlaok';
  assert.throws(
    () => resolveBackupPath({ projectRef: REQUIRED_PROJECT_REF, outputFile: 'src/backup.dump' }, cwd),
    /must be outside tracked repository files/
  );
  assert.throws(
    () => resolveBackupPath({ projectRef: REQUIRED_PROJECT_REF, outputFile: 'supabase/backup.dump' }, cwd),
    /must be outside tracked repository files/
  );

  const localDbPath = resolveBackupPath({ projectRef: REQUIRED_PROJECT_REF }, cwd);
  assert.equal(localDbPath.startsWith(path.join(cwd, '.local-db', 'backups')), true);

  const tmpPath = resolveBackupPath({ projectRef: REQUIRED_PROJECT_REF, outputFile: '/tmp/my-backup.dump' }, cwd);
  assert.equal(tmpPath, '/tmp/my-backup.dump');
});

test('executeBackup: creates file atomically with exclusive wx and 0600 mode before pg_dump, refuses overwrite', () => {
  const openCalls = [];
  const chmodCalls = [];
  const existingFiles = new Set(['/tmp/existing.dump']);

  const fakeFs = {
    existsSync: (p) => existingFiles.has(p),
    mkdirSync: () => {},
    chmodSync: (p, mode) => chmodCalls.push({ path: p, mode }),
    openSync: (p, flags, mode) => {
      openCalls.push({ path: p, flags, mode });
      if (existingFiles.has(p)) {
        const err = new Error('File exists');
        err.code = 'EEXIST';
        throw err;
      }
      existingFiles.add(p);
      return 42;
    },
    closeSync: () => {},
    unlinkSync: (p) => existingFiles.delete(p),
  };

  // Refuses overwrite without unlinking pre-existing file
  assert.throws(
    () =>
      executeBackup(
        { projectRef: REQUIRED_PROJECT_REF, outputFile: '/tmp/existing.dump' },
        { QLAOK_DATABASE_URL: VALID_DIRECT_URL },
        { fs: fakeFs }
      ),
    /Backup destination already exists \(refusing to overwrite\)/
  );
  assert.equal(existingFiles.has('/tmp/existing.dump'), true);
  assert.equal(openCalls[0].flags, 'wx');
  assert.equal(openCalls[0].mode, 0o600);
});

test('executeBackup: fails closed, cleans up file, and does not leak stderr on pg_dump failure', () => {
  const existingFiles = new Set();
  const openCalls = [];
  const fakeFs = {
    existsSync: (p) => existingFiles.has(p),
    mkdirSync: () => {},
    chmodSync: () => {},
    openSync: (p, flags, mode) => {
      openCalls.push({ path: p, flags, mode });
      existingFiles.add(p);
      return 11;
    },
    closeSync: () => {},
    unlinkSync: (p) => existingFiles.delete(p),
  };

  const sensitiveStderr = 'pg_dump: connection failure with password=supersecretpass';
  const fakeSpawn = (cmd) => {
    if (cmd === 'pg_dump') {
      return {
        status: 1,
        error: null,
        stderr: Buffer.from(sensitiveStderr),
      };
    }
    return { status: 0 };
  };

  try {
    executeBackup(
      { projectRef: REQUIRED_PROJECT_REF, outputFile: '/tmp/failed.dump' },
      { QLAOK_DATABASE_URL: VALID_DIRECT_URL },
      { fs: fakeFs, spawnSync: fakeSpawn }
    );
    assert.fail('Expected executeBackup to throw');
  } catch (err) {
    assert.match(err.message, /pg_dump failed with exit code 1/);
    assert.equal(err.message.includes('supersecretpass'), false);
    assert.equal(err.message.includes('sensitiveStderr'), false);
  }

  // Exclusive file was created before pg_dump and unlinked after failure
  assert.equal(openCalls.length, 1);
  assert.equal(openCalls[0].flags, 'wx');
  assert.equal(openCalls[0].mode, 0o600);
  assert.equal(existingFiles.has('/tmp/failed.dump'), false);
});

test('executeBackup: fails closed and cleans up file on archive validation failure or missing TOC entries', () => {
  // Sub-case A: 0-byte file
  let existingFiles = new Set();
  let fakeFs = {
    existsSync: (p) => existingFiles.has(p),
    mkdirSync: () => {},
    chmodSync: () => {},
    openSync: (p) => { existingFiles.add(p); return 1; },
    closeSync: () => {},
    statSync: () => ({ size: 0 }),
    unlinkSync: (p) => existingFiles.delete(p),
  };
  let fakeSpawn = () => ({ status: 0 });

  assert.throws(
    () =>
      executeBackup(
        { projectRef: REQUIRED_PROJECT_REF, outputFile: '/tmp/empty.dump' },
        { QLAOK_DATABASE_URL: VALID_DIRECT_URL },
        { fs: fakeFs, spawnSync: fakeSpawn }
      ),
    /Backup archive is empty \(0 bytes\)/
  );
  assert.equal(existingFiles.has('/tmp/empty.dump'), false);

  // Sub-case B: pg_restore --list fails without leaking stderr
  existingFiles = new Set();
  fakeFs = {
    existsSync: (p) => existingFiles.has(p),
    mkdirSync: () => {},
    chmodSync: () => {},
    openSync: (p) => { existingFiles.add(p); return 2; },
    closeSync: () => {},
    statSync: () => ({ size: 1024 }),
    unlinkSync: (p) => existingFiles.delete(p),
  };
  fakeSpawn = (cmd) => {
    if (cmd === 'pg_restore') {
      return { status: 1, stderr: Buffer.from('corrupt header with secret_token=12345') };
    }
    return { status: 0 };
  };

  try {
    executeBackup(
      { projectRef: REQUIRED_PROJECT_REF, outputFile: '/tmp/invalid-toc.dump' },
      { QLAOK_DATABASE_URL: VALID_DIRECT_URL },
      { fs: fakeFs, spawnSync: fakeSpawn }
    );
    assert.fail('Expected executeBackup to throw');
  } catch (err) {
    assert.match(err.message, /pg_restore --list validation failed with exit code 1/);
    assert.equal(err.message.includes('secret_token'), false);
  }
  assert.equal(existingFiles.has('/tmp/invalid-toc.dump'), false);

  // Sub-case C: pg_restore --list has only public.shops, missing auth.users (OR bug rejection)
  existingFiles = new Set();
  fakeFs = {
    existsSync: (p) => existingFiles.has(p),
    mkdirSync: () => {},
    chmodSync: () => {},
    openSync: (p) => { existingFiles.add(p); return 3; },
    closeSync: () => {},
    statSync: () => ({ size: 1024 }),
    unlinkSync: (p) => existingFiles.delete(p),
  };
  fakeSpawn = (cmd) => {
    if (cmd === 'pg_restore') {
      return { status: 0, stdout: Buffer.from('1; 1259 16400 TABLE public shops postgres\n') };
    }
    return { status: 0 };
  };

  assert.throws(
    () =>
      executeBackup(
        { projectRef: REQUIRED_PROJECT_REF, outputFile: '/tmp/missing-users.dump' },
        { QLAOK_DATABASE_URL: VALID_DIRECT_URL },
        { fs: fakeFs, spawnSync: fakeSpawn }
      ),
    /Archive validation failed: expected table entry \(auth\.users\) missing from TOC/
  );
  assert.equal(existingFiles.has('/tmp/missing-users.dump'), false);

  // Sub-case D: pg_restore --list has only auth.users, missing public.shops
  existingFiles = new Set();
  fakeFs = {
    existsSync: (p) => existingFiles.has(p),
    mkdirSync: () => {},
    chmodSync: () => {},
    openSync: (p) => { existingFiles.add(p); return 4; },
    closeSync: () => {},
    statSync: () => ({ size: 1024 }),
    unlinkSync: (p) => existingFiles.delete(p),
  };
  fakeSpawn = (cmd) => {
    if (cmd === 'pg_restore') {
      return { status: 0, stdout: Buffer.from('1; 1259 16410 TABLE auth users supabase_auth_admin\n') };
    }
    return { status: 0 };
  };

  assert.throws(
    () =>
      executeBackup(
        { projectRef: REQUIRED_PROJECT_REF, outputFile: '/tmp/missing-shops.dump' },
        { QLAOK_DATABASE_URL: VALID_DIRECT_URL },
        { fs: fakeFs, spawnSync: fakeSpawn }
      ),
    /Archive validation failed: expected table entry \(public\.shops\) missing from TOC/
  );
  assert.equal(existingFiles.has('/tmp/missing-shops.dump'), false);
});

test('executeBackup: succeeds for direct and pooler URLs, asserts PGDATABASE is postgres, and checks both TOC entries', () => {
  const existingFiles = new Set();
  const fileModes = new Map();
  const openCalls = [];
  let capturedDumpCall = null;
  let capturedRestoreCall = null;

  const fakeFs = {
    existsSync: (p) => existingFiles.has(p),
    mkdirSync: () => {},
    openSync: (p, flags, mode) => {
      openCalls.push({ path: p, flags, mode });
      existingFiles.add(p);
      return 100;
    },
    closeSync: () => {},
    chmodSync: (p, mode) => fileModes.set(p, mode),
    statSync: () => ({ size: 4096 }),
    unlinkSync: (p) => existingFiles.delete(p),
  };

  const fakeSpawn = (cmd, args, opts) => {
    if (cmd === 'pg_dump') {
      capturedDumpCall = { cmd, args, opts };
      return { status: 0 };
    }
    if (cmd === 'pg_restore') {
      capturedRestoreCall = { cmd, args, opts };
      return {
        status: 0,
        stdout: Buffer.from(
          '; Archive TOC\n' +
            '1; 1259 16400 TABLE public shops postgres\n' +
            '2; 0 16400 TABLE DATA public shops postgres\n' +
            '3; 1259 16410 TABLE auth users supabase_auth_admin\n' +
            '4; 0 16410 TABLE DATA auth users supabase_auth_admin\n'
        ),
      };
    }
    return { status: 0 };
  };

  // Run with VALID_POOLER_URL
  const result = executeBackup(
    { projectRef: REQUIRED_PROJECT_REF, outputFile: '/tmp/qlaok-valid.dump' },
    { QLAOK_DATABASE_URL: VALID_POOLER_URL },
    { fs: fakeFs, spawnSync: fakeSpawn }
  );

  assert.equal(result.success, true);
  assert.equal(result.path, '/tmp/qlaok-valid.dump');
  assert.equal(result.size, 4096);

  // Exclusive creation before pg_dump with mode 0600
  assert.equal(openCalls[0].path, '/tmp/qlaok-valid.dump');
  assert.equal(openCalls[0].flags, 'wx');
  assert.equal(openCalls[0].mode, 0o600);
  assert.equal(fileModes.get('/tmp/qlaok-valid.dump'), 0o600);

  // Connection passed ONLY in child environment, never in CLI arguments
  assert.deepEqual(capturedDumpCall.args, [
    '--format=custom',
    '--schema=public',
    '--schema=auth',
    '--file=/tmp/qlaok-valid.dump',
  ]);
  assert.equal(capturedDumpCall.args.some((a) => a.includes('secret') || a.includes('postgres:')), false);

  // Crucial: PGDATABASE is 'postgres' (NOT the full URI)
  assert.equal(capturedDumpCall.opts.env.PGDATABASE, 'postgres');
  assert.equal(capturedDumpCall.opts.env.PGHOST, 'aws-0-ap-southeast-1.pooler.supabase.com');
  assert.equal(capturedDumpCall.opts.env.PGPORT, '5432');
  assert.equal(capturedDumpCall.opts.env.PGUSER, 'postgres.kftmrjmmympztzztunxf');
  assert.equal(capturedDumpCall.opts.env.PGPASSWORD, 'my secret!');
  assert.equal(capturedDumpCall.opts.env.PGSSLMODE, 'require');

  // pg_restore called with --list
  assert.deepEqual(capturedRestoreCall.args, ['--list', '/tmp/qlaok-valid.dump']);
});

test('redactSecrets: masks credentials and database URLs', () => {
  const text = `Error connecting to ${VALID_DIRECT_URL} with password=supersecret and token=sbp_12345`;
  const redacted = redactSecrets(text);
  assert.equal(redacted.includes('my%20secret%21'), false);
  assert.equal(redacted.includes('supersecret'), false);
  assert.equal(redacted.includes('sbp_12345'), false);
  assert.equal(redacted.includes('[REDACTED_DB_URL]'), true);
});
