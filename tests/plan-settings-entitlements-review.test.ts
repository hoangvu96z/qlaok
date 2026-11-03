import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlanUpgradeDialog } from '@/components/ui/PlanUpgradeDialog';
import { getShopSettingsPlanRestriction } from '@/lib/plan-limits';
import { buildShopSettingsThemeConfigPatch } from '@/lib/shop-settings-theme-patch';

test('Free and Basic language limits select the next plan with enough slots', () => {
  assert.equal(
    getShopSettingsPlanRestriction('free', { supportedLanguageCount: 1 }),
    null
  );
  assert.deepEqual(
    getShopSettingsPlanRestriction('free', { supportedLanguageCount: 2 }),
    {
      code: 'PLAN_LIMIT_REACHED',
      feature: 'supported_languages',
      requiredPlan: 'basic',
      maxLanguages: 1,
    }
  );
  assert.equal(
    getShopSettingsPlanRestriction('basic', { supportedLanguageCount: 3 }),
    null
  );
  assert.equal(
    getShopSettingsPlanRestriction('basic', { supportedLanguageCount: 4 })
      ?.requiredPlan,
    'premium'
  );
  assert.equal(
    getShopSettingsPlanRestriction('premium', { supportedLanguageCount: 8 }),
    null
  );
});

test('Only Free is blocked from changing custom theme settings', () => {
  assert.deepEqual(
    getShopSettingsPlanRestriction('free', { customThemeChanged: true }),
    {
      code: 'PLAN_FEATURE_LOCKED',
      feature: 'custom_theme',
      requiredPlan: 'basic',
    }
  );
  assert.equal(
    getShopSettingsPlanRestriction('basic', { customThemeChanged: true }),
    null
  );
  assert.equal(
    getShopSettingsPlanRestriction('premium', { customThemeChanged: true }),
    null
  );
});

test('settings theme patch preserves newer values owned by other editors', () => {
  const staleSettingsSnapshot = {
    promoBanner: { title: 'Old banner' },
    flashSale: { title: 'Old sale' },
    paymentQr: { accountNumber: '111' },
    orderWorkflow: { template_id: 'old' },
    labelPrintConfig: { paper_preset: 'old' },
  };
  const latestDatabaseTheme = {
    ...staleSettingsSnapshot,
    promoBanner: { title: 'Latest banner' },
    flashSale: { title: 'Latest sale' },
    paymentQr: { accountNumber: '222' },
    orderWorkflow: { template_id: 'latest' },
    labelPrintConfig: { paper_preset: 'latest' },
  };
  const paymentConfig = { accountNumber: '333' };
  const patch = buildShopSettingsThemeConfigPatch({
    customTheme: {
      primaryColor: '#123456',
      layout: 'grid',
      backgroundStyle: 'custom_image',
      backgroundImageUrl: '   ',
      backgroundOverlayOpacity: 0.4,
    },
    paymentConfig,
    serviceRequestNotificationRule: 'owner_only',
  });
  const savedTheme = { ...latestDatabaseTheme, ...patch };

  assert.deepEqual(Object.keys(patch).sort(), [
    'backgroundImageUrl',
    'backgroundOverlayOpacity',
    'backgroundStyle',
    'layout',
    'paymentConfig',
    'primaryColor',
    'serviceRequestNotificationRule',
  ]);
  assert.deepEqual(savedTheme.promoBanner, latestDatabaseTheme.promoBanner);
  assert.deepEqual(savedTheme.flashSale, latestDatabaseTheme.flashSale);
  assert.deepEqual(savedTheme.paymentQr, latestDatabaseTheme.paymentQr);
  assert.deepEqual(savedTheme.orderWorkflow, latestDatabaseTheme.orderWorkflow);
  assert.deepEqual(
    savedTheme.labelPrintConfig,
    latestDatabaseTheme.labelPrintConfig
  );
  assert.equal(savedTheme.primaryColor, '#123456');
  assert.equal(savedTheme.backgroundImageUrl, '');
  assert.deepEqual(savedTheme.paymentConfig, paymentConfig);
  assert.equal(savedTheme.serviceRequestNotificationRule, 'owner_only');
});

test('bank-only settings patch does not re-send custom or owner theme values', () => {
  const paymentConfig = { accountNumber: '123456789' };
  assert.deepEqual(
    buildShopSettingsThemeConfigPatch({ paymentConfig }),
    { paymentConfig }
  );
});

test('Settings upgrade dialog names the current/required plans and links to billing', () => {
  const html = renderToStaticMarkup(
    React.createElement(PlanUpgradeDialog, {
      open: true,
      currentPlan: 'free',
      requiredPlan: 'basic',
      feature: 'supported_languages',
      onClose: () => {},
    })
  );

  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /data-testid="plan-upgrade-dialog"/);
  assert.match(html, /href="\/dashboard\/billing"/);
  assert.match(html, /Nâng cấp lên/);
  assert.match(html, /tính năng cần nâng cấp|requires an upgrade/i);
});
