import { create } from "zustand";
import { doc } from "firebase/firestore";
import { db } from "../config/firebase";
import { safeUpdateDoc } from "../lib/firestoreWrite";
import {
  buildLogEntry, timerEventWrite, workingHoursSettingsOf,
  type WorkingHoursSettings,
} from "../lib/workingHours";
import type { ServiceCenter, ServiceJob, WorkingPauseReason } from "../types/auth";

type TimerAction = "start" | "pause" | "resume";

interface WorkingHoursState {
  /** centerId the settings below were read for — a branch switch invalidates them. */
  centerId: string | null;
  settings: WorkingHoursSettings;
  loaded: boolean;
  /** Job ids with a timer write in flight, so a double tap can't log twice. */
  pendingJobIds: Record<string, true>;

  setSettings: (centerId: string, center: Partial<ServiceCenter> | null) => void;
  /**
   * Append one Start/Pause/Resume event to a job's log. Goes through the
   * app's normal write helper, so offline it lands in Firestore's own queue
   * and resolves at once, exactly like every other job write. A pause
   * without a reason is refused before anything is written.
   */
  logTimerEvent: (
    centerId: string,
    job: Pick<ServiceJob, "id" | "timeLog">,
    action: TimerAction,
    uid: string,
    reason?: WorkingPauseReason | null,
  ) => Promise<void>;
}

const EMPTY: WorkingHoursSettings = { trackingEnabled: false, invoiceBillingEnabled: false, defaultHourlyRate: null };

/**
 * The center's working-hours settings, shared by every surface that gates on
 * them (new-job form, job card, job list, invoice), plus the timer actions.
 * Settings are read once per center through the cached center fetch — see
 * useWorkingHoursSettings — and the Settings screen pushes its own changes in
 * straight away so the rest of the app never shows a stale switch.
 */
export const useWorkingHoursStore = create<WorkingHoursState>((set, get) => ({
  centerId: null,
  settings: EMPTY,
  loaded: false,
  pendingJobIds: {},

  setSettings: (centerId, center) =>
    set({ centerId, settings: workingHoursSettingsOf(center), loaded: true }),

  logTimerEvent: async (centerId, job, action, uid, reason = null) => {
    if (get().pendingJobIds[job.id]) return;
    const entry = buildLogEntry(action, uid, action === "pause" ? reason : null);
    const { fields } = timerEventWrite(job.timeLog, entry);
    set((s) => ({ pendingJobIds: { ...s.pendingJobIds, [job.id]: true } }));
    try {
      await safeUpdateDoc(doc(db, "servicecenters", centerId, "jobs", job.id), fields);
    } finally {
      set((s) => {
        const { [job.id]: _done, ...rest } = s.pendingJobIds;
        void _done;
        return { pendingJobIds: rest };
      });
    }
  },
}));
