import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { collection, query, onSnapshot, orderBy } from "firebase/firestore";
import { Plus, Wrench, Clock, ChevronDown, Search } from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type { ServiceJob } from "../../types/auth";
import { useTranslation } from "react-i18next";

function timeAgo(ts: { toDate: () => Date }): string {
  const diff = Date.now() - ts.toDate().getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)} days ago`;
}

function formatDate(ts: { toDate: () => Date }): string {
  return ts.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const COLUMNS: { key: ServiceJob["status"]; label: string; headerBg: string; borderColor: string }[] = [
  { key: "pending",     label: "Pending",     headerBg: "bg-slate-600",  borderColor: "border-slate-500" },
  { key: "in_progress", label: "In Progress", headerBg: "bg-amber-500",  borderColor: "border-amber-500" },
  { key: "done",        label: "Done",        headerBg: "bg-green-600",  borderColor: "border-green-500" },
  { key: "delivered",   label: "Delivered",   headerBg: "bg-blue-700",   borderColor: "border-blue-500"  },
];

const STATUS_CHIP: Record<ServiceJob["status"], string> = {
  pending:     "bg-slate-500/20 text-slate-300 border border-slate-500/30",
  in_progress: "bg-amber-500/20 text-amber-300 border border-amber-500/30",
  done:        "bg-green-500/20 text-green-300 border border-green-500/30",
  delivered:   "bg-blue-500/20 text-blue-300 border border-blue-500/30",
};

const STATUS_LABEL: Record<ServiceJob["status"], string> = {
  pending: "Pending",
  in_progress: "In Progress",
  done: "Done",
  delivered: "Delivered",
};

type DateFilter = "today" | "week" | "all";
type StatusFilter = "all" | ServiceJob["status"];

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
  const { t } = useTranslation();

  const isPro = currentUser?.centerPlan === "pro";

  const [jobs, setJobs] = useState<ServiceJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [techFilter, setTechFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("today");
  // Basic plan list-view filter
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

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

  // Basic plan: further filter by status + search
  const basicFiltered = useMemo(() => {
    return filtered.filter((j) => {
      if (statusFilter !== "all" && j.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          j.plateNumber.toLowerCase().includes(q) ||
          j.customerName.toLowerCase().includes(q) ||
          j.jobNumber?.toLowerCase().includes(q) ||
          j.services.some((s) => s.toLowerCase().includes(q)) ||
          j.customServices.some((s) => s.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [filtered, statusFilter, search]);

  const statusTabs: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "in_progress", label: "In Progress" },
    { key: "done", label: "Done" },
    { key: "delivered", label: "Delivered" },
  ];

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader
        icon={<Wrench className="w-5 h-5" />}
        title={t("services.title")}
        actions={
          <button
            onClick={() => navigate("/services/new")}
            className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Service
          </button>
        }
        below={
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-3 flex flex-wrap items-center gap-3">
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
            {!isPro && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  placeholder="Search plate, customer…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 pr-3 py-1.5 bg-white/5 border border-white/10 text-white rounded-lg text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500 w-48"
                />
              </div>
            )}
          </div>
        }
      />

      {loading ? (
        <div className="text-center text-gray-400 py-20">Loading...</div>
      ) : isPro ? (
        /* ── Pro: Kanban board ─────────────────────────────────────────── */
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {COLUMNS.map((col) => {
              const colJobs = filtered.filter((j) => j.status === col.key);
              return (
                <div key={col.key} className="flex flex-col gap-3">
                  <div className={`${col.headerBg} rounded-lg px-3 py-2 flex items-center justify-between`}>
                    <span className="text-sm font-semibold text-white">{col.label}</span>
                    <span className="text-xs bg-black/20 text-white px-2 py-0.5 rounded-full">{colJobs.length}</span>
                  </div>
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
        </div>
      ) : (
        /* ── Basic: Simple list view ───────────────────────────────────── */
        <div className="max-w-3xl mx-auto px-4 py-6">
          {/* Status tabs */}
          <div className="flex gap-1 bg-[#162032] border border-white/10 rounded-xl p-1 w-fit mb-5 overflow-x-auto">
            {statusTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  statusFilter === tab.key
                    ? "bg-[#F97316] text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                {tab.label}
                {tab.key !== "all" && (
                  <span className="ml-1.5 text-xs opacity-70">
                    {filtered.filter((j) => j.status === tab.key).length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {basicFiltered.length === 0 ? (
            <div className="flex flex-col items-center py-20 text-center">
              <Wrench className="w-12 h-12 text-gray-600 mb-4" />
              <p className="text-gray-400 font-medium">No service jobs found</p>
              <p className="text-gray-600 text-sm mt-1">
                {search ? "Try a different search term." : "Click \"New Service\" to get started."}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {basicFiltered.map((job) => (
                <div
                  key={job.id}
                  onClick={() => navigate(`/services/${job.id}`)}
                  className="bg-[#162032] border border-white/10 rounded-xl p-4 cursor-pointer hover:border-orange-500/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-white font-mono">{job.plateNumber}</span>
                        {job.jobNumber && (
                          <span className="text-xs text-gray-500 font-mono">{job.jobNumber}</span>
                        )}
                      </div>
                      <div className="text-gray-300 text-sm mt-0.5">{job.customerName}</div>
                      <div className="text-gray-400 text-xs mt-1 truncate">
                        {[...job.services, ...job.customServices].join(", ") || "—"}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${STATUS_CHIP[job.status]}`}>
                        {STATUS_LABEL[job.status]}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/5 text-xs text-gray-500">
                    <span>{job.technicianName || "—"}</span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDate(job.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
