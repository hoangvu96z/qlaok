import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  dbDeleteShopMembership,
  dbGetShopMemberships,
  dbGetUserShopMemberships,
  dbUpsertShopMembership,
  isShopMembershipDbAuthoritative,
  resolveUserShopMembership,
  setShopMembershipDbClientForTest,
} from '@/lib/shop-permissions';

interface MockRow {
  id: string;
  shop_id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  permissions: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

function createInMemorySupabaseMock(options?: {
  initialMemberships?: MockRow[];
  shops?: Array<{ id: string; owner_id: string }>;
  failSelect?: boolean;
  failUpsert?: boolean;
  failDelete?: boolean;
}) {
  const rows: MockRow[] = [...(options?.initialMemberships || [])];
  const shops = [...(options?.shops || [{ id: 'shop-fnb-001', owner_id: 'owner-db-001' }])];
  const upsertedPayloads: Array<Record<string, unknown>> = [];

  const client = {
    from(table: string) {
      if (table === 'shops') {
        return {
          select(_cols: string) {
            return {
              eq(col: string, val: string) {
                return {
                  async maybeSingle() {
                    if (options?.failSelect) {
                      return {
                        data: null,
                        error: { message: 'Simulated DB shop select failure' },
                      };
                    }
                    const found = shops.find(
                      (s) => (s as Record<string, string>)[col] === val
                    );
                    return { data: found || null, error: null };
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'shop_memberships') {
        return {
          select(_cols: string) {
            const filters: Array<[string, unknown]> = [];
            const builder = {
              eq(col: string, val: unknown) {
                filters.push([col, val]);
                return builder;
              },
              then(
                onFulfilled: (value: {
                  data: MockRow[] | null;
                  error: { message: string } | null;
                }) => unknown,
                onRejected?: (reason: unknown) => unknown
              ) {
                if (options?.failSelect) {
                  return Promise.resolve({
                    data: null,
                    error: { message: 'Simulated DB membership select failure' },
                  }).then(onFulfilled, onRejected);
                }
                const matched = rows.filter((r) =>
                  filters.every(
                    ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v
                  )
                );
                return Promise.resolve({ data: matched, error: null }).then(
                  onFulfilled,
                  onRejected
                );
              },
            };
            return builder;
          },

          async upsert(
            payload: Record<string, unknown>,
            _opts?: { onConflict?: string }
          ) {
            upsertedPayloads.push(payload);
            if (options?.failUpsert) {
              return {
                data: null,
                error: { message: 'Simulated DB upsert error' },
              };
            }
            const nextRow: MockRow = {
              id: String(payload.id),
              shop_id: String(payload.shop_id),
              user_id: String(payload.user_id),
              email: (payload.email as string | null) ?? null,
              full_name: (payload.full_name as string | null) ?? null,
              role: String(payload.role),
              permissions: Array.isArray(payload.permissions)
                ? (payload.permissions as string[])
                : [],
              is_active: payload.is_active !== false,
              created_at: String(payload.created_at),
              updated_at: String(payload.updated_at),
            };
            const idx = rows.findIndex(
              (r) =>
                r.shop_id === nextRow.shop_id && r.user_id === nextRow.user_id
            );
            if (idx !== -1) {
              rows[idx] = nextRow;
            } else {
              rows.push(nextRow);
            }
            return { data: [nextRow], error: null };
          },

          delete(_opts?: { count?: string }) {
            const filters: Array<[string, unknown]> = [];
            const builder = {
              eq(col: string, val: unknown) {
                filters.push([col, val]);
                return builder;
              },
              then(
                onFulfilled: (value: {
                  data: MockRow[] | null;
                  error: { message: string } | null;
                  count: number | null;
                }) => unknown,
                onRejected?: (reason: unknown) => unknown
              ) {
                if (options?.failDelete) {
                  return Promise.resolve({
                    data: null,
                    error: { message: 'Simulated DB delete error' },
                    count: null,
                  }).then(onFulfilled, onRejected);
                }
                const before = rows.length;
                const removed: MockRow[] = [];
                for (let i = rows.length - 1; i >= 0; i--) {
                  const match = filters.every(
                    ([k, v]) =>
                      (rows[i] as unknown as Record<string, unknown>)[k] === v
                  );
                  if (match) {
                    removed.push(...rows.splice(i, 1));
                  }
                }
                return Promise.resolve({
                  data: removed,
                  error: null,
                  count: before - rows.length,
                }).then(onFulfilled, onRejected);
              },
            };
            return builder;
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return {
    client: client as unknown as SupabaseClient,
    rows,
    upsertedPayloads,
  };
}

describe('Blocker 1: Authoritative & Fail-Closed Shop Memberships when Supabase is Configured', () => {
  test('1.1 When Supabase is configured, DB is authoritative and never unions local demo memberships', async () => {
    // Ensure a local membership exists in .local-db first (in local mode)
    setShopMembershipDbClientForTest(null);
    await dbUpsertShopMembership({
      shop_id: 'shop-fnb-001',
      user_id: 'local-only-ghost-staff',
      email: 'ghost@qlaok.vn',
      full_name: 'Ghost Local Staff',
      role: 'staff',
    });

    // Now switch to authoritative DB mode where local-only-ghost-staff and staff-demo-001 do NOT exist
    const { client } = createInMemorySupabaseMock({
      initialMemberships: [
        {
          id: 'mem-db-cashier-1',
          shop_id: 'shop-fnb-001',
          user_id: 'db-cashier-001',
          email: 'cashier.db@qlaok.vn',
          full_name: 'Thu Ngân DB',
          role: 'cashier',
          permissions: ['orders.view', 'payment.collect'],
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    });
    setShopMembershipDbClientForTest(client);

    try {
      assert.equal(isShopMembershipDbAuthoritative(), true);

      const shopMembers = await dbGetShopMemberships('shop-fnb-001');
      assert.equal(shopMembers.length, 1);
      assert.equal(shopMembers[0].user_id, 'db-cashier-001');

      // Local demo user and local-only-ghost-staff must NOT be resolved when DB is authoritative
      const ghostResolved = await resolveUserShopMembership({
        userId: 'local-only-ghost-staff',
        shopId: 'shop-fnb-001',
      });
      assert.equal(ghostResolved, null);

      const demoStaffResolved = await resolveUserShopMembership({
        userId: 'staff-demo-001',
        shopId: 'shop-fnb-001',
      });
      assert.equal(demoStaffResolved, null);

      const ghostUserMemberships = await dbGetUserShopMemberships(
        'local-only-ghost-staff'
      );
      assert.deepEqual(ghostUserMemberships, []);
    } finally {
      setShopMembershipDbClientForTest(null);
      await dbDeleteShopMembership('shop-fnb-001', 'local-only-ghost-staff');
    }
  });

  test('1.2 Revoking (is_active=false) or deleting a membership in DB immediately blocks access without local fallback', async () => {
    const { client,upsertedPayloads } = createInMemorySupabaseMock({
      initialMemberships: [],
    });
    setShopMembershipDbClientForTest(client);

    try {
      const created = await dbUpsertShopMembership({
        shop_id: 'shop-fnb-001',
        user_id: 'staff-revoke-test',
        email: 'revoke@qlaok.vn',
        full_name: 'Nhân Viên Thử Thu Hồi',
        role: 'staff',
      });
      assert.equal(created.email, 'revoke@qlaok.vn');
      assert.equal(created.full_name, 'Nhân Viên Thử Thu Hồi');
      assert.equal(upsertedPayloads.length, 1);
      assert.equal(upsertedPayloads[0].email, 'revoke@qlaok.vn');
      assert.equal(upsertedPayloads[0].full_name, 'Nhân Viên Thử Thu Hồi');

      const activeMem = await resolveUserShopMembership({
        userId: 'staff-revoke-test',
        shopId: 'shop-fnb-001',
      });
      assert.ok(activeMem);
      assert.equal(activeMem.is_active, true);

      // Revoke membership (is_active: false)
      await dbUpsertShopMembership({
        shop_id: 'shop-fnb-001',
        user_id: 'staff-revoke-test',
        email: 'revoke@qlaok.vn',
        full_name: 'Nhân Viên Thử Thu Hồi',
        role: 'staff',
        is_active: false,
      });

      const afterRevoke = await resolveUserShopMembership({
        userId: 'staff-revoke-test',
        shopId: 'shop-fnb-001',
      });
      assert.equal(afterRevoke, null, 'Revoked member must be denied access');

      const activeList = await dbGetUserShopMemberships('staff-revoke-test');
      assert.deepEqual(activeList, []);

      // Re-activate then delete
      await dbUpsertShopMembership({
        shop_id: 'shop-fnb-001',
        user_id: 'staff-revoke-test',
        role: 'staff',
        is_active: true,
      });
      const deleted = await dbDeleteShopMembership(
        'shop-fnb-001',
        'staff-revoke-test'
      );
      assert.equal(deleted, true);

      const afterDelete = await resolveUserShopMembership({
        userId: 'staff-revoke-test',
        shopId: 'shop-fnb-001',
      });
      assert.equal(afterDelete, null, 'Deleted member must be denied access');
    } finally {
      setShopMembershipDbClientForTest(null);
    }
  });

  test('1.3 DB read failure fails closed (returns empty/null) and DB write failure throws instead of swallowing', async () => {
    const { client } = createInMemorySupabaseMock({
      failSelect: true,
      failUpsert: true,
      failDelete: true,
    });
    setShopMembershipDbClientForTest(client);

    try {
      // Read errors fail closed (do not fallback to SEED_SHOPS or local memberships)
      const shopMembers = await dbGetShopMemberships('shop-fnb-001');
      assert.deepEqual(shopMembers, []);

      const userMembers = await dbGetUserShopMemberships('owner-demo-001');
      assert.deepEqual(userMembers, []);

      const resolvedOwnerSeed = await resolveUserShopMembership({
        userId: 'owner-demo-001',
        shopId: 'shop-fnb-001',
      });
      assert.equal(
        resolvedOwnerSeed,
        null,
        'When DB shop lookup fails, must fail closed instead of falling back to SEED_SHOPS'
      );

      // Write errors must throw and never report fake success
      await assert.rejects(
        async () => {
          await dbUpsertShopMembership({
            shop_id: 'shop-fnb-001',
            user_id: 'staff-write-fail',
            role: 'staff',
          });
        },
        /DB_UPSERT_MEMBERSHIP_FAILED/
      );

      await assert.rejects(
        async () => {
          await dbDeleteShopMembership('shop-fnb-001', 'staff-write-fail');
        },
        /DB_DELETE_MEMBERSHIP_FAILED/
      );
    } finally {
      setShopMembershipDbClientForTest(null);
    }
  });
});
