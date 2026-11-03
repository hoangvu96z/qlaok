const GUEST_ORDER_IDEMPOTENCY_KEY_PATTERN =
  /^gq1\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([0-9a-f]{64})$/i;

function canonicalizeIntent(value: unknown, topLevel = false): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeIntent(item));
  }

  const record = value as Record<string, unknown>;
  const canonical: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (
      (topLevel && (key === 'idempotency_key' || key === 'visitor_lang')) ||
      record[key] === undefined
    ) {
      continue;
    }
    canonical[key] = canonicalizeIntent(record[key]);
  }
  return canonical;
}

export function serializeGuestOrderIntent(intent: unknown): string {
  return JSON.stringify(canonicalizeIntent(intent, true));
}

export function parseGuestOrderIdempotencyKey(
  value: unknown
): { nonce: string; intentDigest: string } | null {
  if (typeof value !== 'string') return null;
  const match = GUEST_ORDER_IDEMPOTENCY_KEY_PATTERN.exec(value.trim());
  if (!match) return null;
  return {
    nonce: match[1].toLowerCase(),
    intentDigest: match[2].toLowerCase(),
  };
}

function createUuidV4(cryptoApi: Crypto): string {
  if (typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }

  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

export async function getGuestOrderIdempotencyKey(
  intent: unknown,
  previousKey?: string | null
): Promise<string> {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle || !cryptoApi.getRandomValues) {
    throw new Error('Secure checkout retries are unavailable in this browser.');
  }

  const encodedIntent = new TextEncoder().encode(
    serializeGuestOrderIntent(intent)
  );
  const digest = await cryptoApi.subtle.digest('SHA-256', encodedIntent);
  const intentDigest = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  const parsedPrevious = parseGuestOrderIdempotencyKey(previousKey);

  if (parsedPrevious?.intentDigest === intentDigest) {
    return previousKey!.trim();
  }

  return `gq1.${createUuidV4(cryptoApi)}.${intentDigest}`;
}
