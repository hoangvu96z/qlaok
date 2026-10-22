import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.resolve(rel), 'utf8');

test('ConfirmDialog server-renders accessible danger markup with reason + checkbox', () => {
  const output = execFileSync(process.execPath, [
    '--experimental-strip-types',
    '--import', './tests/register-ts.mjs',
    '--import', './tests/tsx-review-loader.mjs',
    path.resolve('tests/confirm-dialog-qa.mjs'),
  ], { cwd: process.cwd(), encoding: 'utf8', timeout: 30000 });
  assert.match(output, /PASS: required reason textarea/);
  assert.match(output, /PASS: closed dialog renders no form/);
});

test('orders page guards destructive actions and handles expired sessions', () => {
  const src = read('src/app/(dashboard)/dashboard/orders/page.tsx');
  assert.doesNotMatch(src, /window\.alert\(/);
  assert.match(src, /method: 'PATCH',\s*headers: getAuthHeaders\(/);
  assert.match(src, /msgType === 'order_created'/);
  assert.match(src, /\/login\?next=\/dashboard\/orders/);
  assert.match(src, /hasPermission\('orders\.cancel_unpaid'\)/);
  assert.match(src, /hasPermission\('orders\.edit_items'\)/);
  assert.match(
    src,
    /const requestCancelOrder = async[\s\S]*?reason:\s*\{[^}]*label:\s*tx\('Lý do hủy',\s*'Cancellation reason'\)[^}]*required:\s*true[^}]*\}[\s\S]*?const requestRefundOrder/
  );
  assert.match(src, /cancelled_reason: result\.reason/);
  assert.match(src, /refund_reason: result\.reason/);
  const qrModalMatch = src.match(
    /\{\/\* VietQR \/ Custom QR Table Bill Payment Modal \*\/\}[\s\S]*?\{\/\* Chime Sound & Volume Booster Settings Modal/
  );
  assert.ok(qrModalMatch, 'QR payment modal block should exist in orders page');
  const qrModalSrc = qrModalMatch[0];
  assert.match(
    qrModalSrc,
    /const updated = await requestMarkPaid\(qrOrderModal,\s*\{\s*method:\s*'vietqr',\s*forcePrint:\s*true,?\s*\}\);\s*if\s*\(updated\)\s*\{\s*setQrOrderModal\(null\);\s*\}/
  );
  assert.doesNotMatch(qrModalSrc, /handleUpdateOrder\(/);
  assert.doesNotMatch(qrModalSrc, /payment_status:\s*'paid'/);
});

test('catalog and posts pages confirm deletes and check res.ok', () => {
  const catalog = read('src/app/(dashboard)/dashboard/catalog/page.tsx');
  assert.match(catalog, /formatPlanLimitError/);
  assert.match(catalog, /rollbackItem\(item\)/);
  assert.match(catalog, /disabled=\{itemLimitReached\}/);
  assert.equal((catalog.match(/await confirm\(/g) || []).length, 2);
  const posts = read('src/app/(dashboard)/dashboard/posts/page.tsx');
  assert.match(posts, /await confirm\(/);
  assert.match(posts, /if \(!res\.ok\)/);
});

test('kitchen page uses authenticated SSE live sync, preserves tickets on transient errors, and gates fulfillment PATCH', () => {
  const kitchen = read('src/app/(dashboard)/dashboard/kitchen/page.tsx');
  assert.doesNotMatch(kitchen, /window\.alert\(/);
  assert.match(kitchen, /startOrderLiveSync\(/);
  assert.match(kitchen, /buildKitchenOrdersUrl\(/);
  assert.match(kitchen, /createKitchenShopScopeTracker\(/);
  assert.match(kitchen, /reconcileKitchenOrdersFetch\(/);
  assert.match(kitchen, /shouldShowKitchenConfirmedEmptyState\(/);
  assert.match(kitchen, /buildKitchenFulfillPatchPayload\(/);
  assert.match(kitchen, /canPerformKitchenFulfill\(/);
  assert.match(kitchen, /method:\s*'PATCH',\s*headers:\s*getAuthHeaders\(/);
  assert.match(kitchen, /\/login\?next=\/dashboard\/kitchen/);
  assert.match(kitchen, /Quá hạn \(≥ \{minutes\}p\)/);
  assert.match(kitchen, /Overdue \(≥ \{minutes\}m\)/);
  assert.doesNotMatch(kitchen, />\s*\{minutes\}[pm]/);
  assert.doesNotMatch(kitchen, /payment_status/);
});
