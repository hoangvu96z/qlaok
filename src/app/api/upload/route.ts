import { NextResponse } from 'next/server';
import {
  createR2PresignedUploadUrl,
  isR2Configured,
  uploadBufferToR2,
} from '@/lib/r2';

interface UploadRouteTestHooks {
  r2Uploader?: typeof uploadBufferToR2;
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

    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `uploads/${Date.now()}-${safeName}`;
    const hooks = globalThis.__uploadRouteTestHooks;
    const configured = hooks?.isR2Configured
      ? hooks.isR2Configured()
      : isR2Configured();

    if (base64Data) {
      if (!configured) {
        return NextResponse.json(
          {
            error: 'UPLOAD_STORAGE_UNAVAILABLE',
            code: 'UPLOAD_STORAGE_UNAVAILABLE',
          },
          { status: 503 }
        );
      }

      let r2Url: string | null = null;
      try {
        const rawBase64 =
          typeof base64Data === 'string' && base64Data.includes(',')
            ? base64Data.split(',')[1]
            : String(base64Data);

        const uploader = hooks?.r2Uploader ?? uploadBufferToR2;
        r2Url = await uploader({
          key,
          contentType,
          buffer: Buffer.from(rawBase64, 'base64'),
        });
      } catch {
        // Do not log raw error, base64 payload, or secrets
      }

      if (r2Url) {
        return NextResponse.json({
          mode: 'r2-direct',
          publicUrl: r2Url,
        });
      }

      return NextResponse.json(
        {
          error: 'UPLOAD_STORAGE_FAILED',
          code: 'UPLOAD_STORAGE_FAILED',
        },
        { status: 502 }
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
