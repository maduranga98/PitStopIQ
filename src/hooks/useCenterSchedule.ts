import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../config/firebase";
import {
  DEFAULT_WEEKLY_HOURS, DEFAULT_SLOT_DURATION_MINUTES, type ScheduleConfig,
} from "../lib/scheduling";

const DEFAULT_SCHEDULE: ScheduleConfig = {
  weeklyHours: DEFAULT_WEEKLY_HOURS,
  slotDurationMinutes: DEFAULT_SLOT_DURATION_MINUTES,
  calendarOverrides: {},
};

/**
 * The center's working-days config (Settings → Working Hours), live. Every
 * feature that has to know whether the workshop is open on a date — bookings,
 * attendance, payroll stats — reads it from here so a center that opens on
 * Sunday and closes on Monday is treated the same everywhere.
 *
 * Falls back to the defaults while loading or if the doc can't be read.
 */
export function useCenterSchedule(centerId: string | undefined): ScheduleConfig {
  // null until the center doc is read — the defaults stand in meanwhile, and
  // a center switch falls back to them rather than showing stale hours.
  const [schedule, setSchedule] = useState<ScheduleConfig | null>(null);

  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(
      doc(db, "servicecenters", centerId),
      (snap) => {
        const d = snap.data() ?? {};
        setSchedule({
          weeklyHours: d.weeklyHours ?? DEFAULT_WEEKLY_HOURS,
          slotDurationMinutes: d.slotDurationMinutes ?? DEFAULT_SLOT_DURATION_MINUTES,
          calendarOverrides: d.calendarOverrides ?? {},
        });
      },
      () => setSchedule(null),
    );
  }, [centerId]);

  return centerId && schedule ? schedule : DEFAULT_SCHEDULE;
}

export default useCenterSchedule;
