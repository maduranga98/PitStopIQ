import {
  setDoc,
  updateDoc,
  deleteDoc,
  doc,
  type DocumentReference,
  type DocumentData,
  type SetOptions,
  type WithFieldValue,
  type UpdateData,
  type CollectionReference,
} from "firebase/firestore";
import { usePendingWritesStore } from "../store/pendingWritesSlice";

const { increment, decrement } = usePendingWritesStore.getState();

// Firestore write promises resolve only when the SERVER acknowledges the
// write. With offline persistence the write is applied to the local cache
// immediately and queued for sync, but the promise stays pending until
// connectivity returns — so `await`-ing it offline hangs the whole flow
// (service creation → invoice creation → SMS queueing all stall forever).
//
// These helpers resolve as soon as the write is committed locally:
//  - offline: resolve immediately (the write is safely queued in IndexedDB)
//  - online: wait for the server ack so rule violations still surface, but
//    cap the wait so a flaky connection can't hang the UI; the queued write
//    still syncs in the background.
// The eventual server outcome is always tracked for the pending-writes
// counter and logged if the server rejects the write.
const ACK_TIMEOUT_MS = 8000;

function trackServerAck(ack: Promise<unknown>, op: string, path: string): void {
  increment();
  ack
    .catch((err) => {
      console.error(`[firestoreWrite] ${op} ${path} was rejected by the server:`, err);
    })
    .finally(decrement);
}

function localFirst<T>(ack: Promise<unknown>, localResult: T): Promise<T> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return Promise.resolve(localResult);
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve(localResult); }
    }, ACK_TIMEOUT_MS);
    ack.then(
      () => {
        if (!settled) { settled = true; clearTimeout(timer); resolve(localResult); }
      },
      (err) => {
        if (!settled) { settled = true; clearTimeout(timer); reject(err); }
      },
    );
  });
}

export async function safeSetDoc<AppModelType, DbModelType extends DocumentData>(
  reference: DocumentReference<AppModelType, DbModelType>,
  data: WithFieldValue<AppModelType>,
  options?: SetOptions,
): Promise<void> {
  const ack = options ? setDoc(reference, data, options) : setDoc(reference, data);
  trackServerAck(ack, "setDoc", reference.path);
  return localFirst(ack, undefined);
}

export async function safeUpdateDoc<AppModelType, DbModelType extends DocumentData>(
  reference: DocumentReference<AppModelType, DbModelType>,
  data: UpdateData<DbModelType>,
): Promise<void> {
  const ack = updateDoc(reference, data);
  trackServerAck(ack, "updateDoc", reference.path);
  return localFirst(ack, undefined);
}

export async function safeAddDoc<AppModelType, DbModelType extends DocumentData>(
  reference: CollectionReference<AppModelType, DbModelType>,
  data: WithFieldValue<AppModelType>,
): Promise<DocumentReference<AppModelType, DbModelType>> {
  // addDoc's promise also only settles on server ack, and we need the new
  // ref synchronously — so generate the id client-side and setDoc it.
  const newRef = doc(reference);
  const ack = setDoc(newRef, data);
  trackServerAck(ack, "addDoc", newRef.path);
  return localFirst(ack, newRef);
}

export async function safeDeleteDoc(
  reference: DocumentReference<unknown, DocumentData>,
): Promise<void> {
  const ack = deleteDoc(reference);
  trackServerAck(ack, "deleteDoc", reference.path);
  return localFirst(ack, undefined);
}
