import { useEffect } from "react";
import { fetchCenter } from "../lib/refData";
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
    fetchCenter(centerId)
      .then((center) => {
        if (!active) return;
        setEnabled(centerId, !!center && inspectionReportsModuleEnabled(center));
      })
      .catch(() => {
        if (active) setEnabled(centerId, false);
      });
    return () => { active = false; };
  }, [centerId, stored?.loaded, setEnabled]);

  return stored?.enabled ?? false;
}
