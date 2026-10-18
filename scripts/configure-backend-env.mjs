// Receives a masked, base64-encoded GitHub Secret over SSH. Base64 is transport
// encoding only; SSH encrypts the transfer. Never print the decoded secret.
import fs from 'node:fs';
import crypto from 'node:crypto';

const encoded = process.env.QLAOK_SUPABASE_KEY_B64 || '';
const key = Buffer.from(encoded, 'base64').toString('utf8').trim();
let valid = /^sb_secret_[A-Za-z0-9_-]+$/.test(key);
if (!valid && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) {
  try { valid = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'service_role'; } catch { /* reject */ }
}
if (!valid) throw new Error('SUPABASE_SERVICE_ROLE_KEY must contain a backend secret key or service_role JWT.');

const target = '.env.local';
const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
const lines = existing.split(/\r?\n/).filter(line => !/^\s*(?:export\s+)?SUPABASE_SERVICE_ROLE_KEY\s*=/.test(line));
const content = lines.join('\n').replace(/\n*$/, '') + `\nSUPABASE_SERVICE_ROLE_KEY=${JSON.stringify(key)}\n`;
const temporary = `${target}.${crypto.randomUUID()}.tmp`;
try {
  fs.writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, target);
} finally {
  if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
}
console.log('Backend key configured on VPS (value hidden).');
