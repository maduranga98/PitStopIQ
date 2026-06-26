import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { ClipboardList, CheckCircle, AlertTriangle, XCircle, Image, ChevronDown, ChevronUp } from "lucide-react";
import { db } from "../../config/firebase";
import type { VehicleInspection, ChecklistStatus } from "../../types/auth";

const STATUS_ICON: Record<ChecklistStatus, React.ReactNode> = {
  ok:              <CheckCircle  className="w-4 h-4 text-green-400 flex-shrink-0" />,
  needs_attention: <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />,
  damaged:         <XCircle      className="w-4 h-4 text-red-400   flex-shrink-0" />,
};

const STATUS_LABEL: Record<ChecklistStatus, string> = {
  ok:              "OK",
  needs_attention: "Needs Attention",
  damaged:         "Damaged",
};

const FUEL_LABEL: Record<string, string> = {
  empty:         "Empty",
  quarter:       "1/4",
  half:          "1/2",
  three_quarter: "3/4",
  full:          "Full",
};

const CONDITION_LABEL: Record<string, { label: string; color: string }> = {
  good:         { label: "Good",         color: "text-green-400" },
  minor_damage: { label: "Minor Damage", color: "text-amber-400" },
  major_damage: { label: "Major Damage", color: "text-red-400"   },
};

function formatTs(ts: { toDate: () => Date } | undefined): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

interface Props {
  centerId: string;
  jobId: string;
}

export default function InspectionViewer({ centerId, jobId }: Props) {
  const [inspection, setInspection] = useState<VehicleInspection | null | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!centerId || !jobId) return;
    const unsub = onSnapshot(
      doc(db, "servicecenters", centerId, "jobs", jobId, "inspection", "main"),
      (snap) => {
        setInspection(snap.exists() ? (snap.data() as VehicleInspection) : null);
      },
    );
    return unsub;
  }, [centerId, jobId]);

  if (inspection === undefined) return null; // loading
  if (inspection === null) return null;      // no inspection on this job
  if (inspection.skipped) {
    return (
      <div className="bg-[#162032] border border-white/10 rounded-xl p-4">
        <div className="flex items-center gap-2 text-gray-500">
          <ClipboardList className="w-4 h-4" />
          <span className="text-xs uppercase tracking-wider font-semibold">Vehicle Inspection</span>
        </div>
        <p className="text-sm text-gray-500 mt-2">Inspection was skipped for this job.</p>
      </div>
    );
  }

  const flagged = inspection.checklistItems?.filter(
    (c) => c.status !== "ok",
  ) ?? [];

  const cond = CONDITION_LABEL[inspection.overallCondition] ?? { label: inspection.overallCondition, color: "text-gray-300" };

  return (
    <div className="bg-[#162032] border border-white/10 rounded-xl overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <ClipboardList className="w-5 h-5 text-[#F97316]" />
          <div className="text-left">
            <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Vehicle Inspection</div>
            <div className="flex items-center gap-3 mt-0.5">
              <span className={`text-sm font-medium ${cond.color}`}>{cond.label}</span>
              <span className="text-xs text-gray-500">·</span>
              <span className="text-xs text-gray-400">Fuel: {FUEL_LABEL[inspection.fuelLevel] ?? inspection.fuelLevel}</span>
              {inspection.odometerReading > 0 && (
                <>
                  <span className="text-xs text-gray-500">·</span>
                  <span className="text-xs text-gray-400">{inspection.odometerReading.toLocaleString()} km</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {flagged.length > 0 && (
            <span className="text-xs bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full">
              {flagged.length} flagged
            </span>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-white/10 p-4 space-y-5">
          <div className="text-xs text-gray-500">
            Completed {formatTs(inspection.completedAt as any)}
          </div>

          {/* Checklist */}
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-2">Checklist</div>
            <div className="space-y-1.5">
              {inspection.checklistItems?.map((c) => (
                <div key={c.item} className="flex items-center gap-2 text-sm">
                  {STATUS_ICON[c.status]}
                  <span className={c.status === "ok" ? "text-gray-400" : "text-white"}>{c.item}</span>
                  {c.status !== "ok" && (
                    <span className={`text-xs ml-auto ${c.status === "damaged" ? "text-red-400" : "text-amber-400"}`}>
                      {STATUS_LABEL[c.status]}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Damage Reports */}
          {inspection.damageReports?.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-2">Damage Reports</div>
              <div className="space-y-3">
                {inspection.damageReports.map((r, i) => (
                  <div key={r.id} className="bg-[#0B1120] border border-white/5 rounded-xl p-3 space-y-2">
                    <div className="text-xs text-gray-500 font-semibold">Report {i + 1} · {r.location}</div>
                    {r.description && <p className="text-sm text-gray-300">{r.description}</p>}
                    {r.photoUrl && !r.photosDeleted ? (
                      <div>
                        <img
                          src={r.photoUrl}
                          alt={r.location}
                          className="w-40 h-28 object-cover rounded-lg"
                        />
                        <p className="text-[11px] text-gray-600 mt-1">
                          Photo auto-deletes {formatTs(r.photoDeleteAt as any)}
                        </p>
                      </div>
                    ) : r.photoUrl === null && r.photosDeleted ? (
                      <div className="flex items-center gap-2 text-xs text-gray-600">
                        <Image className="w-3.5 h-3.5" />
                        Photo deleted after 30 days
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          {inspection.notes && (
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-1">Notes</div>
              <p className="text-sm text-gray-300 whitespace-pre-wrap">{inspection.notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
