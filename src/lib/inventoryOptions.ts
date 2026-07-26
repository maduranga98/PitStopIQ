// Shared option lists for inventory items. The built-in categories cover the
// common workshop stock, but every center carries something the defaults miss
// (paint, AC gas, bodyshop consumables…), so they can add their own. Custom
// categories live on the service-center document as `customInventoryCategories`
// — the same pattern the vehicle form uses for oil brands and vehicle types.
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

export function isDefaultCategory(name: string): boolean {
  return (DEFAULT_INVENTORY_CATEGORIES as readonly string[]).includes(name);
}

/**
 * Merge the built-in categories with a center's custom ones (and anything
 * already used by an item, so a category is never dropped from the filter bar
 * just because it was removed from the custom list). Defaults keep their
 * canonical order; custom entries follow, sorted.
 */
export function buildCategoryList(custom: string[] = [], inUse: string[] = []): string[] {
  const defaults = DEFAULT_INVENTORY_CATEGORIES as readonly string[];
  const extras = new Set<string>();
  [...custom, ...inUse].forEach(c => {
    const trimmed = (c ?? "").trim();
    if (trimmed && !defaults.includes(trimmed)) extras.add(trimmed);
  });
  return [...defaults, ...Array.from(extras).sort((a, b) => a.localeCompare(b))];
}

/** Validation shared by every place a new category can be typed. */
export function validateCategoryName(name: string, existing: string[]): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Enter a category name.";
  if (trimmed.length > MAX_CATEGORY_LENGTH) return `Max ${MAX_CATEGORY_LENGTH} characters.`;
  if (existing.some(c => c.toLowerCase() === trimmed.toLowerCase())) {
    return "That category already exists.";
  }
  return null;
}
