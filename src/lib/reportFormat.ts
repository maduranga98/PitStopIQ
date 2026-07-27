import type { Timestamp } from "firebase/firestore";

// Number and date shaping shared by the reports on this page, kept apart from
// the markup so both halves stay reloadable on their own.

export const CHART_TOOLTIP_STYLE = {
  background: "#0B1120",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8,
} as const;

export function formatLKR(n: number): string {
  return `LKR ${n.toLocaleString("en-LK", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function formatDate(ts?: Timestamp | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function monthLabel(date: Date): string {
  return date.toLocaleDateString("en-LK", { month: "short", year: "2-digit" });
}

/** Value totalled per calendar month, in the order the months occur. */
export function monthlyTotals<T>(
  rows: T[],
  date: (row: T) => Date,
  value: (row: T) => number,
): { month: string; value: number }[] {
  const map = new Map<string, { month: string; value: number; sort: number }>();
  rows.forEach(row => {
    const d = date(row);
    const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
    const entry = map.get(key) ?? { month: monthLabel(d), value: 0, sort: d.getFullYear() * 12 + d.getMonth() };
    entry.value += value(row);
    map.set(key, entry);
  });
  return Array.from(map.values())
    .sort((a, b) => a.sort - b.sort)
    .map(({ month, value }) => ({ month, value }));
}
