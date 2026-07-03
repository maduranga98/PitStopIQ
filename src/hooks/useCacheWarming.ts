import { useEffect, useRef } from "react";
import {
  collection, doc, getDoc, getDocs, query, where, limit,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { useCacheWarmingStore } from "../store/cacheWarmingSlice";

type WarmingState = "idle" | "warming" | "warmed" | "error";

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
      getDocs(query(
        collection(db, centerRef, "services"),
        where("status", "!=", "delivered"),
        limit(100),
      )),
      getDocs(query(collection(db, centerRef, "customers"), limit(500))),
      getDocs(query(collection(db, centerRef, "vehicles"), limit(500))),
      getDocs(query(
        collection(db, centerRef, "serviceLibrary"),
        where("isActive", "==", true),
      )),
    ];

    if (isPro) {
      queries.push(
        getDocs(query(
          collection(db, centerRef, "inventory"),
          where("isActive", "==", true),
        )),
        getDocs(query(
          collection(db, centerRef, "staff"),
          where("isActive", "==", true),
        )),
        getDoc(doc(db, centerRef, "settings", "rolePermissions")),
      );
    }

    Promise.all(queries)
      .then(() => {
        stateRef.current = "warmed";
        const now = new Date();
        setWarmedAt(now);
        if (import.meta.env.DEV) {
          console.log(`[CacheWarming] Completed at ${now.toISOString()}`);
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
