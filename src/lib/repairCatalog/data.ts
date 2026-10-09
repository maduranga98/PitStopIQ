// Cached loaders for the Repair Catalog collections.
//
// Same rules as every other reference list (lib/refData.ts): one-time fetch
// through cachedFetch + boundedGetDocs, filtered and sorted on the device, no
// onSnapshot. The collections are small and bounded, and every write through
// firestoreWrite.ts invalidates them (they are registered in REF_COLLECTIONS).
// A center without the module never calls these.
import { collection } from "firebase/firestore";
import { db } from "../../config/firebase";
import { boundedGetDocs } from "../firestoreRead";
import { cachedFetch } from "../refCache";
import { invalidateRefData, refKey } from "../refData";
import type { VehicleGroup, VehicleModel } from "../../types/repairCatalog";
import { modelLabel, normalizeModelKey } from "./keys.ts";
import { sortGroups } from "./models.ts";

const TTL_MS = 10 * 60_000;

/** Every vehicle model (active and inactive), ordered by "make model". */
export function fetchVehicleModels(centerId: string): Promise<VehicleModel[]> {
  return cachedFetch(
    refKey(centerId, "vehicleModels"),
    async () => {
      const snap = await boundedGetDocs(collection(db, "servicecenters", centerId, "vehicleModels"));
      return snap.docs
        .map((d) => {
          const data = d.data() as Omit<VehicleModel, "id">;
          // A model written before `key` existed still deduplicates correctly.
          return { id: d.id, ...data, key: data.key || normalizeModelKey(data.make, data.model) } as VehicleModel;
        })
        .sort((a, b) => modelLabel(a).localeCompare(modelLabel(b)));
    },
    TTL_MS,
  );
}

/** Every vehicle group (active and inactive), in priority order. */
export function fetchVehicleGroups(centerId: string): Promise<VehicleGroup[]> {
  return cachedFetch(
    refKey(centerId, "vehicleGroups"),
    async () => {
      const snap = await boundedGetDocs(collection(db, "servicecenters", centerId, "vehicleGroups"));
      return sortGroups(
        snap.docs.map((d) => {
          const data = d.data() as Partial<VehicleGroup>;
          return {
            id: d.id,
            ...data,
            modelIds: data.modelIds ?? [],
            types: data.types ?? [],
            priority: data.priority ?? 0,
          } as VehicleGroup;
        }),
      );
    },
    TTL_MS,
  );
}

export const invalidateVehicleModels = (centerId: string) => invalidateRefData(centerId, "vehicleModels");
export const invalidateVehicleGroups = (centerId: string) => invalidateRefData(centerId, "vehicleGroups");
