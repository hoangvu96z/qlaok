import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import {
  dbCreateShopTable,
  dbGetShopTables,
  dbUpdateShopTable,
  getLocalTablesFilePath,
  setShopTablesDbClientForTests,
  setShopTablesFileForTests,
} from '@/lib/shop-tables';

const originalCwd = process.cwd();
const fakeWorkspaceRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), 'qlaok-dev-workspace-fixture-')
);
const customOverrideDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'qlaok-table-override-fixture-')
);

after(() => {
  process.chdir(originalCwd);
  setShopTablesFileForTests(null);
  setShopTablesDbClientForTests(null);
  const processStorePath = getLocalTablesFilePath();
  if (processStorePath.startsWith(os.tmpdir())) {
    fs.rmSync(path.dirname(processStorePath), { recursive: true, force: true });
  }
  fs.rmSync(fakeWorkspaceRoot, { recursive: true, force: true });
  fs.rmSync(customOverrideDir, { recursive: true, force: true });
});

test('Node test process isolates shop-tables store in os.tmpdir() and never reads or mutates process.cwd()/.local-db/shop-tables.json', async () => {
  setShopTablesDbClientForTests(null);
  setShopTablesFileForTests(null);

  const rootDevStorePath = path.join(
    originalCwd,
    '.local-db',
    'shop-tables.json'
  );
  const activeTestPath = getLocalTablesFilePath();

  assert.notEqual(
    path.resolve(activeTestPath),
    path.resolve(rootDevStorePath),
    'Node test store path must not point to workspace .local-db/shop-tables.json'
  );
  assert.ok(
    path.resolve(activeTestPath).startsWith(path.resolve(os.tmpdir())),
    'Node test store path must live under os.tmpdir()'
  );

  // Create a fake developer .local-db/shop-tables.json in a temporary cwd fixture
  const fakeDevLocalDbDir = path.join(fakeWorkspaceRoot, '.local-db');
  const fakeDevTablesFile = path.join(fakeDevLocalDbDir, 'shop-tables.json');
  fs.mkdirSync(fakeDevLocalDbDir, { recursive: true });
  const sentinelContent = JSON.stringify(
    {
      tables: [
        {
          id: 'dev-sentinel-table',
          shop_id: 'shop-fnb-001',
          table_code: 'DEV-99',
          name: 'Bàn Dữ Liệu Developer',
          is_active: true,
          is_archived: false,
        },
      ],
    },
    null,
    2
  );
  fs.writeFileSync(fakeDevTablesFile, sentinelContent, 'utf8');

  process.chdir(fakeWorkspaceRoot);

  // Reading, creating, and updating tables in a Node test must use the isolated process temp file
  const initialTables = await dbGetShopTables('shop-fnb-001', {
    includeInactive: true,
    includeArchived: true,
  });
  assert.ok(
    !initialTables.some((t) => t.id === 'dev-sentinel-table'),
    'Node test must not read developer .local-db/shop-tables.json from process.cwd()'
  );

  const created = await dbCreateShopTable({
    shop_id: 'shop-fnb-001',
    name: 'Bàn Test Cô Lập',
    table_code: 'ISO-01',
  });
  await dbUpdateShopTable({
    shop_id: 'shop-fnb-001',
    id: created.id,
    name: 'Bàn Test Cô Lập (Đã Sửa)',
  });

  // Verify the developer .local-db/shop-tables.json file in process.cwd() was completely untouched
  assert.equal(
    fs.readFileSync(fakeDevTablesFile, 'utf8'),
    sentinelContent,
    'Developer .local-db/shop-tables.json must remain byte-for-byte untouched after test mutations'
  );

  // Verify optional explicit test file override also works and resets cleanly
  const explicitFile = path.join(customOverrideDir, 'custom-tables.json');
  setShopTablesFileForTests(explicitFile);
  assert.equal(getLocalTablesFilePath(), explicitFile);
  await dbCreateShopTable({
    shop_id: 'shop-fnb-001',
    name: 'Bàn Custom Override',
    table_code: 'OVR-01',
  });
  assert.ok(fs.existsSync(explicitFile));

  setShopTablesFileForTests(null);
  assert.equal(getLocalTablesFilePath(), activeTestPath);
});
