import type { Invoice, InventoryItem, PartUsed } from "../types/auth";
import { purchasePriceOf } from "./inventoryPricing";

/** What a part line was billed at — mirrors ServiceDetailPage's partLinePrice. */
function partLinePrice(part: PartUsed): number {
  return part.unitPrice ?? part.unitCost ?? 0;
}

/**
 * What the workshop paid for a part line. Falls back to the billed price for
 * lines saved before cost snapshotting existed — better an optimistic margin
 * than a job that looks like it lost money on a part it didn't.
 */
function partLineCost(part: PartUsed): number {
  return part.costPrice ?? partLinePrice(part);
}

interface PartsUsedFields {
  partsUsed?: PartUsed[];
}

/** Total cost of every part used on a job. */
export function partsCost(job: PartsUsedFields): number {
  return (job.partsUsed ?? []).reduce((sum, p) => sum + partLineCost(p) * p.quantity, 0);
}

/** Total billed value of every part used on a job. */
export function partsRevenue(job: PartsUsedFields): number {
  return (job.partsUsed ?? []).reduce((sum, p) => sum + partLinePrice(p) * p.quantity, 0);
}

export interface JobProfitability {
  revenue: number;
  partsCost: number;
  laborCost: number;
  /**
   * Staff commission this job paid out — technicians' own entries and any
   * supervisor override, frozen onto the job by the `onJobCompleted` Cloud
   * Function. 0 at a center not running the commission module, and on jobs
   * completed before the total was recorded.
   */
  commissionCost: number;
  totalCost: number;
  grossProfit: number;
  /** null when there's no revenue to divide by — nothing to show a % of. */
  marginPercent: number | null;
}

/**
 * A job's margin against its invoice: what it billed, what it cost (parts,
 * labor and staff commission), and what's left. `invoice` is optional so a job
 * that hasn't been invoiced yet (or whose invoice failed to load) still gets a
 * cost-only view.
 *
 * Commission is a cost of doing the job like any other — a workshop paying 10%
 * of every service to the technician who did it is 10% worse off on that job,
 * and a margin that leaves it out flatters every figure built on top.
 */
export function jobProfitability(
  job: PartsUsedFields & { laborCost?: number; commissionTotal?: number },
  invoice: Pick<Invoice, "grandTotal"> | null | undefined,
): JobProfitability {
  const revenue = invoice?.grandTotal ?? 0;
  const cost = partsCost(job);
  const labor = job.laborCost ?? 0;
  const commission = job.commissionTotal ?? 0;
  const totalCost = cost + labor + commission;
  const grossProfit = revenue - totalCost;
  return {
    revenue,
    partsCost: cost,
    laborCost: labor,
    commissionCost: commission,
    totalCost,
    grossProfit,
    marginPercent: revenue > 0 ? Math.round((grossProfit / revenue) * 100) : null,
  };
}

/** The cost snapshot to write onto a new PartUsed line when it's added to a job. */
export function costPriceOf(item: InventoryItem): number {
  return purchasePriceOf(item);
}
