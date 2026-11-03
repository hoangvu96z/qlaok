export type BoundedJsonRequestBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | {
      ok: false;
      status: 400 | 413;
      code: 'INVALID_REQUEST_BODY' | 'REQUEST_BODY_TOO_LARGE';
      error: string;
    };

const INVALID_REQUEST_BODY = {
  ok: false as const,
  status: 400 as const,
  code: 'INVALID_REQUEST_BODY' as const,
  error: 'Nội dung yêu cầu không hợp lệ.',
};

function requestBodyTooLarge(): BoundedJsonRequestBodyResult {
  return {
    ok: false,
    status: 413,
    code: 'REQUEST_BODY_TOO_LARGE',
    error: 'Nội dung yêu cầu vượt quá giới hạn cho phép.',
  };
}

async function cancelRequestBody(
  request: Pick<Request, 'body'>
): Promise<void> {
  try {
    await request.body?.cancel();
  } catch {
    // The response does not depend on stream cancellation succeeding.
  }
}

/** Reads JSON objects while enforcing a byte limit even without Content-Length. */
export async function readBoundedJsonRequestBody(
  request: Pick<Request, 'headers' | 'body'>,
  maxBytes: number
): Promise<BoundedJsonRequestBodyResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError('maxBytes must be a positive safe integer');
  }

  const declaredLength = request.headers.get('content-length')?.trim();
  if (declaredLength) {
    if (!/^\d+$/.test(declaredLength)) return INVALID_REQUEST_BODY;
    const declaredBytes = Number(declaredLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxBytes) {
      await cancelRequestBody(request);
      return requestBodyTooLarge();
    }
  }

  if (!request.body) return INVALID_REQUEST_BODY;

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = request.body.getReader();
  } catch {
    return INVALID_REQUEST_BODY;
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // Ignore stream cancellation errors.
        }
        return requestBodyTooLarge();
      }
      chunks.push(value.slice());
    }
  } catch {
    return INVALID_REQUEST_BODY;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore a stream that already released its lock.
    }
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const parsed: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    );
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return INVALID_REQUEST_BODY;
    }
    return { ok: true, body: parsed as Record<string, unknown> };
  } catch {
    return INVALID_REQUEST_BODY;
  }
}
