import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  dbCompletePaymentWebhook,
  dbDeleteShopSlugAliases,
  dbUpdateShop,
  ensureSupabaseReadyAndSeeded,
  requireSupabaseServiceRoleClient,
  shouldAutoSeedDemoData,
} from '@/lib/db';
import {
  isSuperAdminEmail,
} from '@/lib/auth-session';
import {
  ensureSuperAdminSeeded,
} from '@/lib/auth-credentials';
import {
  dbGetAllOrders,
  dbGetOrderById,
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
  recordOrderAuditLog,
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
        demoReseedAllowed: shouldAutoSeedDemoData(),
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

    if (action === 'reset_owner_password') {
      return NextResponse.json(
        {
          error:
            'Mật khẩu Chủ quán được quản lý qua Zitadel. Hãy dùng mục Quên mật khẩu tại trang đăng nhập Qlaok.',
          code: 'OWNER_PASSWORD_RESET_VIA_OIDC',
        },
        { status: 410 }
      );
    }

    const recordSuccessfulAudit = () =>
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

    if (action === 'reseed_demo_data' && !shouldAutoSeedDemoData()) {
      return NextResponse.json(
        {
          error:
            'Không được phép khôi phục dữ liệu mẫu (SEED_SHOPS) trên môi trường Production để bảo vệ dữ liệu thật.',
          code: 'DEMO_RESEED_FORBIDDEN_IN_PRODUCTION',
        },
        { status: 403 }
      );
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

      await recordSuccessfulAudit();
      return NextResponse.json({ owner: data });
    }

    // 2. Create New Shop Owner Account from Admin
    if (action === 'create_owner') {
      const {
        email = '',
        fullName = '',
        phone = '',
        plan = 'free',
      } = body as {
        email: string;
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

      await recordSuccessfulAudit();
      return NextResponse.json({ owner: created }, { status: 201 });
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
        await dbDeleteShopSlugAliases(s.id, sb);
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

      await recordSuccessfulAudit();
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

      try {
        const updatedShop = await dbUpdateShop(shopId, patch, {
          allowOwnerIdPatch: true,
          sbClient: sb,
          skipEnsureSeeded: true,
        });
        await recordSuccessfulAudit();
        return NextResponse.json({ shop: updatedShop });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: message }, { status: 400 });
      }
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

      await dbDeleteShopSlugAliases(shopId, sb);
      await recordSuccessfulAudit();
      return NextResponse.json({ ok: true });
    }

    // 7. Approve Pending Payment Transaction (VietQR)
    if (action === 'approve_transaction') {
      const { orderCode, bankRefId, amount, transferAmount } = body as {
        orderCode: string;
        bankRefId?: string;
        amount?: unknown;
        transferAmount?: unknown;
      };
      if (!orderCode) {
        return NextResponse.json(
          { error: 'Thiếu mã giao dịch orderCode' },
          { status: 400 }
        );
      }

      const rawAmount =
        transferAmount !== undefined ? transferAmount : amount;

      if (rawAmount === undefined || rawAmount === null) {
        return NextResponse.json(
          {
            error: 'Thiếu số tiền thanh toán (transferAmount hoặc amount).',
            code: 'PAYMENT_AMOUNT_REQUIRED',
          },
          { status: 400 }
        );
      }

      let parsedAmount: number | null = null;
      if (typeof rawAmount === 'number') {
        parsedAmount = rawAmount;
      } else if (typeof rawAmount === 'string' && rawAmount.trim() !== '') {
        parsedAmount = Number(rawAmount.trim());
      }

      if (
        parsedAmount === null ||
        !Number.isFinite(parsedAmount) ||
        parsedAmount <= 0
      ) {
        return NextResponse.json(
          {
            error:
              'Số tiền thanh toán không hợp lệ (phải là số dương lớn hơn 0).',
            code: 'INVALID_PAYMENT_AMOUNT',
          },
          { status: 400 }
        );
      }

      const result = await dbCompletePaymentWebhook(
        orderCode,
        bankRefId || `ADMIN-APPROVED-${Date.now()}`,
        {
          verifiedTransferAmount: parsedAmount,
          allowUnverifiedAmount: false,
        }
      );
      await recordSuccessfulAudit();
      return NextResponse.json({ ok: true, result });
    }

    // 8. Update Global mPOS Order Status
    if (action === 'update_order_status') {
      const {
        orderId,
        status,
        payment_method,
        payment_status,
        refund_reason,
        cancelled_reason,
      } = body as {
        orderId: string;
        status?: OrderStatus;
        payment_method?: PaymentMethod;
        payment_status?: 'unpaid' | 'paid' | 'refunded';
        refund_reason?: string;
        cancelled_reason?: string;
      };
      if (!orderId) {
        return NextResponse.json({ error: 'Thiếu orderId' }, { status: 400 });
      }

      if (
        payment_status === 'paid' ||
        (payment_status !== undefined &&
          (payment_status !== 'refunded' || status !== 'cancelled'))
      ) {
        return NextResponse.json(
          {
            error:
              'Trạng thái thanh toán phải được xác nhận qua giao dịch đã kiểm chứng.',
            code: 'PAYMENT_STATUS_REQUIRES_VERIFIED_TRANSACTION',
          },
          { status: 400 }
        );
      }

      if (status === 'cancelled') {
        const cancelReason =
          typeof cancelled_reason === 'string' ? cancelled_reason.trim() : '';
        const refundReason =
          typeof refund_reason === 'string' ? refund_reason.trim() : '';
        if (!cancelReason) {
          return NextResponse.json(
            { error: 'Vui lòng nhập lý do hủy đơn.', code: 'CANCEL_REASON_REQUIRED' },
            { status: 400 }
          );
        }
        if (cancelReason.length > 500) {
          return NextResponse.json(
            { error: 'Lý do hủy đơn không được vượt quá 500 ký tự.', code: 'REASON_TOO_LONG' },
            { status: 400 }
          );
        }
        if (payment_status === 'refunded' && !refundReason) {
          return NextResponse.json(
            { error: 'Vui lòng nhập lý do hoàn tiền.', code: 'REFUND_REASON_REQUIRED' },
            { status: 400 }
          );
        }
        if (refundReason.length > 500) {
          return NextResponse.json(
            { error: 'Lý do hoàn tiền không được vượt quá 500 ký tự.', code: 'REASON_TOO_LONG' },
            { status: 400 }
          );
        }
      }

      const existingOrder = await dbGetOrderById(orderId);
      const updated = await dbUpdateOrderStatus(orderId, {
        status,
        payment_method,
        payment_status,
        refund_reason,
        cancelled_reason,
      });
      await recordOrderAuditLog({
        shopId: updated.shop_id,
        orderId: updated.id,
        subjectType: 'order',
        actorId: auth.user.sub,
        actorRole: 'admin',
        action: 'admin_update_order_status',
        before: existingOrder
          ? {
              status: existingOrder.status,
              workflow_step_id: existingOrder.workflow_step_id ?? null,
              payment_status: existingOrder.payment_status,
              payment_method: existingOrder.payment_method,
              total_amount: existingOrder.total_amount,
              bill_version: existingOrder.bill_version,
            }
          : null,
        after: {
          status: updated.status,
          workflow_step_id: updated.workflow_step_id ?? null,
          payment_status: updated.payment_status,
          payment_method: updated.payment_method,
          total_amount: updated.total_amount,
          bill_version: updated.bill_version,
          ...(updated.refund_reason
            ? { refund_reason: updated.refund_reason }
            : {}),
          ...(updated.cancelled_reason
            ? { cancelled_reason: updated.cancelled_reason }
            : {}),
        },
        reason:
          updated.refund_reason ||
          updated.cancelled_reason ||
          (typeof refund_reason === 'string' && refund_reason.trim()) ||
          (typeof cancelled_reason === 'string' && cancelled_reason.trim()) ||
          null,
      });
      await recordSuccessfulAudit();
      return NextResponse.json({ order: updated });
    }

    // 9. Re-seed Demo Shops without affecting real user shops (non-production only)
    if (action === 'reseed_demo_data') {
      if (!shouldAutoSeedDemoData()) {
        return NextResponse.json(
          {
            error:
              'Không được phép khôi phục dữ liệu mẫu (SEED_SHOPS) trên môi trường Production để bảo vệ dữ liệu thật.',
            code: 'DEMO_RESEED_FORBIDDEN_IN_PRODUCTION',
          },
          { status: 403 }
        );
      }

      const reseedSteps: Array<{
        table: string;
        run: () => PromiseLike<{ error?: { message?: string } | null }>;
      }> = [
        {
          table: 'profiles',
          run: () =>
            sb.from('profiles').upsert([SEED_PROFILE], { onConflict: 'id' }),
        },
        {
          table: 'shops',
          run: () => sb.from('shops').upsert(SEED_SHOPS, { onConflict: 'id' }),
        },
        {
          table: 'categories',
          run: () =>
            sb.from('categories').upsert(SEED_CATEGORIES, { onConflict: 'id' }),
        },
        {
          table: 'items',
          run: () => sb.from('items').upsert(SEED_ITEMS, { onConflict: 'id' }),
        },
        {
          table: 'posts',
          run: () => sb.from('posts').upsert(SEED_POSTS, { onConflict: 'id' }),
        },
        {
          table: 'payment_transactions',
          run: () =>
            sb
              .from('payment_transactions')
              .upsert(SEED_TRANSACTIONS, { onConflict: 'id' }),
        },
      ];

      for (const step of reseedSteps) {
        const { error: stepErr } = await step.run();
        if (stepErr) {
          return NextResponse.json(
            {
              error: `Lỗi ghi dữ liệu mẫu bảng ${step.table}: ${stepErr.message || 'Ghi thất bại'}`,
              code: 'RESEED_DEMO_DATA_FAILED',
              table: step.table,
            },
            { status: 500 }
          );
        }
      }

      await recordSuccessfulAudit();
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
    const message =
      error instanceof Error
        ? error.message
        : 'Lỗi xử lý thao tác Super Admin';

    let status = 500;
    if (message.startsWith('PAYMENT_ORDER_NOT_FOUND')) {
      status = 404;
    } else if (
      message.startsWith('PAYMENT_ORDER_NOT_PENDING') ||
      message.startsWith('PAID_ORDER_REQUIRES_EXPLICIT_REFUND')
    ) {
      status = 409;
    } else if (
      message.startsWith('PAYMENT_AMOUNT_MISMATCH') ||
      message.startsWith('DUPLICATE_BANK_REF') ||
      message.startsWith('MISSING_ORDER_CODE') ||
      message.startsWith('MISSING_BANK_REF') ||
      message.startsWith('INVALID_PAYMENT_AMOUNT') ||
      message.startsWith('PAYMENT_AMOUNT_REQUIRED') ||
      message.startsWith('REFUND_REASON_REQUIRED') ||
      message.startsWith('CANCEL_REASON_REQUIRED') ||
      message.startsWith('REASON_TOO_LONG') ||
      message.startsWith('FULFILLMENT_CANNOT_COLLECT_PAYMENT')
    ) {
      status = 400;
    }

    return NextResponse.json(
      { error: message },
      { status }
    );
  }
}
