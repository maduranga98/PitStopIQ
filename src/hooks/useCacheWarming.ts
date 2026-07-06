import { useEffect, useRef } from "react";
import {
  collection, doc, getDoc, getDocs, query, orderBy, limit,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { useCacheWarmingStore } from "../store/cacheWarmingSlice";

type WarmingState = "idle" | "warming" | "warmed" | "error";

// Pre-fetch the data the offline flows need into the persistent Firestore
// cache, so service creation → invoice → SMS queueing keeps working when
// connectivity drops. Collections warmed here must match the queries the
// pages actually run (jobs / servicePrices / invoices / staff / inventory).
export function useCacheWarming(centerId: string | undefined, isPro: boolean) {
  const warmedAt = useCacheWarmingStore((s) => s.warmedAt);
  const setWarmedAt = useCacheWarmingStore((s) => s.setWarmedAt);
  const stateRef = useRef<WarmingState>("idle");

  useEffect(() => {
    if (!centerId || !navigator.onLine || warmedAt) return;

    stateRef.current = "warming";
    const centerRef = `servicecenters/${centerId}`;

    const queries: Promise<unknown>[] = [
      getDoc(doc(db, centerRef)),
      // Recent jobs — ordered by jobNumber so offline job-number generation
      // always sees the latest number in cache.
      getDocs(query(
        collection(db, centerRef, "jobs"),
        orderBy("jobNumber", "desc"),
        limit(200),
      )),
      getDocs(query(collection(db, centerRef, "customers"), limit(500))),
      getDocs(query(collection(db, centerRef, "vehicles"), limit(500))),
      // Priced service catalog — used to build invoice line items.
      getDocs(query(collection(db, centerRef, "servicePrices"), limit(500))),
      // Recent invoices — offline invoice numbering + linked-invoice lookups.
      getDocs(query(
        collection(db, centerRef, "invoices"),
        orderBy("createdAt", "desc"),
        limit(200),
      )),
      // Technician dropdown on New Service needs the staff list.
      getDocs(query(collection(db, centerRef, "staff"), limit(200))),
      // Role permissions so permission checks resolve offline.
      getDoc(doc(db, centerRef, "settings", "rolePermissions")),
    ];

    if (isPro) {
      queries.push(
        getDocs(query(collection(db, centerRef, "inventory"), limit(500))),
      );
    }

    // allSettled: one missing index or empty collection must not abort
    // warming everything else.
    Promise.allSettled(queries)
      .then((results) => {
        stateRef.current = "warmed";
        const now = new Date();
        setWarmedAt(now);
        if (import.meta.env.DEV) {
          const failed = results.filter((r) => r.status === "rejected").length;
          console.log(`[CacheWarming] Completed at ${now.toISOString()} (${failed} queries failed)`);
        }
      })
      .catch(() => {
        stateRef.current = "error";
      });
  }, [centerId, isPro, warmedAt, setWarmedAt]);

  return {
    isWarming: stateRef.current === "warming",
    isWarmed: stateRef.current === "warmed",
    warmedAt,
  };
}
