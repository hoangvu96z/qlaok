import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GET as authGet, POST as authPost } from '../src/app/api/auth/route';
import {
  GET as ordersGet,
  PATCH as ordersPatch,
  POST as ordersPost,
} from '../src/app/api/orders/route';
import {
  GET as shopsGet,
  PATCH as shopsPatch,
  POST as shopsPost,
} from '../src/app/api/shops/route';
import { setSupabaseDbClientForTests } from '../src/lib/db';
import { resolvePostLoginRoute } from '../src/lib/post-login-route';
import { issueSessionToken, verifySessionToken } from '../src/lib/server-auth';
import {
  dbGetShopMemberships,
  setShopMembershipDbClientForTest,
} from '../src/lib/shop-permissions';
import {
  cleanupExpiredStaffLoginRateLimits,
  clearInMemoryStaffCredentialsForTest,
  computeStaffLoginRateLimitKey,
  computeStaffLoginUnknownShopRateLimitKey,
  computeStaffLoginUnknownUserRateLimitKey,
  dbGetShopStaffCredentialByUserId,
  getDummyStaffPasswordVerificationCountForTest,
  setStaffLoginRateLimitClockForTest,
  STAFF_LOGIN_RATE_LIMIT_BLOCK_SECONDS,
  STAFF_LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  STAFF_LOGIN_RATE_LIMIT_RETENTION_SECONDS,
} from '../src/lib/staff-accounts';

const MEMBERSHIPS_FILE = path.join(
  process.cwd(),
  '.local-db',
  'shop-memberships.json'
);
const CREDENTIALS_FILE = path.join(
  process.cwd(),
  '.local-db',
  'auth-credentials.json'
);

function jsonReq(
  url: string,
  method: string,
  body?: unknown,
  token?: string,
  extraHeaders?: Record<string, string>
): Request {
  const headers: Record<string, string> = { ...(extraHeaders || {}) };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return new Request(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

test('shop-scoped staff accounts: create, login without email, per-shop username isolation, role/permission guards, password reset, deactivation, deletion, and owner/email compatibility', async () => {
  const prevLocalMode = process.env.QLAOK_TEST_LOCAL_DB;
  process.env.QLAOK_TEST_LOCAL_DB = '1';

  const hadMemFile = fs.existsSync(MEMBERSHIPS_FILE);
  const prevMemRaw = hadMemFile ? fs.readFileSync(MEMBERSHIPS_FILE, 'utf8') : '';
  const hadCredFile = fs.existsSync(CREDENTIALS_FILE);
  const prevCredRaw = hadCredFile
    ? fs.readFileSync(CREDENTIALS_FILE, 'utf8')
    : '';

  const owner1Token = issueSessionToken({
    id: 'owner-demo-001',
    email: 'chuquan@qlaok.vn',
    role: 'owner',
  });

  try {
    clearInMemoryStaffCredentialsForTest();

    // 1. Owner creates a shop-scoped staff account in shop-fnb-001 without an email
    const createStaffRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'create_staff_member',
          shop_id: 'shop-fnb-001',
          username: '  ThuNgan_CaSang  ',
          password: 'StaffPass#123',
          full_name: 'Nguyễn Thu Ngân Ca Sáng',
          role: 'cashier',
        },
        owner1Token
      )
    );
    assert.equal(createStaffRes.status, 201);
    const createStaffBody = await createStaffRes.json();
    const staff1 = createStaffBody.membership;
    assert.ok(staff1);
    assert.match(staff1.user_id, /^staff-acct-/);
    assert.equal(staff1.shop_id, 'shop-fnb-001');
    assert.equal(staff1.username, 'thungan_casang');
    assert.equal(staff1.account_type, 'staff');
    assert.equal(staff1.email, undefined);
    assert.equal(staff1.role, 'cashier');
    assert.equal(staff1.is_active, true);
    assert.ok(staff1.permissions.includes('orders.view'));
    assert.ok(staff1.permissions.includes('payment.collect'));
    assert.equal(staff1.permissions.includes('members.manage'), false);
    assert.equal('password_hash' in staff1, false);
    assert.equal('password' in staff1, false);

    // Verify no staff password hash is ever written to .local-db
    if (fs.existsSync(MEMBERSHIPS_FILE)) {
      const diskMemContent = fs.readFileSync(MEMBERSHIPS_FILE, 'utf8');
      assert.equal(diskMemContent.includes('StaffPass#123'), false);
      assert.equal(diskMemContent.includes('scrypt$'), false);
    }

    // 2. Duplicate username in the SAME shop fails (case-insensitive)
    const dupSameShopRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'create_staff_member',
          shop_id: 'shop-fnb-001',
          username: 'THUNGAN_CASANG',
          password: 'AnotherPassword#456',
          full_name: 'Trùng Tên Quán 1',
          role: 'staff',
        },
        owner1Token
      )
    );
    assert.equal(dupSameShopRes.status, 409);
    const dupSameShopBody = await dupSameShopRes.json();
    assert.equal(dupSameShopBody.code, 'STAFF_USERNAME_EXISTS');

    // 3. Same username in a SEPARATE shop (shop-service-002) succeeds
    const createShop2StaffRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'create_staff_member',
          shop_id: 'shop-service-002',
          username: 'thungan_casang',
          password: 'Shop2Password#789',
          full_name: 'Thu Ngân Linh Spa & Nail',
          role: 'staff',
        },
        owner1Token
      )
    );
    assert.equal(createShop2StaffRes.status, 201);
    const staff2 = (await createShop2StaffRes.json()).membership;
    assert.equal(staff2.shop_id, 'shop-service-002');
    assert.equal(staff2.username, 'thungan_casang');
    assert.notEqual(staff2.user_id, staff1.user_id);

    // 4. Staff login resolves target shop by slug, shop ID, or full storefront URL
    const loginBySlugRes = await authPost(
      jsonReq('http://localhost:3000/api/auth', 'POST', {
        action: 'staff_login',
        shopIdentifier: 'pho-hoi-an',
        username: 'ThuNgan_CaSang',
        password: 'StaffPass#123',
      })
    );
    assert.equal(loginBySlugRes.status, 200);
    const loginBySlugBody = await loginBySlugRes.json();
    assert.equal(loginBySlugBody.user.id, staff1.user_id);
    assert.equal(loginBySlugBody.user.email, '');
    assert.equal(loginBySlugBody.user.username, 'thungan_casang');
    assert.equal(loginBySlugBody.user.shop_id, 'shop-fnb-001');
    assert.equal(loginBySlugBody.user.account_type, 'staff');
    assert.equal(loginBySlugBody.user.role, 'cashier');
    assert.deepEqual(loginBySlugBody.shops, []);
    assert.equal(loginBySlugBody.memberShops.length, 1);
    assert.equal(loginBySlugBody.memberShops[0].id, 'shop-fnb-001');
    assert.equal(loginBySlugBody.memberships.length, 1);
    assert.equal(loginBySlugBody.memberships[0].shop_id, 'shop-fnb-001');
    assert.equal(loginBySlugBody.activeShopId, 'shop-fnb-001');
    assert.equal(loginBySlugBody.redirectTo, '/dashboard/orders');
    assert.equal(loginBySlugBody.isAdmin, false);
    assert.ok(loginBySlugBody.accessToken);
    assert.match(
      loginBySlugRes.headers.get('set-cookie') || '',
      /qlaok_session=/
    );

    // Verify post-login route helper routes staff to /dashboard/orders, never /onboarding
    assert.deepEqual(resolvePostLoginRoute(loginBySlugBody), {
      path: '/dashboard/orders',
      activeShopId: 'shop-fnb-001',
    });

    // Also login using a full storefront URL and action='login' into shop-service-002
    const loginByLinkRes = await authPost(
      jsonReq('http://localhost:3000/api/auth', 'POST', {
        action: 'login',
        shopIdentifier: 'https://qlaok.vn/s/linh-spa-nail/menu?table=T01',
        username: 'thungan_casang',
        password: 'Shop2Password#789',
      })
    );
    assert.equal(loginByLinkRes.status, 200);
    const loginByLinkBody = await loginByLinkRes.json();
    assert.equal(loginByLinkBody.user.id, staff2.user_id);
    assert.equal(loginByLinkBody.activeShopId, 'shop-service-002');
    assert.equal(loginByLinkBody.memberShops[0].id, 'shop-service-002');

    // Cross-shop password mismatch and unknown username return identical generic 401
    const wrongShopPassRes = await authPost(
      jsonReq('http://localhost:3000/api/auth', 'POST', {
        action: 'staff_login',
        shopIdentifier: 'pho-hoi-an',
        username: 'thungan_casang',
        password: 'Shop2Password#789',
      })
    );
    assert.equal(wrongShopPassRes.status, 401);
    const wrongShopPassBody = await wrongShopPassRes.json();

    const unknownUserRes = await authPost(
      jsonReq('http://localhost:3000/api/auth', 'POST', {
        action: 'staff_login',
        shopIdentifier: 'pho-hoi-an',
        username: 'khong_ton_tai_99',
        password: 'StaffPass#123',
      })
    );
    assert.equal(unknownUserRes.status, 401);
    const unknownUserBody = await unknownUserRes.json();
    assert.equal(wrongShopPassBody.code, 'INVALID_STAFF_CREDENTIALS');
    assert.equal(unknownUserBody.code, 'INVALID_STAFF_CREDENTIALS');
    assert.equal(wrongShopPassBody.error, unknownUserBody.error);

    const staff1Token = loginBySlugBody.accessToken as string;
    const decodedStaff1 = verifySessionToken(staff1Token);
    assert.ok(decodedStaff1);
    assert.equal(decodedStaff1.sub, staff1.user_id);
    assert.equal(decodedStaff1.shop_id, 'shop-fnb-001');
    assert.equal(decodedStaff1.username, 'thungan_casang');
    assert.equal(decodedStaff1.account_type, 'staff');
    assert.equal(decodedStaff1.role, 'cashier');

    // 5. Staff session is bound to one shop: can access shop-fnb-001, denied on shop-service-002
    const ownShopOrdersRes = await ordersGet(
      jsonReq(
        'http://localhost:3000/api/orders?shopId=shop-fnb-001',
        'GET',
        undefined,
        staff1Token
      )
    );
    assert.equal(ownShopOrdersRes.status, 200);

    const otherShopOrdersRes = await ordersGet(
      jsonReq(
        'http://localhost:3000/api/orders?shopId=shop-service-002',
        'GET',
        undefined,
        staff1Token
      )
    );
    assert.equal(otherShopOrdersRes.status, 403);
    const otherShopOrdersBody = await otherShopOrdersRes.json();
    assert.equal(otherShopOrdersBody.code, 'FORBIDDEN_CROSS_SHOP_ACCESS');

    const memberBundleRes = await shopsGet(
      jsonReq(
        'http://localhost:3000/api/shops?member=1',
        'GET',
        undefined,
        staff1Token
      )
    );
    assert.equal(memberBundleRes.status, 200);
    const memberBundleBody = await memberBundleRes.json();
    assert.deepEqual(
      memberBundleBody.shops.map((s: { id: string }) => s.id),
      ['shop-fnb-001']
    );

    // 6. Non-owner cannot create staff, update permissions, reset password, or delete staff
    const otherOwnerToken = issueSessionToken({
      id: 'owner-other-999',
      email: 'other-owner@example.com',
      role: 'owner',
    });

    for (const unauthorizedToken of [staff1Token, otherOwnerToken]) {
      const createAttempt = await shopsPost(
        jsonReq(
          'http://localhost:3000/api/shops',
          'POST',
          {
            action: 'create_staff_member',
            shop_id: 'shop-fnb-001',
            username: 'illegal_staff',
            password: 'Password#123',
            role: 'staff',
          },
          unauthorizedToken
        )
      );
      assert.equal(createAttempt.status, 403);

      const updateAttempt = await shopsPost(
        jsonReq(
          'http://localhost:3000/api/shops',
          'POST',
          {
            action: 'update_staff_member',
            shop_id: 'shop-fnb-001',
            user_id: staff1.user_id,
            role: 'cashier',
            permissions: ['orders.view', 'payment.refund'],
          },
          unauthorizedToken
        )
      );
      assert.equal(updateAttempt.status, 403);

      const resetAttempt = await shopsPost(
        jsonReq(
          'http://localhost:3000/api/shops',
          'POST',
          {
            action: 'reset_staff_password',
            shop_id: 'shop-fnb-001',
            user_id: staff1.user_id,
            new_password: 'HackedPassword#123',
          },
          unauthorizedToken
        )
      );
      assert.equal(resetAttempt.status, 403);

      const deleteAttempt = await shopsPost(
        jsonReq(
          'http://localhost:3000/api/shops',
          'POST',
          {
            action: 'delete_staff_member',
            shop_id: 'shop-fnb-001',
            user_id: staff1.user_id,
          },
          unauthorizedToken
        )
      );
      assert.equal(deleteAttempt.status, 403);
    }

    // 7. Reject owner role, admin role, unknown permissions, and owner-only members.manage grants
    const ownerRoleCreateRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'create_staff_member',
          shop_id: 'shop-fnb-001',
          username: 'bad_owner_role',
          password: 'Password#123',
          role: 'owner',
        },
        owner1Token
      )
    );
    assert.equal(ownerRoleCreateRes.status, 400);
    assert.equal(
      (await ownerRoleCreateRes.json()).code,
      'FORBIDDEN_STAFF_OWNER_ROLE'
    );

    const adminRoleUpdateRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'upsert_member',
          shop_id: 'shop-fnb-001',
          user_id: staff1.user_id,
          role: 'admin',
        },
        owner1Token
      )
    );
    assert.equal(adminRoleUpdateRes.status, 400);

    const ownerOnlyPermRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'update_staff_member',
          shop_id: 'shop-fnb-001',
          user_id: staff1.user_id,
          role: 'cashier',
          permissions: ['orders.view', 'members.manage'],
        },
        owner1Token
      )
    );
    assert.equal(ownerOnlyPermRes.status, 400);
    assert.equal(
      (await ownerOnlyPermRes.json()).code,
      'FORBIDDEN_STAFF_PERMISSION'
    );

    const unknownPermRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'update_staff_member',
          shop_id: 'shop-fnb-001',
          user_id: staff1.user_id,
          role: 'staff',
          permissions: ['orders.view', 'arbitrary.super.power'],
        },
        owner1Token
      )
    );
    assert.equal(unknownPermRes.status, 400);
    assert.equal((await unknownPermRes.json()).code, 'INVALID_PERMISSION');

    // 8. Staff cannot create another shop or register/escalate as an owner
    const staffCreateShopRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          name: 'Quán Trái Phép Của Nhân Viên',
          slug: 'quan-trai-phep-nhan-vien',
          vertical: 'fnb',
        },
        staff1Token
      )
    );
    assert.equal(staffCreateShopRes.status, 403);
    assert.equal(
      (await staffCreateShopRes.json()).code,
      'FORBIDDEN_STAFF_SHOP_CREATE'
    );

    const staffRegisterRes = await authPost(
      jsonReq(
        'http://localhost:3000/api/auth',
        'POST',
        {
          action: 'register',
          email: 'escalate-staff@example.com',
          password: 'Password#123',
          fullName: 'Staff Escalation Attempt',
        },
        staff1Token
      )
    );
    assert.equal(staffRegisterRes.status, 403);
    assert.equal(
      (await staffRegisterRes.json()).code,
      'FORBIDDEN_STAFF_REGISTER'
    );

    const staffSyncRes = await authPost(
      jsonReq(
        'http://localhost:3000/api/auth',
        'POST',
        { action: 'sync_user' },
        staff1Token
      )
    );
    assert.equal(staffSyncRes.status, 200);
    const staffSyncBody = await staffSyncRes.json();
    assert.equal(staffSyncBody.user.role, 'cashier');
    assert.equal(staffSyncBody.user.account_type, 'staff');
    assert.deepEqual(staffSyncBody.shops, []);

    // 9. Active staff creates & settles an order (recording actor identity), then owner updates permissions, resets password, deactivates/reactivates, and deletes credential while preserving historical order actor
    const createdOrderRes = await ordersPost(
      jsonReq(
        'http://localhost:3000/api/orders',
        'POST',
        {
          shop_id: 'shop-fnb-001',
          table_label: 'Mang đi',
          payment_method: 'cash',
          source: 'counter_pos',
          items: [
            {
              item_id: 'item-fnb-2',
              quantity: 1,
            },
          ],
        },
        staff1Token
      )
    );
    assert.equal(createdOrderRes.status, 201);
    const createdOrder = (await createdOrderRes.json()).order;
    assert.ok(createdOrder?.id);

    const collectPayRes = await ordersPatch(
      jsonReq(
        'http://localhost:3000/api/orders',
        'PATCH',
        {
          order_id: createdOrder.id,
          payment_status: 'paid',
          payment_method: 'cash',
          payment_idempotency_key: `staff-pay-${Date.now()}`,
        },
        staff1Token
      )
    );
    assert.equal(collectPayRes.status, 200);
    const paidOrder = (await collectPayRes.json()).order;
    assert.equal(paidOrder.payment_status, 'paid');
    assert.equal(paidOrder.paid_by, staff1.user_id);

    // Owner updates staff1 role to 'staff' and strips payment.collect
    const downgradeRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'update_staff_member',
          shop_id: 'shop-fnb-001',
          user_id: staff1.user_id,
          role: 'staff',
          permissions: ['orders.view', 'orders.fulfill'],
        },
        owner1Token
      )
    );
    assert.equal(downgradeRes.status, 200);
    const downgradedMem = (await downgradeRes.json()).membership;
    assert.equal(downgradedMem.role, 'staff');
    assert.deepEqual(downgradedMem.permissions, [
      'orders.view',
      'orders.fulfill',
    ]);

    // Owner resets staff1 password -> old token and old password fail immediately
    const resetPassRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'reset_staff_password',
          shop_id: 'shop-fnb-001',
          user_id: staff1.user_id,
          new_password: 'NewStaffPass#999',
        },
        owner1Token
      )
    );
    assert.equal(resetPassRes.status, 200);

    // Old password rejected
    const oldPassLoginRes = await authPost(
      jsonReq('http://localhost:3000/api/auth', 'POST', {
        action: 'staff_login',
        shopIdentifier: 'pho-hoi-an',
        username: 'thungan_casang',
        password: 'StaffPass#123',
      })
    );
    assert.equal(oldPassLoginRes.status, 401);

    // Old session token (sv=1) rejected on both /api/auth and protected shop APIs
    const oldTokenAuthCheck = await authGet(
      jsonReq('http://localhost:3000/api/auth', 'GET', undefined, staff1Token)
    );
    assert.equal(oldTokenAuthCheck.status, 401);

    const oldTokenOrdersCheck = await ordersGet(
      jsonReq(
        'http://localhost:3000/api/orders?shopId=shop-fnb-001',
        'GET',
        undefined,
        staff1Token
      )
    );
    assert.equal(oldTokenOrdersCheck.status, 403);

    // Login with new password succeeds
    const newPassLoginRes = await authPost(
      jsonReq('http://localhost:3000/api/auth', 'POST', {
        action: 'staff_login',
        shopIdentifier: 'pho-hoi-an',
        username: 'thungan_casang',
        password: 'NewStaffPass#999',
      })
    );
    assert.equal(newPassLoginRes.status, 200);
    const staff1NewToken = (await newPassLoginRes.json()).accessToken as string;

    // Owner deactivates staff1
    const deactivateRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'upsert_member',
          shop_id: 'shop-fnb-001',
          user_id: staff1.user_id,
          role: 'staff',
          permissions: ['orders.view', 'orders.fulfill'],
          is_active: false,
        },
        owner1Token
      )
    );
    assert.equal(deactivateRes.status, 200);
    assert.equal((await deactivateRes.json()).membership.is_active, false);

    // Inactive staff cannot access protected shop APIs or log in
    const inactiveOrdersRes = await ordersGet(
      jsonReq(
        'http://localhost:3000/api/orders?shopId=shop-fnb-001',
        'GET',
        undefined,
        staff1NewToken
      )
    );
    assert.equal(inactiveOrdersRes.status, 403);

    const inactiveLoginRes = await authPost(
      jsonReq('http://localhost:3000/api/auth', 'POST', {
        action: 'staff_login',
        shopIdentifier: 'pho-hoi-an',
        username: 'thungan_casang',
        password: 'NewStaffPass#999',
      })
    );
    assert.equal(inactiveLoginRes.status, 401);

    // Owner reactivates staff1
    const reactivateRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'update_staff_member',
          shop_id: 'shop-fnb-001',
          user_id: staff1.user_id,
          is_active: true,
        },
        owner1Token
      )
    );
    assert.equal(reactivateRes.status, 200);
    assert.equal((await reactivateRes.json()).membership.is_active, true);

    const reactivatedLoginRes = await authPost(
      jsonReq('http://localhost:3000/api/auth', 'POST', {
        action: 'staff_login',
        shopIdentifier: 'pho-hoi-an',
        username: 'thungan_casang',
        password: 'NewStaffPass#999',
      })
    );
    assert.equal(reactivatedLoginRes.status, 200);
    const reactivatedToken = (await reactivatedLoginRes.json())
      .accessToken as string;

    // Owner removes staff1 credential + membership
    const deleteStaffRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'delete_member',
          shop_id: 'shop-fnb-001',
          user_id: staff1.user_id,
        },
        owner1Token
      )
    );
    assert.equal(deleteStaffRes.status, 200);
    assert.equal((await deleteStaffRes.json()).deleted, true);

    // Deleted staff token is immediately denied on protected shop APIs
    const deletedStaffOrdersRes = await ordersGet(
      jsonReq(
        'http://localhost:3000/api/orders?shopId=shop-fnb-001',
        'GET',
        undefined,
        reactivatedToken
      )
    );
    assert.equal(deletedStaffOrdersRes.status, 403);

    // Historical order still preserves paid_by actor identity of the deleted staff member
    const ownerOrdersRes = await ordersGet(
      jsonReq(
        'http://localhost:3000/api/orders?shopId=shop-fnb-001',
        'GET',
        undefined,
        owner1Token
      )
    );
    assert.equal(ownerOrdersRes.status, 200);
    const ownerOrdersBody = await ownerOrdersRes.json();
    const preservedOrder = ownerOrdersBody.orders.find(
      (o: { id: string }) => o.id === createdOrder.id
    );
    assert.ok(preservedOrder, 'historical order must remain after staff deletion');
    assert.equal(preservedOrder.paid_by, staff1.user_id);

    // 10. Existing email member management via upsert_member still works for cashier-demo-001
    const emailMemUpsertRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'upsert_member',
          shop_id: 'shop-fnb-001',
          user_id: 'cashier-demo-001',
          email: 'thungan@qlaok.vn',
          full_name: 'Trần Thị Thu Ngân',
          role: 'cashier',
          permissions: ['orders.view', 'payment.collect', 'discount.apply'],
          is_active: true,
        },
        owner1Token
      )
    );
    assert.equal(emailMemUpsertRes.status, 200);
    const emailMemBody = await emailMemUpsertRes.json();
    assert.equal(emailMemBody.membership.email, 'thungan@qlaok.vn');
    assert.equal(emailMemBody.membership.account_type, 'email');

    // Patch shop settings by non-member staff2 is denied
    const crossShopPatchRes = await shopsPatch(
      jsonReq(
        'http://localhost:3000/api/shops',
        'PATCH',
        {
          id: 'shop-fnb-001',
          city: 'Đà Nẵng',
        },
        loginByLinkBody.accessToken
      )
    );
    assert.equal(crossShopPatchRes.status, 403);
  } finally {
    clearInMemoryStaffCredentialsForTest();
    setShopMembershipDbClientForTest(null);
    setSupabaseDbClientForTests(null);
    if (prevLocalMode === undefined) {
      delete process.env.QLAOK_TEST_LOCAL_DB;
    } else {
      process.env.QLAOK_TEST_LOCAL_DB = prevLocalMode;
    }
    if (hadMemFile) {
      fs.writeFileSync(MEMBERSHIPS_FILE, prevMemRaw, 'utf8');
    } else if (fs.existsSync(MEMBERSHIPS_FILE)) {
      fs.unlinkSync(MEMBERSHIPS_FILE);
    }
    if (hadCredFile) {
      fs.writeFileSync(CREDENTIALS_FILE, prevCredRaw, 'utf8');
    } else if (fs.existsSync(CREDENTIALS_FILE)) {
      fs.unlinkSync(CREDENTIALS_FILE);
    }
  }
});

test('authoritative Supabase DB mode persists staff credentials in shop_staff_credentials with scrypt hashes, preserves owner registration/login and email invite_member, and never falls back to local disk', async () => {
  const credentialRows = new Map<string, Record<string, unknown>>();
  const membershipRows = new Map<string, Record<string, unknown>>();
  const profileRows = new Map<string, Record<string, unknown>>([
    [
      'owner-demo-001',
      {
        id: 'owner-demo-001',
        email: 'chuquan@qlaok.vn',
        full_name: 'Chủ Quán Demo',
        plan: 'premium',
      },
    ],
    [
      'invited-email-staff-1',
      {
        id: 'invited-email-staff-1',
        email: 'phucvu.email@qlaok.vn',
        full_name: 'Nhân Viên Email',
        plan: 'free',
      },
    ],
  ]);

  const hadCredFile = fs.existsSync(CREDENTIALS_FILE);
  const prevCredRaw = hadCredFile
    ? fs.readFileSync(CREDENTIALS_FILE, 'utf8')
    : '';

  const mockSb = {
    from(table: string) {
      if (table === 'profiles') {
        return {
          select() {
            const filters: Array<(r: Record<string, unknown>) => boolean> = [];
            const chain = {
              eq(col: string, val: unknown) {
                filters.push((r) => r[col] === val);
                return chain;
              },
              ilike(col: string, val: unknown) {
                const target = String(val || '').toLowerCase();
                filters.push(
                  (r) => String(r[col] || '').toLowerCase() === target
                );
                return chain;
              },
              limit(n: number) {
                const matched = Array.from(profileRows.values())
                  .filter((r) => filters.every((fn) => fn(r)))
                  .slice(0, n);
                return Promise.resolve({ data: matched, error: null });
              },
              async maybeSingle() {
                const matched = Array.from(profileRows.values()).find((r) =>
                  filters.every((fn) => fn(r))
                );
                return { data: matched ? { ...matched } : null, error: null };
              },
            };
            return chain;
          },
          upsert(payload: Record<string, unknown>) {
            const id = String(payload.id);
            const merged = { ...(profileRows.get(id) || {}), ...payload };
            profileRows.set(id, merged);
            return {
              select() {
                return {
                  async single() {
                    return { data: { ...merged }, error: null };
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'shops') {
        return {
          select() {
            const filters: Array<(r: Record<string, unknown>) => boolean> = [];
            const shopFixture = {
              id: 'shop-fnb-001',
              owner_id: 'owner-demo-001',
              slug: 'pho-hoi-an',
              name: 'Phở & Cà Phê Phố Cổ',
              is_published: true,
            };
            const chain = {
              eq(col: string, val: string) {
                filters.push((r) => r[col] === val);
                return chain;
              },
              in(col: string, vals: string[]) {
                filters.push((r) => vals.includes(String(r[col])));
                const matched = [shopFixture].filter((r) =>
                  filters.every((fn) => fn(r))
                );
                return Promise.resolve({ data: matched, error: null });
              },
              order() {
                const matched = [shopFixture].filter((r) =>
                  filters.every((fn) => fn(r))
                );
                return Promise.resolve({ data: matched, error: null });
              },
              async single() {
                const matched = [shopFixture].find((r) =>
                  filters.every((fn) => fn(r))
                );
                return { data: matched || null, error: null };
              },
              async maybeSingle() {
                const matched = [shopFixture].find((r) =>
                  filters.every((fn) => fn(r))
                );
                return { data: matched || null, error: null };
              },
            };
            return chain;
          },
        };
      }

      if (table === 'shop_staff_credentials') {
        return {
          select() {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return chain;
              },
              async maybeSingle() {
                for (const row of credentialRows.values()) {
                  const matches = Object.entries(filters).every(
                    ([k, v]) => row[k] === v
                  );
                  if (matches) return { data: { ...row }, error: null };
                }
                return { data: null, error: null };
              },
            };
            return chain;
          },
          async insert(payload: Record<string, unknown>) {
            for (const existing of credentialRows.values()) {
              if (
                existing.shop_id === payload.shop_id &&
                existing.username === payload.username
              ) {
                return {
                  data: null,
                  error: { message: 'duplicate key value violates unique constraint' },
                };
              }
            }
            credentialRows.set(String(payload.user_id), { ...payload });
            return { data: [payload], error: null };
          },
          update(patch: Record<string, unknown>) {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                const matched = Array.from(credentialRows.values()).filter((r) =>
                  Object.entries(filters).every(([k, v]) => r[k] === v)
                );
                if (Object.keys(filters).length >= 2) {
                  for (const row of matched) {
                    credentialRows.set(String(row.user_id), {
                      ...row,
                      ...patch,
                    });
                  }
                  return Promise.resolve({ data: matched, error: null });
                }
                return chain;
              },
            };
            return chain;
          },
          delete() {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                if (Object.keys(filters).length >= 2) {
                  let deletedCount = 0;
                  for (const [key, row] of credentialRows.entries()) {
                    if (
                      Object.entries(filters).every(([k, v]) => row[k] === v)
                    ) {
                      credentialRows.delete(key);
                      deletedCount += 1;
                    }
                  }
                  return Promise.resolve({
                    data: [],
                    error: null,
                    count: deletedCount,
                  });
                }
                return chain;
              },
            };
            return chain;
          },
        };
      }

      if (table === 'shop_memberships') {
        return {
          select() {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                const rows = Array.from(membershipRows.values()).filter((r) =>
                  Object.entries(filters).every(([k, v]) => r[k] === v)
                );
                return Object.assign(Promise.resolve({ data: rows, error: null }), chain);
              },
            };
            return chain;
          },
          async upsert(payload: Record<string, unknown>) {
            const key = `${payload.shop_id}:${payload.user_id}`;
            const prev = membershipRows.get(key) || {};
            const merged = { ...prev, ...payload };
            membershipRows.set(key, merged);
            return { data: [merged], error: null };
          },
          delete() {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                if (Object.keys(filters).length >= 2) {
                  let count = 0;
                  for (const [k, row] of membershipRows.entries()) {
                    if (
                      Object.entries(filters).every(([fk, fv]) => row[fk] === fv)
                    ) {
                      membershipRows.delete(k);
                      count += 1;
                    }
                  }
                  return Promise.resolve({ data: [], error: null, count });
                }
                return chain;
              },
            };
            return chain;
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;

  setShopMembershipDbClientForTest(mockSb);
  setSupabaseDbClientForTests(mockSb);
  const ownerToken = issueSessionToken({
    id: 'owner-demo-001',
    email: 'chuquan@qlaok.vn',
    role: 'owner',
  });

  try {
    const createRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'create_staff_member',
          shop_id: 'shop-fnb-001',
          username: 'barista_db_01',
          password: 'DbPassword#123',
          full_name: 'Barista DB',
          role: 'staff',
        },
        ownerToken
      )
    );
    assert.equal(createRes.status, 201);
    const createdMem = (await createRes.json()).membership;
    assert.equal(credentialRows.size, 1);
    const storedCred = credentialRows.get(createdMem.user_id)!;
    assert.ok(storedCred);
    assert.equal(storedCred.username, 'barista_db_01');
    assert.equal(storedCred.shop_id, 'shop-fnb-001');
    assert.match(String(storedCred.password_hash), /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    assert.notEqual(storedCred.password_hash, 'DbPassword#123');

    const membersInDb = await dbGetShopMemberships('shop-fnb-001');
    assert.equal(membersInDb.length, 1);
    assert.equal(membersInDb[0].username, 'barista_db_01');
    assert.equal(membersInDb[0].account_type, 'staff');

    // Existing email-based invite_member still works alongside staff accounts
    const inviteEmailRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'invite_member',
          shop_id: 'shop-fnb-001',
          email: 'phucvu.email@qlaok.vn',
          role: 'cashier',
        },
        ownerToken
      )
    );
    assert.equal(inviteEmailRes.status, 201);
    const invitedMem = (await inviteEmailRes.json()).membership;
    assert.equal(invitedMem.email, 'phucvu.email@qlaok.vn');
    assert.equal(invitedMem.account_type, 'email');

    // Owner registration requires Zitadel OIDC; its callback provisions the profile before sync_user.
    const uniqueOwnerEmail = `owner-reg-${Date.now()}@example.com`;
    const newOwnerUuid = '7d21f8ae-6b7c-414b-ba28-3f932ab062f7';
    profileRows.set(newOwnerUuid, {
      id: newOwnerUuid,
      email: uniqueOwnerEmail,
      full_name: 'Chủ Quán Mới',
      plan: 'free',
    });
    const ownerRegRes = await authPost(
      jsonReq('http://localhost:3000/api/auth', 'POST', {
        action: 'register',
        email: uniqueOwnerEmail,
        password: 'OwnerPass#123',
        fullName: 'Chủ Quán Mới',
      })
    );
    assert.equal(ownerRegRes.status, 400);
    assert.equal((await ownerRegRes.json()).code, 'OIDC_REQUIRED');

    const newOwnerToken = issueSessionToken({
      id: newOwnerUuid,
      email: uniqueOwnerEmail,
      role: 'owner',
    });
    const ownerSyncRes = await authPost(
      jsonReq(
        'http://localhost:3000/api/auth',
        'POST',
        {
          action: 'sync_user',
          email: uniqueOwnerEmail,
          fullName: 'Chủ Quán Mới',
        },
        newOwnerToken
      )
    );
    assert.equal(ownerSyncRes.status, 200);
    const ownerSyncBody = await ownerSyncRes.json();
    assert.equal(ownerSyncBody.user.id, newOwnerUuid);
    assert.equal(ownerSyncBody.user.email, uniqueOwnerEmail);
  } finally {
    setShopMembershipDbClientForTest(null);
    setSupabaseDbClientForTests(null);
    if (hadCredFile) {
      fs.writeFileSync(CREDENTIALS_FILE, prevCredRaw, 'utf8');
    } else if (fs.existsSync(CREDENTIALS_FILE)) {
      fs.unlinkSync(CREDENTIALS_FILE);
    }
  }
});

test('staff login rate limiter: durable DB-backed failure window, generic error responses, spoofed IP header resistance, non-permanent cooldown recovery, reset on login/password-reset, retention cleanup, and fail-closed DB behavior', async () => {
  const credentialRows = new Map<string, Record<string, unknown>>();
  const membershipRows = new Map<string, Record<string, unknown>>();
  const rateLimitRows = new Map<string, Record<string, unknown>>();

  let currentClockMs = Date.parse('2026-10-24T10:00:00.000Z');
  setStaffLoginRateLimitClockForTest(() => currentClockMs);

  let failRateLimitDb = false;

  const shopFixture = {
    id: 'shop-fnb-001',
    owner_id: 'owner-demo-001',
    slug: 'pho-hoi-an',
    name: 'Phở & Cà Phê Phố Cổ',
    is_published: true,
  };

  const mockSb = {
    from(table: string) {
      if (table === 'shops') {
        return {
          select() {
            const filters: Array<(r: Record<string, unknown>) => boolean> = [];
            const chain = {
              eq(col: string, val: string) {
                filters.push((r) => r[col] === val);
                return chain;
              },
              async single() {
                const matched = [shopFixture].find((r) =>
                  filters.every((fn) => fn(r))
                );
                return { data: matched || null, error: null };
              },
              async maybeSingle() {
                const matched = [shopFixture].find((r) =>
                  filters.every((fn) => fn(r))
                );
                return { data: matched || null, error: null };
              },
            };
            return chain;
          },
        };
      }

      if (table === 'shop_staff_credentials') {
        return {
          select() {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return chain;
              },
              async maybeSingle() {
                for (const row of credentialRows.values()) {
                  const matches = Object.entries(filters).every(
                    ([k, v]) => row[k] === v
                  );
                  if (matches) return { data: { ...row }, error: null };
                }
                return { data: null, error: null };
              },
            };
            return chain;
          },
          async insert(payload: Record<string, unknown>) {
            credentialRows.set(String(payload.user_id), { ...payload });
            return { data: [payload], error: null };
          },
          update(patch: Record<string, unknown>) {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                if (Object.keys(filters).length >= 2) {
                  for (const row of credentialRows.values()) {
                    if (
                      Object.entries(filters).every(([k, v]) => row[k] === v)
                    ) {
                      credentialRows.set(String(row.user_id), {
                        ...row,
                        ...patch,
                      });
                    }
                  }
                  return Promise.resolve({ data: [], error: null });
                }
                return chain;
              },
            };
            return chain;
          },
        };
      }

      if (table === 'shop_memberships') {
        return {
          select() {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                const rows = Array.from(membershipRows.values()).filter((r) =>
                  Object.entries(filters).every(([k, v]) => r[k] === v)
                );
                return Object.assign(
                  Promise.resolve({ data: rows, error: null }),
                  chain
                );
              },
            };
            return chain;
          },
          async upsert(payload: Record<string, unknown>) {
            const key = `${payload.shop_id}:${payload.user_id}`;
            const prev = membershipRows.get(key) || {};
            const merged = { ...prev, ...payload };
            membershipRows.set(key, merged);
            return { data: [merged], error: null };
          },
        };
      }

      if (table === 'staff_login_rate_limits') {
        return {
          select() {
            if (failRateLimitDb) {
              const errResult = Promise.resolve({
                data: null,
                error: { message: 'rate limit DB connection lost' },
              });
              const chain = {
                eq() {
                  return chain;
                },
                maybeSingle() {
                  return errResult;
                },
              };
              return Object.assign(errResult, chain);
            }
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return chain;
              },
              async maybeSingle() {
                const key = String(filters.bucket_key || '');
                const found = rateLimitRows.get(key);
                return { data: found ? { ...found } : null, error: null };
              },
            };
            return Object.assign(
              Promise.resolve({
                data: Array.from(rateLimitRows.values()),
                error: null,
              }),
              chain
            );
          },
          async upsert(payload: Record<string, unknown>) {
            if (failRateLimitDb) {
              return {
                data: null,
                error: { message: 'rate limit DB write failed' },
              };
            }
            const key = String(payload.bucket_key);
            rateLimitRows.set(key, { ...payload });
            return { data: [payload], error: null };
          },
          delete() {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                if (failRateLimitDb) {
                  return Promise.resolve({
                    data: null,
                    error: { message: 'rate limit DB delete failed' },
                  });
                }
                const key = String(filters.bucket_key || '');
                rateLimitRows.delete(key);
                return Promise.resolve({ data: [], error: null });
              },
            };
            return chain;
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;

  setShopMembershipDbClientForTest(mockSb);
  setSupabaseDbClientForTests(mockSb);

  const ownerToken = issueSessionToken({
    id: 'owner-demo-001',
    email: 'chuquan@qlaok.vn',
    role: 'owner',
  });

  try {
    const createRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'create_staff_member',
          shop_id: 'shop-fnb-001',
          username: 'cashier_rl',
          password: 'ValidPass#123',
          full_name: 'Thu Ngân Rate Limit',
          role: 'cashier',
        },
        ownerToken
      )
    );
    assert.equal(createRes.status, 201);
    const createdStaff = (await createRes.json()).membership;

    // 1. Partial failures (2 wrong passwords) followed by a valid login resets the failure window
    for (let i = 0; i < 2; i += 1) {
      const badRes = await authPost(
        jsonReq('http://localhost:3000/api/auth', 'POST', {
          action: 'staff_login',
          shopIdentifier: 'pho-hoi-an',
          username: 'cashier_rl',
          password: `WrongPass#${i}`,
        })
      );
      assert.equal(badRes.status, 401);
      const badBody = await badRes.json();
      assert.equal(badBody.code, 'INVALID_STAFF_CREDENTIALS');
    }

    const bucketKey = computeStaffLoginRateLimitKey(
      'shop-fnb-001',
      'cashier_rl'
    );
    assert.match(bucketKey, /^rl-staff-[0-9a-f]{64}$/);
    assert.equal(rateLimitRows.get(bucketKey)?.failure_count, 2);

    // Ensure no raw username, password, or IP is stored in rateLimitRows
    const serializedRl = JSON.stringify(Array.from(rateLimitRows.values()));
    assert.equal(serializedRl.includes('cashier_rl'), false);
    assert.equal(serializedRl.includes('WrongPass'), false);
    assert.equal(serializedRl.includes('pho-hoi-an'), false);

    // Successful login resets the failure counter
    const goodLoginRes = await authPost(
      jsonReq('http://localhost:3000/api/auth', 'POST', {
        action: 'staff_login',
        shopIdentifier: 'pho-hoi-an',
        username: 'cashier_rl',
        password: 'ValidPass#123',
      })
    );
    assert.equal(goodLoginRes.status, 200);
    assert.equal(rateLimitRows.has(bucketKey), false);

    // 2. Reaching 5 failed attempts triggers temporary 429 cooldown; rotating spoofed IP headers cannot bypass it
    for (let attempt = 1; attempt <= STAFF_LOGIN_RATE_LIMIT_MAX_ATTEMPTS; attempt += 1) {
      const failRes = await authPost(
        jsonReq(
          'http://localhost:3000/api/auth',
          'POST',
          {
            action: 'staff_login',
            shopIdentifier: 'pho-hoi-an',
            username: 'cashier_rl',
            password: 'WrongPassword#999',
          },
          undefined,
          {
            'x-forwarded-for': `203.0.113.${attempt}`,
            'x-real-ip': `198.51.100.${attempt}`,
            'cf-connecting-ip': `192.0.2.${attempt}`,
          }
        )
      );
      assert.equal(failRes.status, 401);
      assert.equal((await failRes.json()).code, 'INVALID_STAFF_CREDENTIALS');
    }

    // 6th attempt (even with a different spoofed IP header AND the valid password!) is blocked with 429
    const blockedRes = await authPost(
      jsonReq(
        'http://localhost:3000/api/auth',
        'POST',
        {
          action: 'staff_login',
          shopIdentifier: 'pho-hoi-an',
          username: 'cashier_rl',
          password: 'ValidPass#123',
        },
        undefined,
        {
          'x-forwarded-for': '8.8.8.8',
          'x-real-ip': '1.1.1.1',
        }
      )
    );
    assert.equal(blockedRes.status, 429);
    const blockedBody = await blockedRes.json();
    assert.equal(blockedBody.code, 'STAFF_LOGIN_RATE_LIMITED');
    assert.ok(blockedBody.retryAfterSec > 0);
    assert.equal(
      blockedRes.headers.get('retry-after'),
      String(blockedBody.retryAfterSec)
    );

    // Non-existent shop/username also follows the exact same generic 401 -> 429 progression (no enumeration leak)
    for (let attempt = 1; attempt <= STAFF_LOGIN_RATE_LIMIT_MAX_ATTEMPTS; attempt += 1) {
      const ghostRes = await authPost(
        jsonReq('http://localhost:3000/api/auth', 'POST', {
          action: 'staff_login',
          shopIdentifier: 'non-existent-shop-xyz',
          username: 'ghost_user',
          password: 'AnyPassword#123',
        })
      );
      assert.equal(ghostRes.status, 401);
      assert.equal((await ghostRes.json()).code, 'INVALID_STAFF_CREDENTIALS');
    }
    const ghostBlockedRes = await authPost(
      jsonReq('http://localhost:3000/api/auth', 'POST', {
        action: 'staff_login',
        shopIdentifier: 'non-existent-shop-xyz',
        username: 'ghost_user',
        password: 'AnyPassword#123',
      })
    );
    assert.equal(ghostBlockedRes.status, 429);
    assert.equal((await ghostBlockedRes.json()).code, 'STAFF_LOGIN_RATE_LIMITED');

    // 3. Not a permanent lockout: advancing clock past the 15-minute cooldown restores login
    currentClockMs += (STAFF_LOGIN_RATE_LIMIT_BLOCK_SECONDS + 2) * 1000;

    const recoveredLoginRes = await authPost(
      jsonReq('http://localhost:3000/api/auth', 'POST', {
        action: 'staff_login',
        shopIdentifier: 'pho-hoi-an',
        username: 'cashier_rl',
        password: 'ValidPass#123',
      })
    );
    assert.equal(recoveredLoginRes.status, 200);

    // 4. Owner password reset immediately clears an active rate-limit block for that staff member
    for (let attempt = 1; attempt <= STAFF_LOGIN_RATE_LIMIT_MAX_ATTEMPTS; attempt += 1) {
      await authPost(
        jsonReq('http://localhost:3000/api/auth', 'POST', {
          action: 'staff_login',
          shopIdentifier: 'pho-hoi-an',
          username: 'cashier_rl',
          password: 'ForgotPassword#000',
        })
      );
    }
    const verifyLockedBeforeReset = await authPost(
      jsonReq('http://localhost:3000/api/auth', 'POST', {
        action: 'staff_login',
        shopIdentifier: 'pho-hoi-an',
        username: 'cashier_rl',
        password: 'ValidPass#123',
      })
    );
    assert.equal(verifyLockedBeforeReset.status, 429);

    const ownerResetRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'reset_staff_password',
          shop_id: 'shop-fnb-001',
          user_id: createdStaff.user_id,
          new_password: 'OwnerResetPass#456',
        },
        ownerToken
      )
    );
    assert.equal(ownerResetRes.status, 200);

    const loginAfterOwnerReset = await authPost(
      jsonReq('http://localhost:3000/api/auth', 'POST', {
        action: 'staff_login',
        shopIdentifier: 'pho-hoi-an',
        username: 'cashier_rl',
        password: 'OwnerResetPass#456',
      })
    );
    assert.equal(loginAfterOwnerReset.status, 200);

    // 5. Retention cleanup removes expired rate-limit entries after retention window
    await authPost(
      jsonReq('http://localhost:3000/api/auth', 'POST', {
        action: 'staff_login',
        shopIdentifier: 'pho-hoi-an',
        username: 'stale_attempt_user',
        password: 'WrongPassword#111',
      })
    );
    assert.ok(rateLimitRows.size >= 1);
    currentClockMs += (STAFF_LOGIN_RATE_LIMIT_RETENTION_SECONDS + 60) * 1000;
    const cleaned = await cleanupExpiredStaffLoginRateLimits({
      nowMs: currentClockMs,
    });
    assert.ok(cleaned >= 1);
    assert.equal(rateLimitRows.size, 0);

    // 6. Fail-closed when the DB rate limiter fails in authoritative DB mode
    failRateLimitDb = true;
    const failClosedRes = await authPost(
      jsonReq('http://localhost:3000/api/auth', 'POST', {
        action: 'staff_login',
        shopIdentifier: 'pho-hoi-an',
        username: 'cashier_rl',
        password: 'OwnerResetPass#456',
      })
    );
    assert.equal(failClosedRes.status, 503);
    const failClosedBody = await failClosedRes.json();
    assert.equal(failClosedBody.code, 'STAFF_LOGIN_RATE_LIMIT_UNAVAILABLE');
    assert.equal(failClosedBody.accessToken, undefined);

    const failClosedUnknownUserRes = await authPost(
      jsonReq('http://localhost:3000/api/auth', 'POST', {
        action: 'staff_login',
        shopIdentifier: 'pho-hoi-an',
        username: 'unknown_user_during_db_outage',
        password: 'AnyPassword#123',
      })
    );
    assert.equal(failClosedUnknownUserRes.status, 503);
    assert.equal(
      (await failClosedUnknownUserRes.json()).code,
      'STAFF_LOGIN_RATE_LIMIT_UNAVAILABLE'
    );

    const failClosedUnknownShopRes = await authPost(
      jsonReq('http://localhost:3000/api/auth', 'POST', {
        action: 'staff_login',
        shopIdentifier: 'unknown-shop-during-db-outage',
        username: 'any_user',
        password: 'AnyPassword#123',
      })
    );
    assert.equal(failClosedUnknownShopRes.status, 503);
    assert.equal(
      (await failClosedUnknownShopRes.json()).code,
      'STAFF_LOGIN_RATE_LIMIT_UNAVAILABLE'
    );
  } finally {
    clearInMemoryStaffCredentialsForTest();
    setShopMembershipDbClientForTest(null);
    setSupabaseDbClientForTests(null);
  }
});

test('staff login rate limiter bounded cardinality: unknown usernames collapse per shop, unknown shops collapse globally, real accounts stay isolated, dummy password verification runs on unknown targets, and cooldowns/resets/deletes clear only target buckets', async () => {
  const credentialRows = new Map<string, Record<string, unknown>>();
  const membershipRows = new Map<string, Record<string, unknown>>();
  const rateLimitRows = new Map<string, Record<string, unknown>>();

  let currentClockMs = Date.parse('2026-10-24T14:00:00.000Z');
  setStaffLoginRateLimitClockForTest(() => currentClockMs);

  const shopFixture = {
    id: 'shop-fnb-001',
    owner_id: 'owner-demo-001',
    slug: 'pho-hoi-an',
    name: 'Phở & Cà Phê Phố Cổ',
    is_published: true,
  };

  const mockSb = {
    from(table: string) {
      if (table === 'shops') {
        return {
          select() {
            const filters: Array<(r: Record<string, unknown>) => boolean> = [];
            const chain = {
              eq(col: string, val: string) {
                filters.push((r) => r[col] === val);
                return chain;
              },
              async single() {
                const matched = [shopFixture].find((r) =>
                  filters.every((fn) => fn(r))
                );
                return { data: matched || null, error: null };
              },
              async maybeSingle() {
                const matched = [shopFixture].find((r) =>
                  filters.every((fn) => fn(r))
                );
                return { data: matched || null, error: null };
              },
            };
            return chain;
          },
        };
      }

      if (table === 'shop_staff_credentials') {
        return {
          select() {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return chain;
              },
              async maybeSingle() {
                for (const row of credentialRows.values()) {
                  const matches = Object.entries(filters).every(
                    ([k, v]) => row[k] === v
                  );
                  if (matches) return { data: { ...row }, error: null };
                }
                return { data: null, error: null };
              },
            };
            return chain;
          },
          async insert(payload: Record<string, unknown>) {
            credentialRows.set(String(payload.user_id), { ...payload });
            return { data: [payload], error: null };
          },
          update(patch: Record<string, unknown>) {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                if (Object.keys(filters).length >= 2) {
                  for (const row of credentialRows.values()) {
                    if (
                      Object.entries(filters).every(([k, v]) => row[k] === v)
                    ) {
                      credentialRows.set(String(row.user_id), {
                        ...row,
                        ...patch,
                      });
                    }
                  }
                  return Promise.resolve({ data: [], error: null });
                }
                return chain;
              },
            };
            return chain;
          },
          delete() {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                if (Object.keys(filters).length >= 2) {
                  let count = 0;
                  for (const [k, row] of credentialRows.entries()) {
                    if (
                      Object.entries(filters).every(([fk, fv]) => row[fk] === fv)
                    ) {
                      credentialRows.delete(k);
                      count += 1;
                    }
                  }
                  return Promise.resolve({ data: [], error: null, count });
                }
                return chain;
              },
            };
            return chain;
          },
        };
      }

      if (table === 'shop_memberships') {
        return {
          select() {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                const rows = Array.from(membershipRows.values()).filter((r) =>
                  Object.entries(filters).every(([k, v]) => r[k] === v)
                );
                return Object.assign(
                  Promise.resolve({ data: rows, error: null }),
                  chain
                );
              },
            };
            return chain;
          },
          async upsert(payload: Record<string, unknown>) {
            const key = `${payload.shop_id}:${payload.user_id}`;
            const prev = membershipRows.get(key) || {};
            const merged = { ...prev, ...payload };
            membershipRows.set(key, merged);
            return { data: [merged], error: null };
          },
          delete() {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                if (Object.keys(filters).length >= 2) {
                  let count = 0;
                  for (const [k, row] of membershipRows.entries()) {
                    if (
                      Object.entries(filters).every(([fk, fv]) => row[fk] === fv)
                    ) {
                      membershipRows.delete(k);
                      count += 1;
                    }
                  }
                  return Promise.resolve({ data: [], error: null, count });
                }
                return chain;
              },
            };
            return chain;
          },
        };
      }

      if (table === 'staff_login_rate_limits') {
        return {
          select() {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return chain;
              },
              async maybeSingle() {
                const key = String(filters.bucket_key || '');
                const found = rateLimitRows.get(key);
                return { data: found ? { ...found } : null, error: null };
              },
            };
            return Object.assign(
              Promise.resolve({
                data: Array.from(rateLimitRows.values()),
                error: null,
              }),
              chain
            );
          },
          async upsert(payload: Record<string, unknown>) {
            const key = String(payload.bucket_key);
            rateLimitRows.set(key, { ...payload });
            return { data: [payload], error: null };
          },
          delete() {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                const key = String(filters.bucket_key || '');
                rateLimitRows.delete(key);
                return Promise.resolve({ data: [], error: null });
              },
            };
            return chain;
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;

  setShopMembershipDbClientForTest(mockSb);
  setSupabaseDbClientForTests(mockSb);

  const ownerToken = issueSessionToken({
    id: 'owner-demo-001',
    email: 'chuquan@qlaok.vn',
    role: 'owner',
  });

  try {
    // Create two active staff accounts and one inactive staff account in shop-fnb-001
    const createStaffARes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'create_staff_member',
          shop_id: 'shop-fnb-001',
          username: 'real_cashier_a',
          password: 'CashierAPass#123',
          role: 'cashier',
        },
        ownerToken
      )
    );
    assert.equal(createStaffARes.status, 201);
    const staffA = (await createStaffARes.json()).membership;

    const createStaffBRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'create_staff_member',
          shop_id: 'shop-fnb-001',
          username: 'real_barista_b',
          password: 'BaristaBPass#123',
          role: 'staff',
        },
        ownerToken
      )
    );
    assert.equal(createStaffBRes.status, 201);
    const staffB = (await createStaffBRes.json()).membership;

    const createInactiveRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'create_staff_member',
          shop_id: 'shop-fnb-001',
          username: 'inactive_staff_c',
          password: 'InactiveCPass#123',
          role: 'staff',
          is_active: false,
        },
        ownerToken
      )
    );
    assert.equal(createInactiveRes.status, 201);

    const expectedUnknownShopKey = computeStaffLoginUnknownShopRateLimitKey();
    const expectedShopUnknownUserKey =
      computeStaffLoginUnknownUserRateLimitKey('shop-fnb-001');
    const expectedStaffAKey = computeStaffLoginRateLimitKey(
      'shop-fnb-001',
      'real_cashier_a'
    );
    const expectedStaffBKey = computeStaffLoginRateLimitKey(
      'shop-fnb-001',
      'real_barista_b'
    );
    const expectedInactiveCKey = computeStaffLoginRateLimitKey(
      'shop-fnb-001',
      'inactive_staff_c'
    );

    // Key helper invariants: unknown shop/user inputs collapse deterministically
    assert.equal(computeStaffLoginRateLimitKey(null, 'any_user_1'), expectedUnknownShopKey);
    assert.equal(computeStaffLoginRateLimitKey('', 'any_user_2'), expectedUnknownShopKey);
    assert.equal(
      computeStaffLoginRateLimitKey('shop-fnb-001', null),
      expectedShopUnknownUserKey
    );
    assert.equal(
      computeStaffLoginRateLimitKey('shop-fnb-001', ''),
      expectedShopUnknownUserKey
    );
    assert.equal(
      computeStaffLoginRateLimitKey('shop-fnb-001', 'invalid!username!'),
      expectedShopUnknownUserKey
    );
    assert.equal(
      new Set([
        expectedUnknownShopKey,
        expectedShopUnknownUserKey,
        expectedStaffAKey,
        expectedStaffBKey,
        expectedInactiveCKey,
      ]).size,
      5,
      'bounded buckets for unknown shop, unknown user, and each real account must be distinct'
    );

    // 1. Many distinct unknown usernames for one known shop collapse to ONE fixed bucket
    const shopRefVariants = [
      'pho-hoi-an',
      'PHO-HOI-AN',
      '/s/pho-hoi-an/menu',
      'https://qlaok.vn/s/pho-hoi-an',
      'shop-fnb-001',
    ];
    const dummyBeforeUnknownUsers =
      getDummyStaffPasswordVerificationCountForTest();

    for (let i = 0; i < 20; i += 1) {
      const shopRef = shopRefVariants[i % shopRefVariants.length]!;
      const randomUsername =
        i === 3
          ? 'x' // invalid short username
          : i === 4
            ? 'bad!chars#here'
            : `bot_unknown_user_${i}_${Math.random().toString(36).slice(2, 8)}`;
      const res = await authPost(
        jsonReq('http://localhost:3000/api/auth', 'POST', {
          action: 'staff_login',
          shopIdentifier: shopRef,
          username: randomUsername,
          password: `GuessPass#${i}`,
        })
      );
      const body = await res.json();
      if (i < STAFF_LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
        assert.equal(res.status, 401);
        assert.equal(body.code, 'INVALID_STAFF_CREDENTIALS');
        assert.equal(
          body.error,
          'Thông tin cửa hàng, tên đăng nhập hoặc mật khẩu không chính xác.'
        );
      } else {
        // Attempts 6..20 are rate-limited even though every username is brand new!
        assert.equal(res.status, 429);
        assert.equal(body.code, 'STAFF_LOGIN_RATE_LIMITED');
        assert.ok(body.retryAfterSec > 0);
      }
    }

    const dummyAfterUnknownUsers =
      getDummyStaffPasswordVerificationCountForTest();
    assert.equal(
      dummyAfterUnknownUsers - dummyBeforeUnknownUsers,
      STAFF_LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
      'dummy scrypt password verification must run on each allowed unknown-user attempt and be skipped once rate-limited'
    );
    assert.equal(
      rateLimitRows.size,
      1,
      '20 distinct unknown usernames for a known shop must create only 1 row in staff_login_rate_limits'
    );
    assert.equal(rateLimitRows.has(expectedShopUnknownUserKey), true);

    // 2. Many distinct unknown shop identifiers collapse to ONE fixed global bucket
    const dummyBeforeUnknownShops =
      getDummyStaffPasswordVerificationCountForTest();

    for (let i = 0; i < 20; i += 1) {
      const randomShop =
        i === 2
          ? ''
          : i % 2 === 0
            ? `nonexistent-shop-${i}-${Date.now()}`
            : `https://qlaok.vn/s/fake-slug-${i}/menu`;
      const randomUser = `arbitrary_bot_user_${i}`;
      const res = await authPost(
        jsonReq('http://localhost:3000/api/auth', 'POST', {
          action: 'staff_login',
          shopIdentifier: randomShop,
          username: randomUser,
          password: `BotPass#${i}`,
        })
      );
      const body = await res.json();
      if (i < STAFF_LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
        assert.equal(res.status, 401);
        assert.equal(body.code, 'INVALID_STAFF_CREDENTIALS');
        assert.equal(
          body.error,
          'Thông tin cửa hàng, tên đăng nhập hoặc mật khẩu không chính xác.'
        );
      } else {
        // Attempts 6..20 are rate-limited even though every shopIdentifier and username is brand new!
        assert.equal(res.status, 429);
        assert.equal(body.code, 'STAFF_LOGIN_RATE_LIMITED');
        assert.ok(body.retryAfterSec > 0);
      }
    }

    const dummyAfterUnknownShops =
      getDummyStaffPasswordVerificationCountForTest();
    assert.equal(
      dummyAfterUnknownShops - dummyBeforeUnknownShops,
      STAFF_LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
      'dummy scrypt password verification must run on each allowed unknown-shop attempt and be skipped once rate-limited'
    );
    assert.equal(
      rateLimitRows.size,
      2,
      '20 distinct unknown shops + 20 distinct unknown usernames must produce at most 2 total rows (1 shop-unknown-user + 1 global-unknown-shop)'
    );
    assert.equal(rateLimitRows.has(expectedUnknownShopKey), true);

    // 3. Real staff accounts remain isolated from the blocked unknown-user and unknown-shop buckets, and from each other
    // Exhaust real_cashier_a's bucket (5 failed attempts)
    for (let attempt = 1; attempt <= STAFF_LOGIN_RATE_LIMIT_MAX_ATTEMPTS; attempt += 1) {
      const badARes = await authPost(
        jsonReq('http://localhost:3000/api/auth', 'POST', {
          action: 'staff_login',
          shopIdentifier: 'pho-hoi-an',
          username: 'real_cashier_a',
          password: `WrongPassA#${attempt}`,
        })
      );
      assert.equal(badARes.status, 401);
      assert.equal((await badARes.json()).code, 'INVALID_STAFF_CREDENTIALS');
    }
    const blockedARes = await authPost(
      jsonReq('http://localhost:3000/api/auth', 'POST', {
        action: 'staff_login',
        shopIdentifier: 'pho-hoi-an',
        username: 'real_cashier_a',
        password: 'CashierAPass#123',
      })
    );
    assert.equal(blockedARes.status, 429);

    // Inactive real staff credential uses its own account bucket (isolated from unknown-user bucket)
    const inactiveAttemptRes = await authPost(
      jsonReq('http://localhost:3000/api/auth', 'POST', {
        action: 'staff_login',
        shopIdentifier: 'pho-hoi-an',
        username: 'inactive_staff_c',
        password: 'InactiveCPass#123',
      })
    );
    assert.equal(inactiveAttemptRes.status, 401);
    assert.equal(rateLimitRows.get(expectedInactiveCKey)?.failure_count, 1);

    // Meanwhile, real_barista_b is completely unaffected by unknown-shop, unknown-user, and real_cashier_a blocks!
    const badBRes = await authPost(
      jsonReq('http://localhost:3000/api/auth', 'POST', {
        action: 'staff_login',
        shopIdentifier: 'pho-hoi-an',
        username: 'real_barista_b',
        password: 'WrongBaristaPassword',
      })
    );
    assert.equal(badBRes.status, 401);
    assert.equal(rateLimitRows.get(expectedStaffBKey)?.failure_count, 1);

    // Total rows across all buckets is bounded by 1 (unknown shop) + 1 (shop unknown user) + 3 (real credentials) = 5
    assert.equal(rateLimitRows.size, 5);

    // Ensure no raw shop slug, username, password, or IP exists anywhere in rateLimitRows
    const serializedAllRows = JSON.stringify(Array.from(rateLimitRows.values()));
    assert.equal(serializedAllRows.includes('pho-hoi-an'), false);
    assert.equal(serializedAllRows.includes('shop-fnb-001'), false);
    assert.equal(serializedAllRows.includes('real_cashier_a'), false);
    assert.equal(serializedAllRows.includes('real_barista_b'), false);
    assert.equal(serializedAllRows.includes('inactive_staff_c'), false);
    assert.equal(serializedAllRows.includes('bot_unknown_user'), false);
    assert.equal(serializedAllRows.includes('nonexistent-shop'), false);

    // Successful login by real_barista_b clears ONLY real_barista_b's bucket
    const okBRes = await authPost(
      jsonReq('http://localhost:3000/api/auth', 'POST', {
        action: 'staff_login',
        shopIdentifier: 'pho-hoi-an',
        username: 'real_barista_b',
        password: 'BaristaBPass#123',
      })
    );
    assert.equal(okBRes.status, 200);
    assert.equal(rateLimitRows.has(expectedStaffBKey), false);
    assert.equal(
      rateLimitRows.has(expectedStaffAKey),
      true,
      'successful login on account B must not clear account A bucket'
    );
    assert.equal(
      rateLimitRows.has(expectedShopUnknownUserKey),
      true,
      'successful login on account B must not clear shop unknown-user bucket'
    );

    // Deleting staffB after recording another failure clears staffB's bucket
    await authPost(
      jsonReq('http://localhost:3000/api/auth', 'POST', {
        action: 'staff_login',
        shopIdentifier: 'pho-hoi-an',
        username: 'real_barista_b',
        password: 'WrongAgain#123',
      })
    );
    assert.equal(rateLimitRows.has(expectedStaffBKey), true);
    const deleteBRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'delete_staff_member',
          shop_id: 'shop-fnb-001',
          user_id: staffB.user_id,
        },
        ownerToken
      )
    );
    assert.equal(deleteBRes.status, 200);
    assert.equal(
      rateLimitRows.has(expectedStaffBKey),
      false,
      'deleting a staff account must clear its rate-limit bucket'
    );

    // Renaming staffA's username clears the old username's bucket
    const renameARes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'update_staff_member',
          shop_id: 'shop-fnb-001',
          user_id: staffA.user_id,
          username: 'real_cashier_a_renamed',
        },
        ownerToken
      )
    );
    assert.equal(renameARes.status, 200);
    assert.equal(
      rateLimitRows.has(expectedStaffAKey),
      false,
      'renaming a staff account must clear the old username bucket so no orphan row remains'
    );

    // Finite cooldown recovery on unknown-user and unknown-shop buckets after 15 minutes
    currentClockMs += (STAFF_LOGIN_RATE_LIMIT_BLOCK_SECONDS + 5) * 1000;
    const recoveredUnknownUserRes = await authPost(
      jsonReq('http://localhost:3000/api/auth', 'POST', {
        action: 'staff_login',
        shopIdentifier: 'pho-hoi-an',
        username: 'fresh_unknown_after_cooldown',
        password: 'AnyPass#123',
      })
    );
    assert.equal(
      recoveredUnknownUserRes.status,
      401,
      'unknown-user bucket must recover from temporary cooldown after block window elapses'
    );
    assert.equal(
      rateLimitRows.get(expectedShopUnknownUserKey)?.failure_count,
      1
    );

    const recoveredUnknownShopRes = await authPost(
      jsonReq('http://localhost:3000/api/auth', 'POST', {
        action: 'staff_login',
        shopIdentifier: 'fresh-unknown-shop-after-cooldown',
        username: 'any_user',
        password: 'AnyPass#123',
      })
    );
    assert.equal(
      recoveredUnknownShopRes.status,
      401,
      'unknown-shop bucket must recover from temporary cooldown after block window elapses'
    );
    assert.equal(rateLimitRows.get(expectedUnknownShopKey)?.failure_count, 1);
  } finally {
    clearInMemoryStaffCredentialsForTest();
    setShopMembershipDbClientForTest(null);
    setSupabaseDbClientForTests(null);
  }
});

test('injected DB failures during staff create, update, deactivate, password reset, and delete roll back multi-row state so partial writes never succeed and accounts stay coherent', async () => {
  const credentialRows = new Map<string, Record<string, unknown>>();
  const membershipRows = new Map<string, Record<string, unknown>>();
  const rateLimitRows = new Map<string, Record<string, unknown>>();

  let injectMembershipUpsertError: string | null = null;
  let injectMembershipDeleteError: string | null = null;
  let injectCredentialRestoreError: string | null = null;

  const shopFixture = {
    id: 'shop-fnb-001',
    owner_id: 'owner-demo-001',
    slug: 'pho-hoi-an',
    name: 'Phở & Cà Phê Phố Cổ',
    is_published: true,
  };

  const mockSb = {
    from(table: string) {
      if (table === 'shops') {
        return {
          select() {
            const filters: Array<(r: Record<string, unknown>) => boolean> = [];
            const chain = {
              eq(col: string, val: string) {
                filters.push((r) => r[col] === val);
                return chain;
              },
              async single() {
                const matched = [shopFixture].find((r) =>
                  filters.every((fn) => fn(r))
                );
                return { data: matched || null, error: null };
              },
              async maybeSingle() {
                const matched = [shopFixture].find((r) =>
                  filters.every((fn) => fn(r))
                );
                return { data: matched || null, error: null };
              },
            };
            return chain;
          },
        };
      }

      if (table === 'shop_staff_credentials') {
        return {
          select() {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return chain;
              },
              async maybeSingle() {
                for (const row of credentialRows.values()) {
                  const matches = Object.entries(filters).every(
                    ([k, v]) => row[k] === v
                  );
                  if (matches) return { data: { ...row }, error: null };
                }
                return { data: null, error: null };
              },
            };
            return chain;
          },
          async insert(payload: Record<string, unknown>) {
            if (injectCredentialRestoreError) {
              return {
                data: null,
                error: { message: injectCredentialRestoreError },
              };
            }
            for (const existing of credentialRows.values()) {
              if (
                existing.shop_id === payload.shop_id &&
                existing.username === payload.username
              ) {
                return {
                  data: null,
                  error: {
                    message: 'duplicate key value violates unique constraint',
                  },
                };
              }
            }
            credentialRows.set(String(payload.user_id), { ...payload });
            return { data: [payload], error: null };
          },
          update(patch: Record<string, unknown>) {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                if (Object.keys(filters).length >= 2) {
                  for (const row of credentialRows.values()) {
                    if (
                      Object.entries(filters).every(([k, v]) => row[k] === v)
                    ) {
                      credentialRows.set(String(row.user_id), {
                        ...row,
                        ...patch,
                      });
                    }
                  }
                  return Promise.resolve({ data: [], error: null });
                }
                return chain;
              },
            };
            return chain;
          },
          delete() {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                if (Object.keys(filters).length >= 2) {
                  let count = 0;
                  for (const [k, row] of credentialRows.entries()) {
                    if (
                      Object.entries(filters).every(([fk, fv]) => row[fk] === fv)
                    ) {
                      credentialRows.delete(k);
                      count += 1;
                    }
                  }
                  return Promise.resolve({ data: [], error: null, count });
                }
                return chain;
              },
            };
            return chain;
          },
        };
      }

      if (table === 'shop_memberships') {
        return {
          select() {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                const rows = Array.from(membershipRows.values()).filter((r) =>
                  Object.entries(filters).every(([k, v]) => r[k] === v)
                );
                return Object.assign(
                  Promise.resolve({ data: rows, error: null }),
                  chain
                );
              },
            };
            return chain;
          },
          async upsert(payload: Record<string, unknown>) {
            if (injectMembershipUpsertError) {
              return {
                data: null,
                error: { message: injectMembershipUpsertError },
              };
            }
            const key = `${payload.shop_id}:${payload.user_id}`;
            const prev = membershipRows.get(key) || {};
            const merged = { ...prev, ...payload };
            membershipRows.set(key, merged);
            return { data: [merged], error: null };
          },
          delete() {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                if (Object.keys(filters).length >= 2) {
                  if (injectMembershipDeleteError) {
                    return Promise.resolve({
                      data: null,
                      error: { message: injectMembershipDeleteError },
                      count: 0,
                    });
                  }
                  let count = 0;
                  for (const [k, row] of membershipRows.entries()) {
                    if (
                      Object.entries(filters).every(([fk, fv]) => row[fk] === fv)
                    ) {
                      membershipRows.delete(k);
                      count += 1;
                    }
                  }
                  return Promise.resolve({ data: [], error: null, count });
                }
                return chain;
              },
            };
            return chain;
          },
        };
      }

      if (table === 'staff_login_rate_limits') {
        return {
          select() {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return chain;
              },
              async maybeSingle() {
                const key = String(filters.bucket_key || '');
                const found = rateLimitRows.get(key);
                return { data: found ? { ...found } : null, error: null };
              },
            };
            return Object.assign(
              Promise.resolve({
                data: Array.from(rateLimitRows.values()),
                error: null,
              }),
              chain
            );
          },
          async upsert(payload: Record<string, unknown>) {
            rateLimitRows.set(String(payload.bucket_key), { ...payload });
            return { data: [payload], error: null };
          },
          delete() {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                rateLimitRows.delete(String(filters.bucket_key || ''));
                return Promise.resolve({ data: [], error: null });
              },
            };
            return chain;
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;

  setShopMembershipDbClientForTest(mockSb);
  setSupabaseDbClientForTests(mockSb);

  const ownerToken = issueSessionToken({
    id: 'owner-demo-001',
    email: 'chuquan@qlaok.vn',
    role: 'owner',
  });

  try {
    // 1. Injected failure during create_staff_member (membership upsert fails after credential insert)
    injectMembershipUpsertError = 'simulated membership insert failure';
    const failedCreateRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'create_staff_member',
          shop_id: 'shop-fnb-001',
          username: 'atomic_create_fail',
          password: 'StaffPass#123',
          role: 'staff',
        },
        ownerToken
      )
    );
    assert.equal(failedCreateRes.status, 500);
    assert.equal(
      credentialRows.size,
      0,
      'credential row must be rolled back when membership creation fails'
    );
    assert.equal(membershipRows.size, 0);
    injectMembershipUpsertError = null;

    // Now create a valid staff member
    const okCreateRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'create_staff_member',
          shop_id: 'shop-fnb-001',
          username: 'coherent_staff',
          password: 'InitialPass#123',
          full_name: 'Nhân Viên Nhất Quán',
          role: 'cashier',
          permissions: ['orders.view', 'payment.collect'],
        },
        ownerToken
      )
    );
    assert.equal(okCreateRes.status, 201);
    const staffMem = (await okCreateRes.json()).membership;
    const initialCred = await dbGetShopStaffCredentialByUserId(
      'shop-fnb-001',
      staffMem.user_id
    );
    assert.ok(initialCred);
    assert.equal(initialCred.role, 'cashier');
    assert.equal(initialCred.is_active, true);
    assert.equal(initialCred.session_version, 1);

    // 2. Injected failure during update_staff_member (role/username/permission update) rolls back credential changes
    injectMembershipUpsertError = 'simulated membership update failure';
    const failedUpdateRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'update_staff_member',
          shop_id: 'shop-fnb-001',
          user_id: staffMem.user_id,
          username: 'renamed_staff_fail',
          full_name: 'Tên Mới Lỗi',
          role: 'staff',
          permissions: ['orders.view'],
        },
        ownerToken
      )
    );
    assert.equal(failedUpdateRes.status, 500);
    injectMembershipUpsertError = null;

    const credAfterFailedUpdate = await dbGetShopStaffCredentialByUserId(
      'shop-fnb-001',
      staffMem.user_id
    );
    assert.ok(credAfterFailedUpdate);
    assert.equal(credAfterFailedUpdate.username, 'coherent_staff');
    assert.equal(credAfterFailedUpdate.full_name, 'Nhân Viên Nhất Quán');
    assert.equal(credAfterFailedUpdate.role, 'cashier');
    assert.equal(credAfterFailedUpdate.is_active, true);
    assert.equal(credAfterFailedUpdate.session_version, 1);

    // 3. Injected failure during deactivation (is_active: false) rolls back credential so tables do not diverge
    injectMembershipUpsertError = 'simulated membership deactivation failure';
    const failedDeactivateRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'update_staff_member',
          shop_id: 'shop-fnb-001',
          user_id: staffMem.user_id,
          is_active: false,
        },
        ownerToken
      )
    );
    assert.equal(failedDeactivateRes.status, 500);
    injectMembershipUpsertError = null;

    const credAfterFailedDeactivate = await dbGetShopStaffCredentialByUserId(
      'shop-fnb-001',
      staffMem.user_id
    );
    assert.ok(credAfterFailedDeactivate);
    assert.equal(credAfterFailedDeactivate.is_active, true);
    assert.equal(credAfterFailedDeactivate.session_version, 1);

    // 4. Injected failure during reset_staff_password rolls back password_hash and session_version
    injectMembershipUpsertError = 'simulated membership sync failure on password reset';
    const failedResetRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'reset_staff_password',
          shop_id: 'shop-fnb-001',
          user_id: staffMem.user_id,
          new_password: 'ShouldNotPersistPass#999',
        },
        ownerToken
      )
    );
    assert.equal(failedResetRes.status, 500);
    injectMembershipUpsertError = null;

    const credAfterFailedReset = await dbGetShopStaffCredentialByUserId(
      'shop-fnb-001',
      staffMem.user_id
    );
    assert.ok(credAfterFailedReset);
    assert.equal(
      credAfterFailedReset.password_hash,
      initialCred.password_hash,
      'password_hash must be restored when password reset fails midway'
    );
    assert.equal(credAfterFailedReset.session_version, 1);

    // Original password still works and failed password is rejected
    const failedNewPassLogin = await authPost(
      jsonReq('http://localhost:3000/api/auth', 'POST', {
        action: 'staff_login',
        shopIdentifier: 'pho-hoi-an',
        username: 'coherent_staff',
        password: 'ShouldNotPersistPass#999',
      })
    );
    assert.equal(failedNewPassLogin.status, 401);

    const originalPassLogin = await authPost(
      jsonReq('http://localhost:3000/api/auth', 'POST', {
        action: 'staff_login',
        shopIdentifier: 'pho-hoi-an',
        username: 'coherent_staff',
        password: 'InitialPass#123',
      })
    );
    assert.equal(originalPassLogin.status, 200);
    const activeStaffToken = (await originalPassLogin.json())
      .accessToken as string;

    // 5. Injected failure during delete_staff_member (membership delete fails after credential delete) restores credential row
    injectMembershipDeleteError = 'simulated membership delete failure';
    const failedDeleteRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'delete_staff_member',
          shop_id: 'shop-fnb-001',
          user_id: staffMem.user_id,
        },
        ownerToken
      )
    );
    assert.equal(failedDeleteRes.status, 500);
    injectMembershipDeleteError = null;

    const credAfterFailedDelete = await dbGetShopStaffCredentialByUserId(
      'shop-fnb-001',
      staffMem.user_id
    );
    assert.ok(
      credAfterFailedDelete,
      'credential row must be restored when membership delete fails'
    );
    assert.equal(credAfterFailedDelete.username, 'coherent_staff');
    assert.equal(credAfterFailedDelete.password_hash, initialCred.password_hash);

    // 6. Double-failure during delete_staff_member (membership delete fails AND credential restore also fails) fail-safes membership to inactive and denies session
    injectMembershipDeleteError = 'simulated membership delete failure';
    injectCredentialRestoreError = 'simulated credential restore outage';
    const doubleFailedDeleteRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'delete_staff_member',
          shop_id: 'shop-fnb-001',
          user_id: staffMem.user_id,
        },
        ownerToken
      )
    );
    assert.equal(doubleFailedDeleteRes.status, 500);
    injectMembershipDeleteError = null;
    injectCredentialRestoreError = null;

    // Resulting account is safe and fail-closed: cannot pass session check or log in
    const membersAfterDoubleFailure = await dbGetShopMemberships('shop-fnb-001');
    const failSafedMem = membersAfterDoubleFailure.find(
      (m) => m.user_id === staffMem.user_id
    );
    assert.equal(
      failSafedMem?.is_active,
      false,
      'double failure on delete must fail-safe membership to is_active=false'
    );

    const tokenCheckAfterDoubleFailure = await authGet(
      jsonReq(
        'http://localhost:3000/api/auth',
        'GET',
        undefined,
        activeStaffToken
      )
    );
    assert.equal(tokenCheckAfterDoubleFailure.status, 401);
  } finally {
    clearInMemoryStaffCredentialsForTest();
    setShopMembershipDbClientForTest(null);
    setSupabaseDbClientForTests(null);
  }
});

test('atomic SQL RPC path in staff-accounts: delegates create/update/reset/delete and login rate-limiting to service-role RPCs and fails closed or surfaces atomic rollback errors', async () => {
  const credentialRows = new Map<string, Record<string, unknown>>();
  const membershipRows = new Map<string, Record<string, unknown>>();
  const rateLimitRows = new Map<string, Record<string, unknown>>();
  const rpcCalls: string[] = [];

  let injectRpcError: { message: string; code?: string } | null = null;

  const shopFixture = {
    id: 'shop-fnb-001',
    owner_id: 'owner-demo-001',
    slug: 'pho-hoi-an',
    name: 'Phở & Cà Phê Phố Cổ',
    is_published: true,
  };

  const mockSb = {
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push(fn);
      if (injectRpcError) {
        return { data: null, error: injectRpcError };
      }

      if (fn === 'create_shop_staff_account_atomic') {
        const userId = String(args.p_user_id);
        const shopId = String(args.p_shop_id);
        const username = String(args.p_username);
        const role = String(args.p_role);
        const nowIso = new Date().toISOString();

        for (const existing of credentialRows.values()) {
          if (existing.shop_id === shopId && existing.username === username) {
            return {
              data: null,
              error: {
                code: '23505',
                message: `STAFF_USERNAME_EXISTS: Tên đăng nhập "${username}" đã tồn tại trong cửa hàng này.`,
              },
            };
          }
        }

        credentialRows.set(userId, {
          user_id: userId,
          shop_id: shopId,
          username,
          password_hash: args.p_password_hash,
          full_name: args.p_full_name,
          role,
          is_active: args.p_is_active !== false,
          session_version: 1,
          created_by: args.p_created_by,
          created_at: nowIso,
          updated_at: nowIso,
        });

        const memRow = {
          id: args.p_membership_id || `mem-${userId}`,
          shop_id: shopId,
          user_id: userId,
          username,
          full_name: args.p_full_name,
          role,
          permissions: args.p_permissions,
          is_active: args.p_is_active !== false,
          created_at: nowIso,
          updated_at: nowIso,
        };
        membershipRows.set(`${shopId}:${userId}`, memRow);
        return { data: memRow, error: null };
      }

      if (fn === 'update_shop_staff_account_atomic') {
        const shopId = String(args.p_shop_id);
        const userId = String(args.p_user_id);
        const cred = credentialRows.get(userId);
        const mem = membershipRows.get(`${shopId}:${userId}`);
        if (!cred || !mem) {
          return {
            data: null,
            error: {
              message:
                'STAFF_MEMBER_NOT_FOUND: Không tìm thấy tài khoản nhân viên trong cửa hàng này.',
            },
          };
        }
        const nextRole = String(args.p_role ?? cred.role);
        const nextUsername = String(args.p_username ?? cred.username);
        const nextActive =
          typeof args.p_is_active === 'boolean'
            ? args.p_is_active
            : Boolean(cred.is_active);
        const bump =
          (cred.is_active && !nextActive) ||
          cred.role !== nextRole ||
          cred.username !== nextUsername;
        const nextSv = Number(cred.session_version || 1) + (bump ? 1 : 0);

        credentialRows.set(userId, {
          ...cred,
          username: nextUsername,
          full_name: args.p_full_name ?? cred.full_name,
          role: nextRole,
          is_active: nextActive,
          session_version: nextSv,
        });
        const nextMem = {
          ...mem,
          username: nextUsername,
          full_name: args.p_full_name ?? mem.full_name,
          role: nextRole,
          permissions: args.p_permissions ?? mem.permissions,
          is_active: nextActive,
        };
        membershipRows.set(`${shopId}:${userId}`, nextMem);
        return { data: nextMem, error: null };
      }

      if (fn === 'reset_shop_staff_password_atomic') {
        const shopId = String(args.p_shop_id);
        const userId = String(args.p_user_id);
        const cred = credentialRows.get(userId);
        if (!cred) {
          return {
            data: null,
            error: { message: 'STAFF_MEMBER_NOT_FOUND: Không tìm thấy.' },
          };
        }
        const nextSv = Number(cred.session_version || 1) + 1;
        credentialRows.set(userId, {
          ...cred,
          password_hash: args.p_new_password_hash,
          session_version: nextSv,
        });
        if (args.p_rate_limit_bucket_key) {
          rateLimitRows.delete(String(args.p_rate_limit_bucket_key));
        }
        return {
          data: {
            user_id: userId,
            shop_id: shopId,
            username: cred.username,
            session_version: nextSv,
          },
          error: null,
        };
      }

      if (fn === 'delete_shop_staff_account_atomic') {
        const shopId = String(args.p_shop_id);
        const userId = String(args.p_user_id);
        const hadCred = credentialRows.delete(userId);
        const hadMem = membershipRows.delete(`${shopId}:${userId}`);
        return {
          data: { deleted: hadCred || hadMem },
          error: null,
        };
      }

      if (fn === 'check_staff_login_rate_limit_atomic') {
        const key = String(args.p_bucket_key);
        const row = rateLimitRows.get(key);
        if (!row) {
          return {
            data: { allowed: true, failure_count: 0, retry_after_sec: 0 },
            error: null,
          };
        }
        return {
          data: {
            allowed: !row.blocked,
            failure_count: row.failure_count,
            retry_after_sec: row.blocked ? 900 : 0,
          },
          error: null,
        };
      }

      if (fn === 'record_staff_login_failure_atomic') {
        const key = String(args.p_bucket_key);
        const prev = Number(rateLimitRows.get(key)?.failure_count || 0);
        const next = prev + 1;
        const max = Number(args.p_max_attempts || 5);
        const blocked = next >= max;
        rateLimitRows.set(key, { failure_count: next, blocked });
        return {
          data: {
            allowed: next <= max,
            newly_blocked: next === max,
            failure_count: next,
            retry_after_sec: blocked ? 900 : 0,
          },
          error: null,
        };
      }

      if (fn === 'reset_staff_login_rate_limit_atomic') {
        rateLimitRows.delete(String(args.p_bucket_key));
        return { data: true, error: null };
      }

      if (fn === 'cleanup_expired_staff_login_rate_limits') {
        const count = rateLimitRows.size;
        rateLimitRows.clear();
        return { data: count, error: null };
      }

      return { data: null, error: { code: 'PGRST202', message: 'not found' } };
    },
    from(table: string) {
      if (table === 'shops') {
        return {
          select() {
            const filters: Array<(r: Record<string, unknown>) => boolean> = [];
            const chain = {
              eq(col: string, val: string) {
                filters.push((r) => r[col] === val);
                return chain;
              },
              async single() {
                const matched = [shopFixture].find((r) =>
                  filters.every((fn) => fn(r))
                );
                return { data: matched || null, error: null };
              },
              async maybeSingle() {
                const matched = [shopFixture].find((r) =>
                  filters.every((fn) => fn(r))
                );
                return { data: matched || null, error: null };
              },
            };
            return chain;
          },
        };
      }

      if (table === 'shop_staff_credentials') {
        return {
          select() {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return chain;
              },
              async maybeSingle() {
                for (const row of credentialRows.values()) {
                  if (
                    Object.entries(filters).every(([k, v]) => row[k] === v)
                  ) {
                    return { data: { ...row }, error: null };
                  }
                }
                return { data: null, error: null };
              },
            };
            return chain;
          },
          update() {
            const chain = {
              eq() {
                return Promise.resolve({ data: [], error: null });
              },
            };
            return chain;
          },
        };
      }

      if (table === 'shop_memberships') {
        return {
          select() {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                const rows = Array.from(membershipRows.values()).filter((r) =>
                  Object.entries(filters).every(([k, v]) => r[k] === v)
                );
                return Object.assign(
                  Promise.resolve({ data: rows, error: null }),
                  chain
                );
              },
            };
            return chain;
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;

  setShopMembershipDbClientForTest(mockSb);
  setSupabaseDbClientForTests(mockSb);

  const ownerToken = issueSessionToken({
    id: 'owner-demo-001',
    email: 'chuquan@qlaok.vn',
    role: 'owner',
  });

  try {
    const createRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'create_staff_member',
          shop_id: 'shop-fnb-001',
          username: 'rpc_staff_01',
          password: 'RpcPass#123',
          role: 'staff',
        },
        ownerToken
      )
    );
    assert.equal(createRes.status, 201);
    const createdMem = (await createRes.json()).membership;
    assert.ok(rpcCalls.includes('create_shop_staff_account_atomic'));

    // Injected atomic RPC failure on update does not mutate rows and returns 500
    injectRpcError = { message: 'DB_TRANSACTION_ABORTED: deadlock detected' };
    const failedUpdateRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'update_staff_member',
          shop_id: 'shop-fnb-001',
          user_id: createdMem.user_id,
          role: 'cashier',
        },
        ownerToken
      )
    );
    assert.equal(failedUpdateRes.status, 500);
    injectRpcError = null;
    assert.equal(credentialRows.get(createdMem.user_id)?.role, 'staff');

    // Valid atomic RPC update, password reset, login, and delete
    const okUpdateRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'update_staff_member',
          shop_id: 'shop-fnb-001',
          user_id: createdMem.user_id,
          role: 'cashier',
        },
        ownerToken
      )
    );
    assert.equal(okUpdateRes.status, 200);
    assert.ok(rpcCalls.includes('update_shop_staff_account_atomic'));

    const okResetRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'reset_staff_password',
          shop_id: 'shop-fnb-001',
          user_id: createdMem.user_id,
          new_password: 'RpcPass#456',
        },
        ownerToken
      )
    );
    assert.equal(okResetRes.status, 200);
    assert.ok(rpcCalls.includes('reset_shop_staff_password_atomic'));

    const okLoginRes = await authPost(
      jsonReq('http://localhost:3000/api/auth', 'POST', {
        action: 'staff_login',
        shopIdentifier: 'pho-hoi-an',
        username: 'rpc_staff_01',
        password: 'RpcPass#456',
      })
    );
    assert.equal(okLoginRes.status, 200);
    assert.ok(rpcCalls.includes('check_staff_login_rate_limit_atomic'));
    assert.ok(rpcCalls.includes('reset_staff_login_rate_limit_atomic'));

    const okDeleteRes = await shopsPost(
      jsonReq(
        'http://localhost:3000/api/shops',
        'POST',
        {
          action: 'delete_staff_member',
          shop_id: 'shop-fnb-001',
          user_id: createdMem.user_id,
        },
        ownerToken
      )
    );
    assert.equal(okDeleteRes.status, 200);
    assert.ok(rpcCalls.includes('delete_shop_staff_account_atomic'));
  } finally {
    clearInMemoryStaffCredentialsForTest();
    setShopMembershipDbClientForTest(null);
    setSupabaseDbClientForTests(null);
  }
});
