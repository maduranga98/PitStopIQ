// Sri Lankan Poya (full moon) days and public holidays, keyed by year.
//
// Poya dates follow the lunar calendar and shift every year, so this can
// NEVER be a permanent fixed list — it must be refreshed annually. There is
// no reliable free live API for Sri Lankan Poya/public holidays, so this is
// maintained as static seed data rather than fetched from a service.
//
// ⚠ MAINTENANCE: add next year's dates before the current year listed here
// runs out (check the Sri Lanka government Gazette / bank holiday calendar).
// Each array holds ISO date strings ("YYYY-MM-DD") for every Poya day plus
// the other well-known public holidays (Independence Day, Sinhala & Tamil
// New Year, Christmas, etc.) observed nationally.
export const POYA_AND_PUBLIC_HOLIDAYS: Record<number, string[]> = {
  2026: [
    "2026-01-01", // Duruthu Full Moon Poya Day
    "2026-01-14", // Tamil Thai Pongal Day
    "2026-02-04", // Independence Day
    "2026-02-01", // Navam Full Moon Poya Day
    "2026-03-03", // Madin Full Moon Poya Day
    "2026-04-01", // Bak Full Moon Poya Day
    "2026-04-03", // Good Friday
    "2026-04-13", // Day prior to Sinhala & Tamil New Year
    "2026-04-14", // Sinhala & Tamil New Year Day
    "2026-05-01", // May Day
    "2026-05-01", // Vesak Full Moon Poya Day
    "2026-05-02", // Day following Vesak Full Moon Poya Day
    "2026-05-30", // Poson Full Moon Poya Day
    "2026-06-29", // Esala Full Moon Poya Day
    "2026-07-28", // Nikini Full Moon Poya Day
    "2026-08-27", // Binara Full Moon Poya Day
    "2026-09-25", // Vap Full Moon Poya Day
    "2026-10-20", // Deepavali
    "2026-10-25", // Il Full Moon Poya Day
    "2026-11-24", // Unduvap Full Moon Poya Day
    "2026-12-25", // Christmas Day
  ],
  2027: [
    "2027-01-01", // Duruthu Full Moon Poya Day
    "2027-01-14", // Tamil Thai Pongal Day
    "2027-01-21", // Navam Full Moon Poya Day
    "2027-02-04", // Independence Day
    "2027-02-20", // Madin Full Moon Poya Day
    "2027-03-22", // Bak Full Moon Poya Day
    "2027-04-02", // Good Friday
    "2027-04-13", // Day prior to Sinhala & Tamil New Year
    "2027-04-14", // Sinhala & Tamil New Year Day
    "2027-04-20", // Vesak Full Moon Poya Day
    "2027-04-21", // Day following Vesak Full Moon Poya Day
    "2027-05-01", // May Day
    "2027-05-19", // Poson Full Moon Poya Day
    "2027-06-18", // Esala Full Moon Poya Day
    "2027-07-18", // Nikini Full Moon Poya Day
    "2027-08-16", // Binara Full Moon Poya Day
    "2027-09-15", // Vap Full Moon Poya Day
    "2027-10-14", // Il Full Moon Poya Day
    "2027-11-08", // Deepavali
    "2027-11-13", // Unduvap Full Moon Poya Day
    "2027-12-13", // Duruthu-adjacent (Unduvap follow-on, verify locally)
    "2027-12-25", // Christmas Day
  ],
};

/** Dates for a year, or an empty list if that year hasn't been seeded yet. */
export function poyaDaysForYear(year: number): string[] {
  return POYA_AND_PUBLIC_HOLIDAYS[year] ?? [];
}

/** Whether `isoDate` ("YYYY-MM-DD") is a seeded Poya/public holiday. */
export function isPoyaOrPublicHoliday(isoDate: string): boolean {
  const year = Number(isoDate.slice(0, 4));
  return poyaDaysForYear(year).includes(isoDate);
}
