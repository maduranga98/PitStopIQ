import { collection, getDocs, query, Timestamp, where } from "firebase/firestore";
import { db } from "../config/firebase";
import { fetchStaff } from "./refData";
import type { Payslip, StaffDeduction } from "../types/auth";

// Payroll money as it looks from the outside: what each payslip paid out, what
// of that was commission, and every advance handed over. Payslips and
// deductions live under each staff member, and there is no collection-group
// rule for either, so both are read staff by staff — a workshop's staff list is
// short enough that this stays one small fan-out.

/** "2026-08" — the key a payslip's `month` field is stored under. */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Last millisecond of the month a date falls in. */
export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

export interface PayslipRow {
  id: string;
  staffId: string;
  staffName: string;
  role?: string;
  month: string;
  basicSalary: number;
  commissionRate?: number;
  commissionAmount: number;
  otAmount: number;
  grossPay: number;
  totalDeductions: number;
  netPay: number;
  status?: string;
}

export interface AdvanceRow {
  id: string;
  staffId: string;
  staffName: string;
  type: StaffDeduction["type"];
  label: string;
  amount: number;
  date: Timestamp | null;
  /** Set once a payslip has recovered this advance. */
  appliedPayslipId?: string;
  recordedByName?: string;
}

export interface PayrollOutgoings {
  payslips: PayslipRow[];
  advances: AdvanceRow[];
}

/**
 * Every payslip whose month falls inside the range, and every advance / loan /
 * fine dated inside it. Both are per-staff queries on a single field, so no
 * composite index is needed.
 */
export async function fetchPayrollOutgoings(
  centerId: string, startDate: Date, endDate: Date,
): Promise<PayrollOutgoings> {
  if (!centerId) return { payslips: [], advances: [] };
  const staff = await fetchStaff(centerId);
  const fromKey = monthKey(startDate);
  const toKey = monthKey(endDate);
  const from = Timestamp.fromDate(startDate);
  const to = Timestamp.fromDate(endDate);

  const perStaff = await Promise.all(staff.map(async (member) => {
    const [slipSnap, dedSnap] = await Promise.all([
      getDocs(query(
        collection(db, "servicecenters", centerId, "staff", member.id, "payslips"),
        where("month", ">=", fromKey), where("month", "<=", toKey),
      )),
      getDocs(query(
        collection(db, "servicecenters", centerId, "staff", member.id, "deductions"),
        where("deductionDate", ">=", from), where("deductionDate", "<=", to),
      )),
    ]);

    const payslips: PayslipRow[] = slipSnap.docs.map((d) => {
      const p = d.data() as Payslip;
      return {
        id: d.id,
        staffId: member.id,
        staffName: p.staffName || member.fullName,
        role: p.role,
        month: p.month,
        basicSalary: p.basicSalary ?? 0,
        commissionRate: p.commissionRate ?? undefined,
        commissionAmount: p.commissionAmount ?? 0,
        otAmount: p.otAmount ?? 0,
        grossPay: p.grossPay ?? 0,
        totalDeductions: p.totalDeductions ?? 0,
        netPay: p.netPay ?? 0,
        status: p.status,
      };
    });

    const advances: AdvanceRow[] = dedSnap.docs.map((d) => {
      const a = d.data() as StaffDeduction;
      return {
        id: d.id,
        staffId: member.id,
        staffName: a.staffName || member.fullName,
        type: a.type ?? "other",
        label: a.label || "Deduction",
        amount: a.amount ?? 0,
        date: a.deductionDate ?? null,
        appliedPayslipId: a.appliedPayslipId,
        recordedByName: a.recordedByName,
      };
    });

    return { payslips, advances };
  }));

  return {
    payslips: perStaff.flatMap((r) => r.payslips),
    advances: perStaff.flatMap((r) => r.advances),
  };
}

/**
 * Advances, loans and fines for one employee that no payslip has recovered yet
 * and that are dated on or before the end of the given month — so an advance
 * paid in July but missed at the time still turns up on August's payslip
 * instead of quietly disappearing.
 */
export async function fetchPendingDeductions(
  centerId: string, staffId: string, monthEnd: Date,
): Promise<StaffDeduction[]> {
  const snap = await getDocs(query(
    collection(db, "servicecenters", centerId, "staff", staffId, "deductions"),
    where("deductionDate", "<=", Timestamp.fromDate(monthEnd)),
  ));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as StaffDeduction))
    .filter((d) => !d.appliedPayslipId)
    .sort((a, b) => (a.deductionDate?.toMillis?.() ?? 0) - (b.deductionDate?.toMillis?.() ?? 0));
}
