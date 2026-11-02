import assert from 'node:assert/strict';
import { after, test } from 'node:test';

const environmentKeys = [
  'SESSION_SECRET',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'AI_API_KEY',
  'AI_BASE_URL',
] as const;
const originalEnv = new Map(
  environmentKeys.map((key) => [key, process.env[key]] as const)
);

process.env.SESSION_SECRET = 'ocr-review-session-secret-2026';
for (const key of [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'AI_API_KEY',
  'AI_BASE_URL',
]) {
  delete process.env[key];
}

const { issueSessionToken } = await import('@/lib/server-auth');
const { resetAiRateLimitsForTest } = await import('@/app/api/ai/_lib/guard');
const { POST } = await import('@/app/api/ai/ocr-menu/route');

const token = issueSessionToken({
  id: 'review-ocr-limit-user',
  email: 'ocr-review@example.test',
});

const { SUPER_ADMIN_EMAIL, SUPER_ADMIN_ID } = await import('@/lib/auth-session');
const adminToken = issueSessionToken({
  id: SUPER_ADMIN_ID,
  email: SUPER_ADMIN_EMAIL,
  role: 'admin',
});

const MiB = 1024 * 1024;
const authHeaders = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
};

function makeRequest(body: string | Record<string, unknown>): Request {
  return new Request('http://localhost/api/ai/ocr-menu', {
    method: 'POST',
    headers: authHeaders,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function post(body: string | Record<string, unknown>) {
  resetAiRateLimitsForTest();
  return POST(makeRequest(body));
}

function pngBytes(byteLength: number, width: number, height: number): Buffer {
  assert.ok(byteLength >= 24);
  const bytes = Buffer.alloc(byteLength);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 4, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function webpVp8Bytes(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(30);
  bytes.write('RIFF', 0, 4, 'ascii');
  bytes.writeUInt32LE(22, 4);
  bytes.write('WEBP', 8, 4, 'ascii');
  bytes.write('VP8 ', 12, 4, 'ascii');
  bytes.writeUInt32LE(10, 16);
  bytes[23] = 0x9d;
  bytes[24] = 0x01;
  bytes[25] = 0x2a;
  bytes.writeUInt16LE(width, 26);
  bytes.writeUInt16LE(height, 28);
  return bytes;
}

function jpegSofBytes(width: number, height: number): Buffer {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x08, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01,
  ]);
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

after(() => {
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('authenticated demo OCR request remains available', async () => {
  const response = await post({ useDemo: true });

  assert.equal(response.status, 200);
  assert.equal((await responseBody(response)).provider, 'demo-ocr');
});

test('accepts the existing image and text limits together', async () => {
  const image = pngBytes(5 * MiB, 4096, 4096).toString('base64');
  const response = await post({
    useDemo: true,
    imageBase64: image,
    mimeType: 'image/png',
    rawOcrText: 'x'.repeat(20_000),
  });

  assert.equal(response.status, 200);
  assert.equal((await responseBody(response)).provider, 'demo-ocr');
});

test('accepts the compressed WebP image format used by the dashboard', async () => {
  const response = await post({
    useDemo: true,
    imageBase64: webpVp8Bytes(1600, 1200).toString('base64'),
    mimeType: 'image/webp',
  });

  assert.equal(response.status, 200);
  assert.equal((await responseBody(response)).provider, 'demo-ocr');
});

test('accepts JPEG and rejects a JPEG dimension over the maximum', async () => {
  const accepted = await post({
    useDemo: true,
    imageBase64: jpegSofBytes(1600, 1200).toString('base64'),
    mimeType: 'image/jpeg',
  });
  assert.equal(accepted.status, 200);

  const rejected = await post({
    useDemo: true,
    imageBase64: jpegSofBytes(8193, 1).toString('base64'),
    mimeType: 'image/jpeg',
  });
  const data = await responseBody(rejected);
  assert.equal(rejected.status, 413);
  assert.equal(data.code, 'OCR_REQUEST_TOO_LARGE');
});

test('rejects a JSON body larger than 8 MiB before parsing it', async () => {
  const limit = 8 * MiB;
  const prefix = '{"useDemo":true,"padding":"';
  const suffix = '"}';
  const body = `${prefix}${'x'.repeat(limit + 1 - prefix.length - suffix.length)}${suffix}`;
  assert.equal(Buffer.byteLength(body), limit + 1);

  const response = await post(body);
  const data = await responseBody(response);
  assert.equal(response.status, 413);
  assert.equal(data.code, 'OCR_REQUEST_TOO_LARGE');
});
test('rejects an image over 5 MiB after Base64 decoding', async () => {
  const image = pngBytes(5 * MiB + 1, 1600, 1200).toString('base64');
  const response = await post({
    useDemo: true,
    imageBase64: image,
    mimeType: 'image/png',
  });
  const data = await responseBody(response);

  assert.equal(response.status, 413);
  assert.equal(data.code, 'OCR_REQUEST_TOO_LARGE');
});
test('rejects OCR text over 20,000 characters', async () => {
  const response = await post({ useDemo: true, rawOcrText: 'x'.repeat(20_001) });
  const data = await responseBody(response);

  assert.equal(response.status, 413);
  assert.equal(data.code, 'OCR_REQUEST_TOO_LARGE');
});

test('rejects non-canonical Base64, corrupt image headers, and MIME mismatches', async () => {
  for (const body of [
    { useDemo: true, imageBase64: 'YQ=', mimeType: 'image/png' },
    { useDemo: true, imageBase64: Buffer.from('not an image').toString('base64'), mimeType: 'image/png' },
    { useDemo: true, imageBase64: pngBytes(24, 200, 100).toString('base64'), mimeType: 'image/png' },
    { useDemo: true, imageBase64: pngBytes(24, 200, 100).toString('base64'), mimeType: 'image/webp' },
  ]) {
    const response = await post(body);
    const data = await responseBody(response);
    assert.equal(response.status, 400);
    assert.equal(data.code, 'INVALID_OCR_INPUT');
  }
});

test('rejects images whose declared dimensions exceed the OCR pixel budget', async () => {
  const response = await post({
    useDemo: true,
    imageBase64: pngBytes(33, 8193, 1).toString('base64'),
    mimeType: 'image/png',
  });
  const data = await responseBody(response);

  assert.equal(response.status, 413);
  assert.equal(data.code, 'OCR_REQUEST_TOO_LARGE');
});

test('AI provider failures never leak exception details in response or logs', async () => {
  const secret = 'SECRET_PROVIDER_TOKEN_sk-live-123 https://internal.example/v1 /srv/app/key.pem';
  const originalFetch = globalThis.fetch;
  const originalConsole = {
    error: console.error,
    warn: console.warn,
    log: console.log,
    info: console.info,
  };
  const logged: string[] = [];
  const capture = (...args: unknown[]) => {
    logged.push(
      args
        .map((arg) => (arg instanceof Error ? `${arg.message}\n${arg.stack}` : String(arg)))
        .join(' ')
    );
  };
  process.env.AI_API_KEY = 'test-ai-key';
  process.env.AI_BASE_URL = 'https://ai.invalid/v1';
  globalThis.fetch = (async () => {
    throw new Error(secret);
  }) as typeof fetch;
  console.error = console.warn = console.log = console.info = capture;
  try {
    resetAiRateLimitsForTest();
    const response = await POST(
      new Request('http://localhost/api/ai/ocr-menu', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rawOcrText: '???' }),
      })
    );
    const text = await response.text();

    assert.equal(response.status, 500);
    assert.equal(text.includes('SECRET_PROVIDER_TOKEN'), false);
    assert.equal(text.includes('internal.example'), false);
    assert.equal(text.includes('key.pem'), false);
    assert.equal(
      (JSON.parse(text) as { error: string }).error,
      'Không thể phân tích thực đơn từ ảnh. Vui lòng thử lại sau.'
    );
    const logs = logged.join('\n');
    assert.equal(logs.includes('SECRET_PROVIDER_TOKEN'), false);
    assert.equal(logs.includes('internal.example'), false);
    assert.equal(logs.includes('key.pem'), false);
    assert.equal(logs.includes('at '), false);
    assert.deepEqual(logged, ['{"event":"ocr_menu_analysis_failed","code":"Error"}']);
  } finally {
    globalThis.fetch = originalFetch;
    Object.assign(console, originalConsole);
    delete process.env.AI_API_KEY;
    delete process.env.AI_BASE_URL;
  }
});
