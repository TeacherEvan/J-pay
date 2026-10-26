export type OutboxEntry = {
  siteId: string;
  clientReportedTime: number;
  status: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  sideMissionDurationMinutes?: 15 | 30 | 45 | 60 | 120;
  deviceToken: string;
  idempotencyKey: string;
  deviceMetadata: string;
  queuedAt: number;
};

const DB_NAME = "jpay";
const STORE = "outbox";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error("transaction aborted"));
    };
  });
}

export function outboxEnqueue(entry: OutboxEntry): Promise<IDBValidKey> {
  return withStore("readwrite", (store) => store.add(entry));
}

export function outboxAll(): Promise<{ key: IDBValidKey; entry: OutboxEntry }[]> {
  // Keys and entries MUST come from one transaction. Reading them in two
  // transactions lets a write land in between, so a key can be paired with a
  // different entry — and the flush then deletes the wrong queued punch,
  // losing a worker's check-in without any error.
  return openDb().then(
    (db) =>
      new Promise<{ key: IDBValidKey; entry: OutboxEntry }[]>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const store = tx.objectStore(STORE);
        const entriesReq = store.getAll();
        const keysReq = store.getAllKeys();
        let entries: OutboxEntry[] | null = null;
        let keys: IDBValidKey[] | null = null;
        let settled = false;

        const settle = () => {
          if (settled || entries === null || keys === null) return;
          settled = true;
          resolve(keys.map((key, i) => ({ key, entry: entries![i] })));
        };
        const fail = () => {
          if (settled) return;
          settled = true;
          try {
            db.close();
          } catch {
            // ignore
          }
          reject(tx.error ?? entriesReq.error ?? keysReq.error);
        };

        entriesReq.onsuccess = () => {
          entries = entriesReq.result as OutboxEntry[];
          settle();
        };
        keysReq.onsuccess = () => {
          keys = keysReq.result as IDBValidKey[];
          settle();
        };
        entriesReq.onerror = fail;
        keysReq.onerror = fail;
        tx.onerror = fail;
        tx.onabort = fail;
        tx.oncomplete = () => {
          db.close();
          settle();
        };
      })
  );
}

export function outboxCount(): Promise<number> {
  return withStore("readonly", (store) => store.count());
}

export function outboxRemove(key: IDBValidKey): Promise<undefined> {
  return withStore("readwrite", (store) => store.delete(key));
}
