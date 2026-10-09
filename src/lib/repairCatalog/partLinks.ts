// Item <-> repair links. The link lives ONLY on `repairCatalog.suggestedParts`;
// everything about an item's "used for repairs" is derived here, on the device,
// from the cached catalog. Pure.
import type { RepairItem, RepairSuggestedPart } from "../../types/repairCatalog";

export interface LinkedRepair {
  repair: RepairItem;
  defaultQty: number;
}

/** inventory item id -> the repairs that list it, for the whole catalog in one pass. */
export function buildPartIndex(repairs: RepairItem[]): Map<string, LinkedRepair[]> {
  const index = new Map<string, LinkedRepair[]>();
  for (const repair of repairs) {
    for (const p of repair.suggestedParts ?? []) {
      const list = index.get(p.inventoryItemId);
      const entry = { repair, defaultQty: p.defaultQty };
      if (list) list.push(entry);
      else index.set(p.inventoryItemId, [entry]);
    }
  }
  return index;
}

/** The repairs one item is linked to, by repair name. */
export function linkedRepairsFor(itemId: string, repairs: RepairItem[]): LinkedRepair[] {
  return (buildPartIndex(repairs).get(itemId) ?? []).sort((a, b) => a.repair.name.localeCompare(b.repair.name));
}

/** A quantity the owner typed: a positive number, or null. */
export function parseQty(raw: string | number): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Add an item to a part list. Already linked: the list is returned unchanged
 * (same reference) and the existing entry, with its quantity and overrides, is
 * left alone, so repeating an add changes nothing.
 */
export function addPartLink(parts: RepairSuggestedPart[], itemId: string, defaultQty: number): RepairSuggestedPart[] {
  if (parts.some((p) => p.inventoryItemId === itemId)) return parts;
  return [...parts, { inventoryItemId: itemId, defaultQty }];
}

/** Remove only this item's entry. Every other part, and every other field of the repair, is untouched. */
export function removePartLink(parts: RepairSuggestedPart[], itemId: string): RepairSuggestedPart[] {
  return parts.some((p) => p.inventoryItemId === itemId) ? parts.filter((p) => p.inventoryItemId !== itemId) : parts;
}
