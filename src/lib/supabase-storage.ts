/**
 * @deprecated Legacy Supabase Storage helper.
 * Replaced by Garage object storage in `src/lib/garage-storage.ts`.
 * Preserved for legacy reference only; not invoked by /api/upload.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { requireSupabaseServiceRoleClient } from '@/lib/db';

export const SUPABASE_UPLOAD_BUCKET = 'qlaok-media';
export const MAX_SUPABASE_UPLOAD_BYTES = 5 * 1024 * 1024;
export const SUPABASE_UPLOAD_ALLOWED_MIME_TYPES = [
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

interface UploadImageParams {
  key: string;
  contentType: string;
  buffer: Buffer;
}

function isMissingBucketError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { message?: unknown; statusCode?: unknown };
  const message =
    typeof value.message === 'string' ? value.message.toLowerCase() : '';
  return (
    value.statusCode === 404 ||
    value.statusCode === '404' ||
    message.includes('bucket not found')
  );
}

async function uploadToBucket(
  client: SupabaseClient,
  params: UploadImageParams
) {
  return client.storage.from(SUPABASE_UPLOAD_BUCKET).upload(params.key, params.buffer, {
    cacheControl: '31536000',
    contentType: params.contentType,
    upsert: false,
  });
}

/**
 * Stores a public catalog image in Supabase Storage. This server-side path
 * always requires the private service-role key; publishable/anon keys are
 * never used for storage writes.
 */
export async function uploadBufferToSupabaseStorage(
  params: UploadImageParams,
  clientOverride?: SupabaseClient
): Promise<string> {
  const client =
    clientOverride ?? requireSupabaseServiceRoleClient('Image uploads');

  let { error } = await uploadToBucket(client, params);
  if (isMissingBucketError(error)) {
    const { error: createError } = await client.storage.createBucket(
      SUPABASE_UPLOAD_BUCKET,
      {
        public: true,
        fileSizeLimit: MAX_SUPABASE_UPLOAD_BYTES,
        allowedMimeTypes: [...SUPABASE_UPLOAD_ALLOWED_MIME_TYPES],
      }
    );

    if (createError) {
      // A concurrent request may have created the bucket. Confirm that before
      // retrying the upload; otherwise preserve the original failure.
      const { data: existingBucket, error: lookupError } =
        await client.storage.getBucket(SUPABASE_UPLOAD_BUCKET);
      if (lookupError || !existingBucket?.public) {
        throw createError;
      }
    }

    ({ error } = await uploadToBucket(client, params));
  }

  if (error) throw error;

  const { data } = client.storage
    .from(SUPABASE_UPLOAD_BUCKET)
    .getPublicUrl(params.key);
  if (!data.publicUrl) {
    throw new Error('Supabase Storage did not return a public URL');
  }
  return data.publicUrl;
}
