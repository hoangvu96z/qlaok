import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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

describe('onboarding existing-shops modal member-only own-store CTA and owner branch isolation', () => {
  it('renders "Tạo cửa hàng riêng" / "Create your own store" CTA for member-only staff and reserves branch creation for owners', () => {
    const onboardingSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/(auth)/onboarding/page.tsx'),
      'utf8'
    );

    // Existing shops modal guard and dashboard navigation remain intact
    assert.match(onboardingSource, /if\s*\(\s*existingShops\s*\)\s*\{/);
    assert.match(onboardingSource, /data-testid="onboarding-existing-shops"/);
    assert.match(onboardingSource, /data-testid="onboarding-go-dashboard"/);

    // Member-only CTA: visible only when owned === 0 && member > 0
    assert.match(
      onboardingSource,
      /existingShops\.owned\s*===\s*0\s*&&\s*existingShops\.member\s*>\s*0/
    );
    assert.match(onboardingSource, /data-testid="onboarding-create-own-shop"/);
    assert.match(
      onboardingSource,
      /tx\(\s*['"]Tạo cửa hàng riêng['"]\s*,\s*['"]Create your own store['"]\s*\)/
    );

    // Clicking member-only CTA clears existingShops blocker to reveal wizard
    const memberCtaMatch =
      onboardingSource.match(
        /<button[^>]*data-testid="onboarding-create-own-shop"[^>]*>[\s\S]*?<\/button>/
      ) ||
      onboardingSource.match(
        /<button[\s\S]*?data-testid="onboarding-create-own-shop"[\s\S]*?<\/button>/
      );
    assert.ok(memberCtaMatch, 'member-only CTA button markup must be present');
    assert.match(
      memberCtaMatch[0],
      /onClick=\{\s*\(\)\s*=>\s*setExistingShops\(null\)\s*\}/
    );

    // Owner branch CTA: preserved and restricted to owners (owned > 0)
    assert.match(onboardingSource, /existingShops\.owned\s*>\s*0\s*&&\s*\(/);
    assert.match(onboardingSource, /data-testid="onboarding-create-branch"/);
    assert.match(
      onboardingSource,
      /tx\(\s*['"]Tạo thêm chi nhánh['"]\s*,\s*['"]Create another branch['"]\s*\)/
    );
    const ownerBranchMatch =
      onboardingSource.match(
        /<button[^>]*data-testid="onboarding-create-branch"[^>]*>[\s\S]*?<\/button>/
      ) ||
      onboardingSource.match(
        /<button[\s\S]*?data-testid="onboarding-create-branch"[\s\S]*?<\/button>/
      );
    assert.ok(ownerBranchMatch, 'owner branch button markup must be present');
    assert.match(
      ownerBranchMatch[0],
      /onClick=\{\s*\(\)\s*=>\s*setExistingShops\(null\)\s*\}/
    );

    // CTA mutual exclusivity logic: member-only vs owner
    const evaluateCtas = (owned: number, member: number) => ({
      canCreateOwnShop: owned === 0 && member > 0,
      canCreateBranch: owned > 0,
    });

    // Case 1: Member-only staff (0 owned, 1+ member) receives own-store CTA and never branch CTA
    const staffState = evaluateCtas(0, 2);
    assert.equal(staffState.canCreateOwnShop, true);
    assert.equal(staffState.canCreateBranch, false);

    // Case 2: Store owner (1+ owned, 0 member) receives branch CTA and never own-store CTA
    const ownerState = evaluateCtas(1, 0);
    assert.equal(ownerState.canCreateOwnShop, false);
    assert.equal(ownerState.canCreateBranch, true);

    // Case 3: Owner who is also a member in another store receives branch CTA only
    const ownerMemberState = evaluateCtas(2, 1);
    assert.equal(ownerMemberState.canCreateOwnShop, false);
    assert.equal(ownerMemberState.canCreateBranch, true);

    // Case 4: Zero shops (would bypass existingShops modal to wizard directly)
    const freshUserState = evaluateCtas(0, 0);
    assert.equal(freshUserState.canCreateOwnShop, false);
    assert.equal(freshUserState.canCreateBranch, false);
  });
});
