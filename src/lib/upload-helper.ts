import imageCompression from 'browser-image-compression';

export class UploadError extends Error {
  code: string;

  constructor(code: string, message?: string) {
    super(message || code);
    this.name = 'UploadError';
    this.code = code;
  }
}

export interface UploadHelperTestHooks {
  compressor?: (
    file: File,
    options?: Record<string, unknown>
  ) => Promise<Blob | File>;
  fileReaderClass?: typeof FileReader;
  fetchFn?: typeof fetch;
}

declare global {
  var __uploadHelperTestHooks: UploadHelperTestHooks | undefined;
}

/**
 * Validates that a candidate string is an absolute HTTP(S) URL.
 * Strictly disallows Base64 Data URIs, relative paths (/uploads/...), and non-http(s) schemes.
 */
export function isValidPublicUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (
    !trimmed ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('/uploads/')
  ) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Resolves a safe, user-presentable error code from an upload response payload and status.
 * Prefers UPLOAD_STORAGE_UNAVAILABLE or UPLOAD_STORAGE_FAILED when supplied by API.
 */
function resolveUploadErrorCode(status: number, data: unknown): string {
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if (
      record.code === 'UPLOAD_STORAGE_UNAVAILABLE' ||
      record.error === 'UPLOAD_STORAGE_UNAVAILABLE'
    ) {
      return 'UPLOAD_STORAGE_UNAVAILABLE';
    }
    if (
      record.code === 'UPLOAD_STORAGE_FAILED' ||
      record.error === 'UPLOAD_STORAGE_FAILED'
    ) {
      return 'UPLOAD_STORAGE_FAILED';
    }
    if (
      typeof record.code === 'string' &&
      /^[A-Z0-9_]{3,50}$/.test(record.code)
    ) {
      return record.code;
    }
  }

  if (status === 503) {
    return 'UPLOAD_STORAGE_UNAVAILABLE';
  }

  return 'UPLOAD_STORAGE_FAILED';
}

/**
 * Pure response handler for upload endpoint responses.
 * Resolves only a validated HTTP(S) public URL.
 * On non-2xx, invalid JSON, or missing/invalid publicUrl, rejects with an UploadError.
 * Never returns local fallback or Base64 data URIs.
 */
export async function handleUploadResponse(res: Response): Promise<string> {
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // Gracefully handle response.json() failure without crashing
    data = null;
  }

  const payload =
    data && typeof data === 'object'
      ? (data as Record<string, unknown>)
      : null;

  if (res.ok) {
    if (isValidPublicUrl(payload?.publicUrl)) {
      return (payload.publicUrl as string).trim();
    }
    const code = resolveUploadErrorCode(res.status, data);
    throw new UploadError(code);
  }

  const code = resolveUploadErrorCode(res.status, data);
  throw new UploadError(code);
}

/**
 * Shared client-side image compression & upload helper.
 * 1. Compresses image to lightweight WebP (max 720px, <100KB).
 * 2. Reads image as WebP data URL and sends to /api/upload.
 * 3. Resolves only validated public HTTP(S) URL from successful storage upload.
 *    Never falls back to local Base64 Data URI on failure.
 */
export async function uploadCompressedImage(file: File): Promise<string> {
  const hooks = globalThis.__uploadHelperTestHooks;
  const compress = hooks?.compressor ?? imageCompression;
  const ReaderClass =
    hooks?.fileReaderClass ??
    (typeof FileReader !== 'undefined' ? FileReader : null);
  const doFetch = hooks?.fetchFn ?? fetch;

  const compressed = await compress(file, {
    maxSizeMB: 0.1,
    maxWidthOrHeight: 720,
    useWebWorker: true,
    fileType: 'image/webp',
    initialQuality: 0.82,
  });

  if (!ReaderClass) {
    throw new UploadError('UPLOAD_STORAGE_FAILED');
  }

  const base64Data: string = await new Promise((resolve, reject) => {
    const reader = new ReaderClass();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new UploadError('UPLOAD_STORAGE_FAILED'));
    reader.readAsDataURL(compressed);
  });

  let res: Response;
  try {
    res = await doFetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: file.name.replace(/\.[^.]+$/, '.webp'),
        contentType: 'image/webp',
        base64Data,
      }),
    });
  } catch {
    // Network or fetch thrown error — do not log raw error or payload
    throw new UploadError('UPLOAD_STORAGE_FAILED');
  }

  return handleUploadResponse(res);
}
