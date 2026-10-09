import { useCallback, useMemo, useState } from "react";
import { useModelsAndGroups, useVehicleTypeOptions } from "./useRepairModels";
import { useRepairCatalog, type RepairCatalogData } from "./useRepairCatalog";
import {
  NO_TOOL_FILTER, applyToolFilter, isToolFilterActive,
  type CompatContext, type CompatItem, type InventoryToolFilter,
} from "../lib/repairCatalog/compatibility.ts";
import type { ModelsAndGroups } from "./useRepairModels";

export interface InventoryRepairTools {
  enabled: boolean;
  filter: InventoryToolFilter;
  filterActive: boolean;
  setFilter: (f: InventoryToolFilter) => void;
  /** Filter a list on the device; the list itself is returned untouched when no tool filter is on. */
  apply: <T extends CompatItem>(list: T[]) => T[];
  context: CompatContext;
  mg: ModelsAndGroups;
  typeOptions: string[];
  catalog: RepairCatalogData;
  selected: ReadonlySet<string>;
  toggle: (id: string) => void;
  selectMany: (ids: string[]) => void;
  clearSelection: () => void;
}

/**
 * State for the inventory list's Repair Catalog tools: three extra filters and
 * a selection for bulk actions. With `enabled` false nothing is read and
 * `apply` is the identity, so the list behaves exactly as before.
 *
 * Everything is filtered on the device from the list the page already holds
 * and from the cached catalogs; no listener and no query of its own.
 */
export function useInventoryRepairTools(
  centerId: string | undefined, enabled: boolean, canLink: boolean, onFilterChange: () => void,
): InventoryRepairTools {
  const mg = useModelsAndGroups(centerId, enabled);
  const typeOptions = useVehicleTypeOptions(enabled ? centerId : undefined);
  // The repair catalog is only needed for the "Link to a repair" action.
  const catalog = useRepairCatalog(centerId, enabled && canLink);
  const [filter, setFilterState] = useState<InventoryToolFilter>(NO_TOOL_FILTER);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const context = useMemo<CompatContext>(() => ({ models: mg.models, groups: mg.groups }), [mg.models, mg.groups]);
  const live = enabled ? filter : NO_TOOL_FILTER;

  const setFilter = useCallback((f: InventoryToolFilter) => { setFilterState(f); onFilterChange(); }, [onFilterChange]);
  const apply = useCallback(<T extends CompatItem>(list: T[]) => applyToolFilter(list, live, context), [live, context]);
  const toggle = useCallback((id: string) => setSelected((s) => {
    const n = new Set(s);
    if (!n.delete(id)) n.add(id);
    return n;
  }), []);
  const selectMany = useCallback((ids: string[]) => setSelected(new Set(ids)), []);
  const clearSelection = useCallback(() => setSelected(new Set()), []);

  return {
    enabled, filter: live, filterActive: isToolFilterActive(live), setFilter, apply, context, mg, typeOptions, catalog,
    selected, toggle, selectMany, clearSelection,
  };
}
