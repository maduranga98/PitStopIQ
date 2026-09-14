// Reading the commission ledger — the shared half of the commission module.
//
// `onJobCompleted` (functions/index.js) writes servicecenters/{centerId}/
// commissionLogs, one append-only entry per service line a person earned on.
// That ledger is the ONLY record of what a service paid its technician: the
// per-line `commissionSnapshot` on a job holds the technician's own share and
// never the supervisor override, and the payroll `commissionRate` on a staff
// profile is a different, older thing entirely (a flat share of invoiced
// revenue). Anything reporting what commission cost the workshop — a payslip,
// the daily sheet, the outgoings report — reads it from here so every screen
// quotes the same number.
//
// Reversed entries are history, not money: a job reopened and corrected flips
// its old entries to `reversed` and writes fresh ones, so every total below
// counts only the live ones.
import { collection, query, Timestamp, where } from "firebase/firestore";
import { boundedGetDocs } from "./firestoreRead";
import { db } from "../config/firebase";
import type { CommissionLog } from "../types/auth";

/** A report, not an archive dump — the same ceiling the ledger pages use. */
const MAX_ENTRIES = 500;

/** Entries that still stand. A reversed one was superseded by a correction. */
export function liveEntries(logs: CommissionLog[]): CommissionLog[] {
  return logs.filter((l) => !l.reversed);
}

/** What a set of entries is worth. Reversed entries never count. */
export function sumCommission(logs: CommissionLog[]): number {
  return Math.round(
    liveEntries(logs).reduce((sum, l) => sum + (l.commissionAmount ?? 0), 0) * 100,
  ) / 100;
}

export interface StaffCommissionTotal {
  staffId: string;
  staffName: string;
  /** Everything they earned, overrides included. */
  amount: number;
  /** The part of `amount` earned as a trainer/supervisor override. */
  overrideAmount: number;
  entries: number;
}

/** Per person, biggest earner first — the shape every "by staff" panel wants. */
export function totalsByStaff(logs: CommissionLog[]): StaffCommissionTotal[] {
  const map = new Map<string, StaffCommissionTotal>();
  liveEntries(logs).forEach((l) => {
    const cur = map.get(l.staffId) ?? {
      staffId: l.staffId, staffName: l.staffName, amount: 0, overrideAmount: 0, entries: 0,
    };
    cur.amount += l.commissionAmount ?? 0;
    if (l.isOverride) cur.overrideAmount += l.commissionAmount ?? 0;
    cur.entries += 1;
    map.set(l.staffId, cur);
  });
  return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
}

/**
 * Every entry written between two instants, whoever earned it.
 *
 * `createdAt` is stamped when the job was marked done, so a range query here
 * means "commission the workshop took on in this period" — which is exactly
 * how a day's sheet or a month's outgoings should count it. Only Owner,
 * Manager and super admin may read the whole collection (firestore.rules), so
 * callers that can't must narrow by staff with `fetchStaffCommission` instead.
 */
export async function fetchCommissionInRange(
  centerId: string, start: Date, end: Date,
): Promise<CommissionLog[]> {
  if (!centerId) return [];
  const snap = await boundedGetDocs(query(
    collection(db, "servicecenters", centerId, "commissionLogs"),
    where("createdAt", ">=", Timestamp.fromDate(start)),
    where("createdAt", "<=", Timestamp.fromDate(end)),
  ));
  return snap.docs.slice(0, MAX_ENTRIES).map((d) => ({ id: d.id, ...d.data() } as CommissionLog));
}

/** One person's entries in a period — the query the rules allow every role. */
export async function fetchStaffCommission(
  centerId: string, staffId: string, start: Date, end: Date,
): Promise<CommissionLog[]> {
  if (!centerId || !staffId) return [];
  const snap = await boundedGetDocs(query(
    collection(db, "servicecenters", centerId, "commissionLogs"),
    where("staffId", "==", staffId),
    where("createdAt", ">=", Timestamp.fromDate(start)),
    where("createdAt", "<=", Timestamp.fromDate(end)),
  ));
  return snap.docs.slice(0, MAX_ENTRIES).map((d) => ({ id: d.id, ...d.data() } as CommissionLog));
}

/** First and last instant of a "YYYY-MM" payroll month, in local time. */
export function monthBounds(month: string): { start: Date; end: Date } {
  const [y, m] = month.split("-").map(Number);
  return {
    start: new Date(y, (m || 1) - 1, 1, 0, 0, 0, 0),
    end: new Date(y, (m || 1), 0, 23, 59, 59, 999),
  };
}

/**
 * What one employee earned in a payroll month, ready to be put on a payslip.
 *
 * Entries are bucketed by the month the job was completed in, which is what
 * makes a payslip safe to generate twice and impossible to pay twice: August's
 * payslip can only ever pick up August's entries.
 */
export async function fetchStaffCommissionForMonth(
  centerId: string, staffId: string, month: string,
): Promise<CommissionLog[]> {
  const { start, end } = monthBounds(month);
  return liveEntries(await fetchStaffCommission(centerId, staffId, start, end));
}

/** One frozen commission line on a payslip — what it was for, and what it paid. */
export interface PayslipCommissionEntry {
  serviceName: string;
  jobNumber: string;
  amount: number;
  /** Earned on somebody else's work, as their trainer or supervisor. */
  isOverride: boolean;
}

/**
 * The ledger entries as a payslip stores them: the service, the job it was on
 * and the money, snapshotted so the slip stays readable even after a later
 * correction rewrites the ledger behind it.
 */
export function toPayslipEntries(logs: CommissionLog[]): PayslipCommissionEntry[] {
  return liveEntries(logs)
    .slice()
    .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0))
    .map((l) => ({
      serviceName: l.serviceName,
      jobNumber: l.jobNumber ?? "",
      amount: l.commissionAmount ?? 0,
      isOverride: l.isOverride === true,
    }));
}
