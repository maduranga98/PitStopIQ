import { useEffect } from "react";
import { doc } from "firebase/firestore";
import { db } from "../config/firebase";
import { boundedGetDoc } from "../lib/firestoreRead";
import { reportsModuleEnabled } from "../lib/diagnosticReports";
import { useDiagnosticReportsSettingsStore } from "../store/diagnosticReportsSlice";

/**
 * Bootstraps the diagnosticReportsEnabled flag into the Zustand slice once per
 * center, and returns it. The four gated surfaces (job card, vehicle Reports
 * section, dashboard tile, QR history Reports section) call this instead of
 * reading the center document themselves — the flag is read once and then
 * served from the store, not re-fetched on every render.
 */
export function useDiagnosticReportsEnabled(centerId: string | undefined): boolean {
  const stored = useDiagnosticReportsSettingsStore((s) => (s.centerId === centerId ? s : null));
  const setEnabled = useDiagnosticReportsSettingsStore((s) => s.setEnabled);

  useEffect(() => {
    if (!centerId || stored?.loaded) return;
    let active = true;
    boundedGetDoc(doc(db, "servicecenters", centerId))
      .then((snap) => {
        if (!active) return;
        const data = snap.exists() ? snap.data() : undefined;
        setEnabled(centerId, !!data && reportsModuleEnabled(data as { diagnosticReportsEnabled?: boolean }));
      })
      .catch(() => {
        if (active) setEnabled(centerId, false);
      });
    return () => { active = false; };
  }, [centerId, stored?.loaded, setEnabled]);

  return stored?.enabled ?? false;
}
