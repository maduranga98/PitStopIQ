// Constants for the optional Repair Catalog module.

/** Center-doc field the center switches in Settings → Services & Modules. */
export const REPAIR_CATALOG_FLAG = "repairCatalogEnabled";

/** Center sub-collections owned by the module. */
export const REPAIR_COLLECTIONS = {
  models: "vehicleModels",
  groups: "vehicleGroups",
  repairs: "repairCatalog",
} as const;

/** Suggested starting categories; the owner's own list lives on `ServiceCenter.repairCategories`. */
export const DEFAULT_REPAIR_CATEGORIES = [
  "Engine", "Brakes", "Tyres", "Suspension", "Electrical", "Body", "AC", "General", "Other",
] as const;

/** Permission keys, for guards that take a dot-path. */
export const REPAIR_PERMISSION_KEYS = {
  view: "repairCatalog.view",
  create: "repairCatalog.create",
  edit: "repairCatalog.edit",
  delete: "repairCatalog.delete",
  manageModels: "repairCatalog.manageModels",
} as const;
