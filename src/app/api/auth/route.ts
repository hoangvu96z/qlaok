import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  createSupabasePublicAuthClient,
  ensureSupabaseReadyAndSeeded,
  getSupabaseDbClient,
} from '@/lib/db';
import { isSuperAdminEmail } from '@/lib/auth-session';
import {
  ensureSuperAdminSeeded,
  hashPassword,
  readCredentials,
  verifyPassword,
  writeCredentials,
} from '@/lib/auth-credentials';
import {
  attachSessionCookie,
  clearSessionCookie,
  issueSessionToken,
  verifyRequestUser,
} from '@/lib/server-auth';
import { SEED_PROFILE } from '@/lib/seed-data';
import type { Profile, Shop } from '@/types/qlaok';

export async function GET(req: Request) {
  try {
    const verified = await verifyRequestUser(req);
    if (!verified) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }
    return NextResponse.json({
      authenticated: true,
      session: verified,
    });
  } catch (err) {
    return NextResponse.json(
      {
        authenticated: false,
        error:
          err instanceof Error
            ? err.message
            : 'Lỗi cấu hình xác thực phiên trên máy chủ.',
        code: 'SERVER_AUTH_MISCONFIGURED',
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      action,
      email = '',
      password = '',
      fullName = '',
      phone = '',
      supabaseAccessToken = '',
    } = body as {
      action: 'register' | 'login' | 'demo_login' | 'sync_user' | 'logout';
      email?: string;
      password?: string;
      fullName?: string;
      phone?: string;
      userId?: string;
      supabaseAccessToken?: string;
    };

    if (action === 'logout') {
      const res = NextResponse.json({ success: true });
      return clearSessionCookie(res);
    }

    const normalizedEmail = email.trim().toLowerCase();
    const isAdminUser = isSuperAdminEmail(normalizedEmail);

    // P0 Security Fix: Reject any attempt to register or overwrite the Super Admin account BEFORE DB access
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
      if (isAdminUser) {
        return NextResponse.json(
          {
            error:
              'Email Quản trị hệ thống không thể đăng ký mới hoặc ghi đè mật khẩu qua luồng công khai. Vui lòng sử dụng chức năng Đăng nhập.',
          },
          { status: 403 }
        );
      }
    }

    // P0 Security Fix: Verify token on sync_user BEFORE DB access
    let preVerifiedSyncSession = null;
    if (action === 'sync_user') {
      preVerifiedSyncSession = await verifyRequestUser(req);
      if (!preVerifiedSyncSession && supabaseAccessToken) {
        try {
          const authClient = createSupabasePublicAuthClient();
          const { data: sbUserRes, error: sbErr } =
            await authClient.auth.getUser(supabaseAccessToken);
          if (!sbErr && sbUserRes?.user?.email) {
            const sbEmail = sbUserRes.user.email.trim().toLowerCase();
            preVerifiedSyncSession = {
              sub: sbUserRes.user.id,
              email: sbEmail,
              role: (isSuperAdminEmail(sbEmail) ? 'admin' : 'owner') as
                | 'admin'
                | 'owner',
              iat: Math.floor(Date.now() / 1000),
              exp: Math.floor(Date.now() / 1000) + 3600,
            };
          }
        } catch {
          // ignore
        }
      }

      if (!preVerifiedSyncSession) {
        return NextResponse.json(
          {
            error:
              'Không thể đồng bộ người dùng: Thiếu hoặc sai token xác thực phiên đăng nhập (Unauthorized).',
          },
          { status: 401 }
        );
      }

      if (normalizedEmail && normalizedEmail !== preVerifiedSyncSession.email) {
        return NextResponse.json(
          {
            error:
              'Email yêu cầu đồng bộ không khớp với phiên đăng nhập đã xác thực.',
          },
          { status: 403 }
        );
      }
    }

    await ensureSupabaseReadyAndSeeded();
    const sb = getSupabaseDbClient();

    // 1. Explicit Demo Account Login (non-admin demo shop owner)
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

      const resolvedUser = ((demoProfile as Profile) || SEED_PROFILE) as Profile;
      const accessToken = issueSessionToken({
        id: resolvedUser.id,
        email: resolvedUser.email,
        role: 'owner',
        is_admin: false,
      });

      const res = NextResponse.json({
        user: resolvedUser,
        shops: (demoShops || []) as Shop[],
        isAdmin: false,
        accessToken,
      });
      return attachSessionCookie(res, accessToken);
    }

    // 2. Register New Shop Owner Account
    if (action === 'register') {

      const creds = readCredentials();
      const { data: existingProfiles } = await sb
        .from('profiles')
        .select('*')
        .ilike('email', normalizedEmail)
        .limit(1);

      if (
        (existingProfiles && existingProfiles.length > 0) ||
        Boolean(creds[normalizedEmail])
      ) {
        return NextResponse.json(
          {
            error:
              'Email này đã được đăng ký tài khoản Chủ quán. Vui lòng chuyển sang tab Đăng nhập.',
          },
          { status: 400 }
        );
      }

      let newOwnerId = `owner-${crypto.randomUUID()}`;
      try {
        const authClient = createSupabasePublicAuthClient();
        const signUpRes = await authClient.auth.signUp({
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

      const newProfilePayload = {
        id: newOwnerId,
        email: normalizedEmail,
        full_name: fullName.trim() || normalizedEmail.split('@')[0],
        phone: phone.trim() || undefined,
        plan: 'free' as const,
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

      creds[normalizedEmail] = {
        passwordHash: hashPassword(password),
        profileId: createdProfile.id,
      };
      writeCredentials(creds);

      const finalCreated = createdProfile as Profile;
      const accessToken = issueSessionToken({
        id: finalCreated.id,
        email: finalCreated.email,
        role: 'owner',
        is_admin: false,
      });

      const res = NextResponse.json(
        {
          user: finalCreated,
          shops: [] as Shop[],
          isAdmin: false,
          accessToken,
        },
        { status: 201 }
      );
      return attachSessionCookie(res, accessToken);
    }

    // 3. Login Existing Shop Owner or Super Admin Account
    if (action === 'login') {
      if (!normalizedEmail || !password) {
        return NextResponse.json(
          { error: 'Vui lòng nhập đầy đủ Email và Mật khẩu.' },
          { status: 400 }
        );
      }

      let seededAdminProfile: Profile | null = null;
      if (isAdminUser) {
        seededAdminProfile = await ensureSuperAdminSeeded();
      }

      const { data: matchingProfiles, error: profileLookupErr } = await sb
        .from('profiles')
        .select('*')
        .ilike('email', normalizedEmail)
        .limit(1);

      if (profileLookupErr) {
        return NextResponse.json(
          {
            error: `Không thể truy vấn hồ sơ người dùng từ cơ sở dữ liệu (${profileLookupErr.message}).`,
            code: 'AUTH_PROFILE_QUERY_FAILED',
          },
          { status: 500 }
        );
      }

      let profile: Profile | null =
        (matchingProfiles?.[0] as Profile) || seededAdminProfile || null;

      const creds = readCredentials();
      const storedCred = creds[normalizedEmail];

      if (storedCred) {
        if (!verifyPassword(password, storedCred.passwordHash)) {
          return NextResponse.json(
            { error: 'Mật khẩu không chính xác. Vui lòng kiểm tra lại.' },
            { status: 401 }
          );
        }
        // Automatically upgrade legacy sha256 hash to salted scrypt on successful login
        if (!storedCred.passwordHash.startsWith('scrypt$')) {
          creds[normalizedEmail] = {
            ...storedCred,
            passwordHash: hashPassword(password),
          };
          writeCredentials(creds);
        }
      } else {
        const authClient = createSupabasePublicAuthClient();
        const { data: authData, error: authErr } =
          await authClient.auth.signInWithPassword({
            email: normalizedEmail,
            password,
          });

        if (authErr || !authData?.user) {
          return NextResponse.json(
            { error: 'Email hoặc mật khẩu không chính xác.' },
            { status: 401 }
          );
        }

        if (authData.user && !profile) {
          const nowIso = new Date().toISOString();
          const { data: synced, error: syncErr } = await sb
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
                plan: isAdminUser ? 'premium' : 'free',
                created_at: nowIso,
                updated_at: nowIso,
              },
              { onConflict: 'id' }
            )
            .select('*')
            .single();

          if (syncErr) {
            return NextResponse.json(
              {
                error: `Xác thực thành công nhưng không thể đồng bộ hồ sơ người dùng trong bảng profiles (${syncErr.message}). Kiểm tra SUPABASE_SERVICE_ROLE_KEY và RLS.`,
                code: 'AUTH_PROFILE_SYNC_FAILED',
              },
              { status: 500 }
            );
          }
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

      const finalUser: Profile = isAdminUser
        ? {
            ...profile,
            plan: 'premium',
            is_admin: true,
            role: 'admin',
          }
        : profile;

      const { data: ownerShops, error: shopsLookupErr } = await sb
        .from('shops')
        .select('*')
        .eq('owner_id', profile.id)
        .order('created_at', { ascending: true });

      if (shopsLookupErr) {
        return NextResponse.json(
          {
            error: `Không thể tải danh sách cửa hàng của tài khoản (${shopsLookupErr.message}).`,
            code: 'AUTH_SHOPS_QUERY_FAILED',
          },
          { status: 500 }
        );
      }

      const accessToken = issueSessionToken({
        id: finalUser.id,
        email: finalUser.email,
        role: isAdminUser ? 'admin' : 'owner',
        is_admin: isAdminUser,
      });

      const res = NextResponse.json({
        user: finalUser,
        shops: (ownerShops || []) as Shop[],
        isAdmin: isAdminUser,
        accessToken,
      });
      return attachSessionCookie(res, accessToken);
    }

    // 4. Sync OTP / OAuth User — MUST prove identity via verified token or Supabase JWT
    if (action === 'sync_user') {
      let verifiedSession = preVerifiedSyncSession ?? (await verifyRequestUser(req));

      if (!verifiedSession && supabaseAccessToken) {
        try {
          const authClient = createSupabasePublicAuthClient();
          const { data: sbUserRes, error: sbErr } =
            await authClient.auth.getUser(supabaseAccessToken);
          if (!sbErr && sbUserRes?.user?.email) {
            const sbEmail = sbUserRes.user.email.trim().toLowerCase();
            verifiedSession = {
              sub: sbUserRes.user.id,
              email: sbEmail,
              role: isSuperAdminEmail(sbEmail) ? 'admin' : 'owner',
              iat: Math.floor(Date.now() / 1000),
              exp: Math.floor(Date.now() / 1000) + 3600,
            };
          }
        } catch {
          // ignore
        }
      }

      if (!verifiedSession) {
        return NextResponse.json(
          {
            error:
              'Không thể đồng bộ người dùng: Thiếu hoặc sai token xác thực phiên đăng nhập (Unauthorized).',
          },
          { status: 401 }
        );
      }

      // If caller passed an email in body, it must match the verified token's email
      if (normalizedEmail && normalizedEmail !== verifiedSession.email) {
        return NextResponse.json(
          {
            error:
              'Email yêu cầu đồng bộ không khớp với phiên đăng nhập đã xác thực.',
          },
          { status: 403 }
        );
      }

      const verifiedEmail = verifiedSession.email;
      const verifiedIsAdmin = isSuperAdminEmail(verifiedEmail);

      const { data: existing } = await sb
        .from('profiles')
        .select('*')
        .ilike('email', verifiedEmail)
        .maybeSingle();

      let profile: Profile | null = (existing as Profile) || null;
      if (!profile) {
        const nowIso = new Date().toISOString();
        const { data: created } = await sb
          .from('profiles')
          .upsert(
            {
              id: verifiedSession.sub || `owner-${crypto.randomUUID()}`,
              email: verifiedEmail,
              full_name: fullName || verifiedEmail.split('@')[0],
              phone: phone || null,
              plan: verifiedIsAdmin ? 'premium' : 'free',
              created_at: nowIso,
              updated_at: nowIso,
            },
            { onConflict: 'id' }
          )
          .select('*')
          .single();
        profile = (created as Profile) || null;
      }

      const finalUser: Profile = verifiedIsAdmin
        ? {
            ...profile!,
            plan: 'premium',
            is_admin: true,
            role: 'admin',
          }
        : profile!;

      const { data: ownerShops } = await sb
        .from('shops')
        .select('*')
        .eq('owner_id', finalUser.id)
        .order('created_at', { ascending: true });

      const accessToken = issueSessionToken({
        id: finalUser.id,
        email: finalUser.email,
        role: verifiedIsAdmin ? 'admin' : 'owner',
        is_admin: verifiedIsAdmin,
      });

      const res = NextResponse.json({
        user: finalUser,
        shops: (ownerShops || []) as Shop[],
        isAdmin: verifiedIsAdmin,
        accessToken,
      });
      return attachSessionCookie(res, accessToken);
    }

    return NextResponse.json({ error: 'Invalid auth action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Lỗi xử lý xác thực tài khoản',
      },
      { status: 500 }
    );
  }
}
