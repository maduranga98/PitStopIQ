// Display helpers for repairs on the shop-side screens. Pure, no reads.
//
// Everything here works from the job / invoice snapshot only: a repair that was
// later deactivated or deleted in the catalog still reads exactly as billed.
import type { InvoiceLineItem, ServiceJob } from "../../types/auth";
import type { RepairPerformed } from "../../types/repairCatalog";

export interface LineEntry {
  item: InvoiceLineItem;
  /** Index into the original `lineItems` array (edit/delete handlers are index-based). */
  idx: number;
}

export interface GroupedInvoiceLines {
  services: LineEntry[];
  repairs: LineEntry[];
  parts: LineEntry[];
}

/**
 * Split invoice lines into Services / Repairs / Parts for display, keeping each
 * line's original index. A line without a `type` (manual, or from before the
 * split existed) is a service. With no repair lines this is exactly the
 * services-vs-parts split the invoice screens always used.
 */
export function groupInvoiceLines(lineItems: InvoiceLineItem[]): GroupedInvoiceLines {
  const out: GroupedInvoiceLines = { services: [], repairs: [], parts: [] };
  lineItems.forEach((item, idx) => {
    if (item.type === "part") out.parts.push({ item, idx });
    else if (item.type === "repair") out.repairs.push({ item, idx });
    else out.services.push({ item, idx });
  });
  return out;
}

/**
 * Names a job's work is summarised by: services, custom services, then repairs.
 * With no repairs it is the same list the screens built before.
 */
export function jobWorkNames(
  job: { services?: string[]; customServices?: string[]; repairsPerformed?: Pick<RepairPerformed, "name">[] },
): string[] {
  return [
    ...(job.services ?? []),
    ...(job.customServices ?? []),
    ...(job.repairsPerformed ?? []).map((r) => r.name),
  ];
}

/** Display-only view of a job type for screens whose local job interface predates repairs. */
export type JobWithRepairs = Pick<ServiceJob, "services" | "customServices" | "repairsPerformed">;

/** Name of the repair a part was added from (display grouping via `partItemIds`), or undefined. */
export function repairNameForPart(
  repairs: Pick<RepairPerformed, "name" | "partItemIds">[] | undefined,
  itemId: string | undefined,
): string | undefined {
  if (!itemId) return undefined;
  return repairs?.find((r) => r.partItemIds?.includes(itemId))?.name;
}

export type RepairSourceKey = "custom" | "model" | "group" | "type" | "default";

/**
 * Which price tier a repair was priced from, for a label. Group names are not
 * resolved (that would read the catalog): the label says "Group price".
 */
export function repairSourceKey(r: Pick<RepairPerformed, "custom" | "resolvedFrom">): RepairSourceKey {
  if (r.custom) return "custom";
  if (r.resolvedFrom === "model" || r.resolvedFrom === "group" || r.resolvedFrom === "type") return r.resolvedFrom;
  return "default";
}
