import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getSupabaseDbClient } from '@/lib/db';
import {
  SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_ID,
} from '@/lib/auth-session';
import type { Profile } from '@/types/qlaok';

const STORE_DIR = path.join(process.cwd(), '.local-db');
const CREDENTIALS_FILE = path.join(STORE_DIR, 'auth-credentials.json');

export interface CredentialMap {
  [emailLower: string]: {
    passwordHash: string;
    profileId: string;
  };
}

/**
 * Hashes password using scrypt with a unique random 16-byte salt per password.
 * Format: scrypt$<saltHex>$<derivedKeyHex>
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

/**
 * Verifies a plaintext password against a stored scrypt hash (or legacy sha256 hash)
 * using constant-time comparison (crypto.timingSafeEqual).
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  if (!password || !storedHash) return false;

  if (storedHash.startsWith('scrypt$')) {
    const parts = storedHash.split('$');
    if (parts.length !== 3) return false;
    const [, salt, expectedHex] = parts;
    if (!salt || !expectedHex) return false;
    try {
      const derived = crypto.scryptSync(password, salt, 64);
      const expected = Buffer.from(expectedHex, 'hex');
      if (derived.length !== expected.length) return false;
      return crypto.timingSafeEqual(derived, expected);
    } catch {
      return false;
    }
  }

  // Legacy sha256 compatibility check (constant-time)
  const legacyHash = crypto
    .createHash('sha256')
    .update(`qlaok-salt-v1:${password}`)
    .digest('hex');
  const a = Buffer.from(legacyHash, 'utf8');
  const b = Buffer.from(storedHash, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function readCredentials(): CredentialMap {
  try {
    if (!fs.existsSync(CREDENTIALS_FILE)) {
      return {};
    }
    return JSON.parse(
      fs.readFileSync(CREDENTIALS_FILE, 'utf8')
    ) as CredentialMap;
  } catch {
    return {};
  }
}

export function writeCredentials(creds: CredentialMap): void {
  try {
    if (!fs.existsSync(STORE_DIR)) {
      fs.mkdirSync(STORE_DIR, { recursive: true });
    }
    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), 'utf8');
  } catch {
    // ignore fs write error
  }
}

export async function ensureSuperAdminSeeded(): Promise<Profile> {
  const sb = getSupabaseDbClient();
  const { data: existingList } = await sb
    .from('profiles')
    .select('*')
    .ilike('email', SUPER_ADMIN_EMAIL)
    .limit(1);

  let adminProfile: Profile | null = (existingList?.[0] as Profile) || null;

  if (!adminProfile) {
    const payload = {
      id: SUPER_ADMIN_ID,
      email: SUPER_ADMIN_EMAIL,
      full_name: 'Hoàng Vũ (Super Admin)',
      phone: '0905649696',
      plan: 'premium' as const,
      plan_expires_at: '2030-12-31T23:59:59Z',
    };
    const { data: created } = await sb
      .from('profiles')
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .maybeSingle();

    adminProfile = (created as Profile) || payload;
  } else if (adminProfile.plan !== 'premium') {
    const { data: upgraded } = await sb
      .from('profiles')
      .update({
        plan: 'premium',
        plan_expires_at: '2030-12-31T23:59:59Z',
      })
      .eq('id', adminProfile.id)
      .select('*')
      .maybeSingle();
    if (upgraded) {
      adminProfile = upgraded as Profile;
    }
  }

  // Only seed initial super admin credential if INITIAL_SUPER_ADMIN_PASSWORD is explicitly provided in env
  const envInitialAdminPassword = process.env.INITIAL_SUPER_ADMIN_PASSWORD?.trim();
  if (envInitialAdminPassword) {
    const creds = readCredentials();
    if (!creds[SUPER_ADMIN_EMAIL]) {
      creds[SUPER_ADMIN_EMAIL] = {
        passwordHash: hashPassword(envInitialAdminPassword),
        profileId: adminProfile.id,
      };
      writeCredentials(creds);
    }
  }

  return {
    ...adminProfile,
    plan: 'premium',
    is_admin: true,
    role: 'admin',
  };
}
