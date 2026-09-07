import { useEffect, useMemo, useState } from "react";
import {
  collection, doc, getDoc, getDocs, query, where, Timestamp, serverTimestamp,
} from "firebase/firestore";
import { safeAddDoc, safeUpdateDoc } from "../../lib/firestoreWrite";
import { X, Loader2, Plus, Trash2 } from "lucide-react";
import { db } from "../../config/firebase";
import type {
  StaffMember, PayrollRoleDefaults, PayslipComponent, AttendanceStatus,
  AttendanceDayRecord, OvertimeSettings, StaffDeduction, EpfEtfSettings,
  StaffPayrollProfile,
} from "../../types/auth";
import { yearMonthKey, parseYearMonth, computeAttendanceStats } from "../../lib/attendanceStats";
import {
  withOvertimeDefaults, summariseMonthRecords, overtimeHourlyRate,
} from "../../lib/overtime";
import {
  computeEpfEtf, epfEtfRef, payrollProfileRef, resolveEpfEtf, resolvePay,
  withEpfEtfDefaults,
} from "../../lib/payrollProfiles";
import { useCenterSchedule } from "../../hooks/useCenterSchedule";
import { fetchPendingDeductions } from "../../lib/payrollRecords";

interface JobLike {
  id: string;
  completedAt?: Timestamp;
  startedAt?: Timestamp;
}

interface Props {
  centerId: string;
  staff: StaffMember;
  allJobs: JobLike[];
  createdBy: string;
  createdByName: string;
  onClose: () => void;
  onCreated: (payslipId: string) => void;
}

// Firestore "in" queries cap at 10 values — chunk the month's job ids so
// invoice revenue can be summed for the commission suggestion.
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** "Advance — 14 Aug", so a payslip line says which advance it is. */
function deductionLabel(d: StaffDeduction): string {
  const when = d.deductionDate?.toDate?.();
  const date = when ? when.toLocaleDateString("en-LK", { day: "2-digit", month: "short" }) : "";
  const base = d.label?.trim() || "Deduction";
  return date ? `${base} — ${date}` : base;
}

const DEDUCTION_TYPE_LABEL: Record<StaffDeduction["type"], string> = {
  advance: "Advance",
  loan: "Loan",
  fine: "Fine",
  other: "Other",
};

/** "2026-08" for a deduction, so it can be told from the month being paid. */
function deductionMonthKey(d: StaffDeduction): string {
  const when = d.deductionDate?.toDate?.();
  if (!when) return d.month ?? "";
  return `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}`;
}

const fieldClass =
  "mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500";

export default function PayslipGeneratorModal({
  centerId, staff, allJobs, createdBy, createdByName, onClose, onCreated,
}: Props) {
  const now = new Date();
  const schedule = useCenterSchedule(centerId);
  const [month, setMonth] = useState(yearMonthKey(now.getFullYear(), now.getMonth()));
  const [loadingStats, setLoadingStats] = useState(true);
  const [roleDefaults, setRoleDefaults] = useState<PayrollRoleDefaults | null>(null);
  const [profile, setProfile] = useState<StaffPayrollProfile | null>(null);
  const [payFromProfile, setPayFromProfile] = useState(false);
  const [epf, setEpf] = useState<EpfEtfSettings>(() => withEpfEtfDefaults(null));
  const [attendanceDays, setAttendanceDays] = useState<Record<string, AttendanceStatus>>({});
  const [attendanceRecords, setAttendanceRecords] = useState<Record<string, AttendanceDayRecord>>({});
  const [otSettings, setOtSettings] = useState<OvertimeSettings>(() => withOvertimeDefaults(null));
  const [jobRevenue, setJobRevenue] = useState(0);
  // Every advance / loan / fine no payslip has recovered yet, up to the end of
  // the month being paid. Shown as their own list — an advance is a specific
  // sum handed to this person on a day, not an anonymous deduction line — and
  // each one can be left for a later payslip by unticking it.
  const [pendingDeductions, setPendingDeductions] = useState<StaffDeduction[]>([]);
  const [selectedDeductionIds, setSelectedDeductionIds] = useState<string[]>([]);

  const [basicSalary, setBasicSalary] = useState(0);
  const [commissionRate, setCommissionRate] = useState<number | undefined>(undefined);
  const [commissionAmount, setCommissionAmount] = useState(0);
  /** Jobs the commission suggestion was worked out from, shown alongside it. */
  const [commissionJobs, setCommissionJobs] = useState(0);
  const [otHours, setOtHours] = useState(0);
  const [otRate, setOtRate] = useState(0);
  const [allowances, setAllowances] = useState<PayslipComponent[]>([]);
  const [deductions, setDeductions] = useState<PayslipComponent[]>([]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const { year, month: monthIdx } = parseYearMonth(month);

  const monthJobs = useMemo(() => {
    const start = new Date(year, monthIdx, 1).getTime();
    const end = new Date(year, monthIdx + 1, 1).getTime();
    return allJobs.filter(j => {
      const ca = j.completedAt;
      return ca && ca.toMillis() >= start && ca.toMillis() < end;
    });
  }, [allJobs, year, monthIdx]);

  const totalHours = useMemo(() => {
    const withDuration = monthJobs.filter(j => j.startedAt && j.completedAt);
    if (!withDuration.length) return 0;
    return withDuration.reduce((sum, j) => sum + (j.completedAt!.toMillis() - j.startedAt!.toMillis()), 0) / 3600000;
  }, [monthJobs]);

  // Load role defaults, attendance and job revenue whenever the month or the
  // staff member's role changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const monthEnd = new Date(year, monthIdx + 1, 0, 23, 59, 59, 999);
      const [defaultsSnap, profileSnap, attSnap, otSnap, epfSnap, pending] = await Promise.all([
        getDoc(doc(db, "servicecenters", centerId, "payrollRoleDefaults", staff.role)),
        getDoc(payrollProfileRef(centerId, staff.id)),
        getDoc(doc(db, "servicecenters", centerId, "staff", staff.id, "attendance", month)),
        getDoc(doc(db, "servicecenters", centerId, "payrollSettings", "overtime")),
        getDoc(epfEtfRef(centerId)),
        fetchPendingDeductions(centerId, staff.id, monthEnd),
      ]);
      if (cancelled) return;
      const defaults = defaultsSnap.exists() ? (defaultsSnap.data() as PayrollRoleDefaults) : null;
      setRoleDefaults(defaults);

      // This employee's own pay setup wins over their role's defaults — two
      // people on the same role routinely earn differently.
      const staffProfile = profileSnap.exists() ? (profileSnap.data() as StaffPayrollProfile) : null;
      setProfile(staffProfile);
      const pay = resolvePay(staffProfile, defaults);
      setPayFromProfile(pay.fromProfile);
      const basic = pay.basicSalary;
      setBasicSalary(basic);
      setCommissionRate(pay.commissionRate);
      setAllowances(pay.allowances);
      setEpf(resolveEpfEtf(
        epfSnap.exists() ? (epfSnap.data() as EpfEtfSettings) : null,
        staffProfile,
      ));

      const attData = attSnap.exists()
        ? (attSnap.data() as { days?: Record<string, AttendanceStatus>; records?: Record<string, AttendanceDayRecord> })
        : {};
      setAttendanceDays(attData.days ?? {});
      setAttendanceRecords(attData.records ?? {});

      // Overtime: hours come from the month's attendance, the rate from the
      // center's OT policy. Both stay editable below.
      const settings = withOvertimeDefaults(otSnap.exists() ? (otSnap.data() as OvertimeSettings) : null);
      setOtSettings(settings);
      const otSummary = summariseMonthRecords(attData.records, settings);
      setOtHours(otSummary.otHours);
      setOtRate(settings.otEnabled ? Math.round(overtimeHourlyRate(settings, basic) * 100) / 100 : 0);

      // Standard deductions from the role or profile stay in the editable
      // list; the recorded advances are kept apart and ticked on their own.
      // Anything dated in this month is taken by default; one carried over
      // from an earlier month is shown but left unticked, so recovering it is
      // a decision rather than a surprise on someone's pay.
      setDeductions(pay.deductions);
      setPendingDeductions(pending);
      setSelectedDeductionIds(
        pending.filter((d) => deductionMonthKey(d) === month).map((d) => d.id),
      );

      // Sum revenue of invoices linked to this month's completed jobs, for a
      // commission suggestion (commission still fully editable afterwards).
      const jobIds = monthJobs.map(j => j.id);
      let revenue = 0;
      for (const group of chunk(jobIds, 10)) {
        if (!group.length) continue;
        const snap = await getDocs(
          query(collection(db, "servicecenters", centerId, "invoices"), where("serviceId", "in", group)),
        );
        snap.forEach(d => {
          if (d.data().isDeleted) return;
          revenue += (d.data().grandTotal as number) ?? 0;
        });
      }
      if (cancelled) return;
      setJobRevenue(revenue);
      setCommissionJobs(jobIds.length);
      // The employee's own commission rate wins over their role's, the same
      // way their salary does.
      const rate = pay.commissionRate;
      setCommissionAmount(rate ? Math.round(revenue * (rate / 100)) : 0);
      setLoadingStats(false);
    })().catch(() => setLoadingStats(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerId, staff.id, staff.role, month]);

  // Working days follow the center's schedule, so a Sunday-open workshop
  // isn't docked for the days it actually works.
  const attendanceStats = computeAttendanceStats(attendanceDays, year, monthIdx, schedule);
  const attendanceExtras = summariseMonthRecords(attendanceRecords, otSettings);
  const allowancesTotal = allowances.reduce((s, a) => s + (a.amount || 0), 0);
  // The advances actually being recovered on this payslip, in the order they
  // were handed over.
  const appliedDeductions = useMemo(
    () => pendingDeductions.filter((d) => selectedDeductionIds.includes(d.id)),
    [pendingDeductions, selectedDeductionIds],
  );
  const advancesTotal = appliedDeductions.reduce((s, d) => s + (d.amount || 0), 0);
  const deductionsTotal =
    deductions.reduce((s, d) => s + (d.amount || 0), 0) + advancesTotal;
  const otAmount = Math.round(otHours * otRate * 100) / 100;
  const grossPay = basicSalary + commissionAmount + otAmount + allowancesTotal;
  // EPF/ETF is derived from the gross, so it has to be computed after it. Only
  // the employee's EPF share comes out of net pay; the two employer figures
  // are the workshop's own cost and are reported separately.
  const epfEtf = computeEpfEtf(epf, basicSalary, grossPay);
  const employeeEpf = epfEtf?.employeeEpf ?? 0;
  const totalDeductions = Math.round((deductionsTotal + employeeEpf) * 100) / 100;
  const netPay = Math.round((grossPay - totalDeductions) * 100) / 100;

  function toggleDeduction(id: string) {
    setSelectedDeductionIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  /** Re-applies the rate to this month's invoiced revenue. */
  function recomputeCommission(rate: number | undefined) {
    setCommissionRate(rate);
    setCommissionAmount(rate ? Math.round(jobRevenue * (rate / 100)) : 0);
  }

  function updateComponent(kind: "allowances" | "deductions", idx: number, patch: Partial<PayslipComponent>) {
    const setter = kind === "allowances" ? setAllowances : setDeductions;
    setter(prev => prev.map((item, i) => i === idx ? { ...item, ...patch } : item));
  }
  function addComponent(kind: "allowances" | "deductions") {
    const setter = kind === "allowances" ? setAllowances : setDeductions;
    setter(prev => [...prev, { label: "", amount: 0 }]);
  }
  function removeComponent(kind: "allowances" | "deductions", idx: number) {
    const setter = kind === "allowances" ? setAllowances : setDeductions;
    setter(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const ref = await safeAddDoc(
        collection(db, "servicecenters", centerId, "staff", staff.id, "payslips"),
        {
          staffId: staff.id,
          staffName: staff.fullName,
          role: staff.role,
          employeeId: staff.employeeId ?? null,
          month,
          basicSalary,
          commissionRate: commissionRate ?? null,
          commissionAmount,
          otHours,
          otRate,
          otAmount,
          allowances: allowances.filter(a => a.label.trim()),
          deductions: [
            ...deductions.filter(d => d.label.trim()),
            ...appliedDeductions.map(d => ({ label: deductionLabel(d), amount: d.amount })),
          ],
          grossPay,
          totalDeductions,
          netPay,
          epfEtf: epfEtf ?? null,
          epfNumber: profile?.epfNumber ?? null,
          attendanceRate: attendanceStats.rate,
          daysPresent: attendanceStats.daysPresent,
          daysAbsent: attendanceStats.daysAbsent,
          totalJobs: monthJobs.length,
          totalHours: Number(totalHours.toFixed(1)),
          daysLate: attendanceExtras.daysLate,
          deductionRefIds: appliedDeductions.map(d => d.id),
          status: "draft",
          notes: notes || null,
          centerId,
          createdAt: serverTimestamp(),
          createdBy,
          createdByName,
        },
      );
      // Mark the advances this payslip absorbed, so next month's payslip
      // doesn't deduct the same money twice.
      await Promise.all(appliedDeductions.map(d =>
        safeUpdateDoc(
          doc(db, "servicecenters", centerId, "staff", staff.id, "deductions", d.id),
          { appliedPayslipId: ref.id, appliedAt: Timestamp.now() },
        ).catch(() => {}),
      ));
      onCreated(ref.id);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Generate Payslip — {staff.fullName}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-5">
          <div>
            <label className="text-xs text-gray-400">Month</label>
            <input
              type="month"
              value={month}
              onChange={(e) => { setMonth(e.target.value); setLoadingStats(true); }}
              className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
            />
          </div>

          {/* Monthly summary snapshot */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <SummaryTile label="Attendance" value={loadingStats ? "…" : `${attendanceStats.rate}%`} />
            <SummaryTile label="Days Present" value={loadingStats ? "…" : String(attendanceStats.daysPresent)} />
            <SummaryTile label="Days Late" value={loadingStats ? "…" : String(attendanceExtras.daysLate)} />
            <SummaryTile label="Total Jobs" value={loadingStats ? "…" : String(monthJobs.length)} />
            <SummaryTile label="Total Hours" value={loadingStats ? "…" : `${totalHours.toFixed(1)}h`} />
            <SummaryTile label="OT Hours" value={loadingStats ? "…" : `${attendanceExtras.otHours}h`} />
          </div>

          <div>
            <label className="text-xs text-gray-400">Basic Salary (LKR)</label>
            <input
              type="number"
              value={basicSalary}
              onChange={(e) => setBasicSalary(Number(e.target.value))}
              className={fieldClass}
            />
          </div>

          {/* Commission — what it was worked out from is shown next to it, so
              the figure on the payslip can be checked rather than trusted. */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-white">Commission</h4>
              <span className="text-xs text-gray-500">
                {loadingStats
                  ? "Reading this month's jobs…"
                  : `${commissionJobs} job${commissionJobs === 1 ? "" : "s"} completed · ${
                      jobRevenue ? `LKR ${jobRevenue.toLocaleString()} invoiced` : "nothing invoiced yet"
                    }`}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="text-xs text-gray-400">Rate (% of job revenue)</label>
                <input
                  type="number"
                  min={0}
                  step="0.5"
                  value={commissionRate ?? ""}
                  placeholder="0"
                  onChange={(e) => recomputeCommission(
                    e.target.value === "" ? undefined : Number(e.target.value),
                  )}
                  className={fieldClass}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">Commission (LKR)</label>
                <input
                  type="number"
                  value={commissionAmount}
                  onChange={(e) => setCommissionAmount(Number(e.target.value))}
                  className={fieldClass}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">Worked out as</label>
                <div className="mt-1 bg-[#0B1120] border border-white/5 rounded-lg px-3 py-2 text-sm text-gray-400">
                  {commissionRate
                    ? `${commissionRate}% × LKR ${jobRevenue.toLocaleString()}`
                    : "Set by hand"}
                </div>
              </div>
            </div>
            {!loadingStats && !commissionRate && (
              <p className="text-[11px] text-gray-600 mt-2">
                No commission rate set for {staff.fullName} or the {staff.role} role — enter a rate to
                work it out from this month's revenue, or type the amount straight in.
              </p>
            )}
          </div>

          {/* Overtime — hours come straight from the month's attendance and the
              rate from Payroll Settings; both can be adjusted before saving. */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-white">Overtime</h4>
              <span className="text-xs text-gray-500">
                {otSettings.otEnabled
                  ? `${otSettings.otRateMode === "fixed" ? "Fixed rate" : `${otSettings.otMultiplier}× normal hourly`} · from attendance`
                  : "Auto-calculation is off in Payroll Settings"}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="text-xs text-gray-400">OT Hours</label>
                <input
                  type="number"
                  step="0.25"
                  min={0}
                  value={otHours}
                  onChange={(e) => setOtHours(Number(e.target.value))}
                  className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">Rate (LKR / hour)</label>
                <input
                  type="number"
                  min={0}
                  value={otRate}
                  onChange={(e) => setOtRate(Number(e.target.value))}
                  className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">OT Pay</label>
                <div className="mt-1 bg-[#0B1120] border border-white/5 rounded-lg px-3 py-2 text-sm text-orange-300">
                  LKR {otAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          </div>

          {/* Advances, loans and fines recorded against this employee that no
              payslip has recovered yet. Each one keeps its date, type and the
              name of whoever handed it over, so the person being paid can see
              exactly what is coming off. */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-white">Advances &amp; recorded deductions</h4>
              <span className="text-xs text-gray-500">
                {appliedDeductions.length} of {pendingDeductions.length} selected
              </span>
            </div>
            {loadingStats ? (
              <p className="text-xs text-gray-500">Loading…</p>
            ) : pendingDeductions.length === 0 ? (
              <p className="text-xs text-gray-500">
                Nothing outstanding. Advances are recorded on the employee's profile and
                appear here on the payslip for the month they are dated.
              </p>
            ) : (
              <div className="space-y-2">
                {pendingDeductions.map((d) => {
                  const carried = deductionMonthKey(d) !== month;
                  const checked = selectedDeductionIds.includes(d.id);
                  return (
                    <label
                      key={d.id}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer transition ${
                        checked
                          ? "bg-[#F97316]/10 border-[#F97316]/30"
                          : "bg-white/5 border-white/10 hover:border-white/20"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleDeduction(d.id)}
                        className="h-4 w-4 accent-[#F97316]"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm text-white truncate">{d.label || "Deduction"}</span>
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 text-gray-400 border border-white/10">
                            {DEDUCTION_TYPE_LABEL[d.type] ?? "Other"}
                          </span>
                          {carried && (
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/25">
                              Carried over
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-500 mt-0.5">
                          {d.deductionDate
                            ? d.deductionDate.toDate().toLocaleDateString("en-LK", {
                                day: "2-digit", month: "short", year: "numeric",
                              })
                            : "No date"}
                          {d.recordedByName ? ` · paid out by ${d.recordedByName}` : ""}
                        </p>
                      </div>
                      <span className="text-sm font-medium text-white whitespace-nowrap">
                        LKR {(d.amount || 0).toLocaleString()}
                      </span>
                    </label>
                  );
                })}
                <div className="flex items-center justify-between pt-1 text-xs">
                  <span className="text-gray-500">
                    Unticked entries stay outstanding and come up again on the next payslip.
                  </span>
                  <span className="text-white font-medium">
                    LKR {advancesTotal.toLocaleString()} coming off
                  </span>
                </div>
              </div>
            )}
          </div>

          {!loadingStats && (
            payFromProfile ? (
              <p className="text-xs text-gray-500">
                Using {staff.fullName}'s own pay setup from Payroll Settings, not the {staff.role} role defaults.
              </p>
            ) : !roleDefaults ? (
              <p className="text-xs text-amber-400">
                No pay set for {staff.fullName} and no "{staff.role}" role defaults saved yet — figures start at
                zero. Set them in Settings &gt; Payroll, or customize this payslip by hand.
              </p>
            ) : (
              <p className="text-xs text-gray-500">
                Using the {staff.role} role defaults. Give {staff.fullName} their own salary in
                Settings &gt; Payroll if they're paid differently.
              </p>
            )
          )}

          <ComponentEditor title="Allowances" items={allowances} onAdd={() => addComponent("allowances")}
            onUpdate={(idx, patch) => updateComponent("allowances", idx, patch)} onRemove={(idx) => removeComponent("allowances", idx)} />
          <ComponentEditor title="Deductions" items={deductions} onAdd={() => addComponent("deductions")}
            onUpdate={(idx, patch) => updateComponent("deductions", idx, patch)} onRemove={(idx) => removeComponent("deductions", idx)} />

          <div>
            <label className="text-xs text-gray-400">Notes (optional)</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
            />
          </div>

          <div className="bg-[#0B1120] rounded-xl p-4 border border-white/5 space-y-1 text-sm">
            {otAmount > 0 && <Row label={`Overtime (${otHours}h)`} value={otAmount} />}
            <Row label="Gross Pay" value={grossPay} />
            {commissionAmount > 0 && (
              <Row
                label={`Commission${commissionRate ? ` (${commissionRate}%)` : ""}`}
                value={commissionAmount}
              />
            )}
            {deductionsTotal - advancesTotal > 0 && (
              <Row label="Deductions" value={-(deductionsTotal - advancesTotal)} />
            )}
            {advancesTotal > 0 && (
              <Row label={`Advances (${appliedDeductions.length})`} value={-advancesTotal} />
            )}
            {epfEtf && <Row label={`Employee EPF (${epfEtf.employeeEpfRate}%)`} value={-epfEtf.employeeEpf} />}
            <Row label="Net Pay" value={netPay} bold />
            {epfEtf && (
              <p className="text-[11px] text-gray-600 pt-2">
                Employer contributions on top of this — EPF {epfEtf.employerEpfRate}% (LKR{" "}
                {epfEtf.employerEpf.toLocaleString(undefined, { minimumFractionDigits: 2 })}) and ETF{" "}
                {epfEtf.etfRate}% (LKR {epfEtf.etf.toLocaleString(undefined, { minimumFractionDigits: 2 })}),
                calculated on {epf.contributionBase === "gross" ? "gross pay" : "basic salary"}.
              </p>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 rounded-lg transition text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 bg-[#F97316] hover:bg-orange-600 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition text-sm flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {saving ? "Saving…" : "Generate Payslip"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#0B1120] rounded-xl px-3 py-2.5 border border-white/5">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className="text-sm font-bold text-white mt-0.5">{value}</p>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? "text-white font-semibold pt-1 border-t border-white/10 mt-1" : "text-gray-400"}`}>
      <span>{label}</span>
      <span>LKR {value.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
    </div>
  );
}

function ComponentEditor({
  title, items, onAdd, onUpdate, onRemove,
}: {
  title: string;
  items: PayslipComponent[];
  onAdd: () => void;
  onUpdate: (idx: number, patch: Partial<PayslipComponent>) => void;
  onRemove: (idx: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-white">{title}</h4>
        <button onClick={onAdd} className="flex items-center gap-1 text-xs text-[#F97316] hover:text-orange-400">
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-gray-500">None.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                value={item.label}
                onChange={(e) => onUpdate(idx, { label: e.target.value })}
                placeholder="Label"
                className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
              />
              <input
                type="number"
                value={item.amount}
                onChange={(e) => onUpdate(idx, { amount: Number(e.target.value) })}
                placeholder="Amount"
                className="w-28 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
              />
              <button onClick={() => onRemove(idx)} className="text-gray-500 hover:text-red-400 p-1.5">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
