import test from 'node:test';
import assert from 'node:assert/strict';
import { GET as getShops, PATCH as patchShops } from '@/app/api/shops/route';
import { setSupabaseDbClientForTests } from '@/lib/db';
import { issueSessionToken } from '@/lib/server-auth';
import {
  ALL_SHOP_PERMISSIONS,
  setShopMembershipDbClientForTest,
} from '@/lib/shop-permissions';
import { getBuiltInOrderWorkflowTemplate } from '@/lib/order-workflow';
import { DEFAULT_SHOP_LABEL_PRINT_CONFIG } from '@/lib/label-print-config';
import { SEED_SHOPS } from '@/lib/seed-data';
import type {
  Profile,
  Shop,
  ShopFlashSaleConfig,
  ShopMembership,
  ShopPopupConfig,
  ShopPromoBannerConfig,
} from '@/types/qlaok';

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createInMemoryShopDbMock(params: {
  initialShops: Shop[];
  profiles: Profile[];
  memberships: ShopMembership[];
}) {
  const shopsById = new Map<string, Shop>(
    params.initialShops.map((shop) => [shop.id, cloneJson(shop)])
  );
  const profilesById = new Map<string, Profile>(
    params.profiles.map((profile) => [profile.id, cloneJson(profile)])
  );
  const memberships = params.memberships.map((m) => cloneJson(m));

  let failNextShopUpdateError: string | null = null;
  let simulateNextShopUpdateMissingRow = false;

  class MockQueryBuilder {
    private table: string;
    private filters: Array<{ op: 'eq' | 'neq'; column: string; value: unknown }> = [];
    private singleMode: 'none' | 'single' | 'maybeSingle' = 'none';
    private limitCount: number | null = null;
    private updatePayload: Record<string, unknown> | null = null;

    constructor(table: string) {
      this.table = table;
    }

    select(_columns = '*') {
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters.push({ op: 'eq', column, value });
      return this;
    }

    neq(column: string, value: unknown) {
      this.filters.push({ op: 'neq', column, value });
      return this;
    }

    order(_column: string, _opts?: { ascending?: boolean }) {
      return this;
    }

    limit(count: number) {
      this.limitCount = count;
      return this;
    }

    single() {
      this.singleMode = 'single';
      return this.execute();
    }

    maybeSingle() {
      this.singleMode = 'maybeSingle';
      return this.execute();
    }

    update(payload: Record<string, unknown>) {
      this.updatePayload = cloneJson(payload);
      return this;
    }

    private matches(row: Record<string, unknown>): boolean {
      return this.filters.every((f) => {
        if (f.op === 'eq') return row[f.column] === f.value;
        if (f.op === 'neq') return row[f.column] !== f.value;
        return true;
      });
    }

    async execute(): Promise<{
      data: unknown;
      error: { message: string; code?: string } | null;
    }> {
      if (this.table === 'shops' && this.updatePayload) {
        if (failNextShopUpdateError) {
          const message = failNextShopUpdateError;
          failNextShopUpdateError = null;
          return { data: null, error: { message, code: 'DB_WRITE_ERROR' } };
        }
        if (simulateNextShopUpdateMissingRow) {
          simulateNextShopUpdateMissingRow = false;
          return { data: null, error: null };
        }

        const matched = Array.from(shopsById.values()).filter((shop) =>
          this.matches(shop as unknown as Record<string, unknown>)
        );
        if (matched.length === 0) {
          return { data: null, error: null };
        }

        const updatedRows: Shop[] = [];
        for (const existing of matched) {
          const nextRow = cloneJson({
            ...existing,
            ...this.updatePayload,
          }) as Shop;
          shopsById.set(nextRow.id, nextRow);
          updatedRows.push(cloneJson(nextRow));
        }

        return {
          data:
            this.singleMode !== 'none'
              ? (updatedRows[0] ?? null)
              : updatedRows,
          error: null,
        };
      }

      let rows: Record<string, unknown>[] = [];
      if (this.table === 'shops') {
        rows = Array.from(shopsById.values()).map(
          (s) => cloneJson(s) as unknown as Record<string, unknown>
        );
      } else if (this.table === 'profiles') {
        rows = Array.from(profilesById.values()).map(
          (p) => cloneJson(p) as unknown as Record<string, unknown>
        );
      } else if (this.table === 'shop_memberships') {
        rows = memberships.map(
          (m) => cloneJson(m) as unknown as Record<string, unknown>
        );
      } else if (this.table === 'shop_slug_aliases') {
        rows = [];
      }

      let filtered = rows.filter((row) => this.matches(row));
      if (typeof this.limitCount === 'number') {
        filtered = filtered.slice(0, this.limitCount);
      }

      if (this.singleMode !== 'none') {
        return { data: filtered[0] ?? null, error: null };
      }
      return { data: filtered, error: null };
    }

    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?:
        | ((value: {
            data: unknown;
            error: { message: string; code?: string } | null;
          }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null
    ): Promise<TResult1 | TResult2> {
      return this.execute().then(onfulfilled, onrejected);
    }
  }

  return {
    client: {
      from(table: string) {
        return new MockQueryBuilder(table);
      },
    },
    setFailNextShopUpdate(message: string | null) {
      failNextShopUpdateError = message;
    },
    setSimulateNextShopUpdateMissingRow(flag: boolean) {
      simulateNextShopUpdateMissingRow = flag;
    },
    getRawShopSnapshot(shopId: string): Shop | undefined {
      const found = shopsById.get(shopId);
      return found ? cloneJson(found) : undefined;
    },
  };
}

test('PATCH /api/shops persists promoBanner, welcomePopup, and flashSale, preserves unrelated theme_config keys on fresh GET reload, and does not report DB failures as success', async () => {
  const ownerId = '11111111-1111-4111-8111-111111111111';
  const promoStaffId = '22222222-2222-4222-8222-222222222222';
  const orderStaffId = '33333333-3333-4333-8333-333333333333';
  const shopId = 'shop-promo-regression-1';

  const initialWorkflow = getBuiltInOrderWorkflowTemplate('counter_bar_serve');
  const initialLabelConfig = cloneJson(DEFAULT_SHOP_LABEL_PRINT_CONFIG);

  const initialShop: Shop = {
    ...cloneJson(SEED_SHOPS[0]),
    id: shopId,
    owner_id: ownerId,
    slug: 'quan-ca-phe-khuyen-mai',
    name: 'Quán Cà Phê Khuyến Mãi',
    is_published: true,
    opening_hours_confirmed: true,
    supported_langs: ['vi', 'en'],
    tagline_i18n: { vi: 'Thơm ngon mỗi ngày', en: 'Fresh every day' },
    description_i18n: { vi: 'Menu chính thức', en: 'Official menu' },
    theme_config: {
      primaryColor: '#1d4ed8',
      layout: 'grid',
      fontStyle: 'modern',
      paymentQr: {
        bankId: 'VCB',
        bankName: 'Vietcombank',
        accountNo: '0123456789',
        accountName: 'NGUYEN VAN A',
        template: 'compact2',
      },
      orderWorkflow: initialWorkflow,
      labelPrintConfig: initialLabelConfig,
      promoBanner: {
        enabled: false,
        title: 'Banner cũ',
        imageUrl: 'https://cdn.qlaok.test/banners/preserved-image.jpg',
        ctaText: 'Đặt món ngay',
      },
    },
  };

  const mockDb = createInMemoryShopDbMock({
    initialShops: [initialShop],
    profiles: [
      {
        id: ownerId,
        email: 'owner@qlaok.test',
        full_name: 'Chủ Quán',
        plan: 'premium',
        role: 'owner',
      },
    ],
    memberships: [
      {
        id: 'mem-owner',
        shop_id: shopId,
        user_id: ownerId,
        role: 'owner',
        permissions: [...ALL_SHOP_PERMISSIONS],
        is_active: true,
        created_at: '2026-10-24T00:00:00.000Z',
        updated_at: '2026-10-24T00:00:00.000Z',
      },
      {
        id: 'mem-promo-staff',
        shop_id: shopId,
        user_id: promoStaffId,
        role: 'cashier',
        permissions: ['orders.view', 'promotions.manage'],
        is_active: true,
        created_at: '2026-10-24T00:00:00.000Z',
        updated_at: '2026-10-24T00:00:00.000Z',
      },
      {
        id: 'mem-order-staff',
        shop_id: shopId,
        user_id: orderStaffId,
        role: 'staff',
        permissions: ['orders.view'],
        is_active: true,
        created_at: '2026-10-24T00:00:00.000Z',
        updated_at: '2026-10-24T00:00:00.000Z',
      },
    ],
  });

  setSupabaseDbClientForTests(mockDb.client);
  setShopMembershipDbClientForTest(mockDb.client as never);

  const ownerToken = issueSessionToken({
    id: ownerId,
    email: 'owner@qlaok.test',
    role: 'owner',
  });
  const promoStaffToken = issueSessionToken({
    id: promoStaffId,
    email: 'promo-staff@qlaok.test',
    role: 'cashier',
  });
  const orderStaffToken = issueSessionToken({
    id: orderStaffId,
    email: 'order-staff@qlaok.test',
    role: 'staff',
  });

  try {
    const nextPromoBanner: ShopPromoBannerConfig = {
      enabled: true,
      badgeText: 'ƯU ĐÃI MÙA THU',
      title: 'Giảm 20% đơn từ 100k',
      subtitle: 'Áp dụng cho nhóm món trà trái cây',
      bgGradient: 'amber_rose',
      discountType: 'percent',
      discountValue: 20,
      minOrderAmount: 100000,
      applyScope: 'selected_items',
      selectedItemIds: ['item-tra-dao', 'item-tra-vai'],
      voucherCode: 'THU20',
      startDate: '2026-10-24',
      endDate: '2026-10-31',
      startTime: '09:00',
      endTime: '21:00',
    };

    const nextWelcomePopup: ShopPopupConfig = {
      enabled: true,
      badgeText: 'QUÀ TẶNG KHÁCH MỚI',
      title: 'Chào mừng bạn đến quán!',
      content: 'Nhập mã THU20 khi thanh toán để nhận ưu đãi 20%.',
      imageUrl: 'https://cdn.qlaok.test/popups/welcome.jpg',
      voucherCode: 'THU20',
      ctaText: 'Lưu mã ngay',
    };

    const nextFlashSale: ShopFlashSaleConfig = {
      enabled: true,
      badgeText: 'GIỜ VÀNG GIẢM SÂU',
      title: 'Flash Sale Trưa Nay',
      discountType: 'fixed_amount',
      discountValue: 15000,
      startDate: '2026-10-24',
      endDate: '2026-10-26',
      startTime: '11:00',
      endTime: '14:00',
      itemIds: ['item-tra-dao'],
      selectedItemIds: ['item-tra-dao'],
    };

    // 1. Staff without promotions.manage cannot update promotion configs
    const forbiddenRes = await patchShops(
      new Request('http://localhost:3000/api/shops', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${orderStaffToken}`,
        },
        body: JSON.stringify({
          id: shopId,
          theme_config: {
            promoBanner: nextPromoBanner,
            welcomePopup: nextWelcomePopup,
            flashSale: nextFlashSale,
          },
        }),
      })
    );
    assert.equal(forbiddenRes.status, 403);
    const forbiddenJson = (await forbiddenRes.json()) as {
      code?: string;
      requiredPermissions?: string[];
    };
    assert.equal(forbiddenJson.code, 'INSUFFICIENT_SHOP_PERMISSION');
    assert.deepEqual(forbiddenJson.requiredPermissions, ['promotions.manage']);

    // 2. Owner saves promoBanner, welcomePopup, and flashSale via PATCH /api/shops
    const saveRes = await patchShops(
      new Request('http://localhost:3000/api/shops', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          id: shopId,
          theme_config: {
            promoBanner: nextPromoBanner,
            welcomePopup: nextWelcomePopup,
            flashSale: nextFlashSale,
          },
        }),
      })
    );
    assert.equal(saveRes.status, 200);

    // 3. Fresh GET reload by shopId reads persisted mock DB state
    const reloadByShopIdRes = await getShops(
      new Request(`http://localhost:3000/api/shops?shopId=${shopId}`, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      })
    );
    assert.equal(reloadByShopIdRes.status, 200);
    const reloadByShopIdJson = (await reloadByShopIdRes.json()) as {
      shop: Shop;
    };
    const reloadedTheme = reloadByShopIdJson.shop.theme_config;
    assert.ok(reloadedTheme);

    // All three promotion configs round-trip, and existing promoBanner.imageUrl & ctaText survive partial merge
    assert.deepEqual(reloadedTheme.promoBanner, {
      ...nextPromoBanner,
      imageUrl: 'https://cdn.qlaok.test/banners/preserved-image.jpg',
      ctaText: 'Đặt món ngay',
    });
    assert.deepEqual(reloadedTheme.welcomePopup, nextWelcomePopup);
    assert.deepEqual(reloadedTheme.flashSale, nextFlashSale);

    // Unrelated theme_config keys survive untouched
    assert.equal(reloadedTheme.primaryColor, '#1d4ed8');
    assert.equal(reloadedTheme.layout, 'grid');
    assert.equal(reloadedTheme.fontStyle, 'modern');
    assert.deepEqual(reloadedTheme.paymentQr, initialShop.theme_config.paymentQr);
    assert.deepEqual(reloadedTheme.orderWorkflow, initialWorkflow);
    assert.deepEqual(reloadedTheme.labelPrintConfig, initialLabelConfig);

    // 4. Fresh GET reload via dashboard bootstrap (member=1) also returns persisted configs
    const reloadMemberRes = await getShops(
      new Request('http://localhost:3000/api/shops?member=1', {
        method: 'GET',
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      })
    );
    assert.equal(reloadMemberRes.status, 200);
    const reloadMemberJson = (await reloadMemberRes.json()) as {
      shops: Shop[];
    };
    assert.equal(reloadMemberJson.shops.length, 1);
    assert.deepEqual(
      reloadMemberJson.shops[0].theme_config.flashSale,
      nextFlashSale
    );
    assert.deepEqual(
      reloadMemberJson.shops[0].theme_config.welcomePopup,
      nextWelcomePopup
    );
    assert.deepEqual(reloadMemberJson.shops[0].theme_config.promoBanner, {
      ...nextPromoBanner,
      imageUrl: 'https://cdn.qlaok.test/banners/preserved-image.jpg',
      ctaText: 'Đặt món ngay',
    });

    // 5. Staff with promotions.manage can update flashSale without dropping promoBanner or welcomePopup
    const updatedFlashSale: ShopFlashSaleConfig = {
      ...nextFlashSale,
      discountType: 'percent',
      discountValue: 30,
      itemIds: ['item-tra-dao', 'item-ca-phe-sua'],
      selectedItemIds: ['item-tra-dao', 'item-ca-phe-sua'],
    };
    const staffPatchRes = await patchShops(
      new Request('http://localhost:3000/api/shops', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${promoStaffToken}`,
        },
        body: JSON.stringify({
          id: shopId,
          theme_config: {
            flashSale: updatedFlashSale,
          },
        }),
      })
    );
    assert.equal(staffPatchRes.status, 200);

    const afterStaffReloadRes = await getShops(
      new Request(`http://localhost:3000/api/shops?shopId=${shopId}`, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${promoStaffToken}`,
        },
      })
    );
    assert.equal(afterStaffReloadRes.status, 200);
    const afterStaffReloadJson = (await afterStaffReloadRes.json()) as {
      shop: Shop;
    };
    assert.deepEqual(
      afterStaffReloadJson.shop.theme_config.flashSale,
      updatedFlashSale
    );
    assert.deepEqual(
      afterStaffReloadJson.shop.theme_config.welcomePopup,
      nextWelcomePopup
    );
    assert.deepEqual(afterStaffReloadJson.shop.theme_config.promoBanner, {
      ...nextPromoBanner,
      imageUrl: 'https://cdn.qlaok.test/banners/preserved-image.jpg',
      ctaText: 'Đặt món ngay',
    });
    assert.equal(afterStaffReloadJson.shop.theme_config.primaryColor, '#1d4ed8');

    // 6. DB write error must not be reported as success and must not corrupt persisted state
    mockDb.setFailNextShopUpdate('SIMULATED_DB_WRITE_FAILURE');
    const dbErrRes = await patchShops(
      new Request('http://localhost:3000/api/shops', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          id: shopId,
          theme_config: {
            flashSale: {
              ...updatedFlashSale,
              discountValue: 99,
              title: 'Không được lưu khi DB lỗi',
            },
          },
        }),
      })
    );
    assert.equal(dbErrRes.status, 400);
    const dbErrJson = (await dbErrRes.json()) as { error?: string };
    assert.match(String(dbErrJson.error || ''), /SIMULATED_DB_WRITE_FAILURE/);

    const afterErrorReloadRes = await getShops(
      new Request(`http://localhost:3000/api/shops?shopId=${shopId}`, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      })
    );
    assert.equal(afterErrorReloadRes.status, 200);
    const afterErrorReloadJson = (await afterErrorReloadRes.json()) as {
      shop: Shop;
    };
    assert.deepEqual(
      afterErrorReloadJson.shop.theme_config.flashSale,
      updatedFlashSale
    );

    // 7. Missing update row from DB (null return) is reported as 404, not 200 success
    mockDb.setSimulateNextShopUpdateMissingRow(true);
    const missingRowRes = await patchShops(
      new Request('http://localhost:3000/api/shops', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          id: shopId,
          theme_config: {
            welcomePopup: {
              ...nextWelcomePopup,
              title: 'Không được báo thành công khi thiếu dòng',
            },
          },
        }),
      })
    );
    assert.equal(missingRowRes.status, 404);
    const missingRowJson = (await missingRowRes.json()) as { error?: string };
    assert.equal(missingRowJson.error, 'Shop not found');
  } finally {
    setSupabaseDbClientForTests(null);
    setShopMembershipDbClientForTest(null);
  }
});
