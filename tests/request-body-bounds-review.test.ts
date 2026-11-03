import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POST as postOrders } from '../src/app/api/orders/route';
import {
  PATCH as patchServiceRequests,
  POST as postServiceRequests,
} from '../src/app/api/service-requests/route';
import { readBoundedJsonRequestBody } from '../src/lib/request-body';
import { issueSessionToken } from '../src/lib/server-auth';

function makeRequest(
  chunks: Uint8Array[],
  headers: Record<string, string> = {}
): Pick<Request, 'headers' | 'body'> {
  return {
    headers: new Headers(headers),
    body: new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        for (const chunk of chunks) {
          const copy = new Uint8Array(new ArrayBuffer(chunk.byteLength));
          copy.set(chunk);
          controller.enqueue(copy);
        }
        controller.close();
      },
    }),
  };
}

test('bounded JSON accepts an object exactly at the byte limit', async () => {
  const maxBytes = 64;
  const payload = JSON.stringify({ value: 'a'.repeat(maxBytes - 12) });
  const bytes = new TextEncoder().encode(payload);
  assert.equal(bytes.byteLength, maxBytes);

  const result = await readBoundedJsonRequestBody(makeRequest([bytes]), maxBytes);

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.body.value, 'a'.repeat(maxBytes - 12));
});

test('bounded JSON rejects declared oversized bodies before reading', async () => {
  let canceled = false;
  const request = {
    headers: new Headers({ 'content-length': '65' }),
    body: new ReadableStream<Uint8Array<ArrayBuffer>>({
      cancel() {
        canceled = true;
      },
    }),
  };

  const result = await readBoundedJsonRequestBody(request, 64);

  assert.deepEqual(result, {
    ok: false,
    status: 413,
    code: 'REQUEST_BODY_TOO_LARGE',
    error: 'Nội dung yêu cầu vượt quá giới hạn cho phép.',
  });
  assert.equal(canceled, true);
});

test('bounded JSON enforces streamed bytes without Content-Length', async () => {
  const result = await readBoundedJsonRequestBody(
    makeRequest([new Uint8Array(40), new Uint8Array(25)]),
    64
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 413);
});

test('bounded JSON enforces actual streamed bytes when Content-Length is too small', async () => {
  const result = await readBoundedJsonRequestBody(
    makeRequest([new Uint8Array(65)], { 'content-length': '1' }),
    64
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'REQUEST_BODY_TOO_LARGE');
});

test('bounded JSON rejects malformed JSON and non-object payloads', async () => {
  const malformed = await readBoundedJsonRequestBody(
    makeRequest([new TextEncoder().encode('{')]),
    64
  );
  const array = await readBoundedJsonRequestBody(
    makeRequest([new TextEncoder().encode('[]')]),
    64
  );

  assert.equal(malformed.ok, false);
  assert.equal(array.ok, false);
  if (!malformed.ok) assert.equal(malformed.status, 400);
  if (!array.ok) assert.equal(array.code, 'INVALID_REQUEST_BODY');
});

test('order and service-request POST routes return 413 before processing oversized requests', async () => {
  const oversizedRequest = (url: string, maxBytes: number) =>
    new Request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(maxBytes + 1),
      },
      body: '{}',
    });

  const orderResponse = await postOrders(
    oversizedRequest('https://qlaok.test/api/orders', 1024 * 1024)
  );
  const serviceRequestResponse = await postServiceRequests(
    oversizedRequest('https://qlaok.test/api/service-requests', 16 * 1024)
  );

  for (const response of [orderResponse, serviceRequestResponse]) {
    assert.equal(response.status, 413);
    assert.equal((await response.json()).code, 'REQUEST_BODY_TOO_LARGE');
  }
});

test('service-request PATCH rejects oversized body after authentication and before authorization or database work', async () => {
  const token = issueSessionToken({
    id: 'review-service-request-owner',
    email: 'service-request-review@example.test',
  });
  const response = await patchServiceRequests(
    new Request('https://qlaok.test/api/service-requests', {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'content-length': String(16 * 1024 + 1),
      },
      body: '{}',
    })
  );

  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, 'REQUEST_BODY_TOO_LARGE');
});
