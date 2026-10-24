import type {
  ShopOrder,
  ShopTable,
  SupportedLocale,
  TableOrderStats,
} from '@/types/qlaok';
import { UI_LABELS } from '@/lib/i18n-helper';

const TAKEAWAY_LABELS = new Set([
  'mang về',
  'mang ve',
  'mang đi',
  'mang di',
  'takeaway',
  'take away',
  'take-away',
  'tại quầy',
  'tai quay',
  'counter',
  'quầy',
  'quay',
  '포장',
  'お持ち帰り',
  '外带',
  '打包',
  'para llevar',
  'asporto',
  'навынос',
]);

export function isTakeawayTableLabel(label?: string | null): boolean {
  const normalized = (label ?? '').trim().toLowerCase();
  if (!normalized) return false;
  return (
    TAKEAWAY_LABELS.has(normalized) ||
    normalized.startsWith('mang về') ||
    normalized.startsWith('mang ve') ||
    normalized.startsWith('takeaway') ||
    normalized.startsWith('take away')
  );
}

export function buildTableMenuUrl(
  baseUrl: string,
  slug: string,
  tableId: string,
  qrSig?: string | null
): string {
  const normalizedBase = (baseUrl ?? '').trim().replace(/\/+$/, '');
  const cleanSlug = encodeURIComponent((slug ?? '').trim());
  const cleanTableId = (tableId ?? '').trim();
  const cleanSig = (qrSig ?? '').trim();
  const path = `${normalizedBase}/s/${cleanSlug}/menu`;
  if (!cleanTableId) {
    return `${path}?src=table`;
  }
  const baseQuery = `${path}?src=table&tableId=${encodeURIComponent(cleanTableId)}`;
  if (!cleanSig) {
    return baseQuery;
  }
  return `${baseQuery}&sig=${encodeURIComponent(cleanSig)}`;
}

export function filterSelectableTables(
  tables: ShopTable[] | null | undefined,
  shopId?: string | null
): ShopTable[] {
  if (!Array.isArray(tables)) return [];
  const cleanShopId = (shopId ?? '').trim();
  return tables
    .filter((t) => {
      if (!t || !t.id || !t.name) return false;
      if (cleanShopId && t.shop_id !== cleanShopId) return false;
      return !t.is_archived && Boolean(t.is_active);
    })
    .sort((a, b) => {
      const sortDiff = Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0);
      if (sortDiff !== 0) return sortDiff;
      return a.name.localeCompare(b.name, 'vi');
    });
}

export type StorefrontSearchParamsInput =
  | string
  | URLSearchParams
  | { toString(): string }
  | Record<string, string | string[] | null | undefined>
  | null
  | undefined;

export function serializeStorefrontSearchParams(
  searchParams?: StorefrontSearchParamsInput
): string {
  if (!searchParams) return '';
  if (typeof searchParams === 'string') {
    return searchParams.trim().replace(/^\?+/, '');
  }
  if (
    searchParams instanceof URLSearchParams ||
    (typeof searchParams === 'object' &&
      typeof (searchParams as { toString?: unknown }).toString === 'function' &&
      (searchParams as { toString(): string }).toString !== Object.prototype.toString)
  ) {
    return (searchParams as { toString(): string }).toString().replace(/^\?+/, '');
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(
    searchParams as Record<string, string | string[] | null | undefined>
  )) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) {
          params.append(key, String(item));
        }
      }
    } else {
      params.append(key, String(value));
    }
  }
  return params.toString();
}

export function resolveStorefrontCanonicalRedirect(input: {
  requestedSlug?: string | null;
  canonicalSlug?: string | null;
  view?: 'door' | 'menu';
  searchParams?: StorefrontSearchParamsInput;
}): {
  isAlias: boolean;
  canonicalSlug: string;
  canonicalPath: string;
  canonicalUrl: string;
} | null {
  const requested = (input.requestedSlug ?? '').trim().toLowerCase();
  const canonical = (input.canonicalSlug ?? '').trim().toLowerCase();
  if (!canonical) return null;
  const view = input.view === 'menu' ? 'menu' : 'door';
  const encodedSlug = encodeURIComponent(canonical);
  const canonicalPath =
    view === 'menu' ? `/s/${encodedSlug}/menu` : `/s/${encodedSlug}`;
  const query = serializeStorefrontSearchParams(input.searchParams);
  const canonicalUrl = query ? `${canonicalPath}?${query}` : canonicalPath;
  return {
    isAlias: Boolean(requested) && requested !== canonical,
    canonicalSlug: canonical,
    canonicalPath,
    canonicalUrl,
  };
}

export interface ScopedTableQrVerification {
  shopSlug?: string | null;
  canonicalSlug?: string | null;
  shopId?: string | null;
  tableId: string;
  sig: string;
  verified: boolean;
}

export interface StorefrontTableChoice {
  shopSlug: string;
  tableQueryKey?: string;
  tableId: string | null;
  tableLabel: string;
  isTakeaway: boolean;
}

export function buildTableQrVerificationKey(input: {
  shopSlug?: string | null;
  tableId?: string | null;
  sig?: string | null;
}): string {
  return [
    (input.shopSlug ?? '').trim().toLowerCase(),
    (input.tableId ?? '').trim(),
    (input.sig ?? '').trim(),
  ].join('\0');
}

export function buildStorefrontTableQueryKey(input: {
  shopSlug?: string | null;
  tableId?: string | null;
  sig?: string | null;
  table?: string | null;
}): string {
  return [
    (input.shopSlug ?? '').trim().toLowerCase(),
    (input.tableId ?? '').trim(),
    (input.sig ?? '').trim(),
    (input.table ?? '').trim(),
  ].join('\0');
}

export function resolveScopedTableQrVerification(
  verification: ScopedTableQrVerification | boolean | null | undefined,
  current: {
    shopSlug?: string | null;
    shopId?: string | null;
    tableId?: string | null;
    sig?: string | null;
  }
): boolean | null {
  const cleanTableId = (current.tableId ?? '').trim();
  const cleanSig = (current.sig ?? '').trim();
  if (!cleanTableId) {
    return null;
  }
  if (!cleanSig) {
    return false;
  }
  if (typeof verification === 'boolean') {
    return verification;
  }
  if (!verification || typeof verification !== 'object') {
    return null;
  }
  const verifiedTableId = (verification.tableId ?? '').trim();
  const verifiedSig = (verification.sig ?? '').trim();
  if (!verifiedTableId || !verifiedSig) {
    return null;
  }
  if (verifiedTableId !== cleanTableId || verifiedSig !== cleanSig) {
    return null;
  }
  const currentSlug = (current.shopSlug ?? '').trim().toLowerCase();
  const verifiedSlug = (verification.shopSlug ?? '').trim().toLowerCase();
  const verifiedCanonicalSlug = (verification.canonicalSlug ?? '').trim().toLowerCase();
  if (
    (current.shopSlug !== undefined || verifiedSlug || verifiedCanonicalSlug) &&
    verifiedSlug !== currentSlug &&
    (!verifiedCanonicalSlug || verifiedCanonicalSlug !== currentSlug)
  ) {
    return null;
  }
  const currentShopId = (current.shopId ?? '').trim();
  const verifiedShopId = (verification.shopId ?? '').trim();
  if (
    (current.shopId !== undefined || verifiedShopId) &&
    verifiedShopId !== currentShopId
  ) {
    return null;
  }
  return Boolean(verification.verified);
}

export function createScopedTableQrVerification(input: {
  shopSlug: string;
  canonicalSlug?: string | null;
  shopId?: string | null;
  tableId?: string | null;
  sig?: string | null;
  tableQrVerified?: boolean | null;
  activeSlug?: string | null;
  activeTableId?: string | null;
  activeSig?: string | null;
}): ScopedTableQrVerification | null {
  const cleanSlug = (input.shopSlug ?? '').trim();
  const cleanCanonicalSlug = (input.canonicalSlug ?? '').trim();
  const cleanShopId = (input.shopId ?? '').trim();
  const cleanTableId = (input.tableId ?? '').trim();
  const cleanSig = (input.sig ?? '').trim();

  if (!cleanSlug || !cleanTableId) {
    return null;
  }

  if (input.activeSlug !== undefined) {
    const cleanActiveSlug = (input.activeSlug ?? '').trim().toLowerCase();
    if (
      cleanActiveSlug !== cleanSlug.toLowerCase() &&
      (!cleanCanonicalSlug || cleanActiveSlug !== cleanCanonicalSlug.toLowerCase())
    ) {
      return null;
    }
  }
  if (
    input.activeTableId !== undefined &&
    (input.activeTableId ?? '').trim() !== cleanTableId
  ) {
    return null;
  }
  if (
    input.activeSig !== undefined &&
    (input.activeSig ?? '').trim() !== cleanSig
  ) {
    return null;
  }

  return {
    shopSlug: cleanSlug,
    ...(cleanCanonicalSlug ? { canonicalSlug: cleanCanonicalSlug } : {}),
    shopId: cleanShopId || null,
    tableId: cleanTableId,
    sig: cleanSig,
    verified:
      Boolean(cleanSig) && typeof input.tableQrVerified === 'boolean'
        ? input.tableQrVerified
        : false,
  };
}

export function resolveTableSelection(
  tables: ShopTable[],
  input: {
    shopSlug?: string | null;
    shopId?: string | null;
    tableId?: string | null;
    table?: string | null;
    sig?: string | null;
    requireSig?: boolean;
    sigVerified?: boolean | ScopedTableQrVerification | null;
  },
  locale: SupportedLocale = 'vi'
): { table: ShopTable | null; error: string | null } {
  const rawTableId = (input?.tableId ?? '').trim();
  const rawTable = (input?.table ?? '').trim();
  const cleanSig = (input?.sig ?? '').trim();
  const mustCheckSig =
    Boolean(input?.requireSig) ||
    input?.sig !== undefined ||
    input?.sigVerified !== undefined;

  if (!rawTableId && !rawTable) {
    return { table: null, error: null };
  }

  const list = Array.isArray(tables) ? tables : [];
  const labels = UI_LABELS[locale] || UI_LABELS.vi;

  // tableId takes precedence when provided
  if (rawTableId) {
    const exactOrCaseMatch =
      list.find((t) => t.id === rawTableId) ||
      list.find((t) => t.id.trim().toLowerCase() === rawTableId.toLowerCase());

    if (!exactOrCaseMatch) {
      return {
        table: null,
        error: labels.tableQrInvalidError,
      };
    }

    if (exactOrCaseMatch.is_archived || !exactOrCaseMatch.is_active) {
      return {
        table: null,
        error: labels.tableInactiveError(exactOrCaseMatch.name),
      };
    }

    const effectiveSigVerified =
      typeof input?.sigVerified === 'object' && input?.sigVerified !== null
        ? resolveScopedTableQrVerification(input.sigVerified, {
            shopSlug: input.shopSlug,
            shopId:
              input.shopId !== undefined
                ? input.shopId
                : input.sigVerified.shopId !== undefined
                  ? exactOrCaseMatch.shop_id
                  : undefined,
            tableId: rawTableId,
            sig: cleanSig,
          }) === true &&
          exactOrCaseMatch.id.trim().toLowerCase() ===
            (input.sigVerified.tableId ?? '').trim().toLowerCase() &&
          (!input.sigVerified.shopId ||
            input.sigVerified.shopId.trim() === exactOrCaseMatch.shop_id.trim())
        : input?.sigVerified === true;

    if (mustCheckSig && (!cleanSig || !effectiveSigVerified)) {
      return {
        table: null,
        error: labels.tableQrInvalidError,
      };
    }

    return { table: exactOrCaseMatch, error: null };
  }

  // Fallback to legacy ?table= code or name parameter
  const needle = rawTable.toLowerCase();
  const activeMatch = list.find(
    (t) =>
      !t.is_archived &&
      t.is_active &&
      (t.id.trim().toLowerCase() === needle ||
        t.table_code.trim().toLowerCase() === needle ||
        t.name.trim().toLowerCase() === needle)
  );

  if (activeMatch) {
    const effectiveLegacySigVerified =
      typeof input?.sigVerified === 'object' && input?.sigVerified !== null
        ? resolveScopedTableQrVerification(input.sigVerified, {
            shopSlug: input.shopSlug,
            shopId:
              input.shopId !== undefined
                ? input.shopId
                : input.sigVerified.shopId !== undefined
                  ? activeMatch.shop_id
                  : undefined,
            tableId: activeMatch.id,
            sig: cleanSig,
          }) === true &&
          (!input.sigVerified.shopId ||
            input.sigVerified.shopId.trim() === activeMatch.shop_id.trim())
        : input?.sigVerified === true;

    if (mustCheckSig && (!cleanSig || !effectiveLegacySigVerified)) {
      return {
        table: null,
        error: labels.tableQrInvalidError,
      };
    }
    return { table: activeMatch, error: null };
  }

  const inactiveMatch = list.find(
    (t) =>
      t.id.trim().toLowerCase() === needle ||
      t.table_code.trim().toLowerCase() === needle ||
      t.name.trim().toLowerCase() === needle
  );

  if (inactiveMatch) {
    return {
      table: null,
      error: labels.tableInactiveError(inactiveMatch.name),
    };
  }

  return {
    table: null,
    error: labels.tableNotFoundError(rawTable),
  };
}

export function resolveStorefrontMenuTableState(input: {
  shopSlug: string;
  shopId?: string | null;
  tables: ShopTable[];
  qrTableIdParam?: string | null;
  qrTableSigParam?: string | null;
  qrTableParam?: string | null;
  verification?: ScopedTableQrVerification | boolean | null;
  userTableChoice?: StorefrontTableChoice | null;
  locale?: SupportedLocale;
}): {
  tableQrVerified: boolean | null;
  lockedTable: ShopTable | null;
  selectedTable: ShopTable | null;
  selectedTableId: string | null;
  isTakeawaySelected: boolean;
  error: string | null;
} {
  const locale = input.locale || 'vi';
  const cleanSlug = (input.shopSlug ?? '').trim();
  const cleanShopId = (input.shopId ?? '').trim();
  const cleanTableId = (input.qrTableIdParam ?? '').trim();
  const cleanSig = (input.qrTableSigParam ?? '').trim();
  const cleanTableParam = (input.qrTableParam ?? '').trim();

  const activeTables = cleanShopId
    ? filterSelectableTables(input.tables, cleanShopId)
    : [];

  const tableQrVerified = cleanShopId
    ? resolveScopedTableQrVerification(input.verification, {
        shopSlug: cleanSlug,
        shopId: cleanShopId,
        tableId: cleanTableId,
        sig: cleanSig,
      })
    : cleanTableId && !cleanSig
      ? false
      : null;

  let lockedTable: ShopTable | null = null;
  if (cleanTableId && cleanSig && cleanShopId && tableQrVerified === true) {
    const resolvedLock = resolveTableSelection(
      activeTables,
      {
        shopSlug: cleanSlug,
        shopId: cleanShopId,
        tableId: cleanTableId,
        sig: cleanSig,
        requireSig: true,
        sigVerified: input.verification,
      },
      locale
    );
    if (resolvedLock.table && !resolvedLock.error) {
      lockedTable = resolvedLock.table;
    }
  }

  // 0. Locked signed QR table always wins (no switching)
  if (lockedTable) {
    return {
      tableQrVerified,
      lockedTable,
      selectedTable: lockedTable,
      selectedTableId: lockedTable.id,
      isTakeawaySelected: false,
      error: null,
    };
  }

  // 1. User explicitly chose takeaway in this shop session (for the current QR query)
  const currentQueryKey = buildStorefrontTableQueryKey({
    shopSlug: cleanSlug,
    tableId: cleanTableId,
    sig: cleanSig,
    table: cleanTableParam,
  });
  if (
    input.userTableChoice &&
    input.userTableChoice.shopSlug.trim().toLowerCase() ===
      cleanSlug.toLowerCase() &&
    (!input.userTableChoice.tableQueryKey ||
      input.userTableChoice.tableQueryKey === currentQueryKey) &&
    input.userTableChoice.isTakeaway
  ) {
    return {
      tableQrVerified,
      lockedTable: null,
      selectedTable: null,
      selectedTableId: null,
      isTakeawaySelected: true,
      error: null,
    };
  }

  // 2. Legacy ?table=Mang về / takeaway URL parameter (when no tableId)
  if (!cleanTableId && cleanTableParam && isTakeawayTableLabel(cleanTableParam)) {
    return {
      tableQrVerified,
      lockedTable: null,
      selectedTable: null,
      selectedTableId: null,
      isTakeawaySelected: true,
      error: null,
    };
  }

  // 3. Resolve QR ?tableId= or ?table= with signature enforcement via resolveTableSelection helper
  const resolved = resolveTableSelection(
    activeTables,
    {
      shopSlug: cleanSlug,
      shopId: cleanShopId || undefined,
      tableId: cleanTableId,
      table: cleanTableParam,
      sig: cleanSig,
      requireSig: true,
      sigVerified: tableQrVerified,
    },
    locale
  );

  return {
    tableQrVerified,
    lockedTable: null,
    selectedTable: resolved.table,
    selectedTableId: resolved.table?.id ?? null,
    isTakeawaySelected: false,
    error: resolved.error,
  };
}

export const STOREFRONT_MENU_POLL_INTERVAL_MS = 120_000;
export const STOREFRONT_MENU_STALE_REFRESH_MS = 10_000;

export function shouldRefreshStorefrontCatalog(input: {
  visibilityState?: string | null;
  isOnline?: boolean | null;
  isFetchInFlight?: boolean;
  lastFetchedAtMs?: number;
  nowMs?: number;
  minAgeMs?: number;
}): boolean {
  if (input.isFetchInFlight) {
    return false;
  }
  if (input.isOnline === false) {
    return false;
  }
  const vis = (input.visibilityState ?? 'visible').trim().toLowerCase();
  if (vis === 'hidden' || vis === 'prerender') {
    return false;
  }
  const minAgeMs = Math.max(
    0,
    Number(input.minAgeMs ?? STOREFRONT_MENU_POLL_INTERVAL_MS)
  );
  const lastFetchedAtMs = Number(input.lastFetchedAtMs ?? 0);
  const nowMs = Number(input.nowMs ?? Date.now());
  if (lastFetchedAtMs > 0 && nowMs - lastFetchedAtMs < minAgeMs) {
    return false;
  }
  return true;
}

export function canUseStorefrontTableServiceActions(input: {
  lockedTable: ShopTable | null;
  tableQrVerified: boolean | null;
  isTakeawaySelected: boolean;
  error: string | null;
  qrTableSigParam?: string | null;
}): boolean {
  const cleanSig = (input.qrTableSigParam ?? '').trim();
  return Boolean(
    input.lockedTable &&
      input.lockedTable.is_active &&
      !input.lockedTable.is_archived &&
      input.tableQrVerified === true &&
      !input.isTakeawaySelected &&
      !input.error &&
      cleanSig.length > 0
  );
}

export function summarizeOrdersByTable(
  orders: ShopOrder[],
  shopId: string,
  tables?: ShopTable[]
): TableOrderStats[] {
  const cleanShopId = (shopId ?? '').trim();
  if (!cleanShopId || !Array.isArray(orders)) {
    return [];
  }

  const tableById = new Map<string, ShopTable>();
  for (const t of tables ?? []) {
    if (t && t.shop_id === cleanShopId && t.id) {
      tableById.set(t.id, t);
    }
  }

  const seenOrderIds = new Set<string>();
  const groups = new Map<string, TableOrderStats>();

  for (const order of orders) {
    if (!order || order.shop_id !== cleanShopId) continue;
    if (order.id) {
      if (seenOrderIds.has(order.id)) continue;
      seenOrderIds.add(order.id);
    }

    const rawTableId = (order.table_id ?? '').trim();
    const rawLabel = (order.table_label ?? '').trim();

    let key: string;
    let tableId: string | null = null;
    let tableLabel: string;
    let kind: 'managed' | 'takeaway' | 'legacy';

    if (rawTableId) {
      key = `managed:${rawTableId}`;
      tableId = rawTableId;
      kind = 'managed';
      const managed = tableById.get(rawTableId);
      tableLabel = managed?.name || rawLabel || rawTableId;
    } else if (isTakeawayTableLabel(rawLabel)) {
      key = 'takeaway';
      tableId = null;
      kind = 'takeaway';
      tableLabel = 'Mang về';
    } else {
      const legacyDisplay = rawLabel || 'Khách lẻ';
      key = `legacy:${legacyDisplay.toLowerCase()}`;
      tableId = null;
      kind = 'legacy';
      tableLabel = legacyDisplay;
    }

    let stats = groups.get(key);
    if (!stats) {
      stats = {
        key,
        table_id: tableId,
        table_label: tableLabel,
        kind,
        orderCount: 0,
        paidOrderCount: 0,
        unpaidOrderCount: 0,
        cancelledOrderCount: 0,
        refundedOrderCount: 0,
        collectedRevenue: 0,
        unpaidAmount: 0,
        refundedAmount: 0,
      };
      groups.set(key, stats);
    } else if (kind === 'managed' && tableById.has(rawTableId)) {
      stats.table_label = tableById.get(rawTableId)!.name;
    }

    const amount = Math.max(0, Number(order.total_amount || 0));
    stats.orderCount += 1;

    if (order.status === 'cancelled') {
      stats.cancelledOrderCount += 1;
      if (order.payment_status === 'refunded') {
        stats.refundedOrderCount += 1;
        stats.refundedAmount += amount;
      }
      continue;
    }

    if (order.payment_status === 'paid') {
      stats.paidOrderCount += 1;
      stats.collectedRevenue += amount;
    } else if (order.payment_status === 'refunded') {
      stats.refundedOrderCount += 1;
      stats.refundedAmount += amount;
    } else {
      stats.unpaidOrderCount += 1;
      stats.unpaidAmount += amount;
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (b.collectedRevenue !== a.collectedRevenue) {
      return b.collectedRevenue - a.collectedRevenue;
    }
    if (b.orderCount !== a.orderCount) {
      return b.orderCount - a.orderCount;
    }
    return a.table_label.localeCompare(b.table_label, 'vi');
  });
}
