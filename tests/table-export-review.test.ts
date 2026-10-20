import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { buildXlsx, escapeExportCsvCell, exportFilename, serializeCsv, type ExportDataset } from '@/lib/table-export';

const dataset: ExportDataset = {
  title: 'Theo bàn',
  columns: [
    { key: 'table', label: 'Bàn / Vị trí', kind: 'text' },
    { key: 'amount', label: 'Thực thu', kind: 'money' },
    { key: 'state', label: 'Trạng thái', kind: 'text' },
  ],
  rows: [
    { table: 'Bàn "01", cửa sổ\nTầng 2', amount: 125000, state: 'Đã hoàn tiền', hidden: 'not-visible' },
    { table: '=HYPERLINK("https://example.invalid")', amount: -1000, state: 'Chưa thu' },
    { table: '00012', amount: 0, state: null },
  ],
  metadata: [['Shop', 'Quán A'], ['Scope', 'Current page'], ['Timezone', 'Asia/Ho_Chi_Minh']],
};

test('CSV preserves explicit column order and selected rows, quotes Vietnamese multiline text and excludes hidden data', () => {
  const csv = serializeCsv(dataset);
  assert.ok(csv.startsWith('\uFEFF"Bàn / Vị trí","Thực thu","Trạng thái"\r\n'));
  assert.ok(csv.includes('"Bàn ""01"", cửa sổ\nTầng 2",125000,"Đã hoàn tiền"'));
  assert.ok(csv.includes("\"'=HYPERLINK"));
  assert.ok(csv.includes(',-1000,"Chưa thu"'));
  assert.ok(!csv.includes('not-visible'));
  const currentPage = serializeCsv({ ...dataset, rows: dataset.rows.slice(1, 2) });
  assert.ok(!currentPage.includes('125000'));
  assert.ok(currentPage.includes('Chưa thu'));
});

test('CSV formula text is neutralized while numeric negatives remain numbers', () => {
  for (const value of ['=1+1', '+1+1', '-1+1', '@SUM(A1)', '  =SUM(A1)', '\t=SUM(A1)', '\r=1', '\n=1']) {
    assert.ok(escapeExportCsvCell(value).startsWith('"\''), value);
  }
  assert.equal(escapeExportCsvCell(-42), '-42');
  assert.equal(escapeExportCsvCell(null), '""');
  assert.throws(() => escapeExportCsvCell(NaN));
});

test('XLSX is readable OOXML with identical columns/rows, numeric money, text IDs and no executable formulas', async () => {
  const bytes = await buildXlsx(dataset);
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(bytes).buffer);
  const sheet = workbook.getWorksheet('Report')!;
  assert.deepEqual([1, 2, 3].map((column) => sheet.getCell(1, column).value), ['Bàn / Vị trí', 'Thực thu', 'Trạng thái']);
  assert.equal(sheet.rowCount, dataset.rows.length + 1);
  assert.equal(sheet.columnCount, dataset.columns.length);
  assert.equal(sheet.getCell('A2').value, dataset.rows[0].table);
  assert.equal(sheet.getCell('B2').value, 125000);
  assert.equal(sheet.getCell('C2').value, 'Đã hoàn tiền');
  assert.equal(typeof sheet.getCell('A3').value, 'string');
  assert.equal(sheet.getCell('A3').formula, undefined);
  assert.equal(sheet.getCell('B3').value, -1000);
  assert.equal(sheet.getCell('A4').value, '00012');
  assert.equal(workbook.getWorksheet('Filters')!.getCell('B3').value, 3);
  assert.equal(workbook.getWorksheet('Filters')!.getCell('B4').value, 'Quán A');
});

test('empty reports still produce readable headers and safe filenames use the real file extension', async () => {
  assert.ok(serializeCsv({ ...dataset, rows: [] }).includes('Bàn / Vị trí'));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(await buildXlsx({ ...dataset, rows: [] })).buffer);
  assert.equal(workbook.getWorksheet('Report')!.rowCount, 1);
  assert.equal(exportFilename('../Quán:A/report.xls', 'xlsx'), '-Quán-A-report.xlsx');
});
