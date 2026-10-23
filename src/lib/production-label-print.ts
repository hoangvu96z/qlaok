import {
  cloneLabelPrintConfig,
  validateLabelPrintConfig,
} from '@/lib/label-print-config';
import type {
  ItemOptionChoice,
  LabelPaperPreset,
  LabelSplitMode,
  OrderLineItem,
  ShopLabelPrintConfig,
  ShopOrder,
} from '@/types/qlaok';

/**
 * A single printed label ready for production output.
 * Fully pure and detached from browser APIs, React, or time-based IDs.
 */
export interface ProductionLabel {
  /** Deterministic identifier for this printed label */
  id: string;
  /** 1-based sequence index in the print batch (1..total_labels) */
  label_index: number;
  sequence_number: number;
  /** Total number of printed labels in the print batch */
  total_labels: number;
  sequence_total: number;
  /** 1-based index among unique logical labels (1..logical_label_total) */
  logical_label_index: number;
  /** Total number of unique logical labels in this batch */
  logical_label_total: number;
  /** 1-based copy number for this logical label (1..copy_total) */
  copy_number: number;
  copy_index: number;
  /** Total number of copies per logical label (equals copies_per_unit) */
  copy_total: number;
  total_copies: number;
  /** Split mode used for generating this label */
  split_mode: LabelSplitMode;
  /** Paper preset configured for printing */
  paper_preset: LabelPaperPreset;
  /** Cloned order line item(s) on this label */
  items: OrderLineItem[];
  /** Associated order information */
  order_id: string;
  order_code: string;
  table_label: string;
  customer_note?: string;
  created_at: string;
  visitor_lang?: string;
  source?: 'qr_table' | 'counter_pos';
  /** Unit index if per_item_unit (1..unit_total), else 1 */
  unit_index?: number;
  /** Unit total for this line item if per_item_unit, else items[0]?.quantity */
  unit_total?: number;
  /** Original zero-based index of line in order.items (for per_item_unit and per_line_item) */
  source_line_index?: number;
  /** Cloned snapshot of the active label print configuration */
  config: ShopLabelPrintConfig;
}

export type ProductionLabelBatchErrorCode =
  | 'CONFIG_DISABLED'
  | 'EMPTY_ORDER'
  | 'INVALID_CONFIG'
  | 'INVALID_QUANTITY'
  | 'EXCEEDS_MAX_LABELS'
  | 'INVALID_ORDER';

export type ProductionLabelBatchErrorStatus =
  | 'disabled'
  | 'empty_order'
  | 'invalid_config'
  | 'invalid_quantity'
  | 'over_limit'
  | 'invalid_order';

export interface ProductionLabelBatchSuccess {
  ok: true;
  success: true;
  status: 'success';
  code?: undefined;
  error?: undefined;
  reason?: undefined;
  labels: ProductionLabel[];
  total_labels: number;
  totalLabels: number;
  logical_label_total: number;
  logicalLabelTotal: number;
  copies_per_unit: number;
  copiesPerUnit: number;
  split_mode: LabelSplitMode;
  splitMode: LabelSplitMode;
  paper_preset: LabelPaperPreset;
  paperPreset: LabelPaperPreset;
  order_id: string;
  order_code: string;
  config: ShopLabelPrintConfig;
}

export interface ProductionLabelBatchOverLimitError {
  ok: false;
  success: false;
  status: 'over_limit';
  code: 'EXCEEDS_MAX_LABELS';
  error: string;
  reason: string;
  labels: ProductionLabel[];
  requested_count: number;
  max_count: number;
  requestedCount: number;
  maxCount: number;
}

export interface ProductionLabelBatchGenericError {
  ok: false;
  success: false;
  status: Exclude<ProductionLabelBatchErrorStatus, 'over_limit'>;
  code: Exclude<ProductionLabelBatchErrorCode, 'EXCEEDS_MAX_LABELS'>;
  error: string;
  reason: string;
  labels: ProductionLabel[];
  requested_count?: undefined;
  max_count?: undefined;
  requestedCount?: undefined;
  maxCount?: undefined;
}

export type ProductionLabelBatchError =
  | ProductionLabelBatchOverLimitError
  | ProductionLabelBatchGenericError;

export type ProductionLabelBatchResult =
  | ProductionLabelBatchSuccess
  | ProductionLabelBatchError;

export interface BuildProductionLabelBatchParams {
  order: ShopOrder;
  config: ShopLabelPrintConfig;
}

function cloneItemOptionChoice(choice: ItemOptionChoice): ItemOptionChoice {
  return {
    ...choice,
    label_i18n: choice.label_i18n ? { ...choice.label_i18n } : { vi: '', en: '' },
    desc_i18n: choice.desc_i18n ? { ...choice.desc_i18n } : undefined,
  };
}

function cloneOrderLineItem(
  item: OrderLineItem,
  overrideQuantity?: number
): OrderLineItem {
  return {
    ...item,
    quantity: overrideQuantity !== undefined ? overrideQuantity : item.quantity,
    name_i18n: item.name_i18n ? { ...item.name_i18n } : undefined,
    selected_choices: Array.isArray(item.selected_choices)
      ? item.selected_choices.map(cloneItemOptionChoice)
      : [],
    quick_tags: Array.isArray(item.quick_tags) ? [...item.quick_tags] : undefined,
  };
}

/**
 * Computes the total required labels for an order given split mode and copies per unit.
 * Returns null if the order or line items have invalid quantities.
 */
export function computeRequiredLabelCount(
  items: ReadonlyArray<Pick<OrderLineItem, 'quantity'>>,
  splitMode: LabelSplitMode,
  copiesPerUnit: number
): number | null {
  if (!Array.isArray(items) || items.length === 0) return 0;
  if (!Number.isSafeInteger(copiesPerUnit) || copiesPerUnit <= 0) return null;

  for (const item of items) {
    if (
      !item ||
      typeof item.quantity !== 'number' ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity <= 0
    ) {
      return null;
    }
  }

  let logicalCount = 0;
  if (splitMode === 'single_ticket') {
    logicalCount = 1;
  } else if (splitMode === 'per_line_item') {
    logicalCount = items.length;
  } else if (splitMode === 'per_item_unit') {
    for (const item of items) {
      logicalCount += item.quantity;
      if (!Number.isSafeInteger(logicalCount)) return null;
    }
  } else {
    return null;
  }

  const total = logicalCount * copiesPerUnit;
  return Number.isSafeInteger(total) ? total : null;
}

/**
 * Pure builder function that expands one saved ShopOrder into the exact
 * print batch using its saved ShopLabelPrintConfig.
 *
 * Fails closed on disabled config, empty order, invalid config, or invalid quantities.
 * Returns an over-limit result with no partial labels if requested count exceeds max_labels_per_print.
 */
export function buildProductionLabelBatch(
  params: BuildProductionLabelBatchParams
): ProductionLabelBatchResult;
export function buildProductionLabelBatch(
  order: ShopOrder,
  config: ShopLabelPrintConfig
): ProductionLabelBatchResult;
export function buildProductionLabelBatch(
  orderOrParams: ShopOrder | BuildProductionLabelBatchParams,
  configParam?: ShopLabelPrintConfig
): ProductionLabelBatchResult {
  let order: ShopOrder;
  let rawConfig: ShopLabelPrintConfig;

  if (
    orderOrParams &&
    typeof orderOrParams === 'object' &&
    'order' in orderOrParams &&
    'config' in orderOrParams &&
    configParam === undefined
  ) {
    order = (orderOrParams as BuildProductionLabelBatchParams).order;
    rawConfig = (orderOrParams as BuildProductionLabelBatchParams).config;
  } else {
    order = orderOrParams as ShopOrder;
    rawConfig = configParam as ShopLabelPrintConfig;
  }

  // 1. Basic validation of inputs
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    return {
      ok: false,
      success: false,
      status: 'invalid_config',
      code: 'INVALID_CONFIG',
      error: 'Label print configuration must be a valid object.',
      reason: 'Label print configuration must be a valid object.',
      labels: [],
    };
  }

  if (!order || typeof order !== 'object' || Array.isArray(order)) {
    return {
      ok: false,
      success: false,
      status: 'invalid_order',
      code: 'INVALID_ORDER',
      error: 'Order must be a valid object.',
      reason: 'Order must be a valid object.',
      labels: [],
    };
  }

  // 2. Validate configuration
  const validation = validateLabelPrintConfig(rawConfig);
  if (!validation.valid) {
    const errorMsg =
      validation.errors.map((e) => e.message).join('; ') ||
      'Invalid label print configuration.';
    return {
      ok: false,
      success: false,
      status: 'invalid_config',
      code: 'INVALID_CONFIG',
      error: errorMsg,
      reason: errorMsg,
      labels: [],
    };
  }

  const config = validation.config;

  // 3. Fail closed if disabled
  if (!config.enabled) {
    return {
      ok: false,
      success: false,
      status: 'disabled',
      code: 'CONFIG_DISABLED',
      error: 'Label printing is disabled in configuration.',
      reason: 'Label printing is disabled in configuration.',
      labels: [],
    };
  }

  // 4. Fail closed if order has no items
  if (!Array.isArray(order.items) || order.items.length === 0) {
    return {
      ok: false,
      success: false,
      status: 'empty_order',
      code: 'EMPTY_ORDER',
      error: 'Order has no items to print.',
      reason: 'Order has no items to print.',
      labels: [],
    };
  }

  // 5. Fail closed for invalid quantities / items
  for (let i = 0; i < order.items.length; i++) {
    const item = order.items[i];
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.quantity !== 'number' ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity <= 0
    ) {
      return {
        ok: false,
        success: false,
        status: 'invalid_quantity',
        code: 'INVALID_QUANTITY',
        error: `Item at line ${i + 1} has an invalid quantity. Quantities must be positive safe integers.`,
        reason: `Item at line ${i + 1} has an invalid quantity. Quantities must be positive safe integers.`,
        labels: [],
      };
    }
  }

  // 6. Compute requested count safely before allocating labels
  let logicalLabelCount = 0;
  if (config.split_mode === 'single_ticket') {
    logicalLabelCount = 1;
  } else if (config.split_mode === 'per_line_item') {
    logicalLabelCount = order.items.length;
  } else if (config.split_mode === 'per_item_unit') {
    for (const item of order.items) {
      if (!Number.isSafeInteger(logicalLabelCount + item.quantity)) {
        return {
          ok: false,
          success: false,
          status: 'invalid_quantity',
          code: 'INVALID_QUANTITY',
          error: 'Total item units exceed safe integer limit.',
          reason: 'Total item units exceed safe integer limit.',
          labels: [],
        };
      }
      logicalLabelCount += item.quantity;
    }
  } else {
    return {
      ok: false,
      success: false,
      status: 'invalid_config',
      code: 'INVALID_CONFIG',
      error: `Unsupported label split mode: ${String(config.split_mode)}`,
      reason: `Unsupported label split mode: ${String(config.split_mode)}`,
      labels: [],
    };
  }

  const requestedCount = logicalLabelCount * config.copies_per_unit;
  if (!Number.isSafeInteger(requestedCount)) {
    return {
      ok: false,
      success: false,
      status: 'over_limit',
      code: 'EXCEEDS_MAX_LABELS',
      requested_count: Number.POSITIVE_INFINITY,
      max_count: config.max_labels_per_print,
      requestedCount: Number.POSITIVE_INFINITY,
      maxCount: config.max_labels_per_print,
      error: 'Requested labels calculation overflowed safe integer limits.',
      reason: 'Requested labels calculation overflowed safe integer limits.',
      labels: [],
    };
  }

  // Check boundary against max_labels_per_print
  if (requestedCount > config.max_labels_per_print) {
    return {
      ok: false,
      success: false,
      status: 'over_limit',
      code: 'EXCEEDS_MAX_LABELS',
      requested_count: requestedCount,
      max_count: config.max_labels_per_print,
      requestedCount: requestedCount,
      maxCount: config.max_labels_per_print,
      error: `Requested label count (${requestedCount}) exceeds maximum allowed per print (${config.max_labels_per_print}).`,
      reason: `Requested label count (${requestedCount}) exceeds maximum allowed per print (${config.max_labels_per_print}).`,
      labels: [],
    };
  }

  // 7. Allocate labels
  const labels: ProductionLabel[] = [];
  const copiesPerUnit = config.copies_per_unit;
  const paperPreset = config.paper_preset;
  const orderId = typeof order.id === 'string' ? order.id : '';
  const orderCode = typeof order.order_code === 'string' ? order.order_code : '';
  const tableLabel = typeof order.table_label === 'string' ? order.table_label : '';
  const createdAt = typeof order.created_at === 'string' ? order.created_at : '';
  const customerNote = order.customer_note;
  const visitorLang = order.visitor_lang;
  const source = order.source;
  const prefixId = orderCode || orderId || 'order';

  let currentLabelIndex = 1;

  if (config.split_mode === 'single_ticket') {
    for (let copyIndex = 1; copyIndex <= copiesPerUnit; copyIndex++) {
      const clonedItems = order.items.map((item) => cloneOrderLineItem(item));
      labels.push({
        id: `${prefixId}-ticket-copy${copyIndex}-${currentLabelIndex}`,
        label_index: currentLabelIndex,
        sequence_number: currentLabelIndex,
        total_labels: requestedCount,
        sequence_total: requestedCount,
        logical_label_index: 1,
        logical_label_total: 1,
        copy_number: copyIndex,
        copy_index: copyIndex,
        copy_total: copiesPerUnit,
        total_copies: copiesPerUnit,
        split_mode: 'single_ticket',
        paper_preset: paperPreset,
        items: clonedItems,
        order_id: orderId,
        order_code: orderCode,
        table_label: tableLabel,
        customer_note: customerNote,
        created_at: createdAt,
        visitor_lang: visitorLang,
        source: source,
        config: cloneLabelPrintConfig(config),
      });
      currentLabelIndex++;
    }
  } else if (config.split_mode === 'per_line_item') {
    for (let lineIndex = 0; lineIndex < order.items.length; lineIndex++) {
      const originalItem = order.items[lineIndex];
      const logicalIndex = lineIndex + 1;

      for (let copyIndex = 1; copyIndex <= copiesPerUnit; copyIndex++) {
        const clonedItems = [cloneOrderLineItem(originalItem)];
        labels.push({
          id: `${prefixId}-line${logicalIndex}-copy${copyIndex}-${currentLabelIndex}`,
          label_index: currentLabelIndex,
          sequence_number: currentLabelIndex,
          total_labels: requestedCount,
          sequence_total: requestedCount,
          logical_label_index: logicalIndex,
          logical_label_total: order.items.length,
          copy_number: copyIndex,
          copy_index: copyIndex,
          copy_total: copiesPerUnit,
          total_copies: copiesPerUnit,
          split_mode: 'per_line_item',
          paper_preset: paperPreset,
          items: clonedItems,
          order_id: orderId,
          order_code: orderCode,
          table_label: tableLabel,
          customer_note: customerNote,
          created_at: createdAt,
          visitor_lang: visitorLang,
          source: source,
          unit_index: 1,
          unit_total: originalItem.quantity,
          source_line_index: lineIndex,
          config: cloneLabelPrintConfig(config),
        });
        currentLabelIndex++;
      }
    }
  } else if (config.split_mode === 'per_item_unit') {
    let logicalIndex = 1;
    for (let lineIndex = 0; lineIndex < order.items.length; lineIndex++) {
      const originalItem = order.items[lineIndex];

      for (let unitIndex = 1; unitIndex <= originalItem.quantity; unitIndex++) {
        for (let copyIndex = 1; copyIndex <= copiesPerUnit; copyIndex++) {
          const clonedItems = [cloneOrderLineItem(originalItem, 1)];
          labels.push({
            id: `${prefixId}-unit${logicalIndex}-copy${copyIndex}-${currentLabelIndex}`,
            label_index: currentLabelIndex,
            sequence_number: currentLabelIndex,
            total_labels: requestedCount,
            sequence_total: requestedCount,
            logical_label_index: logicalIndex,
            logical_label_total: logicalLabelCount,
            copy_number: copyIndex,
            copy_index: copyIndex,
            copy_total: copiesPerUnit,
            total_copies: copiesPerUnit,
            split_mode: 'per_item_unit',
            paper_preset: paperPreset,
            items: clonedItems,
            order_id: orderId,
            order_code: orderCode,
            table_label: tableLabel,
            customer_note: customerNote,
            created_at: createdAt,
            visitor_lang: visitorLang,
            source: source,
            unit_index: unitIndex,
            unit_total: originalItem.quantity,
            source_line_index: lineIndex,
            config: cloneLabelPrintConfig(config),
          });
          currentLabelIndex++;
        }
        logicalIndex++;
      }
    }
  }

  return {
    ok: true,
    success: true,
    status: 'success',
    labels,
    total_labels: labels.length,
    totalLabels: labels.length,
    logical_label_total: logicalLabelCount,
    logicalLabelTotal: logicalLabelCount,
    copies_per_unit: copiesPerUnit,
    copiesPerUnit: copiesPerUnit,
    split_mode: config.split_mode,
    splitMode: config.split_mode,
    paper_preset: config.paper_preset,
    paperPreset: config.paper_preset,
    order_id: orderId,
    order_code: orderCode,
    config: cloneLabelPrintConfig(config),
  };
}
