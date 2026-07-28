import {
  collection, doc, getDocs, limit, orderBy, query, where, Timestamp,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { safeUpdateDoc } from "./firestoreWrite";
import { logMovement } from "./inventoryMovements";
import type { StockCountLine } from "../types/auth";

/** Next stock-count number for a center, e.g. SC-2607-0004. */
export async function nextCountNumber(centerId: string): Promise<string> {
  const now = new Date();
  const prefix = `SC-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}-`;
  let seq = 1;
  try {
    const snap = await getDocs(query(
      collection(db, "servicecenters", centerId, "stockCounts"),
      where("countNumber", ">=", prefix),
      where("countNumber", "<=", prefix + "￿"),
      orderBy("countNumber", "desc"),
      limit(1),
    ));
    if (!snap.empty) {
      const last = snap.docs[0].data().countNumber as string;
      const parsed = parseInt(last.slice(prefix.length), 10);
      if (!isNaN(parsed)) seq = parsed + 1;
    }
  } catch {
    return `${prefix}${String(now.getTime()).slice(-5)}`;
  }
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

export interface StockCountActor {
  centerId: string;
  uid: string;
  userName: string;
}

/**
 * Finalize a draft stock count: write each line's counted quantity back to
 * inventory (only where it actually differs), log a movement per adjustment,
 * then mark the count finalized. Writes are per-item, not batched, so one
 * item deleted mid-count doesn't fail the whole finalization — the same
 * trade-off recordSupply makes.
 */
export async function finalizeStockCount({
  countId, lines, actor,
}: {
  countId: string;
  lines: StockCountLine[];
  actor: StockCountActor;
}): Promise<void> {
  const now = Timestamp.now();

  for (const line of lines) {
    if (line.variance === 0) continue;
    await safeUpdateDoc(doc(db, "servicecenters", actor.centerId, "inventory", line.itemId), {
      currentQty: line.countedQty,
      updatedAt: now,
    });
    logMovement({
      centerId: actor.centerId,
      itemId: line.itemId,
      itemName: line.itemName,
      unit: line.unit,
      type: "stock_count",
      qtyChange: line.variance,
      qtyBefore: line.systemQty,
      qtyAfter: line.countedQty,
      refId: countId,
      refLabel: line.note || "Physical stock count adjustment",
      performedBy: actor.uid,
      performedByName: actor.userName,
    }).catch(() => {});
  }

  await safeUpdateDoc(doc(db, "servicecenters", actor.centerId, "stockCounts", countId), {
    status: "finalized",
    finalizedAt: now,
    finalizedBy: actor.uid,
    finalizedByName: actor.userName,
  });
}
