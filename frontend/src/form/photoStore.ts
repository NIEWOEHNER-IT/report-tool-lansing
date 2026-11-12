/**
 * Fotos des Entwurfs in IndexedDB (localStorage ist für Bilder zu klein).
 * Je Foto: verkleinertes Original (JPEG) und optional die Zeichenebene (transparentes PNG).
 * Fällt IndexedDB aus (privates Fenster), bleiben die Fotos bis zum Neuladen im Speicher.
 */

const DB_NAME = 'lansing-bautagesbericht';
const STORE = 'fotos';

export interface StoredPhoto {
    original: Blob;
    annotation: Blob | null;
}

const memory = new Map<string, StoredPhoto>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
    if (!dbPromise) {
        dbPromise = new Promise((resolve) => {
            try {
                const request = indexedDB.open(DB_NAME, 1);
                request.onupgradeneeded = () => request.result.createObjectStore(STORE);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => resolve(null);
                request.onblocked = () => resolve(null);
            } catch {
                resolve(null);
            }
        });
    }
    return dbPromise;
}

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
    return openDb().then(
        (db) =>
            new Promise((resolve) => {
                if (!db) {
                    resolve(undefined);
                    return;
                }
                try {
                    const request = action(db.transaction(STORE, mode).objectStore(STORE));
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => resolve(undefined);
                } catch {
                    resolve(undefined);
                }
            }),
    );
}

export async function putPhoto(id: string, photo: StoredPhoto): Promise<void> {
    memory.set(id, photo);
    await run('readwrite', (store) => store.put(photo, id));
}

export async function getPhoto(id: string): Promise<StoredPhoto | null> {
    const cached = memory.get(id);
    if (cached) return cached;
    const stored = (await run<StoredPhoto>('readonly', (store) => store.get(id))) ?? null;
    if (stored) memory.set(id, stored);
    return stored;
}

export async function deletePhoto(id: string): Promise<void> {
    memory.delete(id);
    await run('readwrite', (store) => store.delete(id));
}

/** Entfernt alle Fotos, die nicht mehr zum Entwurf gehören. */
export async function prunePhotos(keep: string[]): Promise<void> {
    const keys = (await run<IDBValidKey[]>('readonly', (store) => store.getAllKeys())) ?? [];
    for (const key of keys) {
        if (typeof key === 'string' && !keep.includes(key)) await deletePhoto(key);
    }
}
