// Shared helpers for resolving service catalog prices.
//
// A single service (e.g. "Oil Change") can be priced differently per vehicle
// type. Each price lives in its own `servicePrices` document that shares the
// service `name` but carries a distinct `vehicleType`. An entry with no
// `vehicleType` is the general "All vehicle types" fallback price.
//
// These helpers keep the New Service, New Invoice and Service Detail pages in
// sync so a bill always uses the price that matches the vehicle being serviced
// instead of showing every vehicle type's price at once.
import type { ServicePriceItem, VehicleType } from "../types/auth";

/** The effective price of a catalog entry, tolerating the legacy `price` field. */
export function catalogPrice(item: ServicePriceItem): number {
  return item.defaultPrice ?? item.price ?? 0;
}

/**
 * Pick the catalog entry that applies to `name` for a given vehicle type.
 * Prefers an exact vehicle-type match, then the general (typeless) entry,
 * then any entry as a last resort. Returns undefined when the service is not
 * priced at all.
 */
export function resolveServiceItem(
  catalog: ServicePriceItem[],
  name: string,
  vehicleType?: VehicleType,
): ServicePriceItem | undefined {
  const matches = catalog.filter((c) => c.name === name);
  if (matches.length === 0) return undefined;
  return (
    (vehicleType ? matches.find((c) => c.vehicleType === vehicleType) : undefined) ||
    matches.find((c) => !c.vehicleType) ||
    matches[0]
  );
}

/** The resolved price for `name` at `vehicleType`, or `undefined` if unpriced. */
export function resolveServicePrice(
  catalog: ServicePriceItem[],
  name: string,
  vehicleType?: VehicleType,
): number | undefined {
  const item = resolveServiceItem(catalog, name, vehicleType);
  return item ? catalogPrice(item) : undefined;
}

/** Distinct service names in the catalog (a name may be priced for many types). */
export function uniqueServiceNames(catalog: ServicePriceItem[]): string[] {
  return Array.from(new Set(catalog.map((c) => c.name)));
}

/** How many vehicle types (incl. the general entry) a service is priced for. */
export function pricedTypeCount(catalog: ServicePriceItem[], name: string): number {
  return catalog.filter((c) => c.name === name).length;
}

/** A short label for a catalog entry's vehicle type ("All types" when general). */
export function vehicleTypeLabel(vehicleType?: VehicleType): string {
  return vehicleType && vehicleType.trim() ? vehicleType : "All types";
}
