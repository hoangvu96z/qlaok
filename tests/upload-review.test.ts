import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '@/app/api/upload/route';
import type { createR2PresignedUploadUrl, uploadBufferToR2 } from '@/lib/r2';
import { issueSessionToken } from '@/lib/server-auth';

const validOwnerToken = issueSessionToken({
  id: 'owner-test-001',
  email: 'owner@example.com',
  role: 'owner',
});

type R2UploadBufferFn = typeof uploadBufferToR2;
type R2PresignedFn = typeof createR2PresignedUploadUrl;

function setIsR2ConfiguredForTests(fn: (() => boolean) | null): void {
  if (!globalThis.__uploadRouteTestHooks) {
    globalThis.__uploadRouteTestHooks = {};
  }
  globalThis.__uploadRouteTestHooks.isR2Configured = fn ?? undefined;
}

function setR2UploaderForTests(uploader: R2UploadBufferFn | null): void {
  if (!globalThis.__uploadRouteTestHooks) {
    globalThis.__uploadRouteTestHooks = {};
  }
  globalThis.__uploadRouteTestHooks.r2Uploader = uploader ?? undefined;
}

function setR2PresignedForTests(fn: R2PresignedFn | null): void {
  if (!globalThis.__uploadRouteTestHooks) {
    globalThis.__uploadRouteTestHooks = {};
  }
  globalThis.__uploadRouteTestHooks.r2Presigned = fn ?? undefined;
}

afterEach(() => {
  delete globalThis.__uploadRouteTestHooks;
});

function createJsonRequest(
  body: unknown,
  token: string | null = validOwnerToken
): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return new Request('http://localhost:3000/api/upload', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test('POST /api/upload returns 503 UPLOAD_STORAGE_UNAVAILABLE when R2 is unconfigured and base64 arrives', async () => {
  setIsR2ConfiguredForTests(() => false);

  const res = await POST(
    createJsonRequest({
      fileName: 'coffee.webp',
      contentType: 'image/webp',
      base64Data: 'data:image/webp;base64,dGVzdA==',
    })
  );

  assert.equal(res.status, 503);
  const data = await res.json();
  assert.equal(data.code, 'UPLOAD_STORAGE_UNAVAILABLE');
  assert.equal(data.error, 'UPLOAD_STORAGE_UNAVAILABLE');
  assert.equal(data.mode, undefined);
  assert.equal(data.publicUrl, undefined);

  const rawJson = JSON.stringify(data);
  assert.equal(rawJson.includes('data:'), false);
  assert.equal(rawJson.includes('inline-webp'), false);
});

test('POST /api/upload returns 502 UPLOAD_STORAGE_FAILED when R2 upload throws', async () => {
  setIsR2ConfiguredForTests(() => true);
  setR2UploaderForTests(async () => {
    throw new Error('Cloudflare R2 PutObject S3 timeout');
  });

  const res = await POST(
    createJsonRequest({
      fileName: 'tea.webp',
      contentType: 'image/webp',
      base64Data: 'data:image/webp;base64,dGVzdA==',
    })
  );

  assert.equal(res.status, 502);
  const data = await res.json();
  assert.equal(data.code, 'UPLOAD_STORAGE_FAILED');
  assert.equal(data.error, 'UPLOAD_STORAGE_FAILED');
  assert.equal(data.mode, undefined);
  assert.equal(data.publicUrl, undefined);

  const rawJson = JSON.stringify(data);
  assert.equal(rawJson.includes('data:'), false);
  assert.equal(rawJson.includes('inline-webp'), false);
  assert.equal(rawJson.includes('PutObject'), false);
});

test('POST /api/upload returns 502 UPLOAD_STORAGE_FAILED when R2 upload returns null URL', async () => {
  setIsR2ConfiguredForTests(() => true);
  setR2UploaderForTests(async () => null);

  const res = await POST(
    createJsonRequest({
      fileName: 'juice.webp',
      contentType: 'image/webp',
      base64Data: 'dGVzdA==',
    })
  );

  assert.equal(res.status, 502);
  const data = await res.json();
  assert.equal(data.code, 'UPLOAD_STORAGE_FAILED');
  assert.equal(data.error, 'UPLOAD_STORAGE_FAILED');
  assert.equal(data.mode, undefined);
  assert.equal(data.publicUrl, undefined);

  const rawJson = JSON.stringify(data);
  assert.equal(rawJson.includes('data:'), false);
  assert.equal(rawJson.includes('inline-webp'), false);
});

test('POST /api/upload returns 502 UPLOAD_STORAGE_FAILED when R2 upload returns empty string URL', async () => {
  setIsR2ConfiguredForTests(() => true);
  setR2UploaderForTests(async () => '');

  const res = await POST(
    createJsonRequest({
      fileName: 'cake.webp',
      contentType: 'image/webp',
      base64Data: 'dGVzdA==',
    })
  );

  assert.equal(res.status, 502);
  const data = await res.json();
  assert.equal(data.code, 'UPLOAD_STORAGE_FAILED');
  assert.equal(data.error, 'UPLOAD_STORAGE_FAILED');
  assert.equal(data.mode, undefined);
  assert.equal(data.publicUrl, undefined);
});

test('POST /api/upload returns 200 and r2-direct mode with CDN publicUrl on success', async () => {
  setIsR2ConfiguredForTests(() => true);
  let capturedKey = '';
  let capturedContentType = '';
  let capturedBuffer: Buffer | null = null;

  setR2UploaderForTests(async (params) => {
    capturedKey = params.key;
    capturedContentType = params.contentType;
    capturedBuffer = params.buffer;
    return `https://cdn.qlaok.vn/${params.key}`;
  });

  const res = await POST(
    createJsonRequest({
      fileName: 'pho-bo.webp',
      contentType: 'image/webp',
      base64Data: 'data:image/webp;base64,dGVzdA==',
    })
  );

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.mode, 'r2-direct');
  assert.ok(capturedBuffer);
  assert.equal(data.publicUrl, `https://cdn.qlaok.vn/${capturedKey}`);
  assert.ok(data.publicUrl.startsWith('https://cdn.qlaok.vn/uploads/'));
  assert.equal(data.publicUrl.startsWith('data:'), false);
  assert.equal(capturedContentType, 'image/webp');
  assert.equal((capturedBuffer as Buffer).toString('utf8'), 'test');
});

test('POST /api/upload preserves presigned upload URL behavior when base64Data is omitted and R2 is configured', async () => {
  setIsR2ConfiguredForTests(() => true);
  setR2PresignedForTests(async ({ key }) => ({
    uploadUrl: `https://mock-account.r2.cloudflarestorage.com/qlaok-assets/${key}?mock-sig=123`,
    publicUrl: `https://cdn.qlaok.vn/${key}`,
  }));

  const res = await POST(
    createJsonRequest({
      fileName: 'banner.webp',
      contentType: 'image/webp',
    })
  );

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.mode, 'r2-presigned');
  assert.ok(data.uploadUrl.includes('mock-account.r2.cloudflarestorage.com'));
  assert.ok(data.publicUrl.startsWith('https://cdn.qlaok.vn/uploads/'));
});

test('POST /api/upload returns 503 when presigned upload is requested without configured object storage', async () => {
  setIsR2ConfiguredForTests(() => false);

  const res = await POST(
    createJsonRequest({
      fileName: 'banner.webp',
    })
  );

  assert.equal(res.status, 503);
  const data = await res.json();
  assert.equal(data.error, 'UPLOAD_STORAGE_UNAVAILABLE');
  assert.equal(JSON.stringify(data).includes('data:'), false);
});

test('No error response ever returns a data: URI or mode: inline-webp', async () => {
  // 1. Unconfigured error
  setIsR2ConfiguredForTests(() => false);
  const res1 = await POST(
    createJsonRequest({
      base64Data: 'data:image/webp;base64,AAAA',
    })
  );
  const text1 = await res1.text();
  assert.doesNotMatch(text1, /data:\s*image/i);
  assert.doesNotMatch(text1, /inline-webp/);
  assert.equal(res1.status, 503);

  // 2. Storage failed error (thrown)
  setIsR2ConfiguredForTests(() => true);
  setR2UploaderForTests(async () => {
    throw new Error('Connection refused');
  });
  const res2 = await POST(
    createJsonRequest({
      base64Data: 'data:image/webp;base64,BBBB',
    })
  );
  const text2 = await res2.text();
  assert.doesNotMatch(text2, /data:\s*image/i);
  assert.doesNotMatch(text2, /inline-webp/);
  assert.equal(res2.status, 502);

  // 3. Storage failed error (null URL)
  setR2UploaderForTests(async () => null);
  const res3 = await POST(
    createJsonRequest({
      base64Data: 'data:image/webp;base64,CCCC',
    })
  );
  const text3 = await res3.text();
  assert.doesNotMatch(text3, /data:\s*image/i);
  assert.doesNotMatch(text3, /inline-webp/);
  assert.equal(res3.status, 502);

  // 4. Presigned-upload request with no configured object store
  setIsR2ConfiguredForTests(() => false);
  const res4 = await POST(createJsonRequest({}));
  const text4 = await res4.text();
  assert.doesNotMatch(text4, /data:\s*image/i);
  assert.doesNotMatch(text4, /inline-webp/);
  assert.equal(res4.status, 503);

  // 5. Malformed JSON error
  const res5 = await POST(createJsonRequest('invalid-json{'));
  const text5 = await res5.text();
  assert.doesNotMatch(text5, /data:\s*image/i);
  assert.doesNotMatch(text5, /inline-webp/);
  assert.equal(res5.status, 500);
});
