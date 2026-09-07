// Bay Board — one column per bay, showing the services queued at it across
// every open job. "Vacuum Bay: 3 jobs waiting", at a glance.
//
// Part of the optional bay workflow. Each card moves through its own
// Waiting → In progress → Done independently of the job it belongs to and of
// the other services on that job; only when every bay-routed service on a job
// is done can the job itself be marked done (see ServiceDetailPage).
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, doc, onSnapshot, query, serverTimestamp, where } from "firebase/firestore";
import { LayoutGrid } from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { LoadingBlock } from "../../components/LoadingProgress";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import { safeUpdateDoc } from "../../lib/firestoreWrite";
import { useServiceBays, useWorkshopModules } from "../../hooks/useWorkshopModules";
import { BAY_STATUS_LABELS, BAY_STATUS_CLASSES } from "../../lib/serviceLines";
import type { BayStatus, ServiceJob } from "../../types/auth";

/** One service on one job, sitting at one bay. */
interface BayCard {
  jobId: string;
  jobNumber: string;
  plateNumber: string;
  lineIndex: number;
  name: string;
  status: BayStatus;
}

const NEXT_STATUS: Record<BayStatus, BayStatus | null> = {
  pending: "in_progress",
  in_progress: "done",
  done: null,
};

export default function BayBoardPage() {
  const { currentUser } = useAuth();
  const centerId = currentUser?.centerId ?? "";
  // Both permissions are read unconditionally — `||` would short-circuit the
  // second call and change the hook order between renders.
  const canRecordServices = usePermission("jobs.recordServices");
  const canEditJob = usePermission("jobs.edit");
  const canRecord = canRecordServices || canEditJob;
  const { bayWorkflowEnabled, loading: modulesLoading } = useWorkshopModules(centerId);
  const { activeBays } = useServiceBays(centerId, bayWorkflowEnabled);

  // null until the first snapshot arrives, which is what "still loading" means
  // here — no state has to be cleared from inside the effect to say so.
  const [loadedJobs, setLoadedJobs] = useState<ServiceJob[] | null>(null);
  const jobs = useMemo(() => loadedJobs ?? [], [loadedJobs]);
  const loading = Boolean(centerId) && bayWorkflowEnabled && loadedJobs === null;

  // Only the open jobs — a delivered job has nothing left at a bay.
  useEffect(() => {
    if (!centerId || !bayWorkflowEnabled) return;
    return onSnapshot(
      query(
        collection(db, "servicecenters", centerId, "jobs"),
        where("status", "in", ["pending", "in_progress"]),
      ),
      (snap) => setLoadedJobs(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as ServiceJob))
          .filter((j) => !j.isDeleted),
      ),
      () => setLoadedJobs([]),
    );
  }, [centerId, bayWorkflowEnabled]);

  const cardsByBay = useMemo(() => {
    const map = new Map<string, BayCard[]>();
    jobs.forEach((job) => {
      (job.serviceLines ?? []).forEach((line, lineIndex) => {
        if (!line.bayId || line.bayStatus === "done") return;
        map.set(line.bayId, [
          ...(map.get(line.bayId) ?? []),
          {
            jobId: job.id,
            jobNumber: job.jobNumber,
            plateNumber: job.plateNumber,
            lineIndex,
            name: line.name,
            status: line.bayStatus ?? "pending",
          },
        ]);
      });
    });
    return map;
  }, [jobs]);

  async function advance(card: BayCard) {
    const next = NEXT_STATUS[card.status];
    if (!next || !canRecord) return;
    const job = jobs.find((j) => j.id === card.jobId);
    if (!job) return;
    const lines = (job.serviceLines ?? []).map((l, i) =>
      i === card.lineIndex ? { ...l, bayStatus: next } : l,
    );
    await safeUpdateDoc(doc(db, "servicecenters", centerId, "jobs", card.jobId), {
      serviceLines: lines,
      updatedAt: serverTimestamp(),
    });
  }

  if (modulesLoading || loading) {
    return <div className="min-h-screen bg-[#0B1120]"><LoadingBlock className="pt-24" /></div>;
  }

  if (!bayWorkflowEnabled) {
    return (
      <div className="min-h-screen bg-[#0B1120] text-white">
        <PageHeader icon={<LayoutGrid className="w-5 h-5" />} title="Bay Board" />
        <div className="max-w-3xl mx-auto px-4 py-12 text-center">
          <p className="text-sm text-gray-400">Service bays aren't switched on for this center.</p>
          <Link to="/settings?tab=services" className="text-sm text-orange-400 hover:text-orange-300 mt-2 inline-block">
            Turn them on in Settings → Services &amp; Modules →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader icon={<LayoutGrid className="w-5 h-5" />} title="Bay Board" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeBays.length === 0 ? (
          <div className="border border-dashed border-white/10 rounded-xl px-4 py-10 text-center">
            <p className="text-sm text-gray-400">No bays set up yet.</p>
            <Link to="/settings?tab=services" className="text-xs text-orange-400 hover:text-orange-300 mt-2 inline-block">
              Add your bays →
            </Link>
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-4">
            {activeBays.map((bay) => {
              const cards = cardsByBay.get(bay.id) ?? [];
              const waiting = cards.filter((c) => c.status === "pending").length;
              return (
                <div key={bay.id} className="w-72 flex-shrink-0 bg-[#162032] border border-white/10 rounded-xl">
                  <div className="px-4 py-3 border-b border-white/5">
                    <div className="text-sm font-semibold text-white truncate">{bay.name}</div>
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      {cards.length === 0
                        ? "Clear"
                        : `${cards.length} in the bay · ${waiting} waiting`}
                    </div>
                  </div>
                  <div className="p-3 space-y-2 min-h-[6rem]">
                    {cards.length === 0 ? (
                      <p className="text-xs text-gray-600 text-center py-4">Nothing queued</p>
                    ) : (
                      cards.map((card) => (
                        <div
                          key={`${card.jobId}-${card.lineIndex}`}
                          className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 space-y-1.5"
                        >
                          <div className="text-sm text-white truncate">{card.name}</div>
                          <Link
                            to={`/services/${card.jobId}`}
                            className="block text-[11px] text-gray-500 hover:text-orange-400 truncate"
                          >
                            {card.plateNumber} · {card.jobNumber}
                          </Link>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] rounded-full border px-2 py-0.5 ${BAY_STATUS_CLASSES[card.status]}`}>
                              {BAY_STATUS_LABELS[card.status]}
                            </span>
                            {canRecord && NEXT_STATUS[card.status] && (
                              <button
                                onClick={() => advance(card)}
                                className="ml-auto text-[11px] text-orange-400 hover:text-orange-300"
                              >
                                {card.status === "pending" ? "Start →" : "Done →"}
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
