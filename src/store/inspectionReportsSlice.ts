import { create } from "zustand";

interface InspectionReportsSettingsState {
  /** centerId this state was loaded for — guards against a stale flag after a branch switch. */
  centerId: string | null;
  enabled: boolean;
  /** True once the flag has been read at least once for `centerId`. */
  loaded: boolean;
  setEnabled: (centerId: string, enabled: boolean) => void;
}

/** Center-side gate for every Inspection Reports entry point (nav, vehicle
 *  page, routes). Read once per center — see useInspectionReportsEnabled. */
export const useInspectionReportsSettingsStore = create<InspectionReportsSettingsState>((set) => ({
  centerId: null,
  enabled: false,
  loaded: false,
  setEnabled: (centerId, enabled) => set({ centerId, enabled, loaded: true }),
}));
