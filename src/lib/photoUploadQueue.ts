import { ref, uploadString, getDownloadURL } from "firebase/storage";
import { doc, updateDoc } from "firebase/firestore";
import { storage, db } from "../config/firebase";

export interface QueuedUpload {
  id: string;
  storagePath: string;
  base64Data: string;
  mimeType: string;
  metadata: {
    centerId: string;
    serviceId: string;
    type: "inspection" | "paymentSlip" | "vehicle";
    fieldPath: string;
    fieldKey: string;
  };
  createdAt: number;
  attempts: number;
  status: "pending" | "uploading" | "done" | "failed";
}

const DB_NAME = "pitstopiq-photo-queue";
const STORE_NAME = "uploads";
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const idb = request.result;
      if (!idb.objectStoreNames.contains(STORE_NAME)) {
        const store = idb.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("status", "status", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function generateId(): string {
  return crypto.randomUUID();
}

export async function enqueuePhoto(
  item: Omit<QueuedUpload, "id" | "attempts" | "status">,
): Promise<string> {
  const idb = await openDB();
  const id = generateId();
  const entry: QueuedUpload = { ...item, id, attempts: 0, status: "pending" };
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => { idb.close(); resolve(id); };
    tx.onerror = () => { idb.close(); reject(tx.error); };
  });
}

export async function processQueue(): Promise<void> {
  const idb = await openDB();
  const items = await new Promise<QueuedUpload[]>((resolve, reject) => {
    const tx = idb.transaction(STORE_NAME, "readonly");
    const index = tx.objectStore(STORE_NAME).index("status");
    const results: QueuedUpload[] = [];
    const pending = index.openCursor(IDBKeyRange.only("pending"));
    pending.onsuccess = () => {
      const cursor = pending.result;
      if (cursor) {
        results.push(cursor.value as QueuedUpload);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    pending.onerror = () => reject(pending.error);
  });
  idb.close();

  for (const item of items) {
    try {
      await updateItemStatus(item.id, "uploading");
      const storageRef = ref(storage, item.storagePath);
      await uploadString(storageRef, item.base64Data, "data_url");
      const downloadUrl = await getDownloadURL(storageRef);

      const docRef = doc(db, item.metadata.fieldPath);
      await updateDoc(docRef, { [item.metadata.fieldKey]: downloadUrl });

      await updateItemStatus(item.id, "done");
    } catch {
      await incrementAttempts(item.id, item.attempts);
    }
  }
}

async function updateItemStatus(id: string, status: QueuedUpload["status"]): Promise<void> {
  try {
    const idb = await openDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const item = getReq.result as QueuedUpload | undefined;
        if (item) {
          item.status = status;
          store.put(item);
        }
      };
      tx.oncomplete = () => { idb.close(); resolve(); };
      tx.onerror = () => { idb.close(); reject(tx.error); };
    });
  } catch { /* silent */ }
}

async function incrementAttempts(id: string, currentAttempts: number): Promise<void> {
  try {
    const idb = await openDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const item = getReq.result as QueuedUpload | undefined;
        if (item) {
          item.attempts = currentAttempts + 1;
          item.status = item.attempts >= 3 ? "failed" : "pending";
          store.put(item);
        }
      };
      tx.oncomplete = () => { idb.close(); resolve(); };
      tx.onerror = () => { idb.close(); reject(tx.error); };
    });
  } catch { /* silent */ }
}

export async function getPendingCount(): Promise<number> {
  try {
    const idb = await openDB();
    return new Promise((resolve) => {
      const tx = idb.transaction(STORE_NAME, "readonly");
      const index = tx.objectStore(STORE_NAME).index("status");
      let count = 0;
      const pending = index.openCursor(IDBKeyRange.only("pending"));
      pending.onsuccess = () => {
        const cursor = pending.result;
        if (cursor) { count++; cursor.continue(); }
        else {
          const uploading = index.openCursor(IDBKeyRange.only("uploading"));
          uploading.onsuccess = () => {
            const c2 = uploading.result;
            if (c2) { count++; c2.continue(); }
            else { idb.close(); resolve(count); }
          };
          uploading.onerror = () => { idb.close(); resolve(count); };
        }
      };
      pending.onerror = () => { idb.close(); resolve(0); };
    });
  } catch {
    return 0;
  }
}

export async function clearCompleted(): Promise<void> {
  try {
    const idb = await openDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("status");
      const cursor = index.openCursor(IDBKeyRange.only("done"));
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (c) { c.delete(); c.continue(); }
      };
      tx.oncomplete = () => { idb.close(); resolve(); };
      tx.onerror = () => { idb.close(); reject(tx.error); };
    });
  } catch { /* silent */ }
}
