// ── Super-admin shared reads ──────────────────────────────────────────────────
// Five admin screens (Dashboard, Service Centers, Revenue, Unpaid, SMS Log) each
// downloaded the whole `servicecenters` collection on every visit, and three of
// them also downloaded every payment on the platform. Walking the sidebar
// therefore re-billed the same documents over and over.
//
// These fetchers share one copy through the keyed TTL cache (see refCache.ts):
// concurrent callers join a single round-trip and repeat visits inside the TTL
// cost zero reads. Pages that WRITE to centers or payments call
// `useInvalidateAdminDataOnLeave` so the next screen reads fresh data.
import { useEffect } from "react";
import { collection, collectionGroup, orderBy, query } from "firebase/firestore";
import { db } from "../config/firebase";
import { boundedGetDocs } from "./firestoreRead";
import { cachedFetch, invalidate } from "./refCache";
import type { ServiceCenter, ServiceCenterPayment } from "../types/auth";

/** Long enough to cover a walk through the sidebar, short enough that data
 *  changed elsewhere (a centre registering, a slip approved) appears quickly. */
export const ADMIN_TTL_MS = 5 * 60_000;

const CENTERS_KEY = "admin:centers";
const PAYMENTS_KEY = "admin:payments";

/** A payment plus the id of the centre it lives under (from the document path). */
export type AdminPayment = ServiceCenterPayment & { parentCenterId: string };

/** Every service centre, newest first. One shared read. */
export function getAdminCenters(): Promise<ServiceCenter[]> {
  return cachedFetch(CENTERS_KEY, async () => {
    const snap = await boundedGetDocs(query(collection(db, "servicecenters"), orderBy("createdAt", "desc")));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ServiceCenter);
  }, ADMIN_TTL_MS);
}

/** Every payment on the platform (collection group). One shared read. */
export function getAdminPayments(): Promise<AdminPayment[]> {
  return cachedFetch(PAYMENTS_KEY, async () => {
    const snap = await boundedGetDocs(collectionGroup(db, "payments"));
    const out: AdminPayment[] = [];
    for (const d of snap.docs) {
      const parent = d.ref.parent.parent;
      // Only payments under a service centre — a same-named sub-collection
      // elsewhere must never leak in.
      if (!parent || parent.parent?.id !== "servicecenters") continue;
      out.push({ id: d.id, ...d.data(), parentCenterId: parent.id } as AdminPayment);
    }
    return out;
  }, ADMIN_TTL_MS);
}

/** Drop the shared copies so the next read goes to the server. */
export function invalidateAdminData(): void {
  invalidate(CENTERS_KEY);
  invalidate(PAYMENTS_KEY);
  invalidate("admin:usage");
}

/** Call from any admin page that writes to centers/payments. */
export function useInvalidateAdminDataOnLeave(): void {
  useEffect(() => invalidateAdminData, []);
}
