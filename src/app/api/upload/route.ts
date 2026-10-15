import { NextResponse } from 'next/server';
import {
  createR2PresignedUploadUrl,
  isR2Configured,
  uploadBufferToR2,
} from '@/lib/r2';

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

    if (base64Data) {
      const rawBase64 = base64Data.includes(',')
        ? base64Data.split(',')[1]
        : base64Data;

      // 1. If Cloudflare R2 is configured, upload buffer directly to R2
      if (isR2Configured()) {
        try {
          const r2Url = await uploadBufferToR2({
            key,
            contentType,
            buffer: Buffer.from(rawBase64, 'base64'),
          });
          if (r2Url) {
            return NextResponse.json({
              mode: 'r2-direct',
              publicUrl: r2Url,
            });
          }
        } catch (r2Err) {
          console.warn('R2 direct upload failed, falling back to inline WebP:', r2Err);
        }
      }

      // 2. Zero-config production-safe fallback: return compressed WebP Data URI
      // Works across Next.js standalone/production builds, Docker, Vercel, and Mobile
      // without ever returning 404 on /uploads/...
      const normalizedDataUri = base64Data.startsWith('data:')
        ? base64Data
        : `data:${contentType};base64,${rawBase64}`;

      return NextResponse.json({
        mode: 'inline-webp',
        publicUrl: normalizedDataUri,
      });
    }

    if (isR2Configured()) {
      const presigned = await createR2PresignedUploadUrl({
        key,
        contentType,
      });
      if (presigned) {
        return NextResponse.json({
          mode: 'r2-presigned',
          ...presigned,
        });
      }
    }

    return NextResponse.json(
      { error: 'Missing base64Data payload' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Upload route error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
