import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { fetchCenter, fetchInventory } from "../lib/refData";
import { fetchRepairCatalog, invalidateRepairCatalog } from "../lib/repairCatalog/data";
import type { InventoryItem } from "../types/auth";
import type { RepairItem } from "../types/repairCatalog";

export interface RepairCatalogData {
  repairs: RepairItem[];
  /** Owner-defined list on the center doc, or undefined when never set. */
  storedCategories: string[] | undefined;
  loaded: boolean;
  error: boolean;
  retry: () => void;
  setRepairs: Dispatch<SetStateAction<RepairItem[]>>;
  setStoredCategories: Dispatch<SetStateAction<string[] | undefined>>;
}

/**
 * The repair catalog and the center's category list, loaded ONCE through the
 * reference cache (no listener). With `enabled` false nothing is read.
 */
export function useRepairCatalog(centerId: string | undefined, enabled: boolean): RepairCatalogData {
  const [repairs, setRepairs] = useState<RepairItem[]>([]);
  const [storedCategories, setStoredCategories] = useState<string[] | undefined>(undefined);
  const [settled, setSettled] = useState<"idle" | "ok" | "error">("idle");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!centerId || !enabled) return;
    let active = true;
    Promise.all([fetchRepairCatalog(centerId), fetchCenter(centerId)])
      .then(([list, center]) => {
        if (!active) return;
        setRepairs(list);
        setStoredCategories((center as unknown as { repairCategories?: string[] } | null)?.repairCategories);
        setSettled("ok");
      })
      .catch(() => { if (active) setSettled("error"); });
    return () => { active = false; };
  }, [centerId, enabled, tick]);

  const retry = useCallback(() => {
    if (centerId) invalidateRepairCatalog(centerId);
    setSettled("idle");
    setTick((n) => n + 1);
  }, [centerId]);

  const live = !!centerId && enabled;
  return {
    repairs: live ? repairs : [],
    storedCategories: live ? storedCategories : undefined,
    loaded: live ? settled !== "idle" : false,
    error: live && settled === "error",
    retry, setRepairs, setStoredCategories,
  };
}

/**
 * The (non-archived) inventory catalog for the suggested-parts picker, from the
 * shared inventory cache: no listener, and no read at all unless `enabled`
 * (false for roles that cannot read inventory).
 */
export function useInventoryForParts(centerId: string | undefined, enabled: boolean): { items: InventoryItem[]; loaded: boolean } {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!centerId || !enabled) return;
    let active = true;
    fetchInventory(centerId)
      .then((list) => { if (active) { setItems(list.filter((i) => !i.isArchived)); setLoaded(true); } })
      .catch(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [centerId, enabled]);
  return { items: centerId && enabled ? items : [], loaded: centerId && enabled ? loaded : false };
}
