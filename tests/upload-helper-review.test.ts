import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  UploadError,
  isValidPublicUrl,
  handleUploadResponse,
  uploadCompressedImage,
} from '@/lib/upload-helper';

afterEach(() => {
  delete globalThis.__uploadHelperTestHooks;
});

// Helper to create mock Response objects
function createMockResponse(
  body: unknown,
  init: { status?: number; statusText?: string; headers?: Record<string, string> } = {}
): Response {
  const status = init.status ?? 200;
  const isString = typeof body === 'string';
  const bodyText = isString ? body : JSON.stringify(body);
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && !isString) {
    headers.set('Content-Type', 'application/json');
  }

  return new Response(bodyText, {
    status,
    statusText: init.statusText,
    headers,
  });
}

// ---------------------------------------------------------------------------
// 1. isValidPublicUrl tests
// ---------------------------------------------------------------------------
test('isValidPublicUrl accepts valid HTTPS and HTTP URLs', () => {
  assert.equal(
    isValidPublicUrl('https://cdn.qlaok.vn/uploads/1700000000-food.webp'),
    true
  );
  assert.equal(
    isValidPublicUrl('http://localhost:3000/uploads/test.webp'),
    true
  );
  assert.equal(
    isValidPublicUrl('https://pub-abcdef.r2.dev/uploads/item.webp'),
    true
  );
});

test('isValidPublicUrl rejects data URIs, relative paths, and non-HTTP schemes', () => {
  // Never allow data URIs
  assert.equal(
    isValidPublicUrl('data:image/webp;base64,dGVzdA=='),
    false
  );
  assert.equal(
    isValidPublicUrl('data:text/plain;charset=utf-8,hello'),
    false
  );

  // Reject relative and local disk paths
  assert.equal(isValidPublicUrl('/uploads/1700000000-food.webp'), false);
  assert.equal(isValidPublicUrl('uploads/1700000000-food.webp'), false);
  assert.equal(isValidPublicUrl('/api/upload'), false);

  // Reject other protocols
  assert.equal(isValidPublicUrl('blob:http://localhost:3000/uuid-123'), false);
  assert.equal(isValidPublicUrl('javascript:alert(1)'), false);
  assert.equal(isValidPublicUrl('ftp://example.com/photo.webp'), false);

  // Reject falsy, non-string, or empty
  assert.equal(isValidPublicUrl(''), false);
  assert.equal(isValidPublicUrl('   '), false);
  assert.equal(isValidPublicUrl(null), false);
  assert.equal(isValidPublicUrl(undefined), false);
  assert.equal(isValidPublicUrl(123), false);
  assert.equal(isValidPublicUrl({}), false);
});

// ---------------------------------------------------------------------------
// 2. handleUploadResponse tests
// ---------------------------------------------------------------------------
test('handleUploadResponse resolves valid publicUrl on 200 response', async () => {
  const cdnUrl = 'https://cdn.qlaok.vn/uploads/1700000000-tea.webp';
  const res = createMockResponse({
    mode: 'r2-direct',
    publicUrl: cdnUrl,
  });

  const resolved = await handleUploadResponse(res);
  assert.equal(resolved, cdnUrl);
});

test('handleUploadResponse rejects when 200 response contains a Base64 data URI', async () => {
  const res = createMockResponse({
    mode: 'inline-webp',
    publicUrl: 'data:image/webp;base64,dGVzdA==',
  });

  await assert.rejects(
    async () => handleUploadResponse(res),
    (err: unknown) => {
      assert.ok(err instanceof UploadError);
      assert.equal(err.code, 'UPLOAD_STORAGE_FAILED');
      assert.equal(err.message, 'UPLOAD_STORAGE_FAILED');
      return true;
    }
  );
});

test('handleUploadResponse rejects when 200 response contains relative /uploads/ path', async () => {
  const res = createMockResponse({
    publicUrl: '/uploads/local-file.webp',
  });

  await assert.rejects(
    async () => handleUploadResponse(res),
    (err: unknown) => {
      assert.ok(err instanceof UploadError);
      assert.equal(err.code, 'UPLOAD_STORAGE_FAILED');
      return true;
    }
  );
});

test('handleUploadResponse rejects when 200 response is missing publicUrl', async () => {
  const res = createMockResponse({
    mode: 'r2-direct',
  });

  await assert.rejects(
    async () => handleUploadResponse(res),
    (err: unknown) => {
      assert.ok(err instanceof UploadError);
      assert.equal(err.code, 'UPLOAD_STORAGE_FAILED');
      return true;
    }
  );
});

test('handleUploadResponse gracefully handles response.json() failure on 200 response', async () => {
  // Non-JSON body with 200 status
  const res = createMockResponse('<html><body>OK but not JSON</body></html>', {
    status: 200,
  });

  await assert.rejects(
    async () => handleUploadResponse(res),
    (err: unknown) => {
      assert.ok(err instanceof UploadError);
      assert.equal(err.code, 'UPLOAD_STORAGE_FAILED');
      return true;
    }
  );
});

test('handleUploadResponse rejects with UPLOAD_STORAGE_UNAVAILABLE on 503', async () => {
  const res = createMockResponse(
    {
      error: 'UPLOAD_STORAGE_UNAVAILABLE',
      code: 'UPLOAD_STORAGE_UNAVAILABLE',
    },
    { status: 503 }
  );

  await assert.rejects(
    async () => handleUploadResponse(res),
    (err: unknown) => {
      assert.ok(err instanceof UploadError);
      assert.equal(err.code, 'UPLOAD_STORAGE_UNAVAILABLE');
      assert.equal(err.message, 'UPLOAD_STORAGE_UNAVAILABLE');
      return true;
    }
  );
});

test('handleUploadResponse rejects with UPLOAD_STORAGE_FAILED on 502', async () => {
  const res = createMockResponse(
    {
      error: 'UPLOAD_STORAGE_FAILED',
      code: 'UPLOAD_STORAGE_FAILED',
    },
    { status: 502 }
  );

  await assert.rejects(
    async () => handleUploadResponse(res),
    (err: unknown) => {
      assert.ok(err instanceof UploadError);
      assert.equal(err.code, 'UPLOAD_STORAGE_FAILED');
      assert.equal(err.message, 'UPLOAD_STORAGE_FAILED');
      return true;
    }
  );
});

test('handleUploadResponse handles non-JSON HTML error body on 503 and 502', async () => {
  const html503 = createMockResponse('<html>503 Service Unavailable</html>', {
    status: 503,
  });
  await assert.rejects(
    async () => handleUploadResponse(html503),
    (err: unknown) => {
      assert.ok(err instanceof UploadError);
      assert.equal(err.code, 'UPLOAD_STORAGE_UNAVAILABLE');
      return true;
    }
  );

  const html502 = createMockResponse('<html>502 Bad Gateway</html>', {
    status: 502,
  });
  await assert.rejects(
    async () => handleUploadResponse(html502),
    (err: unknown) => {
      assert.ok(err instanceof UploadError);
      assert.equal(err.code, 'UPLOAD_STORAGE_FAILED');
      return true;
    }
  );
});

test('handleUploadResponse rejects with UPLOAD_STORAGE_FAILED on 500 or 400 without leaking details', async () => {
  const res500 = createMockResponse(
    { error: 'Internal database connection timeout at server.internal:5432' },
    { status: 500 }
  );
  await assert.rejects(
    async () => handleUploadResponse(res500),
    (err: unknown) => {
      assert.ok(err instanceof UploadError);
      assert.equal(err.code, 'UPLOAD_STORAGE_FAILED');
      // Verify raw sensitive backend error is not leaked in message or code
      assert.equal(err.message.includes('server.internal'), false);
      assert.equal(err.message.includes('5432'), false);
      return true;
    }
  );

  const res400 = createMockResponse(
    { error: 'Missing base64Data payload' },
    { status: 400 }
  );
  await assert.rejects(
    async () => handleUploadResponse(res400),
    (err: unknown) => {
      assert.ok(err instanceof UploadError);
      assert.equal(err.code, 'UPLOAD_STORAGE_FAILED');
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// 3. uploadCompressedImage end-to-end tests with test hooks
// ---------------------------------------------------------------------------

function setupMockEnvironment(options: {
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  fileReaderResult?: string;
  fileReaderShouldFail?: boolean;
  compressorShouldFail?: boolean;
}) {
  class MockFileReader {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: ((err: unknown) => void) | null = null;

    readAsDataURL(_blob: unknown) {
      if (options.fileReaderShouldFail) {
        queueMicrotask(() => {
          this.onerror?.(new Error('FileReader mock error'));
        });
        return;
      }
      queueMicrotask(() => {
        this.result = options.fileReaderResult ?? 'data:image/webp;base64,bW9ja2VkLWJhc2U2NA==';
        this.onload?.();
      });
    }
  }

  globalThis.__uploadHelperTestHooks = {
    compressor: async (_file, _opts) => {
      if (options.compressorShouldFail) {
        throw new Error('Image compression mock failure');
      }
      return new Blob(['mock-compressed-data'], { type: 'image/webp' });
    },
    fileReaderClass: MockFileReader as unknown as typeof FileReader,
    fetchFn: options.fetchImpl as typeof fetch,
  };
}

interface MockUploadPayload {
  fileName?: string;
  contentType?: string;
  base64Data?: string;
}

test('uploadCompressedImage succeeds and resolves validated publicUrl', async () => {
  const expectedUrl = 'https://cdn.qlaok.vn/uploads/1700000000-matcha.webp';
  let capturedBody: MockUploadPayload | null = null;

  setupMockEnvironment({
    fetchImpl: async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body)) as MockUploadPayload;
      return createMockResponse({
        mode: 'r2-direct',
        publicUrl: expectedUrl,
      });
    },
  });

  const file = new File(['dummy-image-bytes'], 'matcha-latte.png', {
    type: 'image/png',
  });

  const resultUrl = await uploadCompressedImage(file);
  assert.equal(resultUrl, expectedUrl);
  const payload = capturedBody as MockUploadPayload | null;
  assert.ok(payload);
  assert.equal(payload.fileName, 'matcha-latte.webp');
  assert.equal(payload.contentType, 'image/webp');
  assert.equal(payload.base64Data, 'data:image/webp;base64,bW9ja2VkLWJhc2U2NA==');
});

test('uploadCompressedImage rejects on 503 and never returns Base64 data URI', async () => {
  setupMockEnvironment({
    fetchImpl: async () => {
      return createMockResponse(
        {
          error: 'UPLOAD_STORAGE_UNAVAILABLE',
          code: 'UPLOAD_STORAGE_UNAVAILABLE',
        },
        { status: 503 }
      );
    },
  });

  const file = new File(['dummy'], 'coffee.jpg', { type: 'image/jpeg' });

  await assert.rejects(
    async () => uploadCompressedImage(file),
    (err: unknown) => {
      assert.ok(err instanceof UploadError);
      assert.equal(err.code, 'UPLOAD_STORAGE_UNAVAILABLE');
      // Critical invariant: must NEVER return or resolve a data URI
      assert.equal(String(err).includes('data:image/webp'), false);
      return true;
    }
  );
});

test('uploadCompressedImage rejects on 502 and never returns Base64 data URI', async () => {
  setupMockEnvironment({
    fetchImpl: async () => {
      return createMockResponse(
        {
          error: 'UPLOAD_STORAGE_FAILED',
          code: 'UPLOAD_STORAGE_FAILED',
        },
        { status: 502 }
      );
    },
  });

  const file = new File(['dummy'], 'tea.jpg', { type: 'image/jpeg' });

  await assert.rejects(
    async () => uploadCompressedImage(file),
    (err: unknown) => {
      assert.ok(err instanceof UploadError);
      assert.equal(err.code, 'UPLOAD_STORAGE_FAILED');
      assert.equal(String(err).includes('data:image/webp'), false);
      return true;
    }
  );
});

test('uploadCompressedImage rejects when fetch throws network error without returning Base64', async () => {
  setupMockEnvironment({
    fetchImpl: async () => {
      throw new TypeError('Failed to fetch: Connection refused');
    },
  });

  const file = new File(['dummy'], 'smoothie.png', { type: 'image/png' });

  await assert.rejects(
    async () => uploadCompressedImage(file),
    (err: unknown) => {
      assert.ok(err instanceof UploadError);
      assert.equal(err.code, 'UPLOAD_STORAGE_FAILED');
      assert.equal(String(err).includes('data:image/webp'), false);
      return true;
    }
  );
});

test('uploadCompressedImage rejects when 200 response returns a data URI instead of publicUrl', async () => {
  setupMockEnvironment({
    fetchImpl: async () => {
      return createMockResponse({
        publicUrl: 'data:image/webp;base64,another-data-uri',
      });
    },
  });

  const file = new File(['dummy'], 'juice.png', { type: 'image/png' });

  await assert.rejects(
    async () => uploadCompressedImage(file),
    (err: unknown) => {
      assert.ok(err instanceof UploadError);
      assert.equal(err.code, 'UPLOAD_STORAGE_FAILED');
      assert.equal(String(err).includes('data:image/webp'), false);
      return true;
    }
  );
});

test('uploadCompressedImage rejects when compression fails', async () => {
  setupMockEnvironment({
    compressorShouldFail: true,
    fetchImpl: async () => createMockResponse({ publicUrl: 'https://example.com/pic.webp' }),
  });

  const file = new File(['corrupted-bytes'], 'broken.jpg', { type: 'image/jpeg' });

  await assert.rejects(
    async () => uploadCompressedImage(file),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(String(err).includes('data:image/webp'), false);
      return true;
    }
  );
});

test('uploadCompressedImage rejects when FileReader fails', async () => {
  setupMockEnvironment({
    fileReaderShouldFail: true,
    fetchImpl: async () => createMockResponse({ publicUrl: 'https://example.com/pic.webp' }),
  });

  const file = new File(['bytes'], 'test.png', { type: 'image/png' });

  await assert.rejects(
    async () => uploadCompressedImage(file),
    (err: unknown) => {
      assert.ok(err instanceof UploadError);
      assert.equal(err.code, 'UPLOAD_STORAGE_FAILED');
      assert.equal(String(err).includes('data:image/webp'), false);
      return true;
    }
  );
});
