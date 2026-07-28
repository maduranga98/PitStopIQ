import { collection, doc, Timestamp } from "firebase/firestore";
import { db } from "../config/firebase";
import { safeDeleteDoc, safeSetDoc } from "./firestoreWrite";
import type {
  PurchaseOrderPlan, PurchaseOrderPlanLine, ServiceCenter, Supplier,
} from "../types/auth";

// Buying from a supplier is naturally a per-supplier trip: one low-stock item
// is the reason to start planning, but everything else that supplier carries
// should go on the same order. One plan per supplier (doc id == supplierId)
// so items added from separate low-stock alerts land on the same order
// instead of spawning duplicates. The plan is a working draft only — once the
// delivery is booked in through recordSupply(), the plan is deleted; the
// goods-received record it created is the thing that lasts.

export function planRef(centerId: string, supplierId: string) {
  return doc(db, "servicecenters", centerId, "purchaseOrderPlans", supplierId);
}

export function plansCollection(centerId: string) {
  return collection(db, "servicecenters", centerId, "purchaseOrderPlans");
}

export interface SavePlanActor {
  centerId: string;
  uid: string;
  userName: string;
}

/** Overwrites the supplier's plan with the given lines/note. */
export async function savePlan({
  supplier, lines, note, existing, actor,
}: {
  supplier: Supplier;
  lines: PurchaseOrderPlanLine[];
  note?: string;
  /** The plan being edited, if one already existed for this supplier. */
  existing?: PurchaseOrderPlan | null;
  actor: SavePlanActor;
}): Promise<void> {
  const now = Timestamp.now();
  const base = {
    supplierId: supplier.id,
    supplierName: supplier.name,
    supplierCompany: supplier.companyName,
    supplierBrand: supplier.brand || null,
    supplierPhone: supplier.mobile,
    lines,
    note: note?.trim() || null,
    centerId: actor.centerId,
    updatedAt: now,
    updatedBy: actor.uid,
    updatedByName: actor.userName,
  };

  if (existing) {
    await safeSetDoc(planRef(actor.centerId, supplier.id), base, { merge: true });
  } else {
    await safeSetDoc(planRef(actor.centerId, supplier.id), {
      ...base,
      status: "draft",
      createdAt: now,
      createdBy: actor.uid,
      createdByName: actor.userName,
    });
  }
}

function centerContactLine(center: Partial<ServiceCenter> | null | undefined): string {
  const parts: string[] = [];
  if (center?.name) parts.push(String(center.name));
  if (center?.phone) parts.push(String(center.phone));
  if (center?.address) parts.push(String(center.address));
  return parts.join(", ");
}

/** The SMS body telling the supplier stock is needed and to drop by. */
export function buildPurchaseOrderSms(
  plan: Pick<PurchaseOrderPlan, "lines">,
  center: Partial<ServiceCenter> | null | undefined,
): string {
  const centerName = center?.name ? String(center.name) : "our service center";
  const itemCount = plan.lines.length;
  const itemWord = itemCount === 1 ? "item" : "items";
  const contact = centerContactLine(center);
  return (
    `Hi, we need to restock ${itemCount} ${itemWord} at ${centerName}. ` +
    `Please visit us as soon as possible. ${contact ? `Contact: ${contact}.` : ""}`
  ).replace(/\s+/g, " ").trim();
}

/** Queues the SMS through the same smsLogs pipeline every other message uses
 *  (see functions/index.js: dispatchSmsLog), then marks the plan as sent. */
export async function sendPlanSms(
  plan: PurchaseOrderPlan,
  center: Partial<ServiceCenter> | null | undefined,
  actor: SavePlanActor,
): Promise<void> {
  const now = Timestamp.now();
  await safeSetDoc(
    doc(collection(db, "servicecenters", actor.centerId, "smsLogs")),
    {
      supplierId: plan.supplierId,
      customerName: plan.supplierName,
      phone: plan.supplierPhone,
      messageType: "PurchaseOrder",
      status: "sent",
      message: buildPurchaseOrderSms(plan, center),
      sentAt: now,
    },
  );
  await safeSetDoc(
    planRef(actor.centerId, plan.supplierId),
    { status: "sent", smsSentAt: now },
    { merge: true },
  );
}

export async function deletePlan(centerId: string, supplierId: string): Promise<void> {
  await safeDeleteDoc(planRef(centerId, supplierId));
}
