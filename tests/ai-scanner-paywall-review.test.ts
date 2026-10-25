import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AiScannerPaywall } from '@/components/dashboard/AiScannerPaywall';
import { resolveAiScannerAccess } from '@/lib/ai-scanner-access';
import { canUseAiOcr, BILLING_UPGRADE_HREF } from '@/lib/plan-limits';
import { isSuperAdmin, isSuperAdminEmail, SUPER_ADMIN_EMAIL } from '@/lib/auth-session';
import type { Profile } from '@/types/qlaok';

const scannerPageSource = fs.readFileSync(
  path.resolve('src/app/(dashboard)/dashboard/ai-scanner/page.tsx'),
  'utf8'
);
const accessHelperSource = fs.readFileSync(
  path.resolve('src/lib/ai-scanner-access.ts'),
  'utf8'
);
const paywallComponentSource = fs.readFileSync(
  path.resolve('src/components/dashboard/AiScannerPaywall.tsx'),
  'utf8'
);
const guardSource = fs.readFileSync(
  path.resolve('src/app/api/ai/_lib/guard.ts'),
  'utf8'
);

test('1. AiScannerPaywall renders accessible locked dialog markup with role="dialog", test IDs, and clear upgrade CTA', () => {
  // Free tier
  const freeHtml = renderToStaticMarkup(
    React.createElement(AiScannerPaywall, {
      plan: 'free',
      shopName: 'Quán Phở 24',
    })
  );

  // Dialog semantics & accessibility attributes
  assert.match(
    freeHtml,
    /role="dialog"/,
    'Must have role="dialog" for accessible paywall dialog'
  );
  assert.match(
    freeHtml,
    /aria-modal="false"/,
    'Must declare aria-modal="false" for non-blocking in-page dialog'
  );
  assert.match(
    freeHtml,
    /aria-labelledby="ai-scanner-paywall-heading"/,
    'Must link heading via aria-labelledby'
  );
  assert.match(
    freeHtml,
    /aria-describedby="ai-scanner-paywall-desc"/,
    'Must link description via aria-describedby'
  );
  assert.match(
    freeHtml,
    /data-testid="ai-scanner-paywall"/,
    'Must provide data-testid="ai-scanner-paywall"'
  );

  // Clear indication that it is a Premium feature
  assert.match(
    freeHtml,
    /Tính năng Quét menu AI chỉ có trong gói Chuyên Nghiệp \(Premium\)|AI Menu Scanner is a Premium Feature/,
    'Must announce feature is Premium-only'
  );

  // Current store plan badge
  assert.match(
    freeHtml,
    /data-testid="ai-scanner-current-plan"/,
    'Must render data-testid="ai-scanner-current-plan"'
  );
  assert.match(
    freeHtml,
    /Gói Miễn Phí \(Free\)|Free Plan/,
    'Must show Free plan label for free tier'
  );

  // Upgrade CTA linking to /dashboard/billing
  assert.match(
    freeHtml,
    /data-testid="ai-scanner-upgrade-cta"/,
    'Must render data-testid="ai-scanner-upgrade-cta"'
  );
  assert.match(
    freeHtml,
    new RegExp(`href="${BILLING_UPGRADE_HREF}"`),
    'CTA must link to /dashboard/billing'
  );
  assert.match(
    freeHtml,
    /Nâng cấp lên gói Premium ngay|Upgrade to Premium now/,
    'CTA must have clear upgrade label'
  );

  // Feature highlights
  assert.match(freeHtml, /AI Vision OCR/);
  assert.match(freeHtml, /Dịch tự động 8 ngôn ngữ|8 Auto-Translated Languages/);
  assert.match(freeHtml, /Không giới hạn số lượng món|Unlimited items/);

  // Basic tier
  const basicHtml = renderToStaticMarkup(
    React.createElement(AiScannerPaywall, {
      plan: 'basic',
      shopName: 'Tiệm Trà Sen',
    })
  );
  assert.match(
    basicHtml,
    /Gói Cơ Bản \(Basic\)|Basic Plan/,
    'Must show Basic plan label for basic tier'
  );
  assert.match(
    basicHtml,
    new RegExp(`href="${BILLING_UPGRADE_HREF}"`),
    'Basic plan paywall must also link to /dashboard/billing'
  );
});
test('2. canUseAiOcr plan rules strictly restrict AI OCR to Premium only', () => {
  assert.equal(canUseAiOcr('premium'), true, 'Premium tier unlocks AI OCR');
  assert.equal(canUseAiOcr('basic'), false, 'Basic tier must be locked');
  assert.equal(canUseAiOcr('free'), false, 'Free tier must be locked');
  assert.equal(canUseAiOcr(null), false, 'Null plan must fail closed');
  assert.equal(canUseAiOcr(undefined), false, 'Undefined plan must fail closed');
  assert.equal(canUseAiOcr('pro' as any), false, 'Unknown plan must fail closed');
});

test('3. Super Admin bypass preserves server guard parity', () => {
  const superAdminProfile: Profile = {
    id: 'admin-1',
    email: SUPER_ADMIN_EMAIL,
    full_name: 'Super Admin',
    role: 'admin',
    is_admin: true,
    plan: 'free',
    created_at: new Date().toISOString(),
  };
  assert.equal(
    isSuperAdmin(superAdminProfile),
    true,
    'Super Admin profile is recognized'
  );
  assert.equal(
    isSuperAdminEmail(superAdminProfile.email),
    true,
    'Super Admin email is recognized'
  );

  const regularOwnerProfile: Profile = {
    id: 'owner-1',
    email: 'regular@example.com',
    full_name: 'Regular Owner',
    role: 'owner',
    plan: 'free',
    created_at: new Date().toISOString(),
  };
  assert.equal(isSuperAdmin(regularOwnerProfile), false);

  const cashierProfile: Profile = {
    id: 'cashier-1',
    email: SUPER_ADMIN_EMAIL, // even if email matches, staff account type disables admin
    account_type: 'staff',
    role: 'cashier',
    shop_id: 'shop-1',
    full_name: 'Cashier',
    plan: 'free',
    created_at: new Date().toISOString(),
  };
  assert.equal(isSuperAdmin(cashierProfile), false);
});

test('4. Dashboard AI scanner page resolves plan from GET /api/catalog and fails closed', () => {
  // Authoritative catalog fetch
  assert.match(
    scannerPageSource,
    /\/api\/catalog\?shopId=/,
    'Must fetch /api/catalog with shopId parameter'
  );
  assert.match(
    scannerPageSource,
    /parseCatalogApiResponse/,
    'Must use parseCatalogApiResponse to extract authoritative ownerPlan'
  );

  // Active shop switches & race condition handling
  assert.match(
    scannerPageSource,
    /AbortController/,
    'Must use AbortController to cancel stale in-flight requests on shop switch'
  );
  assert.match(
    scannerPageSource,
    /cancelled\s*=\s*true/,
    'Must discard responses if active shop changes before completion'
  );

  // Loading state (fails closed before plan is resolved)
  assert.match(
    scannerPageSource,
    /data-testid="ai-scanner-plan-loading"/,
    'Must render dedicated plan loading testid'
  );
  assert.match(
    scannerPageSource,
    /role="status"/,
    'Plan loading indicator must use role="status"'
  );

  // Error state (fails closed on network or API failure)
  assert.match(
    scannerPageSource,
    /data-testid="ai-scanner-plan-error"/,
    'Must render dedicated plan error testid'
  );
  assert.match(
    scannerPageSource,
    /role="alert"/,
    'Plan error state must use role="alert"'
  );
  assert.match(
    scannerPageSource,
    /setPlanRetryKey/,
    'Must provide recoverable retry action on plan resolution failure'
  );

  // Locked state rendering
  assert.match(
    scannerPageSource,
    /<AiScannerPaywall\s+plan=\{resolvedPlan\}/,
    'Must render AiScannerPaywall when isUnlocked is false'
  );

  // Gated action execution (defense-in-depth)
  assert.match(
    scannerPageSource,
    /const analyzeTextWithAi = async[\s\S]*?if \(!isUnlocked\)/,
    'analyzeTextWithAi must bail out if not unlocked'
  );
  assert.match(
    scannerPageSource,
    /const handleFileChange = async[\s\S]*?if \(!isUnlocked\) return/,
    'handleFileChange must bail out if not unlocked'
  );
  assert.match(
    scannerPageSource,
    /const handleReanalyzeRawText = async[\s\S]*?if \(!isUnlocked/,
    'handleReanalyzeRawText must bail out if not unlocked'
  );
  assert.match(
    scannerPageSource,
    /const handleRunDemoScan = async[\s\S]*?if \(!isUnlocked\) return/,
    'handleRunDemoScan must bail out if not unlocked'
  );
  assert.match(
    scannerPageSource,
    /const handleSaveAllToShop = async[\s\S]*?if \(!isUnlocked/,
    'handleSaveAllToShop must bail out if not unlocked'
  );

  // Server guard unchanged
  assert.match(
    guardSource,
    /export async function requireAiOcrPlan/,
    'requireAiOcrPlan must remain the server-side enforcement layer'
  );
  assert.match(
    guardSource,
    /canUseAiOcr\(plan\)/,
    'Server guard must continue checking canUseAiOcr'
  );
});

test('5. resolveAiScannerAccess closes render-before-effect race across active shop switches', () => {
  // Source inspections
  assert.match(
    scannerPageSource,
    /resolveAiScannerAccess/,
    'The page must use resolveAiScannerAccess helper'
  );
  assert.match(
    accessHelperSource,
    /resolvedShopPlan\?\.shopId\s*===\s*activeShopId/,
    'Must enforce shopId match to prevent plan leaking'
  );

  // 1. When switching from shop-1 (Premium) to shop-2 (Free), before shop-2 fetch completes:
  // Render-before-effect race condition: shopId does not match, so isUnlocked MUST be false and isPlanLoading MUST be true.
  const switchingState = resolveAiScannerAccess({
    activeShopId: 'shop-2',
    resolvedShopPlan: { shopId: 'shop-1', plan: 'premium' },
  });
  assert.equal(
    switchingState.isShopPlanResolved,
    false,
    'Previous shop plan must not be marked as resolved for new shop'
  );
  assert.equal(
    switchingState.resolvedPlan,
    null,
    'Previous shop plan must not resolve to the new shop'
  );
  assert.equal(
    switchingState.isUnlocked,
    false,
    'New shop must never be unlocked with old shop Premium plan'
  );
  assert.equal(
    switchingState.isPlanLoading,
    true,
    'Must fail closed to loading state during the render-before-effect window'
  );

  // 2. When shop-2 fetch completes with Free tier:
  const resolvedFree = resolveAiScannerAccess({
    activeShopId: 'shop-2',
    resolvedShopPlan: { shopId: 'shop-2', plan: 'free' },
  });
  assert.equal(resolvedFree.isShopPlanResolved, true);
  assert.equal(resolvedFree.resolvedPlan, 'free');
  assert.equal(resolvedFree.isUnlocked, false);
  assert.equal(resolvedFree.isPlanLoading, false);

  // 3. When shop-2 fetch completes with Premium tier:
  const resolvedPremium = resolveAiScannerAccess({
    activeShopId: 'shop-2',
    resolvedShopPlan: { shopId: 'shop-2', plan: 'premium' },
  });
  assert.equal(resolvedPremium.isShopPlanResolved, true);
  assert.equal(resolvedPremium.resolvedPlan, 'premium');
  assert.equal(resolvedPremium.isUnlocked, true);
  assert.equal(resolvedPremium.isPlanLoading, false);

  // 4. When an error occurs on shop-2:
  const errorState = resolveAiScannerAccess({
    activeShopId: 'shop-2',
    resolvedShopPlan: { shopId: 'shop-1', plan: 'premium' },
    planErrorShopId: 'shop-2',
  });
  assert.equal(errorState.isPlanError, true);
  assert.equal(errorState.isPlanLoading, false);
  assert.equal(errorState.isUnlocked, false);

  // 5. Error on previous shop does not leak to new shop:
  const errorSwitchState = resolveAiScannerAccess({
    activeShopId: 'shop-2',
    planErrorShopId: 'shop-1',
  });
  assert.equal(errorSwitchState.isPlanError, false);
  assert.equal(errorSwitchState.isPlanLoading, true);
  assert.equal(errorSwitchState.isUnlocked, false);

  // 6. Super Admin bypass preserves immediate access:
  const adminBypass = resolveAiScannerAccess({
    activeShopId: 'shop-2',
    resolvedShopPlan: { shopId: 'shop-2', plan: 'free' },
    isSuperAdminBypass: true,
  });
  assert.equal(adminBypass.isUnlocked, true);
  assert.equal(adminBypass.isPlanLoading, false);
});
