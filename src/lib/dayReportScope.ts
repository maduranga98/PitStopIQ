import {
  OUTCOME_LABEL, type CallLogKind, type Lead, type LeadTag,
} from "../types/leads.ts";

/**
 * The day report's shape and the pure arithmetic over it (totals, per-caller
 * scoping). Kept apart from `dayReport.ts` so it carries no Firebase import
 * and can be tested on its own.
 */

export interface DayActivity {
  id: string;
  leadId: string;
  /** 0 for a note or a demo booking — those are not calls. */
  callNumber: number;
  outcome: CallLogKind;
  tags: LeadTag[];
  note: string;
  at: Date;
  byName: string;
  /** Uid of whoever logged it — what the caller filter keys on. Empty on very old entries. */
  byUid: string;
  /** Joined from the board. Missing only if the lead has since been archived. */
  lead?: Lead;
}

export interface DayReport {
  /** yyyy-mm-dd */
  date: string;
  activity: DayActivity[];
  /** Log entries that were actual calls. */
  callCount: number;
  noteCount: number;
  /** Distinct leads touched at all that day. */
  leadsTouched: number;
  /** Demos booked on the day, whenever they are scheduled for. */
  demosBooked: number;
  /** Leads added to the pipeline that day. */
  newLeads: Lead[];
  /** Demos that are scheduled to happen on this date. */
  demosToday: Lead[];
  /** Leads that reached Closed Won, and what they were worth. */
  wonToday: Lead[];
  wonAmount: number;
  /** How the day's log entries break down — label → count, busiest first. */
  byOutcome: { label: string; count: number }[];
}

export const isoOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Who a row is attributed to: the uid, or the name on entries written before uids were kept. */
export const activityCaller = (a: Pick<DayActivity, "byUid" | "byName">) => a.byUid || a.byName || "unknown";

export interface DayCaller {
  /** `activityCaller` key — a uid, or a name for old entries. */
  key: string;
  name: string;
  count: number;
}

/** Everyone who logged something that day, busiest first — the caller filter's options. */
export function dayCallers(report: DayReport): DayCaller[] {
  const map = new Map<string, DayCaller>();
  for (const a of report.activity) {
    const key = activityCaller(a);
    const hit = map.get(key);
    if (hit) hit.count += 1;
    else map.set(key, { key, name: a.byName || "Unknown", count: 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * The same report narrowed to one caller: their log entries, and every figure
 * above them recounted from those entries and from the leads assigned to them
 * — so the tiles never show the whole team's day next to one person's rows.
 */
export function scopeDayReport(report: DayReport, caller: string): DayReport {
  if (caller === "all") return report;
  const activity = report.activity.filter((a) => activityCaller(a) === caller);
  const mine = (l: Lead) => l.assignedTo === caller || (Boolean(l.assignedToName) && l.assignedToName === caller);
  return summarize(report.date, activity, null, {
    newLeads: report.newLeads.filter(mine),
    demosToday: report.demosToday.filter(mine),
    wonToday: report.wonToday.filter(mine),
  });
}

export function summarize(
  dateISO: string,
  activity: DayActivity[],
  leads: Lead[] | null,
  given?: Pick<DayReport, "newLeads" | "demosToday" | "wonToday">,
): DayReport {
  const counts = new Map<string, number>();
  for (const a of activity) {
    const label = OUTCOME_LABEL[a.outcome] ?? a.outcome;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  const onDate = (ts?: { toDate: () => Date } | null) => Boolean(ts && isoOf(ts.toDate()) === dateISO);
  const all = leads ?? [];
  const wonToday = given?.wonToday ?? all.filter((l) => l.stage === "won" && onDate(l.convertedAt));

  return {
    date: dateISO,
    activity,
    callCount: activity.filter((a) => a.callNumber > 0).length,
    noteCount: activity.filter((a) => a.callNumber === 0).length,
    leadsTouched: new Set(activity.map((a) => a.leadId)).size,
    demosBooked: activity.filter(
      (a) => a.outcome === "demo_scheduled" || a.outcome === "demo_booked",
    ).length,
    newLeads: given?.newLeads ?? all.filter((l) => l.leadDate === dateISO || onDate(l.createdAt)),
    demosToday: given?.demosToday ?? all.filter((l) => l.demoDate === dateISO),
    wonToday,
    wonAmount: wonToday.reduce((sum, l) => sum + (l.closedAmount ?? 0), 0),
    byOutcome: [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
  };
}

