import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { S3Client } from '@aws-sdk/client-s3';
import { POST } from '@/app/api/upload/route';
import {
  MAX_UPLOAD_BYTES,
  GARAGE_UPLOAD_BUCKET,
  isGarageConfigured,
  getGarageClient,
  uploadBufferToGarage,
  createGaragePresignedUploadUrl,
} from '@/lib/garage-storage';
import {
  issueSessionToken,
  SESSION_COOKIE_NAME,
} from '@/lib/server-auth';
import { SUPER_ADMIN_EMAIL } from '@/lib/auth-session';

afterEach(() => {
  delete globalThis.__uploadRouteTestHooks;
});

const validOwnerToken = issueSessionToken({
  id: 'owner-test-001',
  email: 'owner@example.com',
  role: 'owner',
});

const validAdminToken = issueSessionToken({
  id: 'admin-test-001',
  email: SUPER_ADMIN_EMAIL,
  role: 'admin',
  is_admin: true,
});

const staffToken = issueSessionToken({
  id: 'staff-test-001',
  username: 'thungan01',
  shop_id: 'shop-test-001',
  account_type: 'staff',
  role: 'cashier',
});

function createUploadRequest(
  payload: Record<string, unknown>,
  options?: {
    token?: string | null;
    cookie?: string | null;
    headers?: Record<string, string>;
  }
): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers || {}),
  };

  const token =
    options?.token !== undefined ? options.token : validOwnerToken;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (options?.cookie) {
    headers['Cookie'] = options.cookie;
  }

  return new Request('http://localhost/api/upload', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
}

const imagePayload = {
  fileName: 'menu.webp',
  contentType: 'image/webp',
  base64Data: 'data:image/webp;base64,aGVsbG8=',
};

test('upload route prefers Garage and preserves its response contract', async () => {
  let r2Calls = 0;
  const uploaded: Array<{ key: string; contentType: string; buffer: Buffer }> = [];
  globalThis.__uploadRouteTestHooks = {
    isGarageConfigured: () => true,
    isR2Configured: () => true,
    garageUploader: async (params) => {
      uploaded.push(params);
      assert.equal(params.buffer.toString(), 'hello');
      return 'https://s3.vunph.click/media/menu.webp';
    },
    r2Uploader: async () => {
      r2Calls += 1;
      return 'https://cdn.example.test/menu.webp';
    },
  };

  const response = await POST(createUploadRequest(imagePayload));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    mode: 'garage-storage',
    publicUrl: 'https://s3.vunph.click/media/menu.webp',
  });
  assert.equal(r2Calls, 0);
  assert.equal(uploaded[0]?.contentType, 'image/webp');
  assert.match(uploaded[0]?.key || '', /^uploads\/\d+-menu\.webp$/);
});

test('upload route falls back to R2 storage when Garage is not configured', async () => {
  const uploaded: Array<{ key: string; contentType: string; buffer: Buffer }> = [];
  globalThis.__uploadRouteTestHooks = {
    isGarageConfigured: () => false,
    isR2Configured: () => true,
    garageUploader: async () => {
      throw new Error('Garage must not be called when unavailable');
    },
    r2Uploader: async (params) => {
      uploaded.push(params);
      return 'https://cdn.example.test/uploads/123-menu.webp';
    },
  };

  const response = await POST(createUploadRequest(imagePayload));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    mode: 'r2-direct',
    publicUrl: 'https://cdn.example.test/uploads/123-menu.webp',
  });
  assert.equal(uploaded[0]?.contentType, 'image/webp');
  assert.equal(uploaded[0]?.buffer.toString(), 'hello');
  assert.match(uploaded[0]?.key || '', /^uploads\/\d+-menu\.webp$/);
});

test('upload route falls back to R2 storage when a Garage upload fails', async () => {
  globalThis.__uploadRouteTestHooks = {
    isGarageConfigured: () => true,
    isR2Configured: () => true,
    garageUploader: async () => {
      throw new Error('Garage credentials must not be returned to the client');
    },
    r2Uploader: async () =>
      'https://cdn.example.test/uploads/123-menu.webp',
  };

  const response = await POST(createUploadRequest(imagePayload));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    mode: 'r2-direct',
    publicUrl: 'https://cdn.example.test/uploads/123-menu.webp',
  });
});

test('upload route returns a safe unavailable response when both stores fail', async () => {
  globalThis.__uploadRouteTestHooks = {
    isGarageConfigured: () => true,
    isR2Configured: () => true,
    garageUploader: async () => {
      throw new Error('private backend endpoint and key');
    },
    r2Uploader: async () => {
      throw new Error('private r2 secrets and credentials');
    },
  };

  const response = await POST(createUploadRequest(imagePayload));
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.code, 'UPLOAD_STORAGE_FAILED');
  assert.equal(JSON.stringify(body).includes('private backend'), false);
  assert.equal(JSON.stringify(body).includes('private r2'), false);
});

test('upload route returns 503 UPLOAD_STORAGE_UNAVAILABLE when neither store is configured', async () => {
  globalThis.__uploadRouteTestHooks = {
    isR2Configured: () => false,
    isGarageConfigured: () => false,
  };

  const response = await POST(createUploadRequest(imagePayload));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, 'UPLOAD_STORAGE_UNAVAILABLE');
});

test('upload route rejects non-image types and payloads above the storage limit', async () => {
  let uploadCalls = 0;
  globalThis.__uploadRouteTestHooks = {
    isR2Configured: () => false,
    isGarageConfigured: () => true,
    garageUploader: async () => {
      uploadCalls += 1;
      return 'https://s3.vunph.click/media/image.webp';
    },
  };

  const unsupported = await POST(
    createUploadRequest({ ...imagePayload, contentType: 'image/svg+xml' })
  );
  assert.equal(unsupported.status, 415);

  const mismatchedDataUrl = await POST(
    createUploadRequest({
      ...imagePayload,
      base64Data: 'data:image/jpeg;base64,aGVsbG8=',
    })
  );
  assert.equal(mismatchedDataUrl.status, 400);

  const oversized = await POST(
    createUploadRequest({
      ...imagePayload,
      base64Data: `data:image/webp;base64,${'a'.repeat(
        Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 + 4
      )}`,
    })
  );
  assert.equal(oversized.status, 413);
  assert.equal(uploadCalls, 0);
});

test('Garage client configures path-style addressing, region, and server credentials', () => {
  const origEndpoint = process.env.S3_ENDPOINT;
  const origRegion = process.env.S3_REGION;
  const origBucket = process.env.S3_BUCKET_NAME;
  const origKeyId = process.env.S3_ACCESS_KEY_ID;
  const origSecret = process.env.S3_SECRET_ACCESS_KEY;
  const origPublicUrl = process.env.S3_PUBLIC_URL;

  try {
    process.env.S3_ENDPOINT = 'https://s3.vunph.click';
    process.env.S3_REGION = 'garage';
    process.env.S3_BUCKET_NAME = 'qlaok-media';
    process.env.S3_ACCESS_KEY_ID = 'test-garage-access-key';
    process.env.S3_SECRET_ACCESS_KEY = 'test-garage-secret-key';
    process.env.S3_PUBLIC_URL = 'https://s3.vunph.click/media';

    assert.equal(isGarageConfigured(), true);
    const client = getGarageClient();
    assert.ok(client);
    // AWS SDK v3 S3Client stores forcePathStyle in client.config.forcePathStyle
    assert.equal(client.config.forcePathStyle, true);
    assert.equal(GARAGE_UPLOAD_BUCKET, 'qlaok-media');
  } finally {
    if (origEndpoint !== undefined) process.env.S3_ENDPOINT = origEndpoint; else delete process.env.S3_ENDPOINT;
    if (origRegion !== undefined) process.env.S3_REGION = origRegion; else delete process.env.S3_REGION;
    if (origBucket !== undefined) process.env.S3_BUCKET_NAME = origBucket; else delete process.env.S3_BUCKET_NAME;
    if (origKeyId !== undefined) process.env.S3_ACCESS_KEY_ID = origKeyId; else delete process.env.S3_ACCESS_KEY_ID;
    if (origSecret !== undefined) process.env.S3_SECRET_ACCESS_KEY = origSecret; else delete process.env.S3_SECRET_ACCESS_KEY;
    if (origPublicUrl !== undefined) process.env.S3_PUBLIC_URL = origPublicUrl; else delete process.env.S3_PUBLIC_URL;
  }
});

test('uploadBufferToGarage uploads with PutObjectCommand and returns public URL', async () => {
  const origEndpoint = process.env.S3_ENDPOINT;
  const origRegion = process.env.S3_REGION;
  const origBucket = process.env.S3_BUCKET_NAME;
  const origKeyId = process.env.S3_ACCESS_KEY_ID;
  const origSecret = process.env.S3_SECRET_ACCESS_KEY;
  const origPublicUrl = process.env.S3_PUBLIC_URL;

  try {
    process.env.S3_ENDPOINT = 'https://s3.vunph.click';
    process.env.S3_REGION = 'garage';
    process.env.S3_BUCKET_NAME = 'qlaok-media';
    process.env.S3_ACCESS_KEY_ID = 'test-garage-access-key';
    process.env.S3_SECRET_ACCESS_KEY = 'test-garage-secret-key';
    process.env.S3_PUBLIC_URL = 'https://s3.vunph.click/media';

    let capturedCommand: { input?: Record<string, unknown> } | null = null;
    const mockClient = {
      send: async (cmd: { input?: Record<string, unknown> }) => {
        capturedCommand = cmd;
        return {};
      },
    } as unknown as S3Client;

    const publicUrl = await uploadBufferToGarage(
      {
        key: 'uploads/123-menu.webp',
        contentType: 'image/webp',
        buffer: Buffer.from('hello'),
      },
      mockClient
    );

    assert.equal(
      publicUrl,
      'https://s3.vunph.click/media/uploads/123-menu.webp'
    );
    assert.ok(capturedCommand);
    const cmdInput = (capturedCommand as { input?: Record<string, unknown> }).input;
    assert.equal(cmdInput?.Bucket, 'qlaok-media');
    assert.equal(cmdInput?.Key, 'uploads/123-menu.webp');
    assert.equal(cmdInput?.ContentType, 'image/webp');
    assert.deepEqual(cmdInput?.Body, Buffer.from('hello'));
  } finally {
    if (origEndpoint !== undefined) process.env.S3_ENDPOINT = origEndpoint; else delete process.env.S3_ENDPOINT;
    if (origRegion !== undefined) process.env.S3_REGION = origRegion; else delete process.env.S3_REGION;
    if (origBucket !== undefined) process.env.S3_BUCKET_NAME = origBucket; else delete process.env.S3_BUCKET_NAME;
    if (origKeyId !== undefined) process.env.S3_ACCESS_KEY_ID = origKeyId; else delete process.env.S3_ACCESS_KEY_ID;
    if (origSecret !== undefined) process.env.S3_SECRET_ACCESS_KEY = origSecret; else delete process.env.S3_SECRET_ACCESS_KEY;
    if (origPublicUrl !== undefined) process.env.S3_PUBLIC_URL = origPublicUrl; else delete process.env.S3_PUBLIC_URL;
  }
});

test('Garage storage safe misconfiguration behavior when env vars are missing', async () => {
  const origEndpoint = process.env.S3_ENDPOINT;
  const origRegion = process.env.S3_REGION;
  const origBucket = process.env.S3_BUCKET_NAME;
  const origKeyId = process.env.S3_ACCESS_KEY_ID;
  const origSecret = process.env.S3_SECRET_ACCESS_KEY;
  const origPublicUrl = process.env.S3_PUBLIC_URL;

  try {
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_REGION;
    delete process.env.S3_BUCKET_NAME;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    delete process.env.S3_PUBLIC_URL;

    assert.equal(isGarageConfigured(), false);
    assert.equal(getGarageClient(), null);

    await assert.rejects(
      async () => {
        await uploadBufferToGarage({
          key: 'uploads/test.webp',
          contentType: 'image/webp',
          buffer: Buffer.from('test'),
        });
      },
      (error: Error) => {
        assert.match(error.message, /not configured/i);
        return true;
      }
    );
  } finally {
    if (origEndpoint !== undefined) process.env.S3_ENDPOINT = origEndpoint; else delete process.env.S3_ENDPOINT;
    if (origRegion !== undefined) process.env.S3_REGION = origRegion; else delete process.env.S3_REGION;
    if (origBucket !== undefined) process.env.S3_BUCKET_NAME = origBucket; else delete process.env.S3_BUCKET_NAME;
    if (origKeyId !== undefined) process.env.S3_ACCESS_KEY_ID = origKeyId; else delete process.env.S3_ACCESS_KEY_ID;
    if (origSecret !== undefined) process.env.S3_SECRET_ACCESS_KEY = origSecret; else delete process.env.S3_SECRET_ACCESS_KEY;
    if (origPublicUrl !== undefined) process.env.S3_PUBLIC_URL = origPublicUrl; else delete process.env.S3_PUBLIC_URL;
  }
});

test('Garage presigned upload URL generates path-style URL and public URL when configured', async () => {
  const origEndpoint = process.env.S3_ENDPOINT;
  const origRegion = process.env.S3_REGION;
  const origBucket = process.env.S3_BUCKET_NAME;
  const origKeyId = process.env.S3_ACCESS_KEY_ID;
  const origSecret = process.env.S3_SECRET_ACCESS_KEY;
  const origPublicUrl = process.env.S3_PUBLIC_URL;

  try {
    process.env.S3_ENDPOINT = 'https://s3.vunph.click';
    process.env.S3_REGION = 'garage';
    process.env.S3_BUCKET_NAME = 'qlaok-media';
    process.env.S3_ACCESS_KEY_ID = 'test-garage-access-key';
    process.env.S3_SECRET_ACCESS_KEY = 'test-garage-secret-key';
    process.env.S3_PUBLIC_URL = 'https://s3.vunph.click/media';

    const res = await createGaragePresignedUploadUrl({
      key: 'uploads/123-banner.webp',
      contentType: 'image/webp',
    });

    assert.ok(res);
    assert.equal(
      res.publicUrl,
      'https://s3.vunph.click/media/uploads/123-banner.webp'
    );
    // Path-style addressing puts the bucket in the path:
    assert.ok(res.uploadUrl.startsWith('https://s3.vunph.click/qlaok-media/uploads/123-banner.webp'));
  } finally {
    if (origEndpoint !== undefined) process.env.S3_ENDPOINT = origEndpoint; else delete process.env.S3_ENDPOINT;
    if (origRegion !== undefined) process.env.S3_REGION = origRegion; else delete process.env.S3_REGION;
    if (origBucket !== undefined) process.env.S3_BUCKET_NAME = origBucket; else delete process.env.S3_BUCKET_NAME;
    if (origKeyId !== undefined) process.env.S3_ACCESS_KEY_ID = origKeyId; else delete process.env.S3_ACCESS_KEY_ID;
    if (origSecret !== undefined) process.env.S3_SECRET_ACCESS_KEY = origSecret; else delete process.env.S3_SECRET_ACCESS_KEY;
    if (origPublicUrl !== undefined) process.env.S3_PUBLIC_URL = origPublicUrl; else delete process.env.S3_PUBLIC_URL;
  }
});

test('Do not fall back to Supabase Storage when Garage is misconfigured; fail closed', async () => {
  // Ensure R2 is false and Garage is false (unconfigured).
  // Neither R2 nor Garage credentials exist.
  globalThis.__uploadRouteTestHooks = {
    isR2Configured: () => false,
    isGarageConfigured: () => false,
  };

  const response = await POST(createUploadRequest(imagePayload));
  // Must fail closed with 503 UPLOAD_STORAGE_UNAVAILABLE, never calling Supabase Storage
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, 'UPLOAD_STORAGE_UNAVAILABLE');
  assert.equal(body.mode, undefined);
  assert.equal(body.publicUrl, undefined);
});

// ---------------------------------------------------------------------------
// Authentication & Authorization Regression Tests
// ---------------------------------------------------------------------------

test('anonymous upload request is rejected with 401 and never invokes storage adapters', async () => {
  let r2Calls = 0;
  let garageCalls = 0;
  let presignedCalls = 0;

  globalThis.__uploadRouteTestHooks = {
    isR2Configured: () => true,
    isGarageConfigured: () => true,
    r2Uploader: async () => {
      r2Calls += 1;
      return 'https://cdn.example.test/leak.webp';
    },
    garageUploader: async () => {
      garageCalls += 1;
      return 'https://s3.vunph.click/media/leak.webp';
    },
    r2Presigned: async () => {
      presignedCalls += 1;
      return {
        uploadUrl: 'https://r2.example.test/upload',
        publicUrl: 'https://cdn.example.test/leak.webp',
      };
    },
  };

  const response = await POST(
    createUploadRequest(imagePayload, { token: null })
  );
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(
    body.error,
    'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.'
  );
  assert.equal(r2Calls, 0);
  assert.equal(garageCalls, 0);
  assert.equal(presignedCalls, 0);
});

test('anonymous request fails auth before payload parsing or format validation', async () => {
  let r2Calls = 0;
  let garageCalls = 0;

  globalThis.__uploadRouteTestHooks = {
    isR2Configured: () => true,
    isGarageConfigured: () => true,
    r2Uploader: async () => {
      r2Calls += 1;
      return 'https://cdn.example.test/leak.webp';
    },
    garageUploader: async () => {
      garageCalls += 1;
      return 'https://s3.vunph.click/media/leak.webp';
    },
  };

  // Unsupported content type without auth -> returns 401 (not 415)
  const resUnsupportedType = await POST(
    createUploadRequest(
      { ...imagePayload, contentType: 'application/pdf' },
      { token: null }
    )
  );
  assert.equal(resUnsupportedType.status, 401);

  // Oversized or invalid base64 without auth -> returns 401 (not 400 or 413)
  const resInvalidPayload = await POST(
    createUploadRequest(
      { ...imagePayload, base64Data: 'not-valid-base64-content' },
      { token: null }
    )
  );
  assert.equal(resInvalidPayload.status, 401);

  assert.equal(r2Calls, 0);
  assert.equal(garageCalls, 0);
});

test('invalid or expired session token is rejected with 401 without storage calls', async () => {
  let uploaderCalls = 0;
  globalThis.__uploadRouteTestHooks = {
    isR2Configured: () => true,
    r2Uploader: async () => {
      uploaderCalls += 1;
      return 'https://cdn.example.test/leak.webp';
    },
  };

  // Malformed token
  const resMalformed = await POST(
    createUploadRequest(imagePayload, { token: 'invalid.bearer.token' })
  );
  assert.equal(resMalformed.status, 401);

  // Expired token (issued with negative TTL)
  const expiredToken = issueSessionToken(
    {
      id: 'owner-expired-001',
      email: 'owner@example.com',
      role: 'owner',
    },
    -60
  );
  const resExpired = await POST(
    createUploadRequest(imagePayload, { token: expiredToken })
  );
  assert.equal(resExpired.status, 401);

  assert.equal(uploaderCalls, 0);
});

test('staff session is rejected with 403 FORBIDDEN_STAFF_OWNER_ACTION without storage calls', async () => {
  let uploaderCalls = 0;
  globalThis.__uploadRouteTestHooks = {
    isR2Configured: () => true,
    r2Uploader: async () => {
      uploaderCalls += 1;
      return 'https://cdn.example.test/leak.webp';
    },
  };

  const response = await POST(
    createUploadRequest(imagePayload, { token: staffToken })
  );
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.code, 'FORBIDDEN_STAFF_OWNER_ACTION');
  assert.equal(
    body.error,
    'Tài khoản nhân viên không có quyền thực hiện thao tác dành riêng cho chủ quán.'
  );
  assert.equal(uploaderCalls, 0);
});

test('valid owner session via cookie succeeds with storage upload', async () => {
  let r2Calls = 0;
  globalThis.__uploadRouteTestHooks = {
    isR2Configured: () => true,
    r2Uploader: async ({ buffer }) => {
      r2Calls += 1;
      assert.equal(buffer.toString(), 'hello');
      return 'https://cdn.example.test/cookie-upload.webp';
    },
  };

  const response = await POST(
    createUploadRequest(imagePayload, {
      token: null,
      cookie: `${SESSION_COOKIE_NAME}=${validOwnerToken}`,
    })
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    mode: 'r2-direct',
    publicUrl: 'https://cdn.example.test/cookie-upload.webp',
  });
  assert.equal(r2Calls, 1);
});

test('valid admin session succeeds with storage upload to Garage', async () => {
  let garageCalls = 0;
  globalThis.__uploadRouteTestHooks = {
    isR2Configured: () => false,
    isGarageConfigured: () => true,
    garageUploader: async () => {
      garageCalls += 1;
      return 'https://s3.vunph.click/media/admin-upload.webp';
    },
  };

  const response = await POST(
    createUploadRequest(imagePayload, { token: validAdminToken })
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    mode: 'garage-storage',
    publicUrl: 'https://s3.vunph.click/media/admin-upload.webp',
  });
  assert.equal(garageCalls, 1);
});

test('presigned upload URL rejects anonymous requests and succeeds for verified owner/admin', async () => {
  let presignedCalls = 0;
  globalThis.__uploadRouteTestHooks = {
    isR2Configured: () => true,
    r2Presigned: async ({ key, contentType }) => {
      presignedCalls += 1;
      assert.equal(contentType, 'image/webp');
      return {
        uploadUrl: `https://r2.example.test/upload/${key}`,
        publicUrl: `https://cdn.example.test/${key}`,
      };
    },
  };

  const presignedPayload = {
    fileName: 'banner.webp',
    contentType: 'image/webp',
  };

  // 1. Anonymous -> 401 and no presigned call
  const anonRes = await POST(
    createUploadRequest(presignedPayload, { token: null })
  );
  assert.equal(anonRes.status, 401);
  assert.equal(presignedCalls, 0);

  // 2. Staff -> 403 and no presigned call
  const staffRes = await POST(
    createUploadRequest(presignedPayload, { token: staffToken })
  );
  assert.equal(staffRes.status, 403);
  assert.equal(presignedCalls, 0);

  // 3. Valid owner -> 200 and presigned URL returned
  const ownerRes = await POST(
    createUploadRequest(presignedPayload, { token: validOwnerToken })
  );
  assert.equal(ownerRes.status, 200);
  const ownerBody = await ownerRes.json();
  assert.equal(ownerBody.mode, 'r2-presigned');
  assert.ok(ownerBody.uploadUrl.startsWith('https://r2.example.test/upload/'));
  assert.equal(presignedCalls, 1);
});

test('presigned uploads prefer Garage when configured and retain R2 as fallback', async () => {
  let garageCalls = 0;
  let r2Calls = 0;
  const presignedPayload = {
    fileName: 'banner.webp',
    contentType: 'image/webp',
  };

  globalThis.__uploadRouteTestHooks = {
    isGarageConfigured: () => true,
    isR2Configured: () => true,
    garagePresigned: async ({ key, contentType }) => {
      garageCalls += 1;
      assert.equal(contentType, 'image/webp');
      return {
        uploadUrl: `https://s3.vunph.click/qlaok-media/${key}?signature=garage`,
        publicUrl: `https://s3.vunph.click/media/${key}`,
      };
    },
    r2Presigned: async () => {
      r2Calls += 1;
      return {
        uploadUrl: 'https://cdn.example.test/r2-upload',
        publicUrl: 'https://cdn.example.test/r2-image',
      };
    },
  };

  const garageResponse = await POST(
    createUploadRequest(presignedPayload, { token: validOwnerToken })
  );
  assert.equal(garageResponse.status, 200);
  const garageBody = await garageResponse.json();
  assert.equal(garageBody.mode, 'garage-presigned');
  assert.ok(garageBody.uploadUrl.includes('signature=garage'));
  assert.ok(garageBody.publicUrl.startsWith('https://s3.vunph.click/media/'));
  assert.equal(garageCalls, 1);
  assert.equal(r2Calls, 0);

  globalThis.__uploadRouteTestHooks = {
    isGarageConfigured: () => true,
    isR2Configured: () => true,
    garagePresigned: async () => {
      throw new Error('private Garage credentials');
    },
    r2Presigned: async () => {
      r2Calls += 1;
      return {
        uploadUrl: 'https://cdn.example.test/r2-upload',
        publicUrl: 'https://cdn.example.test/r2-image',
      };
    },
  };

  const fallbackResponse = await POST(
    createUploadRequest(presignedPayload, { token: validOwnerToken })
  );
  assert.equal(fallbackResponse.status, 200);
  assert.equal((await fallbackResponse.json()).mode, 'r2-presigned');
  assert.equal(r2Calls, 1);
});

test('presigned upload without a configured object store returns 503', async () => {
  globalThis.__uploadRouteTestHooks = {
    isGarageConfigured: () => false,
    isR2Configured: () => false,
  };

  const response = await POST(
    createUploadRequest(
      { fileName: 'banner.webp', contentType: 'image/webp' },
      { token: validOwnerToken }
    )
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'UPLOAD_STORAGE_UNAVAILABLE');
});
