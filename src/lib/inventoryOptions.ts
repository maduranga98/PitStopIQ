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
