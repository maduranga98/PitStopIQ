import { parseSpreadsheet, parseNumberCell, type ParsedSheet } from "./importSupply";
import { normalizePhone } from "./utils";
import {
  LEAD_STAGE_KEYS, LEAD_TAGS, MAX_TRACKED_CALLS,
  type LeadDraft, type LeadStage, type LeadTag,
} from "../types/leads";

/**
 * Reading the existing lead spreadsheet in.
 *
 * The list lives in Excel today, so the import takes the file as-is — whatever
 * headers it happens to use — and maps its columns onto lead fields, the same
 * way a supplier's stock list is imported (lib/importSupply.ts, whose sheet
 * reader is reused here rather than duplicated). Nothing about the sheet has
 * to be cleaned up first: only a name is required, everything else is
 * best-effort and editable afterwards.
 */

export type { ParsedSheet };
export { parseSpreadsheet };

export type LeadField =
  | "businessName" | "contactName" | "phone" | "email"
  | "city" | "district" | "source" | "stage" | "callCount" | "tags" | "notes";

export const LEAD_FIELD_LABELS: Record<LeadField, string> = {
  businessName: "Business Name",
  contactName: "Contact Person",
  phone: "Phone",
  email: "Email",
  city: "City",
  district: "District",
  source: "Source",
  stage: "Stage",
  callCount: "Calls Made",
  tags: "Tags",
  notes: "Notes",
};

/** The one column that has to be mapped — a lead with no name is not a lead. */
export const REQUIRED_LEAD_FIELDS: LeadField[] = ["businessName"];

const FIELD_HINTS: Record<LeadField, string[]> = {
  businessName: ["business", "center", "centre", "garage", "workshop", "company", "shop", "name"],
  contactName: ["contact", "owner", "person", "customer"],
  phone: ["phone", "mobile", "contact no", "tel", "number", "whatsapp"],
  email: ["email", "mail"],
  city: ["city", "town", "area"],
  district: ["district", "region", "province"],
  source: ["source", "channel", "referr", "lead from", "campaign"],
  stage: ["stage", "status", "pipeline"],
  callCount: ["call", "calls", "attempts", "follow up count"],
  tags: ["tag", "type", "category", "label"],
  notes: ["note", "remark", "comment", "detail", "description"],
};

/** Header row for the downloadable template, in the order they'd fill it in. */
export const LEAD_TEMPLATE_HEADERS: { field: LeadField; header: string }[] =
  (Object.keys(LEAD_FIELD_LABELS) as LeadField[]).map((field) => ({
    field,
    header: LEAD_FIELD_LABELS[field],
  }));

/** Best-effort header → field guess, so the mapping step starts pre-filled. */
export function guessLeadColumnMap(headers: string[]): Partial<Record<LeadField, number>> {
  const map: Partial<Record<LeadField, number>> = {};
  const used = new Set<number>();
  // Longest hints first within each field, and fields in declaration order:
  // "Contact No." must not be claimed by businessName's loose "name" hint
  // before phone has had a chance at it, so phone is matched on its own
  // specific hints first and the generic ones only fill what is left.
  const order: LeadField[] = [
    "phone", "email", "contactName", "district", "city", "source",
    "stage", "callCount", "tags", "notes", "businessName",
  ];
  for (const field of order) {
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

function matchStage(raw: string): LeadStage {
  const v = raw.trim().toLowerCase();
  const hit = LEAD_STAGE_KEYS.find((k) => k === v || k.replace("_", " ") === v);
  if (hit) return hit;
  // The spreadsheet's own words for the same thing.
  if (/won|signed|closed won|converted|customer/.test(v)) return "won";
  if (/lost|dead|reject|not interested/.test(v)) return "lost";
  if (/demo|trial/.test(v)) return "demo";
  if (/negoti|quote|pricing|proposal/.test(v)) return "negotiation";
  if (/contact|called|spoke|follow/.test(v)) return "contacted";
  return "new";
}

function matchTags(raw: string): LeadTag[] {
  const v = raw.toLowerCase();
  const tags = LEAD_TAGS.filter((t) => v.includes(t.key)).map((t) => t.key);
  return Array.from(new Set(tags));
}

export interface ParsedLeadRow {
  draft: LeadDraft;
  /** Normalised phone — blank when the row had none. Used for de-duplication. */
  phoneKey: string;
  /** Why this row will be skipped, when it will be. */
  problem?: string;
}

/**
 * Maps sheet rows onto lead drafts. Rows with no business name are flagged
 * rather than dropped, so the count on screen always matches the file and a
 * mis-mapped column is obvious before anything is written.
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
    const phone = cell(row, "phone");
    const phoneKey = phone ? normalizePhone(phone) : "";
    const calls = parseNumberCell(cell(row, "callCount"));

    const draft: LeadDraft = {
      businessName,
      contactName: cell(row, "contactName"),
      phone,
      email: cell(row, "email"),
      city: cell(row, "city"),
      district: cell(row, "district"),
      source: cell(row, "source"),
      stage: matchStage(cell(row, "stage")),
      callCount: Math.min(MAX_TRACKED_CALLS, Math.max(0, Math.round(calls ?? 0))),
      tags: matchTags(cell(row, "tags")),
      demoRequested: false,
      nextFollowUp: "",
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
