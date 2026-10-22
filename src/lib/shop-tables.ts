import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getSupabaseDbClient,
  isSupabaseDbClientOverriddenForTests,
} from '@/lib/db';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { isTakeawayTableLabel } from '@/lib/table-helpers';
import type { PublicShopTable, ShopTable } from '@/types/qlaok';

function getTableQrSigningSecret(): string {
  const configured = process.env.SESSION_SECRET;
  if (configured && configured.trim().length >= 16) {
    return configured.trim();
  }
  const fallbackEnv =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.PAYMENT_WEBHOOK_SECRET;
  if (fallbackEnv && fallbackEnv.trim().length >= 16) {
    return fallbackEnv.trim();
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET (at least 16 characters) is required in production.');
  }
  return 'qlaok-server-hmac-secret-key-v2-do-not-share-in-client';
}

export function buildCanonicalTableQrPayload(shopId: string, tableId: string): string {
  return `qlaok-table-qr:v1:${(shopId ?? '').trim()}:${(tableId ?? '').trim()}`;
}

export function signTableQr(shopId: string, tableId: string): string {
  const cleanShopId = (shopId ?? '').trim();
  const cleanTableId = (tableId ?? '').trim();
  if (!cleanShopId || !cleanTableId) return '';
  return createHmac('sha256', getTableQrSigningSecret())
    .update(buildCanonicalTableQrPayload(cleanShopId, cleanTableId))
    .digest('base64url');
}

export function verifyTableQrSignature(params: {
  shop_id: string;
  table_id: string;
  signature?: string | null;
}): boolean {
  const cleanShopId = (params.shop_id ?? '').trim();
  const cleanTableId = (params.table_id ?? '').trim();
  const cleanSig = typeof params.signature === 'string' ? params.signature.trim() : '';
  if (!cleanShopId || !cleanTableId || !cleanSig) return false;
  const expected = signTableQr(cleanShopId, cleanTableId);
  if (!expected) return false;
  const sigBuf = Buffer.from(cleanSig, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(sigBuf, expectedBuf);
}

export function withTableQrSignature(table: ShopTable): ShopTable {
  return {
    ...table,
    qr_sig: signTableQr(table.shop_id, table.id),
  };
}

const IS_NODE_TEST_PROCESS =
  Boolean(process.env.NODE_TEST_CONTEXT) ||
  process.argv.includes('--test') ||
  process.execArgv.includes('--test') ||
  process.env.NODE_ENV === 'test' ||
  process.argv.some((arg) => arg.includes('.test.'));

const PROCESS_TEST_TABLES_FILE = IS_NODE_TEST_PROCESS
  ? path.join(
      os.tmpdir(),
      `qlaok-shop-tables-test-${process.pid}-${Date.now()}`,
      'shop-tables.json'
    )
  : null;

const DEFAULT_TIMESTAMP = '2026-03-01T00:00:00.000Z';

export const SEED_SHOP_TABLES: ShopTable[] = [
  {
    id: 'tbl-fnb-01',
    shop_id: 'shop-fnb-001',
    table_code: 'T01',
    name: 'Bàn 01',
    section: 'Tầng 1',
    capacity: 4,
    sort_order: 1,
    is_active: true,
    is_archived: false,
    archived_at: null,
    created_at: DEFAULT_TIMESTAMP,
    updated_at: DEFAULT_TIMESTAMP,
  },
  {
    id: 'tbl-fnb-02',
    shop_id: 'shop-fnb-001',
    table_code: 'T02',
    name: 'Bàn 02',
    section: 'Tầng 1',
    capacity: 4,
    sort_order: 2,
    is_active: true,
    is_archived: false,
    archived_at: null,
    created_at: DEFAULT_TIMESTAMP,
    updated_at: DEFAULT_TIMESTAMP,
  },
  {
    id: 'tbl-fnb-03',
    shop_id: 'shop-fnb-001',
    table_code: 'T03',
    name: 'Bàn 03',
    section: 'Tầng 1',
    capacity: 4,
    sort_order: 3,
    is_active: true,
    is_archived: false,
    archived_at: null,
    created_at: DEFAULT_TIMESTAMP,
    updated_at: DEFAULT_TIMESTAMP,
  },
  {
    id: 'tbl-fnb-04',
    shop_id: 'shop-fnb-001',
    table_code: 'T04',
    name: 'Bàn 04',
    section: 'Tầng 1',
    capacity: 4,
    sort_order: 4,
    is_active: true,
    is_archived: false,
    archived_at: null,
    created_at: DEFAULT_TIMESTAMP,
    updated_at: DEFAULT_TIMESTAMP,
  },
  {
    id: 'tbl-fnb-05',
    shop_id: 'shop-fnb-001',
    table_code: 'T05',
    name: 'Bàn 05',
    section: 'Tầng 1',
    capacity: 6,
    sort_order: 5,
    is_active: true,
    is_archived: false,
    archived_at: null,
    created_at: DEFAULT_TIMESTAMP,
    updated_at: DEFAULT_TIMESTAMP,
  },
  {
    id: 'tbl-fnb-06',
    shop_id: 'shop-fnb-001',
    table_code: 'T06',
    name: 'Bàn 06',
    section: 'Tầng 2',
    capacity: 4,
    sort_order: 6,
    is_active: true,
    is_archived: false,
    archived_at: null,
    created_at: DEFAULT_TIMESTAMP,
    updated_at: DEFAULT_TIMESTAMP,
  },
  {
    id: 'tbl-fnb-07',
    shop_id: 'shop-fnb-001',
    table_code: 'T07',
    name: 'Bàn 07',
    section: 'Tầng 2',
    capacity: 4,
    sort_order: 7,
    is_active: true,
    is_archived: false,
    archived_at: null,
    created_at: DEFAULT_TIMESTAMP,
    updated_at: DEFAULT_TIMESTAMP,
  },
  {
    id: 'tbl-fnb-08',
    shop_id: 'shop-fnb-001',
    table_code: 'T08',
    name: 'Bàn 08',
    section: 'Tầng 2',
    capacity: 6,
    sort_order: 8,
    is_active: true,
    is_archived: false,
    archived_at: null,
    created_at: DEFAULT_TIMESTAMP,
    updated_at: DEFAULT_TIMESTAMP,
  },
  {
    id: 'tbl-fnb-09',
    shop_id: 'shop-fnb-001',
    table_code: 'T09',
    name: 'Bàn 09',
    section: 'Sân vườn',
    capacity: 4,
    sort_order: 9,
    is_active: true,
    is_archived: false,
    archived_at: null,
    created_at: DEFAULT_TIMESTAMP,
    updated_at: DEFAULT_TIMESTAMP,
  },
  {
    id: 'tbl-fnb-10',
    shop_id: 'shop-fnb-001',
    table_code: 'T10',
    name: 'Bàn 10',
    section: 'Sân vườn',
    capacity: 6,
    sort_order: 10,
    is_active: true,
    is_archived: false,
    archived_at: null,
    created_at: DEFAULT_TIMESTAMP,
    updated_at: DEFAULT_TIMESTAMP,
  },
  {
    id: 'tbl-fnb-11',
    shop_id: 'shop-fnb-001',
    table_code: 'T11',
    name: 'Bàn 11',
    section: 'Sân vườn',
    capacity: 4,
    sort_order: 11,
    is_active: true,
    is_archived: false,
    archived_at: null,
    created_at: DEFAULT_TIMESTAMP,
    updated_at: DEFAULT_TIMESTAMP,
  },
  {
    id: 'tbl-fnb-12',
    shop_id: 'shop-fnb-001',
    table_code: 'T12',
    name: 'Bàn 12',
    section: 'Phòng VIP',
    capacity: 8,
    sort_order: 12,
    is_active: true,
    is_archived: false,
    archived_at: null,
    created_at: DEFAULT_TIMESTAMP,
    updated_at: DEFAULT_TIMESTAMP,
  },
  {
    id: 'tbl-service-01',
    shop_id: 'shop-service-002',
    table_code: 'R01',
    name: 'Phòng 01',
    section: 'Khu Spa',
    capacity: 2,
    sort_order: 1,
    is_active: true,
    is_archived: false,
    archived_at: null,
    created_at: DEFAULT_TIMESTAMP,
    updated_at: DEFAULT_TIMESTAMP,
  },
  {
    id: 'tbl-service-02',
    shop_id: 'shop-service-002',
    table_code: 'R02',
    name: 'Phòng 02',
    section: 'Khu Spa',
    capacity: 2,
    sort_order: 2,
    is_active: true,
    is_archived: false,
    archived_at: null,
    created_at: DEFAULT_TIMESTAMP,
    updated_at: DEFAULT_TIMESTAMP,
  },
  {
    id: 'tbl-service-03',
    shop_id: 'shop-service-002',
    table_code: 'R03',
    name: 'Phòng VIP 01',
    section: 'Khu VIP',
    capacity: 4,
    sort_order: 3,
    is_active: true,
    is_archived: false,
    archived_at: null,
    created_at: DEFAULT_TIMESTAMP,
    updated_at: DEFAULT_TIMESTAMP,
  },
  {
    id: 'tbl-retail-01',
    shop_id: 'shop-retail-003',
    table_code: 'C01',
    name: 'Quầy 01',
    section: 'Khu chính',
    capacity: 2,
    sort_order: 1,
    is_active: true,
    is_archived: false,
    archived_at: null,
    created_at: DEFAULT_TIMESTAMP,
    updated_at: DEFAULT_TIMESTAMP,
  },
  {
    id: 'tbl-retail-02',
    shop_id: 'shop-retail-003',
    table_code: 'C02',
    name: 'Quầy 02',
    section: 'Khu chính',
    capacity: 2,
    sort_order: 2,
    is_active: true,
    is_archived: false,
    archived_at: null,
    created_at: DEFAULT_TIMESTAMP,
    updated_at: DEFAULT_TIMESTAMP,
  },
];

let testTablesFileOverride: string | null = null;
let testTablesDbClientOverride: SupabaseClient | null = null;
let testForceTablesDbMode: boolean | null = null;
let memoryTablesFallback: ShopTable[] | null = null;

export function setShopTablesFileForTests(filePath: string | null): void {
  testTablesFileOverride = filePath;
  memoryTablesFallback = null;
}

export function setShopTablesDbClientForTests(
  client: unknown | null,
  forceDbMode?: boolean
): void {
  testTablesDbClientOverride = (client as SupabaseClient | null) ?? null;
  testForceTablesDbMode =
    forceDbMode !== undefined ? forceDbMode : client !== null ? true : null;
}

export function isShopTablesDbAuthoritative(): boolean {
  if (testForceTablesDbMode !== null) return testForceTablesDbMode;
  if (testTablesDbClientOverride !== null) return true;
  if (isSupabaseDbClientOverriddenForTests()) return true;
  if (IS_NODE_TEST_PROCESS && process.env.QLAOK_ENABLE_TEST_SUPABASE !== '1') {
    return false;
  }
  return (
    isSupabaseConfigured() ||
    Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.SUPABASE_SERVICE_ROLE_KEY
    )
  );
}

function getActiveTablesDbClient(explicitClient?: unknown): SupabaseClient {
  if (explicitClient) return explicitClient as SupabaseClient;
  if (testTablesDbClientOverride) return testTablesDbClientOverride;
  return getSupabaseDbClient();
}

export function getLocalTablesFilePath(): string {
  if (testTablesFileOverride) {
    return testTablesFileOverride;
  }
  if (PROCESS_TEST_TABLES_FILE) {
    return PROCESS_TEST_TABLES_FILE;
  }
  return path.join(process.cwd(), '.local-db', 'shop-tables.json');
}

export function normalizeShopTableRecord(raw: Partial<ShopTable>): ShopTable {
  const isArchived = Boolean(raw.is_archived);
  const isActive = isArchived ? false : raw.is_active !== false;
  const capacityNum = Number(raw.capacity);
  const sortOrderNum = Number(raw.sort_order);

  return {
    id: String(raw.id || `tbl-${randomUUID().slice(0, 8)}`).trim(),
    shop_id: String(raw.shop_id || '').trim(),
    table_code: String(raw.table_code || 'T01').trim(),
    name: String(raw.name || 'Bàn 01').trim(),
    section: String(raw.section ?? '').trim(),
    capacity:
      !Number.isNaN(capacityNum) && capacityNum >= 1 && capacityNum <= 200
        ? Math.floor(capacityNum)
        : 4,
    sort_order: !Number.isNaN(sortOrderNum) ? Math.floor(sortOrderNum) : 0,
    is_active: isActive,
    is_archived: isArchived,
    archived_at: isArchived
      ? raw.archived_at || new Date().toISOString()
      : null,
    created_at: raw.created_at || DEFAULT_TIMESTAMP,
    updated_at: raw.updated_at || raw.created_at || DEFAULT_TIMESTAMP,
  };
}

export function toPublicShopTable(table: ShopTable): ShopTable {
  return {
    id: table.id,
    shop_id: table.shop_id,
    table_code: table.table_code,
    name: table.name,
    section: table.section || '',
    capacity: table.capacity,
    sort_order: table.sort_order,
    is_active: Boolean(table.is_active && !table.is_archived),
    is_archived: Boolean(table.is_archived),
  };
}

export function toPublicShopTableView(table: ShopTable): PublicShopTable {
  return {
    id: table.id,
    shop_id: table.shop_id,
    table_code: table.table_code,
    name: table.name,
    section: table.section || '',
    capacity: table.capacity,
    sort_order: table.sort_order,
    is_active: Boolean(table.is_active && !table.is_archived),
  };
}

function sortShopTables(tables: ShopTable[]): ShopTable[] {
  return [...tables].sort((a, b) => {
    if (a.is_archived !== b.is_archived) {
      return a.is_archived ? 1 : -1;
    }
    if (a.sort_order !== b.sort_order) {
      return a.sort_order - b.sort_order;
    }
    return a.table_code.localeCompare(b.table_code, 'vi', { numeric: true });
  });
}

function readLocalTablesStore(): ShopTable[] {
  const filePath = getLocalTablesFilePath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
        tables?: Partial<ShopTable>[];
      };
      if (Array.isArray(raw?.tables)) {
        const loaded = raw.tables.map(normalizeShopTableRecord);
        memoryTablesFallback = loaded;
        return loaded;
      }
    }
  } catch {
    if (memoryTablesFallback) return memoryTablesFallback;
  }

  const seeded = SEED_SHOP_TABLES.map((t) => ({ ...t }));
  writeLocalTablesStore(seeded);
  return seeded;
}

function writeLocalTablesStore(tables: ShopTable[]): void {
  const normalized = tables.map(normalizeShopTableRecord);
  memoryTablesFallback = normalized;
  const filePath = getLocalTablesFilePath();
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      filePath,
      JSON.stringify({ tables: normalized }, null, 2),
      'utf8'
    );
  } catch {
    // read-only environment fallback uses memoryTablesFallback
  }
}

export async function dbGetShopTables(
  shopId: string,
  options?: {
    includeInactive?: boolean;
    includeArchived?: boolean;
    dbClient?: unknown;
  }
): Promise<ShopTable[]> {
  const cleanShopId = (shopId ?? '').trim();
  if (!cleanShopId) return [];

  const includeInactive = Boolean(options?.includeInactive);
  const includeArchived = Boolean(options?.includeArchived);

  if (options?.dbClient || isShopTablesDbAuthoritative()) {
    const sb = getActiveTablesDbClient(options?.dbClient);
    const { data, error } = await sb
      .from('shop_tables')
      .select('*')
      .eq('shop_id', cleanShopId)
      .order('sort_order', { ascending: true });

    if (error) {
      throw new Error(`TABLES_FETCH_FAILED: ${error.message}`);
    }

    const rows = Array.isArray(data)
      ? data.map((row) => normalizeShopTableRecord(row as Partial<ShopTable>))
      : [];

    return sortShopTables(
      rows.filter((t) => {
        if (!includeArchived && t.is_archived) return false;
        if (!includeInactive && !t.is_active) return false;
        return true;
      })
    );
  }

  const allLocal = readLocalTablesStore().filter(
    (t) => t.shop_id === cleanShopId
  );
  return sortShopTables(
    allLocal.filter((t) => {
      if (!includeArchived && t.is_archived) return false;
      if (!includeInactive && !t.is_active) return false;
      return true;
    })
  );
}

export async function dbGetPublicShopTables(
  shopId: string,
  options?: { dbClient?: unknown }
): Promise<ShopTable[]> {
  const activeTables = await dbGetShopTables(shopId, {
    includeInactive: false,
    includeArchived: false,
    dbClient: options?.dbClient,
  });
  return activeTables.map(toPublicShopTable);
}

export async function dbGetShopTableById(
  tableId: string,
  options?: { dbClient?: unknown }
): Promise<ShopTable | null> {
  const cleanId = (tableId ?? '').trim();
  if (!cleanId) return null;

  if (options?.dbClient || isShopTablesDbAuthoritative()) {
    const sb = getActiveTablesDbClient(options?.dbClient);
    const { data, error } = await sb
      .from('shop_tables')
      .select('*')
      .eq('id', cleanId)
      .maybeSingle();

    if (error) {
      throw new Error(`TABLE_LOOKUP_FAILED: ${error.message}`);
    }

    return data
      ? normalizeShopTableRecord(data as Partial<ShopTable>)
      : null;
  }

  const found = readLocalTablesStore().find((t) => t.id === cleanId);
  return found ? normalizeShopTableRecord(found) : null;
}

export async function dbResolveOrderTableIdentity(params: {
  shop_id: string;
  table_id?: string | null;
  table_code?: string | null;
  table_label?: string | null;
  table_qr_sig?: string | null;
  require_table_qr_sig?: boolean;
  strictTableSelection?: boolean;
  dbClient?: unknown;
}): Promise<{ table_id: string | null; table_label: string }> {
  const cleanShopId = (params.shop_id ?? '').trim();
  const rawTableId = (params.table_id ?? '').trim();
  const rawTableCode = (params.table_code ?? '').trim();
  const rawLabel = (params.table_label ?? '').trim();
  const hasSigParam = params.table_qr_sig !== undefined && params.table_qr_sig !== null;
  const cleanSig = typeof params.table_qr_sig === 'string' ? params.table_qr_sig.trim() : '';
  const mustVerifySig = Boolean(params.require_table_qr_sig) || hasSigParam;

  if (mustVerifySig && !rawTableId) {
    throw new Error(
      'MISSING_TABLE_QR_SIGNATURE: Mã xác thực QR bàn bị thiếu hoặc không hợp lệ.'
    );
  }

  if (rawTableId) {
    const table = await dbGetShopTableById(rawTableId, {
      dbClient: params.dbClient,
    });
    if (!table) {
      throw new Error(`INVALID_SHOP_TABLE: Bàn "${rawTableId}" không tồn tại.`);
    }
    if (table.shop_id !== cleanShopId) {
      throw new Error(
        `INVALID_TABLE_SHOP: Bàn "${rawTableId}" không thuộc cửa hàng này.`
      );
    }
    if (mustVerifySig) {
      if (!cleanSig) {
        throw new Error(
          'MISSING_TABLE_QR_SIGNATURE: Mã QR bàn thiếu chữ ký bảo mật. Vui lòng quét lại mã QR tại bàn.'
        );
      }
      if (
        !verifyTableQrSignature({
          shop_id: cleanShopId,
          table_id: table.id,
          signature: cleanSig,
        })
      ) {
        throw new Error(
          'INVALID_TABLE_QR_SIGNATURE: Mã QR bàn không hợp lệ hoặc đã bị thay đổi. Vui lòng quét lại mã QR tại bàn.'
        );
      }
    }
    if (!table.is_active || table.is_archived) {
      throw new Error(
        `INACTIVE_SHOP_TABLE: Bàn "${table.name}" hiện đang tạm ngưng hoặc đã lưu trữ.`
      );
    }
    return {
      table_id: table.id,
      table_label: table.name,
    };
  }

  if (rawTableCode) {
    const allShopTables = await dbGetShopTables(cleanShopId, {
      includeInactive: true,
      includeArchived: true,
      dbClient: params.dbClient,
    });
    const matched = allShopTables.find(
      (t) => t.table_code.trim().toLowerCase() === rawTableCode.toLowerCase()
    );
    if (!matched) {
      const otherShopTable = await dbGetShopTableById(rawTableCode, {
        dbClient: params.dbClient,
      });
      if (otherShopTable && otherShopTable.shop_id !== cleanShopId) {
        throw new Error(
          `INVALID_TABLE_SHOP: Bàn "${rawTableCode}" không thuộc cửa hàng này.`
        );
      }
      throw new Error(
        `INVALID_SHOP_TABLE: Mã bàn "${rawTableCode}" không tồn tại.`
      );
    }
    if (!matched.is_active || matched.is_archived) {
      throw new Error(
        `INACTIVE_SHOP_TABLE: Bàn "${matched.name}" hiện đang tạm ngưng hoặc đã lưu trữ.`
      );
    }
    return {
      table_id: matched.id,
      table_label: matched.name,
    };
  }

  if (!rawLabel) {
    return { table_id: null, table_label: 'Mang về' };
  }

  if (isTakeawayTableLabel(rawLabel)) {
    return { table_id: null, table_label: rawLabel };
  }

  const allShopTables = await dbGetShopTables(cleanShopId, {
    includeInactive: true,
    includeArchived: true,
    dbClient: params.dbClient,
  });

  const needle = rawLabel.toLowerCase();
  const activeMatch = allShopTables.find(
    (t) =>
      !t.is_archived &&
      t.is_active &&
      (t.id.trim().toLowerCase() === needle ||
        t.table_code.trim().toLowerCase() === needle ||
        t.name.trim().toLowerCase() === needle)
  );

  if (activeMatch) {
    return {
      table_id: activeMatch.id,
      table_label: activeMatch.name,
    };
  }

  const inactiveMatch = allShopTables.find(
    (t) =>
      t.id.trim().toLowerCase() === needle ||
      t.table_code.trim().toLowerCase() === needle ||
      t.name.trim().toLowerCase() === needle
  );

  if (inactiveMatch) {
    throw new Error(
      `INACTIVE_SHOP_TABLE: Bàn "${inactiveMatch.name}" hiện đang tạm ngưng hoặc đã lưu trữ.`
    );
  }

  if (params.strictTableSelection) {
    throw new Error(
      `INVALID_SHOP_TABLE: Bàn "${rawLabel}" không tồn tại tại cửa hàng này.`
    );
  }

  return {
    table_id: null,
    table_label: rawLabel,
  };
}

function generateNextTableCode(existingTables: ShopTable[]): string {
  const usedCodes = new Set(
    existingTables.map((t) => t.table_code.trim().toUpperCase())
  );
  let seq = Math.max(1, existingTables.length + 1);
  while (seq < 1000) {
    const candidate = `T${String(seq).padStart(2, '0')}`;
    if (!usedCodes.has(candidate)) {
      return candidate;
    }
    seq += 1;
  }
  return `T${randomUUID().slice(0, 4).toUpperCase()}`;
}

export async function dbCreateShopTable(input: {
  id?: string;
  shop_id: string;
  name: string;
  table_code?: string;
  section?: string;
  capacity?: number;
  sort_order?: number;
  is_active?: boolean;
}): Promise<ShopTable> {
  const cleanShopId = (input.shop_id ?? '').trim();
  const cleanName = (input.name ?? '').trim();
  const cleanSection = (input.section ?? '').trim();

  if (!cleanShopId) {
    throw new Error('MISSING_SHOP_ID: Thiếu mã cửa hàng (shop_id).');
  }
  if (!cleanName) {
    throw new Error('TABLE_NAME_REQUIRED: Tên bàn không được để trống.');
  }

  const existingTables = await dbGetShopTables(cleanShopId, {
    includeInactive: true,
    includeArchived: true,
  });

  const cleanCode =
    (input.table_code ?? '').trim() || generateNextTableCode(existingTables);

  if (!cleanCode) {
    throw new Error('TABLE_CODE_REQUIRED: Mã bàn không được để trống.');
  }

  const duplicateCode = existingTables.find(
    (t) => t.table_code.trim().toLowerCase() === cleanCode.toLowerCase()
  );
  if (duplicateCode) {
    throw new Error(
      `DUPLICATE_TABLE_CODE: Mã bàn "${cleanCode}" đã tồn tại trong cửa hàng này.`
    );
  }

  const duplicateActiveName = existingTables.find(
    (t) =>
      !t.is_archived &&
      t.name.trim().toLowerCase() === cleanName.toLowerCase()
  );
  if (duplicateActiveName) {
    throw new Error(
      `DUPLICATE_TABLE_NAME: Tên bàn "${cleanName}" đã tồn tại trong cửa hàng này.`
    );
  }

  const maxSortOrder = existingTables.reduce(
    (max, t) => Math.max(max, Number(t.sort_order || 0)),
    0
  );
  const nowIso = new Date().toISOString();
  const record = normalizeShopTableRecord({
    id: (input.id ?? '').trim() || `tbl-${randomUUID().slice(0, 8)}`,
    shop_id: cleanShopId,
    table_code: cleanCode,
    name: cleanName,
    section: cleanSection,
    capacity: input.capacity ?? 4,
    sort_order:
      input.sort_order !== undefined ? Number(input.sort_order) : maxSortOrder + 1,
    is_active: input.is_active !== false,
    is_archived: false,
    archived_at: null,
    created_at: nowIso,
    updated_at: nowIso,
  });

  if (isShopTablesDbAuthoritative()) {
    const sb = getActiveTablesDbClient();
    const { data, error } = await sb
      .from('shop_tables')
      .insert({
        id: record.id,
        shop_id: record.shop_id,
        table_code: record.table_code,
        name: record.name,
        section: record.section,
        capacity: record.capacity,
        sort_order: record.sort_order,
        is_active: record.is_active,
        is_archived: record.is_archived,
        archived_at: record.archived_at,
        created_at: record.created_at,
        updated_at: record.updated_at,
      })
      .select('*')
      .maybeSingle();

    if (error || !data) {
      throw new Error(
        `TABLE_CREATE_FAILED: ${error?.message || 'Không thể lưu bàn mới vào cơ sở dữ liệu.'}`
      );
    }

    return normalizeShopTableRecord(data as Partial<ShopTable>);
  }

  const allLocal = readLocalTablesStore();
  if (allLocal.some((t) => t.id === record.id)) {
    throw new Error(`DUPLICATE_TABLE_ID: Bàn "${record.id}" đã tồn tại.`);
  }
  allLocal.push(record);
  writeLocalTablesStore(allLocal);
  return record;
}

export async function dbUpdateShopTable(input: {
  shop_id: string;
  id: string;
  name?: string;
  table_code?: string;
  section?: string;
  capacity?: number;
  sort_order?: number;
  is_active?: boolean;
  is_archived?: boolean;
}): Promise<ShopTable> {
  const cleanShopId = (input.shop_id ?? '').trim();
  const cleanId = (input.id ?? '').trim();

  if (!cleanShopId || !cleanId) {
    throw new Error('MISSING_TABLE_IDENTITY: Thiếu shop_id hoặc id của bàn.');
  }

  const existing = await dbGetShopTableById(cleanId);
  if (!existing) {
    throw new Error(`TABLE_NOT_FOUND: Không tìm thấy bàn "${cleanId}".`);
  }
  if (existing.shop_id !== cleanShopId) {
    throw new Error(
      `FORBIDDEN_CROSS_SHOP_TABLE: Bàn "${cleanId}" không thuộc cửa hàng này.`
    );
  }

  const nextName =
    input.name !== undefined ? input.name.trim() : existing.name;
  const nextCode =
    input.table_code !== undefined
      ? input.table_code.trim()
      : existing.table_code;
  const nextSection =
    input.section !== undefined ? input.section.trim() : existing.section;
  const nextCapacity =
    input.capacity !== undefined ? Number(input.capacity) : existing.capacity;
  const nextSortOrder =
    input.sort_order !== undefined
      ? Number(input.sort_order)
      : existing.sort_order;
  const nextArchived =
    input.is_archived !== undefined
      ? Boolean(input.is_archived)
      : existing.is_archived;
  const nextActive = nextArchived
    ? false
    : input.is_active !== undefined
      ? Boolean(input.is_active)
      : existing.is_active;

  if (!nextName) {
    throw new Error('TABLE_NAME_REQUIRED: Tên bàn không được để trống.');
  }
  if (!nextCode) {
    throw new Error('TABLE_CODE_REQUIRED: Mã bàn không được để trống.');
  }

  const shopTables = await dbGetShopTables(cleanShopId, {
    includeInactive: true,
    includeArchived: true,
  });

  const duplicateCode = shopTables.find(
    (t) =>
      t.id !== cleanId &&
      t.table_code.trim().toLowerCase() === nextCode.toLowerCase()
  );
  if (duplicateCode) {
    throw new Error(
      `DUPLICATE_TABLE_CODE: Mã bàn "${nextCode}" đã tồn tại trong cửa hàng này.`
    );
  }

  if (!nextArchived) {
    const duplicateActiveName = shopTables.find(
      (t) =>
        t.id !== cleanId &&
        !t.is_archived &&
        t.name.trim().toLowerCase() === nextName.toLowerCase()
    );
    if (duplicateActiveName) {
      throw new Error(
        `DUPLICATE_TABLE_NAME: Tên bàn "${nextName}" đã tồn tại trong cửa hàng này.`
      );
    }
  }

  const nowIso = new Date().toISOString();
  const updated = normalizeShopTableRecord({
    ...existing,
    name: nextName,
    table_code: nextCode,
    section: nextSection,
    capacity: nextCapacity,
    sort_order: nextSortOrder,
    is_active: nextActive,
    is_archived: nextArchived,
    archived_at: nextArchived ? existing.archived_at || nowIso : null,
    updated_at: nowIso,
  });

  if (isShopTablesDbAuthoritative()) {
    const sb = getActiveTablesDbClient();
    const { data, error } = await sb
      .from('shop_tables')
      .update({
        name: updated.name,
        table_code: updated.table_code,
        section: updated.section,
        capacity: updated.capacity,
        sort_order: updated.sort_order,
        is_active: updated.is_active,
        is_archived: updated.is_archived,
        archived_at: updated.archived_at,
        updated_at: updated.updated_at,
      })
      .eq('id', cleanId)
      .eq('shop_id', cleanShopId)
      .select('*')
      .maybeSingle();

    if (error || !data) {
      throw new Error(
        `TABLE_UPDATE_FAILED: ${error?.message || 'Không thể cập nhật bàn trong cơ sở dữ liệu.'}`
      );
    }

    return normalizeShopTableRecord(data as Partial<ShopTable>);
  }

  const allLocal = readLocalTablesStore();
  const idx = allLocal.findIndex(
    (t) => t.id === cleanId && t.shop_id === cleanShopId
  );
  if (idx === -1) {
    throw new Error(`TABLE_NOT_FOUND: Không tìm thấy bàn "${cleanId}".`);
  }
  allLocal[idx] = updated;
  writeLocalTablesStore(allLocal);
  return updated;
}
