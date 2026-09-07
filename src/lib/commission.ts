// Staff commission resolution — the client half of the optional commission
// module (servicecenters/{centerId}.commissionEnabled).
//
// The authoritative calculation happens once, server-side, in the
// `onJobCompleted` Cloud Function (functions/index.js), which freezes the
// result into servicecenters/{centerId}/commissionLogs and onto each job
// service line. The helpers here exist so the "Mark as Done" preview can show
// the operator what is about to be earned using the *same* rules — they must
// stay in step with `resolveCommissionRate` / `computeCommissionAmount` in
// functions/index.js.
import type {
  CommissionRate, JobServiceLine, StaffCommission, StaffMember, VehicleType,
} from "../types/auth";

/** Round money to cents the same way the Cloud Function does. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The rate that applies to one service for one staff member: a service-specific
 * override first, then their default, then nothing (no commission at all).
 */
export function resolveCommissionRate(
  commission: StaffCommission | null | undefined,
  serviceKey: string,
): CommissionRate | null {
  if (!commission) return null;
  return commission.serviceRates?.[serviceKey] ?? commission.defaultRate ?? null;
}

/**
 * What a rate is worth on one service line.
 *
 * A percentage rate is a share of the line's price. A fixed rate is a flat LKR
 * amount that varies only by vehicle type — it is never scaled by the price,
 * so a 500-rupee flat rate pays 500 whether the service billed 1,000 or
 * 10,000. An unpriced vehicle type simply earns nothing.
 */
export function computeCommissionAmount(
  rate: CommissionRate | null | undefined,
  servicePrice: number,
  vehicleType: VehicleType | undefined,
): number {
  if (!rate) return 0;
  if (rate.type === "percentage") {
    return round2((servicePrice || 0) * (rate.percentage ?? 0) / 100);
  }
  if (!vehicleType) return 0;
  return round2(rate.valueByVehicleType?.[vehicleType] ?? 0);
}

/** The figure stored as `commissionRate` on a log entry / line snapshot. */
export function appliedRateValue(
  rate: CommissionRate,
  vehicleType: VehicleType | undefined,
): number {
  if (rate.type === "percentage") return rate.percentage ?? 0;
  if (!vehicleType) return 0;
  return rate.valueByVehicleType?.[vehicleType] ?? 0;
}

/** One row of the "what this job is about to pay out" preview. */
export interface CommissionPreviewRow {
  serviceName: string;
  staffId: string;
  staffName: string;
  role: StaffCommission["role"];
  amount: number;
  isOverride: boolean;
}

/**
 * The commission entries completing this job would write, computed exactly as
 * the Cloud Function will: per service line, the assigned technician first,
 * then an ADDITIONAL (never split) override for whoever they report to.
 *
 * Returns an empty list when the module is off, nothing is assigned, or no
 * rate resolves — which is what makes the preview safe to render
 * unconditionally behind the `commissionEnabled` check.
 */
export function previewJobCommissions(
  lines: JobServiceLine[] | undefined,
  staffById: Map<string, StaffMember>,
  vehicleType: VehicleType | undefined,
  displayName: (staff: StaffMember) => string,
): CommissionPreviewRow[] {
  const rows: CommissionPreviewRow[] = [];
  for (const line of lines ?? []) {
    if (!line.technicianId) continue;
    const tech = staffById.get(line.technicianId);
    if (!tech?.commission?.enabled) continue;

    const techRate = resolveCommissionRate(tech.commission, line.libraryItemId);
    const techAmount = computeCommissionAmount(techRate, line.price, vehicleType);
    if (techAmount > 0) {
      rows.push({
        serviceName: line.name,
        staffId: tech.id,
        staffName: displayName(tech),
        role: tech.commission.role,
        amount: techAmount,
        isOverride: false,
      });
    }

    const supId = tech.commission.reportsTo;
    if (!supId) continue;
    const sup = staffById.get(supId);
    if (!sup?.commission?.enabled) continue;
    const supRate = resolveCommissionRate(sup.commission, line.libraryItemId);
    const supAmount = computeCommissionAmount(supRate, line.price, vehicleType);
    if (supAmount > 0) {
      rows.push({
        serviceName: line.name,
        staffId: sup.id,
        staffName: displayName(sup),
        role: sup.commission.role,
        amount: supAmount,
        isOverride: true,
      });
    }
  }
  return rows;
}

/** A blank rate of the given kind, for a fresh row in the config editor. */
export function emptyRate(type: CommissionRate["type"]): CommissionRate {
  return type === "percentage"
    ? { type, percentage: 0, valueByVehicleType: null }
    : { type, percentage: null, valueByVehicleType: {} };
}

/** The default configuration a staff member starts from when it is switched on. */
export function emptyCommission(): StaffCommission {
  return { enabled: true, role: "technician", reportsTo: null, defaultRate: null, serviceRates: {} };
}

/** Short label for a commission role, as shown next to a name in previews. */
export const COMMISSION_ROLE_LABELS: Record<StaffCommission["role"], string> = {
  technician: "Tech",
  trainer: "Trainer",
  supervisor: "Supervisor",
};
