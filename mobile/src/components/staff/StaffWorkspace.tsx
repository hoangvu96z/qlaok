import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import {
  type MobileStaffSession,
  StaffApiError,
  type StaffApiClient,
  staffApi,
} from '../../lib/staff-api';
import {
  type AssistedOrderPayload,
  assertNoForbiddenMutationFields,
  filterActiveTables,
  type StaffCatalogItem,
  type StaffCategory,
  type StaffOptionChoice,
  type StaffOptionGroup,
  type StaffTable,
} from '../../lib/staff-ordering';
import {
  MobileLanguageSwitcher,
  useMobileI18n,
} from '../MobileI18nProvider';
import { AssistedOrderScreen } from './AssistedOrderScreen';

export interface StaffConfirmedOrderSummary {
  orderId: string;
  orderCode: string;
  tableId: string | null;
  tableLabel: string;
  totalAmount?: number;
  status: string;
  paymentStatus: 'unpaid';
}

export interface StaffWorkspaceContextData {
  shopName?: string;
  categories: StaffCategory[];
  items: StaffCatalogItem[];
  tables: StaffTable[];
}

export interface StaffWorkspaceProps {
  session: MobileStaffSession;
  onSignOut: () => void | Promise<void>;
  onSessionExpired?: () => void | Promise<void>;
  apiClient?: StaffApiClient;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeI18nRecord(
  raw: unknown,
  fallbackText = ''
): Record<string, string> {
  const result: Record<string, string> = {};
  if (isPlainRecord(raw)) {
    for (const [key, val] of Object.entries(raw)) {
      if (typeof val === 'string' && val.trim()) {
        result[key] = val.trim();
      }
    }
  }
  if (Object.keys(result).length === 0 && fallbackText.trim()) {
    result.vi = fallbackText.trim();
  }
  return result;
}

/**
 * Checks whether the current staff session has an active shop-scoped membership
 * with `orders.create` permission. Does NOT require `orders.view`.
 */
export function canStaffCreateAssistedOrders(
  session: MobileStaffSession | null | undefined
): boolean {
  if (!session) return false;
  const activeShopId =
    typeof session.activeShopId === 'string' ? session.activeShopId.trim() : '';
  if (!activeShopId) return false;

  const { membership, user, shop } = session;
  if (!membership || membership.is_active !== true) return false;
  if (membership.shop_id !== activeShopId) return false;
  if (user?.shop_id !== activeShopId || shop?.id !== activeShopId) return false;
  if (!Array.isArray(membership.permissions)) return false;

  return membership.permissions.includes('orders.create');
}

/**
 * Maps raw catalog item `options_json` into validated `StaffOptionGroup[]`.
 */
export function normalizeStaffOptionGroups(
  rawOptions: unknown
): StaffOptionGroup[] {
  let parsedOptions: unknown = rawOptions;
  if (typeof rawOptions === 'string' && rawOptions.trim()) {
    try {
      parsedOptions = JSON.parse(rawOptions);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsedOptions)) return [];

  const groups: StaffOptionGroup[] = [];
  for (let gIdx = 0; gIdx < parsedOptions.length; gIdx++) {
    const rawGroup = parsedOptions[gIdx];
    if (!isPlainRecord(rawGroup)) continue;

    const groupId =
      typeof rawGroup.id === 'string' && rawGroup.id.trim()
        ? rawGroup.id.trim()
        : `grp-${gIdx + 1}`;
    const fallbackGroupName =
      typeof rawGroup.name_vi === 'string' && rawGroup.name_vi.trim()
        ? rawGroup.name_vi.trim()
        : typeof rawGroup.name === 'string' && rawGroup.name.trim()
          ? rawGroup.name.trim()
          : groupId;
    const nameI18n = normalizeI18nRecord(rawGroup.name_i18n, fallbackGroupName);
    const descI18n = isPlainRecord(rawGroup.desc_i18n)
      ? normalizeI18nRecord(rawGroup.desc_i18n)
      : undefined;

    const rawChoices = Array.isArray(rawGroup.choices) ? rawGroup.choices : [];
    const choices: StaffOptionChoice[] = [];

    for (let cIdx = 0; cIdx < rawChoices.length; cIdx++) {
      const rawChoice = rawChoices[cIdx];
      if (!isPlainRecord(rawChoice)) continue;

      const choiceId =
        typeof rawChoice.id === 'string' && rawChoice.id.trim()
          ? rawChoice.id.trim()
          : '';
      if (!choiceId) continue;

      const labelVi =
        typeof rawChoice.label_vi === 'string' && rawChoice.label_vi.trim()
          ? rawChoice.label_vi.trim()
          : typeof rawChoice.name_vi === 'string' && rawChoice.name_vi.trim()
            ? rawChoice.name_vi.trim()
            : undefined;
      const choiceLabelI18n = normalizeI18nRecord(
        rawChoice.label_i18n,
        labelVi || choiceId
      );
      const choiceDescI18n = isPlainRecord(rawChoice.desc_i18n)
        ? normalizeI18nRecord(rawChoice.desc_i18n)
        : undefined;
      const extraPrice = Math.max(
        0,
        Math.round(Number(rawChoice.extra_price || 0))
      );

      const normalizedChoice: StaffOptionChoice = {
        id: choiceId,
        label_i18n: choiceLabelI18n,
        extra_price: extraPrice,
      };
      if (labelVi) {
        normalizedChoice.label_vi = labelVi;
      }
      if (choiceDescI18n && Object.keys(choiceDescI18n).length > 0) {
        normalizedChoice.desc_i18n = choiceDescI18n;
      }
      choices.push(normalizedChoice);
    }

    if (choices.length === 0) continue;

    const normalizedGroup: StaffOptionGroup = {
      id: groupId,
      name_i18n: nameI18n,
      required: Boolean(rawGroup.required),
      choices,
    };
    if (descI18n && Object.keys(descI18n).length > 0) {
      normalizedGroup.desc_i18n = descI18n;
    }
    groups.push(normalizedGroup);
  }

  return groups;
}

/**
 * Normalizes `GET /api/catalog?shopId=...` payload into `StaffCategory[]` and
 * `StaffCatalogItem[]` (including `options_json`). Defensively ignores any row
 * belonging to another shop.
 */
export function normalizeStaffCatalogPayload(
  raw: unknown,
  expectedShopId: string
): {
  shopName?: string;
  categories: StaffCategory[];
  items: StaffCatalogItem[];
} {
  const targetShopId = (expectedShopId || '').trim();
  if (!targetShopId || !isPlainRecord(raw)) {
    return { categories: [], items: [] };
  }

  let shopName: string | undefined;
  if (isPlainRecord(raw.shop)) {
    const payloadShopId =
      typeof raw.shop.id === 'string' ? raw.shop.id.trim() : '';
    if (payloadShopId && payloadShopId !== targetShopId) {
      return { categories: [], items: [] };
    }
    if (typeof raw.shop.name === 'string' && raw.shop.name.trim()) {
      shopName = raw.shop.name.trim();
    }
  }

  const rawCategories = Array.isArray(raw.categories) ? raw.categories : [];
  const categories: StaffCategory[] = [];
  for (const rawCat of rawCategories) {
    if (!isPlainRecord(rawCat)) continue;
    const id = typeof rawCat.id === 'string' ? rawCat.id.trim() : '';
    if (!id) continue;

    const rowShopId =
      typeof rawCat.shop_id === 'string' ? rawCat.shop_id.trim() : '';
    if (rowShopId && rowShopId !== targetShopId) {
      continue;
    }

    const fallbackCatName =
      typeof rawCat.name === 'string' && rawCat.name.trim()
        ? rawCat.name.trim()
        : id;
    const nameI18n = normalizeI18nRecord(rawCat.name_i18n, fallbackCatName);

    categories.push({
      id,
      shop_id: targetShopId,
      name_i18n: nameI18n,
      sort_order:
        typeof rawCat.sort_order === 'number' &&
        Number.isFinite(rawCat.sort_order)
          ? rawCat.sort_order
          : undefined,
      is_active: rawCat.is_active !== false,
    });
  }

  categories.sort((a, b) => {
    const orderA = typeof a.sort_order === 'number' ? a.sort_order : 999;
    const orderB = typeof b.sort_order === 'number' ? b.sort_order : 999;
    return orderA - orderB;
  });

  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const items: StaffCatalogItem[] = [];
  for (const rawItem of rawItems) {
    if (!isPlainRecord(rawItem)) continue;
    const id = typeof rawItem.id === 'string' ? rawItem.id.trim() : '';
    if (!id) continue;

    const rowShopId =
      typeof rawItem.shop_id === 'string' ? rawItem.shop_id.trim() : '';
    if (rowShopId && rowShopId !== targetShopId) {
      continue;
    }

    const fallbackItemName =
      typeof rawItem.name_vi === 'string' && rawItem.name_vi.trim()
        ? rawItem.name_vi.trim()
        : typeof rawItem.name === 'string' && rawItem.name.trim()
          ? rawItem.name.trim()
          : id;
    const nameI18n = normalizeI18nRecord(rawItem.name_i18n, fallbackItemName);
    const descI18n = isPlainRecord(rawItem.desc_i18n)
      ? normalizeI18nRecord(rawItem.desc_i18n)
      : undefined;

    const stockQty =
      rawItem.stock_quantity === null
        ? null
        : typeof rawItem.stock_quantity === 'number' &&
            Number.isFinite(rawItem.stock_quantity)
          ? rawItem.stock_quantity
          : undefined;
    const isSoldOutByStock = typeof stockQty === 'number' && stockQty <= 0;
    const isAvailable = rawItem.is_available !== false && !isSoldOutByStock;

    const normalizedItem: StaffCatalogItem = {
      id,
      shop_id: targetShopId,
      category_id:
        typeof rawItem.category_id === 'string' && rawItem.category_id.trim()
          ? rawItem.category_id.trim()
          : undefined,
      sort_order:
        typeof rawItem.sort_order === 'number' &&
        Number.isFinite(rawItem.sort_order)
          ? rawItem.sort_order
          : undefined,
      price: Math.max(0, Math.round(Number(rawItem.price || 0))),
      is_available: isAvailable,
      is_featured:
        typeof rawItem.is_featured === 'boolean'
          ? rawItem.is_featured
          : undefined,
      stock_quantity: stockQty,
      name_i18n: nameI18n,
      options_json: normalizeStaffOptionGroups(rawItem.options_json),
      image_url:
        typeof rawItem.image_url === 'string' ? rawItem.image_url : null,
    };
    if (descI18n && Object.keys(descI18n).length > 0) {
      normalizedItem.desc_i18n = descI18n;
    }
    items.push(normalizedItem);
  }

  items.sort((a, b) => {
    const orderA = typeof a.sort_order === 'number' ? a.sort_order : 999;
    const orderB = typeof b.sort_order === 'number' ? b.sort_order : 999;
    return orderA - orderB;
  });

  return {
    ...(shopName ? { shopName } : {}),
    categories,
    items,
  };
}

/**
 * Normalizes `GET /api/tables?shopId=...` payload into active, non-archived
 * `StaffTable[]`, preserving canonical IDs, codes, and names while defensively
 * ignoring rows from any other shop.
 */
export function normalizeStaffTablesPayload(
  raw: unknown,
  expectedShopId: string
): StaffTable[] {
  const targetShopId = (expectedShopId || '').trim();
  if (!targetShopId || !isPlainRecord(raw)) {
    return [];
  }

  const rawTables = Array.isArray(raw.tables) ? raw.tables : [];
  const candidates: StaffTable[] = [];

  for (const row of rawTables) {
    if (!isPlainRecord(row)) continue;
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!id || !name) continue;

    const rowShopId =
      typeof row.shop_id === 'string' ? row.shop_id.trim() : '';
    if (rowShopId && rowShopId !== targetShopId) {
      continue;
    }

    const table: StaffTable = {
      id,
      shop_id: targetShopId,
      name,
      table_code:
        typeof row.table_code === 'string' && row.table_code.trim()
          ? row.table_code.trim()
          : undefined,
      section:
        typeof row.section === 'string' && row.section.trim()
          ? row.section.trim()
          : undefined,
      capacity:
        typeof row.capacity === 'number' && Number.isFinite(row.capacity)
          ? row.capacity
          : undefined,
      sort_order:
        typeof row.sort_order === 'number' && Number.isFinite(row.sort_order)
          ? row.sort_order
          : undefined,
      is_active: row.is_active !== false,
      is_archived: Boolean(row.is_archived),
    };
    candidates.push(table);
  }

  return filterActiveTables(candidates);
}

/**
 * Loads the fixed shop's catalog (`options_json` included) and active tables
 * through `staffApi` (never direct Supabase queries and never `/api/orders`).
 */
export async function loadStaffWorkspaceContext(params: {
  shopId: string;
  api?: StaffApiClient;
}): Promise<StaffWorkspaceContextData> {
  const cleanShopId = (params.shopId || '').trim();
  if (!cleanShopId) {
    throw new Error('Thiếu mã cửa hàng (shopId).');
  }
  const api = params.api ?? staffApi;
  const query = `shopId=${encodeURIComponent(cleanShopId)}`;

  const [catalogRes, tablesRes] = await Promise.all([
    api(`/api/catalog?${query}`),
    api(`/api/tables?${query}`),
  ]);

  const [catalogRaw, tablesRaw] = await Promise.all([
    catalogRes.json(),
    tablesRes.json(),
  ]);

  const normalizedCatalog = normalizeStaffCatalogPayload(
    catalogRaw,
    cleanShopId
  );
  const normalizedTables = normalizeStaffTablesPayload(tablesRaw, cleanShopId);

  return {
    ...(normalizedCatalog.shopName
      ? { shopName: normalizedCatalog.shopName }
      : {}),
    categories: normalizedCatalog.categories,
    items: normalizedCatalog.items,
    tables: normalizedTables,
  };
}

/**
 * Submits an assisted guest order via `POST /api/orders` using `staffApi`.
 * Enforces `source: 'counter_pos'`, rejects forbidden payment/discount/fulfillment
 * fields, requires HTTP 201 and a valid returned `order.id`, and verifies the
 * returned order remains `unpaid`.
 */
export async function submitStaffAssistedOrder(params: {
  payload: AssistedOrderPayload;
  expectedShopId: string;
  api?: StaffApiClient;
}): Promise<StaffConfirmedOrderSummary> {
  const expectedShopId = (params.expectedShopId || '').trim();
  if (!expectedShopId) {
    throw new Error('Thiếu mã cửa hàng (shopId).');
  }

  const { payload } = params;
  if (!payload || payload.shop_id !== expectedShopId) {
    throw new Error('Đơn hàng không khớp với cửa hàng của phiên nhân viên.');
  }
  if (payload.source !== 'counter_pos') {
    throw new Error('Nguồn đơn hàng nhân viên phải là counter_pos.');
  }

  assertNoForbiddenMutationFields(payload);

  const api = params.api ?? staffApi;
  const response = await api('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (response.status !== 201) {
    throw new Error(
      `Phản hồi tạo đơn không hợp lệ (HTTP ${response.status}).`
    );
  }

  let parsedBody: unknown = null;
  try {
    parsedBody = await response.json();
  } catch {
    throw new Error('Phản hồi tạo đơn từ máy chủ không đúng định dạng JSON.');
  }

  if (!isPlainRecord(parsedBody) || !isPlainRecord(parsedBody.order)) {
    throw new Error('Máy chủ không trả về thông tin đơn hàng hợp lệ.');
  }

  const rawOrder = parsedBody.order;
  const orderId =
    typeof rawOrder.id === 'string' ? rawOrder.id.trim() : '';
  if (!orderId) {
    throw new Error('Thiếu mã định danh đơn hàng (order.id) từ máy chủ.');
  }

  if (
    typeof rawOrder.shop_id === 'string' &&
    rawOrder.shop_id.trim() &&
    rawOrder.shop_id.trim() !== expectedShopId
  ) {
    throw new Error('Đơn hàng trả về không thuộc cửa hàng đang làm việc.');
  }

  const paymentStatus =
    typeof rawOrder.payment_status === 'string'
      ? rawOrder.payment_status.trim()
      : 'unpaid';
  if (paymentStatus !== 'unpaid') {
    throw new Error(
      'Vi phạm bất biến thanh toán: đơn hỗ trợ gọi món phải ở trạng thái chưa thanh toán (unpaid).'
    );
  }

  const orderCode =
    typeof rawOrder.order_code === 'string' && rawOrder.order_code.trim()
      ? rawOrder.order_code.trim()
      : orderId;
  const tableId =
    typeof rawOrder.table_id === 'string' && rawOrder.table_id.trim()
      ? rawOrder.table_id.trim()
      : payload.table_id;
  const tableLabel =
    typeof rawOrder.table_label === 'string' && rawOrder.table_label.trim()
      ? rawOrder.table_label.trim()
      : payload.table_label;
  const totalAmount =
    typeof rawOrder.total_amount === 'number' &&
    Number.isFinite(rawOrder.total_amount)
      ? rawOrder.total_amount
      : undefined;
  const status =
    typeof rawOrder.status === 'string' && rawOrder.status.trim()
      ? rawOrder.status.trim()
      : 'new';

  return {
    orderId,
    orderCode,
    tableId: tableId ?? null,
    tableLabel,
    ...(totalAmount !== undefined ? { totalAmount } : {}),
    status,
    paymentStatus: 'unpaid',
  };
}

export const StaffWorkspace = memo(function StaffWorkspace({
  session,
  onSignOut,
  onSessionExpired,
  apiClient = staffApi,
}: StaffWorkspaceProps) {
  const { tb } = useMobileI18n();
  const tbRef = useRef(tb);
  tbRef.current = tb;

  const fixedShopId = session.activeShopId;
  const canCreateOrders = useMemo(
    () => canStaffCreateAssistedOrders(session),
    [session]
  );

  const [loading, setLoading] = useState<boolean>(canCreateOrders);
  const [loadError, setLoadError] = useState<string>('');
  const [shopDisplayName, setShopDisplayName] = useState<string>(
    session.shop.name
  );
  const [categories, setCategories] = useState<StaffCategory[]>([]);
  const [items, setItems] = useState<StaffCatalogItem[]>([]);
  const [tables, setTables] = useState<StaffTable[]>([]);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [lastConfirmedOrder, setLastConfirmedOrder] =
    useState<StaffConfirmedOrderSummary | null>(null);

  const loadGenerationRef = useRef(0);

  const loadContext = useCallback(async () => {
    if (!canCreateOrders) {
      setLoading(false);
      return;
    }
    const gen = ++loadGenerationRef.current;
    setLoading(true);
    setLoadError('');

    try {
      const data = await loadStaffWorkspaceContext({
        shopId: fixedShopId,
        api: apiClient,
      });
      if (gen !== loadGenerationRef.current) return;
      if (data.shopName) {
        setShopDisplayName(data.shopName);
      }
      setCategories(data.categories);
      setItems(data.items);
      setTables(data.tables);
    } catch (err) {
      if (gen !== loadGenerationRef.current) return;
      if (err instanceof StaffApiError && err.sessionCleared) {
        await onSessionExpired?.();
        return;
      }
      const msg =
        err instanceof Error && err.message
          ? err.message
          : tbRef.current(
              'Không thể tải dữ liệu thực đơn và bàn. Vui lòng thử lại.',
              'Failed to load menu and tables. Please try again.'
            );
      setLoadError(msg);
    } finally {
      if (gen === loadGenerationRef.current) {
        setLoading(false);
      }
    }
  }, [canCreateOrders, fixedShopId, apiClient, onSessionExpired]);

  useEffect(() => {
    void loadContext();
    return () => {
      loadGenerationRef.current += 1;
    };
  }, [loadContext]);

  const handleOrderSubmit = useCallback(
    async (payload: AssistedOrderPayload) => {
      if (!canCreateOrders) {
        throw new Error(
          tbRef.current(
            'Tài khoản không có quyền tạo đơn tại bàn (orders.create).',
            'Account does not have permission to create orders (orders.create).'
          )
        );
      }
      setSubmitting(true);
      try {
        const confirmed = await submitStaffAssistedOrder({
          payload,
          expectedShopId: fixedShopId,
          api: apiClient,
        });
        setLastConfirmedOrder(confirmed);
      } catch (err) {
        if (err instanceof StaffApiError && err.sessionCleared) {
          await onSessionExpired?.();
        }
        throw err;
      } finally {
        setSubmitting(false);
      }
    },
    [canCreateOrders, fixedShopId, apiClient, onSessionExpired]
  );

  const staffRoleBadge =
    session.membership.role === 'cashier'
      ? tb('Thu ngân', 'Cashier')
      : tb('Nhân viên', 'Staff');

  return (
    <SafeAreaView style={wsStyles.safeArea}>
      <StatusBar style="dark" />

      {/* Staff Identity & Fixed Shop Header */}
      <View testID="staff-workspace-header" style={wsStyles.topIdentityBar}>
        <View style={wsStyles.identityLeft}>
          <View style={wsStyles.rolePill}>
            <Ionicons name="id-card-outline" size={13} color="#065f46" />
            <Text style={wsStyles.rolePillText}>{staffRoleBadge}</Text>
          </View>
          <View style={wsStyles.identityTextCol}>
            <Text style={wsStyles.staffNameText} numberOfLines={1}>
              {session.user.full_name || session.user.username}{' '}
              <Text style={wsStyles.staffUsernameText}>
                (@{session.user.username})
              </Text>
            </Text>
            <Text style={wsStyles.shopFixedMetaText} numberOfLines={1}>
              {shopDisplayName || session.shop.name} • /{session.shop.slug}
            </Text>
          </View>
        </View>

        <View style={wsStyles.headerActions}>
          <MobileLanguageSwitcher variant="compact" />

          {canCreateOrders && (
            <TouchableOpacity
              testID="staff-workspace-refresh-btn"
              accessibilityRole="button"
              accessibilityLabel={tb(
                'Làm mới thực đơn và bàn',
                'Refresh menu and tables'
              )}
              onPress={() => void loadContext()}
              disabled={loading || submitting}
              style={wsStyles.iconBtn}
            >
              <Ionicons name="refresh" size={17} color="#334155" />
            </TouchableOpacity>
          )}

          <TouchableOpacity
            testID="staff-workspace-signout-btn"
            accessibilityRole="button"
            accessibilityLabel={tb('Đăng xuất nhân viên', 'Sign out staff')}
            onPress={() => void onSignOut()}
            style={wsStyles.signOutBtn}
          >
            <Ionicons name="log-out-outline" size={16} color="#991b1b" />
            <Text style={wsStyles.signOutBtnText}>
              {tb('Thoát', 'Sign out')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* No Permission State (missing active membership or orders.create) */}
      {!canCreateOrders ? (
        <View
          testID="staff-no-permission-state"
          style={wsStyles.centerStateContainer}
        >
          <View style={wsStyles.stateCard}>
            <Ionicons name="lock-closed-outline" size={38} color="#d97706" />
            <Text style={wsStyles.stateTitle}>
              {tb(
                'Chưa có quyền ghi món tại bàn',
                'No Permission for Assisted Ordering'
              )}
            </Text>
            <Text style={wsStyles.stateDesc}>
              {tb(
                'Tài khoản nhân viên này hiện không hoạt động hoặc chưa được cấp quyền "orders.create" tại quán. Vui lòng liên hệ chủ quán để cấp quyền hoặc đăng xuất.',
                'This staff account is inactive or does not have "orders.create" permission for this shop. Please contact the shop owner or sign out.'
              )}
            </Text>
            <TouchableOpacity
              testID="staff-no-permission-signout-btn"
              accessibilityRole="button"
              onPress={() => void onSignOut()}
              style={wsStyles.primaryStateBtn}
            >
              <Text style={wsStyles.primaryStateBtnText}>
                {tb('Đăng xuất tài khoản', 'Sign Out')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : loading ? (
        <View
          testID="staff-workspace-loading"
          style={wsStyles.centerStateContainer}
        >
          <ActivityIndicator size="large" color="#10b981" />
          <Text style={wsStyles.loadingText}>
            {tb(
              'Đang tải thực đơn và danh sách bàn đang hoạt động...',
              'Loading menu and active tables...'
            )}
          </Text>
        </View>
      ) : loadError ? (
        <View
          testID="staff-workspace-error-state"
          style={wsStyles.centerStateContainer}
        >
          <View style={wsStyles.stateCard}>
            <Ionicons name="alert-circle-outline" size={38} color="#dc2626" />
            <Text style={wsStyles.stateTitle}>
              {tb(
                'Không thể tải dữ liệu bán hàng',
                'Unable to Load Ordering Data'
              )}
            </Text>
            <Text style={wsStyles.stateDesc}>{loadError}</Text>
            <TouchableOpacity
              testID="staff-workspace-retry-btn"
              accessibilityRole="button"
              onPress={() => void loadContext()}
              style={wsStyles.primaryStateBtn}
            >
              <Text style={wsStyles.primaryStateBtnText}>
                {tb('Thử tải lại', 'Retry')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={wsStyles.composerWrapper}>
          {lastConfirmedOrder && (
            <View
              testID="staff-confirmed-order-banner"
              accessibilityRole="alert"
              style={wsStyles.confirmedBanner}
            >
              <View style={wsStyles.confirmedBannerLeft}>
                <Ionicons name="checkmark-circle" size={18} color="#047857" />
                <View style={wsStyles.confirmedBannerTextCol}>
                  <Text style={wsStyles.confirmedBannerTitle}>
                    {tb(
                      `Đã gửi đơn #${lastConfirmedOrder.orderCode} • ${lastConfirmedOrder.tableLabel}`,
                      `Order #${lastConfirmedOrder.orderCode} sent • ${lastConfirmedOrder.tableLabel}`
                    )}
                  </Text>
                  <Text style={wsStyles.confirmedBannerMeta}>
                    {tb(
                      `Mã đơn: ${lastConfirmedOrder.orderId} • Chưa thanh toán (Unpaid)`,
                      `Order ID: ${lastConfirmedOrder.orderId} • Unpaid`
                    )}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={tb('Đóng thông báo', 'Dismiss notice')}
                onPress={() => setLastConfirmedOrder(null)}
                style={wsStyles.confirmedDismissBtn}
              >
                <Ionicons name="close" size={16} color="#065f46" />
              </TouchableOpacity>
            </View>
          )}

          {tables.length === 0 && (
            <View
              testID="staff-workspace-empty-tables"
              style={wsStyles.warningStrip}
            >
              <Ionicons
                name="information-circle-outline"
                size={15}
                color="#92400e"
              />
              <Text style={wsStyles.warningStripText}>
                {tb(
                  'Quán hiện chưa có bàn đang hoạt động. Bạn vẫn có thể chọn Mang về hoặc bấm Làm mới.',
                  'No active dine-in tables found. You can still select Takeaway or tap Refresh.'
                )}
              </Text>
            </View>
          )}

          {items.length === 0 && (
            <View
              testID="staff-workspace-empty-catalog"
              style={wsStyles.warningStrip}
            >
              <Ionicons name="warning-outline" size={15} color="#92400e" />
              <Text style={wsStyles.warningStripText}>
                {tb(
                  'Thực đơn của quán hiện chưa có món khả dụng.',
                  'This shop currently has no available menu items.'
                )}
              </Text>
            </View>
          )}

          <AssistedOrderScreen
            key={fixedShopId}
            shopId={fixedShopId}
            shopName={shopDisplayName || session.shop.name}
            tables={tables}
            categories={categories}
            items={items}
            submitting={submitting}
            onSubmit={handleOrderSubmit}
          />
        </View>
      )}
    </SafeAreaView>
  );
});

const wsStyles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f8fafc',
    paddingTop: Platform.OS === 'android' ? 24 : 0,
  },
  topIdentityBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    gap: 8,
  },
  identityLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  rolePillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#065f46',
  },
  identityTextCol: {
    flex: 1,
  },
  staffNameText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
  },
  staffUsernameText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
  },
  shopFixedMetaText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
    marginTop: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconBtn: {
    padding: 7,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  signOutBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#991b1b',
  },
  centerStateContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  stateCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  stateTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 12,
    textAlign: 'center',
  },
  stateDesc: {
    fontSize: 13,
    color: '#475569',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 19,
  },
  primaryStateBtn: {
    marginTop: 18,
    backgroundColor: '#10b981',
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 10,
  },
  primaryStateBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#020617',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
    textAlign: 'center',
  },
  composerWrapper: {
    flex: 1,
  },
  confirmedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ecfdf5',
    borderBottomWidth: 1,
    borderBottomColor: '#a7f3d0',
    paddingHorizontal: 14,
    paddingVertical: 9,
    gap: 8,
  },
  confirmedBannerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  confirmedBannerTextCol: {
    flex: 1,
  },
  confirmedBannerTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#065f46',
  },
  confirmedBannerMeta: {
    fontSize: 11,
    fontWeight: '600',
    color: '#047857',
  },
  confirmedDismissBtn: {
    padding: 4,
  },
  warningStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fffbeb',
    borderBottomWidth: 1,
    borderBottomColor: '#fde68a',
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  warningStripText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    color: '#92400e',
  },
});
