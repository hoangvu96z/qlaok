import imageCompression from 'browser-image-compression';

/**
 * Shared client-side image compression & upload helper.
 * 1. Compresses any image to lightweight WebP (max 720px, <100KB).
 * 2. Sends to /api/upload (which uploads to Cloudflare R2 if configured,
 *    or returns a persistent WebP Data URI that works across all deployments
 *    and container restarts without 404s).
 */
export async function uploadCompressedImage(file: File): Promise<string> {
  const compressed = await imageCompression(file, {
    maxSizeMB: 0.1,
    maxWidthOrHeight: 720,
    useWebWorker: true,
    fileType: 'image/webp',
    initialQuality: 0.82,
  });

  const base64Data: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(compressed);
  });

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: file.name.replace(/\.[^.]+$/, '.webp'),
        contentType: 'image/webp',
        base64Data,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data?.publicUrl && !data.publicUrl.startsWith('/uploads/')) {
        return data.publicUrl;
      }
    }
  } catch (err) {
    console.warn('Upload API fallback to inline WebP Data URI:', err);
  }

  return base64Data;
}
