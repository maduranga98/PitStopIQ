import { doc, serverTimestamp, Timestamp } from "firebase/firestore";
import { db } from "../config/firebase";
import { safeUpdateDoc } from "./firestoreWrite";
import type {
  Invoice, InvoicePayment, InvoicePaymentMethod, InvoiceStatus,
} from "../types/auth";

// How a customer settled a service invoice. The workshop takes cash at the
// counter, cheques post-dated by a fortnight, and lets its regulars run a tab —
// so an invoice carries a ledger of entries rather than a single "paid" figure,
// and every total shown anywhere is derived from that ledger.

export const INVOICE_PAYMENT_METHODS: InvoicePaymentMethod[] =
  ["cash", "card", "bank_transfer", "cheque", "credit"];

export const PAYMENT_METHOD_LABEL: Record<InvoicePaymentMethod, string> = {
  cash:          "Cash",
  card:          "Card",
  bank_transfer: "Transfer",
  cheque:        "Cheque",
  credit:        "Credit",
};

/** Methods that put money in the till. Credit is owed, not received. */
const RECEIVED_METHODS: InvoicePaymentMethod[] = ["cash", "card", "bank_transfer", "cheque"];

export function round2(n: number): number {
  return parseFloat(n.toFixed(2));
}

export interface InvoicePaymentSummary {
  byMethod: Record<InvoicePaymentMethod, number>;
  /** Money actually in: everything except credit. */
  received: number;
  credit: number;
  balanceDue: number;
  status: InvoiceStatus;
}

export function summariseInvoicePayments(
  payments: InvoicePayment[] | undefined,
  grandTotal: number,
): InvoicePaymentSummary {
  const list = payments ?? [];
  const byMethod = {} as Record<InvoicePaymentMethod, number>;
  INVOICE_PAYMENT_METHODS.forEach(method => {
    byMethod[method] = round2(
      list.filter(p => p.method === method).reduce((sum, p) => sum + (p.amount || 0), 0),
    );
  });

  const received = round2(RECEIVED_METHODS.reduce((sum, m) => sum + byMethod[m], 0));
  const credit = byMethod.credit;
  // Overpayments shouldn't read as a negative balance.
  const balanceDue = round2(Math.max(0, grandTotal - received));

  let status: InvoiceStatus = "pending";
  if (balanceDue <= 0 && grandTotal > 0) status = "paid";
  else if (received > 0) status = "partial";

  return { byMethod, received, credit, balanceDue, status };
}

/**
 * The stored fields that shadow the payments array. paidAmount and status keep
 * their existing meaning — every reader that predates the ledger (the customer
 * share view, the revenue report, the invoice list) keeps working untouched.
 */
export function invoicePaymentFields(payments: InvoicePayment[], grandTotal: number) {
  const s = summariseInvoicePayments(payments, grandTotal);
  return {
    payments,
    paidAmount: s.received,
    receivedTotal: s.received,
    creditTotal: s.credit,
    balanceDue: s.balanceDue,
    status: s.status,
  };
}

const ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function newInvoicePaymentId(): string {
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return out;
}

/**
 * Append a payment to an invoice. The whole array is rewritten (rather than
 * arrayUnion'd) so the derived totals are recomputed in the same write and can
 * never drift from the entries they summarise.
 */
export async function recordInvoicePayment(
  centerId: string,
  invoice: Invoice,
  payment: InvoicePayment,
): Promise<void> {
  const payments = [...(invoice.payments ?? []), payment];
  const fields = invoicePaymentFields(payments, invoice.grandTotal);
  await safeUpdateDoc(doc(db, "servicecenters", centerId, "invoices", invoice.id), {
    ...fields,
    ...(fields.paidAmount > 0 ? { paidAt: serverTimestamp() } : {}),
    updatedAt: serverTimestamp(),
  });
}

/** Remove a mis-keyed entry and re-derive the totals. */
export async function removeInvoicePayment(
  centerId: string,
  invoice: Invoice,
  paymentId: string,
): Promise<void> {
  const payments = (invoice.payments ?? []).filter(p => p.id !== paymentId);
  await safeUpdateDoc(doc(db, "servicecenters", centerId, "invoices", invoice.id), {
    ...invoicePaymentFields(payments, invoice.grandTotal),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Re-derive the stored totals against a new grand total. Editing an invoice's
 * lines after money has come in changes what's owed, so the balance has to be
 * recomputed against the entries already recorded.
 */
export function repricedPaymentFields(invoice: Invoice, grandTotal: number) {
  return invoicePaymentFields(invoice.payments ?? [], grandTotal);
}

/** Local date input (yyyy-mm-dd) → Timestamp, read as local midnight. */
export function dateInputToTimestamp(value: string): Timestamp {
  const [y, m, d] = value.split("-").map(Number);
  return Timestamp.fromDate(new Date(y, (m || 1) - 1, d || 1));
}

export function todayInputValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
