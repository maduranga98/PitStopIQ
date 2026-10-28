/**
 * ISO weeks ("2026-W44") for the weekly commission payout.
 *
 * A confirmed payment is filed under the week it was confirmed in. The week is
 * worked out in Sri Lanka time, not the browser's: a payment confirmed at 11pm
 * on a Sunday belongs to that week even from a laptop set to another timezone,
 * and `toISOString()` (UTC) would file it a day late for the first 5½ hours of
 * every Monday.
 */

export const PAYOUT_TIME_ZONE = "Asia/Colombo";

const DAY_MS = 86_400_000;

/** y/m/d of an instant as seen on the wall clock of `timeZone`. */
function wallDate(at: Date, timeZone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** Monday 00:00 UTC of the given ISO year/week — a calendar date, not an instant. */
function weekStartUTC(isoYear: number, week: number): number {
  // Jan 4th is always in week 1.
  const jan4 = Date.UTC(isoYear, 0, 4);
  const jan4Dow = (new Date(jan4).getUTCDay() + 6) % 7; // Mon=0
  return jan4 - jan4Dow * DAY_MS + (week - 1) * 7 * DAY_MS;
}

function keyFromUTC(dateUtc: number): string {
  // The Thursday of a week decides which ISO year it belongs to.
  const dow = (new Date(dateUtc).getUTCDay() + 6) % 7;
  const thursday = dateUtc + (3 - dow) * DAY_MS;
  const isoYear = new Date(thursday).getUTCFullYear();
  const week = 1 + Math.round((thursday - weekStartUTC(isoYear, 1) - 3 * DAY_MS) / (7 * DAY_MS));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** The ISO week an instant falls in, e.g. "2026-W44". */
export function isoWeekKey(at: Date = new Date(), timeZone: string = PAYOUT_TIME_ZONE): string {
  const { y, m, d } = wallDate(at, timeZone);
  return keyFromUTC(Date.UTC(y, m - 1, d));
}

export function isIsoWeekKey(key: string): boolean {
  const m = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!m) return false;
  const week = Number(m[2]);
  return week >= 1 && week <= 53 && keyFromUTC(weekStartUTC(Number(m[1]), week)) === key;
}

/** The week `n` weeks after (or before, if negative) `key`. */
export function shiftIsoWeek(key: string, n: number): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!m) throw new Error(`Not an ISO week: ${key}`);
  return keyFromUTC(weekStartUTC(Number(m[1]), Number(m[2])) + n * 7 * DAY_MS);
}

/** "26 Oct – 1 Nov 2026" */
export function isoWeekLabel(key: string): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!m) return key;
  const start = new Date(weekStartUTC(Number(m[1]), Number(m[2])));
  const end = new Date(start.getTime() + 6 * DAY_MS);
  const fmt = (d: Date, withYear: boolean) =>
    d.toLocaleDateString("en-GB", {
      timeZone: "UTC", day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}),
    });
  return `${fmt(start, false)} – ${fmt(end, true)}`;
}
