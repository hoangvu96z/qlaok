import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.resolve(rel), 'utf8');

test('ShopTableManager integrates floor plan API with guarded fetch and stale-shop safety', () => {
  const src = read('src/components/dashboard/ShopTableManager.tsx');

  // Contract: imports ShopTableFloorPlanCanvas
  assert.match(
    src,
    /import\s*\{[^}]*ShopTableFloorPlanCanvas[^}]*\}\s*from\s*['"]@\/components\/ShopTableFloorPlanCanvas['"]/
  );

  // Authenticated, un-cached floor-plan fetch with shopId parameter
  assert.match(
    src,
    /\/api\/tables\/floor-plan\?shopId=\$\{encodeURIComponent\(currentShopId\)\}/
  );
  assert.match(src, /headers:\s*getAuthHeaders\(\)/);
  assert.match(src, /cache:\s*['"]no-store['"]/);

  // Stale-shop response safety & request sequence guards
  assert.match(src, /activeShopIdRef\.current !== currentShopId/);
  assert.match(src, /seq !== floorSeqRef\.current/);

  // Refresh loads both table list and floor summaries
  assert.match(
    src,
    /const handleRefresh = useCallback\(async \(\) => \{\s*await Promise\.all\(\[fetchTables\(\), fetchFloorPlan\(\)\]\);/
  );

  // Floor summaries refreshed after mutations (create, edit, activate/deactivate/archive/restore)
  const floorPlanFetchCalls = (src.match(/fetchFloorPlan\(\)/g) || []).length;
  // initial mount + handleRefresh + handleCreateTable + handleSaveEditTable + handlePatchTableState >= 5
  assert.ok(
    floorPlanFetchCalls >= 5,
    `Expected at least 5 fetchFloorPlan() invocations across lifecycle, refresh, and mutations, got ${floorPlanFetchCalls}`
  );
});

test('ShopTableManager section filtering, list/map toggle, and selection synchronization adhere to specifications', () => {
  const src = read('src/components/dashboard/ShopTableManager.tsx');

  // Section filter dropdown with localized All sections
  assert.match(src, /data-testid="table-section-filter"/);
  assert.match(
    src,
    /tx\(['"]Tất cả khu vực['"],\s*['"]All sections['"]\)/
  );

  // List and Map toggle controls
  assert.match(src, /data-testid="table-view-mode-list"/);
  assert.match(src, /data-testid="table-view-mode-map"/);

  // Archived view keeps list mode and disables map toggle
  assert.match(
    src,
    /setViewFilter\(['"]archived['"]\);\s*setViewMode\(['"]list['"]\);/
  );
  assert.match(src, /disabled=\{viewFilter === ['"]archived['"]\}/);

  // Map view receives only non-archived floor items matching section filter
  assert.match(
    src,
    /const visibleFloorTables = useMemo\(\(\) => \{[\s\S]*?floorTables\.filter\(\(tb\) => !tb\.is_archived\)[\s\S]*?selectedSection && selectedSection !== ['"]ALL['"][\s\S]*?return list;[\s\S]*?\}, \[floorTables, selectedSection\]\);/
  );

  // Map selection synchronizes with selectedQrTableId for existing QR preview
  assert.match(
    src,
    /<ShopTableFloorPlanCanvas[\s\S]*?tables=\{visibleFloorTables\}[\s\S]*?selectedTableId=\{selectedQrTableId\}[\s\S]*?onSelectTable=\{\(item\) => setSelectedQrTableId\(item\.id\)\}/
  );

  // Renders clear loading, error with retry, and empty states
  assert.match(src, /data-testid="floor-plan-loading"/);
  assert.match(src, /data-testid="floor-plan-error"/);
  assert.match(src, /data-testid="floor-plan-retry-btn"/);
  assert.match(src, /data-testid="floor-plan-empty"/);

  // Bilingual strings using tx
  assert.match(
    src,
    /tx\(\s*['"]Đang tải sơ đồ bàn & trạng thái đơn hàng\.\.\.['"],\s*['"]Loading floor plan and order statuses\.\.\.['"]\s*\)/
  );
  assert.match(
    src,
    /tx\(\s*['"]Không thể tải sơ đồ bàn['"],\s*['"]Could not load floor plan['"]\s*\)/
  );
  assert.match(
    src,
    /tx\(\s*['"]Chưa có dữ liệu sơ đồ bàn cho quán['"],\s*['"]No table floor plan data available['"]\s*\)/
  );
});

test('ShopTableManager implements manager-only drag callback, PATCH payload/headers, coordinate rollback, and no QR-signature fabrication', () => {
  const src = read('src/components/dashboard/ShopTableManager.tsx');

  // 1. Manager-only drag callback & canvas wiring
  assert.match(
    src,
    /onMoveTable=\{canManageTables \? handleMoveTable : undefined\}/,
    'Canvas must receive onMoveTable callback only when canManageTables is true'
  );
  assert.match(
    src,
    /if \(!canManageTables\) return;/,
    'Callback must guard manager permission directly'
  );
  assert.match(
    src,
    /!Number\.isFinite\(position\.x\)\s*\|\|\s*!Number\.isFinite\(position\.y\)/,
    'Move callback must guard finite coordinate values'
  );
  assert.match(
    src,
    /Math\.round\(position\.x\)/,
    'Move callback must round x to integer percentage'
  );
  assert.match(
    src,
    /Math\.round\(position\.y\)/,
    'Move callback must round y to integer percentage'
  );

  // 2. Overlapping write protection, optimistic update & PATCH payload/headers
  assert.match(
    src,
    /layoutSavingRef\.current/,
    'Must guard against overlapping layout writes'
  );
  assert.match(
    src,
    /setFloorTables\(\(prev\) =>\s*prev\.map\(\(item\) =>\s*item\.id === table\.id\s*\?\s*\{\s*\.\.\.item,\s*layout_x:\s*nextX,\s*layout_y:\s*nextY\s*\}\s*:\s*item\s*\)\s*\);/,
    'Must optimistically update only the moved table in floorTables'
  );
  assert.match(
    src,
    /fetch\(['"]\/api\/tables['"],\s*\{\s*method:\s*['"]PATCH['"]/,
    'Must PATCH /api/tables'
  );
  assert.match(
    src,
    /['"]Content-Type['"]:\s*['"]application\/json['"]/,
    'Must include Content-Type application/json header'
  );
  assert.match(
    src,
    /\.\.\.getAuthHeaders\(\)|getAuthHeaders\(\)/,
    'Must include authenticated getAuthHeaders'
  );
  assert.match(
    src,
    /shop_id:\s*currentShopId,\s*id:\s*table\.id,\s*layout_x:\s*nextX,\s*layout_y:\s*nextY/,
    'Must send required shop_id, id, layout_x, and layout_y JSON payload'
  );

  // 3. Stale-shop guard, response validation, saving indicator & rollback
  assert.match(
    src,
    /activeShopIdRef\.current !== currentShopId/,
    'Must reject stale-shop completion after move PATCH'
  );
  assert.match(
    src,
    /data\.table\.id !== table\.id/,
    'Must validate exact table identity in success response'
  );
  assert.match(
    src,
    /data-testid="floor-plan-saving-indicator"/,
    'Must render a localized floor plan saving indicator'
  );
  assert.match(
    src,
    /tx\(\s*['"]Đang lưu vị trí bàn\.\.\.['"],\s*['"]Saving table position\.\.\.['"]\s*\)/,
    'Must show localized saving indicator text'
  );
  assert.match(
    src,
    /layout_x:\s*priorX,\s*layout_y:\s*priorY/,
    'Must roll coordinates back to prior values on error or invalid response'
  );
  assert.match(
    src,
    /setActionError\(/,
    'Must display a localized action error on failure'
  );

  // 4. No success popup after move
  const moveHandlerMatch = src.match(/const handleMoveTable =[\s\S]*?\n  \};/);
  assert.ok(moveHandlerMatch, 'handleMoveTable must be defined');
  assert.doesNotMatch(
    moveHandlerMatch[0],
    /setActionSuccess/,
    'Must not show success popup after every move'
  );

  // 5. No QR-signature fabrication from floor plan GET data
  assert.doesNotMatch(
    src,
    /as ShopTable/,
    'Must not cast or fabricate ShopTable from floor-plan GET data'
  );
  assert.match(
    src,
    /const selectedQrTable = useMemo\(\(\) => \{\s*if \(!selectedQrTableId\) return null;\s*return sortedTables\.find\(\(tb\) => tb\.id === selectedQrTableId\) \?\? null;\s*\}, \[sortedTables, selectedQrTableId\]\);/,
    'selectedQrTable must use only the full table object from existing table list'
  );
});
