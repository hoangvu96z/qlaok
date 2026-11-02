import assert from 'node:assert/strict';
import test from 'node:test';
import { POST as translate } from '@/app/api/ai/translate/route';
import { setShopMembershipDbClientForTest } from '@/lib/shop-permissions';
import { issueSessionToken } from '@/lib/server-auth';

const shopId = 'shop-ai-auth-review';
const staffId = 'staff-acct-ai-auth-review';

function createMembershipDb(sessionVersion: number, permissions: string[]) {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    shops: [{ id: shopId, owner_id: 'owner-ai-auth-review' }],
    shop_memberships: [
      {
        id: 'membership-ai-auth-review',
        shop_id: shopId,
        user_id: staffId,
        username: 'reviewstaff',
        role: 'cashier',
        permissions,
        is_active: true,
      },
    ],
    shop_staff_credentials: [
      {
        shop_id: shopId,
        user_id: staffId,
        username: 'reviewstaff',
        role: 'cashier',
        is_active: true,
        session_version: sessionVersion,
      },
    ],
  };

  return {
    from(table: string) {
      const filters: Array<{ column: string; value: unknown }> = [];
      const matches = (row: Record<string, unknown>) =>
        filters.every(({ column, value }) => row[column] === value);
      const rows = () => (tables[table] || []).filter(matches);
      const query = {
        select() {
          return query;
        },
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          return query;
        },
        maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ data: rows(), error: null }).then(resolve);
        },
      };
      return query;
    },
  };
}

function staffToken(sessionVersion: number) {
  return issueSessionToken({
    id: staffId,
    email: 'staff@example.test',
    username: 'reviewstaff',
    shop_id: shopId,
    account_type: 'staff',
    role: 'cashier',
    session_version: sessionVersion,
  });
}

function translationRequest(token: string, purpose = 'catalog') {
  return new Request('http://localhost/api/ai/translate', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ shopId, purpose, itemNameVi: 'Phở bò' }),
  });
}

test('paid AI translation rejects a staff session after its credential version changes', async () => {
  setShopMembershipDbClientForTest(createMembershipDb(2, ['catalog.manage']) as never);
  try {
    const response = await translate(translationRequest(staffToken(1)));
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, 'STAFF_SESSION_REVOKED');
  } finally {
    setShopMembershipDbClientForTest(null);
  }
});

test('catalog translation requires catalog.manage for the requested shop', async () => {
  setShopMembershipDbClientForTest(createMembershipDb(2, ['orders.view']) as never);
  try {
    const response = await translate(translationRequest(staffToken(2)));
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.equal(body.code, 'INSUFFICIENT_SHOP_PERMISSION');
    assert.deepEqual(body.requiredPermissions, ['catalog.manage']);
  } finally {
    setShopMembershipDbClientForTest(null);
  }
});

test('promotion translation requires promotions.manage and accepts that permission without catalog.manage', async () => {
  setShopMembershipDbClientForTest(
    createMembershipDb(2, ['promotions.manage']) as never
  );
  try {
    const response = await translate(
      new Request('http://localhost/api/ai/translate', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${staffToken(2)}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          shopId,
          purpose: 'promotion',
          itemNameVi: '',
        }),
      })
    );
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Vui lòng nhập tên món/);
  } finally {
    setShopMembershipDbClientForTest(null);
  }
});

test('paid AI translation rejects a missing shopId and unknown purpose before translating', async () => {
  setShopMembershipDbClientForTest(
    createMembershipDb(2, ['catalog.manage']) as never
  );
  try {
    const missingShopResponse = await translate(
      new Request('http://localhost/api/ai/translate', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${staffToken(2)}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ itemNameVi: 'Phở bò' }),
      })
    );
    assert.equal(missingShopResponse.status, 400);
    assert.equal((await missingShopResponse.json()).code, 'SHOP_ID_REQUIRED');

    const invalidPurposeResponse = await translate(
      new Request('http://localhost/api/ai/translate', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${staffToken(2)}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ shopId, purpose: 'admin', itemNameVi: 'Phở bò' }),
      })
    );
    assert.equal(invalidPurposeResponse.status, 400);
    assert.equal(
      (await invalidPurposeResponse.json()).code,
      'INVALID_TRANSLATION_PURPOSE'
    );
  } finally {
    setShopMembershipDbClientForTest(null);
  }
});
