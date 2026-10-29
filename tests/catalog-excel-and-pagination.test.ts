import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import type { CatalogItem, Category } from '@/types/qlaok';
import {
  CATALOG_PAGE_SIZES,
  calculateCatalogTotalPages,
  clampCatalogPage,
  getCatalogPaginationRange,
  isValidCatalogPageSize,
  normalizeCatalogPageSize,
  paginateCatalogItems,
} from '@/lib/catalog-pagination';
import {
  buildCatalogExcelBulkUpdateItems,
  buildCatalogXlsxWorkbook,
  hasValidZipMagicBytes,
  parseAndValidateCatalogExcel,
  parseCatalogPriceValue,
  parseCatalogStockValue,
  MAX_CATALOG_EXCEL_FILE_SIZE,
} from '@/lib/catalog-excel';

const sampleCategories: Category[] = [
  {
    id: 'cat-drinks',
    shop_id: 'shop-test',
    name_i18n: { vi: 'Đồ uống', en: 'Drinks' },
    sort_order: 1,
    is_active: true,
  },
  {
    id: 'cat-food',
    shop_id: 'shop-test',
    name_i18n: { vi: 'Món ăn', en: 'Food' },
    sort_order: 2,
    is_active: true,
  },
];

const sampleItems: CatalogItem[] = [
  {
    id: 'item-coffee',
    shop_id: 'shop-test',
    category_id: 'cat-drinks',
    name_i18n: { vi: 'Cà phê đen', en: 'Black Coffee' },
    desc_i18n: { vi: 'Đậm đà', en: 'Strong' },
    price: 25000,
    stock_quantity: null, // Unlimited stock
    is_available: true,
    is_featured: true,
    options_json: [],
    view_count: 10,
    sold_count: 50,
    sort_order: 1,
  },
  {
    id: 'item-tea',
    shop_id: 'shop-test',
    category_id: 'cat-drinks',
    name_i18n: { vi: 'Trà đào', en: 'Peach Tea' },
    desc_i18n: { vi: '', en: '' },
    price: 35000,
    stock_quantity: 20, // Limited stock
    is_available: true,
    is_featured: false,
    options_json: [],
    view_count: 5,
    sold_count: 12,
    sort_order: 2,
  },
  {
    id: 'item-cake',
    shop_id: 'shop-test',
    category_id: 'cat-food',
    name_i18n: { vi: 'Bánh ngọt', en: 'Cake' },
    desc_i18n: { vi: '', en: '' },
    price: 45000,
    stock_quantity: 0, // Out of stock
    is_available: false,
    is_featured: false,
    options_json: [],
    view_count: 2,
    sold_count: 3,
    sort_order: 3,
  },
];

// ==========================================
// Suite 1: Pagination Logic
// ==========================================

test('Catalog pagination enforces exact page sizes [10, 20, 50, 100]', () => {
  assert.deepEqual(CATALOG_PAGE_SIZES, [10, 20, 50, 100]);

  assert.equal(isValidCatalogPageSize(10), true);
  assert.equal(isValidCatalogPageSize(20), true);
  assert.equal(isValidCatalogPageSize(50), true);
  assert.equal(isValidCatalogPageSize(100), true);

  assert.equal(isValidCatalogPageSize(5), false);
  assert.equal(isValidCatalogPageSize(15), false);
  assert.equal(isValidCatalogPageSize(25), false);
  assert.equal(isValidCatalogPageSize(200), false);
  assert.equal(isValidCatalogPageSize(0), false);
  assert.equal(isValidCatalogPageSize(-10), false);
  assert.equal(isValidCatalogPageSize(null), false);
  assert.equal(isValidCatalogPageSize(undefined), false);

  assert.equal(normalizeCatalogPageSize(10), 10);
  assert.equal(normalizeCatalogPageSize(20), 20);
  assert.equal(normalizeCatalogPageSize(50), 50);
  assert.equal(normalizeCatalogPageSize(100), 100);
  assert.equal(normalizeCatalogPageSize(999), 20); // Default fallback
});

test('calculateCatalogTotalPages and clampCatalogPage handle boundaries safely', () => {
  // 0 items
  assert.equal(calculateCatalogTotalPages(0, 20), 1);
  assert.equal(clampCatalogPage(1, 0, 20), 1);
  assert.equal(clampCatalogPage(5, 0, 20), 1);
  assert.equal(clampCatalogPage(-1, 0, 20), 1);

  // 45 items with pageSize 20 -> 3 pages
  assert.equal(calculateCatalogTotalPages(45, 20), 3);
  assert.equal(clampCatalogPage(0, 45, 20), 1);
  assert.equal(clampCatalogPage(1, 45, 20), 1);
  assert.equal(clampCatalogPage(2, 45, 20), 2);
  assert.equal(clampCatalogPage(3, 45, 20), 3);
  assert.equal(clampCatalogPage(4, 45, 20), 3); // Clamped to 3
  assert.equal(clampCatalogPage(100, 45, 20), 3); // Clamped to 3
});

test('getCatalogPaginationRange returns accurate ranges and navigation flags', () => {
  // 0 items
  const r0 = getCatalogPaginationRange(1, 20, 0);
  assert.equal(r0.start, 0);
  assert.equal(r0.end, 0);
  assert.equal(r0.totalItems, 0);
  assert.equal(r0.totalPages, 1);
  assert.equal(r0.hasPrev, false);
  assert.equal(r0.hasNext, false);

  // 45 items, page 1 of 3
  const r1 = getCatalogPaginationRange(1, 20, 45);
  assert.equal(r1.start, 1);
  assert.equal(r1.end, 20);
  assert.equal(r1.totalItems, 45);
  assert.equal(r1.totalPages, 3);
  assert.equal(r1.hasPrev, false);
  assert.equal(r1.hasNext, true);

  // 45 items, page 2 of 3
  const r2 = getCatalogPaginationRange(2, 20, 45);
  assert.equal(r2.start, 21);
  assert.equal(r2.end, 40);
  assert.equal(r2.hasPrev, true);
  assert.equal(r2.hasNext, true);

  // 45 items, page 3 of 3 (last page)
  const r3 = getCatalogPaginationRange(3, 20, 45);
  assert.equal(r3.start, 41);
  assert.equal(r3.end, 45);
  assert.equal(r3.hasPrev, true);
  assert.equal(r3.hasNext, false);
});

test('paginateCatalogItems slices items accurately according to page size', () => {
  const list = Array.from({ length: 45 }, (_, i) => ({ id: `item-${i + 1}` }));

  // Page 1 (size 20)
  const p1 = paginateCatalogItems(list, 1, 20);
  assert.equal(p1.length, 20);
  assert.equal(p1[0].id, 'item-1');
  assert.equal(p1[19].id, 'item-20');

  // Page 2 (size 20)
  const p2 = paginateCatalogItems(list, 2, 20);
  assert.equal(p2.length, 20);
  assert.equal(p2[0].id, 'item-21');
  assert.equal(p2[19].id, 'item-40');

  // Page 3 (size 20)
  const p3 = paginateCatalogItems(list, 3, 20);
  assert.equal(p3.length, 5);
  assert.equal(p3[0].id, 'item-41');
  assert.equal(p3[4].id, 'item-45');

  // Page size 50 -> all 45 items on page 1
  const pSize50 = paginateCatalogItems(list, 1, 50);
  assert.equal(pSize50.length, 45);

  // Page size 10 -> exactly 10 items
  const pSize10 = paginateCatalogItems(list, 1, 10);
  assert.equal(pSize10.length, 10);
});

// ==========================================
// Suite 2: Excel Export & Import
// ==========================================

test('hasValidZipMagicBytes validates OOXML/ZIP headers', () => {
  assert.equal(hasValidZipMagicBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04])), true);
  assert.equal(hasValidZipMagicBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x05])), false);
  assert.equal(hasValidZipMagicBytes(new Uint8Array([0x00, 0x00, 0x00, 0x00])), false);
  assert.equal(hasValidZipMagicBytes(new Uint8Array([0x50])), false);
});

test('buildCatalogXlsxWorkbook creates valid OOXML workbook with correct worksheets and unlimited stock formatting', async () => {
  const bytes = await buildCatalogXlsxWorkbook(sampleItems, sampleCategories);
  assert.ok(hasValidZipMagicBytes(bytes));

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(bytes).buffer);

  const sheet = workbook.getWorksheet('ThucDon')!;
  assert.ok(sheet, 'ThucDon sheet must exist');
  assert.equal(sheet.rowCount, sampleItems.length + 1); // 1 header + 3 items

  // Check headers
  const headers = [1, 2, 3, 4, 5, 6].map((col) => sheet.getCell(1, col).value);
  assert.deepEqual(headers, [
    'Mã món (Item ID)',
    'Danh mục (Category)',
    'Tên món (Item Name)',
    'Tên tiếng Anh (English Name)',
    'Giá bán (Price)',
    'Tồn kho (Stock)',
  ]);

  // Check Item 1: Coffee (unlimited stock) -> should be '∞'
  assert.equal(sheet.getCell('A2').value, 'item-coffee');
  assert.equal(sheet.getCell('B2').value, 'Đồ uống');
  assert.equal(sheet.getCell('C2').value, 'Cà phê đen');
  assert.equal(sheet.getCell('D2').value, 'Black Coffee');
  assert.equal(sheet.getCell('E2').value, 25000);
  assert.equal(sheet.getCell('F2').value, '∞');

  // Check Item 2: Tea (stock: 20)
  assert.equal(sheet.getCell('A3').value, 'item-tea');
  assert.equal(sheet.getCell('E3').value, 35000);
  assert.equal(sheet.getCell('F3').value, 20);

  // Check Item 3: Cake (stock: 0)
  assert.equal(sheet.getCell('A4').value, 'item-cake');
  assert.equal(sheet.getCell('E4').value, 45000);
  assert.equal(sheet.getCell('F4').value, 0);

  // Check Guide sheet
  const guideSheet = workbook.getWorksheet('HuongDan');
  assert.ok(guideSheet, 'HuongDan instructions sheet must exist');
});

test('parseCatalogPriceValue parses numbers and formatted strings and rejects invalid inputs', () => {
  // Numbers: finite non-negative integers only (never rounds)
  assert.deepEqual(parseCatalogPriceValue(25000), { valid: true, price: 25000 });
  assert.deepEqual(parseCatalogPriceValue(0), { valid: true, price: 0 });
  assert.deepEqual(parseCatalogPriceValue(-0), { valid: true, price: 0 });
  assert.ok(Object.is((parseCatalogPriceValue(-0) as { price: number }).price, 0));
  assert.deepEqual(parseCatalogPriceValue(1_000_000_000), { valid: true, price: 1000000000 });
  // Fractional numbers must be strictly rejected (never rounded)
  assert.equal(parseCatalogPriceValue(45000.4).valid, false);
  assert.equal(parseCatalogPriceValue(35000.5).valid, false);
  assert.equal(parseCatalogPriceValue(0.5).valid, false);
  assert.equal(parseCatalogPriceValue(-0.5).valid, false);

  // Valid formatted strings (thousand separators, currency symbols, whitespace)
  assert.deepEqual(parseCatalogPriceValue('35,000'), { valid: true, price: 35000 });
  assert.deepEqual(parseCatalogPriceValue('35.000'), { valid: true, price: 35000 });
  assert.deepEqual(parseCatalogPriceValue('35.000đ'), { valid: true, price: 35000 });
  assert.deepEqual(parseCatalogPriceValue('35,000₫'), { valid: true, price: 35000 });
  assert.deepEqual(parseCatalogPriceValue(' 50000 VND '), { valid: true, price: 50000 });
  assert.deepEqual(parseCatalogPriceValue('0'), { valid: true, price: 0 });
  assert.deepEqual(parseCatalogPriceValue('0đ'), { valid: true, price: 0 });
  assert.deepEqual(parseCatalogPriceValue(' 150.000 đ '), { valid: true, price: 150000 });
  assert.deepEqual(parseCatalogPriceValue('1,234,567'), { valid: true, price: 1234567 });
  assert.deepEqual(parseCatalogPriceValue('1.234.567'), { valid: true, price: 1234567 });
  assert.deepEqual(parseCatalogPriceValue('1,234,567đ'), { valid: true, price: 1234567 });
  assert.deepEqual(parseCatalogPriceValue('₫ 1,234,567'), { valid: true, price: 1234567 });
  assert.deepEqual(parseCatalogPriceValue('VND 35000'), { valid: true, price: 35000 });
  assert.deepEqual(parseCatalogPriceValue('35.000 VND'), { valid: true, price: 35000 });

  // Negative / malformed price rejections
  assert.equal(parseCatalogPriceValue(-1).valid, false);
  assert.equal(parseCatalogPriceValue(-500).valid, false);
  assert.equal(parseCatalogPriceValue('-1').valid, false);
  assert.equal(parseCatalogPriceValue('-1000').valid, false);
  assert.equal(parseCatalogPriceValue('-50000').valid, false);
  assert.equal(parseCatalogPriceValue('-35.000đ').valid, false);
  assert.equal(parseCatalogPriceValue('').valid, false);
  assert.equal(parseCatalogPriceValue('   ').valid, false);
  assert.equal(parseCatalogPriceValue(null).valid, false);
  assert.equal(parseCatalogPriceValue(undefined).valid, false);
  assert.equal(parseCatalogPriceValue('abc').valid, false);
  assert.equal(parseCatalogPriceValue('50k').valid, false);
  assert.equal(parseCatalogPriceValue('$50').valid, false);
  assert.equal(parseCatalogPriceValue('free').valid, false);
  assert.equal(parseCatalogPriceValue(NaN).valid, false);
  assert.equal(parseCatalogPriceValue(Infinity).valid, false);
  assert.equal(parseCatalogPriceValue(-Infinity).valid, false);
  assert.equal(parseCatalogPriceValue(1_000_000_001).valid, false); // exceeds max limit
  assert.equal(parseCatalogPriceValue('1000000001').valid, false);
  assert.equal(parseCatalogPriceValue('1.000.000.001').valid, false);

  // Fractional and malformed string prices rejected (integer-VND rule)
  assert.equal(parseCatalogPriceValue('12.5').valid, false);
  assert.equal(parseCatalogPriceValue('12.50').valid, false);
  assert.equal(parseCatalogPriceValue('12,5đ').valid, false);
  assert.equal(parseCatalogPriceValue('35000.5').valid, false);
  assert.equal(parseCatalogPriceValue('35.000,5').valid, false);
  assert.equal(parseCatalogPriceValue('35,000.5').valid, false);
  assert.equal(parseCatalogPriceValue('35.000.5').valid, false);
  assert.equal(parseCatalogPriceValue('1,23,456').valid, false); // inconsistent grouping
  assert.equal(parseCatalogPriceValue('1.234,567').valid, false); // mixed grouping
  assert.equal(parseCatalogPriceValue('35.00').valid, false);
  assert.equal(parseCatalogPriceValue('35.0005').valid, false);
});

test('parseCatalogStockValue handles unlimited representations and finite integers', () => {
  // Unlimited representations -> null
  assert.deepEqual(parseCatalogStockValue(null), { valid: true, stock: null });
  assert.deepEqual(parseCatalogStockValue(undefined), { valid: true, stock: null });
  assert.deepEqual(parseCatalogStockValue(''), { valid: true, stock: null });
  assert.deepEqual(parseCatalogStockValue('  '), { valid: true, stock: null });
  assert.deepEqual(parseCatalogStockValue('∞'), { valid: true, stock: null });
  assert.deepEqual(parseCatalogStockValue('unlimited'), { valid: true, stock: null });
  assert.deepEqual(parseCatalogStockValue('Không giới hạn'), { valid: true, stock: null });
  assert.deepEqual(parseCatalogStockValue('khong gioi han'), { valid: true, stock: null });

  // Valid finite stock -> non-negative integer
  assert.deepEqual(parseCatalogStockValue(0), { valid: true, stock: 0 });
  assert.deepEqual(parseCatalogStockValue('0'), { valid: true, stock: 0 });
  assert.deepEqual(parseCatalogStockValue(15), { valid: true, stock: 15 });
  assert.deepEqual(parseCatalogStockValue('50'), { valid: true, stock: 50 });
  assert.deepEqual(parseCatalogStockValue(500), { valid: true, stock: 500 });

  // Invalid / decimal stock rejections (never silently converts decimal to truncated or scaled int)
  assert.equal(parseCatalogStockValue(-1).valid, false);
  assert.equal(parseCatalogStockValue('-5').valid, false);
  assert.equal(parseCatalogStockValue(1.5).valid, false);
  assert.equal(parseCatalogStockValue(12.5).valid, false);
  assert.equal(parseCatalogStockValue('12.5').valid, false);
  assert.equal(parseCatalogStockValue('ten').valid, false);
  assert.equal(parseCatalogStockValue('abc').valid, false);
  assert.equal(parseCatalogStockValue('five').valid, false);
});

test('parseAndValidateCatalogExcel round-trips exported workbook with 100% accuracy', async () => {
  const bytes = await buildCatalogXlsxWorkbook(sampleItems, sampleCategories);
  const result = await parseAndValidateCatalogExcel(bytes, sampleItems);

  assert.equal(result.ok, true);
  assert.equal(result.totalRows, 3);
  assert.equal(result.errors.length, 0);
  assert.equal(result.invalidRows.length, 0);
  // No price or stock was modified yet -> all 3 rows are unchanged
  assert.equal(result.unchangedRows.length, 3);
  assert.equal(result.validRows.length, 0);

  // Unlimited stock round-tripped cleanly
  const coffeeRow = result.unchangedRows.find((r) => r.rawId === 'item-coffee')!;
  assert.equal(coffeeRow.parsedPrice, 25000);
  assert.equal(coffeeRow.parsedStock, null); // Unlimited stock preserved as null

  // Finite stock round-tripped cleanly
  const teaRow = result.unchangedRows.find((r) => r.rawId === 'item-tea')!;
  assert.equal(teaRow.parsedPrice, 35000);
  assert.equal(teaRow.parsedStock, 20);

  // Out of stock (0) round-tripped cleanly
  const cakeRow = result.unchangedRows.find((r) => r.rawId === 'item-cake')!;
  assert.equal(cakeRow.parsedPrice, 45000);
  assert.equal(cakeRow.parsedStock, 0);
});

test('parseAndValidateCatalogExcel detects price/stock modifications, duplicates, and foreign item IDs', async () => {
  // Create an Excel workbook simulating merchant edits
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ThucDon');
  ws.addRow(['Mã món (Item ID)', 'Tên món', 'Giá bán (Price)', 'Tồn kho (Stock)']);

  // Row 2: Valid edit to coffee (price: 25000 -> 30000, stock: null -> 50)
  ws.addRow(['item-coffee', 'Cà phê đen', 30000, 50]);

  // Row 3: Unchanged tea (price: 35000, stock: 20)
  ws.addRow(['item-tea', 'Trà đào', 35000, 20]);

  // Row 4: Foreign item ID that does not exist in this shop
  ws.addRow(['item-foreign-999', 'Món lạ', 60000, 10]);

  // Row 5: Duplicate item ID (item-coffee repeated)
  ws.addRow(['item-coffee', 'Cà phê đen lặp', 32000, 10]);

  // Row 6: Invalid price (negative) & invalid stock (negative)
  ws.addRow(['item-cake', 'Bánh ngọt lỗi', -5000, -10]);

  const buf = await wb.xlsx.writeBuffer();
  const result = await parseAndValidateCatalogExcel(
    new Uint8Array(buf as unknown as ArrayBuffer),
    sampleItems
  );

  assert.equal(result.totalRows, 5);
  assert.equal(result.ok, false); // Has invalid rows

  // 1 valid row (item-coffee)
  assert.equal(result.validRows.length, 1);
  assert.equal(result.validRows[0].rawId, 'item-coffee');
  assert.equal(result.validRows[0].parsedPrice, 30000);
  assert.equal(result.validRows[0].parsedStock, 50);
  assert.equal(result.validRows[0].priceChanged, true);
  assert.equal(result.validRows[0].stockChanged, true);

  // 1 unchanged row (item-tea)
  assert.equal(result.unchangedRows.length, 1);
  assert.equal(result.unchangedRows[0].rawId, 'item-tea');

  // 3 invalid rows (foreign ID, duplicate ID, invalid price/stock)
  assert.equal(result.invalidRows.length, 3);

  const foreignRow = result.invalidRows.find((r) => r.rawId === 'item-foreign-999')!;
  assert.ok(foreignRow.errors.some((e) => e.includes('không tồn tại trong cửa hàng')));

  const dupRow = result.invalidRows.find((r) => r.rowNumber === 5)!;
  assert.ok(dupRow.errors.some((e) => e.includes('lặp lại')));

  const invalidValRow = result.invalidRows.find((r) => r.rawId === 'item-cake')!;
  assert.ok(invalidValRow.errors.some((e) => e.includes('Giá bán')));
  assert.ok(invalidValRow.errors.some((e) => e.includes('Tồn kho')));
});

test('parseAndValidateCatalogExcel rejects missing required headers and oversized files', async () => {
  // Missing price column
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ThucDon');
  ws.addRow(['Mã món (Item ID)', 'Tên món', 'Tồn kho']);
  ws.addRow(['item-coffee', 'Cà phê', 10]);
  const buf = await wb.xlsx.writeBuffer();

  const missingResult = await parseAndValidateCatalogExcel(
    new Uint8Array(buf as unknown as ArrayBuffer),
    sampleItems
  );
  assert.equal(missingResult.ok, false);
  assert.ok(missingResult.errors.some((e) => e.includes('Giá bán (Price)')));

  // Oversized file (> 5MB)
  const fakeHugeBuffer = new Uint8Array(MAX_CATALOG_EXCEL_FILE_SIZE + 10);
  const sizeResult = await parseAndValidateCatalogExcel(fakeHugeBuffer, sampleItems);
  assert.equal(sizeResult.ok, false);
  assert.ok(sizeResult.errors.some((e) => e.includes('5MB')));
});

test('parseAndValidateCatalogExcel strictly protects immutable fields from workbook injection', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ThucDon');
  // Inject malicious columns trying to overwrite shop_id, role, name, options
  ws.addRow([
    'Mã món (Item ID)',
    'Giá bán (Price)',
    'Tồn kho (Stock)',
    'shop_id',
    'options_json',
    'sold_count',
  ]);
  ws.addRow([
    'item-coffee',
    28000,
    15,
    'attacker-shop',
    JSON.stringify([{ malicious: true }]),
    999999,
  ]);
  const buf = await wb.xlsx.writeBuffer();

  const result = await parseAndValidateCatalogExcel(
    new Uint8Array(buf as unknown as ArrayBuffer),
    sampleItems
  );
  assert.equal(result.validRows.length, 1);
  const parsed = result.validRows[0];

  // Only price and stock are extracted; injected fields are completely absent
  assert.equal(parsed.parsedPrice, 28000);
  assert.equal(parsed.parsedStock, 15);
  assert.equal('shop_id' in parsed, false);
  assert.equal('options_json' in parsed, false);
  assert.equal('sold_count' in parsed, false);
});

// ==========================================
// Suite 3: Catalog API Server-Side Checks
// ==========================================

test('POST /api/catalog bulk_update_price_stock validates shopId and authentication', async () => {
  const { POST } = await import('@/app/api/catalog/route');

  // Missing shopId
  const resNoShop = await POST(
    new Request('http://localhost:3000/api/catalog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'bulk_update_price_stock' }),
    })
  );
  assert.equal(resNoShop.status, 400);
  const dataNoShop = await resNoShop.json();
  assert.ok(dataNoShop.error.includes('Missing shopId'));

  // Unauthenticated caller
  const resUnauth = await POST(
    new Request('http://localhost:3000/api/catalog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'bulk_update_price_stock',
        shopId: 'shop-test',
        items: [{ id: 'item-coffee', price: 30000 }],
      }),
    })
  );
  assert.equal(resUnauth.status, 401);

  // Invalid items (empty array)
  // Even if auth is attempted with invalid session, it fails closed with 401
  const resEmptyItems = await POST(
    new Request('http://localhost:3000/api/catalog', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer invalid-token',
      },
      body: JSON.stringify({
        action: 'bulk_update_price_stock',
        shopId: 'shop-test',
        items: [],
      }),
    })
  );
  assert.equal(resEmptyItems.status, 401);
});

test('POST /api/catalog bulk_update_price_stock rejects malformed entries and reports unsuccessful overall response', async () => {
  const { POST } = await import('@/app/api/catalog/route');
  const { issueSessionToken } = await import('@/lib/server-auth');
  const { setSupabaseDbClientForTests } = await import('@/lib/db');

  const ownerToken = issueSessionToken({
    id: 'owner-demo-001',
    email: 'chuquan@qlaok.vn',
    role: 'owner',
  });

  const mockItems: CatalogItem[] = [
    {
      id: 'item-fnb-001',
      shop_id: 'shop-fnb-001',
      category_id: 'cat-fnb-001',
      name_i18n: { vi: 'Phở bò tái nạm', en: 'Beef Pho' },
      desc_i18n: { vi: '', en: '' },
      price: 55000,
      stock_quantity: 10,
      is_available: true,
      is_featured: true,
      options_json: [],
      view_count: 10,
      sold_count: 5,
      sort_order: 1,
    },
    {
      id: 'item-fnb-002',
      shop_id: 'shop-fnb-001',
      category_id: 'cat-fnb-001',
      name_i18n: { vi: 'Cà phê nâu', en: 'Brown Coffee' },
      desc_i18n: { vi: '', en: '' },
      price: 29000,
      stock_quantity: 5,
      is_available: true,
      is_featured: false,
      options_json: [],
      view_count: 5,
      sold_count: 2,
      sort_order: 2,
    },
  ];

  const itemsStore = mockItems.map((i) => ({ ...i }));

  const mockDbClient = {
    from(table: string) {
      if (table === 'items') {
        return {
          select(_fields = '*') {
            return {
              eq(field: string, val: unknown) {
                return {
                  async maybeSingle() {
                    const match = itemsStore.find(
                      (item) => (item as Record<string, unknown>)[field] === val
                    );
                    return { data: match ? { ...match } : null, error: null };
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'categories') {
        return {
          select(_fields = '*') {
            return {
              eq(_field: string, _val: unknown) {
                return {
                  async maybeSingle() {
                    return {
                      data: { id: 'cat-fnb-001', shop_id: 'shop-fnb-001' },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'shops') {
        return {
          select(_fields = '*') {
            return {
              eq(_field: string, _val: unknown) {
                return {
                  async maybeSingle() {
                    return {
                      data: { id: 'shop-fnb-001', owner_id: 'owner-demo-001' },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }
      return {};
    },
  };

  setSupabaseDbClientForTests(mockDbClient);

  try {
    // Payload containing non-object entries, missing IDs, and malformed price/stock
    const res = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_update_price_stock',
          shopId: 'shop-fnb-001',
          items: [
            null,
            'not-an-object',
            { id: '   ', price: 30000 },
            { id: 'item-fnb-001', price: -500 }, // invalid negative price
            { id: 'item-fnb-002', stock_quantity: 'invalid-stock' }, // invalid non-integer stock
          ],
        }),
      })
    );

    assert.equal(res.status, 200);
    const data = await res.json();

    // Every input entry must get a result row
    assert.equal(data.results.length, 5);
    // Overall response must be unsuccessful
    assert.equal(data.success, false);
    assert.equal(data.updatedCount, 0);

    // All 5 rows failed with informative errors
    assert.equal(data.results[0].success, false);
    assert.ok(data.results[0].error.includes('object'));

    assert.equal(data.results[1].success, false);
    assert.ok(data.results[1].error.includes('object'));

    assert.equal(data.results[2].success, false);
    assert.ok(data.results[2].error.includes('Thiếu mã món'));

    assert.equal(data.results[3].success, false);
    assert.ok(data.results[3].error.includes('Giá bán không hợp lệ'));

    assert.equal(data.results[4].success, false);
    assert.ok(data.results[4].error.includes('Tồn kho không hợp lệ'));
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('POST /api/catalog bulk_update_price_stock rejects duplicate IDs without updating that item', async () => {
  const { POST } = await import('@/app/api/catalog/route');
  const { issueSessionToken } = await import('@/lib/server-auth');
  const { setSupabaseDbClientForTests } = await import('@/lib/db');

  const ownerToken = issueSessionToken({
    id: 'owner-demo-001',
    email: 'chuquan@qlaok.vn',
    role: 'owner',
  });

  const mockItem: CatalogItem = {
    id: 'item-fnb-001',
    shop_id: 'shop-fnb-001',
    category_id: 'cat-fnb-001',
    name_i18n: { vi: 'Phở bò tái nạm', en: 'Beef Pho' },
    desc_i18n: { vi: '', en: '' },
    price: 55000,
    stock_quantity: 10,
    is_available: true,
    is_featured: true,
    options_json: [],
    view_count: 10,
    sold_count: 5,
    sort_order: 1,
  };

  const itemsStore = [{ ...mockItem }];

  const mockDbClient = {
    from(table: string) {
      if (table === 'items') {
        return {
          select(_fields = '*') {
            return {
              eq(field: string, val: unknown) {
                return {
                  async maybeSingle() {
                    const match = itemsStore.find(
                      (item) => (item as Record<string, unknown>)[field] === val
                    );
                    return { data: match ? { ...match } : null, error: null };
                  },
                };
              },
            };
          },
          update(patch: Partial<CatalogItem>) {
            return {
              eq(field: string, val: unknown) {
                const idx = itemsStore.findIndex(
                  (item) => (item as Record<string, unknown>)[field] === val
                );
                if (idx >= 0) {
                  itemsStore[idx] = { ...itemsStore[idx], ...patch };
                }
                return {
                  select(_fields = '*') {
                    return {
                      async single() {
                        if (idx >= 0) {
                          return { data: itemsStore[idx], error: null };
                        }
                        return { data: null, error: { message: 'Item not found' } };
                      },
                    };
                  },
                };
              },
            };
          },
          upsert(payload: CatalogItem) {
            const idx = itemsStore.findIndex((i) => i.id === payload.id);
            if (idx >= 0) {
              itemsStore[idx] = { ...itemsStore[idx], ...payload };
            } else {
              itemsStore.push({ ...payload });
            }
            return {
              select() {
                return {
                  async single() {
                    return { data: itemsStore[idx], error: null };
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'categories') {
        return {
          select(_fields = '*') {
            return {
              eq(_field: string, _val: unknown) {
                return {
                  async maybeSingle() {
                    return {
                      data: { id: 'cat-fnb-001', shop_id: 'shop-fnb-001' },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'shops') {
        return {
          select(_fields = '*') {
            return {
              eq(_field: string, _val: unknown) {
                return {
                  async maybeSingle() {
                    return {
                      data: { id: 'shop-fnb-001', owner_id: 'owner-demo-001' },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }
      return {};
    },
  };

  setSupabaseDbClientForTests(mockDbClient);

  try {
    // Direct payload with duplicate IDs for item-fnb-001
    const res = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_update_price_stock',
          shopId: 'shop-fnb-001',
          items: [
            { id: 'item-fnb-001', price: 99000 },
            { id: 'item-fnb-001', price: 105000 },
          ],
        }),
      })
    );

    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.success, false);
    assert.equal(data.updatedCount, 0);
    assert.equal(data.results.length, 2);

    // Both occurrences must be rejected
    assert.equal(data.results[0].success, false);
    assert.ok(data.results[0].error.includes('trùng lặp'));
    assert.equal(data.results[1].success, false);
    assert.ok(data.results[1].error.includes('trùng lặp'));

    // Database item must remain untouched
    assert.equal(itemsStore[0].price, 55000);
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('POST /api/catalog bulk_update_price_stock derives is_available matching handleUpdateStock and protects immutable fields', async () => {
  const { POST } = await import('@/app/api/catalog/route');
  const { issueSessionToken } = await import('@/lib/server-auth');
  const { setSupabaseDbClientForTests } = await import('@/lib/db');

  const ownerToken = issueSessionToken({
    id: 'owner-demo-001',
    email: 'chuquan@qlaok.vn',
    role: 'owner',
  });

  const mockItem: CatalogItem = {
    id: 'item-fnb-001',
    shop_id: 'shop-fnb-001',
    category_id: 'cat-fnb-001',
    name_i18n: { vi: 'Phở bò tái nạm', en: 'Beef Pho' },
    desc_i18n: { vi: 'Gia truyền', en: 'Traditional' },
    price: 55000,
    stock_quantity: 10,
    is_available: true,
    is_featured: true,
    options_json: [
      {
        id: 'opt-quay',
        name_i18n: { vi: 'Quẩy' },
        required: false,
        choices: [
          {
            id: 'choice-1',
            label_i18n: { vi: '1 cái' },
            extra_price: 5000,
          },
        ],
      },
    ],
    view_count: 100,
    sold_count: 50,
    sort_order: 1,
  };

  const itemsStore = [{ ...mockItem }];

  const mockDbClient = {
    from(table: string) {
      if (table === 'items') {
        return {
          select(_fields = '*') {
            return {
              eq(field: string, val: unknown) {
                return {
                  async maybeSingle() {
                    const match = itemsStore.find(
                      (item) => (item as Record<string, unknown>)[field] === val
                    );
                    return { data: match ? { ...match } : null, error: null };
                  },
                };
              },
            };
          },
          update(patch: Partial<CatalogItem>) {
            return {
              eq(field: string, val: unknown) {
                const idx = itemsStore.findIndex(
                  (item) => (item as Record<string, unknown>)[field] === val
                );
                if (idx >= 0) {
                  itemsStore[idx] = { ...itemsStore[idx], ...patch };
                }
                return {
                  select(_fields = '*') {
                    return {
                      async single() {
                        if (idx >= 0) {
                          return { data: itemsStore[idx], error: null };
                        }
                        return { data: null, error: { message: 'Item not found' } };
                      },
                    };
                  },
                };
              },
            };
          },
          upsert(payload: CatalogItem) {
            const idx = itemsStore.findIndex((i) => i.id === payload.id);
            if (idx >= 0) {
              itemsStore[idx] = { ...itemsStore[idx], ...payload };
            } else {
              itemsStore.push({ ...payload });
            }
            return {
              select() {
                return {
                  async single() {
                    const item = itemsStore.find((i) => i.id === payload.id);
                    return { data: item ? { ...item } : null, error: null };
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'categories') {
        return {
          select(_fields = '*') {
            return {
              eq(_field: string, _val: unknown) {
                return {
                  async maybeSingle() {
                    return {
                      data: { id: 'cat-fnb-001', shop_id: 'shop-fnb-001' },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'shops') {
        return {
          select(_fields = '*') {
            return {
              eq(_field: string, _val: unknown) {
                return {
                  async maybeSingle() {
                    return {
                      data: { id: 'shop-fnb-001', owner_id: 'owner-demo-001' },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }
      return {};
    },
  };

  setSupabaseDbClientForTests(mockDbClient);

  try {
    // Step 1: Update stock to 0 -> is_available must become false (sold out)
    // Attempt to inject malicious values for shop_id, sold_count, and name_i18n
    const resSoldOut = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_update_price_stock',
          shopId: 'shop-fnb-001',
          items: [
            {
              id: 'item-fnb-001',
              price: 68000,
              stock_quantity: 0,
              expected_stock_quantity: 10,
              // Injected fields that must be strictly ignored:
              shop_id: 'attacker-shop',
              sold_count: 999999,
              name_i18n: { vi: 'Tên bị hack', en: 'Hacked' },
            },
          ],
        }),
      })
    );

    assert.equal(resSoldOut.status, 200);
    const dataSoldOut = await resSoldOut.json();
    assert.equal(dataSoldOut.success, true);
    assert.equal(dataSoldOut.updatedCount, 1);

    const itemSoldOut = itemsStore.find((i) => i.id === 'item-fnb-001')!;

    assert.equal(itemSoldOut.price, 68000);
    assert.equal(itemSoldOut.stock_quantity, 0);
    assert.equal(itemSoldOut.is_available, false); // Derived sold out!
    assert.equal(itemSoldOut.shop_id, 'shop-fnb-001'); // Protected!
    assert.equal(itemSoldOut.sold_count, 50); // Protected!
    assert.equal(itemSoldOut.name_i18n.vi, 'Phở bò tái nạm'); // Protected!

    // Step 2: Restore positive stock (> 0) -> is_available must become true (available)
    const resRestored = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_update_price_stock',
          shopId: 'shop-fnb-001',
          items: [
            {
              id: 'item-fnb-001',
              stock_quantity: 30,
              expected_stock_quantity: 0,
            },
          ],
        }),
      })
    );

    assert.equal(resRestored.status, 200);
    const dataRestored = await resRestored.json();
    assert.equal(dataRestored.success, true);

    const itemRestored = itemsStore.find((i) => i.id === 'item-fnb-001')!;
    assert.equal(itemRestored.stock_quantity, 30);
    assert.equal(itemRestored.is_available, true); // Restored available!

    // Step 3: Unlimited stock (null) preserves is_available
    const resUnlimited = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_update_price_stock',
          shopId: 'shop-fnb-001',
          items: [
            {
              id: 'item-fnb-001',
              stock_quantity: null,
              expected_stock_quantity: 30,
            },
          ],
        }),
      })
    );

    assert.equal(resUnlimited.status, 200);
    const dataUnlimited = await resUnlimited.json();
    assert.equal(dataUnlimited.success, true);

    const itemUnlimited = itemsStore.find((i) => i.id === 'item-fnb-001')!;
    assert.equal(itemUnlimited.stock_quantity, null);
    assert.equal(itemUnlimited.is_available, true); // Preserved!
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('POST /api/catalog bulk_update_price_stock enforces integer-VND rule and rejects null or fractional prices', async () => {
  const { POST } = await import('@/app/api/catalog/route');
  const { issueSessionToken } = await import('@/lib/server-auth');
  const { setSupabaseDbClientForTests } = await import('@/lib/db');

  const ownerToken = issueSessionToken({
    id: 'owner-demo-001',
    email: 'chuquan@qlaok.vn',
    role: 'owner',
  });

  const mockItem: CatalogItem = {
    id: 'item-fnb-001',
    shop_id: 'shop-fnb-001',
    category_id: 'cat-fnb-001',
    name_i18n: { vi: 'Phở bò tái nạm', en: 'Beef Pho' },
    desc_i18n: { vi: '', en: '' },
    price: 55000,
    stock_quantity: 10,
    is_available: true,
    is_featured: false,
    options_json: [],
    view_count: 0,
    sold_count: 0,
    sort_order: 1,
  };

  const itemsStore = [{ ...mockItem }];

  const mockDbClient = {
    from(table: string) {
      if (table === 'items') {
        return {
          select(_fields = '*') {
            return {
              eq(field: string, val: unknown) {
                return {
                  async maybeSingle() {
                    const match = itemsStore.find(
                      (item) => (item as Record<string, unknown>)[field] === val
                    );
                    return { data: match ? { ...match } : null, error: null };
                  },
                };
              },
            };
          },
          update(patch: Partial<CatalogItem>) {
            return {
              eq(field: string, val: unknown) {
                const idx = itemsStore.findIndex(
                  (item) => (item as Record<string, unknown>)[field] === val
                );
                if (idx >= 0) {
                  itemsStore[idx] = { ...itemsStore[idx], ...patch };
                }
                return {
                  select(_fields = '*') {
                    return {
                      async single() {
                        if (idx >= 0) {
                          return { data: itemsStore[idx], error: null };
                        }
                        return { data: null, error: { message: 'Item not found' } };
                      },
                    };
                  },
                };
              },
            };
          },
          upsert(payload: CatalogItem) {
            const idx = itemsStore.findIndex((i) => i.id === payload.id);
            if (idx >= 0) {
              itemsStore[idx] = { ...itemsStore[idx], ...payload };
            } else {
              itemsStore.push({ ...payload });
            }
            return {
              select() {
                return {
                  async single() {
                    const item = itemsStore.find((i) => i.id === payload.id);
                    return { data: item ? { ...item } : null, error: null };
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'categories') {
        return {
          select(_fields = '*') {
            return {
              eq(_field: string, _val: unknown) {
                return {
                  async maybeSingle() {
                    return {
                      data: { id: 'cat-fnb-001', shop_id: 'shop-fnb-001' },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'shops') {
        return {
          select(_fields = '*') {
            return {
              eq(_field: string, _val: unknown) {
                return {
                  async maybeSingle() {
                    return {
                      data: { id: 'shop-fnb-001', owner_id: 'owner-demo-001' },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }
      return {};
    },
  };

  setSupabaseDbClientForTests(mockDbClient);

  try {
    // 1. Direct request with invalid fractional numbers, fractional strings, null price, and empty price
    // Note: Use different IDs so duplicate check isn't triggered before price check
    const resInvalid = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_update_price_stock',
          shopId: 'shop-fnb-001',
          items: [
            { id: 'item-fnb-001', price: 35000.5 }, // numeric decimal rejected
          ],
        }),
      })
    );

    assert.equal(resInvalid.status, 200);
    const dataInvalid = await resInvalid.json();
    assert.equal(dataInvalid.success, false);
    assert.equal(dataInvalid.updatedCount, 0);
    assert.equal(dataInvalid.results.length, 1);
    assert.equal(dataInvalid.results[0].success, false);
    assert.ok(dataInvalid.results[0].error.includes('số nguyên'));
    assert.equal(itemsStore[0].price, 55000); // untouched

    // Check null price rejected
    const resNullPrice = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_update_price_stock',
          shopId: 'shop-fnb-001',
          items: [{ id: 'item-fnb-001', price: null }],
        }),
      })
    );
    const dataNull = await resNullPrice.json();
    assert.equal(dataNull.success, false);
    assert.equal(dataNull.results[0].success, false);
    assert.ok(dataNull.results[0].error.includes('không được để trống'));

    // Check fractional string rejected
    const resFractionalString = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_update_price_stock',
          shopId: 'shop-fnb-001',
          items: [{ id: 'item-fnb-001', price: '35.000,5' }],
        }),
      })
    );
    const dataFracStr = await resFractionalString.json();
    assert.equal(dataFracStr.success, false);
    assert.equal(dataFracStr.results[0].success, false);

    // 2. Direct request with valid formatted price string (e.g. "65.000")
    const resValidFormatted = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_update_price_stock',
          shopId: 'shop-fnb-001',
          items: [{ id: 'item-fnb-001', price: '65.000' }],
        }),
      })
    );

    assert.equal(resValidFormatted.status, 200);
    const dataValid = await resValidFormatted.json();
    assert.equal(dataValid.success, true);
    assert.equal(dataValid.updatedCount, 1);
    assert.equal(itemsStore[0].price, 65000);

    // 3. Genuine omission of price preserves existing price
    const resOmittedPrice = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_update_price_stock',
          shopId: 'shop-fnb-001',
          items: [
            {
              id: 'item-fnb-001',
              stock_quantity: 42,
              expected_stock_quantity: 10,
            },
          ],
        }),
      })
    );

    assert.equal(resOmittedPrice.status, 200);
    const dataOmitted = await resOmittedPrice.json();
    assert.equal(dataOmitted.success, true);
    assert.equal(itemsStore[0].price, 65000); // price preserved!
    assert.equal(itemsStore[0].stock_quantity, 42);
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

// ==========================================
// Suite 4: Bulk Move Category & Bulk Delete Items API
// ==========================================

function createBulkCatalogMockHarness(options?: {
  failUpdateError?: string;
  overrideUpdateCount?: number;
  failDeleteError?: string;
  overrideDeleteCount?: number;
}) {
  const categoriesStore: Category[] = [
    {
      id: 'cat-fnb-001',
      shop_id: 'shop-fnb-001',
      name_i18n: { vi: 'Món chính', en: 'Main Dishes' },
      sort_order: 1,
      is_active: true,
    },
    {
      id: 'cat-fnb-002',
      shop_id: 'shop-fnb-001',
      name_i18n: { vi: 'Đồ uống', en: 'Drinks' },
      sort_order: 2,
      is_active: true,
    },
    {
      id: 'cat-foreign-999',
      shop_id: 'shop-secret-foreign-id',
      name_i18n: { vi: 'Danh mục quán khác', en: 'Foreign Category' },
      sort_order: 1,
      is_active: true,
    },
  ];

  const itemsStore: CatalogItem[] = [
    {
      id: 'item-fnb-001',
      shop_id: 'shop-fnb-001',
      category_id: 'cat-fnb-001',
      name_i18n: { vi: 'Phở bò tái nạm', en: 'Beef Pho' },
      desc_i18n: { vi: 'Nước dùng đậm đà', en: 'Rich broth' },
      price: 55000,
      compare_at_price: 65000,
      stock_quantity: 15,
      is_available: true,
      is_featured: true,
      options_json: [
        {
          id: 'opt-1',
          name_i18n: { vi: 'Thêm quẩy' },
          required: false,
          choices: [
            { id: 'c-1', label_i18n: { vi: '1 đĩa' }, extra_price: 5000 },
          ],
        },
      ],
      view_count: 120,
      sold_count: 45,
      sort_order: 1,
    },
    {
      id: 'item-fnb-002',
      shop_id: 'shop-fnb-001',
      category_id: 'cat-fnb-001',
      name_i18n: { vi: 'Trà đá', en: 'Iced Tea' },
      desc_i18n: { vi: 'Mát lạnh', en: 'Cold' },
      price: 5000,
      compare_at_price: null,
      stock_quantity: null,
      is_available: true,
      is_featured: false,
      options_json: [],
      view_count: 30,
      sold_count: 80,
      sort_order: 2,
    },
    {
      id: 'item-fnb-003',
      shop_id: 'shop-fnb-001',
      category_id: 'cat-fnb-002',
      name_i18n: { vi: 'Cà phê sữa', en: 'Milk Coffee' },
      desc_i18n: { vi: 'Đậm vị', en: 'Bold' },
      price: 29000,
      compare_at_price: null,
      stock_quantity: 0,
      is_available: false,
      is_featured: false,
      options_json: [],
      view_count: 15,
      sold_count: 10,
      sort_order: 3,
    },
    {
      id: 'item-foreign-999',
      shop_id: 'shop-secret-foreign-id',
      category_id: 'cat-foreign-999',
      name_i18n: { vi: 'Món quán khác', en: 'Foreign Item' },
      desc_i18n: { vi: '', en: '' },
      price: 99000,
      compare_at_price: null,
      stock_quantity: 10,
      is_available: true,
      is_featured: false,
      options_json: [],
      view_count: 1,
      sold_count: 1,
      sort_order: 1,
    },
  ];

  const shopsStore = [
    { id: 'shop-fnb-001', owner_id: 'owner-demo-001' },
    { id: 'shop-other-002', owner_id: 'owner-other-002' },
    { id: 'shop-secret-foreign-id', owner_id: 'owner-foreign-999' },
  ];

  const membershipsStore = [
    {
      id: 'mem-staff-no-catalog-manage',
      shop_id: 'shop-fnb-001',
      user_id: 'staff-inventory-only',
      email: 'staff@qlaok.vn',
      full_name: 'Staff Inventory Only',
      role: 'staff',
      permissions: ['catalog.view', 'inventory.adjust', 'orders.view'],
      is_active: true,
      created_at: '2026-10-01T00:00:00.000Z',
      updated_at: '2026-10-01T00:00:00.000Z',
    },
    {
      id: 'mem-cashier-catalog-manage',
      shop_id: 'shop-fnb-001',
      user_id: 'cashier-catalog-manager',
      email: 'cashier@qlaok.vn',
      full_name: 'Cashier Manager',
      role: 'cashier',
      permissions: ['catalog.view', 'catalog.manage', 'orders.view'],
      is_active: true,
      created_at: '2026-10-01T00:00:00.000Z',
      updated_at: '2026-10-01T00:00:00.000Z',
    },
    {
      id: 'mem-staff-view-only',
      shop_id: 'shop-fnb-001',
      user_id: 'staff-view-only',
      email: 'viewonly@qlaok.vn',
      full_name: 'Staff View Only',
      role: 'staff',
      permissions: ['catalog.view', 'orders.view'],
      is_active: true,
      created_at: '2026-10-01T00:00:00.000Z',
      updated_at: '2026-10-01T00:00:00.000Z',
    },
    {
      id: 'mem-staff-inactive',
      shop_id: 'shop-fnb-001',
      user_id: 'staff-inactive',
      email: 'inactive@qlaok.vn',
      full_name: 'Staff Inactive',
      role: 'staff',
      permissions: ['catalog.view', 'catalog.manage', 'inventory.adjust'],
      is_active: false,
      created_at: '2026-10-01T00:00:00.000Z',
      updated_at: '2026-10-01T00:00:00.000Z',
    },
  ];

  const categorySelectCalls: Array<{
    eqFilters: Record<string, unknown>;
    eqOrder: string[];
  }> = [];

  const itemSelectCalls: Array<{
    eqFilters: Record<string, unknown>;
    inFilters: Record<string, unknown[]>;
    filterOrder: string[];
  }> = [];

  const updateCalls: Array<{
    patch: Record<string, unknown>;
    eqFilters: Record<string, unknown>;
    inFilters: Record<string, unknown[]>;
  }> = [];

  const deleteCalls: Array<{
    eqFilters: Record<string, unknown>;
    inFilters: Record<string, unknown[]>;
  }> = [];

  const mockDbClient = {
    from(table: string) {
      if (table === 'shops') {
        return {
          select(_fields = '*') {
            return {
              eq(field: string, val: unknown) {
                return {
                  async maybeSingle() {
                    const found = shopsStore.find(
                      (s) => (s as Record<string, unknown>)[field] === val
                    );
                    return { data: found ? { ...found } : null, error: null };
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'shop_memberships') {
        return {
          select(_fields = '*') {
            const filters: Array<[string, unknown]> = [];
            const builder = {
              eq(field: string, val: unknown) {
                filters.push([field, val]);
                return builder;
              },
              order() {
                return builder;
              },
              then(
                onFulfilled: (v: {
                  data: typeof membershipsStore;
                  error: null;
                }) => unknown,
                onRejected?: (e: unknown) => unknown
              ) {
                const matched = membershipsStore.filter((m) =>
                  filters.every(
                    ([k, v]) => (m as Record<string, unknown>)[k] === v
                  )
                );
                return Promise.resolve({
                  data: matched.map((m) => ({ ...m })),
                  error: null,
                }).then(onFulfilled, onRejected);
              },
            };
            return builder;
          },
        };
      }

      if (table === 'categories') {
        return {
          select(_fields = '*') {
            const eqFilters: Record<string, unknown> = {};
            const eqOrder: string[] = [];
            const builder = {
              eq(field: string, val: unknown) {
                eqFilters[field] = val;
                eqOrder.push(field);
                return builder;
              },
              async maybeSingle() {
                categorySelectCalls.push({
                  eqFilters: { ...eqFilters },
                  eqOrder: [...eqOrder],
                });
                const found = categoriesStore.find((c) =>
                  Object.entries(eqFilters).every(
                    ([k, v]) =>
                      (c as unknown as Record<string, unknown>)[k] === v
                  )
                );
                return { data: found ? { ...found } : null, error: null };
              },
            };
            return builder;
          },
        };
      }

      if (table === 'items') {
        return {
          select(_fields = '*') {
            const eqFilters: Record<string, unknown> = {};
            const inFilters: Record<string, unknown[]> = {};
            const filterOrder: string[] = [];
            const builder = {
              eq(field: string, val: unknown) {
                eqFilters[field] = val;
                filterOrder.push(`eq:${field}`);
                return builder;
              },
              async maybeSingle() {
                itemSelectCalls.push({
                  eqFilters: { ...eqFilters },
                  inFilters: { ...inFilters },
                  filterOrder: [...filterOrder],
                });
                const found = itemsStore.find((item) =>
                  Object.entries(eqFilters).every(
                    ([k, v]) =>
                      (item as unknown as Record<string, unknown>)[k] === v
                  )
                );
                return { data: found ? { ...found } : null, error: null };
              },
              async in(field: string, values: unknown[]) {
                inFilters[field] = [...values];
                filterOrder.push(`in:${field}`);
                itemSelectCalls.push({
                  eqFilters: { ...eqFilters },
                  inFilters: { ...inFilters },
                  filterOrder: [...filterOrder],
                });
                const valSet = new Set(values);
                const matched = itemsStore.filter(
                  (item) =>
                    Object.entries(eqFilters).every(
                      ([k, v]) =>
                        (item as unknown as Record<string, unknown>)[k] === v
                    ) &&
                    valSet.has(
                      (item as unknown as Record<string, unknown>)[field]
                    )
                );
                return {
                  data: matched.map((i) => ({ ...i })),
                  error: null,
                };
              },
            };
            return builder;
          },

          update(
            patch: Record<string, unknown>,
            _opts?: { count?: 'exact' | 'planned' | 'estimated' }
          ) {
            const eqFilters: Record<string, unknown> = {};
            const inFilters: Record<string, unknown[]> = {};
            const orFilters: string[] = [];
            const executeUpdate = () => {
              updateCalls.push({
                patch: { ...patch },
                eqFilters: { ...eqFilters },
                inFilters: { ...inFilters },
              });
              if (options?.failUpdateError) {
                return {
                  data: null,
                  error: { message: options.failUpdateError },
                  count: null,
                };
              }
              const updated: CatalogItem[] = [];
              for (let i = 0; i < itemsStore.length; i++) {
                const item = itemsStore[i] as unknown as Record<string, unknown>;
                const eqMatch = Object.entries(eqFilters).every(
                  ([k, v]) => item[k] === v
                );
                const inMatch = Object.entries(inFilters).every(([k, vals]) =>
                  vals.includes(item[k])
                );
                const orMatch = orFilters.every((expr) => {
                  if (expr === 'stock_quantity.is.null,stock_quantity.gt.0') {
                    return (
                      item.stock_quantity === null ||
                      item.stock_quantity === undefined ||
                      (typeof item.stock_quantity === 'number' &&
                        item.stock_quantity > 0)
                    );
                  }
                  return true;
                });
                if (eqMatch && inMatch && orMatch) {
                  itemsStore[i] = { ...itemsStore[i], ...patch };
                  updated.push({ ...itemsStore[i] });
                }
              }
              const finalCount =
                options?.overrideUpdateCount !== undefined
                  ? options.overrideUpdateCount
                  : updated.length;
              return {
                data: updated,
                error: null,
                count: finalCount,
              };
            };

            const builder = {
              eq(field: string, val: unknown) {
                eqFilters[field] = val;
                return builder;
              },
              in(field: string, vals: unknown[]) {
                inFilters[field] = [...vals];
                return builder;
              },
              or(expr: string) {
                orFilters.push(expr);
                return builder;
              },
              then(
                onFulfilled: (v: ReturnType<typeof executeUpdate>) => unknown,
                onRejected?: (e: unknown) => unknown
              ) {
                return Promise.resolve(executeUpdate()).then(
                  onFulfilled,
                  onRejected
                );
              },
            };
            return builder;
          },

          delete(_opts?: { count?: 'exact' | 'planned' | 'estimated' }) {
            const eqFilters: Record<string, unknown> = {};
            const inFilters: Record<string, unknown[]> = {};
            const executeDelete = () => {
              deleteCalls.push({
                eqFilters: { ...eqFilters },
                inFilters: { ...inFilters },
              });
              if (options?.failDeleteError) {
                return {
                  data: null,
                  error: { message: options.failDeleteError },
                  count: null,
                };
              }
              const removed: CatalogItem[] = [];
              for (let i = itemsStore.length - 1; i >= 0; i--) {
                const item = itemsStore[i] as unknown as Record<string, unknown>;
                const eqMatch = Object.entries(eqFilters).every(
                  ([k, v]) => item[k] === v
                );
                const inMatch = Object.entries(inFilters).every(([k, vals]) =>
                  vals.includes(item[k])
                );
                if (eqMatch && inMatch) {
                  removed.push(...itemsStore.splice(i, 1));
                }
              }
              const finalCount =
                options?.overrideDeleteCount !== undefined
                  ? options.overrideDeleteCount
                  : removed.length;
              return {
                data: removed,
                error: null,
                count: finalCount,
              };
            };

            const builder = {
              eq(field: string, val: unknown) {
                eqFilters[field] = val;
                return builder;
              },
              in(field: string, vals: unknown[]) {
                inFilters[field] = [...vals];
                return builder;
              },
              then(
                onFulfilled: (v: ReturnType<typeof executeDelete>) => unknown,
                onRejected?: (e: unknown) => unknown
              ) {
                return Promise.resolve(executeDelete()).then(
                  onFulfilled,
                  onRejected
                );
              },
            };
            return builder;
          },
        };
      }

      return {};
    },
  };

  return {
    mockDbClient,
    itemsStore,
    categoriesStore,
    categorySelectCalls,
    itemSelectCalls,
    updateCalls,
    deleteCalls,
  };
}

test('POST /api/catalog bulk_move_items moves items with a single category-only update and preserves all other fields', async () => {
  const { POST } = await import('@/app/api/catalog/route');
  const { issueSessionToken } = await import('@/lib/server-auth');
  const { setSupabaseDbClientForTests } = await import('@/lib/db');

  const ownerToken = issueSessionToken({
    id: 'owner-demo-001',
    email: 'chuquan@qlaok.vn',
    role: 'owner',
  });

  const {
    mockDbClient,
    itemsStore,
    categorySelectCalls,
    itemSelectCalls,
    updateCalls,
  } = createBulkCatalogMockHarness();
  setSupabaseDbClientForTests(mockDbClient);

  try {
    const beforeItem1 = structuredClone(
      itemsStore.find((i) => i.id === 'item-fnb-001')!
    );
    const beforeItem2 = structuredClone(
      itemsStore.find((i) => i.id === 'item-fnb-002')!
    );

    const res = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_move_items',
          shopId: 'shop-fnb-001',
          itemIds: [' item-fnb-001 ', 'item-fnb-002'],
          categoryId: 'cat-fnb-002',
          // Extra fields in body must never leak into the item update patch
          price: 0,
          is_available: false,
        }),
      })
    );

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.updatedCount, 2);
    assert.equal(data.movedCount, 2);
    assert.equal(data.unchangedCount, 0);
    assert.equal(data.unchanged, false);
    assert.equal(data.categoryId, 'cat-fnb-002');
    assert.deepEqual(data.itemIds, ['item-fnb-001', 'item-fnb-002']);

    // Category lookup filters by both category ID and authorized shop ID
    assert.equal(categorySelectCalls.length, 1);
    assert.deepEqual(categorySelectCalls[0].eqFilters, {
      id: 'cat-fnb-002',
      shop_id: 'shop-fnb-001',
    });

    // Item lookup filters shop_id = authorized shopId before filtering requested IDs
    assert.equal(itemSelectCalls.length, 1);
    assert.deepEqual(itemSelectCalls[0].eqFilters, {
      shop_id: 'shop-fnb-001',
    });
    assert.deepEqual(itemSelectCalls[0].inFilters, {
      id: ['item-fnb-001', 'item-fnb-002'],
    });
    assert.deepEqual(itemSelectCalls[0].filterOrder, ['eq:shop_id', 'in:id']);

    // Exactly one scoped update call that touches ONLY category_id
    assert.equal(updateCalls.length, 1);
    assert.deepEqual(updateCalls[0].patch, { category_id: 'cat-fnb-002' });
    assert.deepEqual(Object.keys(updateCalls[0].patch), ['category_id']);
    assert.equal(updateCalls[0].eqFilters.shop_id, 'shop-fnb-001');
    assert.deepEqual(updateCalls[0].inFilters.id, [
      'item-fnb-001',
      'item-fnb-002',
    ]);

    const afterItem1 = itemsStore.find((i) => i.id === 'item-fnb-001')!;
    const afterItem2 = itemsStore.find((i) => i.id === 'item-fnb-002')!;
    assert.equal(afterItem1.category_id, 'cat-fnb-002');
    assert.equal(afterItem2.category_id, 'cat-fnb-002');

    // Every other field must remain byte-for-byte identical
    assert.deepEqual(
      { ...afterItem1, category_id: beforeItem1.category_id },
      beforeItem1
    );
    assert.deepEqual(
      { ...afterItem2, category_id: beforeItem2.category_id },
      beforeItem2
    );
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('POST /api/catalog bulk_move_items reports unchanged (not updated) when all items already have target category', async () => {
  const { POST } = await import('@/app/api/catalog/route');
  const { issueSessionToken } = await import('@/lib/server-auth');
  const { setSupabaseDbClientForTests } = await import('@/lib/db');

  const ownerToken = issueSessionToken({
    id: 'owner-demo-001',
    email: 'chuquan@qlaok.vn',
    role: 'owner',
  });

  const { mockDbClient, updateCalls } = createBulkCatalogMockHarness();
  setSupabaseDbClientForTests(mockDbClient);

  try {
    // Both item-fnb-001 and item-fnb-002 are already in cat-fnb-001
    const res = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_move_items',
          shopId: 'shop-fnb-001',
          itemIds: ['item-fnb-001', 'item-fnb-002'],
          categoryId: 'cat-fnb-001',
        }),
      })
    );

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.updatedCount, 0);
    assert.equal(data.movedCount, 0);
    assert.equal(data.unchangedCount, 2);
    assert.equal(data.unchanged, true);
    assert.equal(updateCalls.length, 0);
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('POST /api/catalog bulk_move_items and bulk_delete_items reject wrong/missing shop and insufficient permissions', async () => {
  const { POST } = await import('@/app/api/catalog/route');
  const { issueSessionToken } = await import('@/lib/server-auth');
  const { setSupabaseDbClientForTests } = await import('@/lib/db');
  const { setShopMembershipDbClientForTest } = await import(
    '@/lib/shop-permissions'
  );

  const otherShopOwnerToken = issueSessionToken({
    id: 'owner-other-002',
    email: 'other@qlaok.vn',
    role: 'owner',
  });

  const inventoryOnlyStaffToken = issueSessionToken({
    id: 'staff-inventory-only',
    email: 'staff@qlaok.vn',
    role: 'staff',
  });

  const { mockDbClient, updateCalls, deleteCalls } =
    createBulkCatalogMockHarness();
  setSupabaseDbClientForTests(mockDbClient);
  setShopMembershipDbClientForTest(
    mockDbClient as unknown as Parameters<
      typeof setShopMembershipDbClientForTest
    >[0]
  );

  try {
    // 1. Missing shopId
    for (const action of ['bulk_move_items', 'bulk_delete_items'] as const) {
      const resMissingShop = await POST(
        new Request('http://localhost:3000/api/catalog', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${otherShopOwnerToken}`,
          },
          body: JSON.stringify({
            action,
            shopId: '   ',
            itemIds: ['item-fnb-001'],
            categoryId: 'cat-fnb-002',
          }),
        })
      );
      assert.equal(resMissingShop.status, 400);
      const bodyMissingShop = await resMissingShop.json();
      assert.equal(bodyMissingShop.success, false);
    }

    // 2. Non-existent shop
    for (const action of ['bulk_move_items', 'bulk_delete_items'] as const) {
      const resUnknownShop = await POST(
        new Request('http://localhost:3000/api/catalog', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${otherShopOwnerToken}`,
          },
          body: JSON.stringify({
            action,
            shopId: 'shop-does-not-exist',
            itemIds: ['item-fnb-001'],
            categoryId: 'cat-fnb-002',
          }),
        })
      );
      assert.equal(resUnknownShop.status, 404);
    }

    // 3. Wrong shop (owner of shop-other-002 targeting shop-fnb-001)
    for (const action of ['bulk_move_items', 'bulk_delete_items'] as const) {
      const resWrongShop = await POST(
        new Request('http://localhost:3000/api/catalog', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${otherShopOwnerToken}`,
          },
          body: JSON.stringify({
            action,
            shopId: 'shop-fnb-001',
            itemIds: ['item-fnb-001'],
            categoryId: 'cat-fnb-002',
          }),
        })
      );
      assert.equal(resWrongShop.status, 403);
    }

    // 4. Insufficient permission (staff with inventory.adjust but without catalog.manage)
    for (const action of ['bulk_move_items', 'bulk_delete_items'] as const) {
      const resForbidden = await POST(
        new Request('http://localhost:3000/api/catalog', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${inventoryOnlyStaffToken}`,
          },
          body: JSON.stringify({
            action,
            shopId: 'shop-fnb-001',
            itemIds: ['item-fnb-001'],
            categoryId: 'cat-fnb-002',
          }),
        })
      );
      assert.equal(resForbidden.status, 403);
      const dataForbidden = await resForbidden.json();
      assert.equal(dataForbidden.code, 'INSUFFICIENT_SHOP_PERMISSION');
      assert.deepEqual(dataForbidden.requiredPermissions, ['catalog.manage']);
    }

    assert.equal(updateCalls.length, 0);
    assert.equal(deleteCalls.length, 0);
  } finally {
    setShopMembershipDbClientForTest(null);
    setSupabaseDbClientForTests(null);
  }
});

test('POST /api/catalog bulk_move_items and bulk_delete_items reject missing, duplicate, malformed, or >2000 IDs without silent dedupe', async () => {
  const { POST } = await import('@/app/api/catalog/route');
  const { issueSessionToken } = await import('@/lib/server-auth');
  const { setSupabaseDbClientForTests } = await import('@/lib/db');

  const ownerToken = issueSessionToken({
    id: 'owner-demo-001',
    email: 'chuquan@qlaok.vn',
    role: 'owner',
  });

  const { mockDbClient, updateCalls, deleteCalls } =
    createBulkCatalogMockHarness();
  setSupabaseDbClientForTests(mockDbClient);

  try {
    const invalidIdPayloads: Array<{ itemIds: unknown; expectedCode: string }> =
      [
        { itemIds: [], expectedCode: 'INVALID_ITEM_IDS' },
        { itemIds: 'item-fnb-001', expectedCode: 'INVALID_ITEM_IDS' },
        { itemIds: null, expectedCode: 'INVALID_ITEM_IDS' },
        { itemIds: ['item-fnb-001', ''], expectedCode: 'MALFORMED_ITEM_ID' },
        { itemIds: ['item-fnb-001', '   '], expectedCode: 'MALFORMED_ITEM_ID' },
        { itemIds: ['item-fnb-001', null], expectedCode: 'MALFORMED_ITEM_ID' },
        { itemIds: ['item-fnb-001', 123], expectedCode: 'MALFORMED_ITEM_ID' },
        {
          itemIds: ['item-fnb-001', 'item-fnb-001'],
          expectedCode: 'DUPLICATE_ITEM_ID',
        },
        {
          itemIds: ['item-fnb-001', '  item-fnb-001  '],
          expectedCode: 'DUPLICATE_ITEM_ID',
        },
        {
          itemIds: Array.from({ length: 2001 }, (_, i) => `item-${i}`),
          expectedCode: 'TOO_MANY_ITEMS',
        },
      ];

    for (const { itemIds, expectedCode } of invalidIdPayloads) {
      for (const action of ['bulk_move_items', 'bulk_delete_items'] as const) {
        const res = await POST(
          new Request('http://localhost:3000/api/catalog', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${ownerToken}`,
            },
            body: JSON.stringify({
              action,
              shopId: 'shop-fnb-001',
              itemIds,
              categoryId: 'cat-fnb-002',
            }),
          })
        );
        assert.equal(res.status, 400);
        const data = await res.json();
        assert.equal(data.success, false);
        assert.equal(data.code, expectedCode);
      }
    }

    // Missing or malformed categoryId for bulk_move_items
    for (const badCat of ['', '   ', null, 999]) {
      const resBadCat = await POST(
        new Request('http://localhost:3000/api/catalog', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ownerToken}`,
          },
          body: JSON.stringify({
            action: 'bulk_move_items',
            shopId: 'shop-fnb-001',
            itemIds: ['item-fnb-001'],
            categoryId: badCat,
          }),
        })
      );
      assert.equal(resBadCat.status, 400);
      const dataBadCat = await resBadCat.json();
      assert.equal(dataBadCat.success, false);
      assert.equal(dataBadCat.code, 'INVALID_CATEGORY_ID');
    }

    assert.equal(updateCalls.length, 0);
    assert.equal(deleteCalls.length, 0);
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('POST /api/catalog bulk_move_items and bulk_delete_items reject missing or cross-shop items/categories before write without exposing foreign shop IDs', async () => {
  const { POST } = await import('@/app/api/catalog/route');
  const { issueSessionToken } = await import('@/lib/server-auth');
  const { setSupabaseDbClientForTests } = await import('@/lib/db');

  const ownerToken = issueSessionToken({
    id: 'owner-demo-001',
    email: 'chuquan@qlaok.vn',
    role: 'owner',
  });

  const {
    mockDbClient,
    itemsStore,
    categorySelectCalls,
    itemSelectCalls,
    updateCalls,
    deleteCalls,
  } = createBulkCatalogMockHarness();
  setSupabaseDbClientForTests(mockDbClient);

  try {
    // 1. Item from another shop in bulk_move_items -> rejects entire batch before write
    const resMoveCrossItem = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_move_items',
          shopId: 'shop-fnb-001',
          itemIds: ['item-fnb-001', 'item-foreign-999'],
          categoryId: 'cat-fnb-002',
        }),
      })
    );
    assert.equal(resMoveCrossItem.status, 400);
    const dataMoveCrossItem = await resMoveCrossItem.json();
    assert.equal(dataMoveCrossItem.success, false);
    assert.equal(dataMoveCrossItem.code, 'ITEM_NOT_IN_SHOP');
    assert.equal(
      JSON.stringify(dataMoveCrossItem).includes('shop-secret-foreign-id'),
      false,
      'Must never expose foreign shop_id'
    );
    assert.deepEqual(itemSelectCalls[0].eqFilters, { shop_id: 'shop-fnb-001' });
    assert.deepEqual(itemSelectCalls[0].filterOrder, ['eq:shop_id', 'in:id']);

    // 2. Missing item in bulk_move_items -> rejects entire batch before write
    const resMoveMissingItem = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_move_items',
          shopId: 'shop-fnb-001',
          itemIds: ['item-fnb-001', 'item-nonexistent-404'],
          categoryId: 'cat-fnb-002',
        }),
      })
    );
    assert.equal(resMoveMissingItem.status, 400);
    const dataMoveMissingItem = await resMoveMissingItem.json();
    assert.equal(dataMoveMissingItem.success, false);
    assert.equal(dataMoveMissingItem.code, 'ITEM_NOT_IN_SHOP');

    // 3. Foreign-shop category in bulk_move_items -> rejects before write without exposing foreign shop_id
    const resMoveForeignCat = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_move_items',
          shopId: 'shop-fnb-001',
          itemIds: ['item-fnb-001'],
          categoryId: 'cat-foreign-999',
        }),
      })
    );
    assert.equal(resMoveForeignCat.status, 400);
    const dataMoveForeignCat = await resMoveForeignCat.json();
    assert.equal(dataMoveForeignCat.success, false);
    assert.equal(dataMoveForeignCat.code, 'CATEGORY_NOT_IN_SHOP');
    assert.equal(
      JSON.stringify(dataMoveForeignCat).includes('shop-secret-foreign-id'),
      false,
      'Must never expose foreign shop_id'
    );
    assert.deepEqual(categorySelectCalls[2].eqFilters, {
      id: 'cat-foreign-999',
      shop_id: 'shop-fnb-001',
    });

    // 4. Item from another shop in bulk_delete_items -> rejects entire batch before write
    const resDeleteCrossItem = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_delete_items',
          shopId: 'shop-fnb-001',
          itemIds: ['item-fnb-001', 'item-foreign-999'],
        }),
      })
    );
    assert.equal(resDeleteCrossItem.status, 400);
    const dataDeleteCrossItem = await resDeleteCrossItem.json();
    assert.equal(dataDeleteCrossItem.success, false);
    assert.equal(dataDeleteCrossItem.code, 'ITEM_NOT_IN_SHOP');
    assert.equal(
      JSON.stringify(dataDeleteCrossItem).includes('shop-secret-foreign-id'),
      false,
      'Must never expose foreign shop_id'
    );
    assert.deepEqual(itemSelectCalls[2].eqFilters, { shop_id: 'shop-fnb-001' });
    assert.deepEqual(itemSelectCalls[2].filterOrder, ['eq:shop_id', 'in:id']);

    // Verify zero writes occurred and item-fnb-001 is still in cat-fnb-001 and present
    assert.equal(updateCalls.length, 0);
    assert.equal(deleteCalls.length, 0);
    assert.equal(
      itemsStore.find((i) => i.id === 'item-fnb-001')?.category_id,
      'cat-fnb-001'
    );
    assert.equal(itemsStore.length, 4);
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('POST /api/catalog bulk_delete_items performs one atomic shop-scoped delete and preserves legacy single-item DELETE', async () => {
  const { POST, DELETE } = await import('@/app/api/catalog/route');
  const { issueSessionToken } = await import('@/lib/server-auth');
  const { setSupabaseDbClientForTests } = await import('@/lib/db');

  const ownerToken = issueSessionToken({
    id: 'owner-demo-001',
    email: 'chuquan@qlaok.vn',
    role: 'owner',
  });

  const { mockDbClient, itemsStore, itemSelectCalls, deleteCalls } =
    createBulkCatalogMockHarness();
  setSupabaseDbClientForTests(mockDbClient);

  try {
    const res = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_delete_items',
          shopId: 'shop-fnb-001',
          itemIds: [' item-fnb-001 ', 'item-fnb-002'],
        }),
      })
    );

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.deletedCount, 2);
    assert.equal(data.count, 2);
    assert.deepEqual(data.itemIds, ['item-fnb-001', 'item-fnb-002']);

    assert.equal(itemSelectCalls.length, 1);
    assert.deepEqual(itemSelectCalls[0].eqFilters, {
      shop_id: 'shop-fnb-001',
    });
    assert.deepEqual(itemSelectCalls[0].inFilters, {
      id: ['item-fnb-001', 'item-fnb-002'],
    });
    assert.deepEqual(itemSelectCalls[0].filterOrder, ['eq:shop_id', 'in:id']);

    // One atomic shop-scoped delete call
    assert.equal(deleteCalls.length, 1);
    assert.equal(deleteCalls[0].eqFilters.shop_id, 'shop-fnb-001');
    assert.deepEqual(deleteCalls[0].inFilters.id, [
      'item-fnb-001',
      'item-fnb-002',
    ]);

    assert.deepEqual(
      itemsStore.map((i) => i.id),
      ['item-fnb-003', 'item-foreign-999']
    );

    // Legacy single-item DELETE remains intact
    const resLegacyDelete = await DELETE(
      new Request(
        'http://localhost:3000/api/catalog?itemId=item-fnb-003',
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${ownerToken}`,
          },
        }
      )
    );
    assert.equal(resLegacyDelete.status, 200);
    const dataLegacy = await resLegacyDelete.json();
    assert.equal(dataLegacy.deleted, true);
    assert.deepEqual(
      itemsStore.map((i) => i.id),
      ['item-foreign-999']
    );
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('POST /api/catalog bulk_move_items and bulk_delete_items return non-success on DB errors or affected count mismatch', async () => {
  const { POST } = await import('@/app/api/catalog/route');
  const { issueSessionToken } = await import('@/lib/server-auth');
  const { setSupabaseDbClientForTests } = await import('@/lib/db');

  const ownerToken = issueSessionToken({
    id: 'owner-demo-001',
    email: 'chuquan@qlaok.vn',
    role: 'owner',
  });

  // 1. DB update error during bulk_move_items
  const moveErrHarness = createBulkCatalogMockHarness({
    failUpdateError: 'Simulated DB update failure',
  });
  setSupabaseDbClientForTests(moveErrHarness.mockDbClient);
  try {
    const res = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_move_items',
          shopId: 'shop-fnb-001',
          itemIds: ['item-fnb-001', 'item-fnb-002'],
          categoryId: 'cat-fnb-002',
        }),
      })
    );
    assert.equal(res.status, 500);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.code, 'DB_UPDATE_FAILED');
  } finally {
    setSupabaseDbClientForTests(null);
  }

  // 2. Affected count mismatch during bulk_move_items
  const moveMismatchHarness = createBulkCatalogMockHarness({
    overrideUpdateCount: 1,
  });
  setSupabaseDbClientForTests(moveMismatchHarness.mockDbClient);
  try {
    const res = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_move_items',
          shopId: 'shop-fnb-001',
          itemIds: ['item-fnb-001', 'item-fnb-002'],
          categoryId: 'cat-fnb-002',
        }),
      })
    );
    assert.equal(res.status, 409);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.code, 'BULK_MOVE_COUNT_MISMATCH');
  } finally {
    setSupabaseDbClientForTests(null);
  }

  // 3. DB/FK delete error during bulk_delete_items
  const deleteErrHarness = createBulkCatalogMockHarness({
    failDeleteError: 'Simulated DB foreign key constraint error',
  });
  setSupabaseDbClientForTests(deleteErrHarness.mockDbClient);
  try {
    const res = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_delete_items',
          shopId: 'shop-fnb-001',
          itemIds: ['item-fnb-001', 'item-fnb-002'],
        }),
      })
    );
    assert.equal(res.status, 500);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.deletedCount, 0);
    assert.equal(data.code, 'DB_DELETE_FAILED');
  } finally {
    setSupabaseDbClientForTests(null);
  }

  // 4. Affected count mismatch during bulk_delete_items
  const deleteMismatchHarness = createBulkCatalogMockHarness({
    overrideDeleteCount: 1,
  });
  setSupabaseDbClientForTests(deleteMismatchHarness.mockDbClient);
  try {
    const res = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_delete_items',
          shopId: 'shop-fnb-001',
          itemIds: ['item-fnb-001', 'item-fnb-002'],
        }),
      })
    );
    assert.equal(res.status, 409);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.deletedCount, 0);
    assert.equal(data.code, 'BULK_DELETE_COUNT_MISMATCH');
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('POST /api/catalog bulk_update_availability updates only is_available with a single shop-scoped write and leaves stock_quantity untouched', async () => {
  const { POST } = await import('@/app/api/catalog/route');
  const { issueSessionToken } = await import('@/lib/server-auth');
  const { setSupabaseDbClientForTests } = await import('@/lib/db');
  const { setShopMembershipDbClientForTest } = await import(
    '@/lib/shop-permissions'
  );

  const ownerToken = issueSessionToken({
    id: 'owner-demo-001',
    email: 'chuquan@qlaok.vn',
    role: 'owner',
  });

  const inventoryOnlyStaffToken = issueSessionToken({
    id: 'staff-inventory-only',
    email: 'staff@qlaok.vn',
    role: 'staff',
  });

  const cashierManagerToken = issueSessionToken({
    id: 'cashier-catalog-manager',
    email: 'cashier@qlaok.vn',
    role: 'cashier',
  });

  const {
    mockDbClient,
    itemsStore,
    itemSelectCalls,
    updateCalls,
  } = createBulkCatalogMockHarness();
  setSupabaseDbClientForTests(mockDbClient);
  setShopMembershipDbClientForTest(
    mockDbClient as unknown as Parameters<
      typeof setShopMembershipDbClientForTest
    >[0]
  );

  try {
    const beforeItem1 = structuredClone(
      itemsStore.find((i) => i.id === 'item-fnb-001')!
    );
    const beforeItem2 = structuredClone(
      itemsStore.find((i) => i.id === 'item-fnb-002')!
    );

    // 1. Owner marks items as temporarily sold out (is_available = false)
    const resSoldOut = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_update_availability',
          shopId: 'shop-fnb-001',
          itemIds: [' item-fnb-001 ', 'item-fnb-002'],
          is_available: false,
          // Extra injected fields in payload must never leak into update patch
          stock_quantity: 0,
          price: 1000,
          category_id: 'cat-fnb-002',
        }),
      })
    );

    assert.equal(resSoldOut.status, 200);
    const dataSoldOut = await resSoldOut.json();
    assert.equal(dataSoldOut.success, true);
    assert.equal(dataSoldOut.updatedCount, 2);
    assert.equal(dataSoldOut.count, 2);
    assert.equal(dataSoldOut.is_available, false);
    assert.equal(dataSoldOut.isAvailable, false);
    assert.deepEqual(dataSoldOut.itemIds, ['item-fnb-001', 'item-fnb-002']);

    // Verify shop-scoped verification happened first
    assert.equal(itemSelectCalls.length, 1);
    assert.deepEqual(itemSelectCalls[0].eqFilters, {
      shop_id: 'shop-fnb-001',
    });
    assert.deepEqual(itemSelectCalls[0].inFilters, {
      id: ['item-fnb-001', 'item-fnb-002'],
    });
    assert.deepEqual(itemSelectCalls[0].filterOrder, ['eq:shop_id', 'in:id']);

    // Verify update touched ONLY is_available
    assert.equal(updateCalls.length, 1);
    assert.deepEqual(updateCalls[0].patch, { is_available: false });
    assert.deepEqual(Object.keys(updateCalls[0].patch), ['is_available']);
    assert.equal(updateCalls[0].eqFilters.shop_id, 'shop-fnb-001');
    assert.deepEqual(updateCalls[0].inFilters.id, [
      'item-fnb-001',
      'item-fnb-002',
    ]);

    const afterItem1 = itemsStore.find((i) => i.id === 'item-fnb-001')!;
    const afterItem2 = itemsStore.find((i) => i.id === 'item-fnb-002')!;
    assert.equal(afterItem1.is_available, false);
    assert.equal(afterItem2.is_available, false);
    assert.equal(afterItem1.stock_quantity, 15, 'Stock quantity must remain 15');
    assert.equal(
      afterItem2.stock_quantity,
      null,
      'Unlimited stock must remain null'
    );
    assert.deepEqual(
      { ...afterItem1, is_available: beforeItem1.is_available },
      beforeItem1
    );
    assert.deepEqual(
      { ...afterItem2, is_available: beforeItem2.is_available },
      beforeItem2
    );

    // 2. Staff with inventory.adjust (without catalog.manage) marks positive-stock and unlimited-stock items available
    const resStaffAvailable = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${inventoryOnlyStaffToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_update_availability',
          shopId: 'shop-fnb-001',
          itemIds: ['item-fnb-001', 'item-fnb-002'],
          isAvailable: true,
        }),
      })
    );

    assert.equal(resStaffAvailable.status, 200);
    const dataStaffAvailable = await resStaffAvailable.json();
    assert.equal(dataStaffAvailable.success, true);
    assert.equal(dataStaffAvailable.updatedCount, 2);
    assert.equal(dataStaffAvailable.is_available, true);
    assert.equal(dataStaffAvailable.isAvailable, true);
    assert.equal(updateCalls.length, 2);
    assert.deepEqual(updateCalls[1].patch, { is_available: true });
    assert.deepEqual(Object.keys(updateCalls[1].patch), ['is_available']);

    const restoredItem1 = itemsStore.find((i) => i.id === 'item-fnb-001')!;
    const restoredItem2 = itemsStore.find((i) => i.id === 'item-fnb-002')!;
    assert.equal(restoredItem1.is_available, true);
    assert.equal(
      restoredItem1.stock_quantity,
      15,
      'Positive stock_quantity must remain untouched by availability toggle'
    );
    assert.equal(restoredItem2.is_available, true);
    assert.equal(
      restoredItem2.stock_quantity,
      null,
      'Unlimited stock_quantity must remain untouched by availability toggle'
    );

    // 3. Cashier with catalog.manage (without inventory.adjust) can also update availability
    const resCashier = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierManagerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_update_availability',
          shopId: 'shop-fnb-001',
          itemIds: ['item-fnb-002'],
          is_available: true,
        }),
      })
    );
    assert.equal(resCashier.status, 200);
    const dataCashier = await resCashier.json();
    assert.equal(dataCashier.success, true);
    assert.equal(dataCashier.updatedCount, 1);
  } finally {
    setShopMembershipDbClientForTest(null);
    setSupabaseDbClientForTests(null);
  }
});

test('POST /api/catalog bulk_update_availability and bulk_set_availability reject zero-stock items when marking available before any write, while preserving sold-out and positive/unlimited stock behavior', async () => {
  const { POST } = await import('@/app/api/catalog/route');
  const { issueSessionToken } = await import('@/lib/server-auth');
  const { setSupabaseDbClientForTests } = await import('@/lib/db');
  const { setShopMembershipDbClientForTest } = await import(
    '@/lib/shop-permissions'
  );

  const ownerToken = issueSessionToken({
    id: 'owner-demo-001',
    email: 'chuquan@qlaok.vn',
    role: 'owner',
  });

  const { mockDbClient, itemsStore, updateCalls } =
    createBulkCatalogMockHarness();
  setSupabaseDbClientForTests(mockDbClient);
  setShopMembershipDbClientForTest(
    mockDbClient as unknown as Parameters<
      typeof setShopMembershipDbClientForTest
    >[0]
  );

  try {
    // Prepare initial state: item-fnb-001 (stock 15) and item-fnb-002 (stock null) are sold out;
    // item-fnb-003 has stock_quantity = 0 and is_available = false.
    const item1 = itemsStore.find((i) => i.id === 'item-fnb-001')!;
    const item2 = itemsStore.find((i) => i.id === 'item-fnb-002')!;
    const item3 = itemsStore.find((i) => i.id === 'item-fnb-003')!;
    item1.is_available = false;
    item2.is_available = false;
    item3.is_available = false;
    item3.stock_quantity = 0;

    const snapshotBeforeReject = structuredClone(itemsStore);

    // (1a) Single zero-stock item rejected before any write (bulk_update_availability)
    const resZeroSingle = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_update_availability',
          shopId: 'shop-fnb-001',
          itemIds: ['item-fnb-003'],
          is_available: true,
        }),
      })
    );
    assert.equal(resZeroSingle.status, 409);
    const dataZeroSingle = await resZeroSingle.json();
    assert.equal(dataZeroSingle.success, false);
    assert.equal(dataZeroSingle.code, 'ZERO_STOCK_CANNOT_MARK_AVAILABLE');
    assert.equal(dataZeroSingle.updatedCount, 0);
    assert.equal(dataZeroSingle.count, 0);
    assert.deepEqual(dataZeroSingle.zeroStockItemIds, ['item-fnb-003']);
    assert.equal(typeof dataZeroSingle.error, 'string');
    assert.ok(
      dataZeroSingle.error.includes('tồn kho') &&
        dataZeroSingle.error.includes('không giới hạn'),
      'Error message must instruct user in Vietnamese to add stock or switch to unlimited stock'
    );
    assert.equal(
      updateCalls.length,
      0,
      'Must not issue any DB update when rejecting zero-stock item'
    );
    assert.deepEqual(itemsStore, snapshotBeforeReject);

    // (1b) Mixed batch containing positive-stock, unlimited-stock, and zero-stock item rejected before any write (bulk_set_availability alias)
    const resZeroMixed = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_set_availability',
          shopId: 'shop-fnb-001',
          itemIds: ['item-fnb-001', 'item-fnb-002', 'item-fnb-003'],
          isAvailable: true,
          stock_quantity: 99,
          price: 12345,
        }),
      })
    );
    assert.equal(resZeroMixed.status, 409);
    const dataZeroMixed = await resZeroMixed.json();
    assert.equal(dataZeroMixed.success, false);
    assert.equal(dataZeroMixed.code, 'ZERO_STOCK_CANNOT_MARK_AVAILABLE');
    assert.equal(dataZeroMixed.updatedCount, 0);
    assert.equal(dataZeroMixed.count, 0);
    assert.deepEqual(dataZeroMixed.zeroStockItemIds, ['item-fnb-003']);
    assert.equal(
      updateCalls.length,
      0,
      'Entire batch must be rejected before issuing any update'
    );
    assert.deepEqual(
      itemsStore,
      snapshotBeforeReject,
      'All rows in mixed batch must remain completely unchanged'
    );

    // (2) Positive-stock (15) and unlimited-stock (null) items can still be marked available
    const resValidAvailable = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_set_availability',
          shopId: 'shop-fnb-001',
          itemIds: ['item-fnb-001', 'item-fnb-002'],
          isAvailable: true,
          stock_quantity: 999,
          price: 88888,
          category_id: 'cat-fnb-002',
        }),
      })
    );
    assert.equal(resValidAvailable.status, 200);
    const dataValidAvailable = await resValidAvailable.json();
    assert.equal(dataValidAvailable.success, true);
    assert.equal(dataValidAvailable.updatedCount, 2);
    assert.equal(dataValidAvailable.count, 2);
    assert.equal(dataValidAvailable.is_available, true);
    assert.equal(dataValidAvailable.isAvailable, true);
    assert.deepEqual(dataValidAvailable.itemIds, [
      'item-fnb-001',
      'item-fnb-002',
    ]);
    assert.equal(updateCalls.length, 1);
    assert.deepEqual(updateCalls[0].patch, { is_available: true });
    assert.deepEqual(Object.keys(updateCalls[0].patch), ['is_available']);
    assert.equal(
      itemsStore.find((i) => i.id === 'item-fnb-001')?.is_available,
      true
    );
    assert.equal(
      itemsStore.find((i) => i.id === 'item-fnb-001')?.stock_quantity,
      15
    );
    assert.equal(
      itemsStore.find((i) => i.id === 'item-fnb-002')?.is_available,
      true
    );
    assert.equal(
      itemsStore.find((i) => i.id === 'item-fnb-002')?.stock_quantity,
      null
    );
    assert.equal(
      itemsStore.find((i) => i.id === 'item-fnb-003')?.is_available,
      false
    );

    // (3) Zero-stock items (alone and in a mixed batch) can still be marked temporarily sold out (is_available = false)
    // and (4) the update patch remains only { is_available }
    const resZeroSoldOut = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_update_availability',
          shopId: 'shop-fnb-001',
          itemIds: ['item-fnb-001', 'item-fnb-003'],
          is_available: false,
          stock_quantity: 50,
          price: 10000,
          category_id: 'cat-fnb-001',
        }),
      })
    );
    assert.equal(resZeroSoldOut.status, 200);
    const dataZeroSoldOut = await resZeroSoldOut.json();
    assert.equal(dataZeroSoldOut.success, true);
    assert.equal(dataZeroSoldOut.updatedCount, 2);
    assert.equal(dataZeroSoldOut.count, 2);
    assert.equal(dataZeroSoldOut.is_available, false);
    assert.equal(dataZeroSoldOut.isAvailable, false);
    assert.deepEqual(dataZeroSoldOut.itemIds, [
      'item-fnb-001',
      'item-fnb-003',
    ]);
    assert.equal(updateCalls.length, 2);
    assert.deepEqual(updateCalls[1].patch, { is_available: false });
    assert.deepEqual(Object.keys(updateCalls[1].patch), ['is_available']);
    assert.equal(
      itemsStore.find((i) => i.id === 'item-fnb-001')?.is_available,
      false
    );
    assert.equal(
      itemsStore.find((i) => i.id === 'item-fnb-001')?.stock_quantity,
      15
    );
    assert.equal(
      itemsStore.find((i) => i.id === 'item-fnb-003')?.is_available,
      false
    );
    assert.equal(
      itemsStore.find((i) => i.id === 'item-fnb-003')?.stock_quantity,
      0
    );
    assert.equal(
      itemsStore.find((i) => i.id === 'item-fnb-003')?.price,
      29000
    );
    assert.equal(
      itemsStore.find((i) => i.id === 'item-fnb-003')?.category_id,
      'cat-fnb-002'
    );
  } finally {
    setShopMembershipDbClientForTest(null);
    setSupabaseDbClientForTests(null);
  }
});

test('POST /api/catalog bulk_update_availability enforces auth, active shop membership, and catalog.manage | inventory.adjust permissions', async () => {
  const { POST } = await import('@/app/api/catalog/route');
  const { issueSessionToken } = await import('@/lib/server-auth');
  const { setSupabaseDbClientForTests } = await import('@/lib/db');
  const { setShopMembershipDbClientForTest } = await import(
    '@/lib/shop-permissions'
  );

  const otherShopOwnerToken = issueSessionToken({
    id: 'owner-other-002',
    email: 'other@qlaok.vn',
    role: 'owner',
  });

  const viewOnlyStaffToken = issueSessionToken({
    id: 'staff-view-only',
    email: 'viewonly@qlaok.vn',
    role: 'staff',
  });

  const inactiveStaffToken = issueSessionToken({
    id: 'staff-inactive',
    email: 'inactive@qlaok.vn',
    role: 'staff',
  });

  const { mockDbClient, updateCalls } = createBulkCatalogMockHarness();
  setSupabaseDbClientForTests(mockDbClient);
  setShopMembershipDbClientForTest(
    mockDbClient as unknown as Parameters<
      typeof setShopMembershipDbClientForTest
    >[0]
  );

  try {
    // 1. Unauthenticated request -> 401
    const resUnauth = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'bulk_update_availability',
          shopId: 'shop-fnb-001',
          itemIds: ['item-fnb-001'],
          is_available: false,
        }),
      })
    );
    assert.equal(resUnauth.status, 401);

    // 2. Missing shopId -> 400
    const resMissingShop = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${otherShopOwnerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_update_availability',
          shopId: '   ',
          itemIds: ['item-fnb-001'],
          is_available: false,
        }),
      })
    );
    assert.equal(resMissingShop.status, 400);
    const dataMissingShop = await resMissingShop.json();
    assert.equal(dataMissingShop.code, 'INVALID_SHOP_ID');

    // 3. Unknown shop -> 404
    const resUnknownShop = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${otherShopOwnerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_update_availability',
          shopId: 'shop-nonexistent-404',
          itemIds: ['item-fnb-001'],
          is_available: false,
        }),
      })
    );
    assert.equal(resUnknownShop.status, 404);

    // 4. Wrong shop (owner of another shop) -> 403
    const resWrongShop = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${otherShopOwnerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_update_availability',
          shopId: 'shop-fnb-001',
          itemIds: ['item-fnb-001'],
          is_available: false,
        }),
      })
    );
    assert.equal(resWrongShop.status, 403);

    // 5. Inactive membership -> 403
    const resInactive = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${inactiveStaffToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_update_availability',
          shopId: 'shop-fnb-001',
          itemIds: ['item-fnb-001'],
          is_available: false,
        }),
      })
    );
    assert.equal(resInactive.status, 403);

    // 6. Active member without catalog.manage or inventory.adjust -> 403 INSUFFICIENT_SHOP_PERMISSION
    const resViewOnly = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${viewOnlyStaffToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_update_availability',
          shopId: 'shop-fnb-001',
          itemIds: ['item-fnb-001'],
          is_available: false,
        }),
      })
    );
    assert.equal(resViewOnly.status, 403);
    const dataViewOnly = await resViewOnly.json();
    assert.equal(dataViewOnly.code, 'INSUFFICIENT_SHOP_PERMISSION');
    assert.deepEqual(dataViewOnly.requiredPermissions, [
      'catalog.manage',
      'inventory.adjust',
    ]);

    assert.equal(updateCalls.length, 0);
  } finally {
    setShopMembershipDbClientForTest(null);
    setSupabaseDbClientForTests(null);
  }
});

test('POST /api/catalog bulk_update_availability rejects non-boolean availability, malformed/duplicate/>2000 itemIds, cross-shop IDs, and DB failures', async () => {
  const { POST } = await import('@/app/api/catalog/route');
  const { issueSessionToken } = await import('@/lib/server-auth');
  const { setSupabaseDbClientForTests } = await import('@/lib/db');

  const ownerToken = issueSessionToken({
    id: 'owner-demo-001',
    email: 'chuquan@qlaok.vn',
    role: 'owner',
  });

  const { mockDbClient, itemsStore, updateCalls } =
    createBulkCatalogMockHarness();
  setSupabaseDbClientForTests(mockDbClient);

  try {
    // 1. Invalid boolean payloads
    const badAvailabilityPayloads: Array<Record<string, unknown>> = [
      {},
      { is_available: null },
      { is_available: 'true' },
      { is_available: 1 },
      { isAvailable: 0 },
      { isAvailable: 'false' },
      { is_available: true, isAvailable: false },
    ];

    for (const extra of badAvailabilityPayloads) {
      const resBadBool = await POST(
        new Request('http://localhost:3000/api/catalog', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ownerToken}`,
          },
          body: JSON.stringify({
            action: 'bulk_update_availability',
            shopId: 'shop-fnb-001',
            itemIds: ['item-fnb-001'],
            ...extra,
          }),
        })
      );
      assert.equal(resBadBool.status, 400);
      const dataBadBool = await resBadBool.json();
      assert.equal(dataBadBool.success, false);
      assert.equal(dataBadBool.code, 'INVALID_AVAILABILITY');
    }

    // 2. Invalid itemIds (empty, non-array, malformed, duplicate, >2000)
    const invalidIdCases: Array<{ itemIds: unknown; expectedCode: string }> = [
      { itemIds: [], expectedCode: 'INVALID_ITEM_IDS' },
      { itemIds: null, expectedCode: 'INVALID_ITEM_IDS' },
      { itemIds: ['item-fnb-001', '   '], expectedCode: 'MALFORMED_ITEM_ID' },
      { itemIds: ['item-fnb-001', 42], expectedCode: 'MALFORMED_ITEM_ID' },
      {
        itemIds: ['item-fnb-001', 'item-fnb-001'],
        expectedCode: 'DUPLICATE_ITEM_ID',
      },
      {
        itemIds: ['item-fnb-001', ' item-fnb-001 '],
        expectedCode: 'DUPLICATE_ITEM_ID',
      },
      {
        itemIds: Array.from({ length: 2001 }, (_, i) => `item-${i}`),
        expectedCode: 'TOO_MANY_ITEMS',
      },
    ];

    for (const { itemIds, expectedCode } of invalidIdCases) {
      const resBadIds = await POST(
        new Request('http://localhost:3000/api/catalog', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ownerToken}`,
          },
          body: JSON.stringify({
            action: 'bulk_update_availability',
            shopId: 'shop-fnb-001',
            itemIds,
            is_available: false,
          }),
        })
      );
      assert.equal(resBadIds.status, 400);
      const dataBadIds = await resBadIds.json();
      assert.equal(dataBadIds.success, false);
      assert.equal(dataBadIds.code, expectedCode);
    }

    // 3. Cross-shop or non-existent item IDs rejected before any write
    for (const badBatch of [
      ['item-fnb-001', 'item-foreign-999'],
      ['item-fnb-001', 'item-missing-404'],
    ]) {
      const resCross = await POST(
        new Request('http://localhost:3000/api/catalog', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ownerToken}`,
          },
          body: JSON.stringify({
            action: 'bulk_update_availability',
            shopId: 'shop-fnb-001',
            itemIds: badBatch,
            is_available: false,
          }),
        })
      );
      assert.equal(resCross.status, 400);
      const dataCross = await resCross.json();
      assert.equal(dataCross.success, false);
      assert.equal(dataCross.code, 'ITEM_NOT_IN_SHOP');
      assert.equal(
        JSON.stringify(dataCross).includes('shop-secret-foreign-id'),
        false,
        'Must never leak foreign shop_id'
      );
    }

    assert.equal(updateCalls.length, 0);
    assert.equal(
      itemsStore.find((i) => i.id === 'item-fnb-001')?.is_available,
      true
    );
  } finally {
    setSupabaseDbClientForTests(null);
  }

  // 4. DB update error -> 500 DB_UPDATE_FAILED
  const errHarness = createBulkCatalogMockHarness({
    failUpdateError: 'Simulated DB availability error',
  });
  setSupabaseDbClientForTests(errHarness.mockDbClient);
  try {
    const resDbErr = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_update_availability',
          shopId: 'shop-fnb-001',
          itemIds: ['item-fnb-001', 'item-fnb-002'],
          is_available: false,
        }),
      })
    );
    assert.equal(resDbErr.status, 500);
    const dataDbErr = await resDbErr.json();
    assert.equal(dataDbErr.success, false);
    assert.equal(dataDbErr.updatedCount, 0);
    assert.equal(dataDbErr.code, 'DB_UPDATE_FAILED');
  } finally {
    setSupabaseDbClientForTests(null);
  }

  // 5. Affected count mismatch -> 409 BULK_AVAILABILITY_COUNT_MISMATCH
  const mismatchHarness = createBulkCatalogMockHarness({
    overrideUpdateCount: 1,
  });
  setSupabaseDbClientForTests(mismatchHarness.mockDbClient);
  try {
    const resMismatch = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_update_availability',
          shopId: 'shop-fnb-001',
          itemIds: ['item-fnb-001', 'item-fnb-002'],
          is_available: false,
        }),
      })
    );
    assert.equal(resMismatch.status, 409);
    const dataMismatch = await resMismatch.json();
    assert.equal(dataMismatch.success, false);
    assert.equal(dataMismatch.updatedCount, 0);
    assert.equal(dataMismatch.code, 'BULK_AVAILABILITY_COUNT_MISMATCH');
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('POST /api/catalog upsert_item and dbUpsertItem enforce [0, 1_000_000_000] integer VND price boundary before any DB writes', async () => {
  const { POST } = await import('@/app/api/catalog/route');
  const { issueSessionToken } = await import('@/lib/server-auth');
  const { dbUpsertItem, setSupabaseDbClientForTests } = await import('@/lib/db');
  const { setShopMembershipDbClientForTest } = await import(
    '@/lib/shop-permissions'
  );

  const ownerToken = issueSessionToken({
    id: 'owner-demo-001',
    email: 'chuquan@qlaok.vn',
    role: 'owner',
  });
  const staffToken = issueSessionToken({
    id: 'staff-inv-001',
    email: 'staff-inv@qlaok.vn',
    role: 'staff',
  });

  const itemsStore: CatalogItem[] = [
    {
      id: 'item-fnb-001',
      shop_id: 'shop-fnb-001',
      category_id: 'cat-fnb-001',
      name_i18n: { vi: 'Phở bò tái nạm', en: 'Beef Pho' },
      desc_i18n: { vi: '', en: '' },
      price: 55000,
      stock_quantity: 10,
      is_available: true,
      is_featured: false,
      options_json: [],
      view_count: 10,
      sold_count: 5,
      sort_order: 1,
    },
  ];
  let itemUpdateCalls = 0;
  let itemInsertCalls = 0;

  const mockDbClient = {
    from(table: string) {
      if (table === 'shops') {
        return {
          select(_cols = '*') {
            return {
              limit: async () => ({
                data: [{ id: 'shop-fnb-001' }],
                error: null,
              }),
              eq(_field: string, val: unknown) {
                return {
                  async maybeSingle() {
                    if (val === 'shop-fnb-001') {
                      return {
                        data: { id: 'shop-fnb-001', owner_id: 'owner-demo-001' },
                        error: null,
                      };
                    }
                    return { data: null, error: null };
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'profiles') {
        return {
          select(_cols = '*') {
            return {
              eq(_field: string, val: unknown) {
                return {
                  async maybeSingle() {
                    if (val === 'owner-demo-001') {
                      return {
                        data: { id: 'owner-demo-001', plan: 'premium' },
                        error: null,
                      };
                    }
                    return { data: null, error: null };
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'shop_memberships') {
        return {
          select(_cols = '*') {
            const filters: Array<[string, unknown]> = [];
            const staffRow = {
              id: 'mem-staff-inv-001',
              shop_id: 'shop-fnb-001',
              user_id: 'staff-inv-001',
              role: 'staff',
              permissions: ['catalog.view', 'inventory.adjust'],
              is_active: true,
            };
            const resolveRows = () =>
              filters.every(
                ([k, v]) =>
                  (staffRow as unknown as Record<string, unknown>)[k] === v
              )
                ? [{ ...staffRow }]
                : [];
            const builder = {
              eq(field: string, val: unknown) {
                filters.push([field, val]);
                return builder;
              },
              order() {
                return builder;
              },
              async maybeSingle() {
                const rows = resolveRows();
                return { data: rows[0] || null, error: null };
              },
              then(
                onFulfilled: (v: {
                  data: Array<typeof staffRow>;
                  error: null;
                }) => unknown,
                onRejected?: (e: unknown) => unknown
              ) {
                return Promise.resolve({
                  data: resolveRows(),
                  error: null,
                }).then(onFulfilled, onRejected);
              },
            };
            return builder;
          },
        };
      }
      if (table === 'categories') {
        return {
          select(_cols = '*') {
            return {
              eq(_field: string, val: unknown) {
                return {
                  async maybeSingle() {
                    if (val === 'cat-fnb-001') {
                      return {
                        data: { id: 'cat-fnb-001', shop_id: 'shop-fnb-001' },
                        error: null,
                      };
                    }
                    return { data: null, error: null };
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'items') {
        return {
          select(_cols = '*', opts?: { count?: string; head?: boolean }) {
            if (opts?.head) {
              return {
                eq(_field: string, val: unknown) {
                  const count = itemsStore.filter((i) => i.shop_id === val).length;
                  return Promise.resolve({ count, error: null });
                },
              };
            }
            return {
              eq(field: string, val: unknown) {
                return {
                  async maybeSingle() {
                    const match = itemsStore.find(
                      (i) =>
                        (i as unknown as Record<string, unknown>)[field] === val
                    );
                    return { data: match ? { ...match } : null, error: null };
                  },
                };
              },
            };
          },
          update(patch: Partial<CatalogItem>) {
            itemUpdateCalls++;
            return {
              eq(field: string, val: unknown) {
                const idx = itemsStore.findIndex(
                  (i) =>
                    (i as unknown as Record<string, unknown>)[field] === val
                );
                if (idx >= 0) {
                  itemsStore[idx] = { ...itemsStore[idx], ...patch };
                }
                return {
                  select() {
                    return {
                      async single() {
                        return { data: itemsStore[idx], error: null };
                      },
                    };
                  },
                };
              },
            };
          },
          insert(payload: CatalogItem) {
            itemInsertCalls++;
            itemsStore.push({ ...payload });
            return {
              select() {
                return {
                  async single() {
                    return { data: payload, error: null };
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table in test mock: ${table}`);
    },
  };

  setSupabaseDbClientForTests(mockDbClient);
  setShopMembershipDbClientForTest(
    mockDbClient as unknown as Parameters<
      typeof setShopMembershipDbClientForTest
    >[0]
  );

  try {
    // 1. Invalid supplied prices via POST /api/catalog upsert_item (update & create) -> HTTP 400 before any write
    const invalidApiPrices: unknown[] = [
      -1,
      -500,
      '-1',
      '-35.000đ',
      0.5,
      1.5,
      35000.5,
      '12.5',
      1_000_000_001,
      '1000000001',
      '1.000.000.001',
      null,
      '',
      'abc',
    ];

    for (const badPrice of invalidApiPrices) {
      // Update existing item
      const resUpdate = await POST(
        new Request('http://localhost:3000/api/catalog', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ownerToken}`,
          },
          body: JSON.stringify({
            action: 'upsert_item',
            item: {
              ...itemsStore[0],
              price: badPrice,
            },
          }),
        })
      );
      assert.equal(
        resUpdate.status,
        400,
        `Update with invalid price ${String(badPrice)} must return HTTP 400`
      );
      const bodyUpdate = await resUpdate.json();
      assert.equal(bodyUpdate.success, false);
      assert.equal(bodyUpdate.code, 'INVALID_ITEM_PRICE');

      // Create new item
      const resCreate = await POST(
        new Request('http://localhost:3000/api/catalog', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ownerToken}`,
          },
          body: JSON.stringify({
            action: 'upsert_item',
            item: {
              shop_id: 'shop-fnb-001',
              category_id: 'cat-fnb-001',
              name_i18n: { vi: 'Món giá lỗi' },
              price: badPrice,
            },
          }),
        })
      );
      assert.equal(
        resCreate.status,
        400,
        `Create with invalid price ${String(badPrice)} must return HTTP 400`
      );
      const bodyCreate = await resCreate.json();
      assert.equal(bodyCreate.success, false);
      assert.equal(bodyCreate.code, 'INVALID_ITEM_PRICE');
    }

    assert.equal(itemUpdateCalls, 0, 'No item update may occur for invalid prices');
    assert.equal(itemInsertCalls, 0, 'No item insert may occur for invalid prices');
    assert.equal(itemsStore[0].price, 55000);

    // 2. Direct dbUpsertItem rejects negative, fractional, over-limit, and non-finite prices before any DB write
    const invalidDirectPrices: unknown[] = [
      -1,
      -0.5,
      1.5,
      1_000_000_001,
      NaN,
      Infinity,
      -Infinity,
      null,
      '',
    ];
    for (const badPrice of invalidDirectPrices) {
      await assert.rejects(
        async () => {
          await dbUpsertItem({
            id: 'item-fnb-001',
            shop_id: 'shop-fnb-001',
            category_id: 'cat-fnb-001',
            price: badPrice as number,
          });
        },
        /INVALID_ITEM_PRICE/
      );
      await assert.rejects(
        async () => {
          await dbUpsertItem({
            shop_id: 'shop-fnb-001',
            category_id: 'cat-fnb-001',
            name_i18n: { vi: 'Món mới lỗi' },
            price: badPrice as number,
          });
        },
        /INVALID_ITEM_PRICE/
      );
    }
    assert.equal(itemUpdateCalls, 0);
    assert.equal(itemInsertCalls, 0);

    // 3. Valid boundaries 0 and 1,000,000,000 succeed via POST /api/catalog upsert_item
    for (const boundaryPrice of [0, 1_000_000_000]) {
      const resBoundary = await POST(
        new Request('http://localhost:3000/api/catalog', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ownerToken}`,
          },
          body: JSON.stringify({
            action: 'upsert_item',
            item: {
              ...itemsStore[0],
              price: boundaryPrice,
            },
          }),
        })
      );
      assert.equal(resBoundary.status, 200);
      const dataBoundary = await resBoundary.json();
      assert.equal(dataBoundary.item.price, boundaryPrice);
      assert.equal(itemsStore[0].price, boundaryPrice);
    }

    // 4. Omitted price on update preserves current price (1,000,000,000)
    const resOmittedUpdate = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: 'item-fnb-001',
            shop_id: 'shop-fnb-001',
            category_id: 'cat-fnb-001',
            is_available: false,
          },
        }),
      })
    );
    assert.equal(resOmittedUpdate.status, 200);
    const dataOmittedUpdate = await resOmittedUpdate.json();
    assert.equal(dataOmittedUpdate.item.price, 1_000_000_000);
    assert.equal(dataOmittedUpdate.item.is_available, false);
    assert.equal(itemsStore[0].price, 1_000_000_000);

    // 5. Omitted price on create defaults to 0
    const resOmittedCreate = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: 'item-created-default-zero',
            shop_id: 'shop-fnb-001',
            category_id: 'cat-fnb-001',
            name_i18n: { vi: 'Món mặc định 0đ' },
          },
        }),
      })
    );
    assert.equal(resOmittedCreate.status, 200);
    const dataOmittedCreate = await resOmittedCreate.json();
    assert.equal(dataOmittedCreate.item.price, 0);

    // 6. Staff with inventory.adjust only: price change rejected with 403; stock/availability update preserves price
    const resStaffPriceAttempt = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...itemsStore[0],
            price: -1,
          },
        }),
      })
    );
    assert.equal(resStaffPriceAttempt.status, 403);
    const dataStaffPriceAttempt = await resStaffPriceAttempt.json();
    assert.equal(dataStaffPriceAttempt.code, 'INSUFFICIENT_SHOP_PERMISSION');
    assert.equal(itemsStore[0].price, 1_000_000_000);

    // Ambiguous legacy full snapshot carrying stock and toggling is_available without expected_is_available
    // must be rejected with 409 STOCK_CONFLICT
    const resStaffAmbiguousSnapshot = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...itemsStore[0],
            is_available: true,
          },
        }),
      })
    );
    assert.equal(resStaffAmbiguousSnapshot.status, 409);
    const dataStaffAmbiguous = await resStaffAmbiguousSnapshot.json();
    assert.equal(dataStaffAmbiguous.code, 'STOCK_CONFLICT');
    assert.equal(itemsStore[0].is_available, false);
    assert.equal(itemsStore[0].price, 1_000_000_000);

    // Legitimate availability toggle with explicit expected_is_available (or narrow update) succeeds and preserves price
    const resStaffInventoryUpdate = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: itemsStore[0].id,
            shop_id: itemsStore[0].shop_id,
            category_id: itemsStore[0].category_id,
            is_available: true,
            expected_is_available: false,
          },
        }),
      })
    );
    assert.equal(resStaffInventoryUpdate.status, 200);
    const dataStaffInv = await resStaffInventoryUpdate.json();
    assert.equal(dataStaffInv.item.price, 1_000_000_000);
    assert.equal(dataStaffInv.item.is_available, true);
    assert.equal(itemsStore[0].price, 1_000_000_000);
    assert.equal(itemsStore[0].is_available, true);
  } finally {
    setShopMembershipDbClientForTest(null);
    setSupabaseDbClientForTests(null);
  }
});

test('POST /api/catalog bulk_import and dbBulkImportCatalog validate all item prices before the first category or item write', async () => {
  const { POST } = await import('@/app/api/catalog/route');
  const { issueSessionToken } = await import('@/lib/server-auth');
  const { dbBulkImportCatalog, setSupabaseDbClientForTests } = await import('@/lib/db');

  const ownerToken = issueSessionToken({
    id: 'owner-demo-001',
    email: 'chuquan@qlaok.vn',
    role: 'owner',
  });

  const categoriesStore: Category[] = [];
  const itemsStore: CatalogItem[] = [];
  let categoryWriteCalls = 0;
  let itemWriteCalls = 0;

  const mockDbClient = {
    from(table: string) {
      if (table === 'shops') {
        return {
          select(_cols = '*') {
            return {
              limit: async () => ({
                data: [{ id: 'shop-fnb-001' }],
                error: null,
              }),
              eq(_field: string, val: unknown) {
                return {
                  async maybeSingle() {
                    if (val === 'shop-fnb-001') {
                      return {
                        data: { id: 'shop-fnb-001', owner_id: 'owner-demo-001' },
                        error: null,
                      };
                    }
                    return { data: null, error: null };
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'profiles') {
        return {
          select(_cols = '*') {
            return {
              eq(_field: string, val: unknown) {
                return {
                  async maybeSingle() {
                    if (val === 'owner-demo-001') {
                      return {
                        data: { id: 'owner-demo-001', plan: 'premium' },
                        error: null,
                      };
                    }
                    return { data: null, error: null };
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'categories') {
        return {
          select(_cols = '*', opts?: { count?: string; head?: boolean }) {
            if (opts?.head) {
              return {
                eq(_field: string, val: unknown) {
                  const count = categoriesStore.filter((c) => c.shop_id === val).length;
                  return Promise.resolve({ count, error: null });
                },
              };
            }
            return {
              eq(field: string, val: unknown) {
                return {
                  async maybeSingle() {
                    const match = categoriesStore.find(
                      (c) =>
                        (c as unknown as Record<string, unknown>)[field] === val
                    );
                    return { data: match ? { ...match } : null, error: null };
                  },
                };
              },
            };
          },
          update(patch: Partial<Category>) {
            return {
              eq(field: string, val: unknown) {
                const idx = categoriesStore.findIndex(
                  (c) =>
                    (c as unknown as Record<string, unknown>)[field] === val
                );
                if (idx >= 0) {
                  categoryWriteCalls++;
                  categoriesStore[idx] = { ...categoriesStore[idx], ...patch };
                }
                return {
                  select() {
                    return {
                      async single() {
                        if (idx >= 0) {
                          return { data: categoriesStore[idx], error: null };
                        }
                        return { data: null, error: { message: 'Not found' } };
                      },
                    };
                  },
                };
              },
            };
          },
          upsert(payload: Category) {
            categoryWriteCalls++;
            const idx = categoriesStore.findIndex((c) => c.id === payload.id);
            if (idx >= 0) {
              categoriesStore[idx] = { ...categoriesStore[idx], ...payload };
            } else {
              categoriesStore.push({ ...payload });
            }
            return {
              select() {
                return {
                  async single() {
                    return { data: payload, error: null };
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'items') {
        return {
          select(_cols = '*', opts?: { count?: string; head?: boolean }) {
            if (opts?.head) {
              return {
                eq(_field: string, val: unknown) {
                  const count = itemsStore.filter((i) => i.shop_id === val).length;
                  return Promise.resolve({ count, error: null });
                },
              };
            }
            return {
              eq(field: string, val: unknown) {
                return {
                  async maybeSingle() {
                    const match = itemsStore.find(
                      (i) =>
                        (i as unknown as Record<string, unknown>)[field] === val
                    );
                    return { data: match ? { ...match } : null, error: null };
                  },
                };
              },
            };
          },
          insert(payload: CatalogItem) {
            itemWriteCalls++;
            itemsStore.push({ ...payload });
            return {
              select() {
                return {
                  async single() {
                    return { data: payload, error: null };
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table in test mock: ${table}`);
    },
  };

  setSupabaseDbClientForTests(mockDbClient);

  try {
    // 1. Multi-category payload where Category 1 Item 1 is valid, but Category 2 Item 1 has an invalid price:
    // Must reject with HTTP 400 BEFORE writing Category 1 or Item 1!
    const invalidBulkApiPrices: unknown[] = [
      -1,
      -500,
      0.5,
      35000.5,
      1_000_000_001,
      null,
      '',
      'abc',
      '-25000',
      '12.5',
    ];

    for (const badPrice of invalidBulkApiPrices) {
      const res = await POST(
        new Request('http://localhost:3000/api/catalog', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ownerToken}`,
          },
          body: JSON.stringify({
            action: 'bulk_import',
            shopId: 'shop-fnb-001',
            categories: [
              {
                id: 'cat-valid-first',
                name_i18n: { vi: 'Danh mục 1 hợp lệ' },
                items: [
                  {
                    id: 'item-valid-first',
                    price: 35000,
                    name_i18n: { vi: 'Món 1 hợp lệ' },
                    desc_i18n: { vi: '' },
                  },
                ],
              },
              {
                id: 'cat-second-with-bad-item',
                name_i18n: { vi: 'Danh mục 2 có món lỗi' },
                items: [
                  {
                    id: 'item-bad-second',
                    price: badPrice,
                    name_i18n: { vi: 'Món 2 giá lỗi' },
                    desc_i18n: { vi: '' },
                  },
                ],
              },
            ],
          }),
        })
      );

      assert.equal(
        res.status,
        400,
        `bulk_import with invalid price ${String(badPrice)} must return HTTP 400`
      );
      const data = await res.json();
      assert.equal(data.success, false);
      assert.equal(data.code, 'INVALID_ITEM_PRICE');
      assert.equal(
        categoryWriteCalls,
        0,
        'No category write may occur when any imported item price is invalid'
      );
      assert.equal(
        itemWriteCalls,
        0,
        'No item write may occur when any imported item price is invalid'
      );
      assert.equal(categoriesStore.length, 0);
      assert.equal(itemsStore.length, 0);
    }

    // 2. Direct dbBulkImportCatalog rejects negative, fractional, over-limit, and non-finite prices before any writes
    for (const badDirectPrice of [-1, 1.5, 1_000_000_001, NaN, Infinity, -Infinity]) {
      await assert.rejects(
        async () => {
          await dbBulkImportCatalog('shop-fnb-001', [
            {
              id: 'cat-direct-1',
              name_i18n: { vi: 'Danh mục 1' },
              items: [
                {
                  id: 'item-direct-1',
                  price: 25000,
                  name_i18n: { vi: 'Món 1' },
                  desc_i18n: { vi: '' },
                },
              ],
            },
            {
              id: 'cat-direct-2',
              name_i18n: { vi: 'Danh mục 2' },
              items: [
                {
                  id: 'item-direct-2',
                  price: badDirectPrice,
                  name_i18n: { vi: 'Món 2 lỗi' },
                  desc_i18n: { vi: '' },
                },
              ],
            },
          ]);
        },
        /INVALID_ITEM_PRICE/
      );
      assert.equal(categoryWriteCalls, 0);
      assert.equal(itemWriteCalls, 0);
      assert.equal(categoriesStore.length, 0);
      assert.equal(itemsStore.length, 0);
    }

    // 3. Valid boundary prices 0 and 1,000,000,000 succeed cleanly in bulk_import
    const resValidBulk = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_import',
          shopId: 'shop-fnb-001',
          categories: [
            {
              id: 'cat-boundary-bulk',
              name_i18n: { vi: 'Danh mục biên' },
              items: [
                {
                  id: 'item-boundary-zero',
                  price: 0,
                  name_i18n: { vi: 'Món 0đ' },
                  desc_i18n: { vi: '' },
                },
                {
                  id: 'item-boundary-max',
                  price: 1_000_000_000,
                  name_i18n: { vi: 'Món 1 tỷ' },
                  desc_i18n: { vi: '' },
                },
              ],
            },
          ],
        }),
      })
    );
    assert.equal(resValidBulk.status, 200);
    const dataValidBulk = await resValidBulk.json();
    assert.equal(dataValidBulk.createdCategories.length, 1);
    assert.equal(dataValidBulk.createdItems.length, 2);
    assert.equal(dataValidBulk.createdItems[0].price, 0);
    assert.equal(dataValidBulk.createdItems[1].price, 1_000_000_000);
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

// ==========================================
// Suite 10: Catalog Inventory Race Protection & Atomic Compare-And-Swap
// ==========================================

function createAtomicCatalogTestDb(
  itemsStore: CatalogItem[],
  categoriesStore: Array<{ id: string; shop_id: string }> = [
    { id: 'cat-fnb-001', shop_id: 'shop-fnb-001' },
  ],
  hooks?: {
    onBeforeItemUpdate?: (patch: Partial<CatalogItem>) => void | Promise<void>;
  }
) {
  return {
    from(table: string) {
      if (table === 'items') {
        return {
          select(_fields = '*', opts?: { count?: string; head?: boolean }) {
            if (opts?.head) {
              return {
                eq(_field: string, val: unknown) {
                  const count = itemsStore.filter((i) => i.shop_id === val).length;
                  return Promise.resolve({ count, error: null });
                },
              };
            }
            return {
              eq(field: string, val: unknown) {
                return {
                  async maybeSingle() {
                    const match = itemsStore.find(
                      (item) => (item as unknown as Record<string, unknown>)[field] === val
                    );
                    return { data: match ? { ...match } : null, error: null };
                  },
                };
              },
            };
          },
          insert(payload: CatalogItem) {
            itemsStore.push({ ...payload });
            return {
              select(_fields = '*') {
                return {
                  async single() {
                    return { data: { ...payload }, error: null };
                  },
                };
              },
            };
          },
          update(patch: Partial<CatalogItem>) {
            const filters: Array<(row: Record<string, unknown>) => boolean> = [];
            const builder = {
              eq(field: string, val: unknown) {
                filters.push((row) => row[field] === val);
                return builder;
              },
              is(field: string, val: unknown) {
                filters.push((row) => row[field] === val);
                return builder;
              },
              or(expr: string) {
                if (expr === 'stock_quantity.is.null,stock_quantity.gt.0') {
                  filters.push(
                    (row) =>
                      row.stock_quantity === null ||
                      row.stock_quantity === undefined ||
                      (typeof row.stock_quantity === 'number' &&
                        row.stock_quantity > 0)
                  );
                }
                return builder;
              },
              select(_fields = '*') {
                return {
                  async single() {
                    if (hooks?.onBeforeItemUpdate) {
                      await hooks.onBeforeItemUpdate(patch);
                    }
                    const idx = itemsStore.findIndex((item) =>
                      filters.every((fn) => fn(item as unknown as Record<string, unknown>))
                    );
                    if (idx < 0) {
                      return {
                        data: null,
                        error: {
                          code: 'PGRST116',
                          message: 'JSON object requested, multiple (or no) rows returned',
                        },
                      };
                    }
                    itemsStore[idx] = { ...itemsStore[idx], ...patch };
                    return { data: { ...itemsStore[idx] }, error: null };
                  },
                };
              },
            };
            return builder;
          },
          upsert(payload: CatalogItem) {
            const idx = itemsStore.findIndex((i) => i.id === payload.id);
            if (idx >= 0) {
              itemsStore[idx] = { ...itemsStore[idx], ...payload };
            } else {
              itemsStore.push({ ...payload });
            }
            return {
              select(_fields = '*') {
                return {
                  async single() {
                    const item = itemsStore.find((i) => i.id === payload.id);
                    return { data: item ? { ...item } : null, error: null };
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'categories') {
        return {
          select(_fields = '*') {
            return {
              eq(field: string, val: unknown) {
                return {
                  async maybeSingle() {
                    const match = categoriesStore.find(
                      (c) => (c as Record<string, unknown>)[field] === val
                    );
                    return { data: match ? { ...match } : null, error: null };
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'shops') {
        return {
          select(_fields = '*') {
            return {
              eq(_field: string, val: unknown) {
                return {
                  async maybeSingle() {
                    if (val === 'shop-fnb-001') {
                      return {
                        data: { id: 'shop-fnb-001', owner_id: 'owner-demo-001' },
                        error: null,
                      };
                    }
                    return { data: null, error: null };
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'profiles') {
        return {
          select(_fields = '*') {
            return {
              eq(_field: string, val: unknown) {
                return {
                  async maybeSingle() {
                    if (val === 'owner-demo-001') {
                      return {
                        data: { id: 'owner-demo-001', plan: 'premium' },
                        error: null,
                      };
                    }
                    return { data: null, error: null };
                  },
                };
              },
            };
          },
        };
      }
      return {};
    },
  };
}

test('Catalog race protection: 2 interleaved orders exhausting stock + stale price/featured/image/translation edits preserve stock_quantity, sold_count, and sold-out is_available', async () => {
  const { POST } = await import('@/app/api/catalog/route');
  const { issueSessionToken } = await import('@/lib/server-auth');
  const { setSupabaseDbClientForTests } = await import('@/lib/db');

  const ownerToken = issueSessionToken({
    id: 'owner-demo-001',
    email: 'chuquan@qlaok.vn',
    role: 'owner',
  });

  // Initial state: stock_quantity = 5, sold_count = 0, price = 40000, is_available = true
  const staleDashboardSnapshot: CatalogItem = {
    id: 'item-race-001',
    shop_id: 'shop-fnb-001',
    category_id: 'cat-fnb-001',
    name_i18n: { vi: 'Cà phê muối', en: 'Salted Coffee' },
    desc_i18n: { vi: 'Thơm béo', en: 'Creamy' },
    price: 40000,
    stock_quantity: 5,
    is_available: true,
    is_featured: false,
    options_json: [],
    view_count: 10,
    sold_count: 0,
    sort_order: 1,
  };

  const itemsStore: CatalogItem[] = [{ ...staleDashboardSnapshot }];
  setSupabaseDbClientForTests(createAtomicCatalogTestDb(itemsStore));

  try {
    // Simulate Order #1 (qty 2) and Order #2 (qty 3) deducting all 5 units in DB while dashboard is open
    itemsStore[0] = {
      ...itemsStore[0],
      stock_quantity: 0,
      sold_count: 5,
      is_available: false,
    };

    // Case A: Narrow price edit from updated Web/Mobile UI
    const resNarrowPrice = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: 'item-race-001',
            shop_id: 'shop-fnb-001',
            category_id: 'cat-fnb-001',
            price: 45000,
          },
        }),
      })
    );
    assert.equal(resNarrowPrice.status, 200);
    const bodyNarrowPrice = await resNarrowPrice.json();
    assert.equal(bodyNarrowPrice.item.price, 45000);
    assert.equal(bodyNarrowPrice.item.stock_quantity, 0);
    assert.equal(bodyNarrowPrice.item.sold_count, 5);
    assert.equal(bodyNarrowPrice.item.is_available, false);

    // Case B: Legacy/stale full-object spread price edit ({ ...staleDashboardSnapshot, price: 47000 })
    // Even if a client echoes stale stock_quantity: 5, sold_count: 0, is_available: true without expected_stock_quantity,
    // the server must NOT overwrite stock_quantity, sold_count, or is_available!
    const resStaleSpreadPrice = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...staleDashboardSnapshot,
            price: 47000,
          },
        }),
      })
    );
    assert.equal(resStaleSpreadPrice.status, 200);
    const bodyStaleSpread = await resStaleSpreadPrice.json();
    assert.equal(bodyStaleSpread.item.price, 47000);
    assert.equal(
      bodyStaleSpread.item.stock_quantity,
      0,
      'Stale price edit must never resurrect exhausted stock_quantity'
    );
    assert.equal(
      bodyStaleSpread.item.sold_count,
      5,
      'Stale price edit must never reset server-managed sold_count'
    );
    assert.equal(
      bodyStaleSpread.item.is_available,
      false,
      'Stale price edit must never mark sold-out item as available'
    );

    // Case C: Non-stock edits (is_featured, image_url, translations) + forged sold_count
    const resMetadataEdit = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: 'item-race-001',
            shop_id: 'shop-fnb-001',
            category_id: 'cat-fnb-001',
            name_i18n: { vi: 'Cà phê muối Huế', en: 'Hue Salted Coffee' },
            is_featured: true,
            image_url: 'https://example.com/coffee.jpg',
            sold_count: 9999,
            view_count: 8888,
          },
        }),
      })
    );
    assert.equal(resMetadataEdit.status, 200);
    const bodyMetadata = await resMetadataEdit.json();
    assert.equal(bodyMetadata.item.name_i18n.vi, 'Cà phê muối Huế');
    assert.equal(bodyMetadata.item.is_featured, true);
    assert.equal(bodyMetadata.item.image_url, 'https://example.com/coffee.jpg');
    assert.equal(bodyMetadata.item.stock_quantity, 0);
    assert.equal(bodyMetadata.item.sold_count, 5, 'Client-supplied sold_count must be ignored');
    assert.equal(bodyMetadata.item.view_count, 10, 'Client-supplied view_count must be ignored');
    assert.equal(bodyMetadata.item.is_available, false);
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('Catalog atomic CAS: stock edit after interleaved order returns 409 STOCK_CONFLICT, and succeeds after refresh', async () => {
  const { POST } = await import('@/app/api/catalog/route');
  const { issueSessionToken } = await import('@/lib/server-auth');
  const { setSupabaseDbClientForTests } = await import('@/lib/db');

  const ownerToken = issueSessionToken({
    id: 'owner-demo-001',
    email: 'chuquan@qlaok.vn',
    role: 'owner',
  });

  const initialItem: CatalogItem = {
    id: 'item-cas-001',
    shop_id: 'shop-fnb-001',
    category_id: 'cat-fnb-001',
    name_i18n: { vi: 'Trà sữa nướng', en: 'Roasted Milk Tea' },
    desc_i18n: { vi: '', en: '' },
    price: 35000,
    stock_quantity: 5,
    is_available: true,
    is_featured: false,
    options_json: [],
    view_count: 0,
    sold_count: 0,
    sort_order: 1,
  };

  const itemsStore: CatalogItem[] = [{ ...initialItem }];
  setSupabaseDbClientForTests(createAtomicCatalogTestDb(itemsStore));

  try {
    // Interleaved order deducts 2 units: stock_quantity becomes 3, sold_count becomes 2
    itemsStore[0] = {
      ...itemsStore[0],
      stock_quantity: 3,
      sold_count: 2,
    };

    // 1. Manager attempts stock edit to 10 with stale expected_stock_quantity: 5 -> must fail with 409 STOCK_CONFLICT
    const resConflict = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: 'item-cas-001',
            shop_id: 'shop-fnb-001',
            category_id: 'cat-fnb-001',
            stock_quantity: 10,
            expected_stock_quantity: 5,
          },
        }),
      })
    );
    assert.equal(resConflict.status, 409);
    const bodyConflict = await resConflict.json();
    assert.equal(bodyConflict.code, 'STOCK_CONFLICT');
    assert.equal(itemsStore[0].stock_quantity, 3, 'DB stock must remain untouched on CAS conflict');
    assert.equal(itemsStore[0].sold_count, 2, 'DB sold_count must remain untouched on CAS conflict');

    // 2. Legacy spread stock edit without expected_stock_quantity but carrying stale sold_count: 0 -> also fails with 409 STOCK_CONFLICT
    const resLegacySpreadConflict = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...initialItem,
            stock_quantity: 10,
          },
        }),
      })
    );
    assert.equal(resLegacySpreadConflict.status, 409);
    const bodyLegacyConflict = await resLegacySpreadConflict.json();
    assert.equal(bodyLegacyConflict.code, 'STOCK_CONFLICT');
    assert.equal(itemsStore[0].stock_quantity, 3);

    // 3. Manager refreshes UI (sees stock_quantity = 3) and retries setting stock_quantity = 10 with expected_stock_quantity: 3
    const resRetrySuccess = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: 'item-cas-001',
            shop_id: 'shop-fnb-001',
            category_id: 'cat-fnb-001',
            stock_quantity: 10,
            expected_stock_quantity: 3,
          },
        }),
      })
    );
    assert.equal(resRetrySuccess.status, 200);
    const bodyRetry = await resRetrySuccess.json();
    assert.equal(bodyRetry.item.stock_quantity, 10);
    assert.equal(bodyRetry.item.sold_count, 2, 'sold_count must remain 2 after stock update');
    assert.equal(bodyRetry.item.is_available, true);
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('Excel import: price-only row does not send or overwrite stock_quantity, while stock-edited row enforces expected_stock_quantity CAS', async () => {
  const { POST } = await import('@/app/api/catalog/route');
  const { issueSessionToken } = await import('@/lib/server-auth');
  const { setSupabaseDbClientForTests } = await import('@/lib/db');

  const ownerToken = issueSessionToken({
    id: 'owner-demo-001',
    email: 'chuquan@qlaok.vn',
    role: 'owner',
  });

  const exportedItems: CatalogItem[] = [
    {
      id: 'item-excel-price-only',
      shop_id: 'shop-fnb-001',
      category_id: 'cat-fnb-001',
      name_i18n: { vi: 'Bạc xỉu', en: 'White Coffee' },
      desc_i18n: { vi: '', en: '' },
      price: 30000,
      stock_quantity: 5,
      is_available: true,
      is_featured: false,
      options_json: [],
      view_count: 0,
      sold_count: 1,
      sort_order: 1,
    },
    {
      id: 'item-excel-stock-edit',
      shop_id: 'shop-fnb-001',
      category_id: 'cat-fnb-001',
      name_i18n: { vi: 'Bánh sừng bò', en: 'Croissant' },
      desc_i18n: { vi: '', en: '' },
      price: 25000,
      stock_quantity: 8,
      is_available: true,
      is_featured: false,
      options_json: [],
      view_count: 0,
      sold_count: 4,
      sort_order: 2,
    },
  ];

  // Build Excel workbook from snapshot before orders happen
  const initialBytes = await buildCatalogXlsxWorkbook(exportedItems, [
    {
      id: 'cat-fnb-001',
      shop_id: 'shop-fnb-001',
      name_i18n: { vi: 'Đồ uống' },
      sort_order: 1,
      is_active: true,
    },
  ]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(initialBytes).buffer);

  const sheet = workbook.getWorksheet('ThucDon')!;
  // Row 2 is item-excel-price-only: edit ONLY price (col 5 -> 36000), leave stock cell at 5
  sheet.getRow(2).getCell(5).value = 36000;
  // Row 3 is item-excel-stock-edit: edit stock (col 6 -> 20), leave price at 25000
  sheet.getRow(3).getCell(6).value = 20;

  const buffer = await workbook.xlsx.writeBuffer();
  const validation = await parseAndValidateCatalogExcel(
    new Uint8Array(buffer),
    exportedItems
  );

  assert.equal(validation.validRows.length, 2);
  const bulkItems = buildCatalogExcelBulkUpdateItems(validation.validRows);
  assert.deepEqual(bulkItems, [
    {
      id: 'item-excel-price-only',
      price: 36000,
    },
    {
      id: 'item-excel-stock-edit',
      stock_quantity: 20,
      expected_stock_quantity: 8,
    },
  ]);

  // Now simulate orders happening on BOTH items before the user clicks "Apply Import":
  // - item-excel-price-only: stock drops 5 -> 2, sold_count 1 -> 4
  // - item-excel-stock-edit: stock drops 8 -> 6, sold_count 4 -> 6
  const itemsStore: CatalogItem[] = [
    { ...exportedItems[0], stock_quantity: 2, sold_count: 4 },
    { ...exportedItems[1], stock_quantity: 6, sold_count: 6 },
  ];
  setSupabaseDbClientForTests(createAtomicCatalogTestDb(itemsStore));

  try {
    const resBulk = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_update_price_stock',
          shopId: 'shop-fnb-001',
          items: bulkItems,
        }),
      })
    );

    assert.equal(resBulk.status, 200);
    const bodyBulk = await resBulk.json();
    assert.equal(bodyBulk.success, false);
    assert.equal(bodyBulk.code, 'STOCK_CONFLICT');
    assert.equal(bodyBulk.updatedCount, 1);
    assert.equal(bodyBulk.results.length, 2);

    // Price-only item succeeded and kept live stock_quantity = 2, sold_count = 4
    const updatedPriceItem = itemsStore.find((i) => i.id === 'item-excel-price-only')!;
    assert.equal(updatedPriceItem.price, 36000);
    assert.equal(updatedPriceItem.stock_quantity, 2);
    assert.equal(updatedPriceItem.sold_count, 4);

    // Stock-edited item had a concurrent order (expected 8 vs actual 6) -> flagged with STOCK_CONFLICT, stock_quantity = 6 preserved
    const conflictResult = bodyBulk.results.find(
      (r: { id: string }) => r.id === 'item-excel-stock-edit'
    );
    assert.equal(conflictResult.success, false);
    assert.equal(conflictResult.code, 'STOCK_CONFLICT');

    const untouchedStockItem = itemsStore.find((i) => i.id === 'item-excel-stock-edit')!;
    assert.equal(untouchedStockItem.stock_quantity, 6);
    assert.equal(untouchedStockItem.sold_count, 6);
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('Catalog stock transitions: null (unlimited), 0 (sold out), positive stock, and new item insert handle CAS and server-managed sold_count accurately', async () => {
  const { POST } = await import('@/app/api/catalog/route');
  const { issueSessionToken } = await import('@/lib/server-auth');
  const { setSupabaseDbClientForTests } = await import('@/lib/db');

  const ownerToken = issueSessionToken({
    id: 'owner-demo-001',
    email: 'chuquan@qlaok.vn',
    role: 'owner',
  });

  const itemsStore: CatalogItem[] = [];
  setSupabaseDbClientForTests(createAtomicCatalogTestDb(itemsStore));

  try {
    // 1. Insert new item with unlimited stock (null) and forged sold_count: 500
    const resInsertUnlimited = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: 'item-lifecycle-001',
            shop_id: 'shop-fnb-001',
            category_id: 'cat-fnb-001',
            name_i18n: { vi: 'Trà sen vàng', en: 'Lotus Tea' },
            desc_i18n: { vi: '', en: '' },
            price: 45000,
            stock_quantity: null,
            is_available: true,
            sold_count: 500,
          },
        }),
      })
    );
    assert.equal(resInsertUnlimited.status, 200);
    const createdUnlimited = (await resInsertUnlimited.json()).item;
    assert.equal(createdUnlimited.stock_quantity, null);
    assert.equal(createdUnlimited.is_available, true);
    assert.equal(createdUnlimited.sold_count, 0, 'New item insert must initialize sold_count to 0');

    // 2. Transition null -> 10 with expected_stock_quantity: null succeeds
    const resNullToTen = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: 'item-lifecycle-001',
            shop_id: 'shop-fnb-001',
            category_id: 'cat-fnb-001',
            stock_quantity: 10,
            expected_stock_quantity: null,
          },
        }),
      })
    );
    assert.equal(resNullToTen.status, 200);
    assert.equal(itemsStore[0].stock_quantity, 10);

    // 3. Stale attempt to transition null -> 5 when stock is already 10 fails with 409 STOCK_CONFLICT
    const resStaleNull = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: 'item-lifecycle-001',
            shop_id: 'shop-fnb-001',
            category_id: 'cat-fnb-001',
            stock_quantity: 5,
            expected_stock_quantity: null,
          },
        }),
      })
    );
    assert.equal(resStaleNull.status, 409);
    assert.equal((await resStaleNull.json()).code, 'STOCK_CONFLICT');
    assert.equal(itemsStore[0].stock_quantity, 10);

    // 4. Transition 10 -> 0 sets is_available = false
    const resTenToZero = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: 'item-lifecycle-001',
            shop_id: 'shop-fnb-001',
            category_id: 'cat-fnb-001',
            stock_quantity: 0,
            expected_stock_quantity: 10,
          },
        }),
      })
    );
    assert.equal(resTenToZero.status, 200);
    assert.equal(itemsStore[0].stock_quantity, 0);
    assert.equal(itemsStore[0].is_available, false);

    // 5. Transition 0 -> 8 restores is_available = true
    const resZeroToEight = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: 'item-lifecycle-001',
            shop_id: 'shop-fnb-001',
            category_id: 'cat-fnb-001',
            stock_quantity: 8,
            expected_stock_quantity: 0,
          },
        }),
      })
    );
    assert.equal(resZeroToEight.status, 200);
    assert.equal(itemsStore[0].stock_quantity, 8);
    assert.equal(itemsStore[0].is_available, true);

    // 6. Transition 8 -> null (unlimited) with expected_stock_quantity: 8 succeeds
    const resEightToNull = await POST(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: 'item-lifecycle-001',
            shop_id: 'shop-fnb-001',
            category_id: 'cat-fnb-001',
            stock_quantity: null,
            expected_stock_quantity: 8,
          },
        }),
      })
    );
    assert.equal(resEightToNull.status, 200);
    assert.equal(itemsStore[0].stock_quantity, null);
    assert.equal(itemsStore[0].is_available, true);
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('Isolated PostgreSQL + commit_order_with_inventory RPC: resolves all catalog stock race scenarios end-to-end (dbUpsertItem zero-stock fallback concurrency)', async (t) => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { execSync, spawn } = await import('node:child_process');
  const pgModule = await import('pg');
  const pg = pgModule.default || pgModule;

  if (!fs.existsSync('/opt/homebrew/bin/initdb') || !fs.existsSync('/opt/homebrew/bin/postgres')) {
    t.skip('Local PostgreSQL binaries not found at /opt/homebrew/bin');
    return;
  }

  const { POST: catalogPost, GET: catalogGet } = await import('@/app/api/catalog/route');
  const { dbUpsertItem, setSupabaseDbClientForTests } = await import('@/lib/db');
  const { setShopMembershipDbClientForTest } = await import('@/lib/shop-permissions');
  const { setMposDbClientForTests } = await import('@/lib/mpos-store');
  const { issueSessionToken } = await import('@/lib/server-auth');

  const testPort = 55459;
  const tempPgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qlaok-pg-cat-race-fix-'));
  let pgProc: ReturnType<typeof spawn> | null = null;
  const openClients: Array<InstanceType<typeof pg.Client>> = [];

  async function createPgClient() {
    const client = new pg.Client({
      host: '127.0.0.1',
      port: testPort,
      user: 'qlaok_race_admin',
      database: 'postgres',
    });
    await client.connect();
    openClients.push(client);
    return client;
  }

  try {
    execSync(`/opt/homebrew/bin/initdb -D "${tempPgDir}" -A trust -U qlaok_race_admin --no-instructions`, {
      stdio: 'pipe',
    });

    pgProc = spawn(
      '/opt/homebrew/bin/postgres',
      [
        '-D',
        tempPgDir,
        '-p',
        String(testPort),
        '-k',
        '/tmp',
        '-h',
        '127.0.0.1',
        '-c',
        'listen_addresses=127.0.0.1',
        '-c',
        'fsync=off',
        '-c',
        'synchronous_commit=off',
      ],
      { stdio: 'pipe' }
    );

    let pgReady = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((r) => setTimeout(r, 150));
      try {
        const probe = new pg.Client({
          host: '127.0.0.1',
          port: testPort,
          user: 'qlaok_race_admin',
          database: 'postgres',
        });
        await probe.connect();
        await probe.query('SELECT 1;');
        await probe.end();
        pgReady = true;
        break;
      } catch {
        // retry
      }
    }
    assert.equal(pgReady, true, 'Ephemeral PostgreSQL must start');

    const adminClient = await createPgClient();
    const orderRpcClient = await createPgClient();

    await adminClient.query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
      CREATE TABLE public.profiles (
        id TEXT PRIMARY KEY,
        email VARCHAR(255),
        role TEXT NOT NULL DEFAULT 'owner',
        plan TEXT NOT NULL DEFAULT 'premium',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE public.shops (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
        slug VARCHAR(100) UNIQUE NOT NULL,
        name VARCHAR(150) NOT NULL,
        vertical VARCHAR(20) NOT NULL DEFAULT 'fnb',
        tagline_i18n JSONB NOT NULL DEFAULT '{"vi": ""}'::jsonb,
        description_i18n JSONB NOT NULL DEFAULT '{"vi": ""}'::jsonb,
        city VARCHAR(100) NOT NULL DEFAULT 'TP. Hồ Chí Minh',
        supported_langs TEXT[] NOT NULL DEFAULT ARRAY['vi', 'en'],
        currency VARCHAR(10) NOT NULL DEFAULT 'VND',
        theme_config JSONB NOT NULL DEFAULT '{"primaryColor": "#10b981"}'::jsonb,
        is_published BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE public.categories (
        id TEXT PRIMARY KEY,
        shop_id TEXT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        name_i18n JSONB NOT NULL DEFAULT '{"vi": "Danh mục"}'::jsonb,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE public.items (
        id TEXT PRIMARY KEY,
        shop_id TEXT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
        category_id TEXT NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        price NUMERIC(12, 0) NOT NULL DEFAULT 0,
        compare_at_price NUMERIC(12, 0),
        unit_i18n JSONB DEFAULT '{"vi": "phần", "en": "portion"}'::jsonb,
        duration_mins INTEGER,
        image_url TEXT,
        is_available BOOLEAN NOT NULL DEFAULT TRUE,
        is_featured BOOLEAN NOT NULL DEFAULT FALSE,
        name_i18n JSONB NOT NULL DEFAULT '{"vi": ""}'::jsonb,
        desc_i18n JSONB NOT NULL DEFAULT '{"vi": ""}'::jsonb,
        options_json JSONB DEFAULT '[]'::jsonb,
        view_count INTEGER NOT NULL DEFAULT 0,
        stock_quantity INTEGER DEFAULT NULL,
        sold_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE public.shop_tables (
        id TEXT PRIMARY KEY,
        shop_id TEXT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
        table_code VARCHAR(30) NOT NULL,
        name VARCHAR(100) NOT NULL,
        seat_capacity INTEGER NOT NULL DEFAULT 4,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        is_archived BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE public.shop_memberships (
        id TEXT PRIMARY KEY,
        shop_id TEXT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'owner',
        permissions TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE public.orders (
        id TEXT PRIMARY KEY,
        order_code VARCHAR(30) NOT NULL,
        shop_id TEXT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
        table_id TEXT REFERENCES public.shop_tables(id) ON DELETE SET NULL,
        table_label VARCHAR(60) NOT NULL DEFAULT 'Tại quầy',
        session_id TEXT,
        bill_version INTEGER NOT NULL DEFAULT 1,
        visitor_lang VARCHAR(10) NOT NULL DEFAULT 'vi',
        customer_note TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'new',
        workflow_step_id VARCHAR(50) DEFAULT 'received',
        payment_method VARCHAR(20) NOT NULL DEFAULT 'cash',
        payment_status VARCHAR(20) NOT NULL DEFAULT 'unpaid',
        subtotal_amount NUMERIC(12, 0) NOT NULL DEFAULT 0,
        discount_amount NUMERIC(12, 0) NOT NULL DEFAULT 0,
        promo_discount_amount NUMERIC(12, 0) NOT NULL DEFAULT 0,
        manual_discount_amount NUMERIC(12, 0) NOT NULL DEFAULT 0,
        discount_code VARCHAR(50) DEFAULT NULL,
        discount_reason TEXT DEFAULT NULL,
        total_amount NUMERIC(12, 0) NOT NULL DEFAULT 0,
        items JSONB NOT NULL DEFAULT '[]'::jsonb,
        source VARCHAR(20) NOT NULL DEFAULT 'qr_table',
        tracking_token VARCHAR(100) DEFAULT NULL,
        idempotency_key VARCHAR(100) DEFAULT NULL,
        payment_idempotency_key VARCHAR(100) DEFAULT NULL,
        paid_at TIMESTAMPTZ DEFAULT NULL,
        paid_by TEXT DEFAULT NULL,
        refunded_at TIMESTAMPTZ DEFAULT NULL,
        refund_reason TEXT DEFAULT NULL,
        refunded_by TEXT DEFAULT NULL,
        cancelled_reason TEXT DEFAULT NULL,
        cancel_reason TEXT DEFAULT NULL,
        waste_recorded BOOLEAN NOT NULL DEFAULT FALSE,
        print_count INTEGER NOT NULL DEFAULT 0,
        kitchen_printed_count INTEGER NOT NULL DEFAULT 0,
        provisional_printed_count INTEGER NOT NULL DEFAULT 0,
        receipt_printed_count INTEGER NOT NULL DEFAULT 0,
        label_printed_count INTEGER NOT NULL DEFAULT 0,
        last_printed_at TIMESTAMPTZ DEFAULT NULL,
        last_printed_by TEXT DEFAULT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await adminClient.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
          CREATE ROLE service_role NOLOGIN;
        END IF;
      END
      $$;
      CREATE OR REPLACE FUNCTION public.is_client_request_context()
      RETURNS BOOLEAN
      LANGUAGE sql
      STABLE
      AS $$
        SELECT
          current_user IN ('anon', 'authenticated')
          OR COALESCE(current_setting('request.jwt.claim.role', true), '') IN ('anon', 'authenticated');
      $$;
    `);

    const migration017Content = fs.readFileSync('supabase/migrations/017_order_workflow_rpc.sql', 'utf8');
    const rpcMatch = migration017Content.match(
      /CREATE OR REPLACE FUNCTION public\.commit_order_with_inventory[\s\S]*?END;\s*\$\$;/m
    );
    assert.ok(rpcMatch, 'commit_order_with_inventory must exist in migration 017');
    await adminClient.query(rpcMatch[0]);

    const bulkAvailMigrationSql = fs.readFileSync(
      'supabase/migrations/20261029000100_bulk_set_items_availability_atomic.sql',
      'utf8'
    );
    await adminClient.query(bulkAvailMigrationSql);

    let queryQueue = Promise.resolve();
    function safePgQuery(sql: string, params: unknown[]) {
      const next = queryQueue.then(() => adminClient.query(sql, params));
      queryQueue = next.then(
        () => {},
        () => {}
      );
      return next;
    }

    function normalizeRow(row: Record<string, unknown>) {
      const normalized = { ...row };
      for (const [k, v] of Object.entries(normalized)) {
        if (typeof v === 'string' && (v.startsWith('{') || v.startsWith('['))) {
          try {
            normalized[k] = JSON.parse(v);
          } catch {
            // keep string
          }
        }
      }
      return normalized;
    }

    let beforeUpdateHook:
      | ((
          tableName: string,
          updatePayload: Record<string, unknown>,
          filters: Array<{ col: string; val: unknown; op: string }>,
          orClauses: string[]
        ) => Promise<void> | void)
      | null = null;

    class PostgresQueryBuilder {
      tableName: string;
      filters: Array<{ col: string; val: unknown; op: string }> = [];
      orClauses: string[] = [];
      selectedCols = '*';
      selectOptions: { head?: boolean; count?: string } = {};
      orderClauses: Array<{ col: string; ascending: boolean }> = [];
      updatePayload: Record<string, unknown> | null = null;
      insertPayload: Record<string, unknown> | Array<Record<string, unknown>> | null = null;
      limitCount: number | null = null;
      singleMode: 'none' | 'single' | 'maybeSingle' = 'none';

      constructor(tableName: string) {
        this.tableName = tableName;
      }
      select(cols = '*', options: { head?: boolean; count?: string } = {}) {
        this.selectedCols = cols;
        this.selectOptions = options;
        return this;
      }
      order(col: string, options: { ascending?: boolean } = {}) {
        this.orderClauses.push({ col, ascending: options.ascending !== false });
        return this;
      }
      update(payload: Record<string, unknown>) {
        this.updatePayload = payload;
        return this;
      }
      insert(payload: Record<string, unknown> | Array<Record<string, unknown>>) {
        this.insertPayload = payload;
        return this;
      }
      upsert(payload: Record<string, unknown> | Array<Record<string, unknown>>) {
        this.insertPayload = payload;
        return this;
      }
      eq(col: string, val: unknown) {
        this.filters.push({ col, val, op: '=' });
        return this;
      }
      is(col: string, val: unknown) {
        this.filters.push({ col, val, op: '=' });
        return this;
      }
      in(col: string, vals: unknown[]) {
        this.filters.push({ col, val: vals, op: 'IN' });
        return this;
      }
      or(expr: string) {
        this.orClauses.push(expr);
        return this;
      }
      limit(n: number) {
        this.limitCount = n;
        return this;
      }
      single() {
        this.singleMode = 'single';
        return this.execute();
      }
      maybeSingle() {
        this.singleMode = 'maybeSingle';
        return this.execute();
      }
      then(
        resolve?: ((value: unknown) => unknown) | null,
        reject?: ((reason: unknown) => unknown) | null
      ) {
        return this.execute().then(resolve ?? undefined, reject ?? undefined);
      }
      async execute() {
        try {
          if (this.updatePayload && beforeUpdateHook) {
            await beforeUpdateHook(
              this.tableName,
              this.updatePayload,
              this.filters,
              this.orClauses
            );
          }

          const params: unknown[] = [];
          const conditions: string[] = [];
          for (const f of this.filters) {
            if (f.op === 'IN' && Array.isArray(f.val)) {
              params.push(f.val);
              conditions.push(`"${f.col}" = ANY($${params.length}::text[])`);
              continue;
            }
            if (f.val === null) {
              conditions.push(f.op === '=' ? `"${f.col}" IS NULL` : `"${f.col}" IS NOT NULL`);
              continue;
            }
            params.push(f.val);
            conditions.push(`"${f.col}" ${f.op} $${params.length}`);
          }
          for (const expr of this.orClauses) {
            if (expr === 'stock_quantity.is.null,stock_quantity.gt.0') {
              conditions.push(`("stock_quantity" IS NULL OR "stock_quantity" > 0)`);
            }
          }
          const whereClause =
            conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

          if (this.updatePayload) {
            const setClauses: string[] = [];
            for (const [k, v] of Object.entries(this.updatePayload)) {
              params.push(typeof v === 'object' && v !== null ? JSON.stringify(v) : v);
              setClauses.push(`"${k}" = $${params.length}`);
            }
            const sql = `UPDATE "${this.tableName}" SET ${setClauses.join(', ')}${whereClause} RETURNING *;`;
            const res = await safePgQuery(sql, params);
            const rows = res.rows.map(normalizeRow);
            if (this.singleMode === 'single') {
              if (rows.length === 0) {
                return { data: null, error: { message: 'Row not found', code: 'PGRST116' } };
              }
              return { data: rows[0], error: null };
            }
            if (this.singleMode === 'maybeSingle') return { data: rows[0] || null, error: null };
            return { data: rows, count: rows.length, error: null };
          }

          if (this.insertPayload) {
            const rowsToInsert = Array.isArray(this.insertPayload)
              ? this.insertPayload
              : [this.insertPayload];
            const cols = Object.keys(rowsToInsert[0]);
            const colNames = cols.map((c) => `"${c}"`).join(', ');
            const valClauses: string[] = [];
            for (const r of rowsToInsert) {
              const rowParams = cols.map((c) => {
                const val = r[c];
                params.push(typeof val === 'object' && val !== null ? JSON.stringify(val) : val);
                return `$${params.length}`;
              });
              valClauses.push(`(${rowParams.join(', ')})`);
            }
            const sql = `INSERT INTO "${this.tableName}" (${colNames}) VALUES ${valClauses.join(', ')} RETURNING *;`;
            const res = await safePgQuery(sql, params);
            const rows = res.rows.map(normalizeRow);
            if (this.singleMode === 'single') return { data: rows[0], error: null };
            if (this.singleMode === 'maybeSingle') return { data: rows[0] || null, error: null };
            return { data: rows, count: rows.length, error: null };
          }

          if (this.selectOptions?.head) {
            const countRes = await safePgQuery(
              `SELECT count(*)::int as count FROM "${this.tableName}"${whereClause};`,
              params
            );
            return { data: null, count: countRes.rows[0]?.count ?? 0, error: null };
          }

          const orderClause =
            this.orderClauses.length > 0
              ? ' ORDER BY ' +
                this.orderClauses
                  .map((o) => `"${o.col}" ${o.ascending ? 'ASC' : 'DESC'}`)
                  .join(', ')
              : '';
          const limitClause = this.limitCount ? ` LIMIT ${this.limitCount}` : '';
          const res = await safePgQuery(
            `SELECT * FROM "${this.tableName}"${whereClause}${orderClause}${limitClause};`,
            params
          );
          const rows = res.rows.map(normalizeRow);
          if (this.singleMode === 'single') return { data: rows[0], error: null };
          if (this.singleMode === 'maybeSingle') return { data: rows[0] || null, error: null };
          return { data: rows, count: rows.length, error: null };
        } catch (err) {
          const e = err as { message?: string; code?: string };
          return { data: null, error: { message: e.message || 'PG error', code: e.code || 'PG_ERR' } };
        }
      }
    }

    const pgAdapter = {
      from: (tableName: string) => new PostgresQueryBuilder(tableName),
      rpc: async (fnName: string, args: Record<string, unknown>) => {
        try {
          if (fnName === 'bulk_set_items_availability_atomic') {
            const res = await safePgQuery(
              `SELECT public.bulk_set_items_availability_atomic($1::text, $2::text[], $3::boolean) AS result;`,
              [
                args.p_shop_id ?? null,
                Array.isArray(args.p_item_ids) ? args.p_item_ids : null,
                typeof args.p_is_available === 'boolean'
                  ? args.p_is_available
                  : null,
              ]
            );
            return { data: res.rows[0]?.result ?? null, error: null };
          }
          throw new Error(`Unsupported RPC in pgAdapter: ${fnName}`);
        } catch (err) {
          const e = err as { message?: string; code?: string };
          return {
            data: null,
            error: {
              message: e.message || 'PG RPC error',
              code: e.code || 'PG_RPC_ERR',
            },
          };
        }
      },
    };
    setSupabaseDbClientForTests(pgAdapter);
    setShopMembershipDbClientForTest(pgAdapter as unknown as Parameters<typeof setShopMembershipDbClientForTest>[0]);
    setMposDbClientForTests(pgAdapter, true);

    const ownerId = '00000000-0000-4000-8000-000000000901';
    const shopId = 'shop-cat-race-001';
    const catId = 'cat-race-001';
    const tableId = 'tbl-race-001';

    await adminClient.query(
      `INSERT INTO profiles (id, email, role, plan) VALUES ($1, 'owner-race@isolated.local', 'owner', 'premium')`,
      [ownerId]
    );
    await adminClient.query(
      `INSERT INTO shops (id, owner_id, slug, name, vertical, is_published) VALUES ($1, $2, 'quan-test-race', 'Quán Test Race', 'fnb', true)`,
      [shopId, ownerId]
    );
    await adminClient.query(
      `INSERT INTO categories (id, shop_id, sort_order, name_i18n) VALUES ($1, $2, 1, '{"vi": "Đồ uống"}'::jsonb)`,
      [catId, shopId]
    );
    await adminClient.query(
      `INSERT INTO shop_tables (id, shop_id, table_code, name, is_active) VALUES ($1, $2, 'T01', 'Bàn 01', true)`,
      [tableId, shopId]
    );
    await adminClient.query(
      `INSERT INTO shop_memberships (id, shop_id, user_id, role, permissions, is_active)
       VALUES ('mem-race-owner', $1, $2, 'owner', ARRAY['catalog.manage', 'inventory.adjust'], true)`,
      [shopId, ownerId]
    );

    const ownerToken = issueSessionToken({
      id: ownerId,
      email: 'owner-race@isolated.local',
      role: 'owner',
      account_type: 'owner',
    });

    // Scenario 1: Stock edit conflict after interleaved order RPC + retry + unlimited (null) CAS + legacy client without expected_stock_quantity
    const item1Id = 'item-race-stock-1';
    await adminClient.query(
      `INSERT INTO items (id, shop_id, category_id, name_i18n, price, stock_quantity, sold_count, is_available)
       VALUES ($1, $2, $3, '{"vi": "Cà Phê Sữa Đá"}'::jsonb, 35000, 5, 0, true)`,
      [item1Id, shopId, catId]
    );

    const getRes1 = await catalogGet(
      new Request(`http://localhost:3000/api/catalog?shopId=${shopId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${ownerToken}` },
      })
    );
    const clientSnapshot1 = (await getRes1.json()).items.find((i: CatalogItem) => i.id === item1Id);

    // Order RPC deducts 2 (stock: 5 -> 3, sold: 0 -> 2)
    await orderRpcClient.query(`SELECT commit_order_with_inventory($1::jsonb, $2::jsonb)`, [
      JSON.stringify({
        id: 'ord-pg-1',
        order_code: 'ORD-PG-1',
        shop_id: shopId,
        table_id: tableId,
        table_label: 'Bàn 01',
        idempotency_key: 'idemp-pg-1',
        total_amount: 70000,
        subtotal_amount: 70000,
        payment_status: 'unpaid',
        status: 'new',
        items: [{ item_id: item1Id, quantity: 2, unit_price: 35000, extra_price: 0, name_vi: 'Cà Phê Sữa Đá' }],
      }),
      JSON.stringify([{ item_id: item1Id, delta: 2 }]),
    ]);

    // 1A. Stale stock edit (expected_stock_quantity: 5) -> must return 409 STOCK_CONFLICT and NOT overwrite DB
    const postStaleStock = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: item1Id,
            shop_id: shopId,
            category_id: catId,
            stock_quantity: 10,
            expected_stock_quantity: clientSnapshot1.stock_quantity,
          },
        }),
      })
    );
    assert.equal(postStaleStock.status, 409);
    assert.equal((await postStaleStock.json()).code, 'STOCK_CONFLICT');

    // 1B. Legacy narrow stock edit WITHOUT expected_stock_quantity -> must return 409 STOCK_CONFLICT and NOT overwrite DB
    const postLegacyNarrowStock = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: item1Id,
            shop_id: shopId,
            category_id: catId,
            stock_quantity: 10,
          },
        }),
      })
    );
    assert.equal(postLegacyNarrowStock.status, 409);
    assert.equal((await postLegacyNarrowStock.json()).code, 'STOCK_CONFLICT');

    // 1C. Legacy full-spread stock edit WITHOUT expected_stock_quantity -> must return 409 STOCK_CONFLICT and NOT overwrite DB
    const postLegacySpreadStock = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...clientSnapshot1,
            shop_id: shopId,
            stock_quantity: 10,
          },
        }),
      })
    );
    assert.equal(postLegacySpreadStock.status, 409);
    assert.equal((await postLegacySpreadStock.json()).code, 'STOCK_CONFLICT');

    // 1D. Legacy unlimited (null) stock edit WITHOUT expected_stock_quantity -> must return 409 STOCK_CONFLICT and NOT overwrite DB
    const postLegacyNullStock = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: item1Id,
            shop_id: shopId,
            category_id: catId,
            stock_quantity: null,
          },
        }),
      })
    );
    assert.equal(postLegacyNullStock.status, 409);
    assert.equal((await postLegacyNullStock.json()).code, 'STOCK_CONFLICT');

    // 1E. Legacy no-op full spread (echoing stale stock_quantity: 5 without changing catalog fields) -> must return 409 STOCK_CONFLICT
    const postLegacyNoopSpread = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...clientSnapshot1,
            shop_id: shopId,
          },
        }),
      })
    );
    assert.equal(postLegacyNoopSpread.status, 409);
    assert.equal((await postLegacyNoopSpread.json()).code, 'STOCK_CONFLICT');

    const { rows: rowsAfterConflict } = await adminClient.query(
      `SELECT stock_quantity, sold_count, is_available FROM items WHERE id = $1`,
      [item1Id]
    );
    assert.equal(rowsAfterConflict[0].stock_quantity, 3);
    assert.equal(rowsAfterConflict[0].sold_count, 2);

    // 1F. Client re-reads GET /api/catalog (sees stock_quantity = 3) and retries with expected_stock_quantity: 3 -> succeeds
    const getRes1Refresh = await catalogGet(
      new Request(`http://localhost:3000/api/catalog?shopId=${shopId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${ownerToken}` },
      })
    );
    const refreshedSnapshot1 = (await getRes1Refresh.json()).items.find((i: CatalogItem) => i.id === item1Id);
    assert.equal(refreshedSnapshot1.stock_quantity, 3);

    const postFreshStock = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: item1Id,
            shop_id: shopId,
            category_id: catId,
            stock_quantity: 10,
            expected_stock_quantity: refreshedSnapshot1.stock_quantity,
          },
        }),
      })
    );
    assert.equal(postFreshStock.status, 200);

    // 1G. Transition 10 -> null (unlimited) with expected_stock_quantity: 10, then null -> 6 with expected_stock_quantity: null
    const postToNull = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: item1Id,
            shop_id: shopId,
            category_id: catId,
            stock_quantity: null,
            expected_stock_quantity: 10,
          },
        }),
      })
    );
    assert.equal(postToNull.status, 200);
    const { rows: rowsUnlimited } = await adminClient.query(
      `SELECT stock_quantity, sold_count FROM items WHERE id = $1`,
      [item1Id]
    );
    assert.equal(rowsUnlimited[0].stock_quantity, null);
    assert.equal(rowsUnlimited[0].sold_count, 2);

    const postFromNullToSix = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: item1Id,
            shop_id: shopId,
            category_id: catId,
            stock_quantity: 6,
            expected_stock_quantity: null,
          },
        }),
      })
    );
    assert.equal(postFromNullToSix.status, 200);

    // Stale attempt with expected_stock_quantity: null when DB is now 6 must fail with 409 STOCK_CONFLICT
    const postStaleNullExpectation = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: item1Id,
            shop_id: shopId,
            category_id: catId,
            stock_quantity: 4,
            expected_stock_quantity: null,
          },
        }),
      })
    );
    assert.equal(postStaleNullExpectation.status, 409);
    assert.equal((await postStaleNullExpectation.json()).code, 'STOCK_CONFLICT');

    // Scenario 2: 2 orders drain stock (5 -> 3 -> 0), then stale price edit (both narrow and spread) preserves stock=0, sold=5, is_available=false
    const item2Id = 'item-race-price-2';
    await adminClient.query(
      `INSERT INTO items (id, shop_id, category_id, name_i18n, price, stock_quantity, sold_count, is_available)
       VALUES ($1, $2, $3, '{"vi": "Trà Đào Cam Sả"}'::jsonb, 40000, 5, 0, true)`,
      [item2Id, shopId, catId]
    );

    const getRes2 = await catalogGet(
      new Request(`http://localhost:3000/api/catalog?shopId=${shopId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${ownerToken}` },
      })
    );
    const clientSnapshot2 = (await getRes2.json()).items.find((i: CatalogItem) => i.id === item2Id);

    // Order #1 buys 2, Order #2 buys 3 -> stock=0, sold=5, is_available=false
    await orderRpcClient.query(`SELECT commit_order_with_inventory($1::jsonb, $2::jsonb)`, [
      JSON.stringify({
        id: 'ord-pg-2a',
        order_code: 'ORD-PG-2A',
        shop_id: shopId,
        table_id: tableId,
        table_label: 'Bàn 01',
        idempotency_key: 'idemp-pg-2a',
        total_amount: 80000,
        subtotal_amount: 80000,
        payment_status: 'unpaid',
        status: 'new',
        items: [{ item_id: item2Id, quantity: 2, unit_price: 40000, extra_price: 0, name_vi: 'Trà Đào Cam Sả' }],
      }),
      JSON.stringify([{ item_id: item2Id, delta: 2 }]),
    ]);
    await orderRpcClient.query(`SELECT commit_order_with_inventory($1::jsonb, $2::jsonb)`, [
      JSON.stringify({
        id: 'ord-pg-2b',
        order_code: 'ORD-PG-2B',
        shop_id: shopId,
        table_id: tableId,
        table_label: 'Bàn 01',
        idempotency_key: 'idemp-pg-2b',
        total_amount: 120000,
        subtotal_amount: 120000,
        payment_status: 'unpaid',
        status: 'new',
        items: [{ item_id: item2Id, quantity: 3, unit_price: 40000, extra_price: 0, name_vi: 'Trà Đào Cam Sả' }],
      }),
      JSON.stringify([{ item_id: item2Id, delta: 3 }]),
    ]);

    // 2A. Narrow price edit ({ id, shop_id, category_id, price: 43000 })
    const postNarrowPriceRes = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: item2Id,
            shop_id: shopId,
            category_id: catId,
            price: 43000,
          },
        }),
      })
    );
    assert.equal(postNarrowPriceRes.status, 200);

    // 2B. Legacy stale spread price edit ({ ...clientSnapshot2, price: 45000 })
    const postPriceRes = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...clientSnapshot2,
            shop_id: shopId,
            price: 45000,
          },
        }),
      })
    );
    assert.equal(postPriceRes.status, 200);

    // 2C. Ambiguous legacy payload trying to change BOTH price and stock_quantity without expected_stock_quantity -> rejected with 409
    const postAmbiguousPriceAndStock = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...clientSnapshot2,
            shop_id: shopId,
            price: 49000,
            stock_quantity: 12,
          },
        }),
      })
    );
    assert.equal(postAmbiguousPriceAndStock.status, 409);
    assert.equal((await postAmbiguousPriceAndStock.json()).code, 'STOCK_CONFLICT');

    const { rows: rowsAfterPriceEdit } = await adminClient.query(
      `SELECT stock_quantity, sold_count, is_available, price::int AS price FROM items WHERE id = $1`,
      [item2Id]
    );
    assert.equal(rowsAfterPriceEdit[0].price, 45000);
    assert.equal(rowsAfterPriceEdit[0].stock_quantity, 0);
    assert.equal(rowsAfterPriceEdit[0].sold_count, 5);
    assert.equal(rowsAfterPriceEdit[0].is_available, false);

    // Scenario 3: Bulk (Excel import + bulk price bar + legacy bulk without expected_stock_quantity + null stock)
    const itemBulkPriceId = 'item-race-bulk-price-3';
    const itemBulkStockId = 'item-race-bulk-stock-4';
    await adminClient.query(
      `INSERT INTO items (id, shop_id, category_id, name_i18n, price, stock_quantity, sold_count, is_available)
       VALUES
         ($1, $3, $4, '{"vi": "Bạc Xỉu Đá"}'::jsonb, 30000, 5, 1, true),
         ($2, $3, $4, '{"vi": "Bánh Sừng Bò"}'::jsonb, 25000, 8, 4, true)`,
      [itemBulkPriceId, itemBulkStockId, shopId, catId]
    );

    const getResBulk = await catalogGet(
      new Request(`http://localhost:3000/api/catalog?shopId=${shopId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${ownerToken}` },
      })
    );
    const bulkExportItems = (await getResBulk.json()).items.filter((i: CatalogItem) =>
      [itemBulkPriceId, itemBulkStockId].includes(i.id)
    );

    const excelBytes = await buildCatalogXlsxWorkbook(bulkExportItems, [
      { id: catId, shop_id: shopId, name_i18n: { vi: 'Đồ uống' }, sort_order: 1, is_active: true },
    ]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Uint8Array.from(excelBytes).buffer);
    const ws = wb.getWorksheet('ThucDon')!;
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const idVal = String(row.getCell(1).value || '').trim();
      if (idVal === itemBulkPriceId) {
        row.getCell(5).value = 36000; // price-only edit in Excel
      } else if (idVal === itemBulkStockId) {
        row.getCell(6).value = 20; // stock edit in Excel
      }
    }
    const editedExcelBuf = await wb.xlsx.writeBuffer();
    const excelValidation = await parseAndValidateCatalogExcel(
      new Uint8Array(editedExcelBuf),
      bulkExportItems
    );
    const excelBulkPayload = buildCatalogExcelBulkUpdateItems(excelValidation.validRows);

    // Concurrent orders deduct stock on BOTH items before Excel import is applied:
    // itemBulkPriceId: stock 5 -> 2, sold 1 -> 4
    // itemBulkStockId: stock 8 -> 5, sold 4 -> 7
    await orderRpcClient.query(`SELECT commit_order_with_inventory($1::jsonb, $2::jsonb)`, [
      JSON.stringify({
        id: 'ord-pg-3',
        order_code: 'ORD-PG-3',
        shop_id: shopId,
        table_id: tableId,
        table_label: 'Bàn 01',
        idempotency_key: 'idemp-pg-3',
        total_amount: 165000,
        subtotal_amount: 165000,
        payment_status: 'unpaid',
        status: 'new',
        items: [
          { item_id: itemBulkPriceId, quantity: 3, unit_price: 30000, extra_price: 0, name_vi: 'Bạc Xỉu Đá' },
          { item_id: itemBulkStockId, quantity: 3, unit_price: 25000, extra_price: 0, name_vi: 'Bánh Sừng Bò' },
        ],
      }),
      JSON.stringify([
        { item_id: itemBulkPriceId, delta: 3 },
        { item_id: itemBulkStockId, delta: 3 },
      ]),
    ]);

    // 3A. Apply Excel bulk update: price-only row succeeds (preserving stock=2, sold=4); stock-edited row fails with STOCK_CONFLICT (preserving stock=5, sold=7)
    const resExcelBulk = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
          action: 'bulk_update_price_stock',
          shopId,
          items: excelBulkPayload,
        }),
      })
    );
    assert.equal(resExcelBulk.status, 200);
    const bodyExcelBulk = await resExcelBulk.json();
    assert.equal(bodyExcelBulk.success, false);
    assert.equal(bodyExcelBulk.code, 'STOCK_CONFLICT');
    assert.equal(bodyExcelBulk.updatedCount, 1);

    const { rows: rowsBulkPrice } = await adminClient.query(
      `SELECT price::int AS price, stock_quantity, sold_count FROM items WHERE id = $1`,
      [itemBulkPriceId]
    );
    assert.equal(rowsBulkPrice[0].price, 36000);
    assert.equal(rowsBulkPrice[0].stock_quantity, 2);
    assert.equal(rowsBulkPrice[0].sold_count, 4);

    const { rows: rowsBulkStock } = await adminClient.query(
      `SELECT price::int AS price, stock_quantity, sold_count FROM items WHERE id = $1`,
      [itemBulkStockId]
    );
    assert.equal(rowsBulkStock[0].price, 25000);
    assert.equal(rowsBulkStock[0].stock_quantity, 5);
    assert.equal(rowsBulkStock[0].sold_count, 7);

    // 3B. Legacy bulk_update_price_stock payloads without expected_stock_quantity (finite, mixed price+stock, and null unlimited) must all be rejected with 409 STOCK_CONFLICT
    const resLegacyBulkMissingSnapshot = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
          action: 'bulk_update_price_stock',
          shopId,
          items: [
            { id: itemBulkPriceId, price: 39000, stock_quantity: 5 },
            { id: itemBulkStockId, stock_quantity: null },
          ],
        }),
      })
    );
    assert.equal(resLegacyBulkMissingSnapshot.status, 409);
    const bodyLegacyMissing = await resLegacyBulkMissingSnapshot.json();
    assert.equal(bodyLegacyMissing.success, false);
    assert.equal(bodyLegacyMissing.code, 'STOCK_CONFLICT');
    assert.equal(bodyLegacyMissing.updatedCount, 0);

    const { rows: rowsAfterLegacyBulk } = await adminClient.query(
      `SELECT id, price::int AS price, stock_quantity, sold_count FROM items WHERE id = ANY($1::text[]) ORDER BY id`,
      [[itemBulkPriceId, itemBulkStockId]]
    );
    assert.equal(rowsAfterLegacyBulk[0].price, 36000);
    assert.equal(rowsAfterLegacyBulk[0].stock_quantity, 2);
    assert.equal(rowsAfterLegacyBulk[0].sold_count, 4);
    assert.equal(rowsAfterLegacyBulk[1].price, 25000);
    assert.equal(rowsAfterLegacyBulk[1].stock_quantity, 5);
    assert.equal(rowsAfterLegacyBulk[1].sold_count, 7);

    // Scenario 4: Single-item availability toggle (is_available=true) racing with concurrent order draining stock to 0 after pre-read and before UPDATE
    const invStaffId = '00000000-0000-4000-8000-000000000902';
    const catCashierId = '00000000-0000-4000-8000-000000000903';
    const viewStaffId = '00000000-0000-4000-8000-000000000904';
    await adminClient.query(
      `INSERT INTO shop_memberships (id, shop_id, user_id, role, permissions, is_active)
       VALUES
         ('mem-race-inv-staff', $1, $2, 'staff', ARRAY['inventory.adjust'], true),
         ('mem-race-cat-cashier', $1, $3, 'cashier', ARRAY['catalog.manage'], true),
         ('mem-race-view-staff', $1, $4, 'staff', ARRAY['catalog.view'], true)`,
      [shopId, invStaffId, catCashierId, viewStaffId]
    );
    const invStaffToken = issueSessionToken({
      id: invStaffId,
      email: 'inv-staff@isolated.local',
      role: 'staff',
    });
    const catCashierToken = issueSessionToken({
      id: catCashierId,
      email: 'cat-cashier@isolated.local',
      role: 'cashier',
    });
    const viewStaffToken = issueSessionToken({
      id: viewStaffId,
      email: 'view-staff@isolated.local',
      role: 'staff',
    });

    const itemAvailRaceZeroId = 'item-race-avail-zero-5';
    await adminClient.query(
      `INSERT INTO items (id, shop_id, category_id, name_i18n, price, stock_quantity, sold_count, is_available)
       VALUES ($1, $2, $3, '{"vi": "Bánh Mì Chảo"}'::jsonb, 45000, 1, 0, true)`,
      [itemAvailRaceZeroId, shopId, catId]
    );

    // 4A. Narrow Web/Mobile availability toggle (is_available: true) races with concurrent order draining stock 1 -> 0 after pre-read and before UPDATE
    let observedNonZeroPredicateOnSingle = false;
    let singleRaceHookFired = false;
    beforeUpdateHook = async (tableName, updatePayload, _filters, orClauses) => {
      if (
        tableName === 'items' &&
        !singleRaceHookFired &&
        updatePayload.is_available === true
      ) {
        singleRaceHookFired = true;
        observedNonZeroPredicateOnSingle = orClauses.includes(
          'stock_quantity.is.null,stock_quantity.gt.0'
        );
        await orderRpcClient.query(
          `SELECT commit_order_with_inventory($1::jsonb, $2::jsonb)`,
          [
            JSON.stringify({
              id: 'ord-pg-4a',
              order_code: 'ORD-PG-4A',
              shop_id: shopId,
              table_id: tableId,
              table_label: 'Bàn 01',
              idempotency_key: 'idemp-pg-4a',
              total_amount: 45000,
              subtotal_amount: 45000,
              payment_status: 'unpaid',
              status: 'new',
              items: [
                {
                  item_id: itemAvailRaceZeroId,
                  quantity: 1,
                  unit_price: 45000,
                  extra_price: 0,
                  name_vi: 'Bánh Mì Chảo',
                },
              ],
            }),
            JSON.stringify([{ item_id: itemAvailRaceZeroId, delta: 1 }]),
          ]
        );
      }
    };

    const resSingleAvailRace = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: itemAvailRaceZeroId,
            shop_id: shopId,
            category_id: catId,
            is_available: true,
          },
        }),
      })
    );
    beforeUpdateHook = null;

    assert.equal(singleRaceHookFired, true, 'Mid-handler order race hook must fire before UPDATE');
    assert.equal(
      observedNonZeroPredicateOnSingle,
      true,
      'dbUpsertItem UPDATE must include atomic stock_quantity.is.null,stock_quantity.gt.0 predicate'
    );
    assert.equal(resSingleAvailRace.status, 200);
    const bodySingleAvailRace = await resSingleAvailRace.json();
    assert.equal(
      bodySingleAvailRace.item.stock_quantity,
      0,
      'Returned item must reflect stock_quantity = 0'
    );
    assert.equal(
      bodySingleAvailRace.item.sold_count,
      1,
      'Returned item must reflect sold_count = 1 from concurrent order'
    );
    assert.equal(
      bodySingleAvailRace.item.is_available,
      false,
      'Returned item must keep is_available = false when concurrent order drained stock to 0'
    );

    const { rows: rowsSingleAvailRace } = await adminClient.query(
      `SELECT stock_quantity, sold_count, is_available FROM items WHERE id = $1`,
      [itemAvailRaceZeroId]
    );
    assert.equal(rowsSingleAvailRace[0].stock_quantity, 0);
    assert.equal(rowsSingleAvailRace[0].sold_count, 1);
    assert.equal(rowsSingleAvailRace[0].is_available, false);

    // 4B. Legacy spread availability toggle + price edit with is_available=true racing with order draining stock 1 -> 0 after pre-read
    await adminClient.query(
      `UPDATE items SET stock_quantity = 1, is_available = false WHERE id = $1`,
      [itemAvailRaceZeroId]
    );
    const getLegacySnapRes = await catalogGet(
      new Request(`http://localhost:3000/api/catalog?shopId=${shopId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${ownerToken}` },
      })
    );
    const legacySnap = (await getLegacySnapRes.json()).items.find(
      (i: CatalogItem) => i.id === itemAvailRaceZeroId
    );
    assert.equal(legacySnap.stock_quantity, 1);
    assert.equal(legacySnap.is_available, false);

    let legacyRaceHookFired = false;
    beforeUpdateHook = async (tableName, updatePayload) => {
      if (
        tableName === 'items' &&
        !legacyRaceHookFired &&
        updatePayload.is_available === true
      ) {
        legacyRaceHookFired = true;
        // Another staff member re-enabled and a customer order immediately bought the last unit on connection #2
        await orderRpcClient.query(
          `UPDATE items SET is_available = true WHERE id = $1`,
          [itemAvailRaceZeroId]
        );
        await orderRpcClient.query(
          `SELECT commit_order_with_inventory($1::jsonb, $2::jsonb)`,
          [
            JSON.stringify({
              id: 'ord-pg-4b',
              order_code: 'ORD-PG-4B',
              shop_id: shopId,
              table_id: tableId,
              table_label: 'Bàn 01',
              idempotency_key: 'idemp-pg-4b',
              total_amount: 45000,
              subtotal_amount: 45000,
              payment_status: 'unpaid',
              status: 'new',
              items: [
                {
                  item_id: itemAvailRaceZeroId,
                  quantity: 1,
                  unit_price: 45000,
                  extra_price: 0,
                  name_vi: 'Bánh Mì Chảo',
                },
              ],
            }),
            JSON.stringify([{ item_id: itemAvailRaceZeroId, delta: 1 }]),
          ]
        );
      }
    };

    // 1) Ambiguous full snapshot without expected_is_available must be rejected early with 409 STOCK_CONFLICT
    // without firing the database update hook
    const resNoBaselineLegacyRace = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${invStaffToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...legacySnap,
            shop_id: shopId,
            is_available: true,
          },
        }),
      })
    );
    assert.equal(resNoBaselineLegacyRace.status, 409);
    assert.equal(
      (await resNoBaselineLegacyRace.json()).code,
      'STOCK_CONFLICT'
    );
    assert.equal(
      legacyRaceHookFired,
      false,
      'Guard must reject ambiguous snapshot before reaching DB update hook'
    );

    // 2) Legitimate narrow availability toggle reaches DB update, fires race hook,
    // and tests dbUpsertItem zero-stock fallback when concurrent order drains stock to 0
    const resLegacySpreadAvailRace = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${invStaffToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: itemAvailRaceZeroId,
            shop_id: shopId,
            category_id: legacySnap.category_id,
            is_available: true,
          },
        }),
      })
    );
    beforeUpdateHook = null;

    assert.equal(legacyRaceHookFired, true);
    assert.equal(resLegacySpreadAvailRace.status, 200);
    const bodyLegacySpreadAvailRace = await resLegacySpreadAvailRace.json();
    assert.equal(bodyLegacySpreadAvailRace.item.stock_quantity, 0);
    assert.equal(bodyLegacySpreadAvailRace.item.sold_count, 2);
    assert.equal(bodyLegacySpreadAvailRace.item.is_available, false);

    // Non-stock edit (price: 49000) + is_available: true when order drains stock 1 -> 0 after pre-read saves price=49000 while keeping is_available=false
    await adminClient.query(
      `UPDATE items SET stock_quantity = 1, is_available = true WHERE id = $1`,
      [itemAvailRaceZeroId]
    );
    let priceAndAvailRaceHookFired = false;
    beforeUpdateHook = async (tableName, updatePayload) => {
      if (
        tableName === 'items' &&
        !priceAndAvailRaceHookFired &&
        updatePayload.is_available === true
      ) {
        priceAndAvailRaceHookFired = true;
        await orderRpcClient.query(
          `SELECT commit_order_with_inventory($1::jsonb, $2::jsonb)`,
          [
            JSON.stringify({
              id: 'ord-pg-4b2',
              order_code: 'ORD-PG-4B2',
              shop_id: shopId,
              table_id: tableId,
              table_label: 'Bàn 01',
              idempotency_key: 'idemp-pg-4b2',
              total_amount: 45000,
              subtotal_amount: 45000,
              payment_status: 'unpaid',
              status: 'new',
              items: [
                {
                  item_id: itemAvailRaceZeroId,
                  quantity: 1,
                  unit_price: 45000,
                  extra_price: 0,
                  name_vi: 'Bánh Mì Chảo',
                },
              ],
            }),
            JSON.stringify([{ item_id: itemAvailRaceZeroId, delta: 1 }]),
          ]
        );
      }
    };

    const resPriceAndAvailRace = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${catCashierToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: itemAvailRaceZeroId,
            shop_id: shopId,
            category_id: catId,
            price: 49000,
            is_available: true,
          },
        }),
      })
    );
    beforeUpdateHook = null;

    assert.equal(priceAndAvailRaceHookFired, true);
    assert.equal(resPriceAndAvailRace.status, 200);
    const bodyPriceAndAvailRace = await resPriceAndAvailRace.json();
    assert.equal(bodyPriceAndAvailRace.item.price, 49000);
    assert.equal(bodyPriceAndAvailRace.item.stock_quantity, 0);
    assert.equal(bodyPriceAndAvailRace.item.sold_count, 3);
    assert.equal(bodyPriceAndAvailRace.item.is_available, false);

    // 4C. Positive stock (5 -> 2 > 0 during race) and unlimited stock (null) preserve valid availability toggles
    const itemPositiveRaceId = 'item-race-avail-pos-6';
    const itemUnlimitedRaceId = 'item-race-avail-null-7';
    await adminClient.query(
      `INSERT INTO items (id, shop_id, category_id, name_i18n, price, stock_quantity, sold_count, is_available)
       VALUES
         ($1, $3, $4, '{"vi": "Phở Gà Ta"}'::jsonb, 50000, 5, 0, false),
         ($2, $3, $4, '{"vi": "Trà Đá Miễn Phí"}'::jsonb, 5000, NULL, 0, false)`,
      [itemPositiveRaceId, itemUnlimitedRaceId, shopId, catId]
    );

    let posRaceHookFired = false;
    beforeUpdateHook = async (tableName, updatePayload) => {
      if (
        tableName === 'items' &&
        !posRaceHookFired &&
        updatePayload.is_available === true
      ) {
        posRaceHookFired = true;
        await orderRpcClient.query(
          `UPDATE items SET is_available = true WHERE id = $1`,
          [itemPositiveRaceId]
        );
        await orderRpcClient.query(
          `SELECT commit_order_with_inventory($1::jsonb, $2::jsonb)`,
          [
            JSON.stringify({
              id: 'ord-pg-4c',
              order_code: 'ORD-PG-4C',
              shop_id: shopId,
              table_id: tableId,
              table_label: 'Bàn 01',
              idempotency_key: 'idemp-pg-4c',
              total_amount: 150000,
              subtotal_amount: 150000,
              payment_status: 'unpaid',
              status: 'new',
              items: [
                {
                  item_id: itemPositiveRaceId,
                  quantity: 3,
                  unit_price: 50000,
                  extra_price: 0,
                  name_vi: 'Phở Gà Ta',
                },
              ],
            }),
            JSON.stringify([{ item_id: itemPositiveRaceId, delta: 3 }]),
          ]
        );
      }
    };

    const resPosAvailRace = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${invStaffToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: itemPositiveRaceId,
            shop_id: shopId,
            category_id: catId,
            is_available: true,
          },
        }),
      })
    );
    beforeUpdateHook = null;

    assert.equal(posRaceHookFired, true);
    assert.equal(resPosAvailRace.status, 200);
    const bodyPosAvailRace = await resPosAvailRace.json();
    assert.equal(bodyPosAvailRace.item.is_available, true);
    assert.equal(bodyPosAvailRace.item.stock_quantity, 2);
    assert.equal(bodyPosAvailRace.item.sold_count, 3);

    // Unlimited (null) stock toggle false -> true with concurrent order incrementing sold_count -> stays null & becomes true
    let nullRaceHookFired = false;
    beforeUpdateHook = async (tableName, updatePayload) => {
      if (
        tableName === 'items' &&
        !nullRaceHookFired &&
        updatePayload.is_available === true
      ) {
        nullRaceHookFired = true;
        await orderRpcClient.query(
          `UPDATE items SET is_available = true WHERE id = $1`,
          [itemUnlimitedRaceId]
        );
        await orderRpcClient.query(
          `SELECT commit_order_with_inventory($1::jsonb, $2::jsonb)`,
          [
            JSON.stringify({
              id: 'ord-pg-4d',
              order_code: 'ORD-PG-4D',
              shop_id: shopId,
              table_id: tableId,
              table_label: 'Bàn 01',
              idempotency_key: 'idemp-pg-4d',
              total_amount: 20000,
              subtotal_amount: 20000,
              payment_status: 'unpaid',
              status: 'new',
              items: [
                {
                  item_id: itemUnlimitedRaceId,
                  quantity: 4,
                  unit_price: 5000,
                  extra_price: 0,
                  name_vi: 'Trà Đá Miễn Phí',
                },
              ],
            }),
            JSON.stringify([{ item_id: itemUnlimitedRaceId, delta: 4 }]),
          ]
        );
      }
    };

    const resNullAvailRace = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: itemUnlimitedRaceId,
            shop_id: shopId,
            category_id: catId,
            is_available: true,
          },
        }),
      })
    );
    beforeUpdateHook = null;

    assert.equal(nullRaceHookFired, true);
    assert.equal(resNullAvailRace.status, 200);
    const bodyNullAvailRace = await resNullAvailRace.json();
    assert.equal(bodyNullAvailRace.item.is_available, true);
    assert.equal(bodyNullAvailRace.item.stock_quantity, null);
    assert.equal(bodyNullAvailRace.item.sold_count, 4);

    // View-only staff is forbidden (403) from toggling availability
    const resViewStaffForbidden = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${viewStaffToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: itemUnlimitedRaceId,
            shop_id: shopId,
            category_id: catId,
            is_available: false,
          },
        }),
      })
    );
    assert.equal(resViewStaffForbidden.status, 403);
    assert.equal(
      (await resViewStaffForbidden.json()).code,
      'INSUFFICIENT_SHOP_PERMISSION'
    );

    // Scenario 5: bulk_update_availability & bulk_set_availability real 2-connection PostgreSQL concurrency via bulk_set_items_availability_atomic
    const itemBulkRaceZeroId = 'item-race-bulk-avail-zero-8';
    await adminClient.query(
      `INSERT INTO items (id, shop_id, category_id, name_i18n, price, stock_quantity, sold_count, is_available)
       VALUES ($1, $2, $3, '{"vi": "Sữa Chua Nếp Cẩm"}'::jsonb, 32000, 1, 0, false)`,
      [itemBulkRaceZeroId, shopId, catId]
    );
    await adminClient.query(
      `UPDATE items SET is_available = false WHERE id = ANY($1::text[])`,
      [[itemPositiveRaceId, itemUnlimitedRaceId, itemBulkRaceZeroId]]
    );

    // 5A. Connection 2 opens a transaction, concurrently flips itemPositiveRaceId to is_available = true,
    // and commits an order draining itemBulkRaceZeroId from stock 1 -> 0 (is_available = false).
    // While Connection 2 holds uncommitted row locks, Connection 1 invokes bulk_update_availability(is_available = true)
    // on [itemUnlimitedRaceId, itemPositiveRaceId, itemBulkRaceZeroId], blocking on FOR UPDATE in PostgreSQL.
    // Once Connection 2 commits, Connection 1 unblocks, rejects the batch all-or-nothing with 409 ZERO_STOCK_CANNOT_MARK_AVAILABLE,
    // leaves itemUnlimitedRaceId as false, and NEVER overwrites Connection 2's itemPositiveRaceId = true!
    await orderRpcClient.query('BEGIN');
    await orderRpcClient.query(
      `UPDATE items SET is_available = true WHERE id = $1`,
      [itemPositiveRaceId]
    );
    await orderRpcClient.query(
      `UPDATE items SET is_available = true WHERE id = $1`,
      [itemBulkRaceZeroId]
    );
    await orderRpcClient.query(
      `SELECT commit_order_with_inventory($1::jsonb, $2::jsonb)`,
      [
        JSON.stringify({
          id: 'ord-pg-5a',
          order_code: 'ORD-PG-5A',
          shop_id: shopId,
          table_id: tableId,
          table_label: 'Bàn 01',
          idempotency_key: 'idemp-pg-5a',
          total_amount: 32000,
          subtotal_amount: 32000,
          payment_status: 'unpaid',
          status: 'new',
          items: [
            {
              item_id: itemBulkRaceZeroId,
              quantity: 1,
              unit_price: 32000,
              extra_price: 0,
              name_vi: 'Sữa Chua Nếp Cẩm',
            },
          ],
        }),
        JSON.stringify([{ item_id: itemBulkRaceZeroId, delta: 1 }]),
      ]
    );

    const pendingBulkAvailPromise = catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_update_availability',
          shopId,
          itemIds: [
            itemUnlimitedRaceId,
            itemPositiveRaceId,
            itemBulkRaceZeroId,
          ],
          is_available: true,
        }),
      })
    );

    // Wait on Connection 2 until Connection 1's RPC is blocked on the PostgreSQL row lock
    let observedPgLockWait = false;
    for (let poll = 0; poll < 50; poll++) {
      const { rows: lockRows } = await orderRpcClient.query(
        `SELECT count(*)::int AS waiting
         FROM pg_stat_activity
         WHERE wait_event_type = 'Lock'
           AND query LIKE '%bulk_set_items_availability_atomic%'`
      );
      if ((lockRows[0]?.waiting ?? 0) > 0) {
        observedPgLockWait = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(
      observedPgLockWait,
      true,
      'Connection 1 bulk_set_items_availability_atomic must block on PostgreSQL FOR UPDATE lock held by Connection 2'
    );

    await orderRpcClient.query('COMMIT');

    const resBulkAvailRace = await pendingBulkAvailPromise;
    assert.equal(resBulkAvailRace.status, 409);
    const bodyBulkAvailRace = await resBulkAvailRace.json();
    assert.equal(bodyBulkAvailRace.success, false);
    assert.equal(bodyBulkAvailRace.code, 'ZERO_STOCK_CANNOT_MARK_AVAILABLE');
    assert.equal(bodyBulkAvailRace.updatedCount, 0);
    assert.equal(bodyBulkAvailRace.count, 0);
    assert.deepEqual(bodyBulkAvailRace.zeroStockItemIds, [itemBulkRaceZeroId]);

    // Verify all-or-nothing AND that Connection 2's concurrent update on itemPositiveRaceId (is_available = true) was NOT clobbered!
    // Alphabetical ORDER BY id: 'item-race-avail-null-7' < 'item-race-avail-pos-6' < 'item-race-bulk-avail-zero-8'
    const { rows: rowsAfterBulkRace } = await adminClient.query(
      `SELECT id, stock_quantity, sold_count, is_available FROM items WHERE id = ANY($1::text[]) ORDER BY id`,
      [[itemBulkRaceZeroId, itemPositiveRaceId, itemUnlimitedRaceId]]
    );
    assert.equal(rowsAfterBulkRace[0].id, itemUnlimitedRaceId);
    assert.equal(rowsAfterBulkRace[0].stock_quantity, null);
    assert.equal(
      rowsAfterBulkRace[0].is_available,
      false,
      'Unlimited item in rejected batch must remain false (all-or-nothing)'
    );
    assert.equal(rowsAfterBulkRace[1].id, itemPositiveRaceId);
    assert.equal(rowsAfterBulkRace[1].stock_quantity, 2);
    assert.equal(
      rowsAfterBulkRace[1].is_available,
      true,
      'Concurrent update on itemPositiveRaceId by Connection 2 must NOT be overwritten to false'
    );
    assert.equal(rowsAfterBulkRace[2].id, itemBulkRaceZeroId);
    assert.equal(rowsAfterBulkRace[2].stock_quantity, 0);
    assert.equal(rowsAfterBulkRace[2].sold_count, 1);
    assert.equal(rowsAfterBulkRace[2].is_available, false);

    // 5B. DB trigger failure mid-batch inside bulk_set_items_availability_atomic rolls back all rows and returns 500 DB_UPDATE_FAILED
    await adminClient.query(
      `UPDATE items SET is_available = false WHERE id = ANY($1::text[])`,
      [[itemUnlimitedRaceId, itemPositiveRaceId]]
    );
    await adminClient.query(`
      CREATE OR REPLACE FUNCTION public.test_fail_on_second_bulk_item()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.id = '${itemPositiveRaceId}' AND NEW.is_available = TRUE THEN
          RAISE EXCEPTION 'Simulated mid-batch DB failure on ${itemPositiveRaceId}';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER trg_test_fail_on_second_bulk_item
      BEFORE UPDATE ON public.items
      FOR EACH ROW
      EXECUTE FUNCTION public.test_fail_on_second_bulk_item();
    `);

    const resBulkTriggerFail = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_update_availability',
          shopId,
          itemIds: [itemUnlimitedRaceId, itemPositiveRaceId],
          is_available: true,
        }),
      })
    );
    assert.equal(resBulkTriggerFail.status, 500);
    const bodyBulkTriggerFail = await resBulkTriggerFail.json();
    assert.equal(bodyBulkTriggerFail.success, false);
    assert.equal(bodyBulkTriggerFail.code, 'DB_UPDATE_FAILED');
    assert.equal(bodyBulkTriggerFail.updatedCount, 0);
    assert.equal(bodyBulkTriggerFail.count, 0);

    await adminClient.query(`
      DROP TRIGGER IF EXISTS trg_test_fail_on_second_bulk_item ON public.items;
      DROP FUNCTION IF EXISTS public.test_fail_on_second_bulk_item();
    `);

    const { rows: rowsAfterTriggerFail } = await adminClient.query(
      `SELECT id, is_available FROM items WHERE id = ANY($1::text[]) ORDER BY id`,
      [[itemUnlimitedRaceId, itemPositiveRaceId]]
    );
    assert.equal(rowsAfterTriggerFail[0].id, itemUnlimitedRaceId);
    assert.equal(
      rowsAfterTriggerFail[0].is_available,
      false,
      'First item in batch must roll back to false when second item fails in RPC transaction'
    );
    assert.equal(rowsAfterTriggerFail[1].id, itemPositiveRaceId);
    assert.equal(rowsAfterTriggerFail[1].is_available, false);

    // 5C. Cross-shop item in batch rejected atomically with 400 ITEM_NOT_IN_SHOP
    const otherShopId = 'shop-cat-race-002';
    const otherCatId = 'cat-race-002';
    const otherShopItemId = 'item-other-shop-9';
    await adminClient.query(
      `INSERT INTO shops (id, owner_id, slug, name, vertical, is_published) VALUES ($1, $2, 'quan-other-race', 'Quán Khác', 'fnb', true)`,
      [otherShopId, ownerId]
    );
    await adminClient.query(
      `INSERT INTO categories (id, shop_id, sort_order, name_i18n) VALUES ($1, $2, 1, '{"vi": "Khác"}'::jsonb)`,
      [otherCatId, otherShopId]
    );
    await adminClient.query(
      `INSERT INTO items (id, shop_id, category_id, name_i18n, price, stock_quantity, sold_count, is_available)
       VALUES ($1, $2, $3, '{"vi": "Món Quán Khác"}'::jsonb, 25000, 10, 0, false)`,
      [otherShopItemId, otherShopId, otherCatId]
    );

    const resCrossShopBatch = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_update_availability',
          shopId,
          itemIds: [itemUnlimitedRaceId, otherShopItemId],
          is_available: true,
        }),
      })
    );
    assert.equal(resCrossShopBatch.status, 400);
    const bodyCrossShopBatch = await resCrossShopBatch.json();
    assert.equal(bodyCrossShopBatch.success, false);
    assert.equal(bodyCrossShopBatch.code, 'ITEM_NOT_IN_SHOP');

    const { rows: rowsAfterCrossShop } = await adminClient.query(
      `SELECT id, is_available FROM items WHERE id = $1`,
      [itemUnlimitedRaceId]
    );
    assert.equal(rowsAfterCrossShop[0].is_available, false);

    // 5D. View-only staff rejected with 403; inventory.adjust staff succeeds with bulk_set_availability on non-zero items; bulk false succeeds on all (null, >0, 0)
    const resBulkViewForbidden = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${viewStaffToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_set_availability',
          shopId,
          itemIds: [itemUnlimitedRaceId, itemPositiveRaceId],
          isAvailable: true,
        }),
      })
    );
    assert.equal(resBulkViewForbidden.status, 403);

    const resBulkSetValid = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${invStaffToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_set_availability',
          shopId,
          itemIds: [itemUnlimitedRaceId, itemPositiveRaceId],
          isAvailable: true,
        }),
      })
    );
    assert.equal(resBulkSetValid.status, 200);
    const bodyBulkSetValid = await resBulkSetValid.json();
    assert.equal(bodyBulkSetValid.success, true);
    assert.equal(bodyBulkSetValid.updatedCount, 2);

    const resBulkSetFalseAll = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${catCashierToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_update_availability',
          shopId,
          itemIds: [
            itemUnlimitedRaceId,
            itemPositiveRaceId,
            itemBulkRaceZeroId,
          ],
          is_available: false,
        }),
      })
    );
    assert.equal(resBulkSetFalseAll.status, 200);
    const bodyBulkSetFalseAll = await resBulkSetFalseAll.json();
    assert.equal(bodyBulkSetFalseAll.success, true);
    assert.equal(bodyBulkSetFalseAll.updatedCount, 3);

    // -------------------------------------------------------------------------
    // 6. Review findings Bugs 1, 2, 3a, 3b (full-item backward compatibility
    //    without overwriting concurrent stock_quantity / sold_count)
    // -------------------------------------------------------------------------
    const itemCompatId = 'item-stock-compat-review-1';
    await adminClient.query(
      `INSERT INTO items (id, shop_id, category_id, name_i18n, desc_i18n, price, stock_quantity, sold_count, is_available, is_featured, options_json, view_count, sort_order)
       VALUES ($1, $2, $3, '{"vi": "Cà Phê Muối Huế", "en": "Salted Coffee"}'::jsonb, '{"vi": "Đậm đà", "en": "Rich"}'::jsonb, 50000, 10, 2, true, false, '[]'::jsonb, 0, 10)`,
      [itemCompatId, shopId, catId]
    );
    const {
      rows: [initialCompatSnap],
    } = await adminClient.query(`SELECT * FROM items WHERE id = $1`, [
      itemCompatId,
    ]);

    // 6A-1: Concurrent toggle (true -> false) vs stale full-snapshot price edit (incoming.is_available=true):
    // Route must NOT infer an availability toggle from the stale snapshot and overwrite newer is_available=false;
    // it must return 409 STOCK_CONFLICT and preserve is_available=false and price=50000.
    await adminClient.query(
      `UPDATE items SET is_available = false WHERE id = $1`,
      [itemCompatId]
    );
    const resAmbiguousTrueOverFalse = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${catCashierToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...initialCompatSnap, // stale is_available: true
            shop_id: shopId,
            price: 60000,
          },
        }),
      })
    );
    assert.equal(
      resAmbiguousTrueOverFalse.status,
      409,
      'Stale full snapshot with is_available=true editing price after concurrent toggle to false must return 409 STOCK_CONFLICT'
    );
    const bodyAmbiguousTrueOverFalse = await resAmbiguousTrueOverFalse.json();
    assert.equal(bodyAmbiguousTrueOverFalse.code, 'STOCK_CONFLICT');
    const {
      rows: [afterAmbiguousTrueRow],
    } = await adminClient.query(
      `SELECT price, is_available, stock_quantity, sold_count FROM items WHERE id = $1`,
      [itemCompatId]
    );
    assert.equal(
      afterAmbiguousTrueRow.is_available,
      false,
      'Concurrent is_available=false must not be overwritten by stale full snapshot price edit'
    );
    assert.equal(Number(afterAmbiguousTrueRow.price), 50000);

    // 6A-2: Reverse concurrent toggle (false -> true) vs stale full-snapshot price edit (incoming.is_available=false):
    // Route must NOT infer an availability toggle to false and overwrite newer is_available=true;
    // it must return 409 STOCK_CONFLICT and preserve is_available=true and price=50000.
    const {
      rows: [staleFalseCompatSnap],
    } = await adminClient.query(`SELECT * FROM items WHERE id = $1`, [
      itemCompatId,
    ]);
    await adminClient.query(
      `UPDATE items SET is_available = true WHERE id = $1`,
      [itemCompatId]
    );
    const resAmbiguousFalseOverTrue = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${catCashierToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...staleFalseCompatSnap, // stale is_available: false
            shop_id: shopId,
            price: 60000,
          },
        }),
      })
    );
    assert.equal(
      resAmbiguousFalseOverTrue.status,
      409,
      'Stale full snapshot with is_available=false editing price after concurrent toggle to true must return 409 STOCK_CONFLICT'
    );
    const bodyAmbiguousFalseOverTrue = await resAmbiguousFalseOverTrue.json();
    assert.equal(bodyAmbiguousFalseOverTrue.code, 'STOCK_CONFLICT');
    const {
      rows: [afterAmbiguousFalseRow],
    } = await adminClient.query(
      `SELECT price, is_available, stock_quantity, sold_count FROM items WHERE id = $1`,
      [itemCompatId]
    );
    assert.equal(
      afterAmbiguousFalseRow.is_available,
      true,
      'Concurrent is_available=true must not be overwritten by stale full snapshot price edit'
    );
    assert.equal(Number(afterAmbiguousFalseRow.price), 50000);

    // 6A-3: Explicit expected_is_available baseline CAS on full-item combined edits:
    // Mismatched expected_is_available fails closed with 409 STOCK_CONFLICT;
    // matched expected_is_available applies both price and is_available without silent loss.
    const resMismatchedExpectedAvail = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${catCashierToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...initialCompatSnap,
            shop_id: shopId,
            price: 60000,
            is_available: false,
            expected_is_available: false, // DB currently has is_available = true
          },
        }),
      })
    );
    assert.equal(resMismatchedExpectedAvail.status, 409);
    const bodyMismatchedExpectedAvail = await resMismatchedExpectedAvail.json();
    assert.equal(bodyMismatchedExpectedAvail.code, 'STOCK_CONFLICT');

    const resBug1SameStock = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${catCashierToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...initialCompatSnap,
            shop_id: shopId,
            price: 60000,
            is_available: false,
            expected_is_available: true,
          },
        }),
      })
    );
    assert.equal(resBug1SameStock.status, 200);
    const bodyBug1SameStock = await resBug1SameStock.json();
    assert.equal(bodyBug1SameStock.item.price, 60000);
    assert.equal(
      bodyBug1SameStock.item.is_available,
      false,
      'Explicit is_available=false with matching expected_is_available=true alongside price edit must be applied'
    );
    assert.equal(bodyBug1SameStock.item.stock_quantity, 10);
    assert.equal(bodyBug1SameStock.item.sold_count, 2);

    // Concurrent order commits 3 units (stock 10 -> 7, sold_count 2 -> 5) while client holds snapshot (stock=10, sold=2, expected_is_available=false).
    await adminClient.query(
      `UPDATE items SET is_available = true WHERE id = $1`,
      [itemCompatId]
    );
    await orderRpcClient.query(
      `SELECT commit_order_with_inventory($1::jsonb, $2::jsonb)`,
      [
        JSON.stringify({
          id: 'ord-pg-compat-1',
          order_code: 'ORD-PG-COMPAT-1',
          shop_id: shopId,
          table_id: tableId,
          table_label: 'Bàn 01',
          idempotency_key: 'idemp-pg-compat-1',
          total_amount: 180000,
          subtotal_amount: 180000,
          payment_status: 'unpaid',
          status: 'new',
          items: [
            {
              item_id: itemCompatId,
              quantity: 3,
              unit_price: 60000,
              extra_price: 0,
              name_vi: 'Cà Phê Muối Huế',
            },
          ],
        }),
        JSON.stringify([{ item_id: itemCompatId, delta: 3 }]),
      ]
    );
    await adminClient.query(
      `UPDATE items SET is_available = false WHERE id = $1`,
      [itemCompatId]
    );

    const resBug1AfterOrder = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${catCashierToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...initialCompatSnap,
            shop_id: shopId,
            price: 65000,
            is_available: true,
            expected_is_available: false,
          },
        }),
      })
    );
    assert.equal(resBug1AfterOrder.status, 200);
    const bodyBug1AfterOrder = await resBug1AfterOrder.json();
    assert.equal(bodyBug1AfterOrder.item.price, 65000);
    assert.equal(
      bodyBug1AfterOrder.item.is_available,
      true,
      'Explicit is_available=true with matching expected_is_available=false alongside price edit after concurrent order must be applied'
    );
    assert.equal(
      bodyBug1AfterOrder.item.stock_quantity,
      7,
      'Must preserve live stock_quantity=7 after concurrent order'
    );
    assert.equal(
      bodyBug1AfterOrder.item.sold_count,
      5,
      'Must preserve live sold_count=5 after concurrent order'
    );

    // 6B (Bug 2): No-op full-item saves without expected_stock_quantity succeed (200 OK) for both catalog.manage and inventory.adjust
    const {
      rows: [currentCompatSnap],
    } = await adminClient.query(`SELECT * FROM items WHERE id = $1`, [
      itemCompatId,
    ]);
    for (const token of [catCashierToken, invStaffToken]) {
      const resNoOp = await catalogPost(
        new Request('http://localhost:3000/api/catalog', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            action: 'upsert_item',
            item: {
              ...currentCompatSnap,
              shop_id: shopId,
            },
          }),
        })
      );
      assert.equal(
        resNoOp.status,
        200,
        'Bug 2 regression: no-op full-item save with unchanged stock must not return 409 STOCK_CONFLICT'
      );
      const bodyNoOp = await resNoOp.json();
      assert.equal(bodyNoOp.item.stock_quantity, 7);
      assert.equal(bodyNoOp.item.sold_count, 5);
      assert.equal(bodyNoOp.item.is_available, true);
    }

    // 6C (Bug 3b): Legacy full-item availability toggle after concurrent order (stock 7 -> 5, sold 5 -> 7)
    await orderRpcClient.query(
      `SELECT commit_order_with_inventory($1::jsonb, $2::jsonb)`,
      [
        JSON.stringify({
          id: 'ord-pg-compat-2',
          order_code: 'ORD-PG-COMPAT-2',
          shop_id: shopId,
          table_id: tableId,
          table_label: 'Bàn 01',
          idempotency_key: 'idemp-pg-compat-2',
          total_amount: 130000,
          subtotal_amount: 130000,
          payment_status: 'unpaid',
          status: 'new',
          items: [
            {
              item_id: itemCompatId,
              quantity: 2,
              unit_price: 65000,
              extra_price: 0,
              name_vi: 'Cà Phê Muối Huế',
            },
          ],
        }),
        JSON.stringify([{ item_id: itemCompatId, delta: 2 }]),
      ]
    );

    // Stale/no-baseline full snapshot carrying stock and toggling is_available without expected_is_available
    // must be rejected with 409 STOCK_CONFLICT in both catalog.manage and inventory.adjust paths
    const resNoBaselineCatToggle = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${catCashierToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...currentCompatSnap, // stale stock_quantity: 7, sold_count: 5
            shop_id: shopId,
            is_available: false,
          },
        }),
      })
    );
    assert.equal(resNoBaselineCatToggle.status, 409);
    assert.equal(
      (await resNoBaselineCatToggle.json()).code,
      'STOCK_CONFLICT'
    );

    const resNoBaselineInvToggle = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${invStaffToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...currentCompatSnap, // stale stock_quantity: 7, sold_count: 5
            shop_id: shopId,
            is_available: false,
          },
        }),
      })
    );
    assert.equal(resNoBaselineInvToggle.status, 409);
    assert.equal(
      (await resNoBaselineInvToggle.json()).code,
      'STOCK_CONFLICT'
    );

    // Legitimate toggle with explicit expected_is_available baseline (or narrow toggle) succeeds
    // and preserves live stock/sold counts
    const resBug3bCatToggle = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${catCashierToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...currentCompatSnap, // stale stock_quantity: 7, sold_count: 5
            shop_id: shopId,
            is_available: false,
            expected_is_available: true,
          },
        }),
      })
    );
    assert.equal(
      resBug3bCatToggle.status,
      200,
      'Legitimate full-item availability toggle with expected_is_available by catalog.manage after order must succeed'
    );
    const bodyBug3bCatToggle = await resBug3bCatToggle.json();
    assert.equal(bodyBug3bCatToggle.item.is_available, false);
    assert.equal(bodyBug3bCatToggle.item.stock_quantity, 5);
    assert.equal(bodyBug3bCatToggle.item.sold_count, 7);

    const resBug3bInvToggle = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${invStaffToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...currentCompatSnap, // stale stock_quantity: 7, sold_count: 5
            shop_id: shopId,
            is_available: true,
            expected_is_available: false,
          },
        }),
      })
    );
    assert.equal(
      resBug3bInvToggle.status,
      200,
      'Legitimate full-item availability toggle with expected_is_available by inventory.adjust after order must succeed'
    );
    const bodyBug3bInvToggle = await resBug3bInvToggle.json();
    assert.equal(bodyBug3bInvToggle.item.is_available, true);
    assert.equal(bodyBug3bInvToggle.item.stock_quantity, 5);
    assert.equal(bodyBug3bInvToggle.item.sold_count, 7);

    // 6D (Bug 3a): Legacy full-item price edit after order cancellation restock (conserved stock_quantity + sold_count)
    // vs. ambiguous manual stock adjustment (non-conserved sum -> must fail closed with 409 STOCK_CONFLICT).
    await adminClient.query(
      `UPDATE items SET stock_quantity = 8, sold_count = 4 WHERE id = $1`,
      [itemCompatId]
    );
    const resBug3aRestockPriceEdit = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${catCashierToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...currentCompatSnap, // stale stock_quantity: 7, sold_count: 5 (sum = 12 === 8 + 4)
            shop_id: shopId,
            price: 70000,
          },
        }),
      })
    );
    assert.equal(
      resBug3aRestockPriceEdit.status,
      200,
      'Bug 3a regression: legacy full-item price edit after order cancellation restock (conserved stock+sold) must succeed'
    );
    const bodyBug3aRestockPriceEdit = await resBug3aRestockPriceEdit.json();
    assert.equal(bodyBug3aRestockPriceEdit.item.price, 70000);
    assert.equal(bodyBug3aRestockPriceEdit.item.stock_quantity, 8);
    assert.equal(bodyBug3aRestockPriceEdit.item.sold_count, 4);

    // Manual stock adjustment by another staff member (stock_quantity = 25, sold_count = 4; sum = 29 !== 12)
    await adminClient.query(
      `UPDATE items SET stock_quantity = 25, sold_count = 4 WHERE id = $1`,
      [itemCompatId]
    );
    const resBug3aAmbiguousManualStock = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...currentCompatSnap, // stock_quantity: 7, sold_count: 5
            shop_id: shopId,
            price: 75000,
          },
        }),
      })
    );
    assert.equal(
      resBug3aAmbiguousManualStock.status,
      409,
      'Ambiguous full-item payload with non-conserved stock_quantity without expected_stock_quantity must fail closed with 409 STOCK_CONFLICT'
    );
    const bodyBug3aAmbiguous = await resBug3aAmbiguousManualStock.json();
    assert.equal(bodyBug3aAmbiguous.code, 'STOCK_CONFLICT');
    const {
      rows: [afterAmbiguousRow],
    } = await adminClient.query(
      `SELECT price, stock_quantity, sold_count FROM items WHERE id = $1`,
      [itemCompatId]
    );
    assert.equal(
      afterAmbiguousRow.stock_quantity,
      25,
      'Live stock_quantity=25 must not be overwritten by ambiguous stale snapshot'
    );
    assert.equal(afterAmbiguousRow.sold_count, 4);
    assert.equal(Number(afterAmbiguousRow.price), 70000);

    // -------------------------------------------------------------------------
    // 6E: dbUpsertItem zero-stock fallback with expected_is_available CAS:
    // Concurrent is_available change after currentRow read and before fallback update.
    // Verifies:
    // 1. Conditional update fails with STOCK_CONFLICT.
    // 2. Neither price nor availability is overwritten by the stale update.
    // 3. Matching baseline still behaves as intended (succeeds, sets is_available=false, updates price).
    // -------------------------------------------------------------------------
    const concurrentActorClient = await createPgClient();
    const itemZeroFallbackId = 'item-pg-zero-fallback-race-001';

    await adminClient.query(
      `INSERT INTO items (
        id, shop_id, category_id, name_i18n, desc_i18n, price,
        stock_quantity, sold_count, is_available, is_featured, options_json,
        view_count, sort_order, created_at, updated_at
      ) VALUES (
        $1, $2, $3, '{"vi": "Trà Sữa Zero Stock"}'::jsonb, '{"vi": "Mô tả"}'::jsonb, 52000,
        1, 15, true, false, '[]'::jsonb,
        0, 1, NOW(), NOW()
      )`,
      [itemZeroFallbackId, shopId, catId]
    );

    let orderDrainedStockHookFired = false;
    let concurrentAvailChangeHookFired = false;
    beforeUpdateHook = async (tableName, updatePayload, filters, orClauses) => {
      if (tableName !== 'items') return;
      if (!filters.some((f) => f.col === 'id' && f.val === itemZeroFallbackId)) return;

      // Step 1: When initial non-zero update executes, simulate concurrent order draining stock 1 -> 0
      if (
        !orderDrainedStockHookFired &&
        orClauses.includes('stock_quantity.is.null,stock_quantity.gt.0')
      ) {
        orderDrainedStockHookFired = true;
        await concurrentActorClient.query(
          `UPDATE items SET stock_quantity = 0 WHERE id = $1`,
          [itemZeroFallbackId]
        );
        return;
      }

      // Step 2: Intercept the zero-stock fallback update (after currentRow was read with stock=0, is_available=true).
      // Simulate concurrent actor changing is_available (true -> false) right before fallback update.
      const isZeroStockFallback =
        filters.some((f) => f.col === 'stock_quantity' && f.val === 0) &&
        updatePayload.is_available === false;

      if (isZeroStockFallback && !concurrentAvailChangeHookFired) {
        concurrentAvailChangeHookFired = true;
        await concurrentActorClient.query(
          `UPDATE items SET is_available = false WHERE id = $1`,
          [itemZeroFallbackId]
        );
      }
    };

    // 1. Direct dbUpsertItem:
    // Client attempts to update price (52000 -> 68000) while sending expected_is_available = true.
    // The zero-stock fallback conditional update MUST fail with STOCK_CONFLICT because the concurrent
    // actor changed is_available to false after currentRow was read.
    await assert.rejects(
      async () => {
        await dbUpsertItem({
          id: itemZeroFallbackId,
          shop_id: shopId,
          category_id: catId,
          price: 68000,
          is_available: true,
          expected_is_available: true,
        });
      },
      (err: Error) => {
        assert.match(
          err.message,
          /STOCK_CONFLICT/,
          'Expected error to indicate STOCK_CONFLICT'
        );
        return true;
      },
      'dbUpsertItem zero-stock fallback must fail with STOCK_CONFLICT when concurrent is_available change invalidates expected_is_available'
    );

    assert.equal(
      orderDrainedStockHookFired,
      true,
      'Order drain hook must fire on initial non-zero stock predicate'
    );
    assert.equal(
      concurrentAvailChangeHookFired,
      true,
      'Interleaving hook must fire before zero-stock fallback update'
    );

    // Verify PostgreSQL state via second connection: price was NOT overwritten, is_available was NOT overwritten
    const {
      rows: [rowAfterDirectRace],
    } = await concurrentActorClient.query(
      `SELECT price, is_available, stock_quantity, sold_count FROM items WHERE id = $1`,
      [itemZeroFallbackId]
    );
    assert.equal(
      Number(rowAfterDirectRace.price),
      52000,
      'Item price must NOT be overwritten when zero-stock fallback CAS fails'
    );
    assert.equal(
      rowAfterDirectRace.is_available,
      false,
      'Concurrent is_available=false must NOT be overwritten by stale fallback update'
    );
    assert.equal(rowAfterDirectRace.stock_quantity, 0);
    assert.equal(rowAfterDirectRace.sold_count, 15);

    // 2. Matching baseline:
    // Reset item to stock_quantity: 1, is_available: true, price: 52000.
    // Order drains stock 1 -> 0 during initial update, triggering zero-stock fallback.
    // BUT NO concurrent availability change occurs (hook leaves is_available untouched).
    // Zero-stock fallback should succeed, updating price to 58000 and setting is_available: false (since stock is 0).
    await concurrentActorClient.query(
      `UPDATE items SET is_available = true, price = 52000, stock_quantity = 1 WHERE id = $1`,
      [itemZeroFallbackId]
    );
    orderDrainedStockHookFired = false;
    concurrentAvailChangeHookFired = false;
    beforeUpdateHook = async (tableName, _updatePayload, filters, orClauses) => {
      if (tableName !== 'items') return;
      if (!filters.some((f) => f.col === 'id' && f.val === itemZeroFallbackId)) return;
      if (
        !orderDrainedStockHookFired &&
        orClauses.includes('stock_quantity.is.null,stock_quantity.gt.0')
      ) {
        orderDrainedStockHookFired = true;
        // Concurrent order drains stock to 0, forcing entry into zero-stock fallback
        await concurrentActorClient.query(
          `UPDATE items SET stock_quantity = 0 WHERE id = $1`,
          [itemZeroFallbackId]
        );
      }
      // No concurrent availability change -> baseline proceeds with matching availability
    };

    const baselineResult = await dbUpsertItem({
      id: itemZeroFallbackId,
      shop_id: shopId,
      category_id: catId,
      price: 58000,
      is_available: true,
      expected_is_available: true,
    });

    assert.equal(
      baselineResult.price,
      58000,
      'Matching baseline must update price to 58000'
    );
    assert.equal(
      baselineResult.is_available,
      false,
      'Zero-stock fallback must set is_available to false when stock is 0'
    );
    assert.equal(
      baselineResult.stock_quantity,
      0,
      'Stock quantity must remain 0'
    );

    const {
      rows: [rowAfterBaseline],
    } = await concurrentActorClient.query(
      `SELECT price, is_available, stock_quantity FROM items WHERE id = $1`,
      [itemZeroFallbackId]
    );
    assert.equal(
      Number(rowAfterBaseline.price),
      58000,
      'Database price must reflect baseline update'
    );
    assert.equal(
      rowAfterBaseline.is_available,
      false,
      'Database is_available must be false after zero-stock fallback'
    );
    assert.equal(rowAfterBaseline.stock_quantity, 0);
    beforeUpdateHook = null;
  } finally {
    setSupabaseDbClientForTests(null);
    setShopMembershipDbClientForTest(null);
    setMposDbClientForTests(null, false);
    for (const c of openClients) {
      try {
        await c.end();
      } catch {
        // ignore
      }
    }
    if (pgProc && !pgProc.killed) {
      pgProc.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
    }
    try {
      fs.rmSync(tempPgDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

test('dbUpsertItem zeroStock fallback and bulk_update_availability never report false success on DB failure or race mismatch', async () => {
  const { POST: catalogPost } = await import('@/app/api/catalog/route');
  const { setSupabaseDbClientForTests } = await import('@/lib/db');
  const { setShopMembershipDbClientForTest } = await import('@/lib/shop-permissions');
  const { setMposDbClientForTests } = await import('@/lib/mpos-store');
  const { issueSessionToken } = await import('@/lib/server-auth');

  const ownerId = '00000000-0000-4000-8000-000000000950';
  const shopId = 'shop-zero-stock-fallback-test';
  const catId = 'cat-zero-stock-fallback-test';
  const itemId = 'item-zero-stock-fallback-1';
  const ownerToken = issueSessionToken({
    id: ownerId,
    email: 'owner-zero-fallback@isolated.local',
    role: 'owner',
    account_type: 'owner',
  });

  try {
    // Case 1: zeroStockQuery fails with a real DB error -> must reject (HTTP 400) and never report HTTP 200
    let itemUpdateCallCount = 0;
    const mockDbErrorOnZeroStockFallback = {
      from(table: string) {
        if (table === 'shops') {
          return {
            select() {
              const chain = {
                eq() {
                  return chain;
                },
                limit: async () => ({
                  data: [{ id: shopId, owner_id: ownerId, slug: 'test-shop' }],
                  error: null,
                }),
                maybeSingle: async () => ({
                  data: { id: shopId, owner_id: ownerId, slug: 'test-shop' },
                  error: null,
                }),
              };
              return chain;
            },
          };
        }
        if (table === 'shop_memberships') {
          return {
            select() {
              return {
                eq() {
                  return {
                    eq() {
                      return {
                        maybeSingle: async () => ({
                          data: {
                            id: 'mem-1',
                            shop_id: shopId,
                            user_id: ownerId,
                            role: 'owner',
                            permissions: ['catalog.manage'],
                            is_active: true,
                          },
                          error: null,
                        }),
                      };
                    },
                  };
                },
              };
            },
          };
        }
        if (table === 'categories') {
          return {
            select() {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({
                      data: { id: catId, shop_id: shopId },
                      error: null,
                    }),
                  };
                },
              };
            },
          };
        }
        if (table === 'items') {
          return {
            select() {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({
                      // 1st read (target lookup): shop_id matches
                      // 2nd read (existing lookup): stock_quantity = 1 (> 0)
                      // 3rd read (currentRow lookup after updateQuery PGRST116): stock_quantity = 0 (drained by race)
                      data:
                        itemUpdateCallCount === 0
                          ? {
                              id: itemId,
                              shop_id: shopId,
                              category_id: catId,
                              price: 40000,
                              stock_quantity: 1,
                              sold_count: 2,
                              is_available: true,
                            }
                          : {
                              id: itemId,
                              shop_id: shopId,
                              category_id: catId,
                              price: 40000,
                              stock_quantity: 0,
                              sold_count: 3,
                              is_available: false,
                            },
                      error: null,
                    }),
                  };
                },
              };
            },
            update() {
              itemUpdateCallCount += 1;
              const currentCall = itemUpdateCallCount;
              const chain = {
                eq() {
                  return chain;
                },
                or() {
                  return chain;
                },
                select() {
                  return {
                    single: async () => {
                      if (currentCall === 1) {
                        // Initial non-zero update fails with PGRST116 because stock drained to 0
                        return {
                          data: null,
                          error: { code: 'PGRST116', message: 'Row not found' },
                        };
                      }
                      // 2nd update (zeroStockQuery) fails with a real database write error
                      return {
                        data: null,
                        error: {
                          code: 'XX000',
                          message: 'disk full during zeroStockQuery update',
                        },
                      };
                    },
                  };
                },
              };
              return chain;
            },
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    };

    setSupabaseDbClientForTests(mockDbErrorOnZeroStockFallback);
    setShopMembershipDbClientForTest(
      mockDbErrorOnZeroStockFallback as unknown as Parameters<
        typeof setShopMembershipDbClientForTest
      >[0]
    );

    const resZeroFallbackDbError = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: itemId,
            shop_id: shopId,
            category_id: catId,
            price: 45000,
            is_available: true,
          },
        }),
      })
    );
    assert.equal(resZeroFallbackDbError.status, 400);
    const bodyZeroFallbackDbError = await resZeroFallbackDbError.json();
    assert.match(
      bodyZeroFallbackDbError.error || '',
      /disk full during zeroStockQuery update/
    );
    assert.equal(itemUpdateCallCount, 2);

    // Case 2: zeroStockQuery returns PGRST116 (no row matched because stock changed away from 0 right before zeroStockQuery) -> must return 409 STOCK_CONFLICT
    itemUpdateCallCount = 0;
    const mockRaceMismatchOnZeroStockFallback = {
      ...mockDbErrorOnZeroStockFallback,
      from(table: string) {
        if (table !== 'items') {
          return mockDbErrorOnZeroStockFallback.from(table);
        }
        return {
          select: mockDbErrorOnZeroStockFallback.from('items').select,
          update() {
            itemUpdateCallCount += 1;
            const chain = {
              eq() {
                return chain;
              },
              or() {
                return chain;
              },
              select() {
                return {
                  single: async () => ({
                    data: null,
                    error: {
                      code: 'PGRST116',
                      message:
                        'JSON object requested, multiple (or no) rows returned',
                    },
                  }),
                };
              },
            };
            return chain;
          },
        };
      },
    };

    setSupabaseDbClientForTests(mockRaceMismatchOnZeroStockFallback);
    const resZeroFallbackRaceConflict = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: itemId,
            shop_id: shopId,
            category_id: catId,
            price: 45000,
            is_available: true,
          },
        }),
      })
    );
    assert.equal(resZeroFallbackRaceConflict.status, 409);
    const bodyZeroFallbackRaceConflict =
      await resZeroFallbackRaceConflict.json();
    assert.equal(bodyZeroFallbackRaceConflict.code, 'STOCK_CONFLICT');
    assert.equal(itemUpdateCallCount, 2);

    // Case 3: bulk_update_availability when RPC returns error or null payload -> 500 DB_UPDATE_FAILED (never false success)
    const mockRpcFailureClient = {
      from: mockDbErrorOnZeroStockFallback.from,
      rpc: async () => ({
        data: null,
        error: { message: 'connection terminated during atomic bulk RPC' },
      }),
    };
    setSupabaseDbClientForTests(mockRpcFailureClient);

    const resBulkRpcErr = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_update_availability',
          shopId,
          itemIds: [itemId],
          is_available: true,
        }),
      })
    );
    assert.equal(resBulkRpcErr.status, 500);
    const bodyBulkRpcErr = await resBulkRpcErr.json();
    assert.equal(bodyBulkRpcErr.success, false);
    assert.equal(bodyBulkRpcErr.code, 'DB_UPDATE_FAILED');
    assert.equal(bodyBulkRpcErr.updatedCount, 0);
    assert.equal(bodyBulkRpcErr.count, 0);

    // Case 4: Non-production mock path (no sb.rpc) on count mismatch returns 409 BULK_AVAILABILITY_COUNT_MISMATCH without issuing a second rollback update
    const harness = createBulkCatalogMockHarness({
      overrideUpdateCount: 1,
    });
    const fnbOwnerToken = issueSessionToken({
      id: 'owner-demo-001',
      email: 'owner-demo@isolated.local',
      role: 'owner',
      account_type: 'owner',
    });
    setSupabaseDbClientForTests(harness.mockDbClient);
    setShopMembershipDbClientForTest(
      harness.mockDbClient as unknown as Parameters<
        typeof setShopMembershipDbClientForTest
      >[0]
    );

    const resMockMismatch = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${fnbOwnerToken}`,
        },
        body: JSON.stringify({
          action: 'bulk_update_availability',
          shopId: 'shop-fnb-001',
          itemIds: ['item-fnb-001', 'item-fnb-002'],
          is_available: true,
        }),
      })
    );
    assert.equal(resMockMismatch.status, 409);
    const bodyMockMismatch = await resMockMismatch.json();
    assert.equal(bodyMockMismatch.code, 'BULK_AVAILABILITY_COUNT_MISMATCH');
    assert.equal(
      harness.updateCalls.length,
      1,
      'Must NOT issue a second compensating update(is_available: false) that could overwrite concurrent changes'
    );
  } finally {
    setSupabaseDbClientForTests(null);
    setShopMembershipDbClientForTest(null);
    setMposDbClientForTests(null, false);
  }
});

test('upsert_item legacy full snapshot concurrency ambiguity vs expected_is_available CAS, narrow modern updates, and inventory-only permissions', async () => {
  const { POST: catalogPost } = await import('@/app/api/catalog/route');
  const { setSupabaseDbClientForTests } = await import('@/lib/db');
  const { setShopMembershipDbClientForTest } = await import(
    '@/lib/shop-permissions'
  );
  const { setMposDbClientForTests } = await import('@/lib/mpos-store');
  const { issueSessionToken } = await import('@/lib/server-auth');

  const shopId = 'shop-fnb-001';
  const catId = 'cat-fnb-1';
  const itemId = 'item-snap-concurrency-001';

  const ownerId = '00000000-0000-4000-8000-000000000961';
  const cashierCatId = '00000000-0000-4000-8000-000000000962';
  const invOnlyStaffId = '00000000-0000-4000-8000-000000000963';

  const ownerToken = issueSessionToken({
    id: ownerId,
    email: 'owner-snap-concurrency@isolated.local',
    role: 'owner',
  });
  const catCashierToken = issueSessionToken({
    id: cashierCatId,
    email: 'cashier-snap-concurrency@isolated.local',
    role: 'cashier',
  });
  const invOnlyStaffToken = issueSessionToken({
    id: invOnlyStaffId,
    email: 'inv-snap-concurrency@isolated.local',
    role: 'staff',
  });

  type StoredItemRow = {
    id: string;
    shop_id: string;
    category_id: string;
    name_i18n: Record<string, string>;
    desc_i18n: Record<string, string>;
    price: number;
    compare_at_price: number | null;
    duration_mins: number | null;
    image_url: string | null;
    stock_quantity: number | null;
    sold_count: number;
    view_count: number;
    is_available: boolean;
    is_featured: boolean;
    options_json: unknown[];
    sort_order: number;
    created_at: string;
    updated_at: string;
  };

  let liveRow: StoredItemRow = {
    id: itemId,
    shop_id: shopId,
    category_id: catId,
    name_i18n: { vi: 'Phở Bò Tái Lăn', en: 'Stir-fried Beef Pho' },
    desc_i18n: { vi: 'Nước dùng đậm đà', en: 'Rich broth' },
    price: 50000,
    compare_at_price: null,
    duration_mins: null,
    image_url: null,
    stock_quantity: 10,
    sold_count: 2,
    view_count: 5,
    is_available: true,
    is_featured: false,
    options_json: [],
    sort_order: 1,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
  };

  const membershipsByUser: Record<
    string,
    {
      id: string;
      shop_id: string;
      user_id: string;
      role: string;
      permissions: string[];
      is_active: boolean;
    }
  > = {
    [ownerId]: {
      id: 'mem-owner',
      shop_id: shopId,
      user_id: ownerId,
      role: 'owner',
      permissions: ['catalog.view', 'catalog.manage', 'inventory.adjust'],
      is_active: true,
    },
    [cashierCatId]: {
      id: 'mem-cashier-cat',
      shop_id: shopId,
      user_id: cashierCatId,
      role: 'cashier',
      permissions: ['catalog.view', 'catalog.manage'],
      is_active: true,
    },
    [invOnlyStaffId]: {
      id: 'mem-staff-inv',
      shop_id: shopId,
      user_id: invOnlyStaffId,
      role: 'staff',
      permissions: ['catalog.view', 'inventory.adjust'],
      is_active: true,
    },
  };

  const mockDb = {
    from(table: string) {
      if (table === 'shops') {
        return {
          select() {
            const chain = {
              eq() {
                return chain;
              },
              limit: async () => ({
                data: [{ id: shopId, owner_id: ownerId, slug: 'pho-ngon' }],
                error: null,
              }),
              maybeSingle: async () => ({
                data: { id: shopId, owner_id: ownerId, slug: 'pho-ngon' },
                error: null,
              }),
            };
            return chain;
          },
        };
      }
      if (table === 'shop_memberships') {
        return {
          select() {
            const filters: Record<string, unknown> = {};
            const resolveRows = () => {
              const allRows = Object.values(membershipsByUser);
              return allRows.filter((row) =>
                Object.entries(filters).every(
                  ([k, v]) => (row as Record<string, unknown>)[k] === v
                )
              );
            };
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return chain;
              },
              order() {
                return chain;
              },
              maybeSingle: async () => ({
                data: resolveRows()[0] ?? null,
                error: null,
              }),
              then(
                onFulfilled: (v: {
                  data: Array<(typeof membershipsByUser)[string]>;
                  error: null;
                }) => unknown,
                onRejected?: (e: unknown) => unknown
              ) {
                return Promise.resolve({
                  data: resolveRows(),
                  error: null,
                }).then(onFulfilled, onRejected);
              },
            };
            return chain;
          },
        };
      }
      if (table === 'categories') {
        return {
          select() {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return chain;
              },
              maybeSingle: async () => ({
                data:
                  filters.id === catId ? { id: catId, shop_id: shopId } : null,
                error: null,
              }),
            };
            return chain;
          },
        };
      }
      if (table === 'items') {
        return {
          select() {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return chain;
              },
              maybeSingle: async () => ({
                data:
                  filters.id === liveRow.id &&
                  (filters.shop_id === undefined ||
                    filters.shop_id === liveRow.shop_id)
                    ? structuredClone(liveRow)
                    : null,
                error: null,
              }),
            };
            return chain;
          },
          update(patch: Record<string, unknown>) {
            const eqFilters: Record<string, unknown> = {};
            const isFilters: Record<string, unknown> = {};
            let requireNonZeroStock = false;
            const chain = {
              eq(col: string, val: unknown) {
                eqFilters[col] = val;
                return chain;
              },
              is(col: string, val: unknown) {
                isFilters[col] = val;
                return chain;
              },
              or(expr: string) {
                if (expr.includes('stock_quantity.gt.0')) {
                  requireNonZeroStock = true;
                }
                return chain;
              },
              select() {
                return {
                  single: async () => {
                    for (const [col, val] of Object.entries(eqFilters)) {
                      if (
                        (liveRow as unknown as Record<string, unknown>)[col] !==
                        val
                      ) {
                        return {
                          data: null,
                          error: { code: 'PGRST116', message: '0 rows' },
                        };
                      }
                    }
                    for (const [col, val] of Object.entries(isFilters)) {
                      if (
                        (liveRow as unknown as Record<string, unknown>)[col] !==
                        val
                      ) {
                        return {
                          data: null,
                          error: { code: 'PGRST116', message: '0 rows' },
                        };
                      }
                    }
                    if (requireNonZeroStock && liveRow.stock_quantity === 0) {
                      return {
                        data: null,
                        error: { code: 'PGRST116', message: '0 rows' },
                      };
                    }
                    liveRow = {
                      ...liveRow,
                      ...(patch as Partial<StoredItemRow>),
                    };
                    return { data: structuredClone(liveRow), error: null };
                  },
                };
              },
            };
            return chain;
          },
        };
      }
      throw new Error(`Unexpected table in mockDb: ${table}`);
    },
  };

  try {
    setSupabaseDbClientForTests(mockDb);
    setShopMembershipDbClientForTest(
      mockDb as unknown as Parameters<typeof setShopMembershipDbClientForTest>[0]
    );

    // 1. Client A holds stale snapshot with is_available = true while Actor B sets is_available = false.
    //    Client A edits price (50000 -> 60000) using stale full snapshot -> MUST return 409 STOCK_CONFLICT
    //    and MUST NOT overwrite newer is_available = false back to true.
    const staleTrueSnapshot = structuredClone(liveRow);
    liveRow.is_available = false; // Actor B toggled availability off

    const resStaleTruePriceEdit = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${catCashierToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...staleTrueSnapshot,
            price: 60000,
          },
        }),
      })
    );
    assert.equal(resStaleTruePriceEdit.status, 409);
    const bodyStaleTruePriceEdit = await resStaleTruePriceEdit.json();
    assert.equal(bodyStaleTruePriceEdit.code, 'STOCK_CONFLICT');
    assert.equal(
      liveRow.is_available,
      false,
      'Must preserve newer is_available=false instead of treating stale snapshot as toggle'
    );
    assert.equal(liveRow.price, 50000);

    // 2. Reverse case: Client A holds stale snapshot with is_available = false while Actor B sets is_available = true.
    //    Client A edits price (50000 -> 62000) using stale full snapshot -> MUST return 409 STOCK_CONFLICT
    //    and MUST NOT overwrite newer is_available = true back to false.
    const staleFalseSnapshot = structuredClone(liveRow); // is_available = false
    liveRow.is_available = true; // Actor B toggled availability on

    const resStaleFalsePriceEdit = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${catCashierToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...staleFalseSnapshot,
            price: 62000,
          },
        }),
      })
    );
    assert.equal(resStaleFalsePriceEdit.status, 409);
    const bodyStaleFalsePriceEdit = await resStaleFalsePriceEdit.json();
    assert.equal(bodyStaleFalsePriceEdit.code, 'STOCK_CONFLICT');
    assert.equal(
      liveRow.is_available,
      true,
      'Must preserve newer is_available=true instead of treating stale snapshot as toggle'
    );
    assert.equal(liveRow.price, 50000);

    // 3. Explicit expected_is_available baseline compare-and-set:
    //    - Non-boolean expected_is_available -> 400 INVALID_EXPECTED_AVAILABILITY
    //    - Mismatched expected_is_available -> 409 STOCK_CONFLICT
    //    - Matched expected_is_available with combined price + availability edit -> 200 OK (no silent loss of requested change)
    //    - Matched expected_is_available with unchanged is_available + price edit -> 200 OK
    const resInvalidExpectedAvail = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${catCashierToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...staleTrueSnapshot,
            price: 60000,
            expected_is_available: 'invalid',
          },
        }),
      })
    );
    assert.equal(resInvalidExpectedAvail.status, 400);
    const bodyInvalidExpectedAvail = await resInvalidExpectedAvail.json();
    assert.equal(
      bodyInvalidExpectedAvail.code,
      'INVALID_EXPECTED_AVAILABILITY'
    );

    const resMismatchBaseline = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${catCashierToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...staleTrueSnapshot,
            price: 60000,
            is_available: false,
            expected_is_available: false, // liveRow.is_available is true
          },
        }),
      })
    );
    assert.equal(resMismatchBaseline.status, 409);
    assert.equal((await resMismatchBaseline.json()).code, 'STOCK_CONFLICT');
    assert.equal(liveRow.price, 50000);
    assert.equal(liveRow.is_available, true);

    // Concurrent order changes stock 10 -> 7 and sold 2 -> 5 while liveRow.is_available remains true
    liveRow.stock_quantity = 7;
    liveRow.sold_count = 5;

    const resMatchedCombinedEdit = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${catCashierToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...staleTrueSnapshot, // stale stock=10, sold=2
            price: 60000,
            is_available: false,
            expected_is_available: true, // matches liveRow.is_available=true
          },
        }),
      })
    );
    assert.equal(resMatchedCombinedEdit.status, 200);
    const bodyMatchedCombinedEdit = await resMatchedCombinedEdit.json();
    assert.equal(bodyMatchedCombinedEdit.item.price, 60000);
    assert.equal(bodyMatchedCombinedEdit.item.is_available, false);
    assert.equal(bodyMatchedCombinedEdit.item.stock_quantity, 7);
    assert.equal(bodyMatchedCombinedEdit.item.sold_count, 5);

    // 4. Narrow modern price edit preserves concurrent availability state in both directions:
    const resNarrowPriceWhenFalse = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${catCashierToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: itemId,
            shop_id: shopId,
            category_id: catId,
            price: 64000,
          },
        }),
      })
    );
    assert.equal(resNarrowPriceWhenFalse.status, 200);
    assert.equal(liveRow.price, 64000);
    assert.equal(liveRow.is_available, false);

    // 5. Legitimate availability toggle behavior (including inventory.adjust-only staff on both narrow and legacy full snapshots, and permission preservation):
    const snapBeforeInvToggle = structuredClone(liveRow); // stock=7, sold=5, is_available=false, price=64000
    liveRow.stock_quantity = 5;
    liveRow.sold_count = 7; // concurrent order committed 2 units

    // Ambiguous legacy full snapshot carrying stock and toggling is_available without expected_is_available
    // must be rejected with 409 STOCK_CONFLICT (tested for both inventory-only staff and owner)
    const resInvFullToggleNoBaseline = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${invOnlyStaffToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...snapBeforeInvToggle,
            is_available: true,
          },
        }),
      })
    );
    assert.equal(resInvFullToggleNoBaseline.status, 409);
    assert.equal(
      (await resInvFullToggleNoBaseline.json()).code,
      'STOCK_CONFLICT'
    );
    assert.equal(liveRow.is_available, false);
    assert.equal(liveRow.stock_quantity, 5);
    assert.equal(liveRow.sold_count, 7);

    const resOwnerFullToggleNoBaseline = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...snapBeforeInvToggle,
            is_available: true,
          },
        }),
      })
    );
    assert.equal(resOwnerFullToggleNoBaseline.status, 409);
    assert.equal(
      (await resOwnerFullToggleNoBaseline.json()).code,
      'STOCK_CONFLICT'
    );
    assert.equal(liveRow.is_available, false);
    assert.equal(liveRow.stock_quantity, 5);
    assert.equal(liveRow.sold_count, 7);

    // Legitimate toggle on full snapshot with explicit expected_is_available baseline succeeds and preserves concurrent stock/sold
    const resInvFullToggleOn = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${invOnlyStaffToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...snapBeforeInvToggle,
            is_available: true,
            expected_is_available: false,
          },
        }),
      })
    );
    assert.equal(resInvFullToggleOn.status, 200);
    assert.equal(liveRow.is_available, true);
    assert.equal(liveRow.stock_quantity, 5);
    assert.equal(liveRow.sold_count, 7);

    const resInvNarrowToggleOff = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${invOnlyStaffToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: itemId,
            shop_id: shopId,
            category_id: catId,
            is_available: false,
            expected_is_available: true,
          },
        }),
      })
    );
    assert.equal(resInvNarrowToggleOff.status, 200);
    assert.equal(liveRow.is_available, false);

    // inventory.adjust-only staff attempting a price edit is rejected with 403 INSUFFICIENT_SHOP_PERMISSION
    const resInvForbiddenPriceEdit = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${invOnlyStaffToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...structuredClone(liveRow),
            price: 99000,
          },
        }),
      })
    );
    assert.equal(resInvForbiddenPriceEdit.status, 403);
    assert.equal(liveRow.price, 64000);

    // 6. Stock CAS (expected_stock_quantity) preserved for inventory.adjust-only staff and owner:
    const resInvStockCasSuccess = await catalogPost(
      new Request('http://localhost:3000/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${invOnlyStaffToken}`,
        },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: itemId,
            shop_id: shopId,
            category_id: catId,
            stock_quantity: 12,
            expected_stock_quantity: 5,
          },
        }),
      })
    );
    assert.equal(resInvStockCasSuccess.status, 200);
    assert.equal(liveRow.stock_quantity, 12);
    assert.equal(liveRow.is_available, true);
  } finally {
    setSupabaseDbClientForTests(null);
    setShopMembershipDbClientForTest(null);
    setMposDbClientForTests(null, false);
  }
});
