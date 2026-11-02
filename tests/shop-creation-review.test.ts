import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeShopCreationInput,
  resolveShopCreationOwnerId,
} from '@/lib/shop-creation';
import { getShopSettingsPlanRestriction } from '@/lib/plan-limits';

const baseShop = {
  id: 'client-controlled-id',
  owner_id: 'different-owner',
  name: 'New shop',
  slug: 'new-shop',
  vertical: 'fnb',
  supported_langs: ['vi'],
  theme_config: { primaryColor: '#10b981', layout: 'list' },
  opening_hours_confirmed: true,
  created_at: '2000-01-01T00:00:00.000Z',
  is_published: false,
  unexpected_column: 'must not reach the database',
};

test('shop creation allowlists fields and uses safe Free defaults', () => {
  const result = normalizeShopCreationInput(baseShop);
  assert.equal(result.valid, true);
  if (!result.valid) return;

  assert.equal('id' in result.payload, false);
  assert.equal('owner_id' in result.payload, false);
  assert.equal('created_at' in result.payload, false);
  assert.equal('opening_hours_confirmed' in result.payload, false);
  assert.equal('unexpected_column' in result.payload, false);
  assert.deepEqual(result.payload.supported_langs, ['vi']);
  assert.deepEqual(result.payload.theme_config, {
    primaryColor: '#10b981',
    layout: 'list',
  });
  assert.equal(result.customThemeChanged, false);
  assert.equal(
    getShopSettingsPlanRestriction('free', {
      customThemeChanged: result.customThemeChanged,
      supportedLanguageCount: result.payload.supported_langs.length,
    }),
    null
  );
});

test('shop creation flags custom themes and restricts them only on Free', () => {
  const result = normalizeShopCreationInput({
    ...baseShop,
    theme_config: { primaryColor: '#ff0000', layout: 'list' },
  });
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.equal(result.customThemeChanged, true);
  assert.equal(
    getShopSettingsPlanRestriction('free', {
      customThemeChanged: result.customThemeChanged,
    })?.requiredPlan,
    'basic'
  );
  assert.equal(
    getShopSettingsPlanRestriction('basic', {
      customThemeChanged: result.customThemeChanged,
    }),
    null
  );
  assert.equal(
    getShopSettingsPlanRestriction('premium', {
      customThemeChanged: result.customThemeChanged,
    }),
    null
  );
});

test('shop creation rejects malformed theme and unsupported locales', () => {
  assert.equal(
    normalizeShopCreationInput({ ...baseShop, theme_config: [] }).valid,
    false
  );
  const invalidLocales = normalizeShopCreationInput({
    ...baseShop,
    supported_langs: ['vi', 'xx'],
  });
  assert.equal(invalidLocales.valid, false);
  if (!invalidLocales.valid) {
    assert.equal(invalidLocales.code, 'INVALID_SUPPORTED_LANGS');
  }
});

test('only a verified Super Admin can create a shop for another owner', () => {
  assert.deepEqual(
    resolveShopCreationOwnerId({
      authenticatedUserId: 'owner-a',
      requestedOwnerId: 'owner-b',
      isSuperAdmin: false,
    }),
    { allowed: false }
  );
  assert.deepEqual(
    resolveShopCreationOwnerId({
      authenticatedUserId: 'owner-a',
      requestedOwnerId: 'owner-b',
      isSuperAdmin: true,
    }),
    { allowed: true, ownerId: 'owner-b' }
  );
  assert.deepEqual(
    resolveShopCreationOwnerId({
      authenticatedUserId: 'owner-a',
      requestedOwnerId: 'owner-a',
      isSuperAdmin: false,
    }),
    { allowed: true, ownerId: 'owner-a' }
  );
});
