import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePostLoginRoute,
  sanitizeNextPath,
} from '@/lib/post-login-route';

describe('staff first-login routing and next-path sanitization', () => {
  it('routes member-only staff with no safe next path directly to /dashboard/orders with active member shop', () => {
    const result = resolvePostLoginRoute({
      isAdmin: false,
      shops: [],
      memberShops: [{ id: 'shop-member-1' }, { id: 'shop-member-2' }],
    });
    assert.deepEqual(result, {
      path: '/dashboard/orders',
      activeShopId: 'shop-member-1',
    });
  });

  it('routes member-only staff to /dashboard/orders when next param is unsafe or targets /admin', () => {
    for (const unsafeNext of [
      null,
      undefined,
      '',
      'https://evil.example/phish',
      '//evil.example/phish',
      '/\\evil.example',
      '/login',
      '/onboarding',
      '/admin',
      '/admin/users',
    ]) {
      const result = resolvePostLoginRoute(
        {
          shops: null,
          memberShops: [{ id: 'shop-member-1' }],
        },
        unsafeNext
      );
      assert.deepEqual(result, {
        path: '/dashboard/orders',
        activeShopId: 'shop-member-1',
      });
    }
  });

  it('preserves safe next path for member-only staff while keeping active member shop', () => {
    const result = resolvePostLoginRoute(
      {
        shops: [],
        memberShops: [{ id: 'shop-member-1' }],
      },
      '/dashboard/orders?tab=active#top'
    );
    assert.deepEqual(result, {
      path: '/dashboard/orders?tab=active#top',
      activeShopId: 'shop-member-1',
    });
  });

  it('keeps owners at /dashboard by default and prefers owned shop when user also has memberShops', () => {
    const ownerOnly = resolvePostLoginRoute({
      shops: [{ id: 'shop-owned-1' }],
      memberShops: [],
    });
    assert.deepEqual(ownerOnly, {
      path: '/dashboard',
      activeShopId: 'shop-owned-1',
    });

    const ownerAndMember = resolvePostLoginRoute({
      shops: [{ id: 'shop-owned-1' }],
      memberShops: [{ id: 'shop-member-1' }],
    });
    assert.deepEqual(ownerAndMember, {
      path: '/dashboard',
      activeShopId: 'shop-owned-1',
    });
  });

  it('keeps admins at /admin and zero-shop users at /onboarding', () => {
    assert.deepEqual(
      resolvePostLoginRoute(
        {
          isAdmin: true,
          shops: [{ id: 'shop-owned-1' }],
          memberShops: [{ id: 'shop-member-1' }],
        },
        '/dashboard/orders'
      ),
      { path: '/admin', activeShopId: null }
    );

    assert.deepEqual(
      resolvePostLoginRoute({
        isAdmin: false,
        shops: [],
        memberShops: [],
      }),
      { path: '/onboarding', activeShopId: null }
    );
  });

  it('preserves URL sanitization rules in sanitizeNextPath', () => {
    assert.equal(
      sanitizeNextPath('/dashboard/orders?x=1#section'),
      '/dashboard/orders?x=1#section'
    );
    assert.equal(sanitizeNextPath('https://evil.com/dashboard'), null);
    assert.equal(sanitizeNextPath('//evil.com/dashboard'), null);
    assert.equal(sanitizeNextPath('/\\evil.com'), null);
    assert.equal(sanitizeNextPath('/login?next=/dashboard'), null);
    assert.equal(sanitizeNextPath('/onboarding/step-1'), null);
  });
});
