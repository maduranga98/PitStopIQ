import { useEffect } from "react";
import { fetchCenter } from "../lib/refData";
import { useWorkingHoursStore } from "../store/workingHoursSlice";
import type { WorkingHoursSettings } from "../lib/workingHours";

const OFF: WorkingHoursSettings = { trackingEnabled: false, invoiceBillingEnabled: false, defaultHourlyRate: null };

/**
 * The center's working-hours switches, served from the shared store. The
 * center document comes through the reference cache (lib/refData.ts), which
 * every write to the center invalidates, so this costs no read on most
 * visits and still follows a change made in Settings on the next screen.
 *
 * Reads as all-off until loaded: an opt-in feature must never flash on.
 */
export function useWorkingHoursSettings(centerId: string | undefined): WorkingHoursSettings & { loaded: boolean } {
  const stored = useWorkingHoursStore((s) => (s.centerId === centerId ? s : null));
  const setSettings = useWorkingHoursStore((s) => s.setSettings);

  useEffect(() => {
    if (!centerId) return;
    let active = true;
    fetchCenter(centerId)
      .then((center) => { if (active) setSettings(centerId, center); })
      .catch(() => { if (active && !useWorkingHoursStore.getState().loaded) setSettings(centerId, null); });
    return () => { active = false; };
  }, [centerId, setSettings]);

  return stored ? { ...stored.settings, loaded: stored.loaded } : { ...OFF, loaded: false };
}
