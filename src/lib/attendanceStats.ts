import type { AttendanceStatus } from "../types/auth";

export function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function yearMonthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Parse a "YYYY-MM" key into a { year, month } pair (month is 0-indexed). */
export function parseYearMonth(ym: string): { year: number; month: number } {
  const [y, m] = ym.split("-").map(Number);
  return { year: y, month: m - 1 };
}

export interface AttendanceStats {
  /** Attendance rate as a whole-number percentage. */
  rate: number;
  daysPresent: number;
  daysAbsent: number;
  workingDays: number;
}

/**
 * Attendance stats for one calendar month from a staff member's attendance
 * doc. Sundays and marked holidays don't count as working days. If the month
 * is the current one, only counts up to today (the rest hasn't happened yet).
 */
export function computeAttendanceStats(
  days: Record<string, AttendanceStatus>,
  year: number,
  month: number,
): AttendanceStats {
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const lastDay = isCurrentMonth ? today.getDate() : daysInMonth(year, month);

  let working = 0;
  let score = 0;
  let daysPresent = 0;
  let daysAbsent = 0;
  for (let d = 1; d <= lastDay; d++) {
    const date = new Date(year, month, d);
    if (date.getDay() === 0) continue;
    const key = dateKey(year, month, d);
    const status = days[key] as AttendanceStatus | undefined;
    if (status === "holiday") continue;
    working++;
    if (status === "present") { score += 1; daysPresent += 1; }
    else if (status === "half_day") { score += 0.5; daysPresent += 0.5; }
    else daysAbsent += 1;
  }
  const rate = working === 0 ? 0 : Math.round((score / working) * 100);
  return { rate, daysPresent, daysAbsent, workingDays: working };
}
