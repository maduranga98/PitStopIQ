// Parts for the repairs on a job. Pure.
//
// addPartSnapshot is THE way a picked inventory item becomes a PartUsed on the
// job: the same snapshot (code, brand, warranty, price, cost) and the same
// merge-by-itemId as the "Add Part" button on the job card and on the new-job
// form, so there is one parts path, and the job's `partsUsed` is what stock
// deduction (unchanged) reads at Mark Done.
import type { InventoryItem, PartUsed } from "../../types/auth";
import type { RepairItem } from "../../types/repairCatalog";
import { serviceCenterPriceOf, purchasePriceOf } from "../inventoryPricing.ts";
import { itemBrand } from "../inventoryOptions.ts";
import { warrantySnapshot } from "../warranty.ts";
import { resolvePartQty } from "./pricing.ts";
import type { VehicleContext } from "./applicability.ts";
import type { VehicleGroup } from "../../types/repairCatalog";

export function addPartSnapshot(prev: PartUsed[], item: InventoryItem, qty: number): PartUsed[] {
  const existing = prev.find((p) => p.itemId === item.id);
  if (existing) {
    return prev.map((p) => (p.itemId === item.id ? { ...p, quantity: p.quantity + qty } : p));
  }
  return [...prev, {
    itemId: item.id,
    itemName: item.name,
    ...(item.partNumber ? { partNumber: item.partNumber } : {}),
    ...(itemBrand(item) ? { brand: itemBrand(item) } : {}),
    // Frozen now, so a warranty edited on the item later never changes what the job promised.
    ...warrantySnapshot(item),
    quantity: qty,
    unitPrice: serviceCenterPriceOf(item),
    unitCost: serviceCenterPriceOf(item),
    costPrice: purchasePriceOf(item),
  }];
}

export interface SuggestedRow {
  itemId: string;
  item: InventoryItem;
  /** The default quantity for this vehicle (per-model / group / type override, else the repair's). */
  qty: number;
  available: number;
}

/**
 * A repair's suggested parts for a vehicle, with live stock. Parts that are no
 * longer in the (non-archived) inventory are left out: they cannot be added.
 */
export function suggestedPartRows(
  repair: Pick<RepairItem, "suggestedParts">, ctx: VehicleContext, groups: VehicleGroup[],
  inventory: Map<string, InventoryItem>,
): SuggestedRow[] {
  const rows: SuggestedRow[] = [];
  for (const p of repair.suggestedParts ?? []) {
    const item = inventory.get(p.inventoryItemId);
    if (!item || item.isArchived) continue;
    rows.push({
      itemId: item.id, item, qty: resolvePartQty(p, ctx, groups).value, available: Number(item.currentQty) || 0,
    });
  }
  return rows;
}

/**
 * Would the job need more than is on the shelf? Judged on the total the job
 * would hold (what is already on it plus this add), which is what Mark Done
 * compares against stock. A warning only: it never blocks.
 */
export function shortOfStock(available: number, qty: number, alreadyOnJob = 0): boolean {
  return alreadyOnJob + qty > available;
}

/** A quantity typed for a part: above zero, or null. */
export function parseQtyInput(raw: string | number): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}
