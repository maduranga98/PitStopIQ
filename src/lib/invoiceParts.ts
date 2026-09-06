import { doc, getDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../config/firebase";
import { safeUpdateDoc } from "./firestoreWrite";
import { logMovement } from "./inventoryMovements";
import { purchasePriceOf, serviceCenterPriceOf } from "./inventoryPricing";
import type { InventoryItem, InvoiceLineItem } from "../types/auth";

// A part billed straight onto an invoice — a counter sale of a filter, a bulb
// fitted while the customer waited — never passes through a job card, so
// nothing else will take it off the shelf. These helpers are what the invoice
// screens use to turn an inventory item into a line and to move the stock.

/** The line an inventory item becomes on an invoice. */
export function partLineFromItem(item: InventoryItem, qty: number): InvoiceLineItem {
  const unitPrice = serviceCenterPriceOf(item);
  return {
    description: item.name,
    qty,
    unitPrice,
    lineTotal: Math.round(qty * unitPrice * 100) / 100,
    type: "part",
    itemId: item.id,
    ...(item.partNumber ? { partNumber: item.partNumber } : {}),
    // Snapshotted now so margin reporting stays accurate even if the item's
    // purchase price changes later.
    costPrice: purchasePriceOf(item),
  };
}

/**
 * Take the billed parts off the shelf, one item at a time, and record why they
 * moved. Mirrors the job card's deduction on completion.
 *
 * Best-effort per item, exactly like every other movement in the app: the
 * invoice is already written by the time this runs, so a failed stock write is
 * reported rather than rolling the bill back. The returned list names the items
 * that could not be moved, so the caller can say so.
 */
export async function deductInvoiceParts(
  centerId: string,
  lines: InvoiceLineItem[],
  ref: { id: string; label: string },
  actor: { uid: string; name: string },
): Promise<string[]> {
  const failed: string[] = [];
  for (const line of lines) {
    if (line.type !== "part" || !line.itemId || line.qty <= 0) continue;
    try {
      const itemRef = doc(db, "servicecenters", centerId, "inventory", line.itemId);
      const snap = await getDoc(itemRef);
      if (!snap.exists()) continue;
      const item = snap.data() as InventoryItem;
      const before = item.currentQty ?? 0;
      const after = Math.max(0, before - line.qty);
      await safeUpdateDoc(itemRef, { currentQty: after, updatedAt: serverTimestamp() });
      void logMovement({
        centerId,
        itemId: line.itemId,
        itemName: line.description,
        unit: item.unit,
        type: "deduction",
        qtyChange: after - before,
        qtyBefore: before,
        qtyAfter: after,
        refId: ref.id,
        refLabel: ref.label,
        unitPrice: line.unitPrice,
        performedBy: actor.uid,
        performedByName: actor.name,
      }).catch(() => {});
    } catch {
      failed.push(line.description);
    }
  }
  return failed;
}
