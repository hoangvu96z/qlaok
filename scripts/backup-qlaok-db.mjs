#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Qlaok PostgreSQL Backup Wrapper (Supabase project kftmrjmmympztzztunxf).
 * Security: Validates target URL syntax, NOT independent server identity.
 * Reads URL only from QLAOK_DATABASE_URL env; never from CLI args or stdout.
 * Scope: Dumps public and auth schemas. Storage/R2/local files are NOT backed up.
 */
export const REQUIRED_PROJECT_REF = 'kftmrjmmympztzztunxf';

export function redactSecrets(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/(?:postgresql|postgres):\/\/[^:\s]+:[^@\s]+@[^\s"']+/gi, '[REDACTED_DB_URL]')
    .replace(/(password|token|secret|key)=([^\s&"']+)/gi, '$1=[REDACTED]');
}

export function parseBackupArgs(argv = []) {
  let projectRef = '', outputDir = '', outputFile = '';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--project-ref') {
      projectRef = argv[++i] || '';
    } else if (arg.startsWith('--project-ref=')) {
      projectRef = arg.slice(14);
    } else if (arg === '--output-dir') {
      outputDir = argv[++i] || '';
    } else if (arg.startsWith('--output-dir=')) {
      outputDir = arg.slice(13);
    } else if (arg === '--output-file') {
      outputFile = argv[++i] || '';
    } else if (arg.startsWith('--output-file=')) {
      outputFile = arg.slice(14);
    } else if (arg === '--help' || arg === '-h') {
      return { help: true };
    } else if (/^(postgres|postgresql):\/\//i.test(arg) || arg.startsWith('--db') || arg.startsWith('--url')) {
      throw new Error('Database URL must never be passed via CLI arguments.');
    } else {
      // Do not echo unknown option value to avoid leaking accidental secrets
      throw new Error('Unknown option provided. Database credentials and arguments must not be passed via CLI.');
    }
  }
  if (!projectRef) {
    throw new Error(`--project-ref is required and must be exact '${REQUIRED_PROJECT_REF}'.`);
  }
  if (projectRef !== REQUIRED_PROJECT_REF) {
    throw new Error(`--project-ref is required and must be exact '${REQUIRED_PROJECT_REF}'.`);
  }
  return { projectRef, outputDir, outputFile };
}

export function validateDatabaseUrl(rawUrl, expectedRef = REQUIRED_PROJECT_REF) {
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('QLAOK_DATABASE_URL environment variable is required.');
  }
  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error('QLAOK_DATABASE_URL is not a valid URL.');
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error(`Invalid URL protocol: ${url.protocol}. Expected postgresql: or postgres:`);
  }

  const hostname = url.hostname.toLowerCase();
  const directRe = new RegExp(`^db\\.${expectedRef}\\.supabase\\.(co|com)$`, 'i');
  // Official Supabase shared pooler host is aws-<index>-<region>.pooler.supabase.com
  const poolerRe = /^aws-[a-z0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/i;
  const isDirect = directRe.test(hostname);
  const isPooler = poolerRe.test(hostname);

  if (!isDirect && !isPooler) {
    throw new Error(`Host '${hostname}' is not an official Supabase direct/pooler host.`);
  }

  // Reject transaction pooler port 6543; allow direct or session pooler port 5432
  if (url.port === '6543') {
    throw new Error('Transaction pooler port 6543 is not supported for pg_dump. Use direct connection or shared session pooler on port 5432.');
  }
  const port = url.port || '5432';
  if (port !== '5432') {
    throw new Error(`Port '${url.port}' is not supported. pg_dump requires port 5432.`);
  }

  // Require path to be exactly /postgres
  if (url.pathname !== '/postgres') {
    throw new Error(`Database path must be '/postgres'. Received: '${url.pathname}'`);
  }

  // Reject URL fragments/hash
  if (url.hash) {
    throw new Error('Database URL must not contain URL fragments or hash.');
  }

  // Reject unexpected query parameters; permit only safe sslmode
  const safeSslmodes = new Set(['require', 'verify-ca', 'verify-full']);
  for (const key of url.searchParams.keys()) {
    if (key.toLowerCase() !== 'sslmode') {
      throw new Error('Database URL contains unexpected query parameter. Only sslmode is permitted.');
    }
  }
  if (url.searchParams.getAll('sslmode').length > 1) {
    throw new Error('Database URL contains duplicate sslmode query parameter.');
  }
  const sslmodeParam = url.searchParams.get('sslmode');
  if (sslmodeParam && !safeSslmodes.has(sslmodeParam.toLowerCase())) {
    throw new Error('Insecure or unsupported sslmode query parameter. Safe values are require, verify-ca, or verify-full.');
  }
  const sslmode = sslmodeParam ? sslmodeParam.toLowerCase() : 'require';

  const username = decodeURIComponent(url.username || '');
  const password = decodeURIComponent(url.password || '');
  if (!username || !password) {
    throw new Error('Database URL must contain non-empty username and password in userinfo.');
  }
  if (/[\s\0\r\n\t]/.test(username) || /[\0\r\n]/.test(password)) {
    throw new Error('Userinfo contains invalid whitespace or control characters.');
  }
  if (!/^[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)?$/.test(username)) {
    throw new Error('Username contains invalid format or characters.');
  }

  if (isPooler) {
    const parts = username.split('.');
    if (parts.length !== 2 || parts[1] !== expectedRef) {
      throw new Error(`Pooler connection username must include project ref suffix '.${expectedRef}' (e.g. 'postgres.${expectedRef}').`);
    }
  } else if (username.includes('.')) {
    const parts = username.split('.');
    if (parts.length !== 2 || parts[1] !== expectedRef) {
      throw new Error(`Userinfo project ref suffix does not match expected ref '${expectedRef}'.`);
    }
  }

  return {
    url,
    hostname,
    port,
    database: 'postgres',
    username,
    password,
    sslmode,
    isPooler,
    isDirect,
  };
}

export function resolveBackupPath(options, cwd = process.cwd()) {
  let dest;
  if (options.outputFile) {
    dest = path.resolve(cwd, options.outputFile);
  } else {
    const targetDir = path.resolve(cwd, options.outputDir || path.join('.local-db', 'backups'));
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    dest = path.join(targetDir, `qlaok-backup-${options.projectRef}-${timestamp}.dump`);
  }
  const rel = path.relative(cwd, dest);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
    const top = rel.split(path.sep)[0];
    if (!['.local-db', '.backups', '.agy-runs', 'tmp', '.tmp'].includes(top)) {
      throw new Error(`Backup destination must be outside tracked repository files. Received: ${rel}`);
    }
  }
  return dest;
}

export function executeBackup(options, env = process.env, deps = {}) {
  const spawn = deps.spawnSync || spawnSync;
  const fsImpl = deps.fs || fs;
  const cwd = deps.cwd || process.cwd();
  const { projectRef } = options;
  const rawUrl = env.QLAOK_DATABASE_URL;
  const { hostname, port, database, username, password, sslmode } = validateDatabaseUrl(rawUrl, projectRef);
  const dest = resolveBackupPath(options, cwd);
  const destDir = path.dirname(dest);

  fsImpl.mkdirSync(destDir, { recursive: true, mode: 0o700 });
  try {
    fsImpl.chmodSync(destDir, 0o700);
  } catch {
    /* ignore */
  }

  // Atomically create output file exclusively with mode 0600 before pg_dump
  let fileCreated = false;
  try {
    const fd = fsImpl.openSync(dest, 'wx', 0o600);
    if (fd !== undefined && fsImpl.closeSync) {
      fsImpl.closeSync(fd);
    }
    fileCreated = true;
    try {
      fsImpl.chmodSync(dest, 0o600);
    } catch {
      /* ignore */
    }
  } catch (createErr) {
    if (createErr.code === 'EEXIST' || (fsImpl.existsSync && fsImpl.existsSync(dest))) {
      throw new Error(`Backup destination already exists (refusing to overwrite): ${dest}`);
    }
    throw new Error('Failed to exclusively create private backup destination file.');
  }

  try {
    const childEnv = {
      ...env,
      PGDATABASE: database,
      PGHOST: hostname,
      PGPORT: port,
      PGUSER: username,
      PGPASSWORD: password,
      PGSSLMODE: sslmode,
    };
    const dumpArgs = ['--format=custom', '--schema=public', '--schema=auth', `--file=${dest}`];

    const dumpRes = spawn('pg_dump', dumpArgs, { env: childEnv, stdio: ['ignore', 'ignore', 'pipe'] });
    if (dumpRes.error || dumpRes.status !== 0) {
      const exitCode =
        dumpRes.status !== null && dumpRes.status !== undefined
          ? dumpRes.status
          : dumpRes.error?.code || 'error';
      throw new Error(`pg_dump failed with exit code ${exitCode}.`);
    }

    const stat = fsImpl.statSync(dest);
    if (!stat || stat.size === 0) {
      throw new Error('Backup archive is empty (0 bytes).');
    }

    const restoreRes = spawn('pg_restore', ['--list', dest], { stdio: ['ignore', 'pipe', 'pipe'] });
    if (restoreRes.error || restoreRes.status !== 0) {
      const exitCode =
        restoreRes.status !== null && restoreRes.status !== undefined
          ? restoreRes.status
          : restoreRes.error?.code || 'error';
      throw new Error(`pg_restore --list validation failed with exit code ${exitCode}.`);
    }

    const toc = restoreRes.stdout ? restoreRes.stdout.toString('utf8') : '';
    const hasShops = /\bTABLE(?:\s+DATA)?\s+(?:public[\s.]\s*)?shops\b/i.test(toc);
    const hasUsers = /\bTABLE(?:\s+DATA)?\s+(?:auth[\s.]\s*)?users\b/i.test(toc);

    if (!hasShops || !hasUsers) {
      const missing = [];
      if (!hasShops) missing.push('public.shops');
      if (!hasUsers) missing.push('auth.users');
      throw new Error(`Archive validation failed: expected table entry (${missing.join(', ')}) missing from TOC.`);
    }

    return { success: true, path: dest, size: stat.size };
  } catch (err) {
    if (fileCreated && fsImpl.existsSync && fsImpl.existsSync(dest)) {
      try {
        fsImpl.unlinkSync(dest);
      } catch {
        /* ignore */
      }
    }
    throw err;
  }
}

export function runBackupCli(argv = process.argv.slice(2), env = process.env, deps = {}) {
  const args = parseBackupArgs(argv);
  if (args.help) {
    console.log(
      'Usage: QLAOK_DATABASE_URL=... node scripts/backup-qlaok-db.mjs --project-ref kftmrjmmympztzztunxf [--output-dir <dir>] [--output-file <file>]'
    );
    return;
  }
  const result = executeBackup(args, env, deps);
  console.log(`✅ Backup successfully created and verified (${result.size} bytes):\n   ${result.path}`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runBackupCli();
  } catch (err) {
    console.error(`❌ Backup failed: ${redactSecrets(err.message)}`);
    process.exit(1);
  }
}
