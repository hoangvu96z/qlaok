/**
 * Helpers for suppressing duplicate audit rows on idempotent no-op replays.
 *
 * A replay is a no-op only when the persisted business state is identical
 * before and after the mutation. `updated_at` is ignored because status
 * handlers may refresh that timestamp even when nothing else changed; every
 * other field counts as a real change.
 */

const IGNORED_REPLAY_KEYS: ReadonlySet<string> = new Set(['updated_at']);

/** Only true timestamp columns (`paid_at`, `resolved_at`, ...) are instant-normalized. */
const TIMESTAMP_FIELD_PATTERN = /_at$/;

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

function stableReplayValue(
  value: unknown,
  topLevel: boolean,
  key?: string
): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (
    typeof value === 'string' &&
    key !== undefined &&
    TIMESTAMP_FIELD_PATTERN.test(key) &&
    ISO_TIMESTAMP_PATTERN.test(value)
  ) {
    // The same instant may be serialized with different UTC offsets (e.g. a
    // DB read vs. an update response); compare instants, not spellings.
    // Free-text fields (notes, reasons, ...) are never normalized and stay exact.
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? value : new Date(ms).toISOString();
  }
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => stableReplayValue(item, false));
  }
  const out: Record<string, unknown> = {};
  for (const field of Object.keys(value as Record<string, unknown>).sort()) {
    if (topLevel && IGNORED_REPLAY_KEYS.has(field)) continue;
    const next = (value as Record<string, unknown>)[field];
    if (next === undefined) continue;
    out[field] = stableReplayValue(next, false, field);
  }
  return out;
}

/**
 * Returns true when the persisted business state differs between `before` and
 * `after` (ignoring top-level `updated_at`). A missing `before` snapshot is
 * always treated as a change so a real event is never suppressed by accident.
 */
export function hasBusinessStateChanged(
  before: object | null | undefined,
  after: object | null | undefined
): boolean {
  if (!before || !after) return true;
  return (
    JSON.stringify(stableReplayValue(before, true)) !==
    JSON.stringify(stableReplayValue(after, true))
  );
}
