import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import {
  extractPayOSOrderCodeFromDescription,
  getSaasPaymentWebhookPayload,
  isPayOSWebhookEnvelope,
  isSuccessfulPayOSWebhook,
  verifySaasPaymentWebhookAuthentication,
} from '@/lib/saas-payment-webhook';
import { setSupabaseDbClientForTests } from '@/lib/db';

const TEST_CHECKSUM_KEY = 'local-only-payos-checksum-test-key';

function signPayOSData(data: Record<string, unknown>, secret: string) {
  const canonical = Object.keys(data)
    .sort()
    .map((key) => {
      const value = data[key];
      const emptyValue =
        value === null ||
        value === undefined ||
        value === 'null' ||
        value === 'undefined';
      return `${key}=${emptyValue ? '' : String(value)}`;
    })
    .join('&');
  return crypto.createHmac('sha256', secret).update(canonical).digest('hex');
}

function makePayOSBody(
  envelopeOverrides: Partial<Record<string, unknown>> = {},
  dataOverrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    accountNumber: '1234567890',
    amount: 99000,
    code: '00',
    description: 'Thanh toan QLAOKB12345',
    orderCode: 61203,
    reference: 'bank-ref-123',
    ...dataOverrides,
  };
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) delete data[key];
  }
  return {
    code: '00',
    desc: 'success',
    success: true,
    data,
    signature: signPayOSData(data, TEST_CHECKSUM_KEY),
    ...envelopeOverrides,
  };
}

function createBillingWebhookTestClient(
  expectedOrderCode = 'QLAOKB12345',
  rpcResult: Record<string, unknown> = {
    status: 'completed',
    owner_id: 'qa-owner',
  }
) {
  const profile: Record<string, unknown> = {
    id: 'qa-owner',
    plan: 'free',
  };
  const transaction: Record<string, unknown> = {
    id: 'qa-payment-tx',
    user_id: 'qa-owner',
    order_code: expectedOrderCode,
    amount: 99000,
    status: 'pending',
    created_at: '2026-11-01T00:00:00.000Z',
  };
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  type QueryBuilder = {
    select(columns?: string): QueryBuilder;
    eq(column: string, value: unknown): QueryBuilder;
    ilike(column: string, value: unknown): QueryBuilder;
    limit(count?: number): Promise<{ data: unknown[]; error: null }>;
    maybeSingle(): Promise<{
      data: Record<string, unknown> | null;
      error: null;
    }>;
    order(
      column: string,
      options?: { ascending?: boolean }
    ): Promise<{ data: Record<string, unknown>[]; error: null }>;
  };

  const client = {
    from(table: string): QueryBuilder {
      const filters = new Map<string, unknown>();
      const builder: QueryBuilder = {
        select() {
          return builder;
        },
        eq(column, value) {
          filters.set(column, value);
          return builder;
        },
        ilike(column, value) {
          filters.set(column, value);
          return builder;
        },
        async limit() {
          assert.equal(table, 'shops');
          return { data: [{ id: 'qa-shop' }], error: null };
        },
        async maybeSingle() {
          if (
            table === 'payment_transactions' &&
            filters.get('order_code') === expectedOrderCode
          ) {
            return { data: transaction, error: null };
          }
          if (table === 'profiles' && filters.get('id') === 'qa-owner') {
            return { data: profile, error: null };
          }
          return { data: null, error: null };
        },
        async order() {
          return {
            data:
              table === 'payment_transactions' &&
              filters.get('user_id') === 'qa-owner'
                ? [transaction]
                : [],
            error: null,
          };
        },
      };
      return builder;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      transaction.bank_ref_id = args.p_bank_ref_id;
      if (rpcResult.status !== 'manual_review') {
        transaction.status = 'completed';
        profile.plan = 'premium';
      }
      return {
        data: rpcResult,
        error: null,
      };
    },
  };

  return { client, rpcCalls };
}

function makeRequest(headers?: HeadersInit) {
  return new Request('https://qlaok.example/api/webhooks/payment', {
    method: 'POST',
    headers,
  });
}

test('PayOS envelope verifies its signed data and exposes the nested payment payload', () => {
  const body = makePayOSBody();
  const rawBody = JSON.stringify(body);

  assert.equal(isPayOSWebhookEnvelope(body), true);
  assert.equal(isSuccessfulPayOSWebhook(body), true);
  assert.deepEqual(getSaasPaymentWebhookPayload(body), body.data);
  assert.deepEqual(
    verifySaasPaymentWebhookAuthentication(
      makeRequest(),
      rawBody,
      body,
      TEST_CHECKSUM_KEY
    ),
    { valid: true }
  );
});

test('PayOS canonicalization maps null values and null-like strings to empty strings', () => {
  const body = makePayOSBody({}, {
    bankName: null,
    bankNumber: 'null',
    payerName: 'undefined',
  });

  assert.deepEqual(
    verifySaasPaymentWebhookAuthentication(
      makeRequest(),
      JSON.stringify(body),
      body,
      TEST_CHECKSUM_KEY
    ),
    { valid: true }
  );
});

test('valid PayOS payment webhook completes billing through the atomic DB RPC', async () => {
  const envKeys = [
    'PAYMENT_WEBHOOK_SECRET',
    'SAAS_BANK_ACCOUNTS',
    'SAAS_BANK_ACCOUNT',
    'NEXT_PUBLIC_SAAS_BANK_ACCOUNTS',
    'NEXT_PUBLIC_SAAS_BANK_ACCOUNT',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'QLAOK_DATABASE_URL',
    'PAYMENT_DEV_SIMULATE',
  ];
  const previous = new Map(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  process.env.PAYMENT_WEBHOOK_SECRET = TEST_CHECKSUM_KEY;
  process.env.SAAS_BANK_ACCOUNTS = '["1234567890"]';

  const { client, rpcCalls } = createBillingWebhookTestClient();
  setSupabaseDbClientForTests(client);

  try {
    const { POST } = await import('@/app/api/webhooks/payment/route');
    const body = makePayOSBody({}, {
      description: 'Thanh toan QLAOKB12345',
      accountNumber: '1234567890',
      reference: 'bank-ref-qa-1',
    });
    const response = await POST(
      new Request('https://qlaok.example/api/webhooks/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    );
    const responseBody = await response.json();

    assert.equal(response.status, 200);
    assert.equal(responseBody.success, true);
    assert.equal(responseBody.alreadyCompleted, false);
    assert.equal(responseBody.profile.id, 'qa-owner');
    assert.equal(responseBody.profile.plan, 'premium');
    assert.equal(responseBody.transactions[0].status, 'completed');
    assert.equal(responseBody.transactions[0].bank_ref_id, 'bank-ref-qa-1');
    assert.deepEqual(rpcCalls, [
      {
        name: 'complete_payment_webhook_atomic',
        args: {
          p_order_code: 'QLAOKB12345',
          p_bank_ref_id: 'bank-ref-qa-1',
          p_verified_transfer_amount: 99000,
          p_allow_unverified_amount: false,
        },
      },
    ]);
  } finally {
    setSupabaseDbClientForTests(null);
    for (const key of envKeys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('manual-review payment callback is acknowledged without claiming payment success', async () => {
  const envKeys = [
    'PAYMENT_WEBHOOK_SECRET',
    'SAAS_BANK_ACCOUNTS',
    'SAAS_BANK_ACCOUNT',
    'NEXT_PUBLIC_SAAS_BANK_ACCOUNTS',
    'NEXT_PUBLIC_SAAS_BANK_ACCOUNT',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'QLAOK_DATABASE_URL',
    'PAYMENT_DEV_SIMULATE',
  ];
  const previous = new Map(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  process.env.PAYMENT_WEBHOOK_SECRET = TEST_CHECKSUM_KEY;
  process.env.SAAS_BANK_ACCOUNTS = '["1234567890"]';

  const { client, rpcCalls } = createBillingWebhookTestClient('QLAOKB12345', {
    status: 'manual_review',
    owner_id: 'qa-owner',
    resolution_required: true,
    resolution_code: 'NON_EXPIRING_ADMIN_PLAN',
  });
  setSupabaseDbClientForTests(client);

  try {
    const { POST } = await import('@/app/api/webhooks/payment/route');
    const body = makePayOSBody({}, {
      description: 'Thanh toan QLAOKB12345',
      accountNumber: '1234567890',
      reference: 'bank-ref-manual-review',
    });
    const response = await POST(
      new Request('https://qlaok.example/api/webhooks/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    );
    const responseBody = await response.json();

    assert.equal(response.status, 200);
    assert.equal(responseBody.success, false);
    assert.equal(responseBody.status, 'manual_review');
    assert.equal(responseBody.code, 'NON_EXPIRING_ADMIN_PLAN');
    assert.equal(responseBody.paymentResolutionRequired, true);
    assert.equal(responseBody.transactions[0].status, 'pending');
    assert.equal(
      responseBody.transactions[0].bank_ref_id,
      'bank-ref-manual-review'
    );
    assert.deepEqual(rpcCalls, [
      {
        name: 'complete_payment_webhook_atomic',
        args: {
          p_order_code: 'QLAOKB12345',
          p_bank_ref_id: 'bank-ref-manual-review',
          p_verified_transfer_amount: 99000,
          p_allow_unverified_amount: false,
        },
      },
    ]);
  } finally {
    setSupabaseDbClientForTests(null);
    for (const key of envKeys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('invalid or missing PayOS signature cannot fall back to a valid API key header', () => {
  const validHeader = { Authorization: `Apikey ${TEST_CHECKSUM_KEY}` };
  const invalidBody = makePayOSBody({ signature: '0'.repeat(64) });
  const missingBody = makePayOSBody({ signature: undefined });

  for (const body of [invalidBody, missingBody]) {
    const result = verifySaasPaymentWebhookAuthentication(
      makeRequest(validHeader),
      JSON.stringify(body),
      body,
      TEST_CHECKSUM_KEY
    );
    assert.equal(result.valid, false);
  }
});

test('PayOS unsuccessful event remains unsuccessful even with a valid signature', () => {
  const body = makePayOSBody({
    code: '09',
    desc: 'failed',
    success: false,
  });

  assert.deepEqual(
    verifySaasPaymentWebhookAuthentication(
      makeRequest(),
      JSON.stringify(body),
      body,
      TEST_CHECKSUM_KEY
    ),
    { valid: true }
  );
  assert.equal(isSuccessfulPayOSWebhook(body), false);
});

test('flat SePay-style API key and raw-body HMAC authentication remain supported', () => {
  const body = {
    accountNumber: '1234567890',
    code: 'QLAOKB12345',
    transferAmount: 99000,
    transferType: 'in',
  };
  const rawBody = JSON.stringify(body);

  assert.equal(isPayOSWebhookEnvelope(body), false);
  assert.deepEqual(
    verifySaasPaymentWebhookAuthentication(
      makeRequest({ Authorization: `Apikey ${TEST_CHECKSUM_KEY}` }),
      rawBody,
      body,
      TEST_CHECKSUM_KEY
    ),
    { valid: true }
  );

  const signature = crypto
    .createHmac('sha256', TEST_CHECKSUM_KEY)
    .update(rawBody, 'utf8')
    .digest('hex');
  assert.deepEqual(
    verifySaasPaymentWebhookAuthentication(
      makeRequest({ 'x-webhook-signature': signature }),
      rawBody,
      body,
      TEST_CHECKSUM_KEY
    ),
    { valid: true }
  );
});

test('missing provider secret continues to fail closed with 503', () => {
  const body = makePayOSBody();
  const result = verifySaasPaymentWebhookAuthentication(
    makeRequest(),
    JSON.stringify(body),
    body,
    null
  );

  assert.equal(result.valid, false);
  assert.equal(result.status, 503);
});

test('payment route rejects unsuccessful signed PayOS events before database work', async () => {
  const envKeys = [
    'PAYMENT_WEBHOOK_SECRET',
    'SAAS_BANK_ACCOUNTS',
    'SAAS_BANK_ACCOUNT',
    'NEXT_PUBLIC_SAAS_BANK_ACCOUNTS',
    'NEXT_PUBLIC_SAAS_BANK_ACCOUNT',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'QLAOK_DATABASE_URL',
    'PAYMENT_DEV_SIMULATE',
  ];
  const previous = new Map(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  process.env.PAYMENT_WEBHOOK_SECRET = TEST_CHECKSUM_KEY;

  try {
    const { POST } = await import('@/app/api/webhooks/payment/route');
    const body = makePayOSBody({
      code: '09',
      desc: 'failed',
      success: false,
    });
    const response = await POST(
      new Request('https://qlaok.example/api/webhooks/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    );

    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'UNSUCCESSFUL_PAYMENT_EVENT');
  } finally {
    for (const key of envKeys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('payment route reads amount and transfer memo from nested PayOS data', async () => {
  const envKeys = [
    'PAYMENT_WEBHOOK_SECRET',
    'SAAS_BANK_ACCOUNTS',
    'SAAS_BANK_ACCOUNT',
    'NEXT_PUBLIC_SAAS_BANK_ACCOUNTS',
    'NEXT_PUBLIC_SAAS_BANK_ACCOUNT',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'QLAOK_DATABASE_URL',
    'PAYMENT_DEV_SIMULATE',
  ];
  const previous = new Map(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  process.env.PAYMENT_WEBHOOK_SECRET = TEST_CHECKSUM_KEY;
  process.env.SAAS_BANK_ACCOUNTS = '["1234567890"]';

  try {
    const { POST } = await import('@/app/api/webhooks/payment/route');
    const body = makePayOSBody({}, {
      accountNumber: '9999999999',
      orderCode: undefined,
    });
    const response = await POST(
      new Request('https://qlaok.example/api/webhooks/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    );
    const responseBody = await response.json();

    // Reaching this branch proves orderCode came from data.description and
    // transferAmount/amount was read from data; mismatch returns before DB use.
    assert.equal(response.status, 400);
    assert.equal(responseBody.code, 'RECEIVING_ACCOUNT_MISMATCH');
  } finally {
    for (const key of envKeys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('payment route rejects a missing amount from nested PayOS data before DB use', async () => {
  const envKeys = [
    'PAYMENT_WEBHOOK_SECRET',
    'SAAS_BANK_ACCOUNTS',
    'SAAS_BANK_ACCOUNT',
    'NEXT_PUBLIC_SAAS_BANK_ACCOUNTS',
    'NEXT_PUBLIC_SAAS_BANK_ACCOUNT',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'QLAOK_DATABASE_URL',
    'PAYMENT_DEV_SIMULATE',
  ];
  const previous = new Map(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  process.env.PAYMENT_WEBHOOK_SECRET = TEST_CHECKSUM_KEY;

  try {
    const { POST } = await import('@/app/api/webhooks/payment/route');
    const body = makePayOSBody({}, { amount: undefined });
    const response = await POST(
      new Request('https://qlaok.example/api/webhooks/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    );
    const responseBody = await response.json();

    assert.equal(response.status, 400);
    assert.equal(responseBody.code, 'PAYMENT_AMOUNT_REQUIRED');
  } finally {
    for (const key of envKeys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

function createForbiddenBillingWebhookTestClient() {
  const dbAccesses: string[] = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  const client = {
    from(table: string) {
      dbAccesses.push(`from:${table}`);
      throw new Error(`Unexpected DB table access: ${table}`);
    },
    async rpc(name: string, args: Record<string, unknown>) {
      dbAccesses.push(`rpc:${name}`);
      rpcCalls.push({ name, args });
      throw new Error(`Unexpected DB RPC call: ${name}`);
    },
  };

  return { client, dbAccesses, rpcCalls };
}

test('payment route acknowledges official signed PayOS validation sample as an ignored no-op before DB or account checks', async () => {
  const envKeys = [
    'PAYMENT_WEBHOOK_SECRET',
    'SAAS_BANK_ACCOUNTS',
    'SAAS_BANK_ACCOUNT',
    'NEXT_PUBLIC_SAAS_BANK_ACCOUNTS',
    'NEXT_PUBLIC_SAAS_BANK_ACCOUNT',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'QLAOK_DATABASE_URL',
    'PAYMENT_DEV_SIMULATE',
  ];
  const previous = new Map(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  process.env.PAYMENT_WEBHOOK_SECRET = TEST_CHECKSUM_KEY;

  const { client, dbAccesses, rpcCalls } =
    createForbiddenBillingWebhookTestClient();
  setSupabaseDbClientForTests(client as never);

  try {
    const { POST } = await import('@/app/api/webhooks/payment/route');
    const body = makePayOSBody(
      {},
      {
        orderCode: 123,
        amount: 3000,
        description: 'VQRIO123',
        accountNumber: '12345678',
        reference: 'TF230204212323',
        transactionDateTime: '2023-02-04 18:25:00',
        currency: 'VND',
        paymentLinkId: '124c33293c43417ab7879e14c8d9eb18',
        code: '00',
        desc: 'Thành công',
        counterAccountBankId: '',
        counterAccountBankName: '',
        counterAccountName: null,
        counterAccountNumber: null,
        virtualAccountName: '',
        virtualAccountNumber: '',
      }
    );
    const response = await POST(
      new Request('https://qlaok.example/api/webhooks/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    );
    const responseBody = await response.json();

    assert.equal(response.status, 200);
    assert.equal(responseBody.success, true);
    assert.equal(responseBody.ignored, true);
    assert.equal(responseBody.code, 'PAYOS_NON_QLAOK_EVENT_IGNORED');
    assert.deepEqual(dbAccesses, []);
    assert.deepEqual(rpcCalls, []);
  } finally {
    setSupabaseDbClientForTests(null);
    for (const key of envKeys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('payment route does not mistake the PayOS numeric order ID for a Qlaok payment code', async () => {
  const envKeys = [
    'PAYMENT_WEBHOOK_SECRET',
    'SAAS_BANK_ACCOUNTS',
    'SAAS_BANK_ACCOUNT',
    'NEXT_PUBLIC_SAAS_BANK_ACCOUNTS',
    'NEXT_PUBLIC_SAAS_BANK_ACCOUNT',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'QLAOK_DATABASE_URL',
    'PAYMENT_DEV_SIMULATE',
  ];
  const previous = new Map(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  process.env.PAYMENT_WEBHOOK_SECRET = TEST_CHECKSUM_KEY;

  const { client, dbAccesses, rpcCalls } =
    createForbiddenBillingWebhookTestClient();
  setSupabaseDbClientForTests(client as never);

  try {
    const { POST } = await import('@/app/api/webhooks/payment/route');
    const body = makePayOSBody({}, {
      description: 'Thanh toan goi Premium',
    });
    const response = await POST(
      new Request('https://qlaok.example/api/webhooks/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    );
    const responseBody = await response.json();

    assert.equal(response.status, 200);
    assert.equal(responseBody.success, true);
    assert.equal(responseBody.ignored, true);
    assert.equal(responseBody.code, 'PAYOS_NON_QLAOK_EVENT_IGNORED');
    assert.deepEqual(dbAccesses, []);
    assert.deepEqual(rpcCalls, []);
  } finally {
    setSupabaseDbClientForTests(null);
    for (const key of envKeys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('extractPayOSOrderCodeFromDescription accepts only standalone Basic/Premium 5-digit Qlaok codes', () => {
  const validCases: Array<[string, string]> = [
    ['QLAOKB12345', 'QLAOKB12345'],
    ['QLAOKP67890', 'QLAOKP67890'],
    ['Thanh toan QLAOKB12345', 'QLAOKB12345'],
    ['Thanh toan goi Premium QLAOKP00123 ngay', 'QLAOKP00123'],
    ['MBVCB.998877.QLAOKB54321.CT tu NGUYEN VAN A', 'QLAOKB54321'],
    ['NAPAS-QLAOKP10000:ck', 'QLAOKP10000'],
    ['(QLAOKB99999)', 'QLAOKB99999'],
    ['thanh toan qlaokb12345', 'qlaokb12345'],
    ['Nang cap QlaokP13579', 'QlaokP13579'],
  ];

  for (const [description, expected] of validCases) {
    assert.equal(
      extractPayOSOrderCodeFromDescription({ description }),
      expected,
      `expected "${description}" to extract "${expected}"`
    );
  }

  const invalidDescriptions = [
    '',
    'VQRIO123',
    'Thanh toan goi Premium',
    'QLAOK',
    'QLAOKB',
    'QLAOKP',
    'QLAOKTEST',
    'QLAOK12345',
    'QLAOKF12345',
    'QLAOKX12345',
    'QLAOKE12345',
    'QLAOKBB12345',
    'QLAOKBP12345',
    'QLAOKB1',
    'QLAOKB1234',
    'QLAOKP1234',
    'QLAOKB123456',
    'QLAOKP123450',
    'QLAOKB1234A',
    'QLAOKP12A45',
    'XQLAOKB12345',
    '1QLAOKB12345',
    'REF9QLAOKP12345',
    'FOOQLAOKB12345BAR',
    'QLAOKB12345X',
    'Thanh toan QLAOKP12345extra',
    'mãQLAOKB12345',
    'ma\u0303QLAOKB12345',
    'QLAOKB12345đ',
  ];

  for (const description of invalidDescriptions) {
    assert.equal(
      extractPayOSOrderCodeFromDescription({ description }),
      null,
      `expected "${description}" to be rejected`
    );
  }

  assert.equal(extractPayOSOrderCodeFromDescription({}), null);
  assert.equal(extractPayOSOrderCodeFromDescription({ description: null }), null);
  assert.equal(
    extractPayOSOrderCodeFromDescription({ description: 12345 }),
    null
  );
});

test('payment route ignores signed PayOS webhooks with embedded or malformed QLAOK candidates before DB or account checks', async () => {
  const envKeys = [
    'PAYMENT_WEBHOOK_SECRET',
    'SAAS_BANK_ACCOUNTS',
    'SAAS_BANK_ACCOUNT',
    'NEXT_PUBLIC_SAAS_BANK_ACCOUNTS',
    'NEXT_PUBLIC_SAAS_BANK_ACCOUNT',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'QLAOK_DATABASE_URL',
    'PAYMENT_DEV_SIMULATE',
  ];
  const previous = new Map(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  process.env.PAYMENT_WEBHOOK_SECRET = TEST_CHECKSUM_KEY;

  const { client, dbAccesses, rpcCalls } =
    createForbiddenBillingWebhookTestClient();
  setSupabaseDbClientForTests(client as never);

  try {
    const { POST } = await import('@/app/api/webhooks/payment/route');
    for (const description of [
      'FOOQLAOKB12345BAR',
      'Thanh toan QLAOKB123456',
      'Thanh toan QLAOKF12345',
      'QLAOKTEST',
    ]) {
      const body = makePayOSBody({}, { description });
      const response = await POST(
        new Request('https://qlaok.example/api/webhooks/payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      );
      const responseBody = await response.json();

      assert.equal(response.status, 200);
      assert.equal(responseBody.success, true);
      assert.equal(responseBody.ignored, true);
      assert.equal(responseBody.code, 'PAYOS_NON_QLAOK_EVENT_IGNORED');
    }

    assert.deepEqual(dbAccesses, []);
    assert.deepEqual(rpcCalls, []);
  } finally {
    setSupabaseDbClientForTests(null);
    for (const key of envKeys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('valid signed PayOS webhook with case-insensitive standalone Premium order code completes billing unchanged', async () => {
  const envKeys = [
    'PAYMENT_WEBHOOK_SECRET',
    'SAAS_BANK_ACCOUNTS',
    'SAAS_BANK_ACCOUNT',
    'NEXT_PUBLIC_SAAS_BANK_ACCOUNTS',
    'NEXT_PUBLIC_SAAS_BANK_ACCOUNT',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'QLAOK_DATABASE_URL',
    'PAYMENT_DEV_SIMULATE',
  ];
  const previous = new Map(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  process.env.PAYMENT_WEBHOOK_SECRET = TEST_CHECKSUM_KEY;
  process.env.SAAS_BANK_ACCOUNTS = '["1234567890"]';

  const { client, rpcCalls } = createBillingWebhookTestClient('QLAOKP54321');
  setSupabaseDbClientForTests(client as never);

  try {
    const { POST } = await import('@/app/api/webhooks/payment/route');
    const body = makePayOSBody({}, {
      description: 'Nang cap goi qlaokp54321',
      accountNumber: '1234567890',
      reference: 'bank-ref-qa-premium',
    });
    const response = await POST(
      new Request('https://qlaok.example/api/webhooks/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    );
    const responseBody = await response.json();

    assert.equal(response.status, 200);
    assert.equal(responseBody.success, true);
    assert.equal(responseBody.alreadyCompleted, false);
    assert.deepEqual(rpcCalls, [
      {
        name: 'complete_payment_webhook_atomic',
        args: {
          p_order_code: 'QLAOKP54321',
          p_bank_ref_id: 'bank-ref-qa-premium',
          p_verified_transfer_amount: 99000,
          p_allow_unverified_amount: false,
        },
      },
    ]);
  } finally {
    setSupabaseDbClientForTests(null);
    for (const key of envKeys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
