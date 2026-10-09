// Pure helpers over vehicle models and groups (no Firestore here).
import type { VehicleGroup, VehicleModel } from "../../types/repairCatalog";
import { collapseSpaces, modelLabel, normalizeModelKey, normalizeTypeKey } from "./keys.ts";

/** Models by their normalised key, for O(1) duplicate checks. */
export function indexModelsByKey(models: VehicleModel[]): Map<string, VehicleModel> {
  const map = new Map<string, VehicleModel>();
  for (const m of models) {
    const key = m.key || normalizeModelKey(m.make, m.model);
    // First one wins; an older stray duplicate never shadows the original.
    if (!map.has(key)) map.set(key, m);
  }
  return map;
}

/** The existing model a make + model would duplicate, if any (active or not). */
export function findDuplicateModel(
  models: VehicleModel[],
  make: string,
  model: string,
  ignoreId?: string,
): VehicleModel | undefined {
  const key = normalizeModelKey(make, model);
  if (!key) return undefined;
  for (const m of models) {
    if (m.id === ignoreId) continue;
    if ((m.key || normalizeModelKey(m.make, m.model)) === key) return m;
  }
  return undefined;
}

/** Search models by any part of "make model" or type; empty query returns all. */
export function searchModels(models: VehicleModel[], q: string): VehicleModel[] {
  const needle = collapseSpaces(q).toLowerCase();
  if (!needle) return models;
  const words = needle.split(" ");
  return models.filter((m) => {
    const hay = `${modelLabel(m)} ${m.vehicleType}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export function sortModels(models: VehicleModel[]): VehicleModel[] {
  return [...models].sort((a, b) => modelLabel(a).localeCompare(modelLabel(b)));
}

// ── Groups ───────────────────────────────────────────────────────────────────

/** Groups ordered by priority (lower number first), then name. */
export function sortGroups(groups: VehicleGroup[]): VehicleGroup[] {
  return [...groups].sort(
    (a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.name.localeCompare(b.name),
  );
}

/** The priority a newly created group gets: after every existing one. */
export function nextGroupPriority(groups: VehicleGroup[]): number {
  return groups.reduce((max, g) => Math.max(max, g.priority ?? 0), 0) + 1;
}

/**
 * Active groups a model belongs to, in priority order: listed by id, or
 * through a whole vehicle type the group covers.
 */
export function groupsForModel(
  groups: VehicleGroup[],
  model: Pick<VehicleModel, "id" | "vehicleType">,
): VehicleGroup[] {
  const typeKey = normalizeTypeKey(model.vehicleType);
  return sortGroups(groups).filter(
    (g) =>
      g.isActive !== false &&
      (g.modelIds.includes(model.id) || (typeKey !== "" && g.types.some((t) => normalizeTypeKey(t) === typeKey))),
  );
}

/** Group name by id, for chips. */
export function groupNameIndex(groups: VehicleGroup[]): Map<string, string> {
  return new Map(groups.map((g) => [g.id, g.name]));
}

/**
 * New priorities after moving the group at `from` to `to` in the displayed
 * order, renumbered 1..n. Returns only the groups whose number changed.
 */
export function reorderPriorities(
  ordered: VehicleGroup[],
  from: number,
  to: number,
): { id: string; priority: number }[] {
  if (from === to || from < 0 || to < 0 || from >= ordered.length || to >= ordered.length) return [];
  const next = [...ordered];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  const changes: { id: string; priority: number }[] = [];
  next.forEach((g, i) => {
    if (g.priority !== i + 1) changes.push({ id: g.id, priority: i + 1 });
  });
  return changes;
}
