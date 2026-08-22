// ============================================================
// LOCAL STORE — IndexedDB
// Mirrors the intended Firestore layout (users/{uid}/...) so the
// final Firebase integration swaps this adapter, not the pages.
// ============================================================

const DB_NAME = "nexora";
const DB_VERSION = 1;

export const STORES = [
  "meta",
  "profile",
  "settings",
  "goals",
  "projects",
  "tasks",
  "habits",
  "habitLogs",
  "focusSessions",
  "notes",
  "folders",
  "inbox",
  "events",
];

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: "id" });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDb().then((db) =>
    db.transaction(storeName, mode).objectStore(storeName)
  );
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAll(storeName) {
  const store = await tx(storeName, "readonly");
  return wrap(store.getAll());
}

export async function get(storeName, id) {
  const store = await tx(storeName, "readonly");
  return wrap(store.get(id));
}

export async function put(storeName, obj) {
  const store = await tx(storeName, "readwrite");
  return wrap(store.put(obj)).then(() => obj);
}

export async function bulkPut(storeName, objs) {
  const store = await tx(storeName, "readwrite");
  await Promise.all(objs.map((o) => wrap(store.put(o))));
  return objs;
}

export async function del(storeName, id) {
  const store = await tx(storeName, "readwrite");
  return wrap(store.delete(id));
}

export async function clear(storeName) {
  const store = await tx(storeName, "readwrite");
  return wrap(store.clear());
}

// ---------- meta helpers (key/value convenience) ----------
export async function getMeta(key) {
  const row = await get("meta", key);
  return row ? row.value : undefined;
}

export async function setMeta(key, value) {
  return put("meta", { id: key, value });
}
