import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "../config/firebase";
import { DEFAULT_EPF_ETF } from "../types/auth";
import type {
  EpfEtfSettings, PayrollRoleDefaults, PayslipComponent, StaffMember,
  StaffPayrollProfile, UserRole,
} from "../types/auth";

/** Doc id under servicecenters/{centerId}/staff/{staffId}/payrollProfile. */
export const PAYROLL_PROFILE_DOC = "main";

/** Where a center's EPF/ETF policy lives, alongside the shift/OT settings. */
export const EPF_ETF_DOC = "epfEtf";

export function payrollProfileRef(centerId: string, staffId: string) {
  return doc(
    db, "servicecenters", centerId, "staff", staffId, "payrollProfile", PAYROLL_PROFILE_DOC,
  );
}

export function epfEtfRef(centerId: string) {
  return doc(db, "servicecenters", centerId, "payrollSettings", EPF_ETF_DOC);
}

/** Fills in any field a stored EPF/ETF document is missing. */
export function withEpfEtfDefaults(
  partial: Partial<EpfEtfSettings> | null | undefined,
): EpfEtfSettings {
  return { ...DEFAULT_EPF_ETF, ...(partial ?? {}) };
}

/**
 * The EPF/ETF actually in force for one employee: the center's policy, with
 * any per-employee override laid on top. An employee can be exempted entirely
 * (`enabled: false` on their profile) without touching anyone else.
 */
export function resolveEpfEtf(
  center: Partial<EpfEtfSettings> | null | undefined,
  profile: StaffPayrollProfile | null | undefined,
): EpfEtfSettings {
  return { ...withEpfEtfDefaults(center), ...(profile?.epfEtf ?? {}) };
}

/** A profile for someone who has never had one saved, seeded from their role. */
export function emptyProfile(
  staff: Pick<StaffMember, "id" | "fullName" | "role">,
  centerId: string,
): StaffPayrollProfile {
  return {
    staffId: staff.id,
    staffName: staff.fullName,
    role: staff.role,
    useRoleDefaults: true,
    basicSalary: 0,
    allowances: [],
    deductions: [],
    centerId,
  };
}

export interface ResolvedPay {
  basicSalary: number;
  commissionRate?: number;
  allowances: PayslipComponent[];
  deductions: PayslipComponent[];
  /** True when these figures came from the employee's own profile. */
  fromProfile: boolean;
}

/**
 * What an employee is actually paid. Their own profile wins whenever they have
 * one and it isn't set to follow the role; otherwise the role defaults apply.
 * Two people on the same role routinely earn differently, so the per-person
 * figures are the answer and the role is only the starting point.
 */
export function resolvePay(
  profile: StaffPayrollProfile | null | undefined,
  roleDefaults: PayrollRoleDefaults | null | undefined,
): ResolvedPay {
  if (profile && !profile.useRoleDefaults) {
    return {
      basicSalary: profile.basicSalary ?? 0,
      commissionRate: profile.commissionRate,
      allowances: profile.allowances ?? [],
      deductions: profile.deductions ?? [],
      fromProfile: true,
    };
  }
  return {
    basicSalary: roleDefaults?.basicSalary ?? 0,
    commissionRate: roleDefaults?.commissionRate,
    allowances: roleDefaults?.allowances ?? [],
    deductions: roleDefaults?.deductions ?? [],
    fromProfile: false,
  };
}

export interface EpfEtfBreakdown {
  base: number;
  employeeEpfRate: number;
  employeeEpf: number;
  employerEpfRate: number;
  employerEpf: number;
  etfRate: number;
  etf: number;
}

/**
 * Statutory contributions for one payslip.
 *
 * `basicSalary` and `grossPay` are both taken because the base is a policy
 * choice: most centers contribute on the basic salary alone, some on everything
 * earned. Returns null when contributions are switched off, so callers can tell
 * "not applicable" from "zero".
 */
export function computeEpfEtf(
  settings: EpfEtfSettings,
  basicSalary: number,
  grossPay: number,
): EpfEtfBreakdown | null {
  if (!settings.enabled) return null;
  const base = settings.contributionBase === "gross" ? grossPay : basicSalary;
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    base: round(base),
    employeeEpfRate: settings.employeeEpfRate,
    employeeEpf: round(base * (settings.employeeEpfRate / 100)),
    employerEpfRate: settings.employerEpfRate,
    employerEpf: round(base * (settings.employerEpfRate / 100)),
    etfRate: settings.etfRate,
    etf: round(base * (settings.etfRate / 100)),
  };
}

/** Loads one employee's saved profile, or null when they have never had one. */
export async function loadPayrollProfile(
  centerId: string, staffId: string,
): Promise<StaffPayrollProfile | null> {
  const snap = await getDoc(payrollProfileRef(centerId, staffId));
  return snap.exists() ? (snap.data() as StaffPayrollProfile) : null;
}

/** Every saved role default for a center, keyed by role name. */
export async function loadRoleDefaults(
  centerId: string,
): Promise<Record<string, PayrollRoleDefaults>> {
  const snap = await getDocs(collection(db, "servicecenters", centerId, "payrollRoleDefaults"));
  const byRole: Record<string, PayrollRoleDefaults> = {};
  snap.docs.forEach((d) => {
    byRole[d.id] = { ...(d.data() as PayrollRoleDefaults), role: d.id as UserRole };
  });
  return byRole;
}
