// Shapes and helpers shared by the distributor-facing portal pages. The
// distributor has no account: everything here describes what the
// `getDistributorPortal` callable hands back over a share link, so it lives
// apart from the Firestore-typed models in types/auth.ts.

export interface CatalogItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  /** Whether there is any stock at all. The only signal older backends send. */
  inStock: boolean;
  /**
   * What is actually on the shelf — the ceiling for any order line. null when
   * the backend didn't report a figure (see normalisePortalData), in which case
   * `inStock` is all we know and no cap can be applied client-side.
   */
  availableQty: number | null;
  /** What this distributor pays. */
  unitPrice: number;
  /** The MRP printed on the item; 0 when the center hasn't recorded one. */
  markedPrice: number;
}

export type StockRequestStatus = "pending" | "acknowledged" | "fulfilled" | "declined";

export interface PortalStockRequest {
  id: string;
  itemId: string;
  itemName: string;
  unit: string;
  requestedQty: number;
  status: StockRequestStatus;
  note: string | null;
  reviewNote: string | null;
  createdAt: number | null;
}

export interface PortalOrderLine {
  itemName: string;
  unit: string;
  requestedQty: number;
  approvedQty: number;
  unitPrice: number;
  lineTotal: number;
}

export type PortalPaymentMethod = "cash" | "cheque" | "credit";

/** Cleared / bounced state of a cheque or a credit. Cash is never pending. */
export type PortalClearance = "pending" | "cleared" | "returned";

export interface PortalPayment {
  id: string;
  method: PortalPaymentMethod;
  amount: number;
  date: number | null;
  note: string | null;
  chequeNumber: string | null;
  bank: string | null;
  branch: string | null;
  chequeDate: number | null;
  /** null from backends that predate the register. */
  clearance: PortalClearance | null;
  clearedAt: number | null;
  returnedAt: number | null;
  returnReason: string | null;
}

/** A payment with the order it settles attached — how the Payments tab reads. */
export interface PortalPaymentEntry extends PortalPayment {
  orderId: string;
  orderNumber: string;
}

export type PortalOrderStatus = "submitted" | "finalized" | "rejected" | "cancelled";

export interface PortalOrder {
  id: string;
  orderNumber: string;
  status: PortalOrderStatus;
  total: number;
  note: string | null;
  reviewNote: string | null;
  createdVia: "portal" | "staff";
  createdAt: number | null;
  finalizedAt: number | null;
  items: PortalOrderLine[];
  receivedTotal: number;
  creditTotal: number;
  balanceDue: number;
  paymentStatus: "unpaid" | "partial" | "paid";
  payments: PortalPayment[];
}

export interface PortalCenter {
  name: string;
  phone: string | null;
  address: string | null;
  logoUrl: string | null;
  /** All three null against a backend that predates the invoice header. */
  district: string | null;
  email: string | null;
  businessRegistrationNumber: string | null;
}

export interface PortalData {
  center: PortalCenter;
  distributor: { name: string; contactPerson: string | null; phone: string | null };
  catalog: CatalogItem[];
  orders: PortalOrder[];
  stockRequests: PortalStockRequest[];
  /**
   * Client-side only: whether the backend that answered understands stock
   * requests. Set by normalisePortalData from whether the response carried the
   * list at all, so the feature is hidden rather than offered as a dead end
   * against a Cloud Function that predates it.
   */
  supportsStockRequests: boolean;
}

/**
 * The page and the Cloud Functions behind it deploy separately, so this bundle
 * can find itself talking to a `getDistributorPortal` that predates available
 * quantities, marked prices, stock requests or payment clearance. Every gap is
 * filled in here, at the boundary — a missing field must never reach the render
 * and take the whole catalog down with it.
 */
export function normalisePortalData(raw: PortalData): PortalData {
  return {
    ...raw,
    center: {
      ...raw.center,
      district: raw.center?.district ?? null,
      email: raw.center?.email ?? null,
      businessRegistrationNumber: raw.center?.businessRegistrationNumber ?? null,
    },
    distributor: {
      ...raw.distributor,
      contactPerson: raw.distributor?.contactPerson ?? null,
      phone: raw.distributor?.phone ?? null,
    },
    catalog: (raw.catalog ?? []).map(item => ({
      ...item,
      inStock: item.inStock ?? (item.availableQty ?? 0) > 0,
      // Deliberately null rather than 0 when absent: "unknown" and "none left"
      // pull the UI in opposite directions.
      availableQty: typeof item.availableQty === "number" ? item.availableQty : null,
      markedPrice: item.markedPrice ?? 0,
    })),
    orders: (raw.orders ?? []).map(order => ({
      ...order,
      payments: (order.payments ?? []).map(p => ({
        ...p,
        clearance: p.clearance ?? null,
        clearedAt: p.clearedAt ?? null,
        returnedAt: p.returnedAt ?? null,
        returnReason: p.returnReason ?? null,
      })),
    })),
    stockRequests: raw.stockRequests ?? [],
    supportsStockRequests: Array.isArray(raw.stockRequests),
  };
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function formatLKR(n: number): string {
  return `LKR ${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatDate(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export const PAYMENT_LABEL: Record<PortalPaymentMethod, string> = {
  cash: "Cash", cheque: "Cheque", credit: "Credit",
};

/**
 * Where a cheque or a credit stands. Cash needs no wording — it either
 * happened or it isn't on the list.
 */
export function clearanceLabel(p: PortalPayment): string {
  if (p.method === "cash") return "Received";
  if (p.clearance === "cleared") return p.method === "cheque" ? "Cleared" : "Settled";
  if (p.clearance === "returned") return p.method === "cheque" ? "Returned" : "Written back";
  return p.method === "cheque" ? "Awaiting clearance" : "Outstanding";
}

/** A bounced cheque, or credit written back — recorded, but never money. */
export function isReturned(p: PortalPayment): boolean {
  return p.clearance === "returned";
}

/** Cash always counts; a cheque or credit counts once it's confirmed. */
export function isConfirmed(p: PortalPayment): boolean {
  return p.method === "cash" || p.clearance === "cleared";
}

// ── Payments across every order ──────────────────────────────────────────────

export interface MethodGroup {
  method: PortalPaymentMethod;
  entries: PortalPaymentEntry[];
  /** Entries that didn't bounce — what this method is actually worth. */
  total: number;
  /** Cheques taken but not yet cleared / credit not yet collected. */
  pending: number;
  /** Bounced cheques and credit written back. */
  returned: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Flatten every payment on every settleable order into one list per method, so
 * cash, cheques and credit can each be read on their own. Rejected and
 * cancelled orders never carried money and are left out.
 */
export function groupPaymentsByMethod(orders: PortalOrder[]): MethodGroup[] {
  const entries: PortalPaymentEntry[] = [];
  for (const order of orders) {
    if (order.status === "rejected" || order.status === "cancelled") continue;
    for (const p of order.payments ?? []) {
      entries.push({ ...p, orderId: order.id, orderNumber: order.orderNumber });
    }
  }
  entries.sort((a, b) => (b.date ?? 0) - (a.date ?? 0));

  const methods: PortalPaymentMethod[] = ["cash", "cheque", "credit"];
  return methods.map(method => {
    const rows = entries.filter(e => e.method === method);
    const sum = (list: PortalPaymentEntry[]) =>
      round2(list.reduce((total, p) => total + (p.amount || 0), 0));
    return {
      method,
      entries: rows,
      total: sum(rows.filter(p => !isReturned(p))),
      pending: sum(rows.filter(p => !isConfirmed(p) && !isReturned(p))),
      returned: sum(rows.filter(isReturned)),
    };
  });
}

/**
 * The running account across every order that's still settleable — what has
 * been billed, what came in, and what's left to pay.
 */
export function accountSummary(orders: PortalOrder[]) {
  const settleable = orders.filter(o => o.status === "submitted" || o.status === "finalized");
  return {
    billed: round2(settleable.reduce((sum, o) => sum + o.total, 0)),
    paid: round2(settleable.reduce((sum, o) => sum + o.receivedTotal, 0)),
    balance: round2(settleable.reduce((sum, o) => sum + o.balanceDue, 0)),
  };
}

/**
 * The orders that have become invoices. An order is only a bill once the center
 * has confirmed what it's releasing — anything still awaiting confirmation, or
 * declined, is not something the distributor owes on.
 */
export function invoiceableOrders(orders: PortalOrder[]): PortalOrder[] {
  return orders.filter(o => o.status === "finalized");
}

/** The invoice number shown on a released order — derived, never stored. */
export function invoiceNumberFor(order: PortalOrder): string {
  return order.orderNumber.replace(/^PO-/, "INV-");
}

/** Lines that were actually released — trimmed-to-zero lines aren't billed. */
export function billedLines(order: PortalOrder): PortalOrderLine[] {
  return order.items.filter(l => l.approvedQty > 0);
}
