import { collection, doc, getDoc, getDocs, query, where, Timestamp } from "firebase/firestore";
import { db } from "../config/firebase";
import { safeUpdateDoc } from "./firestoreWrite";
import type { Invoice, PartUsed, ServiceJob } from "../types/auth";

function discountAmountOf(subtotal: number, discount: number, discountType: "amount" | "percent"): number {
  return discountType === "percent" ? subtotal * (discount / 100) : discount;
}

/**
 * Bill a part issued against a job onto that job's invoice, and record it on
 * the job itself. Called when an inventory request tied to a job is
 * approved — the part a technician asked for becomes a line item the
 * customer is actually billed for, not just a stock deduction.
 *
 * Non-fatal by design: the stock has already moved by the time this runs, so
 * a failure here must never look like the request itself failed.
 */
export async function billIssuedPartToJob(
  centerId: string,
  jobId: string,
  part: { itemId: string; itemName: string; quantity: number; unitPrice: number },
): Promise<void> {
  try {
    const jobRef = doc(db, "servicecenters", centerId, "jobs", jobId);
    const jobSnap = await getDoc(jobRef);
    if (jobSnap.exists()) {
      const job = jobSnap.data() as ServiceJob;
      const partsUsed: PartUsed[] = job.partsUsed ?? [];
      const idx = partsUsed.findIndex((p) => p.itemId === part.itemId);
      const newParts: PartUsed[] = idx >= 0
        ? partsUsed.map((p, i) => i === idx ? { ...p, quantity: p.quantity + part.quantity } : p)
        : [...partsUsed, {
            itemId: part.itemId,
            itemName: part.itemName,
            quantity: part.quantity,
            unitPrice: part.unitPrice,
            unitCost: part.unitPrice,
          }];
      await safeUpdateDoc(jobRef, { partsUsed: newParts, updatedAt: Timestamp.now() });
    }

    const invSnap = await getDocs(
      query(collection(db, "servicecenters", centerId, "invoices"), where("serviceId", "==", jobId)),
    );
    if (invSnap.empty) return; // no invoice yet — nothing to bill against

    const existing = invSnap.docs[0];
    const inv = existing.data() as Invoice;

    // An invoice with money already recorded against it is never silently
    // rewritten — a part billed after that point goes through the job or
    // invoice page by hand instead.
    if ((inv.paidAmount ?? 0) > 0 || (inv.payments && inv.payments.length > 0)) return;

    const lineItems = [...(inv.lineItems ?? [])];
    const lineIdx = lineItems.findIndex((li) => li.description === part.itemName);
    if (lineIdx >= 0) {
      const li = lineItems[lineIdx];
      const qty = li.qty + part.quantity;
      lineItems[lineIdx] = { ...li, qty, lineTotal: qty * li.unitPrice };
    } else {
      lineItems.push({
        description: part.itemName,
        qty: part.quantity,
        unitPrice: part.unitPrice,
        lineTotal: part.quantity * part.unitPrice,
      });
    }

    const subtotal = lineItems.reduce((s, li) => s + li.lineTotal, 0);
    const discountAmt = discountAmountOf(subtotal, inv.discount ?? 0, inv.discountType ?? "amount");
    const grandTotal = Math.max(0, subtotal - discountAmt + (inv.tax ?? 0));
    const balanceDue = Math.max(0, grandTotal - (inv.paidAmount ?? 0));

    await safeUpdateDoc(doc(db, "servicecenters", centerId, "invoices", existing.id), {
      lineItems,
      subtotal,
      grandTotal,
      balanceDue,
      updatedAt: Timestamp.now(),
    });
  } catch {
    /* non-fatal — the request is already approved and the stock already moved */
  }
}
