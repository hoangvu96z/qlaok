export type ExportCell = string | number | null;

export interface ExportDataset {
  title: string;
  columns: Array<{ key: string; label: string; kind?: 'text' | 'number' | 'money' }>;
  rows: Array<Record<string, ExportCell>>;
  metadata?: Array<[string, string | number]>;
  currency?: string;
}

function validCell(value: ExportCell | undefined): string | number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot export a non-finite number.');
    return value;
  }
  return value ?? '';
}

/** Text stays text; numeric negatives stay numeric. CSV formula-like text is neutralized. */
export function escapeExportCsvCell(value: ExportCell | undefined): string {
  const normalized = validCell(value);
  if (typeof normalized === 'number') return String(normalized);
  const safe = /^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/.test(normalized)
    ? `'${normalized}`
    : normalized;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function serializeCsv(dataset: ExportDataset): string {
  const header = dataset.columns.map((column) => escapeExportCsvCell(column.label)).join(',');
  const rows = dataset.rows.map((row) =>
    dataset.columns.map((column) => escapeExportCsvCell(row[column.key])).join(',')
  );
  return '\uFEFF' + [header, ...rows].join('\r\n');
}

/** Real OOXML workbook. Dynamic import keeps the writer out of the initial page bundle. */
export async function buildXlsx(dataset: ExportDataset): Promise<Uint8Array> {
  const module = await import('exceljs');
  const Workbook = module.default?.Workbook ?? module.Workbook;
  const workbook = new Workbook();
  workbook.creator = 'Qlaok';
  workbook.title = dataset.title;
  const sheet = workbook.addWorksheet('Report');
  sheet.addRow(dataset.columns.map((column) => column.label));
  for (const row of dataset.rows) {
    sheet.addRow(dataset.columns.map((column) => validCell(row[column.key])));
  }
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  if (dataset.columns.length) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, dataset.rows.length + 1), column: dataset.columns.length },
    };
  }
  dataset.columns.forEach((column, index) => {
    const target = sheet.getColumn(index + 1);
    target.width = column.kind === 'money' ? 22 : 28;
    if (column.kind === 'money' || column.kind === 'number') target.numFmt = '#,##0.########';
    else target.numFmt = '@';
  });
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF047857' } };
  const context = workbook.addWorksheet('Filters');
  context.addRow(['Report', dataset.title]);
  context.addRow(['Currency', dataset.currency || 'VND']);
  context.addRow(['Exported rows', dataset.rows.length]);
  for (const [key, value] of dataset.metadata || []) context.addRow([key, validCell(value)]);
  context.getColumn(1).width = 28;
  context.getColumn(2).width = 70;
  const output = await workbook.xlsx.writeBuffer();
  return Uint8Array.from(new Uint8Array(output));
}

export function exportFilename(name: string, format: 'csv' | 'xlsx'): string {
  const base = name
    .replace(/\.(csv|xlsx?|html)$/i, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/^\.+|[.\s]+$/g, '')
    .slice(0, 160) || 'Qlaok-report';
  return `${base}.${format}`;
}

export async function downloadDataset(
  dataset: ExportDataset,
  format: 'csv' | 'xlsx',
  filename: string
): Promise<void> {
  if (typeof document === 'undefined') throw new Error('Downloads require a browser.');
  let blob: Blob;
  if (format === 'csv') {
    blob = new Blob([serializeCsv(dataset)], { type: 'text/csv;charset=utf-8;' });
  } else {
    const bytes = await buildXlsx(dataset);
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = exportFilename(filename, format);
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Defer revocation until the browser has started consuming the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
