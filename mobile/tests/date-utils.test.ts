import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getVietnamDateAndTime,
  getVietnamDateKey,
  addDaysToDateKey,
  countDaysInclusive,
} from '../src/lib/date-utils.ts';

test('Mobile Vietnam date key around midnight boundary (UTC+7)', () => {
  // 1ms before Vietnam midnight: 2026-10-24 23:59:59.999 VN -> 2026-10-24T16:59:59.999Z
  const beforeMidnight = new Date('2026-10-24T16:59:59.999Z');
  assert.equal(getVietnamDateKey(beforeMidnight), '2026-10-24');

  // Exact Vietnam midnight: 2026-10-25 00:00:00.000 VN -> 2026-10-24T17:00:00.000Z
  const exactMidnight = new Date('2026-10-24T17:00:00.000Z');
  assert.equal(getVietnamDateKey(exactMidnight), '2026-10-25');
  assert.equal(getVietnamDateAndTime(exactMidnight).timeHm, '00:00');
});

test('Mobile inclusive date-key addition across presets and boundaries', () => {
  const start = '2026-10-25';

  // 1-day (Today: days = 0)
  assert.equal(addDaysToDateKey(start, 0), '2026-10-25');
  // 3-day (days = 2)
  assert.equal(addDaysToDateKey(start, 2), '2026-10-27');
  // 7-day (days = 6)
  assert.equal(addDaysToDateKey(start, 6), '2026-10-31');
  // 14-day (days = 13)
  assert.equal(addDaysToDateKey(start, 13), '2026-11-07');
  // 30-day (days = 29)
  assert.equal(addDaysToDateKey(start, 29), '2026-11-23');

  // Month & year boundary
  assert.equal(addDaysToDateKey('2026-12-31', 1), '2027-01-01');
  assert.equal(countDaysInclusive('2026-10-25', '2026-11-07'), 14);
});
