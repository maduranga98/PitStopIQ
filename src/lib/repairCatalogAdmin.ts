// Super-admin switch for the Repair Catalog module.
//
// The flag and its audit trail are written in ONE batch (no transaction): the
// center doc carries the current state and who/when, and an append-only
// `adminActionLog` entry keeps the history. firestore.rules lets only a super
// admin write either (a center — Owner included — is rejected on both).
import { collection, doc, Timestamp } from "firebase/firestore";
import { db } from "../config/firebase";
import { safeWriteBatch } from "./firestoreWrite";
import { ADMIN_ACTION_LOG } from "../constants/repairCatalog";
import type { AdminActionLogEntry } from "../types/repairCatalog";

export interface RepairCatalogToggleInput {
  centerId: string;
  centerName: string;
  /** The flag's current value, as the admin sees it. */
  before: boolean;
  enable: boolean;
  admin: { id: string; displayName?: string; email?: string };
}

/** Fields written onto the center doc for a toggle. Exported for testing. */
export function toggleCenterFields(
  enable: boolean, admin: RepairCatalogToggleInput["admin"], at: Timestamp,
) {
  return {
    repairCatalogEnabled: enable,
    repairCatalogToggledAt: at,
    repairCatalogToggledBy: admin.id,
    repairCatalogToggledByName: admin.displayName || admin.email || admin.id,
  };
}

/** The adminActionLog entry for a toggle. Exported for testing. */
export function toggleLogEntry(
  input: RepairCatalogToggleInput, at: Timestamp,
): AdminActionLogEntry {
  return {
    action: input.enable ? "repairCatalog.enable" : "repairCatalog.disable",
    centerId: input.centerId,
    centerName: input.centerName,
    before: input.before,
    after: input.enable,
    performedBy: input.admin.id,
    performedByName: input.admin.displayName || input.admin.email || input.admin.id,
    createdAt: at,
  };
}

/** Turns the module on or off for one center. Turning it off keeps all data. */
export async function setRepairCatalogEnabled(input: RepairCatalogToggleInput): Promise<void> {
  const at = Timestamp.now();
  await safeWriteBatch(`repairCatalog ${input.enable ? "on" : "off"} ${input.centerId}`, (batch) => {
    batch.update(doc(db, "servicecenters", input.centerId), toggleCenterFields(input.enable, input.admin, at));
    batch.set(doc(collection(db, ADMIN_ACTION_LOG)), toggleLogEntry(input, at));
  });
}
