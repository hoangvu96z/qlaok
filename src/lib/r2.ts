import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  PRESIGNED_UPLOAD_EXPIRES_IN_SECONDS,
  PRESIGNED_UPLOAD_SIGNABLE_HEADERS,
  isValidUploadContentLength,
} from '@/lib/garage-storage';

export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET_NAME &&
      process.env.R2_PUBLIC_URL
  );
}

export function getR2Client(): S3Client | null {
  if (!isR2Configured()) return null;

  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

export function getR2PresignerClient(): S3Client | null {
  if (!isR2Configured()) return null;

  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

export async function uploadBufferToR2(params: {
  key: string;
  contentType: string;
  buffer: Buffer;
}): Promise<string | null> {
  const client = getR2Client();
  if (!client) return null;

  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: params.key,
    Body: params.buffer,
    ContentType: params.contentType,
  });

  await client.send(command);
  const publicBase = process.env.R2_PUBLIC_URL!.replace(/\/$/, '');
  return `${publicBase}/${params.key}`;
}

export async function createR2PresignedUploadUrl(params: {
  key: string;
  contentType: string;
  contentLength: number;
}): Promise<{ uploadUrl: string; publicUrl: string } | null> {
  if (!isValidUploadContentLength(params.contentLength)) {
    throw new Error('Invalid or oversized upload contentLength');
  }

  const client = getR2PresignerClient();
  if (!client) return null;

  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: params.key,
    ContentType: params.contentType,
    ContentLength: params.contentLength,
  });

  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn: PRESIGNED_UPLOAD_EXPIRES_IN_SECONDS,
    signableHeaders: new Set(PRESIGNED_UPLOAD_SIGNABLE_HEADERS),
  });
  const publicBase = process.env.R2_PUBLIC_URL!.replace(/\/$/, '');
  const publicUrl = `${publicBase}/${params.key}`;

  return { uploadUrl, publicUrl };
}
