import type { CatalogItem, Category } from '@/types/qlaok';

export const MAX_CATALOG_EXCEL_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
export const MAX_CATALOG_EXCEL_ROWS = 2000;
export const MIN_CATALOG_ITEM_PRICE = 0;
export const MAX_CATALOG_ITEM_PRICE = 1_000_000_000;

export interface CatalogImportRowParsed {
  rowNumber: number;
  rawId: string;
  matchedItem?: CatalogItem;
  categoryName?: string;
  itemName?: string;
  rawPrice: unknown;
  parsedPrice?: number;
  rawStock: unknown;
  parsedStock?: number | null;
  errors: string[];
  status: 'valid' | 'invalid' | 'unchanged';
  priceChanged: boolean;
  stockChanged: boolean;
}

export interface CatalogImportValidationResult {
  ok: boolean;
  totalRows: number;
  validRows: CatalogImportRowParsed[];
  invalidRows: CatalogImportRowParsed[];
  unchangedRows: CatalogImportRowParsed[];
  errors: string[];
}

/**
 * Checks if a byte buffer starts with standard ZIP/OOXML magic bytes (PK\x03\x04).
 */
export function hasValidZipMagicBytes(buffer: ArrayBuffer | Uint8Array): boolean {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 4) return false;
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * Normalizes text for loose header matching.
 */
function normalizeHeader(val: unknown): string {
  if (typeof val !== 'string') return '';
  return val
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Safely extracts primitive string/number from an ExcelJS cell value.
 */
function extractPrimitiveCellValue(cellValue: unknown): unknown {
  if (cellValue === null || cellValue === undefined) return '';
  if (typeof cellValue === 'object') {
    // Formula result
    if ('result' in (cellValue as Record<string, unknown>)) {
      return (cellValue as { result: unknown }).result;
    }
    // Rich text
    if ('richText' in (cellValue as Record<string, unknown>)) {
      const parts = (cellValue as { richText: Array<{ text?: string }> }).richText;
      return parts.map((p) => p.text || '').join('');
    }
    // Text object
    if ('text' in (cellValue as Record<string, unknown>)) {
      return (cellValue as { text: unknown }).text;
    }
  }
  return cellValue;
}

/**
 * Parses and validates a stock quantity cell value.
 * Valid representations of unlimited stock (returns null):
 * - null, undefined, empty string
 * - "∞", "unlimited", "không giới hạn", "khong gioi han"
 * Valid finite stock:
 * - non-negative integer (e.g. 0, 10, 100)
 */
export function parseCatalogStockValue(
  raw: unknown
): { valid: true; stock: number | null } | { valid: false; error: string } {
  const primitive = extractPrimitiveCellValue(raw);

  if (primitive === null || primitive === undefined) {
    return { valid: true, stock: null };
  }

  if (typeof primitive === 'string') {
    const trimmed = primitive.trim();
    if (!trimmed) {
      return { valid: true, stock: null };
    }
    const lower = trimmed.toLowerCase();
    if (
      lower === '∞' ||
      lower === 'unlimited' ||
      lower === 'không giới hạn' ||
      lower === 'khong gioi han'
    ) {
      return { valid: true, stock: null };
    }
    // Pure integer check
    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      if (Number.isSafeInteger(num) && num >= 0 && num <= 1_000_000_000) {
        return { valid: true, stock: num };
      }
    }
    return {
      valid: false,
      error: 'Tồn kho không hợp lệ. Vui lòng nhập số nguyên >= 0 hoặc để trống / nhập "∞" nếu không giới hạn.',
    };
  }

  if (typeof primitive === 'number') {
    if (Number.isFinite(primitive) && Number.isInteger(primitive) && primitive >= 0 && primitive <= 1_000_000_000) {
      return { valid: true, stock: primitive };
    }
    return {
      valid: false,
      error: 'Tồn kho không hợp lệ. Phải là số nguyên không âm (>= 0).',
    };
  }

  return {
    valid: false,
    error: 'Định dạng số lượng tồn kho không được hỗ trợ.',
  };
}

/**
 * Parses and validates a price cell value according to integer-VND rules.
 * Accepts:
 * - Finite non-negative integer numbers (e.g. 35000, 0)
 * - Plain digit strings (e.g. "35000", "0")
 * - Correctly grouped thousands strings with dots (e.g. "35.000", "1.234.567")
 * - Correctly grouped thousands strings with commas (e.g. "35,000", "1,234,567")
 * - Any of the above optionally preceded or followed by supported currency markers/spaces (e.g. "35.000đ", "35.000 VND", "₫ 35,000")
 *
 * Rejects:
 * - Fractional numeric values (e.g. 35000.5) - never rounds!
 * - Fractional/malformed strings (e.g. "35000.5", "35.000,5", "35,000.5", "12.5")
 * - Inconsistent or mixed grouping (e.g. "1,23,456", "1.234,567")
 * - Negatives (e.g. -100, "-35000")
 * - Non-numeric text (e.g. "abc", "35k")
 * - Empty/null/undefined
 */
export function parseCatalogPriceValue(
  raw: unknown
): { valid: true; price: number } | { valid: false; error: string } {
  const primitive = extractPrimitiveCellValue(raw);

  if (primitive === null || primitive === undefined || primitive === '') {
    return {
      valid: false,
      error: 'Giá bán không được để trống.',
    };
  }

  if (typeof primitive === 'number') {
    if (
      Number.isFinite(primitive) &&
      Number.isInteger(primitive) &&
      primitive >= MIN_CATALOG_ITEM_PRICE &&
      primitive <= MAX_CATALOG_ITEM_PRICE
    ) {
      return { valid: true, price: primitive === 0 ? 0 : primitive };
    }
    if (Number.isFinite(primitive) && !Number.isInteger(primitive)) {
      return {
        valid: false,
        error: 'Giá bán không hợp lệ. Giá bán phải là số nguyên (VND không dùng số thập phân).',
      };
    }
    if (primitive < MIN_CATALOG_ITEM_PRICE) {
      return {
        valid: false,
        error: 'Giá bán không hợp lệ. Phải là số nguyên không âm (>= 0).',
      };
    }
    if (primitive > MAX_CATALOG_ITEM_PRICE) {
      return {
        valid: false,
        error: 'Giá bán không hợp lệ. Không được vượt quá 1 tỷ đồng.',
      };
    }
    return {
      valid: false,
      error: 'Giá bán không hợp lệ.',
    };
  }

  if (typeof primitive === 'string') {
    const trimmed = primitive.trim();
    if (!trimmed) {
      return {
        valid: false,
        error: 'Giá bán không được để trống.',
      };
    }

    if (trimmed.startsWith('-') || trimmed.includes('-')) {
      return {
        valid: false,
        error: 'Giá bán không hợp lệ. Phải là số không âm (>= 0).',
      };
    }

    // Supported currency markers: đ, ₫, vnd, vnđ (case-insensitive)
    // Strip optional prefix or suffix currency markers and surrounding whitespace
    const currencyPrefixRegex = /^(?:vnd|vnđ|[đ₫])\s*/i;
    const currencySuffixRegex = /\s*(?:vnd|vnđ|[đ₫])$/i;

    let core = trimmed;
    if (currencyPrefixRegex.test(core)) {
      core = core.replace(currencyPrefixRegex, '').trim();
    }
    if (currencySuffixRegex.test(core)) {
      core = core.replace(currencySuffixRegex, '').trim();
    }

    if (!core) {
      return {
        valid: false,
        error: 'Giá bán không hợp lệ.',
      };
    }

    // Validate integer format:
    // 1. Plain digits: e.g. "35000", "0"
    // 2. Correctly grouped thousands with dots: e.g. "35.000", "1.234.567"
    // 3. Correctly grouped thousands with commas: e.g. "35,000", "1,234,567"
    const isPlainDigits = /^\d+$/.test(core);
    const isDotGrouped = /^\d{1,3}(\.\d{3})+$/.test(core);
    const isCommaGrouped = /^\d{1,3}(,\d{3})+$/.test(core);

    if (!isPlainDigits && !isDotGrouped && !isCommaGrouped) {
      if (/[.,]\d+/.test(core)) {
        return {
          valid: false,
          error: 'Giá bán không hợp lệ. Giá bán phải là số nguyên (VND không dùng số thập phân hoặc nhóm hàng nghìn không đúng quy cách).',
        };
      }
      return {
        valid: false,
        error: 'Giá bán không hợp lệ. Vui lòng nhập số nguyên VND (VD: 35000 hoặc 35.000).',
      };
    }

    const digitsOnly = core.replace(/[.,]/g, '');
    const num = Number(digitsOnly);

    if (
      Number.isSafeInteger(num) &&
      num >= MIN_CATALOG_ITEM_PRICE &&
      num <= MAX_CATALOG_ITEM_PRICE
    ) {
      return { valid: true, price: num };
    }

    if (num > MAX_CATALOG_ITEM_PRICE) {
      return {
        valid: false,
        error: 'Giá bán không hợp lệ. Không được vượt quá 1 tỷ đồng.',
      };
    }

    return {
      valid: false,
      error: 'Giá bán không hợp lệ. Phải là số nguyên không âm (>= 0).',
    };
  }

  return {
    valid: false,
    error: 'Định dạng giá bán không được hỗ trợ.',
  };
}

/**
 * Builds an Excel .xlsx workbook containing the shop's catalog items for price/stock editing.
 */
export async function buildCatalogXlsxWorkbook(
  items: CatalogItem[],
  categories: Category[]
): Promise<Uint8Array> {
  const excelModule = await import('exceljs');
  const Workbook = excelModule.default?.Workbook ?? excelModule.Workbook;
  const workbook = new Workbook();

  workbook.creator = 'Qlaok';
  workbook.title = 'Thực đơn Qlaok';

  const categoryMap = new Map(categories.map((c) => [c.id, c.name_i18n?.vi || '']));

  const sheet = workbook.addWorksheet('ThucDon');

  sheet.columns = [
    { header: 'Mã món (Item ID)', key: 'id', width: 28 },
    { header: 'Danh mục (Category)', key: 'category', width: 22 },
    { header: 'Tên món (Item Name)', key: 'name_vi', width: 32 },
    { header: 'Tên tiếng Anh (English Name)', key: 'name_en', width: 32 },
    { header: 'Giá bán (Price)', key: 'price', width: 18 },
    { header: 'Tồn kho (Stock)', key: 'stock', width: 18 },
  ];

  for (const item of items) {
    const catName = categoryMap.get(item.category_id) || '';
    const stockVal =
      item.stock_quantity === null || item.stock_quantity === undefined
        ? '∞'
        : item.stock_quantity;

    sheet.addRow({
      id: item.id,
      category: catName,
      name_vi: item.name_i18n?.vi || '',
      name_en: item.name_i18n?.en || '',
      price: item.price,
      stock: stockVal,
    });
  }

  // Header row styling
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF047857' }, // Emerald-700
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 26;

  // Frozen header row
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  // Column formatting
  sheet.getColumn(1).numFmt = '@'; // Item ID as text
  sheet.getColumn(2).numFmt = '@'; // Category as text
  sheet.getColumn(3).numFmt = '@'; // Name Vi as text
  sheet.getColumn(4).numFmt = '@'; // Name En as text
  sheet.getColumn(5).numFmt = '#,##0'; // Price as integer currency
  sheet.getColumn(6).alignment = { horizontal: 'center' };

  if (items.length > 0) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: items.length + 1, column: 6 },
    };
  }

  // Instructions worksheet
  const guideSheet = workbook.addWorksheet('HuongDan');
  guideSheet.columns = [
    { header: 'Mục hướng dẫn', key: 'topic', width: 28 },
    { header: 'Chi tiết quy tắc cập nhật giá & tồn kho', key: 'details', width: 80 },
  ];
  const guideHeader = guideSheet.getRow(1);
  guideHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  guideHeader.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' }, // Slate-800
  };

  guideSheet.addRow({
    topic: '1. Mã món (Item ID)',
    details: 'Giữ nguyên cột này không chỉnh sửa. Hệ thống dùng mã ID để tìm đúng món cần cập nhật.',
  });
  guideSheet.addRow({
    topic: '2. Thông tin tham khảo',
    details: 'Các cột Danh mục, Tên món, Tên tiếng Anh chỉ để đối chiếu. File nhập không sửa đổi tên hay danh mục.',
  });
  guideSheet.addRow({
    topic: '3. Giá bán (Price)',
    details:
      'Nhập số tiền bán mới (số nguyên VND >= 0, ví dụ: 35000 hoặc 35.000; VND không dùng số thập phân).',
  });
  guideSheet.addRow({
    topic: '4. Tồn kho (Stock)',
    details: 'Nhập số nguyên >= 0 (ví dụ 10, 50; 0 là tạm hết), hoặc để trống / nhập "∞" nếu bán không giới hạn.',
  });
  guideSheet.addRow({
    topic: '5. An toàn dữ liệu',
    details: 'Hệ thống chỉ cập nhật Giá bán và Tồn kho; không tạo món mới, không xóa món và không ghi đè thuộc tính khác.',
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Uint8Array.from(new Uint8Array(buffer));
}

/**
 * Downloads a catalog XLSX workbook in the browser.
 */
export async function downloadCatalogXlsx(
  items: CatalogItem[],
  categories: Category[],
  filename = 'Qlaok-thuc-don.xlsx'
): Promise<void> {
  if (typeof document === 'undefined') {
    throw new Error('Downloads require a browser environment.');
  }
  const bytes = await buildCatalogXlsxWorkbook(items, categories);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/**
 * Parses and validates an uploaded Excel .xlsx workbook against the current catalog items.
 */
export async function parseAndValidateCatalogExcel(
  buffer: ArrayBuffer | Uint8Array,
  currentItems: CatalogItem[]
): Promise<CatalogImportValidationResult> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  if (bytes.byteLength > MAX_CATALOG_EXCEL_FILE_SIZE) {
    return {
      ok: false,
      totalRows: 0,
      validRows: [],
      invalidRows: [],
      unchangedRows: [],
      errors: ['Dung lượng file vượt quá giới hạn 5MB. Vui lòng kiểm tra lại file.'],
    };
  }

  if (!hasValidZipMagicBytes(bytes)) {
    return {
      ok: false,
      totalRows: 0,
      validRows: [],
      invalidRows: [],
      unchangedRows: [],
      errors: ['File không phải định dạng Excel (.xlsx) hợp lệ.'],
    };
  }

  const excelModule = await import('exceljs');
  const Workbook = excelModule.default?.Workbook ?? excelModule.Workbook;
  const workbook = new Workbook();

  try {
    const rawBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(rawBuffer).set(bytes);
    await workbook.xlsx.load(rawBuffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Không thể đọc nội dung file Excel.';
    return {
      ok: false,
      totalRows: 0,
      validRows: [],
      invalidRows: [],
      unchangedRows: [],
      errors: [`Lỗi khi giải mã file Excel: ${message}`],
    };
  }

  const worksheet = workbook.getWorksheet('ThucDon') || workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount < 2) {
    return {
      ok: false,
      totalRows: 0,
      validRows: [],
      invalidRows: [],
      unchangedRows: [],
      errors: ['Bảng tính không có dữ liệu hoặc thiếu dòng tiêu đề.'],
    };
  }

  // Detect header columns in Row 1
  const headerRow = worksheet.getRow(1);
  let idCol = -1;
  let priceCol = -1;
  let stockCol = -1;
  let nameCol = -1;
  let categoryCol = -1;

  headerRow.eachCell((cell, colNumber) => {
    const text = normalizeHeader(cell.value);
    if (!text) return;

    if (idCol === -1 && (text === 'id' || text === 'mamon' || text === 'itemid' || text.includes('mamon') || text.includes('itemid'))) {
      idCol = colNumber;
    } else if (idCol === -1 && (text.startsWith('ma') || text.includes('id'))) {
      idCol = colNumber;
    }

    if (priceCol === -1 && (text === 'price' || text === 'giaban' || text === 'gia' || text.includes('giaban') || text.includes('price'))) {
      priceCol = colNumber;
    }

    if (stockCol === -1 && (text === 'stock' || text === 'tonkho' || text === 'ton' || text === 'soluong' || text.includes('tonkho') || text.includes('stock'))) {
      stockCol = colNumber;
    }

    if (nameCol === -1 && (text.includes('tenmon') || text.includes('itemname') || text.includes('ten') || text.includes('name'))) {
      nameCol = colNumber;
    }

    if (categoryCol === -1 && (text.includes('danhmuc') || text.includes('category'))) {
      categoryCol = colNumber;
    }
  });

  const missingHeaders: string[] = [];
  if (idCol === -1) missingHeaders.push('Mã món (Item ID)');
  if (priceCol === -1) missingHeaders.push('Giá bán (Price)');
  if (stockCol === -1) missingHeaders.push('Tồn kho (Stock)');

  if (missingHeaders.length > 0) {
    return {
      ok: false,
      totalRows: 0,
      validRows: [],
      invalidRows: [],
      unchangedRows: [],
      errors: [
        `File Excel thiếu cột bắt buộc: ${missingHeaders.join(', ')}. Vui lòng tải file mẫu từ nút "Xuất Excel" và chỉnh sửa.`,
      ],
    };
  }

  const itemMap = new Map(currentItems.map((item) => [item.id, item]));
  const seenIds = new Set<string>();

  const validRows: CatalogImportRowParsed[] = [];
  const invalidRows: CatalogImportRowParsed[] = [];
  const unchangedRows: CatalogImportRowParsed[] = [];

  let dataRowCount = 0;

  for (let rowIdx = 2; rowIdx <= worksheet.rowCount; rowIdx++) {
    const row = worksheet.getRow(rowIdx);

    const rawIdVal = extractPrimitiveCellValue(row.getCell(idCol).value);
    const rawPriceVal = extractPrimitiveCellValue(row.getCell(priceCol).value);
    const rawStockVal = extractPrimitiveCellValue(row.getCell(stockCol).value);
    const rawNameVal = nameCol !== -1 ? String(extractPrimitiveCellValue(row.getCell(nameCol).value) || '') : '';
    const rawCatVal = categoryCol !== -1 ? String(extractPrimitiveCellValue(row.getCell(categoryCol).value) || '') : '';

    // Check if entire row is empty
    const isRowEmpty =
      (rawIdVal === '' || rawIdVal === null || rawIdVal === undefined) &&
      (rawPriceVal === '' || rawPriceVal === null || rawPriceVal === undefined) &&
      (rawStockVal === '' || rawStockVal === null || rawStockVal === undefined);

    if (isRowEmpty) {
      continue;
    }

    dataRowCount++;
    if (dataRowCount > MAX_CATALOG_EXCEL_ROWS) {
      return {
        ok: false,
        totalRows: dataRowCount,
        validRows: [],
        invalidRows: [],
        unchangedRows: [],
        errors: [`File vượt quá giới hạn tối đa ${MAX_CATALOG_EXCEL_ROWS} dòng dữ liệu.`],
      };
    }

    const rowErrors: string[] = [];
    const idString = String(rawIdVal || '').trim();

    if (!idString) {
      rowErrors.push('Thiếu mã món (Item ID).');
    } else if (seenIds.has(idString)) {
      rowErrors.push(`Mã món "${idString}" bị lặp lại nhiều lần trong file.`);
    } else {
      seenIds.add(idString);
    }

    const matchedItem = idString ? itemMap.get(idString) : undefined;
    if (idString && !matchedItem) {
      rowErrors.push(
        `Mã món "${idString}" không tồn tại trong cửa hàng này (không tạo mới món từ file nhập).`
      );
    }

    const priceResult = parseCatalogPriceValue(rawPriceVal);
    if (!priceResult.valid) {
      rowErrors.push(priceResult.error);
    }

    const stockResult = parseCatalogStockValue(rawStockVal);
    if (!stockResult.valid) {
      rowErrors.push(stockResult.error);
    }

    const parsedPrice = priceResult.valid ? priceResult.price : undefined;
    const parsedStock = stockResult.valid ? stockResult.stock : undefined;

    let priceChanged = false;
    let stockChanged = false;

    if (matchedItem && priceResult.valid && stockResult.valid) {
      priceChanged = parsedPrice !== matchedItem.price;
      const currentStockNormalized =
        matchedItem.stock_quantity === undefined ? null : matchedItem.stock_quantity;
      stockChanged = parsedStock !== currentStockNormalized;
    }

    let status: 'valid' | 'invalid' | 'unchanged' = 'invalid';
    if (rowErrors.length === 0) {
      if (priceChanged || stockChanged) {
        status = 'valid';
      } else {
        status = 'unchanged';
      }
    }

    const rowResult: CatalogImportRowParsed = {
      rowNumber: rowIdx,
      rawId: idString,
      matchedItem,
      itemName: matchedItem?.name_i18n?.vi || rawNameVal,
      categoryName: rawCatVal,
      rawPrice: rawPriceVal,
      parsedPrice,
      rawStock: rawStockVal,
      parsedStock,
      errors: rowErrors,
      status,
      priceChanged,
      stockChanged,
    };

    if (status === 'valid') {
      validRows.push(rowResult);
    } else if (status === 'unchanged') {
      unchangedRows.push(rowResult);
    } else {
      invalidRows.push(rowResult);
    }
  }

  return {
    ok: invalidRows.length === 0 && (validRows.length > 0 || unchangedRows.length > 0),
    totalRows: dataRowCount,
    validRows,
    invalidRows,
    unchangedRows,
    errors: [],
  };
}

export interface CatalogExcelBulkUpdateItemPayload {
  id: string;
  price?: number;
  stock_quantity?: number | null;
  expected_stock_quantity?: number | null;
}

/**
 * Builds the narrow bulk_update_price_stock payload items from validated Excel rows.
 * Price-only rows omit stock_quantity so concurrent order stock deductions are never overwritten.
 * Stock-modifying rows include expected_stock_quantity for atomic compare-and-swap protection.
 */
export function buildCatalogExcelBulkUpdateItems(
  validRows: CatalogImportRowParsed[]
): CatalogExcelBulkUpdateItemPayload[] {
  return validRows.map((r) => {
    const entry: CatalogExcelBulkUpdateItemPayload = {
      id: r.rawId,
    };
    if (r.priceChanged && r.parsedPrice !== undefined) {
      entry.price = r.parsedPrice;
    }
    if (r.stockChanged && r.parsedStock !== undefined) {
      entry.stock_quantity = r.parsedStock;
      entry.expected_stock_quantity =
        r.matchedItem?.stock_quantity === undefined
          ? null
          : r.matchedItem.stock_quantity;
    }
    return entry;
  });
}
