import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import {
  createR2PresignedUploadUrl,
  isR2Configured,
  uploadBufferToR2,
} from '@/lib/r2';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_BASE64_UPLOAD_LENGTH,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_REQUEST_BYTES,
  createGaragePresignedUploadUrl,
  isGarageConfigured,
  uploadBufferToGarage,
} from '@/lib/garage-storage';
import {
  isStaffSessionUser,
  requireAuthenticatedUser,
} from '@/lib/server-auth';

const ALLOWED_IMAGE_TYPES: ReadonlySet<string> = new Set(
  ALLOWED_IMAGE_MIME_TYPES
);
const MAX_UPLOAD_FILENAME_LENGTH = 120;
const DEFAULT_UPLOAD_FILENAME = 'image.webp';

function sanitizeUploadFileName(rawFileName: unknown): string {
  if (typeof rawFileName !== 'string') {
    return DEFAULT_UPLOAD_FILENAME;
  }

  const replaced = rawFileName
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '_');

  const extMatch = /(\.[a-zA-Z0-9]{1,10})$/.exec(replaced);
  if (extMatch) {
    const ext = extMatch[1];
    const rawStem = replaced.slice(0, -ext.length);
    const stemBudget = MAX_UPLOAD_FILENAME_LENGTH - ext.length;
    const boundedStem = (
      rawStem.length > stemBudget ? rawStem.slice(-stemBudget) : rawStem
    ).replace(/^[._-]+|[._-]+$/g, '');

    if (boundedStem && /[a-zA-Z0-9]/.test(boundedStem)) {
      return `${boundedStem}${ext}`;
    }
    return DEFAULT_UPLOAD_FILENAME;
  }

  const bounded = (
    replaced.length > MAX_UPLOAD_FILENAME_LENGTH
      ? replaced.slice(-MAX_UPLOAD_FILENAME_LENGTH)
      : replaced
  ).replace(/^[._-]+|[._-]+$/g, '');

  return bounded && /[a-zA-Z0-9]/.test(bounded)
    ? bounded
    : DEFAULT_UPLOAD_FILENAME;
}

function getSafeUploadErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return 'STORAGE_PROVIDER_ERROR';
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(code)
    ? code
    : 'STORAGE_PROVIDER_ERROR';
}

function logStorageProviderFailure(provider: 'garage' | 'r2', error: unknown) {
  console.warn('upload.storage_provider_failed', {
    provider,
    code: getSafeUploadErrorCode(error),
  });
}

interface UploadRouteTestHooks {
  r2Uploader?: typeof uploadBufferToR2;
  garageUploader?: (params: {
    key: string;
    contentType: string;
    buffer: Buffer;
  }) => Promise<string | null>;
  isR2Configured?: () => boolean;
  isGarageConfigured?: () => boolean;
  r2Presigned?: typeof createR2PresignedUploadUrl;
  garagePresigned?: typeof createGaragePresignedUploadUrl;
}

declare global {
  var __uploadRouteTestHooks: UploadRouteTestHooks | undefined;
}

function buildUploadFileTooLargeResponse() {
  return NextResponse.json(
    {
      error: 'Image is too large',
      code: 'UPLOAD_FILE_TOO_LARGE',
    },
    { status: 413 }
  );
}

async function readBoundedUploadJson(req: Request): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: NextResponse }
> {
  const rawContentLength = req.headers.get('content-length')?.trim();
  if (rawContentLength) {
    const declaredBytes = Number(rawContentLength);
    if (
      Number.isFinite(declaredBytes) &&
      declaredBytes > MAX_UPLOAD_REQUEST_BYTES
    ) {
      try {
        await req.body?.cancel();
      } catch {
        // Ignore stream cancellation error
      }
      return {
        ok: false,
        response: buildUploadFileTooLargeResponse(),
      };
    }
  }

  const reader = req.body?.getReader();
  if (!reader) {
    throw new Error('Missing request body');
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      const chunk =
        typeof value === 'string'
          ? Buffer.from(value, 'utf8')
          : Buffer.isBuffer(value)
            ? value
            : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      if (chunk.byteLength === 0) continue;

      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_UPLOAD_REQUEST_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // Ignore stream cancellation error
        }
        return {
          ok: false,
          response: buildUploadFileTooLargeResponse(),
        };
      }

      chunks.push(chunk);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore reader lock release error
    }
  }

  const rawText = Buffer.concat(chunks, totalBytes).toString('utf8');
  const parsed = JSON.parse(rawText);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid JSON payload');
  }

  return {
    ok: true,
    body: parsed as Record<string, unknown>,
  };
}

export async function POST(req: Request) {
  const auth = await requireAuthenticatedUser(req);
  if (auth.errorResponse) return auth.errorResponse;

  if (
    isStaffSessionUser(auth.user) ||
    (auth.user.role !== 'owner' && auth.user.role !== 'admin')
  ) {
    return NextResponse.json(
      {
        error:
          'Tài khoản nhân viên không có quyền thực hiện thao tác dành riêng cho chủ quán.',
        code: 'FORBIDDEN_STAFF_OWNER_ACTION',
      },
      { status: 403 }
    );
  }

  try {
    const parsedRequest = await readBoundedUploadJson(req);
    if (!parsedRequest.ok) {
      return parsedRequest.response;
    }

    const {
      fileName = 'image.webp',
      contentType = 'image/webp',
      base64Data,
      contentLength,
    } = parsedRequest.body as {
      fileName?: unknown;
      contentType?: unknown;
      base64Data?: unknown;
      contentLength?: unknown;
    };

    const normalizedContentType =
      typeof contentType === 'string' ? contentType.trim().toLowerCase() : '';
    if (!ALLOWED_IMAGE_TYPES.has(normalizedContentType)) {
      return NextResponse.json(
        { error: 'Unsupported image type', code: 'UPLOAD_INVALID_CONTENT_TYPE' },
        { status: 415 }
      );
    }

    const safeName = sanitizeUploadFileName(fileName);
    const uploadId = randomUUID().replace(/-/g, '');
    const key = `uploads/${Date.now()}-${uploadId}-${safeName}`;
    const hooks = globalThis.__uploadRouteTestHooks;
    const r2Configured = hooks?.isR2Configured
      ? hooks.isR2Configured()
      : isR2Configured();
    const garageConfigured = hooks?.isGarageConfigured
      ? hooks.isGarageConfigured()
      : isGarageConfigured();

    if (typeof base64Data === 'string' && base64Data.length > 0) {
      const dataUrlMatch = base64Data.startsWith('data:')
        ? /^data:([^;,]+);base64,/i.exec(base64Data)
        : null;
      if (
        base64Data.startsWith('data:') &&
        (!dataUrlMatch ||
          dataUrlMatch[1]?.toLowerCase() !== normalizedContentType)
      ) {
        return NextResponse.json(
          { error: 'Image type does not match payload', code: 'UPLOAD_INVALID_PAYLOAD' },
          { status: 400 }
        );
      }
      const rawBase64 = dataUrlMatch
        ? base64Data.slice(dataUrlMatch[0].length)
        : base64Data;
      const maxBase64Length = MAX_BASE64_UPLOAD_LENGTH;
      if (
        rawBase64.length > maxBase64Length ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(rawBase64) ||
        rawBase64.length % 4 === 1
      ) {
        return NextResponse.json(
          {
            error: 'Invalid or oversized image payload',
            code: 'UPLOAD_INVALID_PAYLOAD',
          },
          { status: rawBase64.length > maxBase64Length ? 413 : 400 }
        );
      }

      const buffer = Buffer.from(rawBase64, 'base64');
      if (buffer.length === 0) {
        return NextResponse.json(
          { error: 'Invalid image payload', code: 'UPLOAD_INVALID_PAYLOAD' },
          { status: 400 }
        );
      }
      if (buffer.length > MAX_UPLOAD_BYTES) {
        return buildUploadFileTooLargeResponse();
      }

      let garageUrl: string | null = null;
      try {
        if (garageConfigured) {
          const uploader =
            hooks?.garageUploader ?? uploadBufferToGarage;
          garageUrl = await uploader({
            key,
            contentType: normalizedContentType,
            buffer,
          });
        }
      } catch (error) {
        // Do not log raw error, base64 payload, or secrets
        logStorageProviderFailure('garage', error);
      }

      if (garageUrl) {
        return NextResponse.json({
          mode: 'garage-storage',
          publicUrl: garageUrl,
        });
      }

      let r2Url: string | null = null;
      try {
        if (r2Configured) {
          const uploader = hooks?.r2Uploader ?? uploadBufferToR2;
          r2Url = await uploader({
            key,
            contentType: normalizedContentType,
            buffer,
          });
        }
      } catch (error) {
        // Do not log raw error, base64 payload, or secrets
        logStorageProviderFailure('r2', error);
      }

      if (r2Url) {
        return NextResponse.json({
          mode: 'r2-direct',
          publicUrl: r2Url,
        });
      }

      const anyConfigured = r2Configured || garageConfigured;
      return NextResponse.json(
        {
          error: anyConfigured
            ? 'UPLOAD_STORAGE_FAILED'
            : 'UPLOAD_STORAGE_UNAVAILABLE',
          code: anyConfigured
            ? 'UPLOAD_STORAGE_FAILED'
            : 'UPLOAD_STORAGE_UNAVAILABLE',
        },
        { status: anyConfigured ? 502 : 503 }
      );
    }

    if (base64Data !== undefined && base64Data !== null) {
      return NextResponse.json(
        { error: 'Invalid image payload', code: 'UPLOAD_INVALID_PAYLOAD' },
        { status: 400 }
      );
    }

    if (
      typeof contentLength !== 'number' ||
      !Number.isInteger(contentLength) ||
      contentLength < 1
    ) {
      return NextResponse.json(
        {
          error: 'Invalid or missing contentLength',
          code: 'UPLOAD_INVALID_PAYLOAD',
        },
        { status: 400 }
      );
    }

    if (contentLength > MAX_UPLOAD_BYTES) {
      return buildUploadFileTooLargeResponse();
    }

    if (garageConfigured) {
      try {
        const presignedFn =
          hooks?.garagePresigned ?? createGaragePresignedUploadUrl;
        const presigned = await presignedFn({
          key,
          contentType: normalizedContentType,
          contentLength,
        });
        if (presigned) {
          return NextResponse.json({
            mode: 'garage-presigned',
            ...presigned,
          });
        }
      } catch (error) {
        // Do not log raw error or secrets; configured R2 may still serve as fallback.
        logStorageProviderFailure('garage', error);
      }
    }

    if (r2Configured) {
      try {
        const presignedFn = hooks?.r2Presigned ?? createR2PresignedUploadUrl;
        const presigned = await presignedFn({
          key,
          contentType: normalizedContentType,
          contentLength,
        });
        if (presigned) {
          return NextResponse.json({
            mode: 'r2-presigned',
            ...presigned,
          });
        }
      } catch (error) {
        // Do not log raw error or secrets
        logStorageProviderFailure('r2', error);
      }
    }

    const anyConfigured = r2Configured || garageConfigured;

    return NextResponse.json(
      {
        error: anyConfigured
          ? 'UPLOAD_STORAGE_FAILED'
          : 'UPLOAD_STORAGE_UNAVAILABLE',
        code: anyConfigured
          ? 'UPLOAD_STORAGE_FAILED'
          : 'UPLOAD_STORAGE_UNAVAILABLE',
      },
      { status: anyConfigured ? 502 : 503 }
    );
  } catch {
    // Do not log raw error, base64 payload, or secrets
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
