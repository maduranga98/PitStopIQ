import { create } from "zustand";

interface DiagnosticReportsSettingsState {
  /** centerId this state was loaded for — guards against showing a stale
   *  flag after switching branches. */
  centerId: string | null;
  enabled: boolean;
  /** True once the flag has been read at least once for `centerId`. */
  loaded: boolean;
  setEnabled: (centerId: string, enabled: boolean) => void;
}

/**
 * Center-side gate for the four surfaces this module can appear on (job card
 * card, vehicle Reports section, dashboard tile, QR history Reports section).
 *
 * Read once per center — see useDiagnosticReportsEnabled below — rather than
 * as a per-render Firestore read. Switching branches invalidates it (a
 * different centerId means the cached flag no longer applies), and flipping
 * the setting itself only takes effect on the next read, which is the settings
 * screen's own optimistic local state in the meantime.
 */
export const useDiagnosticReportsSettingsStore = create<DiagnosticReportsSettingsState>((set) => ({
  centerId: null,
  enabled: false,
  loaded: false,
  setEnabled: (centerId, enabled) => set({ centerId, enabled, loaded: true }),
}));
