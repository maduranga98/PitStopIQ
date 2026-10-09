// Which repairs apply to a vehicle. Pure, no Firestore.
//
// A repair applies when ANY of these holds:
//   - `appliesTo.all`
//   - the vehicle's type is listed in `appliesTo.types` (trim + lowercase match)
//   - the vehicle's model is listed in `appliesTo.modelIds`
//   - the vehicle belongs to a group listed in `appliesTo.groupIds`
// A vehicle belongs to an (active) group through its model (`group.modelIds`) or
// through its type (`group.types`). A vehicle with no `modelId` therefore only
// matches `all`, its type, and groups that cover its type: it never matches a
// model, and there is no fuzzy matching on make/model text.
import type { RepairAppliesTo, RepairItem, VehicleGroup, VehicleModel } from "../../types/repairCatalog";
import { normalizeTypeKey } from "./keys.ts";
import { sortGroups } from "./models.ts";

export interface VehicleContext {
  /** The vehicle's type (falls back to its model's type when the vehicle has none). */
  type: string | undefined;
  modelId: string | undefined;
}

/** The context for a vehicle record, or for a bare model picked in the test preview. */
export function vehicleContext(
  v: { vehicleType?: string | null; modelId?: string | null },
  models: Pick<VehicleModel, "id" | "vehicleType">[],
): VehicleContext {
  const modelId = v.modelId || undefined;
  const model = modelId ? models.find((m) => m.id === modelId) : undefined;
  const type = (v.vehicleType ?? "").trim() || model?.vehicleType || undefined;
  return { type, modelId };
}

/** Active groups this vehicle belongs to, in priority order (lower number first). */
export function groupsForContext(ctx: VehicleContext, groups: VehicleGroup[]): VehicleGroup[] {
  const typeKey = normalizeTypeKey(ctx.type);
  return sortGroups(groups).filter(
    (g) =>
      g.isActive !== false &&
      ((!!ctx.modelId && (g.modelIds ?? []).includes(ctx.modelId)) ||
        (typeKey !== "" && (g.types ?? []).some((t) => normalizeTypeKey(t) === typeKey))),
  );
}

export function repairApplies(
  appliesTo: RepairAppliesTo | undefined,
  ctx: VehicleContext,
  groups: VehicleGroup[],
): boolean {
  if (!appliesTo) return false;
  if (appliesTo.all) return true;
  const typeKey = normalizeTypeKey(ctx.type);
  if (typeKey && (appliesTo.types ?? []).some((t) => normalizeTypeKey(t) === typeKey)) return true;
  if (ctx.modelId && (appliesTo.modelIds ?? []).includes(ctx.modelId)) return true;
  const listed = appliesTo.groupIds ?? [];
  if (listed.length > 0) {
    for (const g of groupsForContext(ctx, groups)) if (listed.includes(g.id)) return true;
  }
  return false;
}

/** The repairs offered for a vehicle. Inactive repairs are never offered. */
export function applicableRepairs(
  repairs: RepairItem[],
  ctx: VehicleContext,
  groups: VehicleGroup[],
): RepairItem[] {
  return repairs.filter((r) => r.isActive !== false && repairApplies(r.appliesTo, ctx, groups));
}
