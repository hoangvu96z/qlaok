import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { POST } from '@/app/api/upload/route';
import {
  MAX_SUPABASE_UPLOAD_BYTES,
  SUPABASE_UPLOAD_ALLOWED_MIME_TYPES,
  SUPABASE_UPLOAD_BUCKET,
  uploadBufferToSupabaseStorage,
} from '@/lib/supabase-storage';

afterEach(() => {
  delete globalThis.__uploadRouteTestHooks;
});

function createUploadRequest(payload: Record<string, unknown>): Request {
  return new Request('http://localhost/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

const imagePayload = {
  fileName: 'menu.webp',
  contentType: 'image/webp',
  base64Data: 'data:image/webp;base64,aGVsbG8=',
};

test('upload route prefers R2 and preserves its response contract', async () => {
  let supabaseCalls = 0;
  globalThis.__uploadRouteTestHooks = {
    isR2Configured: () => true,
    r2Uploader: async ({ buffer }) => {
      assert.equal(buffer.toString(), 'hello');
      return 'https://cdn.example.test/menu.webp';
    },
    supabaseUploader: async () => {
      supabaseCalls += 1;
      return 'https://supabase.example.test/menu.webp';
    },
  };

  const response = await POST(createUploadRequest(imagePayload));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    mode: 'r2-direct',
    publicUrl: 'https://cdn.example.test/menu.webp',
  });
  assert.equal(supabaseCalls, 0);
});

test('upload route falls back to Supabase Storage when R2 is not configured', async () => {
  const uploaded: Array<{ key: string; contentType: string; buffer: Buffer }> = [];
  globalThis.__uploadRouteTestHooks = {
    isR2Configured: () => false,
    r2Uploader: async () => {
      throw new Error('R2 must not be called when unavailable');
    },
    supabaseUploader: async (params) => {
      uploaded.push(params);
      return 'https://project.supabase.co/storage/v1/object/public/qlaok-media/menu.webp';
    },
  };

  const response = await POST(createUploadRequest(imagePayload));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    mode: 'supabase-storage',
    publicUrl:
      'https://project.supabase.co/storage/v1/object/public/qlaok-media/menu.webp',
  });
  assert.equal(uploaded[0]?.contentType, 'image/webp');
  assert.equal(uploaded[0]?.buffer.toString(), 'hello');
  assert.match(uploaded[0]?.key || '', /^uploads\/\d+-menu\.webp$/);
});

test('upload route falls back to Supabase Storage when an R2 upload fails', async () => {
  globalThis.__uploadRouteTestHooks = {
    isR2Configured: () => true,
    r2Uploader: async () => {
      throw new Error('R2 credentials must not be returned to the client');
    },
    supabaseUploader: async () =>
      'https://project.supabase.co/storage/v1/object/public/qlaok-media/menu.webp',
  };

  const response = await POST(createUploadRequest(imagePayload));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    mode: 'supabase-storage',
    publicUrl:
      'https://project.supabase.co/storage/v1/object/public/qlaok-media/menu.webp',
  });
});

test('upload route returns a safe unavailable response when both stores fail', async () => {
  globalThis.__uploadRouteTestHooks = {
    isR2Configured: () => false,
    supabaseUploader: async () => {
      throw new Error('private backend endpoint and key');
    },
  };

  const response = await POST(createUploadRequest(imagePayload));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, 'UPLOAD_STORAGE_UNAVAILABLE');
  assert.equal(JSON.stringify(body).includes('private backend'), false);
});

test('upload route rejects non-image types and payloads above the storage limit', async () => {
  let uploadCalls = 0;
  globalThis.__uploadRouteTestHooks = {
    isR2Configured: () => false,
    supabaseUploader: async () => {
      uploadCalls += 1;
      return 'https://project.supabase.co/image.webp';
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
        Math.ceil(MAX_SUPABASE_UPLOAD_BYTES / 3) * 4 + 4
      )}`,
    })
  );
  assert.equal(oversized.status, 413);
  assert.equal(uploadCalls, 0);
});

test('Supabase Storage creates a bounded public image bucket then retries upload', async () => {
  const attempts: Array<{ key: string; options: unknown }> = [];
  const createdBuckets: Array<{ name: string; options: Record<string, unknown> }> = [];
  const client = {
    storage: {
      from(bucket: string) {
        assert.equal(bucket, SUPABASE_UPLOAD_BUCKET);
        return {
          async upload(key: string, _body: Buffer, options: unknown) {
            attempts.push({ key, options });
            return attempts.length === 1
              ? { data: null, error: { message: 'Bucket not found', statusCode: '404' } }
              : { data: { path: key }, error: null };
          },
          getPublicUrl(key: string) {
            return {
              data: {
                publicUrl: `https://project.supabase.co/storage/v1/object/public/${SUPABASE_UPLOAD_BUCKET}/${key}`,
              },
            };
          },
        };
      },
      async createBucket(name: string, options: Record<string, unknown>) {
        createdBuckets.push({ name, options });
        return { data: null, error: null };
      },
      async getBucket() {
        return { data: { public: true }, error: null };
      },
    },
  } as unknown as SupabaseClient;

  const publicUrl = await uploadBufferToSupabaseStorage(
    {
      key: 'uploads/123-menu.webp',
      contentType: 'image/webp',
      buffer: Buffer.from('hello'),
    },
    client
  );

  assert.equal(
    publicUrl,
    'https://project.supabase.co/storage/v1/object/public/qlaok-media/uploads/123-menu.webp'
  );
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[0]?.options, {
    cacheControl: '31536000',
    contentType: 'image/webp',
    upsert: false,
  });
  assert.equal(createdBuckets[0]?.name, SUPABASE_UPLOAD_BUCKET);
  assert.deepEqual(createdBuckets[0]?.options, {
    public: true,
    fileSizeLimit: MAX_SUPABASE_UPLOAD_BYTES,
    allowedMimeTypes: [...SUPABASE_UPLOAD_ALLOWED_MIME_TYPES],
  });
});

test('Supabase Storage handles a concurrent bucket create and retries only a public bucket', async () => {
  let attempts = 0;
  let lookupCalls = 0;
  const client = {
    storage: {
      from: () => ({
        async upload() {
          attempts += 1;
          return attempts === 1
            ? { data: null, error: { message: 'Bucket not found', statusCode: '404' } }
            : { data: { path: 'uploads/menu.webp' }, error: null };
        },
        getPublicUrl: () => ({ data: { publicUrl: 'https://cdn.example.test/menu.webp' } }),
      }),
      async createBucket() {
        return { data: null, error: { message: 'Bucket already exists' } };
      },
      async getBucket() {
        lookupCalls += 1;
        return { data: { public: true }, error: null };
      },
    },
  } as unknown as SupabaseClient;

  const publicUrl = await uploadBufferToSupabaseStorage(
    { key: 'uploads/menu.webp', contentType: 'image/webp', buffer: Buffer.from('x') },
    client
  );
  assert.equal(publicUrl, 'https://cdn.example.test/menu.webp');
  assert.equal(attempts, 2);
  assert.equal(lookupCalls, 1);
});

test('Supabase Storage does not retry when bucket creation fails and bucket is not public', async () => {
  let attempts = 0;
  const client = {
    storage: {
      from: () => ({
        async upload() {
          attempts += 1;
          return { data: null, error: { message: 'Bucket not found', statusCode: 404 } };
        },
        getPublicUrl: () => ({ data: { publicUrl: 'https://cdn.example.test/menu.webp' } }),
      }),
      async createBucket() {
        return { data: null, error: { message: 'Storage is unavailable' } };
      },
      async getBucket() {
        return { data: { public: false }, error: null };
      },
    },
  } as unknown as SupabaseClient;

  await assert.rejects(
    uploadBufferToSupabaseStorage(
      { key: 'uploads/menu.webp', contentType: 'image/webp', buffer: Buffer.from('x') },
      client
    ),
    (error: unknown) => {
      assert.equal(
        (error as { message?: string }).message,
        'Storage is unavailable'
      );
      return true;
    }
  );
  assert.equal(attempts, 1);
});
