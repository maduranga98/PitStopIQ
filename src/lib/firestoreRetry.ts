import {
  type DocumentReference, type DocumentData, type DocumentSnapshot,
  type Query, type QuerySnapshot,
} from "firebase/firestore";
import { boundedGetDoc, boundedGetDocs } from "./firestoreRead";

// A handful of retries with a short backoff, for reads on the public,
// unauthenticated portal pages (customer view, invoice view). Firestore's
// offline-first persistence (see src/config/firebase.ts — single-tab manager
// with forceOwnership) can abort an in-flight read when the browser reclaims
// the primary lease from a stale tab (backgrounded tab revived, link opened
// twice, etc.) — a transient hiccup, not a sign the record doesn't exist. A
// bare, unretried read used to let that abort fall straight into the "not
// found" branch, permanently showing a customer their own portal was gone.
// Each attempt is a BOUNDED read (lib/firestoreRead.ts), not a bare one.
// Retrying a read that can never time out is no protection at all: the very
// first attempt on a connection that stalls mid-read simply never settles, so
// the ladder below never gets to attempt two and the portal page waits
// forever on a spinner. Bounding each attempt is what makes the retry
// reachable, and gives the last one an offline-cache fallback besides.
const DEFAULT_ATTEMPTS = 3;
const RETRY_DELAY_MS = 400;

export async function getDocWithRetry<T extends DocumentData>(
  ref: DocumentReference<T>,
  attempts = DEFAULT_ATTEMPTS,
): Promise<DocumentSnapshot<T>> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await boundedGetDoc(ref);
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (i + 1)));
    }
  }
  throw lastErr;
}

export async function getDocsWithRetry<T extends DocumentData>(
  q: Query<T>,
  attempts = DEFAULT_ATTEMPTS,
): Promise<QuerySnapshot<T>> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await boundedGetDocs(q);
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (i + 1)));
    }
  }
  throw lastErr;
}
