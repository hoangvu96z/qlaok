import crypto from 'node:crypto';

export interface WebhookVerificationResult {
  valid: boolean;
  status?: number;
  reason?: string;
}

export type PayOSWebhookEnvelope = Record<string, unknown> & {
  code: string;
  success: boolean;
  data: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * Identifies the signed envelope sent by PayOS. A missing signature still
 * counts as a PayOS envelope so it cannot fall through to header auth.
 */
export function isPayOSWebhookEnvelope(
  value: unknown
): value is PayOSWebhookEnvelope {
  return (
    isRecord(value) &&
    typeof value.code === 'string' &&
    typeof value.success === 'boolean' &&
    isRecord(value.data)
  );
}

function sortNestedPayOSValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortNestedPayOSValue);
  }
  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortNestedPayOSValue(value[key])])
  );
}

function payOSValueForSignature(value: unknown): string {
  if (value === null || value === undefined || value === 'null' || value === 'undefined') {
    return '';
  }
  if (Array.isArray(value) || isRecord(value)) {
    return JSON.stringify(sortNestedPayOSValue(value));
  }
  return String(value);
}

/** Builds the canonical key=value data string used by PayOS webhook HMAC. */
function buildPayOSWebhookSigningPayload(
  data: Record<string, unknown>
): string {
  return Object.keys(data)
    .sort()
    .map((key) => `${key}=${payOSValueForSignature(data[key])}`)
    .join('&');
}

function timingSafeStringEqual(value: string, expected: string): boolean {
  const a = Buffer.from(value, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyPayOSWebhookSignature(
  envelope: PayOSWebhookEnvelope,
  secret: string
): boolean {
  const signature =
    typeof envelope.signature === 'string' ? envelope.signature.trim() : '';
  if (!/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(buildPayOSWebhookSigningPayload(envelope.data), 'utf8')
    .digest('hex');
  return timingSafeStringEqual(signature.toLowerCase(), expected);
}

/**
 * Verifies PayOS's signed JSON envelope or the existing flat webhook formats
 * used by SePay/custom integrations. PayOS envelopes never fall back to
 * header-secret authentication when their body signature is missing or bad.
 */
export function verifySaasPaymentWebhookAuthentication(
  req: Request,
  rawBody: string,
  body: unknown,
  configuredSecret: string | null
): WebhookVerificationResult {
  const secret = (configuredSecret || '').trim();
  if (!secret) {
    return {
      valid: false,
      status: 503,
      reason:
        'Webhook thanh toán chưa được cấu hình (thiếu PAYMENT_WEBHOOK_SECRET). Từ chối mọi callback.',
    };
  }

  if (isPayOSWebhookEnvelope(body)) {
    return verifyPayOSWebhookSignature(body, secret)
      ? { valid: true }
      : {
          valid: false,
          reason: 'Chữ ký webhook PayOS không hợp lệ hoặc bị thiếu.',
        };
  }

  const headerSecret =
    req.headers.get('x-webhook-secret') ||
    req.headers
      .get('authorization')
      ?.replace(/^Apikey\s+/i, '')
      .trim();
  const headerSignature = req.headers.get('x-webhook-signature');

  if (headerSignature) {
    const expectedHmac = crypto
      .createHmac('sha256', secret)
      .update(rawBody, 'utf8')
      .digest('hex');
    if (!timingSafeStringEqual(headerSignature.trim(), expectedHmac)) {
      return { valid: false, reason: 'Chữ ký Webhook (HMAC) không hợp lệ.' };
    }
    return { valid: true };
  }

  if (headerSecret) {
    if (!timingSafeStringEqual(headerSecret, secret)) {
      return { valid: false, reason: 'Webhook Secret không hợp lệ.' };
    }
    return { valid: true };
  }

  return {
    valid: false,
    reason: 'Thiếu chữ ký hoặc khóa xác thực Webhook (x-webhook-secret / x-webhook-signature).',
  };
}

export function getSaasPaymentWebhookPayload(
  body: Record<string, unknown>
): Record<string, unknown> {
  return isPayOSWebhookEnvelope(body) ? body.data : body;
}

export function isSuccessfulPayOSWebhook(body: unknown): boolean {
  return (
    !isPayOSWebhookEnvelope(body) ||
    (body.success === true && body.code === '00')
  );
}

const PAYOS_STANDALONE_ORDER_CODE_PATTERN =
  /(?<![\p{L}\p{N}\p{M}])QLAOK[BP][0-9]{5}(?![\p{L}\p{N}\p{M}])/iu;

export function extractPayOSOrderCodeFromDescription(
  data: Record<string, unknown>
): string | null {
  if (!isRecord(data) || typeof data.description !== 'string') {
    return null;
  }
  return (
    data.description.match(PAYOS_STANDALONE_ORDER_CODE_PATTERN)?.[0] || null
  );
}
