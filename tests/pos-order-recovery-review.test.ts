import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearPendingPosOrder,
  clearConfirmedPosOrder,
  POS_RECOVERY_STORE_NAME,
  posRecoveryStorageKey,
  readPendingPosOrder,
  savePendingPosOrder,
  sendPendingPosOrder,
  withPosRecoveryLock,
  type PendingPosOrder,
  type PosRecoveryIndexedDb,
  type PosRecoveryStorage,
} from '@/lib/pos-order-recovery';

function legacyStorage(): PosRecoveryStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

function indexedDbStore(): { idb: PosRecoveryIndexedDb; setRaw: (key: string, value: unknown) => void; getRaw: (key: string) => unknown } {
  const stores = new Map<string, Map<string, unknown>>();
  let txChain = Promise.resolve();

  const idb: PosRecoveryIndexedDb = {
    open: (_name: string, _version?: number) => {
      const openReq: Record<string, unknown> = {
        result: null,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      };
      queueMicrotask(() => {
        const db: Record<string, unknown> = {
          onversionchange: null,
          objectStoreNames: {
            contains: (storeName: string) => stores.has(storeName),
          },
          createObjectStore: (storeName: string) => {
            if (!stores.has(storeName)) stores.set(storeName, new Map());
            return {};
          },
          close: () => {},
          transaction: (storeName: string, _mode?: IDBTransactionMode) => {
            if (!stores.has(storeName)) throw new Error(`Missing object store ${storeName}`);
            const backing = stores.get(storeName)!;
            let activeRequests = 0;
            let finished = false;
            let releaseTx!: () => void;
            const previousTx = txChain;
            txChain = new Promise<void>((resolve) => {
              releaseTx = resolve;
            });

            const tx: Record<string, unknown> = {
              error: null,
              oncomplete: null,
              onerror: null,
              onabort: null,
              abort: () => {
                if (finished) return;
                finished = true;
                releaseTx();
                if (typeof tx.onabort === 'function') (tx.onabort as () => void)();
              },
              objectStore: (targetName: string) => {
                if (targetName !== storeName) throw new Error(`Out-of-scope store ${targetName}`);
                const runRequest = (op: () => unknown) => {
                  activeRequests += 1;
                  const req: Record<string, unknown> = {
                    result: undefined,
                    error: null,
                    onsuccess: null,
                    onerror: null,
                  };
                  void previousTx.then(() => {
                    queueMicrotask(() => {
                      if (finished) return;
                      try {
                        req.result = op();
                        if (typeof req.onsuccess === 'function') {
                          (req.onsuccess as () => void)();
                        }
                      } catch (err) {
                        req.error = err;
                        if (typeof req.onerror === 'function') {
                          (req.onerror as () => void)();
                        }
                        if (!finished) {
                          finished = true;
                          releaseTx();
                          if (typeof tx.onerror === 'function') (tx.onerror as () => void)();
                        }
                        return;
                      } finally {
                        activeRequests -= 1;
                      }
                      queueMicrotask(() => {
                        if (!finished && activeRequests === 0) {
                          finished = true;
                          releaseTx();
                          if (typeof tx.oncomplete === 'function') {
                            (tx.oncomplete as () => void)();
                          }
                        }
                      });
                    });
                  });
                  return req as unknown as IDBRequest;
                };
                return {
                  get: (key: string) => runRequest(() => backing.get(key)),
                  put: (value: unknown, key: string) => runRequest(() => {
                    backing.set(key, value);
                    return key;
                  }),
                  delete: (key: string) => runRequest(() => {
                    backing.delete(key);
                    return undefined;
                  }),
                };
              },
            };
            return tx as unknown as IDBTransaction;
          },
        };
        openReq.result = db;
        if (!stores.has(POS_RECOVERY_STORE_NAME) && typeof openReq.onupgradeneeded === 'function') {
          (openReq.onupgradeneeded as () => void)();
        }
        if (typeof openReq.onsuccess === 'function') {
          (openReq.onsuccess as () => void)();
        }
      });
      return openReq as unknown as IDBOpenDBRequest;
    },
  };

  return {
    idb,
    setRaw: (key: string, value: unknown) => {
      if (!stores.has(POS_RECOVERY_STORE_NAME)) stores.set(POS_RECOVERY_STORE_NAME, new Map());
      stores.get(POS_RECOVERY_STORE_NAME)!.set(key, value);
    },
    getRaw: (key: string) => stores.get(POS_RECOVERY_STORE_NAME)?.get(key),
  };
}

function pending(key = 'pos-web:test-1'): PendingPosOrder {
  return {
    version: 1,
    accountId: 'owner-a',
    shopId: 'shop-a',
    key,
    body: JSON.stringify({
      shop_id: 'shop-a', source: 'counter_pos', idempotency_key: key,
      payment_status: 'unpaid', expected_total: 100, items: [{ item_id: 'qa', quantity: 1 }],
    }),
    openReceipt: false,
  };
}

test('conflicting legacy and IndexedDB requests are preserved and block new submissions', async () => {
  const db = indexedDbStore();
  const legacy = legacyStorage();
  const first = pending('pos-web:first');
  const second = pending('pos-web:second');
  const slot = posRecoveryStorageKey(first.accountId, first.shopId);
  db.setRaw(slot, JSON.stringify(first));
  legacy.setItem!(slot, JSON.stringify(second));
  assert.deepEqual(await readPendingPosOrder(db.idb, first.accountId, first.shopId, legacy), { kind: 'unavailable' });
  assert.equal(await savePendingPosOrder(db.idb, first, legacy), false);
  assert.equal(db.getRaw(slot), JSON.stringify(first));
  assert.equal(legacy.getItem(slot), JSON.stringify(second));
  const inaccessible = { getItem: () => { throw new Error('denied'); }, removeItem: () => {} };
  assert.deepEqual(await readPendingPosOrder(db.idb, first.accountId, first.shopId, inaccessible), { kind: 'unavailable' });
  assert.equal(await savePendingPosOrder(db.idb, first, inaccessible), false);
  assert.equal(await clearConfirmedPosOrder(db.idb, first, inaccessible), 'blocked');
});

test('a committed order with a lost response is retried with the identical request', async () => {
  const { idb: store } = indexedDbStore();
  const original = pending();
  assert.equal(await savePendingPosOrder(store, original), true);
  const committed = new Map<string, { id: string; shop_id: string; order_code: string; items: []; total_amount: number; status: string; payment_status: string }>();
  const sent: string[] = [];
  let lostResponse = true;
  const send = async (body: string) => {
    sent.push(body);
    const payload = JSON.parse(body) as { idempotency_key: string; shop_id: string };
    if (!committed.has(payload.idempotency_key)) committed.set(payload.idempotency_key, {
      id: 'order-a', shop_id: payload.shop_id, order_code: 'ORD-QA', items: [],
      total_amount: 100, status: 'new', payment_status: 'unpaid',
    });
    if (lostResponse) { lostResponse = false; throw new Error('response lost after commit'); }
    return { ok: true, json: async () => ({ order: committed.get(payload.idempotency_key) }) };
  };
  assert.deepEqual(await sendPendingPosOrder(original, send), { kind: 'uncertain' });
  const restored = await readPendingPosOrder(store, 'owner-a', 'shop-a');
  assert.equal(restored.kind, 'pending');
  if (restored.kind !== 'pending') throw new Error('missing pending request');
  assert.equal(sent.length, 1, 'loading after reload does not automatically send');
  assert.equal((await sendPendingPosOrder(restored.request, send)).kind, 'confirmed');
  assert.equal(committed.size, 1);
  assert.deepEqual(sent, [original.body, original.body]);
  assert.equal(await clearPendingPosOrder(store, restored.request), true);
  assert.equal((await readPendingPosOrder(store, 'owner-a', 'shop-a')).kind, 'empty');
});

test('a pending request cannot be overwritten by an edited cart or another intent', async () => {
  const { idb: store } = indexedDbStore();
  const original = pending();
  assert.equal(await savePendingPosOrder(store, original), true);
  const changed = { ...original, body: original.body.replace('unpaid', 'paid') };
  assert.equal(await savePendingPosOrder(store, changed), false);
  assert.equal(await clearPendingPosOrder(store, changed), false);
  assert.deepEqual(await readPendingPosOrder(store, 'owner-a', 'shop-a'), { kind: 'pending', request: original });
  assert.equal((await readPendingPosOrder(store, 'owner-b', 'shop-a')).kind, 'empty');
  assert.equal((await readPendingPosOrder(store, 'owner-a', 'shop-b')).kind, 'empty');
});

test('concurrent tabs serialize claims in IndexedDB readwrite transactions and fail closed if locking is unavailable', async () => {
  const { idb: shared } = indexedDbStore();
  assert.deepEqual(
    await Promise.all([
      savePendingPosOrder(shared, pending('pos-web:direct-first')),
      savePendingPosOrder(shared, pending('pos-web:direct-second')),
    ]),
    [true, false],
  );
  assert.equal(await clearPendingPosOrder(shared, pending('pos-web:direct-first')), true);

  let previous = Promise.resolve();
  const locks = {
    request: (_name: string, operation: () => unknown) => {
      const next = previous.then(operation);
      previous = next.then(() => undefined, () => undefined);
      return next;
    },
  } as Pick<LockManager, 'request'>;
  const claim = (key: string) => withPosRecoveryLock(locks, 'owner-a', 'shop-a',
    () => savePendingPosOrder(shared, pending(key)));
  assert.deepEqual(await Promise.all([claim('pos-web:first'), claim('pos-web:other')]), [true, false]);
  await assert.rejects(withPosRecoveryLock(undefined, 'owner-a', 'shop-a', () => true), /POS_RECOVERY_LOCK_UNAVAILABLE/);
});

test('confirmed retries do not clear a different pending order or report an already-cleared one as failure', async () => {
  const { idb: store } = indexedDbStore();
  const first = pending('pos-web:first');
  const other = pending('pos-web:other');
  assert.equal(await savePendingPosOrder(store, first), true);
  const concurrentClears = await Promise.all([
    clearConfirmedPosOrder(store, first),
    clearConfirmedPosOrder(store, first),
  ]);
  assert.deepEqual(concurrentClears, ['cleared', 'already-cleared']);
  assert.equal(await clearConfirmedPosOrder(store, first), 'already-cleared');
  assert.equal(await savePendingPosOrder(store, other), true);
  assert.equal(await clearConfirmedPosOrder(store, first), 'blocked');
  assert.deepEqual(await readPendingPosOrder(store, 'owner-a', 'shop-a'), { kind: 'pending', request: other });
});

test('legacy localStorage pending order is migrated into IndexedDB and cleared from localStorage without overwrite', async () => {
  const { idb: store, getRaw } = indexedDbStore();
  const legacy = legacyStorage();
  const legacyReq = pending('pos-web:legacy-1');
  const key = posRecoveryStorageKey(legacyReq.accountId, legacyReq.shopId);
  legacy.setItem!(key, JSON.stringify(legacyReq));

  // Attempting to save a different order while a legacy pending order exists must preserve the legacy order in IndexedDB and reject the new claim.
  assert.equal(await savePendingPosOrder(store, pending('pos-web:new-attempt'), legacy), false);
  assert.equal(legacy.getItem(key), null, 'legacy localStorage entry is removed after migration into IndexedDB');
  assert.equal(getRaw(key), JSON.stringify(legacyReq), 'IndexedDB holds migrated legacy pending request');
  assert.deepEqual(await readPendingPosOrder(store, 'owner-a', 'shop-a', legacy), { kind: 'pending', request: legacyReq });
});

test('storage failures, corrupted recovery data, and malformed success fail closed', async () => {
  const broken: PosRecoveryIndexedDb = {
    open: () => { throw new Error('unavailable'); },
  };
  const request = pending();
  assert.equal(await savePendingPosOrder(broken, request), false);
  assert.equal((await readPendingPosOrder(broken, 'owner-a', 'shop-a')).kind, 'unavailable');
  assert.equal(await clearConfirmedPosOrder(broken, request), 'blocked');
  const { idb: corrupt, setRaw } = indexedDbStore();
  setRaw('qlaok_pos_pending_v1:owner-a:shop-a', '{bad json');
  assert.equal((await readPendingPosOrder(corrupt, 'owner-a', 'shop-a')).kind, 'unavailable');
  for (const order of [null, { id: 'order-a', shop_id: 'shop-a' }, { id: 'order-a', shop_id: 'other-shop' }, { id: '', shop_id: 'shop-a' }]) {
    assert.equal((await sendPendingPosOrder(request, async () => ({ ok: true, json: async () => ({ order }) }))).kind, 'uncertain');
  }
});
