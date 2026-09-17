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
import {
  writeBatch,
  type WriteBatch,
} from "firebase/firestore";
import { auth, db } from "../config/firebase";
import { usePendingWritesStore } from "../store/pendingWritesSlice";
import { invalidateRefDataForPath } from "./refData";

const { increment, decrement } = usePendingWritesStore.getState();

// Firestore write promises resolve only when the SERVER acknowledges the
// write. Firestore still applies the write to its in-memory cache and queues
// it for sync while offline, but the promise stays pending until
// connectivity returns — so `await`-ing it offline hangs the whole flow
// (service creation → invoice creation → SMS queueing all stall forever).
//
// These helpers resolve as soon as the write is committed locally:
//  - offline: resolve immediately (the write is queued in memory for this
//    tab and will sync once connectivity returns, but — unlike IndexedDB
//    persistence — does not survive a reload while still offline)
//  - online: wait for the server ack so rule violations still surface, but
//    cap the wait so a flaky connection can't hang the UI; the queued write
//    still syncs in the background.
// The eventual server outcome is always tracked for the pending-writes
// counter and logged if the server rejects the write.
const ACK_TIMEOUT_MS = 8000;

// ── Write failures ────────────────────────────────────────────────────────────
// A write that the server rejects used to be a console.error and nothing else.
// Because these helpers resolve as soon as the write is committed locally, the
// caller has already returned, the spinner has already stopped, and the screen
// is already showing the change — so a later rejection is the ONE case where the
// user sees a success that did not happen. Silence there is worse than the
// blocking wait the local-first behaviour replaced.
//
// This module cannot render anything (it is imported by scripts and by code that
// runs before React), so it exposes a registration point instead and the app
// wires it to a toast. See components/SyncFailureToast.tsx.

export interface WriteFailure {
  /** "setDoc" | "updateDoc" | "addDoc" | "deleteDoc" | "writeBatch". */
  op: string;
  /** Document path, or a short description for a batch. */
  path: string;
  code?: string;
  message: string;
}

type WriteFailureHandler = (failure: WriteFailure) => void;

let failureHandler: WriteFailureHandler | null = null;

/**
 * Register the sink for server-rejected writes. Returns a teardown function.
 * Last registration wins — there is one app, and a second caller replacing the
 * first is a bug worth surfacing rather than silently fanning out to both.
 */
export function registerWriteFailureHandler(handler: WriteFailureHandler): () => void {
  failureHandler = handler;
  return () => {
    if (failureHandler === handler) failureHandler = null;
  };
}

/**
 * Rejections that are the normal consequence of signing out, not a lost write.
 * Same reasoning as the listener wrappers: rules stop matching the instant the
 * token goes, and there is no longer a user to tell.
 *
 * "After sign-out" is the whole justification for swallowing these, so it has
 * to be checked rather than assumed: a rules violation while the user is still
 * signed in reports the same `permission-denied`, and treating that as sign-out
 * noise hid a genuinely broken write (the SMS Log retry) behind a console line
 * nobody reads. `cancelled` stays benign either way — it only ever means the
 * SDK tore the operation down.
 */
const BENIGN_WRITE_CODES = new Set(["permission-denied", "unauthenticated", "cancelled"]);

function isSignOutNoise(code: string): boolean {
  if (code === "cancelled") return true;
  if (!BENIGN_WRITE_CODES.has(code)) return false;
  // No user left to tell — and no user whose write this could have been.
  return !auth.currentUser;
}

function reportFailure(op: string, path: string, err: unknown): void {
  const code = typeof err === "object" && err !== null && "code" in err
    ? String((err as { code?: unknown }).code)
    : undefined;
  if (code && isSignOutNoise(code)) {
    console.info(`[firestoreWrite] ${op} ${path} refused after sign-out: ${code}`);
    return;
  }
  console.error(`[firestoreWrite] ${op} ${path} was rejected by the server:`, err);
  failureHandler?.({
    op,
    path,
    code,
    message: err instanceof Error ? err.message : String(err),
  });
}

function trackServerAck(ack: Promise<unknown>, op: string, path: string): void {
  // Drop any cached copy of the collection this document belongs to, so the
  // next reader sees the change instead of waiting out the TTL (see refData.ts).
  // Done twice on purpose: once now, because the write is already visible
  // locally, and once on ack, in case a read that raced this write refilled the
  // cache from the server with pre-write data in between.
  invalidateRefDataForPath(path);
  increment();
  ack
    .catch((err) => {
      reportFailure(op, path, err);
    })
    .finally(() => {
      invalidateRefDataForPath(path);
      decrement();
    });
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

/**
 * A batch commit that does not block the UI on the server.
 *
 * WriteBatch.commit() resolves only on SERVER ACK — exactly like the raw
 * single-document writes these helpers exist to replace. Firestore still applies
 * every write in the batch to its local cache and queues it for sync, so
 * awaiting the commit offline hangs the caller while the data is already saved.
 * This was the last place in the app where that was still true.
 *
 * Usage mirrors the SDK's, with the commit handed here instead of awaited:
 *
 *     await safeWriteBatch("departments", (batch) => {
 *       batch.set(ref, data);
 *       batch.delete(other);
 *     });
 *
 * `label` is what the user sees if the batch is rejected, so it should name the
 * thing being saved rather than a collection path.
 *
 * NOTE: unlike the single-document helpers, this cannot invalidate the
 * reference-data cache — a batch spans many paths and `label` is not one. A
 * batch that writes to a cached collection (see REF_COLLECTIONS in refData.ts)
 * must call invalidateRefDataForPath itself.
 */
export async function safeWriteBatch(
  label: string,
  build: (batch: WriteBatch) => void,
): Promise<void> {
  const batch = writeBatch(db);
  build(batch);
  const ack = batch.commit();
  trackServerAck(ack, "writeBatch", label);
  return localFirst(ack, undefined);
}
