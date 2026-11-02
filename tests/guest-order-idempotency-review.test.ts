import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getGuestOrderIdempotencyKey,
  parseGuestOrderIdempotencyKey,
  serializeGuestOrderIntent,
} from '@/lib/guest-order-idempotency';

test('guest checkout idempotency keys are strong, intent-bound, and retryable', async () => {
  const intent = {
    shop_id: 'shop-fixture',
    expected_total: 25000,
    items: [{ item_id: 'item-fixture', quantity: 1 }],
    customer_note: 'Ít đá',
  };

  const first = await getGuestOrderIdempotencyKey(intent);
  assert.match(
    first,
    /^gq1\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[0-9a-f]{64}$/i
  );
  assert.equal(parseGuestOrderIdempotencyKey(first)?.intentDigest.length, 64);
  assert.equal(await getGuestOrderIdempotencyKey(intent, first), first);

  const changedIntent = { ...intent, expected_total: 26000 };
  const changedKey = await getGuestOrderIdempotencyKey(changedIntent, first);
  assert.notEqual(changedKey, first);
  assert.equal(
    parseGuestOrderIdempotencyKey(changedKey)?.intentDigest,
    parseGuestOrderIdempotencyKey(
      await getGuestOrderIdempotencyKey(changedIntent)
    )?.intentDigest
  );
});

test('guest intent serialization is stable and ignores only the top-level key', () => {
  assert.equal(
    serializeGuestOrderIntent({ z: 1, a: { y: true, x: null }, idempotency_key: 'first' }),
    serializeGuestOrderIntent({ idempotency_key: 'second', a: { x: null, y: true }, z: 1 })
  );
  assert.notEqual(
    serializeGuestOrderIntent({ shop_id: 'shop-a' }),
    serializeGuestOrderIntent({ shop_id: 'shop-b' })
  );
  assert.equal(parseGuestOrderIdempotencyKey('guessable-key'), null);
});
