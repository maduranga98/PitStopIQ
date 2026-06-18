import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection, onSnapshot, orderBy, query, getDocs,
  doc, getDoc, Timestamp,
} from "firebase/firestore";
import { Users, Plus, Search, ChevronRight } from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type { StaffMember, UserRole } from "../../types/auth";

// ── Types ──────────────────────────────────────────────────────────────────────
interface JobDoc {
  technicianId: string;
  completedAt?: Timestamp;
  status: string;
}

interface AttendanceDoc {
  days: Record<string, string>;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const ROLE_BADGE: Record<string, string> = {
  Owner:        "bg-purple-500/20 text-purple-300 border border-purple-500/30",
  Manager:      "bg-blue-500/20 text-blue-300 border border-blue-500/30",
  Technician:   "bg-amber-500/20 text-amber-300 border border-amber-500/30",
  Cashier:      "bg-green-500/20 text-green-300 border border-green-500/30",
  Receptionist: "bg-pink-500/20 text-pink-300 border border-pink-500/30",
};

const FILTER_TABS: Array<"All" | UserRole> = ["All", "Technician", "Manager", "Cashier", "Receptionist"];

function nowYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function nowMonthStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function nowMonthEnd() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

function computeAttendanceRate(days: Record<string, string>): number {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();

  let working = 0;
  let score = 0;

  for (let d = 1; d <= today; d++) {
    const date = new Date(year, month, d);
    if (date.getDay() === 0) continue; // skip Sundays
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const status = days[key];
    if (status === "holiday") continue;
    working++;
    if (status === "present") score += 1;
    else if (status === "half_day") score += 0.5;
  }

  if (working === 0) return 0;
  return Math.round((score / working) * 100);
}

// ── Spinner ────────────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <svg className="animate-spin h-8 w-8 text-[#F97316]" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function EmployeeListPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const centerId = currentUser?.centerId ?? "";

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [jobsThisMonth, setJobsThisMonth] = useState<JobDoc[]>([]);
  const [attendance, setAttendance] = useState<Record<string, AttendanceDoc>>({});
  const [loadingPlan, setLoadingPlan] = useState(true);
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [search, setSearch] = useState("");
  const [filterTab, setFilterTab] = useState<"All" | UserRole>("All");

  // Mark loading done (no plan check needed)
  useEffect(() => {
    setLoadingPlan(false);
  }, []);

  // Real-time staff
  useEffect(() => {
    if (!centerId) return;
    const q = query(
      collection(db, "servicecenters", centerId, "staff"),
      orderBy("fullName")
    );
    const unsub = onSnapshot(q, snap => {
      setStaff(snap.docs.map(d => ({ id: d.id, ...d.data() } as StaffMember)));
      setLoadingStaff(false);
    });
    return unsub;
  }, [centerId]);

  // Load this month's jobs once
  useEffect(() => {
    if (!centerId) return;
    const start = Timestamp.fromDate(nowMonthStart());
    const end = Timestamp.fromDate(nowMonthEnd());
    getDocs(collection(db, "servicecenters", centerId, "jobs")).then(snap => {
      const jobs: JobDoc[] = [];
      snap.docs.forEach(d => {
        const data = d.data() as JobDoc;
        const ca = data.completedAt;
        if (ca && ca.toMillis() >= start.toMillis() && ca.toMillis() < end.toMillis()) {
          jobs.push(data);
        }
      });
      setJobsThisMonth(jobs);
    });
  }, [centerId]);

  // Load attendance docs for each staff member
  useEffect(() => {
    if (!centerId || staff.length === 0) return;
    const ym = nowYearMonth();
    const promises = staff.map(s =>
      getDoc(doc(db, "servicecenters", centerId, "staff", s.id, "attendance", ym)).then(snap => ({
        id: s.id,
        data: snap.exists() ? (snap.data() as AttendanceDoc) : { days: {} },
      }))
    );
    Promise.all(promises).then(results => {
      const map: Record<string, AttendanceDoc> = {};
      results.forEach(r => { map[r.id] = r.data; });
      setAttendance(map);
    });
  }, [centerId, staff]);

  // Compute metrics per staff
  const metricsMap = useMemo(() => {
    const map: Record<string, { services: number; attendanceRate: number }> = {};
    staff.forEach(s => {
      const services = jobsThisMonth.filter(j => j.technicianId === s.id).length;
      const att = attendance[s.id];
      const attendanceRate = att ? computeAttendanceRate(att.days) : 0;
      map[s.id] = { services, attendanceRate };
    });
    return map;
  }, [staff, jobsThisMonth, attendance]);

  // Filtered list
  const filtered = useMemo(() => {
    return staff.filter(s => {
      const matchSearch = s.fullName.toLowerCase().includes(search.toLowerCase());
      const matchTab = filterTab === "All" || s.role === filterTab;
      return matchSearch && matchTab;
    });
  }, [staff, search, filterTab]);

  const role = currentUser?.role;
  const isOwner = role === "Owner";
  const canAccess = role === "Owner" || role === "Manager";

  if (loadingPlan) return (
    <div className="min-h-screen bg-[#0B1120]">
      <Spinner />
    </div>
  );

  if (!canAccess) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <Users className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">You don't have permission to view Employee Management.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120]">


      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Users className="h-6 w-6 text-[#F97316]" />
              <h1 className="text-2xl font-bold text-white">Employees</h1>
            </div>
            <p className="text-sm text-gray-500 mt-1">{staff.length} staff member{staff.length !== 1 ? "s" : ""}</p>
          </div>
          {isOwner && (
            <button
              onClick={() => navigate("/employees/add")}
              className="flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold px-4 py-2 rounded-lg transition text-sm"
            >
              <Plus className="h-4 w-4" />
              Add Employee
            </button>
          )}
        </div>

        {/* Search + Filter */}
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name…"
              className="w-full bg-[#162032] border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#F97316]/40"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {FILTER_TABS.map(tab => (
              <button
                key={tab}
                onClick={() => setFilterTab(tab)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  filterTab === tab
                    ? "bg-[#F97316] text-white"
                    : "bg-[#162032] text-gray-400 border border-white/10 hover:text-white"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        {loadingStaff ? <Spinner /> : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block bg-[#162032] border border-white/10 rounded-2xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left text-xs font-medium text-gray-500 px-6 py-3">Name</th>
                    <th className="text-left text-xs font-medium text-gray-500 px-6 py-3">Role</th>
                    <th className="text-left text-xs font-medium text-gray-500 px-6 py-3">Services This Month</th>
                    <th className="text-left text-xs font-medium text-gray-500 px-6 py-3">Attendance Rate</th>
                    <th className="text-left text-xs font-medium text-gray-500 px-6 py-3">Status</th>
                    <th className="px-6 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center text-gray-500 text-sm py-12">
                        No employees found.
                      </td>
                    </tr>
                  ) : filtered.map(s => {
                    const m = metricsMap[s.id] ?? { services: 0, attendanceRate: 0 };
                    return (
                      <tr
                        key={s.id}
                        onClick={() => navigate(`/employees/${s.id}`)}
                        className="border-b border-white/5 hover:bg-white/5 cursor-pointer transition"
                      >
                        <td className="px-6 py-4">
                          <p className="text-sm font-semibold text-white">{s.fullName}</p>
                          <p className="text-xs text-gray-500">{s.email}</p>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_BADGE[s.role] ?? ""}`}>
                            {s.role}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-white">{m.services}</td>
                        <td className="px-6 py-4 text-sm text-white">{m.attendanceRate}%</td>
                        <td className="px-6 py-4">
                          {s.active ? (
                            <span className="text-xs font-medium bg-green-500/15 text-green-400 border border-green-500/20 px-2 py-0.5 rounded-full">Active</span>
                          ) : (
                            <span className="text-xs font-medium bg-gray-500/15 text-gray-400 border border-gray-500/20 px-2 py-0.5 rounded-full">Inactive</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <ChevronRight className="h-4 w-4 text-gray-500 ml-auto" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {filtered.length === 0 ? (
                <div className="text-center text-gray-500 text-sm py-12">No employees found.</div>
              ) : filtered.map(s => {
                const m = metricsMap[s.id] ?? { services: 0, attendanceRate: 0 };
                return (
                  <button
                    key={s.id}
                    onClick={() => navigate(`/employees/${s.id}`)}
                    className="w-full bg-[#162032] border border-white/10 rounded-2xl p-4 text-left hover:border-[#F97316]/30 transition"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{s.fullName}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{s.email}</p>
                      </div>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${ROLE_BADGE[s.role] ?? ""}`}>
                        {s.role}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-3">
                      <div>
                        <p className="text-xs text-gray-500">Services</p>
                        <p className="text-sm font-semibold text-white">{m.services}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Attendance</p>
                        <p className="text-sm font-semibold text-white">{m.attendanceRate}%</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Status</p>
                        {s.active ? (
                          <span className="text-xs font-medium text-green-400">Active</span>
                        ) : (
                          <span className="text-xs font-medium text-gray-500">Inactive</span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

