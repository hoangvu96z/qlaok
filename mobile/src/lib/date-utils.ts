/**
 * Timezone-independent date helpers aligned with Vietnam Standard Time (ICT, UTC+7).
 * Matches web implementation in `src/lib/date-utils.ts`.
 */

export const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Returns the Vietnam calendar date key (YYYY-MM-DD) and 24h time (HH:mm)
 * for a given instant (defaults to current clock).
 */
export function getVietnamDateAndTime(now: Date = new Date()): {
  dateKey: string;
  timeHm: string;
} {
  const ts = now.getTime();
  const vnDate = new Date(
    (Number.isNaN(ts) ? Date.now() : ts) + VN_OFFSET_MS
  );
  const iso = vnDate.toISOString();
  return {
    dateKey: iso.slice(0, 10),
    timeHm: iso.slice(11, 16),
  };
}

/**
 * Returns today's date key (YYYY-MM-DD) in Vietnam time.
 */
export function getVietnamDateKey(now: Date = new Date()): string {
  return getVietnamDateAndTime(now).dateKey;
}

/**
 * Adds a number of calendar days to a YYYY-MM-DD date key.
 * Uses Date.UTC to guarantee timezone-independent date arithmetic
 * across month, leap year, and year boundaries.
 */
export function addDaysToDateKey(dateKey: string, daysCount: number): string {
  const parts = dateKey.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!y || !m || !d || Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) {
    return dateKey;
  }
  const date = new Date(Date.UTC(y, m - 1, d + daysCount));
  return date.toISOString().slice(0, 10);
}

/**
 * Counts the inclusive number of calendar days between two YYYY-MM-DD date keys.
 * Returns at least 1.
 */
export function countDaysInclusive(startDateKey: string, endDateKey: string): number {
  const sParts = startDateKey.split('-');
  const eParts = endDateKey.split('-');
  const sy = Number(sParts[0]);
  const sm = Number(sParts[1]);
  const sd = Number(sParts[2]);
  const ey = Number(eParts[0]);
  const em = Number(eParts[1]);
  const ed = Number(eParts[2]);

  if (
    !sy || !sm || !sd || !ey || !em || !ed ||
    Number.isNaN(sy) || Number.isNaN(sm) || Number.isNaN(sd) ||
    Number.isNaN(ey) || Number.isNaN(em) || Number.isNaN(ed)
  ) {
    return 1;
  }

  const sUtc = Date.UTC(sy, sm - 1, sd);
  const eUtc = Date.UTC(ey, em - 1, ed);

  if (Number.isNaN(sUtc) || Number.isNaN(eUtc)) {
    return 1;
  }

  return Math.max(1, Math.round((eUtc - sUtc) / (1000 * 60 * 60 * 24)) + 1);
}
