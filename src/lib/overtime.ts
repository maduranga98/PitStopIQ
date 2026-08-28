import type { AttendanceDayRecord, OvertimeSettings } from "../types/auth";

/**
 * Shift and overtime policy every center starts from. A center that has never
 * opened Payroll Settings still gets sensible late detection and OT, and a
 * settings document saved before a field existed falls back to these values.
 */
export const DEFAULT_OVERTIME_SETTINGS: OvertimeSettings = {
  shiftStart: "08:30",
  shiftEnd: "17:00",
  graceMinutes: 15,
  otEnabled: true,
  otMinimumMinutes: 30,
  otRoundingMinutes: 15,
  otRateMode: "multiplier",
  otHourlyRate: 0,
  otMultiplier: 1.5,
  standardDaysPerMonth: 26,
  standardHoursPerDay: 8,
};

/** Fills in any field a stored settings document is missing. */
export function withOvertimeDefaults(
  partial: Partial<OvertimeSettings> | null | undefined,
): OvertimeSettings {
  return { ...DEFAULT_OVERTIME_SETTINGS, ...(partial ?? {}) };
}

/** "08:30" → 510 minutes past midnight. Null for anything unparseable. */
export function parseClockTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** 510 → "08:30". */
export function formatClockTime(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "1h 20m" for a duration in minutes; "—" when there is nothing to show. */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes == null || minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * How late a clock-in is, in minutes, after the grace period. A holiday isn't
 * a working day, so nobody is late on one.
 */
export function lateMinutesFor(
  inTime: string | null | undefined,
  status: AttendanceDayRecord["status"] | undefined,
  settings: OvertimeSettings,
): number {
  if (status === "holiday" || status === "absent") return 0;
  const inMin = parseClockTime(inTime);
  const startMin = parseClockTime(settings.shiftStart);
  if (inMin == null || startMin == null) return 0;
  const late = inMin - startMin - (settings.graceMinutes ?? 0);
  return late > 0 ? late : 0;
}

/**
 * Minutes between clock-in and clock-out. An out time earlier than the in
 * time is read as a shift that ran past midnight rather than as bad data.
 */
export function workedMinutesFor(
  inTime: string | null | undefined,
  outTime: string | null | undefined,
): number | null {
  const inMin = parseClockTime(inTime);
  const outMin = parseClockTime(outTime);
  if (inMin == null || outMin == null) return null;
  return outMin >= inMin ? outMin - inMin : outMin + 1440 - inMin;
}

/**
 * Overtime hours a day's clock times earn.
 *
 * On a normal working day that's whatever was worked past the shift end. A
 * holiday has no shift to run past, so every hour worked on one is overtime.
 * The center's minimum and rounding are applied last, and the result is
 * hours (not minutes) because that's what a payslip prices.
 */
export function overtimeHoursFor(
  record: Pick<AttendanceDayRecord, "status" | "inTime" | "outTime">,
  settings: OvertimeSettings,
): number {
  if (!settings.otEnabled) return 0;
  const worked = workedMinutesFor(record.inTime, record.outTime);
  if (worked == null) return 0;

  let otMinutes: number;
  if (record.status === "holiday") {
    otMinutes = worked;
  } else {
    const outMin = parseClockTime(record.outTime);
    const endMin = parseClockTime(settings.shiftEnd);
    if (outMin == null || endMin == null) return 0;
    // A shift that ended past midnight reads as a smaller clock value than
    // the shift end; shift it forward a day before comparing.
    const normalisedOut = outMin < (parseClockTime(record.inTime) ?? 0) ? outMin + 1440 : outMin;
    otMinutes = normalisedOut - endMin;
  }

  if (otMinutes < (settings.otMinimumMinutes ?? 0)) return 0;
  const rounding = settings.otRoundingMinutes ?? 0;
  if (rounding > 0) otMinutes = Math.floor(otMinutes / rounding) * rounding;
  if (otMinutes <= 0) return 0;
  return Number((otMinutes / 60).toFixed(2));
}

/** The OT hours to use for a day — the hand-typed figure when there is one. */
export function effectiveOtHours(
  record: AttendanceDayRecord | undefined,
  settings: OvertimeSettings,
): number {
  if (!record) return 0;
  if (record.otManual) return record.otHours ?? 0;
  return overtimeHoursFor(record, settings);
}

/**
 * LKR per overtime hour. A flat rate is used as given; a multiplier is applied
 * to the hourly rate implied by the basic salary and the center's standard
 * days/hours.
 */
export function overtimeHourlyRate(settings: OvertimeSettings, basicSalary: number): number {
  if (settings.otRateMode === "fixed") return settings.otHourlyRate ?? 0;
  const days = settings.standardDaysPerMonth || 1;
  const hours = settings.standardHoursPerDay || 1;
  const normalHourly = basicSalary / days / hours;
  return normalHourly * (settings.otMultiplier ?? 1);
}

export interface MonthOvertimeSummary {
  otHours: number;
  daysLate: number;
  totalLateMinutes: number;
  daysWithTimes: number;
}

/** Rolls a month's attendance records up into the figures payroll needs. */
export function summariseMonthRecords(
  records: Record<string, AttendanceDayRecord> | undefined,
  settings: OvertimeSettings,
): MonthOvertimeSummary {
  const summary: MonthOvertimeSummary = {
    otHours: 0, daysLate: 0, totalLateMinutes: 0, daysWithTimes: 0,
  };
  for (const record of Object.values(records ?? {})) {
    if (record.inTime || record.outTime) summary.daysWithTimes += 1;
    const late = record.lateMinutes ?? lateMinutesFor(record.inTime, record.status, settings);
    if (late > 0) {
      summary.daysLate += 1;
      summary.totalLateMinutes += late;
    }
    summary.otHours += effectiveOtHours(record, settings);
  }
  summary.otHours = Number(summary.otHours.toFixed(2));
  return summary;
}
