import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getVietnamDateAndTime,
  getVietnamDateKey,
  addDaysToDateKey,
  countDaysInclusive,
} from '../src/lib/date-utils';

test('Vietnam date key around midnight boundary (UTC+7)', () => {
  // 1ms before Vietnam midnight: 2026-10-24 23:59:59.999 VN -> 2026-10-24T16:59:59.999Z
  const beforeMidnight = new Date('2026-10-24T16:59:59.999Z');
  const resBefore = getVietnamDateAndTime(beforeMidnight);
  assert.equal(resBefore.dateKey, '2026-10-24');
  assert.equal(resBefore.timeHm, '23:59');
  assert.equal(getVietnamDateKey(beforeMidnight), '2026-10-24');

  // Exact Vietnam midnight: 2026-10-25 00:00:00.000 VN -> 2026-10-24T17:00:00.000Z
  const exactMidnight = new Date('2026-10-24T17:00:00.000Z');
  const resExact = getVietnamDateAndTime(exactMidnight);
  assert.equal(resExact.dateKey, '2026-10-25');
  assert.equal(resExact.timeHm, '00:00');
  assert.equal(getVietnamDateKey(exactMidnight), '2026-10-25');

  // 1s past Vietnam midnight: 2026-10-25 00:00:01.000 VN -> 2026-10-24T17:00:01.000Z
  const afterMidnight = new Date('2026-10-24T17:00:01.000Z');
  const resAfter = getVietnamDateAndTime(afterMidnight);
  assert.equal(resAfter.dateKey, '2026-10-25');
  assert.equal(resAfter.timeHm, '00:00');
  assert.equal(getVietnamDateKey(afterMidnight), '2026-10-25');

  // Month boundary midnight: 2026-10-31 23:59:59.999 VN vs 2026-11-01 00:00:00.000 VN
  const oct31End = new Date('2026-10-31T16:59:59.999Z');
  assert.equal(getVietnamDateKey(oct31End), '2026-10-31');
  const nov01Start = new Date('2026-10-31T17:00:00.000Z');
  assert.equal(getVietnamDateKey(nov01Start), '2026-11-01');

  // Year boundary midnight: 2026-12-31 23:59:59.999 VN vs 2027-01-01 00:00:00.000 VN
  const dec31End = new Date('2026-12-31T16:59:59.999Z');
  assert.equal(getVietnamDateKey(dec31End), '2026-12-31');
  const jan01Start = new Date('2026-12-31T17:00:00.000Z');
  assert.equal(getVietnamDateKey(jan01Start), '2027-01-01');
});

test('Inclusive date-key addition across calendar boundaries and presets', () => {
  const start = '2026-10-25';

  // 1-day preset (Today, offset = 0)
  const end1 = addDaysToDateKey(start, 0);
  assert.equal(end1, '2026-10-25');
  assert.equal(countDaysInclusive(start, end1), 1);

  // 3-day preset (offset = 2)
  const end3 = addDaysToDateKey(start, 2);
  assert.equal(end3, '2026-10-27');
  assert.equal(countDaysInclusive(start, end3), 3);

  // 7-day preset (offset = 6) -> lands on end of month 2026-10-31
  const end7 = addDaysToDateKey(start, 6);
  assert.equal(end7, '2026-10-31');
  assert.equal(countDaysInclusive(start, end7), 7);

  // 14-day preset (offset = 13) -> crosses month boundary into November
  const end14 = addDaysToDateKey(start, 13);
  assert.equal(end14, '2026-11-07');
  assert.equal(countDaysInclusive(start, end14), 14);

  // 30-day preset (offset = 29) -> crosses month boundary into November
  const end30 = addDaysToDateKey(start, 29);
  assert.equal(end30, '2026-11-23');
  assert.equal(countDaysInclusive(start, end30), 30);

  // Leap year boundary: Feb 2024 has 29 days
  assert.equal(addDaysToDateKey('2024-02-28', 1), '2024-02-29');
  assert.equal(addDaysToDateKey('2024-02-28', 2), '2024-03-01');
  assert.equal(countDaysInclusive('2024-02-28', '2024-03-01'), 3);

  // Non-leap year boundary: Feb 2025 has 28 days
  assert.equal(addDaysToDateKey('2025-02-28', 1), '2025-03-01');
  assert.equal(countDaysInclusive('2025-02-28', '2025-03-01'), 2);

  // Year boundary transition
  assert.equal(addDaysToDateKey('2026-12-31', 1), '2027-01-01');
  assert.equal(addDaysToDateKey('2026-12-25', 13), '2027-01-07');
  assert.equal(countDaysInclusive('2026-12-25', '2027-01-07'), 14);

  // Degenerate / safety cases
  assert.equal(countDaysInclusive('2026-10-25', '2026-10-20'), 1);
  assert.equal(countDaysInclusive('invalid', '2026-10-25'), 1);
  assert.equal(addDaysToDateKey('invalid', 5), 'invalid');
});
