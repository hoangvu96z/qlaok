import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlanUpgradeDialog } from '@/components/ui/PlanUpgradeDialog';
import { getShopSettingsPlanRestriction } from '@/lib/plan-limits';

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
