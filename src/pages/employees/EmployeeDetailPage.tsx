import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  doc, onSnapshot, getDoc,
  collection, getDocs, Timestamp,
  where, query,
} from "firebase/firestore";
import { safeUpdateDoc } from "../../lib/firestoreWrite";
import {
  Edit2, UserCheck, UserX,
  Wrench, Calendar, TrendingUp, TrendingDown, Minus,
  Clock,
} from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type { StaffMember, AttendanceStatus } from "../../types/auth";
import { LoadingBlock } from "../../components/LoadingProgress";

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

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function yearMonthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function computeAttendanceRate(days: Record<string, AttendanceStatus>, year: number, month: number): number {
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const lastDay = isCurrentMonth ? today.getDate() : daysInMonth(year, month);

  let working = 0;
  let score = 0;
  for (let d = 1; d <= lastDay; d++) {
    const date = new Date(year, month, d);
    if (date.getDay() === 0) continue;
    const key = dateKey(year, month, d);
    const status = days[key] as AttendanceStatus | undefined;
    if (status === "holiday") continue;
    working++;
    if (status === "present") score += 1;
    else if (status === "half_day") score += 0.5;
  }
  if (working === 0) return 0;
  return Math.round((score / working) * 100);
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function EmployeeDetailPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const { staffId } = useParams<{ staffId: string }>();

  const centerId = currentUser?.centerId ?? "";
  const viewerRole = currentUser?.role;

  const [staff, setStaff] = useState<StaffMember | null>(null);
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [centerLogoUrl, setCenterLogoUrl] = useState("");
  const [centerName, setCenterName] = useState("");
  const [allJobs, setAllJobs] = useState<JobDoc[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [attendanceDays, setAttendanceDays] = useState<Record<string, AttendanceStatus>>({});
  const [confirmModal, setConfirmModal] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  const now = new Date();

  // Load staff real-time
  useEffect(() => {
    if (!centerId || !staffId) return;
    return onSnapshot(doc(db, "servicecenters", centerId, "staff", staffId), snap => {
      if (snap.exists()) setStaff({ id: snap.id, ...snap.data() } as StaffMember);
      setLoadingStaff(false);
    });
  }, [centerId, staffId]);

  // Load center info for logo
  useEffect(() => {
    if (!centerId) return;
    getDoc(doc(db, "servicecenters", centerId)).then(snap => {
      if (snap.exists()) {
        const d = snap.data();
        setCenterLogoUrl(d.logoUrl ?? "");
        setCenterName(d.name ?? "");
      }
    });
  }, [centerId]);

  // Load only this staff member's jobs — both the ones they led and the ones
  // they were part of the crew on. Firestore can't OR the two fields in one
  // query, so they're fetched separately and merged by id.
  useEffect(() => {
    if (!centerId || !staffId) return;
    const jobs = collection(db, "servicecenters", centerId, "jobs");
    Promise.all([
      getDocs(query(jobs, where("technicianId", "==", staffId))),
      getDocs(query(jobs, where("technicianIds", "array-contains", staffId))),
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
    getDoc(doc(db, "servicecenters", centerId, "staff", staffId, "attendance", ym)).then((snap) => {
      setAttendanceDays(snap.exists() ? (snap.data() as { days: Record<string, AttendanceStatus> }).days ?? {} : {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerId, staffId]);

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

  const attendanceRate = computeAttendanceRate(attendanceDays, now.getFullYear(), now.getMonth());

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

  const canEdit = viewerRole === "Owner";
  const canView = viewerRole === "Owner" || viewerRole === "Manager";

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
                </div>
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
            <p className="text-xs text-gray-500 mt-0.5">{attendanceRate}% attendance rate this month</p>
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
      </div>

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

