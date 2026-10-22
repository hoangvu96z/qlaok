import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../package.json', import.meta.url));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const {
  ShopTableFloorPlanCanvas,
  resolveTableCoordinates,
  isValidCoordinate,
  isValidFloorStatus,
  resolveFloorStatus,
  resolveTableCapacity,
  resolveTableCount,
  resolveTableAmount,
  CANVAS_BOUNDS,
  CANVAS_SAFE_MARGINS,
  getSafeCanvasBounds,
  clampTableCoordinateX,
  clampTableCoordinateY,
  clampTableCoordinates,
  convertPointToCanvasCoordinates,
  createPostDragClickGuard,
} = await import('../src/components/ShopTableFloorPlanCanvas.tsx');

// --- Test Suite 1: isValidCoordinate ---
assert.equal(isValidCoordinate(0), true);
assert.equal(isValidCoordinate(50), true);
assert.equal(isValidCoordinate(100), true);
assert.equal(isValidCoordinate(-1), false);
assert.equal(isValidCoordinate(101), false);
assert.equal(isValidCoordinate(null), false);
assert.equal(isValidCoordinate(undefined), false);
assert.equal(isValidCoordinate(NaN), false);
assert.equal(isValidCoordinate('50'), false);
console.log('PASS: isValidCoordinate boundary and type validation');

// --- Test Suite 2: Deterministic fallback positions ---
const positionedTable = {
  id: 'tbl-1',
  name: 'Bàn 01',
  table_code: 'T01',
  layout_x: 25,
  layout_y: 35,
};
const nullTableA = {
  id: 'tbl-null-a',
  name: 'Bàn Chưa Đặt A',
  table_code: 'T02',
  layout_x: null,
  layout_y: null,
};
const nullTableB = {
  id: 'tbl-null-b',
  name: 'Bàn Chưa Đặt B',
  table_code: 'T03',
  layout_x: null,
  layout_y: null,
};

const coords1 = resolveTableCoordinates([positionedTable, nullTableA, nullTableB]);
const pos1 = coords1.get('tbl-1');
const posA = coords1.get('tbl-null-a');
const posB = coords1.get('tbl-null-b');

assert.ok(pos1 && !pos1.isFallback && pos1.x === 25 && pos1.y === 35);
assert.ok(posA && posA.isFallback);
assert.ok(posB && posB.isFallback);
// Distinct fallback positions
assert.notEqual(`${posA.x},${posA.y}`, `${posB.x},${posB.y}`);

// Strictly within canvas bounds [7, 93] and [9, 91]
for (const pos of [pos1, posA, posB]) {
  assert.ok(pos.x >= 7 && pos.x <= 93, `x=${pos.x} within bounds`);
  assert.ok(pos.y >= 9 && pos.y <= 91, `y=${pos.y} within bounds`);
}

// Determinism: calling again with identical tables yields exact same coordinates
const coords2 = resolveTableCoordinates([positionedTable, nullTableA, nullTableB]);
assert.deepEqual(coords1.get('tbl-null-a'), coords2.get('tbl-null-a'));
assert.deepEqual(coords1.get('tbl-null-b'), coords2.get('tbl-null-b'));
console.log('PASS: deterministic fallback positioning and bounds clamping');

// Edge case: single unpositioned table centers at (50, 50)
const singleCoords = resolveTableCoordinates([nullTableA]);
assert.deepEqual(singleCoords.get('tbl-null-a'), { x: 50, y: 50, isFallback: true });

// Edge case: empty list returns empty Map
const emptyCoords = resolveTableCoordinates([]);
assert.equal(emptyCoords.size, 0);
console.log('PASS: fallback edge cases (single table center, empty list)');

// --- Test Suite 2B: Explicit clamping boundaries, partial coordinates & collision avoidance ---
// QA assertion 1: Explicit 0/100 boundary clamping on both axes
const boundaryTableZero = {
  id: 'tbl-zero',
  name: 'Bàn Góc 0',
  table_code: 'T00',
  layout_x: 0,
  layout_y: 0,
};
const boundaryTableHundred = {
  id: 'tbl-hundred',
  name: 'Bàn Góc 100',
  table_code: 'T99',
  layout_x: 100,
  layout_y: 100,
};
const boundaryCoords = resolveTableCoordinates([
  boundaryTableZero,
  boundaryTableHundred,
]);
const posZero = boundaryCoords.get('tbl-zero');
const posHundred = boundaryCoords.get('tbl-hundred');

assert.ok(posZero && !posZero.isFallback, 'Explicit coordinate at 0 must not be fallback');
assert.equal(posZero.x, 7, 'layout_x: 0 clamped to 7');
assert.equal(posZero.y, 9, 'layout_y: 0 clamped to 9');

assert.ok(posHundred && !posHundred.isFallback, 'Explicit coordinate at 100 must not be fallback');
assert.equal(posHundred.x, 93, 'layout_x: 100 clamped to 93');
assert.equal(posHundred.y, 91, 'layout_y: 100 clamped to 91');

// QA assertion 2: Partial coordinates (one valid + one invalid coordinate)
const partialTableValidX = {
  id: 'tbl-part-x',
  name: 'Bàn Thiếu Y',
  table_code: 'TP1',
  layout_x: 35,
  layout_y: null,
};
const partialTableValidY = {
  id: 'tbl-part-y',
  name: 'Bàn Thiếu X',
  table_code: 'TP2',
  layout_x: undefined,
  layout_y: 65,
};
const partialCoords = resolveTableCoordinates([
  partialTableValidX,
  partialTableValidY,
]);
const posX = partialCoords.get('tbl-part-x');
const posY = partialCoords.get('tbl-part-y');

assert.ok(posX && posX.isFallback, 'Partial table with valid X and null Y must get fallback slot');
assert.ok(posX.x >= 7 && posX.x <= 93, 'Partial table X within bounds');
assert.ok(posX.y >= 9 && posX.y <= 91, 'Partial table Y within bounds');

assert.ok(posY && posY.isFallback, 'Partial table with undefined X and valid Y must get fallback slot');
assert.ok(posY.x >= 7 && posY.x <= 93, 'Partial table X within bounds');
assert.ok(posY.y >= 9 && posY.y <= 91, 'Partial table Y within bounds');
assert.notEqual(`${posX.x},${posX.y}`, `${posY.x},${posY.y}`, 'Partial tables do not collide with each other');

// QA assertion 3: Auto-positioned table not colliding with an explicit table at the fallback center (50, 50)
const explicitCenterTable = {
  id: 'tbl-center',
  name: 'Bàn Trung Tâm',
  table_code: 'TC0',
  layout_x: 50,
  layout_y: 50,
};
const autoTable = {
  id: 'tbl-auto',
  name: 'Bàn Tự Động',
  table_code: 'TA1',
  layout_x: null,
  layout_y: null,
};

const centerTestCoords = resolveTableCoordinates([
  explicitCenterTable,
  autoTable,
]);
const posCenter = centerTestCoords.get('tbl-center');
const posAuto = centerTestCoords.get('tbl-auto');

assert.ok(posCenter, 'Explicit center table must resolve');
assert.equal(posCenter.isFallback, false, 'Owner-set position must not be marked fallback');
assert.equal(posCenter.x, 50, 'Explicit center table X preserved');
assert.equal(posCenter.y, 50, 'Explicit center table Y preserved');

assert.ok(posAuto, 'Auto table must resolve');
assert.equal(posAuto.isFallback, true, 'Auto table must be marked fallback');
assert.ok(posAuto.x >= 7 && posAuto.x <= 93, 'Auto table X within bounds');
assert.ok(posAuto.y >= 9 && posAuto.y <= 91, 'Auto table Y within bounds');

// Must NOT collide with the explicit table at the fallback center
assert.notEqual(
  `${posAuto.x},${posAuto.y}`,
  `${posCenter.x},${posCenter.y}`,
  'Auto-positioned table must not take the center table position'
);
const dxCenter = Math.abs(posAuto.x - posCenter.x);
const dyCenter = Math.abs(posAuto.y - posCenter.y);
assert.ok(
  dxCenter >= 12 || dyCenter >= 10,
  `Auto-positioned table must maintain non-colliding distance from center (dx=${dxCenter}, dy=${dyCenter})`
);

// Verify order stability and preservation when unpositioned table comes before explicit table
const reversedCenterTest = resolveTableCoordinates([
  autoTable,
  explicitCenterTable,
]);
const revCenter = reversedCenterTest.get('tbl-center');
const revAuto = reversedCenterTest.get('tbl-auto');
assert.equal(revCenter.x, 50, 'Owner-set position preserved regardless of input order');
assert.equal(revCenter.y, 50, 'Owner-set position preserved regardless of input order');
assert.equal(revCenter.isFallback, false);
assert.equal(revAuto.isFallback, true);
assert.notEqual(`${revAuto.x},${revAuto.y}`, `${revCenter.x},${revCenter.y}`);

// --- Test Suite 3: Empty State Server Rendering ---
const emptyHtmlVi = renderToStaticMarkup(
  React.createElement(ShopTableFloorPlanCanvas, { tables: [], locale: 'vi' })
);
assert.ok(emptyHtmlVi.includes('Chưa có bàn nào trong sơ đồ'));
assert.ok(emptyHtmlVi.includes('data-testid="floor-plan-empty"'));

const emptyHtmlEn = renderToStaticMarkup(
  React.createElement(ShopTableFloorPlanCanvas, { tables: [], locale: 'en' })
);
assert.ok(emptyHtmlEn.includes('No tables in floor plan'));
console.log('PASS: empty state rendering in VI and EN');

// --- Test Suite 4: Four Statuses, Legend Counts and Accessible Text ---
const sampleTables = [
  {
    id: 'tbl-free',
    name: 'Bàn Trống 01',
    table_code: 'T01',
    section: 'Tầng 1',
    capacity: 2,
    is_active: true,
    layout_x: 20,
    layout_y: 20,
    floor_status: 'free',
    open_order_count: 0,
    unpaid_amount: 0,
  },
  {
    id: 'tbl-occupied',
    name: 'Bàn Đang Ăn 02',
    table_code: 'T02',
    section: 'Tầng 1',
    capacity: 4,
    is_active: true,
    layout_x: 50,
    layout_y: 20,
    floor_status: 'occupied',
    open_order_count: 1,
    unpaid_amount: 0,
  },
  {
    id: 'tbl-waiting',
    name: 'Bàn Chờ Tính Tiền 03',
    table_code: 'T03',
    section: 'VIP 1',
    capacity: 8,
    is_active: true,
    layout_x: 80,
    layout_y: 20,
    floor_status: 'waiting_payment',
    open_order_count: 2,
    unpaid_amount: 250000,
  },
  {
    id: 'tbl-inactive',
    name: 'Bàn Sửa Chữa 04',
    table_code: 'T04',
    section: 'Ngoài Trời',
    capacity: 4,
    is_active: false,
    layout_x: null,
    layout_y: null,
    floor_status: 'inactive',
    open_order_count: 0,
    unpaid_amount: 0,
  },
];

const renderedVi = renderToStaticMarkup(
  React.createElement(ShopTableFloorPlanCanvas, {
    tables: sampleTables,
    selectedTableId: 'tbl-waiting',
    locale: 'vi',
  })
);

// Legend rendered with live counts
assert.ok(renderedVi.includes('data-testid="floor-plan-legend"'));
assert.ok(renderedVi.includes('Trạng thái bàn'));
assert.ok(renderedVi.includes('(4 bàn)'));
assert.ok(renderedVi.includes('data-testid="floor-plan-legend-free"'));
assert.ok(renderedVi.includes('data-testid="floor-plan-legend-occupied"'));
assert.ok(renderedVi.includes('data-testid="floor-plan-legend-waiting_payment"'));
assert.ok(renderedVi.includes('data-testid="floor-plan-legend-inactive"'));

// Status text accessible in markers (not relying on color alone)
assert.ok(renderedVi.includes('Trống'));
assert.ok(renderedVi.includes('Đang phục vụ'));
assert.ok(renderedVi.includes('Chờ thanh toán'));
assert.ok(renderedVi.includes('Tạm ngưng'));

// Markers render correct codes, sections, capacities
assert.ok(renderedVi.includes('T01'));
assert.ok(renderedVi.includes('T02'));
assert.ok(renderedVi.includes('T03'));
assert.ok(renderedVi.includes('T04'));
assert.ok(renderedVi.includes('VIP 1'));
assert.ok(renderedVi.includes('Ngoài Trời'));
assert.ok(renderedVi.includes('<span>2</span>'));
assert.ok(renderedVi.includes('<span>8</span>'));
assert.ok(renderedVi.includes('👥'));

// Read-only markers (no onSelectTable): render non-focusable div without role=button, tabIndex, aria-pressed, or cursor-pointer
assert.ok(
  renderedVi.includes('data-testid="floor-plan-marker-tbl-waiting"') &&
    renderedVi.includes('data-selected="true"')
);
assert.match(renderedVi, /<div[^>]*data-testid="floor-plan-marker-tbl-waiting"/);
assert.equal(renderedVi.includes('role="button"'), false);
assert.equal(renderedVi.includes('tabindex') || renderedVi.includes('tabIndex'), false);
assert.equal(renderedVi.includes('aria-pressed'), false);
assert.equal(renderedVi.includes('cursor-pointer'), false);

// Interactive markers (when onSelectTable is provided): render native <button type="button">, aria-pressed, cursor-pointer, no role=button, no tabIndex
const renderedInteractive = renderToStaticMarkup(
  React.createElement(ShopTableFloorPlanCanvas, {
    tables: sampleTables,
    selectedTableId: 'tbl-waiting',
    onSelectTable: () => {},
    locale: 'vi',
  })
);
assert.match(
  renderedInteractive,
  /<button[^>]*type="button"[^>]*data-testid="floor-plan-marker-tbl-waiting"/
);
assert.ok(renderedInteractive.includes('aria-pressed="true"'));
assert.ok(renderedInteractive.includes('aria-pressed="false"'));
assert.ok(renderedInteractive.includes('cursor-pointer'));
assert.equal(renderedInteractive.includes('role="button"'), false);
assert.equal(
  renderedInteractive.includes('tabindex') || renderedInteractive.includes('tabIndex'),
  false
);

// Order and unpaid amount metrics
assert.ok(renderedVi.includes('2 đơn'));
assert.ok(renderedVi.includes('250.000đ'));

// Fallback auto position indicator on unpositioned table
assert.ok(renderedVi.includes('data-testid="floor-plan-marker-tbl-inactive"'));
assert.ok(renderedVi.includes('data-fallback-position="true"'));
assert.ok(renderedVi.includes('auto'));

console.log('PASS: comprehensive VI rendering with legend counts, metrics, and selection');

// --- Test Suite 5: English Localization & Dark Theme ---
// Following the app's existing theme state: dark styling comes from the surrounding app theme ancestor (.dark),
// not from a hard-coded or misleading component prop override.
const renderedEnDark = renderToStaticMarkup(
  React.createElement(
    'div',
    { className: 'dark' },
    React.createElement(ShopTableFloorPlanCanvas, {
      tables: sampleTables,
      locale: 'en',
    })
  )
);

assert.ok(renderedEnDark.includes('Table Status'));
assert.ok(renderedEnDark.includes('(4 tables)'));
assert.ok(renderedEnDark.includes('Available'));
assert.ok(renderedEnDark.includes('Occupied'));
assert.ok(renderedEnDark.includes('Waiting payment'));
assert.ok(renderedEnDark.includes('Inactive'));
assert.ok(renderedEnDark.includes('2 orders'));
assert.ok(renderedEnDark.includes('dark'));
assert.ok(renderedEnDark.includes('dark:bg-slate-950/70'));
assert.ok(renderedEnDark.includes('dark:text-white'));
console.log('PASS: English localization and dark theme classes verified');

// --- Test Suite 6: Unique SVG Pattern IDs per component instance ---
const twoCanvasesHtml = renderToStaticMarkup(
  React.createElement(
    'div',
    null,
    React.createElement(ShopTableFloorPlanCanvas, { tables: [] }),
    React.createElement(ShopTableFloorPlanCanvas, { tables: [] })
  )
);

const patternIdMatches = [
  ...twoCanvasesHtml.matchAll(/<pattern id="([^"]+)"/g),
].map((m) => m[1]);
const fillMatches = [
  ...twoCanvasesHtml.matchAll(/fill="url\(#([^)]+)\)"/g),
].map((m) => m[1]);

assert.equal(patternIdMatches.length, 2, 'Must render two pattern elements');
assert.notEqual(
  patternIdMatches[0],
  patternIdMatches[1],
  'Pattern IDs must be distinct across instances'
);
assert.equal(fillMatches.length, 2, 'Must render two pattern fill references');
assert.equal(
  fillMatches[0],
  patternIdMatches[0],
  'First canvas fill reference must match its pattern ID'
);
assert.equal(
  fillMatches[1],
  patternIdMatches[1],
  'Second canvas fill reference must match its pattern ID'
);
console.log('PASS: SVG pattern IDs unique per component instance');

// --- Test Suite 7: Data Safety, Fallbacks & 1-Item Pluralization ---

// 7.1 Unknown status consistency: own-key check against STATUS_CONFIG & fallback to free
assert.equal(isValidFloorStatus('free'), true);
assert.equal(isValidFloorStatus('occupied'), true);
assert.equal(isValidFloorStatus('waiting_payment'), true);
assert.equal(isValidFloorStatus('inactive'), true);
assert.equal(isValidFloorStatus('toString'), false, 'Object prototype keys are rejected');
assert.equal(isValidFloorStatus('valueOf'), false);
assert.equal(isValidFloorStatus('unknown_status'), false);
assert.equal(isValidFloorStatus(null), false);
assert.equal(isValidFloorStatus(undefined), false);
assert.equal(isValidFloorStatus(123), false);

assert.equal(resolveFloorStatus('free'), 'free');
assert.equal(resolveFloorStatus('toString'), 'free');
assert.equal(resolveFloorStatus('custom_state'), 'free');
assert.equal(resolveFloorStatus(null), 'free');

const unknownStatusTables = [
  {
    id: 'tbl-unk-1',
    name: 'Bàn Trạng Thái Lạ 1',
    table_code: 'UK1',
    is_active: true,
    floor_status: 'custom_or_deprecated_status',
  },
  {
    id: 'tbl-unk-proto',
    name: 'Bàn Trạng Thái Prototype',
    table_code: 'UK2',
    is_active: true,
    floor_status: 'toString',
  },
  {
    id: 'tbl-unk-null',
    name: 'Bàn Trạng Thái Null',
    table_code: 'UK3',
    is_active: true,
    floor_status: null,
  },
];

const renderedUnknownStatus = renderToStaticMarkup(
  React.createElement(ShopTableFloorPlanCanvas, {
    tables: unknownStatusTables,
    locale: 'vi',
  })
);

// Legend count for free must include all 3 fallback tables
assert.ok(
  renderedUnknownStatus.includes('data-testid="floor-plan-legend-free"'),
  'Legend free badge must exist'
);
assert.match(
  renderedUnknownStatus,
  /data-testid="floor-plan-legend-free"[^>]*>[\s\S]*?\(3\)/,
  'All 3 unknown/prototype status tables must count toward free in legend'
);

// Markers must consistently render data-floor-status="free" and the "Trống" label
assert.ok(
  renderedUnknownStatus.includes('data-floor-status="free"'),
  'Resolved floor status in data attribute must be free'
);
assert.equal(
  renderedUnknownStatus.includes('data-floor-status="custom_or_deprecated_status"'),
  false,
  'Unknown raw status must not appear in data-floor-status'
);
assert.equal(
  renderedUnknownStatus.includes('data-floor-status="toString"'),
  false,
  'Prototype key status must not appear in data-floor-status'
);
assert.equal(
  renderedUnknownStatus.includes('data-floor-status="null"'),
  false,
  'Null status must not appear as string in data-floor-status'
);

// 7.2 Malformed numeric values: NaN, Infinity, negative, malformed strings
assert.equal(resolveTableCapacity(0), 1, 'Capacity minimum is 1');
assert.equal(resolveTableCapacity(-5), 1, 'Negative capacity clamps to 1');
assert.equal(resolveTableCapacity(NaN), 4, 'NaN capacity falls back to safe default');
assert.equal(resolveTableCapacity(Infinity), 4, 'Infinity capacity falls back to safe default');
assert.equal(resolveTableCapacity('invalid'), 4, 'Invalid string capacity falls back');
assert.equal(resolveTableCapacity('6'), 6, 'Valid numeric string parsed');

assert.equal(resolveTableCount(-3), 0, 'Count minimum is 0');
assert.equal(resolveTableCount(NaN), 0, 'NaN count falls back to 0');
assert.equal(resolveTableCount(Infinity), 0, 'Infinity count falls back to 0');
assert.equal(resolveTableCount('malformed'), 0, 'Malformed string count falls back to 0');
assert.equal(resolveTableCount('5'), 5, 'Valid numeric string parsed');

assert.equal(resolveTableAmount(-9999), 0, 'Amount minimum is 0');
assert.equal(resolveTableAmount(NaN), 0, 'NaN amount falls back to 0');
assert.equal(resolveTableAmount(Infinity), 0, 'Infinity amount falls back to 0');
assert.equal(resolveTableAmount('bad_vnd'), 0, 'Bad string amount falls back to 0');

const malformedNumericTables = [
  {
    id: 'tbl-malformed',
    name: 'Bàn Số Liệu Lỗi',
    table_code: 'ERR1',
    is_active: true,
    floor_status: 'occupied',
    capacity: NaN,
    open_order_count: 'malformed_count',
    unpaid_amount: Infinity,
  },
  {
    id: 'tbl-zero-capacity',
    name: 'Bàn Sức Chứa 0',
    table_code: 'ERR2',
    is_active: true,
    floor_status: 'occupied',
    capacity: 0,
    open_order_count: -5,
    unpaid_amount: -99999,
  },
  {
    id: 'tbl-str-infinity',
    name: 'Bàn Chuỗi Vô Cực',
    table_code: 'ERR3',
    is_active: true,
    floor_status: 'waiting_payment',
    capacity: 'Infinity',
    open_order_count: Infinity,
    unpaid_amount: 'NaN',
  },
];

const renderedMalformed = renderToStaticMarkup(
  React.createElement(ShopTableFloorPlanCanvas, {
    tables: malformedNumericTables,
    locale: 'vi',
  })
);

// Must never render NaN or Infinity
assert.equal(renderedMalformed.includes('NaN'), false, 'HTML must never contain NaN');
assert.equal(renderedMalformed.includes('Infinity'), false, 'HTML must never contain Infinity');
assert.equal(renderedMalformed.includes('-5 đơn'), false, 'HTML must never render negative counts');
assert.equal(renderedMalformed.includes('-99.999'), false, 'HTML must never render negative amounts');
assert.equal(renderedMalformed.includes('-99999'), false, 'HTML must never render negative amounts');

// 0 capacity must clamp to minimum 1
const renderedZeroCap = renderToStaticMarkup(
  React.createElement(ShopTableFloorPlanCanvas, {
    tables: [malformedNumericTables[1]],
    locale: 'en',
  })
);
assert.ok(
  renderedZeroCap.includes('title="1 seat"'),
  'Capacity 0 must clamp to minimum 1 seat'
);
assert.ok(
  renderedZeroCap.includes('<span>1</span>'),
  'Capacity badge must display 1 when capacity was 0'
);

// 7.3 Blank labels: use table.id as final fallback when table_code and name are empty
const blankLabelTable = {
  id: 'tbl-blank-fallback-99',
  name: '   ',
  table_code: '',
  is_active: true,
  floor_status: 'free',
};

const renderedBlank = renderToStaticMarkup(
  React.createElement(ShopTableFloorPlanCanvas, {
    tables: [blankLabelTable],
    locale: 'vi',
  })
);

assert.ok(
  renderedBlank.includes('tbl-blank-fallback-99'),
  'Component must fall back to table.id when table_code and name are empty'
);
assert.ok(
  renderedBlank.includes('data-table-code="tbl-blank-fallback-99"'),
  'Marker data-table-code attribute must fall back to table.id'
);

// 7.4 1-item English singular/plural labels
const singleItemTable = {
  id: 'tbl-single-1',
  name: 'Single Table',
  table_code: 'ST1',
  capacity: 1,
  open_order_count: 1,
  unpaid_amount: 50000,
  floor_status: 'occupied',
  is_active: true,
  section: 'Main',
};

const renderedSingleEn = renderToStaticMarkup(
  React.createElement(ShopTableFloorPlanCanvas, {
    tables: [singleItemTable],
    locale: 'en',
  })
);

// Legend must say "(1 table)" NOT "(1 tables)"
assert.ok(
  renderedSingleEn.includes('(1 table)'),
  'English legend must use singular "1 table"'
);
assert.equal(
  renderedSingleEn.includes('(1 tables)'),
  false,
  'English legend must not use plural "(1 tables)"'
);

// Capacity must say "1 seat" NOT "1 seats"
assert.ok(
  renderedSingleEn.includes('title="1 seat"'),
  'English capacity title must use singular "1 seat"'
);
assert.equal(
  renderedSingleEn.includes('1 seats'),
  false,
  'English capacity must not use plural "1 seats"'
);

// Open orders must say "1 order" and "1 order in progress"
assert.ok(
  renderedSingleEn.includes('1 order in progress'),
  'English metric title must use singular "1 order in progress"'
);
assert.equal(
  renderedSingleEn.includes('1 orders in progress'),
  false,
  'English metric title must not use plural "1 orders in progress"'
);
assert.ok(
  renderedSingleEn.includes('>1 order<') || renderedSingleEn.includes('1 order'),
  'English order badge must use singular "1 order"'
);
assert.equal(
  renderedSingleEn.includes('1 orders'),
  false,
  'English order badge must not use plural "1 orders"'
);
assert.ok(
  renderedSingleEn.includes('1 open order'),
  'English aria-label must use singular "1 open order"'
);

// Contrast with 2 items for plural check
const twoItemTables = [
  singleItemTable,
  {
    id: 'tbl-single-2',
    name: 'Second Table',
    table_code: 'ST2',
    capacity: 2,
    open_order_count: 2,
    unpaid_amount: 100000,
    floor_status: 'occupied',
    is_active: true,
    section: 'Main',
  },
];
const renderedTwoEn = renderToStaticMarkup(
  React.createElement(ShopTableFloorPlanCanvas, {
    tables: twoItemTables,
    locale: 'en',
  })
);
assert.ok(renderedTwoEn.includes('(2 tables)'), 'English legend plural (2 tables)');
assert.ok(renderedTwoEn.includes('title="2 seats"'), 'English capacity plural 2 seats');
assert.ok(renderedTwoEn.includes('2 orders in progress'), 'English metric plural 2 orders in progress');
assert.ok(renderedTwoEn.includes('2 orders'), 'English order badge plural 2 orders');
assert.ok(renderedTwoEn.includes('2 open orders'), 'English aria-label plural 2 open orders');

// 7.5 Valid section spacing class: replace py-0.2 with py-0.5
assert.equal(
  renderedSingleEn.includes('py-0.2'),
  false,
  'Markup must not include invalid Tailwind utility py-0.2'
);
assert.ok(
  renderedSingleEn.includes('py-0.5'),
  'Section badge must use valid Tailwind spacing utility py-0.5'
);
assert.equal(
  renderedVi.includes('py-0.2'),
  false,
  'Existing VI render must not include invalid Tailwind utility py-0.2'
);

console.log(
  'PASS: unknown status consistency, malformed numeric values, blank labels, 1-item English labels, and valid section spacing class'
);

// --- Test Suite 8: Coordinate Conversion & Clamping QA Coverage ---
// 8.1 Clamping bounds constants and boundaries
assert.equal(CANVAS_BOUNDS.minX, 7);
assert.equal(CANVAS_BOUNDS.maxX, 93);
assert.equal(CANVAS_BOUNDS.minY, 9);
assert.equal(CANVAS_BOUNDS.maxY, 91);

assert.deepEqual(clampTableCoordinates(0, 0), { x: 7, y: 9 });
assert.deepEqual(clampTableCoordinates(100, 100), { x: 93, y: 91 });
assert.deepEqual(clampTableCoordinates(-20, 120), { x: 7, y: 91 });
assert.deepEqual(clampTableCoordinates(50, 50), { x: 50, y: 50 });
assert.deepEqual(clampTableCoordinates(25.432, 60.876), { x: 25.4, y: 60.9 });

// 8.2 Keyboard 2 percentage point step clamping
// Left / Right bounds
assert.equal(clampTableCoordinateX(7 - 2), 7, 'ArrowLeft at min bound clamps to 7');
assert.equal(clampTableCoordinateX(8 - 2), 7, 'ArrowLeft from 8 clamps to 7');
assert.equal(clampTableCoordinateX(50 - 2), 48, 'ArrowLeft moves by 2');
assert.equal(clampTableCoordinateX(50 + 2), 52, 'ArrowRight moves by 2');
assert.equal(clampTableCoordinateX(92 + 2), 93, 'ArrowRight from 92 clamps to 93');
assert.equal(clampTableCoordinateX(93 + 2), 93, 'ArrowRight at max bound clamps to 93');

// Up / Down bounds
assert.equal(clampTableCoordinateY(9 - 2), 9, 'ArrowUp at min bound clamps to 9');
assert.equal(clampTableCoordinateY(10 - 2), 9, 'ArrowUp from 10 clamps to 9');
assert.equal(clampTableCoordinateY(50 - 2), 48, 'ArrowUp moves by 2');
assert.equal(clampTableCoordinateY(50 + 2), 52, 'ArrowDown moves by 2');
assert.equal(clampTableCoordinateY(90.5 + 2), 91, 'ArrowDown from 90.5 clamps to 91');
assert.equal(clampTableCoordinateY(91 + 2), 91, 'ArrowDown at max bound clamps to 91');

// 8.3 Coordinate conversion from pointer drag delta
const mockSurface = { left: 100, top: 100, width: 800, height: 500 };
// Pointer moves +80px (+10%) in X, -50px (-10%) in Y from start (50, 50)
const convertedNormal = convertPointToCanvasCoordinates(
  { clientX: 180, clientY: 50 },
  mockSurface,
  { clientX: 100, clientY: 100, startX: 50, startY: 50 }
);
assert.deepEqual(convertedNormal, { x: 60, y: 40 });

// Pointer drag delta that exceeds max bounds on medium 800x500 canvas
const convertedOverflow = convertPointToCanvasCoordinates(
  { clientX: 600, clientY: 500 },
  mockSurface,
  { clientX: 100, clientY: 100, startX: 50, startY: 50 }
);
// dx = +500px (+62.5%) -> 50 + 62.5 = 112.5 -> clamped to safe bound 90
// dy = +400px (+80%) -> 50 + 80 = 130 -> clamped to safe bound 87.2
assert.deepEqual(convertedOverflow, { x: 90, y: 87.2 });

// Pointer drag delta that exceeds min bounds on medium 800x500 canvas
const convertedUnderflow = convertPointToCanvasCoordinates(
  { clientX: -400, clientY: -400 },
  mockSurface,
  { clientX: 100, clientY: 100, startX: 50, startY: 50 }
);
assert.deepEqual(convertedUnderflow, { x: 10, y: 12.8 });

// On wide desktop canvas (1200x680), clamps to base coordinates (93, 91) and (7, 9)
const mockDesktopSurface = { left: 100, top: 100, width: 1200, height: 680 };
const desktopOverflow = convertPointToCanvasCoordinates(
  { clientX: 2000, clientY: 2000 },
  mockDesktopSurface,
  { clientX: 100, clientY: 100, startX: 50, startY: 50 }
);
assert.deepEqual(desktopOverflow, { x: 93, y: 91 });

const desktopUnderflow = convertPointToCanvasCoordinates(
  { clientX: -800, clientY: -800 },
  mockDesktopSurface,
  { clientX: 100, clientY: 100, startX: 50, startY: 50 }
);
assert.deepEqual(desktopUnderflow, { x: 7, y: 9 });

// Direct surface point conversion without drag delta
const convertedCenter = convertPointToCanvasCoordinates(
  { clientX: 500, clientY: 350 },
  mockSurface
);
assert.deepEqual(convertedCenter, { x: 50, y: 50 });

// Degenerate surface size (e.g. unmounted/zero-size)
const convertedZeroSize = convertPointToCanvasCoordinates(
  { clientX: 100, clientY: 100 },
  { left: 0, top: 0, width: 0, height: 0 }
);
assert.deepEqual(convertedZeroSize, { x: 50, y: 50 });

console.log('PASS: coordinate conversion and clamping QA coverage');

// --- Test Suite 9: Server-Rendered Movable and Read-Only State QA Coverage ---
// 9.1 Movable state (when onMoveTable callback exists)
const movableHtmlVi = renderToStaticMarkup(
  React.createElement(ShopTableFloorPlanCanvas, {
    tables: sampleTables,
    selectedTableId: 'tbl-waiting',
    onMoveTable: () => {},
    locale: 'vi',
  })
);

// All markers render native <button type="button"> with data-draggable="true"
assert.match(
  movableHtmlVi,
  /<button[^>]*type="button"[^>]*data-testid="floor-plan-marker-tbl-free"[^>]*data-draggable="true"/
);
assert.match(
  movableHtmlVi,
  /<button[^>]*type="button"[^>]*data-testid="floor-plan-marker-tbl-waiting"[^>]*data-draggable="true"/
);
// Drag cursor grab present
assert.ok(movableHtmlVi.includes('cursor-grab'), 'Movable canvas has cursor-grab');
// Accessible hints present in Vietnamese
assert.ok(
  movableHtmlVi.includes('Kéo hoặc dùng phím mũi tên để di chuyển vị trí'),
  'VI accessible hint in aria-label'
);
assert.ok(
  movableHtmlVi.includes('Dùng phím mũi tên hoặc kéo để di chuyển vị trí bàn'),
  'VI accessible hint in aria-description'
);
// Touch and select none styling present
assert.ok(movableHtmlVi.includes('touch-action:none'), 'Touch action none present');
assert.ok(movableHtmlVi.includes('user-select:none'), 'User select none present');

// 9.2 Movable state in English
const movableHtmlEn = renderToStaticMarkup(
  React.createElement(ShopTableFloorPlanCanvas, {
    tables: sampleTables,
    onMoveTable: () => {},
    locale: 'en',
  })
);
assert.ok(
  movableHtmlEn.includes('Drag or use arrow keys to move position'),
  'EN accessible hint in aria-label'
);
assert.ok(
  movableHtmlEn.includes('Use arrow keys or drag to move table position'),
  'EN accessible hint in aria-description'
);

// 9.3 Combined selectable + movable canvas
const combinedHtml = renderToStaticMarkup(
  React.createElement(ShopTableFloorPlanCanvas, {
    tables: sampleTables,
    selectedTableId: 'tbl-waiting',
    onSelectTable: () => {},
    onMoveTable: () => {},
    locale: 'vi',
  })
);
assert.ok(combinedHtml.includes('aria-pressed="true"'), 'Selected table has aria-pressed');
assert.ok(combinedHtml.includes('data-draggable="true"'), 'Movable has data-draggable true');
assert.ok(combinedHtml.includes('cursor-grab'), 'Drag cursor grab takes priority when movable');

// 9.4 Read-only canvas (no onMoveTable) stays strictly read-only for position
const readOnlyHtml = renderToStaticMarkup(
  React.createElement(ShopTableFloorPlanCanvas, {
    tables: sampleTables,
    locale: 'vi',
  })
);
assert.ok(readOnlyHtml.includes('data-draggable="false"'), 'Read-only has data-draggable false');
assert.equal(readOnlyHtml.includes('cursor-grab'), false, 'Read-only must not have cursor-grab');
assert.equal(readOnlyHtml.includes('cursor-grabbing'), false, 'Read-only must not have cursor-grabbing');
assert.equal(
  readOnlyHtml.includes('Kéo hoặc dùng phím mũi tên để di chuyển'),
  false,
  'Read-only must not contain drag accessible hint'
);

console.log('PASS: server-rendered movable and read-only state QA coverage');

// --- Test Suite 10: Post-Drag Click Suppression Lifecycle & Activation QA Coverage ---
{
  const guard = createPostDragClickGuard();

  // 10.1 Immediate pointer click for the completed drag is suppressed
  guard.arm('tbl-dragged-1');
  assert.equal(guard.isArmed('tbl-dragged-1'), true, 'Guard should be armed for dragged table');
  assert.equal(
    guard.shouldSuppressClick('tbl-dragged-1', { detail: 1 }),
    true,
    'Immediate pointer click for completed drag must be suppressed'
  );

  // 10.2 Immediate click consumes the guard: subsequent pointer click is NOT suppressed
  assert.equal(guard.isArmed(), false, 'Guard must be cleared after suppressing immediate click');
  assert.equal(
    guard.shouldSuppressClick('tbl-dragged-1', { detail: 1 }),
    false,
    'Subsequent pointer click on the dragged table must not be suppressed'
  );

  // 10.3 Click on a different table is NOT suppressed
  guard.arm('tbl-dragged-1');
  assert.equal(
    guard.shouldSuppressClick('tbl-other', { detail: 1 }),
    false,
    'Click on a different table must not be suppressed'
  );
  guard.clear();

  // 10.4 Keyboard activation (detail === 0) is NEVER suppressed
  guard.arm('tbl-dragged-1');
  assert.equal(
    guard.shouldSuppressClick('tbl-dragged-1', { detail: 0 }),
    false,
    'Keyboard activation (detail 0, Space/Enter) must never be suppressed'
  );
  guard.clear();

  // 10.5 Prompt expiration: guard expires promptly if no click follows (e.g. outside release)
  guard.arm('tbl-dragged-2');
  assert.equal(guard.isArmed('tbl-dragged-2'), true, 'Guard armed for second table');
  // Wait for prompt expiration timer to fire
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(guard.isArmed(), false, 'Guard must expire promptly if no click follows');
  assert.equal(
    guard.shouldSuppressClick('tbl-dragged-2', { detail: 1 }),
    false,
    'Later user activation must not be swallowed after guard expired'
  );

  // 10.6 Cancel / pointerdown lifecycle resets the guard
  guard.arm('tbl-dragged-3');
  assert.equal(guard.isArmed('tbl-dragged-3'), true);
  guard.clear(); // Simulating pointerdown or pointercancel
  assert.equal(guard.isArmed(), false, 'clear() resets guard immediately');
  assert.equal(
    guard.shouldSuppressClick('tbl-dragged-3', { detail: 1 }),
    false,
    'Click after cancel/reset must not be suppressed'
  );

  // 10.7 Custom scheduler lifecycle cleanup verification
  let scheduled = 0;
  let cancelled = 0;
  const customGuard = createPostDragClickGuard(
    (fn) => {
      scheduled += 1;
      return setTimeout(fn, 100);
    },
    (id) => {
      cancelled += 1;
      clearTimeout(id);
    }
  );
  customGuard.arm('tbl-custom');
  assert.equal(scheduled, 1, 'Custom schedule function was called');
  customGuard.clear();
  assert.equal(cancelled, 1, 'Custom cancel function was called on clear()');

  // 10.8 Simulated user interaction flows on table markers
  const testTableA = { id: 'tbl-a', name: 'Bàn A', table_code: 'A1', is_active: true, floor_status: 'free' };
  const testTableB = { id: 'tbl-b', name: 'Bàn B', table_code: 'B1', is_active: true, floor_status: 'free' };
  let selected = null;
  const simulatedGuard = createPostDragClickGuard();
  const handleMarkerClick = (table, event) => {
    if (simulatedGuard.shouldSuppressClick(table.id, event)) return;
    selected = table;
  };

  // Scenario A: Normal pointer click selects table
  handleMarkerClick(testTableA, { detail: 1 });
  assert.equal(selected?.id, 'tbl-a', 'Normal click selects table');
  selected = null;

  // Scenario B: Completed drag suppresses immediate click without selecting
  simulatedGuard.arm(testTableA.id);
  handleMarkerClick(testTableA, { detail: 1 });
  assert.equal(selected, null, 'Drag release must not select table');

  // Scenario C: If drag emitted no click, later click activates table
  simulatedGuard.arm(testTableA.id);
  // No click followed drag; wait for expiration
  await new Promise((resolve) => setTimeout(resolve, 15));
  handleMarkerClick(testTableA, { detail: 1 });
  assert.equal(selected?.id, 'tbl-a', 'Later click selects table after prompt expiration');
  selected = null;

  // Scenario D: Keyboard Enter activation during armed state is never suppressed
  simulatedGuard.arm(testTableB.id);
  handleMarkerClick(testTableB, { detail: 0 });
  assert.equal(selected?.id, 'tbl-b', 'Keyboard activation (detail 0) selects table');

  console.log('PASS: post-drag click suppression guard immediate consumption, detail 0 bypass, and prompt expiration');
}

// --- Test Suite 11: Selected Marker Status Border & Selection Ring Preservation ---
{
  const renderedSelected = renderToStaticMarkup(
    React.createElement(ShopTableFloorPlanCanvas, {
      tables: sampleTables,
      selectedTableId: 'tbl-occupied',
      onSelectTable: () => {},
      locale: 'vi',
    })
  );

  const markerMatch = renderedSelected.match(
    /<button[^>]*data-testid="floor-plan-marker-tbl-occupied"[^>]*class="([^"]+)"/
  );
  assert.ok(markerMatch, 'Selected occupied marker must render');
  const classNames = markerMatch[1].split(/\s+/);

  // Status-specific border class must remain
  assert.ok(
    classNames.includes('border-sky-500/80'),
    'Selected occupied marker must preserve its status border class border-sky-500/80'
  );
  assert.ok(
    classNames.includes('dark:border-sky-500/80'),
    'Selected occupied marker must preserve its dark status border class dark:border-sky-500/80'
  );

  // Emerald selection ring must remain
  assert.ok(
    classNames.includes('ring-2') &&
      classNames.includes('ring-emerald-500') &&
      classNames.includes('ring-offset-2'),
    'Selected occupied marker must retain its emerald selection ring'
  );

  // Must NOT replace status border with emerald border
  assert.equal(
    classNames.includes('border-emerald-500'),
    false,
    'Selected occupied marker must not have border-emerald-500 overriding status border'
  );
  assert.equal(
    classNames.includes('dark:border-emerald-400'),
    false,
    'Selected occupied marker must not have dark:border-emerald-400 overriding status border'
  );

  // Non-interactive / read-only selected marker also preserves status border and selection ring
  const renderedReadOnlySelected = renderToStaticMarkup(
    React.createElement(ShopTableFloorPlanCanvas, {
      tables: sampleTables,
      selectedTableId: 'tbl-occupied',
      locale: 'vi',
    })
  );
  const readOnlyMatch = renderedReadOnlySelected.match(
    /<div[^>]*data-testid="floor-plan-marker-tbl-occupied"[^>]*class="([^"]+)"/
  );
  assert.ok(readOnlyMatch, 'Read-only selected occupied marker must render');
  const readOnlyClasses = readOnlyMatch[1].split(/\s+/);
  assert.ok(
    readOnlyClasses.includes('border-sky-500/80'),
    'Read-only selected occupied marker must preserve its status border class'
  );
  assert.ok(
    readOnlyClasses.includes('ring-emerald-500'),
    'Read-only selected occupied marker must retain emerald selection ring'
  );
  assert.equal(
    readOnlyClasses.includes('border-emerald-500'),
    false,
    'Read-only selected marker must not have border-emerald-500'
  );

  console.log(
    'PASS: selected occupied marker preserves status border class and emerald selection ring'
  );
}

// --- Test Suite 12: Responsive Canvas Bounds Helper & Mobile Clipping QA Coverage ---
{
  // 12.1 Pure helper getSafeCanvasBounds boundary checks
  // Empty, null, undefined, and non-positive surfaces return default CANVAS_BOUNDS (7/93, 9/91)
  assert.deepEqual(getSafeCanvasBounds(null), CANVAS_BOUNDS);
  assert.deepEqual(getSafeCanvasBounds(undefined), CANVAS_BOUNDS);
  assert.deepEqual(getSafeCanvasBounds({ width: 0, height: 0 }), CANVAS_BOUNDS);
  assert.deepEqual(getSafeCanvasBounds({ width: -10, height: 420 }), CANVAS_BOUNDS);
  assert.deepEqual(getSafeCanvasBounds({ width: 358, height: 0 }), CANVAS_BOUNDS);

  // 12.2 Mobile surface (358x420) keeps markers at least 80px from horizontal and 64px from vertical edges
  const mobileRect = { width: 358, height: 420 };
  const mobileBounds = getSafeCanvasBounds(mobileRect);

  // Verify horizontal distance in pixels is at least 80px
  const minLeftPx = (mobileBounds.minX / 100) * mobileRect.width;
  const minRightPx = (1 - mobileBounds.maxX / 100) * mobileRect.width;
  assert.ok(
    minLeftPx >= 80,
    `minLeftPx=${minLeftPx} must be at least 80px on 358px canvas`
  );
  assert.ok(
    minRightPx >= 80,
    `minRightPx=${minRightPx} must be at least 80px on 358px canvas`
  );

  // Verify vertical distance in pixels is at least 64px
  const minTopPx = (mobileBounds.minY / 100) * mobileRect.height;
  const minBottomPx = (1 - mobileBounds.maxY / 100) * mobileRect.height;
  assert.ok(
    minTopPx >= 64,
    `minTopPx=${minTopPx} must be at least 64px on 420px canvas`
  );
  assert.ok(
    minBottomPx >= 64,
    `minBottomPx=${minBottomPx} must be at least 64px on 420px canvas`
  );

  // Expected percentage bounds for 358x420 canvas: minX=22.4, maxX=77.6, minY=15.3, maxY=84.7
  assert.deepEqual(mobileBounds, {
    minX: 22.4,
    maxX: 77.6,
    minY: 15.3,
    maxY: 84.7,
  });

  // 12.3 Wide desktop canvas (1200x680): original 7/93 and 9/91 limits remain effective
  const desktopRect = { width: 1200, height: 680 };
  const desktopBounds = getSafeCanvasBounds(desktopRect);
  assert.deepEqual(desktopBounds, {
    minX: 7,
    maxX: 93,
    minY: 9,
    maxY: 91,
  });
  assert.equal(desktopBounds.minX, 7);
  assert.equal(desktopBounds.maxX, 93);
  assert.equal(desktopBounds.minY, 9);
  assert.equal(desktopBounds.maxY, 91);
  // Default edges are preserved (not moved inward) on wide desktop
  assert.equal(desktopBounds.minX, CANVAS_BOUNDS.minX, 'minX preserved on 1200x680');
  assert.equal(desktopBounds.maxX, CANVAS_BOUNDS.maxX, 'maxX preserved on 1200x680');
  assert.equal(desktopBounds.minY, CANVAS_BOUNDS.minY, 'minY preserved on 1200x680');
  assert.equal(desktopBounds.maxY, CANVAS_BOUNDS.maxY, 'maxY preserved on 1200x680');

  // Surface 1248x680 (viewport 1280x900) also preserves default edges
  const desktop1248Rect = { width: 1248, height: 680 };
  assert.deepEqual(getSafeCanvasBounds(desktop1248Rect), CANVAS_BOUNDS);

  // 12.3B Medium canvases (808x505 and 800x500): safe pixel margins keeping desktop markers inside
  // At viewport 840x700, canvas surface is 808x505; desktop marker is 144x113.5 (half 72x56.75)
  const medium808Rect = { width: 808, height: 505 };
  const bounds808 = getSafeCanvasBounds(medium808Rect);
  assert.deepEqual(bounds808, {
    minX: 10,
    maxX: 90,
    minY: 12.7,
    maxY: 87.3,
  });

  // Verify available horizontal pixel margins >= 80px
  const minLeft808Px = (bounds808.minX / 100) * medium808Rect.width;
  const minRight808Px = ((100 - bounds808.maxX) / 100) * medium808Rect.width;
  assert.ok(
    Math.round(minLeft808Px * 100) / 100 >= CANVAS_SAFE_MARGINS.horizontalPx,
    `minLeft808Px=${minLeft808Px} must be at least 80px on 808px canvas`
  );
  assert.ok(
    Math.round(minRight808Px * 100) / 100 >= CANVAS_SAFE_MARGINS.horizontalPx,
    `minRight808Px=${minRight808Px} must be at least 80px on 808px canvas`
  );

  // Verify available vertical pixel margins >= 64px
  const minTop808Px = (bounds808.minY / 100) * medium808Rect.height;
  const minBottom808Px = ((100 - bounds808.maxY) / 100) * medium808Rect.height;
  assert.ok(
    Math.round(minTop808Px * 100) / 100 >= CANVAS_SAFE_MARGINS.verticalPx,
    `minTop808Px=${minTop808Px} must be at least 64px on 505px canvas`
  );
  assert.ok(
    Math.round(minBottom808Px * 100) / 100 >= CANVAS_SAFE_MARGINS.verticalPx,
    `minBottom808Px=${minBottom808Px} must be at least 64px on 505px canvas`
  );

  // Desktop marker (144x113.5) bounding box is strictly within canvas surface (>0px clearance)
  assert.ok(
    minLeft808Px - 72 > 0,
    `Left clearance ${minLeft808Px - 72}px must be strictly positive`
  );
  assert.ok(
    minRight808Px - 72 > 0,
    `Right clearance ${minRight808Px - 72}px must be strictly positive`
  );
  assert.ok(
    minTop808Px - 56.75 > 0,
    `Top clearance ${minTop808Px - 56.75}px must be strictly positive`
  );
  assert.ok(
    minBottom808Px - 56.75 > 0,
    `Bottom clearance ${minBottom808Px - 56.75}px must be strictly positive`
  );

  // Default edges are moved inward only where needed
  assert.ok(bounds808.minX > CANVAS_BOUNDS.minX, 'minX moved inward on 808x505');
  assert.ok(bounds808.maxX < CANVAS_BOUNDS.maxX, 'maxX moved inward on 808x505');
  assert.ok(bounds808.minY > CANVAS_BOUNDS.minY, 'minY moved inward on 808x505');
  assert.ok(bounds808.maxY < CANVAS_BOUNDS.maxY, 'maxY moved inward on 808x505');

  // Surface 800x500 medium canvas boundary check
  const medium800Rect = { width: 800, height: 500 };
  const bounds800 = getSafeCanvasBounds(medium800Rect);
  assert.deepEqual(bounds800, {
    minX: 10,
    maxX: 90,
    minY: 12.8,
    maxY: 87.2,
  });

  const minLeft800Px = (bounds800.minX / 100) * medium800Rect.width;
  const minRight800Px = ((100 - bounds800.maxX) / 100) * medium800Rect.width;
  assert.ok(
    Math.round(minLeft800Px * 100) / 100 >= CANVAS_SAFE_MARGINS.horizontalPx,
    `minLeft800Px=${minLeft800Px} must be at least 80px on 800px canvas`
  );
  assert.ok(
    Math.round(minRight800Px * 100) / 100 >= CANVAS_SAFE_MARGINS.horizontalPx,
    `minRight800Px=${minRight800Px} must be at least 80px on 800px canvas`
  );

  const minTop800Px = (bounds800.minY / 100) * medium800Rect.height;
  const minBottom800Px = ((100 - bounds800.maxY) / 100) * medium800Rect.height;
  assert.ok(
    Math.round(minTop800Px * 100) / 100 >= CANVAS_SAFE_MARGINS.verticalPx,
    `minTop800Px=${minTop800Px} must be at least 64px on 500px canvas`
  );
  assert.ok(
    Math.round(minBottom800Px * 100) / 100 >= CANVAS_SAFE_MARGINS.verticalPx,
    `minBottom800Px=${minBottom800Px} must be at least 64px on 500px canvas`
  );

  assert.ok(
    minLeft800Px - 72 > 0,
    `Left clearance ${minLeft800Px - 72}px must be strictly positive on 800x500`
  );
  assert.ok(
    minRight800Px - 72 > 0,
    `Right clearance ${minRight800Px - 72}px must be strictly positive on 800x500`
  );
  assert.ok(
    minTop800Px - 56.75 > 0,
    `Top clearance ${minTop800Px - 56.75}px must be strictly positive on 800x500`
  );
  assert.ok(
    minBottom800Px - 56.75 > 0,
    `Bottom clearance ${minBottom800Px - 56.75}px must be strictly positive on 800x500`
  );

  assert.ok(bounds800.minX > CANVAS_BOUNDS.minX, 'minX moved inward on 800x500');
  assert.ok(bounds800.maxX < CANVAS_BOUNDS.maxX, 'maxX moved inward on 800x500');
  assert.ok(bounds800.minY > CANVAS_BOUNDS.minY, 'minY moved inward on 800x500');
  assert.ok(bounds800.maxY < CANVAS_BOUNDS.maxY, 'maxY moved inward on 800x500');

  // 12.4 Clamping alignment with clampTableCoordinates
  // Mobile canvas clamps coordinates inward to safe bounds
  assert.deepEqual(clampTableCoordinates(0, 0, mobileRect), { x: 22.4, y: 15.3 });
  assert.deepEqual(clampTableCoordinates(100, 100, mobileRect), { x: 77.6, y: 84.7 });
  // Older persisted coordinates at old limits (7, 9) clamp inward on mobile, preventing clipping
  assert.deepEqual(clampTableCoordinates(7, 9, mobileRect), { x: 22.4, y: 15.3 });
  assert.deepEqual(clampTableCoordinates(93, 91, mobileRect), { x: 77.6, y: 84.7 });
  // Centered coordinates remain unchanged
  assert.deepEqual(clampTableCoordinates(50, 50, mobileRect), { x: 50, y: 50 });

  // Medium canvas (808x505) clamps coordinates inward to safe bounds (10, 12.7)
  assert.deepEqual(clampTableCoordinates(0, 0, medium808Rect), { x: 10, y: 12.7 });
  assert.deepEqual(clampTableCoordinates(100, 100, medium808Rect), { x: 90, y: 87.3 });
  assert.deepEqual(clampTableCoordinates(7, 9, medium808Rect), { x: 10, y: 12.7 });
  assert.deepEqual(clampTableCoordinates(93, 91, medium808Rect), { x: 90, y: 87.3 });
  assert.deepEqual(clampTableCoordinates(50, 50, medium808Rect), { x: 50, y: 50 });

  // Wide desktop canvas preserves near-edge placement without forcing 20-80 range
  assert.deepEqual(clampTableCoordinates(0, 0, desktopRect), { x: 7, y: 9 });
  assert.deepEqual(clampTableCoordinates(100, 100, desktopRect), { x: 93, y: 91 });
  assert.deepEqual(clampTableCoordinates(7, 9, desktopRect), { x: 7, y: 9 });
  assert.deepEqual(clampTableCoordinates(93, 91, desktopRect), { x: 93, y: 91 });

  // 12.5 Pointer drag conversion alignment with convertPointToCanvasCoordinates on mobile
  const mobileSurfaceObj = { left: 16, top: 16, width: 358, height: 420 };
  // Underflow beyond top-left safe bounds clamps to (22.4, 15.3)
  const mobileUnderflow = convertPointToCanvasCoordinates(
    { clientX: -100, clientY: -100 },
    mobileSurfaceObj
  );
  assert.deepEqual(mobileUnderflow, { x: 22.4, y: 15.3 });

  // Overflow beyond bottom-right safe bounds clamps to (77.6, 84.7)
  const mobileOverflow = convertPointToCanvasCoordinates(
    { clientX: 999, clientY: 999 },
    mobileSurfaceObj
  );
  assert.deepEqual(mobileOverflow, { x: 77.6, y: 84.7 });

  // Drag starting from rendered center (22.4, 15.3): moves right by +35.8px (+10%)
  const mobileMoveRight = convertPointToCanvasCoordinates(
    { clientX: 135.8, clientY: 100 },
    mobileSurfaceObj,
    { clientX: 100, clientY: 100, startX: 22.4, startY: 15.3 }
  );
  assert.deepEqual(mobileMoveRight, { x: 32.4, y: 15.3 });

  // Drag moving toward edge reaches safe edge (22.4, 15.3) without a jump
  const mobileMoveLeft = convertPointToCanvasCoordinates(
    { clientX: 50, clientY: 100 },
    mobileSurfaceObj,
    { clientX: 100, clientY: 100, startX: 22.4, startY: 15.3 }
  );
  // dx = -50px (-13.97%) -> 22.4 - 13.97 = 8.43% -> clamps cleanly to safe edge 22.4%
  assert.deepEqual(mobileMoveLeft, { x: 22.4, y: 15.3 });

  // Pointer drag conversion alignment on medium canvas (808x505)
  const mediumSurfaceObj = { left: 16, top: 16, width: 808, height: 505 };
  const mediumUnderflow = convertPointToCanvasCoordinates(
    { clientX: -100, clientY: -100 },
    mediumSurfaceObj
  );
  assert.deepEqual(mediumUnderflow, { x: 10, y: 12.7 });
  const mediumMoveLeft = convertPointToCanvasCoordinates(
    { clientX: 50, clientY: 100 },
    mediumSurfaceObj,
    { clientX: 100, clientY: 100, startX: 10, startY: 12.7 }
  );
  assert.deepEqual(mediumMoveLeft, { x: 10, y: 12.7 });

  // 12.6 Keyboard arrow movement on mobile: starts from rendered center, not swallowed
  // Starting from rendered center 22.4%, ArrowRight immediately moves by +2%
  const arrowRightNext = clampTableCoordinateX(22.4 + 2, mobileRect);
  assert.equal(arrowRightNext, 24.4, 'ArrowRight advances immediately on mobile');
  // Repeated arrow presses smoothly advance
  const arrowRightNext2 = clampTableCoordinateX(24.4 + 2, mobileRect);
  assert.equal(arrowRightNext2, 26.4, 'Second ArrowRight advances to 26.4');
  // Moving toward left edge clamps to safe edge without a jump
  const arrowLeftClamped = clampTableCoordinateX(22.4 - 2, mobileRect);
  assert.equal(arrowLeftClamped, 22.4, 'ArrowLeft clamps to safe edge 22.4%');

  // Vertical arrow steps
  const arrowDownNext = clampTableCoordinateY(15.3 + 2, mobileRect);
  assert.equal(arrowDownNext, 17.3, 'ArrowDown advances immediately on mobile');
  const arrowUpClamped = clampTableCoordinateY(15.3 - 2, mobileRect);
  assert.equal(arrowUpClamped, 15.3, 'ArrowUp clamps to safe edge 15.3%');

  // Keyboard arrow movement on medium canvas (808x505)
  const mediumArrowRight = clampTableCoordinateX(10 + 2, medium808Rect);
  assert.equal(mediumArrowRight, 12, 'ArrowRight advances from 10 to 12 on medium canvas');
  const mediumArrowLeftClamped = clampTableCoordinateX(10 - 2, medium808Rect);
  assert.equal(mediumArrowLeftClamped, 10, 'ArrowLeft clamps to safe edge 10% on medium canvas');
  const mediumArrowDown = clampTableCoordinateY(12.7 + 2, medium808Rect);
  assert.equal(mediumArrowDown, 14.7, 'ArrowDown advances from 12.7 to 14.7 on medium canvas');
  const mediumArrowUpClamped = clampTableCoordinateY(12.7 - 2, medium808Rect);
  assert.equal(mediumArrowUpClamped, 12.7, 'ArrowUp clamps to safe edge 12.7% on medium canvas');

  // 12.7 Server-rendered mobile canvas with surfaceDimensions: { width: 358, height: 420 }
  // A table with older persisted coordinates (7, 9) renders clamped inward at safe bounds
  const edgeTable = {
    id: 'tbl-edge-clipping',
    name: 'Bàn Cận Rìa',
    table_code: 'EDGE01',
    layout_x: 7,
    layout_y: 9,
    floor_status: 'free',
    is_active: true,
  };
  const mobileHtml = renderToStaticMarkup(
    React.createElement(ShopTableFloorPlanCanvas, {
      tables: [edgeTable],
      surfaceDimensions: { width: 358, height: 420 },
      locale: 'vi',
    })
  );

  // Position is rendered as left: 22.4%; top: 15.3% (not left: 7%; top: 9%)
  assert.match(
    mobileHtml,
    /left:22\.4%/,
    'Mobile marker left coordinate must be clamped to safe 22.4%'
  );
  assert.match(
    mobileHtml,
    /top:15\.3%/,
    'Mobile marker top coordinate must be clamped to safe 15.3%'
  );

  // Marker has 112px width (w-28, half-width 56px).
  // At 22.4% of 358px: center is 80.192px.
  // Left bounding box start: 80.192 - 56 = 24.192px > 0px (strictly inside visible canvas surface).
  // Right bounding box end: 80.192 + 56 = 136.192px < 358px (strictly inside visible canvas surface).
  const markerCenterPx = (22.4 / 100) * 358;
  const markerLeftEdgePx = markerCenterPx - 56;
  const markerRightEdgePx = markerCenterPx + 56;
  assert.ok(
    markerLeftEdgePx > 0,
    `markerLeftEdgePx=${markerLeftEdgePx} must be strictly inside canvas (> 0)`
  );
  assert.ok(
    markerRightEdgePx < 358,
    `markerRightEdgePx=${markerRightEdgePx} must be strictly inside canvas (< 358)`
  );

  // 12.8 Server-rendered desktop canvas with surfaceDimensions: { width: 1200, height: 680 }
  // Table with persisted coordinates (7, 9) renders at left: 7%; top: 9%
  const desktopHtml = renderToStaticMarkup(
    React.createElement(ShopTableFloorPlanCanvas, {
      tables: [edgeTable],
      surfaceDimensions: { width: 1200, height: 680 },
      locale: 'vi',
    })
  );
  assert.match(
    desktopHtml,
    /left:7%/,
    'Desktop marker preserves near-edge 7% placement'
  );
  assert.match(
    desktopHtml,
    /top:9%/,
    'Desktop marker preserves near-edge 9% placement'
  );

  // 12.9 Server-rendered medium canvas with surfaceDimensions: { width: 808, height: 505 }
  // Table with persisted coordinates (7, 9) renders clamped inward at safe bounds (10%, 12.7%)
  const mediumHtml = renderToStaticMarkup(
    React.createElement(ShopTableFloorPlanCanvas, {
      tables: [edgeTable],
      surfaceDimensions: { width: 808, height: 505 },
      locale: 'vi',
    })
  );
  assert.match(
    mediumHtml,
    /left:10%/,
    'Medium canvas marker left coordinate clamped to safe 10%'
  );
  assert.match(
    mediumHtml,
    /top:12\.7%/,
    'Medium canvas marker top coordinate clamped to safe 12.7%'
  );

  // Desktop marker (144x113.5, half 72x56.75) bounding box verification on 808x505
  const center808XPx = (10 / 100) * 808;
  const leftEdge808Px = center808XPx - 72;
  const rightEdge808Px = center808XPx + 72;
  assert.ok(
    leftEdge808Px > 0,
    `leftEdge808Px=${leftEdge808Px} must be strictly inside canvas (> 0)`
  );
  assert.ok(
    rightEdge808Px < 808,
    `rightEdge808Px=${rightEdge808Px} must be strictly inside canvas (< 808)`
  );

  const center808YPx = (12.7 / 100) * 505;
  const topEdge808Px = center808YPx - 56.75;
  const bottomEdge808Px = center808YPx + 56.75;
  assert.ok(
    topEdge808Px > 0,
    `topEdge808Px=${topEdge808Px} must be strictly inside canvas (> 0)`
  );
  assert.ok(
    bottomEdge808Px < 505,
    `bottomEdge808Px=${bottomEdge808Px} must be strictly inside canvas (< 505)`
  );

  console.log(
    'PASS: responsive canvas bounds helper and mobile clipping QA coverage'
  );
}
