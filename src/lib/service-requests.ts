import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getSupabaseDbClient,
  isSupabaseDbClientOverriddenForTests,
} from '@/lib/db';
import {
  dbGetShopTableById,
  dbResolveOrderTableIdentity,
} from '@/lib/shop-tables';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { isTakeawayTableLabel } from '@/lib/table-helpers';
import type {
  ServiceRequestStatus,
  ServiceRequestType,
  SupportedLocale,
  TableServiceRequest,
} from '@/types/qlaok';

export const VALID_SERVICE_REQUEST_TYPES: readonly ServiceRequestType[] = [
  'call_staff',
  'request_bill',
];

export const VALID_SERVICE_REQUEST_STATUSES: readonly ServiceRequestStatus[] = [
  'pending',
  'acknowledged',
  'resolved',
];

export const DEFAULT_SERVICE_REQUEST_COOLDOWN_MS = 60_000;

const SUPPORTED_LOCALES: readonly SupportedLocale[] = [
  'vi',
  'en',
  'ko',
  'ja',
  'zh',
  'es',
  'it',
  'ru',
];

const IS_NODE_TEST_PROCESS =
  Boolean(process.env.NODE_TEST_CONTEXT) ||
  process.argv.includes('--test') ||
  process.execArgv.includes('--test') ||
  process.env.NODE_ENV === 'test' ||
  process.argv.some((arg) => arg.includes('.test.'));

const PROCESS_TEST_SERVICE_REQUESTS_FILE = IS_NODE_TEST_PROCESS
  ? path.join(
      os.tmpdir(),
      `qlaok-service-requests-test-${process.pid}-${Date.now()}`,
      'service-requests.json'
    )
  : null;

let testServiceRequestsDbClientOverride: SupabaseClient | null = null;
let testForceServiceRequestsDbMode: boolean | null = null;
let testLocalServiceRequestsPathOverride: string | null = null;
let memoryServiceRequestsFallback: TableServiceRequest[] | null = null;
const MAX_IDEMPOTENCY_KEYS = 2_000;
const idempotencyKeyMap = new Map<string, string>();
const newlyCreatedServiceRequests = new WeakSet<TableServiceRequest>();
let serviceRequestLockQueue: Promise<void> = Promise.resolve();

async function withServiceRequestLock<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const nextLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previousLock = serviceRequestLockQueue;
  serviceRequestLockQueue = previousLock.catch(() => {}).then(() => nextLock);
  await previousLock.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
  }
}

function rememberIdempotencyKey(key: string, requestId: string): void {
  if (!key || !requestId) return;
  if (idempotencyKeyMap.has(key)) {
    idempotencyKeyMap.delete(key);
  } else if (idempotencyKeyMap.size >= MAX_IDEMPOTENCY_KEYS) {
    const oldestKey = idempotencyKeyMap.keys().next().value;
    if (oldestKey !== undefined) {
      idempotencyKeyMap.delete(oldestKey);
    }
  }
  idempotencyKeyMap.set(key, requestId);
}

export function __setServiceRequestsDbClientForTests(
  client: SupabaseClient | null,
  options?: { forceDbMode?: boolean }
): void {
  testServiceRequestsDbClientOverride = client;
  testForceServiceRequestsDbMode =
    options?.forceDbMode !== undefined ? options.forceDbMode : null;
}

export function __setServiceRequestsLocalPathForTests(
  filePath: string | null
): void {
  testLocalServiceRequestsPathOverride = filePath;
  memoryServiceRequestsFallback = null;
}

export function __resetLocalServiceRequestsForTests(): void {
  memoryServiceRequestsFallback = [];
  idempotencyKeyMap.clear();
  const filePath = getLocalServiceRequestsFilePath();
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // ignore cleanup failures
  }
}

export function wasServiceRequestNewlyCreated(
  request: TableServiceRequest
): boolean {
  return newlyCreatedServiceRequests.has(request);
}

export function isServiceRequestsDbAuthoritative(): boolean {
  if (testForceServiceRequestsDbMode !== null) {
    return testForceServiceRequestsDbMode;
  }
  if (testServiceRequestsDbClientOverride !== null) return true;
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

function getActiveServiceRequestsDbClient(
  overrideClient?: unknown
): SupabaseClient {
  if (overrideClient) return overrideClient as SupabaseClient;
  if (testServiceRequestsDbClientOverride) {
    return testServiceRequestsDbClientOverride;
  }
  return getSupabaseDbClient();
}

function getLocalServiceRequestsFilePath(): string {
  if (testLocalServiceRequestsPathOverride) {
    return testLocalServiceRequestsPathOverride;
  }
  if (PROCESS_TEST_SERVICE_REQUESTS_FILE) {
    return PROCESS_TEST_SERVICE_REQUESTS_FILE;
  }
  return path.join(process.cwd(), '.local-db', 'service-requests.json');
}

function normalizeLocale(raw?: string | null): SupportedLocale {
  const clean = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return (SUPPORTED_LOCALES as readonly string[]).includes(clean)
    ? (clean as SupportedLocale)
    : 'vi';
}

export function isValidServiceRequestType(
  value: unknown
): value is ServiceRequestType {
  return (
    typeof value === 'string' &&
    (VALID_SERVICE_REQUEST_TYPES as readonly string[]).includes(value.trim())
  );
}

export function isValidServiceRequestStatus(
  value: unknown
): value is ServiceRequestStatus {
  return (
    typeof value === 'string' &&
    (VALID_SERVICE_REQUEST_STATUSES as readonly string[]).includes(value.trim())
  );
}

export function normalizeServiceRequestRecord(
  raw: Partial<TableServiceRequest>
): TableServiceRequest {
  const nowIso = new Date().toISOString();
  const status: ServiceRequestStatus = isValidServiceRequestStatus(raw.status)
    ? raw.status
    : 'pending';
  const requestType: ServiceRequestType = isValidServiceRequestType(
    raw.request_type
  )
    ? raw.request_type
    : 'call_staff';

  return {
    id: String(raw.id || `srv-${randomUUID().slice(0, 8)}`).trim(),
    shop_id: String(raw.shop_id || '').trim(),
    table_id: String(raw.table_id || '').trim(),
    table_code: String(raw.table_code || '').trim(),
    table_label: String(raw.table_label || '').trim(),
    request_type: requestType,
    status,
    visitor_lang: normalizeLocale(raw.visitor_lang),
    acknowledged_at: raw.acknowledged_at ?? null,
    acknowledged_by: raw.acknowledged_by ?? null,
    resolved_at: raw.resolved_at ?? null,
    resolved_by: raw.resolved_by ?? null,
    created_at: raw.created_at || nowIso,
    updated_at: raw.updated_at || raw.created_at || nowIso,
  };
}

function readLocalServiceRequestsStore(): TableServiceRequest[] {
  const filePath = getLocalServiceRequestsFilePath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
        serviceRequests?: Partial<TableServiceRequest>[];
      };
      if (Array.isArray(raw?.serviceRequests)) {
        const loaded = raw.serviceRequests.map(normalizeServiceRequestRecord);
        memoryServiceRequestsFallback = loaded;
        return loaded;
      }
    }
  } catch {
    if (memoryServiceRequestsFallback) return memoryServiceRequestsFallback;
  }

  if (memoryServiceRequestsFallback) {
    return memoryServiceRequestsFallback;
  }
  memoryServiceRequestsFallback = [];
  return memoryServiceRequestsFallback;
}

function writeLocalServiceRequestsStore(
  requests: TableServiceRequest[]
): void {
  const normalized = requests.map(normalizeServiceRequestRecord);
  memoryServiceRequestsFallback = normalized;
  const filePath = getLocalServiceRequestsFilePath();
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      filePath,
      JSON.stringify({ serviceRequests: normalized }, null, 2),
      'utf8'
    );
  } catch {
    // keep in-memory fallback if filesystem is read-only
  }
}

export async function dbGetShopServiceRequests(
  shopId: string,
  options?: {
    includeResolved?: boolean;
    statuses?: ServiceRequestStatus[];
    tableId?: string;
    dbClient?: unknown;
  }
): Promise<TableServiceRequest[]> {
  const cleanShopId = (shopId ?? '').trim();
  if (!cleanShopId) return [];

  const includeResolved = Boolean(options?.includeResolved);
  const statusesFilter =
    options?.statuses && options.statuses.length > 0
      ? options.statuses
      : includeResolved
        ? undefined
        : (['pending', 'acknowledged'] as ServiceRequestStatus[]);
  const cleanTableId = options?.tableId?.trim() || undefined;

  if (isServiceRequestsDbAuthoritative()) {
    const sb = getActiveServiceRequestsDbClient(options?.dbClient);
    let query = sb
      .from('table_service_requests')
      .select('*')
      .eq('shop_id', cleanShopId);

    if (cleanTableId) {
      query = query.eq('table_id', cleanTableId);
    }
    if (statusesFilter && statusesFilter.length > 0) {
      query = query.in('status', statusesFilter);
    }

    const { data, error } = await query.order('created_at', {
      ascending: false,
    });

    if (error) {
      throw new Error(
        `SERVICE_REQUESTS_FETCH_FAILED: ${error.message || 'Không thể tải danh sách yêu cầu phục vụ.'}`
      );
    }

    return (data || []).map((row) =>
      normalizeServiceRequestRecord(row as Partial<TableServiceRequest>)
    );
  }

  const allLocal = readLocalServiceRequestsStore();
  return allLocal
    .filter((req) => {
      if (req.shop_id !== cleanShopId) return false;
      if (cleanTableId && req.table_id !== cleanTableId) return false;
      if (
        statusesFilter &&
        statusesFilter.length > 0 &&
        !statusesFilter.includes(req.status)
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export async function dbGetServiceRequestById(
  id: string,
  options?: { shopId?: string | null; dbClient?: unknown }
): Promise<TableServiceRequest | null> {
  const cleanId = (id ?? '').trim();
  if (!cleanId) return null;
  const cleanShopId =
    typeof options?.shopId === 'string' && options.shopId.trim()
      ? options.shopId.trim()
      : null;

  if (isServiceRequestsDbAuthoritative()) {
    const sb = getActiveServiceRequestsDbClient(options?.dbClient);
    let query = sb
      .from('table_service_requests')
      .select('*')
      .eq('id', cleanId);
    if (cleanShopId) {
      query = query.eq('shop_id', cleanShopId);
    }
    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new Error(
        `SERVICE_REQUEST_FETCH_FAILED: ${error.message || 'Không thể tải yêu cầu phục vụ.'}`
      );
    }
    if (!data) return null;
    return normalizeServiceRequestRecord(data as Partial<TableServiceRequest>);
  }

  const allLocal = readLocalServiceRequestsStore();
  const found = allLocal.find(
    (req) => req.id === cleanId && (!cleanShopId || req.shop_id === cleanShopId)
  );
  return found ? normalizeServiceRequestRecord(found) : null;
}

export async function dbCreateTableServiceRequest(params: {
  shop_id?: string | null;
  table_id?: string | null;
  table_qr_sig?: string | null;
  table_label?: string | null;
  request_type?: string | null;
  visitor_lang?: SupportedLocale | string | null;
  idempotency_key?: string | null;
  cooldownMs?: number;
  now?: Date;
  dbClient?: unknown;
}): Promise<{
  serviceRequest: TableServiceRequest;
  deduplicated: boolean;
}> {
  const rawType =
    typeof params.request_type === 'string' ? params.request_type.trim() : '';
  if (!isValidServiceRequestType(rawType)) {
    throw new Error(
      'INVALID_SERVICE_REQUEST_TYPE: Loại yêu cầu phục vụ không hợp lệ (chỉ hỗ trợ call_staff hoặc request_bill).'
    );
  }

  const rawTableId =
    typeof params.table_id === 'string' ? params.table_id.trim() : '';
  const rawTableLabel =
    typeof params.table_label === 'string' ? params.table_label.trim() : '';
  const cleanSig =
    typeof params.table_qr_sig === 'string' ? params.table_qr_sig.trim() : '';
  const requestedShopId =
    typeof params.shop_id === 'string' ? params.shop_id.trim() : '';

  if (
    isTakeawayTableLabel(rawTableId) ||
    (!rawTableId && rawTableLabel && isTakeawayTableLabel(rawTableLabel))
  ) {
    throw new Error(
      'TAKEAWAY_SERVICE_REQUEST_FORBIDDEN: Đơn mang về không hỗ trợ gọi phục vụ hoặc xin hóa đơn tại bàn.'
    );
  }

  if (!rawTableId) {
    throw new Error(
      cleanSig
        ? 'INVALID_TABLE_QR_SIGNATURE: Mã QR bàn không hợp lệ hoặc thiếu định danh bàn. Vui lòng quét lại mã QR tại bàn.'
        : 'MISSING_TABLE_QR_SIGNATURE: Vui lòng quét mã QR tại bàn để gọi nhân viên hoặc yêu cầu thanh toán.'
    );
  }

  if (!cleanSig) {
    throw new Error(
      'MISSING_TABLE_QR_SIGNATURE: Mã QR bàn thiếu chữ ký bảo mật. Vui lòng quét lại mã QR tại bàn.'
    );
  }

  // Look up the canonical managed table first so the server derives shop_id and table_label
  // from the verified table record and never trusts an arbitrary client tableId/shopId/tableLabel.
  const canonicalTable = await dbGetShopTableById(rawTableId, {
    dbClient: params.dbClient,
  });
  if (!canonicalTable) {
    throw new Error(`INVALID_SHOP_TABLE: Bàn "${rawTableId}" không tồn tại.`);
  }

  if (requestedShopId && canonicalTable.shop_id !== requestedShopId) {
    throw new Error(
      `INVALID_TABLE_SHOP: Bàn "${rawTableId}" không thuộc cửa hàng này.`
    );
  }

  const verifiedShopId = canonicalTable.shop_id;

  // Reuse the guest order QR signature + active/unarchived table verification
  const resolvedTable = await dbResolveOrderTableIdentity({
    shop_id: verifiedShopId,
    table_id: canonicalTable.id,
    table_qr_sig: cleanSig,
    require_table_qr_sig: true,
    strictTableSelection: true,
    dbClient: params.dbClient,
  });

  if (!resolvedTable.table_id) {
    throw new Error(
      'INVALID_SHOP_TABLE: Không thể xác thực bàn cho yêu cầu phục vụ.'
    );
  }

  const nowDate = params.now ?? new Date();
  const nowMs = nowDate.getTime();
  const nowIso = nowDate.toISOString();
  const cooldownMs =
    typeof params.cooldownMs === 'number' && Number.isFinite(params.cooldownMs)
      ? Math.max(0, params.cooldownMs)
      : DEFAULT_SERVICE_REQUEST_COOLDOWN_MS;

  const cleanIdempotencyKey =
    typeof params.idempotency_key === 'string'
      ? params.idempotency_key.trim()
      : '';
  const scopedIdempotencyKey = cleanIdempotencyKey
    ? `${verifiedShopId}:${canonicalTable.id}:${rawType}:${cleanIdempotencyKey}`
    : '';

  const newRequest: TableServiceRequest = normalizeServiceRequestRecord({
    id: `srv-${randomUUID().slice(0, 12)}`,
    shop_id: verifiedShopId,
    table_id: canonicalTable.id,
    table_code: canonicalTable.table_code,
    table_label: resolvedTable.table_label || canonicalTable.name,
    request_type: rawType,
    status: 'pending',
    visitor_lang: normalizeLocale(params.visitor_lang),
    acknowledged_at: null,
    acknowledged_by: null,
    resolved_at: null,
    resolved_by: null,
    created_at: nowIso,
    updated_at: nowIso,
  });

  if (isServiceRequestsDbAuthoritative()) {
    if (scopedIdempotencyKey) {
      const existingId = idempotencyKeyMap.get(scopedIdempotencyKey);
      if (existingId) {
        const existingByIdemp = await dbGetServiceRequestById(existingId, {
          shopId: verifiedShopId,
          dbClient: params.dbClient,
        });
        if (existingByIdemp && existingByIdemp.status !== 'resolved') {
          return {
            serviceRequest: existingByIdemp,
            deduplicated: true,
          };
        }
      }
    }

    const sb = getActiveServiceRequestsDbClient(params.dbClient);
    const { data: rpcData, error: rpcError } = await sb.rpc(
      'create_table_service_request_atomic',
      {
        p_request: {
          id: newRequest.id,
          shop_id: newRequest.shop_id,
          table_id: newRequest.table_id,
          table_code: newRequest.table_code,
          table_label: newRequest.table_label,
          request_type: newRequest.request_type,
          status: newRequest.status,
          visitor_lang: newRequest.visitor_lang,
          created_at: newRequest.created_at,
          updated_at: newRequest.updated_at,
        },
        p_cooldown_ms: Math.floor(cooldownMs),
      }
    );

    const parsedRpcData =
      typeof rpcData === 'string'
        ? (() => {
            try {
              return JSON.parse(rpcData) as unknown;
            } catch {
              return null;
            }
          })()
        : rpcData;

    if (rpcError || !parsedRpcData || typeof parsedRpcData !== 'object') {
      throw new Error(
        `SERVICE_REQUEST_CREATE_FAILED: ${rpcError?.message || 'Không thể lưu yêu cầu phục vụ.'}`
      );
    }

    const rpcEnvelope = parsedRpcData as {
      service_request?: Partial<TableServiceRequest>;
      serviceRequest?: Partial<TableServiceRequest>;
      deduplicated?: boolean;
    } & Partial<TableServiceRequest>;

    const rawRecord =
      rpcEnvelope.service_request ??
      rpcEnvelope.serviceRequest ??
      (rpcEnvelope.id && rpcEnvelope.shop_id ? rpcEnvelope : null);

    if (!rawRecord) {
      throw new Error(
        'SERVICE_REQUEST_CREATE_FAILED: Không nhận được bản ghi yêu cầu phục vụ từ cơ sở dữ liệu.'
      );
    }

    const saved = normalizeServiceRequestRecord(rawRecord);
    const isDeduplicated = Boolean(rpcEnvelope.deduplicated);
    if (!isDeduplicated) {
      newlyCreatedServiceRequests.add(saved);
    }
    if (scopedIdempotencyKey) {
      rememberIdempotencyKey(scopedIdempotencyKey, saved.id);
    }
    return {
      serviceRequest: saved,
      deduplicated: isDeduplicated,
    };
  }

  return withServiceRequestLock(async () => {
    if (scopedIdempotencyKey) {
      const existingId = idempotencyKeyMap.get(scopedIdempotencyKey);
      if (existingId) {
        const existingByIdemp = await dbGetServiceRequestById(existingId, {
          shopId: verifiedShopId,
          dbClient: params.dbClient,
        });
        if (existingByIdemp && existingByIdemp.status !== 'resolved') {
          return {
            serviceRequest: existingByIdemp,
            deduplicated: true,
          };
        }
      }
    }

    // Server-side per-table + per-type duplicate suppression for local fallback store:
    // If there is already an active (pending/acknowledged) request of the same type
    // for this table within the cooldown window, return the existing request without
    // creating duplicate rows or re-alerting staff.
    const activeForTable = await dbGetShopServiceRequests(verifiedShopId, {
      tableId: canonicalTable.id,
      statuses: ['pending', 'acknowledged'],
      dbClient: params.dbClient,
    });

    const duplicateActive = activeForTable.find((req) => {
      if (req.request_type !== rawType) return false;
      if (cooldownMs <= 0) return false;
      const createdMs = Date.parse(req.created_at);
      if (!Number.isFinite(createdMs)) return true;
      return Math.abs(nowMs - createdMs) <= cooldownMs;
    });

    if (duplicateActive) {
      if (scopedIdempotencyKey) {
        rememberIdempotencyKey(scopedIdempotencyKey, duplicateActive.id);
      }
      return {
        serviceRequest: duplicateActive,
        deduplicated: true,
      };
    }

    const allLocal = readLocalServiceRequestsStore();
    allLocal.unshift(newRequest);
    writeLocalServiceRequestsStore(allLocal);
    newlyCreatedServiceRequests.add(newRequest);
    if (scopedIdempotencyKey) {
      rememberIdempotencyKey(scopedIdempotencyKey, newRequest.id);
    }

    return {
      serviceRequest: newRequest,
      deduplicated: false,
    };
  });
}

export async function dbUpdateServiceRequestStatus(params: {
  id: string;
  shop_id: string;
  status: ServiceRequestStatus;
  actor_id?: string | null;
  now?: Date;
  dbClient?: unknown;
}): Promise<TableServiceRequest> {
  const cleanId = (params.id ?? '').trim();
  if (!cleanId) {
    throw new Error('MISSING_SERVICE_REQUEST_ID: Thiếu mã yêu cầu phục vụ.');
  }

  const cleanShopId =
    typeof params.shop_id === 'string' ? params.shop_id.trim() : '';
  if (!cleanShopId) {
    throw new Error('MISSING_SHOP_ID: Thiếu mã cửa hàng (shop_id).');
  }

  const nextStatus =
    typeof params.status === 'string'
      ? (params.status.trim() as ServiceRequestStatus)
      : ('' as ServiceRequestStatus);
  if (!isValidServiceRequestStatus(nextStatus)) {
    throw new Error(
      'INVALID_SERVICE_REQUEST_STATUS: Trạng thái yêu cầu phục vụ không hợp lệ.'
    );
  }

  return withServiceRequestLock(async () => {
    const existing = await dbGetServiceRequestById(cleanId, {
      shopId: cleanShopId,
      dbClient: params.dbClient,
    });
    if (!existing) {
      throw new Error(
        `SERVICE_REQUEST_NOT_FOUND: Không tìm thấy yêu cầu phục vụ "${cleanId}".`
      );
    }

    if (existing.status === 'resolved' && nextStatus !== 'resolved') {
      throw new Error(
        `INVALID_SERVICE_REQUEST_TRANSITION: Yêu cầu đã hoàn tất không thể chuyển lại trạng thái "${nextStatus}".`
      );
    }

    if (existing.status === 'acknowledged' && nextStatus === 'pending') {
      throw new Error(
        'INVALID_SERVICE_REQUEST_TRANSITION: Yêu cầu đã tiếp nhận không thể chuyển lại trạng thái chờ xử lý.'
      );
    }

    if (existing.status === nextStatus) {
      return existing;
    }

    const nowIso = (params.now ?? new Date()).toISOString();
    const actorId =
      typeof params.actor_id === 'string' && params.actor_id.trim()
        ? params.actor_id.trim()
        : null;

    const nextAcknowledgedAt =
      nextStatus === 'acknowledged' || nextStatus === 'resolved'
        ? existing.acknowledged_at || nowIso
        : existing.acknowledged_at ?? null;
    const nextAcknowledgedBy =
      nextStatus === 'acknowledged' || nextStatus === 'resolved'
        ? existing.acknowledged_by || actorId
        : existing.acknowledged_by ?? null;
    const nextResolvedAt =
      nextStatus === 'resolved'
        ? existing.resolved_at || nowIso
        : existing.resolved_at ?? null;
    const nextResolvedBy =
      nextStatus === 'resolved'
        ? actorId || existing.resolved_by || null
        : existing.resolved_by ?? null;

    const updated = normalizeServiceRequestRecord({
      ...existing,
      status: nextStatus,
      acknowledged_at: nextAcknowledgedAt,
      acknowledged_by: nextAcknowledgedBy,
      resolved_at: nextResolvedAt,
      resolved_by: nextResolvedBy,
      updated_at: nowIso,
    });

    if (isServiceRequestsDbAuthoritative()) {
      const sb = getActiveServiceRequestsDbClient(params.dbClient);
      const { data, error } = await sb
        .from('table_service_requests')
        .update({
          status: updated.status,
          acknowledged_at: updated.acknowledged_at,
          acknowledged_by: updated.acknowledged_by,
          resolved_at: updated.resolved_at,
          resolved_by: updated.resolved_by,
          updated_at: updated.updated_at,
        })
        .eq('id', cleanId)
        .eq('shop_id', existing.shop_id)
        .select('*')
        .maybeSingle();

      if (error || !data) {
        throw new Error(
          `SERVICE_REQUEST_UPDATE_FAILED: ${error?.message || 'Không thể cập nhật yêu cầu phục vụ.'}`
        );
      }

      return normalizeServiceRequestRecord(
        data as Partial<TableServiceRequest>
      );
    }

    const allLocal = readLocalServiceRequestsStore();
    const idx = allLocal.findIndex((req) => req.id === cleanId);
    if (idx === -1) {
      throw new Error(
        `SERVICE_REQUEST_NOT_FOUND: Không tìm thấy yêu cầu phục vụ "${cleanId}".`
      );
    }
    allLocal[idx] = updated;
    writeLocalServiceRequestsStore(allLocal);
    return updated;
  });
}
