// Writes made from the inventory screens: item compatibility, and the item <->
// repair link (stored on the REPAIR document only).
//
// Offline-first, no transactions. Compatibility is written as a whole, fixed
// value per item, and a part link is merged by item id, so repeating any of
// these after a dropped connection is harmless.
import { Timestamp, doc } from "firebase/firestore";
import { db } from "../../config/firebase";
import { safeUpdateDoc, safeWriteBatch } from "../firestoreWrite";
import { invalidateInventoryCache } from "../inventorySearch";
import { normalizeRepair } from "./data";
import { changedFieldNames, detectEditConflict } from "./catalog.ts";
import { fetchRepairFresh, type Actor } from "./repairWrites";
import { chunk, runChunked, type BulkProgress, type BulkResult } from "./bulk.ts";
import type { InventoryCompatibility, RepairItem, RepairSuggestedPart } from "../../types/repairCatalog";

/**
 * Compare the copy of a repair this screen is working from with the stored one
 * (the Phase 4 guard: `updatedAt` equality). Offline this reads the device's
 * cache, so a conflict can't be seen: best effort, as in the repair editor.
 */
export type LinkCheck =
  | { conflict: false; fresh: RepairItem }
  | { conflict: true; fresh: RepairItem; fields: string[] }
  | { conflict: "gone" };

export async function checkRepairForLink(centerId: string, base: RepairItem): Promise<LinkCheck> {
  const fresh = await fetchRepairFresh(centerId, base.id);
  if (!fresh) return { conflict: "gone" };
  if (detectEditConflict(base.updatedAt, fresh.updatedAt)) {
    return { conflict: true, fresh, fields: changedFieldNames(base, fresh) };
  }
  return { conflict: false, fresh };
}

/**
 * Replace ONE repair's suggestedParts (plus the usual edit stamp). Nothing else
 * on the repair is written. Returns the repair as it now reads, to keep the
 * cached copy in step without another read.
 */
export async function saveSuggestedParts(
  centerId: string, repair: RepairItem, nextParts: RepairSuggestedPart[], actor: Actor,
): Promise<RepairItem> {
  const now = Timestamp.now();
  await safeUpdateDoc(doc(db, "servicecenters", centerId, "repairCatalog", repair.id), {
    suggestedParts: nextParts, updatedAt: now, updatedBy: actor.uid, updatedByName: actor.name,
  });
  return normalizeRepair(repair.id, {
    ...repair, suggestedParts: nextParts, updatedAt: now, updatedBy: actor.uid, updatedByName: actor.name,
  });
}

/**
 * Set the same compatibility on many items, a chunk per batch. A batch spans
 * many documents, so the inventory cache is dropped here by hand.
 */
export async function setCompatibilityBulk(
  centerId: string,
  itemIds: string[],
  compatibility: InventoryCompatibility,
  opts: { startAt?: number; onProgress?: (p: BulkProgress) => void } = {},
): Promise<BulkResult> {
  const now = Timestamp.now();
  try {
    return await runChunked(chunk(itemIds), async (ids) => {
      await safeWriteBatch(`item compatibility (${ids.length} items)`, (batch) => {
        for (const id of ids) {
          batch.update(doc(db, "servicecenters", centerId, "inventory", id), { compatibility, updatedAt: now });
        }
      });
    }, opts);
  } finally {
    invalidateInventoryCache(centerId);
  }
}
