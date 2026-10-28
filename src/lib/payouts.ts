import type { Lead } from "../types/leads";

/**
 * The weekly commission payout, grouped by caller. Pure so the arithmetic that
 * decides what is owed can be tested without Firebase.
 *
 * A lead is in a week's payout when its payment was confirmed in that week
 * (`payoutWeek`). Sent leads stay in the list — a caller paid late, or a past
 * week looked up later, must remain visible.
 */

export interface PayoutGroup {
  callerId: string;
  callerName: string;
  leads: Lead[];
  /** Leads whose commission has not been sent yet. */
  pending: Lead[];
  total: number;
  pendingTotal: number;
  sentTotal: number;
  /** Every lead in the group has been paid out (and there is at least one). */
  allSent: boolean;
}

export interface PayoutTotals {
  total: number;
  pendingTotal: number;
  sentTotal: number;
}

const amountOf = (l: Pick<Lead, "commissionAmount">) =>
  typeof l.commissionAmount === "number" ? l.commissionAmount : 0;

/** Only confirmed payments in a payout state belong in a payout. */
export function isPayable(l: Pick<Lead, "paymentConfirmed" | "payoutStatus">): boolean {
  return l.paymentConfirmed === true
    && (l.payoutStatus === "pending" || l.payoutStatus === "paid_to_caller");
}

export function groupPayouts(leads: Lead[]): PayoutGroup[] {
  const byCaller = new Map<string, PayoutGroup>();
  for (const lead of leads) {
    if (!isPayable(lead) || !lead.assignedTo) continue;
    let g = byCaller.get(lead.assignedTo);
    if (!g) {
      g = {
        callerId: lead.assignedTo, callerName: lead.assignedToName || "Unknown caller",
        leads: [], pending: [], total: 0, pendingTotal: 0, sentTotal: 0, allSent: false,
      };
      byCaller.set(lead.assignedTo, g);
    }
    const amount = amountOf(lead);
    g.leads.push(lead);
    g.total += amount;
    if (lead.payoutStatus === "pending") {
      g.pending.push(lead);
      g.pendingTotal += amount;
    } else {
      g.sentTotal += amount;
    }
  }
  const groups = [...byCaller.values()];
  for (const g of groups) g.allSent = g.leads.length > 0 && g.pending.length === 0;
  // Money still owed first, then alphabetical.
  return groups.sort((a, b) =>
    Number(a.allSent) - Number(b.allSent) || a.callerName.localeCompare(b.callerName));
}

export function payoutTotals(groups: PayoutGroup[]): PayoutTotals {
  return groups.reduce<PayoutTotals>(
    (t, g) => ({
      total: t.total + g.total,
      pendingTotal: t.pendingTotal + g.pendingTotal,
      sentTotal: t.sentTotal + g.sentTotal,
    }),
    { total: 0, pendingTotal: 0, sentTotal: 0 },
  );
}

/** Weeks that still owe a commission, with how many leads, oldest first. */
export function pendingWeeks(leads: Pick<Lead, "payoutWeek" | "payoutStatus" | "paymentConfirmed">[]): { week: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const l of leads) {
    if (l.paymentConfirmed !== true || l.payoutStatus !== "pending" || !l.payoutWeek) continue;
    counts.set(l.payoutWeek, (counts.get(l.payoutWeek) ?? 0) + 1);
  }
  return [...counts.entries()].map(([week, count]) => ({ week, count })).sort((a, b) => a.week.localeCompare(b.week));
}

export const PAYOUT_CSV_HEADERS = ["Week", "Caller", "Garage", "Package", "Commission (Rs)", "Payment confirmed", "Payout"];

export function payoutCsvRows(week: string, groups: PayoutGroup[]): string[][] {
  return groups.flatMap((g) =>
    g.leads.map((l) => [
      week, g.callerName, l.businessName ?? "", l.packageId ?? "", String(amountOf(l)),
      l.paymentConfirmedAt ? l.paymentConfirmedAt.toDate().toISOString().slice(0, 10) : "",
      l.payoutStatus === "paid_to_caller" ? "Sent" : "Pending",
    ]));
}
