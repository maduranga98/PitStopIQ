import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { collection, query, onSnapshot, orderBy } from "firebase/firestore";
import { Plus, Wrench, Clock, ChevronDown } from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type { ServiceJob } from "../../types/auth";

function timeAgo(ts: { toDate: () => Date }): string {
  const diff = Date.now() - ts.toDate().getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)} days ago`;
}

const COLUMNS: { key: ServiceJob["status"]; label: string; headerBg: string; borderColor: string }[] = [
  { key: "pending",     label: "Pending",     headerBg: "bg-slate-600",  borderColor: "border-slate-500" },
  { key: "in_progress", label: "In Progress", headerBg: "bg-amber-500",  borderColor: "border-amber-500" },
  { key: "done",        label: "Done",        headerBg: "bg-green-600",  borderColor: "border-green-500" },
  { key: "delivered",   label: "Delivered",   headerBg: "bg-blue-700",   borderColor: "border-blue-500"  },
];

type DateFilter = "today" | "week" | "all";

function isToday(ts: { toDate: () => Date }): boolean {
  const d = ts.toDate();
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function isThisWeek(ts: { toDate: () => Date }): boolean {
  const d = ts.toDate();
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);
  return d >= weekStart;
}

export default function ServicesPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const [jobs, setJobs] = useState<ServiceJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [techFilter, setTechFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("today");

  useEffect(() => {
    if (!currentUser?.centerId) return;
    const q = query(
      collection(db, "servicecenters", currentUser.centerId, "jobs"),
      orderBy("createdAt", "desc"),
    );
    return onSnapshot(q, (snap) => {
      setJobs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ServiceJob)));
      setLoading(false);
    });
  }, [currentUser?.centerId]);

  const technicians = useMemo(() => {
    const names = Array.from(new Set(jobs.map((j) => j.technicianName)));
    return names.sort();
  }, [jobs]);

  const filtered = useMemo(() => {
    return jobs.filter((j) => {
      if (currentUser?.role === "Technician") {
        if (j.technicianId !== currentUser.uid) return false;
      } else if (techFilter !== "all" && j.technicianName !== techFilter) {
        return false;
      }
      if (dateFilter === "today" && !isToday(j.createdAt)) return false;
      if (dateFilter === "week" && !isThisWeek(j.createdAt)) return false;
      return true;
    });
  }, [jobs, techFilter, dateFilter, currentUser]);

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      {/* Header */}
      <div className="border-b border-white/10 bg-[#162032]">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Wrench className="w-5 h-5 text-orange-500" />
            <h1 className="text-lg font-semibold">Active Services</h1>
          </div>
          <button
            onClick={() => navigate("/services/new")}
            className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Service
          </button>
        </div>

        {/* Filter bar */}
        <div className="max-w-7xl mx-auto px-4 pb-3 flex flex-wrap items-center gap-3">
          {/* Date filter */}
          <div className="flex bg-white/5 rounded-lg p-0.5 gap-0.5">
            {(["today", "week", "all"] as DateFilter[]).map((d) => (
              <button
                key={d}
                onClick={() => setDateFilter(d)}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                  dateFilter === d ? "bg-orange-500 text-white" : "text-gray-400 hover:text-white"
                }`}
              >
                {d === "today" ? "Today" : d === "week" ? "This Week" : "All"}
              </button>
            ))}
          </div>

          {/* Technician filter (hidden for Technician role — they always see their own jobs) */}
          {currentUser?.role !== "Technician" && (
            <div className="relative">
              <select
                value={techFilter}
                onChange={(e) => setTechFilter(e.target.value)}
                className="appearance-none bg-white/5 border border-white/10 text-white rounded-lg px-3 py-1.5 pr-8 text-sm focus:outline-none focus:border-orange-500"
              >
                <option value="all">All Technicians</option>
                {technicians.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          )}

        </div>
      </div>

      {/* Kanban board */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {loading ? (
          <div className="text-center text-gray-400 py-20">Loading...</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {COLUMNS.map((col) => {
              const colJobs = filtered.filter((j) => j.status === col.key);
              return (
                <div key={col.key} className="flex flex-col gap-3">
                  {/* Column header */}
                  <div className={`${col.headerBg} rounded-lg px-3 py-2 flex items-center justify-between`}>
                    <span className="text-sm font-semibold text-white">{col.label}</span>
                    <span className="text-xs bg-black/20 text-white px-2 py-0.5 rounded-full">{colJobs.length}</span>
                  </div>

                  {/* Cards */}
                  {colJobs.length === 0 ? (
                    <div className="text-center text-gray-600 text-sm py-8 border border-dashed border-white/10 rounded-lg">
                      No jobs
                    </div>
                  ) : (
                    colJobs.map((job) => (
                      <div
                        key={job.id}
                        onClick={() => navigate(`/services/${job.id}`)}
                        className={`bg-[#162032] border border-white/10 border-l-4 ${col.borderColor} rounded-lg p-3 cursor-pointer hover:bg-white/5 transition-colors`}
                      >
                        <div className="font-bold text-white text-sm">{job.plateNumber}</div>
                        <div className="text-gray-300 text-sm mt-0.5">{job.customerName}</div>
                        <div className="text-gray-400 text-xs mt-1">
                          {job.services[0] ?? job.customServices[0] ?? "—"}
                        </div>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-xs text-gray-500">{job.technicianName}</span>
                          <span className="flex items-center gap-1 text-xs text-gray-500">
                            <Clock className="w-3 h-3" />
                            {timeAgo(job.createdAt)}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
