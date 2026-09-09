// ── Count-only reads ───────────────────────────────────────────────────────────
// Firestore bills an aggregation query at ONE read per 1,000 documents matched,
// against one read per document for the equivalent getDocs. Anywhere the app
// wants a number and nothing else — a sidebar badge, "how many staff still hold
// this role" — downloading the documents to call .size on them is paying up to a
// thousand times over for a figure the server can return on its own.
//
// Caveat, and the reason this is a helper rather than a blanket rule: an
// aggregation is server-only. It has no offline path and no cache fallback, so
// it throws when the device is offline instead of quietly answering from the
// local copy. Only use it where a missing number degrades gracefully — a badge
// that stays hidden, a guard that falls back to asking the server later — and
// always handle the rejection.
import { getCountFromServer, type Query, type DocumentData } from "firebase/firestore";

/** How many documents match, without reading any of them. */
export async function countDocs(q: Query<DocumentData>): Promise<number> {
  const snap = await getCountFromServer(q);
  return snap.data().count;
}

/** Sum of several counts, resolved in parallel. */
export async function countAll(...queries: Query<DocumentData>[]): Promise<number> {
  const counts = await Promise.all(queries.map(countDocs));
  return counts.reduce((sum, n) => sum + n, 0);
}
