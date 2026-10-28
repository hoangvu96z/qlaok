import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '@/app/api/tables/floor-plan/route';
import { setSupabaseDbClientForTests } from '@/lib/db';
import { issueSessionToken } from '@/lib/server-auth';
import { SUPER_ADMIN_EMAIL } from '@/lib/auth-session';

interface QueryFilter {
  column: string;
  value: unknown;
}

interface QueryOrder {
  column: string;
  options?: { ascending?: boolean };
}

interface RecordedQueryCall {
  table: string;
  select?: string;
  filters: QueryFilter[];
  orExpression?: string;
  order?: QueryOrder;
  range?: { from: number; to: number };
}

interface FakeSupabaseConfig {
  shopTablesData?: Array<Record<string, unknown>>;
  ordersData?: Array<Record<string, unknown>>;
  onShopTablesRange?: (
    from: number,
    to: number,
    filters: QueryFilter[]
  ) => { data: unknown[] | null; error: { message: string } | null };
  onOrdersRange?: (
    from: number,
    to: number,
    filters: QueryFilter[]
  ) => { data: unknown[] | null; error: { message: string } | null };
}

/**
 * Evaluates the subset of PostgREST `or=` expressions the floor-plan route uses:
 * `col.eq.value`, `col.in.(a,b)`, and `and(...)` / `or(...)` groups.
 * Matching is simulated in the fake client so a route regression that drops or
 * narrows the filter shows up as a wrong row set, not just a missing call.
 */
function matchesPostgrestOrExpression(
  row: Record<string, unknown>,
  expression: string
): boolean {
  const terms = splitTopLevel(expression);
  return terms.some((term) => matchesPostgrestTerm(row, term));
}

function splitTopLevel(expression: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of expression) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

function matchesPostgrestTerm(
  row: Record<string, unknown>,
  term: string
): boolean {
  const trimmed = term.trim();
  const groupMatch = /^(and|or)\((.*)\)$/s.exec(trimmed);
  if (groupMatch) {
    const [, operator, inner] = groupMatch;
    const innerTerms = splitTopLevel(inner);
    const results = innerTerms.map((t) => matchesPostgrestTerm(row, t));
    return operator === 'and' ? results.every(Boolean) : results.some(Boolean);
  }

  const inMatch = /^([A-Za-z0-9_]+)\.in\.\((.*)\)$/s.exec(trimmed);
  if (inMatch) {
    const [, column, values] = inMatch;
    const allowed = values.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    return allowed.includes(String(row[column]));
  }

  const eqMatch = /^([A-Za-z0-9_]+)\.eq\.(.*)$/s.exec(trimmed);
  if (eqMatch) {
    const [, column, value] = eqMatch;
    return String(row[column]) === value.replace(/^"|"$/g, '');
  }

  throw new Error(`Unsupported PostgREST filter in fake client: ${term}`);
}

function createFakeSupabaseClient(config: FakeSupabaseConfig = {}) {
  const queryLogs: RecordedQueryCall[] = [];

  const client = {
    queryLogs,
    from(table: string) {
      if (table === 'shops') {
        const query = {
          select(_cols?: string) {
            return query;
          },
          eq(_col: string, _val: unknown) {
            return query;
          },
          async maybeSingle() {
            return { data: null, error: null };
          },
        };
        return query;
      }

      if (table === 'shop_tables') {
        const filters: QueryFilter[] = [];
        let selectCols: string | undefined;
        let orderObj: QueryOrder | undefined;

        const query = {
          select(cols?: string) {
            selectCols = cols;
            return query;
          },
          eq(column: string, value: unknown) {
            filters.push({ column, value });
            return query;
          },
          order(column: string, options?: { ascending?: boolean }) {
            orderObj = { column, options };
            return query;
          },
          async range(from: number, to: number) {
            queryLogs.push({
              table: 'shop_tables',
              select: selectCols,
              filters: [...filters],
              order: orderObj,
              range: { from, to },
            });

            if (config.onShopTablesRange) {
              return config.onShopTablesRange(from, to, filters);
            }

            let filtered = config.shopTablesData ?? [];
            for (const f of filters) {
              filtered = filtered.filter((row) => row[f.column] === f.value);
            }
            return {
              data: filtered.slice(from, to + 1),
              error: null,
            };
          },
        };
        return query;
      }

      if (table === 'orders') {
        const filters: QueryFilter[] = [];
        let selectCols: string | undefined;
        let orderObj: QueryOrder | undefined;
        let orExpression: string | undefined;

        const query = {
          select(cols?: string) {
            selectCols = cols;
            return query;
          },
          eq(column: string, value: unknown) {
            filters.push({ column, value });
            return query;
          },
          or(expression: string) {
            orExpression = expression;
            return query;
          },
          order(column: string, options?: { ascending?: boolean }) {
            orderObj = { column, options };
            return query;
          },
          async range(from: number, to: number) {
            queryLogs.push({
              table: 'orders',
              select: selectCols,
              filters: [...filters],
              orExpression,
              order: orderObj,
              range: { from, to },
            });

            if (config.onOrdersRange) {
              return config.onOrdersRange(from, to, filters);
            }

            let filtered = config.ordersData ?? [];
            for (const f of filters) {
              filtered = filtered.filter((row) => row[f.column] === f.value);
            }
            if (orExpression) {
              const expression = orExpression;
              filtered = filtered.filter((row) =>
                matchesPostgrestOrExpression(row, expression)
              );
            }
            return {
              data: filtered.slice(from, to + 1),
              error: null,
            };
          },
        };
        return query;
      }

      throw new Error(`Unexpected table query in fake Supabase client: ${table}`);
    },
  };

  return client;
}

function getAdminAuthHeader(): string {
  const token = issueSessionToken({
    id: 'admin-tester-id',
    email: SUPER_ADMIN_EMAIL,
    role: 'admin',
    is_admin: true,
  });
  return `Bearer ${token}`;
}

const DOCUMENTED_13_KEYS = [
  'capacity',
  'floor_status',
  'id',
  'is_active',
  'is_archived',
  'layout_x',
  'layout_y',
  'name',
  'open_order_count',
  'section',
  'shop_id',
  'table_code',
  'unpaid_amount',
].sort();

test('(a) blank shopId returns 400 before any DB call', async () => {
  const calls: string[] = [];
  const fakeClient = {
    from(table: string) {
      calls.push(table);
      throw new Error(`DB must not be called when shopId is blank; attempted from('${table}')`);
    },
  };

  setSupabaseDbClientForTests(fakeClient);
  try {
    const urls = [
      'https://qlaok.test/api/tables/floor-plan',
      'https://qlaok.test/api/tables/floor-plan?shopId=',
      'https://qlaok.test/api/tables/floor-plan?shopId=%20%20%20',
      'https://qlaok.test/api/tables/floor-plan?shop_id=',
      'https://qlaok.test/api/tables/floor-plan?shop_id=%20%20%20',
    ];

    for (const url of urls) {
      const req = new Request(url, {
        method: 'GET',
        headers: { authorization: getAdminAuthHeader() },
      });
      const res = await GET(req);
      assert.equal(res.status, 400, `Expected 400 for url: ${url}`);
      const body = await res.json();
      assert.deepEqual(body, { error: 'Thiếu mã cửa hàng (shopId).' });
    }

    assert.equal(calls.length, 0, 'No DB calls should occur when shopId is blank');
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('(b) successful GET returns only the documented 13 response keys, excludes archived tables, includes inactive tables, aggregates one table with 501 new unpaid orders correctly, and proves orders paginate through .range(0,499), .range(500,999) with exact shop_id filters', async () => {
  const targetShopId = 'shop-floor-plan-main';

  const mockShopTables = [
    {
      id: 'table-active-1',
      shop_id: targetShopId,
      name: 'Bàn Hoạt Động 1',
      table_code: 'T01',
      section: 'Tầng 1',
      capacity: 4,
      is_active: true,
      is_archived: false,
      layout_x: 15.5,
      layout_y: 25.0,
    },
    {
      id: 'table-inactive-2',
      shop_id: targetShopId,
      name: 'Bàn Tạm Ngưng 2',
      table_code: 'T02',
      section: 'Tầng 2',
      capacity: 6,
      is_active: false,
      is_archived: false,
      layout_x: 60.0,
      layout_y: 80.0,
    },
    {
      id: 'table-archived-3',
      shop_id: targetShopId,
      name: 'Bàn Đã Xóa',
      table_code: 'T03',
      section: 'Kho',
      capacity: 2,
      is_active: true,
      is_archived: true,
      layout_x: null,
      layout_y: null,
    },
    {
      id: 'table-other-shop-4',
      shop_id: 'other-shop-foreign',
      name: 'Bàn Quán Khác',
      table_code: 'T99',
      section: '',
      capacity: 4,
      is_active: true,
      is_archived: false,
      layout_x: 0,
      layout_y: 0,
    },
  ];

  const mockOrders = Array.from({ length: 501 }, (_, i) => ({
    id: `order-target-${i + 1}`,
    shop_id: targetShopId,
    table_id: 'table-active-1',
    table_label: 'Bàn Hoạt Động 1',
    status: 'new',
    payment_status: 'unpaid',
    total_amount: 10000,
  }));

  mockOrders.push({
    id: 'order-foreign-shop',
    shop_id: 'other-shop-foreign',
    table_id: 'table-active-1',
    table_label: 'Bàn Hoạt Động 1',
    status: 'new',
    payment_status: 'unpaid',
    total_amount: 999999,
  });

  const fakeClient = createFakeSupabaseClient({
    shopTablesData: mockShopTables,
    ordersData: mockOrders,
  });

  setSupabaseDbClientForTests(fakeClient);
  try {
    const req = new Request(
      `https://qlaok.test/api/tables/floor-plan?shopId=${targetShopId}`,
      {
        method: 'GET',
        headers: { authorization: getAdminAuthHeader() },
      }
    );

    const res = await GET(req);
    assert.equal(res.status, 200);

    const body = (await res.json()) as { tables: Array<Record<string, unknown>> };
    assert.ok(Array.isArray(body.tables), 'Expected response to have tables array');
    assert.equal(body.tables.length, 2, 'Expected only non-archived tables belonging to the shop');

    for (const table of body.tables) {
      const keys = Object.keys(table).sort();
      assert.equal(keys.length, 13, `Table ${table.id} does not have exactly 13 keys`);
      assert.deepEqual(keys, DOCUMENTED_13_KEYS, `Table ${table.id} keys mismatch`);
    }

    assert.equal(
      body.tables.some((t) => t.id === 'table-archived-3'),
      false,
      'Archived table must be excluded'
    );
    assert.equal(
      body.tables.some((t) => t.id === 'table-other-shop-4'),
      false,
      'Other shop table must be excluded'
    );

    const inactiveTable = body.tables.find((t) => t.id === 'table-inactive-2');
    assert.ok(inactiveTable, 'Inactive table must be included');
    assert.equal(inactiveTable.is_active, false);
    assert.equal(inactiveTable.floor_status, 'inactive');
    assert.equal(inactiveTable.open_order_count, 0);
    assert.equal(inactiveTable.unpaid_amount, 0);

    const activeTable = body.tables.find((t) => t.id === 'table-active-1');
    assert.ok(activeTable, 'Active table must be present');
    assert.equal(activeTable.is_active, true);
    assert.equal(activeTable.floor_status, 'occupied');
    assert.equal(activeTable.open_order_count, 501);
    assert.equal(activeTable.unpaid_amount, 501 * 10000);

    const orderRangeCalls = fakeClient.queryLogs.filter(
      (q) => q.table === 'orders' && q.range !== undefined
    );
    assert.equal(orderRangeCalls.length, 2, 'Expected 2 pagination queries for orders (501 rows)');
    assert.deepEqual(orderRangeCalls[0].range, { from: 0, to: 499 });
    assert.deepEqual(orderRangeCalls[1].range, { from: 500, to: 999 });

    for (const call of orderRangeCalls) {
      assert.deepEqual(call.filters, [{ column: 'shop_id', value: targetShopId }]);
      assert.deepEqual(call.order, { column: 'id', options: { ascending: true } });
      assert.equal(
        call.orExpression,
        'status.in.(new,preparing),and(status.eq.completed,payment_status.eq.unpaid)',
        'The floor plan must filter orders server-side to open/unpaid tickets'
      );
    }

    const tableCalls = fakeClient.queryLogs.filter((q) => q.table === 'shop_tables');
    assert.equal(tableCalls.length, 1);
    assert.deepEqual(tableCalls[0].filters, [
      { column: 'shop_id', value: targetShopId },
      { column: 'is_archived', value: false },
    ]);
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('(c) a page returning {data:null,error:null} returns generic 500 TABLE_FLOOR_PLAN_FETCH_FAILED without partial tables and without exposing an internal message', async () => {
  const fakeClient = createFakeSupabaseClient({
    shopTablesData: [
      {
        id: 'table-c-1',
        shop_id: 'shop-c',
        name: 'Bàn C1',
        table_code: 'TC1',
        is_active: true,
        is_archived: false,
      },
    ],
    onOrdersRange: () => ({ data: null, error: null }),
  });

  const originalConsoleError = console.error;
  const capturedErrors: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    capturedErrors.push(args);
  };

  setSupabaseDbClientForTests(fakeClient);
  try {
    const req = new Request('https://qlaok.test/api/tables/floor-plan?shopId=shop-c', {
      method: 'GET',
      headers: { authorization: getAdminAuthHeader() },
    });

    const res = await GET(req);
    assert.equal(res.status, 500);

    const json = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(json, {
      error: 'Lỗi truy vấn sơ đồ bàn.',
      code: 'TABLE_FLOOR_PLAN_FETCH_FAILED',
    });
    assert.equal('tables' in json, false, 'Must not return partial tables');

    const serialized = JSON.stringify(json);
    assert.equal(serialized.includes('QUERY_FAILED'), false);
    assert.equal(serialized.includes('không hợp lệ'), false);
    assert.equal(serialized.includes('table-c-1'), false);
    assert.ok(capturedErrors.length > 0, 'Internal error should be logged to console.error');
  } finally {
    console.error = originalConsoleError;
    setSupabaseDbClientForTests(null);
  }
});

test('(d) a DB page error also returns generic 500 without exposing the internal DB message', async () => {
  const sensitiveDbMessage = 'connection to server at postgresql.internal failed: SSL SYSCALL error: EOF detected';

  const fakeClient = createFakeSupabaseClient({
    shopTablesData: [
      {
        id: 'table-d-1',
        shop_id: 'shop-d',
        name: 'Bàn D1',
        table_code: 'TD1',
        is_active: true,
        is_archived: false,
      },
    ],
    onOrdersRange: () => ({ data: null, error: { message: sensitiveDbMessage } }),
  });

  const originalConsoleError = console.error;
  const capturedErrors: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    capturedErrors.push(args);
  };

  setSupabaseDbClientForTests(fakeClient);
  try {
    const req = new Request('https://qlaok.test/api/tables/floor-plan?shopId=shop-d', {
      method: 'GET',
      headers: { authorization: getAdminAuthHeader() },
    });

    const res = await GET(req);
    assert.equal(res.status, 500);

    const json = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(json, {
      error: 'Lỗi truy vấn sơ đồ bàn.',
      code: 'TABLE_FLOOR_PLAN_FETCH_FAILED',
    });
    assert.equal('tables' in json, false, 'Must not return partial tables');

    const serialized = JSON.stringify(json);
    assert.equal(serialized.includes(sensitiveDbMessage), false);
    assert.equal(serialized.includes('QUERY_FAILED'), false);
    assert.equal(serialized.includes('postgresql'), false);
    assert.ok(capturedErrors.length > 0, 'DB error should be logged to console.error');
  } finally {
    console.error = originalConsoleError;
    setSupabaseDbClientForTests(null);
  }
});

test('(e) 10001 matching orders triggers the cap lookahead and returns 500, while a separate test with exactly 10000 rows succeeds', async () => {
  // Part 1: 10001 matching orders triggers cap lookahead and returns 500
  {
    const shopIdE1 = 'shop-floor-e1';
    const orders10001 = Array.from({ length: 10001 }, (_, i) => ({
      id: `order-10001-${i + 1}`,
      shop_id: shopIdE1,
      table_id: 'table-e1-1',
      table_label: 'Bàn E1',
      status: 'new',
      payment_status: 'unpaid',
      total_amount: 1000,
    }));

    const fakeClientE1 = createFakeSupabaseClient({
      shopTablesData: [
        {
          id: 'table-e1-1',
          shop_id: shopIdE1,
          name: 'Bàn E1',
          table_code: 'TE1',
          is_active: true,
          is_archived: false,
        },
      ],
      ordersData: orders10001,
    });

    const originalConsoleError = console.error;
    const capturedErrors: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      capturedErrors.push(args);
    };

    setSupabaseDbClientForTests(fakeClientE1);
    try {
      const req = new Request(
        `https://qlaok.test/api/tables/floor-plan?shopId=${shopIdE1}`,
        {
          method: 'GET',
          headers: { authorization: getAdminAuthHeader() },
        }
      );

      const res = await GET(req);
      assert.equal(res.status, 500);

      const json = (await res.json()) as Record<string, unknown>;
      assert.deepEqual(json, {
        error: 'Lỗi truy vấn sơ đồ bàn.',
        code: 'TABLE_FLOOR_PLAN_FETCH_FAILED',
      });
      assert.equal('tables' in json, false, 'Must not return tables on cap exceeded');

      const lookaheadCalls = fakeClientE1.queryLogs.filter(
        (q) => q.table === 'orders' && q.range?.from === 10000 && q.range?.to === 10000
      );
      assert.equal(lookaheadCalls.length, 1, 'Lookahead query range(10000, 10000) must be called');
      assert.ok(capturedErrors.length > 0, 'MAX_RECORDS_EXCEEDED should be logged to console.error');
    } finally {
      console.error = originalConsoleError;
      setSupabaseDbClientForTests(null);
    }
  }

  // Part 2: Separate test with exactly 10000 rows succeeds
  {
    const shopIdE2 = 'shop-floor-e2';
    const orders10000 = Array.from({ length: 10000 }, (_, i) => ({
      id: `order-10000-${i + 1}`,
      shop_id: shopIdE2,
      table_id: 'table-e2-1',
      table_label: 'Bàn E2',
      status: 'new',
      payment_status: 'unpaid',
      total_amount: 2000,
    }));

    const fakeClientE2 = createFakeSupabaseClient({
      shopTablesData: [
        {
          id: 'table-e2-1',
          shop_id: shopIdE2,
          name: 'Bàn E2',
          table_code: 'TE2',
          is_active: true,
          is_archived: false,
        },
      ],
      ordersData: orders10000,
    });

    setSupabaseDbClientForTests(fakeClientE2);
    try {
      const req = new Request(
        `https://qlaok.test/api/tables/floor-plan?shopId=${shopIdE2}`,
        {
          method: 'GET',
          headers: { authorization: getAdminAuthHeader() },
        }
      );

      const res = await GET(req);
      assert.equal(res.status, 200);

      const json = (await res.json()) as { tables: Array<Record<string, unknown>> };
      assert.ok(Array.isArray(json.tables));
      assert.equal(json.tables.length, 1);
      assert.equal(json.tables[0].open_order_count, 10000);
      assert.equal(json.tables[0].unpaid_amount, 10000 * 2000);
      assert.equal(json.tables[0].floor_status, 'occupied');

      const lookaheadCalls = fakeClientE2.queryLogs.filter(
        (q) => q.table === 'orders' && q.range?.from === 10000 && q.range?.to === 10000
      );
      assert.equal(lookaheadCalls.length, 1, 'Lookahead query range(10000, 10000) must be called');

      const orderRangeCalls = fakeClientE2.queryLogs.filter(
        (q) => q.table === 'orders' && q.range !== undefined
      );
      assert.equal(orderRangeCalls.length, 21, 'Expected 20 pages of 500 + 1 lookahead call = 21 range calls');
    } finally {
      setSupabaseDbClientForTests(null);
    }
  }
});
