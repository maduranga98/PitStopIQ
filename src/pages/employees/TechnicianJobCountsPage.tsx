import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection, getDocs, query, where, Timestamp,
} from "firebase/firestore";
import { ArrowLeft, ChevronLeft, ChevronRight, Wrench } from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type { StaffMember } from "../../types/auth";
import { jobTechnicianIds, jobTechnicianNames } from "../../lib/jobTechnicians";
import { LoadingBlock } from "../../components/LoadingProgress";
import PageHeader from "../../components/layout/PageHeader";

interface JobDoc {
  technicianId?: string;
  technicianName?: string;
  technicianIds?: string[];
  technicianNames?: string[];
  status: string;
  completedAt?: Timestamp;
}

function monthStart(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function monthEnd(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 1, 1); }

export default function TechnicianJobCountsPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const centerId = currentUser?.centerId ?? "";
  const role = currentUser?.role;
  const canAccess = role === "Owner" || role === "Manager";

  const [month, setMonth] = useState(() => monthStart(new Date()));
  const [technicians, setTechnicians] = useState<StaffMember[]>([]);
  const [jobs, setJobs] = useState<JobDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!centerId) return;
    getDocs(query(collection(db, "servicecenters", centerId, "staff"), where("role", "==", "Technician")))
      .then((snap) => setTechnicians(snap.docs.map((d) => ({ id: d.id, ...d.data() } as StaffMember))));
  }, [centerId]);

  useEffect(() => {
    if (!centerId) return;
    setLoading(true);
    const start = Timestamp.fromDate(monthStart(month));
    const end = Timestamp.fromDate(monthEnd(month));
    getDocs(
      query(
        collection(db, "servicecenters", centerId, "jobs"),
        where("completedAt", ">=", start),
        where("completedAt", "<", end),
      ),
    ).then((snap) => {
      setJobs(snap.docs.map((d) => d.data() as JobDoc).filter((j) => j.status === "done" || j.status === "delivered"));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [centerId, month]);

  const rows = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>();
    technicians.forEach((t) => counts.set(t.id, { name: t.fullName, count: 0 }));
    jobs.forEach((j) => {
      const ids = jobTechnicianIds(j);
      const names = jobTechnicianNames(j);
      const n = Math.max(ids.length, names.length);
      for (let i = 0; i < n; i++) {
        const id = ids[i] || names[i];
        const name = names[i] || "Unassigned";
        const entry = counts.get(id) ?? { name, count: 0 };
        entry.count += 1;
        counts.set(id, entry);
      }
    });
    return Array.from(counts.values()).sort((a, b) => b.count - a.count);
  }, [technicians, jobs]);

  const totalJobs = rows.reduce((s, r) => s + r.count, 0);

  if (!canAccess) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <Wrench className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">You don't have permission to view this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120]">
      <PageHeader
        icon={<Wrench className="w-5 h-5" />}
        title="Technician Job Counts"
        actions={
          <button
            onClick={() => navigate("/employees")}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Employees
          </button>
        }
      />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

        {/* Month nav */}
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-4 flex items-center justify-between">
          <button
            onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
            className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex flex-col items-center">
            <span className="text-sm font-medium text-white">
              {month.toLocaleDateString("en-LK", { month: "long", year: "numeric" })}
            </span>
            <button
              onClick={() => setMonth(monthStart(new Date()))}
              className="text-xs text-orange-400 hover:text-orange-300 mt-0.5"
            >
              This Month
            </button>
          </div>
          <button
            onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
            className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Table */}
        <div className="bg-[#162032] border border-white/10 rounded-2xl overflow-hidden">
          {loading ? (
            <LoadingBlock className="py-16" />
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-center">
              <Wrench className="w-10 h-10 text-gray-600 mb-3" />
              <p className="text-gray-400 text-sm">No technicians or completed jobs for this month.</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-xs font-medium text-gray-500 px-6 py-3">#</th>
                  <th className="text-left text-xs font-medium text-gray-500 px-6 py-3">Technician</th>
                  <th className="text-right text-xs font-medium text-gray-500 px-6 py-3">Jobs Completed</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.name}-${i}`} className="border-b border-white/5">
                    <td className="px-6 py-3 text-xs text-gray-600">{i + 1}</td>
                    <td className="px-6 py-3 text-sm text-white font-medium">{r.name}</td>
                    <td className="px-6 py-3 text-sm text-[#F97316] font-bold text-right">{r.count}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-white/10">
                  <td colSpan={2} className="px-6 py-3 text-xs text-gray-500 uppercase tracking-wider">Total</td>
                  <td className="px-6 py-3 text-sm text-white font-bold text-right">{totalJobs}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
