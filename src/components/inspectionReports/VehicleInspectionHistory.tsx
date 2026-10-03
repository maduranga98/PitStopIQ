import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileCheck } from "lucide-react";
import type { DocumentData, QueryDocumentSnapshot } from "firebase/firestore";
import { fetchVehicleReportsPage } from "../../lib/inspectionReports/reports";
import { StatusBadge, TypeBadge } from "./ReportBadges";
import type { InspectionReport } from "../../types/inspectionReports";

const fmt = (ts: { toDate?: () => Date } | null | undefined) =>
  ts?.toDate ? ts.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";

/** A vehicle's inspection reports (history), 20 at a time, newest first. Read on
 *  demand — never a listener. Shown only while the module is on. */
export default function VehicleInspectionHistory({ centerId, vehicleId }: { centerId: string; vehicleId: string }) {
  const [reports, setReports] = useState<InspectionReport[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async (from: QueryDocumentSnapshot<DocumentData> | null) => {
    if (from) setMore(true); else setLoading(true);
    setError(false);
    try {
      const page = await fetchVehicleReportsPage(centerId, vehicleId, from);
      setReports((prev) => (from ? [...prev, ...page.reports] : page.reports));
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } catch { setError(true); }
    finally { setLoading(false); setMore(false); }
  }, [centerId, vehicleId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
  useEffect(() => { load(null); }, [load]);

  return (
    <div className="bg-[#162032] border border-white/10 rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-3">
        <FileCheck className="w-4 h-4 text-[#F97316]" />
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Inspection reports</h2>
      </div>
      {loading ? <p className="text-sm text-gray-500">Loading…</p>
        : error ? <button onClick={() => load(null)} className="text-sm text-[#F97316]">Couldn't load. Try again</button>
        : reports.length === 0 ? <p className="text-sm text-gray-500">No inspection reports for this vehicle yet.</p>
        : (
          <div className="space-y-2">
            {reports.map((r) => (
              <Link key={r.id} to={`/inspection-reports/${r.id}`}
                className="flex items-center gap-2 bg-[#0B1120] border border-white/5 hover:border-[#F97316]/30 rounded-xl px-4 py-3 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{r.reportNumber ?? "Not numbered"}</p>
                  <p className="text-xs text-gray-500">{fmt(r.status === "finalized" ? r.finalizedAt : r.createdAt)}{r.inspectorName && ` · ${r.inspectorName}`}</p>
                </div>
                <TypeBadge type={r.type} /> <StatusBadge status={r.status} />
              </Link>
            ))}
            {hasMore && (
              <button onClick={() => load(cursor)} disabled={more} className="w-full py-2 text-sm text-[#F97316] disabled:opacity-50">
                {more ? "Loading…" : "Load more"}
              </button>
            )}
          </div>
        )}
    </div>
  );
}
