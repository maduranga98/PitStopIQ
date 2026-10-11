// Repairs on a job: which repairs to offer for a vehicle, and the entries that
// are stored on the job. Pure, no Firestore.
//
// The price on a stored entry is a SNAPSHOT: it is resolved once, when the
// repair is picked, and the invoice reads it back. Nothing here re-resolves it.
import type {
  RepairItem, RepairPerformed, VehicleGroup, VehicleModel,
} from "../../types/repairCatalog";
import { repairApplies, vehicleContext, type VehicleContext } from "./applicability.ts";
import { groupsForContext } from "./applicability.ts";
import { resolveRepairPrice, type Resolved } from "./pricing.ts";

/** The vehicle a job is for, as the picker needs it. */
export interface JobVehicle {
  vehicleType?: string | null;
  /** The vehicle's resolved model (job.modelId, or the registered vehicle's). Never set for a walk-in. */
  modelId?: string | null;
  /** No vehicle record behind the plate: only the typed vehicle type is known. */
  walkIn?: boolean;
}

/**
 * The context repairs are matched and priced against. A walk-in has no model
 * and no group membership, whatever was typed: it matches on its type alone.
 */
export function jobRepairContext(v: JobVehicle, models: Pick<VehicleModel, "id" | "vehicleType">[]): VehicleContext {
  return v.walkIn
    ? vehicleContext({ vehicleType: v.vehicleType }, [])
    : vehicleContext({ vehicleType: v.vehicleType, modelId: v.modelId }, models);
}

/** The groups that may be matched for this vehicle: none for a walk-in. */
export const jobRepairGroups = (v: JobVehicle, groups: VehicleGroup[]): VehicleGroup[] => (v.walkIn ? [] : groups);

/** How specifically a repair is aimed at this vehicle: 0 model, 1 group, 2 type, 3 everything, 4 not applicable. */
export function matchRank(repair: RepairItem, ctx: VehicleContext, groups: VehicleGroup[]): number {
  const a = repair.appliesTo;
  if (!a) return 4;
  if (ctx.modelId && (a.modelIds ?? []).includes(ctx.modelId)) return 0;
  const listed = a.groupIds ?? [];
  if (listed.length > 0 && groupsForContext(ctx, groups).some((g) => listed.includes(g.id))) return 1;
  if (repairApplies({ ...a, all: false, modelIds: [], groupIds: [] }, ctx, groups)) return 2;
  return a.all ? 3 : 4;
}

/**
 * The repairs to offer: the active ones that apply to the vehicle, most
 * specific first (model, group, type, all), then by name. `showAll` offers
 * every active repair. Inactive repairs are never offered.
 */
export function repairsForPicker(
  repairs: RepairItem[], v: JobVehicle, models: Pick<VehicleModel, "id" | "vehicleType">[], groups: VehicleGroup[],
  showAll = false,
): RepairItem[] {
  const ctx = jobRepairContext(v, models);
  const g = jobRepairGroups(v, groups);
  return repairs
    .filter((r) => r.isActive !== false)
    .map((r) => ({ r, rank: matchRank(r, ctx, g) }))
    .filter((x) => showAll || x.rank < 4)
    .sort((a, b) => a.rank - b.rank || a.r.name.localeCompare(b.r.name))
    .map((x) => x.r);
}

/** What picking a repair puts on the job, and the resolution behind it. */
export function pickRepair(
  repair: Pick<RepairItem, "id" | "name" | "defaultPrice" | "priceOverrides">,
  v: JobVehicle, models: Pick<VehicleModel, "id" | "vehicleType">[], groups: VehicleGroup[],
): { entry: RepairPerformed; resolved: Resolved } {
  const resolved = resolveRepairPrice(repair, jobRepairContext(v, models), jobRepairGroups(v, groups));
  return {
    resolved,
    entry: {
      repairItemId: repair.id,
      name: repair.name,
      price: resolved.value,
      custom: false,
      resolvedFrom: resolved.from,
      ...(resolved.sourceId ? { resolvedSourceId: resolved.sourceId } : {}),
    },
  };
}

let customSeq = 0;
/** A free-text repair: name and price only. Its id is local to the job. */
export function customRepair(name: string, price: number): RepairPerformed {
  customSeq += 1;
  return {
    repairItemId: `custom-${Date.now().toString(36)}-${customSeq}`,
    name: name.trim(), price: moneyOrZero(price), custom: true, resolvedFrom: "default",
  };
}

export const moneyOrZero = (n: number) => (Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0);

/** A positive amount typed by the user, or null. */
export function parsePrice(raw: string | number): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw).trim().replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export const hasRepair = (list: RepairPerformed[], repairItemId: string) =>
  list.some((r) => r.repairItemId === repairItemId);

/** Add an entry. A catalog repair already on the job is left exactly as it is (same reference). */
export function addRepair(list: RepairPerformed[], entry: RepairPerformed): RepairPerformed[] {
  return !entry.custom && hasRepair(list, entry.repairItemId) ? list : [...list, entry];
}

/** Remove only this repair's entry. Parts already added stay on the job. */
export const removeRepair = (list: RepairPerformed[], repairItemId: string): RepairPerformed[] =>
  list.filter((r) => r.repairItemId !== repairItemId);

/** The user typed a different price: keep `resolvedFrom` as it was picked and mark the override. */
export function overrideRepairPrice(list: RepairPerformed[], repairItemId: string, price: number): RepairPerformed[] {
  return list.map((r) =>
    r.repairItemId === repairItemId ? { ...r, price: moneyOrZero(price), priceOverridden: true } : r);
}

/** Remember which parts were added with a repair, for display grouping only. */
export function attachPartIds(list: RepairPerformed[], repairItemId: string, itemIds: string[]): RepairPerformed[] {
  if (itemIds.length === 0) return list;
  return list.map((r) =>
    r.repairItemId === repairItemId
      ? { ...r, partItemIds: [...new Set([...(r.partItemIds ?? []), ...itemIds])] }
      : r);
}

/** "Model price", "Group: Scooters", "Type price", "Default", "Custom" (+ "· edited" after an override). */
export function priceSourceText(
  r: Pick<RepairPerformed, "custom" | "resolvedFrom" | "resolvedSourceId" | "priceOverridden">,
  groups: Pick<VehicleGroup, "id" | "name">[],
): string {
  const base = r.custom ? "Custom"
    : r.resolvedFrom === "model" ? "Model price"
    : r.resolvedFrom === "group"
      ? `Group: ${groups.find((g) => g.id === r.resolvedSourceId)?.name ?? "price"}`
      : r.resolvedFrom === "type" ? "Type price"
      : "Default";
  return r.priceOverridden ? `${base} · edited` : base;
}
