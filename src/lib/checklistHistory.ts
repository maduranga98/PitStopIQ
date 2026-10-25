// Pure helpers for the standalone checklist history list: which state a record
// is in, and search / status filtering. No Firebase, so they are unit-tested.
import type { FilledChecklistSection, StandalonePostServiceChecklist } from "../types/auth";

export type ChecklistState = "draft" | "signed" | "sent";
export type ChecklistStateFilter = ChecklistState | "all";

export function checklistState(r: Pick<StandalonePostServiceChecklist, "completedAt" | "sentToCustomer">): ChecklistState {
  if (r.sentToCustomer === true) return "sent";
  return r.completedAt ? "signed" : "draft";
}

/** Lines rated "needs immediate attention" — what a workshop most wants to find again. */
export function urgentCount(sections: FilledChecklistSection[] | undefined): number {
  return (sections ?? []).reduce((n, s) => n + s.items.filter((i) => i.status === "immediate").length, 0);
}

export interface HistoryFilter {
  /** Free text: matches plate, customer name, phone and checklist name. */
  query: string;
  state: ChecklistStateFilter;
  urgentOnly: boolean;
}

/**
 * Records matching the filter, in the order given. `plateById` / `nameById` /
 * `phoneById` resolve vehicles and customers that were picked from the system
 * rather than typed in; a missing entry just means that field can't match.
 */
export function filterChecklists(
  records: StandalonePostServiceChecklist[],
  f: HistoryFilter,
  lookup: { plateById?: Map<string, string>; nameById?: Map<string, string>; phoneById?: Map<string, string> } = {},
): StandalonePostServiceChecklist[] {
  const q = f.query.trim().toLowerCase();
  const compact = q.replace(/\s+/g, "");
  // Phone digits are only searched when the query is itself number-shaped, so a
  // plate like "wpka1" does not match every phone number containing a 1.
  const queryDigits = q.replace(/\D/g, "");
  const looksLikePhone = /^[\d\s+()-]+$/.test(q) && queryDigits.length >= 3;
  return records.filter((r) => {
    if (f.state !== "all" && checklistState(r) !== f.state) return false;
    if (f.urgentOnly && urgentCount(r.sections) === 0) return false;
    if (!q) return true;
    const plate = (r.plateNumberManual || (r.vehicleId ? lookup.plateById?.get(r.vehicleId) : "") || "").toLowerCase();
    const name = (r.customerNameManual || (r.customerId ? lookup.nameById?.get(r.customerId) : "") || "").toLowerCase();
    const phone = (r.customerId ? lookup.phoneById?.get(r.customerId) : "") ?? "";
    return name.includes(q)
      || r.templateName.toLowerCase().includes(q)
      // Plates are typed with and without spaces ("CAI 5598" / "CAI5598").
      || plate.replace(/\s+/g, "").includes(compact)
      || (looksLikePhone && phone.replace(/\D/g, "").includes(queryDigits));
  });
}

export function stateCounts(records: StandalonePostServiceChecklist[]): Record<ChecklistStateFilter, number> {
  const counts: Record<ChecklistStateFilter, number> = { all: records.length, draft: 0, signed: 0, sent: 0 };
  for (const r of records) counts[checklistState(r)] += 1;
  return counts;
}
