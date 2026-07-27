import { doc, Timestamp } from "firebase/firestore";
import { db } from "../config/firebase";
import { safeUpdateDoc } from "./firestoreWrite";
import type {
  PaymentClearance, SupplierPayment, SupplierPaymentMethod, SupplierPaymentStatus,
  SupplierSupply,
} from "../types/auth";

// Money going the other way. A delivery is settled the same messy way an
// invoice is — some cash now, a post-dated cheque for the rest, the remainder
// on the supplier's book — so a goods-received record carries the same kind of
// ledger, and every total on it is derived from those entries.

export const SUPPLIER_PAYMENT_METHODS: SupplierPaymentMethod[] =
  ["cash", "bank_transfer", "cheque", "credit"];

export const SUPPLIER_METHOD_LABEL: Record<SupplierPaymentMethod, string> = {
  cash:          "Cash",
  bank_transfer: "Transfer",
  cheque:        "Cheque",
  credit:        "Credit",
};

/** A cheque still has to be presented and a credit still has to be settled. */
export function needsConfirmation(method: SupplierPaymentMethod): boolean {
  return method === "cheque" || method === "credit";
}

export function isConfirmed(payment: SupplierPayment): boolean {
  return !needsConfirmation(payment.method) || payment.clearance === "cleared";
}

/** A cheque that came back, or a credit cancelled — recorded, never paid. */
export function isReturned(payment: SupplierPayment): boolean {
  return payment.clearance === "returned";
}

export function round2(n: number): number {
  return parseFloat(n.toFixed(2));
}

export interface SupplierPaymentSummary {
  byMethod: Record<SupplierPaymentMethod, number>;
  /** Money actually out: cash, transfers, cheques that were honoured, plus
   *  credit that has since been settled. */
  paid: number;
  /** Still owed to the supplier. */
  credit: number;
  /** Cheques written but not yet presented — the account must cover them. */
  unpresentedCheques: number;
  returned: number;
  balanceDue: number;
  status: SupplierPaymentStatus;
}

export function summariseSupplierPayments(
  payments: SupplierPayment[] | undefined,
  total: number,
): SupplierPaymentSummary {
  const list = payments ?? [];
  const sum = (rows: SupplierPayment[]) =>
    round2(rows.reduce((acc, p) => acc + (p.amount || 0), 0));

  // Returned entries are left out of the per-method totals — a cheque that came
  // back is history, not money — and reported on their own as `returned`.
  const byMethod = {} as Record<SupplierPaymentMethod, number>;
  SUPPLIER_PAYMENT_METHODS.forEach(m => {
    byMethod[m] = sum(list.filter(p => p.method === m && !isReturned(p)));
  });

  const settledCredit = sum(list.filter(p => p.method === "credit" && isConfirmed(p)));

  // A cheque handed to the supplier counts as paid from the day it's written —
  // the workshop has parted with it — unless it comes back.
  const paid = round2(
    byMethod.cash + byMethod.bank_transfer + byMethod.cheque + settledCredit,
  );
  const credit = round2(byMethod.credit - settledCredit);
  const unpresentedCheques = sum(
    list.filter(p => p.method === "cheque" && !isConfirmed(p) && !isReturned(p)),
  );
  const returned = sum(list.filter(isReturned));
  const balanceDue = round2(Math.max(0, total - paid));

  let status: SupplierPaymentStatus = "unpaid";
  if (balanceDue <= 0 && total > 0) status = "paid";
  else if (paid > 0) status = "partial";

  return { byMethod, paid, credit, unpresentedCheques, returned, balanceDue, status };
}

/** The stored fields that shadow the payments array on a supply record. */
export function supplierPaymentFields(payments: SupplierPayment[], total: number) {
  const s = summariseSupplierPayments(payments, total);
  return {
    payments,
    paidTotal: s.paid,
    creditTotal: s.credit,
    balanceDue: s.balanceDue,
    paymentStatus: s.status,
  };
}

const ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function newSupplierPaymentId(): string {
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return out;
}

function supplyRef(centerId: string, supplyId: string) {
  return doc(db, "servicecenters", centerId, "supplierSupplies", supplyId);
}

/**
 * Append a payment to a delivery. The whole array is rewritten (rather than
 * arrayUnion'd) so the derived totals are recomputed in the same write and can
 * never drift from the entries they summarise.
 */
export async function recordSupplierPayment(
  centerId: string,
  supply: SupplierSupply,
  payment: SupplierPayment,
): Promise<void> {
  const payments = [...(supply.payments ?? []), payment];
  await safeUpdateDoc(supplyRef(centerId, supply.id), {
    ...supplierPaymentFields(payments, supply.total),
    updatedAt: Timestamp.now(),
  });
}

/** Move a cheque or a credit between pending, cleared and returned. */
export async function setSupplierPaymentClearance(
  centerId: string,
  supply: SupplierSupply,
  paymentId: string,
  state: PaymentClearance,
  actor: { uid: string; name: string },
  reason?: string,
): Promise<void> {
  const payments = (supply.payments ?? []).map(p => {
    if (p.id !== paymentId || !needsConfirmation(p.method)) return p;
    // Firestore has no undefined inside an array element, so fields that no
    // longer apply are dropped rather than blanked.
    const {
      clearedAt: _at, clearedBy: _by, clearedByName: _name,
      returnedAt: _rat, returnedBy: _rby, returnedByName: _rname, returnReason: _reason,
      ...rest
    } = p;
    void _at; void _by; void _name; void _rat; void _rby; void _rname; void _reason;
    if (state === "cleared") {
      return {
        ...rest,
        clearance: "cleared" as const,
        clearedAt: Timestamp.now(),
        clearedBy: actor.uid,
        clearedByName: actor.name,
      };
    }
    if (state === "returned") {
      return {
        ...rest,
        clearance: "returned" as const,
        returnedAt: Timestamp.now(),
        returnedBy: actor.uid,
        returnedByName: actor.name,
        ...(reason?.trim() ? { returnReason: reason.trim() } : {}),
      };
    }
    return { ...rest, clearance: "pending" as const };
  });

  await safeUpdateDoc(supplyRef(centerId, supply.id), {
    ...supplierPaymentFields(payments, supply.total),
    updatedAt: Timestamp.now(),
  });
}

/** Remove a mis-keyed entry and re-derive the totals. */
export async function removeSupplierPayment(
  centerId: string,
  supply: SupplierSupply,
  paymentId: string,
): Promise<void> {
  const payments = (supply.payments ?? []).filter(p => p.id !== paymentId);
  await safeUpdateDoc(supplyRef(centerId, supply.id), {
    ...supplierPaymentFields(payments, supply.total),
    updatedAt: Timestamp.now(),
  });
}
