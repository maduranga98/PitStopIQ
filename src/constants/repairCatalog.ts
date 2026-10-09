// Constants for the optional Repair Catalog module.

/** Center-doc field the super admin toggles. Never writable by a center. */
export const REPAIR_CATALOG_FLAG = "repairCatalogEnabled";

/** Center-doc audit fields written alongside the flag. */
export const REPAIR_CATALOG_AUDIT_FIELDS = [
  "repairCatalogToggledAt",
  "repairCatalogToggledBy",
  "repairCatalogToggledByName",
] as const;

/** Top-level collection holding super-admin actions. Append-only. */
export const ADMIN_ACTION_LOG = "adminActionLog";

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
