// ── Bounded reads ──────────────────────────────────────────────────────────────
// Firestore's getDoc/getDocs have NO timeout of their own. On a connection that
// completes the TCP handshake but then stalls — a carrier proxy, a captive
// Wi-Fi portal, one bar of signal — the promise simply never settles. Every
// caller `await`-ing it is stuck forever: a spinner that never stops, or a
// Save button that stays disabled with no error, which is what "I pressed it
// and nothing happened" looks like from the counter.
//
// Writes were already protected (firestoreWrite.ts caps the server-ack wait).
// Reads were not, and the pre-flight read in front of a write — "does this
// vehicle already have an open job?" — is exactly the read that hangs the
// button. That is what this module is for.
//
// AuthContext carries its own private copy of this logic, deliberately: the
// sign-in path also needs a retry ladder and an offline-cache fallback, and it
// runs before anything else in the app is ready.
import {
  getDocs, getDocsFromCache, getDoc, getDocFromCache,
  type Query, type QuerySnapshot, type DocumentData,
  type DocumentReference, type DocumentSnapshot,
} from "firebase/firestore";

/** How long any single read may take before we stop waiting on it. Far longer
 *  than a healthy read (tens of milliseconds), short enough that the user gets
 *  an answer instead of a spinner. */
export const READ_TIMEOUT_MS = 10_000;

export class ReadTimeoutError extends Error {
  constructor() {
    super("The connection stalled while loading. Please try again.");
    this.name = "ReadTimeoutError";
  }
}

/**
 * Resolve `work`, or reject with ReadTimeoutError once the budget is spent.
 *
 * The original promise keeps a no-op catch so that a rejection arriving after
 * we have moved on can't surface as an unhandled rejection.
 */
export function withReadTimeout<T>(work: Promise<T>, ms = READ_TIMEOUT_MS): Promise<T> {
  work.catch(() => {});
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    work.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new ReadTimeoutError()), ms);
    }),
  ]);
}

/**
 * getDocs, bounded, falling back to the offline cache.
 *
 * When the network won't answer inside the budget, the locally cached copy of
 * the same query is a far better answer than hanging — the persistent cache
 * (see config/firebase.ts) holds whatever this device has already seen. Only
 * when there is no cached copy either does this reject, and the caller can
 * show a real error.
 */
export async function boundedGetDocs<T extends DocumentData>(
  q: Query<T>,
  ms = READ_TIMEOUT_MS,
): Promise<QuerySnapshot<T>> {
  try {
    return await withReadTimeout(getDocs(q), ms);
  } catch (err) {
    const cached = await getDocsFromCache(q).catch(() => undefined);
    if (cached) return cached;
    throw err;
  }
}

/**
 * getDoc, bounded, falling back to the offline cache — the single-document
 * counterpart of boundedGetDocs above, for exactly the same reason: a plain
 * getDoc has no timeout, and callers chaining several of these in a row (a
 * stock check per part, a vehicle lookup, an invoice-number lookup — see
 * ServiceDetailPage's Mark Done flow) turn one stalled connection into every
 * step after it hanging too, with the action button stuck on its "…" label
 * forever and no error.
 */
export async function boundedGetDoc<T extends DocumentData>(
  ref: DocumentReference<T>,
  ms = READ_TIMEOUT_MS,
): Promise<DocumentSnapshot<T>> {
  try {
    return await withReadTimeout(getDoc(ref), ms);
  } catch (err) {
    const cached = await getDocFromCache(ref).catch(() => undefined);
    if (cached) return cached;
    throw err;
  }
}

// ── Batched "get these specific documents" reads ────────────────────────────
// A per-part stock check, a per-staff attendance read: N independent ids,
// each one `boundedGetDoc`-ed in its own request. Running them in
// Promise.all (rather than one after another) already turned N sequential
// round trips into one wait, but it is still N requests over the wire.
//
// Firestore's `where(documentId(), "in", [...])` answers "give me exactly
// these documents" in a single query — the same documents, the same reads
// billed, but one round trip (or one per 30 ids: that operator's own cap).
// `idChunks` is the batching that cap forces on a caller with more ids than
// that; most callers here have far fewer than 30 and get a single chunk.
export const IN_QUERY_MAX_IDS = 30;

/** Split `ids` into chunks of at most `IN_QUERY_MAX_IDS`, Firestore's limit
 *  for a `where(documentId(), "in", ...)` (or any `in`) filter. */
export function idChunks(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += IN_QUERY_MAX_IDS) {
    out.push(ids.slice(i, i + IN_QUERY_MAX_IDS));
  }
  return out;
}
