// The repair editor's form model: conversion to and from stored documents, and
// validation. Pure.
import type {
  RepairAppliesTo, RepairItem, RepairPartQtyOverride, RepairPriceOverride, RepairScope, RepairSuggestedPart,
} from "../../types/repairCatalog";
import { collapseSpaces } from "./keys.ts";
import { findDuplicateRepair } from "./catalog.ts";

export interface PriceOverrideForm { scope: RepairScope; scopeId: string; price: string }
export interface PartQtyOverrideForm { scope: RepairScope; scopeId: string; qty: string }
export interface SuggestedPartForm {
  inventoryItemId: string;
  /** Snapshot of the name, so the row reads right even if the item can't be loaded. */
  name: string;
  defaultQty: string;
  overrides: PartQtyOverrideForm[];
}

export interface RepairForm {
  name: string;
  description: string;
  category: string;
  unit: string;
  estimatedMinutes: string;
  defaultPrice: string;
  priceOverrides: PriceOverrideForm[];
  appliesTo: RepairAppliesTo;
  suggestedParts: SuggestedPartForm[];
  isActive: boolean;
}

export const REPAIR_UNITS = ["per service", "per item", "per hour", "per litre"] as const;

export function emptyAppliesTo(): RepairAppliesTo {
  return { all: true, types: [], groupIds: [], modelIds: [] };
}

export function emptyForm(category = ""): RepairForm {
  return {
    name: "", description: "", category, unit: "per service", estimatedMinutes: "", defaultPrice: "",
    priceOverrides: [], appliesTo: emptyAppliesTo(), suggestedParts: [], isActive: true,
  };
}

/** Fill the form from a stored repair. `partNames` maps inventory ids to names. */
export function formFromRepair(r: RepairItem, partNames: Map<string, string> = new Map()): RepairForm {
  return {
    name: r.name,
    description: r.description ?? "",
    category: r.category ?? "",
    unit: r.unit ?? "",
    estimatedMinutes: r.estimatedMinutes != null ? String(r.estimatedMinutes) : "",
    defaultPrice: String(r.defaultPrice ?? 0),
    priceOverrides: (r.priceOverrides ?? []).map((o) => ({ scope: o.scope, scopeId: o.scopeId, price: String(o.price) })),
    appliesTo: {
      all: !!r.appliesTo?.all,
      types: [...(r.appliesTo?.types ?? [])],
      groupIds: [...(r.appliesTo?.groupIds ?? [])],
      modelIds: [...(r.appliesTo?.modelIds ?? [])],
    },
    suggestedParts: (r.suggestedParts ?? []).map((p) => ({
      inventoryItemId: p.inventoryItemId,
      name: partNames.get(p.inventoryItemId) ?? "",
      defaultQty: String(p.defaultQty),
      overrides: (p.overrides ?? []).map((o) => ({ scope: o.scope, scopeId: o.scopeId, qty: String(o.qty) })),
    })),
    isActive: r.isActive !== false,
  };
}

const num = (s: string): number => (s.trim() === "" ? NaN : Number(s));

export interface FormIssues {
  /** Block saving. */
  errors: Record<string, string>;
  /** Shown, but saving is allowed. */
  warnings: string[];
}

export function validateForm(
  f: RepairForm,
  others: Pick<RepairItem, "id" | "name" | "category">[],
  editingId?: string,
): FormIssues {
  const errors: Record<string, string> = {};
  const warnings: string[] = [];

  if (!collapseSpaces(f.name)) errors.name = "Enter a name.";
  const price = num(f.defaultPrice);
  if (!Number.isFinite(price) || price < 0) errors.defaultPrice = "Enter a price of 0 or more.";
  if (f.estimatedMinutes.trim() !== "") {
    const m = num(f.estimatedMinutes);
    if (!Number.isFinite(m) || m <= 0 || !Number.isInteger(m)) errors.estimatedMinutes = "Whole minutes, more than 0.";
  }

  const a = f.appliesTo;
  if (!a.all && a.types.length + a.groupIds.length + a.modelIds.length === 0) {
    errors.appliesTo = "Choose “All vehicles”, or at least one type, group or model.";
  }

  const seen = new Set<string>();
  f.priceOverrides.forEach((o, i) => {
    const k = `${o.scope}:${o.scopeId.trim().toLowerCase()}`;
    const p = num(o.price);
    if (!o.scopeId.trim()) errors[`override.${i}`] = "Choose what this price is for.";
    else if (seen.has(k)) errors[`override.${i}`] = "There is already a price for this.";
    else if (!Number.isFinite(p) || p < 0) errors[`override.${i}`] = "Enter a price of 0 or more.";
    seen.add(k);
  });

  const partIds = new Set<string>();
  f.suggestedParts.forEach((p, i) => {
    const q = num(p.defaultQty);
    if (partIds.has(p.inventoryItemId)) errors[`part.${i}`] = "This part is listed twice.";
    else if (!Number.isFinite(q) || q <= 0) errors[`part.${i}`] = "Quantity must be more than 0.";
    partIds.add(p.inventoryItemId);
    const oseen = new Set<string>();
    p.overrides.forEach((o, j) => {
      const ok = `${o.scope}:${o.scopeId.trim().toLowerCase()}`;
      const oq = num(o.qty);
      if (!o.scopeId.trim()) errors[`part.${i}.${j}`] = "Choose what this quantity is for.";
      else if (oseen.has(ok)) errors[`part.${i}.${j}`] = "There is already a quantity for this.";
      else if (!Number.isFinite(oq) || oq <= 0) errors[`part.${i}.${j}`] = "Quantity must be more than 0.";
      oseen.add(ok);
    });
  });

  const dup = findDuplicateRepair(others, f.name, f.category, editingId);
  if (dup) warnings.push(`A repair named “${dup.name}” already exists${dup.category ? ` in ${dup.category}` : ""}.`);

  return { errors, warnings };
}

/** The stored fields for a (valid) form. */
export function toRepairData(f: RepairForm) {
  const category = collapseSpaces(f.category);
  const unit = f.unit.trim();
  const description = f.description.trim();
  const minutes = f.estimatedMinutes.trim() === "" ? undefined : Number(f.estimatedMinutes);
  return {
    name: collapseSpaces(f.name),
    description: description || undefined,
    category: category || undefined,
    unit: unit || undefined,
    estimatedMinutes: minutes,
    defaultPrice: Math.round(Number(f.defaultPrice) * 100) / 100,
    priceOverrides: f.priceOverrides.map((o): RepairPriceOverride => ({
      scope: o.scope, scopeId: o.scopeId.trim(), price: Math.round(Number(o.price) * 100) / 100,
    })),
    appliesTo: {
      all: f.appliesTo.all,
      types: f.appliesTo.all ? [] : f.appliesTo.types,
      groupIds: f.appliesTo.all ? [] : f.appliesTo.groupIds,
      modelIds: f.appliesTo.all ? [] : f.appliesTo.modelIds,
    } satisfies RepairAppliesTo,
    suggestedParts: f.suggestedParts.map((p): RepairSuggestedPart => ({
      inventoryItemId: p.inventoryItemId,
      defaultQty: Number(p.defaultQty),
      ...(p.overrides.length > 0
        ? {
            overrides: p.overrides.map((o): RepairPartQtyOverride => ({
              scope: o.scope, scopeId: o.scopeId.trim(), qty: Number(o.qty),
            })),
          }
        : {}),
    })),
    isActive: f.isActive,
  };
}
