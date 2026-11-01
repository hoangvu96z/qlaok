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
  dbGetShopTables,
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

test('dbGetShopTables rejects with LOCAL_TABLES_STORE_READ_FAILED when store JSON is malformed and no memory fallback exists', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qlaok-store-malformed-'));
  const filePath = path.join(tempDir, 'malformed-tables.json');
  fs.writeFileSync(filePath, '{ invalid_json: ');

  setShopTablesDbClientForTests(null, false);
  setShopTablesFileForTests(filePath);

  try {
    await assert.rejects(
      dbGetShopTables('shop-fnb-001'),
      /LOCAL_TABLES_STORE_READ_FAILED/
    );
  } finally {
    setShopTablesFileForTests(null);
    setShopTablesDbClientForTests(null);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('dbGetShopTables does not seed a missing local tables store in production', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qlaok-store-missing-'));
  const filePath = path.join(tempDir, 'tables.json');
  const originalNodeEnv = process.env.NODE_ENV;

  setShopTablesDbClientForTests(null, false);
  setShopTablesFileForTests(filePath);
  Object.assign(process.env, { NODE_ENV: 'production' });

  try {
    await assert.rejects(
      dbGetShopTables('shop-fnb-001'),
      /LOCAL_TABLES_STORE_MISSING/
    );
    assert.equal(fs.existsSync(filePath), false);
  } finally {
    if (originalNodeEnv === undefined) {
      Reflect.deleteProperty(process.env, 'NODE_ENV');
    } else {
      Object.assign(process.env, { NODE_ENV: originalNodeEnv });
    }
    setShopTablesFileForTests(null);
    setShopTablesDbClientForTests(null);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('dbGetShopTables rejects when local store file is missing and bootstrap persistence fails', async () => {
  const { tempDir, filePath } = createBlockedStorePath();
  setShopTablesDbClientForTests(null, false);
  setShopTablesFileForTests(filePath);

  try {
    await assert.rejects(
      dbGetShopTables('shop-fnb-001')
    );
  } finally {
    setShopTablesFileForTests(null);
    setShopTablesDbClientForTests(null);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
