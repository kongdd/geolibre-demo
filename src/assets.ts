const DB_NAME = "geolibre-project-demo";
const STORE_NAME = "raster-assets";

interface StoredAsset {
  name: string;
  type: string;
  blob: Blob;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function request<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const operation = run(transaction.objectStore(STORE_NAME));
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error);
    transaction.oncomplete = () => database.close();
  });
}

export async function putRasterAsset(id: string, file: File): Promise<void> {
  await request("readwrite", (store) =>
    store.put({ name: file.name, type: file.type, blob: file } satisfies StoredAsset, id),
  );
}

export async function getRasterAsset(id: string): Promise<File | null> {
  const asset = await request<StoredAsset | undefined>("readonly", (store) => store.get(id));
  return asset ? new File([asset.blob], asset.name, { type: asset.type }) : null;
}

export async function deleteRasterAsset(id: string): Promise<void> {
  await request("readwrite", (store) => store.delete(id));
}
