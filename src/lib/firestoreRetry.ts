import {
  getDoc, getDocs,
  type DocumentReference, type DocumentData, type DocumentSnapshot,
  type Query, type QuerySnapshot,
} from "firebase/firestore";

// A handful of retries with a short backoff, for reads on the public,
// unauthenticated portal pages (customer view, invoice view). Firestore's
// offline-first persistence (see src/config/firebase.ts — single-tab manager
// with forceOwnership) can abort an in-flight read when the browser reclaims
// the primary lease from a stale tab (backgrounded tab revived, link opened
// twice, etc.) — a transient hiccup, not a sign the record doesn't exist. A
// bare, unretried read used to let that abort fall straight into the "not
// found" branch, permanently showing a customer their own portal was gone.
const DEFAULT_ATTEMPTS = 3;
const RETRY_DELAY_MS = 400;

export async function getDocWithRetry<T extends DocumentData>(
  ref: DocumentReference<T>,
  attempts = DEFAULT_ATTEMPTS,
): Promise<DocumentSnapshot<T>> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await getDoc(ref);
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
      return await getDocs(q);
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (i + 1)));
    }
  }
  throw lastErr;
}
