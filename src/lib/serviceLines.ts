// Per-service job lines — the shared half of the two optional workshop
// modules (bay workflow and staff commission).
//
// A job's services live in `services[]` / `customServices[]` as plain names,
// and that stays true: those two arrays remain what invoices, reports and the
// customer view read. `serviceLines[]` sits alongside them carrying the extra
// per-line detail the modules need (who did it, which bay, its bay progress,
// its frozen commission), and is only written when at least one module is on.
// A center running neither never gets the field at all.
import type {
  JobServiceLine, ServiceBay, ServicePriceItem, VehicleType,
} from "../types/auth";
import { catalogPrice, resolveServiceItem } from "./servicePricing";

/** Whether either optional module needs `serviceLines` maintained. */
export function serviceLinesEnabled(flags: {
  bayWorkflowEnabled?: boolean; commissionEnabled?: boolean;
}): boolean {
  return flags.bayWorkflowEnabled === true || flags.commissionEnabled === true;
}

/** A fresh, unassigned line for one service name. */
export function blankServiceLine(
  name: string,
  price: number,
  custom: boolean,
  bayWorkflowEnabled: boolean,
): JobServiceLine {
  return {
    libraryItemId: name,
    name,
    price,
    custom,
    technicianId: null,
    bayId: null,
    // A line only tracks bay progress where the workflow is on; otherwise the
    // field stays null and the completion gate below ignores it entirely.
    bayStatus: bayWorkflowEnabled ? "pending" : null,
    commissionSnapshot: null,
  };
}

/**
 * Reconcile `serviceLines` against the job's current service names.
 *
 * Lines whose service is still on the job keep everything already recorded
 * against them (technician, bay, progress, a frozen commission); services that
 * appeared get a blank line; lines whose service was removed are dropped. The
 * result is ordered to match `services` then `customServices`, so the job card
 * and the bay board list them the same way.
 */
export function syncServiceLines(
  existing: JobServiceLine[] | undefined,
  services: string[],
  customServices: string[],
  catalog: ServicePriceItem[],
  vehicleType: VehicleType | undefined,
  bayWorkflowEnabled: boolean,
): JobServiceLine[] {
  const byName = new Map((existing ?? []).map((l) => [l.libraryItemId, l]));
  const build = (name: string, custom: boolean): JobServiceLine => {
    const item = custom ? undefined : resolveServiceItem(catalog, name, vehicleType);
    const price = item ? catalogPrice(item) : 0;
    const prev = byName.get(name);
    if (!prev) return blankServiceLine(name, price, custom, bayWorkflowEnabled);
    return {
      ...prev,
      // Re-resolve the price so a line always reflects what is actually being
      // billed — except once a commission has been frozen against it, which is
      // never rewritten after the fact.
      price: prev.commissionSnapshot ? prev.price : price,
      bayStatus: bayWorkflowEnabled ? (prev.bayStatus ?? "pending") : prev.bayStatus,
    };
  };
  return [
    ...services.map((n) => build(n, false)),
    ...customServices.map((n) => build(n, true)),
  ];
}

/**
 * Whether every bay-routed line has been worked to completion.
 *
 * Lines with no bay (and every line at a center not running the workflow) are
 * ignored — only what was actually sent to a bay can hold the job open.
 */
export function allBaysDone(lines: JobServiceLine[] | undefined): boolean {
  return (lines ?? []).every((l) => !l.bayId || l.bayStatus === "done");
}

/** The bay-routed lines still outstanding, for the force-close confirmation. */
export function outstandingBayLines(
  lines: JobServiceLine[] | undefined,
  bays: ServiceBay[],
): { name: string; bayName: string; bayStatus: string }[] {
  const bayName = (id: string) => bays.find((b) => b.id === id)?.name ?? "Unknown bay";
  return (lines ?? [])
    .filter((l) => l.bayId && l.bayStatus !== "done")
    .map((l) => ({
      name: l.name,
      bayName: bayName(l.bayId as string),
      bayStatus: l.bayStatus === "in_progress" ? "In progress" : "Not started",
    }));
}

export const BAY_STATUS_LABELS: Record<NonNullable<JobServiceLine["bayStatus"]>, string> = {
  pending: "Waiting",
  in_progress: "In progress",
  done: "Done",
};

/** Tailwind classes for a bay-status pill, matching the job status chips. */
export const BAY_STATUS_CLASSES: Record<NonNullable<JobServiceLine["bayStatus"]>, string> = {
  pending: "bg-white/5 text-gray-400 border-white/10",
  in_progress: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  done: "bg-green-500/15 text-green-300 border-green-500/30",
};
