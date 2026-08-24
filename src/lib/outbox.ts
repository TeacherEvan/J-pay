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
  });
}

export function outboxEnqueue(entry: OutboxEntry): Promise<IDBValidKey> {
  return withStore("readwrite", (store) => store.add(entry));
}

export function outboxAll(): Promise<{ key: IDBValidKey; entry: OutboxEntry }[]> {
  return withStore("readonly", (store) => store.getAll()).then(async (entries) => {
    const keys = await withStore("readonly", (store) => store.getAllKeys());
    return keys.map((key, i) => ({ key, entry: entries[i] }));
  });
}

export function outboxCount(): Promise<number> {
  return withStore("readonly", (store) => store.count());
}

export function outboxRemove(key: IDBValidKey): Promise<undefined> {
  return withStore("readwrite", (store) => store.delete(key));
}
