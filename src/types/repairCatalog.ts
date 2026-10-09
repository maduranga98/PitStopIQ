// Repair Catalog data model (see docs/repair-catalog-phase-0.md).
//
// Everything here is optional and additive. A center without
// `ServiceCenter.repairCatalogEnabled` never reads or writes any of it, and
// every existing document keeps its shape.
import type { Timestamp } from "firebase/firestore";

/** The three levels a price, a quantity or an applicability rule can be scoped to. */
export type RepairScope = "type" | "group" | "model";

/** Where a resolved price (or quantity) came from — shown on the job screen. */
export type RepairResolvedFrom = RepairScope | "default";

/**
 * servicecenters/{centerId}/vehicleModels/{id}
 *
 * The finer classification under a vehicle type: "Honda Dio", "Bajaj Pulsar 150".
 * `vehicleType` is the center's own type string (case-insensitive match).
 */
export interface VehicleModel {
  id: string;
  make: string;
  model: string;
  vehicleType: string;
  notes?: string;
  isActive: boolean;
  centerId: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

/**
 * servicecenters/{centerId}/vehicleGroups/{id}
 *
 * An owner-defined bundle ("Scooters", "150cc+ sports bikes"). Membership lives
 * here, not on the model, so changing a group never rewrites model documents.
 */
export interface VehicleGroup {
  id: string;
  name: string;
  modelIds: string[];
  /** Whole vehicle types the group also covers. */
  types: string[];
  /**
   * Tie-break when a model sits in several groups that each carry an override:
   * the LOWER number wins. Never "lowest price".
   */
  priority: number;
  notes?: string;
  isActive: boolean;
  centerId: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export interface RepairAppliesTo {
  /** True: offered for every vehicle. */
  all: boolean;
  types: string[];
  groupIds: string[];
  modelIds: string[];
}

export interface RepairPriceOverride {
  scope: RepairScope;
  /** Type string, group id or model id, depending on `scope`. */
  scopeId: string;
  price: number;
}

export interface RepairPartQtyOverride {
  scope: RepairScope;
  scopeId: string;
  qty: number;
}

export interface RepairSuggestedPart {
  inventoryItemId: string;
  defaultQty: number;
  overrides?: RepairPartQtyOverride[];
}

/**
 * servicecenters/{centerId}/repairCatalog/{id}
 *
 * The item-to-part link is stored HERE only (`suggestedParts`); an inventory
 * item's "used for repairs" view is derived from the catalog on the device.
 */
export interface RepairItem {
  id: string;
  name: string;
  description?: string;
  /** From the center's own `repairCategories` list. */
  category?: string;
  unit?: string;
  estimatedMinutes?: number;
  defaultPrice: number;
  priceOverrides: RepairPriceOverride[];
  appliesTo: RepairAppliesTo;
  suggestedParts: RepairSuggestedPart[];
  isActive: boolean;
  centerId: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

/**
 * One entry of `ServiceJob.repairsPerformed`. The price is frozen when the
 * repair is picked (and may be overridden by the user); the invoice reads this
 * snapshot, it never re-resolves.
 */
export interface RepairPerformed {
  repairItemId: string;
  name: string;
  price: number;
  /** True for a free-text repair typed on the job, not picked from the catalog. */
  custom: boolean;
  resolvedFrom: RepairResolvedFrom;
  /** Display grouping only. Never read by stock deduction. */
  partItemIds?: string[];
}

/** Inventory item compatibility. Absent means universal. */
export interface InventoryCompatibility {
  universal: boolean;
  types: string[];
  groupIds: string[];
  modelIds: string[];
}

/** One append-only entry in the top-level `adminActionLog` collection. */
export interface AdminActionLogEntry {
  action: "repairCatalog.enable" | "repairCatalog.disable";
  centerId: string;
  centerName: string;
  before: boolean;
  after: boolean;
  performedBy: string;
  performedByName: string;
  createdAt: Timestamp;
}
