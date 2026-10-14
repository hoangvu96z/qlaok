import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getSupabaseDbClient } from '@/lib/db';
import {
  SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_ID,
} from '@/lib/auth-session';
import { Profile } from '@/types/qlaok';

const STORE_DIR = path.join(process.cwd(), '.local-db');
const CREDENTIALS_FILE = path.join(STORE_DIR, 'auth-credentials.json');

export interface CredentialMap {
  [emailLower: string]: {
    passwordHash: string;
    profileId: string;
  };
}

export function hashPassword(password: string): string {
  return crypto
    .createHash('sha256')
    .update(`qlaok-salt-v1:${password}`)
    .digest('hex');
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

  // Ensure default credential exists for hoangvu96z@gmail.com if not set yet
  const creds = readCredentials();
  if (!creds[SUPER_ADMIN_EMAIL]) {
    creds[SUPER_ADMIN_EMAIL] = {
      passwordHash: hashPassword('Hoangvu@6496'),
      profileId: adminProfile.id,
    };
    writeCredentials(creds);
  }

  return {
    ...adminProfile,
    plan: 'premium',
    is_admin: true,
    role: 'admin',
  };
}
