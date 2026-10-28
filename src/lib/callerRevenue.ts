import { isoWeekKey, shiftIsoWeek } from "./isoWeek.ts";
import type { Lead } from "../types/leads.ts";

/**
 * A caller's own earnings, worked out from their won leads. Pure, so the
 * figures a caller reads about their money can be tested.
 *
 * A sale moves through three states:
 *  - awaiting  — registered as a customer, first payment not yet confirmed
 *  - payable   — payment confirmed, commission owed in the lead's payout week
 *  - paid      — the weekly payout has been sent
 */

export type SaleStatus = "awaiting" | "payable" | "paid";

export interface RevenueSummary {
  /** Commission on confirmed payments: payable + paid. */
  earned: number;
  paidOut: number;
  /** Confirmed, not yet sent. */
  payable: number;
  /** Won, but the customer's first payment is not confirmed yet. */
  awaiting: number;
  sales: number;
}

export interface WeekEarnings {
  week: string;
  total: number;
  paid: number;
  payable: number;
  count: number;
}

const amountOf = (l: Pick<Lead, "commissionAmount">) =>
  typeof l.commissionAmount === "number" ? l.commissionAmount : 0;

export function isSale(l: Pick<Lead, "stage" | "isDeleted">): boolean {
  return l.stage === "won" && l.isDeleted !== true;
}

export function saleStatus(l: Pick<Lead, "paymentConfirmed" | "payoutStatus">): SaleStatus {
  if (!l.paymentConfirmed) return "awaiting";
  return l.payoutStatus === "paid_to_caller" ? "paid" : "payable";
}

export function summarizeRevenue(leads: Lead[]): RevenueSummary {
  const out: RevenueSummary = { earned: 0, paidOut: 0, payable: 0, awaiting: 0, sales: 0 };
  for (const l of leads) {
    if (!isSale(l)) continue;
    out.sales += 1;
    const amount = amountOf(l);
    switch (saleStatus(l)) {
      case "awaiting": out.awaiting += amount; break;
      case "payable": out.payable += amount; out.earned += amount; break;
      case "paid": out.paidOut += amount; out.earned += amount; break;
    }
  }
  return out;
}

/** Confirmed commission by payout week, newest first. */
export function weeklyEarnings(leads: Lead[]): WeekEarnings[] {
  const byWeek = new Map<string, WeekEarnings>();
  for (const l of leads) {
    if (!isSale(l) || !l.paymentConfirmed || !l.payoutWeek) continue;
    const row = byWeek.get(l.payoutWeek) ?? { week: l.payoutWeek, total: 0, paid: 0, payable: 0, count: 0 };
    const amount = amountOf(l);
    row.total += amount;
    row.count += 1;
    if (saleStatus(l) === "paid") row.paid += amount; else row.payable += amount;
    byWeek.set(l.payoutWeek, row);
  }
  return [...byWeek.values()].sort((a, b) => b.week.localeCompare(a.week));
}

/** The last `n` weeks ending at `current`, oldest first, with empty weeks as zeros — for the chart. */
export function recentWeeks(rows: WeekEarnings[], n = 8, current: string = isoWeekKey()): WeekEarnings[] {
  const byWeek = new Map(rows.map((r) => [r.week, r]));
  return Array.from({ length: n }, (_, i) => {
    const week = shiftIsoWeek(current, i - (n - 1));
    return byWeek.get(week) ?? { week, total: 0, paid: 0, payable: 0, count: 0 };
  });
}

/** Won leads, most recently registered first. */
export function salesList(leads: Lead[]): Lead[] {
  const at = (l: Lead) => l.convertedAt?.toMillis() ?? l.updatedAt?.toMillis() ?? 0;
  return leads.filter(isSale).sort((a, b) => at(b) - at(a));
}
