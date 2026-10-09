import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { fetchCenter } from "../lib/refData";
import {
  fetchVehicleGroups, fetchVehicleModels, invalidateVehicleGroups, invalidateVehicleModels,
} from "../lib/repairCatalog/data";
import { DEFAULT_VEHICLE_TYPES, withoutHiddenTypes } from "../lib/vehicleOptions";
import type { VehicleGroup, VehicleModel } from "../types/repairCatalog";

interface Loaded { models: VehicleModel[]; groups: VehicleGroup[] }

export interface ModelsAndGroups {
  models: VehicleModel[];
  groups: VehicleGroup[];
  /** True once a fetch has settled (success or failure). */
  loaded: boolean;
  /** The last fetch failed: show a retry instead of an empty state. */
  error: boolean;
  retry: () => void;
  /**
   * Local updates after a write. The write itself already dropped the cache, so
   * the NEXT mount re-reads; updating state here avoids re-paying for the whole
   * collection after every edit.
   */
  setModels: Dispatch<SetStateAction<VehicleModel[]>>;
  setGroups: Dispatch<SetStateAction<VehicleGroup[]>>;
}

/**
 * The center's vehicle models and groups, loaded ONCE through the reference
 * cache (no listener). With `enabled` false nothing is read at all.
 */
export function useModelsAndGroups(centerId: string | undefined, enabled: boolean): ModelsAndGroups {
  const [data, setData] = useState<Loaded>({ models: [], groups: [] });
  const [settled, setSettled] = useState<"idle" | "ok" | "error">("idle");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!centerId || !enabled) return;
    let active = true;
    Promise.all([fetchVehicleModels(centerId), fetchVehicleGroups(centerId)])
      .then(([models, groups]) => {
        if (!active) return;
        setData({ models, groups });
        setSettled("ok");
      })
      .catch(() => { if (active) setSettled("error"); });
    return () => { active = false; };
  }, [centerId, enabled, tick]);

  const retry = useCallback(() => {
    if (centerId) { invalidateVehicleModels(centerId); invalidateVehicleGroups(centerId); }
    setSettled("idle");
    setTick((n) => n + 1);
  }, [centerId]);

  const setModels: Dispatch<SetStateAction<VehicleModel[]>> = useCallback(
    (u) => setData((d) => ({ ...d, models: typeof u === "function" ? u(d.models) : u })), []);
  const setGroups: Dispatch<SetStateAction<VehicleGroup[]>> = useCallback(
    (u) => setData((d) => ({ ...d, groups: typeof u === "function" ? u(d.groups) : u })), []);

  const live = !!centerId && enabled;
  return {
    models: live ? data.models : [],
    groups: live ? data.groups : [],
    loaded: live ? settled !== "idle" : false,
    error: live && settled === "error",
    retry, setModels, setGroups,
  };
}

/** The vehicle types this center offers (built-ins plus its own, minus hidden ones). */
export function useVehicleTypeOptions(centerId: string | undefined): string[] {
  const [types, setTypes] = useState<string[]>(DEFAULT_VEHICLE_TYPES);
  useEffect(() => {
    if (!centerId) return;
    let active = true;
    fetchCenter(centerId).then((c) => {
      if (!active || !c) return;
      const d = c as unknown as { customVehicleTypes?: string[]; hiddenVehicleTypes?: string[] };
      setTypes(withoutHiddenTypes([...DEFAULT_VEHICLE_TYPES, ...(d.customVehicleTypes ?? [])], d.hiddenVehicleTypes ?? []));
    }).catch(() => { /* keep the built-in list */ });
    return () => { active = false; };
  }, [centerId]);
  return types;
}
