import {
  collection, doc, getDocs, limit, orderBy, query, runTransaction, where, Timestamp,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { logMovement } from "./inventoryMovements";
import type { InventoryItem, PosPaymentMethod, PosSaleLine } from "../types/auth";

export function round2(n: number): number {
  return parseFloat(n.toFixed(2));
}

/** Next outlet sale number for a center, e.g. POS-2607-0004. Same scheme as GRNs and invoices. */
export async function nextSaleNumber(centerId: string): Promise<string> {
  const now = new Date();
  const prefix = `POS-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}-`;
  let seq = 1;
  try {
    const snap = await getDocs(query(
      collection(db, "servicecenters", centerId, "posSales"),
      where("saleNumber", ">=", prefix),
      where("saleNumber", "<=", prefix + "￿"),
      orderBy("saleNumber", "desc"),
      limit(1),
    ));
    if (!snap.empty) {
      const last = snap.docs[0].data().saleNumber as string;
      const parsed = parseInt(last.slice(prefix.length), 10);
      if (!isNaN(parsed)) seq = parsed + 1;
    }
  } catch {
    return `${prefix}${String(now.getTime()).slice(-5)}`;
  }
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

export interface PosSaleActor {
  centerId: string;
  uid: string;
  userName: string;
}

export interface PosCartLine {
  item: InventoryItem;
  quantity: number;
  unitPrice: number;
}

/**
 * Ring up an outlet sale: deduct every line's stock and write the sale in one
 * transaction, so two terminals selling the last unit of something at the
 * same moment can't both succeed. The movement-ledger rows are best-effort
 * writes made right after the transaction commits.
 */
export async function recordPosSale({
  outletId, outletName, lines, discount, paymentMethod, amountTendered, actor,
}: {
  outletId: string;
  outletName: string;
  lines: PosCartLine[];
  discount: number;
  paymentMethod: PosPaymentMethod;
  amountTendered?: number;
  actor: PosSaleActor;
}): Promise<{ saleNumber: string; total: number }> {
  if (lines.length === 0) throw new Error("Cart is empty.");

  const now = Timestamp.now();
  const saleNumber = await nextSaleNumber(actor.centerId);
  const saleRef = doc(collection(db, "servicecenters", actor.centerId, "posSales"));

  const saleLines: PosSaleLine[] = lines.map(l => ({
    itemId: l.item.id,
    itemName: l.item.name,
    unit: l.item.unit,
    quantity: round2(l.quantity),
    unitPrice: round2(l.unitPrice),
    lineTotal: round2(l.quantity * l.unitPrice),
  }));
  const subtotal = round2(saleLines.reduce((sum, l) => sum + l.lineTotal, 0));
  const total = round2(Math.max(0, subtotal - discount));
  const changeDue = paymentMethod === "cash" && amountTendered != null
    ? round2(Math.max(0, amountTendered - total))
    : undefined;

  const qtyBeforeByItem = await runTransaction(db, async (tx) => {
    const before: Record<string, number> = {};
    const itemRefs = lines.map(l => doc(db, "servicecenters", actor.centerId, "inventory", l.item.id));
    const snaps = await Promise.all(itemRefs.map(ref => tx.get(ref)));

    snaps.forEach((snap, i) => {
      const line = lines[i];
      if (!snap.exists()) throw new Error(`${line.item.name} is no longer in inventory.`);
      const data = snap.data() as InventoryItem;
      if (data.currentQty < line.quantity) {
        throw new Error(`Only ${data.currentQty} ${data.unit} of ${data.name} left in stock.`);
      }
      before[line.item.id] = data.currentQty;
    });

    snaps.forEach((snap, i) => {
      const line = lines[i];
      const data = snap.data() as InventoryItem;
      tx.update(itemRefs[i], {
        currentQty: round2(data.currentQty - line.quantity),
        updatedAt: now,
      });
    });

    tx.set(saleRef, {
      saleNumber,
      outletId,
      outletName,
      items: saleLines,
      subtotal,
      discount: round2(discount),
      total,
      paymentMethod,
      ...(amountTendered != null ? { amountTendered: round2(amountTendered) } : {}),
      ...(changeDue != null ? { changeDue } : {}),
      status: "completed",
      soldBy: actor.uid,
      soldByName: actor.userName,
      centerId: actor.centerId,
      createdAt: now,
    });

    return before;
  });

  await Promise.all(lines.map(line => logMovement({
    centerId: actor.centerId,
    itemId: line.item.id,
    itemName: line.item.name,
    unit: line.item.unit,
    type: "pos_sale",
    qtyChange: -line.quantity,
    qtyBefore: qtyBeforeByItem[line.item.id],
    qtyAfter: round2(qtyBeforeByItem[line.item.id] - line.quantity),
    outletId,
    outletName,
    refId: saleRef.id,
    refLabel: saleNumber,
    performedBy: actor.uid,
    performedByName: actor.userName,
  }).catch(() => {})));

  return { saleNumber, total };
}
