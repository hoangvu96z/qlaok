import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  dbGetShopById,
  getSupabaseDbClient,
  isSupabaseDbClientOverriddenForTests,
} from '@/lib/db';
import {
  dbGetOrderById,
  dbGetShopOrdersForReconciliation,
  dbMarkOrderPaidViaSePayInStore,
  isOrderDbConfigured,
  normalizeOrderRecord,
  withOrderInventoryLock,
} from '@/lib/mpos-store';
import { getOrderEventsBroker } from '@/lib/order-events';
import { getShopPaymentQrInfo, stripVietnameseAccents } from '@/lib/payment-qr';
import { SEED_SHOPS } from '@/lib/seed-data';
import { recordOrderAuditLog } from '@/lib/server-auth';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import type { Shop, ShopOrder } from '@/types/qlaok';

export const SEPAY_SIGNATURE_HEADER = 'x-sepay-signature';
export const SEPAY_TIMESTAMP_HEADER = 'x-sepay-timestamp';
export const MIN_SEPAY_ENCRYPTION_KEY_LENGTH = 32;
export const MIN_SEPAY_HMAC_SECRET_LENGTH = 16;
export const MAX_SEPAY_HMAC_SECRET_LENGTH = 512;
export const SEPAY_MAX_WEBHOOK_BODY_BYTES = 64 * 1024; // 64 KiB max unauthenticated raw body

export type SePayWebhookReasonCode =
  | 'OK'
  | 'DUPLICATE_EVENT_NOOP'
  | 'PAYLOAD_TOO_LARGE'
  | 'SEPAY_ENCRYPTION_NOT_CONFIGURED'
  | 'MISSING_SHOP_ID'
  | 'SHOP_NOT_FOUND'
  | 'SEPAY_NOT_CONFIGURED'
  | 'SEPAY_DISABLED'
  | 'SEPAY_SECRET_DECRYPT_FAILED'
  | 'SHOP_BANK_ACCOUNT_NOT_CONFIGURED'
  | 'MISSING_WEBHOOK_TIMESTAMP'
  | 'MISSING_WEBHOOK_SIGNATURE'
  | 'INVALID_WEBHOOK_SIGNATURE'
  | 'INVALID_WEBHOOK_PAYLOAD'
  | 'CONFLICTING_WEBHOOK_EVENT'
  | 'CONFLICTING_BANK_REFERENCE'
  | 'OUTBOUND_TRANSFER'
  | 'ACCOUNT_NUMBER_MISMATCH'
  | 'ORDER_CODE_MISSING'
  | 'AMBIGUOUS_ORDER_CODE'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_CANCELLED'
  | 'PAYMENT_METHOD_NOT_VIETQR'
  | 'ORDER_ALREADY_PAID'
  | 'AMOUNT_MISMATCH';

export interface SePayWebhookPayload {
  id: number | string;
  gateway?: string | null;
  transactionDate?: string | null;
  accountNumber?: string | null;
  subAccount?: string | null;
  code?: string | null;
  content?: string | null;
  transferType?: 'in' | 'out' | string | null;
  transferAmount?: number | string | null;
  accumulated?: number | string | null;
  referenceCode?: string | null;
  description?: string | null;
}

export interface EncryptedSePaySecretRecord {
  shop_id: string;
  enabled: boolean;
  secret_ciphertext: string;
  secret_iv: string;
  secret_auth_tag: string;
  key_version: number;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RedactedShopSePayConfig {
  shopId: string;
  enabled: boolean;
  savedEnabled: boolean;
  hasSecret: boolean;
  isConfigured: boolean;
  encryptionConfigured: boolean;
  callbackPath: string;
  callbackUrl: string;
  recipientAccountConfigured: boolean;
  recipientAccountNumber: string;
  recipientBankShortName: string;
  transferPrefix: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface SePayWebhookEventRecord {
  id: string;
  shop_id: string;
  sepay_transaction_id: string;
  payload_hash: string;
  reference_code: string | null;
  transfer_type: 'in' | 'out' | 'unknown';
  transfer_amount: number;
  account_number: string | null;
  extracted_order_code: string | null;
  order_id: string | null;
  outcome: 'reconciled' | 'rejected' | 'conflict';
  reason_code: SePayWebhookReasonCode | string;
  delivery_count: number;
  conflict_count: number;
  last_conflict_hash: string | null;
  last_conflict_at: string | null;
  raw_payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SePayWebhookProcessResult {
  httpStatus: number;
  success: boolean;
  reconciled: boolean;
  duplicate: boolean;
  code: SePayWebhookReasonCode;
  message: string;
  shopId: string;
  sepayTransactionId?: string;
  referenceCode?: string | null;
  extractedOrderCode?: string | null;
  orderId?: string | null;
  orderCode?: string | null;
  order?: ShopOrder | null;
}

interface LocalSePayPrivateStore {
  configs: Record<string, EncryptedSePaySecretRecord>;
  events: Record<string, SePayWebhookEventRecord>;
}

const IS_NODE_TEST_PROCESS =
  Boolean(process.env.NODE_TEST_CONTEXT) ||
  process.argv.includes('--test') ||
  process.execArgv.includes('--test') ||
  process.env.NODE_ENV === 'test' ||
  process.argv.some((arg) => arg.includes('.test.'));

const PROCESS_TEST_SEPAY_STORE_FILE = IS_NODE_TEST_PROCESS
  ? path.join(
      os.tmpdir(),
      `qlaok-sepay-test-${process.pid}-${Date.now()}`,
      'sepay-private.json'
    )
  : null;

let testSePayDbClientOverride: SupabaseClient | null = null;
let testForceSePayDbMode: boolean | null = null;
let testLocalSePayStorePathOverride: string | null = null;

export function __setSePayDbClientForTests(
  client: SupabaseClient | null,
  options?: { forceDbMode?: boolean }
): void {
  testSePayDbClientOverride = client;
  testForceSePayDbMode =
    options?.forceDbMode !== undefined ? options.forceDbMode : null;
}

export function __setSePayLocalStorePathForTests(
  filePath: string | null
): void {
  testLocalSePayStorePathOverride = filePath;
}

export function __resetSePayStoreForTests(): void {
  const filePath = resolveLocalSePayStorePath();
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // ignore cleanup error
  }
}

function resolveLocalSePayStorePath(): string {
  if (testLocalSePayStorePathOverride) return testLocalSePayStorePathOverride;
  if (PROCESS_TEST_SEPAY_STORE_FILE) return PROCESS_TEST_SEPAY_STORE_FILE;
  return path.join(process.cwd(), '.local-db', 'sepay-private.json');
}

function readLocalSePayStore(): LocalSePayPrivateStore {
  const filePath = resolveLocalSePayStorePath();
  try {
    if (!fs.existsSync(filePath)) {
      return { configs: {}, events: {} };
    }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<LocalSePayPrivateStore>;
    return {
      configs: raw.configs && typeof raw.configs === 'object' ? raw.configs : {},
      events: raw.events && typeof raw.events === 'object' ? raw.events : {},
    };
  } catch {
    return { configs: {}, events: {} };
  }
}

function writeLocalSePayStore(store: LocalSePayPrivateStore): void {
  const filePath = resolveLocalSePayStorePath();
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8');
}

export function isSePayDbAuthoritative(): boolean {
  if (testForceSePayDbMode !== null) return testForceSePayDbMode;
  if (testSePayDbClientOverride !== null) return true;
  if (isOrderDbConfigured()) return true;
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

function getActiveSePayDbClient(overrideClient?: SupabaseClient): SupabaseClient {
  if (overrideClient) return overrideClient;
  if (testSePayDbClientOverride) return testSePayDbClientOverride;
  return getSupabaseDbClient();
}

function getRawSePayEncryptionKey(): string {
  return (process.env.SEPAY_SECRET_ENCRYPTION_KEY || '').trim();
}

export function isSePayEncryptionConfigured(): boolean {
  const raw = getRawSePayEncryptionKey();
  if (!raw || raw.length < MIN_SEPAY_ENCRYPTION_KEY_LENGTH) return false;
  if (
    raw.includes('replace-with') ||
    raw.includes('your-sepay-encryption-key')
  ) {
    return false;
  }
  return true;
}

function deriveSePayAesKey(): Buffer {
  const raw = getRawSePayEncryptionKey();
  if (!isSePayEncryptionConfigured()) {
    throw new Error(
      'SEPAY_ENCRYPTION_NOT_CONFIGURED: Máy chủ chưa cấu hình SEPAY_SECRET_ENCRYPTION_KEY (tối thiểu 32 ký tự).'
    );
  }
  return Buffer.from(
    crypto.hkdfSync(
      'sha256',
      Buffer.from(raw, 'utf8'),
      Buffer.from('qlaok:sepay-secret-salt:v1', 'utf8'),
      Buffer.from('qlaok:sepay-secret-aes256gcm:v1', 'utf8'),
      32
    )
  );
}

export function encryptSePaySecret(
  shopId: string,
  plainSecret: string
): {
  secret_ciphertext: string;
  secret_iv: string;
  secret_auth_tag: string;
  key_version: number;
} {
  const cleanShopId = (shopId || '').trim();
  const cleanSecret = (plainSecret || '').trim();
  if (!cleanShopId) {
    throw new Error('MISSING_SHOP_ID: Thiếu mã cửa hàng (shopId).');
  }
  if (cleanSecret.length < MIN_SEPAY_HMAC_SECRET_LENGTH) {
    throw new Error(
      `INVALID_SEPAY_SECRET: Khóa bí mật SePay phải có tối thiểu ${MIN_SEPAY_HMAC_SECRET_LENGTH} ký tự.`
    );
  }
  if (cleanSecret.length > MAX_SEPAY_HMAC_SECRET_LENGTH) {
    throw new Error(
      `INVALID_SEPAY_SECRET: Khóa bí mật SePay không được vượt quá ${MAX_SEPAY_HMAC_SECRET_LENGTH} ký tự.`
    );
  }

  const key = deriveSePayAesKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`shop:${cleanShopId}:v1`, 'utf8'));

  const encrypted = Buffer.concat([
    cipher.update(cleanSecret, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    secret_ciphertext: encrypted.toString('base64url'),
    secret_iv: iv.toString('base64url'),
    secret_auth_tag: authTag.toString('base64url'),
    key_version: 1,
  };
}

export function decryptSePaySecret(
  shopId: string,
  record: Pick<
    EncryptedSePaySecretRecord,
    'secret_ciphertext' | 'secret_iv' | 'secret_auth_tag'
  >
): string {
  const cleanShopId = (shopId || '').trim();
  if (
    !cleanShopId ||
    !record?.secret_ciphertext ||
    !record?.secret_iv ||
    !record?.secret_auth_tag
  ) {
    throw new Error(
      'SEPAY_SECRET_DECRYPT_FAILED: Dữ liệu khóa bí mật SePay không đầy đủ.'
    );
  }

  const key = deriveSePayAesKey();
  try {
    const iv = Buffer.from(record.secret_iv, 'base64url');
    const authTag = Buffer.from(record.secret_auth_tag, 'base64url');
    const ciphertext = Buffer.from(record.secret_ciphertext, 'base64url');
    if (iv.length !== 12 || authTag.length !== 16 || ciphertext.length === 0) {
      throw new Error('Invalid AES-256-GCM parameters');
    }

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(`shop:${cleanShopId}:v1`, 'utf8'));
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');

    if (!decrypted.trim()) {
      throw new Error('Decrypted secret is empty');
    }
    return decrypted;
  } catch {
    throw new Error(
      'SEPAY_SECRET_DECRYPT_FAILED: Không thể giải mã khóa bí mật SePay của cửa hàng.'
    );
  }
}

const FORBIDDEN_THEME_SECRET_KEYS = new Set([
  'sepaysecret',
  'sepay_secret',
  'webhooksecret',
  'webhook_secret',
  'secret_ciphertext',
  'hmacsecret',
  'hmac_secret',
]);

export function assertNoSePaySecretInThemeConfig(
  themeConfig: unknown
): void {
  if (!themeConfig || typeof themeConfig !== 'object') return;
  const checkObject = (obj: Record<string, unknown>, pathLabel: string) => {
    for (const [key, value] of Object.entries(obj)) {
      if (FORBIDDEN_THEME_SECRET_KEYS.has(key.trim().toLowerCase())) {
        throw new Error(
          `FORBIDDEN_PUBLIC_SEPAY_SECRET: Không được lưu khóa bí mật SePay trong ${pathLabel}.${key}. Vui lòng cấu hình qua mục Đối soát tự động SePay.`
        );
      }
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        checkObject(value as Record<string, unknown>, `${pathLabel}.${key}`);
      }
    }
  };
  checkObject(themeConfig as Record<string, unknown>, 'theme_config');
}

export function buildShopSePayCallbackPath(shopId: string): string {
  return `/api/webhooks/sepay/${encodeURIComponent((shopId || '').trim())}`;
}

export function buildShopSePayCallbackUrl(
  shopId: string,
  baseOrigin?: string | null
): string {
  const pathPart = buildShopSePayCallbackPath(shopId);
  const cleanOrigin = (
    baseOrigin ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    ''
  )
    .trim()
    .replace(/\/+$/, '');
  return cleanOrigin ? `${cleanOrigin}${pathPart}` : pathPart;
}

async function resolveShopRecord(shopId: string): Promise<Shop | undefined> {
  const cleanShopId = (shopId || '').trim();
  if (!cleanShopId) return undefined;
  try {
    const dbShop = await dbGetShopById(cleanShopId);
    if (dbShop) return dbShop;
  } catch {
    // Fallback in non-production when DB is not active
  }
  if (process.env.NODE_ENV !== 'production' && !isSePayDbAuthoritative()) {
    return SEED_SHOPS.find((s) => s.id === cleanShopId);
  }
  return undefined;
}

async function loadRawShopSePayConfig(
  shopId: string,
  dbClient?: SupabaseClient
): Promise<EncryptedSePaySecretRecord | null> {
  const cleanShopId = (shopId || '').trim();
  if (!cleanShopId) return null;

  if (dbClient !== undefined || isSePayDbAuthoritative()) {
    const sb = getActiveSePayDbClient(dbClient);
    const { data, error } = await sb
      .from('shop_sepay_configs')
      .select('*')
      .eq('shop_id', cleanShopId)
      .maybeSingle<EncryptedSePaySecretRecord>();
    if (error) {
      throw new Error(`SEPAY_CONFIG_READ_FAILED: ${error.message}`);
    }
    return data ?? null;
  }

  const store = readLocalSePayStore();
  return store.configs[cleanShopId] ?? null;
}

function toRedactedSePayConfig(
  shopId: string,
  shop: Shop | undefined,
  record: EncryptedSePaySecretRecord | null,
  baseOrigin?: string | null
): RedactedShopSePayConfig {
  const encryptionConfigured = isSePayEncryptionConfigured();
  const hasSecret = Boolean(
    record?.secret_ciphertext && record?.secret_iv && record?.secret_auth_tag
  );
  const savedEnabled = Boolean(record?.enabled);
  const qrInfo = getShopPaymentQrInfo(shop ?? null);
  const recipientAccountNumber = normalizeBankAccountNumber(
    qrInfo.accountNumber
  );
  const recipientAccountConfigured = Boolean(
    qrInfo.mode === 'vietqr_auto' &&
      qrInfo.isConfigured &&
      recipientAccountNumber
  );
  const transferPrefix =
    (shop?.theme_config?.paymentConfig?.transferPrefix || 'QLAOK').trim() ||
    'QLAOK';
  const enabled = Boolean(savedEnabled && hasSecret && encryptionConfigured);

  return {
    shopId,
    enabled,
    savedEnabled,
    hasSecret,
    isConfigured: Boolean(enabled && recipientAccountConfigured),
    encryptionConfigured,
    callbackPath: buildShopSePayCallbackPath(shopId),
    callbackUrl: buildShopSePayCallbackUrl(shopId, baseOrigin),
    recipientAccountConfigured,
    recipientAccountNumber: qrInfo.accountNumber || '',
    recipientBankShortName: qrInfo.isConfigured ? qrInfo.bankShortName : '',
    transferPrefix,
    updatedAt: record?.updated_at ?? null,
    updatedBy: record?.updated_by ?? null,
  };
}

export async function dbGetRedactedShopSePayConfig(
  shopId: string,
  options?: { baseOrigin?: string | null; dbClient?: SupabaseClient }
): Promise<RedactedShopSePayConfig> {
  const cleanShopId = (shopId || '').trim();
  if (!cleanShopId) {
    throw new Error('MISSING_SHOP_ID: Thiếu mã cửa hàng (shopId).');
  }
  const [shop, record] = await Promise.all([
    resolveShopRecord(cleanShopId),
    loadRawShopSePayConfig(cleanShopId, options?.dbClient),
  ]);
  if (!shop) {
    throw new Error('SHOP_NOT_FOUND: Không tìm thấy cửa hàng.');
  }
  return toRedactedSePayConfig(cleanShopId, shop, record, options?.baseOrigin);
}

export async function dbUpsertShopSePayConfig(params: {
  shopId: string;
  secret?: string | null;
  enabled?: boolean;
  updatedBy?: string | null;
  baseOrigin?: string | null;
  dbClient?: SupabaseClient;
}): Promise<RedactedShopSePayConfig> {
  const cleanShopId = (params.shopId || '').trim();
  if (!cleanShopId) {
    throw new Error('MISSING_SHOP_ID: Thiếu mã cửa hàng (shopId).');
  }
  if (!isSePayEncryptionConfigured()) {
    throw new Error(
      'SEPAY_ENCRYPTION_NOT_CONFIGURED: Máy chủ chưa cấu hình SEPAY_SECRET_ENCRYPTION_KEY (tối thiểu 32 ký tự).'
    );
  }

  const shop = await resolveShopRecord(cleanShopId);
  if (!shop) {
    throw new Error('SHOP_NOT_FOUND: Không tìm thấy cửa hàng.');
  }

  const existing = await loadRawShopSePayConfig(cleanShopId, params.dbClient);
  const rawNewSecret =
    typeof params.secret === 'string' ? params.secret.trim() : '';

  let encryptedFields: {
    secret_ciphertext: string;
    secret_iv: string;
    secret_auth_tag: string;
    key_version: number;
  };

  if (rawNewSecret) {
    encryptedFields = encryptSePaySecret(cleanShopId, rawNewSecret);
  } else if (
    existing?.secret_ciphertext &&
    existing?.secret_iv &&
    existing?.secret_auth_tag
  ) {
    // Verify existing secret can still be decrypted with current key before enabling
    decryptSePaySecret(cleanShopId, existing);
    encryptedFields = {
      secret_ciphertext: existing.secret_ciphertext,
      secret_iv: existing.secret_iv,
      secret_auth_tag: existing.secret_auth_tag,
      key_version: existing.key_version || 1,
    };
  } else {
    throw new Error(
      'SEPAY_SECRET_REQUIRED: Vui lòng nhập khóa bí mật (Secret Key) HMAC từ SePay.'
    );
  }

  const nowIso = new Date().toISOString();
  const nextEnabled =
    params.enabled !== undefined
      ? Boolean(params.enabled)
      : existing
        ? existing.enabled
        : true;

  const nextRecord: EncryptedSePaySecretRecord = {
    shop_id: cleanShopId,
    enabled: nextEnabled,
    secret_ciphertext: encryptedFields.secret_ciphertext,
    secret_iv: encryptedFields.secret_iv,
    secret_auth_tag: encryptedFields.secret_auth_tag,
    key_version: encryptedFields.key_version,
    updated_by: params.updatedBy ?? existing?.updated_by ?? null,
    created_at: existing?.created_at ?? nowIso,
    updated_at: nowIso,
  };

  if (params.dbClient !== undefined || isSePayDbAuthoritative()) {
    const sb = getActiveSePayDbClient(params.dbClient);
    const { data, error } = await sb
      .from('shop_sepay_configs')
      .upsert(nextRecord, { onConflict: 'shop_id' })
      .select('*')
      .single<EncryptedSePaySecretRecord>();
    if (error || !data) {
      throw new Error(
        `SEPAY_CONFIG_WRITE_FAILED: ${error?.message || 'Không thể lưu cấu hình SePay.'}`
      );
    }
    return toRedactedSePayConfig(
      cleanShopId,
      shop,
      data,
      params.baseOrigin
    );
  }

  const store = readLocalSePayStore();
  store.configs[cleanShopId] = nextRecord;
  writeLocalSePayStore(store);

  return toRedactedSePayConfig(
    cleanShopId,
    shop,
    nextRecord,
    params.baseOrigin
  );
}

export async function dbDeleteShopSePayConfig(
  shopId: string,
  options?: { baseOrigin?: string | null; dbClient?: SupabaseClient }
): Promise<RedactedShopSePayConfig> {
  const cleanShopId = (shopId || '').trim();
  if (!cleanShopId) {
    throw new Error('MISSING_SHOP_ID: Thiếu mã cửa hàng (shopId).');
  }
  const shop = await resolveShopRecord(cleanShopId);
  if (!shop) {
    throw new Error('SHOP_NOT_FOUND: Không tìm thấy cửa hàng.');
  }

  if (options?.dbClient !== undefined || isSePayDbAuthoritative()) {
    const sb = getActiveSePayDbClient(options?.dbClient);
    const { error } = await sb
      .from('shop_sepay_configs')
      .delete()
      .eq('shop_id', cleanShopId);
    if (error) {
      throw new Error(`SEPAY_CONFIG_DELETE_FAILED: ${error.message}`);
    }
  } else {
    const store = readLocalSePayStore();
    delete store.configs[cleanShopId];
    writeLocalSePayStore(store);
  }

  return toRedactedSePayConfig(cleanShopId, shop, null, options?.baseOrigin);
}

/**
 * Generates an official SePay HMAC-SHA256 signature header value (`sha256=<hex>`)
 * over `{timestamp}.{raw_body}` bytes.
 */
export function signSePayWebhookPayload(
  rawBody: Buffer | Uint8Array | string,
  timestamp: string,
  secret: string
): string {
  const rawBuf = Buffer.isBuffer(rawBody)
    ? rawBody
    : typeof rawBody === 'string'
      ? Buffer.from(rawBody, 'utf8')
      : Buffer.from(rawBody);
  const hmac = crypto.createHmac('sha256', Buffer.from(secret, 'utf8'));
  hmac.update(Buffer.from(`${timestamp}.`, 'utf8'));
  hmac.update(rawBuf);
  return `sha256=${hmac.digest('hex')}`;
}

/**
 * Verifies SePay's official HMAC-SHA256 signature over `{timestamp}.{raw_body}`
 * using constant-time byte comparison before parsing JSON.
 */
export function verifySePayWebhookSignature(params: {
  rawBody: Buffer | Uint8Array | string;
  signatureHeader: string | null | undefined;
  timestampHeader: string | null | undefined;
  secret: string;
}):
  | { valid: true; timestamp: string }
  | {
      valid: false;
      code:
        | 'MISSING_WEBHOOK_TIMESTAMP'
        | 'MISSING_WEBHOOK_SIGNATURE'
        | 'INVALID_WEBHOOK_SIGNATURE';
      reason: string;
    } {
  const timestamp = (params.timestampHeader ?? '').trim();
  if (!timestamp || /[\r\n]/.test(timestamp)) {
    return {
      valid: false,
      code: 'MISSING_WEBHOOK_TIMESTAMP',
      reason: 'Thiếu header X-SePay-Timestamp hợp lệ.',
    };
  }

  const rawSig = (params.signatureHeader ?? '').trim();
  if (!rawSig) {
    return {
      valid: false,
      code: 'MISSING_WEBHOOK_SIGNATURE',
      reason: 'Thiếu header X-SePay-Signature.',
    };
  }

  const sigMatch = /^sha256=([0-9a-fA-F]{64})$/i.exec(rawSig);
  if (!sigMatch || !sigMatch[1] || !params.secret) {
    return {
      valid: false,
      code: 'INVALID_WEBHOOK_SIGNATURE',
      reason: 'Định dạng chữ ký X-SePay-Signature không hợp lệ.',
    };
  }

  const providedDigest = Buffer.from(sigMatch[1].toLowerCase(), 'hex');
  const rawBuf = Buffer.isBuffer(params.rawBody)
    ? params.rawBody
    : typeof params.rawBody === 'string'
      ? Buffer.from(params.rawBody, 'utf8')
      : Buffer.from(params.rawBody);

  const hmac = crypto.createHmac('sha256', Buffer.from(params.secret, 'utf8'));
  hmac.update(Buffer.from(`${timestamp}.`, 'utf8'));
  hmac.update(rawBuf);
  const expectedDigest = hmac.digest();

  if (
    providedDigest.length !== expectedDigest.length ||
    !crypto.timingSafeEqual(providedDigest, expectedDigest)
  ) {
    return {
      valid: false,
      code: 'INVALID_WEBHOOK_SIGNATURE',
      reason: 'Chữ ký HMAC X-SePay-Signature không khớp với nội dung gốc.',
    };
  }

  return { valid: true, timestamp };
}

export function normalizeBankAccountNumber(
  accountNumber: string | null | undefined
): string {
  if (typeof accountNumber !== 'string') return '';
  return accountNumber.replace(/[\s\-_.]/g, '').trim().toUpperCase();
}

function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildFlexibleTokenRegexFragment(raw: string): string {
  const normalized = stripVietnameseAccents(raw);
  const tokens = normalized.split(/[^A-Z0-9]+/).filter(Boolean);
  if (tokens.length === 0) return '';
  return tokens.map((t) => escapeRegex(t)).join('[\\s\\-_.:#]*');
}

function normalizeCandidateOrderCodeToken(rawToken: string): string {
  const cleaned = rawToken
    .trim()
    .toUpperCase()
    .replace(/^[^A-Z0-9#]+|[^A-Z0-9]+$/g, '');
  const ordMatch = /^ORD[\s\-_]*(\d+)$/i.exec(cleaned);
  if (ordMatch && ordMatch[1]) {
    return `ORD-${ordMatch[1]}`;
  }
  return cleaned.replace(/\s+/g, '-');
}

/**
 * Correlates a SePay transfer description (`content` / `code`) to an exact `order_code`
 * in the target shop using the shop's configured `transferPrefix`.
 *
 * Rules:
 * 1. The configured transferPrefix must appear in `content` or `code`.
 * 2. If multiple distinct order code patterns appear in the transfer text, reject as `AMBIGUOUS_ORDER_CODE`.
 * 3. If >1 order in the shop matches the extracted order_code, reject as `AMBIGUOUS_ORDER_CODE`.
 * 4. If 0 orders in the shop match, reject as `ORDER_NOT_FOUND` or `ORDER_CODE_MISSING`.
 */
export function correlateSePayOrderFromTransfer(params: {
  transferPrefix: string;
  content?: string | null;
  code?: string | null;
  shopOrders: readonly ShopOrder[];
}):
  | {
      status: 'matched';
      order: ShopOrder;
      extractedOrderCode: string;
    }
  | {
      status: 'rejected';
      reasonCode:
        | 'ORDER_CODE_MISSING'
        | 'AMBIGUOUS_ORDER_CODE'
        | 'ORDER_NOT_FOUND';
      extractedOrderCode: string | null;
    } {
  const prefixFragment = buildFlexibleTokenRegexFragment(
    params.transferPrefix || 'QLAOK'
  );
  if (!prefixFragment) {
    return {
      status: 'rejected',
      reasonCode: 'ORDER_CODE_MISSING',
      extractedOrderCode: null,
    };
  }

  const candidateTexts = [params.content, params.code]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) =>
      v
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toUpperCase()
    );

  if (candidateTexts.length === 0) {
    return {
      status: 'rejected',
      reasonCode: 'ORDER_CODE_MISSING',
      extractedOrderCode: null,
    };
  }

  const prefixDetectRegex = new RegExp(
    `(?<![A-Z0-9])${prefixFragment}(?![A-Z0-9])`,
    'i'
  );
  const compactPrefix = stripVietnameseAccents(params.transferPrefix || 'QLAOK')
    .replace(/[^A-Z0-9]/g, '')
    .toUpperCase();
  const prefixCompactDetectRegex = compactPrefix
    ? new RegExp(`(?<![A-Z0-9])${escapeRegex(compactPrefix)}`, 'i')
    : prefixDetectRegex;

  const hasConfiguredPrefix = candidateTexts.some(
    (txt) => prefixDetectRegex.test(txt) || prefixCompactDetectRegex.test(txt)
  );
  if (!hasConfiguredPrefix) {
    return {
      status: 'rejected',
      reasonCode: 'ORDER_CODE_MISSING',
      extractedOrderCode: null,
    };
  }

  // Extract explicit ORD-<digits> or #<digits> tokens mentioned in the text
  const explicitOrderCandidates = new Set<string>();
  const prefixOrderRegex = new RegExp(
    `(?<![A-Z0-9])${prefixFragment}[\\s\\-_.:#]*(ORD[\\s\\-_]*\\d+|#\\d+)(?![A-Z0-9])`,
    'gi'
  );
  const standaloneOrdRegex = /(?<![A-Z0-9])(ORD[\s\-_]*\d+)(?![A-Z0-9])/gi;

  for (const txt of candidateTexts) {
    let matchedImmediatelyAfterPrefix = false;
    for (const match of txt.matchAll(prefixOrderRegex)) {
      if (match[1]) {
        matchedImmediatelyAfterPrefix = true;
        explicitOrderCandidates.add(normalizeCandidateOrderCodeToken(match[1]));
      }
    }
    if (matchedImmediatelyAfterPrefix) {
      for (const match of txt.matchAll(standaloneOrdRegex)) {
        if (match[1]) {
          explicitOrderCandidates.add(
            normalizeCandidateOrderCodeToken(match[1])
          );
        }
      }
    }
  }

  if (explicitOrderCandidates.size > 1) {
    return {
      status: 'rejected',
      reasonCode: 'AMBIGUOUS_ORDER_CODE',
      extractedOrderCode: Array.from(explicitOrderCandidates).join(','),
    };
  }

  // Match against the shop's orders
  const matchedOrders: ShopOrder[] = [];
  const matchedCodes = new Set<string>();

  for (const order of params.shopOrders) {
    const rawOrderCode = String(order.order_code || '').trim().toUpperCase();
    if (!rawOrderCode) continue;

    const codeFragment = buildFlexibleTokenRegexFragment(rawOrderCode);
    if (!codeFragment) continue;

    const fullPattern = new RegExp(
      `(?<![A-Z0-9])${prefixFragment}[\\s\\-_.:#]*${codeFragment}(?![A-Z0-9])`,
      'i'
    );

    if (candidateTexts.some((txt) => fullPattern.test(txt))) {
      matchedOrders.push(order);
      matchedCodes.add(rawOrderCode);
    }
  }

  if (matchedCodes.size > 1 || matchedOrders.length > 1) {
    return {
      status: 'rejected',
      reasonCode: 'AMBIGUOUS_ORDER_CODE',
      extractedOrderCode:
        Array.from(matchedCodes)[0] ||
        Array.from(explicitOrderCandidates)[0] ||
        null,
    };
  }

  if (matchedOrders.length === 1 && matchedOrders[0]) {
    const matched = matchedOrders[0];
    if (
      explicitOrderCandidates.size === 1 &&
      !explicitOrderCandidates.has(
        normalizeCandidateOrderCodeToken(matched.order_code)
      )
    ) {
      return {
        status: 'rejected',
        reasonCode: 'AMBIGUOUS_ORDER_CODE',
        extractedOrderCode: Array.from(explicitOrderCandidates)[0] ?? null,
      };
    }

    return {
      status: 'matched',
      order: matched,
      extractedOrderCode: matched.order_code,
    };
  }

  // No shop order matched; check if there was an uncorrelatable token after prefix
  const fallbackTokenRegex = new RegExp(
    `(?<![A-Z0-9])${prefixFragment}[\\s\\-_.:#]+([A-Z0-9#][A-Z0-9\\-_#]{1,31})(?![A-Z0-9])`,
    'i'
  );
  for (const txt of candidateTexts) {
    const m = fallbackTokenRegex.exec(txt);
    if (m && m[1]) {
      const token = normalizeCandidateOrderCodeToken(m[1]);
      if (token && token !== 'THANH' && token !== 'THANH-TOAN') {
        return {
          status: 'rejected',
          reasonCode: 'ORDER_NOT_FOUND',
          extractedOrderCode: token,
        };
      }
    }
  }

  if (explicitOrderCandidates.size === 1) {
    return {
      status: 'rejected',
      reasonCode: 'ORDER_NOT_FOUND',
      extractedOrderCode: Array.from(explicitOrderCandidates)[0] ?? null,
    };
  }

  return {
    status: 'rejected',
    reasonCode: 'ORDER_CODE_MISSING',
    extractedOrderCode: null,
  };
}

export function computeSePayPayloadHash(
  shopId: string,
  payload: SePayWebhookPayload
): string {
  const canonical = JSON.stringify({
    shopId: (shopId || '').trim(),
    id: String(payload.id ?? '').trim(),
    gateway: String(payload.gateway ?? '').trim(),
    transactionDate: String(payload.transactionDate ?? '').trim(),
    accountNumber: normalizeBankAccountNumber(
      typeof payload.accountNumber === 'string'
        ? payload.accountNumber
        : String(payload.accountNumber ?? '')
    ),
    subAccount: normalizeBankAccountNumber(
      typeof payload.subAccount === 'string'
        ? payload.subAccount
        : String(payload.subAccount ?? '')
    ),
    code: String(payload.code ?? '').trim().toUpperCase(),
    content: String(payload.content ?? '').trim(),
    transferType: String(payload.transferType ?? '').trim().toLowerCase(),
    transferAmount: Number(payload.transferAmount ?? 0),
    referenceCode: String(payload.referenceCode ?? '').trim(),
  });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function parseStrictVndAmount(rawAmount: unknown): number | null {
  if (typeof rawAmount === 'number') {
    if (!Number.isFinite(rawAmount) || !Number.isInteger(rawAmount)) return null;
    return rawAmount;
  }
  if (typeof rawAmount === 'string') {
    const trimmed = rawAmount.trim();
    if (!/^-?\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed)) return null;
    return parsed;
  }
  return null;
}

function mapReasonCodeToHttpStatus(
  code: SePayWebhookReasonCode,
  reconciled: boolean,
  duplicate: boolean
): number {
  if (reconciled) return 200;
  if (duplicate && code === 'OK') return 200;
  switch (code) {
    case 'PAYLOAD_TOO_LARGE':
      return 413;
    case 'SEPAY_ENCRYPTION_NOT_CONFIGURED':
    case 'SEPAY_SECRET_DECRYPT_FAILED':
      return 503;
    case 'MISSING_SHOP_ID':
    case 'INVALID_WEBHOOK_PAYLOAD':
      return 400;
    case 'SHOP_NOT_FOUND':
      return 404;
    case 'SEPAY_NOT_CONFIGURED':
    case 'SEPAY_DISABLED':
      return 403;
    case 'MISSING_WEBHOOK_TIMESTAMP':
    case 'MISSING_WEBHOOK_SIGNATURE':
    case 'INVALID_WEBHOOK_SIGNATURE':
      return 401;
    case 'CONFLICTING_WEBHOOK_EVENT':
    case 'CONFLICTING_BANK_REFERENCE':
    case 'AMBIGUOUS_ORDER_CODE':
    case 'ORDER_CANCELLED':
    case 'ORDER_ALREADY_PAID':
      return 409;
    case 'SHOP_BANK_ACCOUNT_NOT_CONFIGURED':
    case 'OUTBOUND_TRANSFER':
    case 'ACCOUNT_NUMBER_MISMATCH':
    case 'ORDER_CODE_MISSING':
    case 'ORDER_NOT_FOUND':
    case 'PAYMENT_METHOD_NOT_VIETQR':
    case 'AMOUNT_MISMATCH':
      return 422;
    default:
      return 400;
  }
}

function describeReasonCode(code: SePayWebhookReasonCode): string {
  switch (code) {
    case 'OK':
      return 'Đã đối soát và xác nhận thanh toán VietQR thành công.';
    case 'DUPLICATE_EVENT_NOOP':
      return 'Sự kiện webhook trùng lặp đã được xử lý trước đó (idempotent no-op).';
    case 'PAYLOAD_TOO_LARGE':
      return 'Kích thước dữ liệu webhook vượt quá giới hạn cho phép (tối đa 64 KiB).';
    case 'SEPAY_ENCRYPTION_NOT_CONFIGURED':
      return 'Máy chủ chưa cấu hình khóa mã hóa SEPAY_SECRET_ENCRYPTION_KEY.';
    case 'MISSING_SHOP_ID':
      return 'Thiếu mã cửa hàng (shopId) trong đường dẫn webhook.';
    case 'SHOP_NOT_FOUND':
      return 'Không tìm thấy cửa hàng đích.';
    case 'SEPAY_NOT_CONFIGURED':
      return 'Cửa hàng chưa cấu hình tích hợp webhook SePay.';
    case 'SEPAY_DISABLED':
      return 'Tích hợp webhook SePay của cửa hàng đang tạm tắt.';
    case 'SEPAY_SECRET_DECRYPT_FAILED':
      return 'Không thể giải mã khóa bí mật SePay của cửa hàng.';
    case 'SHOP_BANK_ACCOUNT_NOT_CONFIGURED':
      return 'Cửa hàng chưa cấu hình số tài khoản ngân hàng nhận VietQR tự động.';
    case 'MISSING_WEBHOOK_TIMESTAMP':
      return 'Thiếu hoặc sai định dạng header X-SePay-Timestamp.';
    case 'MISSING_WEBHOOK_SIGNATURE':
      return 'Thiếu header chữ ký X-SePay-Signature.';
    case 'INVALID_WEBHOOK_SIGNATURE':
      return 'Chữ ký HMAC X-SePay-Signature không hợp lệ.';
    case 'INVALID_WEBHOOK_PAYLOAD':
      return 'Payload JSON của webhook SePay không hợp lệ hoặc thiếu trường bắt buộc.';
    case 'CONFLICTING_WEBHOOK_EVENT':
      return 'Xung đột dữ liệu: mã sự kiện SePay (id) đã được dùng với nội dung giao dịch khác hoặc đã gạch nợ ở cửa hàng khác.';
    case 'CONFLICTING_BANK_REFERENCE':
      return 'Xung đột dữ liệu: mã tham chiếu ngân hàng (referenceCode) đã được dùng cho giao dịch khác.';
    case 'OUTBOUND_TRANSFER':
      return 'Bỏ qua giao dịch chuyển tiền ra (transferType !== "in").';
    case 'ACCOUNT_NUMBER_MISMATCH':
      return 'Số tài khoản nhận không khớp với tài khoản VietQR đã cấu hình của cửa hàng.';
    case 'ORDER_CODE_MISSING':
      return 'Nội dung chuyển khoản không chứa cú pháp tiền tố và mã đơn hàng của cửa hàng.';
    case 'AMBIGUOUS_ORDER_CODE':
      return 'Nội dung chuyển khoản chứa nhiều mã đơn hoặc khớp nhiều hơn một đơn hàng (bao gồm trùng mã đơn giữa các cửa hàng dùng chung tài khoản nhận).';
    case 'ORDER_NOT_FOUND':
      return 'Không tìm thấy đơn hàng khớp với mã đơn trong nội dung chuyển khoản.';
    case 'ORDER_CANCELLED':
      return 'Đơn hàng đã hủy, không thể tự động gạch nợ.';
    case 'PAYMENT_METHOD_NOT_VIETQR':
      return 'Đơn hàng không sử dụng phương thức thanh toán VietQR.';
    case 'ORDER_ALREADY_PAID':
      return 'Đơn hàng đã được thanh toán hoặc hoàn tiền trước đó.';
    case 'AMOUNT_MISMATCH':
      return 'Số tiền chuyển khoản không khớp chính xác với tổng tiền đơn hàng (VND).';
  }
}

export const SEPAY_SHOP_DISCOVERY_PAGE_SIZE = 1000;
export const SEPAY_SHOP_DISCOVERY_MAX_PAGES = 100;

export async function listOtherCandidateShopsOnSameAccount(params: {
  currentShopId: string;
  expectedAccountNumber: string;
  dbClient?: SupabaseClient;
}): Promise<Shop[]> {
  const { currentShopId, expectedAccountNumber, dbClient } = params;
  if (!expectedAccountNumber) return [];

  const shopById = new Map<string, Shop>();
  const dbAuthoritative =
    dbClient !== undefined || isSePayDbAuthoritative();

  if (dbAuthoritative) {
    const sb = getActiveSePayDbClient(dbClient);
    let exhausted = false;

    for (let page = 0; page < SEPAY_SHOP_DISCOVERY_MAX_PAGES; page++) {
      const from = page * SEPAY_SHOP_DISCOVERY_PAGE_SIZE;
      const to = from + SEPAY_SHOP_DISCOVERY_PAGE_SIZE - 1;
      let query = sb
        .from('shops')
        .select('*')
        .neq('id', currentShopId);

      const orderFn = (
        query as unknown as {
          order?: (
            column: string,
            options?: { ascending?: boolean }
          ) => typeof query;
        }
      ).order;
      if (typeof orderFn === 'function') {
        query = orderFn.call(query, 'id', { ascending: true });
      }

      const rangeFn = (
        query as unknown as {
          range?: (start: number, end: number) => typeof query;
        }
      ).range;
      const supportsRange = typeof rangeFn === 'function';
      if (supportsRange) {
        query = rangeFn.call(query, from, to);
      }

      const { data, error } = await query;
      if (error || !Array.isArray(data)) {
        throw new Error(
          `SEPAY_SHOP_DISCOVERY_FAILED: ${error?.message || 'Không thể truy vấn danh sách cửa hàng để kiểm tra trùng tài khoản nhận.'}`
        );
      }

      for (const row of data as Shop[]) {
        if (row && row.id && row.id !== currentShopId) {
          shopById.set(row.id, row);
        }
      }

      if (data.length < SEPAY_SHOP_DISCOVERY_PAGE_SIZE) {
        exhausted = true;
        break;
      }

      if (!supportsRange) {
        throw new Error(
          'SEPAY_SHOP_DISCOVERY_PAGINATION_UNSUPPORTED: Truy vấn cửa hàng đạt giới hạn trang nhưng client không hỗ trợ phân trang .range().'
        );
      }
    }

    if (!exhausted) {
      throw new Error(
        `SEPAY_SHOP_DISCOVERY_PAGE_CAP_EXCEEDED: Số lượng cửa hàng vượt quá giới hạn phân trang an toàn (${SEPAY_SHOP_DISCOVERY_MAX_PAGES} trang).`
      );
    }
  } else if (process.env.NODE_ENV !== 'production') {
    for (const seedShop of SEED_SHOPS) {
      if (seedShop.id !== currentShopId && !shopById.has(seedShop.id)) {
        const resolved = (await resolveShopRecord(seedShop.id)) ?? seedShop;
        shopById.set(resolved.id, resolved);
      }
    }
  }

  const matchingAccountShops: Shop[] = [];
  for (const candidate of shopById.values()) {
    const qr = getShopPaymentQrInfo(candidate);
    const candidateAcct = normalizeBankAccountNumber(qr.accountNumber);
    if (
      qr.mode === 'vietqr_auto' &&
      qr.isConfigured &&
      candidateAcct &&
      candidateAcct === expectedAccountNumber
    ) {
      matchingAccountShops.push(candidate);
    }
  }
  return matchingAccountShops;
}

export async function hasCrossShopOrderCollisionOnSameAccount(params: {
  currentShopId: string;
  expectedAccountNumber: string;
  content?: string | null;
  code?: string | null;
  dbClient?: SupabaseClient;
}): Promise<boolean> {
  const otherShops = await listOtherCandidateShopsOnSameAccount({
    currentShopId: params.currentShopId,
    expectedAccountNumber: params.expectedAccountNumber,
    dbClient: params.dbClient,
  });
  if (otherShops.length === 0) return false;

  for (const otherShop of otherShops) {
    const otherPrefix =
      (
        otherShop.theme_config?.paymentConfig?.transferPrefix || 'QLAOK'
      ).trim() || 'QLAOK';
    const otherOrders = (
      await dbGetShopOrdersForReconciliation(otherShop.id, params.dbClient)
    ).filter(
      (o) => o.status !== 'cancelled' && o.payment_method === 'vietqr'
    );
    if (otherOrders.length === 0) continue;

    const otherCorrelation = correlateSePayOrderFromTransfer({
      transferPrefix: otherPrefix,
      content: params.content,
      code: params.code,
      shopOrders: otherOrders,
    });
    if (
      otherCorrelation.status === 'matched' ||
      otherCorrelation.reasonCode === 'AMBIGUOUS_ORDER_CODE'
    ) {
      return true;
    }
  }
  return false;
}

export async function dbGetShopSePayWebhookEvents(
  shopId: string,
  options?: { dbClient?: SupabaseClient; limit?: number }
): Promise<SePayWebhookEventRecord[]> {
  const cleanShopId = (shopId || '').trim();
  if (!cleanShopId) return [];
  const limit = Math.max(1, Math.min(200, options?.limit ?? 50));

  if (options?.dbClient !== undefined || isSePayDbAuthoritative()) {
    const sb = getActiveSePayDbClient(options?.dbClient);
    const { data, error } = await sb
      .from('sepay_webhook_events')
      .select('*')
      .eq('shop_id', cleanShopId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      throw new Error(`SEPAY_EVENTS_READ_FAILED: ${error.message}`);
    }
    return (data ?? []) as SePayWebhookEventRecord[];
  }

  const store = readLocalSePayStore();
  return Object.values(store.events)
    .filter((evt) => evt.shop_id === cleanShopId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
}

/**
 * Processes an incoming SePay webhook request for a specific `shopId`:
 * 1. Verifies server encryption key, shop existence, and per-shop SePay config.
 * 2. Verifies HMAC-SHA256 signature over `{timestamp}.{raw_body}` before parsing JSON.
 * 3. Enforces idempotent transaction ledger (`(shop_id, sepay_transaction_id)`),
 *    detecting identical replays vs conflicting reuse.
 * 4. Validates inbound transfer (`transferType === 'in'`), recipient bank account match,
 *    exact single `order_code` match with configured `transferPrefix`, `payment_method === 'vietqr'`,
 *    `payment_status === 'unpaid'`, `status !== 'cancelled'`, and exact VND `transferAmount === total_amount`.
 * 5. Atomically marks `payment_status = 'paid'` and persists transaction/reference metadata
 *    without altering fulfillment `status`, totals, or inventory.
 */
export async function processSePayShopWebhook(params: {
  shopId: string;
  rawBody: Buffer | Uint8Array | string;
  signatureHeader: string | null | undefined;
  timestampHeader: string | null | undefined;
  dbClient?: SupabaseClient;
}): Promise<SePayWebhookProcessResult> {
  const cleanShopId = (params.shopId || '').trim();
  if (!cleanShopId) {
    return {
      httpStatus: 400,
      success: false,
      reconciled: false,
      duplicate: false,
      code: 'MISSING_SHOP_ID',
      message: describeReasonCode('MISSING_SHOP_ID'),
      shopId: '',
    };
  }

  const rawBodyBytes = Buffer.isBuffer(params.rawBody)
    ? params.rawBody
    : typeof params.rawBody === 'string'
      ? Buffer.from(params.rawBody, 'utf8')
      : Buffer.from(params.rawBody);

  if (rawBodyBytes.byteLength > SEPAY_MAX_WEBHOOK_BODY_BYTES) {
    return {
      httpStatus: 413,
      success: false,
      reconciled: false,
      duplicate: false,
      code: 'PAYLOAD_TOO_LARGE',
      message: describeReasonCode('PAYLOAD_TOO_LARGE'),
      shopId: cleanShopId,
    };
  }

  if (!isSePayEncryptionConfigured()) {
    return {
      httpStatus: 503,
      success: false,
      reconciled: false,
      duplicate: false,
      code: 'SEPAY_ENCRYPTION_NOT_CONFIGURED',
      message: describeReasonCode('SEPAY_ENCRYPTION_NOT_CONFIGURED'),
      shopId: cleanShopId,
    };
  }

  const shop = await resolveShopRecord(cleanShopId);
  if (!shop) {
    return {
      httpStatus: 404,
      success: false,
      reconciled: false,
      duplicate: false,
      code: 'SHOP_NOT_FOUND',
      message: describeReasonCode('SHOP_NOT_FOUND'),
      shopId: cleanShopId,
    };
  }

  const sepayConfig = await loadRawShopSePayConfig(
    cleanShopId,
    params.dbClient
  );
  if (!sepayConfig) {
    return {
      httpStatus: 403,
      success: false,
      reconciled: false,
      duplicate: false,
      code: 'SEPAY_NOT_CONFIGURED',
      message: describeReasonCode('SEPAY_NOT_CONFIGURED'),
      shopId: cleanShopId,
    };
  }

  if (!sepayConfig.enabled) {
    return {
      httpStatus: 403,
      success: false,
      reconciled: false,
      duplicate: false,
      code: 'SEPAY_DISABLED',
      message: describeReasonCode('SEPAY_DISABLED'),
      shopId: cleanShopId,
    };
  }

  let decryptedSecret: string;
  try {
    decryptedSecret = decryptSePaySecret(cleanShopId, sepayConfig);
  } catch {
    return {
      httpStatus: 503,
      success: false,
      reconciled: false,
      duplicate: false,
      code: 'SEPAY_SECRET_DECRYPT_FAILED',
      message: describeReasonCode('SEPAY_SECRET_DECRYPT_FAILED'),
      shopId: cleanShopId,
    };
  }

  // Authenticate HMAC over exact raw body bytes BEFORE parsing JSON
  const sigVerification = verifySePayWebhookSignature({
    rawBody: rawBodyBytes,
    signatureHeader: params.signatureHeader,
    timestampHeader: params.timestampHeader,
    secret: decryptedSecret,
  });

  if (!sigVerification.valid) {
    return {
      httpStatus: 401,
      success: false,
      reconciled: false,
      duplicate: false,
      code: sigVerification.code,
      message: sigVerification.reason,
      shopId: cleanShopId,
    };
  }

  const rawText = rawBodyBytes.toString('utf8');

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawText);
  } catch {
    return {
      httpStatus: 400,
      success: false,
      reconciled: false,
      duplicate: false,
      code: 'INVALID_WEBHOOK_PAYLOAD',
      message: describeReasonCode('INVALID_WEBHOOK_PAYLOAD'),
      shopId: cleanShopId,
    };
  }

  if (
    !parsedBody ||
    typeof parsedBody !== 'object' ||
    Array.isArray(parsedBody)
  ) {
    return {
      httpStatus: 400,
      success: false,
      reconciled: false,
      duplicate: false,
      code: 'INVALID_WEBHOOK_PAYLOAD',
      message: describeReasonCode('INVALID_WEBHOOK_PAYLOAD'),
      shopId: cleanShopId,
    };
  }

  const payload = parsedBody as SePayWebhookPayload;
  const rawTxId = payload.id;
  const sepayTransactionId =
    typeof rawTxId === 'number' && Number.isFinite(rawTxId) && rawTxId > 0
      ? String(Math.trunc(rawTxId))
      : typeof rawTxId === 'string' && rawTxId.trim().length > 0
        ? rawTxId.trim()
        : '';

  const parsedTransferAmount = parseStrictVndAmount(payload.transferAmount);
  const rawTransferType =
    typeof payload.transferType === 'string'
      ? payload.transferType.trim().toLowerCase()
      : '';

  if (
    !sepayTransactionId ||
    parsedTransferAmount === null ||
    !rawTransferType
  ) {
    return {
      httpStatus: 400,
      success: false,
      reconciled: false,
      duplicate: false,
      code: 'INVALID_WEBHOOK_PAYLOAD',
      message: describeReasonCode('INVALID_WEBHOOK_PAYLOAD'),
      shopId: cleanShopId,
    };
  }

  const providedAccountNumber = normalizeBankAccountNumber(
    typeof payload.accountNumber === 'string'
      ? payload.accountNumber
      : String(payload.accountNumber ?? '')
  );
  const referenceCode =
    typeof payload.referenceCode === 'string' && payload.referenceCode.trim()
      ? payload.referenceCode.trim()
      : null;

  const payloadHash = computeSePayPayloadHash(cleanShopId, {
    ...payload,
    id: sepayTransactionId,
    transferAmount: parsedTransferAmount,
    transferType: rawTransferType,
  });

  // Serialize reconciliation per process so concurrent deliveries cannot race
  return withOrderInventoryLock(async () => {
    const currentShop = (await resolveShopRecord(cleanShopId)) ?? shop;
    const qrInfo = getShopPaymentQrInfo(currentShop);
    const expectedAccountNumber = normalizeBankAccountNumber(
      qrInfo.accountNumber
    );
    const transferPrefix =
      (
        currentShop.theme_config?.paymentConfig?.transferPrefix || 'QLAOK'
      ).trim() || 'QLAOK';

    let precheckReasonCode: SePayWebhookReasonCode | null = null;
    let extractedOrderCode: string | null = null;
    let targetOrder: ShopOrder | null = null;

    if (
      qrInfo.mode !== 'vietqr_auto' ||
      !qrInfo.isConfigured ||
      !expectedAccountNumber
    ) {
      precheckReasonCode = 'SHOP_BANK_ACCOUNT_NOT_CONFIGURED';
    } else if (rawTransferType !== 'in') {
      precheckReasonCode = 'OUTBOUND_TRANSFER';
    } else if (
      !providedAccountNumber ||
      providedAccountNumber !== expectedAccountNumber
    ) {
      precheckReasonCode = 'ACCOUNT_NUMBER_MISMATCH';
    } else {
      const shopOrders = await dbGetShopOrdersForReconciliation(
        cleanShopId,
        params.dbClient
      );
      const correlation = correlateSePayOrderFromTransfer({
        transferPrefix,
        content: payload.content,
        code: payload.code,
        shopOrders,
      });

      extractedOrderCode = correlation.extractedOrderCode;
      if (correlation.status === 'rejected') {
        precheckReasonCode = correlation.reasonCode;
      } else {
        const hasCrossShopCollision =
          await hasCrossShopOrderCollisionOnSameAccount({
            currentShopId: cleanShopId,
            expectedAccountNumber,
            content: payload.content,
            code: payload.code,
            dbClient: params.dbClient,
          });
        if (hasCrossShopCollision) {
          precheckReasonCode = 'AMBIGUOUS_ORDER_CODE';
        } else {
          targetOrder = correlation.order;
        }
      }
    }

    const nowIso = new Date().toISOString();

    if (params.dbClient !== undefined || isSePayDbAuthoritative()) {
      const sb = getActiveSePayDbClient(params.dbClient);
      const { data: rpcRaw, error: rpcError } = await sb.rpc(
        'reconcile_sepay_order_payment_atomic',
        {
          p_shop_id: cleanShopId,
          p_sepay_transaction_id: sepayTransactionId,
          p_payload_hash: payloadHash,
          p_transfer_type:
            rawTransferType === 'in' || rawTransferType === 'out'
              ? rawTransferType
              : 'unknown',
          p_transfer_amount: parsedTransferAmount,
          p_account_number: providedAccountNumber || null,
          p_reference_code: referenceCode,
          p_extracted_order_code: extractedOrderCode,
          p_target_order_id: targetOrder?.id ?? null,
          p_precheck_reason_code: precheckReasonCode,
          p_raw_payload: parsedBody as Record<string, unknown>,
          p_now: nowIso,
        }
      );

      if (rpcError || !rpcRaw) {
        throw new Error(
          `SEPAY_RECONCILE_RPC_FAILED: ${rpcError?.message || 'Không thể thực thi đối soát nguyên tử.'}`
        );
      }

      const rpcResult = (
        typeof rpcRaw === 'string' ? JSON.parse(rpcRaw) : rpcRaw
      ) as {
        outcome: 'reconciled' | 'rejected' | 'conflict';
        reconciled: boolean;
        duplicate: boolean;
        reason_code: SePayWebhookReasonCode;
        order_id?: string | null;
        order?: Partial<ShopOrder> | null;
      };

      const reconciled = Boolean(rpcResult.reconciled);
      const duplicate = Boolean(rpcResult.duplicate);
      const code: SePayWebhookReasonCode =
        duplicate && reconciled
          ? 'DUPLICATE_EVENT_NOOP'
          : (rpcResult.reason_code as SePayWebhookReasonCode);
      const normalizedOrder = rpcResult.order
        ? normalizeOrderRecord(rpcResult.order)
        : rpcResult.order_id
          ? await dbGetOrderById(rpcResult.order_id)
          : null;

      if (reconciled && !duplicate && normalizedOrder) {
        recordOrderAuditLog({
          shopId: cleanShopId,
          orderId: normalizedOrder.id,
          actorId: normalizedOrder.paid_by || `sepay:${sepayTransactionId}`,
          actorRole: 'webhook',
          action: 'sepay_webhook_reconcile',
          before: {
            status: normalizedOrder.status,
            payment_status: 'unpaid',
            payment_method: normalizedOrder.payment_method,
            total_amount: normalizedOrder.total_amount,
          },
          after: {
            status: normalizedOrder.status,
            payment_status: normalizedOrder.payment_status,
            payment_method: normalizedOrder.payment_method,
            total_amount: normalizedOrder.total_amount,
            payment_idempotency_key: normalizedOrder.payment_idempotency_key,
            paid_by: normalizedOrder.paid_by,
          },
          details: {
            sepay_transaction_id: sepayTransactionId,
            reference_code: referenceCode,
            transfer_amount: parsedTransferAmount,
            account_number: providedAccountNumber,
          },
        });
        getOrderEventsBroker().notifyOrderChange(
          cleanShopId,
          normalizedOrder.id
        );
      }

      const httpStatus = mapReasonCodeToHttpStatus(
        rpcResult.reason_code,
        reconciled,
        duplicate
      );
      return {
        httpStatus,
        success: httpStatus === 200,
        reconciled,
        duplicate,
        code,
        message: describeReasonCode(code),
        shopId: cleanShopId,
        sepayTransactionId,
        referenceCode,
        extractedOrderCode,
        orderId: normalizedOrder?.id ?? rpcResult.order_id ?? null,
        orderCode: normalizedOrder?.order_code ?? extractedOrderCode ?? null,
        order: normalizedOrder,
      };
    }

    // Local store execution (isolated unit/review tests when DB mode is off)
    const store = readLocalSePayStore();
    const eventKey = `${cleanShopId}:${sepayTransactionId}`;
    const existingEvt = store.events[eventKey];

    if (existingEvt) {
      if (existingEvt.payload_hash !== payloadHash) {
        existingEvt.conflict_count = (existingEvt.conflict_count || 0) + 1;
        existingEvt.last_conflict_hash = payloadHash;
        existingEvt.last_conflict_at = nowIso;
        existingEvt.updated_at = nowIso;
        store.events[eventKey] = existingEvt;
        writeLocalSePayStore(store);

        return {
          httpStatus: 409,
          success: false,
          reconciled: false,
          duplicate: false,
          code: 'CONFLICTING_WEBHOOK_EVENT',
          message: describeReasonCode('CONFLICTING_WEBHOOK_EVENT'),
          shopId: cleanShopId,
          sepayTransactionId,
          referenceCode,
          extractedOrderCode,
          orderId: existingEvt.order_id,
        };
      }

      // Only already-reconciled events short-circuit as duplicate no-ops.
      // Previously rejected/conflict events with an identical payload_hash are re-evaluated below.
      if (existingEvt.outcome === 'reconciled') {
        existingEvt.delivery_count = (existingEvt.delivery_count || 1) + 1;
        existingEvt.updated_at = nowIso;
        store.events[eventKey] = existingEvt;
        writeLocalSePayStore(store);

        const existingOrder = existingEvt.order_id
          ? await dbGetOrderById(existingEvt.order_id)
          : null;

        return {
          httpStatus: 200,
          success: true,
          reconciled: true,
          duplicate: true,
          code: 'DUPLICATE_EVENT_NOOP',
          message: describeReasonCode('DUPLICATE_EVENT_NOOP'),
          shopId: cleanShopId,
          sepayTransactionId,
          referenceCode,
          extractedOrderCode: existingEvt.extracted_order_code,
          orderId: existingEvt.order_id,
          orderCode:
            existingOrder?.order_code ?? existingEvt.extracted_order_code,
          order: existingOrder,
        };
      }
    }

    const nextDeliveryCount = existingEvt
      ? (existingEvt.delivery_count || 1) + 1
      : 1;
    const prevConflictCount = existingEvt?.conflict_count || 0;
    const createdAtIso = existingEvt?.created_at || nowIso;
    const recordId =
      existingEvt?.id || `sepay-evt-${crypto.randomUUID().slice(0, 12)}`;

    // Guard against cross-shop fan-out where another shop already reconciled this same SePay transaction ID
    const crossShopReconciledTx = Object.values(store.events).find(
      (evt) =>
        evt.shop_id !== cleanShopId &&
        evt.outcome === 'reconciled' &&
        evt.sepay_transaction_id === sepayTransactionId
    );
    if (crossShopReconciledTx) {
      const conflictEvt: SePayWebhookEventRecord = {
        id: recordId,
        shop_id: cleanShopId,
        sepay_transaction_id: sepayTransactionId,
        payload_hash: payloadHash,
        reference_code: referenceCode,
        transfer_type:
          rawTransferType === 'in' || rawTransferType === 'out'
            ? rawTransferType
            : 'unknown',
        transfer_amount: parsedTransferAmount,
        account_number: providedAccountNumber || null,
        extracted_order_code: extractedOrderCode,
        order_id: null,
        outcome: 'conflict',
        reason_code: 'CONFLICTING_WEBHOOK_EVENT',
        delivery_count: nextDeliveryCount,
        conflict_count: prevConflictCount + 1,
        last_conflict_hash: payloadHash,
        last_conflict_at: nowIso,
        raw_payload: parsedBody as Record<string, unknown>,
        created_at: createdAtIso,
        updated_at: nowIso,
      };
      store.events[eventKey] = conflictEvt;
      writeLocalSePayStore(store);

      return {
        httpStatus: 409,
        success: false,
        reconciled: false,
        duplicate: false,
        code: 'CONFLICTING_WEBHOOK_EVENT',
        message: describeReasonCode('CONFLICTING_WEBHOOK_EVENT'),
        shopId: cleanShopId,
        sepayTransactionId,
        referenceCode,
        extractedOrderCode,
      };
    }

    if (precheckReasonCode) {
      const rejectedEvt: SePayWebhookEventRecord = {
        id: recordId,
        shop_id: cleanShopId,
        sepay_transaction_id: sepayTransactionId,
        payload_hash: payloadHash,
        reference_code: referenceCode,
        transfer_type:
          rawTransferType === 'in' || rawTransferType === 'out'
            ? rawTransferType
            : 'unknown',
        transfer_amount: parsedTransferAmount,
        account_number: providedAccountNumber || null,
        extracted_order_code: extractedOrderCode,
        order_id: targetOrder?.id ?? null,
        outcome: 'rejected',
        reason_code: precheckReasonCode,
        delivery_count: nextDeliveryCount,
        conflict_count: prevConflictCount,
        last_conflict_hash: existingEvt?.last_conflict_hash ?? null,
        last_conflict_at: existingEvt?.last_conflict_at ?? null,
        raw_payload: parsedBody as Record<string, unknown>,
        created_at: createdAtIso,
        updated_at: nowIso,
      };
      store.events[eventKey] = rejectedEvt;
      writeLocalSePayStore(store);

      return {
        httpStatus: mapReasonCodeToHttpStatus(precheckReasonCode, false, false),
        success: false,
        reconciled: false,
        duplicate: false,
        code: precheckReasonCode,
        message: describeReasonCode(precheckReasonCode),
        shopId: cleanShopId,
        sepayTransactionId,
        referenceCode,
        extractedOrderCode,
        orderId: targetOrder?.id ?? null,
      };
    }

    // Check bank referenceCode conflict across different transaction IDs or across shops
    if (referenceCode) {
      const refConflict = Object.values(store.events).find(
        (evt) =>
          evt.outcome === 'reconciled' &&
          evt.reference_code === referenceCode &&
          (evt.shop_id !== cleanShopId ||
            evt.sepay_transaction_id !== sepayTransactionId)
      );
      if (refConflict) {
        const conflictEvt: SePayWebhookEventRecord = {
          id: recordId,
          shop_id: cleanShopId,
          sepay_transaction_id: sepayTransactionId,
          payload_hash: payloadHash,
          reference_code: referenceCode,
          transfer_type: 'in',
          transfer_amount: parsedTransferAmount,
          account_number: providedAccountNumber || null,
          extracted_order_code: extractedOrderCode,
          order_id: null,
          outcome: 'conflict',
          reason_code: 'CONFLICTING_BANK_REFERENCE',
          delivery_count: nextDeliveryCount,
          conflict_count: prevConflictCount + 1,
          last_conflict_hash: payloadHash,
          last_conflict_at: nowIso,
          raw_payload: parsedBody as Record<string, unknown>,
          created_at: createdAtIso,
          updated_at: nowIso,
        };
        store.events[eventKey] = conflictEvt;
        writeLocalSePayStore(store);

        return {
          httpStatus: 409,
          success: false,
          reconciled: false,
          duplicate: false,
          code: 'CONFLICTING_BANK_REFERENCE',
          message: describeReasonCode('CONFLICTING_BANK_REFERENCE'),
          shopId: cleanShopId,
          sepayTransactionId,
          referenceCode,
          extractedOrderCode,
        };
      }
    }

    if (!targetOrder) {
      const notFoundEvt: SePayWebhookEventRecord = {
        id: recordId,
        shop_id: cleanShopId,
        sepay_transaction_id: sepayTransactionId,
        payload_hash: payloadHash,
        reference_code: referenceCode,
        transfer_type: 'in',
        transfer_amount: parsedTransferAmount,
        account_number: providedAccountNumber || null,
        extracted_order_code: extractedOrderCode,
        order_id: null,
        outcome: 'rejected',
        reason_code: 'ORDER_NOT_FOUND',
        delivery_count: nextDeliveryCount,
        conflict_count: prevConflictCount,
        last_conflict_hash: existingEvt?.last_conflict_hash ?? null,
        last_conflict_at: existingEvt?.last_conflict_at ?? null,
        raw_payload: parsedBody as Record<string, unknown>,
        created_at: createdAtIso,
        updated_at: nowIso,
      };
      store.events[eventKey] = notFoundEvt;
      writeLocalSePayStore(store);

      return {
        httpStatus: 422,
        success: false,
        reconciled: false,
        duplicate: false,
        code: 'ORDER_NOT_FOUND',
        message: describeReasonCode('ORDER_NOT_FOUND'),
        shopId: cleanShopId,
        sepayTransactionId,
        referenceCode,
        extractedOrderCode,
      };
    }

    const paymentIdempotencyKey = `sepay:${cleanShopId}:${sepayTransactionId}`;
    const paidBy = referenceCode
      ? `sepay:${sepayTransactionId}:${referenceCode}`
      : `sepay:${sepayTransactionId}`;

    const applyResult = await dbMarkOrderPaidViaSePayInStore({
      shopId: cleanShopId,
      orderId: targetOrder.id,
      expectedAmount: parsedTransferAmount,
      paymentIdempotencyKey,
      paidBy,
      nowIso,
    });

    if (!applyResult.ok) {
      const rejectCode = applyResult.reasonCode;
      const isConflict = rejectCode === 'CONFLICTING_BANK_REFERENCE';
      const rejectedEvt: SePayWebhookEventRecord = {
        id: recordId,
        shop_id: cleanShopId,
        sepay_transaction_id: sepayTransactionId,
        payload_hash: payloadHash,
        reference_code: referenceCode,
        transfer_type: 'in',
        transfer_amount: parsedTransferAmount,
        account_number: providedAccountNumber || null,
        extracted_order_code: extractedOrderCode,
        order_id: applyResult.order?.id ?? targetOrder.id,
        outcome: isConflict ? 'conflict' : 'rejected',
        reason_code: rejectCode,
        delivery_count: nextDeliveryCount,
        conflict_count: isConflict ? prevConflictCount + 1 : prevConflictCount,
        last_conflict_hash: isConflict
          ? payloadHash
          : (existingEvt?.last_conflict_hash ?? null),
        last_conflict_at: isConflict
          ? nowIso
          : (existingEvt?.last_conflict_at ?? null),
        raw_payload: parsedBody as Record<string, unknown>,
        created_at: createdAtIso,
        updated_at: nowIso,
      };
      store.events[eventKey] = rejectedEvt;
      writeLocalSePayStore(store);

      return {
        httpStatus: mapReasonCodeToHttpStatus(rejectCode, false, false),
        success: false,
        reconciled: false,
        duplicate: false,
        code: rejectCode,
        message: describeReasonCode(rejectCode),
        shopId: cleanShopId,
        sepayTransactionId,
        referenceCode,
        extractedOrderCode,
        orderId: applyResult.order?.id ?? targetOrder.id,
        orderCode: applyResult.order?.order_code ?? targetOrder.order_code,
        order: applyResult.order ?? null,
      };
    }

    const updatedOrder = applyResult.order;
    const reconciledEvt: SePayWebhookEventRecord = {
      id: recordId,
      shop_id: cleanShopId,
      sepay_transaction_id: sepayTransactionId,
      payload_hash: payloadHash,
      reference_code: referenceCode,
      transfer_type: 'in',
      transfer_amount: parsedTransferAmount,
      account_number: providedAccountNumber || null,
      extracted_order_code: extractedOrderCode,
      order_id: updatedOrder.id,
      outcome: 'reconciled',
      reason_code: 'OK',
      delivery_count: nextDeliveryCount,
      conflict_count: prevConflictCount,
      last_conflict_hash: existingEvt?.last_conflict_hash ?? null,
      last_conflict_at: existingEvt?.last_conflict_at ?? null,
      raw_payload: parsedBody as Record<string, unknown>,
      created_at: createdAtIso,
      updated_at: nowIso,
    };
    store.events[eventKey] = reconciledEvt;
    writeLocalSePayStore(store);

    recordOrderAuditLog({
      shopId: cleanShopId,
      orderId: updatedOrder.id,
      actorId: paidBy,
      actorRole: 'webhook',
      action: 'sepay_webhook_reconcile',
      before: {
        status: applyResult.previousStatus,
        payment_status: 'unpaid',
        payment_method: updatedOrder.payment_method,
        total_amount: updatedOrder.total_amount,
      },
      after: {
        status: updatedOrder.status,
        payment_status: updatedOrder.payment_status,
        payment_method: updatedOrder.payment_method,
        total_amount: updatedOrder.total_amount,
        payment_idempotency_key: updatedOrder.payment_idempotency_key,
        paid_by: updatedOrder.paid_by,
      },
      details: {
        sepay_transaction_id: sepayTransactionId,
        reference_code: referenceCode,
        transfer_amount: parsedTransferAmount,
        account_number: providedAccountNumber,
      },
    });

    getOrderEventsBroker().notifyOrderChange(cleanShopId, updatedOrder.id);

    return {
      httpStatus: 200,
      success: true,
      reconciled: true,
      duplicate: false,
      code: 'OK',
      message: describeReasonCode('OK'),
      shopId: cleanShopId,
      sepayTransactionId,
      referenceCode,
      extractedOrderCode,
      orderId: updatedOrder.id,
      orderCode: updatedOrder.order_code,
      order: updatedOrder,
    };
  });
}

export async function readBoundedWebhookRawBody(
  req: Request,
  maxBytes = SEPAY_MAX_WEBHOOK_BODY_BYTES
): Promise<
  | { ok: true; rawBody: Buffer }
  | { ok: false; code: 'PAYLOAD_TOO_LARGE'; byteLength: number }
> {
  const rawContentLength = req.headers.get('content-length')?.trim();
  if (rawContentLength) {
    const parsedLength = Number(rawContentLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      try {
        await req.body?.cancel();
      } catch {
        // Ignore stream cancellation error
      }
      return {
        ok: false,
        code: 'PAYLOAD_TOO_LARGE',
        byteLength: parsedLength,
      };
    }
  }

  if (!req.body) {
    return { ok: true, rawBody: Buffer.alloc(0) };
  }

  const reader = req.body.getReader();
  const chunks: Buffer[] = [];
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
          // Ignore stream cancellation error
        }
        return {
          ok: false,
          code: 'PAYLOAD_TOO_LARGE',
          byteLength: totalBytes,
        };
      }

      chunks.push(
        Buffer.from(value.buffer, value.byteOffset, value.byteLength)
      );
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore reader lock release error
    }
  }

  return {
    ok: true,
    rawBody: Buffer.concat(chunks, totalBytes),
  };
}

export async function handleSePayShopWebhookHttpRequest(
  req: Request,
  explicitShopId?: string | null
): Promise<Response> {
  const url = new URL(req.url, 'http://localhost:3000');
  const resolvedShopId = (
    explicitShopId ||
    url.searchParams.get('shopId') ||
    url.searchParams.get('shop_id') ||
    ''
  ).trim();

  // Enforce conservative 64 KiB body size limit BEFORE unbounded buffering or authentication
  const boundedBody = await readBoundedWebhookRawBody(
    req,
    SEPAY_MAX_WEBHOOK_BODY_BYTES
  );
  if (!boundedBody.ok) {
    const message = describeReasonCode('PAYLOAD_TOO_LARGE');
    return Response.json(
      {
        success: false,
        reconciled: false,
        duplicate: false,
        code: 'PAYLOAD_TOO_LARGE',
        error: message,
        message,
        shopId: resolvedShopId,
      },
      { status: 413 }
    );
  }

  const rawBody = boundedBody.rawBody;

  const signatureHeader = req.headers.get(SEPAY_SIGNATURE_HEADER);
  const timestampHeader = req.headers.get(SEPAY_TIMESTAMP_HEADER);

  try {
    const result = await processSePayShopWebhook({
      shopId: resolvedShopId,
      rawBody,
      signatureHeader,
      timestampHeader,
    });

    return Response.json(
      {
        success: result.success,
        reconciled: result.reconciled,
        duplicate: result.duplicate,
        code: result.code,
        ...(result.success ? {} : { error: result.message }),
        message: result.message,
        shopId: result.shopId,
        ...(result.sepayTransactionId
          ? { sepayTransactionId: result.sepayTransactionId }
          : {}),
        ...(result.referenceCode
          ? { referenceCode: result.referenceCode }
          : {}),
        ...(result.orderId ? { orderId: result.orderId } : {}),
        ...(result.orderCode ? { orderCode: result.orderCode } : {}),
      },
      { status: result.httpStatus }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Không thể xử lý webhook đối soát SePay.';
    return Response.json(
      {
        success: false,
        reconciled: false,
        duplicate: false,
        code: 'SEPAY_INTERNAL_ERROR',
        error: message,
      },
      { status: 500 }
    );
  }
}
