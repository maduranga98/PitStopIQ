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

/** Methods that put money in the till the moment they're taken. */
const RECEIVED_METHODS: InvoicePaymentMethod[] = ["cash", "card", "bank_transfer", "cheque"];

/** A cheque has to clear and a credit has to be collected — both get confirmed. */
export function needsConfirmation(method: InvoicePaymentMethod): boolean {
  return method === "cheque" || method === "credit";
}

/**
 * The entries worth showing the customer on their own portal: a cheque they
 * wrote or a tab they're running. That they paid cash needs no explaining —
 * the total and the balance already say it.
 */
export function customerVisiblePayments(payments: InvoicePayment[] | undefined): InvoicePayment[] {
  return (payments ?? []).filter(p => needsConfirmation(p.method));
}

/** What a cheque or credit entry is waiting on, in the customer's words. */
export function clearanceLabel(payment: InvoicePayment): string {
  if (payment.method === "cheque") {
    return isConfirmed(payment) ? "Cleared" : "Awaiting clearance";
  }
  return isConfirmed(payment) ? "Settled" : "Outstanding";
}

export function isConfirmed(payment: InvoicePayment): boolean {
  return !needsConfirmation(payment.method) || payment.clearance === "cleared";
}

export function round2(n: number): number {
  return parseFloat(n.toFixed(2));
}

export interface InvoicePaymentSummary {
  byMethod: Record<InvoicePaymentMethod, number>;
  /** Money in: cash, card, transfers, cheques, and credit that's been collected. */
  received: number;
  /** Credit still owed — a confirmed credit has been paid and counts as received. */
  credit: number;
  /** Cheques handed over but not yet confirmed as cleared. */
  unclearedCheques: number;
  balanceDue: number;
  status: InvoiceStatus;
}

export function summariseInvoicePayments(
  payments: InvoicePayment[] | undefined,
  grandTotal: number,
): InvoicePaymentSummary {
  const list = payments ?? [];
  const total = (rows: InvoicePayment[]) =>
    round2(rows.reduce((sum, p) => sum + (p.amount || 0), 0));

  const byMethod = {} as Record<InvoicePaymentMethod, number>;
  INVOICE_PAYMENT_METHODS.forEach(method => {
    byMethod[method] = total(list.filter(p => p.method === method));
  });

  // A cheque counts the day it's taken — the workshop has it in hand, and a
  // bounced one gets removed from the ledger. A credit is only a promise until
  // someone confirms it was collected.
  const collectedCredit = total(list.filter(p => p.method === "credit" && isConfirmed(p)));
  const received = round2(
    RECEIVED_METHODS.reduce((sum, m) => sum + byMethod[m], 0) + collectedCredit,
  );
  const credit = round2(byMethod.credit - collectedCredit);
  const unclearedCheques = total(list.filter(p => p.method === "cheque" && !isConfirmed(p)));
  // Overpayments shouldn't read as a negative balance.
  const balanceDue = round2(Math.max(0, grandTotal - received));

  let status: InvoiceStatus = "pending";
  if (balanceDue <= 0 && grandTotal > 0) status = "paid";
  else if (received > 0) status = "partial";

  return { byMethod, received, credit, unclearedCheques, balanceDue, status };
}

/**
 * How an invoice was settled, in one phrase — for the column on the invoice list
 * and the chip on the customer's portal. Cash-only settlements say "Cash"; what
 * matters is spotting the cheques and the tabs.
 */
export function paymentMethodSummary(payments: InvoicePayment[] | undefined): {
  label: string;
  /** Set when something is still waiting on a confirmation. */
  pendingLabel: string;
  methods: InvoicePaymentMethod[];
} {
  const list = payments ?? [];
  if (list.length === 0) return { label: "", pendingLabel: "", methods: [] };

  // Fixed order so the same mix always reads the same way.
  const methods = INVOICE_PAYMENT_METHODS.filter(m => list.some(p => p.method === m));
  const label = methods.map(m => PAYMENT_METHOD_LABEL[m]).join(" + ");

  const pendingCheque = list.some(p => p.method === "cheque" && !isConfirmed(p));
  const pendingCredit = list.some(p => p.method === "credit" && !isConfirmed(p));
  const pendingLabel = pendingCheque && pendingCredit ? "awaiting confirmation"
    : pendingCheque ? "not yet cleared"
    : pendingCredit ? "not yet collected"
    : "";

  return { label, pendingLabel, methods };
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

/**
 * Confirm (or un-confirm) a cheque or a credit. Clearing a cheque is a record
 * of the bank paying it; clearing a credit means the customer settled the tab,
 * which turns the promise into money and moves the invoice to paid — so the
 * totals are re-derived in the same write.
 */
export async function setInvoicePaymentClearance(
  centerId: string,
  invoice: Invoice,
  paymentId: string,
  cleared: boolean,
  actor: { uid: string; name: string },
): Promise<void> {
  const payments = (invoice.payments ?? []).map(p => {
    if (p.id !== paymentId || !needsConfirmation(p.method)) return p;
    if (!cleared) {
      // Firestore has no undefined inside an array element, so the confirmation
      // fields are dropped rather than blanked.
      const { clearedAt: _at, clearedBy: _by, clearedByName: _name, ...rest } = p;
      void _at; void _by; void _name;
      return { ...rest, clearance: "pending" as const };
    }
    return {
      ...p,
      clearance: "cleared" as const,
      clearedAt: Timestamp.now(),
      clearedBy: actor.uid,
      clearedByName: actor.name,
    };
  });

  const fields = invoicePaymentFields(payments, invoice.grandTotal);
  await safeUpdateDoc(doc(db, "servicecenters", centerId, "invoices", invoice.id), {
    ...fields,
    ...(fields.paidAmount > 0 ? { paidAt: serverTimestamp() } : {}),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Settle whatever is left of an invoice in one action: any credit still on the
 * tab is confirmed as collected, and anything still owed after that is booked
 * as cash. Done as a single write so the ledger never sits in a state where the
 * invoice reads paid but a credit entry still reads outstanding.
 */
export async function settleInvoiceInFull(
  centerId: string,
  invoice: Invoice,
  actor: { uid: string; name: string },
): Promise<void> {
  const now = Timestamp.now();
  const payments: InvoicePayment[] = (invoice.payments ?? []).map(p =>
    p.method === "credit" && !isConfirmed(p)
      ? { ...p, clearance: "cleared" as const, clearedAt: now, clearedBy: actor.uid, clearedByName: actor.name }
      : p,
  );

  const outstanding = summariseInvoicePayments(payments, invoice.grandTotal).balanceDue;
  if (outstanding > 0) {
    payments.push({
      id: newInvoicePaymentId(),
      method: "cash",
      amount: outstanding,
      date: now,
      note: "Balance settled",
      recordedBy: actor.uid,
      recordedByName: actor.name,
      recordedAt: now,
    });
  }

  await safeUpdateDoc(doc(db, "servicecenters", centerId, "invoices", invoice.id), {
    ...invoicePaymentFields(payments, invoice.grandTotal),
    paidAt: serverTimestamp(),
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
