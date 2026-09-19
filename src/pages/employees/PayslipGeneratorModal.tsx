import { useEffect, useMemo, useState } from "react";
import {
  collection, doc, query, where, Timestamp, serverTimestamp,
} from "firebase/firestore";
import { boundedGetDoc, boundedGetDocs } from "../../lib/firestoreRead";
import { safeAddDoc, safeUpdateDoc } from "../../lib/firestoreWrite";
import { X, Loader2, Plus, Trash2 } from "lucide-react";
import { db } from "../../config/firebase";
import type {
  StaffMember, PayrollRoleDefaults, PayslipComponent, AttendanceStatus,
  AttendanceDayRecord, OvertimeSettings, StaffDeduction, EpfEtfSettings,
  StaffPayrollProfile, JobServiceLine,
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
import { useWorkshopModules } from "../../hooks/useWorkshopModules";
import { fetchPendingDeductions } from "../../lib/payrollRecords";
import {
  fetchStaffCommissionForMonth, sumCommission, toPayslipEntries,
  type PayslipCommissionEntry,
} from "../../lib/commissionLedger";

interface JobLike {
  id: string;
  completedAt?: Timestamp;
  startedAt?: Timestamp;
  /** Catalog services and free-text ones on the job card. */
  services?: string[];
  customServices?: string[];
  /** Per-service detail, where the bay-workflow / commission modules write it. */
  serviceLines?: JobServiceLine[];
}

/**
 * How many service lines of a job belong to this employee. Where the job names
 * a technician per line, only their own lines count — a crew of three washing,
 * servicing and regassing one car did three services between them, not nine.
 * A job without that detail falls back to everything listed on it.
 */
function servicesForStaff(job: JobLike, staffId: string): number {
  const mine = job.serviceLines?.filter((l) => l.technicianId === staffId) ?? [];
  if (mine.length > 0) return mine.length;
  return (job.services?.length ?? 0) + (job.customServices?.length ?? 0);
}

interface Props {
  centerId: string;
  staff: StaffMember;
  /**
   * This employee's jobs, when the caller already has them (the employee
   * profile does). Left out — as the Payroll page does — the modal fetches
   * them itself, so no screen has to load jobs just to offer a payslip.
   */
  allJobs?: JobLike[];
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
  const [fetchedJobs, setFetchedJobs] = useState<JobLike[]>([]);
  const schedule = useCenterSchedule(centerId);
  const { commissionEnabled, loading: modulesLoading } = useWorkshopModules(centerId);
  const [month, setMonth] = useState(yearMonthKey(now.getFullYear(), now.getMonth()));
  // Pay setup and commission load independently — the commission pass waits on
  // this employee's jobs, which may still be in flight — so each reports its
  // own progress and the tiles stay on "…" until both are in.
  const [loadingPay, setLoadingPay] = useState(true);
  const [loadingCommission, setLoadingCommission] = useState(true);
  const loadingStats = loadingPay || loadingCommission;
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
  /**
   * The rate this employee's profile (or their role) sets, kept apart from the
   * editable `commissionRate` so the commission pass can re-seed from it
   * without depending on whatever is currently typed in the box.
   */
  const [defaultCommissionRate, setDefaultCommissionRate] = useState<number | undefined>(undefined);
  // Per-service commission for the month, straight from the ledger the
  // `onJobCompleted` Cloud Function writes. When the module is on this is the
  // commission — the older "% of invoiced revenue" rate is not applied on top
  // of it, which would pay the same work twice.
  const [ledgerEntries, setLedgerEntries] = useState<PayslipCommissionEntry[]>([]);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [otHours, setOtHours] = useState(0);
  const [otRate, setOtRate] = useState(0);
  const [allowances, setAllowances] = useState<PayslipComponent[]>([]);
  const [deductions, setDeductions] = useState<PayslipComponent[]>([]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  // Set only when the payslip saved but one of its advances could not be
  // marked as recovered — see handleSave.
  const [createdPayslipId, setCreatedPayslipId] = useState<string | null>(null);
  const [unmarkedDeductions, setUnmarkedDeductions] = useState<StaffDeduction[]>([]);

  const { year, month: monthIdx } = parseYearMonth(month);

  // Only when the caller didn't pass them. Firestore can't OR the lead
  // technician and the crew array in one query, so the two are merged by id.
  useEffect(() => {
    if (allJobs || !centerId || !staff.id) return;
    let alive = true;
    const jobs = collection(db, "servicecenters", centerId, "jobs");
    Promise.all([
      boundedGetDocs(query(jobs, where("technicianId", "==", staff.id))),
      boundedGetDocs(query(jobs, where("technicianIds", "array-contains", staff.id))),
    ]).then(snaps => {
      if (!alive) return;
      const byId = new Map<string, JobLike>();
      snaps.forEach(snap => snap.docs.forEach(d => byId.set(d.id, { id: d.id, ...d.data() } as JobLike)));
      setFetchedJobs(Array.from(byId.values()));
    }).catch(() => { /* a payslip without job data is still generatable */ });
    return () => { alive = false; };
  }, [allJobs, centerId, staff.id]);

  const jobs = allJobs ?? fetchedJobs;

  const monthJobs = useMemo(() => {
    const start = new Date(year, monthIdx, 1).getTime();
    const end = new Date(year, monthIdx + 1, 1).getTime();
    return jobs.filter(j => {
      const ca = j.completedAt;
      return ca && ca.toMillis() >= start && ca.toMillis() < end;
    });
  }, [jobs, year, monthIdx]);

  // How long this month's jobs were open, start to finish. A bay figure, not a
  // payroll one — the hours an employee is paid for come from attendance
  // below — so it is labelled as such rather than as "hours worked".
  const jobHours = useMemo(() => {
    const withDuration = monthJobs.filter(j => j.startedAt && j.completedAt);
    if (!withDuration.length) return 0;
    return withDuration.reduce((sum, j) => sum + (j.completedAt!.toMillis() - j.startedAt!.toMillis()), 0) / 3600000;
  }, [monthJobs]);

  /** Service lines this employee did this month, across their completed jobs. */
  const jobServices = useMemo(
    () => monthJobs.reduce((sum, j) => sum + servicesForStaff(j, staff.id), 0),
    [monthJobs, staff.id],
  );

  // The month's job ids as a stable string, so the commission pass re-runs when
  // the jobs themselves arrive (this modal fetches them when the caller has
  // none) rather than settling on whatever list existed at mount.
  const monthJobIds = useMemo(() => monthJobs.map(j => j.id), [monthJobs]);
  const monthJobIdsKey = monthJobIds.join(",");

  // Pay setup, attendance and outstanding advances for the month being paid.
  // Nothing here depends on the employee's jobs, so it runs as soon as the
  // modal opens rather than waiting on them.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Inside the async body, not the effect's: a synchronous setState here
      // would cascade a render before the reads even start.
      setLoadingPay(true);
      const monthEnd = new Date(year, monthIdx + 1, 0, 23, 59, 59, 999);
      const [defaultsSnap, profileSnap, attSnap, otSnap, epfSnap, pending] = await Promise.all([
        boundedGetDoc(doc(db, "servicecenters", centerId, "payrollRoleDefaults", staff.role)),
        boundedGetDoc(payrollProfileRef(centerId, staff.id)),
        boundedGetDoc(doc(db, "servicecenters", centerId, "staff", staff.id, "attendance", month)),
        boundedGetDoc(doc(db, "servicecenters", centerId, "payrollSettings", "overtime")),
        boundedGetDoc(epfEtfRef(centerId)),
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
      setDefaultCommissionRate(pay.commissionRate);
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
      setLoadingPay(false);
    })().catch(() => setLoadingPay(false));
    return () => { cancelled = true; };
  }, [centerId, staff.id, staff.role, month, year, monthIdx]);

  // Commission for the month: what the per-service ledger recorded, or — for a
  // center not running that module — a suggestion from the revenue this
  // employee's completed jobs were invoiced for.
  //
  // This is its own pass because it waits on two things the pay setup does
  // not: the module flags, and the employee's job list, which this modal
  // fetches itself when the caller has none. Keying it on the month's job ids
  // means the figures are re-worked when those jobs land instead of being
  // fixed at zero by whatever was loaded at mount.
  useEffect(() => {
    // Both module flags read as off until the center doc lands, and a payslip
    // must not be seeded from the fallback rate only to be rewritten a moment
    // later — over an edit the operator may already have made. Nothing loads
    // until it is known which commission this center actually pays.
    if (modulesLoading) return;
    let cancelled = false;
    (async () => {
      setLoadingCommission(true);
      // Sum revenue of invoices linked to this month's completed jobs, for a
      // commission suggestion (commission still fully editable afterwards).
      // One chunk per ten job ids (Firestore's `in` limit), read in parallel:
      // the chunks are independent and nothing here writes, so a payroll month
      // with a lot of jobs shouldn't pay N sequential round trips before the
      // commission suggestion appears.
      const groups = chunk(monthJobIds, 10).filter(g => g.length > 0);
      const [snaps, logs] = await Promise.all([
        Promise.all(
          groups.map(group =>
            boundedGetDocs(
              query(collection(db, "servicecenters", centerId, "invoices"), where("serviceId", "in", group)),
            ),
          ),
        ),
        // What the per-service commission module actually recorded for this
        // person this month. Nothing is read when the center doesn't run the
        // module, and a rules refusal is not fatal — the rate path below still
        // produces a payslip.
        commissionEnabled
          ? fetchStaffCommissionForMonth(centerId, staff.id, month).catch(() => [])
          : Promise.resolve([]),
      ]);
      if (cancelled) return;
      let revenue = 0;
      for (const snap of snaps) {
        snap.forEach(d => {
          if (d.data().isDeleted) return;
          revenue += (d.data().grandTotal as number) ?? 0;
        });
      }
      setJobRevenue(revenue);

      const earned = sumCommission(logs);
      setLedgerEntries(toPayslipEntries(logs));
      setLedgerTotal(earned);
      if (logs.length > 0) {
        // The ledger is the money this person actually earned, service by
        // service — it replaces the flat rate rather than adding to it.
        setCommissionRate(undefined);
        setCommissionAmount(earned);
      } else {
        // The employee's own commission rate wins over their role's, the same
        // way their salary does.
        setCommissionRate(defaultCommissionRate);
        setCommissionAmount(
          defaultCommissionRate ? Math.round(revenue * (defaultCommissionRate / 100)) : 0,
        );
      }
      setLoadingCommission(false);
    })().catch(() => setLoadingCommission(false));
    return () => { cancelled = true; };
    // monthJobIdsKey stands in for the job id array itself, which is a new
    // reference on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    centerId, staff.id, month, commissionEnabled, modulesLoading,
    monthJobIdsKey, defaultCommissionRate,
  ]);

  // Working days follow the center's schedule, so a Sunday-open workshop
  // isn't docked for the days it actually works.
  const attendanceStats = computeAttendanceStats(attendanceDays, year, monthIdx, schedule);
  const attendanceExtras = summariseMonthRecords(attendanceRecords, otSettings);
  // Services this employee did. The ledger counts exactly the lines they
  // earned on; without it, the services listed on their completed jobs.
  const totalServices = ledgerEntries.length > 0 ? ledgerEntries.length : jobServices;
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

  // The ledger paid this payslip as long as its entries are still the figure on
  // screen; typing over the amount makes it a manual override, and the slip
  // says so rather than claiming a breakdown that no longer adds up.
  const fromLedger = ledgerEntries.length > 0 && commissionAmount === ledgerTotal;

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
          commissionSource: fromLedger ? "ledger" : "rate",
          commissionEntries: fromLedger ? ledgerEntries : [],
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
          totalServices,
          totalHours: Number(jobHours.toFixed(1)),
          // Hours actually clocked, from attendance — the figure an employee
          // checks their pay against, which the job-duration total above is
          // not (it counts a car left overnight, and counts a crewed job in
          // full for every member of the crew).
          hoursWorked: attendanceExtras.workedHours,
          daysWithTimes: attendanceExtras.daysWithTimes,
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
      // doesn't deduct the same money twice. A failure here is money: the
      // advance came off this payslip but is still outstanding, so it would
      // come off again next month. It is never swallowed — the payslip is
      // saved either way, and whoever generated it is told which ones to
      // settle by hand.
      const unmarked = (await Promise.all(appliedDeductions.map(async (d) => {
        try {
          await safeUpdateDoc(
            doc(db, "servicecenters", centerId, "staff", staff.id, "deductions", d.id),
            { appliedPayslipId: ref.id, appliedAt: Timestamp.now() },
          );
          return null;
        } catch {
          return d;
        }
      }))).filter((d): d is StaffDeduction => d !== null);

      if (unmarked.length > 0) {
        setCreatedPayslipId(ref.id);
        setUnmarkedDeductions(unmarked);
        return;
      }
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
              onChange={(e) => {
                setMonth(e.target.value);
                setLoadingPay(true);
                setLoadingCommission(true);
              }}
              className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
            />
          </div>

          {/* Monthly summary snapshot */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <SummaryTile label="Attendance" value={loadingStats ? "…" : `${attendanceStats.rate}%`} />
            <SummaryTile label="Days Present" value={loadingStats ? "…" : String(attendanceStats.daysPresent)} />
            <SummaryTile label="Days Late" value={loadingStats ? "…" : String(attendanceExtras.daysLate)} />
            <SummaryTile label="Jobs" value={loadingStats ? "…" : String(monthJobs.length)} />
            <SummaryTile label="Services" value={loadingStats ? "…" : String(totalServices)} />
            {/* Clocked hours and bay hours are different measurements and are
                shown as two tiles rather than one ambiguous "Total Hours". */}
            <SummaryTile
              label="Hours Worked"
              value={loadingStats ? "…" : `${attendanceExtras.workedHours.toFixed(1)}h`}
              hint={
                attendanceExtras.daysWithTimes
                  ? `clocked over ${attendanceExtras.daysWithTimes} day${attendanceExtras.daysWithTimes === 1 ? "" : "s"}`
                  : "no clock times marked"
              }
            />
            <SummaryTile
              label="Job Hours"
              value={loadingStats ? "…" : `${jobHours.toFixed(1)}h`}
              hint="time their jobs were open"
            />
            {/* The hours being paid, not the raw attendance figure — an
                adjustment typed below has to show here too. */}
            <SummaryTile label="OT Hours" value={loadingStats ? "…" : `${otHours}h`} />
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
                  : ledgerEntries.length > 0
                    ? `${ledgerEntries.length} service${ledgerEntries.length === 1 ? "" : "s"} earned on`
                    : `${monthJobIds.length} job${monthJobIds.length === 1 ? "" : "s"} completed · ${
                        jobRevenue ? `LKR ${jobRevenue.toLocaleString()} invoiced` : "nothing invoiced yet"
                      }`}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* The rate is the fallback for centers not running the
                  per-service module. Where the ledger has entries it is hidden
                  outright: offering a second way to price the same work is how
                  a payslip ends up paying it twice. */}
              {ledgerEntries.length === 0 && (
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
              )}
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
                  {fromLedger
                    ? "Per-service commission"
                    : commissionRate
                      ? `${commissionRate}% × LKR ${jobRevenue.toLocaleString()}`
                      : "Set by hand"}
                </div>
              </div>
            </div>

            {/* Service by service, so the figure on the payslip can be checked
                against the jobs that earned it rather than trusted. */}
            {ledgerEntries.length > 0 && (
              <div className="mt-3 bg-[#0B1120] border border-white/5 rounded-lg divide-y divide-white/5">
                {ledgerEntries.map((e, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <span className="text-sm text-gray-300 truncate">{e.serviceName}</span>
                      {e.jobNumber && <span className="text-[11px] text-gray-600 ml-2">{e.jobNumber}</span>}
                      {e.isOverride && <span className="text-[11px] text-gray-600 ml-2">override</span>}
                    </div>
                    <span className="text-sm text-orange-300 flex-shrink-0">
                      LKR {e.amount.toLocaleString()}
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="text-xs text-gray-500 uppercase tracking-wider">Earned this month</span>
                  <span className="text-sm font-semibold text-white">LKR {ledgerTotal.toLocaleString()}</span>
                </div>
              </div>
            )}
            {ledgerEntries.length > 0 && !fromLedger && (
              <button
                type="button"
                onClick={() => setCommissionAmount(ledgerTotal)}
                className="text-[11px] text-orange-400 hover:text-orange-300 mt-2"
              >
                Amount edited by hand — restore LKR {ledgerTotal.toLocaleString()} from the ledger
              </button>
            )}
            {!loadingStats && ledgerEntries.length === 0 && commissionEnabled && (
              <p className="text-[11px] text-gray-600 mt-2">
                No per-service commission recorded for {staff.fullName} this month. It appears here
                automatically once a job naming them on a service is marked done.
              </p>
            )}
            {!loadingStats && ledgerEntries.length === 0 && !commissionEnabled && !commissionRate && (
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

          {unmarkedDeductions.length > 0 && createdPayslipId && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-2">
              <p className="text-sm font-semibold text-amber-300">
                Payslip saved — {unmarkedDeductions.length} advance
                {unmarkedDeductions.length === 1 ? "" : "s"} could not be marked as recovered
              </p>
              <p className="text-xs text-amber-200/80">
                {unmarkedDeductions.map((d) => deductionLabel(d)).join(", ")} came off this payslip
                but {unmarkedDeductions.length === 1 ? "is" : "are"} still showing as outstanding, so
                the next payslip would deduct the same money again. Delete
                {unmarkedDeductions.length === 1 ? " it" : " them"} on {staff.fullName}'s profile, or
                untick {unmarkedDeductions.length === 1 ? "it" : "them"} next month.
              </p>
              <button
                onClick={() => onCreated(createdPayslipId)}
                className="text-xs font-semibold text-amber-200 underline underline-offset-2"
              >
                Open the payslip
              </button>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 rounded-lg transition text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !!createdPayslipId}
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

function SummaryTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-[#0B1120] rounded-xl px-3 py-2.5 border border-white/5">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className="text-sm font-bold text-white mt-0.5">{value}</p>
      {hint && <p className="text-[10px] text-gray-600 mt-0.5 truncate">{hint}</p>}
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
