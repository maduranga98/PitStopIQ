import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { collection, query, orderBy, where, limit, Timestamp } from "firebase/firestore";
import { watchQuery } from "../../lib/listeners";
import { Plus, Wrench, Clock, ChevronDown, Search, Tag } from "lucide-react";
import { usePermission } from "../../contexts/PermissionsContext";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type { ServiceJob } from "../../types/auth";
import { isJobTechnician, jobHasTechnicianName, jobTechnicianLabel, jobTechnicianNames } from "../../lib/jobTechnicians";
import { useTranslation } from "react-i18next";
import { LoadingBlock } from "../../components/LoadingProgress";

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

// Hex, not `bg-amber-500`: a solid palette fill compiles to
// `var(--color-amber-500)`, which is an `oklch()` a pre-2023 phone cannot read,
// and the header then paints nothing at all. index.css restores that variable
// for every such browser; these four are written out as well because the colour
// IS the column — there is nothing else on the header to tell them apart.
// (Alpha fills like the chips below are already safe: the minifier resolves
// them to a hex before the color-mix().)
const COLUMNS: { key: ServiceJob["status"]; label: string; headerBg: string; borderColor: string }[] = [
  { key: "pending",     label: "Pending",     headerBg: "bg-[#475569]", borderColor: "border-[#64748B]" },
  { key: "in_progress", label: "In Progress", headerBg: "bg-[#F59E0B]", borderColor: "border-[#F59E0B]" },
  { key: "done",        label: "Done",        headerBg: "bg-[#16A34A]", borderColor: "border-[#22C55E]" },
  { key: "delivered",   label: "Delivered",   headerBg: "bg-[#1D4ED8]", borderColor: "border-[#3B82F6]" },
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

type DateFilter = "today" | "week" | "lastWeek" | "all";
type StatusFilter = "all" | ServiceJob["status"];

// ── Date window ────────────────────────────────────────────────────────────────
// These used to be isToday()/isThisWeek() predicates applied AFTER the whole
// jobs collection had been downloaded, so the filter saved nothing: a center
// two years in was streaming every job it had ever written to every device just
// to show the eight cards it opened today. They are now the START of the
// Firestore query instead, so the network only ever carries the window on
// screen. Equality-free single-field range + orderBy on the same field, so no
// composite index is needed.

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Sunday 00:00 of the week `weeksAgo` weeks back — 0 is the week in progress,
// 1 the one before it. setDate() rolls the month and the year over on its own,
// so a week that straddles either needs no special case.
function startOfWeek(weeksAgo = 0): Date {
  const now = new Date();
  const d = new Date(now);
  d.setDate(now.getDate() - now.getDay() - weeksAgo * 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

// The Firestore window each option asks for. "Last week" is the only one with
// an upper bound — it ends where "this week" begins, so a job belongs to
// exactly one of the two. Both bounds are on `createdAt`, the same field the
// query orders by, so this is still a single-field range and still needs no
// composite index.
function dateWindow(filter: Exclude<DateFilter, "all">): { from: Date; to?: Date } {
  if (filter === "today") return { from: startOfToday() };
  if (filter === "week") return { from: startOfWeek() };
  return { from: startOfWeek(1), to: startOfWeek() };
}

const DATE_LABEL: Record<DateFilter, string> = {
  today: "Today",
  week: "This Week",
  lastWeek: "Last Week",
  all: "All",
};

// "All" still has to be bounded — it is the one option with no natural limit.
// A page is loaded at a time and the button below extends it, so the history is
// all still reachable; it just isn't all downloaded before the first paint.
const ALL_PAGE_SIZE = 200;

export default function ServicesPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const canCreateJob = usePermission("jobs.create");
  // Setting up services and prices is its own job — no job card required.
  const canViewCatalog = usePermission("serviceLibrary.view");
  const canViewAll = usePermission("jobs.viewAll");

  const isPro = currentUser?.centerPlan === "pro";

  const [jobs, setJobs] = useState<ServiceJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [techFilter, setTechFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("today");
  // How far back "All" currently reaches. Raised by the Load more button.
  const [allPageSize, setAllPageSize] = useState(ALL_PAGE_SIZE);
  // Basic plan list-view filter
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!currentUser?.centerId) return;
    const jobs = collection(db, "servicecenters", currentUser.centerId, "jobs");
    let q;
    if (dateFilter === "all") {
      q = query(jobs, orderBy("createdAt", "desc"), limit(allPageSize));
    } else {
      const { from, to } = dateWindow(dateFilter);
      q = query(
        jobs,
        where("createdAt", ">=", Timestamp.fromDate(from)),
        // Closed windows get their upper bound too; open-ended ones ("today",
        // "this week") run to now and add no constraint at all.
        ...(to ? [where("createdAt", "<", Timestamp.fromDate(to))] : []),
        orderBy("createdAt", "desc"),
      );
    }
    return watchQuery(q, (snap) => {
      setJobs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ServiceJob)).filter((j) => !j.isDeleted));
      setLoading(false);
    },
      // A dead listener must not leave the screen on a spinner: show the
      // empty state instead. The wrapper has already logged the cause.
      () => setLoading(false),
    );
  }, [currentUser?.centerId, dateFilter, allPageSize]);

  const technicians = useMemo(() => {
    // A job can carry a crew, so every name on every job is an option. Basic-
    // plan jobs can be unassigned, which simply contributes no names.
    const names = Array.from(new Set(jobs.flatMap(jobTechnicianNames)));
    return names.sort();
  }, [jobs]);

  const departmentNames = useMemo(() => {
    const names = Array.from(new Set(jobs.map((j) => j.departmentName).filter((n): n is string => Boolean(n))));
    return names.sort();
  }, [jobs]);

  const filtered = useMemo(() => {
    return jobs.filter((j) => {
      if (!canViewAll) {
        // A technician sees a job whether they're the lead or one of the crew.
        if (!isJobTechnician(j, currentUser?.uid)) return false;
      } else if (techFilter !== "all" && !jobHasTechnicianName(j, techFilter)) {
        return false;
      }
      if (canViewAll && deptFilter !== "all" && j.departmentName !== deptFilter) return false;
      // The date window is applied by the query itself now — see the listener
      // above — so there is nothing left to filter out here.
      return true;
    });
  }, [jobs, techFilter, deptFilter, currentUser, canViewAll]);

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

  // Changing the window always starts from one page again, so coming back to
  // "All" later doesn't silently re-download everything a previous visit had
  // expanded to.
  function selectDateFilter(next: DateFilter) {
    setDateFilter(next);
    setAllPageSize(ALL_PAGE_SIZE);
  }

  // "All" loads a page at a time (see the listener above). Offered only when the
  // window is actually full, so it never appears on a center whose entire
  // history already fits.
  const canLoadMore = dateFilter === "all" && jobs.length >= allPageSize;
  const loadMore = (
    canLoadMore ? (
      <div className="flex flex-col items-center gap-1 py-6">
        <button
          onClick={() => setAllPageSize((n) => n + ALL_PAGE_SIZE)}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white transition-colors"
        >
          Load older jobs
        </button>
        <span className="text-xs text-gray-600">Showing the {jobs.length} most recent</span>
      </div>
    ) : null
  );

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
          <>
            {canViewCatalog && (
              <button
                onClick={() => navigate("/services/catalog")}
                title="Add, edit or price services without creating a job"
                className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                <Tag className="w-4 h-4" />
                <span className="hidden sm:inline">Manage Services</span>
              </button>
            )}
            {canCreateJob && (
              <button
                onClick={() => navigate("/services/new")}
                className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                New Service
              </button>
            )}
          </>
        }
        below={
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-3 flex flex-wrap items-center gap-3">
            <div className="flex bg-white/5 rounded-lg p-0.5 gap-0.5 overflow-x-auto max-w-full">
              {(["today", "week", "lastWeek", "all"] as DateFilter[]).map((d) => (
                <button
                  key={d}
                  onClick={() => selectDateFilter(d)}
                  className={`px-3 py-1 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                    dateFilter === d ? "bg-[#F97316] text-white" : "text-gray-400 hover:text-white"
                  }`}
                >
                  {DATE_LABEL[d]}
                </button>
              ))}
            </div>
            {canViewAll && (
              <div className="relative">
                <select
                  value={techFilter}
                  onChange={(e) => setTechFilter(e.target.value)}
                  className="appearance-none bg-[#162032] border border-white/10 text-white rounded-lg px-3 py-1.5 pr-8 text-sm focus:outline-none focus:border-orange-500 [color-scheme:dark]"
                >
                  <option value="all" className="bg-[#0B1120] text-white">All Technicians</option>
                  {technicians.map((t) => (
                    <option key={t} value={t} className="bg-[#0B1120] text-white">{t}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
            )}
            {canViewAll && departmentNames.length > 0 && (
              <div className="relative">
                <select
                  value={deptFilter}
                  onChange={(e) => setDeptFilter(e.target.value)}
                  className="appearance-none bg-[#162032] border border-white/10 text-white rounded-lg px-3 py-1.5 pr-8 text-sm focus:outline-none focus:border-orange-500 [color-scheme:dark]"
                >
                  <option value="all" className="bg-[#0B1120] text-white">All Departments</option>
                  {departmentNames.map((n) => (
                    <option key={n} value={n} className="bg-[#0B1120] text-white">{n}</option>
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
        <LoadingBlock className="py-20" />
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
                          <span className="text-xs text-gray-500 truncate">{jobTechnicianLabel(job)}</span>
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
          {loadMore}
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
                    <span>{jobTechnicianLabel(job) || "—"}</span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDate(job.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {loadMore}
        </div>
      )}
    </div>
  );
}
