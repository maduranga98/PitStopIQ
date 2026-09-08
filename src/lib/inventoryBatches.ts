import {
  collection, doc, getDocs, orderBy, query, Timestamp,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { safeSetDoc } from "./firestoreWrite";
import { purchasePriceOf } from "./inventoryPricing";
import { round2 } from "./distributors";
import type { InventoryBatch, InventoryItem } from "../types/auth";

// Batch (FIFO) costing, opt-in per item.
//
// An item on a single cost has no documents here and never touches this file —
// every entry point below is reached only once `costingMode === "fifo"`, which
// is set in one place: choosing "Track as a separate batch" while adding stock.
//
// Writes follow the same pattern as the rest of the app's stock handling
// (safeSetDoc / safeUpdateDoc, no transaction): the client is offline-first, a
// transaction cannot be queued while offline, and a restock that hangs until
// connectivity returns is worse than the race window every other stock write
// already accepts.

export function batchesRef(centerId: string, itemId: string) {
  return collection(db, "servicecenters", centerId, "inventory", itemId, "batches");
}

/**
 * Every batch of an item, oldest first — the order they are consumed in.
 *
 * Ordered by receivedAt alone and filtered in memory: pairing a `where` on
 * qtyRemaining with this orderBy would need a composite index, and a batch
 * list is a handful of documents.
 */
export async function loadBatches(
  centerId: string, itemId: string,
): Promise<InventoryBatch[]> {
  const snap = await getDocs(query(batchesRef(centerId, itemId), orderBy("receivedAt", "asc")));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryBatch));
}

/** Batches with stock left, oldest first. What a deduction draws down. */
export function openBatches(batches: InventoryBatch[]): InventoryBatch[] {
  return batches.filter(b => (b.qtyRemaining ?? 0) > 0);
}

/** Total stock across batches — what an item's currentQty should agree with. */
export function batchesTotalQty(batches: InventoryBatch[]): number {
  return round2(batches.reduce((sum, b) => sum + (b.qtyRemaining ?? 0), 0));
}

/**
 * The spread of costs still on the shelf, for display: the cheapest and dearest
 * unit cost among batches with stock left. Null when nothing is left.
 */
export function batchCostRange(
  batches: InventoryBatch[],
): { min: number; max: number } | null {
  const costs = openBatches(batches).map(b => b.unitCost ?? 0);
  if (costs.length === 0) return null;
  return { min: Math.min(...costs), max: Math.max(...costs) };
}

export interface NewBatchInput {
  centerId: string;
  itemId: string;
  qty: number;
  unitCost: number;
  receivedAt: Timestamp;
  addedBy: string;
  note?: string | null;
  isOpening?: boolean;
}

/** Write one batch document. Returns its id so the restock log can point at it. */
export async function createBatch(input: NewBatchInput): Promise<string> {
  const ref = doc(batchesRef(input.centerId, input.itemId));
  const qty = round2(Math.max(0, input.qty));
  await safeSetDoc(ref, {
    qtyOriginal: qty,
    qtyRemaining: qty,
    unitCost: input.unitCost,
    receivedAt: input.receivedAt,
    addedBy: input.addedBy,
    note: input.note?.trim() ? input.note.trim() : null,
    ...(input.isOpening ? { isOpening: true } : {}),
    createdAt: Timestamp.now(),
  });
  return ref.id;
}

/**
 * The stock an item already had, preserved as its first batch at the cost it
 * was already carrying, so switching an item to batch tracking never re-costs
 * or loses what is on the shelf.
 *
 * Dated with the item's own updatedAt (falling back to createdAt): that is the
 * closest thing on the document to "when this stock was last touched", and it
 * guarantees the opening batch sorts before the delivery arriving now.
 *
 * Returns null when there is nothing on hand — an item at zero has no history
 * worth a batch, and its first real batch is the delivery being added.
 */
export async function createOpeningBatch(
  centerId: string, item: InventoryItem, addedBy: string,
): Promise<string | null> {
  const onHand = round2(Math.max(0, item.currentQty ?? 0));
  if (onHand <= 0) return null;
  return createBatch({
    centerId,
    itemId: item.id,
    qty: onHand,
    unitCost: purchasePriceOf(item),
    receivedAt: item.updatedAt ?? item.createdAt ?? Timestamp.now(),
    addedBy,
    note: "Stock on hand when batch tracking was turned on",
    isOpening: true,
  });
}
