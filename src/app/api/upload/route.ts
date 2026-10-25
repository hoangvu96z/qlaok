import { NextResponse } from 'next/server';
import {
  createR2PresignedUploadUrl,
  isR2Configured,
  uploadBufferToR2,
} from '@/lib/r2';
import {
  MAX_SUPABASE_UPLOAD_BYTES,
  SUPABASE_UPLOAD_ALLOWED_MIME_TYPES,
  uploadBufferToSupabaseStorage,
} from '@/lib/supabase-storage';

const ALLOWED_IMAGE_TYPES: ReadonlySet<string> = new Set(
  SUPABASE_UPLOAD_ALLOWED_MIME_TYPES
);

interface UploadRouteTestHooks {
  r2Uploader?: typeof uploadBufferToR2;
  supabaseUploader?: typeof uploadBufferToSupabaseStorage;
  isR2Configured?: () => boolean;
  r2Presigned?: typeof createR2PresignedUploadUrl;
}

declare global {
  var __uploadRouteTestHooks: UploadRouteTestHooks | undefined;
}

export async function POST(req: Request) {
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
    const configured = hooks?.isR2Configured
      ? hooks.isR2Configured()
      : isR2Configured();

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
      const maxBase64Length = Math.ceil(MAX_SUPABASE_UPLOAD_BYTES / 3) * 4;
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
      if (buffer.length > MAX_SUPABASE_UPLOAD_BYTES) {
        return NextResponse.json(
          {
            error: 'Image is too large',
            code: 'UPLOAD_FILE_TOO_LARGE',
          },
          { status: 413 }
        );
      }

      let r2Url: string | null = null;
      try {
        if (configured) {
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

      try {
        const uploader = hooks?.supabaseUploader ?? uploadBufferToSupabaseStorage;
        const publicUrl = await uploader({
          key,
          contentType: normalizedContentType,
          buffer,
        });
        if (publicUrl) {
          return NextResponse.json({ mode: 'supabase-storage', publicUrl });
        }
      } catch {
        // Do not log raw error, base64 payload, or secrets
      }

      return NextResponse.json(
        {
          error: configured
            ? 'UPLOAD_STORAGE_FAILED'
            : 'UPLOAD_STORAGE_UNAVAILABLE',
          code: configured
            ? 'UPLOAD_STORAGE_FAILED'
            : 'UPLOAD_STORAGE_UNAVAILABLE',
        },
        { status: configured ? 502 : 503 }
      );
    }

    if (configured) {
      try {
        const presignedFn = hooks?.r2Presigned ?? createR2PresignedUploadUrl;
        const presigned = await presignedFn({
          key,
          contentType,
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

    return NextResponse.json(
      { error: 'Missing base64Data payload' },
      { status: 400 }
    );
  } catch {
    // Do not log raw error, base64 payload, or secrets
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
