import { collection, doc, query, Timestamp, where } from "firebase/firestore";
import { db } from "../config/firebase";
import { boundedGetDocs } from "./firestoreRead";
import { safeAddDoc, safeUpdateDoc } from "./firestoreWrite";
import type { AuthUser, DailyPaySetup, StaffDeduction, StaffMember } from "../types/auth";

// Staff who take their pay day by day. The owner sets that up once per
// employee — a switch and the usual amount — and from then on marks each day
// as it is paid. Every mark is an ordinary "daily" entry under the employee's
// deductions, so the month's payslip takes it off like any other payment
// already made; nothing is calculated from attendance.

/** "2026-08-14" for a Date, in local time. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Midday local time on a "YYYY-MM-DD" day, so it never slips across a timezone. */
export function dayKeyToDate(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0) : null;
}

export function isDailyPaid(staff: Pick<StaffMember, "dailyPay">): boolean {
  return staff.dailyPay?.enabled === true;
}

/** Saves the per-employee setup onto their staff record. */
export function saveDailyPaySetup(centerId: string, staffId: string, setup: DailyPaySetup): Promise<void> {
  return safeUpdateDoc(doc(db, "servicecenters", centerId, "staff", staffId), { dailyPay: setup });
}

/** The daily payments already recorded for one employee on one day. */
export async function fetchDailyPaymentsOn(
  centerId: string, staffId: string, day: string,
): Promise<StaffDeduction[]> {
  const snap = await boundedGetDocs(query(
    collection(db, "servicecenters", centerId, "staff", staffId, "deductions"),
    where("month", "==", day.slice(0, 7)),
  ));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as StaffDeduction))
    .filter((d) => d.type === "daily" && d.deductionDate && dayKey(d.deductionDate.toDate()) === day);
}

/** Marks one day's pay as handed over. */
export async function recordDailyPayment(
  centerId: string,
  staff: Pick<StaffMember, "id" | "fullName">,
  amount: number,
  day: string,
  recorder: AuthUser | null,
): Promise<void> {
  const when = dayKeyToDate(day);
  if (!when || !(amount > 0)) throw new Error("A date and an amount are required.");
  await safeAddDoc(collection(db, "servicecenters", centerId, "staff", staff.id, "deductions"), {
    staffId: staff.id,
    staffName: staff.fullName,
    type: "daily",
    label: "Daily Payment",
    amount,
    deductionDate: Timestamp.fromDate(when),
    month: day.slice(0, 7),
    notes: null,
    centerId,
    recordedBy: recorder?.uid ?? "",
    recordedByName: recorder?.displayName || recorder?.email || "Staff",
    recordedByRole: recorder?.role ?? null,
    createdAt: Timestamp.now(),
  });
}
