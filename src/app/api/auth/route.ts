import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { ensureSupabaseReadyAndSeeded, getSupabaseDbClient } from '@/lib/db';
import { SEED_PROFILE } from '@/lib/seed-data';
import { Profile, Shop } from '@/types/qlaok';

const STORE_DIR = path.join(process.cwd(), '.local-db');
const CREDENTIALS_FILE = path.join(STORE_DIR, 'auth-credentials.json');

interface CredentialMap {
  [emailLower: string]: {
    passwordHash: string;
    profileId: string;
  };
}

function hashPassword(password: string): string {
  return crypto
    .createHash('sha256')
    .update(`qlaok-salt-v1:${password}`)
    .digest('hex');
}

function readCredentials(): CredentialMap {
  try {
    if (!fs.existsSync(CREDENTIALS_FILE)) {
      return {};
    }
    return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8')) as CredentialMap;
  } catch {
    return {};
  }
}

function writeCredentials(creds: CredentialMap): void {
  try {
    if (!fs.existsSync(STORE_DIR)) {
      fs.mkdirSync(STORE_DIR, { recursive: true });
    }
    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), 'utf8');
  } catch {
    // ignore fs write error
  }
}

export async function POST(req: Request) {
  try {
    await ensureSupabaseReadyAndSeeded();
    const sb = getSupabaseDbClient();
    const body = await req.json();
    const {
      action,
      email = '',
      password = '',
      fullName = '',
      phone = '',
      userId = '',
    } = body as {
      action: 'register' | 'login' | 'demo_login' | 'sync_user';
      email?: string;
      password?: string;
      fullName?: string;
      phone?: string;
      userId?: string;
    };

    const normalizedEmail = email.trim().toLowerCase();

    // 1. Explicit Demo Account Login
    if (
      action === 'demo_login' ||
      (action === 'login' &&
        normalizedEmail === 'chuquan@qlaok.vn' &&
        password === 'qlaok123456')
    ) {
      const [{ data: demoProfile }, { data: demoShops }] = await Promise.all([
        sb.from('profiles').select('*').eq('id', SEED_PROFILE.id).maybeSingle(),
        sb
          .from('shops')
          .select('*')
          .eq('owner_id', SEED_PROFILE.id)
          .order('created_at', { ascending: true }),
      ]);

      return NextResponse.json({
        user: (demoProfile as Profile) || SEED_PROFILE,
        shops: (demoShops || []) as Shop[],
      });
    }

    // 2. Register New Shop Owner Account on Supabase
    if (action === 'register') {
      if (!normalizedEmail || !normalizedEmail.includes('@')) {
        return NextResponse.json(
          { error: 'Vui lòng nhập địa chỉ email hợp lệ.' },
          { status: 400 }
        );
      }
      if (!password || password.length < 6) {
        return NextResponse.json(
          { error: 'Mật khẩu phải có ít nhất 6 ký tự.' },
          { status: 400 }
        );
      }

      const { data: existingProfiles } = await sb
        .from('profiles')
        .select('*')
        .ilike('email', normalizedEmail)
        .limit(1);

      if (existingProfiles && existingProfiles.length > 0) {
        return NextResponse.json(
          {
            error:
              'Email này đã được đăng ký tài khoản Chủ quán. Vui lòng chuyển sang tab Đăng nhập.',
          },
          { status: 400 }
        );
      }

      // Attempt Supabase Auth registration (non-blocking if rate-limited by Supabase free tier)
      let newOwnerId = userId || `owner-${crypto.randomUUID()}`;
      try {
        const signUpRes = await sb.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            data: {
              full_name: fullName.trim() || normalizedEmail.split('@')[0],
              phone: phone.trim(),
            },
          },
        });
        if (signUpRes.data?.user?.id) {
          newOwnerId = signUpRes.data.user.id;
        }
      } catch {
        // Proceed with Supabase public.profiles registration
      }

      const newProfilePayload: Profile = {
        id: newOwnerId,
        email: normalizedEmail,
        full_name: fullName.trim() || normalizedEmail.split('@')[0],
        phone: phone.trim() || undefined,
        plan: 'free',
        plan_expires_at: null,
      };

      const { data: createdProfile, error: insertErr } = await sb
        .from('profiles')
        .upsert(newProfilePayload, { onConflict: 'id' })
        .select('*')
        .single();

      if (insertErr) {
        return NextResponse.json({ error: insertErr.message }, { status: 400 });
      }

      const creds = readCredentials();
      creds[normalizedEmail] = {
        passwordHash: hashPassword(password),
        profileId: createdProfile.id,
      };
      writeCredentials(creds);

      return NextResponse.json(
        {
          user: createdProfile as Profile,
          shops: [] as Shop[],
        },
        { status: 201 }
      );
    }

    // 3. Login Existing Shop Owner Account
    if (action === 'login') {
      if (!normalizedEmail || !password) {
        return NextResponse.json(
          { error: 'Vui lòng nhập đầy đủ Email và Mật khẩu.' },
          { status: 400 }
        );
      }

      const { data: matchingProfiles } = await sb
        .from('profiles')
        .select('*')
        .ilike('email', normalizedEmail)
        .limit(1);

      let profile: Profile | null =
        (matchingProfiles?.[0] as Profile) || null;

      const creds = readCredentials();
      const storedCred = creds[normalizedEmail];

      if (storedCred) {
        if (storedCred.passwordHash !== hashPassword(password)) {
          return NextResponse.json(
            { error: 'Mật khẩu không chính xác. Vui lòng kiểm tra lại.' },
            { status: 401 }
          );
        }
      } else {
        // Verify via Supabase Auth if not in local credential store
        const { data: authData, error: authErr } =
          await sb.auth.signInWithPassword({
            email: normalizedEmail,
            password,
          });

        if (authErr) {
          const msg = authErr.message.toLowerCase();
          if (!profile) {
            return NextResponse.json(
              {
                error:
                  'Email này chưa được đăng ký tài khoản Chủ quán. Vui lòng chọn tab "Đăng ký mới".',
              },
              { status: 401 }
            );
          }
          if (!msg.includes('email not confirmed')) {
            return NextResponse.json(
              { error: 'Email hoặc mật khẩu không chính xác.' },
              { status: 401 }
            );
          }
        }

        if (authData?.user && !profile) {
          const nowIso = new Date().toISOString();
          const { data: synced } = await sb
            .from('profiles')
            .upsert(
              {
                id: authData.user.id,
                email: normalizedEmail,
                full_name:
                  (authData.user.user_metadata?.full_name as string) ||
                  normalizedEmail.split('@')[0],
                phone:
                  (authData.user.user_metadata?.phone as string) || null,
                plan: 'free',
                created_at: nowIso,
                updated_at: nowIso,
              },
              { onConflict: 'id' }
            )
            .select('*')
            .single();
          profile = (synced as Profile) || null;
        }
      }

      if (!profile) {
        return NextResponse.json(
          {
            error:
              'Không tìm thấy tài khoản Chủ quán. Vui lòng chọn tab "Đăng ký mới" để tạo tài khoản.',
          },
          { status: 404 }
        );
      }

      const { data: ownerShops } = await sb
        .from('shops')
        .select('*')
        .eq('owner_id', profile.id)
        .order('created_at', { ascending: true });

      return NextResponse.json({
        user: profile,
        shops: (ownerShops || []) as Shop[],
      });
    }

    // 4. Sync OTP / OAuth User
    if (action === 'sync_user') {
      if (!normalizedEmail) {
        return NextResponse.json({ error: 'Missing email' }, { status: 400 });
      }
      const { data: existing } = await sb
        .from('profiles')
        .select('*')
        .ilike('email', normalizedEmail)
        .maybeSingle();

      let profile: Profile | null = (existing as Profile) || null;
      if (!profile) {
        const nowIso = new Date().toISOString();
        const { data: created } = await sb
          .from('profiles')
          .upsert(
            {
              id: userId || `owner-${crypto.randomUUID()}`,
              email: normalizedEmail,
              full_name: fullName || normalizedEmail.split('@')[0],
              phone: phone || null,
              plan: 'free',
              created_at: nowIso,
              updated_at: nowIso,
            },
            { onConflict: 'id' }
          )
          .select('*')
          .single();
        profile = (created as Profile) || null;
      }

      const { data: ownerShops } = await sb
        .from('shops')
        .select('*')
        .eq('owner_id', profile!.id)
        .order('created_at', { ascending: true });

      return NextResponse.json({
        user: profile,
        shops: (ownerShops || []) as Shop[],
      });
    }

    return NextResponse.json({ error: 'Invalid auth action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Lỗi xử lý xác thực tài khoản',
      },
      { status: 500 }
    );
  }
}
