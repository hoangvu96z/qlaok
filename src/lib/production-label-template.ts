import { escapeHtml } from '@/lib/escape-html';
import { formatCurrency } from '@/lib/i18n-helper';
import {
  LABEL_PAPER_PRESET_SPECS,
  VALID_LABEL_PAPER_PRESETS,
  resolveShopLabelPrintConfig,
  type LabelPaperPreset,
  type LabelPaperPresetSpec,
} from '@/lib/label-print-config';
import { getShopPaymentQrInfo } from '@/lib/payment-qr';
import type {
  I18nText,
  ItemOptionChoice,
  OrderLineItem,
  Shop,
  ShopLabelPrintConfig,
  ShopOrder,
} from '@/types/qlaok';
import {
  buildProductionLabelBatch,
  computeRequiredLabelCount,
  type ProductionLabel,
  type ProductionLabelBatchErrorCode,
  type ProductionLabelBatchErrorStatus,
  type ProductionLabelBatchResult,
  type ProductionLabelBatchSuccess,
} from '@/lib/production-label-print';

export interface ProductionLabelQrPayload {
  qrImageUrl?: string | null;
  qr_image_url?: string | null;
  bankShortName?: string | null;
  bank_short_name?: string | null;
  accountNumber?: string | null;
  account_number?: string | null;
  accountName?: string | null;
  account_name?: string | null;
  transferContent?: string | null;
  transfer_content?: string | null;
  amount?: number | null;
}

export interface RenderProductionLabelOptions {
  shopName?: string | null;
  shop_name?: string | null;
  shop?: { name?: string | null; currency?: string | null } | null;
  currency?: string | null;
  locale?: string | null;
  visitorLang?: string | null;
  visitor_lang?: string | null;
  timeZone?: string | null;
  time_zone?: string | null;
  isReprint?: boolean | null;
  is_reprint?: boolean | null;
  reprintCount?: number | null;
  reprint_count?: number | null;
  printCount?: number | null;
  print_count?: number | null;
  paymentQr?: ProductionLabelQrPayload | null;
  payment_qr?: ProductionLabelQrPayload | null;
  qrPayload?: ProductionLabelQrPayload | null;
  qr_payload?: ProductionLabelQrPayload | null;
  paperPreset?: LabelPaperPreset | null;
  paper_preset?: LabelPaperPreset | null;
  bilingualFooter?: boolean | null;
  bilingual_footer?: boolean | null;
  customFooterI18n?: { vi?: string; en?: string } | null;
  custom_footer_i18n?: { vi?: string; en?: string } | null;
  documentTitle?: string | null;
  document_title?: string | null;
}

export interface RenderProductionLabelParams extends RenderProductionLabelOptions {
  labels?: ProductionLabel[] | null;
  batch?: ProductionLabelBatchSuccess | { labels?: ProductionLabel[] } | null;
}

export interface RenderProductionLabelSuccess {
  ok: true;
  success: true;
  status: 'success';
  html: string;
  labelCount: number;
  label_count: number;
  paperPreset: LabelPaperPreset;
  paper_preset: LabelPaperPreset;
}

export interface RenderProductionLabelError {
  ok: false;
  success: false;
  status: 'error';
  code: 'EMPTY_LABELS' | 'INVALID_PRESET' | 'INVALID_INPUT';
  error: string;
  reason?: string;
  html: '';
  labelCount: 0;
  label_count: 0;
}

export type RenderProductionLabelResult =
  | RenderProductionLabelSuccess
  | RenderProductionLabelError;

/**
 * Deterministically format an ISO timestamp using a fixed timezone.
 * Never accesses wall-clock time (`new Date()` with 0 args or `Date.now()`).
 */
export function formatDeterministicTimestamp(
  createdAt: string | undefined | null,
  locale = 'vi',
  timeZone = 'Asia/Ho_Chi_Minh'
): string {
  if (!createdAt || typeof createdAt !== 'string') return '';
  const date = new Date(createdAt);
  if (isNaN(date.getTime())) return createdAt;

  try {
    const isEn = locale === 'en';
    const formatter = new Intl.DateTimeFormat(isEn ? 'en-US' : 'vi-VN', {
      timeZone: timeZone || 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return formatter.format(date);
  } catch {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} ${pad(
      date.getUTCDate()
    )}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
  }
}

/**
 * Localize an I18nText-like field with VI/EN fallback.
 */
function resolveLocalizedText(
  field: I18nText | { vi?: string; en?: string } | undefined | null,
  locale: string = 'vi'
): string {
  if (!field) return '';
  const map = field as Record<string, string | undefined>;
  const direct = map[locale]?.trim();
  if (direct) return direct;

  if (locale === 'en') {
    return map.en?.trim() || map.vi?.trim() || '';
  }
  return map.vi?.trim() || map.en?.trim() || '';
}

function resolveItemDisplayName(
  item: OrderLineItem,
  locale: string
): string {
  if (item.name_i18n) {
    const localized = resolveLocalizedText(item.name_i18n, locale);
    if (localized) return localized;
  }
  return item.name_vi || '';
}

function resolveChoiceDisplayName(
  choice: ItemOptionChoice,
  locale: string
): string {
  if (choice.label_i18n) {
    const localized = resolveLocalizedText(choice.label_i18n, locale);
    if (localized) return localized;
  }
  return choice.label_vi || '';
}

function getLocalizedPrefixes(locale: string): {
  notePrefix: string;
  orderNotePrefix: string;
  reprintBadge: string;
  reprintCountPrefix: (count: number) => string;
} {
  if (locale === 'en') {
    return {
      notePrefix: 'Note',
      orderNotePrefix: 'Order note',
      reprintBadge: 'REPRINT',
      reprintCountPrefix: (count: number) => `REPRINT (#${count})`,
    };
  }
  return {
    notePrefix: 'Ghi chú',
    orderNotePrefix: 'Ghi chú đơn',
    reprintBadge: 'BẢN IN LẠI',
    reprintCountPrefix: (count: number) => `BẢN IN LẠI (#${count})`,
  };
}

/**
 * Pure document renderer that transforms an accepted production-label batch
 * into a self-contained, printable HTML document.
 */
export function renderProductionLabelDocument(
  input:
    | RenderProductionLabelParams
    | ProductionLabel[]
    | ProductionLabelBatchSuccess
    | null
    | undefined,
  options?: RenderProductionLabelOptions
): RenderProductionLabelResult {
  if (!input) {
    return {
      ok: false,
      success: false,
      status: 'error',
      code: 'EMPTY_LABELS',
      error: 'No labels to render: input is empty or missing.',
      reason: 'empty_input',
      html: '',
      labelCount: 0,
      label_count: 0,
    };
  }

  let labels: ProductionLabel[] | undefined;
  let opts: RenderProductionLabelOptions = options ? { ...options } : {};

  if (Array.isArray(input)) {
    labels = input;
  } else if (input && typeof input === 'object') {
    if ('labels' in input && Array.isArray(input.labels)) {
      labels = input.labels;
      opts = { ...input, ...options };
    } else if (
      'batch' in input &&
      input.batch &&
      typeof input.batch === 'object' &&
      'labels' in input.batch &&
      Array.isArray(input.batch.labels)
    ) {
      labels = input.batch.labels;
      opts = { ...input, ...options };
    } else {
      opts = { ...input, ...options };
    }
  }

  if (!labels || !Array.isArray(labels) || labels.length === 0) {
    return {
      ok: false,
      success: false,
      status: 'error',
      code: 'EMPTY_LABELS',
      error: 'No labels to render: labels array is empty or missing.',
      reason: 'empty_labels',
      html: '',
      labelCount: 0,
      label_count: 0,
    };
  }

  const rawPreset =
    opts.paperPreset ||
    opts.paper_preset ||
    labels[0]?.paper_preset ||
    labels[0]?.config?.paper_preset ||
    'cup_sticker_50x30';

  if (
    !VALID_LABEL_PAPER_PRESETS.includes(rawPreset as LabelPaperPreset) ||
    !LABEL_PAPER_PRESET_SPECS[rawPreset as LabelPaperPreset]
  ) {
    return {
      ok: false,
      success: false,
      status: 'error',
      code: 'INVALID_PRESET',
      error: `Invalid paper preset: "${String(
        rawPreset
      )}". Must be one of ${VALID_LABEL_PAPER_PRESETS.join(', ')}.`,
      reason: 'invalid_preset',
      html: '',
      labelCount: 0,
      label_count: 0,
    };
  }

  const paperPreset = rawPreset as LabelPaperPreset;
  const spec: LabelPaperPresetSpec = LABEL_PAPER_PRESET_SPECS[paperPreset];

  const shopName =
    opts.shopName ??
    opts.shop_name ??
    opts.shop?.name ??
    '';

  const currency =
    opts.currency ??
    opts.shop?.currency ??
    'VND';

  const targetLocale = (
    opts.locale ||
    opts.visitorLang ||
    opts.visitor_lang ||
    labels[0]?.visitor_lang ||
    'vi'
  ).toLowerCase();

  const timeZone =
    opts.timeZone ||
    opts.time_zone ||
    'Asia/Ho_Chi_Minh';

  const isReprint = Boolean(
    opts.isReprint ||
      opts.is_reprint ||
      (opts.reprintCount && opts.reprintCount > 0) ||
      (opts.reprint_count && opts.reprint_count > 0) ||
      (opts.printCount && opts.printCount > 1) ||
      (opts.print_count && opts.print_count > 1)
  );

  const reprintCount =
    opts.reprintCount ??
    opts.reprint_count ??
    opts.printCount ??
    opts.print_count ??
    undefined;

  const rawQrPayload =
    opts.paymentQr ||
    opts.payment_qr ||
    opts.qrPayload ||
    opts.qr_payload;

  const hasConfiguredQr = Boolean(
    rawQrPayload &&
      typeof rawQrPayload === 'object' &&
      (rawQrPayload.qrImageUrl?.trim() || rawQrPayload.qr_image_url?.trim())
  );

  const qrImageUrl = hasConfiguredQr
    ? (rawQrPayload!.qrImageUrl?.trim() || rawQrPayload!.qr_image_url?.trim() || '')
    : '';

  const qrBankShort =
    rawQrPayload?.bankShortName?.trim() ||
    rawQrPayload?.bank_short_name?.trim() ||
    '';

  const qrAccountNum =
    rawQrPayload?.accountNumber?.trim() ||
    rawQrPayload?.account_number?.trim() ||
    '';

  const qrAccountName =
    rawQrPayload?.accountName?.trim() ||
    rawQrPayload?.account_name?.trim() ||
    '';

  const qrTransferContent =
    rawQrPayload?.transferContent?.trim() ||
    rawQrPayload?.transfer_content?.trim() ||
    '';

  const isBilingualFooterRequested = Boolean(
    opts.bilingualFooter || opts.bilingual_footer
  );

  // Sizing and styling variables derived from trusted spec
  const pageSizeCss =
    spec.height_mm !== null
      ? `${spec.width_mm}mm ${spec.height_mm}mm`
      : `${spec.width_mm}mm auto`;

  const isSticker = spec.is_sticker;
  const isCompactSticker = isSticker && spec.width_mm <= 40;
  const baseFontSize = isCompactSticker
    ? '8.5px'
    : isSticker
    ? '9.5px'
    : spec.width_mm <= 58
    ? '11px'
    : '12px';

  const labelPadding = isCompactSticker
    ? '1mm 1.5mm'
    : isSticker
    ? '1.5mm 2mm'
    : spec.width_mm <= 58
    ? '3mm 2.5mm'
    : '4mm 3mm';

  const defaultTitle =
    labels[0]?.config?.show_order_code && labels[0]?.order_code
      ? `Production Labels - #${labels[0].order_code}`
      : 'Production Labels';

  const docTitle =
    opts.documentTitle ||
    opts.document_title ||
    defaultTitle;

  // Render individual labels
  const totalInBatch = labels.length;
  const renderedPagesHtml = labels
    .map((label, index) => {
      const isLast = index === totalInBatch - 1;
      const config: ShopLabelPrintConfig = label.config;

      // Locale determination: caller locale > label.visitor_lang > 'vi'
      const labelLocale = (
        opts.locale ||
        opts.visitorLang ||
        opts.visitor_lang ||
        label.visitor_lang ||
        'vi'
      ).toLowerCase();

      const prefixes = getLocalizedPrefixes(labelLocale);

      // 1. Reprint indicator
      let reprintHtml = '';
      if (isReprint) {
        const text =
          reprintCount && reprintCount > 0
            ? prefixes.reprintCountPrefix(reprintCount)
            : prefixes.reprintBadge;
        reprintHtml = `<div class="label-reprint-badge" data-reprint="true" style="display:inline-block;border:1px solid #000;padding:1px 3px;font-size:7.5px;font-weight:900;text-transform:uppercase;margin-bottom:1px;">${escapeHtml(
          text
        )}</div>`;
      }

      // 2. Shop name
      let shopNameHtml = '';
      if (config.show_shop_name && shopName.trim()) {
        shopNameHtml = `<div class="label-shop-name" style="font-weight:900;font-size:${
          isSticker ? '10px' : '13px'
        };text-transform:uppercase;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:1px;">${escapeHtml(
          shopName.trim()
        )}</div>`;
      }

      // 3. Meta header (Order code, Table label, Sequence counter)
      const metaElements: string[] = [];
      if (config.show_order_code && label.order_code) {
        metaElements.push(
          `<span class="label-order-code" style="font-family:monospace;font-weight:900;">#${escapeHtml(
            label.order_code
          )}</span>`
        );
      }
      if (config.show_table_label && label.table_label) {
        metaElements.push(
          `<span class="label-table-label" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(
            label.table_label
          )}</span>`
        );
      }
      if (config.show_sequence_counter) {
        const seqNumber = label.sequence_number ?? label.label_index ?? 1;
        const seqTotal = label.sequence_total ?? label.total_labels ?? totalInBatch;
        metaElements.push(
          `<span class="label-sequence" style="font-family:monospace;font-weight:900;">[${escapeHtml(
            seqNumber
          )}/${escapeHtml(seqTotal)}]</span>`
        );
      }

      let metaRowHtml = '';
      if (metaElements.length > 0) {
        metaRowHtml = `<div class="label-meta-row" style="display:flex;justify-content:space-between;align-items:center;font-size:${
          isCompactSticker ? '8px' : '8.5px'
        };font-weight:bold;border-bottom:1px dashed #000;padding-bottom:1px;margin-bottom:1px;">${metaElements.join(
          ''
        )}</div>`;
      }

      // 4. Timestamp
      let timestampHtml = '';
      if (config.show_timestamp && label.created_at) {
        const formatted = formatDeterministicTimestamp(
          label.created_at,
          labelLocale,
          timeZone
        );
        timestampHtml = `<div class="label-timestamp" style="font-size:7.5px;color:#333;font-family:monospace;margin-bottom:1px;">${escapeHtml(
          formatted
        )}</div>`;
      }

      // 5. Line items
      const itemsListHtml = (label.items || [])
        .map((item) => {
          const itemName = resolveItemDisplayName(item, labelLocale);

          // Name and quantity
          let nameHtml = '';
          if (config.show_item_name) {
            const hasMultipleQty =
              item.quantity > 1 &&
              (label.split_mode === 'per_line_item' ||
                label.split_mode === 'single_ticket');
            const qtyPrefix = hasMultipleQty ? `${item.quantity}x ` : '';
            nameHtml = `<span class="label-item-name">${escapeHtml(
              qtyPrefix + itemName
            )}</span>`;
          }

          // Price
          let priceHtml = '';
          if (config.show_price) {
            const unitPrice = item.unit_price + (item.extra_price || 0);
            const lineTotal = unitPrice * item.quantity;
            priceHtml = `<span class="label-item-price" style="font-family:monospace;font-weight:bold;margin-left:4px;white-space:nowrap;">${escapeHtml(
              formatCurrency(lineTotal, currency)
            )}</span>`;
          }

          const headerRow =
            nameHtml || priceHtml
              ? `<div class="label-item-header" style="display:flex;justify-content:space-between;align-items:flex-start;font-weight:900;font-size:${
                  isCompactSticker ? '8.5px' : isSticker ? '9px' : '12px'
                };line-height:1.2;">${nameHtml || '<span></span>'}${
                  priceHtml || ''
                }</div>`
              : '';

          // Options & Toppings
          let optionsHtml = '';
          let tagsHtml = '';
          if (config.show_item_options) {
            if (item.selected_choices && item.selected_choices.length > 0) {
              const formattedChoices = item.selected_choices.map((choice) => {
                const choiceName = resolveChoiceDisplayName(choice, labelLocale);
                if (config.show_price && choice.extra_price && choice.extra_price > 0) {
                  return `${choiceName} (+${formatCurrency(
                    choice.extra_price,
                    currency
                  )})`;
                }
                return choiceName;
              });
              optionsHtml = `<div class="label-item-options" style="font-size:7.5px;color:#333;padding-left:2px;margin-top:0.5px;">+ ${formattedChoices
                .map(escapeHtml)
                .join(', ')}</div>`;
            }

            if (item.quick_tags && item.quick_tags.length > 0) {
              tagsHtml = `<div class="label-item-tags" style="font-size:7.5px;font-weight:bold;padding-left:2px;">[${escapeHtml(
                item.quick_tags.join(', ')
              )}]</div>`;
            }
          }

          // Line item note
          let itemNoteHtml = '';
          if (config.show_item_note && item.custom_note?.trim()) {
            itemNoteHtml = `<div class="label-item-note" style="font-size:7.5px;font-style:italic;padding-left:2px;color:#222;">* ${escapeHtml(
              prefixes.notePrefix
            )}: ${escapeHtml(item.custom_note.trim())}</div>`;
          }

          return `<div class="label-item" style="margin-bottom:1.5px;">${headerRow}${optionsHtml}${tagsHtml}${itemNoteHtml}</div>`;
        })
        .join('');

      // 6. Order note
      let orderNoteHtml = '';
      if (config.show_order_note && label.customer_note?.trim()) {
        orderNoteHtml = `<div class="label-order-note" style="font-size:7.5px;font-style:italic;border-top:1px dotted #666;margin-top:1.5px;padding-top:1px;">${escapeHtml(
          prefixes.orderNotePrefix
        )}: ${escapeHtml(label.customer_note.trim())}</div>`;
      }

      // 7. Payment QR
      // Honor template config AND caller payload; never derive payment status
      let paymentQrHmtl = '';
      if (config.show_payment_qr && hasConfiguredQr) {
        const qrSize = isCompactSticker ? '12mm' : isSticker ? '14mm' : '26mm';
        const details: string[] = [];

        if (qrBankShort) {
          details.push(
            `<div>${escapeHtml(
              labelLocale === 'en' ? 'Bank' : 'NH'
            )}: <strong>${escapeHtml(qrBankShort)}</strong></div>`
          );
        }
        if (qrAccountNum) {
          details.push(
            `<div>${escapeHtml(
              labelLocale === 'en' ? 'Acct' : 'STK'
            )}: <strong>${escapeHtml(qrAccountNum)}</strong></div>`
          );
        }
        if (qrAccountName) {
          details.push(
            `<div>${escapeHtml(
              labelLocale === 'en' ? 'Name' : 'Chủ TK'
            )}: <strong>${escapeHtml(qrAccountName)}</strong></div>`
          );
        }
        if (qrTransferContent) {
          details.push(
            `<div>${escapeHtml(
              labelLocale === 'en' ? 'Memo' : 'ND'
            )}: <strong>${escapeHtml(qrTransferContent)}</strong></div>`
          );
        }

        const detailsBlock =
          details.length > 0
            ? `<div class="label-qr-details" style="font-size:7px;line-height:1.2;margin-top:1px;">${details.join(
                ''
              )}</div>`
            : '';

        paymentQrHmtl = `<div class="label-payment-qr" style="margin-top:2px;padding-top:2px;border-top:1px dashed #000;text-align:center;"><img src="${escapeHtml(
          qrImageUrl
        )}" alt="Payment QR" style="width:${qrSize};height:${qrSize};object-fit:contain;margin:0 auto;display:block;" />${detailsBlock}</div>`;
      }

      // 8. Custom Footer (bilingual or localized with VI/EN fallback)
      let footerHtml = '';
      const activeFooterConfig =
        opts.customFooterI18n ??
        opts.custom_footer_i18n ??
        config.custom_footer_i18n;
      const footerVi = activeFooterConfig?.vi?.trim() || '';
      const footerEn = activeFooterConfig?.en?.trim() || '';

      if (isBilingualFooterRequested && footerVi && footerEn && footerVi !== footerEn) {
        footerHtml = `<div class="label-custom-footer label-custom-footer-bilingual" style="margin-top:2px;padding-top:2px;border-top:1px dashed #999;text-align:center;font-size:7.5px;font-style:italic;"><div>${escapeHtml(
          footerVi
        )}</div><div>${escapeHtml(footerEn)}</div></div>`;
      } else {
        const resolvedFooter = resolveLocalizedText(
          activeFooterConfig,
          labelLocale
        );
        if (resolvedFooter) {
          footerHtml = `<div class="label-custom-footer" style="margin-top:2px;padding-top:2px;border-top:1px dashed #999;text-align:center;font-size:7.5px;font-style:italic;">${escapeHtml(
            resolvedFooter
          )}</div>`;
        }
      }

      const inlinePageBreak = isLast
        ? 'page-break-after:auto;break-after:auto;'
        : 'page-break-after:always;break-after:page;';

      const inlineHeight =
        spec.height_mm !== null
          ? `height:${spec.height_mm}mm;max-height:${spec.height_mm}mm;overflow:hidden;`
          : 'min-height:auto;';

      return `
    <div
      class="production-label-page label-preset-${escapeHtml(paperPreset)}"
      data-label-id="${escapeHtml(label.id)}"
      data-label-index="${label.label_index}"
      data-preset="${escapeHtml(paperPreset)}"
      style="box-sizing:border-box;width:${spec.width_mm}mm;${inlineHeight}padding:${labelPadding};font-size:${baseFontSize};line-height:1.25;background:#ffffff;color:#000000;${inlinePageBreak}page-break-inside:avoid;break-inside:avoid;"
    >
      ${reprintHtml}
      ${shopNameHtml}
      ${metaRowHtml}
      ${timestampHtml}
      <div class="label-items">${itemsListHtml}</div>
      ${orderNoteHtml}
      ${paymentQrHmtl}
      ${footerHtml}
    </div>`;
    })
    .join('\n');

  const htmlDocument = `<!DOCTYPE html>
<html lang="${escapeHtml(targetLocale)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(docTitle)}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    @page {
      size: ${pageSizeCss};
      margin: 0;
    }
    @media print {
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .production-label-page {
        page-break-after: always;
        break-after: page;
        page-break-inside: avoid;
        break-inside: avoid;
      }
      .production-label-page:last-child {
        page-break-after: auto;
        break-after: auto;
      }
    }
    @media screen {
      body {
        background: #f1f5f9;
        padding: 16px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
      }
      .production-label-page {
        box-shadow: 0 1px 3px rgba(0,0,0,0.15), 0 1px 2px rgba(0,0,0,0.2);
      }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #000000;
      background: #ffffff;
    }
    .production-label-page {
      box-sizing: border-box;
      width: ${spec.width_mm}mm;
      ${spec.height_mm !== null ? `height: ${spec.height_mm}mm; max-height: ${spec.height_mm}mm; overflow: hidden;` : 'min-height: auto;'}
      padding: ${labelPadding};
      font-size: ${baseFontSize};
      line-height: 1.25;
      background: #ffffff;
      color: #000000;
      page-break-after: always;
      break-after: page;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .production-label-page:last-child {
      page-break-after: auto;
      break-after: auto;
    }
  </style>
</head>
<body>
${renderedPagesHtml}
</body>
</html>`;

  return {
    ok: true,
    success: true,
    status: 'success',
    html: htmlDocument,
    labelCount: totalInBatch,
    label_count: totalInBatch,
    paperPreset,
    paper_preset: paperPreset,
  };
}

/**
 * Convenience helper that returns only the HTML string, or an empty string on error.
 */
export function renderProductionLabelHtml(
  input:
    | RenderProductionLabelParams
    | ProductionLabel[]
    | ProductionLabelBatchSuccess
    | null
    | undefined,
  options?: RenderProductionLabelOptions
): string {
  const result = renderProductionLabelDocument(input, options);
  return result.html;
}

export const renderProductionLabelTemplate = renderProductionLabelDocument;

export interface FirstProductionLabelItemPreview {
  displayName: string;
  quantity: number;
  priceText: string;
  optionsText: string;
  tagsText: string;
  noteText: string;
}

export interface FirstProductionLabelPreview {
  label: ProductionLabel;
  shopName: string;
  orderCode: string;
  tableLabel: string;
  sequenceText: string;
  timestampText: string;
  items: FirstProductionLabelItemPreview[];
  orderNoteText: string;
  footerText: string;
  hasPaymentQr: boolean;
  paymentQr: ProductionLabelQrPayload | null;
  isReprint: boolean;
  printCount: number;
}

export interface PrepareOrderProductionLabelPrintParams {
  order: ShopOrder | null | undefined;
  shop:
    | Pick<Shop, 'name' | 'currency' | 'theme_config'>
    | Shop
    | null
    | undefined;
  config?: ShopLabelPrintConfig | null;
  locale?: 'vi' | 'en' | string | null;
  printCount?: number | null;
  isReprint?: boolean | null;
  timeZone?: string | null;
}

export interface OrderProductionLabelPreflightSuccess {
  ok: true;
  canPrint: true;
  status: 'ready';
  html: string;
  labelCount: number;
  requestedCount: number;
  maxLabels: number;
  preset: LabelPaperPreset;
  presetSpec: LabelPaperPresetSpec;
  presetLabel: string;
  config: ShopLabelPrintConfig;
  batch: ProductionLabelBatchSuccess;
  document: RenderProductionLabelSuccess;
  firstLabel: ProductionLabel;
  firstLabelPreview: FirstProductionLabelPreview;
  paymentQr: ProductionLabelQrPayload | null;
  errorCode: null;
  errorStatus: null;
  errorMessage: null;
  error_i18n: null;
}

export interface OrderProductionLabelPreflightFailure {
  ok: false;
  canPrint: false;
  status: ProductionLabelBatchErrorStatus | 'render_error';
  html: '';
  labelCount: 0;
  requestedCount: number;
  maxLabels: number;
  preset: LabelPaperPreset;
  presetSpec: LabelPaperPresetSpec;
  presetLabel: string;
  config: ShopLabelPrintConfig;
  batch: ProductionLabelBatchResult;
  document: RenderProductionLabelError | null;
  firstLabel: null;
  firstLabelPreview: null;
  paymentQr: null;
  errorCode: ProductionLabelBatchErrorCode | 'RENDER_FAILED';
  errorStatus: ProductionLabelBatchErrorStatus | 'render_error';
  errorMessage: string;
  error_i18n: { vi: string; en: string };
}

export type OrderProductionLabelPreflightResult =
  | OrderProductionLabelPreflightSuccess
  | OrderProductionLabelPreflightFailure;

/**
 * Pure preflight & rendering helper for merchant order label printing.
 * Resolves ShopLabelPrintConfig, builds & validates the label batch, resolves
 * opt-in payment QR (only when config.show_payment_qr is true, order is unpaid,
 * and shop bank QR is configured), builds the first-label preview, and renders
 * the printable HTML document.
 */
export function prepareOrderProductionLabelPrint(
  params: PrepareOrderProductionLabelPrintParams
): OrderProductionLabelPreflightResult {
  const { order, shop } = params;
  const uiLocale: 'vi' | 'en' =
    typeof params.locale === 'string' &&
    params.locale.trim().toLowerCase().startsWith('en')
      ? 'en'
      : 'vi';

  const resolvedFromShop = resolveShopLabelPrintConfig(shop?.theme_config);
  const rawConfig =
    params.config !== undefined && params.config !== null
      ? params.config
      : resolvedFromShop;

  const safePreset: LabelPaperPreset =
    rawConfig &&
    typeof rawConfig === 'object' &&
    VALID_LABEL_PAPER_PRESETS.includes(rawConfig.paper_preset as LabelPaperPreset)
      ? (rawConfig.paper_preset as LabelPaperPreset)
      : resolvedFromShop.paper_preset;

  const presetSpec =
    LABEL_PAPER_PRESET_SPECS[safePreset] ||
    LABEL_PAPER_PRESET_SPECS.cup_sticker_50x30;
  const presetLabel =
    (uiLocale === 'en'
      ? presetSpec.label_i18n.en
      : presetSpec.label_i18n.vi) || presetSpec.label_i18n.vi || '';

  const maxLabels =
    rawConfig &&
    typeof rawConfig === 'object' &&
    typeof rawConfig.max_labels_per_print === 'number' &&
    Number.isFinite(rawConfig.max_labels_per_print)
      ? rawConfig.max_labels_per_print
      : resolvedFromShop.max_labels_per_print;

  const batch = buildProductionLabelBatch({
    order: order as ShopOrder,
    config: rawConfig as ShopLabelPrintConfig,
  });

  if (!batch.ok) {
    const fallbackRequestedCount =
      batch.status === 'over_limit'
        ? batch.requested_count
        : (computeRequiredLabelCount(
            Array.isArray(order?.items) ? order.items : [],
            rawConfig?.split_mode || resolvedFromShop.split_mode,
            rawConfig?.copies_per_unit || resolvedFromShop.copies_per_unit
          ) ?? 0);

    let errorVi = 'Cấu hình in tem hoặc dữ liệu đơn hàng không hợp lệ.';
    let errorEn = 'Label print configuration or order data is invalid.';

    switch (batch.code) {
      case 'CONFIG_DISABLED':
        errorVi =
          'In tem món đang tắt trong Cài đặt cửa hàng. Vui lòng bật cấu hình in tem trước khi in.';
        errorEn =
          'Label printing is disabled in Store Settings. Please enable label printing before printing.';
        break;
      case 'EXCEEDS_MAX_LABELS':
        errorVi = `Số lượng tem cần in (${batch.requested_count}) vượt quá giới hạn tối đa mỗi lần in (${batch.max_count}). Vui lòng tách đơn hoặc tăng giới hạn trong Cài đặt.`;
        errorEn = `Requested label count (${batch.requested_count}) exceeds the maximum allowed per print (${batch.max_count}). Please split the order or increase the limit in Settings.`;
        break;
      case 'EMPTY_ORDER':
        errorVi = 'Đơn hàng chưa có món nào để tạo tem in.';
        errorEn = 'Order has no items to generate labels.';
        break;
      case 'INVALID_QUANTITY':
        errorVi =
          'Số lượng món trong đơn không hợp lệ, không thể tạo lô tem in.';
        errorEn =
          'Order contains an invalid item quantity; cannot generate labels.';
        break;
      default:
        break;
    }

    return {
      ok: false,
      canPrint: false,
      status: batch.status,
      html: '',
      labelCount: 0,
      requestedCount: fallbackRequestedCount,
      maxLabels,
      preset: safePreset,
      presetSpec,
      presetLabel,
      config:
        rawConfig && typeof rawConfig === 'object'
          ? (rawConfig as ShopLabelPrintConfig)
          : resolvedFromShop,
      batch,
      document: null,
      firstLabel: null,
      firstLabelPreview: null,
      paymentQr: null,
      errorCode: batch.code,
      errorStatus: batch.status,
      errorMessage: uiLocale === 'en' ? errorEn : errorVi,
      error_i18n: { vi: errorVi, en: errorEn },
    };
  }

  const config = batch.config;
  const currency = shop?.currency || 'VND';
  const timeZone = params.timeZone || 'Asia/Ho_Chi_Minh';
  const labelRenderLocale = (
    params.locale ||
    order?.visitor_lang ||
    'vi'
  ).toLowerCase();

  let paymentQr: ProductionLabelQrPayload | null = null;
  if (config.show_payment_qr && order?.payment_status === 'unpaid') {
    const qrInfo = getShopPaymentQrInfo(
      shop as Shop,
      order.total_amount,
      order.order_code
    );
    if (qrInfo.isConfigured && Boolean(qrInfo.qrImageUrl)) {
      paymentQr = {
        qrImageUrl: qrInfo.qrImageUrl,
        bankShortName: qrInfo.bankShortName,
        accountNumber: qrInfo.accountNumber,
        accountName: qrInfo.accountName,
        transferContent: qrInfo.transferContent,
        amount: order.total_amount,
      };
    }
  }

  const effectivePrintCount =
    typeof params.printCount === 'number' && Number.isFinite(params.printCount)
      ? Math.max(0, Math.trunc(params.printCount))
      : Math.max(0, Math.trunc(Number(order?.label_printed_count || 0)));

  const effectiveIsReprint =
    typeof params.isReprint === 'boolean'
      ? params.isReprint
      : typeof params.printCount === 'number'
        ? effectivePrintCount > 1
        : effectivePrintCount >= 1;

  const docResult = renderProductionLabelDocument({
    batch,
    shopName: shop?.name || '',
    currency,
    locale: labelRenderLocale,
    timeZone,
    isReprint: effectiveIsReprint,
    printCount: effectivePrintCount > 0 ? effectivePrintCount : undefined,
    paymentQr,
    paperPreset: config.paper_preset,
    customFooterI18n: config.custom_footer_i18n,
  });

  if (!docResult.ok || !docResult.html) {
    const errorVi = 'Không thể dựng nội dung tài liệu tem in cho đơn hàng này.';
    const errorEn = 'Could not render printable label document for this order.';
    return {
      ok: false,
      canPrint: false,
      status: 'render_error',
      html: '',
      labelCount: 0,
      requestedCount: batch.total_labels,
      maxLabels: config.max_labels_per_print,
      preset: config.paper_preset,
      presetSpec: LABEL_PAPER_PRESET_SPECS[config.paper_preset],
      presetLabel,
      config,
      batch,
      document: docResult.ok ? null : docResult,
      firstLabel: null,
      firstLabelPreview: null,
      paymentQr: null,
      errorCode: 'RENDER_FAILED',
      errorStatus: 'render_error',
      errorMessage: uiLocale === 'en' ? errorEn : errorVi,
      error_i18n: { vi: errorVi, en: errorEn },
    };
  }

  const firstLabel = batch.labels[0]!;
  const prefixes = getLocalizedPrefixes(labelRenderLocale);

  const previewItems: FirstProductionLabelItemPreview[] = (
    firstLabel.items || []
  ).map((item) => {
    const itemName = resolveItemDisplayName(item, labelRenderLocale);
    const hasMultipleQty =
      item.quantity > 1 &&
      (firstLabel.split_mode === 'per_line_item' ||
        firstLabel.split_mode === 'single_ticket');
    const qtyPrefix = hasMultipleQty ? `${item.quantity}x ` : '';
    const displayName = config.show_item_name ? `${qtyPrefix}${itemName}` : '';

    const unitPrice = item.unit_price + (item.extra_price || 0);
    const lineTotal = unitPrice * item.quantity;
    const priceText = config.show_price
      ? formatCurrency(lineTotal, currency)
      : '';

    let optionsText = '';
    let tagsText = '';
    if (config.show_item_options) {
      if (item.selected_choices && item.selected_choices.length > 0) {
        const formattedChoices = item.selected_choices
          .map((choice) => {
            const choiceName = resolveChoiceDisplayName(
              choice,
              labelRenderLocale
            );
            if (!choiceName) return '';
            if (
              config.show_price &&
              choice.extra_price &&
              choice.extra_price > 0
            ) {
              return `${choiceName} (+${formatCurrency(
                choice.extra_price,
                currency
              )})`;
            }
            return choiceName;
          })
          .filter(Boolean);
        optionsText = formattedChoices.join(', ');
      }
      if (item.quick_tags && item.quick_tags.length > 0) {
        tagsText = `[${item.quick_tags.join(', ')}]`;
      }
    }

    const noteText =
      config.show_item_note && item.custom_note?.trim()
        ? `${prefixes.notePrefix}: ${item.custom_note.trim()}`
        : '';

    return {
      displayName,
      quantity: item.quantity,
      priceText,
      optionsText,
      tagsText,
      noteText,
    };
  });

  const firstLabelPreview: FirstProductionLabelPreview = {
    label: firstLabel,
    shopName: config.show_shop_name ? shop?.name?.trim() || '' : '',
    orderCode:
      config.show_order_code && firstLabel.order_code
        ? `#${firstLabel.order_code}`
        : '',
    tableLabel: config.show_table_label ? firstLabel.table_label || '' : '',
    sequenceText: config.show_sequence_counter
      ? `[${firstLabel.sequence_number}/${firstLabel.sequence_total}]`
      : '',
    timestampText:
      config.show_timestamp && firstLabel.created_at
        ? formatDeterministicTimestamp(
            firstLabel.created_at,
            labelRenderLocale,
            timeZone
          )
        : '',
    items: previewItems,
    orderNoteText:
      config.show_order_note && firstLabel.customer_note?.trim()
        ? `${prefixes.orderNotePrefix}: ${firstLabel.customer_note.trim()}`
        : '',
    footerText: resolveLocalizedText(
      config.custom_footer_i18n,
      labelRenderLocale
    ),
    hasPaymentQr: Boolean(paymentQr),
    paymentQr,
    isReprint: effectiveIsReprint,
    printCount: effectivePrintCount,
  };

  return {
    ok: true,
    canPrint: true,
    status: 'ready',
    html: docResult.html,
    labelCount: batch.total_labels,
    requestedCount: batch.total_labels,
    maxLabels: config.max_labels_per_print,
    preset: config.paper_preset,
    presetSpec: LABEL_PAPER_PRESET_SPECS[config.paper_preset],
    presetLabel,
    config,
    batch,
    document: docResult,
    firstLabel,
    firstLabelPreview,
    paymentQr,
    errorCode: null,
    errorStatus: null,
    errorMessage: null,
    error_i18n: null,
  };
}
