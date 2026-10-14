import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { createR2PresignedUploadUrl, isR2Configured } from '@/lib/r2';

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

    if (isR2Configured() && !base64Data) {
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

    // Local development storage fallback: write to public/uploads if base64Data is provided
    if (base64Data) {
      const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      const localFileName = `${Date.now()}-${safeName}`;
      const filePath = path.join(uploadsDir, localFileName);
      const rawBase64 = base64Data.includes(',')
        ? base64Data.split(',')[1]
        : base64Data;
      fs.writeFileSync(filePath, Buffer.from(rawBase64, 'base64'));

      return NextResponse.json({
        mode: 'local-public',
        publicUrl: `/uploads/${localFileName}`,
      });
    }

    return NextResponse.json({
      mode: 'local-passthrough',
      uploadUrl: null,
      publicUrl: `/uploads/${safeName}`,
    });
  } catch (error) {
    console.error('Upload route error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
