import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildShopSettingsCityPatch,
  resolveInitialSettingsCity,
} from '@/lib/shop-settings-city';

test('resolveInitialSettingsCity preserves absent, null, or whitespace city as empty string', () => {
  assert.equal(resolveInitialSettingsCity(undefined), '');
  assert.equal(resolveInitialSettingsCity(null), '');
  assert.equal(resolveInitialSettingsCity(''), '');
  assert.equal(resolveInitialSettingsCity('   '), '');
  assert.equal(resolveInitialSettingsCity('\t\n'), '');
});

test('resolveInitialSettingsCity trims and preserves populated city values', () => {
  assert.equal(resolveInitialSettingsCity('Đà Nẵng'), 'Đà Nẵng');
  assert.equal(resolveInitialSettingsCity('  Hà Nội  '), 'Hà Nội');
  assert.equal(resolveInitialSettingsCity('TP. Hồ Chí Minh'), 'TP. Hồ Chí Minh');
});

test('buildShopSettingsCityPatch omits city when untouched', () => {
  // Untouched with empty/absent city (e.g. production fixture with missing city)
  const untouchedEmpty = buildShopSettingsCityPatch({
    city: '',
    touched: false,
  });
  assert.deepEqual(untouchedEmpty, {});
  assert.equal('city' in untouchedEmpty, false);
  assert.equal(untouchedEmpty.city, undefined);

  // Untouched with existing city
  const untouchedExisting = buildShopSettingsCityPatch({
    city: 'Đà Nẵng',
    touched: false,
  });
  assert.deepEqual(untouchedExisting, {});
  assert.equal('city' in untouchedExisting, false);

  // Positional signature
  assert.deepEqual(buildShopSettingsCityPatch('', false), {});
  assert.deepEqual(buildShopSettingsCityPatch('Đà Nẵng', false), {});
});

test('buildShopSettingsCityPatch includes explicit city selection when touched', () => {
  const explicitSelection = buildShopSettingsCityPatch({
    city: 'Đà Nẵng',
    touched: true,
  });
  assert.deepEqual(explicitSelection, { city: 'Đà Nẵng' });
  assert.equal('city' in explicitSelection, true);
  assert.equal(explicitSelection.city, 'Đà Nẵng');

  // Trims extra whitespace on explicit selection
  const trimmedSelection = buildShopSettingsCityPatch({
    city: '  Hải Phòng  ',
    touched: true,
  });
  assert.deepEqual(trimmedSelection, { city: 'Hải Phòng' });

  // Positional signature
  assert.deepEqual(buildShopSettingsCityPatch('Cần Thơ', true), {
    city: 'Cần Thơ',
  });
});

test('buildShopSettingsCityPatch supports explicit clearing when touched', () => {
  const explicitCleared = buildShopSettingsCityPatch({
    city: '',
    touched: true,
  });
  assert.deepEqual(explicitCleared, { city: '' });
  assert.equal('city' in explicitCleared, true);
  assert.equal(explicitCleared.city, '');

  const whitespaceCleared = buildShopSettingsCityPatch({
    city: '   ',
    touched: true,
  });
  assert.deepEqual(whitespaceCleared, { city: '' });
  assert.equal('city' in whitespaceCleared, true);

  // Positional signature
  assert.deepEqual(buildShopSettingsCityPatch('', true), { city: '' });
});

test('Settings PATCH general payload omits city on color-only save with absent city', () => {
  // Fixture mimicking production Premium shop with no city set
  const productionShopFixture = {
    id: 'prod-shop-1',
    name: 'Tiệm Trà Hoa',
    city: null as unknown as string,
    theme_config: { primaryColor: '#10b981' },
  };

  // Form hydrates city from shop fixture
  const initialCity = resolveInitialSettingsCity(productionShopFixture.city);
  assert.equal(initialCity, '');

  // Owner only changes color without touching city selector
  const isCityTouched = false;
  const newPrimaryColor = '#6366f1';

  const settingsPatch: Record<string, unknown> = {
    name: productionShopFixture.name,
    theme_config: {
      ...productionShopFixture.theme_config,
      primaryColor: newPrimaryColor,
    },
    ...buildShopSettingsCityPatch({
      city: initialCity,
      touched: isCityTouched,
    }),
  };

  // Assert city is omitted from patch — does not overwrite missing city with Đà Nẵng
  assert.equal('city' in settingsPatch, false);
  assert.equal(settingsPatch.city, undefined);
  assert.equal(
    (settingsPatch.theme_config as { primaryColor: string }).primaryColor,
    '#6366f1'
  );
});

test('Settings PATCH general payload includes city when owner actively selects or clears', () => {
  // Owner actively selects Huế
  const patchWithCitySelection: Record<string, unknown> = {
    name: 'Tiệm Trà Hoa',
    ...buildShopSettingsCityPatch({
      city: 'Huế',
      touched: true,
    }),
  };
  assert.equal('city' in patchWithCitySelection, true);
  assert.equal(patchWithCitySelection.city, 'Huế');

  // Owner actively clears city back to empty placeholder
  const patchWithCityCleared: Record<string, unknown> = {
    name: 'Tiệm Trà Hoa',
    ...buildShopSettingsCityPatch({
      city: '',
      touched: true,
    }),
  };
  assert.equal('city' in patchWithCityCleared, true);
  assert.equal(patchWithCityCleared.city, '');
});
