import { Timestamp } from "firebase/firestore";
import type { ServiceCenter } from "../types/auth";

const DAY_MS = 24 * 60 * 60 * 1000;

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
