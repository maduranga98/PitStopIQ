// Item warranty — the manufacturer's (or the center's own) guarantee on a part
// that carries one. Only some stock does: a battery or an alternator is sold
// with a warranty, a litre of oil or a packet of washers never is. And plenty
// of centers don't track warranties at all, so the whole feature hangs off the
// center's `inventoryWarrantyEnabled` flag (see ServiceCenter in types/auth).
//
// The period is stored as a plain value + unit pair rather than a number of
// days, so "6 months" prints as "6 months" and an expiry date is worked out
// from the date the part was actually billed.

import type { InventoryItem, ItemWarranty, WarrantyUnit } from "../types/auth";

export const WARRANTY_UNITS: { value: WarrantyUnit; label: string }[] = [
  { value: "days", label: "Days" },
  { value: "months", label: "Months" },
  { value: "years", label: "Years" },
];

const UNIT_SET = new Set<WarrantyUnit>(["days", "months", "years"]);

/** Longest period anyone would sensibly type — guards a mis-keyed spreadsheet. */
const MAX_PERIOD = 1000;

export function isWarrantyUnit(value: unknown): value is WarrantyUnit {
  return typeof value === "string" && UNIT_SET.has(value as WarrantyUnit);
}

/** "6 months", "1 year", "90 days" — singular when the value is exactly one. */
export function warrantyLabel(value: number, unit: WarrantyUnit): string {
  const noun = value === 1 ? unit.slice(0, -1) : unit;
  return `${value} ${noun}`;
}

/** The same, for a warranty object. Empty string when there is nothing to say. */
export function formatWarranty(warranty?: ItemWarranty | null): string {
  if (!warranty || !(warranty.value > 0)) return "";
  return warrantyLabel(warranty.value, warranty.unit);
}

/**
 * The warranty carried by an inventory item, or null when it has none.
 *
 * `hasWarranty` is the switch the form toggles; a period of zero (or a missing
 * one) means the switch is on but nothing was filled in yet, which is not a
 * warranty worth printing on a bill.
 */
export function itemWarranty(item: Pick<
  InventoryItem, "hasWarranty" | "warrantyPeriodValue" | "warrantyPeriodUnit" | "warrantyNotes"
>): ItemWarranty | null {
  if (item.hasWarranty !== true) return null;
  const value = item.warrantyPeriodValue;
  if (typeof value !== "number" || !(value > 0)) return null;
  const unit = isWarrantyUnit(item.warrantyPeriodUnit) ? item.warrantyPeriodUnit : "months";
  const notes = item.warrantyNotes?.trim();
  return { value, unit, ...(notes ? { notes } : {}) };
}

/**
 * The warranty fields to spread onto a snapshot (a job's `partsUsed` line, an
 * invoice line). Nothing is written for an item without one, so a line that
 * never had a warranty carries no key at all — Firestore rejects undefined.
 */
export function warrantySnapshot(item: Pick<
  InventoryItem, "hasWarranty" | "warrantyPeriodValue" | "warrantyPeriodUnit" | "warrantyNotes"
>): { warranty?: ItemWarranty } {
  const warranty = itemWarranty(item);
  return warranty ? { warranty } : {};
}

/** The date a warranty taken out on `from` runs until. */
export function warrantyExpiry(from: Date, warranty: ItemWarranty): Date {
  const out = new Date(from.getTime());
  if (warranty.unit === "days") out.setDate(out.getDate() + warranty.value);
  else if (warranty.unit === "months") out.setMonth(out.getMonth() + warranty.value);
  else out.setFullYear(out.getFullYear() + warranty.value);
  return out;
}

/**
 * Read a warranty out of a spreadsheet cell.
 *
 * Suppliers write these every which way — "6 months", "6M", "1 year", "2 yrs",
 * "90 days", or a bare "6" — so the unit is matched loosely and a number on its
 * own is read as months, which is what a bare figure on a parts list means in
 * practice. Returns null for a blank cell or anything that isn't a warranty
 * ("N/A", "no", "-"), so an unmapped column never invents one.
 */
export function parseWarrantyCell(raw: string): ItemWarranty | null {
  const text = (raw ?? "").trim().toLowerCase();
  if (!text) return null;
  if (/^(n\/?a|no|none|nil|-|0)$/.test(text)) return null;

  const match = text.match(/(\d+(?:\.\d+)?)\s*([a-z]*)/);
  if (!match) return null;

  const value = Math.round(parseFloat(match[1]));
  if (!(value > 0) || value > MAX_PERIOD) return null;

  const word = match[2];
  let unit: WarrantyUnit = "months";
  if (/^d/.test(word)) unit = "days";
  else if (/^y/.test(word)) unit = "years";
  else if (/^(w)/.test(word)) { // "4 weeks" — kept as days rather than dropped
    return { value: value * 7, unit: "days" };
  }
  return { value, unit };
}

/** Clamp a typed period to something storable. Returns null when unusable. */
export function normalizeWarrantyPeriod(raw: string): number | null {
  const n = Math.round(parseFloat(raw));
  if (isNaN(n) || n <= 0 || n > MAX_PERIOD) return null;
  return n;
}
