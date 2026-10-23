import type {
  I18nText,
  LabelPaperPreset,
  LabelSplitMode,
  ShopLabelPrintConfig,
  ShopThemeConfig,
  SupportedLocale,
} from '@/types/qlaok';

export type { LabelPaperPreset, LabelSplitMode };

export const VALID_LABEL_PAPER_PRESETS: readonly LabelPaperPreset[] = [
  'cup_sticker_50x30',
  'cup_sticker_40x30',
  'production_slip_58mm',
  'production_slip_80mm',
] as const;

export const VALID_LABEL_SPLIT_MODES: readonly LabelSplitMode[] = [
  'per_item_unit',
  'per_line_item',
  'single_ticket',
] as const;

export const MIN_LABEL_COPIES_PER_UNIT = 1;
export const MAX_LABEL_COPIES_PER_UNIT = 5;
export const MIN_MAX_LABELS_PER_PRINT = 1;
export const MAX_MAX_LABELS_PER_PRINT = 100;
export const DEFAULT_MAX_LABELS_PER_PRINT = 50;
export const MAX_LABEL_FOOTER_LENGTH = 120;

export interface LabelPaperPresetSpec {
  id: LabelPaperPreset;
  width_mm: number;
  height_mm: number | null;
  is_sticker: boolean;
  default_split_mode: LabelSplitMode;
  label_i18n: I18nText;
}

export const LABEL_PAPER_PRESET_SPECS: Record<
  LabelPaperPreset,
  LabelPaperPresetSpec
> = {
  cup_sticker_50x30: {
    id: 'cup_sticker_50x30',
    width_mm: 50,
    height_mm: 30,
    is_sticker: true,
    default_split_mode: 'per_item_unit',
    label_i18n: {
      vi: 'Tem dán ly 50×30mm',
      en: 'Cup Sticker 50×30mm',
    },
  },
  cup_sticker_40x30: {
    id: 'cup_sticker_40x30',
    width_mm: 40,
    height_mm: 30,
    is_sticker: true,
    default_split_mode: 'per_item_unit',
    label_i18n: {
      vi: 'Tem dán ly 40×30mm',
      en: 'Cup Sticker 40×30mm',
    },
  },
  production_slip_58mm: {
    id: 'production_slip_58mm',
    width_mm: 58,
    height_mm: null,
    is_sticker: false,
    default_split_mode: 'per_line_item',
    label_i18n: {
      vi: 'Phiếu pha chế 58mm',
      en: 'Production Slip 58mm',
    },
  },
  production_slip_80mm: {
    id: 'production_slip_80mm',
    width_mm: 80,
    height_mm: null,
    is_sticker: false,
    default_split_mode: 'single_ticket',
    label_i18n: {
      vi: 'Phiếu pha chế 80mm',
      en: 'Production Slip 80mm',
    },
  },
};

export const DEFAULT_SHOP_LABEL_PRINT_CONFIG: ShopLabelPrintConfig = {
  enabled: true,
  paper_preset: 'cup_sticker_50x30',
  split_mode: 'per_item_unit',
  copies_per_unit: 1,
  max_labels_per_print: DEFAULT_MAX_LABELS_PER_PRINT,
  show_shop_name: true,
  show_order_code: true,
  show_table_label: true,
  show_item_name: true,
  show_item_options: true,
  show_item_note: true,
  show_order_note: false,
  show_sequence_counter: true,
  show_timestamp: true,
  show_price: false,
  show_payment_qr: false,
  custom_footer_i18n: {
    vi: '',
    en: '',
  },
};

export function getDefaultShopLabelPrintConfig(): ShopLabelPrintConfig {
  return {
    ...DEFAULT_SHOP_LABEL_PRINT_CONFIG,
    custom_footer_i18n: {
      vi: DEFAULT_SHOP_LABEL_PRINT_CONFIG.custom_footer_i18n?.vi ?? '',
      en: DEFAULT_SHOP_LABEL_PRINT_CONFIG.custom_footer_i18n?.en ?? '',
    },
  };
}

export interface LabelPrintConfigValidationError {
  code:
    | 'INVALID_CONFIG_OBJECT'
    | 'FORBIDDEN_LABEL_CONFIG_FIELD'
    | 'INVALID_PAPER_PRESET'
    | 'INVALID_SPLIT_MODE'
    | 'INVALID_COPIES_PER_UNIT'
    | 'INVALID_MAX_LABELS_PER_PRINT'
    | 'INVALID_BOOLEAN_FLAG'
    | 'INVALID_CUSTOM_FOOTER'
    | 'CUSTOM_FOOTER_TOO_LONG'
    | 'UNSAFE_CUSTOM_FOOTER';
  field: string;
  message: string;
}

export type LabelPrintConfigValidationResult =
  | {
      valid: true;
      config: ShopLabelPrintConfig;
      errors: [];
    }
  | {
      valid: false;
      config: null;
      errors: LabelPrintConfigValidationError[];
    };

const FORBIDDEN_LABEL_KEYS = new Set([
  'payment_status',
  'payment_method',
  'mark_paid',
  'auto_pay',
  'collect_payment',
  'status',
  'customer_name',
  'show_customer_name',
]);

const BOOLEAN_TOGGLE_KEYS: ReadonlyArray<
  keyof Pick<
    ShopLabelPrintConfig,
    | 'enabled'
    | 'show_shop_name'
    | 'show_order_code'
    | 'show_table_label'
    | 'show_item_name'
    | 'show_item_options'
    | 'show_item_note'
    | 'show_order_note'
    | 'show_sequence_counter'
    | 'show_timestamp'
    | 'show_price'
    | 'show_payment_qr'
  >
> = [
  'enabled',
  'show_shop_name',
  'show_order_code',
  'show_table_label',
  'show_item_name',
  'show_item_options',
  'show_item_note',
  'show_order_note',
  'show_sequence_counter',
  'show_timestamp',
  'show_price',
  'show_payment_qr',
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasUnsafeControlOrMarkup(text: string): boolean {
  if (/[<>]/.test(text)) return true;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if ((code >= 0 && code <= 8) || (code >= 11 && code <= 31) || code === 127) {
      return true;
    }
  }
  return false;
}

export function resolveLabelLocalizedText(
  field: I18nText | undefined | null,
  locale: SupportedLocale = 'vi'
): string {
  if (!field) return '';
  return (
    field[locale]?.trim() ||
    field.vi?.trim() ||
    field.en?.trim() ||
    ''
  );
}

export function validateLabelPrintConfig(
  raw: unknown
): LabelPrintConfigValidationResult {
  if (!isPlainObject(raw)) {
    return {
      valid: false,
      config: null,
      errors: [
        {
          code: 'INVALID_CONFIG_OBJECT',
          field: 'labelPrintConfig',
          message: 'Label print configuration must be a plain object.',
        },
      ],
    };
  }

  const errors: LabelPrintConfigValidationError[] = [];

  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_LABEL_KEYS.has(key)) {
      errors.push({
        code: 'FORBIDDEN_LABEL_CONFIG_FIELD',
        field: key,
        message: `Field "${key}" is not permitted in ShopLabelPrintConfig.`,
      });
    }
  }

  const defaults = getDefaultShopLabelPrintConfig();

  let paperPreset: LabelPaperPreset = defaults.paper_preset;
  if (raw.paper_preset !== undefined) {
    if (
      typeof raw.paper_preset !== 'string' ||
      !VALID_LABEL_PAPER_PRESETS.includes(raw.paper_preset as LabelPaperPreset)
    ) {
      errors.push({
        code: 'INVALID_PAPER_PRESET',
        field: 'paper_preset',
        message: `paper_preset must be one of: ${VALID_LABEL_PAPER_PRESETS.join(', ')}.`,
      });
    } else {
      paperPreset = raw.paper_preset as LabelPaperPreset;
    }
  }

  let splitMode: LabelSplitMode = defaults.split_mode;
  if (raw.split_mode !== undefined) {
    if (
      typeof raw.split_mode !== 'string' ||
      !VALID_LABEL_SPLIT_MODES.includes(raw.split_mode as LabelSplitMode)
    ) {
      errors.push({
        code: 'INVALID_SPLIT_MODE',
        field: 'split_mode',
        message: `split_mode must be one of: ${VALID_LABEL_SPLIT_MODES.join(', ')}.`,
      });
    } else {
      splitMode = raw.split_mode as LabelSplitMode;
    }
  }

  let copiesPerUnit = defaults.copies_per_unit;
  if (raw.copies_per_unit !== undefined) {
    if (
      typeof raw.copies_per_unit !== 'number' ||
      !Number.isInteger(raw.copies_per_unit) ||
      raw.copies_per_unit < MIN_LABEL_COPIES_PER_UNIT ||
      raw.copies_per_unit > MAX_LABEL_COPIES_PER_UNIT
    ) {
      errors.push({
        code: 'INVALID_COPIES_PER_UNIT',
        field: 'copies_per_unit',
        message: `copies_per_unit must be an integer between ${MIN_LABEL_COPIES_PER_UNIT} and ${MAX_LABEL_COPIES_PER_UNIT}.`,
      });
    } else {
      copiesPerUnit = raw.copies_per_unit;
    }
  }

  let maxLabelsPerPrint = defaults.max_labels_per_print;
  if (raw.max_labels_per_print !== undefined) {
    if (
      typeof raw.max_labels_per_print !== 'number' ||
      !Number.isInteger(raw.max_labels_per_print) ||
      raw.max_labels_per_print < MIN_MAX_LABELS_PER_PRINT ||
      raw.max_labels_per_print > MAX_MAX_LABELS_PER_PRINT
    ) {
      errors.push({
        code: 'INVALID_MAX_LABELS_PER_PRINT',
        field: 'max_labels_per_print',
        message: `max_labels_per_print must be an integer between ${MIN_MAX_LABELS_PER_PRINT} and ${MAX_MAX_LABELS_PER_PRINT}.`,
      });
    } else {
      maxLabelsPerPrint = raw.max_labels_per_print;
    }
  }

  const booleans: Record<
    (typeof BOOLEAN_TOGGLE_KEYS)[number],
    boolean
  > = {
    enabled: defaults.enabled,
    show_shop_name: defaults.show_shop_name,
    show_order_code: defaults.show_order_code,
    show_table_label: defaults.show_table_label,
    show_item_name: defaults.show_item_name,
    show_item_options: defaults.show_item_options,
    show_item_note: defaults.show_item_note,
    show_order_note: defaults.show_order_note,
    show_sequence_counter: defaults.show_sequence_counter,
    show_timestamp: defaults.show_timestamp,
    show_price: defaults.show_price,
    show_payment_qr: defaults.show_payment_qr,
  };

  for (const key of BOOLEAN_TOGGLE_KEYS) {
    if (raw[key] !== undefined) {
      if (typeof raw[key] !== 'boolean') {
        errors.push({
          code: 'INVALID_BOOLEAN_FLAG',
          field: key,
          message: `Field "${key}" must be a boolean.`,
        });
      } else {
        booleans[key] = raw[key];
      }
    }
  }

  let customFooterI18n: I18nText = {
    vi: '',
    en: '',
  };

  if (raw.custom_footer_i18n !== undefined && raw.custom_footer_i18n !== null) {
    if (!isPlainObject(raw.custom_footer_i18n)) {
      errors.push({
        code: 'INVALID_CUSTOM_FOOTER',
        field: 'custom_footer_i18n',
        message: 'custom_footer_i18n must be an I18nText object.',
      });
    } else {
      const rawVi = raw.custom_footer_i18n.vi;
      const rawEn = raw.custom_footer_i18n.en;

      if (
        (rawVi !== undefined && typeof rawVi !== 'string') ||
        (rawEn !== undefined && typeof rawEn !== 'string')
      ) {
        errors.push({
          code: 'INVALID_CUSTOM_FOOTER',
          field: 'custom_footer_i18n',
          message: 'custom_footer_i18n.vi and custom_footer_i18n.en must be strings.',
        });
      } else {
        const trimmedVi = (rawVi ?? '').trim();
        const trimmedEn = (rawEn ?? '').trim();

        if (
          trimmedVi.length > MAX_LABEL_FOOTER_LENGTH ||
          trimmedEn.length > MAX_LABEL_FOOTER_LENGTH
        ) {
          errors.push({
            code: 'CUSTOM_FOOTER_TOO_LONG',
            field: 'custom_footer_i18n',
            message: `custom_footer_i18n text must not exceed ${MAX_LABEL_FOOTER_LENGTH} characters.`,
          });
        } else if (
          hasUnsafeControlOrMarkup(trimmedVi) ||
          hasUnsafeControlOrMarkup(trimmedEn)
        ) {
          errors.push({
            code: 'UNSAFE_CUSTOM_FOOTER',
            field: 'custom_footer_i18n',
            message:
              'custom_footer_i18n must not contain HTML markup or control characters.',
          });
        } else {
          customFooterI18n = {
            vi: trimmedVi || trimmedEn,
            en: trimmedEn || trimmedVi,
          };
        }
      }
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      config: null,
      errors,
    };
  }

  return {
    valid: true,
    config: {
      enabled: booleans.enabled,
      paper_preset: paperPreset,
      split_mode: splitMode,
      copies_per_unit: copiesPerUnit,
      max_labels_per_print: maxLabelsPerPrint,
      show_shop_name: booleans.show_shop_name,
      show_order_code: booleans.show_order_code,
      show_table_label: booleans.show_table_label,
      show_item_name: booleans.show_item_name,
      show_item_options: booleans.show_item_options,
      show_item_note: booleans.show_item_note,
      show_order_note: booleans.show_order_note,
      show_sequence_counter: booleans.show_sequence_counter,
      show_timestamp: booleans.show_timestamp,
      show_price: booleans.show_price,
      show_payment_qr: booleans.show_payment_qr,
      custom_footer_i18n: customFooterI18n,
    },
    errors: [],
  };
}

export function resolveShopLabelPrintConfig(
  themeOrConfig?: ShopThemeConfig | ShopLabelPrintConfig | null
): ShopLabelPrintConfig {
  if (!themeOrConfig || !isPlainObject(themeOrConfig)) {
    return getDefaultShopLabelPrintConfig();
  }

  const candidate =
    'labelPrintConfig' in themeOrConfig &&
    isPlainObject(themeOrConfig.labelPrintConfig)
      ? themeOrConfig.labelPrintConfig
      : 'paper_preset' in themeOrConfig ||
          'split_mode' in themeOrConfig ||
          'copies_per_unit' in themeOrConfig
        ? themeOrConfig
        : null;

  if (!candidate) {
    return getDefaultShopLabelPrintConfig();
  }

  const validation = validateLabelPrintConfig(candidate);
  return validation.valid ? validation.config : getDefaultShopLabelPrintConfig();
}

export function cloneLabelPrintConfig(
  config: ShopLabelPrintConfig
): ShopLabelPrintConfig {
  return {
    ...config,
    custom_footer_i18n: {
      vi: config.custom_footer_i18n?.vi ?? '',
      en: config.custom_footer_i18n?.en ?? '',
    },
  };
}

export function buildLabelPrintPatchPayload(
  shopId: string,
  config: ShopLabelPrintConfig
): {
  id: string;
  theme_config: {
    labelPrintConfig: ShopLabelPrintConfig;
  };
} {
  return {
    id: shopId,
    theme_config: {
      labelPrintConfig: config,
    },
  };
}

export function formatLabelValidationError(
  error: LabelPrintConfigValidationError,
  locale: 'vi' | 'en' = 'vi'
): string {
  const isEn = locale === 'en';
  switch (error.code) {
    case 'INVALID_CONFIG_OBJECT':
      return isEn
        ? 'Label print configuration must be a valid object.'
        : 'Cấu hình in tem nhãn phải là một đối tượng hợp lệ.';
    case 'FORBIDDEN_LABEL_CONFIG_FIELD':
      return isEn
        ? `Field "${error.field}" is not allowed in label print configuration.`
        : `Trường "${error.field}" không được phép có trong cấu hình in tem.`;
    case 'INVALID_PAPER_PRESET':
      return isEn
        ? 'Invalid label paper preset selected.'
        : 'Khổ giấy in tem được chọn không hợp lệ.';
    case 'INVALID_SPLIT_MODE':
      return isEn
        ? 'Invalid label split mode selected.'
        : 'Chế độ tách tem nhãn được chọn không hợp lệ.';
    case 'INVALID_COPIES_PER_UNIT':
      return isEn
        ? `Copies per unit must be an integer between ${MIN_LABEL_COPIES_PER_UNIT} and ${MAX_LABEL_COPIES_PER_UNIT}.`
        : `Số bản in mỗi đơn vị phải là số nguyên từ ${MIN_LABEL_COPIES_PER_UNIT} đến ${MAX_LABEL_COPIES_PER_UNIT}.`;
    case 'INVALID_MAX_LABELS_PER_PRINT':
      return isEn
        ? `Max labels per print must be an integer between ${MIN_MAX_LABELS_PER_PRINT} and ${MAX_MAX_LABELS_PER_PRINT}.`
        : `Số tem in tối đa mỗi lần phải là số nguyên từ ${MIN_MAX_LABELS_PER_PRINT} đến ${MAX_MAX_LABELS_PER_PRINT}.`;
    case 'INVALID_BOOLEAN_FLAG':
      return isEn
        ? `Display toggle "${error.field}" must be true or false.`
        : `Tùy chọn hiển thị "${error.field}" phải là đúng hoặc sai.`;
    case 'INVALID_CUSTOM_FOOTER':
      return isEn
        ? 'Custom footer text is invalid.'
        : 'Lời nhắn chân tem không hợp lệ.';
    case 'CUSTOM_FOOTER_TOO_LONG':
      return isEn
        ? `Custom footer must not exceed ${MAX_LABEL_FOOTER_LENGTH} characters.`
        : `Lời nhắn chân tem không được vượt quá ${MAX_LABEL_FOOTER_LENGTH} ký tự.`;
    case 'UNSAFE_CUSTOM_FOOTER':
      return isEn
        ? 'Custom footer must not contain HTML tags or control characters.'
        : 'Lời nhắn chân tem không được chứa thẻ HTML hoặc ký tự điều khiển.';
    default:
      return error.message;
  }
}
