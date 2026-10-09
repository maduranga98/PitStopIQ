// Writes for the repair catalog and its category list.
//
// Offline-first, no transactions: safeSetDoc / safeUpdateDoc / safeWriteBatch.
// Every repair write stamps `updatedAt` (+ who), which the editor compares to
// warn before overwriting a newer edit (see detectEditConflict).
import { Timestamp, collection, deleteField, doc } from "firebase/firestore";
import { db } from "../../config/firebase";
import { boundedGetDoc } from "../firestoreRead";
import { safeSetDoc, safeUpdateDoc, safeWriteBatch } from "../firestoreWrite";
import { invalidate } from "../refCache";
import { centerKey } from "../refData";
import { invalidateRepairCatalog, normalizeRepair } from "./data";
import { copyName } from "./catalog.ts";
import { toRepairData, type RepairForm } from "./form.ts";
import type { RepairItem } from "../../types/repairCatalog";

export interface Actor { uid: string; name: string }

const repairsCol = (centerId: string) => collection(db, "servicecenters", centerId, "repairCatalog");
type RepairData = ReturnType<typeof toRepairData>;

/** Drop undefined for a create; turn it into deleteField() for an update. */
function forCreate(d: RepairData): Record<string, unknown> {
  return Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined));
}
function forUpdate(d: RepairData): Record<string, unknown> {
  return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v === undefined ? deleteField() : v]));
}

export async function createRepair(centerId: string, form: RepairForm, actor: Actor): Promise<RepairItem> {
  const ref = doc(repairsCol(centerId));
  const now = Timestamp.now();
  const data = toRepairData(form);
  await safeSetDoc(ref, {
    ...forCreate(data), centerId, createdAt: now, updatedAt: now, updatedBy: actor.uid, updatedByName: actor.name,
  });
  return normalizeRepair(ref.id, {
    ...data, centerId, createdAt: now, updatedAt: now, updatedBy: actor.uid, updatedByName: actor.name,
  } as Partial<RepairItem>);
}

export async function updateRepair(
  centerId: string, existing: RepairItem, form: RepairForm, actor: Actor,
): Promise<RepairItem> {
  const now = Timestamp.now();
  const data = toRepairData(form);
  await safeUpdateDoc(doc(repairsCol(centerId), existing.id), {
    ...forUpdate(data), updatedAt: now, updatedBy: actor.uid, updatedByName: actor.name,
  });
  return normalizeRepair(existing.id, {
    ...existing, ...data, updatedAt: now, updatedBy: actor.uid, updatedByName: actor.name,
  } as Partial<RepairItem>);
}

/** Repairs are switched off, never deleted: old jobs and invoices point at them. */
export async function setRepairActive(centerId: string, existing: RepairItem, isActive: boolean, actor: Actor): Promise<RepairItem> {
  const now = Timestamp.now();
  await safeUpdateDoc(doc(repairsCol(centerId), existing.id), {
    isActive, updatedAt: now, updatedBy: actor.uid, updatedByName: actor.name,
  });
  return { ...existing, isActive, updatedAt: now, updatedBy: actor.uid, updatedByName: actor.name };
}

/** A copy of a repair, named "… (copy)", switched on, with the same prices, rules and parts. */
export async function duplicateRepair(
  centerId: string, source: RepairItem, all: RepairItem[], actor: Actor,
): Promise<RepairItem> {
  const ref = doc(repairsCol(centerId));
  const now = Timestamp.now();
  const copy = normalizeRepair(ref.id, {
    ...source,
    name: copyName(all, source.name, source.category),
    isActive: true,
    createdAt: now, updatedAt: now, updatedBy: actor.uid, updatedByName: actor.name,
  });
  const { id: _id, ...stored } = copy;
  void _id;
  await safeSetDoc(ref, Object.fromEntries(Object.entries(stored).filter(([, v]) => v !== undefined)));
  return copy;
}

/**
 * The repair as it is stored right now (server, or this device's cache when
 * offline), for the pre-save conflict check. null: it no longer exists.
 */
export async function fetchRepairFresh(centerId: string, id: string): Promise<RepairItem | null> {
  const snap = await boundedGetDoc(doc(repairsCol(centerId), id));
  return snap.exists() ? normalizeRepair(snap.id, snap.data() as Partial<RepairItem>) : null;
}

/** Persist the owner's category list on the center document. */
export async function saveCategories(centerId: string, list: string[]): Promise<void> {
  await safeUpdateDoc(doc(db, "servicecenters", centerId), { repairCategories: list });
}

const BATCH_LIMIT = 400;

/**
 * Rename a category: the list on the center doc and every repair filed under
 * the old name, in as few batches as the 500-write limit allows. A batch does
 * not invalidate the cache by itself, so it is done here.
 */
export async function renameCategoryEverywhere(
  centerId: string, newList: string[], repairIds: string[], newName: string, actor: Actor,
): Promise<void> {
  const now = Timestamp.now();
  const chunks: string[][] = [];
  for (let i = 0; i < repairIds.length; i += BATCH_LIMIT) chunks.push(repairIds.slice(i, i + BATCH_LIMIT));
  if (chunks.length === 0) chunks.push([]);
  for (let i = 0; i < chunks.length; i++) {
    await safeWriteBatch(`repairCatalog category rename ${centerId}`, (batch) => {
      if (i === 0) batch.update(doc(db, "servicecenters", centerId), { repairCategories: newList });
      for (const id of chunks[i]) {
        batch.update(doc(repairsCol(centerId), id), {
          category: newName, updatedAt: now, updatedBy: actor.uid, updatedByName: actor.name,
        });
      }
    });
  }
  invalidateRepairCatalog(centerId);
  invalidate(centerKey(centerId));
}
