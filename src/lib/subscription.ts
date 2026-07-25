import { Timestamp } from "firebase/firestore";
import type { ServiceCenter } from "../types/auth";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * PitStopIQ bank account for manual subscription deposits. Shown to owners on
 * the Payments tab so they know where to transfer, and referenced by the super
 * admin. Single source of truth — update here to change it everywhere.
 */
export const BANK_ACCOUNT = {
  accountNumber: "02795000003",
  accountName: "Lumora Ventures",
  bank: "Cargills Bank",
  branch: "Kuliyapitiya",
} as const;

/** Coerce a Firestore Timestamp / plain {seconds} / Date into a JS Date. */
function toDate(
  value: Date | Timestamp | { seconds: number } | null | undefined,
): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof (value as { seconds?: number }).seconds === "number") {
    return new Date((value as { seconds: number }).seconds * 1000);
  }
  return null;
}

/**
 * Total number of months a center has already paid for, derived from its
 * payment records. Monthly payments count as 1 month each, yearly as 12.
 * Only records that are (or are assumed) "paid" are counted.
 */
export function monthsPaidFromPayments(
  payments: { status?: string; period?: string }[],
): number {
  return payments.reduce((sum, p) => {
    if (p.status && p.status !== "paid") return sum;
    return sum + (p.period === "yearly" ? 12 : 1);
  }, 0);
}

/**
 * The next subscription payment date for a service center.
 *
 * The billing "anchor day" is the day-of-month the center was created on, so a
 * center created on 2026-07-26 is always billed on the 26th. The due date is
 * `monthsPaid + 1` calendar months after the creation month on that anchor day:
 *
 *   - created 2026-07-26, nothing paid yet  → next due 2026-08-26
 *   - after one monthly payment             → next due 2026-09-26
 *   - and so on, one month per paid month
 *
 * The anchor day is clamped to the last day of shorter target months (e.g. an
 * anchor of the 31st becomes the 30th in November). Returns null if the
 * creation date is missing/unparseable.
 */
export function nextMonthlyPaymentDate(
  createdAt: Date | Timestamp | { seconds: number } | null | undefined,
  monthsPaid = 0,
): Date | null {
  const created = toDate(createdAt);
  if (!created) return null;
  const anchorDay = created.getDate();
  const targetMonthIndex = created.getMonth() + monthsPaid + 1;
  const year = created.getFullYear() + Math.floor(targetMonthIndex / 12);
  const month = ((targetMonthIndex % 12) + 12) % 12;
  const daysInTarget = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(anchorDay, daysInTarget));
}

/**
 * Fields to merge into a servicecenters doc when the super admin confirms a
 * payment (marked manually, slip confirmed, or upgrade approved): reactivates
 * the center and rolls the billing period forward, so the daily subscription
 * check doesn't immediately push it back into grace_period/blocked.
 *
 * The new period extends from the current period end when that's still in the
 * future (paying early keeps the full remaining time), otherwise from now
 * (paying late after grace/block starts a fresh period).
 */
export function subscriptionRenewalFields(
  center: Pick<ServiceCenter, "currentPeriodEnd"> | undefined,
  period: "monthly" | "yearly",
) {
  const now = Timestamp.now();
  const end = center?.currentPeriodEnd;
  const baseMs = end && end.toMillis() > now.toMillis() ? end.toMillis() : now.toMillis();
  const days = period === "yearly" ? 365 : 30;
  return {
    status: "active" as const,
    currentPeriodStart: now,
    currentPeriodEnd: Timestamp.fromMillis(baseMs + days * DAY_MS),
    graceDeadline: null,
    // Reset so expiry reminders fire again for the new period.
    lastReminderSentFor: null,
  };
}
