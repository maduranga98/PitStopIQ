import { useEffect } from "react";
import { doc } from "firebase/firestore";
import { db } from "../config/firebase";
import { boundedGetDoc } from "../lib/firestoreRead";
import { inspectionReportsModuleEnabled } from "../lib/inspectionReports/paths";
import { useInspectionReportsSettingsStore } from "../store/inspectionReportsSlice";

/**
 * Bootstraps standaloneInspectionEnabled into the Zustand slice once per center
 * and returns it. Every gated surface calls this instead of reading the center
 * document itself: one read, then served from the store.
 */
export function useInspectionReportsEnabled(centerId: string | undefined): boolean {
  const stored = useInspectionReportsSettingsStore((s) => (s.centerId === centerId ? s : null));
  const setEnabled = useInspectionReportsSettingsStore((s) => s.setEnabled);

  useEffect(() => {
    if (!centerId || stored?.loaded) return;
    let active = true;
    boundedGetDoc(doc(db, "servicecenters", centerId))
      .then((snap) => {
        if (!active) return;
        setEnabled(centerId, snap.exists() && inspectionReportsModuleEnabled(snap.data()));
      })
      .catch(() => {
        if (active) setEnabled(centerId, false);
      });
    return () => { active = false; };
  }, [centerId, stored?.loaded, setEnabled]);

  return stored?.enabled ?? false;
}
