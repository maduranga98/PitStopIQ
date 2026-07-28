import { Timestamp } from "firebase/firestore";
import { setInvoicePaymentClearance } from "./invoicePayments";
import { setPaymentClearance as setDistributorPaymentClearance } from "./distributors";
import { setSupplierPaymentClearance } from "./supplierPayments";
import type {
  DistributorOrder, Invoice, PaymentClearance, SupplierSupply,
} from "../types/auth";

// Every cheque and every rupee of credit in the business, in one place.
//
// The workshop's paper lives in three different ledgers: a customer's invoice,
// a distributor's order, and a delivery from a supplier. Two of those are money
// coming in and one is money going out, but the question the owner actually has
// is the same for all three — what is out there, when does it fall due, and has
// it come in yet? So this module reads all three and flattens them into one
// list of entries with one vocabulary.
//
// Nothing is stored here: an entry is a view onto a payment inside its source
// document, and marking one settled or returned writes straight back to that
// document (see applyRegisterState below). There is no second copy to drift.

export type RegisterKind = "cheque" | "credit";

/** Money owed to the workshop, or money the workshop owes. */
export type RegisterDirection = "incoming" | "outgoing";

/**
 * pending  — sitting there: the cheque hasn't been banked, the tab isn't paid
 * settled  — the cheque cleared / the credit was collected or paid
 * returned — the cheque bounced, or the credit was written back
 */
export type RegisterState = "pending" | "settled" | "returned";

export type RegisterSource = "invoice" | "distributorOrder" | "supplierSupply";

export interface RegisterEntry {
  /** Stable across reloads: source + document + payment. */
  key: string;
  source: RegisterSource;
  docId: string;
  paymentId: string;
  kind: RegisterKind;
  direction: RegisterDirection;
  state: RegisterState;
  amount: number;
  /** Document the entry belongs to — invoice number, PO number, GRN. */
  reference: string;
  /** Who it's with: the customer, the distributor, the supplier. */
  partyName: string;
  /** Second line of context — a plate number, a company, a phone. */
  partySubtitle?: string;
  /** When it was taken or agreed. */
  date: Timestamp;
  /** The day it falls due: the date on the cheque. Credit has none. */
  dueDate?: Timestamp;
  chequeNumber?: string;
  bank?: string;
  branch?: string;
  note?: string;
  recordedByName?: string;
  settledByName?: string;
  settledAt?: Timestamp;
  returnedByName?: string;
  returnedAt?: Timestamp;
  returnReason?: string;
  /** In-app route to the document this came from. */
  href?: string;
}

const KIND_METHODS = new Set(["cheque", "credit"]);

function stateOf(clearance: PaymentClearance | undefined): RegisterState {
  if (clearance === "cleared") return "settled";
  if (clearance === "returned") return "returned";
  return "pending";
}

/** RegisterState → the stored clearance value it maps to. */
export function clearanceFor(state: RegisterState): PaymentClearance {
  return state === "settled" ? "cleared" : state === "returned" ? "returned" : "pending";
}

// ── Collectors ───────────────────────────────────────────────────────────────

export function entriesFromInvoices(invoices: Invoice[]): RegisterEntry[] {
  const out: RegisterEntry[] = [];
  for (const inv of invoices) {
    for (const p of inv.payments ?? []) {
      if (!KIND_METHODS.has(p.method)) continue;
      out.push({
        key: `invoice:${inv.id}:${p.id}`,
        source: "invoice",
        docId: inv.id,
        paymentId: p.id,
        kind: p.method as RegisterKind,
        direction: "incoming",
        state: stateOf(p.clearance),
        amount: p.amount || 0,
        reference: inv.invoiceNumber,
        partyName: inv.customerName,
        partySubtitle: inv.plateNumber,
        date: p.date,
        dueDate: p.chequeDate,
        chequeNumber: p.chequeNumber,
        bank: p.bank,
        branch: p.branch,
        note: p.note,
        recordedByName: p.recordedByName,
        settledByName: p.clearedByName,
        settledAt: p.clearedAt,
        returnedByName: p.returnedByName,
        returnedAt: p.returnedAt,
        returnReason: p.returnReason,
        href: `/invoices/${inv.id}`,
      });
    }
  }
  return out;
}

export function entriesFromDistributorOrders(orders: DistributorOrder[]): RegisterEntry[] {
  const out: RegisterEntry[] = [];
  for (const order of orders) {
    for (const p of order.payments ?? []) {
      if (!KIND_METHODS.has(p.method)) continue;
      out.push({
        key: `distributorOrder:${order.id}:${p.id}`,
        source: "distributorOrder",
        docId: order.id,
        paymentId: p.id,
        kind: p.method as RegisterKind,
        direction: "incoming",
        state: stateOf(p.clearance),
        amount: p.amount || 0,
        reference: order.orderNumber,
        partyName: order.distributorName,
        partySubtitle: order.distributorPhone,
        date: p.date,
        dueDate: p.chequeDate,
        chequeNumber: p.chequeNumber,
        bank: p.bank,
        branch: p.branch,
        note: p.note,
        recordedByName: p.recordedByName,
        settledByName: p.clearedByName,
        settledAt: p.clearedAt,
        returnedByName: p.returnedByName,
        returnedAt: p.returnedAt,
        returnReason: p.returnReason,
        href: "/distributors/orders",
      });
    }
  }
  return out;
}

export function entriesFromSupplies(supplies: SupplierSupply[]): RegisterEntry[] {
  const out: RegisterEntry[] = [];
  for (const supply of supplies) {
    for (const p of supply.payments ?? []) {
      if (!KIND_METHODS.has(p.method)) continue;
      out.push({
        key: `supplierSupply:${supply.id}:${p.id}`,
        source: "supplierSupply",
        docId: supply.id,
        paymentId: p.id,
        kind: p.method as RegisterKind,
        direction: "outgoing",
        state: stateOf(p.clearance),
        amount: p.amount || 0,
        reference: supply.supplyNumber,
        partyName: supply.supplierCompany || supply.supplierName,
        partySubtitle: supply.invoiceRef ? `Bill ${supply.invoiceRef}` : supply.supplierName,
        date: p.date,
        dueDate: p.chequeDate,
        chequeNumber: p.chequeNumber,
        bank: p.bank,
        branch: p.branch,
        note: p.note,
        recordedByName: p.recordedByName,
        settledByName: p.clearedByName,
        settledAt: p.clearedAt,
        returnedByName: p.returnedByName,
        returnedAt: p.returnedAt,
        returnReason: p.returnReason,
        href: "/suppliers?tab=supplies",
      });
    }
  }
  return out;
}

export function collectRegisterEntries({
  invoices = [], orders = [], supplies = [],
}: {
  invoices?: Invoice[];
  orders?: DistributorOrder[];
  supplies?: SupplierSupply[];
}): RegisterEntry[] {
  return [
    ...entriesFromInvoices(invoices),
    ...entriesFromDistributorOrders(orders),
    ...entriesFromSupplies(supplies),
  ];
}

// ── Reading the list ─────────────────────────────────────────────────────────

/** The day an entry is watched for: the cheque's date, else when it was taken. */
export function effectiveDate(entry: RegisterEntry): Date {
  return (entry.dueDate ?? entry.date)?.toDate?.() ?? new Date(0);
}

/** Local yyyy-mm-dd — the key the calendar groups on. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function isOverdue(entry: RegisterEntry, now = new Date()): boolean {
  if (entry.state !== "pending" || !entry.dueDate) return false;
  const due = entry.dueDate.toDate();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return due < today;
}

export interface RegisterTotals {
  chequesIn: number;
  chequesOut: number;
  creditReceivable: number;
  creditPayable: number;
  overdueCount: number;
  returnedCount: number;
}

/** What's still open, split the four ways an owner thinks about it. */
export function pendingTotals(entries: RegisterEntry[], now = new Date()): RegisterTotals {
  const totals: RegisterTotals = {
    chequesIn: 0, chequesOut: 0, creditReceivable: 0, creditPayable: 0,
    overdueCount: 0, returnedCount: 0,
  };
  for (const e of entries) {
    if (e.state === "returned") { totals.returnedCount += 1; continue; }
    if (e.state !== "pending") continue;
    if (e.kind === "cheque") {
      if (e.direction === "incoming") totals.chequesIn += e.amount;
      else totals.chequesOut += e.amount;
    } else if (e.direction === "incoming") {
      totals.creditReceivable += e.amount;
    } else {
      totals.creditPayable += e.amount;
    }
    if (isOverdue(e, now)) totals.overdueCount += 1;
  }
  return totals;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export interface ReminderOptions {
  /** A pending cheque starts showing up once it's within this many days of its date (or past it). */
  chequeDueWithinDays?: number;
  /** Pending credit has no due date, so it starts showing up once it's been open this many days. */
  creditAgingDays?: number;
}

/**
 * The two things an owner needs nudging about: a cheque about to fall due (or
 * already overdue) and credit that's gone unpaid for too long to still call
 * it "recent". Feeds the notification bell.
 */
export function reminderEntries(
  entries: RegisterEntry[],
  now = new Date(),
  opts: ReminderOptions = {},
): RegisterEntry[] {
  const chequeDueWithinDays = opts.chequeDueWithinDays ?? 3;
  const creditAgingDays = opts.creditAgingDays ?? 14;
  const today = startOfDay(now);
  const chequeCutoff = new Date(today.getTime() + chequeDueWithinDays * DAY_MS);

  return entries
    .filter(e => {
      if (e.state !== "pending") return false;
      if (e.kind === "cheque") {
        if (!e.dueDate) return false;
        return e.dueDate.toDate() <= chequeCutoff;
      }
      const since = startOfDay(effectiveDate(e));
      return today.getTime() - since.getTime() >= creditAgingDays * DAY_MS;
    })
    .sort((a, b) => effectiveDate(a).getTime() - effectiveDate(b).getTime());
}

/** Short "why this is a reminder" line, in the owner's words. */
export function reminderReason(entry: RegisterEntry, now = new Date()): string {
  const today = startOfDay(now);
  if (entry.kind === "cheque" && entry.dueDate) {
    const due = startOfDay(entry.dueDate.toDate());
    const days = Math.round((due.getTime() - today.getTime()) / DAY_MS);
    if (days < 0) return `Overdue by ${Math.abs(days)}d`;
    if (days === 0) return entry.direction === "incoming" ? "To bank today" : "Presents today";
    return `Due in ${days}d`;
  }
  const since = startOfDay(effectiveDate(entry));
  const days = Math.round((today.getTime() - since.getTime()) / DAY_MS);
  return `Outstanding ${days}d`;
}

export interface DayCheques {
  /** Cheques received, due to be banked that day. */
  toBank: RegisterEntry[];
  /** Cheques written to suppliers — the account has to cover them that day. */
  toFund: RegisterEntry[];
}

/**
 * Cheques by the day they fall due. Two numbers per day is the whole point of
 * the calendar: how many to take to the bank, and how many need money in the
 * account before they're presented.
 */
export function chequesByDay(entries: RegisterEntry[]): Map<string, DayCheques> {
  const map = new Map<string, DayCheques>();
  for (const e of entries) {
    if (e.kind !== "cheque" || !e.dueDate) continue;
    const key = dayKey(e.dueDate.toDate());
    const day = map.get(key) ?? { toBank: [], toFund: [] };
    if (e.direction === "incoming") day.toBank.push(e);
    else day.toFund.push(e);
    map.set(key, day);
  }
  return map;
}

/**
 * The 6×7 grid of a month, Monday-first, padded with the neighbouring months'
 * days so the calendar is always a complete rectangle.
 */
export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  // getDay() is Sunday-first; the workshop's week starts on Monday.
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - offset);
  return Array.from({ length: 42 }, (_, i) =>
    new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

// ── Writing back ─────────────────────────────────────────────────────────────

export interface RegisterSources {
  invoices: Map<string, Invoice>;
  orders: Map<string, DistributorOrder>;
  supplies: Map<string, SupplierSupply>;
}

/**
 * Mark an entry settled, returned, or back to pending. The write goes to the
 * document the payment lives in, which re-derives that document's own totals —
 * so a bounced customer cheque reopens the invoice balance in the same breath.
 */
export async function applyRegisterState(
  centerId: string,
  entry: RegisterEntry,
  state: RegisterState,
  sources: RegisterSources,
  actor: { uid: string; name: string },
  reason?: string,
): Promise<void> {
  const clearance = clearanceFor(state);
  if (entry.source === "invoice") {
    const invoice = sources.invoices.get(entry.docId);
    if (!invoice) throw new Error("Invoice not found");
    await setInvoicePaymentClearance(centerId, invoice, entry.paymentId, clearance, actor, reason);
    return;
  }
  if (entry.source === "distributorOrder") {
    const order = sources.orders.get(entry.docId);
    if (!order) throw new Error("Order not found");
    await setDistributorPaymentClearance(centerId, order, entry.paymentId, clearance, actor, reason);
    return;
  }
  const supply = sources.supplies.get(entry.docId);
  if (!supply) throw new Error("Supply not found");
  await setSupplierPaymentClearance(centerId, supply, entry.paymentId, clearance, actor, reason);
}

// ── Labels ───────────────────────────────────────────────────────────────────

export function stateLabel(entry: RegisterEntry): string {
  if (entry.state === "returned") return entry.kind === "cheque" ? "Returned" : "Written back";
  if (entry.state === "settled") {
    if (entry.kind === "cheque") return entry.direction === "incoming" ? "Cleared" : "Presented";
    return entry.direction === "incoming" ? "Collected" : "Settled";
  }
  if (entry.kind === "cheque") return entry.direction === "incoming" ? "Not yet banked" : "Not yet presented";
  return entry.direction === "incoming" ? "Not yet received" : "Not yet paid";
}

/** The button that moves a pending entry to settled, in the owner's words. */
export function settleActionLabel(entry: RegisterEntry): string {
  if (entry.kind === "cheque") {
    return entry.direction === "incoming" ? "Mark received" : "Mark presented";
  }
  return entry.direction === "incoming" ? "Mark received" : "Mark paid";
}

export function sourceLabel(source: RegisterSource): string {
  return source === "invoice" ? "Customer invoice"
    : source === "distributorOrder" ? "Distributor order"
    : "Supplier delivery";
}
