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

// ── Custom tags ──────────────────────────────────────────────────────────────
// Free-form labels the super admin puts on a lead ("Garage", "Colombo batch",
// "Hot") — separate from the fixed conversation tags above, which callers also
// raise from a call. Most leads share one common tag, so the form offers the
// ones already in use, most-used first.
export const MAX_CUSTOM_TAGS = 6;
export const MAX_CUSTOM_TAG_LENGTH = 24;

/** Trimmed, de-duplicated (case-insensitive), length- and count-capped. */
export function normalizeCustomTags(tags?: readonly string[] | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags ?? []) {
    const tag = String(raw).replace(/\s+/g, " ").trim().slice(0, MAX_CUSTOM_TAG_LENGTH);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length === MAX_CUSTOM_TAGS) break;
  }
  return out;
}

/** Tags in use across the leads, most-used first. */
export function customTagCounts(leads: readonly Pick<Lead, "customTags">[]): { tag: string; count: number }[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const l of leads) {
    for (const tag of l.customTags ?? []) {
      const key = tag.toLowerCase();
      const hit = counts.get(key);
      if (hit) hit.count += 1;
      else counts.set(key, { tag, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

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

/** How long one demo meeting runs. */
export const DEMO_DURATION_MINUTES = 45;

/** Breathing room kept between one demo ending and the next starting. */
export const DEMO_BUFFER_MINUTES = 15;

/**
 * How close two demo *start times* may be before they clash: the meeting
 * itself plus the buffer. Two demos closer than this would either overlap or
 * leave no time to reset between them.
 */
export const DEMO_CLASH_MINUTES = DEMO_DURATION_MINUTES + DEMO_BUFFER_MINUTES;

/** "10:00" → "10:00 AM – 10:45 AM". Falls back to the bare time if it isn't HH:mm. */
export function demoWindowLabel(time?: string | null): string {
  const start = demoMinutes(time);
  if (start === null) return time ?? "";
  const fmt = (m: number) =>
    new Date(0, 0, 1, Math.floor(m / 60) % 24, m % 60).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${fmt(start)} – ${fmt(start + DEMO_DURATION_MINUTES)}`;
}

/** The hours demos actually get given in — the grid callers pick from. */
export const DEMO_SLOT_TIMES = ["09:00", "10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:30"];

/**
 * One claimed demo slot, held in the `demoSlots` collection under a
 * deterministic id (`2026-09-21_1430`). Because the id is the slot, a second
 * booking for the same moment is a second create on an existing document,
 * which the rules refuse — so two callers cannot both win a slot, however
 * close together they tap. Holds no business details: callers can read the
 * collection, but only ever learn that a slot is taken.
 */
export interface DemoSlotLock {
  date: string;
  time: string;
  leadId: string;
  bookedBy: string;
}

export const demoSlotId = (date: string, time: string) => `${date}_${time.replace(":", "")}`;

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
  return `${day}, ${demoWindowLabel(time)}`;
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

// ── Customer rating ──────────────────────────────────────────────────────────
// A caller's read on how likely a service center is to sign up: 5 stars is a
// hot prospect worth the next call, 1 is a long shot. Stored on the lead so
// the board can show it beside the name and filter on it.

export const MAX_RATING = 5;

/** The filter the boards offer. "unrated" is its own bucket, not a zero. */
export type RatingFilter = "all" | "unrated" | `${1 | 2 | 3 | 4 | 5}+`;

export const RATING_FILTERS: { key: RatingFilter; label: string }[] = [
  { key: "all", label: "All ratings" },
  { key: "5+", label: "5 stars" },
  { key: "4+", label: "4 stars & up" },
  { key: "3+", label: "3 stars & up" },
  { key: "2+", label: "2 stars & up" },
  { key: "1+", label: "Any rated" },
  { key: "unrated", label: "Not rated yet" },
];

/** A stored rating if it is a whole number 1–5, otherwise 0 (unrated). */
export function ratingOf(lead: Pick<Lead, "rating">): number {
  const r = Number(lead.rating);
  return Number.isInteger(r) && r >= 1 && r <= MAX_RATING ? r : 0;
}

export function matchesRating(lead: Pick<Lead, "rating">, filter: RatingFilter): boolean {
  if (filter === "all") return true;
  const r = ratingOf(lead);
  if (filter === "unrated") return r === 0;
  return r >= Number(filter[0]);
}

// ── Service center profile ───────────────────────────────────────────────────
// What the Lead Card collects on a call: the kind of center, what it works on,
// how big the team is, how it runs today, what hurts and what is holding the
// owner back. Name, owner, phone and district already live on the lead itself,
// so they are not asked twice.

type Option<K extends string = string> = { key: K; label: string };

export const CENTER_TYPES = [
  { key: "service",        label: "Service" },
  { key: "repair",         label: "Repair" },
  { key: "service_repair", label: "Service + Repair" },
] as const satisfies readonly Option[];

export const VEHICLE_TYPES = [
  { key: "bike",        label: "Bike" },
  { key: "three_wheel", label: "Three-wheel" },
  { key: "light",       label: "Light (car / van / jeep / cab)" },
  { key: "heavy",       label: "Heavy (lorry / tipper / bus)" },
  { key: "machinery",   label: "Machinery (loader / dozer)" },
] as const satisfies readonly Option[];

export const DAILY_VEHICLES = [
  { key: "lt10",  label: "< 10" },
  { key: "10_20", label: "10–20" },
  { key: "20_40", label: "20–40" },
  { key: "40plus", label: "40+" },
] as const satisfies readonly Option[];

export const STAFF_ROLES = [
  { key: "total",       label: "Total staff" },
  { key: "manager",     label: "Manager" },
  { key: "technicians", label: "Technicians" },
  { key: "cashier",     label: "Cashier" },
  { key: "supervisor",  label: "Supervisor" },
  { key: "helpers",     label: "Wash / helpers" },
] as const satisfies readonly Option[];

export const OWNER_PRESENCE = [
  { key: "on_site",  label: "Owner is at the center all day" },
  { key: "often_away", label: "Owner is often away / abroad" },
] as const satisfies readonly Option[];

export const CURRENT_METHODS = [
  { key: "book",     label: "Book / paper" },
  { key: "excel",    label: "Excel" },
  { key: "software", label: "Other software" },
] as const satisfies readonly Option[];

export const CALL_DIRECTIONS = [
  { key: "we_called",   label: "We called" },
  { key: "they_called", label: "They called" },
] as const satisfies readonly Option[];

export const CAME_VIA = [
  { key: "sms",      label: "SMS" },
  { key: "fb_video", label: "FB video" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "friend",   label: "Friend" },
  { key: "other",    label: "Other" },
] as const satisfies readonly Option[];

/** The pain tags from the card — the main one is starred. */
export const PAIN_TAGS = [
  { key: "REM",   label: "Customers don't return / no reminders" },
  { key: "JOB",   label: "Job card / bill writing is a hassle" },
  { key: "HIST",  label: "Can't find past work" },
  { key: "INV",   label: "Stock doesn't tally / items go missing" },
  { key: "STF",   label: "Staff / manager trust & control" },
  { key: "CASH",  label: "Daily totals, credit, cash" },
  { key: "AWAY",  label: "Can't watch the center when away" },
  { key: "MKT",   label: "Wants more customers / marketing" },
  { key: "MULTI", label: "Hard to watch several branches" },
  { key: "READY", label: "\"Is my vehicle ready?\" calls" },
  { key: "PAY",   label: "Attendance, payroll, commission" },
  { key: "NONE",  label: "No special problem — came to look" },
] as const satisfies readonly Option[];

export const OBJECTIONS = [
  { key: "PRICE",  label: "Price" },
  { key: "HARD",   label: "Seems hard to use" },
  { key: "TRUST",  label: "Trust" },
  { key: "DATA",   label: "Data safety" },
  { key: "FAMILY", label: "Must ask family" },
  { key: "HAVE",   label: "Already has a system" },
  { key: "VISIT",  label: "Wants a visit / show me" },
  { key: "TIME",   label: "No time" },
] as const satisfies readonly Option[];

export type PainTagKey = (typeof PAIN_TAGS)[number]["key"];
export type ObjectionKey = (typeof OBJECTIONS)[number]["key"];

export interface ServiceCenterProfile {
  callDirection?: (typeof CALL_DIRECTIONS)[number]["key"] | "";
  cameVia?: (typeof CAME_VIA)[number]["key"][];
  centerType?: (typeof CENTER_TYPES)[number]["key"] | "";
  vehicleTypes?: (typeof VEHICLE_TYPES)[number]["key"][];
  dailyVehicles?: (typeof DAILY_VEHICLES)[number]["key"] | "";
  /** Head-count per role; absent means not asked. */
  staff?: Partial<Record<(typeof STAFF_ROLES)[number]["key"], number>>;
  ownerPresence?: (typeof OWNER_PRESENCE)[number]["key"] | "";
  currentMethods?: (typeof CURRENT_METHODS)[number]["key"][];
  /** Which software, when "Other software" is ticked. */
  softwareName?: string;
  painTags?: PainTagKey[];
  /** The one that matters most — the card's ★. */
  mainPain?: PainTagKey | "";
  objections?: ObjectionKey[];
  /** The owner's own words, names and dates. */
  ownerWords?: string;
}

export function blankServiceProfile(): ServiceCenterProfile {
  return {
    callDirection: "", cameVia: [], centerType: "", vehicleTypes: [], dailyVehicles: "",
    staff: {}, ownerPresence: "", currentMethods: [], softwareName: "",
    painTags: [], mainPain: "", objections: [], ownerWords: "",
  };
}

/** How many of the profile's questions have an answer — drives the "n/10" chip. */
export function profileProgress(p?: ServiceCenterProfile | null): { done: number; total: number } {
  const x = p ?? {};
  const answered = [
    x.callDirection, (x.cameVia ?? []).length > 0, x.centerType, (x.vehicleTypes ?? []).length > 0,
    x.dailyVehicles, Object.values(x.staff ?? {}).some((n) => typeof n === "number"),
    x.ownerPresence, (x.currentMethods ?? []).length > 0, (x.painTags ?? []).length > 0,
    (x.objections ?? []).length > 0 || Boolean(x.ownerWords?.trim()),
  ];
  return { done: answered.filter(Boolean).length, total: answered.length };
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
  /** Admin-defined labels — see `normalizeCustomTags`. Absent on older leads. */
  customTags?: string[];
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
  /** Why it was lost. Required of a caller moving a lead to Lost. */
  lostReason?: string | null;
  /** A caller's 1–5 read on how likely this center is to sign up. Absent until rated. */
  rating?: number | null;
  ratedAt?: Timestamp | null;
  ratedByName?: string | null;
  /** A .vcf contact card attached by the super admin — callers can download it. */
  vcfFile?: LeadVcf | null;
  vcfUploadedAt?: Timestamp | null;
  /** The Lead Card answers — see `ServiceCenterProfile`. */
  serviceProfile?: ServiceCenterProfile | null;
  profileUpdatedAt?: Timestamp | null;
  profileUpdatedByName?: string | null;

  // ── Assignment, package and commission ──────────────────────────────────
  // All optional: leads written before callers existed carry none of these.
  /** Caller uid, or null while unassigned. */
  assignedTo?: string | null;
  /** Denormalized so the board never needs a second read per card. */
  assignedToName?: string | null;
  assignedAt?: Timestamp | null;
  /** Super admin uid who made the assignment. */
  assignedBy?: string | null;
  /** Set when the lead is registered, from the plan the registration used. */
  packageId?: LeadPackageId | null;
  /** Rupees: round(package price × commission rate). Null until packageId is set. */
  commissionAmount?: number | null;
  /** True once the super admin has confirmed the first payment came in. */
  paymentConfirmed?: boolean;
  paymentConfirmedAt?: Timestamp | null;
  paymentConfirmedBy?: string | null;
  paymentConfirmedByName?: string | null;
  /** Null until paymentConfirmed; "pending" until the Friday payout is sent. */
  payoutStatus?: PayoutStatus | null;
  /** ISO week the payment was confirmed in, e.g. "2026-W44". */
  payoutWeek?: string | null;
  /** Stamped when the weekly payout to the caller is marked sent. */
  payoutSentAt?: Timestamp | null;
  payoutSentBy?: string | null;
  payoutSentByName?: string | null;
  /** Every stage change, oldest first — the audit trail for a commission dispute. */
  stageHistory?: StageHistoryEntry[];

  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy?: string;
  createdByName?: string;
}

/** Pointer to the contact file in Storage (`leadContacts/{leadId}/contact.vcf`). */
export interface LeadVcf {
  name: string;
  size: number;
  /** vCards inside the file. */
  contacts: number;
  uploadedByName?: string;
}

/** The two fixed packages — document ids under `packages/`. */
export type LeadPackageId = "basic" | "pro";

export type PayoutStatus = "pending" | "paid_to_caller";

/** One stage change on a lead, appended by the admin and caller writes alike. */
export interface StageHistoryEntry {
  from: LeadStage;
  to: LeadStage;
  byUid: string;
  byName: string;
  at: Timestamp;
}

/** `packages/{id}` — the fixed price list commission is derived from. */
export interface LeadPackage {
  name: string;
  price: number;
  commissionRate: number;
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
  | "source" | "mainProblem" | "stage" | "callCount" | "tags" | "customTags" | "demoRequested"
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
    customTags: [],
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
