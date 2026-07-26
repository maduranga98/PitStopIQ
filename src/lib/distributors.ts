import {
  collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp,
  setDoc, updateDoc, where, Timestamp, arrayUnion,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { safeSetDoc, safeUpdateDoc } from "./firestoreWrite";
import { SHORTLINK_HOST } from "./shortLinks";
import type {
  Distributor, DistributorOrder, DistributorOrderItem, DistributorPayment,
  DistributorPaymentMethod, DistributorPaymentStatus, InventoryItem,
} from "../types/auth";

// ── Share links ──────────────────────────────────────────────────────────────
// A distributor has no login. The owner shares a link carrying the center id,
// the distributor id and a secret token; the portal refuses to open unless the
// token matches the one stored on the distributor. Regenerating the token is
// how a lost or leaked link gets revoked.

const TOKEN_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const TOKEN_LENGTH = 24;
const SHORT_CODE_LENGTH = 7;

function randomString(length: number): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  return out;
}

export function generateAccessToken(): string {
  return randomString(TOKEN_LENGTH);
}

export function distributorPortalPath(centerId: string, distributorId: string, token: string): string {
  return `/d/${centerId}/${distributorId}/${token}`;
}

export function distributorPortalUrl(centerId: string, distributorId: string, token: string): string {
  return `https://${SHORTLINK_HOST}${distributorPortalPath(centerId, distributorId, token)}`;
}

export function shortPortalUrl(code: string): string {
  return `https://${SHORTLINK_HOST}/v/${code}`;
}

/**
 * Mint a `links/{code}` mapping so the owner can share a short URL instead of
 * the full token-bearing one. Link documents are immutable, so a regenerated
 * token always gets a fresh code — the old one keeps pointing at the dead
 * token and simply stops working, which is exactly what revoking should do.
 * Returns null when the mapping can't be written; callers fall back to the
 * long link.
 */
export async function mintDistributorShortLink(
  centerId: string,
  distributorId: string,
  token: string,
): Promise<string | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomString(SHORT_CODE_LENGTH);
    try {
      const linkRef = doc(db, "links", code);
      const existing = await getDoc(linkRef);
      if (existing.exists()) continue; // astronomically unlikely — retry
      await setDoc(linkRef, {
        type: "distributor",
        centerId,
        distributorId,
        token,
        createdAt: serverTimestamp(),
      });
      return code;
    } catch {
      return null;
    }
  }
  return null;
}

// ── Order numbering ──────────────────────────────────────────────────────────

/**
 * Next purchase-order number for a center, e.g. PO-2607-0004. Mirrors how
 * invoice numbers are derived: read the highest existing number under this
 * month's prefix and add one.
 */
export async function nextOrderNumber(centerId: string): Promise<string> {
  const now = new Date();
  const prefix = `PO-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}-`;
  let seq = 1;
  try {
    const snap = await getDocs(query(
      collection(db, "servicecenters", centerId, "distributorOrders"),
      where("orderNumber", ">=", prefix),
      where("orderNumber", "<=", prefix + "￿"),
      orderBy("orderNumber", "desc"),
      limit(1),
    ));
    if (!snap.empty) {
      const last = snap.docs[0].data().orderNumber as string;
      const parsed = parseInt(last.slice(prefix.length), 10);
      if (!isNaN(parsed)) seq = parsed + 1;
    }
  } catch {
    // Index missing or offline — fall back to a timestamp suffix rather than
    // risking a duplicate number.
    return `${prefix}${String(now.getTime()).slice(-5)}`;
  }
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

// ── Pricing ──────────────────────────────────────────────────────────────────

/** What a distributor pays for an item — its own price, or the unit cost. */
export function distributorUnitPrice(item: Pick<InventoryItem, "distributorPrice" | "unitCost">): number {
  return item.distributorPrice ?? item.unitCost ?? 0;
}

export function round2(n: number): number {
  return parseFloat(n.toFixed(2));
}

export function orderTotal(items: DistributorOrderItem[]): number {
  return round2(items.reduce((sum, i) => sum + i.lineTotal, 0));
}

/** Lines the owner is actually releasing — zero-quantity lines are dropped. */
export function releasableItems(items: DistributorOrderItem[]): DistributorOrderItem[] {
  return items.filter(i => i.approvedQty > 0);
}

// ── Payments ─────────────────────────────────────────────────────────────────

export interface PaymentSummary {
  cash: number;
  cheque: number;
  credit: number;
  /** Money actually in: cash + cheques. Credit is owed, not received. */
  received: number;
  balanceDue: number;
  status: DistributorPaymentStatus;
}

export function summarisePayments(
  payments: DistributorPayment[] | undefined,
  orderTotalValue: number,
): PaymentSummary {
  const list = payments ?? [];
  const by = (method: DistributorPaymentMethod) =>
    round2(list.filter(p => p.method === method).reduce((sum, p) => sum + (p.amount || 0), 0));

  const cash = by("cash");
  const cheque = by("cheque");
  const credit = by("credit");
  const received = round2(cash + cheque);
  // Overpayments shouldn't read as a negative balance.
  const balanceDue = round2(Math.max(0, orderTotalValue - received));

  let status: DistributorPaymentStatus = "unpaid";
  if (balanceDue <= 0 && orderTotalValue > 0) status = "paid";
  else if (received > 0) status = "partial";

  return { cash, cheque, credit, received, balanceDue, status };
}

/** The stored aggregate fields that shadow the payments array. */
export function paymentFields(payments: DistributorPayment[], orderTotalValue: number) {
  const s = summarisePayments(payments, orderTotalValue);
  return {
    payments,
    receivedTotal: s.received,
    creditTotal: s.credit,
    balanceDue: s.balanceDue,
    paymentStatus: s.status,
  };
}

export function newPaymentId(): string {
  return randomString(12);
}

/**
 * Append a payment to an order. The whole array is rewritten (rather than
 * arrayUnion'd) so the denormalised totals can be recomputed in the same write
 * and never drift from the entries they summarise.
 */
export async function recordPayment(
  centerId: string,
  order: DistributorOrder,
  payment: DistributorPayment,
): Promise<void> {
  const payments = [...(order.payments ?? []), payment];
  await safeUpdateDoc(
    doc(db, "servicecenters", centerId, "distributorOrders", order.id),
    { ...paymentFields(payments, order.total), updatedAt: Timestamp.now() },
  );
}

/** Remove a mis-keyed entry and re-derive the totals. */
export async function removePayment(
  centerId: string,
  order: DistributorOrder,
  paymentId: string,
): Promise<void> {
  const payments = (order.payments ?? []).filter(p => p.id !== paymentId);
  await safeUpdateDoc(
    doc(db, "servicecenters", centerId, "distributorOrders", order.id),
    { ...paymentFields(payments, order.total), updatedAt: Timestamp.now() },
  );
}

// ── Stock release ────────────────────────────────────────────────────────────

export interface ReleaseActor {
  centerId: string;
  userName: string;
  uid: string;
}

/**
 * Check every approved line against live stock before anything is written, so a
 * finalize either releases the whole order or nothing at all. Returns the
 * blocking message, or null when the order can be released.
 */
export function checkStock(
  items: DistributorOrderItem[],
  stock: Map<string, InventoryItem>,
): string | null {
  for (const line of releasableItems(items)) {
    const item = stock.get(line.itemId);
    if (!item) return `${line.itemName} is no longer in inventory — remove the line or reject the order.`;
    if (item.currentQty < line.approvedQty) {
      return `Only ${item.currentQty} ${item.unit} of ${item.name} in stock — restock or lower the quantity.`;
    }
  }
  return null;
}

/**
 * Hand the approved lines of an order to the distributor: deduct each item's
 * quantity, record the movement on the item's releaseLog, and mark the order
 * finalized. Callers must have run checkStock first.
 */
export async function releaseOrder(
  order: DistributorOrder,
  stock: Map<string, InventoryItem>,
  actor: ReleaseActor,
  reviewNote?: string,
): Promise<void> {
  const lines = releasableItems(order.items);
  const now = Timestamp.now();

  for (const line of lines) {
    const item = stock.get(line.itemId);
    if (!item) continue;
    await safeUpdateDoc(doc(db, "servicecenters", actor.centerId, "inventory", item.id), {
      currentQty: round2(item.currentQty - line.approvedQty),
      releaseLog: arrayUnion({
        distributorId: order.distributorId,
        distributorName: order.distributorName,
        releasedQty: line.approvedQty,
        releasedBy: actor.userName,
        orderId: order.id,
        orderNumber: order.orderNumber,
        unitPrice: line.unitPrice,
        timestamp: now,
      }),
      updatedAt: now,
    });
  }

  // Trimming quantities changes what's owed, so the payment aggregate is
  // re-derived against the finalized total in the same write.
  const finalTotal = orderTotal(lines);
  await safeUpdateDoc(doc(db, "servicecenters", actor.centerId, "distributorOrders", order.id), {
    status: "finalized",
    items: order.items,
    total: finalTotal,
    ...paymentFields(order.payments ?? [], finalTotal),
    reviewNote: reviewNote?.trim() || null,
    reviewedAt: now,
    reviewedBy: actor.uid,
    reviewedByName: actor.userName,
    finalizedAt: now,
  });

  // Best-effort: keeps the distributor list's "last order" column honest.
  updateDoc(doc(db, "servicecenters", actor.centerId, "distributors", order.distributorId), {
    lastOrderAt: now,
  }).catch(() => {});
}

/**
 * Release stock straight to a distributor without waiting for them to raise an
 * order — the storekeeper handing goods over the counter. Recorded as an
 * already-finalized order so direct releases and portal orders share one
 * ledger.
 */
export async function releaseItemDirect({
  item, distributor, quantity, note, actor,
}: {
  item: InventoryItem;
  distributor: Distributor;
  quantity: number;
  note?: string;
  actor: ReleaseActor;
}): Promise<string> {
  const unitPrice = distributorUnitPrice(item);
  const line: DistributorOrderItem = {
    itemId: item.id,
    itemName: item.name,
    unit: item.unit,
    requestedQty: quantity,
    approvedQty: quantity,
    unitPrice,
    lineTotal: round2(quantity * unitPrice),
  };
  const now = Timestamp.now();
  const orderNumber = await nextOrderNumber(actor.centerId);
  const orderRef = doc(collection(db, "servicecenters", actor.centerId, "distributorOrders"));

  await safeSetDoc(orderRef, {
    orderNumber,
    distributorId: distributor.id,
    distributorName: distributor.name,
    distributorPhone: distributor.phone ?? null,
    items: [line],
    note: note?.trim() || null,
    status: "finalized",
    total: line.lineTotal,
    ...paymentFields([], line.lineTotal),
    createdVia: "staff",
    centerId: actor.centerId,
    createdAt: now,
    reviewedAt: now,
    reviewedBy: actor.uid,
    reviewedByName: actor.userName,
    finalizedAt: now,
  });

  await safeUpdateDoc(doc(db, "servicecenters", actor.centerId, "inventory", item.id), {
    currentQty: round2(item.currentQty - quantity),
    releaseLog: arrayUnion({
      distributorId: distributor.id,
      distributorName: distributor.name,
      releasedQty: quantity,
      releasedBy: actor.userName,
      orderId: orderRef.id,
      orderNumber,
      unitPrice,
      timestamp: now,
      ...(note?.trim() ? { note: note.trim() } : {}),
    }),
    updatedAt: now,
  });

  updateDoc(doc(db, "servicecenters", actor.centerId, "distributors", distributor.id), {
    lastOrderAt: now,
  }).catch(() => {});

  return orderNumber;
}
