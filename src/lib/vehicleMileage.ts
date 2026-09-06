// Mileage is optional on a vehicle: it can be registered before anyone reads
// the odometer, and some things a workshop looks after (a trailer, a
// generator) have none at all. Every screen therefore has to cope with "not
// recorded" rather than assume a number, so the arithmetic and the formatting
// live here instead of being re-derived per page.

export type MileageStatus = "ok" | "due_soon" | "overdue" | "unknown";

type MileageFields = {
  currentMileageKm?: number | null;
  nextServiceMileageKm?: number | null;
};

/** Whether this vehicle carries an odometer reading at all. */
export function hasMileage(v: MileageFields): boolean {
  return v.currentMileageKm != null;
}

/** Kilometres left before the next service, or null when either figure is missing. */
export function kmRemaining(v: MileageFields): number | null {
  if (v.currentMileageKm == null || v.nextServiceMileageKm == null) return null;
  return v.nextServiceMileageKm - v.currentMileageKm;
}

/**
 * Service standing from the odometer. A vehicle with no reading is "unknown",
 * never "overdue" — nothing is known to be due, so it must not be chased.
 */
export function mileageStatus(v: MileageFields, thresholdKm: number): MileageStatus {
  const remaining = kmRemaining(v);
  if (remaining === null) return "unknown";
  if (remaining < 0) return "overdue";
  if (remaining <= thresholdKm) return "due_soon";
  return "ok";
}

/** "45,000 km", or a dash where nothing was recorded. */
export function formatKm(km: number | null | undefined): string {
  return km == null ? "—" : `${km.toLocaleString()} km`;
}
