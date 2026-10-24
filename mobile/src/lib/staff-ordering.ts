/**
 * Pure helper module for mobile staff assisted table-order composer.
 *
 * Adheres strictly to the POST /api/orders contract:
 * - source: 'counter_pos'
 * - table_id / table_label for table service (table_id: null for takeaway)
 * - visitor_lang
 * - idempotency_key (stable caller-provided)
 * - items using item_id, name_vi, optional name_i18n, quantity, unit_price, extra_price, selected_choices, custom_note
 *
 * Invariant: This module only builds an order draft/payload. It never mutates
 * payment_status, status, discount, fulfillment, or price overrides. The server
 * remains authoritative for final order pricing and state.
 */

export interface StaffOptionChoice {
  id: string;
  label_vi?: string;
  label_i18n: Record<string, string>;
  desc_i18n?: Record<string, string>;
  extra_price: number;
}

export interface StaffOptionGroup {
  id: string;
  name_i18n: Record<string, string>;
  desc_i18n?: Record<string, string>;
  required: boolean;
  choices: StaffOptionChoice[];
}

export interface StaffCatalogItem {
  id: string;
  shop_id?: string;
  category_id?: string;
  sort_order?: number;
  price: number;
  is_available: boolean;
  is_featured?: boolean;
  stock_quantity?: number | null;
  name_i18n: Record<string, string>;
  desc_i18n?: Record<string, string>;
  options_json?: StaffOptionGroup[];
  image_url?: string | null;
  sold_count?: number;
  view_count?: number;
}

export interface StaffCategory {
  id: string;
  shop_id?: string;
  name_i18n: Record<string, string>;
  sort_order?: number;
  is_active?: boolean;
}

export interface StaffTable {
  id: string;
  shop_id?: string;
  name: string;
  table_code?: string;
  section?: string;
  capacity?: number;
  sort_order?: number;
  is_active?: boolean;
  is_archived?: boolean;
}

export interface StaffTableSelection {
  kind: 'table' | 'takeaway';
  tableId: string | null;
  tableLabel: string;
}

export interface StaffCartLine {
  lineId: string;
  item: StaffCatalogItem;
  quantity: number;
  selectedChoices: StaffOptionChoice[];
  customNote: string;
}

export interface AssistedOrderLinePayload {
  item_id: string;
  name_vi: string;
  name_i18n?: Record<string, string>;
  quantity: number;
  unit_price: number;
  extra_price: number;
  selected_choices: Array<{
    id: string;
    label_i18n: Record<string, string>;
    extra_price: number;
  }>;
  custom_note?: string;
}

export interface AssistedOrderPayload {
  shop_id: string;
  source: 'counter_pos';
  table_id: string | null;
  table_label: string;
  visitor_lang: string;
  idempotency_key: string;
  items: AssistedOrderLinePayload[];
}

export interface DraftValidationResult {
  ok: boolean;
  code?:
    | 'MISSING_SHOP_ID'
    | 'TABLE_REQUIRED'
    | 'EMPTY_CART'
    | 'INVALID_QUANTITY'
    | 'ITEM_UNAVAILABLE'
    | 'MISSING_REQUIRED_OPTIONS'
    | 'MISSING_IDEMPOTENCY_KEY';
  message: {
    vi: string;
    en: string;
  };
  missingGroups?: StaffOptionGroup[];
  offendingLineId?: string;
}

/** Standard takeaway labels recognized by server and table helpers. */
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
]);

/**
 * Checks whether a given string is a standard takeaway label.
 */
export function isTakeawayLabel(label?: string | null): boolean {
  const norm = (label ?? '').trim().toLowerCase();
  if (!norm) return false;
  return (
    TAKEAWAY_LABELS.has(norm) ||
    norm.startsWith('mang về') ||
    norm.startsWith('mang ve') ||
    norm.startsWith('takeaway') ||
    norm.startsWith('take away')
  );
}

/**
 * Resolves localized text with fallbacks: target locale -> vi -> en -> fallback.
 */
export function resolveI18nText(
  i18n?: Record<string, string> | null,
  locale = 'vi',
  fallback = ''
): string {
  if (!i18n || typeof i18n !== 'object') return fallback;
  const target = i18n[locale]?.trim();
  if (target) return target;
  const vi = i18n.vi?.trim();
  if (vi) return vi;
  const en = i18n.en?.trim();
  if (en) return en;
  const first = Object.values(i18n).find(
    (v) => typeof v === 'string' && v.trim()
  );
  return first ? first.trim() : fallback;
}

/**
 * Filters and sorts active, unarchived tables.
 */
export function filterActiveTables(tables: StaffTable[]): StaffTable[] {
  if (!Array.isArray(tables)) return [];
  return tables
    .filter((t) => t && t.is_archived !== true && t.is_active !== false)
    .sort((a, b) => {
      const orderA = typeof a.sort_order === 'number' ? a.sort_order : 999;
      const orderB = typeof b.sort_order === 'number' ? b.sort_order : 999;
      if (orderA !== orderB) return orderA - orderB;
      return (a.name || '').localeCompare(b.name || '');
    });
}

/**
 * Creates a table selection representing table service.
 */
export function createTableSelection(table: StaffTable): StaffTableSelection {
  return {
    kind: 'table',
    tableId: table.id,
    tableLabel: table.name || `Bàn ${table.table_code || table.id}`,
  };
}

/**
 * Creates a table selection representing takeaway without a fake table entity.
 */
export function createTakeawaySelection(
  customLabel?: string
): StaffTableSelection {
  return {
    kind: 'takeaway',
    tableId: null,
    tableLabel: customLabel?.trim() || 'Mang về',
  };
}

/**
 * Checks whether the current table selection represents takeaway.
 */
export function isTakeawaySelection(
  selection?: StaffTableSelection | null
): boolean {
  if (!selection) return false;
  if (selection.kind === 'takeaway') return true;
  return !selection.tableId && isTakeawayLabel(selection.tableLabel);
}

/**
 * Computes single item unit price (preview).
 */
export function calculateLineUnitPrice(item: StaffCatalogItem): number {
  return Math.max(0, Math.round(Number(item?.price || 0)));
}

/**
 * Computes extra price sum from selected options (preview).
 */
export function calculateLineExtraPrice(
  selectedChoices: StaffOptionChoice[]
): number {
  if (!Array.isArray(selectedChoices)) return 0;
  return selectedChoices.reduce((sum, c) => {
    return sum + Math.max(0, Math.round(Number(c?.extra_price || 0)));
  }, 0);
}

/**
 * Computes total price for a single line item (unit + extras) * quantity.
 */
export function calculateLineTotal(
  item: StaffCatalogItem,
  selectedChoices: StaffOptionChoice[],
  quantity: number
): number {
  const unit = calculateLineUnitPrice(item);
  const extra = calculateLineExtraPrice(selectedChoices);
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  return (unit + extra) * qty;
}

/**
 * Computes total preview amount for all lines in cart.
 */
export function calculateCartSubtotal(cart: StaffCartLine[]): number {
  if (!Array.isArray(cart)) return 0;
  return cart.reduce((total, line) => {
    return (
      total +
      calculateLineTotal(line.item, line.selectedChoices, line.quantity)
    );
  }, 0);
}

/**
 * Computes total item count (sum of quantities) in cart.
 */
export function calculateCartItemCount(cart: StaffCartLine[]): number {
  if (!Array.isArray(cart)) return 0;
  return cart.reduce((sum, line) => {
    return sum + Math.max(0, Math.floor(Number(line.quantity) || 0));
  }, 0);
}

/**
 * Returns default selections for required option groups (first choice of each).
 */
export function getDefaultOptionChoices(
  item: StaffCatalogItem
): StaffOptionChoice[] {
  const defaults: StaffOptionChoice[] = [];
  const groups = Array.isArray(item.options_json) ? item.options_json : [];
  for (const group of groups) {
    if (group.required && Array.isArray(group.choices) && group.choices.length > 0) {
      defaults.push(group.choices[0]);
    }
  }
  return defaults;
}

/**
 * Checks whether an item satisfies all required option groups.
 */
export function validateItemRequiredOptions(
  item: StaffCatalogItem,
  selectedChoices: StaffOptionChoice[]
): { valid: boolean; missingGroups: StaffOptionGroup[] } {
  const groups = Array.isArray(item.options_json) ? item.options_json : [];
  const missingGroups: StaffOptionGroup[] = [];
  const choiceIdSet = new Set(
    (selectedChoices || []).map((c) => String(c.id || '').trim().toLowerCase())
  );

  for (const group of groups) {
    if (group.required) {
      const groupChoiceIds = (group.choices || []).map((c) =>
        String(c.id || '').trim().toLowerCase()
      );
      const hasChoice = groupChoiceIds.some((id) => choiceIdSet.has(id));
      if (!hasChoice) {
        missingGroups.push(group);
      }
    }
  }

  return {
    valid: missingGroups.length === 0,
    missingGroups,
  };
}

/**
 * Handles toggling an option choice in a list of selected choices.
 * - If group is required: replaces previous choice in the same group (single-select).
 * - If group is optional: toggles the choice on or off (multi-select).
 */
export function toggleOptionChoice(
  currentChoices: StaffOptionChoice[],
  group: StaffOptionGroup,
  choice: StaffOptionChoice
): StaffOptionChoice[] {
  const groupChoiceIds = new Set(
    (group.choices || []).map((c) => String(c.id || '').trim().toLowerCase())
  );
  const choiceId = String(choice.id || '').trim().toLowerCase();
  const existingInGroup = currentChoices.filter((c) =>
    groupChoiceIds.has(String(c.id || '').trim().toLowerCase())
  );
  const otherGroupsChoices = currentChoices.filter(
    (c) => !groupChoiceIds.has(String(c.id || '').trim().toLowerCase())
  );

  if (group.required) {
    // Single choice replacement within this group
    return [...otherGroupsChoices, choice];
  }

  // Multi-select toggle
  const isAlreadySelected = existingInGroup.some(
    (c) => String(c.id || '').trim().toLowerCase() === choiceId
  );
  if (isAlreadySelected) {
    return [
      ...otherGroupsChoices,
      ...existingInGroup.filter(
        (c) => String(c.id || '').trim().toLowerCase() !== choiceId
      ),
    ];
  }
  return [...otherGroupsChoices, ...existingInGroup, choice];
}

/**
 * Generates a stable client-side line item identifier.
 */
let lineCounter = 0;
export function createLineId(itemId: string): string {
  lineCounter += 1;
  return `line-${itemId}-${Date.now().toString(36)}-${lineCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Generates a stable fallback idempotency key if parent doesn't supply one.
 */
export function generateAssistedOrderIdempotencyKey(shopId: string): string {
  return `assist-${shopId.replace(/[^a-zA-Z0-9_-]/g, '')}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Creates a new cart line item.
 */
export function createCartLine(
  item: StaffCatalogItem,
  quantity = 1,
  selectedChoices?: StaffOptionChoice[],
  customNote = ''
): StaffCartLine {
  return {
    lineId: createLineId(item.id),
    item,
    quantity: Math.max(1, Math.floor(quantity)),
    selectedChoices: selectedChoices || getDefaultOptionChoices(item),
    customNote: (customNote || '').trim(),
  };
}

/**
 * Updates quantity of a cart line; removes line if quantity becomes <= 0.
 */
export function updateCartLineQuantity(
  cart: StaffCartLine[],
  lineId: string,
  newQuantity: number
): StaffCartLine[] {
  if (newQuantity <= 0) {
    return cart.filter((l) => l.lineId !== lineId);
  }
  const cleanQty = Math.min(999, Math.floor(newQuantity));
  return cart.map((l) => (l.lineId === lineId ? { ...l, quantity: cleanQty } : l));
}

/**
 * Removes a line item from the cart.
 */
export function removeCartLine(
  cart: StaffCartLine[],
  lineId: string
): StaffCartLine[] {
  return cart.filter((l) => l.lineId !== lineId);
}

/**
 * Validates the order draft prior to submission.
 */
export function validateAssistedOrderDraft(params: {
  shopId: string;
  table: StaffTableSelection | null;
  cart: StaffCartLine[];
  idempotencyKey?: string;
}): DraftValidationResult {
  const shopId = (params.shopId || '').trim();
  if (!shopId) {
    return {
      ok: false,
      code: 'MISSING_SHOP_ID',
      message: {
        vi: 'Thiếu mã cửa hàng (shopId).',
        en: 'Missing shop identifier (shopId).',
      },
    };
  }

  if (!params.table) {
    return {
      ok: false,
      code: 'TABLE_REQUIRED',
      message: {
        vi: 'Vui lòng chọn bàn đang hoạt động hoặc chọn Mang về trước khi gửi đơn.',
        en: 'Please select an active table or Takeaway before sending the order.',
      },
    };
  }

  const tableLabel = (params.table.tableLabel || '').trim();
  if (!tableLabel) {
    return {
      ok: false,
      code: 'TABLE_REQUIRED',
      message: {
        vi: 'Tên bàn hoặc nhãn bàn không hợp lệ.',
        en: 'Invalid table label.',
      },
    };
  }

  if (!Array.isArray(params.cart) || params.cart.length === 0) {
    return {
      ok: false,
      code: 'EMPTY_CART',
      message: {
        vi: 'Giỏ hàng đang trống. Vui lòng thêm ít nhất một món.',
        en: 'Cart is empty. Please add at least one item.',
      },
    };
  }

  for (const line of params.cart) {
    const rawQty = Number(line.quantity);
    if (!Number.isFinite(rawQty) || !Number.isInteger(rawQty) || rawQty < 1 || rawQty > 999) {
      return {
        ok: false,
        code: 'INVALID_QUANTITY',
        offendingLineId: line.lineId,
        message: {
          vi: `Số lượng món "${resolveI18nText(line.item.name_i18n, 'vi', 'Món')}" phải là số nguyên từ 1 đến 999.`,
          en: `Quantity for "${resolveI18nText(line.item.name_i18n, 'en', 'Item')}" must be between 1 and 999.`,
        },
      };
    }

    if (line.item.is_available === false) {
      return {
        ok: false,
        code: 'ITEM_UNAVAILABLE',
        offendingLineId: line.lineId,
        message: {
          vi: `Món "${resolveI18nText(line.item.name_i18n, 'vi', 'Món')}" hiện đã tạm hết hàng.`,
          en: `Item "${resolveI18nText(line.item.name_i18n, 'en', 'Item')}" is currently unavailable.`,
        },
      };
    }

    const optionCheck = validateItemRequiredOptions(
      line.item,
      line.selectedChoices
    );
    if (!optionCheck.valid) {
      const groupNamesVi = optionCheck.missingGroups
        .map((g) => resolveI18nText(g.name_i18n, 'vi'))
        .join(', ');
      const groupNamesEn = optionCheck.missingGroups
        .map((g) => resolveI18nText(g.name_i18n, 'en'))
        .join(', ');
      return {
        ok: false,
        code: 'MISSING_REQUIRED_OPTIONS',
        missingGroups: optionCheck.missingGroups,
        offendingLineId: line.lineId,
        message: {
          vi: `Món "${resolveI18nText(line.item.name_i18n, 'vi', 'Món')}" chưa chọn đủ tùy chọn bắt buộc: ${groupNamesVi}.`,
          en: `Item "${resolveI18nText(line.item.name_i18n, 'en', 'Item')}" is missing required options: ${groupNamesEn}.`,
        },
      };
    }
  }

  const idempKey = (params.idempotencyKey || '').trim();
  if (params.idempotencyKey !== undefined && !idempKey) {
    return {
      ok: false,
      code: 'MISSING_IDEMPOTENCY_KEY',
      message: {
        vi: 'Khóa chống trùng đơn (idempotencyKey) không hợp lệ.',
        en: 'Invalid idempotency key.',
      },
    };
  }

  return {
    ok: true,
    message: { vi: '', en: '' },
  };
}

/**
 * Builds the canonical POST /api/orders payload for counter_pos assisted orders.
 *
 * Strict invariants:
 * - Omits payment_status, payment_method, paid_by, paid_at. The server must keep payment unpaid.
 * - Omits discount_amount, discount_code, promo_discount_amount, manual_discount_amount.
 * - Omits fulfillment transitions (status, workflow_step_id).
 * - Omits forbidden customer fields (customer_name, top-level notes).
 * - Uses exact line fields: item_id, name_vi, optional name_i18n, quantity, unit_price, extra_price, selected_choices, custom_note.
 */
export function buildAssistedOrderPayload(params: {
  shopId: string;
  table: StaffTableSelection;
  cart: StaffCartLine[];
  idempotencyKey: string;
  visitorLang?: string;
}): AssistedOrderPayload {
  const validation = validateAssistedOrderDraft({
    shopId: params.shopId,
    table: params.table,
    cart: params.cart,
    idempotencyKey: params.idempotencyKey,
  });

  if (!validation.ok) {
    const error = new Error(validation.message.vi);
    (error as Error & { code?: string }).code = validation.code;
    throw error;
  }

  const isTakeaway = isTakeawaySelection(params.table);
  const resolvedTableId = isTakeaway ? null : params.table.tableId;
  const resolvedTableLabel = params.table.tableLabel.trim();

  const linesPayload: AssistedOrderLinePayload[] = params.cart.map((line) => {
    const item = line.item;
    const nameVi = resolveI18nText(item.name_i18n, 'vi', 'Món');
    const unitPrice = calculateLineUnitPrice(item);
    const extraPrice = calculateLineExtraPrice(line.selectedChoices);

    const choicesPayload = (line.selectedChoices || []).map((c) => ({
      id: String(c.id || '').trim(),
      label_i18n: c.label_i18n || {
        vi: c.label_vi || String(c.id || '').trim(),
      },
      extra_price: Math.max(0, Math.round(Number(c.extra_price || 0))),
    }));

    const linePayload: AssistedOrderLinePayload = {
      item_id: String(item.id || '').trim(),
      name_vi: nameVi,
      quantity: Math.max(1, Math.floor(Number(line.quantity))),
      unit_price: unitPrice,
      extra_price: extraPrice,
      selected_choices: choicesPayload,
    };

    if (item.name_i18n && typeof item.name_i18n === 'object') {
      linePayload.name_i18n = item.name_i18n;
    }

    const trimmedNote = (line.customNote || '').trim();
    if (trimmedNote) {
      linePayload.custom_note = trimmedNote;
    }

    return linePayload;
  });

  return {
    shop_id: params.shopId.trim(),
    source: 'counter_pos',
    table_id: resolvedTableId,
    table_label: resolvedTableLabel,
    visitor_lang: (params.visitorLang || 'vi').trim(),
    idempotency_key: params.idempotencyKey.trim(),
    items: linesPayload,
  };
}

/**
 * Asserts that the payload strictly adheres to the invariant:
 * - NO payment confirmation fields
 * - NO discount mutation fields
 * - NO order status / fulfillment mutation fields
 * - NO custom prices
 * - NO forbidden legacy fields
 */
export function assertNoForbiddenMutationFields(payload: unknown): void {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload must be an object');
  }

  const forbiddenTopLevelKeys = [
    'payment_status',
    'payment_method',
    'paid_at',
    'paid_by',
    'payment_reference',
    'payment_idempotency_key',
    'cash_received',
    'change_due',
    'status',
    'workflow_step_id',
    'markCompletedImmediately',
    'discount_amount',
    'discount_code',
    'promo_discount_amount',
    'manual_discount_amount',
    'voucher_code',
    'expected_total',
    'subtotal_amount',
    'total_amount',
    'notes', // must not use top-level notes
    'customer_name', // must not use customer_name
    'selected_options', // must use selected_choices in lines
  ];

  const obj = payload as Record<string, unknown>;
  for (const key of forbiddenTopLevelKeys) {
    if (obj[key] !== undefined) {
      throw new Error(`FORBIDDEN_MUTATION_FIELD: Top-level "${key}" is strictly forbidden in assisted order payload.`);
    }
  }

  const forbiddenLineKeys = [
    'discount_percent',
    'line_discount_amount',
    'custom_unit_price',
    'catalog_unit_price',
  ];

  if (Array.isArray(obj.items)) {
    for (let i = 0; i < obj.items.length; i++) {
      const line = obj.items[i] as Record<string, unknown>;
      for (const key of forbiddenLineKeys) {
        if (line[key] !== undefined) {
          throw new Error(
            `FORBIDDEN_MUTATION_FIELD: Line item ${i} contains forbidden price override field "${key}".`
          );
        }
      }
      if (line.selected_options !== undefined) {
        throw new Error(
          `FORBIDDEN_LINE_FIELD: Line item ${i} contains "selected_options"; must use "selected_choices".`
        );
      }
    }
  }
}
