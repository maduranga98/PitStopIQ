// ── Super-admin usage & billing signals per service center ────────────────────
// The Service Centers list answers two questions the super admin asks about
// every center on the platform:
//
//   1. Are they a paying customer?  — do they have any recorded payment.
//   2. Are they actually using it?  — have they opened a job recently.
//
// Both are derived here rather than on the center document because nothing
// keeps a denormalised flag on `servicecenters` honest: a payment is written
// into the center's own `payments` sub-collection, and a job is written by the
// workshop with no super-admin-facing side effect.
//
// Cost matters — this runs for every center on one screen — so:
//   • payments are read once for the whole platform via a collection-group
//     query (the same read AdminPaymentsPage already does), not per center;
//   • recent jobs are counted with a server-side aggregation (one billed read
//     per 1,000 matched jobs, see lib/counts.ts) instead of downloading them,
//     and the "last used" date is a single `limit(1)` document.
import {
  collection, collectionGroup, limit, orderBy, query, where, Timestamp,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { boundedGetDocs } from "./firestoreRead";
import { countDocs } from "./counts";
import type { ServiceCenterPayment } from "../types/auth";

/** A center counts as "using the app" if it opened a job inside this window. */
export const ACTIVE_WINDOW_DAYS = 7;

export interface CenterUsage {
  /** Recorded payments with status "paid". 0 = never paid for anything. */
  paymentCount: number;
  /** Sum of those payments, in LKR. */
  paidTotal: number;
  /** Most recent payment date (ms), or null when never paid. */
  lastPaymentAt: number | null;
  /** Jobs created inside the active window. null = the count could not be read. */
  recentJobs: number | null;
  /** Most recent job creation date (ms). null = never, or unknown. */
  lastJobAt: number | null;
}

export const UNKNOWN_USAGE: CenterUsage = {
  paymentCount: 0,
  paidTotal: 0,
  lastPaymentAt: null,
  recentJobs: null,
  lastJobAt: null,
};

/** Has a payment history → a real customer, not just a registered account. */
export function isPayingCustomer(usage?: CenterUsage): boolean {
  return (usage?.paymentCount ?? 0) > 0;
}

/** Opened at least one job inside the active window → actively using the app. */
export function isActiveUser(usage?: CenterUsage): boolean {
  return (usage?.recentJobs ?? 0) > 0;
}

/** Whole days since `ms`, or null when there is nothing to measure from. */
export function daysSince(ms: number | null): number | null {
  if (ms == null) return null;
  return Math.max(0, Math.floor((Date.now() - ms) / 86_400_000));
}

/** "Today" / "3d ago" / "Never" — compact enough for a list row. */
export function sinceLabel(ms: number | null): string {
  const days = daysSince(ms);
  if (days === null) return "Never";
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function toMillis(value: unknown): number | null {
  const ts = value as Timestamp | undefined;
  return ts && typeof ts.seconds === "number" ? ts.seconds * 1000 : null;
}

/**
 * Every center's payment history, in one collection-group read.
 *
 * Keyed by the parent center document id rather than the payment's `centerId`
 * field, so a legacy payment written without that field still lands on the
 * right center — and so a same-named `payments` sub-collection elsewhere in
 * the database can never leak in.
 */
async function fetchPaymentSummaries(): Promise<Map<string, CenterUsage>> {
  const snap = await boundedGetDocs(collectionGroup(db, "payments"));
  const map = new Map<string, CenterUsage>();
  for (const d of snap.docs) {
    const parent = d.ref.parent.parent;
    if (!parent || parent.parent?.id !== "servicecenters") continue;
    const p = d.data() as ServiceCenterPayment;
    if (p.status && p.status !== "paid") continue;
    const at = toMillis(p.paidAt) ?? toMillis(p.createdAt);
    const acc = map.get(parent.id) ?? { ...UNKNOWN_USAGE };
    acc.paymentCount += 1;
    acc.paidTotal += p.amount ?? 0;
    if (at !== null && (acc.lastPaymentAt === null || at > acc.lastPaymentAt)) acc.lastPaymentAt = at;
    map.set(parent.id, acc);
  }
  return map;
}

/** Run `task` over `items`, at most `size` in flight at a time. */
async function pooled<T, R>(items: T[], size: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await task(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Recent-job count and last-job date for one center.
 *
 * Both reads are allowed to fail independently: an aggregation has no offline
 * path, and a center whose jobs can't be read should show as "unknown", never
 * take the whole list down.
 */
async function fetchJobActivity(centerId: string, since: Timestamp) {
  const jobs = collection(db, "servicecenters", centerId, "jobs");
  const [recent, last] = await Promise.all([
    countDocs(query(jobs, where("createdAt", ">=", since))).catch(() => null),
    boundedGetDocs(query(jobs, orderBy("createdAt", "desc"), limit(1)))
      .then((snap) => toMillis(snap.docs[0]?.data()?.createdAt))
      .catch(() => null),
  ]);
  return { recentJobs: recent, lastJobAt: last };
}

/**
 * Payment + activity signals for the given centers.
 *
 * Never rejects: whatever could be read is returned, and the rest stays at its
 * unknown defaults so the caller can render the list either way.
 */
export async function fetchCenterUsage(centerIds: string[]): Promise<Map<string, CenterUsage>> {
  const since = Timestamp.fromDate(new Date(Date.now() - ACTIVE_WINDOW_DAYS * 86_400_000));
  const payments = await fetchPaymentSummaries().catch((err) => {
    console.error("Center payment summary failed:", err);
    return new Map<string, CenterUsage>();
  });

  const usage = new Map<string, CenterUsage>();
  const activity = await pooled(centerIds, 6, (id) => fetchJobActivity(id, since));
  centerIds.forEach((id, i) => {
    usage.set(id, { ...UNKNOWN_USAGE, ...payments.get(id), ...activity[i] });
  });
  return usage;
}
