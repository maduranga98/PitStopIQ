// Shared invoice arithmetic, so every page that shows a bill's totals — the
// invoice card, the new-invoice form, the customer's public view and the
// job → invoice sync — reaches the same grand total from the same inputs.
//
// A bill carries discounts at two levels:
//   • per line   — a service or part with its own special price ("10% off the
//                  wheel alignment"), stored on the line as `discount`;
//   • whole bill — the counter's discount on the total, stored as
//                  `discount` + `discountType` on the invoice itself.
// Both are money off the same subtotal, so they are summed into the single
// Discount figure the totals section (and the printed bill) shows.
import type { DiscountType, InvoiceLineItem } from "../types/auth";

/** Round to cents, so repeated edits don't accumulate float dust. */
const money = (n: number) => Math.round(n * 100) / 100;

/** What a line is worth before its own discount: qty × unit price. */
export function lineGross(item: InvoiceLineItem): number {
  return money(item.qty * item.unitPrice);
}

/** A line's own discount, never more than the line is worth. */
export function lineDiscount(item: InvoiceLineItem): number {
  return Math.min(Math.max(item.discount ?? 0, 0), lineGross(item));
}

/** Every line's own discount added up — the special prices on this bill. */
export function lineDiscountTotal(items: InvoiceLineItem[]): number {
  return money(items.reduce((s, l) => s + lineDiscount(l), 0));
}

export interface InvoiceTotals {
  /** Sum of the lines at full price — what the printed bill lists. */
  subtotal: number;
  /** The per-line special prices, summed. */
  lineDiscounts: number;
  /** The whole-bill discount, resolved from its amount/percent setting. */
  billDiscount: number;
  /** What comes off the subtotal in total: line discounts + bill discount. */
  discountAmount: number;
  grandTotal: number;
}

/**
 * Total up a bill. `discount`/`discountType` are the whole-bill discount; any
 * per-line discounts are read off the lines themselves.
 */
export function invoiceTotals(
  items: InvoiceLineItem[],
  discount: number,
  discountType: DiscountType,
  tax: number,
): InvoiceTotals {
  const subtotal = money(items.reduce((s, l) => s + l.lineTotal, 0));
  const lineDiscounts = lineDiscountTotal(items);
  const billDiscount = discountType === "percent"
    ? money((subtotal * discount) / 100)
    : money(discount);
  // Nothing may discount a bill past zero, however the two levels combine.
  const discountAmount = Math.min(money(lineDiscounts + billDiscount), subtotal);
  const grandTotal = Math.max(0, money(subtotal - discountAmount + tax));
  return { subtotal, lineDiscounts, billDiscount, discountAmount, grandTotal };
}
