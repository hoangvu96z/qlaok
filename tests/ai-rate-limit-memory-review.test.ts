import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AI_RATE_LIMITS,
  consumeAiRateLimit,
  getAiRateLimitBucketCountForTest,
  resetAiRateLimitsForTest,
} from '@/app/api/ai/_lib/guard';

test('AI rate-limit memory stays bounded and overflow quotas remain scoped', () => {
  resetAiRateLimitsForTest();
  const now = 1_000_000;
  const regularBucketCapacity = 5_000 - Object.keys(AI_RATE_LIMITS).length;

  for (let request = 0; request < AI_RATE_LIMITS.translate.max; request += 1) {
    assert.equal(consumeAiRateLimit('translate', 'existing-user', now).allowed, true);
  }
  for (let user = 1; user < regularBucketCapacity; user += 1) {
    assert.equal(consumeAiRateLimit('translate', `user-${user}`, now).allowed, true);
  }
  assert.equal(getAiRateLimitBucketCountForTest(), regularBucketCapacity);
  assert.equal(
    consumeAiRateLimit('translate', 'existing-user', now).allowed,
    false,
    'reaching the bucket cap must not evict an active user and reset their quota'
  );

  for (let request = 0; request < AI_RATE_LIMITS.translate.max; request += 1) {
    assert.equal(
      consumeAiRateLimit('translate', `overflow-user-${request}`, now).allowed,
      true
    );
  }
  assert.equal(
    consumeAiRateLimit('translate', 'overflow-user-next', now).allowed,
    false,
    'new translate identities must share the bounded translate overflow quota'
  );
  assert.equal(
    getAiRateLimitBucketCountForTest(),
    regularBucketCapacity + 1
  );

  for (let request = 0; request < AI_RATE_LIMITS.ocr.max; request += 1) {
    assert.equal(
      consumeAiRateLimit('ocr', `ocr-overflow-user-${request}`, now).allowed,
      true
    );
  }
  assert.equal(
    consumeAiRateLimit('ocr', 'ocr-overflow-user-next', now).allowed,
    false,
    'OCR has an independent overflow quota'
  );
  assert.equal(getAiRateLimitBucketCountForTest(), 5_000);
  assert.equal(
    consumeAiRateLimit('translate', 'overflow-user-another', now).allowed,
    false,
    'OCR traffic must not reset or consume translate overflow quota'
  );

  const afterWindow = now + AI_RATE_LIMITS.translate.windowMs + 1;
  const reclaimed = consumeAiRateLimit('translate', 'new-user-after-expiry', afterWindow);
  assert.equal(reclaimed.allowed, true);
  assert.equal(reclaimed.remaining, AI_RATE_LIMITS.translate.max - 1);
  assert.equal(getAiRateLimitBucketCountForTest(), 1);

  resetAiRateLimitsForTest();
  assert.equal(getAiRateLimitBucketCountForTest(), 0);
  assert.equal(consumeAiRateLimit('translate', 'existing-user', now).allowed, true);
});
