// Suggested links between existing vehicles (free-text make/model) and
// vehicleModels. SUGGESTIONS ONLY: nothing here writes, and the review screen
// applies a link only when the owner confirms that one vehicle.
import type { Vehicle } from "../../types/auth";
import type { VehicleModel } from "../../types/repairCatalog";
import { indexModelsByKey } from "./models.ts";
import { normalizeModelKey, normalizeTypeKey } from "./keys.ts";

export interface LinkSuggestion {
  vehicle: Vehicle;
  model: VehicleModel;
  /** The vehicle's own type differs from the model's. Shown, never auto-fixed. */
  typeMismatch: boolean;
}

/** The model an unlinked vehicle's make/model text matches exactly (after normalising). */
export function suggestModelFor(
  vehicle: Pick<Vehicle, "make" | "model" | "modelId">,
  byKey: Map<string, VehicleModel>,
): VehicleModel | undefined {
  if (vehicle.modelId) return undefined;
  // A vehicle with no model text has nothing to match on; "Honda" alone is not a model.
  if (!(vehicle.model ?? "").trim()) return undefined;
  return byKey.get(normalizeModelKey(vehicle.make, vehicle.model));
}

/** Suggestions for every unlinked vehicle that matches an ACTIVE model. */
export function suggestLinks(vehicles: Vehicle[], models: VehicleModel[]): LinkSuggestion[] {
  const byKey = indexModelsByKey(models.filter((m) => m.isActive !== false));
  const out: LinkSuggestion[] = [];
  for (const v of vehicles) {
    if (v.isDeleted) continue;
    const model = suggestModelFor(v, byKey);
    if (!model) continue;
    out.push({
      vehicle: v,
      model,
      typeMismatch:
        !!v.vehicleType && normalizeTypeKey(v.vehicleType) !== normalizeTypeKey(model.vehicleType),
    });
  }
  return out;
}
