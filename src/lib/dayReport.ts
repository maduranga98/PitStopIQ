import { collectionGroup, limit, orderBy, query, Timestamp, where } from "firebase/firestore";
import { db } from "../config/firebase";
import { boundedGetDocs } from "./firestoreRead";
import {
  OUTCOME_LABEL, STAGE_META, TAG_META, demoLabel,
  type CallLogKind, type Lead, type LeadTag,
} from "../types/leads";
import { summarize, type DayActivity, type DayReport } from "./dayReportScope";

export { activityCaller, dayCallers, scopeDayReport } from "./dayReportScope";
export type { DayActivity, DayCaller, DayReport } from "./dayReportScope";

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

/** Local midnight-to-midnight, so "today" means the day the team just worked. */
function dayBounds(dateISO: string): [Timestamp, Timestamp] {
  const start = new Date(`${dateISO}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return [Timestamp.fromDate(start), Timestamp.fromDate(end)];
}

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
      note?: string; createdAt?: Timestamp; createdBy?: string; createdByName?: string;
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
      byUid: data.createdBy ?? "",
      lead: byId.get(leadId),
    };
  });

  return summarize(dateISO, activity, leads);
}

/** The report as a spreadsheet — one row per thing that happened, in order. */
export function dayReportRows(report: DayReport): string[][] {
  return report.activity.map((a) => [
    a.at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
    a.lead?.businessName ?? "(archived lead)",
    a.lead?.contactName ?? "",
    a.lead?.phone ?? "",
    a.lead?.location || a.lead?.district || "",
    a.byName,
    a.callNumber > 0 ? `Call #${a.callNumber}` : "Note",
    OUTCOME_LABEL[a.outcome] ?? a.outcome,
    (a.tags ?? []).map((t) => TAG_META[t]?.label ?? t).join(" "),
    a.note,
    a.lead ? STAGE_META[a.lead.stage].label : "",
    a.lead ? demoLabel(a.lead) : "",
    a.lead?.nextFollowUp || a.lead?.followUpNote || "",
  ]);
}

export const DAY_REPORT_HEADERS = [
  "Time", "Garage", "Customer", "Phone", "Location", "Caller", "Type", "Outcome",
  "Tags", "Note", "Status now", "Demo", "Next follow-up",
];
