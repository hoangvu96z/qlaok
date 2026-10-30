import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  setItemStockMetadata,
  setMposDbClientForTests,
  setMposStoreFileForTests,
} from '@/lib/mpos-store';
import {
  dbCreateShopTable,
  setShopTablesDbClientForTests,
  setShopTablesFileForTests,
} from '@/lib/shop-tables';

function createBlockedStorePath() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qlaok-store-write-'));
  const blockerFile = path.join(tempDir, 'not-a-directory');
  fs.writeFileSync(blockerFile, 'block');

  return {
    tempDir,
    filePath: path.join(blockerFile, 'store.json'),
  };
}

test('mPOS local mutation rejects when its store cannot be persisted', async () => {
  const { tempDir, filePath } = createBlockedStorePath();
  setMposDbClientForTests(null, false);
  setMposStoreFileForTests(filePath);

  try {
    await assert.rejects(
      setItemStockMetadata('item-write-failure', 4),
      /MPOS_STORE_WRITE_FAILED/
    );
  } finally {
    setMposStoreFileForTests(null);
    setMposDbClientForTests(null);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('shop table creation rejects when its local store cannot be persisted', async () => {
  const { tempDir, filePath } = createBlockedStorePath();
  setShopTablesDbClientForTests(null, false);
  setShopTablesFileForTests(filePath);

  try {
    await assert.rejects(
      dbCreateShopTable({
        shop_id: 'shop-write-failure',
        name: 'QA write failure table',
        table_code: 'QA-WRITE-FAILURE',
      })
    );
  } finally {
    setShopTablesFileForTests(null);
    setShopTablesDbClientForTests(null);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
