import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  dbCompletePaymentWebhook,
  ensureSupabaseReadyAndSeeded,
  requireSupabaseServiceRoleClient,
} from '@/lib/db';
import {
  isSuperAdminEmail,
} from '@/lib/auth-session';
import {
  ensureSuperAdminSeeded,
  hashPassword,
  readCredentials,
  writeCredentials,
} from '@/lib/auth-credentials';
import {
  dbGetAllOrders,
  dbUpdateOrderStatus,
  enrichItemsWithInventory,
  getVietnamDateKey,
} from '@/lib/mpos-store';
import {
  SEED_CATEGORIES,
  SEED_ITEMS,
  SEED_POSTS,
  SEED_PROFILE,
  SEED_SHOPS,
  SEED_TRANSACTIONS,
} from '@/lib/seed-data';
import type {
  AnalyticsEvent,
  CatalogItem,
  Category,
  OrderStatus,
  PaymentMethod,
  PaymentTransaction,
  PlanTier,
  Post,
  Profile,
  Shop,
  SupportedLocale,
} from '@/types/qlaok';

import {
  recordAdminAuditLog,
  requireSuperAdmin,
} from '@/lib/server-auth';

export async function GET(req: Request) {
  try {
    const auth = await requireSuperAdmin(req);
    if (auth.errorResponse) {
      return auth.errorResponse;
    }

    const sb = requireSupabaseServiceRoleClient(
      'Super Admin API (/api/admin)'
    );
    const readyStatus = await ensureSupabaseReadyAndSeeded();
    if (!readyStatus.ready) {
      return NextResponse.json(
        {
          error: `Không thể kết nối hoặc khởi tạo cơ sở dữ liệu Supabase (${readyStatus.error || 'UNKNOWN'}).`,
          code: 'SUPABASE_NOT_READY',
        },
        { status: 503 }
      );
    }

    const adminProfile = await ensureSuperAdminSeeded();

    const [
      profilesRes,
      shopsRes,
      categoriesRes,
      itemsRes,
      postsRes,
      eventsRes,
      transactionsRes,
      allOrders,
    ] = await Promise.all([
      sb.from('profiles').select('*').order('created_at', { ascending: false }),
      sb.from('shops').select('*').order('created_at', { ascending: false }),
      sb.from('categories').select('*'),
      sb.from('items').select('*'),
      sb.from('posts').select('*'),
      sb
        .from('analytics_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1000),
      sb
        .from('payment_transactions')
        .select('*')
        .order('created_at', { ascending: false }),
      dbGetAllOrders(),
    ]);

    const queryChecks: Array<[string, { message?: string } | null | undefined]> = [
      ['profiles', profilesRes.error],
      ['shops', shopsRes.error],
      ['categories', categoriesRes.error],
      ['items', itemsRes.error],
      ['posts', postsRes.error],
      ['analytics_events', eventsRes.error],
      ['payment_transactions', transactionsRes.error],
    ];
    for (const [tableName, queryErr] of queryChecks) {
      if (queryErr) {
        return NextResponse.json(
          {
            error: `Lỗi truy vấn bảng dữ liệu quản trị (${tableName}): ${queryErr.message || 'Truy vấn bị từ chối'}`,
            code: 'ADMIN_DB_QUERY_FAILED',
            table: tableName,
          },
          { status: 500 }
        );
      }
    }

    const profilesData = profilesRes.data;
    const shopsData = shopsRes.data;
    const categoriesData = categoriesRes.data;
    const itemsData = itemsRes.data;
    const postsData = postsRes.data;
    const eventsData = eventsRes.data;
    const transactionsData = transactionsRes.data;

    const profiles = ((profilesData || []) as Profile[]).map((p) =>
      isSuperAdminEmail(p.email)
        ? { ...p, is_admin: true, role: 'admin' as const, plan: 'premium' as const }
        : { ...p, is_admin: false, role: 'owner' as const }
    );
    const shops = (shopsData || []) as Shop[];
    const categories = (categoriesData || []) as Category[];
    const rawItems = ((itemsData || []) as CatalogItem[]).map((i) => ({
      ...i,
      price: Number(i.price || 0),
    }));
    const items = enrichItemsWithInventory(rawItems);
    const posts = (postsData || []) as Post[];
    const events = (eventsData || []) as AnalyticsEvent[];
    const transactions = ((transactionsData || []) as PaymentTransaction[]).map(
      (t) => ({
        ...t,
        amount: Number(t.amount || 0),
      })
    );

    // Build lookup maps
    const profileMap = new Map<string, Profile>();
    for (const p of profiles) {
      profileMap.set(p.id, p);
    }

    const shopMap = new Map<string, Shop>();
    for (const s of shops) {
      shopMap.set(s.id, s);
    }

    // 1. Enriched Owners
    const enrichedOwners = profiles.map((p) => {
      const ownerShops = shops.filter((s) => s.owner_id === p.id);
      const ownerTxs = transactions.filter(
        (t) => t.user_id === p.id && t.status === 'completed'
      );
      const totalSpentSaas = ownerTxs.reduce((sum, t) => sum + t.amount, 0);
      return {
        ...p,
        shopsCount: ownerShops.length,
        shops: ownerShops.map((s) => ({
          id: s.id,
          name: s.name,
          slug: s.slug,
          vertical: s.vertical,
        })),
        totalSpentSaas,
      };
    });

    // 2. Enriched Shops
    const enrichedShops = shops.map((s) => {
      const owner = profileMap.get(s.owner_id);
      const shopCats = categories.filter((c) => c.shop_id === s.id);
      const shopItems = items.filter((i) => i.shop_id === s.id);
      const shopOrders = allOrders.filter(
        (o) => o.shop_id === s.id && o.status !== 'cancelled'
      );
      const shopGmv = shopOrders.reduce(
        (sum, o) => sum + Number(o.total_amount || 0),
        0
      );
      const shopEvents = events.filter((e) => e.shop_id === s.id);
      const qrScansCount = shopEvents.filter(
        (e) => e.event_type === 'scan_door' || e.event_type === 'scan_table'
      ).length;

      return {
        ...s,
        is_published: s.is_published ?? true,
        ownerEmail: owner?.email || 'Chưa gán',
        ownerName: owner?.full_name || 'Chủ quán',
        ownerPlan: owner?.plan || 'free',
        categoriesCount: shopCats.length,
        itemsCount: shopItems.length,
        ordersCount: shopOrders.length,
        shopGmv,
        qrScansCount,
      };
    });

    // 3. Enriched Global mPOS Orders
    const enrichedOrders = allOrders.map((o) => {
      const shop = shopMap.get(o.shop_id);
      return {
        ...o,
        shopName: shop?.name || o.shop_id,
        shopSlug: shop?.slug || '',
        shopVertical: shop?.vertical || 'fnb',
      };
    });

    // 4. Enriched SaaS Billing Transactions
    const enrichedTransactions = transactions.map((t) => {
      const owner = profileMap.get(t.user_id);
      return {
        ...t,
        ownerEmail: owner?.email || t.user_id,
        ownerName: owner?.full_name || 'Chủ quán',
      };
    });

    // 5. Executive KPIs
    const planBreakdown = {
      free: profiles.filter((p) => p.plan === 'free').length,
      basic: profiles.filter((p) => p.plan === 'basic').length,
      premium: profiles.filter((p) => p.plan === 'premium').length,
    };

    const estimatedMrr =
      planBreakdown.basic * 39000 + planBreakdown.premium * 69000;
    const totalSaasRevenue = transactions
      .filter((t) => t.status === 'completed')
      .reduce((sum, t) => sum + t.amount, 0);
    const pendingTransactionsCount = transactions.filter(
      (t) => t.status === 'pending'
    ).length;

    const verticalBreakdown = {
      fnb: shops.filter((s) => s.vertical === 'fnb').length,
      service: shops.filter((s) => s.vertical === 'service').length,
      retail: shops.filter((s) => s.vertical === 'retail').length,
    };

    const todayVnKey = getVietnamDateKey();
    const validOrders = allOrders.filter((o) => o.status !== 'cancelled');
    const globalMposGmv = validOrders.reduce(
      (sum, o) => sum + Number(o.total_amount || 0),
      0
    );
    const todayMposGmv = validOrders
      .filter((o) => getVietnamDateKey(o.created_at) === todayVnKey)
      .reduce((sum, o) => sum + Number(o.total_amount || 0), 0);

    // Analytics & Language breakdown
    const scanDoorCount = events.filter(
      (e) => e.event_type === 'scan_door'
    ).length;
    const scanTableCount = events.filter(
      (e) => e.event_type === 'scan_table'
    ).length;
    const showToStaffCount = events.filter(
      (e) => e.event_type === 'show_to_staff'
    ).length;
    const wifiCopyCount = events.filter(
      (e) => e.event_type === 'wifi_copy'
    ).length;
    const itemViewCount = events.filter(
      (e) => e.event_type === 'item_view'
    ).length;

    const langCounts: Record<SupportedLocale, number> = {
      vi: 0,
      en: 0,
      ko: 0,
      ja: 0,
      zh: 0,
      es: 0,
      it: 0,
      ru: 0,
    };
    for (const ev of events) {
      if (langCounts[ev.visitor_lang] !== undefined) {
        langCounts[ev.visitor_lang]++;
      }
    }
    const totalLangEvents = events.length || 1;
    const langBreakdown = (Object.keys(langCounts) as SupportedLocale[]).map(
      (lang) => ({
        lang,
        count: langCounts[lang],
        percentage: Math.round((langCounts[lang] / totalLangEvents) * 100),
      })
    );

    const lowStockItems = items
      .filter(
        (i) =>
          i.stock_quantity !== null &&
          i.stock_quantity !== undefined &&
          i.stock_quantity <= 5
      )
      .map((i) => ({
        ...i,
        shopName: shopMap.get(i.shop_id)?.name || i.shop_id,
      }));

    return NextResponse.json({
      adminProfile,
      kpis: {
        totalOwners: profiles.length,
        planBreakdown,
        estimatedMrr,
        totalSaasRevenue,
        pendingTransactionsCount,
        totalShops: shops.length,
        publishedShopsCount: shops.filter((s) => s.is_published !== false)
          .length,
        hiddenShopsCount: shops.filter((s) => s.is_published === false).length,
        verticalBreakdown,
        totalCategories: categories.length,
        totalItems: items.length,
        totalPosts: posts.length,
        totalOrders: allOrders.length,
        newOrdersCount: allOrders.filter((o) => o.status === 'new').length,
        preparingOrdersCount: allOrders.filter((o) => o.status === 'preparing')
          .length,
        completedOrdersCount: allOrders.filter((o) => o.status === 'completed')
          .length,
        cancelledOrdersCount: allOrders.filter((o) => o.status === 'cancelled')
          .length,
        globalMposGmv,
        todayMposGmv,
        totalQrScans: scanDoorCount + scanTableCount,
        scanDoorCount,
        scanTableCount,
        showToStaffCount,
        wifiCopyCount,
        itemViewCount,
        langBreakdown,
      },
      owners: enrichedOwners,
      shops: enrichedShops,
      orders: enrichedOrders,
      transactions: enrichedTransactions,
      lowStockItems,
      recentEvents: events.slice(0, 25).map((ev) => ({
        ...ev,
        shopName: shopMap.get(ev.shop_id)?.name || ev.shop_id,
      })),
      systemHealth: {
        supabaseConnected: true,
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        aiGatewayUrl: process.env.AI_BASE_URL || 'https://vunph.click/v1',
        aiTextModel: process.env.AI_MODEL || 'combo1',
        aiVisionModel: process.env.AI_VISION_MODEL || 'combo2',
        r2Configured: Boolean(process.env.R2_ACCOUNT_ID),
        tableCounts: {
          profiles: profiles.length,
          shops: shops.length,
          categories: categories.length,
          items: items.length,
          posts: posts.length,
          analytics_events: events.length,
          payment_transactions: transactions.length,
          mpos_orders: allOrders.length,
        },
        serverTime: new Date().toISOString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Lỗi tải dữ liệu Super Admin',
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireSuperAdmin(req);
    if (auth.errorResponse) {
      return auth.errorResponse;
    }

    const body = await req.json();
    const { action } = body;

    recordAdminAuditLog({
      actorId: auth.user.sub,
      actorEmail: auth.user.email,
      action: String(action || 'unknown'),
      targetId: body.ownerId || body.shopId || body.orderId || body.orderCode,
      details: {
        plan: body.plan,
        email: body.email,
        isPublished: body.isPublished,
      },
    });

    const sb = requireSupabaseServiceRoleClient(
      'Super Admin API (/api/admin)'
    );
    const readyStatus = await ensureSupabaseReadyAndSeeded();
    if (!readyStatus.ready) {
      return NextResponse.json(
        {
          error: `Không thể kết nối hoặc khởi tạo cơ sở dữ liệu Supabase (${readyStatus.error || 'UNKNOWN'}).`,
          code: 'SUPABASE_NOT_READY',
        },
        { status: 503 }
      );
    }

    // 1. Update Owner Plan / Details
    if (action === 'update_owner_plan') {
      const {
        ownerId,
        plan,
        durationDays = 30,
        fullName,
        phone,
      } = body as {
        ownerId: string;
        plan: PlanTier;
        durationDays?: number;
        fullName?: string;
        phone?: string;
      };

      if (!ownerId || !plan) {
        return NextResponse.json(
          { error: 'Thiếu ownerId hoặc gói cước.' },
          { status: 400 }
        );
      }

      let expiresAt: string | null = null;
      if (plan !== 'free' && durationDays > 0) {
        const exp = new Date();
        exp.setDate(exp.getDate() + durationDays);
        expiresAt = exp.toISOString();
      }

      const updatePayload: Record<string, unknown> = {
        plan,
        plan_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      };
      if (fullName !== undefined) updatePayload.full_name = fullName;
      if (phone !== undefined) updatePayload.phone = phone;

      const { data, error } = await sb
        .from('profiles')
        .update(updatePayload)
        .eq('id', ownerId)
        .select('*')
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      return NextResponse.json({ owner: data });
    }

    // 2. Create New Shop Owner Account from Admin
    if (action === 'create_owner') {
      const {
        email = '',
        password = '',
        fullName = '',
        phone = '',
        plan = 'free',
      } = body as {
        email: string;
        password?: string;
        fullName?: string;
        phone?: string;
        plan?: PlanTier;
      };

      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail || !normalizedEmail.includes('@')) {
        return NextResponse.json(
          { error: 'Email không hợp lệ.' },
          { status: 400 }
        );
      }

      const finalPassword =
        password && password.length >= 6 ? password : 'qlaok123456';
      const newOwnerId = `owner-${crypto.randomUUID()}`;

      let expiresAt: string | null = null;
      if (plan !== 'free') {
        const exp = new Date();
        exp.setDate(exp.getDate() + 30);
        expiresAt = exp.toISOString();
      }

      const { data: created, error } = await sb
        .from('profiles')
        .upsert(
          {
            id: newOwnerId,
            email: normalizedEmail,
            full_name: fullName.trim() || normalizedEmail.split('@')[0],
            phone: phone.trim() || null,
            plan,
            plan_expires_at: expiresAt,
          },
          { onConflict: 'id' }
        )
        .select('*')
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      const creds = readCredentials();
      creds[normalizedEmail] = {
        passwordHash: hashPassword(finalPassword),
        profileId: created.id,
      };
      writeCredentials(creds);

      return NextResponse.json({ owner: created }, { status: 201 });
    }

    // 3. Reset Owner Password from Admin
    if (action === 'reset_owner_password') {
      const { ownerId, email, newPassword } = body as {
        ownerId: string;
        email: string;
        newPassword: string;
      };
      if (!email || !newPassword || newPassword.length < 6) {
        return NextResponse.json(
          { error: 'Mật khẩu mới phải từ 6 ký tự trở lên.' },
          { status: 400 }
        );
      }
      const normalizedEmail = email.trim().toLowerCase();
      const creds = readCredentials();
      creds[normalizedEmail] = {
        passwordHash: hashPassword(newPassword),
        profileId: ownerId,
      };
      writeCredentials(creds);
      return NextResponse.json({ ok: true });
    }

    // 4. Delete Owner Account
    if (action === 'delete_owner') {
      const { ownerId, email } = body as { ownerId: string; email?: string };
      if (!ownerId) {
        return NextResponse.json({ error: 'Thiếu ownerId' }, { status: 400 });
      }
      if (isSuperAdminEmail(email)) {
        return NextResponse.json(
          { error: 'Không thể xóa tài khoản Super Admin tối cao!' },
          { status: 400 }
        );
      }

      // Delete shops belonging to this owner first
      const { data: ownerShops } = await sb
        .from('shops')
        .select('id')
        .eq('owner_id', ownerId);

      for (const s of ownerShops || []) {
        await sb.from('analytics_events').delete().eq('shop_id', s.id);
        await sb.from('posts').delete().eq('shop_id', s.id);
        await sb.from('items').delete().eq('shop_id', s.id);
        await sb.from('categories').delete().eq('shop_id', s.id);
        await sb.from('shops').delete().eq('id', s.id);
      }

      await sb.from('payment_transactions').delete().eq('user_id', ownerId);
      const { error } = await sb.from('profiles').delete().eq('id', ownerId);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      if (email) {
        const creds = readCredentials();
        delete creds[email.trim().toLowerCase()];
        writeCredentials(creds);
      }

      return NextResponse.json({ ok: true });
    }

    // 5. Toggle Shop Published or Update Shop Owner/Metadata
    if (action === 'update_shop') {
      const { shopId, patch } = body as {
        shopId: string;
        patch: Partial<Shop>;
      };
      if (!shopId || !patch) {
        return NextResponse.json(
          { error: 'Thiếu shopId hoặc patch' },
          { status: 400 }
        );
      }

      const { data, error } = await sb
        .from('shops')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', shopId)
        .select('*')
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ shop: data });
    }

    // 6. Delete Shop
    if (action === 'delete_shop') {
      const { shopId } = body as { shopId: string };
      if (!shopId) {
        return NextResponse.json({ error: 'Thiếu shopId' }, { status: 400 });
      }

      await sb.from('analytics_events').delete().eq('shop_id', shopId);
      await sb.from('posts').delete().eq('shop_id', shopId);
      await sb.from('items').delete().eq('shop_id', shopId);
      await sb.from('categories').delete().eq('shop_id', shopId);
      const { error } = await sb.from('shops').delete().eq('id', shopId);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    // 7. Approve Pending Payment Transaction (VietQR)
    if (action === 'approve_transaction') {
      const { orderCode, bankRefId, ownerId } = body as {
        orderCode: string;
        bankRefId?: string;
        ownerId?: string;
      };
      if (!orderCode) {
        return NextResponse.json(
          { error: 'Thiếu mã giao dịch orderCode' },
          { status: 400 }
        );
      }

      const result = await dbCompletePaymentWebhook(
        orderCode,
        bankRefId || `ADMIN-APPROVED-${Date.now()}`,
        ownerId
      );
      return NextResponse.json({ ok: true, result });
    }

    // 8. Update Global mPOS Order Status
    if (action === 'update_order_status') {
      const { orderId, status, payment_method, payment_status } = body as {
        orderId: string;
        status?: OrderStatus;
        payment_method?: PaymentMethod;
        payment_status?: 'unpaid' | 'paid';
      };
      if (!orderId) {
        return NextResponse.json({ error: 'Thiếu orderId' }, { status: 400 });
      }
      const updated = await dbUpdateOrderStatus(orderId, {
        status,
        payment_method,
        payment_status,
      });
      return NextResponse.json({ order: updated });
    }

    // 9. Re-seed Demo Shops without affecting real user shops
    if (action === 'reseed_demo_data') {
      await sb.from('profiles').upsert([SEED_PROFILE], { onConflict: 'id' });
      await sb.from('shops').upsert(SEED_SHOPS, { onConflict: 'id' });
      await sb.from('categories').upsert(SEED_CATEGORIES, { onConflict: 'id' });
      await sb.from('items').upsert(SEED_ITEMS, { onConflict: 'id' });
      await sb.from('posts').upsert(SEED_POSTS, { onConflict: 'id' });
      await sb
        .from('payment_transactions')
        .upsert(SEED_TRANSACTIONS, { onConflict: 'id' });

      return NextResponse.json({
        ok: true,
        message: 'Đã đồng bộ lại dữ liệu mẫu 3 cửa hàng Demo thành công.',
      });
    }

    return NextResponse.json(
      { error: 'Hành động Admin không hợp lệ.' },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Lỗi xử lý thao tác Super Admin',
      },
      { status: 500 }
    );
  }
}
