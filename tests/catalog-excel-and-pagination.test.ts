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
  assert.deepEqual(parseCatalogPriceValue(1_000_000_000), { valid: true, price: 1000000000 });
  // Fractional numbers must be strictly rejected (never rounded)
  assert.equal(parseCatalogPriceValue(45000.4).valid, false);
  assert.equal(parseCatalogPriceValue(35000.5).valid, false);
  assert.equal(parseCatalogPriceValue(0.5).valid, false);

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
  assert.equal(parseCatalogPriceValue(-500).valid, false);
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
  assert.equal(parseCatalogPriceValue(1_000_000_001).valid, false); // exceeds max limit

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
          items: [{ id: 'item-fnb-001', stock_quantity: 30 }],
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
          items: [{ id: 'item-fnb-001', stock_quantity: null }],
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
          items: [{ id: 'item-fnb-001', stock_quantity: 42 }],
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
