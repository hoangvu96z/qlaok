import { NextResponse } from 'next/server';
import {
  createR2PresignedUploadUrl,
  isR2Configured,
  uploadBufferToR2,
} from '@/lib/r2';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_UPLOAD_BYTES,
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
    const body = await req.json();
    const {
      fileName = 'image.webp',
      contentType = 'image/webp',
      base64Data,
    } = body as {
      fileName?: string;
      contentType?: string;
      base64Data?: string;
    };

    const normalizedContentType =
      typeof contentType === 'string' ? contentType.trim().toLowerCase() : '';
    if (!ALLOWED_IMAGE_TYPES.has(normalizedContentType)) {
      return NextResponse.json(
        { error: 'Unsupported image type', code: 'UPLOAD_INVALID_CONTENT_TYPE' },
        { status: 415 }
      );
    }

    const safeFileName = typeof fileName === 'string' ? fileName : 'image.webp';
    const safeName = safeFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `uploads/${Date.now()}-${safeName}`;
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
      const maxBase64Length = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4;
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
        return NextResponse.json(
          {
            error: 'Image is too large',
            code: 'UPLOAD_FILE_TOO_LARGE',
          },
          { status: 413 }
        );
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
      } catch {
        // Do not log raw error, base64 payload, or secrets
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
      } catch {
        // Do not log raw error, base64 payload, or secrets
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

    if (garageConfigured) {
      try {
        const presignedFn =
          hooks?.garagePresigned ?? createGaragePresignedUploadUrl;
        const presigned = await presignedFn({
          key,
          contentType: normalizedContentType,
        });
        if (presigned) {
          return NextResponse.json({
            mode: 'garage-presigned',
            ...presigned,
          });
        }
      } catch {
        // Do not log raw error or secrets; configured R2 may still serve as fallback.
      }
    }

    if (r2Configured) {
      try {
        const presignedFn = hooks?.r2Presigned ?? createR2PresignedUploadUrl;
        const presigned = await presignedFn({
          key,
          contentType: normalizedContentType,
        });
        if (presigned) {
          return NextResponse.json({
            mode: 'r2-presigned',
            ...presigned,
          });
        }
      } catch {
        // Do not log raw error or secrets
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
