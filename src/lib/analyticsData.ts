// ── Analytics read layer ───────────────────────────────────────────────────────
// Every Analytics tab is its own component, mounted only while its tab is
// selected. Each one fired its own getDocs on mount — so clicking through the
// nine tabs scanned the period's jobs and invoices repeatedly, and clicking back
// to a tab paid for the identical scan all over again. Firestore's persistent
// cache does not help here: it spares reads for listeners resuming from a token,
// never for a one-shot getDocs.
//
// Routing every report read through refCache's keyed TTL cache fixes both, and a
// third problem the reports did not know they had: three separate tabs ask for
// "jobs created in this period" and three ask for invoices. Keyed by the query
// rather than by the component, they now share ONE read set between them.
//
// Keys start with the centerId so `invalidatePrefix(centerId)` drops a center's
// whole analytics working set in one call.
import {
  collection, getDocs, query, where, Timestamp,
  type Query, type DocumentData,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { cachedFetch, invalidatePrefix } from "./refCache";

// Reports are a read-only "look at the numbers" screen, not a live board, so
// they can tolerate a window far longer than the pickers do — long enough to
// cover a whole sitting with the date picker without re-reading anything.
const TTL_MS = 5 * 60_000;

const analyticsPrefix = (centerId: string) => `${centerId}:analytics:`;

function cacheKey(centerId: string, label: string, ...stamps: (number | string)[]): string {
  return `${analyticsPrefix(centerId)}${label}:${stamps.join("-")}`;
}

/**
 * Rounded down to midnight.
 *
 * The trailing-window queries ("jobs in the last 90 days") were built from
 * `new Date()`, so every mount produced a slightly different lower bound — and
 * would produce a different cache key every time, never hitting the cache. A
 * day-granular bound is what those reports actually mean anyway.
 */
function dayStart(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

async function cachedDocs<T>(key: string, build: () => Query<DocumentData>): Promise<T[]> {
  return cachedFetch<T[]>(
    key,
    async () => {
      const snap = await getDocs(build());
      return snap.docs.map(d => ({ id: d.id, ...d.data() }) as unknown as T);
    },
    TTL_MS,
  );
}

// ── Jobs ───────────────────────────────────────────────────────────────────────

/** Jobs created inside the selected period. Shared by Services, Profitability
 *  and Customers, which all ask for exactly this. */
export function fetchJobsInPeriod<T>(centerId: string, start: Date, end: Date): Promise<T[]> {
  return cachedDocs<T>(
    cacheKey(centerId, "jobs", start.getTime(), end.getTime()),
    () => query(
      collection(db, "servicecenters", centerId, "jobs"),
      where("createdAt", ">=", Timestamp.fromDate(start)),
      where("createdAt", "<=", Timestamp.fromDate(end)),
    ),
  );
}

/** Jobs created since a trailing cut-off, rounded to the start of that day. */
export function fetchJobsSince<T>(centerId: string, since: Date): Promise<T[]> {
  const from = dayStart(since);
  return cachedDocs<T>(
    cacheKey(centerId, "jobsSince", from.getTime()),
    () => query(
      collection(db, "servicecenters", centerId, "jobs"),
      where("createdAt", ">=", Timestamp.fromDate(from)),
    ),
  );
}

// ── Invoices ───────────────────────────────────────────────────────────────────

/** Every invoice created inside the period, whatever its status. */
export function fetchInvoicesInPeriod<T>(centerId: string, start: Date, end: Date): Promise<T[]> {
  return cachedDocs<T>(
    cacheKey(centerId, "invoices", start.getTime(), end.getTime()),
    () => query(
      collection(db, "servicecenters", centerId, "invoices"),
      where("createdAt", ">=", Timestamp.fromDate(start)),
      where("createdAt", "<=", Timestamp.fromDate(end)),
    ),
  );
}

/** Paid invoices created inside the period. */
export function fetchPaidInvoicesInPeriod<T>(centerId: string, start: Date, end: Date): Promise<T[]> {
  return cachedDocs<T>(
    cacheKey(centerId, "invoicesPaid", start.getTime(), end.getTime()),
    () => query(
      collection(db, "servicecenters", centerId, "invoices"),
      where("createdAt", ">=", Timestamp.fromDate(start)),
      where("createdAt", "<=", Timestamp.fromDate(end)),
      where("status", "==", "paid"),
    ),
  );
}

/** Paid invoices since a trailing cut-off, rounded to the start of that day. */
export function fetchPaidInvoicesSince<T>(centerId: string, since: Date): Promise<T[]> {
  const from = dayStart(since);
  return cachedDocs<T>(
    cacheKey(centerId, "invoicesPaidSince", from.getTime()),
    () => query(
      collection(db, "servicecenters", centerId, "invoices"),
      where("createdAt", ">=", Timestamp.fromDate(from)),
      where("status", "==", "paid"),
    ),
  );
}

// ── SMS ────────────────────────────────────────────────────────────────────────

/** SMS logs sent inside the period. */
export function fetchSmsLogsInPeriod<T>(centerId: string, start: Date, end: Date): Promise<T[]> {
  return cachedDocs<T>(
    cacheKey(centerId, "smsLogs", start.getTime(), end.getTime()),
    () => query(
      collection(db, "servicecenters", centerId, "smsLogs"),
      where("sentAt", ">=", Timestamp.fromDate(start)),
      where("sentAt", "<=", Timestamp.fromDate(end)),
    ),
  );
}

/**
 * Every reminder SMS ever sent, filtered to a period by the caller.
 *
 * Filtered on messageType alone (single-field, auto-indexed) because a
 * messageType + sentAt-range compound query needs a composite index that is not
 * guaranteed to exist in every deployment — so the range is applied on the
 * client. Range-independent, hence cached without the period in its key: moving
 * the date picker no longer re-reads it.
 */
export function fetchReminderSmsLogs<T>(centerId: string): Promise<T[]> {
  return cachedDocs<T>(
    cacheKey(centerId, "smsReminders"),
    () => query(
      collection(db, "servicecenters", centerId, "smsLogs"),
      where("messageType", "==", "Reminder"),
    ),
  );
}

// ── Suppliers & distributors ───────────────────────────────────────────────────

/** Supplies recorded inside the period. Shared by Expenses and Suppliers. */
export function fetchSupplierSuppliesInPeriod<T>(centerId: string, start: Date, end: Date): Promise<T[]> {
  return cachedDocs<T>(
    cacheKey(centerId, "supplierSupplies", start.getTime(), end.getTime()),
    () => query(
      collection(db, "servicecenters", centerId, "supplierSupplies"),
      where("createdAt", ">=", Timestamp.fromDate(start)),
      where("createdAt", "<=", Timestamp.fromDate(end)),
    ),
  );
}

/** Distributor orders placed inside the period. */
export function fetchDistributorOrdersInPeriod<T>(centerId: string, start: Date, end: Date): Promise<T[]> {
  return cachedDocs<T>(
    cacheKey(centerId, "distributorOrders", start.getTime(), end.getTime()),
    () => query(
      collection(db, "servicecenters", centerId, "distributorOrders"),
      where("createdAt", ">=", Timestamp.fromDate(start)),
      where("createdAt", "<=", Timestamp.fromDate(end)),
    ),
  );
}

/** Every distributor on file. Range-independent. */
export function fetchDistributors<T>(centerId: string): Promise<T[]> {
  return cachedDocs<T>(
    cacheKey(centerId, "distributors"),
    () => collection(db, "servicecenters", centerId, "distributors"),
  );
}

/** Open purchase-order plans. Range-independent: an order still waiting on a
 *  supplier is money committed today, whatever period is on screen. */
export function fetchPurchaseOrderPlans<T>(centerId: string): Promise<T[]> {
  return cachedDocs<T>(
    cacheKey(centerId, "purchaseOrderPlans"),
    () => collection(db, "servicecenters", centerId, "purchaseOrderPlans"),
  );
}

/**
 * Drop every cached analytics read for a center.
 *
 * Used where a report writes something the numbers on screen depend on (the
 * Expenses tab records an expense), so its reload sees the change instead of
 * the copy it just invalidated.
 */
export function invalidateAnalyticsData(centerId: string): void {
  invalidatePrefix(analyticsPrefix(centerId));
}
