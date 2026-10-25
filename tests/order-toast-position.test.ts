import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CHIME_SETTINGS,
  loadOrderChimeSettings,
  saveOrderChimeSettings,
  isValidOrderToastPosition,
  CHIME_SETTINGS_EVENT,
  type OrderToastPosition,
} from '@/lib/order-chime';

interface MockGlobalScope {
  window?: unknown;
  localStorage?: unknown;
}

describe('Order Toast Position Settings', () => {
  const globalScope = globalThis as unknown as MockGlobalScope;
  const originalWindow = globalScope.window;
  const originalLocalStorage = globalScope.localStorage;
  let mockStorage: Map<string, string>;
  let dispatchedEvents: CustomEvent[];

  beforeEach(() => {
    mockStorage = new Map<string, string>();
    dispatchedEvents = [];

    const mockLocalStorage = {
      getItem(key: string): string | null {
        return mockStorage.get(key) ?? null;
      },
      setItem(key: string, value: string): void {
        mockStorage.set(key, String(value));
      },
      removeItem(key: string): void {
        mockStorage.delete(key);
      },
      clear(): void {
        mockStorage.clear();
      },
    };

    globalScope.localStorage = mockLocalStorage;
    globalScope.window = {
      localStorage: mockLocalStorage,
      dispatchEvent(event: CustomEvent): boolean {
        dispatchedEvents.push(event);
        return true;
      },
    };
  });

  afterEach(() => {
    globalScope.window = originalWindow;
    globalScope.localStorage = originalLocalStorage;
  });

  it('defaults to top-right when no stored settings exist', () => {
    assert.equal(DEFAULT_CHIME_SETTINGS.newOrderToastPosition, 'top-right');
    const settings = loadOrderChimeSettings();
    assert.equal(settings.newOrderToastPosition, 'top-right');
    assert.equal(settings.enabled, true);
    assert.equal(settings.soundId, 'kitchen_gong');
  });

  it('backward-compatibility: preserves existing settings when newOrderToastPosition is missing', () => {
    const oldSettings = {
      enabled: false,
      soundId: 'siren_urgent',
      volumePreset: 'loud',
      repeatCount: 3,
      remindUntilAccepted: false,
      browserNotificationEnabled: false,
    };
    mockStorage.set('qlaok_order_chime_settings_v1', JSON.stringify(oldSettings));

    const loaded = loadOrderChimeSettings();
    assert.equal(loaded.enabled, false);
    assert.equal(loaded.soundId, 'siren_urgent');
    assert.equal(loaded.volumePreset, 'loud');
    assert.equal(loaded.repeatCount, 3);
    assert.equal(loaded.remindUntilAccepted, false);
    assert.equal(loaded.browserNotificationEnabled, false);
    assert.equal(loaded.newOrderToastPosition, 'top-right');
  });

  it('falls back to default top-right when stored position is invalid or malformed', () => {
    const invalidPositions = [
      'center',
      'top-center',
      'bottom-center',
      'invalid',
      '',
      123,
      null,
      false,
    ];
    for (const invalid of invalidPositions) {
      mockStorage.set(
        'qlaok_order_chime_settings_v1',
        JSON.stringify({
          soundId: 'melody_upbeat',
          newOrderToastPosition: invalid,
        })
      );
      const loaded = loadOrderChimeSettings();
      assert.equal(
        loaded.newOrderToastPosition,
        'top-right',
        `Expected fallback to top-right for invalid value: ${String(invalid)}`
      );
      assert.equal(loaded.soundId, 'melody_upbeat');
    }
  });

  it('persists and loads each valid position through saveOrderChimeSettings', () => {
    const validPositions: OrderToastPosition[] = [
      'top-left',
      'top-right',
      'bottom-left',
      'bottom-right',
    ];

    for (const pos of validPositions) {
      dispatchedEvents = [];
      const toSave = {
        ...DEFAULT_CHIME_SETTINGS,
        newOrderToastPosition: pos,
      };

      saveOrderChimeSettings(toSave);

      // Verify localStorage content
      const storedRaw = mockStorage.get('qlaok_order_chime_settings_v1');
      assert.ok(storedRaw, 'Expected settings in localStorage');
      const parsed = JSON.parse(storedRaw);
      assert.equal(parsed.newOrderToastPosition, pos);

      // Verify loadOrderChimeSettings recovers it
      const loaded = loadOrderChimeSettings();
      assert.equal(loaded.newOrderToastPosition, pos);

      // Verify CHIME_SETTINGS_EVENT event dispatch
      assert.equal(dispatchedEvents.length, 1);
      assert.equal(dispatchedEvents[0].type, CHIME_SETTINGS_EVENT);
      assert.equal(
        (dispatchedEvents[0] as CustomEvent).detail.newOrderToastPosition,
        pos
      );
    }
  });

  it('validates positions using isValidOrderToastPosition', () => {
    assert.equal(isValidOrderToastPosition('top-left'), true);
    assert.equal(isValidOrderToastPosition('top-right'), true);
    assert.equal(isValidOrderToastPosition('bottom-left'), true);
    assert.equal(isValidOrderToastPosition('bottom-right'), true);
    assert.equal(isValidOrderToastPosition('top-center'), false);
    assert.equal(isValidOrderToastPosition(null), false);
    assert.equal(isValidOrderToastPosition(undefined), false);
    assert.equal(isValidOrderToastPosition(42), false);
  });
});
