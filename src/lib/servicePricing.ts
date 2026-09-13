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
 * Of the entries sharing one service name, the one that applies to a vehicle
 * type. Prefers an exact vehicle-type match, then the general (typeless)
 * entry, then any entry as a last resort. The single definition of the
 * fallback rules, so the scanning and the indexed lookups below can never
 * disagree about which price a job is billed.
 */
function pickForType(
  matches: ServicePriceItem[] | undefined,
  vehicleType?: VehicleType,
): ServicePriceItem | undefined {
  if (!matches || matches.length === 0) return undefined;
  return (
    (vehicleType ? matches.find((c) => c.vehicleType === vehicleType) : undefined) ||
    matches.find((c) => !c.vehicleType) ||
    matches[0]
  );
}

/**
 * Pick the catalog entry that applies to `name` for a given vehicle type.
 * Returns undefined when the service is not priced at all.
 *
 * This scans the whole catalog, so it costs O(catalog) per lookup. That is
 * fine for a caller that resolves a handful of names once (saving a job,
 * rebuilding its service lines). A caller that resolves EVERY name — any
 * screen listing the catalog — must not use it in a loop: that is O(n²) and
 * it is what made the job-card form crawl on a tablet. Use `buildCatalogIndex`
 * once and `resolveFromIndex` per name instead.
 */
export function resolveServiceItem(
  catalog: ServicePriceItem[],
  name: string,
  vehicleType?: VehicleType,
): ServicePriceItem | undefined {
  return pickForType(catalog.filter((c) => c.name === name), vehicleType);
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

/**
 * The services a workshop actually offers for a given vehicle type: those
 * priced for that exact type, plus those carrying a general (typeless) price
 * that applies to everything.
 *
 * Not every service fits every vehicle — a motorbike has no wheel alignment,
 * a lorry has no interior valet — so a job card for a bike should only offer
 * what the bike is priced for. When the vehicle's type is unknown there is
 * nothing to narrow by, so every service is on offer.
 */
export function serviceNamesForVehicleType(
  catalog: ServicePriceItem[],
  vehicleType?: VehicleType,
): string[] {
  if (!vehicleType) return uniqueServiceNames(catalog);
  const offered = catalog.filter((c) => !c.vehicleType || c.vehicleType === vehicleType);
  return uniqueServiceNames(offered);
}

// ── Indexed lookups ────────────────────────────────────────────────────────────
// Everything above answers one question by walking the whole catalog. A screen
// that LISTS the catalog asks the same question once per service name, so the
// walking is quadratic: a 400-entry catalog costs 160,000 string comparisons to
// paint the service grid on the new-job form. None of those screens memoised
// it, so the whole grid was rebuilt on every render — and a render happens on
// every keystroke anywhere on the page, including the customer search, the part
// search and the notes field. Each character typed paid the full quadratic
// bill. A desktop absorbs it; the counter tablet the form is actually used on
// does not, and it reads as "the job card has frozen".
//
// Same shape of bug, and the same fix, as hooks/useCustomerSearch.ts: group the
// data ONCE (O(catalog)), then every per-name lookup is a Map hit. Build the
// index in a useMemo keyed on the catalog so it survives keystrokes, and the
// per-render cost of the grid drops to O(names).

/** The catalog grouped for O(1) lookup by service name. Build with
 *  `buildCatalogIndex`; treat as opaque and immutable. */
export interface CatalogIndex {
  /** Every entry sharing a service name, in catalog order. */
  byName: Map<string, ServicePriceItem[]>;
  /** Distinct service names, in first-seen catalog order. */
  names: string[];
}

/** Group a catalog by service name in a single pass. */
export function buildCatalogIndex(catalog: ServicePriceItem[]): CatalogIndex {
  const byName = new Map<string, ServicePriceItem[]>();
  const names: string[] = [];
  for (const item of catalog) {
    const existing = byName.get(item.name);
    if (existing) {
      existing.push(item);
    } else {
      byName.set(item.name, [item]);
      names.push(item.name);
    }
  }
  return { byName, names };
}

/** `resolveServiceItem` against a prebuilt index: a Map hit, then a scan of the
 *  one-to-a-few entries priced under that name. */
export function resolveFromIndex(
  index: CatalogIndex,
  name: string,
  vehicleType?: VehicleType,
): ServicePriceItem | undefined {
  return pickForType(index.byName.get(name), vehicleType);
}

/** The resolved price for `name` at `vehicleType` against a prebuilt index. */
export function priceFromIndex(
  index: CatalogIndex,
  name: string,
  vehicleType?: VehicleType,
): number | undefined {
  const item = resolveFromIndex(index, name, vehicleType);
  return item ? catalogPrice(item) : undefined;
}

/** `serviceNamesForVehicleType` against a prebuilt index. */
export function serviceNamesFromIndex(
  index: CatalogIndex,
  vehicleType?: VehicleType,
): string[] {
  if (!vehicleType) return index.names;
  return index.names.filter((name) =>
    index.byName.get(name)!.some((c) => !c.vehicleType || c.vehicleType === vehicleType),
  );
}
