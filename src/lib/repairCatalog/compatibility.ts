// Inventory compatibility: which parts fit which vehicle. Pure, no Firestore.
//
// An item with no `compatibility` field is UNIVERSAL: every item that existed
// before this feature keeps working with no backfill. Matching follows the same
// conventions as repair applicability (applicability.ts):
//   - types match after trim + lowercase,
//   - a vehicle belongs to an active group through its model (`group.modelIds`)
//     or its type (`group.types`),
//   - a vehicle without a `modelId` therefore matches only universal items, its
//     type, and groups whose `types[]` cover it. Never a model, never by text.
import type {
  InventoryCompatibility, VehicleGroup, VehicleModel,
} from "../../types/repairCatalog";
import { groupsForContext, vehicleContext } from "./applicability.ts";
import { collapseSpaces, normalizeTypeKey } from "./keys.ts";

/** The part of an inventory item these helpers read. */
export interface CompatItem {
  compatibility?: InventoryCompatibility | null;
  serviceCenterPrice?: number | null;
}

/** What a part is matched against: the vehicle's own fields. */
export interface CompatVehicle {
  vehicleType?: string | null;
  modelId?: string | null;
}

/** The center's cached catalogs, used to resolve a vehicle's model and groups. */
export interface CompatContext {
  models: Pick<VehicleModel, "id" | "vehicleType">[];
  groups: VehicleGroup[];
}

/** A vehicle with its type, model and groups resolved once, for matching many parts. */
export interface ResolvedVehicle {
  type: string | undefined;
  modelId: string | undefined;
  groupIds: Set<string>;
}

export function resolveVehicle(vehicle: CompatVehicle, context: CompatContext): ResolvedVehicle {
  const ctx = vehicleContext(vehicle, context.models);
  return {
    type: ctx.type,
    modelId: ctx.modelId,
    groupIds: new Set(groupsForContext(ctx, context.groups).map((g) => g.id)),
  };
}

/** The stored compatibility with any missing array filled in. undefined: none set. */
export function normalizeCompatibility(raw: unknown): InventoryCompatibility | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const c = raw as Partial<InventoryCompatibility>;
  return {
    universal: c.universal === true,
    types: Array.isArray(c.types) ? c.types : [],
    groupIds: Array.isArray(c.groupIds) ? c.groupIds : [],
    modelIds: Array.isArray(c.modelIds) ? c.modelIds : [],
  };
}

/**
 * The canonical value to store. Universal carries empty lists (so it reads the
 * same however it was reached); specific lists are de-duplicated, with types
 * compared the way matching compares them.
 */
export function buildCompatibility(input: {
  universal: boolean; types?: string[]; groupIds?: string[]; modelIds?: string[];
}): InventoryCompatibility {
  if (input.universal) return { universal: true, types: [], groupIds: [], modelIds: [] };
  const seenTypes = new Set<string>();
  const types: string[] = [];
  for (const t of input.types ?? []) {
    const k = normalizeTypeKey(t);
    if (k && !seenTypes.has(k)) { seenTypes.add(k); types.push(collapseSpaces(t)); }
  }
  return {
    universal: false,
    types,
    groupIds: [...new Set(input.groupIds ?? [])],
    modelIds: [...new Set(input.modelIds ?? [])],
  };
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Same meaning (list order does not matter, types compare trim + lowercase). */
export function compatibilityEquals(a: InventoryCompatibility | undefined, b: InventoryCompatibility | undefined): boolean {
  if (!a || !b) return !a && !b;
  const x = buildCompatibility(a);
  const y = buildCompatibility(b);
  return (
    x.universal === y.universal &&
    sameSet(x.types.map(normalizeTypeKey), y.types.map(normalizeTypeKey)) &&
    sameSet(x.groupIds, y.groupIds) &&
    sameSet(x.modelIds, y.modelIds)
  );
}

/** No compatibility has been set on this item (it counts as universal). */
export function isUnclassified(item: CompatItem): boolean {
  return !normalizeCompatibility(item.compatibility);
}

/** serviceCenterPrice missing or 0: the part would be billed at a fallback price. */
export function hasNoSellingPrice(item: CompatItem): boolean {
  const p = item.serviceCenterPrice;
  return typeof p !== "number" || !Number.isFinite(p) || p <= 0;
}

function fitsResolved(item: CompatItem, v: ResolvedVehicle): boolean {
  const c = normalizeCompatibility(item.compatibility);
  if (!c || c.universal) return true;
  const typeKey = normalizeTypeKey(v.type);
  if (typeKey && c.types.some((t) => normalizeTypeKey(t) === typeKey)) return true;
  if (v.modelId && c.modelIds.includes(v.modelId)) return true;
  return c.groupIds.some((id) => v.groupIds.has(id));
}

/** Does this part fit this vehicle? Items without compatibility are universal. */
export function isPartCompatible(item: CompatItem, vehicle: CompatVehicle, context: CompatContext): boolean {
  return fitsResolved(item, resolveVehicle(vehicle, context));
}

/**
 * Compatible parts first, then the rest. Stable: each half keeps the order it
 * came in. Returns a new array. (Used by the job screen in a later phase.)
 */
export function sortPartsForVehicle<T extends CompatItem>(items: T[], vehicle: CompatVehicle, context: CompatContext): T[] {
  const v = resolveVehicle(vehicle, context);
  const fits: T[] = [];
  const rest: T[] = [];
  for (const i of items) (fitsResolved(i, v) ? fits : rest).push(i);
  return [...fits, ...rest];
}

// ── Inventory list filters ───────────────────────────────────────────────────

export type CompatTarget =
  | { kind: "type"; id: string }
  | { kind: "group"; id: string }
  | { kind: "model"; id: string };

/**
 * Is the part offered for this type, group or model? Universal parts always
 * are. A type or model is judged exactly as a vehicle of that type/model would
 * be; a group is judged by the part listing that group directly.
 */
export function isCompatibleWithTarget(item: CompatItem, target: CompatTarget, context: CompatContext): boolean {
  if (target.kind === "group") {
    const c = normalizeCompatibility(item.compatibility);
    return !c || c.universal || c.groupIds.includes(target.id);
  }
  if (target.kind === "type") return isPartCompatible(item, { vehicleType: target.id }, context);
  const model = context.models.find((m) => m.id === target.id);
  return isPartCompatible(item, { vehicleType: model?.vehicleType, modelId: target.id }, context);
}

export interface InventoryToolFilter {
  unclassified: boolean;
  noSellingPrice: boolean;
  compatibleWith: CompatTarget | null;
}

export const NO_TOOL_FILTER: InventoryToolFilter = { unclassified: false, noSellingPrice: false, compatibleWith: null };

export const isToolFilterActive = (f: InventoryToolFilter) => f.unclassified || f.noSellingPrice || !!f.compatibleWith;

/** The items passing every active filter. */
export function applyToolFilter<T extends CompatItem>(items: T[], f: InventoryToolFilter, context: CompatContext): T[] {
  if (!isToolFilterActive(f)) return items;
  return items.filter(
    (i) =>
      (!f.unclassified || isUnclassified(i)) &&
      (!f.noSellingPrice || hasNoSellingPrice(i)) &&
      (!f.compatibleWith || isCompatibleWithTarget(i, f.compatibleWith, context)),
  );
}
