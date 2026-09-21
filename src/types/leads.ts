import type { Timestamp } from "firebase/firestore";

/**
 * Sales pipeline for the super-admin's Management section. This is the list
 * that used to live in a spreadsheet: every service center that has been
 * spoken to but not yet signed up, and the call history behind it.
 */

// ── Pipeline stages ──────────────────────────────────────────────────────────
// Hex fills rather than `bg-slate-600`: a solid palette fill compiles to an
// `oklch()` a pre-2023 browser cannot read, and the column header then paints
// nothing at all — the same reason the job board writes its four out by hand.
export const LEAD_STAGES = [
  { key: "new",         label: "New",         headerBg: "bg-[#475569]", border: "border-[#64748B]" },
  { key: "contacted",   label: "Contacted",   headerBg: "bg-[#0284C7]", border: "border-[#38BDF8]" },
  { key: "demo",        label: "Demo",        headerBg: "bg-[#7C3AED]", border: "border-[#A78BFA]" },
  { key: "negotiation", label: "Negotiation", headerBg: "bg-[#D97706]", border: "border-[#F59E0B]" },
  { key: "won",         label: "Won",         headerBg: "bg-[#16A34A]", border: "border-[#22C55E]" },
  { key: "lost",        label: "Lost",        headerBg: "bg-[#B91C1C]", border: "border-[#EF4444]" },
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
export const CALL_OUTCOMES = [
  { key: "connected",      label: "Spoke to them" },
  { key: "no_answer",      label: "No answer" },
  { key: "callback",       label: "Asked to call back" },
  { key: "demo_requested", label: "Wants a demo" },
  { key: "not_interested", label: "Not interested" },
] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number]["key"];

/**
 * A note recorded without a call behind it shares the call log — it is the
 * same timeline, and splitting it in two would mean two listeners and two
 * merges to show one history. It is stored as call number 0.
 */
export type CallLogKind = CallOutcome | "note";

export const OUTCOME_LABEL: Record<CallLogKind, string> = {
  ...(Object.fromEntries(CALL_OUTCOMES.map((o) => [o.key, o.label])) as Record<CallOutcome, string>),
  note: "Note",
};

/**
 * How many calls the dropdown offers. The count is also raised automatically
 * whenever a call is logged, so the dropdown is only there for the back-fill:
 * a lead imported from the spreadsheet already has calls behind it that were
 * never logged one by one.
 */
export const MAX_TRACKED_CALLS = 20;

// ── Documents ────────────────────────────────────────────────────────────────

export interface Lead {
  id: string;
  businessName: string;
  contactName: string;
  /** Primary number the calls go to. Also how a duplicate import is spotted. */
  phone: string;
  email?: string;
  city?: string;
  district?: string;
  /** Where the lead came from — "Facebook", "Referral", a rep's name, … */
  source?: string;
  stage: LeadStage;
  /** Calls made so far. Raised by logging a call or set straight from the dropdown. */
  callCount: number;
  /** Rolled up from the call log plus anything set on the lead itself. */
  tags: LeadTag[];
  /** Raised by a "Wants a demo" call, or ticked by hand. */
  demoRequested?: boolean;
  /** yyyy-mm-dd — plain string so it sorts and compares without a timezone. */
  nextFollowUp?: string | null;
  /** Free-form background, and where a spreadsheet's notes column lands. */
  notes?: string;
  /** `phone` reduced to bare local digits — the key duplicate checks compare. */
  phoneKey?: string;
  lastCallAt?: Timestamp | null;
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
  createdAt: Timestamp;
  createdBy?: string;
  createdByName?: string;
}

/** The fields the add/edit form owns — everything else is bookkeeping. */
export type LeadDraft = Pick<
  Lead,
  | "businessName" | "contactName" | "phone" | "email" | "city" | "district"
  | "source" | "stage" | "callCount" | "tags" | "demoRequested"
  | "nextFollowUp" | "notes"
>;

export function blankLeadDraft(): LeadDraft {
  return {
    businessName: "",
    contactName: "",
    phone: "",
    email: "",
    city: "",
    district: "",
    source: "",
    stage: "new",
    callCount: 0,
    tags: [],
    demoRequested: false,
    nextFollowUp: "",
    notes: "",
  };
}
