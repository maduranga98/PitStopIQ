import {
  arrayUnion, collection, doc, getDoc, getDocs, orderBy, query, serverTimestamp,
  Timestamp, where,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { safeAddDoc, safeSetDoc } from "./firestoreWrite";

// Everything the workshop spends money on outside a supplier delivery: rent,
// utilities, a mechanic's advance paid in cash, a one-off tool purchase. The
// accounting page and the outgoings report both record and read through here,
// so a category added on one page shows up on the other.

/** A category is any string — these are only the ones offered out of the box. */
export type ExpenseCategory = string;

export const DEFAULT_EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "Rent", "Utilities", "Salaries", "Inventory", "Marketing",
  "Tools & Equipment", "Transport", "Maintenance", "Tax", "Other",
];

export const EXPENSE_PAYMENT_METHODS = [
  "Cash", "Bank Transfer", "Card", "Cheque", "Other",
] as const;

export interface Expense {
  id: string;
  date: Timestamp;
  category: ExpenseCategory;
  description: string;
  amount: number;
  paymentMethod?: string;
  vendor?: string;
  notes?: string;
  recordedBy?: string;
  recordedByName?: string;
  createdAt?: Timestamp;
}

export function expensesCollection(centerId: string) {
  return collection(db, "servicecenters", centerId, "expenses");
}

/** Categories the center added itself, on top of the defaults. */
export async function loadCustomCategories(centerId: string): Promise<string[]> {
  const snap = await getDoc(doc(db, "servicecenters", centerId));
  const data = snap.data() as { customExpenseCategories?: string[] } | undefined;
  return data?.customExpenseCategories ?? [];
}

/**
 * Remembers a newly typed category on the center so it is offered next time.
 * Non-fatal: the expense itself still saves with the typed category if this
 * write is refused.
 */
export async function saveCustomCategory(centerId: string, name: string): Promise<void> {
  try {
    await safeSetDoc(
      doc(db, "servicecenters", centerId),
      { customExpenseCategories: arrayUnion(name) },
      { merge: true },
    );
  } catch {
    /* ignore — the category still lives on the expense record */
  }
}

/** Defaults + the center's own categories + anything already used on a record. */
export function mergeCategories(custom: string[], used: string[]): string[] {
  const set = new Set<string>(DEFAULT_EXPENSE_CATEGORIES);
  custom.forEach((c) => c && set.add(c));
  used.forEach((c) => c && set.add(c));
  return Array.from(set);
}

export interface NewExpense {
  date: Date;
  category: ExpenseCategory;
  description: string;
  amount: number;
  vendor?: string;
  paymentMethod?: string;
  notes?: string;
  recordedBy?: string;
  recordedByName?: string;
}

export async function addExpense(centerId: string, input: NewExpense): Promise<string> {
  const ref = await safeAddDoc(expensesCollection(centerId), {
    date: Timestamp.fromDate(input.date),
    category: input.category,
    description: input.description,
    amount: input.amount,
    vendor: input.vendor ?? "",
    paymentMethod: input.paymentMethod ?? "Cash",
    notes: input.notes ?? null,
    recordedBy: input.recordedBy ?? null,
    recordedByName: input.recordedByName ?? null,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/** Every expense dated inside a range, newest first. */
export async function fetchExpensesInRange(
  centerId: string, startDate: Date, endDate: Date,
): Promise<Expense[]> {
  const snap = await getDocs(query(
    expensesCollection(centerId),
    where("date", ">=", Timestamp.fromDate(startDate)),
    where("date", "<=", Timestamp.fromDate(endDate)),
    orderBy("date", "desc"),
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Expense));
}

/** Totals per category, largest first, zero-total categories dropped. */
export function totalsByCategory(
  expenses: Pick<Expense, "category" | "amount">[],
): { category: string; total: number }[] {
  const map = new Map<string, number>();
  expenses.forEach((e) => {
    const key = e.category || "Other";
    map.set(key, (map.get(key) ?? 0) + (e.amount || 0));
  });
  return Array.from(map.entries())
    .map(([category, total]) => ({ category, total }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);
}
