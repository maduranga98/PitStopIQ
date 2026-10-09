// Price (and part quantity) resolution. Pure, no Firestore.
//
// Order, most specific first:
//   1. an override on the vehicle's MODEL
//   2. an override on a GROUP the vehicle belongs to: if several groups have one,
//      the group with the LOWER priority number wins. The cheapest is never picked.
//   3. an override on the vehicle's TYPE (trim + lowercase match)
//   4. the repair's default
// The result says where it came from, so the job screen can show it.
import type {
  RepairItem, RepairPartQtyOverride, RepairPriceOverride, RepairResolvedFrom, RepairSuggestedPart,
  RepairScope, VehicleGroup, VehicleModel,
} from "../../types/repairCatalog";
import { groupsForContext, type VehicleContext } from "./applicability.ts";
import { modelLabel, normalizeTypeKey } from "./keys.ts";

export interface Resolved {
  value: number;
  from: RepairResolvedFrom;
  /** The model id, group id or type string the value came from. */
  sourceId?: string;
  /**
   * Two groups the vehicle belongs to carried different overrides at the SAME
   * priority number, so the one used was decided by name order, not by the
   * owner. Surfaced so the owner can fix the priorities.
   */
  ambiguous?: boolean;
}

interface Scoped { scope: RepairScope; scopeId: string; value: number }

function resolveScoped(
  overrides: Scoped[],
  ctx: VehicleContext,
  groups: VehicleGroup[],
  defaultValue: number,
): Resolved {
  const usable = overrides.filter((o) => Number.isFinite(o.value));

  if (ctx.modelId) {
    const m = usable.find((o) => o.scope === "model" && o.scopeId === ctx.modelId);
    if (m) return { value: m.value, from: "model", sourceId: m.scopeId };
  }

  // Groups the vehicle is in, already ordered by priority (lower number first).
  const withOverride = groupsForContext(ctx, groups)
    .map((g) => ({ g, o: usable.find((x) => x.scope === "group" && x.scopeId === g.id) }))
    .filter((x): x is { g: VehicleGroup; o: Scoped } => !!x.o);
  if (withOverride.length > 0) {
    const [first, second] = withOverride;
    return {
      value: first.o.value,
      from: "group",
      sourceId: first.g.id,
      ...(second && second.g.priority === first.g.priority && second.o.value !== first.o.value
        ? { ambiguous: true }
        : {}),
    };
  }

  const typeKey = normalizeTypeKey(ctx.type);
  if (typeKey) {
    const t = usable.find((o) => o.scope === "type" && normalizeTypeKey(o.scopeId) === typeKey);
    if (t) return { value: t.value, from: "type", sourceId: t.scopeId };
  }

  return { value: defaultValue, from: "default" };
}

/** The price of a repair for a vehicle, and where it came from. */
export function resolveRepairPrice(
  repair: Pick<RepairItem, "defaultPrice" | "priceOverrides">,
  ctx: VehicleContext,
  groups: VehicleGroup[],
): Resolved {
  const overrides = (repair.priceOverrides ?? []).map((o: RepairPriceOverride) => ({
    scope: o.scope, scopeId: o.scopeId, value: Number(o.price),
  }));
  return resolveScoped(overrides, ctx, groups, Number(repair.defaultPrice) || 0);
}

/** The default quantity of a suggested part for a vehicle, with per-model/group/type overrides. */
export function resolvePartQty(
  part: Pick<RepairSuggestedPart, "defaultQty" | "overrides">,
  ctx: VehicleContext,
  groups: VehicleGroup[],
): Resolved {
  const overrides = (part.overrides ?? []).map((o: RepairPartQtyOverride) => ({
    scope: o.scope, scopeId: o.scopeId, value: Number(o.qty),
  }));
  return resolveScoped(overrides, ctx, groups, Number(part.defaultQty) || 1);
}

/** "Model price (Honda Dio)", "Group price (Scooters)", "Type price (motor bike)", "Default price". */
export function sourceLabel(
  r: Pick<Resolved, "from" | "sourceId">,
  groups: Pick<VehicleGroup, "id" | "name">[],
  models: Pick<VehicleModel, "id" | "make" | "model">[],
  noun = "price",
): string {
  switch (r.from) {
    case "model": {
      const m = models.find((x) => x.id === r.sourceId);
      return `Model ${noun}${m ? ` (${modelLabel(m)})` : ""}`;
    }
    case "group": {
      const g = groups.find((x) => x.id === r.sourceId);
      return `Group ${noun}${g ? ` (${g.name})` : ""}`;
    }
    case "type":
      return `Type ${noun}${r.sourceId ? ` (${r.sourceId})` : ""}`;
    default:
      return `Default ${noun}`;
  }
}
