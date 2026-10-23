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
                if (eqMatch && inMatch) {
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
