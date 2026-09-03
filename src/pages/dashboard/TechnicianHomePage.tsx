import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { Wrench, Clock, ChevronRight, ClipboardList, Package } from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import type { ServiceJob } from "../../types/auth";
import { mergeJobLists } from "../../lib/jobTechnicians";
import { LoadingBlock } from "../../components/LoadingProgress";

// The technician landing page. Deliberately not a dashboard: no revenue, no
// customer or vehicle directory, no center-wide counts — only the jobs this
// technician has been assigned, plus a way into inventory requests.

const STATUS_CHIP: Record<ServiceJob["status"], string> = {
  pending: "bg-slate-500/20 text-slate-300 border border-slate-500/30",
  in_progress: "bg-amber-500/20 text-amber-300 border border-amber-500/30",
  done: "bg-green-500/20 text-green-300 border border-green-500/30",
  delivered: "bg-blue-500/20 text-blue-300 border border-blue-500/30",
};

const STATUS_LABEL: Record<ServiceJob["status"], string> = {
  pending: "Pending",
  in_progress: "In Progress",
  done: "Done",
  delivered: "Delivered",
};

// Active work first, finished work last.
const STATUS_ORDER: ServiceJob["status"][] = ["in_progress", "pending", "done", "delivered"];

function timeAgo(ts: { toDate: () => Date }): string {
  const mins = Math.floor((Date.now() - ts.toDate().getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)} days ago`;
}

type Filter = "active" | "all";

export default function TechnicianHomePage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const canRequestStock = usePermission("inventory.request");

  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("active");

  const centerId = currentUser?.centerId;
  const uid = currentUser?.uid;

  // A job assigns a crew, so "my jobs" is two queries: the ones where this
  // technician is the lead (the field every job has carried since day one) and
  // the ones where they're anywhere in the crew. Firestore can't OR the two
  // without a composite index, so they're merged here instead.
  const [leadJobs, setLeadJobs] = useState<ServiceJob[]>([]);
  const [crewJobs, setCrewJobs] = useState<ServiceJob[]>([]);

  useEffect(() => {
    if (!centerId || !uid) return;
    const unsubLead = onSnapshot(
      query(collection(db, "servicecenters", centerId, "jobs"), where("technicianId", "==", uid)),
      snap => {
        setLeadJobs(snap.docs.map(d => ({ id: d.id, ...d.data() } as ServiceJob)));
        setLoading(false);
      },
      () => setLoading(false),
    );
    const unsubCrew = onSnapshot(
      query(collection(db, "servicecenters", centerId, "jobs"), where("technicianIds", "array-contains", uid)),
      snap => {
        setCrewJobs(snap.docs.map(d => ({ id: d.id, ...d.data() } as ServiceJob)));
        setLoading(false);
      },
      () => setCrewJobs([]),
    );
    return () => { unsubLead(); unsubCrew(); };
  }, [centerId, uid]);

  const jobs = useMemo(
    () => mergeJobLists(leadJobs, crewJobs).filter((j) => !j.isDeleted),
    [leadJobs, crewJobs],
  );

  const visible = useMemo(() => {
    const list = filter === "active"
      ? jobs.filter(j => j.status === "pending" || j.status === "in_progress")
      : [...jobs];
    return list.sort((a, b) => {
      const byStatus = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
      if (byStatus !== 0) return byStatus;
      return b.createdAt.toDate().getTime() - a.createdAt.toDate().getTime();
    });
  }, [jobs, filter]);

  const activeCount = jobs.filter(j => j.status === "pending" || j.status === "in_progress").length;

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader
        icon={<Wrench className="w-5 h-5" />}
        title="My Jobs"
        actions={
          canRequestStock ? (
            <button
              onClick={() => navigate("/inventory/requests?new=1")}
              className="flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold px-4 py-2.5 rounded-xl transition text-sm"
            >
              <Package className="h-4 w-4" />
              Request Item
            </button>
          ) : undefined
        }
        below={
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pb-3 flex items-center gap-3">
            <div className="flex bg-white/5 rounded-lg p-0.5 gap-0.5">
              {(["active", "all"] as Filter[]).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                    filter === f ? "bg-orange-500 text-white" : "text-gray-400 hover:text-white"
                  }`}
                >
                  {f === "active" ? `Active (${activeCount})` : `All (${jobs.length})`}
                </button>
              ))}
            </div>
          </div>
        }
      />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {loading ? (
          <LoadingBlock className="py-20" />
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <ClipboardList className="w-12 h-12 text-gray-600 mb-4" />
            <p className="text-gray-400 font-medium">
              {filter === "active" ? "No jobs assigned to you right now" : "No jobs assigned to you yet"}
            </p>
            <p className="text-gray-600 text-sm mt-1">
              Assigned jobs appear here as soon as the front desk allocates them.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map(job => (
              <button
                key={job.id}
                onClick={() => navigate(`/services/${job.id}`)}
                className="w-full text-left bg-[#162032] border border-white/10 rounded-xl p-4 hover:border-orange-500/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-white font-mono">{job.plateNumber}</span>
                      {job.jobNumber && (
                        <span className="text-xs text-gray-500 font-mono">{job.jobNumber}</span>
                      )}
                    </div>
                    <div className="text-gray-400 text-xs mt-1 truncate">
                      {[...(job.services ?? []), ...(job.customServices ?? [])].join(", ") || "—"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${STATUS_CHIP[job.status]}`}>
                      {STATUS_LABEL[job.status]}
                    </span>
                    <ChevronRight className="h-4 w-4 text-gray-600" />
                  </div>
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/5 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {timeAgo(job.createdAt)}
                  </span>
                  {job.mileageIn ? <span>{job.mileageIn.toLocaleString()} km in</span> : null}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
