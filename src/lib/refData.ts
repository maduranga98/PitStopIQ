// ── Cached reference data ──────────────────────────────────────────────────────
// The small, slow-changing collections the app re-reads on nearly every screen:
// customers, vehicles, staff, the service-price catalog and suppliers.
//
// Why this exists: a one-shot getDocs() ALWAYS goes to the server and ALWAYS
// bills for every document it returns. Firestore's persistent cache only saves
// reads for listeners, which resume from a stored token — it does nothing for a
// getDocs the app fires again on the next mount. So the pickers on New Service,
// New Invoice, New Quotation and Add Vehicle each re-read (and re-pay for) the
// whole customer and vehicle collections every single time they are opened.
//
// Every reference read now goes through refCache's keyed TTL cache, so:
//  - re-opening a picker inside the TTL costs ZERO reads
//  - concurrent callers share ONE round-trip instead of racing
//  - "the vehicles of customer X" is derived from the already-cached full list
//    rather than being its own query
//
// Freshness is not left to the TTL alone: every write through firestoreWrite.ts
// invalidates the collection it touched (see invalidateRefDataForPath below), so
// an edit shows up on the very next read.
//
// NOT for live data. Money, stock levels and job status still need a listener —
// see the module header in refCache.ts.
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../config/firebase";
import { cachedFetch, invalidate } from "./refCache";
import type {
  Customer, Vehicle, StaffMember, ServicePriceItem, Supplier,
} from "../types/auth";

/** Collections served from the reference cache, keyed by their Firestore name. */
export const REF_COLLECTIONS = [
  "customers", "vehicles", "staff", "servicePrices", "suppliers", "inventory",
] as const;

export type RefCollection = (typeof REF_COLLECTIONS)[number];

const REF_COLLECTION_SET = new Set<string>(REF_COLLECTIONS);

/**
 * Cache key for one center's copy of a collection.
 *
 * The centerId comes FIRST so `invalidatePrefix(centerId)` drops everything a
 * center owns in one call — used on branch switch so no data ever leaks across
 * centers.
 */
export const refKey = (centerId: string, name: RefCollection): string =>
  `${centerId}:${name}`;

// People and vehicles change during a working day (a new customer is added at
// the counter and wanted on the next screen), so they get a short window.
// Staff, the price catalog and suppliers change a few times a month.
const TTL_SHORT_MS = 60_000;
const TTL_LONG_MS = 5 * 60_000;

// ── Fetchers ───────────────────────────────────────────────────────────────────

// Sorting happens client-side rather than with orderBy("name"). Two reasons:
// Firestore drops any document missing the ordered field, so a record saved
// without a name would silently vanish from a picker; and ordering in the query
// would need a composite index alongside the isDeleted filter for no gain, since
// the whole result set is already in memory.
const byName = <T extends { name?: string }>(a: T, b: T) =>
  String(a.name ?? "").localeCompare(String(b.name ?? ""));

/** Every non-deleted customer, ordered by name. */
export function fetchCustomers(centerId: string): Promise<Customer[]> {
  return cachedFetch(
    refKey(centerId, "customers"),
    async () => {
      const snap = await getDocs(query(
        collection(db, "servicecenters", centerId, "customers"),
        where("isDeleted", "==", false),
      ));
      return snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Customer))
        .sort(byName);
    },
    TTL_SHORT_MS,
  );
}

/** Every non-deleted vehicle in the center. */
export function fetchVehicles(centerId: string): Promise<Vehicle[]> {
  return cachedFetch(
    refKey(centerId, "vehicles"),
    async () => {
      const snap = await getDocs(query(
        collection(db, "servicecenters", centerId, "vehicles"),
        where("isDeleted", "==", false),
      ));
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as Vehicle));
    },
    TTL_SHORT_MS,
  );
}

/**
 * One customer's vehicles, filtered out of the cached full list.
 *
 * This used to be its own `where("customerId", "==", ...)` query fired every
 * time a customer was picked — so choosing three customers in a row while
 * writing a job cost three extra round-trips on top of the full list the page
 * had already loaded. The full list is in the cache by then, so this is free.
 */
export async function fetchVehiclesForCustomer(
  centerId: string,
  customerId: string,
): Promise<Vehicle[]> {
  const all = await fetchVehicles(centerId);
  return all.filter(v => v.customerId === customerId);
}

/** Every staff member, active or not. Small enough to cache whole. */
export function fetchStaff(centerId: string): Promise<StaffMember[]> {
  return cachedFetch(
    refKey(centerId, "staff"),
    async () => {
      const snap = await getDocs(collection(db, "servicecenters", centerId, "staff"));
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as StaffMember));
    },
    TTL_LONG_MS,
  );
}

// `active === true` rather than `!== false` on purpose: it mirrors exactly what
// the `where("active", "==", true)` queries these helpers replace returned, so a
// legacy document missing the field keeps being treated the same way it was.

/** Active staff only, filtered out of the cached staff list. */
export async function fetchActiveStaff(centerId: string): Promise<StaffMember[]> {
  const all = await fetchStaff(centerId);
  return all.filter(s => s.active === true);
}

/** Active technicians, filtered out of the cached staff list. */
export async function fetchTechnicians(centerId: string): Promise<StaffMember[]> {
  const all = await fetchStaff(centerId);
  return all.filter(s => s.role === "Technician" && s.active === true);
}

/** The service-price catalog, ordered by name. */
export function fetchServicePrices(centerId: string): Promise<ServicePriceItem[]> {
  return cachedFetch(
    refKey(centerId, "servicePrices"),
    async () => {
      const snap = await getDocs(collection(db, "servicecenters", centerId, "servicePrices"));
      return snap.docs
        .map(d => ({ id: d.id, ...d.data() } as ServicePriceItem))
        .sort(byName);
    },
    TTL_LONG_MS,
  );
}

/** Every supplier on file. */
export function fetchSuppliers(centerId: string): Promise<Supplier[]> {
  return cachedFetch(
    refKey(centerId, "suppliers"),
    async () => {
      const snap = await getDocs(collection(db, "servicecenters", centerId, "suppliers"));
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as Supplier));
    },
    TTL_LONG_MS,
  );
}

// ── Invalidation ───────────────────────────────────────────────────────────────

/** Drop one cached collection for one center. */
export function invalidateRefData(centerId: string, name: RefCollection): void {
  invalidate(refKey(centerId, name));
}

/**
 * Invalidate whatever cached collection a written document belongs to.
 *
 * Called for every write that goes through firestoreWrite.ts, so a page never
 * has to remember to invalidate by hand — forgetting is what turns a read cache
 * into a stale-data bug. Paths look like
 * `servicecenters/{centerId}/{collection}/{docId}`; anything that isn't a
 * cached reference collection is ignored.
 */
export function invalidateRefDataForPath(path: string): void {
  const parts = path.split("/");
  if (parts.length < 4 || parts[0] !== "servicecenters") return;
  const [, centerId, name] = parts;
  if (!REF_COLLECTION_SET.has(name)) return;
  invalidate(refKey(centerId, name as RefCollection));
}
