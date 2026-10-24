import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  getUnseenPendingServiceRequests,
  normalizeServiceRequestNotificationRule,
  shouldNotifyBrowserServiceRequest,
} from '../src/lib/service-request-browser-notifications';

describe('service request browser notification helpers', () => {
  test('returns every unseen pending request and ignores known or resolved requests', () => {
    const requests = [
      { id: 'known', status: 'pending' },
      { id: 'new-a', status: 'pending' },
      { id: 'new-b', status: 'pending' },
      { id: 'resolved', status: 'completed' },
    ];

    assert.deepEqual(
      getUnseenPendingServiceRequests(requests, new Set(['known'])).map(
        (request) => request.id
      ),
      ['new-a', 'new-b']
    );
  });

  test('defaults malformed or missing rules to all order staff', () => {
    assert.equal(normalizeServiceRequestNotificationRule(undefined), 'all_order_staff');
    assert.equal(normalizeServiceRequestNotificationRule('invalid'), 'all_order_staff');
    assert.equal(
      shouldNotifyBrowserServiceRequest({
        rule: undefined,
        requestType: 'call_staff',
        userId: 'staff-1',
        ownerId: 'owner-1',
      }),
      true
    );
  });

  test('owner-only gates call staff alerts and leaves bill requests unchanged', () => {
    const params = {
      rule: 'owner_only',
      requestType: 'call_staff' as const,
      ownerId: 'owner-1',
    };

    assert.equal(
      shouldNotifyBrowserServiceRequest({ ...params, userId: 'owner-1' }),
      true
    );
    assert.equal(
      shouldNotifyBrowserServiceRequest({ ...params, userId: 'staff-1' }),
      false
    );
    assert.equal(shouldNotifyBrowserServiceRequest({ ...params, userId: null }), false);
    assert.equal(
      shouldNotifyBrowserServiceRequest({
        ...params,
        requestType: 'request_bill',
        userId: 'staff-1',
      }),
      true
    );
  });

  test('Settings exposes owner rule choices, rehydrates the saved rule, and submits it for owners', () => {
    const settingsSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'src/app/(dashboard)/dashboard/settings/page.tsx'
      ),
      'utf8'
    );

    assert.match(settingsSource, /data-testid="service-request-notification-settings"/);
    assert.match(settingsSource, /value: 'all_order_staff'/);
    assert.match(settingsSource, /value: 'owner_only'/);
    assert.match(
      settingsSource,
      /tc\?\.serviceRequestNotificationRule === 'owner_only'/
    );
    assert.match(settingsSource, /activeShop\.owner_id === profile\?\.id/);
    assert.match(settingsSource, /\{ serviceRequestNotificationRule \}/);
  });
});
