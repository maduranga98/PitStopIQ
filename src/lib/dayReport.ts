import { collectionGroup, limit, orderBy, query, Timestamp, where } from "firebase/firestore";
import { db } from "../config/firebase";
import { boundedGetDocs } from "./firestoreRead";
import {
  OUTCOME_LABEL, STAGE_META, TAG_META, demoLabel,
  type CallLogKind, type Lead, type LeadTag,
} from "../types/leads";

/**
 * The day-end report for the Management board: everything that happened on
 * one date, pulled together in one read.
 *
 * The activity is a collectionGroup read over `leads/{id}/calls` rather than a
 * walk of the leads: on a day with twelve calls that is one query instead of
 * one per lead in the pipeline, and it still finds the calls on leads that
 * have since been archived off the board. Everything about the lead itself —
 * who they are, where they ended up — is joined from the leads already
 * streaming into the page, so the report costs exactly that one read.
 */

/** Never stream an unbounded day. Far more than a real day of calling. */
const DAY_CALL_LIMIT = 2000;

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

/** Local midnight-to-midnight, so "today" means the day the team just worked. */
function dayBounds(dateISO: string): [Timestamp, Timestamp] {
  const start = new Date(`${dateISO}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return [Timestamp.fromDate(start), Timestamp.fromDate(end)];
}

const isoOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export async function loadDayReport(dateISO: string, leads: Lead[]): Promise<DayReport> {
  const [start, end] = dayBounds(dateISO);
  const snap = await boundedGetDocs(
    query(
      collectionGroup(db, "calls"),
      where("createdAt", ">=", start),
      where("createdAt", "<", end),
      orderBy("createdAt", "asc"),
      limit(DAY_CALL_LIMIT),
    ),
  );

  const byId = new Map(leads.map((l) => [l.id, l]));
  const activity: DayActivity[] = snap.docs.map((d) => {
    const data = d.data() as {
      callNumber?: number; outcome?: CallLogKind; tags?: LeadTag[];
      note?: string; createdAt?: Timestamp; createdByName?: string;
    };
    const leadId = d.ref.parent.parent?.id ?? "";
    return {
      id: d.id,
      leadId,
      callNumber: data.callNumber ?? 0,
      outcome: data.outcome ?? "note",
      tags: data.tags ?? [],
      note: data.note ?? "",
      at: data.createdAt?.toDate() ?? start.toDate(),
      byName: data.createdByName ?? "",
      lead: byId.get(leadId),
    };
  });

  const counts = new Map<string, number>();
  for (const a of activity) {
    const label = OUTCOME_LABEL[a.outcome] ?? a.outcome;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  const onDate = (ts?: { toDate: () => Date } | null) => Boolean(ts && isoOf(ts.toDate()) === dateISO);
  const wonToday = leads.filter((l) => l.stage === "won" && onDate(l.convertedAt));

  return {
    date: dateISO,
    activity,
    callCount: activity.filter((a) => a.callNumber > 0).length,
    noteCount: activity.filter((a) => a.callNumber === 0).length,
    leadsTouched: new Set(activity.map((a) => a.leadId)).size,
    demosBooked: activity.filter(
      (a) => a.outcome === "demo_scheduled" || a.outcome === "demo_booked",
    ).length,
    newLeads: leads.filter((l) => l.leadDate === dateISO || onDate(l.createdAt)),
    demosToday: leads.filter((l) => l.demoDate === dateISO),
    wonToday,
    wonAmount: wonToday.reduce((sum, l) => sum + (l.closedAmount ?? 0), 0),
    byOutcome: [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/** The report as a spreadsheet — one row per thing that happened, in order. */
export function dayReportRows(report: DayReport): string[][] {
  return report.activity.map((a) => [
    a.at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
    a.lead?.businessName ?? "(archived lead)",
    a.lead?.contactName ?? "",
    a.lead?.phone ?? "",
    a.lead?.location || a.lead?.district || "",
    a.callNumber > 0 ? `Call #${a.callNumber}` : "Note",
    OUTCOME_LABEL[a.outcome] ?? a.outcome,
    (a.tags ?? []).map((t) => TAG_META[t]?.label ?? t).join(" "),
    a.note,
    a.lead ? STAGE_META[a.lead.stage].label : "",
    a.lead ? demoLabel(a.lead) : "",
    a.lead?.nextFollowUp || a.lead?.followUpNote || "",
    a.byName,
  ]);
}

export const DAY_REPORT_HEADERS = [
  "Time", "Garage", "Customer", "Phone", "Location", "Type", "Outcome",
  "Tags", "Note", "Status now", "Demo", "Next follow-up", "Logged by",
];
