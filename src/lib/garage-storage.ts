import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Garage Object Storage Client & Upload Helper (S3-compatible).
 * Configured with path-style addressing (forcePathStyle: true) and server-only credentials.
 * Production:
 *   S3 API: https://s3.vunph.click, bucket: qlaok-media, region: garage
 *   Public delivery: https://s3.vunph.click/media (mapped to qlaok-media via Nginx)
 */

export const GARAGE_UPLOAD_BUCKET = process.env.S3_BUCKET_NAME || 'qlaok-media';
export const MAX_GARAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
export const GARAGE_UPLOAD_ALLOWED_MIME_TYPES = [
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const MAX_UPLOAD_BYTES = MAX_GARAGE_UPLOAD_BYTES;
export const ALLOWED_IMAGE_MIME_TYPES = GARAGE_UPLOAD_ALLOWED_MIME_TYPES;

// Aliases for backward compatibility
export const MAX_SUPABASE_UPLOAD_BYTES = MAX_UPLOAD_BYTES;
export const SUPABASE_UPLOAD_ALLOWED_MIME_TYPES = ALLOWED_IMAGE_MIME_TYPES;
export const SUPABASE_UPLOAD_BUCKET = GARAGE_UPLOAD_BUCKET;

export interface UploadImageParams {
  key: string;
  contentType: string;
  buffer: Buffer;
}

/**
 * Validates that all required server-side Garage S3 credentials and endpoint configurations are set.
 * Server-only credentials; never expose through NEXT_PUBLIC_* or EXPO_PUBLIC_*.
 */
export function isGarageConfigured(): boolean {
  return Boolean(
    process.env.S3_ENDPOINT &&
      process.env.S3_REGION &&
      process.env.S3_BUCKET_NAME &&
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY &&
      process.env.S3_PUBLIC_URL
  );
}

export const isS3Configured = isGarageConfigured;

/**
 * Creates an AWS SDK v3 S3Client instance configured for Garage S3 with path-style addressing.
 */
export function getGarageClient(): S3Client | null {
  if (!isGarageConfigured()) return null;

  return new S3Client({
    region: process.env.S3_REGION || 'garage',
    endpoint: process.env.S3_ENDPOINT!,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
}

export const getS3Client = getGarageClient;

/**
 * Uploads an image buffer to Garage object storage and returns its stable public URL.
 * Throws on failure or misconfiguration without leaking raw credentials.
 */
export async function uploadBufferToGarage(
  params: UploadImageParams,
  clientOverride?: S3Client
): Promise<string> {
  const client = clientOverride ?? getGarageClient();
  if (!client) {
    throw new Error('Garage storage is not configured');
  }

  const bucket = process.env.S3_BUCKET_NAME || 'qlaok-media';
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: params.key,
    Body: params.buffer,
    ContentType: params.contentType,
  });

  await client.send(command);

  const publicBase = (process.env.S3_PUBLIC_URL || '').replace(/\/$/, '');
  if (!publicBase) {
    throw new Error('Garage S3_PUBLIC_URL is not configured');
  }

  return `${publicBase}/${params.key}`;
}

export const uploadBufferToS3 = uploadBufferToGarage;

/**
 * Creates a presigned upload URL for direct client upload to Garage.
 */
export async function createGaragePresignedUploadUrl(
  params: {
    key: string;
    contentType: string;
  },
  clientOverride?: S3Client
): Promise<{ uploadUrl: string; publicUrl: string } | null> {
  const client = clientOverride ?? getGarageClient();
  if (!client) return null;

  const bucket = process.env.S3_BUCKET_NAME || 'qlaok-media';
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: params.key,
    ContentType: params.contentType,
  });

  const uploadUrl = await getSignedUrl(client, command, { expiresIn: 3600 });
  const publicBase = (process.env.S3_PUBLIC_URL || '').replace(/\/$/, '');
  const publicUrl = `${publicBase}/${params.key}`;

  return { uploadUrl, publicUrl };
}

export const createS3PresignedUploadUrl = createGaragePresignedUploadUrl;
