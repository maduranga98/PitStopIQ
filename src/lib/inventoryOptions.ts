// Shared option lists for inventory items. The built-in categories and units
// cover the common workshop stock, but every center carries something the
// defaults miss (paint, AC gas, bodyshop consumables… sold by the drum, the
// can, the box), so they can add their own. Custom entries live on the
// service-center document as `customInventoryCategories` and
// `customInventoryUnits` — the same pattern the vehicle form uses for oil
// brands and vehicle types.
export const DEFAULT_INVENTORY_CATEGORIES = [
  "Lubricants",
  "Filters",
  "Brake Parts",
  "Tyres",
  "Electrical",
  "Consumables",
  "Other",
] as const;

export const DEFAULT_INVENTORY_UNITS = [
  "Litres",
  "Pieces",
  "Kits",
  "Sets",
  "Metres",
  "Pairs",
  "Packets",
] as const;

export const MAX_CATEGORY_LENGTH = 40;
export const MAX_UNIT_LENGTH = 20;

/**
 * Merge a built-in list with a center's custom entries (and anything already
 * used by an item, so an option is never dropped from a filter bar or a
 * dropdown just because it was removed from the custom list). Defaults keep
 * their canonical order; custom entries follow, sorted.
 */
function mergeOptions(
  defaults: readonly string[],
  custom: string[],
  inUse: string[],
): string[] {
  const extras = new Set<string>();
  [...custom, ...inUse].forEach(value => {
    const trimmed = (value ?? "").trim();
    if (trimmed && !defaults.includes(trimmed)) extras.add(trimmed);
  });
  return [...defaults, ...Array.from(extras).sort((a, b) => a.localeCompare(b))];
}

/** Validation shared by every place a new option can be typed. */
function validateOption(
  name: string,
  existing: string[],
  maxLength: number,
  noun: string,
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return `Enter a ${noun} name.`;
  if (trimmed.length > maxLength) return `Max ${maxLength} characters.`;
  if (existing.some(c => c.toLowerCase() === trimmed.toLowerCase())) {
    return `That ${noun} already exists.`;
  }
  return null;
}

// ── Categories ───────────────────────────────────────────────────────────────

export function isDefaultCategory(name: string): boolean {
  return (DEFAULT_INVENTORY_CATEGORIES as readonly string[]).includes(name);
}

export function buildCategoryList(custom: string[] = [], inUse: string[] = []): string[] {
  return mergeOptions(DEFAULT_INVENTORY_CATEGORIES, custom, inUse);
}

export function validateCategoryName(name: string, existing: string[]): string | null {
  return validateOption(name, existing, MAX_CATEGORY_LENGTH, "category");
}

// ── Units ────────────────────────────────────────────────────────────────────

export function isDefaultUnit(name: string): boolean {
  return (DEFAULT_INVENTORY_UNITS as readonly string[]).includes(name);
}

export function buildUnitList(custom: string[] = [], inUse: string[] = []): string[] {
  return mergeOptions(DEFAULT_INVENTORY_UNITS, custom, inUse);
}

export function validateUnitName(name: string, existing: string[]): string | null {
  return validateOption(name, existing, MAX_UNIT_LENGTH, "unit");
}

// ── Brand ─────────────────────────────────────────────────────────────────────
// The same part is stocked under several makes, so a brand is part of an item's
// identity rather than a detail of who supplied it. `brand` is where that now
// lives; items saved before it existed only carry `supplierBrand`, so every
// read goes through the helpers below rather than touching either field.

export const MAX_BRAND_LENGTH = 40;

type BrandFields = { brand?: string; supplierBrand?: string };

/** An item's brand, falling back to the supplier's for items saved before it. */
export function itemBrand(item?: BrandFields | null): string {
  return (item?.brand ?? "").trim() || (item?.supplierBrand ?? "").trim();
}

/**
 * Two items are the same stock line when their name AND brand match. Used for
 * the uniqueness check on the item form and for matching an imported row to an
 * item already on the shelf — "Air Filter (Sakura)" and "Air Filter (Denso)"
 * are two lines, not a duplicate.
 */
export function itemIdentityKey(name: string, brand: string): string {
  return `${name.trim().toLowerCase()}|${brand.trim().toLowerCase()}`;
}

/** Every brand in use across a catalog, sorted — the datalist behind a Brand box. */
export function brandsInUse(items: BrandFields[]): string[] {
  const seen = new Map<string, string>();
  items.forEach(item => {
    const brand = itemBrand(item);
    if (brand) seen.set(brand.toLowerCase(), brand);
  });
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
