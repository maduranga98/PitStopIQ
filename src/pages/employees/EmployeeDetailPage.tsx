import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  doc, collection, Timestamp, where, query, orderBy, limit,
} from "firebase/firestore";
import { watchDoc, watchQuery } from "../../lib/listeners";
import { boundedGetDoc, boundedGetDocs } from "../../lib/firestoreRead";
import { safeUpdateDoc } from "../../lib/firestoreWrite";
import { httpsCallable } from "firebase/functions";
import {
  Edit2, UserCheck, UserX, Trash2, AlertTriangle,
  Wrench, Calendar, TrendingUp, TrendingDown, Minus,
  Clock, Wallet, Plus, Download, Network, Loader2,
} from "lucide-react";
import { db, functions } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { logAuditEvent } from "../../lib/auditLog";
import { callableErrorMessage } from "../../lib/callableError";
import { usePermission } from "../../contexts/PermissionsContext";
import { assignStaffDepartment } from "../../lib/departments";
import type {
  Department, StaffMember, AttendanceStatus, AttendanceDayRecord, OvertimeSettings, Payslip,
} from "../../types/auth";
import { LoadingBlock } from "../../components/LoadingProgress";
import { yearMonthKey, computeAttendanceStats } from "../../lib/attendanceStats";
import { withOvertimeDefaults, summariseMonthRecords } from "../../lib/overtime";
import { useCenterSchedule } from "../../hooks/useCenterSchedule";
import PayslipGeneratorModal from "./PayslipGeneratorModal";
import DeductionsSection from "../../components/employees/DeductionsSection";
import CommissionSection from "../../components/employees/CommissionSection";
import { useWorkshopModules } from "../../hooks/useWorkshopModules";

// ── Types ──────────────────────────────────────────────────────────────────────
interface JobDoc {
  id: string;
  technicianId: string;
  completedAt?: Timestamp;
  startedAt?: Timestamp;
  status: string;
  plateNumber?: string;
  customerName?: string;
  services?: string[];
}

// ── Constants / Helpers ────────────────────────────────────────────────────────
const ROLE_BADGE: Record<string, string> = {
  Owner:        "bg-purple-500/20 text-purple-300 border border-purple-500/30",
  Manager:      "bg-blue-500/20 text-blue-300 border border-blue-500/30",
  Technician:   "bg-amber-500/20 text-amber-300 border border-amber-500/30",
  Cashier:      "bg-green-500/20 text-green-300 border border-green-500/30",
  Receptionist: "bg-pink-500/20 text-pink-300 border border-pink-500/30",
};

function fmtDate(ts: Timestamp): string {
  return ts.toDate().toLocaleDateString("en-LK", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDuration(start?: Timestamp, end?: Timestamp): string {
  if (!start || !end) return "—";
  const hrs = (end.toMillis() - start.toMillis()) / 3600000;
  return `${hrs.toFixed(1)}h`;
}


// ── Main ───────────────────────────────────────────────────────────────────────
export default function EmployeeDetailPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const { staffId } = useParams<{ staffId: string }>();

  const centerId = currentUser?.centerId ?? "";
  const schedule = useCenterSchedule(centerId);
  const viewerRole = currentUser?.role;
  const canAssignDept = usePermission("departments.assignStaff");
  // Commission setup only exists where the center runs the module. The Owner
  // may set anyone's; a Manager may set the crew's, but not their own and not
  // an Owner's — the same ceiling firestore.rules keeps on this field, so
  // nobody is shown a control that would be rejected on save.
  const { commissionEnabled } = useWorkshopModules(centerId);

  const [staff, setStaff] = useState<StaffMember | null>(null);
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [centerLogoUrl, setCenterLogoUrl] = useState("");
  const [centerName, setCenterName] = useState("");
  const [allJobs, setAllJobs] = useState<JobDoc[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [attendanceDays, setAttendanceDays] = useState<Record<string, AttendanceStatus>>({});
  const [attendanceRecords, setAttendanceRecords] = useState<Record<string, AttendanceDayRecord>>({});
  const [otSettings, setOtSettings] = useState<OvertimeSettings>(() => withOvertimeDefaults(null));
  const [confirmModal, setConfirmModal] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  // Permanent removal, which is not the same action as deactivating and gets
  // its own confirmation saying what it takes with it.
  const [deleteModal, setDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [showPayslipModal, setShowPayslipModal] = useState(false);
  // Department assignment straight from the profile — the roster on the
  // Departments page is the same data, written by the same helper.
  const [departments, setDepartments] = useState<Department[]>([]);
  const [savingDept, setSavingDept] = useState(false);
  const [deptError, setDeptError] = useState("");

  const now = new Date();

  // Load staff real-time
  useEffect(() => {
    if (!centerId || !staffId) return;
    return watchDoc(doc(db, "servicecenters", centerId, "staff", staffId), snap => {
      if (snap.exists()) setStaff({ id: snap.id, ...snap.data() } as StaffMember);
      setLoadingStaff(false);
    },
      // A dead listener must not leave the screen on a spinner: show the
      // empty state instead. The wrapper has already logged the cause.
      () => setLoadingStaff(false),
    );
  }, [centerId, staffId]);

  // Load this staff member's payslips, newest month first.
  useEffect(() => {
    if (!centerId || !staffId) return;
    return watchQuery(
      // Two years of payslips, newest first — enough for every view on this page
      // without growing by 12 billed reads a year, forever.
      query(
        collection(db, "servicecenters", centerId, "staff", staffId, "payslips"),
        orderBy("month", "desc"),
        limit(24),
      ),
      snap => setPayslips(snap.docs.map(d => ({ id: d.id, ...d.data() } as Payslip))),
      { label: "EmployeeDetailPage:payslips" },
    );
  }, [centerId, staffId]);

  // Load center info for logo
  useEffect(() => {
    if (!centerId) return;
    boundedGetDoc(doc(db, "servicecenters", centerId)).then(snap => {
      if (snap.exists()) {
        const d = snap.data();
        setCenterLogoUrl(d.logoUrl ?? "");
        setCenterName(d.name ?? "");
      }
    });
  }, [centerId]);

  // Departments to assign this member into.
  useEffect(() => {
    if (!centerId) return;
    return watchQuery(
      query(collection(db, "servicecenters", centerId, "departments"), orderBy("name")),
      snap => setDepartments(snap.docs.map(d => ({ id: d.id, ...d.data() } as Department))),
      // A dead listener leaves the picker empty rather than breaking the page.
      () => setDepartments([]),
    );
  }, [centerId]);

  // Load only this staff member's jobs — both the ones they led and the ones
  // they were part of the crew on. Firestore can't OR the two fields in one
  // query, so they're fetched separately and merged by id.
  useEffect(() => {
    if (!centerId || !staffId) return;
    const jobs = collection(db, "servicecenters", centerId, "jobs");
    Promise.all([
      boundedGetDocs(query(jobs, where("technicianId", "==", staffId))),
      boundedGetDocs(query(jobs, where("technicianIds", "array-contains", staffId))),
    ]).then(snaps => {
      const byId = new Map<string, JobDoc>();
      snaps.forEach(snap => snap.docs.forEach(d => byId.set(d.id, { id: d.id, ...d.data() } as JobDoc)));
      setAllJobs(Array.from(byId.values()));
      setLoadingJobs(false);
    }).catch(() => setLoadingJobs(false));
  }, [centerId, staffId]);

  // Load the current month's attendance, read-only — marking now happens on
  // the standalone Attendance page (/attendance), not here.
  useEffect(() => {
    if (!centerId || !staffId) return;
    const ym = yearMonthKey(now.getFullYear(), now.getMonth());
    boundedGetDoc(doc(db, "servicecenters", centerId, "staff", staffId, "attendance", ym)).then((snap) => {
      const data = snap.exists()
        ? (snap.data() as { days?: Record<string, AttendanceStatus>; records?: Record<string, AttendanceDayRecord> })
        : {};
      setAttendanceDays(data.days ?? {});
      setAttendanceRecords(data.records ?? {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerId, staffId]);

  // Shift/OT policy, so this month's overtime and late days can be summarised.
  useEffect(() => {
    if (!centerId) return;
    boundedGetDoc(doc(db, "servicecenters", centerId, "payrollSettings", "overtime"))
      .then((snap) => setOtSettings(withOvertimeDefaults(snap.exists() ? (snap.data() as OvertimeSettings) : null)))
      .catch(() => {});
  }, [centerId]);

  // Derived: jobs this month
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const jobsThisMonth = allJobs.filter(j => {
    const ca = j.completedAt;
    return ca && ca.toMillis() >= monthStart.getTime() && ca.toMillis() < monthEnd.getTime();
  });

  // Last month jobs for comparison
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 1);
  const jobsLastMonth = allJobs.filter(j => {
    const ca = j.completedAt;
    return ca && ca.toMillis() >= lastMonthStart.getTime() && ca.toMillis() < lastMonthEnd.getTime();
  });

  const allTimeJobs = allJobs;

  const avgDuration = (() => {
    const withDuration = allTimeJobs.filter(j => j.startedAt && j.completedAt);
    if (withDuration.length === 0) return null;
    const total = withDuration.reduce((sum, j) => sum + (j.completedAt!.toMillis() - j.startedAt!.toMillis()), 0);
    return (total / withDuration.length / 3600000).toFixed(1);
  })();

  // Rate is measured against the center's own working days (Settings →
  // Working Hours), not a fixed Mon–Sat week.
  const attendanceRate = computeAttendanceStats(
    attendanceDays, now.getFullYear(), now.getMonth(), schedule,
  ).rate;
  const monthOvertime = summariseMonthRecords(attendanceRecords, otSettings);

  async function handleToggleActive() {
    if (!centerId || !staffId || !staff) return;
    setDeactivating(true);
    try {
      await safeUpdateDoc(doc(db, "servicecenters", centerId, "staff", staffId), {
        active: !staff.active,
      });
      setConfirmModal(false);
    } finally {
      setDeactivating(false);
    }
  }

  // Removes the member outright: staff record, users-index entry and Firebase
  // Auth login. All three are closed to clients (staff and users are both
  // `allow delete: if false`, and Auth is not Firestore at all), so the work
  // happens in the deleteStaffAccount callable, which re-checks Owner and
  // refuses to delete an Owner or the caller themselves.
  async function handleDelete() {
    if (!centerId || !staffId || !staff) return;
    setDeleteError("");
    setDeleting(true);
    try {
      const deleteStaffAccount = httpsCallable(functions, "deleteStaffAccount");
      await deleteStaffAccount({ centerId, staffId });
      if (currentUser) {
        void logAuditEvent({
          centerId,
          action: "delete",
          entityType: "staff",
          entityId: staffId,
          entityLabel: staff.fullName,
          changes: [{ field: "role", before: staff.role, after: "deleted" }],
          performedBy: currentUser.uid,
          performedByName: currentUser.displayName || currentUser.email || "Unknown",
        });
      }
      // The record this page is built on is gone — the live listener would
      // otherwise leave it on the not-found state.
      navigate("/employees", { replace: true });
    } catch (err) {
      setDeleteError(callableErrorMessage(err, "Could not delete this member."));
      setDeleting(false);
    }
  }

  const canEdit = viewerRole === "Owner";
  const canView = viewerRole === "Owner" || viewerRole === "Manager";

  // A Manager sees the commission setup of everyone they manage and may
  // change it; their own record and the Owner's they can read but not touch,
  // which is exactly what the rules allow — so the section still shows the
  // figures, with the controls locked.
  const canManageCommission = viewerRole === "Owner" || viewerRole === "Manager";
  const canEditCommission = viewerRole === "Owner"
    || (viewerRole === "Manager" && staff?.id !== currentUser?.uid && staff?.role !== "Owner");

  // The roster is authoritative; the staff doc's departmentId is its mirror.
  const currentDeptId =
    departments.find(d => d.memberStaffIds?.includes(staffId ?? ""))?.id ?? staff?.departmentId ?? "";

  async function changeDepartment(nextId: string) {
    if (!staff || nextId === currentDeptId) return;
    setSavingDept(true);
    setDeptError("");
    try {
      await assignStaffDepartment(
        db,
        centerId,
        staff,
        nextId ? departments.find(d => d.id === nextId) ?? null : null,
        departments,
      );
    } catch {
      setDeptError("Couldn't update the department.");
    } finally {
      setSavingDept(false);
    }
  }

  if (loadingStaff) {
    return (
      <div className="min-h-screen bg-[#0B1120]">

        <LoadingBlock className="py-20" />
      </div>
    );
  }

  if (!staff || !canView) {
    return (
      <div className="min-h-screen bg-[#0B1120]">

        <div className="max-w-lg mx-auto px-4 py-20 text-center">
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-8">
            <h2 className="text-xl font-bold text-white mb-2">{!staff ? "Employee Not Found" : "Access Denied"}</h2>
            <p className="text-gray-400 text-sm">{!staff ? "This employee record does not exist." : "You don't have permission to view this page."}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

        {/* Profile Card */}
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-6">
          {/* Center branding */}
          {centerLogoUrl && (
            <div className="flex items-center gap-3 mb-5 pb-4 border-b border-white/10">
              <img src={centerLogoUrl} alt="" className="w-9 h-9 rounded-lg object-contain bg-white/5" />
              <span className="text-sm font-medium text-gray-300">{centerName}</span>
            </div>
          )}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-full bg-[#F97316]/10 flex items-center justify-center flex-shrink-0">
                <span className="text-xl font-bold text-[#F97316]">{staff.fullName.charAt(0).toUpperCase()}</span>
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">{staff.fullName}</h1>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_BADGE[staff.role] ?? ""}`}>{staff.customRoleName ?? staff.role}</span>
                  {staff.active ? (
                    <span className="text-xs font-medium bg-green-500/15 text-green-400 border border-green-500/20 px-2 py-0.5 rounded-full">Active</span>
                  ) : (
                    <span className="text-xs font-medium bg-gray-500/15 text-gray-400 border border-gray-500/20 px-2 py-0.5 rounded-full">Inactive</span>
                  )}
                  {!canAssignDept && (
                    <span className="text-xs font-medium bg-white/5 text-gray-400 border border-white/10 px-2 py-0.5 rounded-full">
                      {staff.departmentName ?? "No department"}
                    </span>
                  )}
                </div>

                {canAssignDept && (
                  <div className="flex items-center gap-2 mt-2">
                    <Network className="h-3.5 w-3.5 text-gray-500 flex-shrink-0" />
                    <select
                      value={currentDeptId}
                      disabled={savingDept || departments.length === 0}
                      onChange={e => changeDepartment(e.target.value)}
                      className="bg-[#0B1120] border border-white/10 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none focus:border-[#F97316]/50 disabled:opacity-50"
                    >
                      <option value="">
                        {departments.length === 0 ? "No departments yet" : "Unassigned"}
                      </option>
                      {departments.map(d => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                    {savingDept && <Loader2 className="h-3.5 w-3.5 text-gray-500 animate-spin" />}
                    {deptError && <span className="text-xs text-red-400">{deptError}</span>}
                  </div>
                )}
              </div>
            </div>
            {canEdit && (
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => navigate(`/employees/${staffId}/edit`)}
                  className="flex items-center gap-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 px-3 py-1.5 rounded-lg transition"
                >
                  <Edit2 className="h-3.5 w-3.5" />
                  Edit
                </button>
                {/* Deactivating the Owner leaves the center with nobody who can
                    pass hasRole(centerId, ['Owner']) — an unrecoverable state
                    from inside the app. The Firestore rules reject it; don't
                    offer the button in the first place. */}
                {staff.role !== "Owner" && (
                  <button
                    onClick={() => setConfirmModal(true)}
                    className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition ${
                      staff.active
                        ? "bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400"
                        : "bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 text-green-400"
                    }`}
                  >
                    {staff.active ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                    {staff.active ? "Deactivate" : "Reactivate"}
                  </button>
                )}
                {/* Same Owner exclusion as Deactivate, and for the same
                    reason — plus the callable refuses it server-side. */}
                {staff.role !== "Owner" && (
                  <button
                    onClick={() => { setDeleteModal(true); setDeleteError(""); }}
                    title="Remove this member permanently"
                    className="flex items-center gap-1.5 text-xs font-medium bg-red-500/10 hover:bg-red-500 border border-red-500/30 hover:border-red-500 text-red-400 hover:text-white px-3 py-1.5 rounded-lg transition"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <InfoField label="Phone" value={staff.phone} />
            <InfoField label="Email" value={staff.email || "—"} />
            <InfoField label="Employee ID" value={staff.employeeId || "—"} />
            <InfoField
              label="Date Joined"
              value={staff.dateJoined ? fmtDate(staff.dateJoined) : "—"}
            />
          </div>

          {staff.notes && (
            <div className="mt-4 bg-[#0B1120] rounded-xl px-4 py-3 border border-white/5">
              <p className="text-xs text-gray-500 mb-1">Notes</p>
              <p className="text-sm text-gray-300">{staff.notes}</p>
            </div>
          )}
        </div>

        {/* Performance Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label="Services This Month"
            value={jobsThisMonth.length}
            comparison={jobsThisMonth.length - jobsLastMonth.length}
            icon={<Wrench className="h-5 w-5 text-[#F97316]" />}
            accent="bg-[#F97316]/10"
          />
          <MetricCard
            label="Services All Time"
            value={allTimeJobs.length}
            icon={<TrendingUp className="h-5 w-5 text-blue-400" />}
            accent="bg-blue-500/10"
          />
          <MetricCard
            label="Avg Job Duration"
            value={avgDuration !== null ? `${avgDuration}h` : "—"}
            icon={<Clock className="h-5 w-5 text-amber-400" />}
            accent="bg-amber-500/10"
          />
          <MetricCard
            label="Attendance Rate"
            value={`${attendanceRate}%`}
            icon={<Calendar className="h-5 w-5 text-green-400" />}
            accent="bg-green-500/10"
          />
        </div>

        {/* Services This Month */}
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-6">
          <h2 className="text-base font-semibold text-white mb-4">Services This Month</h2>
          {loadingJobs ? <LoadingBlock className="py-20" /> : jobsThisMonth.length === 0 ? (
            <div className="flex flex-col items-center py-8 gap-2">
              <Wrench className="h-8 w-8 text-gray-600" />
              <p className="text-sm text-gray-500">No completed services this month.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-left">
                      <th className="pb-3 text-xs font-medium text-gray-500 pr-4">Date</th>
                      <th className="pb-3 text-xs font-medium text-gray-500 pr-4">Plate</th>
                      <th className="pb-3 text-xs font-medium text-gray-500 pr-4">Customer</th>
                      <th className="pb-3 text-xs font-medium text-gray-500 pr-4">Services</th>
                      <th className="pb-3 text-xs font-medium text-gray-500">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobsThisMonth.map(j => (
                      <tr key={j.id} className="border-b border-white/5">
                        <td className="py-3 pr-4 text-gray-400">{j.completedAt ? fmtDate(j.completedAt) : "—"}</td>
                        <td className="py-3 pr-4 font-medium text-white">{j.plateNumber ?? "—"}</td>
                        <td className="py-3 pr-4 text-gray-400">{j.customerName ?? "—"}</td>
                        <td className="py-3 pr-4 text-gray-400">{j.services?.join(", ") ?? "—"}</td>
                        <td className="py-3 text-gray-400">{fmtDuration(j.startedAt, j.completedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div className="bg-[#0B1120] rounded-xl px-4 py-3 border border-white/5">
                  <p className="text-xs text-gray-500">Total Jobs</p>
                  <p className="text-lg font-bold text-white mt-0.5">{jobsThisMonth.length}</p>
                </div>
                <div className="bg-[#0B1120] rounded-xl px-4 py-3 border border-white/5">
                  <p className="text-xs text-gray-500">Avg Duration</p>
                  <p className="text-lg font-bold text-white mt-0.5">
                    {(() => {
                      const withD = jobsThisMonth.filter(j => j.startedAt && j.completedAt);
                      if (!withD.length) return "—";
                      const total = withD.reduce((s, j) => s + j.completedAt!.toMillis() - j.startedAt!.toMillis(), 0);
                      return `${(total / withD.length / 3600000).toFixed(1)}h`;
                    })()}
                  </p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Attendance — marking now happens on the standalone Attendance page */}
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-6 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-base font-semibold text-white">Attendance</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {attendanceRate}% attendance rate this month
              {monthOvertime.workedHours > 0 && ` · ${monthOvertime.workedHours}h clocked`}
              {monthOvertime.otHours > 0 && ` · ${monthOvertime.otHours}h overtime`}
              {monthOvertime.daysLate > 0 && ` · ${monthOvertime.daysLate} late ${monthOvertime.daysLate === 1 ? "arrival" : "arrivals"}`}
            </p>
          </div>
          {(viewerRole === "Owner" || viewerRole === "Manager") && (
            <button
              onClick={() => navigate("/attendance")}
              className="flex items-center gap-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 px-3 py-1.5 rounded-lg transition"
            >
              <Calendar className="h-3.5 w-3.5" />
              Mark Attendance
            </button>
          )}
        </div>

        {/* Commission — what this employee earns per service */}
        {commissionEnabled && canManageCommission && (
          <CommissionSection
            key={staff.id}
            centerId={centerId}
            staff={staff}
            readOnly={!canEditCommission}
          />
        )}

        {/* Deductions — advances and other money owed back, picked up by payroll */}
        <DeductionsSection
          centerId={centerId}
          staff={staff}
          currentUser={currentUser}
          canManage={viewerRole === "Owner" || viewerRole === "Manager"}
        />

        {/* Payslips — generate, customize and view this employee's payroll history */}
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-6">
          <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <Wallet className="h-4 w-4 text-[#F97316]" /> Payslips
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">Generate a customized payslip using this month's attendance and jobs.</p>
            </div>
            {(viewerRole === "Owner" || viewerRole === "Manager") && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => navigate("/settings/payroll")}
                  className="text-xs font-medium text-gray-400 hover:text-white transition"
                >
                  Payroll Settings
                </button>
                <button
                  onClick={() => setShowPayslipModal(true)}
                  className="flex items-center gap-1.5 text-xs font-medium bg-[#F97316] hover:bg-orange-600 text-white px-3 py-1.5 rounded-lg transition"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Generate Payslip
                </button>
              </div>
            )}
          </div>

          {payslips.length === 0 ? (
            <div className="flex flex-col items-center py-8 gap-2">
              <Wallet className="h-8 w-8 text-gray-600" />
              <p className="text-sm text-gray-500">No payslips generated yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {payslips.map(p => (
                <button
                  key={p.id}
                  onClick={() => navigate(`/employees/${staffId}/payslips/${p.id}`)}
                  className="w-full flex items-center justify-between gap-4 py-3 text-left hover:bg-white/5 rounded-lg px-2 -mx-2 transition"
                >
                  <div>
                    <p className="text-sm font-medium text-white">
                      {new Date(`${p.month}-01T00:00:00`).toLocaleDateString("en-LK", { month: "long", year: "numeric" })}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {p.status === "draft" ? "Draft" : "Finalized"} · Net LKR {p.netPay.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <Download className="h-4 w-4 text-gray-500" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {showPayslipModal && staff && (
        <PayslipGeneratorModal
          centerId={centerId}
          staff={staff}
          allJobs={allJobs}
          createdBy={currentUser?.uid ?? ""}
          createdByName={currentUser?.displayName ?? ""}
          onClose={() => setShowPayslipModal(false)}
          onCreated={(id) => { setShowPayslipModal(false); navigate(`/employees/${staffId}/payslips/${id}`); }}
        />
      )}

      {/* Deactivate Confirm Modal */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmModal(false)} />
          <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-semibold text-white mb-2">
              {staff.active ? "Deactivate Employee?" : "Reactivate Employee?"}
            </h3>
            <p className="text-sm text-gray-400 mb-5">
              {staff.active
                ? `${staff.fullName} will be marked as inactive and cannot log in.`
                : `${staff.fullName} will be reactivated and can log in again.`}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmModal(false)}
                className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 px-4 rounded-lg transition text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleToggleActive}
                disabled={deactivating}
                className={`flex-1 font-semibold py-2.5 px-4 rounded-lg transition text-sm flex items-center justify-center gap-2 ${
                  staff.active
                    ? "bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white"
                    : "bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white"
                }`}
              >
                {deactivating ? (
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : null}
                {staff.active ? "Deactivate" : "Reactivate"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permanent delete confirm modal */}
      {deleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !deleting && setDeleteModal(false)} />
          <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-red-500/15 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-white leading-tight">Delete permanently?</h3>
                <p className="text-xs text-gray-400 mt-0.5 truncate">
                  {staff.fullName} · {staff.customRoleName ?? staff.role}
                </p>
              </div>
            </div>
            <p className="text-sm text-gray-300 mb-2">
              This removes {staff.fullName}'s record and their login for good. They will not be able
              to sign in, and their attendance, payslips, advances and commission setup are deleted
              with them. This cannot be undone.
            </p>
            <p className="text-xs text-gray-500 mb-5">
              To keep the record and only block access, use Deactivate instead — that can be reversed.
            </p>
            {deleteError && <p className="text-xs text-red-400 mb-4">{deleteError}</p>}
            <div className="flex gap-3">
              <button
                onClick={() => { setDeleteModal(false); setDeleteError(""); }}
                disabled={deleting}
                className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 px-4 rounded-lg transition text-sm disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white font-semibold py-2.5 px-4 rounded-lg transition text-sm flex items-center justify-center gap-2"
              >
                {deleting ? (
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : <Trash2 className="h-3.5 w-3.5" />}
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm font-medium text-white mt-0.5">{value}</p>
    </div>
  );
}

function MetricCard({ label, value, comparison, icon, accent }: {
  label: string;
  value: string | number;
  comparison?: number;
  icon: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="bg-[#162032] border border-white/10 rounded-2xl p-5">
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2.5 rounded-xl ${accent ?? "bg-[#F97316]/10"}`}>
          {icon}
        </div>
        {comparison !== undefined && (
          <div className={`flex items-center gap-1 text-xs font-medium ${
            comparison > 0 ? "text-green-400" : comparison < 0 ? "text-red-400" : "text-gray-500"
          }`}>
            {comparison > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : comparison < 0 ? <TrendingDown className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
            {comparison > 0 ? `+${comparison}` : comparison}
          </div>
        )}
      </div>
      <div className="text-2xl font-bold text-white mb-0.5">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

