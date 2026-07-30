// Pure scheduling logic for the booking calendar — no Firestore calls here.
// Callers (Settings, the customer portal, BookingsPage) fetch the center's
// schedule config and pass plain data in, which keeps this unit-testable and
// keeps the precedence rule in exactly one place:
//
//   calendarOverrides > Poya/public-holiday dataset > weeklyHours
//
// i.e. the Owner's manual override always wins, a seeded holiday closes the
// center by default, and the weekly schedule is the fallback for everything
// else.
import { isPoyaOrPublicHoliday } from "./sriLankaHolidays";
import type { DayKey, WeeklyHours, CalendarOverrides } from "../types/auth";

export const DAY_KEYS: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export const DAY_LABELS: Record<DayKey, string> = {
  sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday",
  thu: "Thursday", fri: "Friday", sat: "Saturday",
};

export interface ScheduleConfig {
  weeklyHours: WeeklyHours;
  slotDurationMinutes: number;
  calendarOverrides?: CalendarOverrides;
}

export const DEFAULT_SLOT_DURATION_MINUTES = 30;

export const DEFAULT_WEEKLY_HOURS: WeeklyHours = {
  sun: { open: false },
  mon: { open: true, start: "08:00", end: "17:00" },
  tue: { open: true, start: "08:00", end: "17:00" },
  wed: { open: true, start: "08:00", end: "17:00" },
  thu: { open: true, start: "08:00", end: "17:00" },
  fri: { open: true, start: "08:00", end: "17:00" },
  sat: { open: true, start: "08:00", end: "13:00" },
};

/** "YYYY-MM-DD" for a Date, in local time (not UTC — avoids off-by-one). */
export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Parses an ISO date string as a local-midnight Date (not UTC). */
function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function dayKeyFor(date: Date): DayKey {
  return DAY_KEYS[date.getDay()];
}

/**
 * Whether the center is open on `date`, applying the precedence rule:
 * calendarOverrides > Poya/public-holiday dataset > weeklyHours.
 */
export function isCenterOpen(config: ScheduleConfig, date: Date | string): boolean {
  const iso = typeof date === "string" ? date : toIsoDate(date);
  const d = typeof date === "string" ? parseIsoDate(date) : date;

  const override = config.calendarOverrides?.[iso];
  if (override === "closed") return false;
  if (override === "open") return true;

  if (isPoyaOrPublicHoliday(iso)) return false;

  const hours = config.weeklyHours[dayKeyFor(d)];
  return Boolean(hours?.open);
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m ?? 0);
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60).toString().padStart(2, "0");
  const m = (mins % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

// Used when an override forces a date open on a weekday whose weeklyHours
// entry has no start/end configured (e.g. forcing a normally-closed Sunday
// open) — a reasonable fallback rather than producing zero slots.
const FALLBACK_START = "09:00";
const FALLBACK_END = "17:00";

/**
 * Every bookable slot start-time ("HH:mm") for `date`, in order, minus
 * whatever's already taken. Returns [] when the center isn't open that day.
 * `existingSlots` is the list of "HH:mm" slots already booked for that date
 * (active bookings only — callers should exclude rejected/cancelled ones).
 */
export function getAvailableSlots(
  config: ScheduleConfig,
  date: Date | string,
  existingSlots: string[] = [],
): string[] {
  if (!isCenterOpen(config, date)) return [];

  const d = typeof date === "string" ? parseIsoDate(date) : date;
  const hours = config.weeklyHours[dayKeyFor(d)];
  const start = hours?.start || FALLBACK_START;
  const end = hours?.end || FALLBACK_END;
  const step = config.slotDurationMinutes > 0 ? config.slotDurationMinutes : DEFAULT_SLOT_DURATION_MINUTES;

  const startMin = timeToMinutes(start);
  const endMin = timeToMinutes(end);
  const taken = new Set(existingSlots);

  const slots: string[] = [];
  for (let t = startMin; t + step <= endMin; t += step) {
    const slot = minutesToTime(t);
    if (!taken.has(slot)) slots.push(slot);
  }
  return slots;
}
