// ── How a finalized report is laid out for a reader (pure) ───────────────────
// Used by the public page and the customer portal's detail view.
// Needs-repair items first within each section, then Meets, then N/A — stable
// within a group, so the template's own order still decides ties.
import type {
  InspectionItemResult, InspectionReportOnlyItem, InspectionResultStatus, InspectionTemplateSection,
} from "../../types/inspectionReports";

export interface DisplayItem { id: string; label: string; reportOnly: boolean; status: InspectionResultStatus | null; remark: string; photoIds: string[] }

const RANK: Record<string, number> = { needs_repair: 0, meets: 1, na: 2 };

export function displayItems(
  section: Pick<InspectionTemplateSection, "id" | "items">,
  reportOnly: InspectionReportOnlyItem[],
  results: Record<string, InspectionItemResult>,
): DisplayItem[] {
  const all = [
    ...section.items.map((i) => ({ id: i.id, label: i.label, reportOnly: false })),
    ...reportOnly.filter((e) => e.sectionId === section.id).map((e) => ({ id: e.id, label: e.label, reportOnly: true })),
  ].map((i) => ({
    ...i, status: results[i.id]?.status ?? null, remark: results[i.id]?.remark ?? "", photoIds: results[i.id]?.photoIds ?? [],
  }));
  return all
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (RANK[a.item.status ?? ""] ?? 3) - (RANK[b.item.status ?? ""] ?? 3) || a.index - b.index)
    .map((x) => x.item);
}

export function resultCounts(
  sections: Array<Pick<InspectionTemplateSection, "id" | "items">>,
  reportOnly: InspectionReportOnlyItem[],
  results: Record<string, InspectionItemResult>,
) {
  const c = { meets: 0, needs_repair: 0, na: 0 };
  for (const s of sections) for (const i of displayItems(s, reportOnly, results)) if (i.status) c[i.status] += 1;
  return c;
}
