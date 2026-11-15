import { Timestamp, increment } from "firebase/firestore";
import type { ServiceCenter, StoreAddonKey, SmsPackageKey } from "../types/auth";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Monthly price of each Store add-on, in LKR. Charged on top of the plan's
 * own monthly/yearly rate once purchased and approved — see
 * storeAddonsMonthlyTotal.
 */
export const STORE_ADDON_PRICE: Record<StoreAddonKey, number> = {
  outlets: 4999,
  distributors: 3999,
};

export const STORE_ADDON_LABEL: Record<StoreAddonKey, string> = {
  outlets: "Outlets & POS",
  distributors: "Distributors",
};

/** Monthly price (LKR) of an additional branch, by the plan it's requested on. */
export const BRANCH_PRICE: Record<"basic" | "pro", number> = {
  pro: 6999,
  basic: 4499,
};

/** Monthly price (LKR) of a primary center, by plan. */
export const PRIMARY_PRICE: Record<"basic" | "pro", number> = {
  pro: 7999,
  basic: 4999,
};

/** Base monthly SMS quota of each plan (top-up packages are added on top). */
export const PLAN_SMS_QUOTA: Record<"basic" | "pro", number> = {
  pro: 1000,
  basic: 200,
};

/**
 * Fields to write when the super admin moves a center to another plan.
 *
 * - `smsQuotaLimit` is shifted by the difference between the two base quotas
 *   (atomic `increment`) rather than overwritten, so SMS top-up packages the
 *   center already bought are preserved.
 * - `monthlyRate` follows the plan (branches use the discounted add-on rate),
 *   so payment reminders / slips quote the new amount.
 * The billing period is untouched.
 */
export function planChangeFields(
  center: Pick<ServiceCenter, "plan" | "isBranch">,
  newPlan: "basic" | "pro",
) {
  const quotaDelta = PLAN_SMS_QUOTA[newPlan] - PLAN_SMS_QUOTA[center.plan ?? "basic"];
  return {
    plan: newPlan,
    smsQuotaLimit: increment(quotaDelta),
    monthlyRate: (center.isBranch ? BRANCH_PRICE : PRIMARY_PRICE)[newPlan],
  };
}

/** Combined monthly cost of every Store add-on currently active on a center. */
export function storeAddonsMonthlyTotal(
  storeAddons: Partial<Record<StoreAddonKey, boolean>> | undefined,
): number {
  if (!storeAddons) return 0;
  return (Object.keys(STORE_ADDON_PRICE) as StoreAddonKey[])
    .filter(key => storeAddons[key])
    .reduce((sum, key) => sum + STORE_ADDON_PRICE[key], 0);
}

/** SMS quota granted by each purchasable top-up package. */
export const SMS_PACKAGE_QUOTA: Record<SmsPackageKey, number> = {
  sms500: 500,
  sms1000: 1000,
  sms2500: 2500,
  sms5000: 5000,
};

/** Price (LKR) of each SMS top-up package. */
export const SMS_PACKAGE_PRICE: Record<SmsPackageKey, number> = {
  sms500: 950,
  sms1000: 1750,
  sms2500: 4000,
  sms5000: 7500,
};

/** Effective per-SMS rate of each package, for display only (price / quota). */
export const SMS_PACKAGE_PER_SMS: Record<SmsPackageKey, number> = {
  sms500: 1.90,
  sms1000: 1.75,
  sms2500: 1.60,
  sms5000: 1.50,
};

export const SMS_PACKAGE_LABEL: Record<SmsPackageKey, string> = {
  sms500: "500 SMS",
  sms1000: "1,000 SMS",
  sms2500: "2,500 SMS",
  sms5000: "5,000 SMS",
};

/**
 * Combined monthly cost of every recurring SMS package subscription active on
 * a center (a center can stack more than one of the same tier). Folded into
 * the regular monthly payment slip alongside Store add-ons — see
 * storeAddonsMonthlyTotal.
 */
export function smsPackageSubscriptionsMonthlyTotal(
  subs: Partial<Record<SmsPackageKey, number>> | undefined,
): number {
  if (!subs) return 0;
  return (Object.keys(SMS_PACKAGE_PRICE) as SmsPackageKey[])
    .reduce((sum, key) => sum + (subs[key] ?? 0) * SMS_PACKAGE_PRICE[key], 0);
}

/**
 * PitStopIQ bank account for manual subscription deposits. Shown to owners on
 * the Payments tab so they know where to transfer, and referenced by the super
 * admin. Single source of truth — update here to change it everywhere.
 */
export const BANK_ACCOUNT = {
  // Raw digits (no spaces) so copy-to-clipboard pastes cleanly into bank forms.
  accountNumber: "027950000036",
  // Grouped for on-screen readability: "0279 5000 0036".
  accountNumberDisplay: "0279 5000 0036",
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
 *
 * The `servicecenters/{id}/payments` collection also holds Store add-on
 * purchases (`plan: "addon"`) and SMS package top-ups (`plan: "sms_package"`,
 * `period: "one_time"` or `"monthly"` for a recurring package) — those are
 * separate charges, not a renewal of the base subscription, so they must not
 * advance the next-payment-due date. Only records for the base "basic"/"pro"
 * plan, billed "monthly" or "yearly", count toward months paid.
 */
export function monthsPaidFromPayments(
  payments: { status?: string; period?: string; plan?: string }[],
): number {
  return payments.reduce((sum, p) => {
    if (p.status && p.status !== "paid") return sum;
    if (p.plan !== "basic" && p.plan !== "pro") return sum;
    if (p.period !== "yearly" && p.period !== "monthly") return sum;
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

const COLOMBO_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Last moment (23:59:59.999, Colombo time) of the calendar day picked in a
 * `<input type="date">` ("YYYY-MM-DD"). The billing date is the day payment
 * is due, so the period stays valid through that whole day: the 09:00 daily
 * check can send the "due today" reminder before moving the center to grace.
 */
export function billingDateToTimestamp(value: string): Timestamp | null {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return Timestamp.fromMillis(Date.UTC(y, m - 1, d + 1) - COLOMBO_OFFSET_MS - 1);
}

/** Inverse of billingDateToTimestamp: "YYYY-MM-DD" in Colombo time. */
export function timestampToBillingDate(value: Date | Timestamp | { seconds: number } | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  return new Date(date.getTime() + COLOMBO_OFFSET_MS).toISOString().slice(0, 10);
}

/** Same day-of-month one calendar month on (clamped, e.g. 31 Jan -> 28 Feb). */
export function addOneMonth(value: string): string {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return value;
  const daysInTarget = new Date(y, m + 1, 0).getDate();
  const t = new Date(Date.UTC(y, m, Math.min(d, daysInTarget)));
  return t.toISOString().slice(0, 10);
}

/**
 * Fields to merge into a servicecenters doc when the super admin confirms a
 * payment (marked manually, slip confirmed, or upgrade approved): reactivates
 * the center and rolls the billing period forward, so the daily subscription
 * check doesn't immediately push it back into grace_period/blocked.
 *
 * When `billingDate` ("YYYY-MM-DD") is given, it becomes the next due date:
 * currentPeriodEnd/billingDate are set to it and the daily check sends its
 * SMS reminders (7 days, 1 day, due day) relative to it. Otherwise the period
 * extends from the current period end when that's still in the future (paying
 * early keeps the full remaining time), else from now.
 */
export function subscriptionRenewalFields(
  center: Pick<ServiceCenter, "currentPeriodEnd"> | undefined,
  period: "monthly" | "yearly",
  billingDate?: string,
) {
  const now = Timestamp.now();
  const end = center?.currentPeriodEnd;
  const baseMs = end && end.toMillis() > now.toMillis() ? end.toMillis() : now.toMillis();
  const days = period === "yearly" ? 365 : 30;
  const periodEnd =
    (billingDate ? billingDateToTimestamp(billingDate) : null)
    ?? Timestamp.fromMillis(baseMs + days * DAY_MS);
  return {
    status: "active" as const,
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
    // Kept in sync so the "Next Payment Date" shown to the admin is this one.
    billingDate: periodEnd,
    graceDeadline: null,
    // Reset so expiry reminders fire again for the new period.
    lastReminderSentFor: null,
  };
}
