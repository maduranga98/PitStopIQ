import { parseSpreadsheet, type ParsedSheet } from "./importSupply";
import { normalizePhone } from "./utils";
import { SRI_LANKA_DISTRICTS } from "../types/auth";
import {
  LEAD_STAGE_KEYS, LEAD_TAGS, MAX_TRACKED_CALLS,
  type LeadDraft, type LeadStage, type LeadTag,
} from "../types/leads";

/**
 * Reading the existing lead tracker in.
 *
 * The list lives in `PitstopIQ-Leads-Tracker-Excel-Sheet.xlsx` today, whose
 * columns are:
 *
 *   ID. | Date (Lead ආපු දවස) | Customer Name (නම) | Garage Name (Garage එක) |
 *   Location (තැන) | Phone Number | Source (FB/Insta/WA) |
 *   Main Problem (ප්‍රධාන ප්‍රශ්නය) | Status | Demo Date & Time |
 *   Follow-up Date | Price Told? | Closed Amount (Rs) | Notes / ඊළඟට කරන්න ඕන දේ
 *
 * …on the first tab, with a Dashboard on the second. The mapping is guessed
 * from those headers and stays editable, so a re-ordered or renamed column
 * costs nothing. Nothing has to be cleaned up first: only a name is required,
 * and every messy cell is either parsed leniently or kept as written.
 */

export type { ParsedSheet };
export { parseSpreadsheet };

export type LeadField =
  | "businessName" | "contactName" | "phone" | "email" | "location" | "district"
  | "source" | "mainProblem" | "stage" | "callCount" | "tags" | "demoAt"
  | "followUp" | "priceNote" | "closedAmount" | "leadDate" | "notes";

export const LEAD_FIELD_LABELS: Record<LeadField, string> = {
  businessName: "Garage Name",
  contactName: "Customer Name",
  phone: "Phone Number",
  email: "Email",
  location: "Location",
  district: "District",
  source: "Source",
  mainProblem: "Main Problem",
  stage: "Status",
  callCount: "Calls Made",
  tags: "Tags",
  demoAt: "Demo Date & Time",
  followUp: "Follow-up Date",
  priceNote: "Price Told?",
  closedAmount: "Closed Amount (Rs)",
  leadDate: "Date (lead came in)",
  notes: "Notes",
};

/** The one column that has to be mapped — a lead with no name is not a lead. */
export const REQUIRED_LEAD_FIELDS: LeadField[] = ["businessName"];

const FIELD_HINTS: Record<LeadField, string[]> = {
  phone: ["phone", "mobile", "tel", "whatsapp", "contact no", "contact number"],
  email: ["email", "mail"],
  leadDate: ["date (lead", "lead date", "date"],
  contactName: ["customer name", "contact person", "contact name", "customer", "owner", "person"],
  businessName: ["garage", "business", "workshop", "company", "center", "centre", "shop", "name"],
  location: ["location", "town", "city", "area", "address"],
  district: ["district", "region", "province"],
  source: ["source", "channel", "campaign", "lead from"],
  mainProblem: ["problem", "pain", "issue", "requirement", "need"],
  stage: ["status", "stage", "pipeline"],
  demoAt: ["demo date", "demo time", "demo &", "demo"],
  followUp: ["follow-up", "follow up", "followup", "next call"],
  priceNote: ["price", "quote", "quoted", "amount told"],
  closedAmount: ["closed amount", "revenue", "value", "closed"],
  callCount: ["calls made", "no. of calls", "call count", "attempts"],
  tags: ["tag", "category", "label"],
  notes: ["note", "remark", "comment", "ඊළඟට"],
};

/**
 * Header → field, most specific field first.
 *
 * Order matters because several hints overlap on this sheet. "Customer Name
 * (නම)" and "Garage Name (Garage එක)" both end in "Name", and "Demo Date &
 * Time", "Follow-up Date" and "Date (Lead ආපු දවස)" all contain "Date" — so
 * phone, the two dates and the contact are matched on their specific hints
 * before businessName's loose "name" or leadDate's loose "date" get a turn.
 */
const MATCH_ORDER: LeadField[] = [
  "phone", "email", "demoAt", "followUp", "closedAmount", "priceNote",
  "contactName", "mainProblem", "stage", "callCount", "tags", "notes",
  "source", "district", "location", "leadDate", "businessName",
];

export const LEAD_TEMPLATE_HEADERS: { field: LeadField; header: string }[] =
  MATCH_ORDER.slice().reverse().map((field) => ({ field, header: LEAD_FIELD_LABELS[field] }));

/** Best-effort header → field guess, so the mapping step starts pre-filled. */
export function guessLeadColumnMap(headers: string[]): Partial<Record<LeadField, number>> {
  const map: Partial<Record<LeadField, number>> = {};
  const used = new Set<number>();
  for (const field of MATCH_ORDER) {
    const hints = FIELD_HINTS[field];
    const idx = headers.findIndex(
      (h, i) => !used.has(i) && hints.some((hint) => h.toLowerCase().includes(hint)),
    );
    if (idx !== -1) {
      map[field] = idx;
      used.add(idx);
    }
  }
  return map;
}

// ── Value parsing ────────────────────────────────────────────────────────────

/**
 * The sheet's Status words, mapped onto the board's columns. The stage keys
 * themselves are matched first, then the wording actually in the file, then a
 * few near-misses ("Called back", "Interested") that show up as people type.
 */
function matchStage(raw: string): LeadStage {
  const v = raw.trim().toLowerCase().replace(/[_-]/g, " ");
  if (!v) return "new";
  const exact = LEAD_STAGE_KEYS.find((k) => k.replace(/_/g, " ") === v);
  if (exact) return exact;
  if (/not answer|no answer|unanswered|didn'?t answer/.test(v)) return "no_answer";
  if (/won|signed|closed|converted|customer|paid/.test(v)) return "won";
  if (/lost|dead|reject|not interested/.test(v)) return "lost";
  if (/demo done|demo completed|demo given/.test(v)) return "demo_done";
  if (/demo/.test(v)) return "demo_booked";
  if (/video|details|detais|sent/.test(v)) return "details_sent";
  if (/follow/.test(v)) return "follow_up";
  if (/call|spoke|contacted|interested/.test(v)) return "called";
  return "new";
}

function matchTags(raw: string): LeadTag[] {
  const v = raw.toLowerCase();
  return Array.from(new Set(LEAD_TAGS.filter((t) => v.includes(t.key)).map((t) => t.key)));
}

/** The location cell when it happens to name one of the 25 districts. */
function matchDistrict(location: string): string {
  const v = location.trim().toLowerCase();
  if (!v) return "";
  return SRI_LANKA_DISTRICTS.find((d) => v.includes(d.toLowerCase())) ?? "";
}

/**
 * Phone numbers, repaired.
 *
 * Excel stores these as numbers, which breaks them two ways in this sheet:
 *
 *  - `0777494720` loses its leading zero and comes back as 777494720.
 *  - `940776123456` is wide enough to be displayed as `9.40769E+11`. That is
 *    only a display format — the stored value is intact — and it is the
 *    country code in front of a local number that kept its own zero, so the
 *    94 comes off rather than the zero going on.
 *
 * `82-10-8139-4844` stays text and is left exactly as written: a number this
 * doesn't recognise is kept rather than mangled into one that would dial
 * nowhere. Everything else goes to the app's own normaliser, which already
 * knows the 94… and 0094… forms.
 */
export function repairPhone(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  const digits = text.replace(/\D/g, "");
  // Nine digits with no leading zero: Excel ate it.
  if (/^[1-9]\d{8}$/.test(digits)) return "0" + digits;
  // 94 in front of a ten-digit local number that still has its zero.
  if (/^940\d{9}$/.test(digits)) return digits.slice(2);
  const normalised = normalizePhone(text);
  return /^0\d{9}$/.test(normalised) ? normalised : text;
}

/**
 * A cell that has to be a number to mean anything.
 *
 * `parseNumberCell` strips everything non-numeric, which is right for a price
 * column but wrong here: one tracker row has "8pm call" sitting in Closed
 * Amount (the row's columns are shifted by one), and stripping it yields Rs 8
 * of revenue that never existed. A cell that is not wholly a number — bar
 * thousands separators and an Rs/LKR prefix — is treated as not filled in.
 */
export function parseStrictNumber(raw: string): number {
  const text = raw.trim().replace(/^(rs\.?|lkr)\s*/i, "").replace(/[\s,]/g, "");
  if (!/^\d+(\.\d+)?$/.test(text)) return 0;
  const n = Number(text);
  return isNaN(n) ? 0 : n;
}

/**
 * How many calls a status implies have already been made.
 *
 * The sheet has no call-count column — the Status column is the record that
 * somebody picked up the phone. A lead sitting in any stage past New has
 * plainly been called at least once, so it is imported as one call rather
 * than zero. It is a floor, not a claim: the real count is usually higher,
 * and the dropdown on the card is there to correct it.
 */
function impliedCallCount(stage: LeadStage): number {
  return stage === "new" ? 0 : 1;
}

/**
 * Dates, as the sheet writes them: "2026.07.26", "2026-07-26", "26/07/2026",
 * or an Excel serial that came through as a number. Returns yyyy-mm-dd, or
 * "" when the cell isn't a date at all.
 */
export function parseSheetDate(raw: string): string {
  const text = raw.trim();
  if (!text) return "";

  const ymd = text.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
  if (ymd) return iso(+ymd[1], +ymd[2], +ymd[3]);

  const dmy = text.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
  if (dmy) return iso(+dmy[3], +dmy[2], +dmy[1]);

  // Excel serial: days since 1899-12-30. Only for plausible recent dates, so
  // a bare "26" in a follow-up column is not read as January 1900.
  if (/^\d{5}$/.test(text)) {
    const serial = Number(text);
    if (serial > 40000 && serial < 60000) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
      return d.toISOString().slice(0, 10);
    }
  }
  return "";
}

function iso(y: number, m: number, d: number): string {
  if (m < 1 || m > 12 || d < 1 || d > 31) return "";
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * The follow-up column, which holds a date in some rows and a sentence in
 * others — "26", "30 cl karala time ekak ganna", "next week visit", "sir call
 * me". Both are kept: a date drives the follow-ups-due count, and the text is
 * shown on the card as written.
 *
 * A bare 1–31 is the day of the month, which is how the sheet abbreviates a
 * follow-up inside the current month. It is resolved against the lead's own
 * date, and rolls into the next month when that day has already passed —
 * "26" written on the 30th means next month's 26th, not four days ago.
 */
export function parseFollowUp(raw: string, leadDate: string): { date: string; note: string } {
  const text = raw.trim();
  if (!text) return { date: "", note: "" };

  const exact = parseSheetDate(text);
  if (exact) return { date: exact, note: "" };

  const bareDay = text.match(/^(\d{1,2})$/);
  if (bareDay) {
    const day = Number(bareDay[1]);
    const base = leadDate ? new Date(`${leadDate}T00:00:00`) : new Date();
    if (day >= 1 && day <= 31 && !isNaN(base.getTime())) {
      let year = base.getFullYear();
      let month = base.getMonth();
      if (day < base.getDate()) {
        month += 1;
        if (month > 11) { month = 0; year += 1; }
      }
      const resolved = new Date(year, month, day);
      // Reject a day the month doesn't have (31 February rolls forward).
      if (resolved.getDate() === day) return { date: iso(year, month + 1, day), note: "" };
    }
  }
  return { date: "", note: text };
}

// ── Rows ─────────────────────────────────────────────────────────────────────

export interface ParsedLeadRow {
  draft: LeadDraft;
  /** Normalised phone — blank when the row had none. Used for de-duplication. */
  phoneKey: string;
  /** Why this row will be skipped, when it will be. */
  problem?: string;
}

/**
 * Maps sheet rows onto lead drafts. Rows that will be skipped are flagged
 * rather than dropped, so the count on screen always matches the file and a
 * mis-mapped column is obvious before anything is written. The tracker ends
 * in forty-odd rows that carry only an ID, and those land here as "no
 * business name".
 *
 * `existingPhones` are the numbers already in the pipeline: re-importing last
 * week's sheet on top of this week's must not create the same lead twice.
 */
export function parseLeadRows(
  rows: string[][],
  map: Partial<Record<LeadField, number>>,
  existingPhones: ReadonlySet<string> = new Set(),
): ParsedLeadRow[] {
  const cell = (row: string[], field: LeadField): string => {
    const idx = map[field];
    return idx === undefined ? "" : (row[idx] ?? "").trim();
  };

  const seen = new Set<string>();
  return rows.map((row) => {
    const businessName = cell(row, "businessName");
    const phone = repairPhone(cell(row, "phone"));
    const phoneKey = phone ? normalizePhone(phone) : "";
    const leadDate = parseSheetDate(cell(row, "leadDate"));
    const followUp = parseFollowUp(cell(row, "followUp"), leadDate);
    const location = cell(row, "location");
    const stage = matchStage(cell(row, "stage"));
    const mappedCalls = parseStrictNumber(cell(row, "callCount"));
    const calls = mappedCalls || impliedCallCount(stage);
    const closed = parseStrictNumber(cell(row, "closedAmount"));

    const draft: LeadDraft = {
      businessName,
      contactName: cell(row, "contactName"),
      phone,
      email: cell(row, "email"),
      location,
      // An explicit district column wins; otherwise the location is matched
      // against the 25 districts, which covers most of the sheet's rows.
      district: cell(row, "district") || matchDistrict(location),
      source: cell(row, "source"),
      mainProblem: cell(row, "mainProblem"),
      stage,
      callCount: Math.min(MAX_TRACKED_CALLS, Math.max(0, Math.round(calls))),
      tags: matchTags(cell(row, "tags")),
      // A row already sitting in a demo stage has plainly asked for one.
      demoRequested: stage === "demo_booked" || stage === "demo_done",
      demoAt: cell(row, "demoAt"),
      nextFollowUp: followUp.date,
      followUpNote: followUp.note,
      priceNote: cell(row, "priceNote"),
      closedAmount: closed,
      leadDate: leadDate || null,
      notes: cell(row, "notes"),
    };

    let problem: string | undefined;
    if (!businessName) problem = "No business name";
    else if (phoneKey && existingPhones.has(phoneKey)) problem = "Already in the pipeline";
    else if (phoneKey && seen.has(phoneKey)) problem = "Duplicate row in this file";
    if (!problem && phoneKey) seen.add(phoneKey);

    return { draft, phoneKey, problem };
  });
}
