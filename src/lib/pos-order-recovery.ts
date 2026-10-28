import type { ShopOrder } from '@/types/qlaok';

/** A request that may have committed must be retried byte-for-byte. */
export interface PendingPosOrder {
  version: 1;
  accountId: string;
  shopId: string;
  key: string;
  body: string;
  openReceipt: boolean;
}

export interface PosRecoveryStorage {
  getItem(key: string): string | null;
  setItem?(key: string, value: string): void;
  removeItem(key: string): void;
}

export type PosRecoveryIndexedDb = Pick<IDBFactory, 'open'> | null | undefined;

export type PendingRead =
  | { kind: 'empty' }
  | { kind: 'pending'; request: PendingPosOrder }
  | { kind: 'unavailable' };

export const POS_RECOVERY_DB_NAME = 'qlaok_pos_recovery_v1';
export const POS_RECOVERY_STORE_NAME = 'pending_orders';
export const POS_RECOVERY_CHANNEL_NAME = 'qlaok_pos_recovery_v1';

export interface PosRecoveryChannelMessage {
  type: 'pos-recovery-changed';
  key: string;
  accountId: string;
  shopId: string;
  reason: 'saved' | 'confirmed' | 'discarded';
  requestKey: string;
}

export function posRecoveryStorageKey(accountId: string, shopId: string): string {
  return `qlaok_pos_pending_v1:${encodeURIComponent(accountId)}:${encodeURIComponent(shopId)}`;
}

let browserBroadcastChannel: BroadcastChannel | null = null;

function getBrowserBroadcastChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel !== 'function') return null;
  if (!browserBroadcastChannel) {
    browserBroadcastChannel = new BroadcastChannel(POS_RECOVERY_CHANNEL_NAME);
  }
  return browserBroadcastChannel;
}

export function notifyPosRecoveryChanged(
  accountId: string,
  shopId: string,
  reason: PosRecoveryChannelMessage['reason'],
  requestKey: string,
): void {
  if (!accountId || !shopId) return;
  try {
    const channel = getBrowserBroadcastChannel();
    if (!channel) return;
    const message: PosRecoveryChannelMessage = {
      type: 'pos-recovery-changed',
      key: posRecoveryStorageKey(accountId, shopId),
      accountId,
      shopId,
      reason,
      requestKey,
    };
    channel.postMessage(message);
  } catch {
    // IndexedDB remains authoritative even if BroadcastChannel fails.
  }
}

export function subscribePosRecoveryChanges(
  accountId: string,
  shopId: string,
  onChange: (message: PosRecoveryChannelMessage) => void,
): () => void {
  if (!accountId || !shopId) return () => {};
  const key = posRecoveryStorageKey(accountId, shopId);
  try {
    const channel = getBrowserBroadcastChannel();
    if (!channel) return () => {};
    const listener = (event: MessageEvent<PosRecoveryChannelMessage>) => {
      const data = event.data;
      if (!data || data.type !== 'pos-recovery-changed' || data.key !== key) return;
      onChange(data);
    };
    channel.addEventListener('message', listener);
    return () => {
      try {
        channel.removeEventListener('message', listener);
      } catch {}
    };
  } catch {
    return () => {};
  }
}

/** Serialize read-modify-write operations across tabs on the same origin. */
export async function withPosRecoveryLock<T>(
  locks: Pick<LockManager, 'request'> | undefined,
  accountId: string,
  shopId: string,
  operation: () => Promise<T> | T,
): Promise<T> {
  if (!locks || !accountId || !shopId) throw new Error('POS_RECOVERY_LOCK_UNAVAILABLE');
  return locks.request(posRecoveryStorageKey(accountId, shopId), operation);
}

function validRequest(value: unknown, accountId: string, shopId: string): value is PendingPosOrder {
  if (!accountId.trim() || !shopId.trim()) return false;
  if (!value || typeof value !== 'object') return false;
  const pending = value as Partial<PendingPosOrder>;
  if (
    pending.version !== 1 || pending.accountId !== accountId || pending.shopId !== shopId ||
    typeof pending.key !== 'string' || !pending.key.startsWith('pos-web:') || pending.key.length > 120 || typeof pending.body !== 'string' ||
    typeof pending.openReceipt !== 'boolean'
  ) return false;
  try {
    const body: unknown = JSON.parse(pending.body);
    if (!body || typeof body !== 'object') return false;
    const request = body as Record<string, unknown>;
    return request.shop_id === shopId && request.source === 'counter_pos' &&
      request.idempotency_key === pending.key && Array.isArray(request.items) && request.items.length > 0;
  } catch {
    return false;
  }
}

function openPosRecoveryDb(indexedDb: PosRecoveryIndexedDb): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!indexedDb || typeof indexedDb.open !== 'function') {
      reject(new Error('POS_RECOVERY_IDB_UNAVAILABLE'));
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDb.open(POS_RECOVERY_DB_NAME, 1);
    } catch (err) {
      reject(err);
      return;
    }
    req.onupgradeneeded = () => {
      try {
        const db = req.result;
        if (!db.objectStoreNames.contains(POS_RECOVERY_STORE_NAME)) {
          db.createObjectStore(POS_RECOVERY_STORE_NAME);
        }
      } catch (err) {
        reject(err);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      if (!db || !db.objectStoreNames.contains(POS_RECOVERY_STORE_NAME)) {
        try {
          db?.close();
        } catch {}
        reject(new Error('POS_RECOVERY_STORE_MISSING'));
        return;
      }
      db.onversionchange = () => {
        try {
          db.close();
        } catch {}
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('POS_RECOVERY_IDB_OPEN_FAILED'));
    req.onblocked = () => reject(new Error('POS_RECOVERY_IDB_BLOCKED'));
  });
}

/** Invalid or unreadable data is not treated as an empty slot. */
export async function readPendingPosOrder(
  indexedDb: PosRecoveryIndexedDb,
  accountId: string,
  shopId: string,
  legacyStorage?: Pick<PosRecoveryStorage, 'getItem' | 'removeItem'> | null,
): Promise<PendingRead> {
  if (!accountId || !shopId || !accountId.trim() || !shopId.trim()) return { kind: 'unavailable' };
  const key = posRecoveryStorageKey(accountId, shopId);
  let legacyRaw: string | null = null;
  if (legacyStorage) {
    try {
      legacyRaw = legacyStorage.getItem(key);
    } catch {
      return { kind: 'unavailable' };
    }
  }
  let db: IDBDatabase | null = null;
  try {
    db = await openPosRecoveryDb(indexedDb);
    return await new Promise<PendingRead>((resolve) => {
      let outcome: PendingRead = { kind: 'unavailable' };
      let migratedLegacy = false;
      let tx: IDBTransaction;
      try {
        tx = db!.transaction(POS_RECOVERY_STORE_NAME, 'readwrite');
      } catch {
        try {
          db?.close();
        } catch {}
        resolve({ kind: 'unavailable' });
        return;
      }
      const closeDb = () => {
        try {
          db?.close();
        } catch {}
      };
      tx.oncomplete = () => {
        closeDb();
        if (migratedLegacy && legacyStorage) {
          try {
            legacyStorage.removeItem(key);
          } catch {}
        }
        resolve(outcome);
      };
      tx.onerror = () => {
        closeDb();
        resolve({ kind: 'unavailable' });
      };
      tx.onabort = () => {
        closeDb();
        resolve({ kind: 'unavailable' });
      };

      const store = tx.objectStore(POS_RECOVERY_STORE_NAME);
      const getReq = store.get(key);
      getReq.onsuccess = () => {
        const raw = getReq.result;
        if (raw === undefined || raw === null) {
          if (legacyRaw === null) {
            outcome = { kind: 'empty' };
            return;
          }
          try {
            const parsed: unknown = JSON.parse(legacyRaw);
            if (!validRequest(parsed, accountId, shopId)) {
              outcome = { kind: 'unavailable' };
              return;
            }
            const canonical = JSON.stringify(parsed);
            const putReq = store.put(canonical, key);
            putReq.onsuccess = () => {
              const verifyReq = store.get(key);
              verifyReq.onsuccess = () => {
                if (verifyReq.result === canonical) {
                  migratedLegacy = true;
                  outcome = { kind: 'pending', request: parsed };
                } else {
                  outcome = { kind: 'unavailable' };
                }
              };
            };
          } catch {
            outcome = { kind: 'unavailable' };
          }
          return;
        }
        if (typeof raw !== 'string') {
          outcome = { kind: 'unavailable' };
          return;
        }
        try {
          const value: unknown = JSON.parse(raw);
          if (validRequest(value, accountId, shopId)) {
            if (legacyRaw !== null) {
              const legacy: unknown = JSON.parse(legacyRaw);
              if (!validRequest(legacy, accountId, shopId) || JSON.stringify(legacy) !== JSON.stringify(value)) {
                outcome = { kind: 'unavailable' };
                return;
              }
              migratedLegacy = true;
            }
            outcome = { kind: 'pending', request: value };
          } else {
            outcome = { kind: 'unavailable' };
          }
        } catch {
          outcome = { kind: 'unavailable' };
        }
      };
    });
  } catch {
    try {
      db?.close();
    } catch {}
    return { kind: 'unavailable' };
  }
}

/** Persist and read back in a single readwrite transaction before any network request; never overwrite another pending order. */
export async function savePendingPosOrder(
  indexedDb: PosRecoveryIndexedDb,
  request: PendingPosOrder,
  legacyStorage?: Pick<PosRecoveryStorage, 'getItem' | 'removeItem'> | null,
): Promise<boolean> {
  if (!validRequest(request, request.accountId, request.shopId)) return false;
  const key = posRecoveryStorageKey(request.accountId, request.shopId);
  const serialized = JSON.stringify(request);
  let legacyRaw: string | null = null;
  if (legacyStorage) {
    try {
      legacyRaw = legacyStorage.getItem(key);
    } catch {
      return false;
    }
  }
  let db: IDBDatabase | null = null;
  try {
    db = await openPosRecoveryDb(indexedDb);
    return await new Promise<boolean>((resolve) => {
      let saved = false;
      let clearLegacy = false;
      let tx: IDBTransaction;
      try {
        tx = db!.transaction(POS_RECOVERY_STORE_NAME, 'readwrite');
      } catch {
        try {
          db?.close();
        } catch {}
        resolve(false);
        return;
      }
      const closeDb = () => {
        try {
          db?.close();
        } catch {}
      };
      tx.oncomplete = () => {
        closeDb();
        if (clearLegacy && legacyStorage) {
          try {
            legacyStorage.removeItem(key);
          } catch {}
        }
        if (saved) {
          notifyPosRecoveryChanged(request.accountId, request.shopId, 'saved', request.key);
        }
        resolve(saved);
      };
      tx.onerror = () => {
        closeDb();
        resolve(false);
      };
      tx.onabort = () => {
        closeDb();
        resolve(false);
      };

      const store = tx.objectStore(POS_RECOVERY_STORE_NAME);
      const getReq = store.get(key);
      getReq.onsuccess = () => {
        const existing = getReq.result;
        if (existing !== undefined && existing !== null) {
          if (existing === serialized) {
            if (legacyRaw !== null) {
              try {
                const legacy: unknown = JSON.parse(legacyRaw);
                if (!validRequest(legacy, request.accountId, request.shopId) || JSON.stringify(legacy) !== serialized) return;
              } catch {
                return;
              }
            }
            saved = true;
            if (legacyRaw !== null) clearLegacy = true;
          }
          return;
        }
        if (legacyRaw !== null && legacyRaw !== serialized) {
          try {
            const parsedLegacy: unknown = JSON.parse(legacyRaw);
            if (validRequest(parsedLegacy, request.accountId, request.shopId)) {
              const canonicalLegacy = JSON.stringify(parsedLegacy);
              const migrateReq = store.put(canonicalLegacy, key);
              migrateReq.onsuccess = () => {
                const verifyMigrate = store.get(key);
                verifyMigrate.onsuccess = () => {
                  if (verifyMigrate.result === canonicalLegacy) clearLegacy = true;
                };
              };
            }
          } catch {
            // Corrupt legacy entry blocks claiming a new order.
          }
          saved = false;
          return;
        }
        const putReq = store.put(serialized, key);
        putReq.onsuccess = () => {
          const verifyReq = store.get(key);
          verifyReq.onsuccess = () => {
            if (verifyReq.result === serialized) {
              saved = true;
              if (legacyRaw !== null) clearLegacy = true;
            }
          };
        };
      };
    });
  } catch {
    try {
      db?.close();
    } catch {}
    return false;
  }
}

async function deleteMatchingPendingPosOrder(
  indexedDb: PosRecoveryIndexedDb,
  request: PendingPosOrder,
  reason: 'confirmed' | 'discarded',
  legacyStorage?: Pick<PosRecoveryStorage, 'getItem' | 'removeItem'> | null,
): Promise<'cleared' | 'already-cleared' | 'blocked'> {
  if (!validRequest(request, request.accountId, request.shopId)) return 'blocked';
  const key = posRecoveryStorageKey(request.accountId, request.shopId);
  const serialized = JSON.stringify(request);
  let legacyRaw: string | null = null;
  if (legacyStorage) {
    try {
      legacyRaw = legacyStorage.getItem(key);
    } catch {
      return 'blocked';
    }
  }
  let db: IDBDatabase | null = null;
  try {
    db = await openPosRecoveryDb(indexedDb);
    return await new Promise<'cleared' | 'already-cleared' | 'blocked'>((resolve) => {
      let status: 'cleared' | 'already-cleared' | 'blocked' = 'blocked';
      let clearLegacy = false;
      let tx: IDBTransaction;
      try {
        tx = db!.transaction(POS_RECOVERY_STORE_NAME, 'readwrite');
      } catch {
        try {
          db?.close();
        } catch {}
        resolve('blocked');
        return;
      }
      const closeDb = () => {
        try {
          db?.close();
        } catch {}
      };
      tx.oncomplete = () => {
        closeDb();
        if (clearLegacy && legacyStorage) {
          try {
            legacyStorage.removeItem(key);
          } catch {}
        }
        if (status === 'cleared') {
          notifyPosRecoveryChanged(request.accountId, request.shopId, reason, request.key);
        }
        resolve(status);
      };
      tx.onerror = () => {
        closeDb();
        resolve('blocked');
      };
      tx.onabort = () => {
        closeDb();
        resolve('blocked');
      };

      const store = tx.objectStore(POS_RECOVERY_STORE_NAME);
      const getReq = store.get(key);
      getReq.onsuccess = () => {
        const existing = getReq.result;
        if (existing === undefined || existing === null) {
          if (legacyRaw === null) {
            status = 'already-cleared';
            return;
          }
          if (legacyRaw === serialized) {
            clearLegacy = true;
            status = 'cleared';
            return;
          }
          status = 'blocked';
          return;
        }
        if (existing !== serialized) {
          status = 'blocked';
          return;
        }
        const delReq = store.delete(key);
        delReq.onsuccess = () => {
          const verifyReq = store.get(key);
          verifyReq.onsuccess = () => {
            if (verifyReq.result === undefined || verifyReq.result === null) {
              status = 'cleared';
              if (legacyRaw === serialized) clearLegacy = true;
            } else {
              status = 'blocked';
            }
          };
        };
      };
    });
  } catch {
    try {
      db?.close();
    } catch {}
    return 'blocked';
  }
}

/** Clear only the exact confirmed request; failed storage leaves recovery blocked. */
export async function clearPendingPosOrder(
  indexedDb: PosRecoveryIndexedDb,
  request: PendingPosOrder,
  legacyStorage?: Pick<PosRecoveryStorage, 'getItem' | 'removeItem'> | null,
): Promise<boolean> {
  return (await deleteMatchingPendingPosOrder(indexedDb, request, 'discarded', legacyStorage)) === 'cleared';
}

/** Called under the recovery lock after the server confirms this exact request. */
export async function clearConfirmedPosOrder(
  indexedDb: PosRecoveryIndexedDb,
  request: PendingPosOrder,
  legacyStorage?: Pick<PosRecoveryStorage, 'getItem' | 'removeItem'> | null,
): Promise<'cleared' | 'already-cleared' | 'blocked'> {
  return deleteMatchingPendingPosOrder(indexedDb, request, 'confirmed', legacyStorage);
}

type PosResponse = { ok: boolean; json(): Promise<unknown> };
type PosSendResult =
  | { kind: 'confirmed'; order: ShopOrder }
  | { kind: 'uncertain' };

/** No retry happens here: the caller must explicitly invoke this for each attempt. */
export async function sendPendingPosOrder(
  request: PendingPosOrder,
  send: (body: string) => Promise<PosResponse>
): Promise<PosSendResult> {
  if (!validRequest(request, request.accountId, request.shopId)) return { kind: 'uncertain' };
  try {
    const response = await send(request.body);
    if (!response.ok) return { kind: 'uncertain' };
    const body = await response.json() as { order?: Partial<ShopOrder> } | null;
    const order = body?.order;
    if (
      typeof order?.id !== 'string' || !order.id.trim() || order.shop_id !== request.shopId ||
      typeof order.order_code !== 'string' || !order.order_code.trim() ||
      !Array.isArray(order.items) || typeof order.total_amount !== 'number' || !Number.isFinite(order.total_amount) ||
      !['new', 'preparing', 'completed', 'cancelled'].includes(String(order.status)) ||
      !['unpaid', 'paid', 'refunded'].includes(String(order.payment_status))
    ) {
      return { kind: 'uncertain' };
    }
    return { kind: 'confirmed', order: order as ShopOrder };
  } catch {
    return { kind: 'uncertain' };
  }
}
