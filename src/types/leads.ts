import type { Timestamp } from "firebase/firestore";

/**
 * Sales pipeline for the super-admin's Management section. This is the list
 * that used to live in a spreadsheet: every service center that has been
 * spoken to but not yet signed up, and the call history behind it.
 */

// ── Pipeline stages ──────────────────────────────────────────────────────────
// These are the Status values the team already uses in the tracker sheet, in
// the order a lead actually moves through them — not a generic CRM funnel.
// "Video & details" is its own step because it is how most of these leads are
// worked: the details go out by WhatsApp before a demo is ever booked.
//
// Hex fills rather than `bg-slate-600`: a solid palette fill compiles to an
// `oklch()` a pre-2023 browser cannot read, and the column header then paints
// nothing at all — the same reason the job board writes its four out by hand.
export const LEAD_STAGES = [
  { key: "new",          label: "New",              headerBg: "bg-[#475569]", border: "border-[#64748B]" },
  { key: "called",       label: "Called",           headerBg: "bg-[#0284C7]", border: "border-[#38BDF8]" },
  { key: "no_answer",    label: "Not Answer",       headerBg: "bg-[#64748B]", border: "border-[#94A3B8]" },
  { key: "follow_up",    label: "Follow-up",        headerBg: "bg-[#0891B2]", border: "border-[#22D3EE]" },
  { key: "details_sent", label: "Video & details",  headerBg: "bg-[#4F46E5]", border: "border-[#818CF8]" },
  { key: "demo_booked",  label: "Demo Booked",      headerBg: "bg-[#7C3AED]", border: "border-[#A78BFA]" },
  { key: "demo_done",    label: "Demo Done",        headerBg: "bg-[#C026D3]", border: "border-[#E879F9]" },
  { key: "won",          label: "Closed Won",       headerBg: "bg-[#16A34A]", border: "border-[#22C55E]" },
  { key: "lost",         label: "Lost",             headerBg: "bg-[#B91C1C]", border: "border-[#EF4444]" },
] as const;

export type LeadStage = (typeof LEAD_STAGES)[number]["key"];

export const LEAD_STAGE_KEYS = LEAD_STAGES.map((s) => s.key) as readonly LeadStage[];

export const STAGE_META: Record<LeadStage, (typeof LEAD_STAGES)[number]> =
  Object.fromEntries(LEAD_STAGES.map((s) => [s.key, s])) as Record<
    LeadStage,
    (typeof LEAD_STAGES)[number]
  >;

/** A stage nothing else is expected to follow — kept off the follow-up counts. */
export function isClosedStage(stage: LeadStage): boolean {
  return stage === "won" || stage === "lost";
}

// ── Tags ─────────────────────────────────────────────────────────────────────
// What came out of the conversation: something they want built, something
// broken, something they are unhappy about, or anything else worth flagging.
export const LEAD_TAGS = [
  { key: "feature",   label: "Feature",   chip: "bg-sky-500/15 text-sky-300 border border-sky-500/30" },
  { key: "bug",       label: "Bug",       chip: "bg-red-500/15 text-red-300 border border-red-500/30" },
  { key: "complaint", label: "Complaint", chip: "bg-amber-500/15 text-amber-300 border border-amber-500/30" },
  { key: "other",     label: "Other",     chip: "bg-gray-500/15 text-gray-300 border border-gray-500/30" },
] as const;

export type LeadTag = (typeof LEAD_TAGS)[number]["key"];

export const TAG_META: Record<LeadTag, (typeof LEAD_TAGS)[number]> =
  Object.fromEntries(LEAD_TAGS.map((t) => [t.key, t])) as Record<
    LeadTag,
    (typeof LEAD_TAGS)[number]
  >;

// ── Call outcomes ────────────────────────────────────────────────────────────
// What the call ended in. Each one lands the lead in a stage (see
// `stageAfterCall` in lib/leads.ts), so logging the call is the only step —
// nobody has to remember to move the card as well.
export const CALL_OUTCOMES = [
  { key: "connected",      label: "Spoke to them" },
  { key: "no_answer",      label: "No answer" },
  { key: "not_working",    label: "Not working" },
  { key: "line_busy",      label: "Line busy" },
  { key: "user_busy",      label: "User busy" },
  { key: "not_responding", label: "Not respond" },
  { key: "callback",       label: "Call back" },
  { key: "details_sent",   label: "Sent video & details" },
  { key: "demo_booked",    label: "Demo booked" },
  { key: "demo_done",      label: "Demo done" },
  { key: "not_interested", label: "Not interested" },
] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number]["key"];

/**
 * A note recorded without a call behind it shares the call log — it is the
 * same timeline, and splitting it in two would mean two listeners and two
 * merges to show one history. It is stored as call number 0.
 */
export type CallLogKind = CallOutcome | "note" | "demo_scheduled";

export const OUTCOME_LABEL: Record<CallLogKind, string> = {
  ...(Object.fromEntries(CALL_OUTCOMES.map((o) => [o.key, o.label])) as Record<CallOutcome, string>),
  note: "Note",
  // Booking a demo from the scheduler, rather than as the outcome of a call.
  demo_scheduled: "Demo scheduled",
};

/**
 * How many calls the dropdown offers. The count is also raised automatically
 * whenever a call is logged, so the dropdown is only there for the back-fill:
 * a lead imported from the spreadsheet already has calls behind it that were
 * never logged one by one.
 */
export const MAX_TRACKED_CALLS = 20;

// ── Demo slots ───────────────────────────────────────────────────────────────
// A booked demo is a date plus a time rather than the sheet's free text, so
// the board can show what else is booked that day and warn about a clash
// before a second garage is promised the same half hour.

/** How close two demos have to be before the scheduler calls it a clash. */
export const DEMO_CLASH_MINUTES = 60;

/** "10:30" → 630. Anything that isn't HH:mm comes back as null. */
export function demoMinutes(time?: string | null): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((time ?? "").trim());
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return mins >= 0 && mins < 24 * 60 ? mins : null;
}

/** "2026-09-21" + "14:30" → "21 Sep 2026, 2:30 PM". The label everything shows. */
export function formatDemoSlot(date?: string | null, time?: string | null): string {
  const d = (date ?? "").trim();
  if (!d) return "";
  const mins = demoMinutes(time);
  const at = new Date(`${d}T${mins === null ? "00:00" : (time as string)}:00`);
  if (Number.isNaN(at.getTime())) return d;
  const day = at.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  if (mins === null) return day;
  return `${day}, ${at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

/** What to show for a lead's demo: the booked slot, or whatever the sheet said. */
export function demoLabel(lead: Pick<Lead, "demoAt" | "demoDate" | "demoTime">): string {
  return lead.demoDate ? formatDemoSlot(lead.demoDate, lead.demoTime) : (lead.demoAt ?? "");
}

/** One booked demo, flattened off a lead for the scheduler's day view. */
export interface DemoSlot {
  leadId: string;
  businessName: string;
  contactName?: string;
  phone?: string;
  date: string;
  time: string;
  minutes: number | null;
  stage: LeadStage;
  note?: string;
}

/** Every booked demo on the board, earliest first. */
export function collectDemoSlots(leads: Lead[]): DemoSlot[] {
  return leads
    .filter((l) => Boolean(l.demoDate))
    .map((l) => ({
      leadId: l.id,
      businessName: l.businessName,
      contactName: l.contactName,
      phone: l.phone,
      date: l.demoDate as string,
      time: l.demoTime ?? "",
      minutes: demoMinutes(l.demoTime),
      stage: l.stage,
      note: l.demoNote,
    }))
    .sort((a, b) =>
      a.date === b.date ? (a.minutes ?? 0) - (b.minutes ?? 0) : a.date.localeCompare(b.date),
    );
}

// ── Documents ────────────────────────────────────────────────────────────────

export interface Lead {
  id: string;
  /** The garage. What the sheet calls "Garage Name". */
  businessName: string;
  /** The person answering the phone. The sheet's "Customer Name". */
  contactName: string;
  /** Primary number the calls go to. Also how a duplicate import is spotted. */
  phone: string;
  email?: string;
  /**
   * Where they are, in the team's own words — "Nugegoda", "Colombo10",
   * "koria- Tissamaharama", "අනුරාධපුර". Free text rather than a district
   * dropdown, because that is how the sheet records it and forcing it into
   * the 25 districts would lose half of them.
   */
  location?: string;
  /** Matched against the district list where the location names one. */
  district?: string;
  /** Where the lead came from — "FB Lead", "phone call", "whatapp call", … */
  source?: string;
  /**
   * What they said is wrong today — the sheet's "Main Problem". This is the
   * reason they would buy, so it stays its own field rather than being
   * folded into the notes.
   */
  mainProblem?: string;
  stage: LeadStage;
  /** Calls made so far. Raised by logging a call or set straight from the dropdown. */
  callCount: number;
  /** Rolled up from the call log plus anything set on the lead itself. */
  tags: LeadTag[];
  /** Raised by a demo-booked or demo-done call, or ticked by hand. */
  demoRequested?: boolean;
  /**
   * When the demo is, as it was written down — "7.30 pm", "8.1d", "Next week".
   * Free text, because that is what the sheet holds. Once a demo is booked
   * through the scheduler this is the readable form of `demoDate`/`demoTime`
   * and the two below are what anything comparing slots actually reads.
   */
  demoAt?: string;
  /** yyyy-mm-dd — the booked demo's day, so slots sort and clash-check. */
  demoDate?: string | null;
  /** HH:mm, 24-hour — the booked demo's time. */
  demoTime?: string | null;
  /** The note the booking was confirmed with. A demo is not booked without one. */
  demoNote?: string;
  demoConfirmedAt?: Timestamp | null;
  demoConfirmedByName?: string;
  /** yyyy-mm-dd — plain string so it sorts and compares without a timezone. */
  nextFollowUp?: string | null;
  /**
   * The follow-up cell when it is not a date at all — "after 07.30 day",
   * "sir call me", "next week visit". The sheet uses this column for both,
   * so both are kept: the date drives the due count, the text is shown as-is.
   */
  followUpNote?: string;
  /** The sheet's "Price Told?" column, which is a note rather than a yes/no. */
  priceNote?: string;
  /** Rupees, once they sign. Feeds the revenue figure on the board. */
  closedAmount?: number;
  /** yyyy-mm-dd, from the sheet's lead date — when the lead came in. */
  leadDate?: string | null;
  /** Free-form background, and where the sheet's Notes column lands. */
  notes?: string;
  /** `phone` reduced to bare local digits — the key duplicate checks compare. */
  phoneKey?: string;
  lastCallAt?: Timestamp | null;
  /** When the next call is due — set from the call log, shown on the Calls screen. */
  nextCallAt?: Timestamp | null;
  /** What the next call is about, alongside the date/time. */
  nextCallNote?: string;
  /** Soft-deleted rows stay for their call history but leave the board. */
  isDeleted?: boolean;
  /** Set once the lead has been given a real account from this screen. */
  convertedCenterId?: string | null;
  convertedAt?: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy?: string;
  createdByName?: string;
}

/** One logged call, under `leads/{leadId}/calls`. */
export interface LeadCall {
  id: string;
  /** 1-based: the lead's Nth call, so the log reads the way the team counts. */
  callNumber: number;
  outcome: CallLogKind;
  tags: LeadTag[];
  note: string;
  /** The next call booked while logging this one, if any. */
  nextCallAt?: Timestamp | null;
  createdAt: Timestamp;
  createdBy?: string;
  createdByName?: string;
}

/** One entry in a service center's note log — `leads/{leadId}/notes`. */
export interface LeadNote {
  id: string;
  text: string;
  createdAt: Timestamp;
  createdBy?: string;
  createdByName?: string;
  updatedAt?: Timestamp | null;
  updatedByName?: string;
}

/** The fields the add/edit form owns — everything else is bookkeeping. */
export type LeadDraft = Pick<
  Lead,
  | "businessName" | "contactName" | "phone" | "email" | "location" | "district"
  | "source" | "mainProblem" | "stage" | "callCount" | "tags" | "demoRequested"
  | "demoAt" | "demoDate" | "demoTime" | "nextFollowUp" | "followUpNote" | "priceNote" | "closedAmount"
  | "leadDate" | "notes"
>;

export function blankLeadDraft(): LeadDraft {
  return {
    businessName: "",
    contactName: "",
    phone: "",
    email: "",
    location: "",
    district: "",
    source: "",
    mainProblem: "",
    stage: "new",
    callCount: 0,
    tags: [],
    demoRequested: false,
    demoAt: "",
    demoDate: "",
    demoTime: "",
    nextFollowUp: "",
    followUpNote: "",
    priceNote: "",
    closedAmount: 0,
    leadDate: new Date().toISOString().slice(0, 10),
    notes: "",
  };
}
