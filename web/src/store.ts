// Saved flights, kept in the browser (IndexedDB). Nothing is uploaded anywhere.

export interface SavedSettings {
  mode: "simple" | "detailed";
  aircraft: string;
  row: number;
  letter: string;
  eyeCm: number | null;
  visibilityKm: number;
  terrain: boolean;
}

export interface SavedFlight {
  id: string;
  fileName: string;
  text: string;
  addedAt: number;
  title: string;
  subtitle: string;
  settings?: SavedSettings;
}

const DB = "window-seat", STORE = "flights";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = fn(db.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export const listFlights = async () =>
  (await tx<SavedFlight[]>("readonly", (s) => s.getAll() as IDBRequest<SavedFlight[]>)).sort((a, b) => b.addedAt - a.addedAt);
export const getFlight = (id: string) => tx<SavedFlight | undefined>("readonly", (s) => s.get(id) as IDBRequest<SavedFlight | undefined>);
export const saveFlight = (f: SavedFlight) => tx("readwrite", (s) => s.put(f));
export const deleteFlight = (id: string) => tx("readwrite", (s) => s.delete(id));

/** Stable id for a file: same name + size → same entry (re-dropping updates instead of duplicating). */
export const flightId = (fileName: string, text: string) => `${fileName}:${text.length}`;
