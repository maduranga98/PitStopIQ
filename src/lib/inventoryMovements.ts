import { addDoc, collection, Timestamp } from "firebase/firestore";
import { db } from "../config/firebase";
import { invalidateInventoryCache } from "./inventorySearch";
import type { InventoryMovementType } from "../types/auth";

// One row per stock-changing event, from every source. Callers write the
// stock change itself first (it's the thing that matters), then log the
// movement here — best-effort, so a dropped write to the audit trail never
// blocks or rolls back a restock/issue/deduction/sale that already committed.

export interface LogMovementInput {
  centerId: string;
  itemId: string;
  itemName: string;
  unit: string;
  type: InventoryMovementType;
  /** Positive = stock added, negative = stock removed. */
  qtyChange: number;
  qtyBefore: number;
  qtyAfter: number;
  outletId?: string;
  outletName?: string;
  /** id of the source doc (posSale, inventoryRequest, supplierSupply, stockCount…) */
  refId?: string;
  refLabel?: string;
  /** Cost per unit for the stock that moved, where the caller knows it. */
  unitPrice?: number;
  performedBy: string;
  performedByName: string;
  note?: string;
}

export async function logMovement(input: LogMovementInput): Promise<void> {
  const { centerId, ...rest } = input;
  // Every stock change in the app funnels through here, which makes this the
  // one place guaranteed to know the cached parts catalog is now stale. Drop it
  // so the next picker search sees the new quantities instead of serving the
  // pre-movement snapshot for the rest of the TTL.
  invalidateInventoryCache(centerId);
  await addDoc(collection(db, "servicecenters", centerId, "inventoryMovements"), {
    ...rest,
    centerId,
    createdAt: Timestamp.now(),
  });
}
